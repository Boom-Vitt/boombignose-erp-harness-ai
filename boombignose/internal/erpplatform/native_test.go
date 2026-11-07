package erpplatform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/localai"
)

var nativeTestNow = time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC)

func nativeActor(t *testing.T, role erpwire.Role, operator bool) erpwire.Actor {
	t.Helper()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: "11111111-1111-4111-8111-111111111111", Email: "owner@example.test", Assurance: erpwire.AAL2, ExpiresAt: nativeTestNow.Add(time.Hour), FactorStateKnown: true, HasVerifiedFactor: true}, erpwire.Membership{UserID: "11111111-1111-4111-8111-111111111111", OrgID: "22222222-2222-4222-8222-222222222222", Role: role}, operator, nativeTestNow)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func nativeService() *Service {
	return &Service{now: func() time.Time { return nativeTestNow }, origins: []string{"http://localhost:3000"}, native: NativeOptions{Platform: "darwin", Arch: "arm64", DataAvailable: true}}
}
func nativeRaw(t *testing.T, method string, body []byte, headers map[string]string) json.RawMessage {
	t.Helper()
	if headers == nil {
		headers = map[string]string{}
	}
	headers["origin"] = "http://localhost:3000"
	b, e := json.Marshal([]Request{{Method: method, URL: "http://localhost:3000/api", Body: body, Headers: headers}})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func nativeCall(t *testing.T, op erpwire.Operation, a erpwire.Actor, raw json.RawMessage) Response {
	t.Helper()
	value, e := op(context.Background(), a, raw)
	if e != nil {
		t.Fatal(e)
	}
	r, ok := value.(Response)
	if !ok {
		t.Fatalf("response type %T", value)
	}
	return r
}
func nativeMessage(t *testing.T, r Response) string {
	t.Helper()
	switch b := r.Body.(type) {
	case map[string]any:
		return text(b["error"])
	case erpwire.Row:
		return text(b["error"])
	}
	t.Fatalf("error body type %T", r.Body)
	return ""
}

type nativeModelFake struct {
	calls         []string
	installed     []InstalledModel
	audio         []byte
	image, vision string
}

func (f *nativeModelFake) List(context.Context) ([]InstalledModel, error) {
	f.calls = append(f.calls, "list")
	return f.installed, nil
}
func (f *nativeModelFake) Delete(_ context.Context, id string) error {
	f.calls = append(f.calls, "delete:"+id)
	return nil
}
func (f *nativeModelFake) Pull(_ context.Context, id string) (io.ReadCloser, error) {
	f.calls = append(f.calls, "pull:"+id)
	return io.NopCloser(strings.NewReader("{\"status\":\"success\",\"digest\":\"secret\"}\n")), nil
}
func (f *nativeModelFake) VerifyVision(_ context.Context, id string) error {
	f.calls = append(f.calls, "verify:"+id)
	return nil
}
func (f *nativeModelFake) Vision(context.Context, string, string) (string, error) {
	f.calls = append(f.calls, "vision")
	return f.vision, nil
}
func (f *nativeModelFake) Speech(_ context.Context, input string) ([]byte, error) {
	f.calls = append(f.calls, "speech:"+input)
	return f.audio, nil
}
func (f *nativeModelFake) Image(_ context.Context, input string) (io.ReadCloser, error) {
	f.calls = append(f.calls, "image:"+input)
	return io.NopCloser(strings.NewReader(f.image)), nil
}

func TestNativeAuthorizationBeforeHostChanges(t *testing.T) {
	for _, test := range []struct {
		name     string
		role     erpwire.Role
		operator bool
		want     string
	}{
		{"member", erpwire.Member, true, "Only an owner or admin can install or remove models on this computer."},
		{"accountant", erpwire.Accountant, true, "Only an owner or admin can install or remove models on this computer."},
		{"workspace owner", erpwire.Owner, false, "Shared host changes and all-workspace backups require operating-system operator authorization. On the server, run boombignose configure-operators 11111111-1111-4111-8111-111111111111, then restart it. Workspace ownership alone is insufficient."},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := nativeService()
			fake := &nativeModelFake{}
			s.native.Models = fake
			r := nativeCall(t, s.modelsDelete, nativeActor(t, test.role, test.operator), nativeRaw(t, "DELETE", []byte(`{"model":"qwen3.5:4b"}`), nil))
			if r.Status != 403 || nativeMessage(t, r) != test.want || len(fake.calls) != 0 {
				t.Fatalf("got %#v, calls %v", r, fake.calls)
			}
		})
	}
}
func TestNativeUnauthenticatedAndUntrustedOrigin(t *testing.T) {
	s := nativeService()
	fake := &nativeModelFake{}
	s.native.Models = fake
	raw := nativeRaw(t, "DELETE", []byte(`{"model":"qwen3.5:4b"}`), nil)
	r := nativeCall(t, s.modelsDelete, erpwire.Actor{}, raw)
	if r.Status != 401 || nativeMessage(t, r) != "Sign in required." {
		t.Fatalf("got %#v", r)
	}
	var requests []Request
	_ = json.Unmarshal(raw, &requests)
	requests[0].Headers["origin"] = "https://attacker.test"
	raw, _ = json.Marshal(requests)
	r = nativeCall(t, s.modelsDelete, nativeActor(t, erpwire.Owner, true), raw)
	if r.Status != 403 || nativeMessage(t, r) != "Untrusted request origin." || len(fake.calls) != 0 {
		t.Fatalf("got %#v, calls %v", r, fake.calls)
	}
}
func TestNativeModelAllowlistAndInstalledGate(t *testing.T) {
	for _, test := range []struct {
		model, platform, arch string
		status                int
		message               string
	}{
		{"../../private", "darwin", "arm64", 400, "That model is not in this build."},
		{"phonon", "linux", "amd64", 409, nativeUnavailable("phonon")},
		{"x/flux2-klein:4b", "windows", "amd64", 409, nativeUnavailable("x/flux2-klein:4b")},
		{"qwen3.5:4b", "linux", "amd64", 200, ""},
	} {
		t.Run(test.model+test.platform, func(t *testing.T) {
			s := nativeService()
			s.native.Platform = test.platform
			s.native.Arch = test.arch
			fake := &nativeModelFake{}
			s.native.Models = fake
			body, _ := json.Marshal(erpwire.Row{"model": test.model})
			r := nativeCall(t, s.modelsDelete, nativeActor(t, erpwire.Owner, true), nativeRaw(t, "DELETE", body, nil))
			if r.Status != test.status {
				t.Fatalf("got %#v", r)
			}
			if test.message != "" && (nativeMessage(t, r) != test.message || len(fake.calls) != 0) {
				t.Fatalf("got %#v, calls %v", r, fake.calls)
			}
			if test.status == 200 && (len(fake.calls) != 1 || fake.calls[0] != "delete:qwen3.5:4b") {
				t.Fatalf("calls %v", fake.calls)
			}
		})
	}
}
func nativePNG(t *testing.T) []byte {
	t.Helper()
	var out bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.White)
	if e := png.Encode(&out, img); e != nil {
		t.Fatal(e)
	}
	return out.Bytes()
}
func TestNativeVisionDecodesBeforeModel(t *testing.T) {
	for _, test := range []struct {
		name, mime string
		bytes      []byte
		want       int
	}{
		{"wrong mime", "image/jpeg", nativePNG(t), 415},
		{"corrupt", "image/png", append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 20)...), 400},
		{"valid", "image/png", nativePNG(t), 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := nativeService()
			fake := &nativeModelFake{installed: []InstalledModel{{Name: "qwen3.5:4b"}}, vision: "ยอดรวม 1.00"}
			s.native.Models = fake
			body, _ := json.Marshal(erpwire.Row{"mediaType": test.mime, "imageBase64": base64.StdEncoding.EncodeToString(test.bytes)})
			r := nativeCall(t, s.modelsVision, nativeActor(t, erpwire.Member, false), nativeRaw(t, "POST", body, nil))
			if r.Status != test.want {
				t.Fatalf("got %#v", r)
			}
			if test.want != 200 && len(fake.calls) != 0 {
				t.Fatalf("invalid raster reached model %v", fake.calls)
			}
			if test.want == 200 && (len(fake.calls) != 3 || r.Body.(map[string]any)["text"] != "ยอดรวม 1.00") {
				t.Fatalf("got %#v calls %v", r, fake.calls)
			}
		})
	}
}
func TestNativeSpeechBoundariesAndPrompt(t *testing.T) {
	for _, n := range []int{43, 44, 8_000_000, 8_000_001} {
		t.Run(strconvNative(n), func(t *testing.T) {
			s := nativeService()
			fake := &nativeModelFake{installed: []InstalledModel{{Name: "phonon:latest"}}, audio: make([]byte, n)}
			s.native.Models = fake
			r := nativeCall(t, s.modelsSpeech, nativeActor(t, erpwire.Member, false), nativeRaw(t, "POST", []byte("{\"text\":\"  hello\\u0000  \"}"), nil))
			want := 200
			if n < 44 || n > 8_000_000 {
				want = 502
			}
			if r.Status != want || len(fake.calls) != 2 || fake.calls[1] != "speech:hello" {
				t.Fatalf("got %#v calls %v", r, fake.calls)
			}
		})
	}
}
func strconvNative(n int) string { b, _ := json.Marshal(n); return string(b) }
func TestNativeBodySizeAndJSONErrors(t *testing.T) {
	for _, test := range []struct {
		name    string
		body    []byte
		headers map[string]string
		status  int
		message string
	}{
		{"missing", nil, nil, 400, "Send a JSON request body."},
		{"utf8", []byte{255}, nil, 400, "The request is not valid UTF-8 JSON."},
		{"declared", []byte(`{}`), map[string]string{"content-length": "257"}, 413, "The request is too large."},
		{"invalid length", []byte(`{}`), map[string]string{"content-length": "-1"}, 400, "Invalid request size."},
		{"limit", bytes.Repeat([]byte(" "), 257), nil, 413, "The request is too large."},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, r := nativeJSON(Request{Body: test.body, Headers: test.headers}, 256)
			if r == nil || r.Status != test.status || nativeMessage(t, *r) != test.message {
				t.Fatalf("got %#v", r)
			}
		})
	}
}
func TestNativeOCRMetadataAndSize(t *testing.T) {
	s := nativeService()
	a := nativeActor(t, erpwire.Member, false)
	for _, test := range []struct {
		page, total, sha string
		body             []byte
		status           int
		message          string
	}{
		{"0", "1", strings.Repeat("a", 64), nativePNG(t), 400, "Invalid source SHA-256 or page reference."},
		{"2", "1", strings.Repeat("a", 64), nativePNG(t), 400, "Invalid source SHA-256 or page reference."},
		{"1", "13", strings.Repeat("a", 64), nativePNG(t), 400, "Invalid source SHA-256 or page reference."},
		{"1", "1", strings.Repeat("A", 64), nativePNG(t), 400, "Invalid source SHA-256 or page reference."},
		{"1", "1", strings.Repeat("a", 64), nil, 413, "Page upload is empty or exceeds 3 MiB."},
	} {
		r := nativeCall(t, s.ocrPage, a, nativeRaw(t, "POST", test.body, map[string]string{"x-ocr-page": test.page, "x-ocr-pages": test.total, "x-ocr-source-sha256": test.sha, "content-type": "image/png"}))
		if r.Status != test.status || nativeMessage(t, r) != test.message {
			t.Fatalf("got %#v", r)
		}
	}
	if nativeOCRBusy.Load() {
		t.Fatal("OCR gate leaked")
	}
	nativeOCRBusy.Store(true)
	r := nativeCall(t, s.ocrPage, a, nativeRaw(t, "POST", nativePNG(t), nil))
	nativeOCRBusy.Store(false)
	if r.Status != 429 || r.Headers["Retry-After"] != "5" {
		t.Fatalf("got %#v", r)
	}
}
func TestNativeWindowDiscoveryHidesHost(t *testing.T) {
	s := nativeService()
	r := nativeCall(t, s.windowGet, erpwire.Actor{}, nativeRaw(t, "GET", nil, nil))
	if r.Status != 200 || r.Body.(map[string]any)["desktop"] != false {
		t.Fatalf("got %#v", r)
	}
}
func TestNativePullSanitization(t *testing.T) {
	source := io.NopCloser(strings.NewReader("{\"status\":\" pulling   layer \",\"digest\":\"private\",\"completed\":12,\"total\":20}\n{\"status\":\"success\"}\nno json\n"))
	reader := newNativePullStream(source)
	defer reader.Close()
	got, e := io.ReadAll(reader)
	want := "{\"completed\":12,\"status\":\"pulling layer\",\"total\":20}\n{\"done\":true,\"status\":\"success\"}\n{\"error\":\"The download sent a status this app could not read.\"}\n"
	if e != nil || string(got) != want {
		t.Fatalf("got %s, %v", got, e)
	}
}
func TestNativeCatalogPreservesMetadataAndHostFiltering(t *testing.T) {
	s := nativeService()
	s.native.Platform = "linux"
	s.native.Arch = "amd64"
	s.native.Models = &nativeModelFake{installed: []InstalledModel{{Name: "qwen3.5:4b", Size: 123}}}
	snapshot := s.nativeModelSnapshot(context.Background())
	rows := snapshot["rows"].([]erpwire.Row)
	if len(rows) != 2 || rows[0]["titleTh"] != "OCR ไทย/อังกฤษ · ต้องตรวจต้นฉบับ" || rows[0]["installed"] != true || rows[0]["installedBytes"] != int64(123) || rows[1]["installed"] != false || len(snapshot["blocked"].([]erpwire.Row)) != 5 {
		t.Fatalf("got %#v", snapshot)
	}
}
func TestNativeMoneyBoundariesReuseExactOCR(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want *int64
	}{{"1.01", nativeInt64(101)}, {"0.005", nil}, {"90,071,992,547,409.91", nativeInt64(9007199254740991)}, {"90,071,992,547,409.92", nil}} {
		got := localai.PrintedMoneySatang(test.raw)
		if got == nil && test.want != nil || got != nil && (test.want == nil || *got != *test.want) {
			t.Fatalf("%q got %v want %v", test.raw, got, test.want)
		}
	}
}
func nativeInt64(n int64) *int64 { return &n }

