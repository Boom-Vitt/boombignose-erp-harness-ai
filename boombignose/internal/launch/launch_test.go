package launch

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAddr(t *testing.T) {
	got, err := Addr("http://127.0.0.1:3100")
	if err != nil || got != "127.0.0.1:3100" {
		t.Fatalf("addr: %q %v", got, err)
	}
	if _, err := Addr("http://127.0.0.1"); err == nil {
		t.Fatal("url without a port must be refused")
	}
}

func TestListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	up, err := Listening("http://" + ln.Addr().String())
	if err != nil || !up {
		t.Fatalf("expected a listener: %v %v", up, err)
	}
	_ = ln.Close()
	up, err = Listening("http://" + ln.Addr().String())
	if err != nil || up {
		t.Fatalf("closed port: %v %v", up, err)
	}
}

func writeCheckout(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "scripts", "local"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scripts", "local", "stack.mjs"), []byte("// test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "supabase"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "project_id = \"" + ProjectID + "\"\n"
	if err := os.WriteFile(filepath.Join(dir, "supabase", "config.toml"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFindCheckout(t *testing.T) {
	root := t.TempDir()
	writeCheckout(t, root)
	nested := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindCheckout("", []string{nested}); got != root {
		t.Fatalf("walk: %s", got)
	}
	if got := FindCheckout(root, nil); got != root {
		t.Fatalf("explicit: %s", got)
	}
	if got := FindCheckout(t.TempDir(), []string{t.TempDir()}); got != "" {
		t.Fatalf("empty tree returned %s", got)
	}
}

func TestCheckedServeRejectsAnythingButTheStack(t *testing.T) {
	root := t.TempDir()
	writeCheckout(t, root)
	script := filepath.Join(root, "scripts", "local", "stack.mjs")
	good := []string{script, "serve", "--port", "3100"}
	if gotScript, port, err := checkedServe("node", good, root); err != nil || gotScript != script || port != "3100" {
		t.Fatalf("node: %s %s %v", gotScript, port, err)
	}
	nodePath := filepath.Join(root, "node")
	if err := os.WriteFile(nodePath, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := checkedServe(nodePath, good, root); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"bash", "node-extra", filepath.Join(root, "not-node")} {
		if _, _, err := checkedServe(name, good, root); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	bad := [][]string{
		{script, "serve", "--port", "3100;id"},
		{script, "bash", "--port", "3100"},
		{"/tmp/other.mjs", "serve", "--port", "3100"},
		{script, "serve", "--port", "0"},
		{script, "serve", "--port", "65536"},
	}
	for _, args := range bad {
		if _, _, err := checkedServe("node", args, root); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}

func TestServeCommand(t *testing.T) {
	root := t.TempDir()
	writeCheckout(t, root)
	name, args, err := ServeCommand(root, "", "http://127.0.0.1:3100")
	if err != nil {
		t.Fatal(err)
	}
	if name != "node" || len(args) != 4 || args[1] != "serve" || args[3] != "3100" {
		t.Fatalf("command: %s %v", name, args)
	}
	if _, _, err := ServeCommand(t.TempDir(), "node", "http://127.0.0.1:3100"); !errors.Is(err, ErrNotCheckout) {
		t.Fatalf("err: %v", err)
	}
}

func TestWaitUntil(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	n := 0
	err := WaitUntil(ctx, 10*time.Millisecond, func() bool {
		n++
		return n == 2
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	exited <- errors.New("build failed")
	err = WaitUntil(context.Background(), time.Hour, func() bool { return false }, exited)
	if err == nil || !strings.Contains(err.Error(), "build failed") {
		t.Fatal(err)
	}
}

func TestEnsureStartsAndSeesPort(t *testing.T) {
	root := t.TempDir()
	writeCheckout(t, root)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	raw := "http://" + addr
	var gotName string
	err = Ensure(context.Background(), root, "node", raw, func(name string, args []string, dir string) (func() error, func(), error) {
		gotName = name
		if dir != root {
			t.Fatalf("dir %s", dir)
		}
		opened, err := net.Listen("tcp", addr)
		if err != nil {
			return nil, nil, err
		}
		t.Cleanup(func() { _ = opened.Close() })
		return func() error {
			<-context.Background().Done()
			return nil
		}, func() {}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotName != "node" {
		t.Fatalf("started %s", gotName)
	}
}

func TestEnsureSkipsStartWhenListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	called := false
	err = Ensure(context.Background(), "", "node", "http://"+ln.Addr().String(), func(string, []string, string) (func() error, func(), error) {
		called = true
		return func() error { return nil }, func() {}, nil
	})
	if err == nil || called || !strings.Contains(err.Error(), "already in use") || !strings.Contains(err.Error(), ln.Addr().String()) {
		t.Fatalf("err=%v called=%v", err, called)
	}
}

func TestEnsureKeepsAHealthyERP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	called := false
	err := Ensure(context.Background(), "", "node", srv.URL, func(string, []string, string) (func() error, func(), error) {
		called = true
		return func() error { return nil }, func() {}, nil
	})
	if err != nil || called {
		t.Fatalf("err=%v called=%v", err, called)
	}
}

func TestReadyRetriesASlowServer(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if hits < 3 {
			http.Error(w, "compiling", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	ok, err := Ready(context.Background(), srv.URL)
	if err != nil || !ok || hits != 3 {
		t.Fatalf("ok=%v err=%v hits=%d", ok, err, hits)
	}
}

func TestReadyGivesUpOnAForeignServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("<html>not the erp</html>"))
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	start := time.Now()
	ok, err := Ready(ctx, srv.URL)
	if err != nil || ok || time.Since(start) > 2*time.Second {
		t.Fatalf("ok=%v err=%v after %s", ok, err, time.Since(start))
	}
}
