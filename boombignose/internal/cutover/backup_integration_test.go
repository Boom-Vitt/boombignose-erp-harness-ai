package cutover

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestBackupRoundTripPreservesAuthenticatedAccess(t *testing.T) {
	for _, exportKind := range []string{"cli", "browser-compatible"} {
		t.Run(exportKind, func(t *testing.T) {
			bin, port, passfile := startRecoveryCluster(t)
			recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
			rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
			dir := t.TempDir()
			run := recoveryRunner(passfile)
			var dumpPath string
			if exportKind == "cli" {
				if err := backup(context.Background(), []string{"export", "--url", rawURL, "--dir", dir}, &bytes.Buffer{}, bin, run, time.Now); err != nil {
					t.Fatal(err)
				}
				matches, err := filepath.Glob(filepath.Join(dir, "boombignose-*.dump"))
				if err != nil || len(matches) != 1 {
					t.Fatalf("dumps %v %v", matches, err)
				}
				dumpPath = matches[0]
			} else {
				// The browser exports a standard custom archive without stripping
				// ownership or ACLs. Exercise that archive as a CLI consumer too.
				dumpPath = filepath.Join(dir, "browser.dump")
				cmd := exec.Command(filepath.Join(bin, "pg_dump"), "--format=custom", "--no-password", "--host=127.0.0.1", "--port="+strconv.Itoa(port), "--username=boombignose", "--dbname=boombignose", "--file="+dumpPath)
				cmd.Env = []string{"LC_ALL=C", "PATH=" + bin, "PGPASSFILE=" + passfile}
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("browser-compatible export: %v: %s", err, out)
				}
				if err := writeChecksum(dumpPath); err != nil {
					t.Fatal(err)
				}
			}
			if err := verifyChecksum(dumpPath); err != nil {
				t.Fatal(err)
			}
			recoveryExec(t, bin, port, passfile, "UPDATE backup_probe SET note = 'target-before-restore';")
			bad := strings.Repeat("ab", 32) + "  " + filepath.Base(dumpPath) + "\n"
			if err := os.WriteFile(dumpPath+".sha256", []byte(bad), 0o600); err != nil {
				t.Fatal(err)
			}
			err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", dumpPath}, &bytes.Buffer{}, bin, run, time.Now)
			if err == nil || !strings.Contains(err.Error(), "checksum does not match") {
				t.Fatalf("bad checksum: %v", err)
			}
			assertRecoveryQuery(t, bin, port, "boombignose", passfile, "SELECT DISTINCT note FROM backup_probe", "target-before-restore")
			if err := writeChecksum(dumpPath); err != nil {
				t.Fatal(err)
			}
			var restored bytes.Buffer
			if err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", dumpPath}, &restored, bin, run, time.Now); err != nil {
				t.Fatal(err)
			}
			assertRecoveryQuery(t, bin, port, "boombignose", passfile, "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'backup_probe'::regclass", "recovery_owner")
			assertRecoveryQuery(t, bin, port, "boombignose", passfile, "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'backup_original_owner_probe'::regclass", "boombignose")
			assertRecoveryQuery(t, bin, port, "boombignose", passfile, "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'backup_probe_seq'::regclass", "recovery_owner")
			assertNoRecoveryRoles(t, bin, port, passfile)
			assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "kept")
			assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT count(*) FROM backup_probe WHERE workspace = 2", "0")
			assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT nextval('backup_probe_seq')", "1")
			assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_original_owner_probe WHERE workspace = 1", "original-owner-kept")
			assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT count(*) FROM backup_original_owner_probe WHERE workspace = 2", "0")
			for _, table := range []string{"backup_probe", "backup_original_owner_probe"} {
				if _, err := recoveryQuery(bin, port, "authenticated", passfile, "SELECT network_password FROM "+table); err == nil {
					t.Fatalf("restored %s exposed a restricted credential column", table)
				}
				if _, err := recoveryQuery(bin, port, "authenticated", passfile, "INSERT INTO "+table+" (workspace, note, network_password) VALUES (1, 'denied', 'private')"); err == nil {
					t.Fatalf("restored %s broadened column INSERT privileges", table)
				}
				if _, err := recoveryQuery(bin, port, "authenticated", passfile, "UPDATE "+table+" SET note = 'denied'"); err == nil {
					t.Fatalf("restored %s inherited table-wide UPDATE privileges", table)
				}
			}
			if out, err := recoveryQuery(bin, port, "authenticated", passfile, "INSERT INTO backup_original_owner_probe (workspace, note) VALUES (1, 'inserted')"); err != nil {
				t.Fatalf("restored column INSERT grant: %v: %s", err, out)
			}
			assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_original_owner_probe WHERE note = 'inserted'", "inserted")
			if strings.Contains(restored.String(), "postgresql://") {
				t.Fatal("restore output exposed a database URL")
			}
		})
	}
}

