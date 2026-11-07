package bundle

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func isolatedPorts(t *testing.T) {
	t.Helper()
	for key, value := range map[string]string{"BOOMBIGNOSE_ERP_URL": "http://127.0.0.1:3100", "BOOMBIGNOSE_API_PORT": "55421", "BOOMBIGNOSE_AUTH_PORT": "55423", "BOOMBIGNOSE_REST_PORT": "55424", "BOOMBIGNOSE_PG_PORT": "55429", "BOOMBIGNOSE_PUBLIC_ORIGIN": "", "BOOMBIGNOSE_ALLOW_SIGNUP": ""} {
		t.Setenv(key, value)
	}
}
func TestRuntimeRejectsInvalidOrOverlappingPorts(t *testing.T) {
	isolatedPorts(t)
	for _, value := range []string{"0", "65536", "-1", "3100", " 55421", "055421", "55423", "no"} {
		t.Setenv("BOOMBIGNOSE_API_PORT", value)
		if _, err := ValidateConfig("http://127.0.0.1:3100"); err == nil {
			t.Errorf("accepted invalid or duplicate port %q", value)
		}
	}
}
func TestRuntimeKeepsPublicAndPrivateOriginsSeparate(t *testing.T) {
	isolatedPorts(t)
	t.Setenv("BOOMBIGNOSE_PUBLIC_ORIGIN", "https://erp.example.test")
	layout := Layout{Node: "/opt/bundle/node", Server: "/opt/bundle/erp/server.js"}
	command, err := ERPCommand(layout, "http://127.0.0.1:55400", []string{"BOOMBIGNOSE_NATIVE=1", "BOOMBIGNOSE_FILES_ROOT=/private/erp/attachments", "GOTRUE_SITE_URL=https://untrusted.example", "NEXT_PUBLIC_APP_URL=https://untrusted.example"})
	if err != nil {
		t.Fatal(err)
	}
	env := make(map[string]string)
	for _, item := range command.Env {
		key, value, _ := strings.Cut(item, "=")
		env[key] = value
	}
	for key, want := range map[string]string{"HOST": "127.0.0.1", "HOSTNAME": "127.0.0.1", "PORT": "55400", "NEXT_PUBLIC_APP_URL": "https://erp.example.test", "BOOMBIGNOSE_LOCAL_ORIGIN": "http://127.0.0.1:55400", "BOOMBIGNOSE_NATIVE": "1", "BOOMBIGNOSE_FILES_ROOT": "/private/erp/attachments", "OLLAMA_NO_CLOUD": "1"} {
		if env[key] != want {
			t.Errorf("%s does not follow native boundary", key)
		}
	}
	if env["GOTRUE_SITE_URL"] != "" {
		t.Fatal("inherited arbitrary Auth setting")
	}
	auth := strings.Join(authProcessEnv("/private/migrations", "test-secret"), "\n")
	for _, want := range []string{"GOTRUE_API_HOST=127.0.0.1", "GOTRUE_API_PORT=55423", "GOTRUE_SITE_URL=https://erp.example.test", "GOTRUE_URI_ALLOW_LIST=https://erp.example.test/auth/confirm", "GOTRUE_DISABLE_SIGNUP=true", "GOTRUE_JWT_AUD=authenticated", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated"} {
		if !strings.Contains(auth, want) {
			t.Errorf("missing explicit Auth policy %s", want)
		}
	}
	t.Setenv("BOOMBIGNOSE_ALLOW_SIGNUP", "1")
	cfg, err := ValidateConfig("http://127.0.0.1:55400")
	if err != nil || cfg.SignupAllowed() {
		t.Fatal("public open signup accepted")
	}
}
func TestPublicOriginRefusesRedirectConfusion(t *testing.T) {
	for _, value := range []string{"http://erp.example", "https://user:secret@erp.example", "https://erp.example/", "https://erp.example/path", "https://erp.example?next=x", "https://erp.example#fragment", "https://erp.example#", "https://erp.example:", "https://erp.example:65536", " https://erp.example", "https://erp.example\\evil", "https://*.example", "https://erp..example"} {
		if _, err := PublicOrigin(value); err == nil {
			t.Error("accepted ambiguous public origin")
		}
	}
}
func TestPublicOriginPersistsWithoutShellInheritance(t *testing.T) {
	isolatedPorts(t)
	data := filepath.Join(t.TempDir(), "pg")
	t.Setenv("BOOMBIGNOSE_DATA", data)
	if err := ConfigurePublicOrigin(data, "https://private.example.test"); err != nil {
		t.Fatal(err)
	}
	if err := LoadRuntimeConfig(); err != nil {
		t.Fatal(err)
	}
	cfg, err := ValidateConfig("http://127.0.0.1:55400")
	if err != nil || cfg.AppOrigin() != "https://private.example.test" {
		t.Fatal("persisted origin not loaded")
	}
	if err := ConfigurePublicOrigin(data, "off"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BOOMBIGNOSE_PUBLIC_ORIGIN", "")
	if err := LoadRuntimeConfig(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("BOOMBIGNOSE_PUBLIC_ORIGIN") != "" {
		t.Fatal("public origin not disabled")
	}
}
func TestForeignListenerIsNotAdoptedOrStopped(t *testing.T) {
	isolatedPorts(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	t.Setenv("BOOMBIGNOSE_API_PORT", port)
	err = StartStack(context.Background(), Layout{}, filepath.Join(t.TempDir(), "pg"), "http://127.0.0.1:55400", nil, nil)
	if err == nil {
		t.Fatal("foreign API listener was adopted")
	}
	conn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatal("foreign listener disturbed")
	}
	conn.Close()
}
func TestPrivateCredentialsAreRandomStableAndNotInArguments(t *testing.T) {
	data := filepath.Join(t.TempDir(), "pg")
	first, err := loadDBCredentials(data, true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadDBCredentials(data, false)
	if err != nil || first != second {
		t.Fatal("credentials did not persist")
	}
	other, err := loadDBCredentials(filepath.Join(t.TempDir(), "pg"), true)
	if err != nil {
		t.Fatal(err)
	}
	if first.admin == first.auth || first.auth == first.rest || first.admin == other.admin {
		t.Fatal("role/cluster credentials were reused")
	}
	args := strings.Join(initdbArgs(runtime.GOOS, data), " ")
	for _, secret := range []string{first.admin, first.auth, first.rest} {
		if strings.Contains(args, secret) {
			t.Fatal("credential in initdb arguments")
		}
	}
	var log bytes.Buffer
	output := &privateLog{out: &log, secrets: []string{first.auth}}
	output.Write([]byte("failed postgres://user:" + first.auth[:20]))
	output.Write([]byte(first.auth[20:] + "@127.0.0.1\n"))
	if strings.Contains(log.String(), first.auth) || !strings.Contains(log.String(), "[redacted]") {
		t.Fatal("split service log leaked credential")
	}
}
func TestCredentialSymlinkIsRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink privilege depends on runner")
	}
	data := filepath.Join(t.TempDir(), "pg")
	if _, err := loadDBCredentials(data, true); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "other")
	if err := os.WriteFile(target, []byte(strings.Repeat("a", 64)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(passwordPath(data)); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, passwordPath(data)); err != nil {
		t.Fatal(err)
	}
	if _, err := loadDBCredentials(data, false); err == nil {
		t.Fatal("symlink accepted as credential")
	}
}
func TestLegacyClusterRequiresExplicitMigration(t *testing.T) {
	layout, data := postgresFixture(t)
	if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	os.Remove(secureClusterMarker(data))
	err := ensurePostgres(context.Background(), layout, data, func() bool { return false }, func(Command) error { t.Fatal("legacy cluster was modified"); return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "secure-db") {
		t.Fatal("legacy trust cluster not gated")
	}
}
func TestLegacyHBAMigrationPreservesRulesAndRejectsCustomPolicy(t *testing.T) {
	input := []byte("# owned initdb policy\nlocal all all trust\nhost all all 127.0.0.1/32 trust # loopback\nhost replication all ::1/128 trust\n")
	result, err := secureHBA(input)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(result), "trust") || !strings.Contains(string(result), "# loopback") {
		t.Fatal("HBA migration did not preserve policy/comment")
	}
	for _, policy := range []string{"host all all 0.0.0.0/0 trust\n", "include custom.conf\n", "host all all 127.0.0.1/32 md5\n"} {
		if _, err := secureHBA([]byte(policy)); err == nil {
			t.Fatal("custom HBA overwritten")
		}
	}
}
func TestStaleOrForgedPIDDoesNotKillProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep fixture")
	}
	command := exec.Command("sleep", "30")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { command.Process.Kill(); command.Wait() }()
	dir := t.TempDir()
	body, _ := json.Marshal(processRecord{PID: command.Process.Pid, Identity: "wrong-birth-time"})
	if err := writeDataFile(dir, "erp.pid", body); err != nil {
		t.Fatal(err)
	}
	stopPID(dir)
	if !processAlive(command.Process.Pid) {
		t.Fatal("unrelated PID killed")
	}
}

