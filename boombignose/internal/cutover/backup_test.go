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
