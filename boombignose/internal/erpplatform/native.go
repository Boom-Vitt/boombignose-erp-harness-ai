package erpplatform

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/url"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/bundle"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/localai"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/raster"
)

// ModelRuntime is supplied by the native runtime. It must verify a configured,
// installed checkpoint and never resolve a provider or origin from browser data.
type ModelRuntime interface {
	List(context.Context) ([]InstalledModel, error)
	Delete(context.Context, string) error
	Pull(context.Context, string) (io.ReadCloser, error)
	VerifyVision(context.Context, string) error
	Vision(context.Context, string, string) (string, error)
	Speech(context.Context, string) ([]byte, error)
	Image(context.Context, string) (io.ReadCloser, error)
}
type InstalledModel struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}
type OCRRuntime interface {
	RecognizePage(context.Context, []byte, localai.PageMetadata) (localai.OCRPage, error)
}
type ASRRuntime interface {
	Installed(context.Context) (bool, error)
	Install(context.Context) error
	Remove(context.Context) error
	Transcribe(context.Context, []byte) (string, error)
}

// DesktopRuntime is the trusted OS adapter. Staging writes are private, bounded,
// atomic files. The adapter never accepts a client-selected directory or helper.
type DesktopRuntime interface {
	Configured() bool
	Fullscreen(context.Context, *bool) (bool, error)
	LatestRelease(context.Context) (json.RawMessage, error)
	Download(context.Context, string) (io.ReadCloser, int64, error)
	Stage(context.Context, string, io.Reader) error
	RemoveStage(context.Context, string) error
	CommitStage(context.Context, string, string) error
	Apply(context.Context, string, string) error
}
type NativeOptions struct {
	Backup        NativeBackupHost
	Models        ModelRuntime
	OCR           OCRRuntime
	ASR           ASRRuntime
	Desktop       DesktopRuntime
	Platform      string
	Arch          string
	Version       string
	DataAvailable bool
}

type NativeError struct {
	Status        int
	Code, Message string
}

