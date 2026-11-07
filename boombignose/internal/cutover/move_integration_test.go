package cutover

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestCutoverMovesOneRowOnLoopback(t *testing.T) {
	bin := postgresBinDir()
	if bin == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("postgres binaries missing")
		}
		t.Skip("postgres binaries missing")
	}
	sourcePort := freePort(t)
	targetPort := freePort(t)
	startCluster(t, bin, sourcePort)
	startCluster(t, bin, targetPort)
	psqlExec(t, bin, sourcePort, "CREATE TABLE cutover_probe (id int primary key, note text); INSERT INTO cutover_probe (id, note) VALUES (1, 'moved');")
	psqlExec(t, bin, targetPort, "CREATE TABLE cutover_probe (id int primary key, note text); INSERT INTO cutover_probe (id, note) VALUES (1, 'original');")

	sourceURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", sourcePort)
	targetURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", targetPort)
	backup := filepath.Join(t.TempDir(), "target.dump")
	ctx := context.Background()
	var dry bytes.Buffer
	if err := execute(ctx, []string{"dry-run", "--source", sourceURL, "--target", targetURL}, &dry, nil, bin, logRunner(t)); err != nil {
		t.Fatal(err)
	}
	if strings.Count(dry.String(), "tables=public.cutover_probe") != 2 || !strings.Contains(dry.String(), "no backup written") {
		t.Fatal(dry.String())
	}
	if _, err := os.Stat(backup); !os.IsNotExist(err) {
		t.Fatal("dry-run created a backup")
	}

	var applied bytes.Buffer
	if err := execute(ctx, []string{"apply", "--source", sourceURL, "--target", targetURL, "--backup", backup}, &applied, nil, bin, logRunner(t)); err != nil {
		t.Fatal(err)
	}
	if note := mustQuery(t, bin, targetPort, "SELECT note FROM cutover_probe"); note != "moved" {
		t.Fatalf("target note %q", note)
	}
	if note := mustQuery(t, bin, sourcePort, "SELECT note FROM cutover_probe"); note != "moved" {
		t.Fatalf("source note %q", note)
	}
	header, err := os.ReadFile(backup)
	if err != nil || len(header) < 5 || string(header[:5]) != "PGDMP" {
		t.Fatal("backup is not a custom dump")
	}

	if err := execute(ctx, []string{"rollback", "--target", targetURL, "--backup", backup}, &bytes.Buffer{}, nil, bin, logRunner(t)); err != nil {
		t.Fatal(err)
	}
	if note := mustQuery(t, bin, targetPort, "SELECT note FROM cutover_probe"); note != "original" {
		t.Fatalf("note after rollback %q", note)
	}
	if note := mustQuery(t, bin, sourcePort, "SELECT note FROM cutover_probe"); note != "moved" {
		t.Fatalf("source changed %q", note)
	}
}

func logRunner(t *testing.T) Runner {
	t.Helper()
	return func(ctx context.Context, cmd Command) ([]byte, error) {
		out, err := RealRunner(ctx, cmd)
		if err != nil {
			t.Logf("%s failed: %s", filepath.Base(cmd.Name), out)
		}
		return out, err
	}
}

func postgresBinDir() string {
	candidates := []string{os.Getenv("BOOMBIGNOSE_PG_BIN")}
	if executable, err := exec.LookPath("initdb"); err == nil {
		candidates = append(candidates, filepath.Dir(executable))
	}
	matches, _ := filepath.Glob("/usr/lib/postgresql/*/bin")
	candidates = append(candidates, matches...)
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		complete := true
		for _, name := range []string{"initdb", "pg_ctl", "psql", "pg_dump", "pg_restore"} {
			if _, err := findTool(candidate, name); err != nil {
				complete = false
				break
			}
		}
		if complete {
			return candidate
		}
	}
	return ""
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return port
}

func startCluster(t *testing.T, bin string, port int) {
	t.Helper()
	dir := t.TempDir()
	if strings.Contains(dir, " ") {
		t.Fatalf("data dir contains a space: %s", dir)
	}
	data := filepath.Join(dir, "pg")
	runBin(t, bin, "initdb", "-D", data, "-U", "boombignose", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale")
	opts := fmt.Sprintf("-c listen_addresses=127.0.0.1 -c port=%d -c unix_socket_directories=", port)
	t.Cleanup(func() {
		_ = execTool(bin, "pg_ctl", "-D", data, "-m", "immediate", "stop")
	})
	if err := execTool(bin, "pg_ctl", "-D", data, "-l", filepath.Join(dir, "server.log"), "-w", "-o", opts, "start"); err != nil {
		log, _ := os.ReadFile(filepath.Join(dir, "server.log"))
		t.Fatalf("isolated PostgreSQL startup failed: %v\n%s", err, log)
	}
	runBin(t, bin, "psql", "-h", "127.0.0.1", "-p", strconv.Itoa(port), "-U", "boombignose", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE boombignose")
}

func psqlExec(t *testing.T, bin string, port int, sql string) {
	t.Helper()
	if err := execTool(bin, "psql", "-h", "127.0.0.1", "-p", strconv.Itoa(port), "-U", "boombignose", "-d", "boombignose", "-v", "ON_ERROR_STOP=1", "-c", sql); err != nil {
		t.Fatal(err)
	}
}

func mustQuery(t *testing.T, bin string, port int, sql string) string {
	t.Helper()
	out, err := psqlQuery(t, bin, port, sql)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func psqlQuery(t *testing.T, bin string, port int, sql string) (string, error) {
	t.Helper()
	cmd := exec.Command(filepath.Join(bin, "psql"), "-h", "127.0.0.1", "-p", strconv.Itoa(port), "-U", "boombignose", "-d", "boombignose", "-At", "-c", sql) // #nosec G204 -- the binary is psql from the postgres bin dir and the SQL is a test constant
	cmd.Env = []string{"LC_ALL=C", "PATH=" + bin}
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func runBin(t *testing.T, bin, name string, args ...string) {
	t.Helper()
	if err := execTool(bin, name, args...); err != nil {
		t.Fatal(err)
	}
}

func execTool(bin, name string, args ...string) error {
	switch name {
	case "initdb", "pg_ctl", "createdb", "psql":
	default:
		return fmt.Errorf("refusing %s", name)
	}
	cmd := exec.Command(filepath.Join(bin, name), args...) // #nosec G204 -- name is limited to initdb, pg_ctl, createdb, and psql
	cmd.Env = []string{"LC_ALL=C", "PATH=" + bin + string(os.PathListSeparator) + os.Getenv("PATH")}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, out)
	}
	return nil
}
