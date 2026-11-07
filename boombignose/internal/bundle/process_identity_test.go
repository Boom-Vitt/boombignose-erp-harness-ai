//go:build darwin || linux

package bundle

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestOwnedProcessStopsAfterNodeChangesItsTitle(t *testing.T) {
	node := filepath.Join(os.Getenv("BOOMBIGNOSE_NATIVE_TEST_BUNDLE"), "node")
	if _, err := os.Stat(node); err != nil {
		var err error
		node, err = exec.LookPath("node")
		if err != nil {
			t.Skip("real Node runtime is unavailable")
		}
	}
	cmd := exec.Command(node, "-e", `process.stdout.write("ready\n"); process.stdin.once("data", () => { process.title = "bbn-owned-title-changed"; process.stdout.write("changed\n"); }); setInterval(() => {}, 1000);`)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	t.Cleanup(func() { _ = stdin.Close(); _ = cmd.Process.Kill(); <-done })
	lines := make(chan string, 2)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()
	readLine := func(want string) {
		t.Helper()
		select {
		case got := <-lines:
			if got != want {
				t.Fatalf("child state %q, want %q", got, want)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("Node did not reach the requested state")
		}
	}
	readLine("ready")
	dir := t.TempDir()
	if err := writePID(dir, cmd.Process.Pid); err != nil {
		t.Fatal(err)
	}
	if _, err := stdin.Write([]byte("change\n")); err != nil {
		t.Fatal(err)
	}
	readLine("changed")
	stopPID(dir)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("owned Node was left running after its mutable process title changed")
	}
}

func TestOwnedProcessRejectsAChangedLifetimeRecord(t *testing.T) {
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	t.Cleanup(func() { _ = cmd.Process.Kill(); <-done })
	dir := t.TempDir()
	identity, err := processIdentity(cmd.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(processRecord{PID: cmd.Process.Pid, Identity: identity + "-not-this-lifetime"})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeDataFile(dir, "erp.pid", body); err != nil {
		t.Fatal(err)
	}
	stopPID(dir)
	if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("a mismatched lifetime record terminated an unrelated process")
	}
	if err := writePID(dir, cmd.Process.Pid); err != nil {
		t.Fatal(err)
	}
	stopPID(dir)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the correctly owned process was not stopped")
	}
}