func (e *NativeError) Error() string { return e.Message }
func nativeError(status int, message string) Response {
	return jsonResponse(status, map[string]any{"error": message})
}
func nativeFailure(err error, status int, fallback string) Response {
	var e *NativeError
	if errors.As(err, &e) {
		if e.Code != "" {
			return jsonResponse(e.Status, map[string]any{"error": e.Message, "code": e.Code})
		}
		return nativeError(e.Status, e.Message)
	}
	var local *localai.Error
	if errors.As(err, &local) {
		return jsonResponse(local.Status, map[string]any{"error": local.Message, "code": local.Code})
	}
	return nativeError(status, fallback)
}
func (s *Service) nativeOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/api/local-models/route.ts::GET":          s.modelsGet,
		"app/api/local-models/route.ts::DELETE":       s.modelsDelete,
		"app/api/local-models/pull/route.ts::POST":    s.modelsPull,
		"app/api/local-models/vision/route.ts::POST":  s.modelsVision,
		"app/api/local-models/speech/route.ts::POST":  s.modelsSpeech,
		"app/api/local-models/image/route.ts::POST":   s.modelsImage,
		"app/api/local-asr/install/route.ts::POST":    s.asrInstall,
		"app/api/local-asr/install/route.ts::DELETE":  s.asrRemove,
		"app/api/local-asr/transcribe/route.ts::POST": s.asrTranscribe,
		"app/api/ocr/page/route.ts::POST":             s.ocrPage,
		"app/api/local-backup/route.ts::GET":          s.backupStatus,
		"app/api/local-backup/route.ts::POST":         s.backupExport,
		"app/api/local-backup/restore/route.ts::POST": s.backupRestore,
		"app/api/local-backup/restore/route.ts::GET":  s.backupStatus,
		"app/api/desktop-window/route.ts::GET":        s.windowGet,
		"app/api/desktop-window/route.ts::POST":       s.windowPost,
		"app/api/desktop-update/route.ts::POST":       s.desktopUpdate,
	}
}
func (s *Service) nativeHost() (string, string) {
	os, arch := s.native.Platform, s.native.Arch
	if os == "" {
		os = runtime.GOOS
	}
	if arch == "" {
		arch = runtime.GOARCH
	}
	if os == "win32" {
		os = "windows"
	}
	if arch == "x64" {
		arch = "amd64"
	}
	return os, arch
}
func (s *Service) operatorDenied(a erpwire.Actor) *Response {
	if a.Operator() {
		return nil
	}
	r := nativeError(403, "Shared host changes and all-workspace backups require operating-system operator authorization. On the server, run boombignose configure-operators "+a.UserID()+", then restart it. Workspace ownership alone is insufficient.")
	return &r
}
func (s *Service) modelAccess(a erpwire.Actor, r Request, write bool) *Response {
	if deny := s.apiAccess(a, r, "", r.Method != "GET" && r.Method != "HEAD"); deny != nil {
		return deny
	}
	if write && !erpwire.Can(a.Role(), "settings:manage") {
		r := nativeError(403, "Only an owner or admin can install or remove models on this computer.")
		return &r
	}
	if write {
		return s.operatorDenied(a)
	}
	return nil
}
func nativeJSON(r Request, limit int) (erpwire.Row, *Response) {
	if declared := header(r, "content-length"); declared != "" {
		n, e := strconv.ParseInt(strings.TrimSpace(declared), 10, 64)
		if e != nil || n < 0 || n > erpwire.MaxSafeInteger {
			x := nativeError(400, "Invalid request size.")
			return nil, &x
		}
		if n > int64(limit) {
			x := nativeError(413, "The request is too large.")
			return nil, &x
		}
	}
	if r.Body == nil {
		x := nativeError(400, "Send a JSON request body.")
		return nil, &x
	}
	if len(r.Body) > limit {
		x := nativeError(413, "The request is too large.")
		return nil, &x
	}
	var body erpwire.Row
	if !utf8.Valid(r.Body) || erpwire.DecodeJSON(r.Body, &body) != nil {
		x := nativeError(400, "The request is not valid UTF-8 JSON.")
		return nil, &x
	}
	return body, nil
}
func modelBody(r Request) erpwire.Row {
	body, deny := nativeJSON(r, 3_000_000)
	if deny != nil {
		return nil
	}
	return body
}
func cleanNativePrompt(raw string, max int) string {
	raw = strings.Map(func(r rune) rune {
		if r <= 8 || r == 11 || r == 12 || (r >= 14 && r <= 31) {
			return -1
		}
		return r
	}, raw)
	raw = strings.TrimSpace(raw)
	if len(utf16.Encode([]rune(raw))) > max {
		return ""
	}
	return raw
}
func clipNative(raw string, max int) string {
	u := utf16.Encode([]rune(raw))
	if len(u) > max {
		u = u[:max]
	}
	return string(utf16.Decode(u))
}
func clipNativeError(raw string) string {
	return clipNative(strings.Join(strings.Fields(raw), " "), 200)
}
func nativeNamesMatch(left, right string) bool {
	left = strings.ToLower(strings.TrimSpace(left))
	right = strings.ToLower(strings.TrimSpace(right))
	return left == right || left == right+":latest" || right == left+":latest"
}
func nativeInstalled(ctx context.Context, models ModelRuntime, id string) *Response {
	if models == nil {
		r := nativeError(503, "AI is not configured.")
		return &r
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	list, e := models.List(ctx)
	if e != nil {
		r := nativeFailure(e, 503, "Ollama is not running on this computer.")
		return &r
	}
	for _, m := range list {
		if nativeNamesMatch(m.Name, id) {
			return nil
		}
	}
	r := nativeError(409, "Install that model on this computer first.")
	return &r
}
func (s *Service) modelGate(id string) *Response {
	if !bundle.KnownModel(id) {
		r := nativeError(400, "That model is not in this build.")
		return &r
	}
	os, arch := s.nativeHost()
	if !bundle.PullAllowed(id, os, arch) {
		r := nativeError(409, nativeUnavailable(id))
		return &r
	}
	return nil
}
func nativeUnavailable(id string) string {
	switch id {
	case "phonon":
		return "Not available in this build on this computer. Ollama 0.40.11 runs Phonon on Apple Silicon only. It is English, not Thai, and it is not voice cloning."
	case "x/flux2-klein:4b":
		return "Not available in this build on this operating system. Ollama 0.40.11 runs image models on macOS only, so this app does not download those weights here."
	}
	return "Not available in this build."
}
func (s *Service) modelsGet(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, false); deny != nil {
		return *deny, nil
	}
	return jsonResponse(200, s.nativeModelSnapshot(ctx)), nil
}
func (s *Service) modelsDelete(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	model := text(modelBody(r)["model"])
	if deny := s.modelGate(model); deny != nil {
		return *deny, nil
	}
	if s.native.Models == nil {
		return nativeError(503, "AI is not configured."), nil
	}
	if e = s.native.Models.Delete(ctx, model); e != nil {
		return nativeFailure(e, 502, "The local model service could not remove the model."), nil
	}
	return jsonResponse(200, map[string]any{"ok": true}), nil
}
func (s *Service) modelsPull(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	model := text(modelBody(r)["model"])
	if deny := s.modelGate(model); deny != nil {
		return *deny, nil
	}
	if s.native.Models == nil {
		return nativeError(503, "AI is not configured."), nil
	}
	stream, e := s.native.Models.Pull(ctx, model)
	if e != nil {
		return nativeFailure(e, 503, "Ollama is not running on this computer."), nil
	}
	if stream == nil {
		return nativeError(502, "The download did not start."), nil
	}
	return Response{Status: 200, Headers: map[string]string{"Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store"}, Body: newNativePullStream(stream)}, nil
}
func (s *Service) modelsVision(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, false); deny != nil {
		return *deny, nil
	}
	os, arch := s.nativeHost()
	if !bundle.PullAllowed("qwen3.5:4b", os, arch) {
		return nativeError(409, "Not available in this build."), nil
	}
	body := modelBody(r)
	mime := text(body["mediaType"])
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" {
		return nativeError(400, "Use a JPEG, PNG, or WebP image."), nil
	}
	encoded := nativeNoSpace(text(body["imageBase64"]))
	if !nativeBase64(encoded, 16, 2_000_000) {
		return nativeError(400, "That image is empty or larger than this page accepts."), nil
	}
	b, e := decodeNativeBase64(encoded)
	if e != nil {
		return nativeError(400, "Invalid image."), nil
	}
	if deny := validateNativeRaster(b, mime); deny != nil {
		return *deny, nil
	}
	if deny := nativeInstalled(ctx, s.native.Models, "qwen3.5:4b"); deny != nil {
		return *deny, nil
	}
	if e = s.native.Models.VerifyVision(ctx, "qwen3.5:4b"); e != nil {
		return nativeFailure(e, 409, "The local model could not be verified."), nil
	}
	output, e := s.native.Models.Vision(ctx, encoded, "Describe this image briefly in Thai and then in English. Mention only what is visible. Do not invent amounts, do not post a journal, and do not file tax.")
	if e != nil {
		return nativeFailure(e, 502, "The vision model returned no text."), nil
	}
	if strings.TrimSpace(output) == "" {
		return nativeError(502, "The vision model returned no text."), nil
	}
	return jsonResponse(200, map[string]any{"text": clipNative(output, 4000)}), nil
}
func (s *Service) modelsSpeech(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, false); deny != nil {
		return *deny, nil
	}
	if deny := s.modelGate("phonon"); deny != nil {
		return *deny, nil
	}
	input := cleanNativePrompt(text(modelBody(r)["text"]), 200)
	if input == "" {
		return nativeError(400, "Enter one short English sentence."), nil
	}
	if deny := nativeInstalled(ctx, s.native.Models, "phonon"); deny != nil {
		return *deny, nil
	}
	audio, e := s.native.Models.Speech(ctx, input)
	if e != nil {
		return nativeFailure(e, 503, "Ollama is not running on this computer."), nil
	}
	if len(audio) < 44 || len(audio) > 8_000_000 {
		return nativeError(502, "The speech model did not return audio."), nil
	}
	return Response{Status: 200, Headers: map[string]string{"Content-Type": "audio/wav", "Cache-Control": "no-store"}, Body: audio}, nil
}
func (s *Service) modelsImage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, false); deny != nil {
		return *deny, nil
	}
	if deny := s.modelGate("x/flux2-klein:4b"); deny != nil {
		return *deny, nil
	}
	input := cleanNativePrompt(text(modelBody(r)["prompt"]), 300)
	if input == "" {
		return nativeError(400, "Enter a short description."), nil
	}
	if deny := nativeInstalled(ctx, s.native.Models, "x/flux2-klein:4b"); deny != nil {
		return *deny, nil
	}
	stream, e := s.native.Models.Image(ctx, input)
	if e != nil {
		return nativeFailure(e, 503, "Ollama is not running on this computer."), nil
	}
	if stream == nil {
		return nativeError(502, "The picture did not start."), nil
	}
	defer stream.Close()
	image, failure, e := readNativeImage(stream)
	if e != nil {
		return nativeError(502, "The model returned no picture."), nil
	}
	if failure != "" && image == "" {
		return nativeError(502, failure), nil
	}
	mime := nativeImageMIME(image)
	if mime == "" {
		return nativeError(502, "The model returned no picture."), nil
	}
	return jsonResponse(200, map[string]any{"mediaType": mime, "image": image}), nil
}
func nativeNoSpace(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '\ufeff' {
			return -1
		}
		return r
	}, s)
}

