package bundle

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDefaultRoot(t *testing.T) {
	for _, tt := range []struct {
		name       string
		executable string
		want       string
	}{
		{"portable", filepath.Join("opt", "BoomBigNose"), filepath.Join("opt", "bundle")},
		{"not an app", filepath.Join("opt", "portable", "Contents", "MacOS", "BoomBigNose"), filepath.Join("opt", "portable", "Contents", "MacOS", "bundle")},
		{"not MacOS", filepath.Join("opt", "BoomBigNose.app", "Contents", "bin", "BoomBigNose"), filepath.Join("opt", "BoomBigNose.app", "Contents", "bin", "bundle")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := DefaultRoot(tt.executable); got != tt.want {
				t.Fatalf("DefaultRoot(%q) = %q, want %q", tt.executable, got, tt.want)
			}
		})
	}
	executable := filepath.Join(t.TempDir(), "BoomBigNose.app", "Contents", "MacOS", "BoomBigNose")
	want := filepath.Join(filepath.Dir(executable), "bundle")
	if runtime.GOOS == "darwin" {
		want = filepath.Join(filepath.Dir(filepath.Dir(executable)), "Resources", "bundle")
	}
	layout := writeBundle(t, want, true)
	if got := DefaultRoot(executable); got != layout.Root || !Valid(got) {
		t.Fatalf("application bundle lookup = %q, want discoverable %q", got, layout.Root)
	}
}

