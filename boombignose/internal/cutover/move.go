package cutover

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const listTablesSQL = "SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE' ORDER BY 1"

// Command is one postgres tool invocation. allowExec accepts only the fixed
// cutover, recovery, table-listing, or archive-listing command contracts.
type Command struct {
	Name string
	Args []string
}

// Runner executes a command that allowExec already accepted.
type Runner func(ctx context.Context, cmd Command) ([]byte, error)

// Endpoint is a loopback database. Host is only 127.0.0.1 or ::1.
type Endpoint struct {
	Host     string
	Port     int
	User     string
	Database string
}

// Execute runs plan, dry-run, apply, or rollback.
// A URL that is not loopback, or that contains a password, is refused
// before any tool is started. The error does not include the URL.
func Execute(ctx context.Context, args []string, stdout io.Writer) error {
	return execute(ctx, args, stdout, nil, "", RealRunner)
}

func execute(ctx context.Context, args []string, stdout io.Writer, tools *toolPaths, binDir string, run Runner) error {
	if len(args) == 0 || args[0] == "plan" {
		if len(args) > 1 {
			return RefuseApply()
		}
		if _, err := io.WriteString(stdout, Plan()); err != nil {
			return err
		}
		return nil
	}
	mode := args[0]
	flags, err := parseFlags(args[1:])
	if err != nil {
		return err
	}
	var source, target Endpoint
	switch mode {
	case "dry-run", "apply":
		source, err = ParseLocalURL(flags.source)
		if err != nil {
			return err
		}
		target, err = ParseLocalURL(flags.target)
		if err != nil {
			return err
		}
	case "rollback":
		if flags.source != "" {
			return errors.New("rollback does not take --source")
		}
		target, err = ParseLocalURL(flags.target)
		if err != nil {
			return err
		}
	default:
		return RefuseApply()
	}
	if run == nil {
		run = RealRunner
	}
	paths, err := resolveTools(mode, tools, binDir)
	if err != nil {
		return err
	}
	switch mode {
	case "dry-run":
		report, err := dryRun(ctx, paths, source, target, run)
		if err != nil {
			return err
		}
		_, err = io.WriteString(stdout, report)
		return err
	case "apply":
		if err := safeDumpPath(flags.backup); err != nil {
			return err
		}
		if _, err := os.Stat(flags.backup); err == nil {
			return errors.New("backup path already exists")
		} else if !errors.Is(err, os.ErrNotExist) {
			return errors.New("backup path is not a new file")
		}
		report, err := dryRun(ctx, paths, source, target, run)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(stdout, report); err != nil {
			return err
		}
		return apply(ctx, paths, source, target, flags.backup, stdout, run)
	case "rollback":
		if err := safeDumpPath(flags.backup); err != nil {
			return err
		}
		if err := dumpHeaderOK(flags.backup); err != nil {
			return err
		}
		if err := restore(ctx, paths, target, flags.backup, run); err != nil {
			return err
		}
		_, err = fmt.Fprintf(stdout, "restored backup into %s\n", target.Label())
		return err
	default:
		return RefuseApply()
	}
}

type toolPaths struct {
	psql    string
	dump    string
	restore string
}

type flagSet struct {
	source string
	target string
	backup string
}

func parseFlags(args []string) (flagSet, error) {
	var flags flagSet
	for i := 0; i < len(args); i++ {
		var name, value string
		switch args[i] {
		case "--source", "--target", "--backup":
			if i+1 >= len(args) {
				return flagSet{}, fmt.Errorf("%s needs a value", args[i])
			}
			name, value = args[i], args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "--source=") || strings.HasPrefix(args[i], "--target=") || strings.HasPrefix(args[i], "--backup=") {
				name, value, _ = strings.Cut(args[i], "=")
			} else {
				return flagSet{}, errors.New("unknown cutover flag")
			}
		}
		switch name {
		case "--source":
			if flags.source != "" {
				return flagSet{}, errors.New("--source was repeated")
			}
			flags.source = value
		case "--target":
			if flags.target != "" {
				return flagSet{}, errors.New("--target was repeated")
			}
			flags.target = value
		case "--backup":
			if flags.backup != "" {
				return flagSet{}, errors.New("--backup was repeated")
			}
			flags.backup = value
		}
	}
	return flags, nil
}