var nativeBase64Pattern = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)

func nativeBase64(s string, min, max int) bool {
	return len(s) >= min && len(s) <= max && nativeBase64Pattern.MatchString(s)
}
func decodeNativeBase64(s string) ([]byte, error) {
	return base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "="))
}
func nativeImageMIME(encoded string) string {
	b, e := decodeNativeBase64(encoded)
	if e != nil {
		return ""
	}
	return nativeSniff(b)
}
func nativeSniff(b []byte) string {
	if bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) {
		return "image/png"
	}
	if len(b) >= 3 && b[0] == 255 && b[1] == 216 && b[2] == 255 {
		return "image/jpeg"
	}
	if len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return "image/webp"
	}
	return ""
}
func validateNativeRaster(b []byte, mime string) *Response {
	if len(b) == 0 || len(b) > raster.MaxBytes {
		r := nativeError(413, "Page raster exceeds 3 MiB.")
		return &r
	}
	actual := nativeSniff(b)
	if actual == "" || actual != mime {
		r := nativeError(415, "Use valid JPEG, PNG or WebP bytes with their matching MIME type.")
		return &r
	}
	if result := raster.Validate(b); !result.OK {
		r := nativeError(400, "Corrupt, animated or over-limit image. Use a single page up to 4 million pixels and 2400 pixels per edge.")
		return &r
	}
	return nil
}

var nativeOCRBusy atomic.Bool

func (s *Service) ocrPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.apiAccess(a, r, "", true); deny != nil {
		return *deny, nil
	}
	if !nativeOCRBusy.CompareAndSwap(false, true) {
		resp := jsonResponse(429, map[string]any{"error": "Another local OCR page is running. Wait for it to finish, then retry.", "code": "busy"})
		resp.Headers["Retry-After"] = "5"
		return resp, nil
	}
	defer nativeOCRBusy.Store(false)
	pageText, totalText := header(r, "x-ocr-page"), header(r, "x-ocr-pages")
	page, e1 := strconv.Atoi(pageText)
	total, e2 := strconv.Atoi(totalText)
	sha := header(r, "x-ocr-source-sha256")
	if e1 != nil || e2 != nil || !nativePositive.MatchString(pageText) || !nativePositive.MatchString(totalText) || total > 12 || page > total || !nativeSHA.MatchString(sha) {
		return jsonResponse(400, map[string]any{"error": "Invalid source SHA-256 or page reference.", "code": "invalid_document"}), nil
	}
	if n := header(r, "content-length"); n != "" {
		v, e := strconv.ParseUint(n, 10, 64)
		if e != nil || v > raster.MaxBytes {
			return jsonResponse(413, map[string]any{"error": "Page upload is empty or exceeds 3 MiB.", "code": "invalid_document"}), nil
		}
	}
	if len(r.Body) == 0 || len(r.Body) > raster.MaxBytes {
		return jsonResponse(413, map[string]any{"error": "Page upload is empty or exceeds 3 MiB.", "code": "invalid_document"}), nil
	}
	if deny := validateNativeRaster(r.Body, header(r, "content-type")); deny != nil {
		deny.Body.(map[string]any)["code"] = "invalid_document"
		return *deny, nil
	}
	if ctx.Err() != nil {
		return jsonResponse(499, map[string]any{"error": "OCR cancelled.", "code": "cancelled"}), nil
	}
	if s.native.OCR == nil {
		return jsonResponse(503, map[string]any{"error": "Local OCR could not finish this page. Retry or enter the document manually.", "code": "service_unavailable"}), nil
	}
	result, e := s.native.OCR.RecognizePage(ctx, r.Body, localai.PageMetadata{Page: page, TotalPages: total, SourceSHA256: sha})
	if e != nil {
		if errors.Is(e, context.Canceled) || ctx.Err() == context.Canceled {
			return jsonResponse(499, map[string]any{"error": "OCR cancelled.", "code": "cancelled"}), nil
		}
		if errors.Is(e, context.DeadlineExceeded) {
			return jsonResponse(504, map[string]any{"error": "Local OCR timed out. Try a smaller page or check model memory in Settings.", "code": "timeout"}), nil
		}
		failure := nativeFailure(e, 500, "Local OCR could not finish this page. Retry or enter the document manually.")
		if body, ok := failure.Body.(map[string]any); ok && body["code"] == nil {
			body["code"] = "ocr_failed"
		}
		return failure, nil
	}
	return jsonResponse(200, result), nil
}

