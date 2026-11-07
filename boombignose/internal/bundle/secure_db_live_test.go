package bundle

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestOfflineLegacyMigrationPreservesExistingRows(t *testing.T) {
	tree := os.Getenv("BOOMBIGNOSE_PG_TREE")
	if tree == "" {
		t.Skip("set BOOMBIGNOSE_PG_TREE to a portable postgres tree")
	}
	data := filepath.Join(t.TempDir(), "pg")
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	listener.Close()
	t.Setenv("BOOMBIGNOSE_PG_PORT", port)
	layout := Layout{Postgres: filepath.Join(tree, "bin", exeName("postgres"))}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	run := func(name string, args ...string) {
		t.Helper()
		command := exec.CommandContext(ctx, filepath.Join(tree, "bin", exeName(name)), args...)
		command.Env = postgresEnv(layout)
		if err := command.Run(); err != nil {
			t.Fatalf("isolated fixture %s failed", name)
		}
	}
	// Trust exists only in this newly created isolated legacy fixture, never an
	// existing application cluster. Migration itself must not open a listener.
	run("initdb", "-D", data, "-U", "boombignose", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale")
	if err := hardenCreated(data); err != nil {
		t.Fatal(err)
	}
	originalHBA, err := os.ReadFile(filepath.Join(data, "pg_hba.conf"))
	if err != nil {
		t.Fatal(err)
	}
	originalConfig, err := os.ReadFile(filepath.Join(data, "postgresql.conf"))
	if err != nil {
		t.Fatal(err)
	}
	run("pg_ctl", "-D", data, "-l", filepath.Join(data, "server.log"), "-w", "-o", pgStartOptions(data), "start")
	t.Cleanup(func() {
		command := exec.Command(filepath.Join(tree, "bin", exeName("pg_ctl")), "-D", data, "-m", "fast", "stop")
		command.Env = postgresEnv(layout)
		command.Run()
	})
	if _, err := queryAuthenticated(ctx, pgAddr(), "boombignose", "postgres", "", "create database boombignose"); err != nil {
		t.Fatal(err)
	}
	if _, err := queryAuthenticated(ctx, pgAddr(), "boombignose", "boombignose", "", "create table preserved_row(value text); insert into preserved_row values ('keep-existing-data')"); err != nil {
		t.Fatal(err)
	}
	run("pg_ctl", "-D", data, "-m", "fast", "stop")
	if err := SecureDatabase(ctx, layout, data); err != nil {
		t.Fatal(err)
	}
	backup, err := os.ReadFile(filepath.Join(secretsDir(data), "pg_hba.legacy.conf"))
	if err != nil || string(backup) != string(originalHBA) {
		t.Fatal("original HBA was not backed up exactly")
	}
	config, err := os.ReadFile(filepath.Join(data, "postgresql.conf"))
	if err != nil || string(config) != string(originalConfig) {
		t.Fatal("migration replaced unrelated PostgreSQL configuration")
	}
	if err := EnsurePostgres(ctx, layout, data); err != nil {
		t.Fatal(err)
	}
	rows, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose", "select value from preserved_row")
	if err != nil || len(rows) != 1 || rows[0][0] != "keep-existing-data" {
		t.Fatal("existing data did not survive the credential migration")
	}
	if _, err := queryAuthenticated(ctx, pgAddr(), "boombignose", "postgres", "", "select 1"); err == nil {
		t.Fatal("migrated database still accepts unauthenticated loopback clients")
	}
	if err := StopPostgres(layout, data); err != nil {
		t.Fatal(err)
	}
	if err := SecureDatabase(ctx, layout, data); err != nil {
		t.Fatal("migration was not repeatable")
	}
}
