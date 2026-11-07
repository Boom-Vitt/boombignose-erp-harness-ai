package bundle

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuthDBURLSetsTheAuthSearchPath(t *testing.T) {
	t.Setenv("BOOMBIGNOSE_PG_PORT", "54329")
	got := authDBURL()
	if !strings.Contains(got, "options=-csearch_path%3Dauth%2Cpublic") {
		t.Fatal(got)
	}
	if strings.Contains(localDBURL(), "search_path") {
		t.Fatal(localDBURL())
	}
}

func TestAuthBootstrapCreatesThePostgresRole(t *testing.T) {
	sql := strings.Join(authBootstrapSQL(), "\n")
	if !strings.Contains(sql, "create extension if not exists pgcrypto") {
		t.Fatal("pgcrypto missing")
	}
	if !strings.Contains(sql, "create schema if not exists auth") {
		t.Fatal("auth schema missing")
	}
	if !strings.Contains(sql, "create role postgres nologin") {
		t.Fatal("postgres role missing")
	}
}

func TestMintRoleJWTSignsTheRole(t *testing.T) {
	token, err := mintRoleJWT("test-secret", "anon")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[2] == "" {
		t.Fatalf("token = %s", token)
	}
	if strings.Contains(token, "service_role") {
		t.Fatal("anon token must not carry the service role")
	}
}

func TestEnsureLocalKeysStayOnDisk(t *testing.T) {
	dir := t.TempDir()
	first, err := ensureLocalKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.anon == "" || first.service == "" || first.secret == "" {
		t.Fatal("missing key material")
	}
	if first.anon == first.service {
		t.Fatal("anon and service tokens must differ")
	}
	info, err := os.Stat(filepath.Join(dir, "service.key"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("service key mode = %o", info.Mode().Perm())
	}
	second, err := ensureLocalKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	if second.secret != first.secret || second.anon != first.anon {
		t.Fatal("a second launch must keep the same local keys")
	}
}

func TestEnsureLocalKeysDifferPerDataDirectory(t *testing.T) {
	first, err := ensureLocalKeys(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	second, err := ensureLocalKeys(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if first.secret == second.secret || len(first.secret) != 64 {
		t.Fatal("each install must get its own 32-byte jwt secret")
	}
}

func TestLocalServicesUseAuthenticatedPrivateDatabaseRoles(t *testing.T) {
	t.Setenv("BOOMBIGNOSE_PG_PORT", "54329")
	isolatedPorts(t)
	credentials, err := loadDBCredentials(filepath.Join(t.TempDir(), "pg"), true)
	if err != nil {
		t.Fatal(err)
	}
	rememberCredentials(pgAddr(), credentials)
	secret := "install-specific-secret"
	groups := [][]string{
		authProcessEnv("/opt/boombignose/migrations", secret),
		postgrestProcessEnv(secret),
	}
	for _, env := range groups {
		text := strings.Join(env, "\n")
		if strings.Contains(text, "0.0.0.0") || strings.Contains(strings.ToLower(text), "password") {
			t.Fatal("service environment violated the private endpoint policy")
		}
		for _, line := range env {
			equals := strings.Index(line, "=")
			raw := line[equals+1:]
			if !strings.Contains(raw, "://") {
				continue
			}
			parsed, err := url.Parse(raw)
			if err != nil {
				t.Fatal("invalid service connection URL")
			}
			if parsed.Scheme == "postgres" {
				password, set := parsed.User.Password()
				if !set || password == "" || parsed.User.Username() == "boombignose" {
					t.Fatal("service database connection is not an authenticated non-superuser role")
				}
			}
			if parsed.Hostname() != "" && parsed.Hostname() != "127.0.0.1" {
				t.Fatalf("url host = %s", parsed.Hostname())
			}
		}
	}
	auth := strings.Join(groups[0], "\n")
	if !strings.Contains(auth, "GOTRUE_API_HOST=127.0.0.1") || !strings.Contains(auth, "GOTRUE_JWT_SECRET="+secret) || !strings.Contains(auth, "GOTRUE_SITE_URL=http://127.0.0.1:3100") {
		t.Fatal("explicit Auth process configuration missing")
	}
	rest := strings.Join(groups[1], "\n")
	if !strings.Contains(rest, "PGRST_SERVER_HOST=127.0.0.1") || !strings.Contains(rest, "PGRST_JWT_SECRET="+secret) {
		t.Fatal("explicit PostgREST process configuration missing")
	}
	if localAPIListenAddr() != "127.0.0.1:"+apiPort() {
		t.Fatal(localAPIListenAddr())
	}
}

func TestCopiedProcessEnvDropsSecrets(t *testing.T) {
	t.Setenv("HOME", "/tmp/boombignose-home")
	t.Setenv("PGPASSWORD", "default-password")
	t.Setenv("DATABASE_URL", "postgres://boombignose:default-password@0.0.0.0/boombignose")
	t.Setenv("GOTRUE_JWT_SECRET", "compiled-secret")
	got := strings.Join(copiedProcessEnv(), "\n")
	if !strings.Contains(got, "HOME=/tmp/boombignose-home") {
		t.Fatal(got)
	}
	for _, forbidden := range []string{"PGPASSWORD", "DATABASE_URL", "default-password", "compiled-secret", "0.0.0.0"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("copied env contains %s: %s", forbidden, got)
		}
	}
}

func TestWithLocalKeysReplacesThePlaceholder(t *testing.T) {
	dir := t.TempDir()
	keys, err := ensureLocalKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	parent := []string{
		"PATH=/usr/bin",
		"NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-not-a-secret",
	}
	got := strings.Join(withLocalKeys(parent, dir), "\n")
	if strings.Contains(got, "local-anon-not-a-secret") || !strings.Contains(got, "PATH=/usr/bin") {
		t.Fatalf("env = %s", got)
	}
	if !strings.Contains(got, "NEXT_PUBLIC_SUPABASE_ANON_KEY="+keys.anon) {
		t.Fatal("anon key was not installed")
	}
	if !strings.Contains(got, "http://127.0.0.1:54321") {
		t.Fatal("local api url missing")
	}
}

func TestPrefixProxyStripsTheAuthPrefix(t *testing.T) {
	var got string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	u, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := newPrefixProxy("/auth/v1", u)
	req := httptest.NewRequest(http.MethodGet, "http://launcher/auth/v1/health", nil)
	rec := httptest.NewRecorder()
	proxy.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got != "/health" {
		t.Fatalf("upstream path = %s", got)
	}
}
