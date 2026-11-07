package cutover

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Backup exports or restores one loopback database, preserving owners and grants.
// export writes a custom dump and a sha256 sidecar into a directory the user chose.
// restore checks that sidecar and rejects ACL-stripped archives before pg_restore.
func Backup(ctx context.Context, args []string, stdout io.Writer, passwordFile string) error {
	runner := RealRunner
	if passwordFile != "" {
		runner = func(ctx context.Context, cmd Command) ([]byte, error) { return runTool(ctx, cmd, passwordFile) }
	}
	return backup(ctx, args, stdout, "", runner, time.Now)
}

func backup(ctx context.Context, args []string, stdout io.Writer, binDir string, run Runner, now func() time.Time) error {
	if len(args) == 0 {
		return errors.New("backup needs export or restore")
	}
	if run == nil {
		run = RealRunner
	}
	if now == nil {
		now = time.Now
	}
	switch args[0] {
	case "export":
		url, dir, err := backupFlags(args[1:], "--url", "--dir")
		if err != nil {
			return err
		}
		return exportBackup(ctx, url, dir, stdout, binDir, run, now)
	case "restore":
		url, file, err := backupFlags(args[1:], "--url", "--file")
		if err != nil {
			return err
		}
		return restoreBackup(ctx, url, file, stdout, binDir, run)
	default:
		return errors.New("backup needs export or restore")
	}
}

func backupFlags(args []string, urlFlag, otherFlag string) (string, string, error) {
	var url, other string
	for i := 0; i < len(args); i++ {
		flag := args[i]
		value := ""
		if flag != urlFlag && flag != otherFlag {
			if strings.HasPrefix(flag, urlFlag+"=") || strings.HasPrefix(flag, otherFlag+"=") {
				flag, value, _ = strings.Cut(flag, "=")
			} else {
				return "", "", errors.New("unknown backup flag")
			}
		}
		if value == "" {
			if i+1 >= len(args) {
				return "", "", fmt.Errorf("%s needs a value", flag)
			}
			i++
			value = args[i]
		}
		switch flag {
		case urlFlag:
			if url != "" {
				return "", "", errors.New("unknown backup flag")
			}
			url = value
		case otherFlag:
			if other != "" {
				return "", "", errors.New("unknown backup flag")
			}
			other = value
		default:
			return "", "", errors.New("unknown backup flag")
		}
	}
	if url == "" || other == "" {
		return "", "", errors.New("backup needs a local database and a folder or file")
	}
	return url, other, nil
}

func exportBackup(ctx context.Context, rawURL, dir string, stdout io.Writer, binDir string, run Runner, now func() time.Time) error {
	ep, err := ParseLocalURL(rawURL)
	if err != nil {
		return err
	}
	if err := safeBackupDir(dir); err != nil {
		return err
	}
	name := "boombignose-" + now().UTC().Format("20060102T150405Z") + ".dump"
	file := filepath.Join(dir, name)
	if err := safeDumpPath(file); err != nil {
		return err
	}
	if _, err := os.Stat(file); err == nil {
		return errors.New("backup path already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return errors.New("backup path is not a new file")
	}
	dumpBin, err := findTool(binDir, "pg_dump")
	if err != nil {
		return err
	}
	cmd, err := backupDumpArgs(dumpBin, ep, file)
	if err != nil {
		return err
	}
	if _, err := run(ctx, cmd); err != nil {
		_ = os.Remove(file)
		return err
	}
	if err := dumpHeaderOK(file); err != nil {
		_ = os.Remove(file)
		return err
	}
	if err := writeChecksum(file); err != nil {
		_ = os.Remove(file)
		_ = os.Remove(file + ".sha256")
		return err
	}
	if _, err := fmt.Fprintf(stdout, "wrote %s\nchecksum %s\n", file, file+".sha256"); err != nil {
		return err
	}
	return nil
}

func restoreBackup(ctx context.Context, rawURL, file string, stdout io.Writer, binDir string, run Runner) error {
	ep, err := ParseLocalURL(rawURL)
	if err != nil {
		return err
	}
	if err := verifyChecksum(file); err != nil {
		return err
	}
	if err := dumpHeaderOK(file); err != nil {
		return err
	}
	restoreBin, err := findTool(binDir, "pg_restore")
	if err != nil {
		return err
	}
	// Older CLI exports used --no-acl. Removing that flag on restore cannot
	// recover the missing grants. Refuse these before changing the target.
	list, err := run(ctx, Command{Name: restoreBin, Args: []string{"--list", file}})
	if err != nil {
		return err
	}
	if !archiveHasACL(list) {
		return errors.New("backup has no ACL metadata; re-export from the trusted original database with owners and grants preserved, or recover its full cold backup")
	}
	psqlBin, err := findTool(binDir, "psql")
	if err != nil {
		return err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return errors.New("could not allocate a private recovery role; restore has not started")
	}
	role := recoveryRolePrefix + hex.EncodeToString(nonce[:])
	cmd, err := backupRestoreArgs(restoreBin, ep, file, role)
	if err != nil {
		return err
	}
	create, err := recoveryRoleArgs(psqlBin, ep, role, false)
	if err != nil {
		return err
	}
	cleanup, err := recoveryRoleArgs(psqlBin, ep, role, true)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("restore has not started: %w", err)
	}
	// The fresh role has no default ACLs, unlike either the administrator or an
	// archived owner. SET ROLE (not session authorization) still lets the archive
	// restore its original owners. Archives remain trusted administrator SQL.
	_, createErr := run(ctx, create)
	// Even a failed/cancelled allocation may have committed on the server. The
	// transactional role comment lets cleanup recognize only our own allocation.
	var restoreErr error
	if createErr == nil {
		if err := ctx.Err(); err != nil {
			restoreErr = fmt.Errorf("restore has not started: %w", err)
		} else if _, err := run(ctx, cmd); err != nil {
			restoreErr = fmt.Errorf("backup restore failed; transaction outcome is unconfirmed, inspect the target before retrying: %w", errors.Join(err, ctx.Err()))
		}
	}
	// Never let request cancellation skip cleanup or leave it unbounded. Use the
	// original administrator credentials, not the temporary restore role.
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	_, cleanupErr := run(cleanupCtx, cleanup)
	if createErr != nil {
		err = fmt.Errorf("could not allocate an administrator-only recovery role; restore has not started: %w", errors.Join(createErr, ctx.Err()))
	} else {
		err = restoreErr
	}
	if cleanupErr != nil {
		cleanupErr = fmt.Errorf("recovery role %s cleanup failed; administrator cleanup is required: %w", role, cleanupErr)
		if err == nil {
			return fmt.Errorf("backup restore committed, but %w", cleanupErr)
		}
		return errors.Join(err, cleanupErr)
	}
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "restored backup into %s\n", ep.Label())
	return err
}