var nativePositive = regexp.MustCompile(`^[1-9][0-9]*$`)
var nativeSHA = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (s *Service) asrAvailable() bool {
	os, arch := s.nativeHost()
	return os == "linux" && (arch == "amd64" || arch == "arm64") || os == "windows" && arch == "amd64"
}
func (s *Service) asrInstall(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	if !s.asrAvailable() {
		return nativeError(409, "Speech to text is not available on this computer in this build."), nil
	}
	if !s.native.DataAvailable {
		return nativeError(502, "No local data directory yet."), nil
	}
	if s.native.ASR == nil {
		return nativeError(502, "The download failed."), nil
	}
	if e = s.native.ASR.Install(ctx); e != nil {
		return nativeFailure(e, 502, "The download failed."), nil
	}
	return jsonResponse(200, map[string]any{"ok": true}), nil
}
func (s *Service) asrRemove(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	if s.native.ASR != nil {
		if e = s.native.ASR.Remove(ctx); e != nil {
			return nil, e
		}
	}
	return jsonResponse(200, map[string]any{"ok": true}), nil
}
func (s *Service) asrTranscribe(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, false); deny != nil {
		return *deny, nil
	}
	encoded := nativeNoSpace(text(modelBody(r)["audioBase64"]))
	if !nativeBase64(encoded, 16, 6_000_000) {
		return nativeError(400, "Use a WAV, MP3, FLAC, or Ogg file under 4 MB."), nil
	}
	audio, e := decodeNativeBase64(encoded)
	if e != nil {
		return nativeError(400, "Use a WAV, MP3, FLAC, or Ogg file under 4 MB."), nil
	}
	if !s.asrAvailable() || !s.native.DataAvailable {
		return nativeError(409, "Speech to text is not available on this computer in this build."), nil
	}
	if s.native.ASR == nil {
		return nativeError(409, "Install speech to text on this computer first."), nil
	}
	installed, e := s.native.ASR.Installed(ctx)
	if e != nil || !installed {
		return nativeError(409, "Install speech to text on this computer first."), nil
	}
	if len(audio) < 16 || len(audio) > 4_000_000 || !nativeAudio(audio) {
		return nativeError(400, "Use a WAV, MP3, FLAC, or Ogg file under 4 MB."), nil
	}
	result, e := s.native.ASR.Transcribe(ctx, audio)
	if e != nil {
		return nativeFailure(e, 502, "Speech to text failed."), nil
	}
	result = strings.TrimSpace(result)
	if result == "" {
		return nativeError(502, "The recording had no words."), nil
	}
	return jsonResponse(200, map[string]any{"text": clipNative(result, 8000)}), nil
}
func nativeAudio(b []byte) bool {
	return len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WAVE" || len(b) >= 4 && (string(b[:4]) == "fLaC" || string(b[:4]) == "OggS") || len(b) >= 3 && string(b[:3]) == "ID3" || len(b) >= 2 && b[0] == 255 && b[1]&0xe0 == 0xe0
}
func (s *Service) nativeAdminAccess(a erpwire.Actor, r Request, mutation bool) *Response {
	if deny := s.apiAccess(a, r, "settings:manage", mutation); deny != nil {
		return deny
	}
	return s.operatorDenied(a)
}
func (s *Service) backupStatus(_ context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.nativeAdminAccess(a, r, false); deny != nil {
		return *deny, nil
	}
	return jsonResponse(200, map[string]any{"scope": "database-only", "allWorkspaces": true, "maxBytes": 512 * 1024 * 1024, "confirmation": "RESTORE ALL WORKSPACES"}), nil
}
func (s *Service) windowGet(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.nativeAdminAccess(a, r, false); deny != nil {
		if deny.Status == 401 || deny.Status == 403 {
			return jsonResponse(200, map[string]any{"desktop": false}), nil
		}
		return *deny, nil
	}
	return s.nativeWindow(ctx, nil), nil
}
func (s *Service) windowPost(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.nativeAdminAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	body, deny := nativeJSON(r, 256)
	if deny != nil {
		return *deny, nil
	}
	value, ok := body["fullscreen"].(bool)
	if !ok {
		return nativeError(400, "fullscreen must be true or false."), nil
	}
	return s.nativeWindow(ctx, &value), nil
}
func (s *Service) nativeWindow(ctx context.Context, fullscreen *bool) Response {
	d := s.native.Desktop
	if d == nil || !d.Configured() {
		return jsonResponse(200, map[string]any{"desktop": false})
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	state, e := d.Fullscreen(ctx, fullscreen)
	if e != nil {
		return jsonResponse(200, map[string]any{"desktop": false})
	}
	return jsonResponse(200, map[string]any{"desktop": true, "fullscreen": state})
}

// Pull events are sanitized before the stream becomes visible to a browser.
type nativePullReader struct {
	source  io.ReadCloser
	pending []byte
	output  []byte
	done    bool
}

func newNativePullStream(source io.ReadCloser) io.ReadCloser {
	return &nativePullReader{source: source}
}
func (r *nativePullReader) Close() error { return r.source.Close() }
func (r *nativePullReader) Read(p []byte) (int, error) {
	for len(r.output) == 0 && !r.done {
		buffer := make([]byte, 4096)
		n, e := r.source.Read(buffer)
		r.pending = append(r.pending, buffer[:n]...)
		if len(r.pending) > 1_000_000 {
			r.done = true
			return 0, errors.New("model status exceeds limit")
		}
		for {
			at := bytes.IndexByte(r.pending, '\n')
			if at < 0 {
				break
			}
			r.output = append(r.output, sanitizeNativePull(r.pending[:at])...)
			r.pending = r.pending[at+1:]
		}
		if e != nil {
			r.output = append(r.output, sanitizeNativePull(r.pending)...)
			r.pending = nil
			r.done = true
			if e != io.EOF && len(r.output) == 0 {
				return 0, e
			}
		}
	}
	if len(r.output) > 0 {
		n := copy(p, r.output)
		r.output = r.output[n:]
		return n, nil
	}
	return 0, io.EOF
}
func sanitizeNativePull(line []byte) []byte {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil
	}
	var record erpwire.Row
	if erpwire.DecodeJSON(line, &record) != nil {
		return []byte("{\"error\":\"The download sent a status this app could not read.\"}\n")
	}
	out := erpwire.Row{}
	if s := text(record["status"]); strings.TrimSpace(s) != "" {
		out["status"] = clipNative(strings.Join(strings.Fields(s), " "), 120)
	}
	for _, key := range []string{"completed", "total"} {
		if n, ok := record[key].(json.Number); ok {
			if value, e := n.Float64(); e == nil && (value >= 0 && key == "completed" || value > 0 && key == "total") {
				out[key] = n
			}
		}
	}
	if s := text(record["error"]); strings.TrimSpace(s) != "" {
		out["error"] = clipNativeError(s)
	}
	if out["status"] == "success" {
		out["done"] = true
	}
	if out["status"] == nil && out["error"] == nil && out["completed"] == nil {
		return nil
	}
	b, _ := json.Marshal(out)
	return append(b, '\n')
}
func readNativeImage(stream io.Reader) (string, string, error) {
	b, e := io.ReadAll(io.LimitReader(stream, 24_000_001))
	if e != nil || len(b) > 24_000_000 {
		return "", "", errors.New("oversized model image")
	}
	image, failure := "", ""
	for _, line := range bytes.Split(b, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var record erpwire.Row
		if erpwire.DecodeJSON(line, &record) != nil {
			failure = "The model sent a status this app could not read."
			continue
		}
		if s := text(record["error"]); s != "" {
			failure = clipNativeError(s)
		}
		if s := text(record["image"]); s != "" {
			if len(s) > 8_000_000 {
				failure = "The picture was larger than this page can show."
			} else {
				image = s
			}
		}
	}
	return image, failure, nil
}

const nativeDeferred = "รุ่นนี้ติดตั้งทับให้อัตโนมัติบน macOS Apple Silicon เท่านั้น บน Windows และ Linux ให้เปิดหน้า release / This version replaces the app automatically on macOS Apple Silicon only. On Windows and Linux, open the release page."
const nativeWindowMessage = "เปิดหน้าต่าง BoomBigNose เพื่อติดตั้งจากในแอป แท็บเบราว์เซอร์แทนที่โปรแกรมไม่ได้ / Open the BoomBigNose window to install from inside the app. A browser tab cannot replace the program."
const nativeMacAsset = "BoomBigNose-macos-arm64.dmg"

var nativeSemver = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
var nativeTag = regexp.MustCompile(`^(?:boombignose-v|v)([0-9]+\.[0-9]+\.[0-9]+)$`)

