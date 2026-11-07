package bundle

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestApplyMigrationsOnPortablePostgres(t *testing.T) {
	bundle := os.Getenv("BOOMBIGNOSE_NATIVE_TEST_BUNDLE")
	if bundle == "" {
		t.Skip("set BOOMBIGNOSE_NATIVE_TEST_BUNDLE to a portable PostgreSQL/Auth/PostgREST bundle")
	}
	tree := filepath.Join(bundle, "postgres")
	root := t.TempDir()
	for _, name := range []string{"bin", "lib", "share"} {
		if err := os.Symlink(filepath.Join(tree, name), filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	repo := filepath.Join("..", "..", "..")
	if err := copyFile(filepath.Join(repo, "packaging", "postgres", "prelude-after-auth.sql"), filepath.Join(root, "prelude-after-auth.sql")); err != nil {
		t.Fatal(err)
	}
	migDir := filepath.Join(root, "migrations")
	if err := os.MkdirAll(migDir, 0o755); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(repo, "supabase", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 70 {
		t.Fatalf("migrations = %d", len(entries))
	}
	for _, entry := range entries {
		if entry.IsDir() || !stringsHasSQL(entry.Name()) {
			continue
		}
		if err := copyFile(filepath.Join(repo, "supabase", "migrations", entry.Name()), filepath.Join(migDir, entry.Name())); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.MkdirTemp("/tmp", "bbnpg")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(data); _ = os.RemoveAll(secretsDir(data)) })
	for key, port := range map[string]string{
		"BOOMBIGNOSE_PG_PORT": "54341", "BOOMBIGNOSE_AUTH_PORT": "54342",
		"BOOMBIGNOSE_REST_PORT": "54343", "BOOMBIGNOSE_API_PORT": "54344",
	} {
		ln, err := net.Listen("tcp", "127.0.0.1:"+port)
		if err != nil {
			t.Fatal(err)
		}
		_ = ln.Close()
		t.Setenv(key, port)
	}
	t.Setenv("BOOMBIGNOSE_PUBLIC_ORIGIN", "")
	t.Setenv("BOOMBIGNOSE_ALLOW_SIGNUP", "1")
	layout := Layout{
		Postgres:  filepath.Join(root, "bin", exeName("postgres")),
		Auth:      filepath.Join(bundle, "auth", exeName("auth")),
		PostgREST: filepath.Join(bundle, "postgrest", exeName("postgrest")),
	}
	t.Cleanup(func() { stopExtraPIDs(data); _ = StopPostgres(layout, data) })
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	if err := EnsurePostgres(ctx, layout, data); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(data, "PG_VERSION")); err != nil {
		t.Fatal(err)
	}
	if _, err := queryAuthenticated(ctx, pgAddr(), "boombignose", "postgres", "", "select 1"); err == nil {
		t.Fatal("unauthenticated loopback user reached the private database")
	}
	if _, err := queryAuthenticated(ctx, pgAddr(), "boombignose", "postgres", "incorrect-private-password", "select 1"); err == nil {
		t.Fatal("incorrect password was accepted")
	}
	passwordRows, err := queryPostgres(ctx, pgAddr(), "boombignose", "postgres", "select rolpassword like 'SCRAM-SHA-256$%' from pg_authid where rolname = 'boombignose'")
	if err != nil || len(passwordRows) != 1 || passwordRows[0][0] != "t" {
		t.Fatal("native admin credential was not stored using PostgreSQL SCRAM")
	}
	if err := EnsureAuth(ctx, layout, data); err != nil {
		t.Fatal(err)
	}
	// Reopening migration bookkeeping must not collide with Auth or replay DDL.
	if err := applyMigrations(ctx, layout, pgAddr(), nil); err != nil {
		t.Fatal(err)
	}
	copied := 0
	for _, entry := range entries {
		if !entry.IsDir() && stringsHasSQL(entry.Name()) {
			copied++
		}
	}
	rows, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose", "select count(*)::text from public.erp_schema_migrations")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0][0] != strconv.Itoa(copied) {
		t.Fatalf("applied %v, copied %d", rows, copied)
	}
	rows, err = queryPostgres(ctx, pgAddr(), "boombignose", "boombignose", "select to_regclass('auth.mfa_factors')")
	if err != nil || len(rows) != 1 || len(rows[0]) != 1 || rows[0][0] == "" {
		t.Fatal("real Auth MFA schema was not initialized")
	}
	for _, user := range []string{"boombignose_auth", "boombignose_rest"} {
		rows, err := queryPostgres(ctx, pgAddr(), user, "boombignose", "select rolsuper, rolcreaterole from pg_roles where rolname = current_user")
		if err != nil || len(rows) != 1 || len(rows[0]) != 2 || rows[0][0] != "f" || rows[0][1] != "f" {
			t.Fatal("native service did not authenticate as a restricted database role")
		}
	}
	t.Run("consumer authorization through native gateway", func(t *testing.T) {
		testNativeConsumerAuthorization(t, ctx)
	})
}

