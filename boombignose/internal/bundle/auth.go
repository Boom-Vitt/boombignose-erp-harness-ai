package bundle

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/launch"
)

const (
	localAPIPort  = "54321"
	localAuthPort = "54323"
	localRESTPort = "54324"
)

// EnsureAuth initializes the real Auth schema before applying ERP migrations,
// then starts PostgREST and the loopback gateway. No synthetic Auth fallback.
func EnsureAuth(ctx context.Context, layout Layout, dataDir string) error {
	if layout.Auth == "" || layout.PostgREST == "" {
		return errors.New("native Auth or PostgREST runtime missing; install the complete runtime bundle")
	}
	keys, err := prepareAuthSchema(ctx, layout, dataDir)
	if err != nil {
		return err
	}
	if err := startPostgREST(ctx, layout, dataDir, keys.secret); err != nil {
		return err
	}
	return startLocalAPI(ctx)
}

// EnsureApplicationInfrastructure starts only the existing PostgreSQL and
// GoTrue infrastructure for the Go application. It never starts Node,
// PostgREST, a second application server, a model provider or a model download.
func EnsureApplicationInfrastructure(ctx context.Context, layout Layout, dataDir string) error {
	if layout.Postgres == "" || layout.Auth == "" {
		return errors.New("native PostgreSQL or Auth runtime missing")
	}
	if err := EnsurePostgres(ctx, layout, dataDir); err != nil {
		return err
	}
	if _, err := prepareAuthSchema(ctx, layout, dataDir); err != nil {
		return err
	}
	// The Go server never authenticates a service-role database request. Keep
	// the inherited legacy role out of its login's reachable privilege set.
	_, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose",
		"alter role boombignose_rest noinherit nobypassrls; revoke service_role from boombignose_rest")
	return err
}

func prepareAuthSchema(ctx context.Context, layout Layout, dataDir string) (localKeys, error) {
	keys, err := ensureLocalKeys(dataDir)
	if err != nil {
		return localKeys{}, err
	}
	for _, stmt := range authBootstrapSQL() {
		if _, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose", stmt); err != nil {
			return localKeys{}, fmt.Errorf("auth bootstrap: %w", err)
		}
	}
	if err := provisionServiceRoles(ctx); err != nil {
		return localKeys{}, err
	}
	if err := startAuthServer(ctx, layout, dataDir, keys.secret); err != nil {
		return localKeys{}, err
	}
	if err := applyMigrations(ctx, layout, pgAddr(), nil); err != nil {
		return localKeys{}, err
	}
	if _, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose",
		"grant anon, authenticated, service_role to boombignose_rest"); err != nil {
		return localKeys{}, err
	}
	return keys, nil
}

type localKeys struct {
	secret  string
	anon    string
	service string
}

func ensureLocalKeys(dataDir string) (localKeys, error) {
	secret, secretErr := privateRead(filepath.Join(dataDir, "jwt.secret"))
	anon, anonErr := privateRead(filepath.Join(dataDir, "anon.key"))
	service, serviceErr := privateRead(filepath.Join(dataDir, "service.key"))
	if secretErr == nil && anonErr == nil && serviceErr == nil {
		return localKeys{
			secret:  strings.TrimSpace(string(secret)),
			anon:    strings.TrimSpace(string(anon)),
			service: strings.TrimSpace(string(service)),
		}, nil
	}
	if !os.IsNotExist(secretErr) || !os.IsNotExist(anonErr) || !os.IsNotExist(serviceErr) {
		return localKeys{}, errors.New("local signing keys are incomplete or not private; restore the complete key set instead of rotating it")
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return localKeys{}, err
	}
	keys := localKeys{secret: hex.EncodeToString(buf)}
	var err error
	keys.anon, err = mintRoleJWT(keys.secret, "anon")
	if err != nil {
		return localKeys{}, err
	}
	keys.service, err = mintRoleJWT(keys.secret, "service_role")
	if err != nil {
		return localKeys{}, err
	}
	if err := writeDataFile(dataDir, "jwt.secret", []byte(keys.secret+"\n")); err != nil {
		return localKeys{}, err
	}
	if err := writeDataFile(dataDir, "anon.key", []byte(keys.anon+"\n")); err != nil {
		return localKeys{}, err
	}
	if err := writeDataFile(dataDir, "service.key", []byte(keys.service+"\n")); err != nil {
		return localKeys{}, err
	}
	return keys, nil
}