type nativeSeekFile struct{ *bytes.Reader }

func (f *nativeSeekFile) Close() error { return nil }

type nativeBackupFake struct {
	data                  []byte
	calls                 []string
	acl                   bool
	failRestore, failDrop bool
	role                  string
}

func (f *nativeBackupFake) Open(context.Context) (NativeBackupSession, error) {
	f.calls = append(f.calls, "open")
	return f, nil
}
func (f *nativeBackupFake) VerifyServer(context.Context) error {
	f.calls = append(f.calls, "verify")
	return nil
}
func (f *nativeBackupFake) Dump(context.Context) (NativeBackupFile, error) {
	f.calls = append(f.calls, "dump")
	return &nativeSeekFile{bytes.NewReader(f.data)}, nil
}
func (f *nativeBackupFake) RemoveCredentials(context.Context) error {
	f.calls = append(f.calls, "remove-credentials")
	return nil
}
func (f *nativeBackupFake) StageRestore(_ context.Context, r io.Reader) error {
	f.calls = append(f.calls, "stage")
	b, e := io.ReadAll(r)
	if !bytes.Equal(b, f.data) {
		return errors.New("wrong bytes staged")
	}
	return e
}
func (f *nativeBackupFake) ArchiveList(context.Context) (string, error) {
	f.calls = append(f.calls, "list")
	if f.acl {
		return "123; 0 0 ACL public TABLE test owner", nil
	}
	return "123; 0 0 TABLE public test owner", nil
}
func (f *nativeBackupFake) CreateRecoveryRole(_ context.Context, role string) error {
	f.calls = append(f.calls, "create-role")
	f.role = role
	return nil
}
func (f *nativeBackupFake) RestoreAsRole(_ context.Context, role string) error {
	f.calls = append(f.calls, "restore")
	if role != f.role {
		return errors.New("wrong recovery role")
	}
	if f.failRestore {
		return errors.New("uncertain")
	}
	return nil
}
func (f *nativeBackupFake) DropRecoveryRole(_ context.Context, role string) error {
	f.calls = append(f.calls, "drop-role")
	if role != f.role {
		return errors.New("wrong role cleanup")
	}
	if f.failDrop {
		return errors.New("cleanup")
	}
	return nil
}
func (f *nativeBackupFake) Close() error { f.calls = append(f.calls, "close"); return nil }
func nativeBackupForm(t *testing.T, dump []byte, checksum string, confirmed bool) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, e := writer.CreateFormFile("dump", "boombignose-20261108T010000Z.dump")
	if e != nil {
		t.Fatal(e)
	}
	_, _ = part.Write(dump)
	part, e = writer.CreateFormFile("checksum", "backup.sha256")
	if e != nil {
		t.Fatal(e)
	}
	_, _ = part.Write([]byte(checksum))
	if confirmed {
		_ = writer.WriteField("confirmation", "RESTORE ALL WORKSPACES")
		_ = writer.WriteField("trustedSource", "yes")
	}
	_ = writer.Close()
	return body.Bytes(), writer.FormDataContentType()
}
func TestNativeBackupExportPreservesScopeAndCloses(t *testing.T) {
	s := nativeService()
	fake := &nativeBackupFake{data: []byte("PGDMParchive")}
	s.native.Backup = fake
	r := nativeCall(t, s.backupExport, nativeActor(t, erpwire.Owner, true), nativeRaw(t, "POST", nil, nil))
	if r.Status != 200 || r.Headers["X-Backup-Scope"] != "database-only-all-workspaces" || r.Headers["X-Backup-Name"] != "boombignose-20261108T010000Z.dump" {
		t.Fatalf("got %#v", r)
	}
	if !nativeBackupBusy.Load() {
		t.Fatal("backup concurrency gate released before download")
	}
	stream := r.Body.(io.ReadCloser)
	data, e := io.ReadAll(stream)
	if e != nil || string(data) != "PGDMParchive" {
		t.Fatalf("got %s %v", data, e)
	}
	_ = stream.Close()
	if nativeBackupBusy.Load() || strings.Join(fake.calls, ",") != "open,verify,dump,remove-credentials,close" {
		t.Fatalf("calls %v busy %v", fake.calls, nativeBackupBusy.Load())
	}
}
func TestNativeBackupRestoreTransitionsAndCleanup(t *testing.T) {
	dump := []byte("PGDMParchive")
	sha := sha256.Sum256(dump)
	checksum := hex.EncodeToString(sha[:]) + "  boombignose-20261108T010000Z.dump\n"
	for _, test := range []struct {
		name                                  string
		checksum                              string
		confirmed, acl, failRestore, failDrop bool
		status                                int
		calls, message                        string
	}{
		{"missing confirmation", checksum, false, true, false, false, 400, "open,close", "Restore requires a trusted source and explicit RESTORE ALL WORKSPACES confirmation."},
		{"wrong hash", strings.Repeat("0", 64) + "  boombignose-20261108T010000Z.dump", true, true, false, false, 400, "open,close", "Backup checksum does not match. Nothing was restored."},
		{"ACL missing", checksum, true, false, false, false, 400, "open,stage,list,close", "Backup has no ACL metadata. Re-export from the trusted original database with owners and grants preserved. Nothing was restored."},
		{"success", checksum, true, true, false, false, 200, "open,stage,list,verify,create-role,restore,drop-role,close", ""},
		{"uncertain", checksum, true, true, true, false, 500, "open,stage,list,verify,create-role,restore,drop-role,close", "Restore did not complete successfully; its transaction outcome is uncertain. Inspect the database before retrying. No attachment or native secret files were restored."},
		{"cleanup overrides success", checksum, true, true, false, true, 500, "open,stage,list,verify,create-role,restore,drop-role,close", "Restore was applied, but recovery role or private staging cleanup failed. Reload the application and have the native administrator complete cleanup before another recovery."},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := nativeService()
			fake := &nativeBackupFake{data: dump, acl: test.acl, failRestore: test.failRestore, failDrop: test.failDrop}
			s.native.Backup = fake
			body, mime := nativeBackupForm(t, dump, test.checksum, test.confirmed)
			r := nativeCall(t, s.backupRestore, nativeActor(t, erpwire.Owner, true), nativeRaw(t, "POST", body, map[string]string{"content-type": mime}))
			if r.Status != test.status || strings.Join(fake.calls, ",") != test.calls || nativeBackupBusy.Load() {
				t.Fatalf("got %#v calls %v", r, fake.calls)
			}
			if test.message != "" && nativeMessage(t, r) != test.message {
				t.Fatalf("got %#v", r)
			}
			if strings.Contains(test.calls, "create-role") && (!strings.HasPrefix(fake.role, "boombignose_recovery_") || len(fake.role) != 53) {
				t.Fatalf("unsafe role %q", fake.role)
			}
		})
	}
}
func TestNativeBackupConstantTimeChecksumValidation(t *testing.T) {
	name := "boombignose-20261108T010000Z.dump"
	hash := strings.Repeat("a", 64)
	for _, test := range []struct {
		name, hash, line string
		want             bool
	}{{name, hash, hash + "  " + name + "\n", true}, {"../" + name, hash, hash + "  " + name, false}, {name, hash, strings.Repeat("a", 63) + "b  " + name, false}, {name, hash, hash + " *" + name, false}} {
		if got := nativeBackupChecksum(test.name, test.hash, test.line); got != test.want {
			t.Fatalf("got %v for %#v", got, test)
		}
	}
}

