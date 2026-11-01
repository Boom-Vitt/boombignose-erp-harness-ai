// Package bundle starts a portable local stack from files beside the desktop
// binary. It does not download Node, Postgres, or Ollama, and it does not call
// Docker. PullModel downloads an allowlisted model only when a caller asks. A missing
// optional file is skipped. A cloud credential is not passed to the child.
package bundle

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/launch"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
)

const (
	// DefaultOllamaListen is the loopback address used when OLLAMA_HOST is empty.
	DefaultOllamaListen = "127.0.0.1:11434"
	// LocalModel is the text model the ERP screens call. The window does not pull it at startup.
	LocalModel = "qwen3:4b"
)

// ErrIncomplete means the bundle has no portable Node and ERP server.
var ErrIncomplete = errors.New("portable bundle is incomplete")

// ErrNoOllama means neither the bundle nor PATH has an ollama binary.
var ErrNoOllama = errors.New("ollama binary not found")

// Command is a local process with an explicit environment.
type Command struct {
	Name string
	Args []string
	Dir  string
	Env  []string
}

// Layout is the portable tree. Postgres and Ollama may be empty.
type Layout struct {
	Root      string
	Node      string
	Server    string
	Postgres  string
	Ollama    string
	Auth      string
	PostgREST string
}

// Valid reports whether root contains the portable Node binary and ERP server.
func Valid(root string) bool {
	layout, err := Discover(root)
	return err == nil && layout.Node != "" && layout.Server != ""
}

// Discover reads the portable tree. Node and server.js are required.
// Postgres and Ollama are recorded only when their files exist.
func Discover(root string) (Layout, error) {
	if strings.TrimSpace(root) == "" {
		return Layout{}, ErrIncomplete
	}
	layout := Layout{Root: root}
	node := filepath.Join(root, exeName("node"))
	server := filepath.Join(root, "erp", "server.js")
	if _, err := os.Stat(node); err != nil {
		return Layout{}, ErrIncomplete
	}
	if _, err := os.Stat(server); err != nil {
		return Layout{}, ErrIncomplete
	}
	layout.Node = node
	layout.Server = server
	postgres := filepath.Join(root, "postgres", "bin", exeName("postgres"))
	if _, err := os.Stat(postgres); err == nil {
		layout.Postgres = postgres
	}
	if ollama := findOllama(root); ollama != "" {
		layout.Ollama = ollama
	}
	auth := filepath.Join(root, "auth", exeName("auth"))
	if _, err := os.Stat(auth); err == nil {
		layout.Auth = auth
	}
	postgrest := filepath.Join(root, "postgrest", exeName("postgrest"))
	if _, err := os.Stat(postgrest); err == nil {
		layout.PostgREST = postgrest
	}
	return layout, nil
}

func exeName(base string) string {
	if runtime.GOOS == "windows" {
		return base + ".exe"
	}
	return base
}

