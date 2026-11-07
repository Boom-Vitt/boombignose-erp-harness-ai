// Package localai provides one verified loopback Ollama provider. It neither
// starts services nor installs models, and has no cloud or write fallback.
package localai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/bundle"
)

const DefaultChatModel = "qwen3.5:9b-q4_k_m"
const DefaultOCRModel = "qwen3.5:4b"

// Error contains safe operator-facing text, never a model response or source.
// HTTP callers serialize {error: Message, code: Code} with Status. Context
// cancellation/deadline errors remain identifiable with errors.Is.
type Error struct {
	Status  int
	Code    string
	Message string
	cause   error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.cause }
func problem(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}
func contextError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return &Error{Status: 504, Code: "timeout", Message: "The local operation timed out. History was not discarded and no cloud fallback was used.", cause: err}
	}
	return &Error{Status: 499, Code: "cancelled", Message: "The request was cancelled.", cause: err}
}

type Config struct {
	Origin    string
	ChatModel string
	OCRModel  string
	// Absolute path to the existing boombignose-image CLI. Absence only disables
	// raster-dependent operations, not text chat or provider construction.
	RasterExecutable string
	// Trusted concurrency-safe deterministic/idempotent native secret policy.
	// Per-request credentials use WithRedactor; neither callback is serialized.
	Redact func(string) (string, bool)
}

type Provider struct {
	origin           string
	chatModel        string
	ocrModel         string
	rasterExecutable string
	client           *http.Client
	inference        chan struct{}
	decoders         chan struct{}
	ocrPages         chan struct{}
	redactor         Redactor
}

var modelID = regexp.MustCompile(`^[a-z0-9][a-z0-9._:/-]*$`)

func validModel(id string) bool {
	return len(id) <= 80 && modelID.MatchString(id) && !strings.Contains(id, "..") && !strings.Contains(id, "cloud") && !strings.Contains(id, "://")
}

func NewProvider(c Config) (*Provider, error) {
	raw := strings.TrimSpace(c.Origin)
	if raw == "" {
		raw = "http://127.0.0.1:11434"
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, problem(503, "service_unavailable", "AI requires a credential-free loopback Ollama origin.")
	}
	host := strings.ToLower(u.Hostname())
	if host != "127.0.0.1" && host != "::1" && host != "localhost" {
		return nil, problem(503, "service_unavailable", "Remote and cloud model hosts are not permitted.")
	}
	// Resolve localhost ourselves; neither DNS nor environment proxy configuration
	// can redirect private business messages outside loopback.
	if host == "localhost" {
		if u.Port() == "" {
			u.Host = "127.0.0.1"
		} else {
			u.Host = net.JoinHostPort("127.0.0.1", u.Port())
		}
	}
	c.ChatModel = strings.TrimSpace(c.ChatModel)
	if c.ChatModel == "" {
		c.ChatModel = DefaultChatModel
	}
	c.OCRModel = strings.TrimSpace(c.OCRModel)
	if c.OCRModel == "" {
		c.OCRModel = DefaultOCRModel
	}
	if !validModel(c.ChatModel) {
		return nil, problem(409, "model_not_allowed", "Choose an installed local chat checkpoint.")
	}
	if !validModel(c.OCRModel) || !bundle.PullAllowed(c.OCRModel, runtime.GOOS, runtime.GOARCH) {
		return nil, problem(409, "model_not_allowed", "Choose an allowed local vision model from Settings.")
	}
	if c.RasterExecutable != "" && !filepath.IsAbs(c.RasterExecutable) {
		return nil, problem(503, "service_unavailable", "The raster helper path must be absolute.")
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext, MaxConnsPerHost: 2, MaxIdleConnsPerHost: 2, ResponseHeaderTimeout: 240 * time.Second, DisableCompression: true}
	return &Provider{origin: strings.TrimRight(u.String(), "/"), chatModel: c.ChatModel, ocrModel: c.OCRModel, rasterExecutable: c.RasterExecutable, redactor: Redactor(c.Redact), client: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("model redirects are forbidden") }}, inference: make(chan struct{}, 1), decoders: make(chan struct{}, 2), ocrPages: make(chan struct{}, 1)}, nil
}

func (p *Provider) ChatModel() string { return p.chatModel }
func (p *Provider) OCRModel() string  { return p.ocrModel }

func boundedRead(r io.Reader, max int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, errors.New("body limit exceeded")
	}
	if !utf8.Valid(b) {
		return nil, errors.New("invalid UTF-8")
	}
	return b, nil
}

func (p *Provider) post(ctx context.Context, path string, body any, max int64) ([]byte, int, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.origin+path, bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := p.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, contextError(ctx.Err())
		}
		return nil, 0, problem(503, "service_unavailable", "The local model service could not complete the request. No cloud fallback was used.")
	}
	defer res.Body.Close()
	if res.ContentLength > max {
		return nil, res.StatusCode, problem(502, "invalid_reply", "The local model returned an oversized response.")
	}
	b, err := boundedRead(res.Body, max)
	if err != nil {
		if ctx.Err() != nil {
			return nil, res.StatusCode, contextError(ctx.Err())
		}
		return nil, res.StatusCode, problem(502, "invalid_reply", "The local model returned an invalid or oversized response.")
	}
	return b, res.StatusCode, nil
}