type nativeDesktopFake struct {
	asset            []byte
	checksum, staged []byte
	calls            []string
	fullscreen       bool
	version          string
	configured       bool
}

func (f *nativeDesktopFake) Configured() bool { return f.configured }
func (f *nativeDesktopFake) Fullscreen(_ context.Context, value *bool) (bool, error) {
	f.calls = append(f.calls, "fullscreen")
	if value != nil {
		f.fullscreen = *value
	}
	return f.fullscreen, nil
}
func (f *nativeDesktopFake) LatestRelease(context.Context) (json.RawMessage, error) {
	f.calls = append(f.calls, "release")
	version := f.version
	if version == "" {
		version = "1.6.0"
	}
	return json.RawMessage(`{"tag_name":"boombignose-v` + version + `","html_url":"https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v` + version + `"}`), nil
}
func (f *nativeDesktopFake) Download(_ context.Context, address string) (io.ReadCloser, int64, error) {
	if !NativeDownloadAllowed(address, false) {
		return nil, 0, errors.New("unsafe download")
	}
	if strings.HasSuffix(address, "SHA256SUMS") {
		f.calls = append(f.calls, "sums")
		return io.NopCloser(bytes.NewReader(f.checksum)), int64(len(f.checksum)), nil
	}
	f.calls = append(f.calls, "download")
	return io.NopCloser(bytes.NewReader(f.asset)), int64(len(f.asset)), nil
}
func (f *nativeDesktopFake) Stage(_ context.Context, name string, r io.Reader) error {
	f.calls = append(f.calls, "stage:"+name)
	var e error
	f.staged, e = io.ReadAll(r)
	return e
}
func (f *nativeDesktopFake) RemoveStage(_ context.Context, name string) error {
	f.calls = append(f.calls, "remove:"+name)
	return nil
}
func (f *nativeDesktopFake) CommitStage(_ context.Context, from, to string) error {
	f.calls = append(f.calls, "commit:"+from+":"+to)
	return nil
}
func (f *nativeDesktopFake) Apply(_ context.Context, version, file string) error {
	f.calls = append(f.calls, "apply:"+version+":"+file)
	return nil
}
func TestNativeDesktopUpdateIntegrityAndPhases(t *testing.T) {
	for _, valid := range []bool{false, true} {
		t.Run(strconvNative(map[bool]int{false: 0, true: 1}[valid]), func(t *testing.T) {
			s := nativeService()
			asset := []byte("trusted disk image")
			sha := sha256.Sum256(asset)
			digest := hex.EncodeToString(sha[:])
			if !valid {
				digest = strings.Repeat("0", 64)
			}
			fake := &nativeDesktopFake{configured: true, asset: asset, checksum: []byte(digest + "  " + nativeMacAsset + "\n")}
			s.native.Desktop = fake
			phases := []string{}
			e := s.performNativeUpdate(context.Background(), func(event erpwire.Row) { phases = append(phases, text(event["phase"])) })
			if valid {
				if e != nil || !bytes.Equal(fake.staged, asset) || strings.Join(phases, ",") != "sums,download,download,verify,restart,apply" || fake.calls[len(fake.calls)-1] != "apply:1.6.0:"+nativeMacAsset {
					t.Fatalf("error %v phases %v calls %v", e, phases, fake.calls)
				}
			} else {
				if e == nil || e.Error() != "The update file did not match SHA256SUMS." || fake.calls[len(fake.calls)-1] != "remove:"+nativeMacAsset+".partial" {
					t.Fatalf("error %v calls %v", e, fake.calls)
				}
				for _, call := range fake.calls {
					if strings.HasPrefix(call, "apply:") || strings.HasPrefix(call, "commit:") {
						t.Fatalf("unverified image installed %v", fake.calls)
					}
				}
			}
		})
	}
}
func TestNativeDesktopDownloadAndChecksumAllowlist(t *testing.T) {
	for _, test := range []struct {
		url            string
		redirect, want bool
	}{
		{"https://github.com/Boom-Vitt/nose-erp/releases/download/boombignose-v1.6.0/" + nativeMacAsset, false, true},
		{"https://github.com/Boom-Vitt/nose-erp/releases/download/boombignose-v1.6.0/file?auth=token", false, false},
		{"https://github.com.attacker.test/download", true, false},
		{"https://token@github.com/path", true, false},
		{"http://github.com/path", true, false},
		{"https://release-assets.githubusercontent.com/asset?sig=x", true, true},
	} {
		if got := NativeDownloadAllowed(test.url, test.redirect); got != test.want {
			t.Fatalf("%s got %v", test.url, got)
		}
	}
	sha := strings.Repeat("a", 64)
	if nativeChecksum([]byte(sha+"  "+nativeMacAsset+"\n"+strings.Repeat("b", 64)+"  "+nativeMacAsset), nativeMacAsset) != "" {
		t.Fatal("conflicting checksum accepted")
	}
	if nativeChecksum([]byte(sha+"  "+nativeMacAsset+"\nmalformed"), nativeMacAsset) != "" {
		t.Fatal("malformed checksum line accepted")
	}
}
func TestNativeDesktopUpdateNoHostWorkBeforeCapability(t *testing.T) {
	s := nativeService()
	s.native.Platform = "linux"
	fake := &nativeDesktopFake{configured: true}
	s.native.Desktop = fake
	e := s.performNativeUpdate(context.Background(), func(erpwire.Row) {})
	if e == nil || e.Error() != nativeDeferred || len(fake.calls) != 0 {
		t.Fatalf("error %v calls %v", e, fake.calls)
	}
	s.native.Platform = "darwin"
	fake.configured = false
	e = s.performNativeUpdate(context.Background(), func(erpwire.Row) {})
	if e == nil || e.Error() != nativeWindowMessage || len(fake.calls) != 0 {
		t.Fatalf("error %v calls %v", e, fake.calls)
	}
}
func TestNativeReleaseResponseMustMatchCanonicalLink(t *testing.T) {
	for _, raw := range []string{`{"tag_name":"boombignose-v1.6.0","html_url":"https://attacker.test/download"}`, `{"tag_name":"release1.6.0","html_url":"https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.6.0"}`} {
		got := NativeReleaseCheck(json.RawMessage(raw), "1.5.0")
		if got["state"] != "unavailable" || got["message"] != "The release page could not be read." {
			t.Fatalf("got %#v", got)
		}
	}
	got := NativeReleaseCheck(json.RawMessage(`{"tag_name":"v1.6.0","html_url":"https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.6.0"}`), "1.5.0")
	if got["state"] != "available" || got["version"] != "1.6.0" {
		t.Fatalf("got %#v", got)
	}
}