func writeBundle(t *testing.T, root string, withPostgres bool) Layout {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, "erp"), 0o755); err != nil {
		t.Fatal(err)
	}
	server := filepath.Join(root, "erp", "server.js")
	if err := os.WriteFile(server, []byte("// fixture\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	node := filepath.Join(root, exeName("node"))
	if err := os.WriteFile(node, []byte("not a real runtime"), 0o755); err != nil {
		t.Fatal(err)
	}
	if withPostgres {
		dir := filepath.Join(root, "postgres", "bin")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, exeName("postgres")), []byte("postgres"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	layout, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	return layout
}

func TestAllowedBundleCommandRejectsOtherPrograms(t *testing.T) {
	root := t.TempDir()
	layout := writeBundle(t, root, false)
	cmd, err := ERPCommand(layout, "http://127.0.0.1:3100", []string{"PATH=/usr/bin"})
	if err != nil {
		t.Fatal(err)
	}
	if err := allowedBundleCommand(cmd); err != nil {
		t.Fatal(err)
	}
	ollama := filepath.Join(root, exeName("ollama"))
	if err := os.WriteFile(ollama, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := allowedBundleCommand(Command{Name: ollama, Args: []string{"serve"}}); err != nil {
		t.Fatal(err)
	}
	if err := allowedBundleCommand(Command{Name: ollama, Args: []string{"pull", "qwen2.5:3b"}}); err == nil {
		t.Fatal("pull must be refused")
	}
	if err := allowedBundleCommand(Command{Name: "node", Args: []string{layout.Server}}); err == nil {
		t.Fatal("a PATH lookup must be refused")
	}
	if err := allowedBundleCommand(Command{Name: layout.Node, Args: []string{"-e", "process.exit(0)"}}); err == nil {
		t.Fatal("node eval must be refused")
	}
}

func TestDiscoverRequiresNodeAndServer(t *testing.T) {
	if _, err := Discover(t.TempDir()); err != ErrIncomplete {
		t.Fatalf("empty tree: %v", err)
	}
	root := t.TempDir()
	layout := writeBundle(t, root, false)
	if layout.Node == "" || layout.Server == "" {
		t.Fatalf("layout: %+v", layout)
	}
	if layout.Postgres != "" {
		t.Fatal("postgres file was not part of this fixture")
	}
	if !Valid(root) {
		t.Fatal("expected a valid bundle")
	}
}

func TestDiscoverRecordsPostgresWithoutStartingIt(t *testing.T) {
	root := t.TempDir()
	layout := writeBundle(t, root, true)
	if layout.Postgres == "" {
		t.Fatal("expected the portable postgres path")
	}
	parent := []string{"OPENROUTER_API_KEY=secret-value", "PATH=/usr/bin"}
	cmd, err := ERPCommand(layout, "http://127.0.0.1:3100", parent)
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Name != layout.Node {
		t.Fatalf("command must be the bundled node, got %s", cmd.Name)
	}
	if strings.Contains(cmd.Name, "postgres") {
		t.Fatal("erp command must not be postgres")
	}
	joined := strings.Join(cmd.Args, " ")
	if strings.Contains(joined, "pull") || strings.Contains(cmd.Name, "ollama") {
		t.Fatalf("erp command must not pull a model: %+v", cmd)
	}
	for _, item := range cmd.Env {
		if strings.Contains(item, "OPENROUTER") || strings.Contains(item, "secret-value") {
			t.Fatalf("cloud key leaked into child env: %s", item)
		}
	}
}

func TestChildEnvDropsCloudURLWithoutEchoingIt(t *testing.T) {
	_, err := ChildEnv([]string{"NEXT_PUBLIC_SUPABASE_URL=https://hidden.supabase.co"}, "3100")
	if err == nil {
		t.Fatal("hosted supabase must be refused")
	}
	if strings.Contains(err.Error(), "hidden.supabase.co") || strings.Contains(err.Error(), "https://") {
		t.Fatalf("error leaked the url: %v", err)
	}
}

func TestChildEnvKeepsLocalSupabaseAndPort(t *testing.T) {
	env, err := ChildEnv([]string{
		"NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421",
		"SUPABASE_SERVICE_ROLE_KEY=local-test-role",
		"OPENAI_API_KEY=sk-test",
		"PATH=/usr/bin",
	}, "3100")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(env, "\n")
	if !strings.Contains(text, "PORT=3100") || !strings.Contains(text, "HOST=127.0.0.1") || !strings.Contains(text, "HOSTNAME=127.0.0.1") {
		t.Fatalf("bind env: %s", text)
	}
	if !strings.Contains(text, "http://127.0.0.1:54421") || !strings.Contains(text, "local-test-role") {
		t.Fatalf("local supabase values missing: %s", text)
	}
	if strings.Contains(text, "OPENAI") || strings.Contains(text, "sk-test") {
		t.Fatalf("cloud key leaked: %s", text)
	}
}

func TestChildEnvKeepsLoopbackOllama(t *testing.T) {
	env, err := ChildEnv([]string{"OLLAMA_HOST=127.0.0.1:11434", "OLLAMA_MODEL=qwen2.5:3b"}, "3100")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(env, "\n")
	if !strings.Contains(text, "OLLAMA_HOST=127.0.0.1:11434") || !strings.Contains(text, "OLLAMA_MODEL=qwen2.5:3b") {
		t.Fatalf("ollama env: %s", text)
	}
	_, err = ChildEnv([]string{"OLLAMA_HOST=https://models.example:11434"}, "3100")
	if err == nil || strings.Contains(err.Error(), "models.example") {
		t.Fatalf("remote ollama: %v", err)
	}
}

func TestChildEnvCopiesTotpFlagOnlyWhenEnabled(t *testing.T) {
	env, err := ChildEnv([]string{"LOCAL_TOTP_ENROLL=1"}, "3100")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(env, "\n"), "LOCAL_TOTP_ENROLL=1") {
		t.Fatalf("flag was not copied: %s", strings.Join(env, "\n"))
	}
	closed, err := ChildEnv([]string{"LOCAL_TOTP_ENROLL=true"}, "3100")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(closed, "\n"), "LOCAL_TOTP_ENROLL") {
		t.Fatalf("non-1 flag was copied: %s", strings.Join(closed, "\n"))
	}
}

func TestChildEnvKeepsTheLoopbackUpdateHelper(t *testing.T) {
	token := strings.Repeat("ab", 32)
	data := t.TempDir()
	env, err := ChildEnv([]string{
		"BOOMBIGNOSE_UPDATE_URL=http://127.0.0.1:43123",
		"BOOMBIGNOSE_UPDATE_TOKEN=" + token,
		"BOOMBIGNOSE_DATA=" + data,
		"BOOMBIGNOSE_UPDATE_TOKEN=not-a-token",
	}, "3100")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(env, "\n")
	if !strings.Contains(text, "BOOMBIGNOSE_UPDATE_URL=http://127.0.0.1:43123") || !strings.Contains(text, "BOOMBIGNOSE_UPDATE_TOKEN="+token) {
		t.Fatalf("helper env: %s", text)
	}
	if !strings.Contains(text, "BOOMBIGNOSE_DATA="+data) || strings.Contains(text, "not-a-token") {
		t.Fatalf("data dir: %s", text)
	}
	if _, err := ChildEnv([]string{"BOOMBIGNOSE_UPDATE_URL=https://updates.example"}, "3100"); err == nil || strings.Contains(err.Error(), "updates.example") {
		t.Fatalf("remote helper: %v", err)
	}
}

func TestOllamaServeRefusesRemoteHost(t *testing.T) {
	_, err := OllamaServe("/tmp/ollama", "https://ollama.example")
	if err == nil {
		t.Fatal("remote ollama must be refused")
	}
	if strings.Contains(err.Error(), "ollama.example") {
		t.Fatalf("error leaked the host: %v", err)
	}
	cmd, err := OllamaServe("/opt/ollama", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(cmd.Args) != 1 || cmd.Args[0] != "serve" {
		t.Fatalf("args: %#v", cmd.Args)
	}
	for _, arg := range cmd.Args {
		if arg == "pull" || strings.Contains(arg, LocalModel) {
			t.Fatal("serve must not pull the model")
		}
	}
}

func TestEnsureOllamaSkipsMissingBinary(t *testing.T) {
	called := false
	err := EnsureOllama(context.Background(), Layout{}, "", func(string) (string, error) {
		return "", os.ErrNotExist
	}, func(Command) (func() error, func(), error) {
		called = true
		return func() error { return nil }, func() {}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("missing ollama must not start a process")
	}
}

func TestEnsureERPUsesBundledNode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture runtime is a shell script")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "erp"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "erp", "server.js"), []byte("// fixture\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	nodePath := filepath.Join(root, exeName("node"))
	script := "#!/bin/sh\nexec python3 -c 'import os,socket,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind((\"127.0.0.1\", int(os.environ[\"PORT\"]))); s.listen(1); time.sleep(30)'\n"
	if err := os.WriteFile(nodePath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	layout, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	raw := "http://127.0.0.1:" + strconv.Itoa(port)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var kill func()
	err = EnsureERP(ctx, layout, raw, []string{"OPENROUTER_API_KEY=do-not-pass", "PATH=" + os.Getenv("PATH")}, func(cmd Command) (func() error, func(), error) {
		if cmd.Name != nodePath {
			t.Errorf("name = %s", cmd.Name)
		}
		if strings.Join(cmd.Args, " ") != filepath.Join(root, "erp", "server.js") {
			t.Errorf("args = %#v", cmd.Args)
		}
		for _, item := range cmd.Env {
			if strings.Contains(item, "OPENROUTER") || strings.Contains(item, "do-not-pass") {
				t.Errorf("leaked %s", item)
			}
			if strings.Contains(item, "pull") {
				t.Errorf("pull leaked into env: %s", item)
			}
		}
		wait, stop, startErr := defaultRunner(cmd)
		kill = stop
		return wait, stop, startErr
	})
	if kill != nil {
		kill()
	}
	if err != nil {
		t.Fatal(err)
	}
}

func TestDiscoverFindsOllamaBesideOrUnderBin(t *testing.T) {
	flat := t.TempDir()
	writeBundle(t, flat, false)
	flatBin := filepath.Join(flat, "ollama", exeName("ollama"))
	if err := os.MkdirAll(filepath.Dir(flatBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(flatBin, []byte("ollama"), 0o755); err != nil {
		t.Fatal(err)
	}
	found, err := Discover(flat)
	if err != nil {
		t.Fatal(err)
	}
	if found.Ollama != flatBin {
		t.Fatalf("flat ollama = %s", found.Ollama)
	}

	nested := t.TempDir()
	writeBundle(t, nested, false)
	nestedBin := filepath.Join(nested, "ollama", "bin", exeName("ollama"))
	if err := os.MkdirAll(filepath.Dir(nestedBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nestedBin, []byte("ollama"), 0o755); err != nil {
		t.Fatal(err)
	}
	found, err = Discover(nested)
	if err != nil {
		t.Fatal(err)
	}
	if found.Ollama != nestedBin {
		t.Fatalf("nested ollama = %s", found.Ollama)
	}
}

func TestPullCommandIsNotAStartupCommand(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, exeName("ollama"))
	if err := os.WriteFile(binary, []byte("ollama"), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd, err := PullCommand(binary, "", []string{
		"OPENAI_API_KEY=sk-test",
		"PATH=/usr/bin",
		"HOME=/home/me",
		"OLLAMA_HOST=http://127.0.0.1:11434",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := allowedBundleCommand(cmd); err == nil {
		t.Fatal("startup must refuse pull")
	}
	if err := allowPullCommand(cmd); err != nil {
		t.Fatal(err)
	}
	text := strings.Join(cmd.Env, "\n")
	if strings.Contains(text, "OPENAI") || strings.Contains(text, "sk-test") {
		t.Fatalf("cloud key leaked: %s", text)
	}
	if !strings.Contains(text, "OLLAMA_HOST=127.0.0.1:11434") || !strings.Contains(text, "HOME=/home/me") {
		t.Fatalf("pull env: %s", text)
	}
	_, err = PullCommand(binary, "https://models.example", nil)
	if err == nil || strings.Contains(err.Error(), "models.example") {
		t.Fatalf("remote pull: %v", err)
	}
	other := cmd
	other.Args = []string{"pull", "llama3"}
	if err := allowPullCommand(other); err == nil {
		t.Fatal("another model must be refused")
	}
	if err := runPull(context.Background(), Command{Name: binary, Args: []string{"serve"}, Env: cmd.Env}); err == nil {
		t.Fatal("pull runner must refuse serve")
	}
}