func mintRoleJWT(secret, role string) (string, error) {
	if strings.TrimSpace(secret) == "" || strings.TrimSpace(role) == "" {
		return "", errors.New("jwt secret and role are required")
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	now := time.Now().Unix()
	payload := fmt.Sprintf(`{"role":%q,"iss":"supabase","iat":%d,"exp":%d}`, role, now, now+10*365*24*3600)
	body := base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(header + "." + body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return header + "." + body + "." + sig, nil
}

// authBootstrapSQL prepares a cluster whose only superuser is boombignose.
// Auth migrations grant to the role named postgres, which initdb does not create.
func authBootstrapSQL() []string {
	return []string{
		"create extension if not exists pgcrypto",
		"create schema if not exists auth",
		"do $$ begin create role postgres nologin; exception when duplicate_object then null; end $$",
	}
}

func authProcessEnv(migrations, secret string) []string {
	cfg, _ := ValidateConfig(localERPOrigin())
	external := cfg.AppOrigin() + "/auth/local"
	disableSignup := "true"
	if cfg.SignupAllowed() {
		disableSignup = "false"
	}
	return []string{
		"GOTRUE_DB_DRIVER=postgres",
		"GOTRUE_DB_DATABASE_URL=" + authDBURL(),
		"DATABASE_URL=" + authDBURL(),
		"GOTRUE_DB_MIGRATIONS_PATH=" + migrations,
		"GOTRUE_JWT_SECRET=" + secret,
		"GOTRUE_JWT_EXP=3600",
		"GOTRUE_API_HOST=127.0.0.1",
		"GOTRUE_API_PORT=" + authPort(),
		"API_EXTERNAL_URL=" + external,
		"GOTRUE_API_EXTERNAL_URL=" + external,
		"GOTRUE_API_API_EXTERNAL_URL=" + external,
		"GOTRUE_SITE_URL=" + cfg.AppOrigin(),
		"GOTRUE_URI_ALLOW_LIST=" + cfg.AppOrigin() + "/auth/confirm",
		"GOTRUE_DISABLE_SIGNUP=" + disableSignup,
		"GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
		"GOTRUE_JWT_AUD=authenticated",
		"GOTRUE_MAILER_AUTOCONFIRM=true",
		"GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
	}
}

func postgrestProcessEnv(secret string) []string {
	return []string{
		"PGRST_DB_URI=" + localDBURL(),
		"PGRST_DB_SCHEMAS=public,storage",
		"PGRST_DB_ANON_ROLE=anon",
		"PGRST_JWT_SECRET=" + secret,
		"PGRST_SERVER_HOST=127.0.0.1",
		"PGRST_SERVER_PORT=" + restPort(),
	}
}

func localAPIListenAddr() string {
	return net.JoinHostPort("127.0.0.1", apiPort())
}

func startAuthServer(ctx context.Context, layout Layout, dataDir, secret string) error {
	migrations := filepath.Join(filepath.Dir(layout.Auth), "migrations")
	if _, err := os.Stat(migrations); err != nil {
		return fmt.Errorf("auth migrations: %w", err)
	}
	cmd := Command{
		Name: layout.Auth,
		Dir:  filepath.Dir(layout.Auth),
		Env:  authProcessEnv(migrations, secret),
	}
	cmd.Env = append(cmd.Env, copiedProcessEnv()...)
	exited, err := startLogged(cmd, dataDir, "auth.log", "auth.pid")
	if err != nil {
		return err
	}
	waitCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var reason string
	err = launch.WaitUntil(waitCtx, 500*time.Millisecond, func() bool {
		ok, why := authReady(waitCtx)
		reason = why
		return ok
	}, exited)
	if err != nil {
		return fmt.Errorf("auth did not become ready: %s (inspect the private auth.log locally)", reason)
	}
	return nil
}

func authReady(ctx context.Context) (bool, string) {
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(probe, http.MethodGet, "http://127.0.0.1:"+authPort()+"/health", nil)
	if err != nil {
		return false, err.Error()
	}
	client := http.Client{
		Timeout:   2 * time.Second,
		Transport: &http.Transport{Proxy: nil},
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, "health: " + err.Error()
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Sprintf("health status %d", resp.StatusCode)
	}
	return true, ""
}

func startPostgREST(ctx context.Context, layout Layout, dataDir, secret string) error {
	cmd := Command{
		Name: layout.PostgREST,
		Dir:  filepath.Dir(layout.PostgREST),
		Env:  postgrestProcessEnv(secret),
	}
	cmd.Env = append(cmd.Env, copiedProcessEnv()...)
	exited, err := startLogged(cmd, dataDir, "postgrest.log", "postgrest.pid")
	if err != nil {
		return err
	}
	waitCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	err = launch.WaitUntil(waitCtx, 200*time.Millisecond, func() bool {
		ok, _ := launch.Listening("http://127.0.0.1:" + restPort())
		return ok
	}, exited)
	if err != nil {
		return errors.New("postgrest did not become ready (inspect the private postgrest.log locally)")
	}
	return nil
}

func localDBURL() string {
	return databaseURL("boombignose_rest")
}

// authDBURL puts the auth schema first. GoTrue queries unqualified table
// names such as identities. The cluster default stays public so ERP
// migrations create their tables there.
func authDBURL() string {
	return databaseURL("boombignose_auth") + "&options=-csearch_path%3Dauth%2Cpublic"
}

func copiedProcessEnv() []string {
	var env []string
	for _, key := range []string{"HOME", "LANG", "TMPDIR", "SystemRoot", "USERPROFILE", "PATH"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func allowLoggedCommand(name string, args []string) (string, error) {
	if strings.ContainsAny(name, "\x00\r\n") || len(args) != 0 {
		return "", errors.New("refusing local api command")
	}
	path := name
	if !filepath.IsAbs(path) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return "", errors.New("refusing local api command")
		}
		path = abs
	}
	path = filepath.Clean(path)
	switch filepath.Base(path) {
	case "auth", "auth.exe", "postgrest", "postgrest.exe":
		return path, nil
	default:
		return "", errors.New("refusing local api command")
	}
}

func startLogged(cmd Command, dataDir, logName, pidName string) (<-chan error, error) {
	bin, err := allowLoggedCommand(cmd.Name, cmd.Args)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dataDir)
	if err != nil {
		return nil, err
	}
	logFile, err := root.OpenFile(logName, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		_ = root.Close()
		return nil, err
	}
	// #nosec G204 -- allowLoggedCommand accepts only the absolute auth/PostgREST binary and no arguments.
	proc := exec.Command(bin)
	proc.Dir = cmd.Dir
	proc.Env = cmd.Env
	serviceLog := redactedServiceLog(logFile, cmd.Env)
	proc.Stdout, proc.Stderr = serviceLog, serviceLog
	if err := proc.Start(); err != nil {
		_ = logFile.Close()
		_ = root.Close()
		return nil, err
	}
	if err := writeProcessRecord(dataDir, pidName, proc.Process.Pid); err != nil {
		_ = proc.Process.Kill()
		_ = proc.Wait()
		_ = logFile.Close()
		_ = root.Close()
		return nil, err
	}
	exited := make(chan error, 1)
	go func() {
		err := proc.Wait()
		_ = logFile.Close()
		_ = root.Close()
		exited <- err
		close(exited)
	}()
	return exited, nil
}

func startLocalAPI(ctx context.Context) error {
	addr := localAPIListenAddr()
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("local api: %w", err)
	}
	authURL, err := url.Parse("http://127.0.0.1:" + authPort())
	if err != nil {
		_ = ln.Close()
		return err
	}
	restURL, err := url.Parse("http://127.0.0.1:" + restPort())
	if err != nil {
		_ = ln.Close()
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/auth/v1/", newPrefixProxy("/auth/v1", authURL))
	mux.Handle("/rest/v1/", newPrefixProxy("/rest/v1", restURL))
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	apiMu.Lock()
	apiSrv = srv
	apiMu.Unlock()
	go func() { _ = srv.Serve(ln) }()
	err = launch.WaitUntil(ctx, 50*time.Millisecond, func() bool {
		ok, _ := launch.Listening("http://" + addr + "/auth/v1/health")
		return ok
	}, nil)
	if err != nil {
		stopLocalAPI()
		return errors.New("local api did not become ready")
	}
	return nil
}

func newPrefixProxy(prefix string, upstream *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.Director = func(r *http.Request) {
		r.URL.Scheme = upstream.Scheme
		r.URL.Host = upstream.Host
		r.Host = upstream.Host
		path := strings.TrimPrefix(r.URL.Path, prefix)
		if path == "" {
			path = "/"
		}
		r.URL.Path = path
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "local api unavailable", http.StatusBadGateway)
	}
	return proxy
}