func TestBackupRejectsStrippedACLWithoutChangingTarget(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	ep, err := ParseLocalURL(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "old-cli.dump")
	// Generic external cutover intentionally strips ACLs; its archives must not
	// be mistaken for complete native recovery archives.
	if err := dump(context.Background(), toolPaths{dump: filepath.Join(bin, "pg_dump")}, ep, file, recoveryRunner(passfile)); err != nil {
		t.Fatal(err)
	}
	if err := writeChecksum(file); err != nil {
		t.Fatal(err)
	}
	recoveryExec(t, bin, port, passfile, "UPDATE backup_probe SET note = 'target-before-restore';")
	var out bytes.Buffer
	err = backup(context.Background(), []string{"restore", "--url", rawURL, "--file", file}, &out, bin, recoveryRunner(passfile), time.Now)
	if err == nil || !strings.Contains(err.Error(), "no ACL metadata") || out.Len() != 0 {
		t.Fatalf("ACL-stripped restore: %v, output %q", err, out.String())
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "target-before-restore")
	assertNoRecoveryRoles(t, bin, port, passfile)
}

func TestBackupRestoreMissingRoleRollsBack(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL+"CREATE ROLE source_only; GRANT SELECT (note) ON backup_probe TO source_only;")
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	dir := t.TempDir()
	if err := backup(context.Background(), []string{"export", "--url", rawURL, "--dir", dir}, &bytes.Buffer{}, bin, recoveryRunner(passfile), time.Now); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.dump"))
	if err != nil || len(files) != 1 {
		t.Fatalf("dumps %v %v", files, err)
	}
	recoveryExec(t, bin, port, passfile, "REVOKE ALL (note) ON backup_probe FROM source_only; DROP ROLE source_only; UPDATE backup_probe SET note = 'target-before-restore';")
	var out bytes.Buffer
	if err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", files[0]}, &out, bin, recoveryRunner(passfile), time.Now); err == nil || out.Len() != 0 {
		t.Fatalf("missing-role restore: %v, output %q", err, out.String())
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "target-before-restore")
	assertNoRecoveryRoles(t, bin, port, passfile)
}

func TestBackupRequiresCorrectDatabasePassword(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	dir := t.TempDir()
	if err := backup(context.Background(), []string{"export", "--url", rawURL, "--dir", dir}, &bytes.Buffer{}, bin, recoveryRunner(passfile), time.Now); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.dump"))
	if err != nil || len(files) != 1 {
		t.Fatalf("dumps %v %v", files, err)
	}
	wrong := filepath.Join(t.TempDir(), "wrong.pgpass")
	if err := os.WriteFile(wrong, []byte(fmt.Sprintf("127.0.0.1:%d:boombignose:boombignose:wrong-password\n", port)), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, credentials := range []string{"", wrong} {
		for _, args := range [][]string{
			{"export", "--url", rawURL, "--dir", t.TempDir()},
			{"restore", "--url", rawURL, "--file", files[0]},
		} {
			var out bytes.Buffer
			if err := backup(context.Background(), args, &out, bin, recoveryRunner(credentials), time.Now); err == nil || out.Len() != 0 {
				t.Fatalf("unauthenticated %s: %v, output %q", args[0], err, out.String())
			}
		}
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "kept")
}

func TestBackupRejectsMalformedArchiveWithoutChangingTarget(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	file := filepath.Join(t.TempDir(), "malformed.dump")
	if err := os.WriteFile(file, []byte("PGDMP-invalid-archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeChecksum(file); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", file}, &out, bin, recoveryRunner(passfile), time.Now); err == nil || out.Len() != 0 {
		t.Fatalf("malformed restore: %v, output %q", err, out.String())
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "kept")
	assertNoRecoveryRoles(t, bin, port, passfile)
}

func TestBackupRecoveryRoleRequiresAdministrator(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
	file := exportRecoveryFixture(t, bin, port, passfile)
	recoveryExec(t, bin, port, passfile, "UPDATE backup_probe SET note = 'target-before-restore';")
	rawURL := fmt.Sprintf("postgresql://authenticated@127.0.0.1:%d/boombignose", port)
	var out bytes.Buffer
	err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", file}, &out, bin, recoveryRunner(passfile), time.Now)
	if err == nil || !strings.Contains(err.Error(), "restore has not started") || out.Len() != 0 {
		t.Fatalf("non-administrator restore: %v, output %q", err, out.String())
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "target-before-restore")
	assertNoRecoveryRoles(t, bin, port, passfile)
}

func TestBackupCancellationStillCleansRecoveryRole(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
	file := exportRecoveryFixture(t, bin, port, passfile)
	recoveryExec(t, bin, port, passfile, "UPDATE backup_probe SET note = 'target-before-restore';")
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	realRun := recoveryRunner(passfile)
	run := func(ctx context.Context, cmd Command) ([]byte, error) {
		out, err := realRun(ctx, cmd)
		if err == nil && filepath.Base(cmd.Name) == "psql" {
			// Cancel after the server acknowledges allocation. Cleanup must still
			// use a live administrative connection, not this cancelled request.
			cancel()
		}
		return out, err
	}
	var out bytes.Buffer
	err := backup(ctx, []string{"restore", "--url", rawURL, "--file", file}, &out, bin, run, time.Now)
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "restore has not started") || out.Len() != 0 {
		t.Fatalf("cancelled restore: %v, output %q", err, out.String())
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "target-before-restore")
	assertNoRecoveryRoles(t, bin, port, passfile)
}

