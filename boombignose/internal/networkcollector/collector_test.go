package networkcollector

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHTTPPayloadAndCredentialPlacement(t *testing.T) {
	token := strings.Repeat("a", 64)
	received := make(chan bool, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		raw, _ := io.ReadAll(io.LimitReader(request.Body, 256*1024))
		var payload struct {
			DeviceID string `json:"deviceId"`
			Report   Report `json:"report"`
		}
		err := json.Unmarshal(raw, &payload)
		received <- err == nil && request.Method == http.MethodPost && request.URL.Path == "/api/network/telemetry" && request.URL.RawQuery == "" && request.URL.User == nil && request.Header.Get("Authorization") == "Bearer "+token && request.Header.Get("Content-Type") == "application/json" && !bytes.Contains(raw, []byte(token)) && payload.DeviceID == "device_123" && payload.Report.Coverage == "current_user_tcp_snapshot" && len(payload.Report.Observations) == 1
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	cfg, err := parseConfig(configBytes(server.URL))
	if err != nil {
		t.Fatal("isolated sink config rejected")
	}
	if err := sendReport(context.Background(), newHTTPClient(), cfg, parseSnapshot("p1\ncnode\n"+socketLine, captureTime)); err != nil || !<-received {
		t.Fatal("incorrect telemetry request or credential placement")
	}
}

func TestRedirectsNeverFollowed(t *testing.T) {
	var destinationCalls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		destinationCalls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer destination.Close()
	for _, code := range []int{301, 302, 303, 307, 308} {
		redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			w.Header().Set("Location", destination.URL+"/credential-sink")
			w.WriteHeader(code)
		}))
		cfg, _ := parseConfig(configBytes(redirect.URL))
		err := sendReport(context.Background(), newHTTPClient(), cfg, parseSnapshot("", captureTime))
		redirect.Close()
		if err == nil || destinationCalls.Load() != 0 || strings.Contains(err.Error(), "credential-sink") {
			t.Fatal("redirect was followed or target leaked into error")
		}
	}
}

func TestHTTPRejectionsNeverExposeBodies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, "response-secret-password-token")
	}))
	defer server.Close()
	cfg, _ := parseConfig(configBytes(server.URL))
	err := sendReport(context.Background(), newHTTPClient(), cfg, parseSnapshot("", captureTime))
	if err == nil || !strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), cfg.DeviceToken) {
		t.Fatal("HTTP failure must report only a safe status summary")
	}
}

func TestHTTPTimeoutAndCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	cfg, _ := parseConfig(configBytes(server.URL))
	client := newHTTPClient()
	client.Timeout = 5 * time.Millisecond
	if err := sendReport(context.Background(), client, cfg, parseSnapshot("", captureTime)); err == nil || strings.Contains(err.Error(), server.URL) {
		t.Fatal("timeout must fail without exposing target/config")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := sendReport(ctx, newHTTPClient(), cfg, parseSnapshot("", captureTime)); err == nil {
		t.Fatal("canceled requests must not report success")
	}
}

func TestSnapshotOutputBound(t *testing.T) {
	output := &limitedOutput{limit: 8}
	if _, err := io.Copy(output, strings.NewReader("12345678")); err != nil {
		t.Fatal("exact output boundary rejected")
	}
	if _, err := io.Copy(output, strings.NewReader("9")); err == nil || output.buffer.Len() != 8 {
		t.Fatal("exec output cap was bypassed")
	}
}

func TestCommandArgumentSafety(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS-only command")
	}
	for _, args := range [][]string{
		nil, {"--config", "relative.json"}, {"--unknown", "secret"}, {"--config"}, {"--once", "--once"},
	} {
		var out bytes.Buffer
		if err := Execute(context.Background(), args, &out); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatal("invalid arguments accepted or echoed")
		}
	}
}

// This opt-in smoke runs the real macOS lsof collector against an ephemeral
// loopback sink. It never enrolls a device or touches an existing ERP/database.
func TestMacOSLiveCollectorToIsolatedSink(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("BOOMBIGNOSE_NETWORK_COLLECTOR_SMOKE") != "1" {
		t.Skip("opt in on macOS with BOOMBIGNOSE_NETWORK_COLLECTOR_SMOKE=1")
	}
	received := make(chan Report, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		var payload struct {
			DeviceID string `json:"deviceId"`
			Report   Report `json:"report"`
		}
		if request.Method != http.MethodPost || request.URL.Path != "/api/network/telemetry" || json.NewDecoder(io.LimitReader(request.Body, 256*1024)).Decode(&payload) != nil || payload.DeviceID != "device_123" || request.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		received <- payload.Report
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	name := filepath.Join(t.TempDir(), "collector.json")
	if err := os.WriteFile(name, configBytes(server.URL), 0o600); err != nil {
		t.Fatal("cannot create private smoke config")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	var out bytes.Buffer
	if err := Execute(ctx, []string{"--config", name, "--once"}, &out); err != nil {
		t.Fatal(err)
	}
	select {
	case report := <-received:
		if report.Coverage != "current_user_tcp_snapshot" || report.Observations == nil || len(report.Observations) > 500 {
			t.Fatal("invalid live report")
		}
		if _, err := time.Parse(time.RFC3339Nano, report.CapturedAt); err != nil {
			t.Fatal("invalid live capture time")
		}
		t.Log(strings.TrimSpace(out.String()))
	case <-ctx.Done():
		t.Fatal("no real collector report received by isolated sink")
	}
}

func TestLsofResultHeartbeatSemantics(t *testing.T) {
	for _, test := range []struct {
		name      string
		exit      int
		stdout    string
		stderr    string
		overflow  bool
		wantError bool
	}{
		{name: "success with sockets", stdout: "p1\ncnode\n" + socketLine},
		{name: "success no sockets"},
		{name: "exit one empty selection", exit: 1},
		{name: "exit one partial output", exit: 1, stdout: "p1\ncnode\n" + socketLine, wantError: true},
		{name: "exit one warning", exit: 1, stderr: "private diagnostic", wantError: true},
		{name: "unexpected failure", exit: 2, wantError: true},
		{name: "spawn timeout canceled", exit: -1, wantError: true},
		{name: "warning on zero exit", stderr: "private diagnostic", wantError: true},
		{name: "output cap even on empty selection", exit: 1, overflow: true, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			stdout := &limitedOutput{limit: maxSnapshotBytes, exceeded: test.overflow}
			stderr := &limitedOutput{limit: 16 * 1024}
			stdout.buffer.WriteString(test.stdout)
			stderr.buffer.WriteString(test.stderr)
			report, err := snapshotResult(stdout, stderr, test.exit, captureTime)
			if (err != nil) != test.wantError {
				t.Fatal("incorrect lsof result heartbeat classification")
			}
			if err != nil {
				if report.CapturedAt != "" || strings.Contains(err.Error(), "private diagnostic") {
					t.Fatal("failed collection produced a heartbeat or leaked a diagnostic")
				}
			} else if report.Coverage != "current_user_tcp_snapshot" {
				t.Fatal("successful collection omitted coverage")
			}
		})
	}
}