// findOllama accepts the flat tree (bundle/ollama/ollama) and the upstream
// Linux tree (bundle/ollama/bin/ollama). The second form keeps lib/ollama
// beside bin/, which is where the Linux binary looks.
func findOllama(root string) string {
	candidates := []string{
		filepath.Join(root, "ollama", exeName("ollama")),
		filepath.Join(root, "ollama", "bin", exeName("ollama")),
	}
	for _, path := range candidates {
		info, err := os.Stat(path)
		if err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

// ERPCommand runs the bundled Node on server.js. The name is the bundled
// binary, not a PATH lookup. Postgres is not started.
func ERPCommand(layout Layout, rawURL string, parent []string) (Command, error) {
	if err := policy.AllowEndpoint(rawURL); err != nil {
		return Command{}, err
	}
	if layout.Node == "" || layout.Server == "" {
		return Command{}, ErrIncomplete
	}
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Port() == "" {
		return Command{}, errors.New("erp url needs a port")
	}
	env, err := ChildEnv(parent, u.Port())
	if err != nil {
		return Command{}, err
	}
	return Command{
		Name: layout.Node,
		Args: []string{layout.Server},
		Dir:  filepath.Dir(layout.Server),
		Env:  env,
	}, nil
}

// ChildEnv keeps the process paths, local Supabase values, and a loopback
// Ollama host. Cloud model keys are dropped. A non-loopback Supabase, n8n,
// or Ollama value is an error that does not include the value.
func ChildEnv(parent []string, port string) ([]string, error) {
	port = strings.TrimSpace(port)
	if port == "" {
		return nil, errors.New("port required")
	}
	drop := map[string]bool{
		"OPENROUTER_API_KEY": true,
		"OPENROUTER_MODEL":   true,
		"OPENAI_API_KEY":     true,
		"ANTHROPIC_API_KEY":  true,
		"RESEND_API_KEY":     true,
	}
	keep := map[string]bool{
		"PATH": true, "HOME": true, "TMPDIR": true, "LANG": true,
		"SystemRoot": true, "USERPROFILE": true, "APPDATA": true, "LOCALAPPDATA": true,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY": true,
		"SUPABASE_SERVICE_ROLE_KEY":     true,
	}
	vals := map[string]string{}
	for _, item := range parent {
		key, value, ok := strings.Cut(item, "=")
		if !ok || drop[key] {
			continue
		}
		switch key {
		case "NEXT_PUBLIC_SUPABASE_URL", "N8N_OUTBOUND_URL", "BOOMBIGNOSE_ERP_URL":
			if err := policy.AllowEndpoint(value); err != nil {
				return nil, fmt.Errorf("%s: %w", key, policy.ErrNotLocal)
			}
			if strings.TrimSpace(value) != "" {
				vals[key] = value
			}
		case "OLLAMA_HOST":
			if err := policy.AllowService(value); err != nil {
				return nil, fmt.Errorf("%s: %w", key, policy.ErrNotLocal)
			}
			if strings.TrimSpace(value) != "" {
				vals[key] = strings.TrimSpace(value)
			}
		case "OLLAMA_MODEL":
			if strings.TrimSpace(value) != "" {
				vals[key] = strings.TrimSpace(value)
			}
		case "LOCAL_TOTP_ENROLL":
			if value == "1" {
				vals[key] = "1"
			}
		default:
			if keep[key] && value != "" {
				vals[key] = value
			}
		}
	}
	vals["HOST"] = "127.0.0.1"
	vals["HOSTNAME"] = "127.0.0.1"
	vals["PORT"] = port
	vals["NODE_ENV"] = "production"
	keys := make([]string, 0, len(vals))
	for key := range vals {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+vals[key])
	}
	return env, nil
}

// PullArgs is the default local model pull. Callers must not run it
// from the window start path.
func PullArgs() []string {
	return []string{"pull", LocalModel}
}

// OllamaBinary prefers the bundled binary, then PATH.
func OllamaBinary(layout Layout, pathLookup func(string) (string, error)) (string, error) {
	if layout.Ollama != "" {
		return layout.Ollama, nil
	}
	if pathLookup == nil {
		pathLookup = exec.LookPath
	}
	found, err := pathLookup("ollama")
	if err != nil || found == "" {
		return "", ErrNoOllama
	}
	return found, nil
}

// OllamaServe is `ollama serve` bound to loopback. The error never contains
// a refused host.
func OllamaServe(binary, host string) (Command, error) {
	if strings.TrimSpace(binary) == "" {
		return Command{}, ErrNoOllama
	}
	if err := policy.AllowService(host); err != nil {
		return Command{}, err
	}
	listen := DefaultOllamaListen
	if strings.TrimSpace(host) != "" {
		listen = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(host), "https://"), "http://")
	}
	return Command{
		Name: binary,
		Args: []string{"serve"},
		Env:  []string{"OLLAMA_HOST=" + listen},
	}, nil
}

// PullCommand is `ollama pull qwen3:4b` on loopback. It is not a startup
// command: allowedBundleCommand refuses it. The child env keeps path and
// home values and drops cloud keys.
func PullCommand(binary, host string, parent []string) (Command, error) {
	return PullCommandFor(binary, host, parent, LocalModel)
}

