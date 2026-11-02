// Package launch starts the local ERP when the desktop window cannot see it.
// It only accepts a loopback URL. It does not embed Node, Docker, or a model.
package launch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
)

// ErrNotCheckout means the directory is not this ERP tree.
var ErrNotCheckout = errors.New("erp checkout not found")

// ProjectID is the local Supabase project id. It is not the GitHub repository slug.
const ProjectID = "boombignose-erp"

// Addr returns host:port for a loopback ERP URL.
func Addr(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || u.Port() == "" {
		return "", errors.New("erp url needs a host and port")
	}
	return net.JoinHostPort(u.Hostname(), u.Port()), nil
}

// Fingerprint is the "app" value /api/health must carry, so another server
// answering {"ok":true} on the ERP port is never mistaken for this app.
const Fingerprint = "boombignose-erp"

// Ready reports whether rawURL's /api/health returns {"ok":true,"app":Fingerprint}.
// A slow server (a dev build compiling its first route) gets several probes of
// probeTimeout each within readyWindow, or until ctx ends. A closed port or a
// non-JSON response is false, not an error.
func Ready(ctx context.Context, raw string) (bool, error) {
	if err := policy.AllowEndpoint(raw); err != nil {
		return false, err
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return false, errors.New("erp url needs a host and port")
	}
	u.Path = "/api/health"
	u.RawQuery = ""
	u.Fragment = ""
	ctx, cancel := context.WithTimeout(ctx, readyWindow)
	defer cancel()
	for {
		ok, err := probeHealth(ctx, u.String())
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
		select {
		case <-ctx.Done():
			return false, nil
		case <-time.After(retryEvery):
		}
	}
}

// Ready retries for readyWindow; each request waits at most probeTimeout.
const (
	readyWindow  = 3 * time.Second
	probeTimeout = 1500 * time.Millisecond
	retryEvery   = 250 * time.Millisecond
)