func nativeVersionGreater(left, right string) bool {
	if !nativeSemver.MatchString(left) || !nativeSemver.MatchString(right) {
		return false
	}
	a, b := strings.Split(left, "."), strings.Split(right, ".")
	for i := range a {
		x, e1 := strconv.ParseUint(a[i], 10, 64)
		y, e2 := strconv.ParseUint(b[i], 10, 64)
		if e1 != nil || e2 != nil {
			return false
		}
		if x != y {
			return x > y
		}
	}
	return false
}
func NativeReleaseCheck(raw json.RawMessage, current string) erpwire.Row {
	var record erpwire.Row
	bad := erpwire.Row{"state": "unavailable", "message": "The release page could not be read."}
	if !nativeSemver.MatchString(current) || erpwire.DecodeJSON(raw, &record) != nil {
		return bad
	}
	tag := nativeTag.FindStringSubmatch(text(record["tag_name"]))
	if tag == nil {
		return bad
	}
	link := "https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v" + tag[1]
	if text(record["html_url"]) != link {
		return bad
	}
	if nativeVersionGreater(tag[1], current) {
		return erpwire.Row{"state": "available", "version": tag[1], "url": link}
	}
	return erpwire.Row{"state": "current", "version": current, "url": link}
}
func nativeReleaseURL(version, file string) string {
	if !nativeSemver.MatchString(version) || file != "SHA256SUMS" && file != nativeMacAsset {
		return ""
	}
	return "https://github.com/Boom-Vitt/nose-erp/releases/download/boombignose-v" + version + "/" + file
}
func nativeChecksum(raw []byte, file string) string {
	if len(raw) == 0 || len(raw) > 100_000 || file != nativeMacAsset {
		return ""
	}
	found := ""
	pattern := regexp.MustCompile(`^([a-fA-F0-9]{64}) [ *](\S+)$`)
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		m := pattern.FindStringSubmatch(line)
		if m == nil {
			return ""
		}
		if m[2] != file {
			continue
		}
		sha := strings.ToLower(m[1])
		if found != "" && found != sha {
			return ""
		}
		found = sha
	}
	return found
}
func NativeDownloadAllowed(raw string, redirect bool) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	if redirect {
		return u.Hostname() == "github.com" || u.Hostname() == "release-assets.githubusercontent.com" || u.Hostname() == "objects.githubusercontent.com" || u.Hostname() == "github-releases.githubusercontent.com"
	}
	return u.Host == "github.com" && u.RawQuery == "" && u.Fragment == "" && regexp.MustCompile(`^/Boom-Vitt/nose-erp/releases/download/boombignose-v[0-9]+\.[0-9]+\.[0-9]+/[^/]+$`).MatchString(u.Path)
}
func (s *Service) desktopUpdate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.modelAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	reader, writer := io.Pipe()
	go func() {
		defer writer.Close()
		send := func(event erpwire.Row) { _ = json.NewEncoder(writer).Encode(event) }
		if e := s.performNativeUpdate(ctx, send); e != nil {
			message := "The update stopped."
			var known *NativeError
			if errors.As(e, &known) {
				message = known.Message
			}
			send(erpwire.Row{"phase": "error", "message": message})
		}
	}()
	return Response{Status: 200, Headers: map[string]string{"Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store"}, Body: reader}, nil
}
func (s *Service) performNativeUpdate(ctx context.Context, send func(erpwire.Row)) error {
	fail := func(message string) error { return &NativeError{Message: message} }
	os, arch := s.nativeHost()
	if os != "darwin" || arch != "arm64" {
		return fail(nativeDeferred)
	}
	desktop := s.native.Desktop
	if desktop == nil || !desktop.Configured() {
		return fail(nativeWindowMessage)
	}
	if !s.native.DataAvailable {
		return fail("No local folder is available for the update.")
	}
	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	raw, e := desktop.LatestRelease(checkCtx)
	cancel()
	if e != nil {
		return fail("The release page did not respond.")
	}
	current := s.native.Version
	if current == "" {
		current = "1.5.0"
	}
	release := NativeReleaseCheck(raw, current)
	if release["state"] == "unavailable" {
		return fail(text(release["message"]))
	}
	if release["state"] != "available" {
		return fail("This install matches the published release.")
	}
	version := text(release["version"])
	send(erpwire.Row{"phase": "sums"})
	sumsURL, fileURL := nativeReleaseURL(version, "SHA256SUMS"), nativeReleaseURL(version, nativeMacAsset)
	if sumsURL == "" || fileURL == "" {
		return fail("The update address was refused.")
	}
	sums, _, e := desktop.Download(ctx, sumsURL)
	if e != nil || sums == nil {
		return fail("The update download did not respond.")
	}
	b, e := io.ReadAll(io.LimitReader(sums, 100_001))
	_ = sums.Close()
	if e != nil {
		return fail("SHA256SUMS did not list the macOS installer.")
	}
	expected := nativeChecksum(b, nativeMacAsset)
	if expected == "" {
		return fail("SHA256SUMS did not list the macOS installer.")
	}
	send(erpwire.Row{"phase": "download", "received": 0, "total": nil})
	source, total, e := desktop.Download(ctx, fileURL)
	if e != nil || source == nil {
		return fail("The update download did not respond.")
	}
	defer source.Close()
	if total > 2*1024*1024*1024-1 {
		return fail("The update file is larger than this app accepts.")
	}
	hash := sha256.New()
	count := &nativeUpdateReader{source: io.TeeReader(source, hash), total: total, send: send}
	if e = desktop.Stage(ctx, nativeMacAsset+".partial", count); e != nil {
		_ = desktop.RemoveStage(context.WithoutCancel(ctx), nativeMacAsset+".partial")
		return e
	}
	actual := hash.Sum(nil)
	expectedBytes, _ := hex.DecodeString(expected)
	if subtle.ConstantTimeCompare(actual, expectedBytes) != 1 {
		_ = desktop.RemoveStage(context.WithoutCancel(ctx), nativeMacAsset+".partial")
		return fail("The update file did not match SHA256SUMS.")
	}
	if e = desktop.CommitStage(ctx, nativeMacAsset+".partial", nativeMacAsset); e != nil {
		return e
	}
	send(erpwire.Row{"phase": "verify"})
	send(erpwire.Row{"phase": "restart"})
	send(erpwire.Row{"phase": "apply"})
	if e = desktop.Apply(ctx, version, nativeMacAsset); e != nil {
		return fail("The desktop helper did not install the update.")
	}
	return nil
}

type nativeUpdateReader struct {
	source          io.Reader
	total, received int64
	send            func(erpwire.Row)
}