var (
	apiMu  sync.Mutex
	apiSrv *http.Server
)

func stopLocalAPI() {
	apiMu.Lock()
	srv := apiSrv
	apiSrv = nil
	apiMu.Unlock()
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func stopExtraPIDs(dataDir string) {
	if dataDir == "" {
		return
	}
	for _, name := range []string{"auth.pid", "postgrest.pid", "ollama.pid"} {
		stopOnePID(dataDir, name)
	}
}

func stopOnePID(dataDir, name string) {
	stopOwnedProcess(dataDir, name)
}

func withLocalKeys(parent []string, dataDir string) []string {
	anon, err := readBundleFile(dataDir, "anon.key")
	if err != nil {
		return parent
	}
	service, err := readBundleFile(dataDir, "service.key")
	if err != nil {
		return parent
	}
	drop := map[string]bool{
		"NEXT_PUBLIC_SUPABASE_URL":      true,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY": true,
		"SUPABASE_SERVICE_ROLE_KEY":     true,
	}
	out := make([]string, 0, len(parent)+3)
	for _, item := range parent {
		key, _, ok := strings.Cut(item, "=")
		if ok && drop[key] {
			continue
		}
		out = append(out, item)
	}
	return append(out,
		"NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:"+apiPort(),
		"NEXT_PUBLIC_SUPABASE_ANON_KEY="+strings.TrimSpace(string(anon)),
		"SUPABASE_SERVICE_ROLE_KEY="+strings.TrimSpace(string(service)),
	)
}

func databaseURL(user string) string {
	return (&url.URL{Scheme: "postgres", User: url.UserPassword(user, passwordFor(pgAddr(), user)), Host: pgAddr(), Path: "/boombignose", RawQuery: "sslmode=disable"}).String()
}

func localERPOrigin() string {
	if value := os.Getenv("BOOMBIGNOSE_ERP_URL"); value != "" {
		return value
	}
	return "http://127.0.0.1:3100"
}

func provisionServiceRoles(ctx context.Context) error {
	authPassword := passwordFor(pgAddr(), "boombignose_auth")
	restPassword := passwordFor(pgAddr(), "boombignose_rest")
	if authPassword == "" || restPassword == "" {
		return errors.New("private database credentials are unavailable")
	}
	// Passwords are generated hex, never external SQL input. PostgreSQL's own
	// SCRAM implementation creates/verifies the password representation.
	sql := `do $$ begin create role boombignose_auth login; exception when duplicate_object then null; end $$;
do $$ begin create role boombignose_rest login noinherit; exception when duplicate_object then null; end $$;
alter role boombignose_auth nosuperuser nocreatedb nocreaterole noreplication password '` + authPassword + `';
alter role boombignose_rest nosuperuser nocreatedb nocreaterole noreplication password '` + restPassword + `';
alter schema auth owner to boombignose_auth;
grant usage, create on schema public to boombignose_auth;
do $$ declare r record; begin
for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p','S','v','m') loop
execute format('alter %s auth.%I owner to boombignose_auth', case r.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.relname);
end loop;
for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' loop
execute format('alter function %s owner to boombignose_auth', r.signature);
end loop;
if exists (select 1 from information_schema.columns where table_schema='public' and table_name='schema_migrations' and column_name='version') then alter table public.schema_migrations owner to boombignose_auth; end if;
end $$;`
	_, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose", sql)
	return err
}
