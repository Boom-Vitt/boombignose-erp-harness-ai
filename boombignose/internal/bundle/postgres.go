package bundle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/launch"
)

const defaultPGPort = "54329"

// DataDir is where initdb writes the cluster. It is outside the installer
// so an AppImage mount can stay read-only.
func DataDir() (string, error) {
	if dir := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_DATA")); dir != "" {
		if !safeDataDir(dir) {
			return "", errors.New("BOOMBIGNOSE_DATA must be a private absolute path without spaces or traversal")
		}
		return canonicalPath(dir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return canonicalPath(filepath.Join(home, ".local", "share", "boombignose", "pg"))
}

func pgAddr() string {
	return net.JoinHostPort("127.0.0.1", pgPort())
}

// ourCluster reports whether postmaster.pid in dataDir is a live process
// for this directory and port. This is only a preliminary ownership check;
// stopping also requires authenticated confirmation of the data directory.
func ourCluster(dataDir, port string) bool {
	body, err := os.ReadFile(filepath.Join(dataDir, "postmaster.pid"))
	if err != nil {
		return false
	}
	lines := strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n")
	if len(lines) < 4 {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(lines[0]))
	if err != nil || !processAlive(pid) {
		return false
	}
	if filepath.Clean(strings.TrimSpace(lines[1])) != filepath.Clean(dataDir) {
		return false
	}
	return strings.TrimSpace(lines[3]) == port
}

func processAlive(pid int) bool {
	if pid <= 1 {
		return false
	}
	if runtime.GOOS == "windows" {
		_, err := processIdentity(pid)
		return err == nil
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

func pgPort() string {
	return servicePort("BOOMBIGNOSE_PG_PORT", defaultPGPort)
}

type sqlQuery func(ctx context.Context, addr, user, database, sql string) ([][]string, error)
type cmdRun func(Command) error

func safeDataDir(dir string) bool {
	return filepath.IsAbs(dir) && !strings.Contains(dir, "..") && !strings.ContainsAny(dir, " \x00\r\n")
}

func allowedPgCtl(args []string) bool {
	if len(args) == 5 && args[0] == "-D" && safeDataDir(args[1]) && args[2] == "-m" && args[3] == "fast" && args[4] == "stop" {
		return true
	}
	if len(args) != 8 || args[0] != "-D" || !safeDataDir(args[1]) || args[2] != "-l" || args[4] != "-w" || args[5] != "-o" || args[7] != "start" {
		return false
	}
	if args[3] != filepath.Join(args[1], "server.log") {
		return false
	}
	return loopbackStartOptions(args[6], args[1])
}

func initdbAllowed(args []string) bool {
	if len(args) != 9 || args[0] != "-D" || !safeDataDir(args[1]) || args[2] != "-U" || args[3] != "boombignose" {
		return false
	}
	if args[4] != "--auth-local=scram-sha-256" || args[5] != "--auth-host=scram-sha-256" || args[6] != "--encoding=UTF8" || args[7] != "--pwfile="+passwordPath(args[1]) {
		return false
	}
	return args[8] == "--locale=C" || args[8] == "--no-locale"
}

const securePGOptions = " -c password_encryption=scram-sha-256 -c log_statement=none -c log_min_duration_statement=-1 -c log_min_error_statement=panic"

func loopbackStartOptions(opts, dataDir string) bool {
	base, ok := strings.CutSuffix(opts, securePGOptions)
	if !ok {
		return false
	}
	base, ok = strings.CutSuffix(base, " -c hba_file="+filepath.Join(dataDir, "pg_hba.conf"))
	if !ok {
		return false
	}
	const prefix = "-c listen_addresses=127.0.0.1 -c port="
	rest, ok := strings.CutPrefix(base, prefix)
	if !ok {
		return false
	}
	port, ok := strings.CutSuffix(rest, " -c unix_socket_directories=")
	if !ok {
		return false
	}
	n, err := strconv.Atoi(port)
	return err == nil && n >= 1 && n <= 65535 && strconv.Itoa(n) == port
}

// allowedPostgresCommand accepts initdb for a new cluster and pg_ctl start/stop.
// The listen address inside pg_ctl -o must be 127.0.0.1.
func allowedPostgresCommand(name string, args []string) error {
	if !filepath.IsAbs(name) || strings.ContainsAny(name, "\x00\r\n") {
		return errors.New("refusing postgres command")
	}
	base := strings.ToLower(filepath.Base(name))
	switch base {
	case "initdb", "initdb.exe":
		if !initdbAllowed(args) {
			return errors.New("refusing postgres command")
		}
	case "pg_ctl", "pg_ctl.exe":
		if !allowedPgCtl(args) {
			return errors.New("refusing postgres command")
		}
	default:
		return errors.New("refusing postgres command")
	}
	info, err := os.Stat(name)
	if err != nil || info.IsDir() {
		return errors.New("refusing postgres command")
	}
	return nil
}

func defaultCmd(cmd Command) error {
	if err := allowedPostgresCommand(cmd.Name, cmd.Args); err != nil {
		return err
	}
	// #nosec G204 -- allowedPostgresCommand accepts only initdb or pg_ctl with the fixed local arguments
	proc := exec.Command(cmd.Name, cmd.Args...)
	proc.Dir = cmd.Dir
	proc.Env = cmd.Env
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	return proc.Run()
}

// EnsurePostgres initializes and starts the private loopback cluster.
// ERP migrations run only after the real Auth schema has been initialized.
func EnsurePostgres(ctx context.Context, layout Layout, dataDir string) error {
	return ensurePostgres(ctx, layout, dataDir, func() bool {
		ok, _ := launch.Listening("http://" + pgAddr())
		return ok
	}, defaultCmd, queryPostgres)
}

func ensurePostgres(ctx context.Context, layout Layout, dataDir string, up func() bool, run cmdRun, query sqlQuery) error {
	if layout.Postgres == "" {
		return errors.New("native PostgreSQL runtime missing; install the complete runtime bundle")
	}
	if dataDir == "" {
		return errors.New("postgres data dir is empty")
	}
	if strings.Contains(dataDir, " ") {
		return errors.New("postgres data dir cannot contain spaces")
	}
	listening := up()
	if listening && !ourCluster(dataDir, pgPort()) {
		return fmt.Errorf("%s is already in use by another program. Stop that program, or set BOOMBIGNOSE_PG_PORT. The data directory stays at %s and the Postgres log is %s", pgAddr(), dataDir, filepath.Join(dataDir, "server.log"))
	}
	if err := privateDirectory(dataDir); err != nil {
		return err
	}
	_, versionErr := os.Stat(filepath.Join(dataDir, "PG_VERSION"))
	newCluster := os.IsNotExist(versionErr)
	if versionErr != nil && !newCluster {
		return versionErr
	}
	if !newCluster && !isSecureCluster(dataDir) {
		return errors.New("legacy or unrecognized PostgreSQL cluster: stop its owned stack, take an offline backup, then explicitly run boombignose secure-db; data and configuration were not changed")
	}
	credentials, err := loadDBCredentials(dataDir, newCluster)
	if err != nil {
		return err
	}
	rememberCredentials(pgAddr(), credentials)
	binDir := filepath.Dir(layout.Postgres)
	env := postgresEnv(layout)
	if !listening {
		if _, err := os.Stat(filepath.Join(dataDir, "PG_VERSION")); err != nil {
			initdb := filepath.Join(binDir, exeName("initdb"))
			if err := run(Command{
				Name: initdb,
				Args: initdbArgs(runtime.GOOS, dataDir),
				Env:  env,
			}); err != nil {
				return fmt.Errorf("initdb: %w", err)
			}
			if err := markSecureCluster(dataDir); err != nil {
				return err
			}
		}
		pgCtl := filepath.Join(binDir, exeName("pg_ctl"))
		if err := run(Command{
			Name: pgCtl,
			Args: []string{
				"-D", dataDir,
				"-l", filepath.Join(dataDir, "server.log"),
				"-w",
				"-o", pgStartOptions(dataDir),
				"start",
			},
			Env: env,
		}); err != nil {
			return fmt.Errorf("pg_ctl start: %w", err)
		}
	}
	var last error
	for i := 0; i < 25; i++ {
		last = ensureDatabase(ctx, pgAddr(), query)
		if last == nil {
			return nil
		}
		if !strings.Contains(strings.ToLower(last.Error()), "connection refused") {
			return last
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return last
}

func initdbArgs(goos, dataDir string) []string {
	args := []string{"-D", dataDir, "-U", "boombignose", "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", "--encoding=UTF8", "--pwfile=" + passwordPath(dataDir)}
	if goos == "windows" {
		return append(args, "--no-locale")
	}
	return append(args, "--locale=C")
}

func pgStartOptions(dataDir string) string {
	// Every native client uses loopback TCP. Avoid unnecessary Unix sockets,
	// whose path limit otherwise rejects valid long data directories on macOS.
	opts := fmt.Sprintf("-c listen_addresses=127.0.0.1 -c port=%s -c unix_socket_directories=", pgPort())
	return opts + " -c hba_file=" + filepath.Join(dataDir, "pg_hba.conf") + securePGOptions
}

func postgresEnv(layout Layout) []string {
	return postgresEnvFor(runtime.GOOS, layout)
}

func postgresEnvFor(goos string, layout Layout) []string {
	root := filepath.Dir(filepath.Dir(layout.Postgres))
	bin := filepath.Dir(layout.Postgres)
	lib := filepath.Join(root, "lib")
	path := bin
	if goos == "windows" {
		if systemRoot := os.Getenv("SystemRoot"); systemRoot != "" {
			path = bin + ";" + filepath.Join(systemRoot, "System32")
		}
	}
	env := []string{"PATH=" + path}
	switch goos {
	case "darwin":
		env = append(env, "DYLD_LIBRARY_PATH="+lib, "DYLD_FALLBACK_LIBRARY_PATH="+lib)
	case "windows":
	default:
		env = append(env, "LD_LIBRARY_PATH="+lib)
	}
	for _, key := range []string{"HOME", "LANG", "TMPDIR", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func ensureDatabase(ctx context.Context, addr string, query sqlQuery) error {
	if query == nil {
		query = queryPostgres
	}
	_, err := query(ctx, addr, "boombignose", "postgres", "create database boombignose")
	if err == nil || strings.Contains(strings.ToLower(err.Error()), "already exists") {
		return nil
	}
	return err
}

func applyMigrations(ctx context.Context, layout Layout, addr string, query sqlQuery) error {
	// Auth owns its own migration journal; ERP filenames use a separate table.
	const table = "public.erp_schema_migrations"
	if query == nil {
		query = queryPostgres
	}
	present, err := query(ctx, addr, "boombignose", "boombignose", "select to_regclass('"+table+"')")
	if err != nil {
		return err
	}
	if len(present) != 1 || len(present[0]) != 1 {
		return errors.New("unable to inspect ERP migration journal")
	}
	applied := map[string]bool{}
	if present[0][0] == "" {
		root := filepath.Dir(filepath.Dir(layout.Postgres))
		body, err := readBundleFile(root, "prelude-after-auth.sql")
		if err != nil {
			return err
		}
		if _, err := query(ctx, addr, "boombignose", "boombignose", string(body)); err != nil {
			return fmt.Errorf("prelude: %w", err)
		}
	} else {
		rows, err := query(ctx, addr, "boombignose", "boombignose", "select filename from "+table)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if len(row) > 0 && row[0] != "" {
				applied[row[0]] = true
			}
		}
	}
	dir := filepath.Join(filepath.Dir(filepath.Dir(layout.Postgres)), "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		if applied[name] {
			continue
		}
		if strings.Contains(name, "/") || strings.Contains(name, "\\") || name == ".." {
			return errors.New("refusing migration name")
		}
		body, err := readBundleFile(dir, name)
		if err != nil {
			return err
		}
		if _, err := query(ctx, addr, "boombignose", "boombignose", string(body)); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		quoted, err := quoteLiteral(name)
		if err != nil {
			return err
		}
		insert := "insert into " + table + " (filename) values (" + quoted + ")"
		if _, err := query(ctx, addr, "boombignose", "boombignose", insert); err != nil {
			return err
		}
	}
	check, err := query(ctx, addr, "boombignose", "boombignose", "select to_regclass('public.organizations')")
	if err != nil {
		return err
	}
	if len(check) == 0 || check[0][0] == "" {
		return errors.New("public.organizations was not created")
	}
	return nil
}

// StopPostgres asks the cluster in dataDir to shut down.
func StopPostgres(layout Layout, dataDir string) error {
	return stopPostgres(layout, dataDir, queryPostgres)
}

func stopPostgres(layout Layout, dataDir string, query sqlQuery) error {
	if layout.Postgres == "" || dataDir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dataDir, "PG_VERSION")); err != nil {
		return nil
	}
	if !ourCluster(dataDir, pgPort()) {
		return nil // A stale PID file is not permission to stop another service.
	}
	credentials, err := loadDBCredentials(dataDir, false)
	if err != nil {
		return errors.New("refusing to stop PostgreSQL without private ownership credentials")
	}
	rememberCredentials(pgAddr(), credentials)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := query(ctx, pgAddr(), "boombignose", "postgres", "show data_directory")
	if err != nil || len(rows) != 1 || len(rows[0]) != 1 || filepath.Clean(rows[0][0]) != filepath.Clean(dataDir) {
		return errors.New("refusing to stop PostgreSQL: authenticated cluster ownership could not be established")
	}
	pgCtl := filepath.Join(filepath.Dir(layout.Postgres), exeName("pg_ctl"))
	stopArgs := []string{"-D", dataDir, "-m", "fast", "stop"}
	if err := allowedPostgresCommand(pgCtl, stopArgs); err != nil {
		return err
	}
	// #nosec G204 -- allowedPostgresCommand accepts only this pg_ctl stop shape
	cmd := exec.Command(pgCtl, stopArgs...)
	cmd.Env = postgresEnv(layout)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// pid helpers keep the ERP process stoppable without scanning the machine.
func writePID(dataDir string, pid int) error {
	return writeProcessRecord(dataDir, "erp.pid", pid)
}

func writeDataFile(dir, name string, body []byte) error {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer root.Close()
	file, err := root.OpenFile(name, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := hardenCreated(filepath.Join(dir, name)); err != nil {
		return err
	}
	_, err = file.Write(body)
	return err
}

func readBundleFile(root, name string) ([]byte, error) {
	fsRoot, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer fsRoot.Close()
	f, err := fsRoot.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, 8<<20))
}

func stopPID(dataDir string) {
	stopOnePID(dataDir, "erp.pid")
}

var running struct {
	sync.Mutex
	layout Layout
	data   string
}

// erpPIDDir is the data directory whose erp.pid the bundled Node should write.
// recordERP limits that write to the ERP process, not ollama.
var (
	erpPIDDir string
	recordERP bool
)

// StartStack starts portable Postgres when the binary is present, applies
// migrations, then starts the bundled ERP server.
func StartStack(ctx context.Context, layout Layout, dataDir, rawURL string, parent []string, run Runner) error {
	var pathErr error
	dataDir, pathErr = canonicalPath(dataDir)
	if pathErr != nil {
		return pathErr
	}
	layout.Root, pathErr = canonicalPath(layout.Root)
	if pathErr != nil {
		return pathErr
	}
	cfg, err := ValidateConfig(rawURL)
	if err != nil {
		return err
	}
	if err := preflightPorts(cfg, dataDir); err != nil {
		return err
	}
	running.Lock()
	running.layout = layout
	running.data = dataDir
	erpPIDDir = dataDir
	recordERP = true
	running.Unlock()
	defer func() {
		running.Lock()
		recordERP = false
		running.Unlock()
	}()
	if err := EnsurePostgres(ctx, layout, dataDir); err != nil {
		return err
	}
	if err := EnsureAuth(ctx, layout, dataDir); err != nil {
		return err
	}
	filesRoot := filepath.Join(dataDir, "attachments")
	if err := privateDirectory(filesRoot); err != nil {
		return err
	}
	nativeEnv := append([]string{}, parent...)
	nativeEnv = append(nativeEnv, "BOOMBIGNOSE_NATIVE=1", "BOOMBIGNOSE_FILES_ROOT="+filesRoot,
		"BOOMBIGNOSE_DATA="+dataDir, "BOOMBIGNOSE_BUNDLE="+layout.Root)
	if err := EnsureOllama(ctx, layout, os.Getenv("OLLAMA_HOST"), nil, nil); err != nil {
		return err
	}
	return EnsureERP(ctx, layout, rawURL, withLocalKeys(nativeEnv, dataDir), run)
}

// StopAt stops the recorded ERP pid and the portable cluster in dataDir.
func StopAt(layout Layout, dataDir string) error {
	if dataDir != "" {
		stopPID(dataDir)
		stopExtraPIDs(dataDir)
	}
	stopLocalAPI()
	return StopPostgres(layout, dataDir)
}

// StopRunning stops the stack started in this process.
func StopRunning() {
	running.Lock()
	layout := running.layout
	data := running.data
	running.Unlock()
	_ = StopAt(layout, data)
}
