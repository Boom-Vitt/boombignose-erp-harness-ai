package cutover

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBackupRoundTripOnLoopback(t *testing.T) {
	bin := postgresBinDir()
	if bin == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("postgres binaries missing")
		}
		t.Skip("postgres binaries missing")
	}
	port := freePort(t)
	startCluster(t, bin, port)
	psqlExec(t, bin, port, "CREATE TABLE backup_probe (id int primary key, note text); INSERT INTO backup_probe (id, note) VALUES (1, 'kept');")
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	dir := t.TempDir()
	var exported bytes.Buffer
	if err := backup(context.Background(), []string{"export", "--url", rawURL, "--dir", dir}, &exported, bin, RealRunner, time.Now); err != nil {
		t.Fatal(err)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "boombignose-*.dump"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("dumps %v %v", matches, err)
	}
	dumpPath := matches[0]
	if err := verifyChecksum(dumpPath); err != nil {
		t.Fatal(err)
	}
	psqlExec(t, bin, port, "DROP TABLE backup_probe;")
	bad := strings.Repeat("ab", 32) + "  " + filepath.Base(dumpPath) + "\n"
	if err := os.WriteFile(dumpPath+".sha256", []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	err = backup(context.Background(), []string{"restore", "--url", rawURL, "--file", dumpPath}, &bytes.Buffer{}, bin, RealRunner, time.Now)
	if err == nil || !strings.Contains(err.Error(), "checksum does not match") {
		t.Fatalf("bad checksum: %v", err)
	}
	if note := queryOrEmpty(t, bin, port, "SELECT note FROM backup_probe"); note != "" {
		t.Fatalf("checksum failure restored %q", note)
	}
	if err := writeChecksum(dumpPath); err != nil {
		t.Fatal(err)
	}
	var restored bytes.Buffer
	if err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", dumpPath}, &restored, bin, RealRunner, time.Now); err != nil {
		t.Fatal(err)
	}
	if note := mustQuery(t, bin, port, "SELECT note FROM backup_probe"); note != "kept" {
		t.Fatalf("note %q", note)
	}
	if strings.Contains(restored.String(), "postgresql://") {
		t.Fatal(restored.String())
	}
}

func queryOrEmpty(t *testing.T, bin string, port int, sql string) string {
	t.Helper()
	out, err := psqlQuery(t, bin, port, sql)
	if err != nil {
		return ""
	}
	return out
}
