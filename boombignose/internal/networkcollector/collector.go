// Package networkcollector sends metadata-only macOS TCP snapshots to one
// enrolled ERP origin. It never elevates privileges or captures packet payloads.
package networkcollector

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const reportInterval = 30 * time.Second
const operationTimeout = 10 * time.Second
const maxSnapshotBytes = 4 * 1024 * 1024

var errSnapshot = errors.New("TCP snapshot failed; no heartbeat sent")
var errRequest = errors.New("telemetry request failed; no successful heartbeat confirmed")

// limitedOutput bounds exec's stdout/stderr without logging either stream.
type limitedOutput struct {
	buffer   bytes.Buffer
	limit    int
	exceeded bool
}

func (out *limitedOutput) Write(data []byte) (int, error) {
	if len(data) > out.limit-out.buffer.Len() {
		out.exceeded = true
		return 0, errSnapshot
	}
	return out.buffer.Write(data)
}

func collect(ctx context.Context) (Report, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, "/usr/sbin/lsof", "-nP", "-iTCP", "-sTCP:ESTABLISHED", "-Fpcn")
	command.WaitDelay = time.Second
	stdout := &limitedOutput{limit: maxSnapshotBytes}
	stderr := &limitedOutput{limit: 16 * 1024}
	command.Stdout, command.Stderr = stdout, stderr
	err := command.Run()
	exitCode := 0
	if err != nil {
		exitCode = -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			exitCode = exit.ExitCode()
		}
	}
	if ctx.Err() != nil {
		exitCode = -1
	}
	return snapshotResult(stdout, stderr, exitCode, time.Now())
}

func snapshotResult(stdout, stderr *limitedOutput, exitCode int, capturedAt time.Time) (Report, error) {
	if stdout.exceeded || stderr.exceeded || strings.TrimSpace(stderr.buffer.String()) != "" {
		return Report{}, errSnapshot
	}
	// lsof exit 1 with no output means no matching sockets. Partial
	// output, spawn/timeout errors, and other exit codes never heartbeat.
	if exitCode != 0 && (exitCode != 1 || strings.TrimSpace(stdout.buffer.String()) != "") {
		return Report{}, errSnapshot
	}
	return parseSnapshot(stdout.buffer.String(), capturedAt), nil
}

func newHTTPClient() *http.Client {
	return &http.Client{
		Timeout:       operationTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errRequest },
	}
}

func sendReport(ctx context.Context, client *http.Client, cfg config, report Report) error {
	payload := struct {
		DeviceID string `json:"deviceId"`
		Report   Report `json:"report"`
	}{cfg.DeviceID, report}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return errRequest
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.ERPURL+"/api/network/telemetry", bytes.NewReader(encoded))
	if err != nil {
		return errRequest
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+cfg.DeviceToken)
	response, err := client.Do(request)
	if err != nil {
		return errRequest
	}
	// Never decode or print response bodies, even on rejection.
	response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("telemetry rejected (HTTP %d); no successful heartbeat confirmed", response.StatusCode)
	}
	return nil
}

// Execute runs the explicit collector command. The caller owns signal handling;
// canceling ctx stops lsof, HTTP requests, and the interval without a heartbeat.
func Execute(ctx context.Context, args []string, out io.Writer) error {
	if runtime.GOOS != "darwin" {
		return errors.New("network collector supports macOS only")
	}
	var configPath string
	once := false
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--config" && configPath == "" && i+1 < len(args):
			i++
			configPath = args[i]
		case args[i] == "--once" && !once:
			once = true
		default:
			return errors.New("usage: network-collector --config ABS_PATH [--once]")
		}
	}
	if !filepath.IsAbs(configPath) {
		return errors.New("--config requires an absolute file path")
	}
	cfg, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	target, _ := url.Parse(cfg.ERPURL)
	client := newHTTPClient()
	defer client.CloseIdleConnections()
	for ctx.Err() == nil {
		startedAt := time.Now()
		report, err := collect(ctx)
		if err == nil && ctx.Err() == nil {
			err = sendReport(ctx, client, cfg, report)
		}
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			if once {
				return err
			}
			fmt.Fprintf(out, "Collector cycle failed: %s\n", err.Error())
		} else {
			suffix := ""
			if report.Truncated {
				suffix = " (truncated at 500)"
			}
			fmt.Fprintf(out, "Snapshot sent: %d TCP sockets to %s%s\n", len(report.Observations), target.Host, suffix)
			if once {
				return nil
			}
		}
		timer := time.NewTimer(max(0, reportInterval-time.Since(startedAt)))
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}