func TestNativeOperatorsRequirePrivateConfiguration(t *testing.T) {
	isolatedPorts(t)
	data := filepath.Join(t.TempDir(), "pg")
	allowed := "e4a4a088-34a2-4cd7-9c96-2f45920885c1"
	injected := "93f2de16-e9cb-4f7d-9b7e-6c4abc225bc3"
	parent := []string{"BOOMBIGNOSE_NATIVE=1", "BOOMBIGNOSE_DATA=" + data, "BOOMBIGNOSE_OPERATOR_USER_IDS=" + injected}
	operatorValue := func() string {
		t.Helper()
		env, err := ChildEnv(parent, "55400")
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range env {
			if value, ok := strings.CutPrefix(entry, "BOOMBIGNOSE_OPERATOR_USER_IDS="); ok {
				return value
			}
		}
		return ""
	}
	if operatorValue() != "" {
		t.Fatal("inherited operator authority accepted")
	}
	if err := ConfigureOperators(data, []string{allowed}); err != nil {
		t.Fatal(err)
	}
	if err := ConfigurePublicOrigin(data, "https://erp.example.test"); err != nil {
		t.Fatal(err)
	}
	if operatorValue() != allowed {
		t.Fatal("OS operator policy was not preserved and forwarded")
	}
	if err := ConfigureOperators(data, nil); err != nil {
		t.Fatal(err)
	}
	if operatorValue() != "" {
		t.Fatal("operator authority not revoked")
	}
	cfg, err := readPersistedRuntime(data)
	if err != nil || cfg.PublicOrigin != "https://erp.example.test" {
		t.Fatal("operator update lost public-origin policy")
	}
	if err := ConfigureOperators(data, []string{"not-a-user-uuid"}); err == nil {
		t.Fatal("invalid operator identifier accepted")
	}
}

func TestCanonicalNativePathResolvesExistingAncestors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink fixture privilege")
	}
	root := t.TempDir()
	actual := filepath.Join(root, "actual")
	if err := os.Mkdir(actual, 0o700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(actual, alias); err != nil {
		t.Fatal(err)
	}
	got, err := canonicalPath(filepath.Join(alias, "new", "pg"))
	if err != nil {
		t.Fatal(err)
	}
	canonicalActual, err := filepath.EvalSymlinks(actual)
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join(canonicalActual, "new", "pg") {
		t.Fatal("native missing-leaf profile was not canonicalized")
	}
}