func (r *nativeUpdateReader) Read(p []byte) (int, error) {
	n, e := r.source.Read(p)
	r.received += int64(n)
	if r.received > 2*1024*1024*1024-1 {
		return 0, &NativeError{Message: "The update file is larger than this app accepts."}
	}
	if n > 0 {
		var total any
		if r.total >= 0 {
			total = r.total
		}
		r.send(erpwire.Row{"phase": "download", "received": r.received, "total": total})
	}
	return n, e
}

const nativeCatalogJSON = `{
  "models": [
    {
      "id": "qwen3.5:4b",
      "modality": "vision",
      "license": "Apache-2.0",
      "sizeNote": "about 3.3–4.0 GB; allow 12 GB RAM for the ERP + model",
      "platforms": ["darwin", "linux", "windows"],
      "arches": ["any"],
      "try": "vision",
      "titleTh": "OCR ไทย/อังกฤษ · ต้องตรวจต้นฉบับ",
      "titleEn": "Thai/English OCR · original review required",
      "detailTh": "ค่าเริ่มต้น OCR รูป/บิล การทดสอบภาพสะอาดอ่านยอดและเลขเอกสารได้ แต่ภาพเอียงคุณภาพต่ำอ่านเดือนผิด แชท ERP ซับซ้อนแบบอ้างอิงหลักฐานยังไม่ผ่าน จึงใช้ 9B เป็นค่าเริ่มต้นแชท",
      "detailEn": "OCR default. Clean test images preserved amounts and document IDs; a degraded rotated image had a wrong month. Complex evidence-reference ERP chat failed, so chat defaults to 9B."
    },
    {
      "id": "qwen3.5:9b-q4_k_m",
      "modality": "text",
      "license": "Apache-2.0",
      "sizeNote": "about 6.6 GB; recommend 24 GB+ RAM",
      "platforms": ["darwin", "linux", "windows"],
      "arches": ["any"],
      "try": "none",
      "titleTh": "แชท ERP ตามหลักฐาน · ค่าเริ่มต้น",
      "titleEn": "Evidence-linked ERP chat · default",
      "detailTh": "ค่าเริ่มต้น GGUF แบบพกพา รันไทม์ที่ทดสอบปฏิเสธอินพุตที่เกินขอบเขตจริงโดยไม่ทิ้งประวัติ ต่างจาก MLX รุ่นที่ทดสอบ ตัวเลขแสดงจาก ERP ไม่ใช่ AI คำนวณ ต้องตรวจทานทุกคำตอบ การควบคุม context ไม่รับรองความถูกต้องของข้อความ",
      "detailEn": "Portable GGUF default. The tested runtime rejects actual context overflow without discarding history, unlike the tested MLX backend. Figures come from ERP, not model arithmetic. Review every answer; context control does not certify prose accuracy."
    },
    {
      "id": "x/flux2-klein:4b",
      "modality": "image",
      "license": "Apache-2.0",
      "sizeNote": "about 5.7 GB",
      "platforms": ["darwin"],
      "arches": ["any"],
      "try": "image",
      "titleTh": "สร้างภาพ",
      "titleEn": "Image",
      "detailTh": "Ollama 0.40.11 รันโมเดลสร้างภาพบน macOS ภาพที่ลองสร้างไม่ถูกบันทึกในระบบ และไม่ได้ยื่นภาษี",
      "detailEn": "Ollama 0.40.11 runs this image model on macOS. A trial picture is not saved in the ERP and it does not file tax."
    },
    {
      "id": "phonon",
      "modality": "tts",
      "license": "Apache-2.0",
      "sizeNote": "about 120 MB",
      "platforms": ["darwin"],
      "arches": ["arm64"],
      "try": "speech",
      "titleTh": "อ่านออกเสียง",
      "titleEn": "Speech",
      "detailTh": "เสียงสำเร็จรูปภาษาอังกฤษบน Apple Silicon ไม่ใช่ภาษาไทย และไม่ใช่การโคลนเสียงของคุณ",
      "detailEn": "A built-in English voice on Apple Silicon. It is not Thai, and it is not a clone of your voice."
    }
  ],
  "alwaysBlocked": [
    {
      "modality": "video",
      "reasonTh": "ยังไม่มีในรุ่นนี้ ตัวติดตั้งไม่มีรันไทม์สร้างวิดีโอ และไม่ได้พ่วง ComfyUI",
      "reasonEn": "Not available in this build. The installer has no video runtime and does not bundle ComfyUI."
    },
    {
      "modality": "asr",
      "reasonTh": "บน macOS ยังไม่มีในรุ่นนี้ whisper.cpp รุ่น b5454 มีโปรแกรมสำหรับ Linux และ Windows แต่ยังไม่มี whisper-cli สำหรับ macOS ขั้นตอนถัดไปคือปักเวอร์ชันไฟล์นั้นเมื่อ ggml-org เผยแพร่ แอปนี้ไม่ได้ให้ไปติดตั้ง Whisper Desktop",
      "reasonEn": "Not available on macOS in this build. whisper.cpp release b5454 publishes Linux and Windows command-line archives, not a macOS whisper-cli. The next step is to pin that archive when ggml-org publishes it. This app does not send you to Whisper Desktop."
    },
    {
      "modality": "voice-clone",
      "reasonTh": "ยังไม่มีในรุ่นนี้ ไม่มีช่องอัปโหลดเสียงตัวอย่าง เสียงของ Phonon เป็นเสียงสำเร็จรูปเท่านั้น",
      "reasonEn": "Not available in this build. There is no sample-upload control. Phonon uses built-in voices only."
    }
  ],
  "unavailableHere": {
    "image": {
      "reasonTh": "ยังไม่มีในรุ่นนี้บนระบบปฏิบัติการนี้ Ollama 0.40.11 รันโมเดลสร้างภาพบน macOS เท่านั้น แอปนี้จึงไม่ดาวน์โหลดน้ำหนักโมเดลนั้นที่นี่",
      "reasonEn": "Not available in this build on this operating system. Ollama 0.40.11 runs image models on macOS only, so this app does not download those weights here."
    },
    "tts": {
      "reasonTh": "ยังไม่มีในรุ่นนี้บนเครื่องนี้ Ollama 0.40.11 รัน Phonon บน Apple Silicon เท่านั้น เป็นภาษาอังกฤษ ไม่ใช่ภาษาไทย และไม่ใช่การโคลนเสียง",
      "reasonEn": "Not available in this build on this computer. Ollama 0.40.11 runs Phonon on Apple Silicon only. It is English, not Thai, and it is not voice cloning."
    }
  }
}
`

