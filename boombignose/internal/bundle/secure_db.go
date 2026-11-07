package bundle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// secureHBA accepts initdb's original loopback policy and its SCRAM equivalent
// so an interrupted owned migration is retryable. Custom rules are refused.
func secureHBA(body []byte) ([]byte, error) {
	lines := strings.Split(string(body), "\n")
	rules := 0
	for i, line := range lines {
		text, _, _ := strings.Cut(line, "#")
		fields := strings.Fields(text)
		if len(fields) == 0 {
			continue
		}
		valid := false
		if len(fields) == 4 && fields[0] == "local" && (fields[1] == "all" || fields[1] == "replication") && fields[2] == "all" && (fields[3] == "trust" || fields[3] == "scram-sha-256") {
			valid = true
		}
		if len(fields) == 5 && fields[0] == "host" && (fields[1] == "all" || fields[1] == "replication") && fields[2] == "all" && (fields[3] == "127.0.0.1/32" || fields[3] == "::1/128") && (fields[4] == "trust" || fields[4] == "scram-sha-256") {
			valid = true
		}
		if !valid {
			return nil, errors.New("legacy pg_hba.conf contains custom policy; migration refused without changing configuration (have the cluster owner migrate it to SCRAM explicitly)")
		}
		if fields[len(fields)-1] == "trust" {
			pos := strings.LastIndex(text, "trust")
			lines[i] = line[:pos] + "scram-sha-256" + line[pos+len("trust"):]
		}
		rules++
	}
	if rules == 0 {
		return nil, errors.New("legacy pg_hba.conf has no recognized initdb rules")
	}
	return []byte(strings.Join(lines, "\n")), nil
}

// SecureDatabase is an explicit, offline migration of an owned legacy cluster.
// PostgreSQL single-user mode uses its own lock and SCRAM implementation, with
// SQL on private stdin, no TCP/Unix listener and no password in argv or output.
// Existing tables, postgres.conf and the original HBA backup are preserved.
func SecureDatabase(ctx context.Context, layout Layout, data string) error {
	if layout.Postgres == "" || !filepath.IsAbs(layout.Postgres) || !safeDataDir(data) {
		return errors.New("secure-db requires an absolute portable postgres binary and owned data directory")
	}
	if err := privateDirectory(data); err != nil {
		return err
	}
	if isSecureCluster(data) {
		_, err := loadDBCredentials(data, false)
		return err
	}
	if _, err := os.Stat(filepath.Join(data, "PG_VERSION")); err != nil {
		return errors.New("secure-db requires an existing PostgreSQL cluster; it never initializes or resets data")
	}
	if body, err := readBundleFile(data, "postmaster.pid"); err == nil {
		first, _, _ := strings.Cut(string(body), "\n")
		pid, _ := strconv.Atoi(strings.TrimSpace(first))
		if processAlive(pid) {
			return errors.New("secure-db requires the owned PostgreSQL service to be stopped; no process was signalled")
		}
	}
	for key, expected := range map[string]string{"hba_file": filepath.Join(data, "pg_hba.conf"), "data_directory": data, "config_file": filepath.Join(data, "postgresql.conf")} {
		probe := exec.CommandContext(ctx, layout.Postgres, "-D", data, "-C", key)
		probe.Env = postgresEnv(layout)
		effective, err := probe.Output()
		if err != nil || filepath.Clean(strings.TrimSpace(string(effective))) != filepath.Clean(expected) {
			return errors.New("legacy PostgreSQL uses an unrecognized data/HBA/configuration layout; explicit owner review is required before credential migration")
		}
	}
	info, err := os.Lstat(filepath.Join(data, "pg_hba.conf"))
	if err != nil || !info.Mode().IsRegular() || !currentOwner(filepath.Join(data, "pg_hba.conf"), info) {
		return errors.New("secure-db requires a current-user-owned regular pg_hba.conf, not a symlink")
	}
	original, err := readBundleFile(data, "pg_hba.conf")
	if err != nil {
		return err
	}
	hardened, err := secureHBA(original)
	if err != nil {
		return err
	}
	credentials, err := loadDBCredentials(data, true)
	if err != nil {
		return err
	}
	backup := filepath.Join(secretsDir(data), "pg_hba.legacy.conf")
	if _, err := os.Lstat(backup); os.IsNotExist(err) {
		if err := writeDataFile(secretsDir(data), "pg_hba.legacy.conf", original); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	args := []string{"--single", "-D", data, "-c", "log_statement=none", "-c", "log_min_error_statement=panic", "-c", "exit_on_error=on", "postgres"}
	// #nosec G204 -- absolute discovered Postgres binary, fixed single-user args.
	cmd := exec.CommandContext(ctx, layout.Postgres, args...)
	cmd.Env = postgresEnv(layout)
	cmd.Stdin = strings.NewReader("SET password_encryption = 'scram-sha-256';\nALTER ROLE boombignose PASSWORD '" + credentials.admin + "';\n")
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return errors.New("offline PostgreSQL credential migration failed; data/HBA remain intact; inspect with the cluster owner (no credentials were logged)")
	}
	if err := writeDataFile(data, "pg_hba.conf", hardened); err != nil {
		return fmt.Errorf("saving SCRAM policy: %w", err)
	}
	if err := markSecureCluster(data); err != nil {
		return err
	}
	rememberCredentials(pgAddr(), credentials)
	return nil
}