func resolveTools(mode string, given *toolPaths, binDir string) (toolPaths, error) {
	if given != nil {
		return *given, nil
	}
	var paths toolPaths
	var err error
	if mode == "dry-run" || mode == "apply" {
		paths.psql, err = findTool(binDir, "psql")
		if err != nil {
			return toolPaths{}, err
		}
	}
	if mode == "apply" {
		paths.dump, err = findTool(binDir, "pg_dump")
		if err != nil {
			return toolPaths{}, err
		}
	}
	if mode == "apply" || mode == "rollback" {
		paths.restore, err = findTool(binDir, "pg_restore")
		if err != nil {
			return toolPaths{}, err
		}
	}
	return paths, nil
}

func findTool(binDir, name string) (string, error) {
	if binDir != "" {
		if !filepath.IsAbs(binDir) || filepath.Clean(binDir) != binDir || strings.ContainsAny(binDir, "\x00\r\n") {
			return "", errors.New("postgres tool directory is not absolute")
		}
		root, err := os.OpenRoot(binDir)
		if err != nil {
			return "", fmt.Errorf("%s not found", name)
		}
		defer root.Close()
		for _, candidate := range []string{name, name + ".exe"} {
			info, err := root.Stat(candidate)
			if err == nil && !info.IsDir() {
				return filepath.Join(binDir, candidate), nil
			}
		}
		return "", fmt.Errorf("%s not found", name)
	}
	if dir := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_PG_BIN")); dir != "" {
		return findTool(dir, name)
	}
	found, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("%s not found", name)
	}
	if !filepath.IsAbs(found) {
		found, err = filepath.Abs(found)
		if err != nil {
			return "", fmt.Errorf("%s not found", name)
		}
	}
	return found, nil
}

// ParseLocalURL accepts a postgresql URL with an explicit port and no password.
// The returned host is 127.0.0.1 or ::1. The error never contains the raw URL.
func ParseLocalURL(raw string) (Endpoint, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return Endpoint{}, errors.New("refusing database URL")
	}
	if parsed.Scheme != "postgresql" && parsed.Scheme != "postgres" {
		return Endpoint{}, errors.New("refusing database URL")
	}
	if parsed.User == nil {
		return Endpoint{}, errors.New("refusing database URL")
	}
	if _, ok := parsed.User.Password(); ok {
		return Endpoint{}, errors.New("refusing a database URL that contains a password")
	}
	user := parsed.User.Username()
	if !identOK(user) {
		return Endpoint{}, errors.New("refusing database URL")
	}
	host := parsed.Hostname()
	switch host {
	case "localhost", "127.0.0.1":
		host = "127.0.0.1"
	case "::1":
		host = "::1"
	default:
		return Endpoint{}, errors.New("refusing non-local database")
	}
	if parsed.Port() == "" {
		return Endpoint{}, errors.New("refusing database URL without a port")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return Endpoint{}, errors.New("refusing database URL")
	}
	database := strings.TrimPrefix(parsed.EscapedPath(), "/")
	if decoded, err := url.PathUnescape(database); err == nil {
		database = decoded
	}
	if !identOK(database) || strings.Contains(database, "/") {
		return Endpoint{}, errors.New("refusing database URL")
	}
	query := parsed.Query()
	if len(query) > 0 && !(len(query) == 1 && query.Get("sslmode") == "disable") {
		return Endpoint{}, errors.New("refusing database URL")
	}
	if parsed.Fragment != "" {
		return Endpoint{}, errors.New("refusing database URL")
	}
	ep := Endpoint{Host: host, Port: port, User: user, Database: database}
	if err := ep.validate(); err != nil {
		return Endpoint{}, err
	}
	return ep, nil
}

