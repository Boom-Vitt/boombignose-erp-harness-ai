package networkcollector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func configBytes(origin string) []byte {
	encoded, _ := json.Marshal(config{ERPURL: origin, DeviceID: "device_123", DeviceToken: strings.Repeat("a", 64)})
	return encoded
}

func TestPermittedOrigins(t *testing.T) {
	for _, origin := range []string{"https://erp.example.test", "https://erp.example.test:8443/", "http://localhost:3101", "http://127.0.0.1:3101", "http://127.2.3.4:3101", "http://[::1]:3101"} {
		cfg, err := parseConfig(configBytes(origin))
		if err != nil || cfg.ERPURL != strings.TrimSuffix(origin, "/") {
			t.Fatal("permitted bare origin was rejected")
		}
	}
}

func TestUnsafeOrigins(t *testing.T) {
	for _, origin := range []string{
		"http://erp.example.test", "http://192.168.1.2", "http://localhost.evil.test", "http://127.0.0.1.evil.test",
		"https://user:password@erp.example.test", "https://erp.example.test/?token=secret", "https://erp.example.test/#secret",
		"https://erp.example.test/path", "https://erp.example.test/a/..", "https://erp.example.test:0", "https://erp.example.test:65536",
		"https://erp.example.test\\evil", " https://erp.example.test", "https://erp.example.test\n", "file:///tmp/erp",
		"ftp://erp.example.test", "//erp.example.test", "https://", "https://erp.example.test/@secret", "https://[:::]",
	} {
		if _, err := parseConfig(configBytes(origin)); err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "password") {
			t.Fatal("unsafe origin accepted or echoed in error")
		}
	}
}

func TestMalformedConfig(t *testing.T) {
	for _, raw := range []string{
		"null", "[]", `"secret"`, `{}`, `{"erpUrl":"https://erp.example.test","deviceId":"bad/path","deviceToken":"secret"}`,
		`{"erpUrl":"https://erp.example.test","deviceId":"device_123","deviceToken":"short"}`,
		`{"erpUrl":"https://erp.example.test","deviceId":"device_123","deviceToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\nsecret"}`,
		string(configBytes("https://erp.example.test")) + " trailing secret", strings.Repeat("x", maxConfigBytes+1),
	} {
		if _, err := parseConfig([]byte(raw)); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatal("malformed config accepted or credential echoed")
		}
	}
}

func TestPrivateConfigFile(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native ownership and no-follow validation is macOS-only")
	}
	name := filepath.Join(t.TempDir(), "collector.json")
	for _, mode := range []os.FileMode{0o600, 0o400} {
		if err := os.WriteFile(name, configBytes("https://erp.example.test"), 0o600); err != nil {
			t.Fatal("cannot create private test config")
		}
		if err := os.Chmod(name, mode); err != nil {
			t.Fatal("cannot set private test permissions")
		}
		if _, err := loadConfig(name); err != nil {
			t.Fatal("private owned config rejected")
		}
		_ = os.Chmod(name, 0o600)
	}
	for _, mode := range []os.FileMode{0o644, 0o640, 0o604, 0o660, 0o700, 0o600 | os.ModeSetuid, 0o600 | os.ModeSetgid, 0o600 | os.ModeSticky} {
		if err := os.Chmod(name, mode); err != nil {
			t.Fatal("cannot set test file mode")
		}
		if _, err := loadConfig(name); err == nil {
			t.Fatal("non-private/execute/special file permissions accepted")
		}
	}
	_ = os.Chmod(name, 0o600)
	link := filepath.Join(t.TempDir(), "config-link")
	if err := os.Symlink(name, link); err != nil {
		t.Fatal("cannot create symlink fixture")
	}
	for _, invalid := range []string{link, t.TempDir(), "relative-config.json", name + "-missing"} {
		if _, err := loadConfig(invalid); err == nil {
			t.Fatal("symlink/nonfile/relative/missing config accepted")
		}
	}
	if err := os.WriteFile(name, []byte(strings.Repeat("x", maxConfigBytes+1)), 0o600); err != nil {
		t.Fatal("cannot create oversized test config")
	}
	if _, err := loadConfig(name); err == nil {
		t.Fatal("oversized config accepted")
	}
}

func TestForeignOwnedConfig(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getuid() == 0 {
		t.Skip("requires a nonroot macOS account")
	}
	if file, err := openPrivateConfig("/etc/hosts"); err == nil {
		file.Close()
		t.Fatal("root-owned file accepted for a nonroot collector")
	}
}