func archiveHasACL(list []byte) bool {
	for line := range bytes.Lines(list) {
		index := 0
		for field := range bytes.FieldsSeq(line) {
			if index == 0 && !bytes.HasSuffix(field, []byte(";")) {
				break
			}
			if index == 3 {
				if bytes.Equal(field, []byte("ACL")) {
					return true
				}
				if !bytes.Equal(field, []byte("DEFAULT")) {
					break
				}
			}
			if index == 4 {
				if bytes.Equal(field, []byte("ACL")) {
					return true
				}
				break
			}
			index++
		}
	}
	return false
}

// Recovery is not generic cutover: the native roles already exist and ownership
// and grants must survive. Missing roles or failed grants abort the transaction.
func backupDumpArgs(bin string, ep Endpoint, file string) (Command, error) {
	if err := allowBin(bin, "pg_dump"); err != nil {
		return Command{}, err
	}
	if err := ep.validate(); err != nil {
		return Command{}, err
	}
	if err := safeDumpPath(file); err != nil {
		return Command{}, err
	}
	return Command{Name: bin, Args: []string{
		"--format=custom",
		"--no-password",
		"--host=" + ep.Host,
		"--port=" + strconv.Itoa(ep.Port),
		"--username=" + ep.User,
		"--dbname=" + ep.Database,
		"--file=" + file,
	}}, nil
}

func backupRestoreArgs(bin string, ep Endpoint, file, role string) (Command, error) {
	if err := allowBin(bin, "pg_restore"); err != nil {
		return Command{}, err
	}
	if err := ep.validate(); err != nil {
		return Command{}, err
	}
	if err := safeDumpPath(file); err != nil {
		return Command{}, err
	}
	if !validRecoveryRole(role) {
		return Command{}, errors.New("refusing recovery role")
	}
	return Command{Name: bin, Args: []string{
		"--no-password",
		"--clean",
		"--if-exists",
		"--exit-on-error",
		"--single-transaction",
		"--role=" + role,
		"--host=" + ep.Host,
		"--port=" + strconv.Itoa(ep.Port),
		"--username=" + ep.User,
		"--dbname=" + ep.Database,
		file,
	}}, nil
}

const recoveryRolePrefix = "bbn_recovery_"

func validRecoveryRole(role string) bool {
	nonce, ok := strings.CutPrefix(role, recoveryRolePrefix)
	if !ok || len(nonce) != 32 {
		return false
	}
	for _, c := range nonce {
		if !('0' <= c && c <= '9') && !('a' <= c && c <= 'f') {
			return false
		}
	}
	return true
}