func (e Endpoint) validate() error {
	if e.Host != "127.0.0.1" && e.Host != "::1" {
		return errors.New("refusing non-local database")
	}
	if e.Port < 1 || e.Port > 65535 || !identOK(e.User) || !identOK(e.Database) {
		return errors.New("refusing database URL")
	}
	return nil
}

// Label is the host, port, and database. It is safe to print.
func (e Endpoint) Label() string {
	return fmt.Sprintf("%s:%d/%s", e.Host, e.Port, e.Database)
}

func identOK(value string) bool {
	if value == "" || len(value) > 63 {
		return false
	}
	for i, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '_':
		case i > 0 && r >= '0' && r <= '9':
		default:
			return false
		}
	}
	return true
}

func dryRun(ctx context.Context, paths toolPaths, source, target Endpoint, run Runner) (string, error) {
	sourceTables, err := tableNames(ctx, paths.psql, source, run)
	if err != nil {
		return "", err
	}
	targetTables, err := tableNames(ctx, paths.psql, target, run)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("dry-run source=%s tables=%s\ndry-run target=%s tables=%s\nno backup written\n", source.Label(), formatTables(sourceTables), target.Label(), formatTables(targetTables)), nil
}

func tableNames(ctx context.Context, psql string, ep Endpoint, run Runner) ([]string, error) {
	cmd, err := psqlArgs(psql, ep)
	if err != nil {
		return nil, err
	}
	out, err := run(ctx, cmd)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		schema, table, ok := strings.Cut(line, ".")
		if !ok || !identOK(schema) || !identOK(table) {
			return nil, errors.New("refusing a table name from the database")
		}
		names = append(names, schema+"."+table)
	}
	return names, nil
}

func formatTables(names []string) string {
	if len(names) == 0 {
		return "none"
	}
	return strings.Join(names, ",")
}

func apply(ctx context.Context, paths toolPaths, source, target Endpoint, backup string, stdout io.Writer, run Runner) error {
	if err := dump(ctx, paths, target, backup, run); err != nil {
		_ = os.Remove(backup)
		return err
	}
	if err := dumpHeaderOK(backup); err != nil {
		_ = os.Remove(backup)
		return err
	}
	if _, err := fmt.Fprintf(stdout, "backup %s\n", backup); err != nil {
		return err
	}
	dir := filepath.Dir(backup)
	temp, err := os.CreateTemp(dir, "source-*.dump")
	if err != nil {
		return errors.New("could not create the source dump")
	}
	sourceDump := temp.Name()
	_ = temp.Close()
	_ = os.Remove(sourceDump)
	defer os.Remove(sourceDump)
	if err := dump(ctx, paths, source, sourceDump, run); err != nil {
		_ = os.Remove(sourceDump)
		return err
	}
	if err := dumpHeaderOK(sourceDump); err != nil {
		return err
	}
	if err := restore(ctx, paths, target, sourceDump, run); err != nil {
		if rbErr := restore(ctx, paths, target, backup, run); rbErr != nil {
			return errors.New("restore failed and rollback failed")
		}
		return errors.New("restore failed; target was rolled back from the backup")
	}
	_, err = fmt.Fprintf(stdout, "restored source into %s\n", target.Label())
	return err
}

func dump(ctx context.Context, paths toolPaths, ep Endpoint, file string, run Runner) error {
	cmd, err := dumpArgs(paths.dump, ep, file)
	if err != nil {
		return err
	}
	_, err = run(ctx, cmd)
	return err
}

func restore(ctx context.Context, paths toolPaths, ep Endpoint, file string, run Runner) error {
	cmd, err := restoreArgs(paths.restore, ep, file)
	if err != nil {
		return err
	}
	_, err = run(ctx, cmd)
	return err
}

