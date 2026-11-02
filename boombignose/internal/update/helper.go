package update

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/bundle"
)

// ErrDeferred means this operating system does not replace the app in place.
var ErrDeferred = errors.New("automatic replace is not available on this operating system")

// Helper is a loopback service the ERP server calls after it has staged a
// disk image. The browser never receives the token.
type Helper struct {
	BaseURL   string
	Token     string
	dir       string
	sums      func(version, file string) (string, error)
	apply     func(ctx context.Context, dmgPath, updatesDir string) error
	mu        sync.Mutex
	quit      func()
	window    Window
	quitDelay time.Duration
	busy      sync.Mutex
	server    *http.Server
}

// Dir is the staging folder beside the Postgres data directory.
func Dir() (string, error) {
	data, err := bundle.DataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(data), "updates"), nil
}

// Start listens on 127.0.0.1 and a random port. The token is 32 random bytes.
func Start(dir string) (*Helper, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	token, err := newToken()
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	helper := &Helper{
		BaseURL:   "http://" + listener.Addr().String(),
		Token:     token,
		dir:       dir,
		quitDelay: 500 * time.Millisecond,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/status", helper.status)
	mux.HandleFunc("/v1/apply", helper.applyRequest)
	mux.HandleFunc("/v1/fullscreen", helper.fullscreen)
	helper.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = helper.server.Serve(listener) }()
	return helper, nil
}

// SetQuit runs after a verified replace has been handed to the relaunch script.
func (h *Helper) SetQuit(fn func()) {
	h.mu.Lock()
	h.quit = fn
	h.mu.Unlock()
}

// Window is the desktop window the version strip toggles. The ERP page cannot
// reach the Wails runtime from a loopback origin, so it asks through the ERP server.
type Window struct {
	IsFullscreen  func() bool
	SetFullscreen func(on bool)
}

// SetWindow wires the fullscreen route. Without it the route answers 404 and the page falls back to the browser API.
func (h *Helper) SetWindow(w Window) {
	h.mu.Lock()
	h.window = w
	h.mu.Unlock()
}

// fullscreen: GET reports {"fullscreen":bool}. POST {"fullscreen":bool} sets it, then reports.
func (h *Helper) fullscreen(w http.ResponseWriter, r *http.Request) {
	if (r.Method != http.MethodGet && r.Method != http.MethodPost) || !h.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	h.mu.Lock()
	win := h.window
	h.mu.Unlock()
	if win.IsFullscreen == nil || win.SetFullscreen == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no window"})
		return
	}
	if r.Method == http.MethodPost {
		var body struct {
			Fullscreen bool `json:"fullscreen"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		win.SetFullscreen(body.Fullscreen)
	}
	_ = json.NewEncoder(w).Encode(map[string]bool{"fullscreen": win.IsFullscreen()})
}

func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func (h *Helper) authorized(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return false
	}
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if len(got) != len(h.Token) || h.Token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(h.Token)) == 1
}

func (h *Helper) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || !h.authorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"apply": canApply(),
	})
}

type applyBody struct {
	Version string `json:"version"`
	File    string `json:"file"`
}

func (h *Helper) applyRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || !h.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.busy.TryLock() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "busy"})
		return
	}
	release := true
	defer func() {
		if release {
			h.busy.Unlock()
		}
	}()
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var body applyBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request"})
		return
	}
	if body.File != MacOSAsset || !Newer(body.Version, AppVersion) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request"})
		return
	}
	full, err := stagedFile(h.dir, body.File)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request"})
		return
	}
	expected, err := h.checksum(r.Context(), body.Version, body.File)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "checksum"})
		return
	}
	actual, err := hashFile(full)
	if err != nil || !sameHash(actual, expected) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "checksum"})
		return
	}
	apply := h.apply
	if apply == nil {
		apply = defaultApply
	}
	if err := apply(r.Context(), full, h.dir); err != nil {
		if errors.Is(err, ErrDeferred) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "deferred"})
			return
		}
		fmt.Fprintf(os.Stderr, "boombignose: update apply failed\n")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "apply"})
		return
	}
	release = false
	h.scheduleQuit()
	writeJSON(w, http.StatusOK, map[string]string{"ok": "restart"})
}

func (h *Helper) scheduleQuit() {
	h.mu.Lock()
	fn := h.quit
	delay := h.quitDelay
	h.mu.Unlock()
	if fn == nil {
		return
	}
	if delay < 0 {
		fn()
		return
	}
	go func() {
		time.Sleep(delay)
		fn()
	}()
}

func (h *Helper) checksum(ctx context.Context, version, file string) (string, error) {
	if h.sums != nil {
		return h.sums(version, file)
	}
	raw, err := SumsURL(version)
	if err != nil {
		return "", err
	}
	body, err := getLimited(ctx, raw, 100_000)
	if err != nil {
		return "", err
	}
	return ParseSums(string(body), file)
}

func stagedFile(dir, name string) (string, error) {
	if name != filepath.Base(name) || strings.Contains(name, "..") {
		return "", errors.New("refusing update file")
	}
	full := filepath.Join(dir, name)
	rel, err := filepath.Rel(filepath.Clean(dir), full)
	if err != nil || rel != name || strings.HasPrefix(rel, "..") {
		return "", errors.New("refusing update file")
	}
	return full, nil
}

func hashFile(path string) (string, error) {
	file, err := openNoFollow(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

func sameHash(actual, expected string) bool {
	if len(actual) != 64 || len(expected) != 64 {
		return false
	}
	a, errA := hex.DecodeString(actual)
	b, errB := hex.DecodeString(expected)
	if errA != nil || errB != nil || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}

func getLimited(ctx context.Context, raw string, limit int64) ([]byte, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || !DownloadHostAllowed(parsed.Hostname()) {
		return nil, errors.New("refusing update address")
	}
	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || req.URL.Scheme != "https" || !DownloadHostAllowed(req.URL.Hostname()) {
				return errors.New("refusing update address")
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "BoomBigNose")
	req.Header.Set("Accept", "text/plain")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("checksum request failed")
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errors.New("checksum request failed")
	}
	return body, nil
}

func writeJSON(w http.ResponseWriter, status int, body map[string]string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
