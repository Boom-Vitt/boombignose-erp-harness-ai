package bundle

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func ownCluster(t *testing.T, data string) {
	t.Helper()
	body := strconv.Itoa(os.Getpid()) + "\n" + data + "\n0\n" + pgPort() + "\n" + data + "\n127.0.0.1\n"
	if err := os.WriteFile(filepath.Join(data, "postmaster.pid"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestEnsurePostgresRetriesConnectionRefused(t *testing.T) {
	layout, data := postgresFixture(t)
	if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ownCluster(t, data)
	n := 0
	err := ensurePostgres(context.Background(), layout, data, func() bool { return true }, func(Command) error {
		t.Fatal("cluster was already up")
		return nil
	}, func(_ context.Context, _, _, _, sql string) ([][]string, error) {
		n++
		if n < 3 {
			return nil, errors.New("dial tcp 127.0.0.1:54329: connect: connection refused")
		}
		if strings.HasPrefix(strings.TrimSpace(sql), "select filename") {
			return [][]string{{"001.sql"}}, nil
		}
		if strings.Contains(sql, "to_regclass") {
			return [][]string{{"organizations"}}, nil
		}
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n < 3 {
		t.Fatalf("attempts = %d", n)
	}
}

func TestEnsurePostgresRefusesASpaceInTheDataDir(t *testing.T) {
	err := ensurePostgres(context.Background(), Layout{Postgres: "postgres"}, "/tmp/has space", func() bool { return false }, func(Command) error {
		t.Fatal("command ran")
		return nil
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "spaces") {
		t.Fatalf("err = %v", err)
	}
}

func TestEnsurePostgresRefusesAForeignListener(t *testing.T) {
	layout, data := postgresFixture(t)
	if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	queried := false
	err := ensurePostgres(context.Background(), layout, data, func() bool { return true }, func(Command) error {
		t.Fatal("must not start postgres when the port is taken")
		return nil
	}, func(context.Context, string, string, string, string) ([][]string, error) {
		queried = true
		return nil, nil
	})
	if err == nil || queried {
		t.Fatalf("err=%v queried=%v", err, queried)
	}
	if !strings.Contains(err.Error(), "127.0.0.1:"+pgPort()) || !strings.Contains(err.Error(), "already in use") || !strings.Contains(err.Error(), "server.log") {
		t.Fatal(err)
	}
}

func TestAllowedPostgresCommandRejectsAPublicListen(t *testing.T) {
	bin := t.TempDir()
	initdb := filepath.Join(bin, "initdb")
	if err := os.WriteFile(initdb, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	data := t.TempDir()
	good := initdbArgs("linux", data)
	if err := allowedPostgresCommand(initdb, good); err != nil {
		t.Fatal(err)
	}
	windows := append([]string{}, good...)
	windows[8] = "--no-locale"
	if err := allowedPostgresCommand(initdb, windows); err != nil {
		t.Fatal(err)
	}
	pgCtl := filepath.Join(bin, "pg_ctl")
	if err := os.WriteFile(pgCtl, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	options := pgStartOptions(data)
	private := []string{"-D", data, "-l", filepath.Join(data, "server.log"), "-w", "-o", options, "start"}
	if err := allowedPostgresCommand(pgCtl, private); err != nil {
		t.Fatal(err)
	}
	public := append([]string{}, private...)
	public[6] = strings.Replace(options, "listen_addresses=127.0.0.1", "listen_addresses=0.0.0.0", 1)
	if err := allowedPostgresCommand(pgCtl, public); err == nil {
		t.Fatal("a public listen address must be refused")
	}
}

func TestStopPostgresMissingCluster(t *testing.T) {
	err := StopPostgres(Layout{Postgres: filepath.Join(t.TempDir(), "postgres")}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
}

func TestDefaultRunnerRecordsERPPid(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture is a shell script")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "node")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	server := filepath.Join(dir, "server.js")
	if err := os.WriteFile(server, []byte("// fixture\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	erpPIDDir = dir
	recordERP = true
	t.Cleanup(func() {
		recordERP = false
		erpPIDDir = ""
	})
	wait, kill, err := defaultRunner(Command{Name: script, Args: []string{server}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		kill()
		_ = wait()
	}()
	body, err := os.ReadFile(filepath.Join(dir, "erp.pid"))
	if err != nil {
		t.Fatal(err)
	}
	var record processRecord
	if err := json.Unmarshal(body, &record); err != nil || record.PID <= 1 || record.Identity == "" {
		t.Fatal("missing owned process identity")
	}
}

func TestStopPIDStopsTheRecordedProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep fixture")
	}
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
	})
	dir := t.TempDir()
	if err := writePID(dir, cmd.Process.Pid); err != nil {
		t.Fatal(err)
	}
	stopPID(dir)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("process was still running")
	}
}

func TestStartStackLeavesAnOpenERPAlone(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	raw := "http://" + ln.Addr().String()
	err = StartStack(ctx, Layout{Node: "node", Server: "server.js"}, t.TempDir(), raw, nil, func(Command) (func() error, func(), error) {
		t.Fatal("erp was already listening")
		return nil, nil, nil
	})
	if err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func postgresFixture(t *testing.T) (Layout, string) {
	t.Helper()
	root := t.TempDir()
	bin := filepath.Join(root, "postgres", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, exeName("postgres")), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	data := t.TempDir()
	if err := os.Chmod(data, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := hardenCreated(data); err != nil {
		t.Fatal(err)
	}
	if _, err := loadDBCredentials(data, true); err != nil {
		t.Fatal(err)
	}
	if err := markSecureCluster(data); err != nil {
		t.Fatal(err)
	}
	return Layout{Postgres: filepath.Join(bin, exeName("postgres"))}, data
}