func TestBackupReportsCommittedRestoreWhenCleanupFails(t *testing.T) {
	bin, port, passfile := startRecoveryCluster(t)
	recoveryExec(t, bin, port, passfile, recoveryFixtureSQL)
	file := exportRecoveryFixture(t, bin, port, passfile)
	recoveryExec(t, bin, port, passfile, "UPDATE backup_probe SET note = 'target-before-restore';")
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	wrongPassfile := filepath.Join(t.TempDir(), "wrong.pgpass")
	if err := os.WriteFile(wrongPassfile, []byte(fmt.Sprintf("127.0.0.1:%d:*:boombignose:wrong-password\n", port)), 0o600); err != nil {
		t.Fatal(err)
	}
	realRun := recoveryRunner(passfile)
	committed := false
	run := func(ctx context.Context, cmd Command) ([]byte, error) {
		if committed {
			// Exercise a real cleanup connection failure, not a successful echo.
			return runTool(ctx, cmd, wrongPassfile)
		}
		out, err := realRun(ctx, cmd)
		if err == nil && filepath.Base(cmd.Name) == "pg_restore" && len(cmd.Args) > 2 {
			committed = true
		}
		return out, err
	}
	var out bytes.Buffer
	err := backup(context.Background(), []string{"restore", "--url", rawURL, "--file", file}, &out, bin, run, time.Now)
	role, queryErr := recoveryQuery(bin, port, "boombignose", passfile, "SELECT rolname FROM pg_roles WHERE starts_with(rolname, 'bbn_recovery_')")
	if queryErr != nil || !validRecoveryRole(role) {
		t.Fatalf("could not locate the role requiring cleanup: %q: %v", role, queryErr)
	}
	t.Cleanup(func() {
		recoveryExec(t, bin, port, passfile, `REASSIGN OWNED BY "`+role+`" TO CURRENT_USER; DROP ROLE "`+role+`";`)
	})
	if err == nil || !strings.Contains(err.Error(), "restore committed") || !strings.Contains(err.Error(), "cleanup failed") || out.Len() != 0 {
		t.Fatalf("cleanup failure: %v, output %q", err, out.String())
	}
	assertRecoveryQuery(t, bin, port, "authenticated", passfile, "SELECT note FROM backup_probe WHERE workspace = 1", "kept")
	if _, err := recoveryQuery(bin, port, "authenticated", passfile, "SELECT network_password FROM backup_probe"); err == nil {
		t.Fatal("committed restore exposed a restricted column")
	}
}

func exportRecoveryFixture(t *testing.T, bin string, port int, passfile string) string {
	t.Helper()
	dir := t.TempDir()
	rawURL := fmt.Sprintf("postgresql://boombignose@127.0.0.1:%d/boombignose", port)
	if err := backup(context.Background(), []string{"export", "--url", rawURL, "--dir", dir}, &bytes.Buffer{}, bin, recoveryRunner(passfile), time.Now); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.dump"))
	if err != nil || len(files) != 1 {
		t.Fatalf("dumps %v %v", files, err)
	}
	return files[0]
}