// PullCommandFor builds an allowlisted pull. A catalog model this OS cannot
// run returns ErrModelUnavailable. Any other name returns ErrModelRefused.
// Neither error includes a remote host.
func PullCommandFor(binary, host string, parent []string, model string) (Command, error) {
	if strings.TrimSpace(binary) == "" {
		return Command{}, ErrNoOllama
	}
	if !filepath.IsAbs(binary) {
		return Command{}, ErrModelRefused
	}
	if !PullAllowed(model, runtime.GOOS, runtime.GOARCH) {
		if KnownModel(model) {
			return Command{}, ErrModelUnavailable
		}
		return Command{}, ErrModelRefused
	}
	listen, err := ollamaListen(host)
	if err != nil {
		return Command{}, err
	}
	return Command{
		Name: binary,
		Args: []string{"pull", model},
		Env:  pullEnv(parent, listen),
	}, nil
}

func ollamaListen(host string) (string, error) {
	if err := policy.AllowService(host); err != nil {
		return "", err
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return DefaultOllamaListen, nil
	}
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	return host, nil
}

func pullEnv(parent []string, listen string) []string {
	keep := map[string]bool{
		"PATH": true, "HOME": true, "TMPDIR": true, "LANG": true,
		"TEMP": true, "TMP": true, "SystemRoot": true,
		"USERPROFILE": true, "APPDATA": true, "LOCALAPPDATA": true,
	}
	vals := map[string]string{}
	for _, item := range parent {
		key, value, ok := strings.Cut(item, "=")
		if !ok || value == "" || !keep[key] {
			continue
		}
		vals[key] = value
	}
	vals["OLLAMA_HOST"] = listen
	keys := make([]string, 0, len(vals))
	for key := range vals {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+vals[key])
	}
	return env
}

// allowPullCommand is the only gate for the model download. It is separate
// from allowedBundleCommand so startup still cannot pull.
func allowPullCommand(cmd Command) error {
	if !filepath.IsAbs(cmd.Name) || strings.ContainsAny(cmd.Name, "\x00\r\n") {
		return errors.New("refusing model pull")
	}
	base := strings.ToLower(filepath.Base(cmd.Name))
	if base != "ollama" && base != "ollama.exe" {
		return errors.New("refusing model pull")
	}
	if len(cmd.Args) != 2 || cmd.Args[0] != "pull" || !PullAllowed(cmd.Args[1], runtime.GOOS, runtime.GOARCH) {
		return errors.New("refusing model pull")
	}
	host := ""
	for _, item := range cmd.Env {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			return errors.New("refusing model pull")
		}
		upper := strings.ToUpper(key)
		if strings.Contains(upper, "OPENAI") || strings.Contains(upper, "ANTHROPIC") || strings.Contains(upper, "OPENROUTER") || strings.Contains(upper, "RESEND") {
			return errors.New("refusing model pull")
		}
		if key == "OLLAMA_HOST" {
			if host != "" {
				return errors.New("refusing model pull")
			}
			host = value
		}
	}
	if strings.TrimSpace(host) == "" {
		return errors.New("refusing model pull")
	}
	if err := policy.AllowService(host); err != nil {
		return errors.New("refusing model pull")
	}
	info, err := os.Stat(cmd.Name)
	if err != nil || info.IsDir() {
		return errors.New("refusing model pull")
	}
	return nil
}

func runPull(ctx context.Context, cmd Command) error {
	if err := allowPullCommand(cmd); err != nil {
		return err
	}
	// #nosec G204 -- allowPullCommand allows only the absolute ollama binary and an allowlisted pull name
	proc := exec.CommandContext(ctx, cmd.Name, cmd.Args...)
	proc.Env = cmd.Env
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	return proc.Run()
}

// PullModel downloads qwen3:4b through the local ollama binary. Call it from
// an explicit command or button. Do not call it from startup.
func PullModel(ctx context.Context, layout Layout, host string, parent []string) error {
	return PullNamedModel(ctx, layout, host, parent, LocalModel)
}

// PullNamedModel downloads one allowlisted model. The name is checked before
// the binary is looked up, so a refused name does not start a process.
func PullNamedModel(ctx context.Context, layout Layout, host string, parent []string, model string) error {
	if !PullAllowed(model, runtime.GOOS, runtime.GOARCH) {
		if KnownModel(model) {
			return ErrModelUnavailable
		}
		return ErrModelRefused
	}
	binary, err := OllamaBinary(layout, exec.LookPath)
	if err != nil {
		return err
	}
	if !filepath.IsAbs(binary) {
		abs, absErr := filepath.Abs(binary)
		if absErr != nil || !filepath.IsAbs(abs) {
			return ErrNoOllama
		}
		binary = abs
	}
	cmd, err := PullCommandFor(binary, host, parent, model)
	if err != nil {
		return err
	}
	return runPull(ctx, cmd)
}

