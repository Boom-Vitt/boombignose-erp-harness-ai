package update

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
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

func TestRelaunchScriptInstallsBundleBesideTheExecutable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script")
	}
	// Not t.TempDir: on macOS that is under /var, which the script refuses.
	dir, err := os.MkdirTemp("/tmp", "relaunch")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	write := func(path, body string, mode os.FileMode) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), mode); err != nil {
			t.Fatal(err)
		}
	}
	// Stand-ins for the macOS-only ditto and open.
	tools := filepath.Join(dir, "tools")
	write(filepath.Join(tools, "ditto"), "#!/bin/sh\nmkdir -p \"$2\" && cp -R \"$1\"/. \"$2\"/\n", 0o755)
	write(filepath.Join(tools, "open"), "#!/bin/sh\n:\n", 0o755)
	root := filepath.Join(dir, "Applications")
	app := filepath.Join(root, "BoomBigNose.app", "Contents", "MacOS")
	write(filepath.Join(app, "BoomBigNose"), "old", 0o755)
	write(filepath.Join(app, "bundle", "node"), "old", 0o755)
	write(filepath.Join(root, "bundle", "keep"), "legacy sibling", 0o644)
	newApp := filepath.Join(dir, "payload", "BoomBigNose.app")
	write(filepath.Join(newApp, "Contents", "MacOS", "BoomBigNose"), "new", 0o755)
	newBundle := filepath.Join(dir, "payload", "bundle")
	write(filepath.Join(newBundle, "node"), "new", 0o755)
	script := filepath.Join(dir, "relaunch.sh")
	write(script, RelaunchScript, 0o700)
	done := exec.Command("/bin/sh", "-c", "exit 0")
	if err := done.Run(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("/bin/sh", script, strconv.Itoa(done.Process.Pid), newApp, newBundle, root)
	cmd.Env = append(os.Environ(), "PATH="+tools+":"+os.Getenv("PATH"))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("script: %v %s", err, out)
	}
	// The new bundle lands where the desktop reads it: Dir(exe)/bundle.
	got, err := os.ReadFile(filepath.Join(app, "bundle", "node"))
	if err != nil || string(got) != "new" {
		t.Fatalf("bundle not installed beside the executable: %q %v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(app, "BoomBigNose")); err != nil || string(got) != "new" {
		t.Fatalf("app not replaced: %q %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(root, "bundle", "node")); err == nil {
		t.Fatal("script wrote $root/bundle")
	}
	if _, err := os.Stat(filepath.Join(root, "bundle", "keep")); err != nil {
		t.Fatal("script touched a sibling bundle it did not create")
	}
}