const recoveryFixtureSQL = `
CREATE ROLE recovery_owner NOLOGIN;
CREATE ROLE authenticated LOGIN PASSWORD 'recovery-test-user';
ALTER ROLE authenticated SET app.workspace = '1';
ALTER DEFAULT PRIVILEGES FOR ROLE boombignose IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE recovery_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
CREATE TABLE backup_probe (id int PRIMARY KEY, workspace int, note text, network_password text);
ALTER TABLE backup_probe OWNER TO recovery_owner;
INSERT INTO backup_probe VALUES (1, 1, 'kept', 'private-one'), (2, 2, 'kept', 'private-two');
ALTER TABLE backup_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_access ON backup_probe FOR SELECT TO authenticated USING (workspace = current_setting('app.workspace')::int);
REVOKE ALL ON backup_probe FROM authenticated;
GRANT SELECT (id, workspace, note) ON backup_probe TO authenticated;
GRANT INSERT (workspace, note) ON backup_probe TO authenticated;
CREATE TABLE backup_original_owner_probe (workspace int, note text, network_password text);
INSERT INTO backup_original_owner_probe VALUES (1, 'original-owner-kept', 'private-one'), (2, 'original-owner-kept', 'private-two');
ALTER TABLE backup_original_owner_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY original_workspace_access ON backup_original_owner_probe TO authenticated USING (workspace = current_setting('app.workspace')::int) WITH CHECK (workspace = current_setting('app.workspace')::int);
REVOKE ALL ON backup_original_owner_probe FROM authenticated;
GRANT SELECT (workspace, note), INSERT (workspace, note) ON backup_original_owner_probe TO authenticated;
CREATE SEQUENCE backup_probe_seq;
ALTER SEQUENCE backup_probe_seq OWNER TO recovery_owner;
GRANT USAGE ON SEQUENCE backup_probe_seq TO authenticated;
`

func startRecoveryCluster(t *testing.T) (string, int, string) {
	t.Helper()
	bin := postgresBinDir()
	if bin == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("postgres binaries missing")
		}
		t.Skip("postgres binaries missing")
	}
	port := freePort(t)
	dir := t.TempDir()
	data := filepath.Join(dir, "pg")
	password := filepath.Join(dir, "init-password")
	if err := os.WriteFile(password, []byte("recovery-test-admin\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runBin(t, bin, "initdb", "-D", data, "-U", "boombignose", "--pwfile="+password, "--auth-local=trust", "--auth-host=scram-sha-256", "--encoding=UTF8", "--no-locale")
	passfile := filepath.Join(dir, "backup.pgpass")
	body := fmt.Sprintf("127.0.0.1:%d:*:boombignose:recovery-test-admin\n127.0.0.1:%d:*:authenticated:recovery-test-user\n", port, port)
	if err := os.WriteFile(passfile, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = execTool(bin, "pg_ctl", "-D", data, "-m", "immediate", "stop") })
	opts := fmt.Sprintf("-c listen_addresses=127.0.0.1 -c port=%d -c unix_socket_directories=", port)
	runBin(t, bin, "pg_ctl", "-D", data, "-l", filepath.Join(dir, "server.log"), "-w", "-o", opts, "start")
	if _, err := recoveryQuery(bin, port, "boombignose", passfile, "CREATE DATABASE boombignose", "postgres"); err != nil {
		t.Fatal(err)
	}
	return bin, port, passfile
}

func recoveryRunner(passfile string) Runner {
	return func(ctx context.Context, cmd Command) ([]byte, error) { return runTool(ctx, cmd, passfile) }
}

func recoveryQuery(bin string, port int, user, passfile, sql string, database ...string) (string, error) {
	db := "boombignose"
	if len(database) != 0 {
		db = database[0]
	}
	cmd := exec.Command(filepath.Join(bin, "psql"), "--no-password", "-h", "127.0.0.1", "-p", strconv.Itoa(port), "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql)
	cmd.Env = []string{"LC_ALL=C", "PATH=" + bin}
	if passfile != "" {
		cmd.Env = append(cmd.Env, "PGPASSFILE="+passfile)
	}
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func recoveryExec(t *testing.T, bin string, port int, passfile, sql string) {
	t.Helper()
	if out, err := recoveryQuery(bin, port, "boombignose", passfile, sql); err != nil {
		t.Fatalf("recovery fixture: %v: %s", err, out)
	}
}

func assertRecoveryQuery(t *testing.T, bin string, port int, user, passfile, sql, want string) {
	t.Helper()
	if out, err := recoveryQuery(bin, port, user, passfile, sql); err != nil || out != want {
		t.Fatalf("query as %s: got %q, want %q: %v", user, out, want, err)
	}
}

func assertNoRecoveryRoles(t *testing.T, bin string, port int, passfile string) {
	t.Helper()
	assertRecoveryQuery(t, bin, port, "boombignose", passfile, "SELECT count(*) FROM pg_roles WHERE starts_with(rolname, 'bbn_recovery_')", "0")
}