func (s *Service) nativeModelSnapshot(ctx context.Context) erpwire.Row {
	var catalog struct {
		Models        []erpwire.Row          `json:"models"`
		AlwaysBlocked []erpwire.Row          `json:"alwaysBlocked"`
		Unavailable   map[string]erpwire.Row `json:"unavailableHere"`
	}
	_ = erpwire.DecodeJSON([]byte(nativeCatalogJSON), &catalog)
	installed := []InstalledModel{}
	up := false
	message := "AI is not configured."
	if s.native.Models != nil {
		var e error
		listCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		installed, e = s.native.Models.List(listCtx)
		cancel()
		up = e == nil
		if e != nil {
			var public *NativeError
			if errors.As(e, &public) {
				message = public.Message
			} else {
				message = "Ollama is not running on this computer."
			}
		}
	}
	os, arch := s.nativeHost()
	rows := []erpwire.Row{}
	blocked := []erpwire.Row{}
	for _, model := range catalog.Models {
		id := text(model["id"])
		if !bundle.PullAllowed(id, os, arch) {
			modality := text(model["modality"])
			if copy := catalog.Unavailable[modality]; copy != nil {
				blocked = append(blocked, erpwire.Row{"modality": modality, "reasonTh": copy["reasonTh"], "reasonEn": copy["reasonEn"]})
			}
			continue
		}
		model["installed"] = false
		model["installedBytes"] = nil
		for _, item := range installed {
			if nativeNamesMatch(item.Name, id) {
				model["installed"] = true
				model["installedBytes"] = item.Size
				break
			}
		}
		rows = append(rows, model)
	}
	blocked = append(blocked, catalog.AlwaysBlocked...)
	var daemonMessage any
	if !up {
		daemonMessage = message
	}
	return erpwire.Row{"daemonUp": up, "daemonMessage": daemonMessage, "rows": rows, "blocked": blocked}
}

// NativeBackupHost is an OS-administrator command boundary, never an API database
// credential. Open verifies the resolved native install and private SCRAM login.
// General ERP row reads and writes continue to use Store, with no service role.
type NativeBackupHost interface {
	Open(context.Context) (NativeBackupSession, error)
}
type NativeBackupFile interface {
	io.ReadCloser
	io.Seeker
}
type NativeBackupSession interface {
	VerifyServer(context.Context) error
	Dump(context.Context) (NativeBackupFile, error)
	RemoveCredentials(context.Context) error
	StageRestore(context.Context, io.Reader) error
	ArchiveList(context.Context) (string, error)
	CreateRecoveryRole(context.Context, string) error
	RestoreAsRole(context.Context, string) error
	DropRecoveryRole(context.Context, string) error
	Close() error
}

const nativeBackupLimit = 512 * 1024 * 1024

var nativeBackupBusy atomic.Bool
var nativeDumpName = regexp.MustCompile(`^boombignose-[0-9]{8}T[0-9]{6}Z\.dump$`)
var nativeACL = regexp.MustCompile(`(?m)^[0-9]+;\s+[0-9]+\s+[0-9]+\s+(?:DEFAULT\s+)?ACL(?:\s|$)`)

func nativeBackupDigest(r io.Reader) (string, int64, error) {
	hash := sha256.New()
	var prefix [5]byte
	n, e := io.ReadFull(r, prefix[:])
	if e != nil || n != 5 || string(prefix[:]) != "PGDMP" {
		return "", 0, errors.New("invalid archive")
	}
	_, _ = hash.Write(prefix[:])
	size, e := io.Copy(hash, io.LimitReader(r, nativeBackupLimit-5+1))
	size += 5
	if size > nativeBackupLimit {
		return "", size, &NativeError{Status: 413}
	}
	if e != nil {
		return "", size, e
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}
func nativeBackupChecksum(name, digest, sidecar string) bool {
	if !nativeDumpName.MatchString(name) || !nativeSHA.MatchString(digest) {
		return false
	}
	line := strings.TrimSpace(strings.ReplaceAll(sidecar, "\r\n", "\n"))
	if len(line) < 66 || line[64:66] != "  " || line[66:] != name || !nativeSHA.MatchString(line[:64]) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(digest), []byte(line[:64])) == 1
}

type nativeBackupDownload struct {
	io.ReadCloser
	session NativeBackupSession
	closed  atomic.Bool
	cancel  context.CancelFunc
}

