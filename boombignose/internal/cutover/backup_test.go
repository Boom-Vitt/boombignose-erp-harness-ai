package cutover

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBackupExportRefusesARemoteDatabase(t *testing.T) {
	called := false
	run := func(ctx context.Context, cmd Command) ([]byte, error) {
		called = true
		return nil, nil
	}
	err := backup(context.Background(), []string{"export", "--url", "postgresql://boombignose:secret-value@db.example.com:5432/boombignose", "--dir", t.TempDir()}, &bytes.Buffer{}, "", run, time.Now)
	if err == nil {
		t.Fatal("remote backup must fail")
	}
	if called {
		t.Fatal("remote backup started pg_dump")
	}
	if strings.Contains(err.Error(), "secret-value") || strings.Contains(err.Error(), "example.com") {
		t.Fatalf("error includes the URL: %s", err)
	}
}

func TestBackupRestoreStopsWhenTheChecksumDoesNotMatch(t *testing.T) {
	dir := t.TempDir()
	dumpPath := filepath.Join(dir, "boombignose-20261028T020000Z.dump")
	if err := os.WriteFile(dumpPath, []byte("PGDMP-test"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeChecksum(dumpPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dumpPath+".sha256", []byte(strings.Repeat("ab", 32)+"  "+filepath.Base(dumpPath)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	called := false
	run := func(ctx context.Context, cmd Command) ([]byte, error) {
		called = true
		return nil, nil
	}
	err := backup(context.Background(), []string{"restore", "--url", "postgresql://boombignose@127.0.0.1:54329/boombignose", "--file", dumpPath}, &bytes.Buffer{}, t.TempDir(), run, time.Now)
	if err == nil || !strings.Contains(err.Error(), "checksum does not match") {
		t.Fatalf("checksum: %v", err)
	}
	if called {
		t.Fatal("restore started before the checksum matched")
	}
}

func TestBackupExportWritesASidecar(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "pg_dump"), []byte("not a binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	when := time.Date(2026, 10, 28, 2, 0, 0, 0, time.UTC)
	var out bytes.Buffer
	err := backup(context.Background(), []string{"export", "--url", "postgresql://boombignose@127.0.0.1:54329/boombignose", "--dir", dir}, &out, bin, func(ctx context.Context, cmd Command) ([]byte, error) {
		if filepath.Base(cmd.Name) != "pg_dump" {
			t.Fatalf("tool %s", cmd.Name)
		}
		file := ""
		for _, arg := range cmd.Args {
			if strings.HasPrefix(arg, "--file=") {
				file = strings.TrimPrefix(arg, "--file=")
			}
			if strings.Contains(arg, "example.com") || strings.Contains(arg, "secret-value") {
				t.Fatalf("arg %s", arg)
			}
		}
		if !strings.Contains(strings.Join(cmd.Args, " "), "--host=127.0.0.1") {
			t.Fatalf("args %v", cmd.Args)
		}
		return nil, os.WriteFile(file, []byte("PGDMP-test"), 0o600)
	}, func() time.Time { return when })
	if err != nil {
		t.Fatal(err)
	}
	dumpPath := filepath.Join(dir, "boombignose-20261028T020000Z.dump")
	if err := verifyChecksum(dumpPath); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), dumpPath) || !strings.Contains(out.String(), dumpPath+".sha256") {
		t.Fatal(out.String())
	}
}