func testNativeConsumerAuthorization(t *testing.T, ctx context.Context) {
	t.Helper()
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	baseURL := "http://" + localAPIListenAddr()
	var secrets []string
	diagnostic := func(body []byte) string {
		// Auth responses contain credentials even when an assertion fails.
		// Report only error fields, never complete signup/session responses.
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(body, &fields); err != nil {
			return "non-object response (body omitted)"
		}
		safe := make(map[string]json.RawMessage)
		for _, key := range []string{"code", "error_code", "message", "msg", "error", "error_description", "details", "hint"} {
			if value, ok := fields[key]; ok {
				safe[key] = value
			}
		}
		encoded, _ := json.Marshal(safe)
		text := string(encoded)
		for _, secret := range secrets {
			text = strings.ReplaceAll(text, secret, "[REDACTED]")
		}
		return text
	}
	request := func(method, path, token string, payload any) (int, []byte) {
		t.Helper()
		var body []byte
		if payload != nil {
			var err error
			body, err = json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, baseURL+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		defer resp.Body.Close()
		body, err = io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("%s %s response: %v", method, path, err)
		}
		return resp.StatusCode, body
	}
	type actor struct {
		id, token, workspace, name string
	}
	signIn := func(label string) actor {
		t.Helper()
		password := "Native-fixture-" + uuid.NewString()
		secrets = append(secrets, password)
		credentials := map[string]string{
			"email":    "native-" + uuid.NewString() + "@example.test",
			"password": password,
		}
		status, body := request(http.MethodPost, "/auth/v1/signup", "", credentials)
		if status != http.StatusOK && status != http.StatusCreated {
			t.Fatalf("%s signup: HTTP %d: %s", label, status, diagnostic(body))
		}
		var signup struct {
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		if err := json.Unmarshal(body, &signup); err != nil || signup.User.ID == "" {
			t.Fatalf("%s signup returned no user: HTTP %d: %s", label, status, diagnostic(body))
		}
		if _, err := uuid.Parse(signup.User.ID); err != nil {
			t.Fatalf("%s signup returned an invalid actor ID", label)
		}
		status, body = request(http.MethodPost, "/auth/v1/token?grant_type=password", "", credentials)
		if status != http.StatusOK {
			t.Fatalf("%s password sign-in: HTTP %d: %s", label, status, diagnostic(body))
		}
		var session struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			User         struct {
				ID   string `json:"id"`
				Role string `json:"role"`
			} `json:"user"`
		}
		if err := json.Unmarshal(body, &session); err != nil {
			t.Fatalf("%s password sign-in returned invalid JSON: %s", label, diagnostic(body))
		}
		if session.AccessToken == "" || session.User.ID != signup.User.ID || session.User.Role != "authenticated" {
			t.Fatalf("%s password sign-in did not return the ordinary signup actor: %s", label, diagnostic(body))
		}
		secrets = append(secrets, session.AccessToken)
		if session.RefreshToken != "" {
			secrets = append(secrets, session.RefreshToken)
		}
		return actor{id: session.User.ID, token: session.AccessToken, name: "Native fixture " + label}
	}
	provision := func(who *actor) {
		t.Helper()
		status, body := request(http.MethodPost, "/rest/v1/rpc/provision_workspace", who.token, map[string]string{
			"p_name": who.name,
			"p_key":  uuid.NewString(),
		})
		if status != http.StatusOK {
			t.Fatalf("%s onboarding: HTTP %d: %s", who.name, status, diagnostic(body))
		}
		if err := json.Unmarshal(body, &who.workspace); err != nil || who.workspace == "" {
			t.Fatalf("%s onboarding returned no workspace: HTTP %d: %s", who.name, status, diagnostic(body))
		}
		if _, err := uuid.Parse(who.workspace); err != nil {
			t.Fatalf("%s onboarding returned an invalid workspace ID", who.name)
		}
	}
	assertOwnWorkspace := func(who actor) {
		t.Helper()
		path := "/rest/v1/memberships?select=user_id,org_id,role&user_id=eq." + who.id
		status, body := request(http.MethodGet, path, who.token, nil)
		if status != http.StatusOK {
			t.Fatalf("%s own memberships: HTTP %d: %s", who.name, status, diagnostic(body))
		}
		var memberships []struct {
			UserID string `json:"user_id"`
			OrgID  string `json:"org_id"`
			Role   string `json:"role"`
		}
		if err := json.Unmarshal(body, &memberships); err != nil {
			t.Fatalf("%s memberships returned invalid JSON", who.name)
		}
		if len(memberships) != 1 || memberships[0].UserID != who.id || memberships[0].OrgID != who.workspace || memberships[0].Role != "owner" {
			t.Fatalf("%s memberships did not contain exactly the onboarded owner/workspace", who.name)
		}
		status, body = request(http.MethodGet, "/rest/v1/organizations?select=id,name", who.token, nil)
		if status != http.StatusOK {
			t.Fatalf("%s own organizations: HTTP %d: %s", who.name, status, diagnostic(body))
		}
		var organizations []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(body, &organizations); err != nil {
			t.Fatalf("%s organizations returned invalid JSON", who.name)
		}
		if len(organizations) != 1 || organizations[0].ID != who.workspace || organizations[0].Name != who.name {
			t.Fatalf("%s organizations did not contain exactly the onboarded workspace", who.name)
		}
	}
	first, second := signIn("first owner"), signIn("second owner")
	if first.id == second.id {
		t.Fatal("ordinary Auth signup did not create isolated actors")
	}
	provision(&first)
	assertOwnWorkspace(first)
	status, body := request(http.MethodPost, "/rest/v1/rpc/provision_workspace", second.token, map[string]string{
		"p_name": second.name,
		"p_key":  uuid.NewString(),
	})
	var singletonError struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &singletonError); err != nil || status != http.StatusBadRequest || singletonError.Code != "P0001" || !strings.Contains(singletonError.Message, "already has a workspace") {
		t.Fatalf("Community second workspace was not deliberately denied: HTTP %d: %s", status, diagnostic(body))
	}
	// Community onboarding permits only one workspace per installation. Seed
	// this foreign-workspace negative control only in the fixture's disposable
	// cluster; never replace the RPC, relax its singleton gate, or widen grants.
	second.workspace = uuid.NewString()
	if _, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose",
		"begin; insert into public.organizations(id,name,slug) values('"+second.workspace+"','"+second.name+"','native-fixture-"+second.workspace+"'); "+
			"insert into public.memberships(org_id,user_id,role) values('"+second.workspace+"','"+second.id+"','owner'); "+
			"insert into public.org_settings(org_id) values('"+second.workspace+"'); commit;"); err != nil {
		t.Fatalf("seed disposable foreign workspace: %v", err)
	}
	assertOwnWorkspace(first)
	assertOwnWorkspace(second)
	assertInaccessible := func(label, path, token string, allowEmpty bool) {
		t.Helper()
		status, body := request(http.MethodGet, path, token, nil)
		if allowEmpty && status == http.StatusOK {
			var rows []json.RawMessage
			if err := json.Unmarshal(body, &rows); err == nil && strings.TrimSpace(string(body)) != "null" && len(rows) == 0 {
				return
			}
			t.Fatalf("%s exposed rows or returned an invalid row array", label)
		}
		var denied struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(body, &denied); err != nil || (status != http.StatusForbidden && status != http.StatusUnauthorized) || denied.Code != "42501" {
			t.Fatalf("%s expected empty rows or deliberate permission denial: HTTP %d: %s", label, status, diagnostic(body))
		}
	}
	for _, pair := range [][2]actor{{first, second}, {second, first}} {
		own, foreign := pair[0], pair[1]
		assertInaccessible(own.name+" foreign membership",
			"/rest/v1/memberships?select=user_id,org_id&user_id=eq."+foreign.id+"&org_id=eq."+foreign.workspace,
			own.token, true)
		assertInaccessible(own.name+" foreign organization",
			"/rest/v1/organizations?select=id&id=eq."+foreign.workspace, own.token, true)
	}
	assertInaccessible("anonymous memberships", "/rest/v1/memberships?select=user_id,org_id", "", false)
	status, body = request(http.MethodPost, "/rest/v1/payments", first.token, map[string]any{
		"org_id":        first.workspace,
		"invoice_id":    uuid.NewString(),
		"amount_satang": 100,
	})
	var paymentError struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &paymentError); err != nil || status != http.StatusForbidden || paymentError.Code != "42501" || !strings.Contains(paymentError.Message, "permission denied for table payments") {
		t.Fatalf("direct command-only payment mutation was not denied by table privileges: HTTP %d: %s", status, diagnostic(body))
	}
}

func stringsHasSQL(name string) bool {
	return len(name) > 4 && name[len(name)-4:] == ".sql"
}

func copyFile(src, dst string) error {
	body, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, body, 0o644)
}