// Runner starts a command. The wait function blocks until the process exits.
type Runner func(Command) (wait func() error, kill func(), err error)

// allowedBundleCommand limits the process to the bundled node server or
// `ollama serve`. Anything else never reaches exec.
func allowedBundleCommand(cmd Command) error {
	if !filepath.IsAbs(cmd.Name) || strings.ContainsAny(cmd.Name, "\x00\r\n") {
		return errors.New("refusing bundle command")
	}
	base := strings.ToLower(filepath.Base(cmd.Name))
	switch base {
	case "node", "node.exe":
		if len(cmd.Args) != 1 || filepath.Base(cmd.Args[0]) != "server.js" || strings.Contains(cmd.Args[0], "..") || strings.ContainsAny(cmd.Args[0], "\x00\r\n") {
			return errors.New("refusing bundle command")
		}
	case "ollama", "ollama.exe":
		if len(cmd.Args) != 1 || cmd.Args[0] != "serve" {
			return errors.New("refusing bundle command")
		}
	default:
		return errors.New("refusing bundle command")
	}
	info, err := os.Stat(cmd.Name)
	if err != nil || info.IsDir() {
		return errors.New("refusing bundle command")
	}
	return nil
}

func defaultRunner(cmd Command) (func() error, func(), error) {
	if err := allowedBundleCommand(cmd); err != nil {
		return nil, nil, err
	}
	// #nosec G204 -- allowedBundleCommand allows only the absolute node or ollama binary and its fixed arguments
	proc := exec.Command(cmd.Name, cmd.Args...)
	if cmd.Dir != "" {
		proc.Dir = cmd.Dir
	}
	proc.Env = cmd.Env
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	if err := proc.Start(); err != nil {
		return nil, nil, err
	}
	if recordERP && erpPIDDir != "" && proc.Process != nil {
		_ = writePID(erpPIDDir, proc.Process.Pid)
	}
	return proc.Wait, func() {
		if proc.Process != nil {
			_ = proc.Process.Kill()
		}
	}, nil
}

// EnsureERP starts the bundled server when the ERP port is closed.
// It does not start Postgres and it does not pull a model.
func EnsureERP(ctx context.Context, layout Layout, rawURL string, parent []string, run Runner) error {
	up, err := launch.Listening(rawURL)
	if err != nil {
		return err
	}
	if up {
		ok, err := launch.Ready(ctx, rawURL)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
		return launch.Busy(rawURL)
	}
	cmd, err := ERPCommand(layout, rawURL, parent)
	if err != nil {
		return err
	}
	if run == nil {
		run = defaultRunner
	}
	wait, _, err := run(cmd)
	if err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- wait() }()
	return launch.WaitUntil(ctx, 50*time.Millisecond, func() bool {
		ok, _ := launch.Listening(rawURL)
		return ok
	}, exited)
}

// EnsureOllama starts a local daemon when a binary exists and the port is
// closed. A missing binary is success. The process arguments are only serve.
func EnsureOllama(ctx context.Context, layout Layout, host string, pathLookup func(string) (string, error), run Runner) error {
	binary, err := OllamaBinary(layout, pathLookup)
	if errors.Is(err, ErrNoOllama) {
		return nil
	}
	if err != nil {
		return err
	}
	cmd, err := OllamaServe(binary, host)
	if err != nil {
		return err
	}
	listenURL := "http://" + DefaultOllamaListen
	if len(cmd.Env) == 1 {
		if _, value, ok := strings.Cut(cmd.Env[0], "="); ok && value != "" {
			listenURL = "http://" + value
		}
	}
	up, err := launch.Listening(listenURL)
	if err != nil {
		return err
	}
	if up {
		return nil
	}
	if run == nil {
		run = defaultRunner
	}
	wait, _, err := run(cmd)
	if err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- wait() }()
	return launch.WaitUntil(ctx, 50*time.Millisecond, func() bool {
		ok, _ := launch.Listening(listenURL)
		return ok
	}, exited)
}
