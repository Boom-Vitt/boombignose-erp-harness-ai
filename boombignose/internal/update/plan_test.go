package update

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSumsURLAndVersionOrder(t *testing.T) {
	got, err := SumsURL("1.4.0")
	if err != nil || got != "https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/download/boombignose-v1.4.0/SHA256SUMS" {
		t.Fatalf("sums url: %s %v", got, err)
	}
	if _, err := SumsURL("1.4.0/evil"); err == nil {
		t.Fatal("path version was accepted")
	}
	if !Newer("1.4.1", "1.4.0") || Newer("1.4.0", "1.4.0") || Newer("1.3.9", "1.4.0") {
		t.Fatal("version order")
	}
}

func TestParseSums(t *testing.T) {
	text := "" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  BoomBigNose-windows-x64-setup.exe\n" +
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *" + MacOSAsset + "\n"
	got, err := ParseSums(text, MacOSAsset)
	if err != nil || got != strings.Repeat("b", 64) {
		t.Fatalf("parse: %s %v", got, err)
	}
	if _, err := ParseSums(text+"\nnot a hash\n", MacOSAsset); err == nil {
		t.Fatal("malformed sums accepted")
	}
	clash := strings.Repeat("c", 64) + "  " + MacOSAsset + "\n" + strings.Repeat("d", 64) + "  " + MacOSAsset + "\n"
	if _, err := ParseSums(clash, MacOSAsset); err == nil {
		t.Fatal("conflicting hash accepted")
	}
}

func TestParseMountPoint(t *testing.T) {
	plist := []byte(`<key>mount-point</key><string>/Volumes/BoomBigNose</string>`)
	got, err := ParseMountPoint(plist)
	if err != nil || got != "/Volumes/BoomBigNose" {
		t.Fatalf("mount: %s %v", got, err)
	}
	if _, err := ParseMountPoint([]byte(`<key>mount-point</key><string>/tmp/BoomBigNose</string>`)); err == nil {
		t.Fatal("non-volume mount accepted")
	}
}

func TestInstallRootFrom(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix install paths")
	}
	root, err := InstallRootFrom("/Applications/BoomBigNose.app/Contents/MacOS/BoomBigNose")
	if err != nil || root != "/Applications" {
		t.Fatalf("app root: %s %v", root, err)
	}
	root, err = InstallRootFrom("/Users/me/BoomBigNose")
	if err != nil || root != "/Users/me" {
		t.Fatalf("binary root: %s %v", root, err)
	}
	if _, err := InstallRootFrom("/BoomBigNose"); err == nil {
		t.Fatal("filesystem root accepted")
	}
	if _, err := InstallRootFrom("/usr/local/bin/BoomBigNose"); err == nil {
		t.Fatal("usr prefix accepted")
	}
}

func TestRelaunchScriptRejectsTheFilesystemRoot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script")
	}
	file := filepath.Join(t.TempDir(), "relaunch.sh")
	if err := os.WriteFile(file, []byte(RelaunchScript), 0o700); err != nil {
		t.Fatal(err)
	}
	syntax := exec.Command("/bin/sh", "-n", file)
	if err := syntax.Run(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("/bin/sh", file, "1", "/tmp/BoomBigNose.app", "/tmp/bundle", "/")
	err := cmd.Run()
	if err == nil {
		t.Fatal("root was not refused")
	}
	if !strings.Contains(RelaunchScript, `open "$root/BoomBigNose.app"`) || strings.Contains(RelaunchScript, "PG_VERSION") {
		t.Fatal("script contract")
	}
}