func (d *nativeBackupDownload) Close() error {
	if !d.closed.CompareAndSwap(false, true) {
		return nil
	}
	if d.cancel != nil {
		d.cancel()
	}
	e := d.ReadCloser.Close()
	closeErr := d.session.Close()
	nativeBackupBusy.Store(false)
	if e != nil {
		return e
	}
	return closeErr
}
func (d *nativeBackupDownload) Read(p []byte) (int, error) {
	n, e := d.ReadCloser.Read(p)
	if e != nil {
		_ = d.Close()
	}
	return n, e
}
func (s *Service) backupExport(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.nativeAdminAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	if !nativeBackupBusy.CompareAndSwap(false, true) {
		return nativeError(409, "Another database backup or restore is in progress. Try again when it finishes."), nil
	}
	streaming := false
	var session NativeBackupSession
	defer func() {
		if !streaming {
			if session != nil {
				_ = session.Close()
			}
			nativeBackupBusy.Store(false)
		}
	}()
	fallback := "Backup failed. Check this native install's private credentials, resolved bundle/data/port, and SCRAM configuration. Nothing was exported."
	if s.native.Backup == nil {
		return nativeError(503, fallback), nil
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer func() {
		if !streaming {
			cancel()
		}
	}()
	session, e = s.native.Backup.Open(ctx)
	if e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	if e = session.VerifyServer(ctx); e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	file, e := session.Dump(ctx)
	if e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	digest, size, e := nativeBackupDigest(file)
	if e != nil {
		_ = file.Close()
		if size > nativeBackupLimit {
			return nativeError(413, "The database dump exceeds the 512 MiB export limit. No backup was exported."), nil
		}
		return nativeFailure(e, 503, fallback), nil
	}
	if _, e = file.Seek(0, io.SeekStart); e != nil {
		_ = file.Close()
		return nativeError(503, fallback), nil
	}
	if e = session.RemoveCredentials(ctx); e != nil {
		_ = file.Close()
		return nativeError(503, fallback), nil
	}
	name := "boombignose-" + s.now().UTC().Format("20060102T150405Z") + ".dump"
	if !nativeDumpName.MatchString(name) {
		_ = file.Close()
		return nativeError(503, fallback), nil
	}
	download := &nativeBackupDownload{ReadCloser: file, session: session, cancel: cancel}
	context.AfterFunc(ctx, func() { _ = download.Close() })
	streaming = true
	return Response{Status: 200, Headers: map[string]string{"Content-Type": "application/octet-stream", "Content-Length": strconv.FormatInt(size, 10), "Content-Disposition": `attachment; filename="` + name + `"`, "X-Backup-Sha256": digest, "X-Backup-Name": name, "X-Backup-Scope": "database-only-all-workspaces", "Cache-Control": "no-store"}, Body: download}, nil
}

type nativeRestoreUpload struct {
	dump                                  []byte
	name, checksum, confirmation, trusted string
}

func nativeRestoreForm(r Request) (nativeRestoreUpload, *Response) {
	var form nativeRestoreUpload
	size := len(r.Body)
	if declared := header(r, "content-length"); declared != "" {
		v, e := strconv.ParseUint(declared, 10, 64)
		if e != nil || v > nativeBackupLimit+64*1024 {
			deny := nativeError(413, "Backup exceeds the 512 MiB dump or 512-byte checksum limit. Nothing was restored.")
			return form, &deny
		}
	}
	if size > nativeBackupLimit+64*1024 {
		deny := nativeError(413, "Backup exceeds the 512 MiB dump or 512-byte checksum limit. Nothing was restored.")
		return form, &deny
	}
	media, params, e := mime.ParseMediaType(header(r, "content-type"))
	if e != nil || media != "multipart/form-data" {
		deny := nativeError(400, "Invalid or incomplete multipart backup upload. Nothing was restored.")
		return form, &deny
	}
	reader := multipart.NewReader(bytes.NewReader(r.Body), params["boundary"])
	seen := map[string]bool{}
	for count := 0; ; count++ {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil || count >= 256 {
			deny := nativeError(400, "Invalid or incomplete multipart backup upload. Nothing was restored.")
			return form, &deny
		}
		name := part.FormName()
		if seen[name] {
			_ = part.Close()
			continue
		}
		seen[name] = true
		limit := int64(1024)
		if name == "dump" {
			limit = nativeBackupLimit
		} else if name == "checksum" {
			limit = 512
		}
		body, e := io.ReadAll(io.LimitReader(part, limit+1))
		_ = part.Close()
		if e != nil {
			deny := nativeError(400, "Invalid or incomplete multipart backup upload. Nothing was restored.")
			return form, &deny
		}
		if int64(len(body)) > limit {
			deny := nativeError(413, "Backup exceeds the 512 MiB dump or 512-byte checksum limit. Nothing was restored.")
			return form, &deny
		}
		switch name {
		case "dump":
			if part.FileName() != "" {
				form.dump = body
				form.name = part.FileName()
			}
		case "checksum":
			if part.FileName() != "" {
				form.checksum = string(body)
			}
		case "confirmation":
			form.confirmation = string(body)
		case "trustedSource":
			form.trusted = string(body)
		}
	}
	if form.dump == nil || form.checksum == "" {
		deny := nativeError(400, "Choose the dump and its checksum file.")
		return form, &deny
	}
	if form.confirmation != "RESTORE ALL WORKSPACES" || form.trusted != "yes" {
		deny := nativeError(400, "Restore requires a trusted source and explicit RESTORE ALL WORKSPACES confirmation.")
		return form, &deny
	}
	return form, nil
}
func (s *Service) backupRestore(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (result any, resultError error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.nativeAdminAccess(a, r, true); deny != nil {
		return *deny, nil
	}
	if !nativeBackupBusy.CompareAndSwap(false, true) {
		return nativeError(409, "Another database backup or restore is in progress. Try again when it finishes."), nil
	}
	defer nativeBackupBusy.Store(false)
	var session NativeBackupSession
	role := ""
	outcome := "not-started"
	defer func() {
		cleanupFailed := false
		if session != nil {
			if role != "" {
				cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
				if e := session.DropRecoveryRole(cleanupCtx, role); e != nil {
					cleanupFailed = true
				}
				cancel()
			}
			if e := session.Close(); e != nil {
				cleanupFailed = true
			}
		}
		if cleanupFailed {
			message := "Restore did not start, but recovery role or private staging cleanup failed. Have the native administrator complete cleanup before retrying."
			if outcome == "applied" {
				message = "Restore was applied, but recovery role or private staging cleanup failed. Reload the application and have the native administrator complete cleanup before another recovery."
			} else if outcome == "uncertain" {
				message = "Restore transaction outcome is uncertain, and recovery role or private staging cleanup failed. Have the native administrator inspect the database and complete cleanup before retrying."
			}
			result = jsonResponse(500, map[string]any{"error": message, "reloadRequired": outcome != "not-started"})
			resultError = nil
		}
	}()
	fallback := "Restore did not start. Check the files, native install's private credentials, resolved bundle/data/port, SCRAM configuration, and administrator permission to create a recovery role."
	if s.native.Backup == nil {
		return nativeError(503, fallback), nil
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	session, e = s.native.Backup.Open(ctx)
	if e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	form, deny := nativeRestoreForm(r)
	if deny != nil {
		return *deny, nil
	}
	digest, size, e := nativeBackupDigest(bytes.NewReader(form.dump))
	if e != nil {
		if size > nativeBackupLimit {
			return nativeError(413, "Backup exceeds the 512 MiB dump or 512-byte checksum limit. Nothing was restored."), nil
		}
		return nativeError(400, "Invalid PostgreSQL custom archive. Nothing was restored."), nil
	}
	if !nativeBackupChecksum(form.name, digest, form.checksum) {
		return nativeError(400, "Backup checksum does not match. Nothing was restored."), nil
	}
	if e = session.StageRestore(ctx, bytes.NewReader(form.dump)); e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	listing, e := session.ArchiveList(ctx)
	if e != nil {
		return nativeFailure(e, 400, "Invalid or unsupported PostgreSQL archive. Nothing was restored."), nil
	}
	if !nativeACL.MatchString(listing) {
		return nativeError(400, "Backup has no ACL metadata. Re-export from the trusted original database with owners and grants preserved. Nothing was restored."), nil
	}
	if e = session.VerifyServer(ctx); e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	if e = ctx.Err(); e != nil {
		return nativeError(503, fallback), nil
	}
	nonce := make([]byte, 16)
	if _, e = rand.Read(nonce); e != nil {
		return nativeError(503, fallback), nil
	}
	role = "boombignose_recovery_" + hex.EncodeToString(nonce)
	allocation, cancelAllocation := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	e = session.CreateRecoveryRole(allocation, role)
	cancelAllocation()
	if e != nil {
		return nativeFailure(e, 503, fallback), nil
	}
	if e = ctx.Err(); e != nil {
		return nativeError(503, fallback), nil
	}
	outcome = "uncertain"
	if e = session.RestoreAsRole(ctx, role); e != nil {
		return nativeError(500, "Restore did not complete successfully; its transaction outcome is uncertain. Inspect the database before retrying. No attachment or native secret files were restored."), nil
	}
	outcome = "applied"
	return jsonResponse(200, map[string]any{"ok": true, "scope": "database-only", "reloadRequired": true}), nil
}