func probeHealth(ctx context.Context, health string) (bool, error) {
	reqCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, health, nil)
	if err != nil {
		return false, err
	}
	resp, err := (&http.Client{Timeout: probeTimeout}).Do(req)
	if err != nil {
		return false, nil
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil || resp.StatusCode != http.StatusOK {
		return false, nil
	}
	var payload struct {
		OK  bool   `json:"ok"`
		App string `json:"app"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return false, nil
	}
	return payload.OK && payload.App == Fingerprint, nil
}

// Busy is the error shown when the ERP port is open and is not this app.
func Busy(raw string) error {
	addr, err := Addr(raw)
	if err != nil {
		return errors.New("address is already in use by another program")
	}
	return fmt.Errorf("พอร์ต %[1]s ถูกโปรแกรมอื่นใช้อยู่ ปิดโปรแกรมนั้นแล้วกดลองใหม่ / %[1]s is already in use by another program. Stop that program before opening BoomBigNose", addr)
}

// Listening reports whether something accepts TCP on the ERP address.
// A refused connection is a false result, not an error.
func Listening(raw string) (bool, error) {
	addr, err := Addr(raw)
	if err != nil {
		return false, err
	}
	conn, err := net.DialTimeout("tcp", addr, 400*time.Millisecond)
	if err != nil {
		return false, nil
	}
	_ = conn.Close()
	return true, nil
}

// ValidCheckout reports whether dir contains the local stack script and the
// expected Supabase project id.
func ValidCheckout(dir string) bool {
	if dir == "" {
		return false
	}
	script := filepath.Join(dir, "scripts", "local", "stack.mjs")
	if _, err := os.Stat(script); err != nil {
		return false
	}
	config, err := readCheckoutConfig(dir)
	if err != nil {
		return false
	}
	return strings.Contains(string(config), `project_id = "`+ProjectID+`"`)
}

// readCheckoutConfig reads supabase/config.toml inside dir. os.Root rejects a
// path that escapes the checkout, so a joined ".." cannot read another file.
func readCheckoutConfig(dir string) ([]byte, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	fsRoot, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer fsRoot.Close()
	f, err := fsRoot.Open(filepath.Join("supabase", "config.toml"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, 1<<20))
}

// FindCheckout returns explicit when it is a checkout. Otherwise it walks
// upward from each start path. It does not search the whole disk.
func FindCheckout(explicit string, starts []string) string {
	if ValidCheckout(explicit) {
		return explicit
	}
	for _, start := range starts {
		dir := start
		if dir == "" {
			continue
		}
		for i := 0; i < 8; i++ {
			if ValidCheckout(dir) {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return ""
}

// ServeCommand is `node scripts/local/stack.mjs serve --port <port>`.
func ServeCommand(dir, node, rawURL string) (string, []string, error) {
	if err := policy.AllowEndpoint(rawURL); err != nil {
		return "", nil, err
	}
	if !ValidCheckout(dir) {
		return "", nil, ErrNotCheckout
	}
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Port() == "" {
		return "", nil, errors.New("erp url needs a port")
	}
	if node == "" {
		node = "node"
	}
	args := []string{
		filepath.Join(dir, "scripts", "local", "stack.mjs"),
		"serve",
		"--port",
		u.Port(),
	}
	return node, args, nil
}

// WaitUntil returns when ready is true, when the start process exits, or when
// ctx ends. A nil exited channel waits only for ready or ctx.
func WaitUntil(ctx context.Context, every time.Duration, ready func() bool, exited <-chan error) error {
	if ready == nil {
		return errors.New("missing ready check")
	}
	if every <= 0 {
		every = 200 * time.Millisecond
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		if ready() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err, ok := <-exited:
			if !ok {
				return errors.New("local stack stopped")
			}
			if err != nil {
				return fmt.Errorf("local stack exited: %w", err)
			}
			return errors.New("local stack exited before it was ready")
		case <-tick.C:
		}
	}
}

// Runner starts a process and returns a wait function and a kill function.
type Runner func(name string, args []string, dir string) (wait func() error, kill func(), err error)

// checkedServe accepts only `node <checkout>/scripts/local/stack.mjs serve --port <n>`.
// name is "node" or an absolute path whose file name is node.
func checkedServe(name string, args []string, dir string) (script, port string, err error) {
	if strings.ContainsAny(name, "\x00\r\n") || strings.TrimSpace(dir) == "" {
		return "", "", errors.New("refusing to start this command")
	}
	base := strings.ToLower(filepath.Base(name))
	switch {
	case name == "node":
	case filepath.IsAbs(name) && (base == "node" || base == "node.exe"):
		info, statErr := os.Stat(name)
		if statErr != nil || info.IsDir() {
			return "", "", errors.New("refusing to start this command")
		}
	default:
		return "", "", errors.New("refusing to start this command")
	}
	root, err := filepath.Abs(dir)
	if err != nil {
		return "", "", errors.New("refusing to start this command")
	}
	want := filepath.Join(root, "scripts", "local", "stack.mjs")
	if len(args) != 4 || args[0] != want || args[1] != "serve" || args[2] != "--port" {
		return "", "", errors.New("refusing to start this command")
	}
	n, err := strconv.Atoi(args[3])
	if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != args[3] {
		return "", "", errors.New("refusing to start this command")
	}
	return want, args[3], nil
}

func defaultRunner(name string, args []string, dir string) (func() error, func(), error) {
	script, port, err := checkedServe(name, args, dir)
	if err != nil {
		return nil, nil, err
	}
	// #nosec G204 -- checkedServe allows only node plus the checkout stack script, serve, and a numeric port
	cmd := exec.Command(name, script, "serve", "--port", port)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	return cmd.Wait, func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}, nil
}

// Ensure opens an ERP that is already listening, or starts the local stack
// from a checkout and waits until the port accepts a connection.
// On timeout the start process is left running so a long build can finish.
func Ensure(ctx context.Context, dir, node, rawURL string, run Runner) error {
	up, err := Listening(rawURL)
	if err != nil {
		return err
	}
	if up {
		ok, err := Ready(ctx, rawURL)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
		return Busy(rawURL)
	}
	if dir == "" {
		return ErrNotCheckout
	}
	name, args, err := ServeCommand(dir, node, rawURL)
	if err != nil {
		return err
	}
	if run == nil {
		run = defaultRunner
	}
	wait, _, err := run(name, args, dir)
	if err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- wait() }()
	return WaitUntil(ctx, 200*time.Millisecond, func() bool {
		ok, _ := Listening(rawURL)
		return ok
	}, exited)
}