func psqlArgs(bin string, ep Endpoint) (Command, error) {
	if err := allowBin(bin, "psql"); err != nil {
		return Command{}, err
	}
	if err := ep.validate(); err != nil {
		return Command{}, err
	}
	return Command{Name: bin, Args: []string{
		"--no-password",
		"--tuples-only",
		"--no-align",
		"--host=" + ep.Host,
		"--port=" + strconv.Itoa(ep.Port),
		"--username=" + ep.User,
		"--dbname=" + ep.Database,
		"--command=" + listTablesSQL,
	}}, nil
}

// Generic external cutover deliberately adopts the destination role and omits
// source grants. Native recovery uses the separate owner/ACL-preserving contract.
func dumpArgs(bin string, ep Endpoint, file string) (Command, error) {
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
		"--no-owner",
		"--no-acl",
		"--host=" + ep.Host,
		"--port=" + strconv.Itoa(ep.Port),
		"--username=" + ep.User,
		"--dbname=" + ep.Database,
		"--file=" + file,
	}}, nil
}

func restoreArgs(bin string, ep Endpoint, file string) (Command, error) {
	if err := allowBin(bin, "pg_restore"); err != nil {
		return Command{}, err
	}
	if err := ep.validate(); err != nil {
		return Command{}, err
	}
	if err := safeDumpPath(file); err != nil {
		return Command{}, err
	}
	return Command{Name: bin, Args: []string{
		"--no-password",
		"--no-owner",
		"--no-acl",
		"--clean",
		"--if-exists",
		"--exit-on-error",
		"--single-transaction",
		"--host=" + ep.Host,
		"--port=" + strconv.Itoa(ep.Port),
		"--username=" + ep.User,
		"--dbname=" + ep.Database,
		file,
	}}, nil
}

func allowBin(path, base string) error {
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
		return errors.New("postgres tool path must be absolute")
	}
	got := filepath.Base(path)
	if got != base && got != base+".exe" {
		return errors.New("refusing postgres tool")
	}
	return nil
}

func safeDumpPath(path string) error {
	if path == "" || strings.ContainsAny(path, "\x00\r\n $`|&;<>*?\"'=") {
		return errors.New("backup path is not a local dump file")
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("backup path is not a local dump file")
	}
	if !strings.HasSuffix(path, ".dump") {
		return errors.New("backup path must end in .dump")
	}
	for _, part := range strings.Split(path, string(filepath.Separator)) {
		if part == ".." {
			return errors.New("backup path is not a local dump file")
		}
	}
	return nil
}

func dumpHeaderOK(path string) error {
	if err := safeDumpPath(path); err != nil {
		return err
	}
	parent := filepath.Dir(path)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return errors.New("backup is not a postgres custom dump")
	}
	defer root.Close()
	file, err := root.Open(filepath.Base(path))
	if err != nil {
		return errors.New("backup is not a postgres custom dump")
	}
	defer file.Close()
	buf := make([]byte, 5)
	n, err := io.ReadFull(file, buf)
	if err != nil || n != 5 || string(buf) != "PGDMP" {
		return errors.New("backup is not a postgres custom dump")
	}
	return nil
}