// Preflight checks checkpoint provenance and capabilities, not inference quality.
// It is repeated before each inference and never downloads or retries a model.
func (p *Provider) preflight(ctx context.Context, model string, vision, requireGGUF bool) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	b, status, err := p.post(ctx, "/api/show", map[string]any{"model": model}, 2_000_000)
	if err != nil {
		return err
	}
	if status == 404 {
		return problem(409, "missing_model", "Install "+model+" explicitly in Settings first. This request never downloads a model.")
	}
	if status != 200 {
		return problem(409, "local_model_unavailable", "The installed local checkpoint could not be verified.")
	}
	var d struct {
		Remote      json.RawMessage `json:"remote"`
		RemoteHost  json.RawMessage `json:"remote_host"`
		RemoteModel json.RawMessage `json:"remote_model"`
		Details     struct {
			Format string `json:"format"`
		} `json:"details"`
		Capabilities []string `json:"capabilities"`
	}
	if decodeEnvelope(b, &d) != nil || remoteValue(d.Remote) || remoteValue(d.RemoteHost) || remoteValue(d.RemoteModel) || (d.Details.Format != "gguf" && d.Details.Format != "safetensors") || (requireGGUF && d.Details.Format != "gguf") || !contains(d.Capabilities, "completion") || (vision && !contains(d.Capabilities, "vision")) {
		return problem(409, "local_model_unavailable", "Use an installed local checkpoint with the required capabilities; chat requires GGUF for enforced history/context bounds. Cloud proxies and unsupported checkpoints are refused.")
	}
	return nil
}
func remoteValue(v json.RawMessage) bool {
	return len(v) > 0 && string(v) != "null" && string(v) != `""` && string(v) != "false"
}
func contains(values []string, s string) bool {
	for _, v := range values {
		if v == s {
			return true
		}
	}
	return false
}

type modelMessage struct {
	Role     string   `json:"role"`
	Content  string   `json:"content"`
	Images   []string `json:"images,omitempty"`
	ToolName string   `json:"tool_name,omitempty"`
}

// infer owns the gate only for local model work, never across an ERP/tool call.
func (p *Provider) infer(ctx context.Context, model string, messages []modelMessage, format any, ocr bool, final bool) (string, error) {
	return p.inferWithLimit(ctx, model, messages, format, ocr, final, 0)
}
func (p *Provider) inferWithLimit(ctx context.Context, model string, messages []modelMessage, format any, ocr bool, final bool, maxTokens int) (string, error) {
	timeout := 120 * time.Second
	if ocr {
		timeout = 240 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case p.inference <- struct{}{}:
		defer func() { <-p.inference }()
	case <-ctx.Done():
		return "", contextError(ctx.Err())
	}
	vision := ocr
	for _, m := range messages {
		if len(m.Images) > 0 {
			vision = true
		}
	}
	if err := p.preflight(ctx, model, vision, !ocr); err != nil {
		return "", err
	}
	messages, _ = p.redactMessages(ctx, messages)
	if p.hasProtectedValue(ctx, format) {
		return "", problem(503, "tools_unavailable", "The model schema contains protected runtime material; nothing was sent.")
	}
	options := map[string]any{"num_ctx": 32768, "num_predict": 1600, "temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0, "presence_penalty": 1.5, "repeat_penalty": 1}
	if final {
		options["num_predict"] = 2200
		options["presence_penalty"] = 0.5
	}
	if ocr {
		options = map[string]any{"num_ctx": 16384, "num_predict": 8192, "temperature": 0}
		if format != nil {
			options["num_predict"] = 2048
		}
	}
	if maxTokens > 0 {
		options["num_predict"] = maxTokens
	}
	body := map[string]any{"model": model, "runner": "llamacpp", "stream": false, "think": false, "truncate": false, "shift": false, "messages": messages, "options": options}
	if format != nil {
		body["format"] = format
	}
	if ocr {
		delete(body, "runner")
	}
	max := int64(320_000)
	if ocr {
		max = 160_000
	}
	b, status, err := p.post(ctx, "/api/chat", body, max)
	if err != nil {
		return "", err
	}
	var d struct {
		Error      string `json:"error"`
		Done       bool   `json:"done"`
		DoneReason string `json:"done_reason"`
		Message    struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if decodeEnvelope(b, &d) != nil {
		return "", problem(502, "invalid_reply", "The local model returned invalid JSON.")
	}
	if status == 404 {
		return "", problem(409, "missing_model", "The installed checkpoint could not load. No automatic download or fallback was attempted.")
	}
	if status < 200 || status >= 300 || d.Error != "" {
		detail := strings.ToLower(d.Error)
		if strings.Contains(detail, "context") && (strings.Contains(detail, "exceed") || strings.Contains(detail, "too long")) {
			return "", problem(422, "context_overflow", "This conversation exceeds the local model context limit. History was not silently discarded or shifted.")
		}
		return "", problem(502, "inference_failed", "The local model could not answer. No cloud fallback or automatic retry was used.")
	}
	if !d.Done || d.DoneReason == "length" || strings.TrimSpace(d.Message.Content) == "" {
		return "", problem(422, "invalid_reply", "The local model returned empty or truncated text. No partial answer was accepted.")
	}
	if ocr && utf16Length(d.Message.Content) > 24000 {
		return "", problem(422, "unreadable_page", "The dense page exceeded the transcription limit. Split it into smaller images.")
	}
	if !ocr && !noSensitiveOutput(p, ctx, d.Message.Content) {
		return "", problem(502, "invalid_reply", "The local model returned protected runtime material; no answer was accepted.")
	}
	if !ocr && p.hasRedactor(ctx) {
		var value any
		if strictJSON([]byte(d.Message.Content), &value) == nil && p.hasProtectedValue(ctx, value) {
			return "", problem(502, "invalid_reply", "The local model returned protected runtime material; no answer was accepted.")
		}
	}
	return d.Message.Content, nil
}