func recoveryRoleArgs(bin string, ep Endpoint, role string, cleanup bool) (Command, error) {
	if err := allowBin(bin, "psql"); err != nil {
		return Command{}, err
	}
	if err := ep.validate(); err != nil {
		return Command{}, err
	}
	if !validRecoveryRole(role) {
		return Command{}, errors.New("refusing recovery role")
	}
	identifier := `"` + strings.ReplaceAll(role, `"`, `""`) + `"`
	sql := "BEGIN; CREATE ROLE " + identifier + " NOLOGIN SUPERUSER; COMMENT ON ROLE " + identifier + " IS '" + role + "'; COMMIT;"
	if cleanup {
		// REASSIGN handles extensions and objects without an archive OWNER entry.
		// The marker is created atomically with the role; a failed allocation must
		// never remove a pre-existing role, even in the event of a name collision.
		sql = "DO $recovery$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + role + "') THEN " +
			"IF (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = '" + role + "') IS DISTINCT FROM '" + role + "' THEN " +
			"RAISE EXCEPTION 'refusing cleanup of an unrelated recovery role'; END IF; " +
			"EXECUTE 'REASSIGN OWNED BY " + identifier + " TO CURRENT_USER'; " +
			"EXECUTE 'DROP ROLE " + identifier + "'; END IF; END; $recovery$;"
	}
	return Command{Name: bin, Args: []string{
		"--no-password",
		"--no-psqlrc",
		"--set=ON_ERROR_STOP=1",
		"--host=" + ep.Host,
		"--port=" + strconv.Itoa(ep.Port),
		"--username=" + ep.User,
		"--dbname=" + ep.Database,
		"--command=" + sql,
	}}, nil
}

func allowRecoveryRoleCommand(cmd Command, ep Endpoint) error {
	sql, ok := strings.CutPrefix(cmd.Args[len(cmd.Args)-1], "--command=")
	if !ok {
		return errors.New("refusing postgres tool")
	}
	start := strings.Index(sql, recoveryRolePrefix)
	if start < 0 || len(sql)-start < len(recoveryRolePrefix)+32 {
		return errors.New("refusing postgres tool")
	}
	role := sql[start : start+len(recoveryRolePrefix)+32]
	for _, cleanup := range []bool{false, true} {
		want, err := recoveryRoleArgs(cmd.Name, ep, role, cleanup)
		if err != nil {
			return err
		}
		if sameCommand(cmd, want) == nil {
			return nil
		}
	}
	return errors.New("refusing postgres tool")
}

func safeBackupDir(path string) error {
	if path == "" || strings.ContainsAny(path, "\x00\r\n $`|&;<>*?\"'=") {
		return errors.New("backup folder is not a local directory")
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("backup folder is not a local directory")
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return errors.New("backup folder is not a local directory")
	}
	return nil
}

func writeChecksum(dumpPath string) error {
	sum, err := fileSHA256(dumpPath)
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	parent := filepath.Dir(dumpPath)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	defer root.Close()
	side, err := root.Create(filepath.Base(dumpPath) + ".sha256")
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	defer side.Close()
	_, err = fmt.Fprintf(side, "%s  %s\n", sum, filepath.Base(dumpPath))
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	return nil
}

func verifyChecksum(dumpPath string) error {
	if err := safeDumpPath(dumpPath); err != nil {
		return err
	}
	parent := filepath.Dir(dumpPath)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return errors.New("backup checksum is missing")
	}
	defer root.Close()
	side, err := root.Open(filepath.Base(dumpPath) + ".sha256")
	if err != nil {
		return errors.New("backup checksum is missing")
	}
	defer side.Close()
	body, err := io.ReadAll(io.LimitReader(side, 256))
	if err != nil {
		return errors.New("backup checksum does not match")
	}
	line := strings.TrimSuffix(string(body), "\n")
	if strings.Contains(line, "\n") {
		return errors.New("backup checksum does not match")
	}
	hexPart, name, ok := strings.Cut(line, "  ")
	if !ok || name != filepath.Base(dumpPath) || len(hexPart) != 64 {
		return errors.New("backup checksum does not match")
	}
	sum, err := fileSHA256(dumpPath)
	if err != nil {
		return errors.New("backup checksum does not match")
	}
	if subtle.ConstantTimeCompare([]byte(hexPart), []byte(sum)) != 1 {
		return errors.New("backup checksum does not match")
	}
	return nil
}

func fileSHA256(dumpPath string) (string, error) {
	parent := filepath.Dir(dumpPath)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return "", err
	}
	defer root.Close()
	file, err := root.Open(filepath.Base(dumpPath))
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