func allowExec(cmd Command) error {
	base := strings.TrimSuffix(filepath.Base(cmd.Name), ".exe")
	if len(cmd.Args) < 2 {
		return errors.New("refusing postgres tool")
	}
	switch base {
	case "psql":
		ep, err := endpointFromFlags(cmd.Args[:len(cmd.Args)-1])
		if err != nil {
			return err
		}
		want, err := psqlArgs(cmd.Name, ep)
		if err != nil {
			return err
		}
		if sameCommand(cmd, want) == nil {
			return nil
		}
		return allowRecoveryRoleCommand(cmd, ep)
	case "pg_dump":
		file, ok := strings.CutPrefix(cmd.Args[len(cmd.Args)-1], "--file=")
		if !ok {
			return errors.New("refusing postgres tool")
		}
		ep, err := endpointFromFlags(cmd.Args[:len(cmd.Args)-1])
		if err != nil {
			return err
		}
		want, err := dumpArgs(cmd.Name, ep, file)
		if err != nil {
			return err
		}
		if sameCommand(cmd, want) == nil {
			return nil
		}
		want, err = backupDumpArgs(cmd.Name, ep, file)
		if err != nil {
			return err
		}
		return sameCommand(cmd, want)
	case "pg_restore":
		file := cmd.Args[len(cmd.Args)-1]
		if len(cmd.Args) == 2 && cmd.Args[0] == "--list" {
			if err := allowBin(cmd.Name, "pg_restore"); err != nil {
				return err
			}
			return safeDumpPath(file)
		}
		ep, err := endpointFromFlags(cmd.Args[:len(cmd.Args)-1])
		if err != nil {
			return err
		}
		want, err := restoreArgs(cmd.Name, ep, file)
		if err != nil {
			return err
		}
		if sameCommand(cmd, want) == nil {
			return nil
		}
		var role string
		for _, arg := range cmd.Args {
			if value, ok := strings.CutPrefix(arg, "--role="); ok {
				role = value
			}
		}
		want, err = backupRestoreArgs(cmd.Name, ep, file, role)
		if err != nil {
			return err
		}
		return sameCommand(cmd, want)
	default:
		return errors.New("refusing postgres tool")
	}
}

func endpointFromFlags(args []string) (Endpoint, error) {
	ep := Endpoint{}
	for _, arg := range args {
		switch {
		case strings.HasPrefix(arg, "--host="):
			ep.Host = strings.TrimPrefix(arg, "--host=")
		case strings.HasPrefix(arg, "--port="):
			port, err := strconv.Atoi(strings.TrimPrefix(arg, "--port="))
			if err != nil {
				return Endpoint{}, errors.New("refusing postgres tool")
			}
			ep.Port = port
		case strings.HasPrefix(arg, "--username="):
			ep.User = strings.TrimPrefix(arg, "--username=")
		case strings.HasPrefix(arg, "--dbname="):
			ep.Database = strings.TrimPrefix(arg, "--dbname=")
		}
	}
	if err := ep.validate(); err != nil {
		return Endpoint{}, errors.New("refusing postgres tool")
	}
	return ep, nil
}

func sameCommand(got, want Command) error {
	if got.Name != want.Name || len(got.Args) != len(want.Args) {
		return errors.New("refusing postgres tool")
	}
	for i := range got.Args {
		if got.Args[i] != want.Args[i] {
			return errors.New("refusing postgres tool")
		}
	}
	return nil
}

// RealRunner starts pg_dump, pg_restore, or psql after allowExec.
// The child environment is PATH and LC_ALL only. A password is not forwarded.
func RealRunner(ctx context.Context, cmd Command) ([]byte, error) {
	return runTool(ctx, cmd, "")
}

func runTool(ctx context.Context, cmd Command, passwordFile string) ([]byte, error) {
	if err := allowExec(cmd); err != nil {
		return nil, err
	}
	// #nosec G204 -- allowExec allows only absolute pg_dump, pg_restore, or psql with a fixed argument list
	proc := exec.CommandContext(ctx, cmd.Name, cmd.Args...)
	proc.Env = []string{"LC_ALL=C", "PATH=" + os.Getenv("PATH")}
	if passwordFile != "" {
		proc.Env = append(proc.Env, "PGPASSFILE="+passwordFile)
	}
	out, err := proc.CombinedOutput()
	if err != nil {
		return out, fmt.Errorf("%s failed", strings.TrimSuffix(filepath.Base(cmd.Name), ".exe"))
	}
	return out, nil
}
