package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testHelper(t *testing.T) *Helper {
	t.Helper()
	dir := t.TempDir()
	helper, err := Start(dir)
	if err != nil {
		t.Fatal(err)
	}
	helper.quitDelay = -1
	t.Cleanup(func() { _ = helper.server.Close() })
	return helper
}

func postApply(t *testing.T, helper *Helper, token, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, helper.BaseURL+"/v1/apply", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func writeAsset(t *testing.T, dir string, body []byte) string {
	t.Helper()
	path := filepath.Join(dir, MacOSAsset)
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func futureUpdateVersion(t *testing.T) string {
	t.Helper()
	var major, minor, patch uint
	if n, err := fmt.Sscanf(AppVersion, "%d.%d.%d", &major, &minor, &patch); err != nil || n != 3 {
		t.Fatalf("invalid installed version %q: %v", AppVersion, err)
	}
	return fmt.Sprintf("%d.0.0", major+1)
}

func TestApplyRequiresTheTokenAndAMatchingChecksum(t *testing.T) {
	helper := testHelper(t)
	version := futureUpdateVersion(t)
	requestBody := fmt.Sprintf(`{"version":%q,"file":%q}`, version, MacOSAsset)
	body := []byte("disk-image")
	hash := writeAsset(t, helper.dir, body)
	helper.sums = func(version, file string) (string, error) {
		if version != futureUpdateVersion(t) || file != MacOSAsset {
			t.Fatalf("sums lookup %s %s", version, file)
		}
		return hash, nil
	}
	called := false
	helper.apply = func(context.Context, string, string) error {
		called = true
		return nil
	}
	quit := false
	helper.SetQuit(func() { quit = true })

	denied := postApply(t, helper, "", requestBody)
	if denied.StatusCode != http.StatusUnauthorized || called {
		t.Fatalf("unauthorized: %d called=%v", denied.StatusCode, called)
	}

	wrong := postApply(t, helper, strings.Repeat("ab", 32), requestBody)
	if wrong.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d", wrong.StatusCode)
	}

	helper.sums = func(string, string) (string, error) { return strings.Repeat("c", 64), nil }
	mismatch := postApply(t, helper, helper.Token, requestBody)
	payload, _ := io.ReadAll(mismatch.Body)
	if mismatch.StatusCode != http.StatusBadRequest || !bytes.Contains(payload, []byte("checksum")) || called {
		t.Fatalf("mismatch: %d %s called=%v", mismatch.StatusCode, payload, called)
	}

	helper.sums = func(string, string) (string, error) { return hash, nil }
	ok := postApply(t, helper, helper.Token, requestBody)
	if ok.StatusCode != http.StatusOK || !called || !quit {
		raw, _ := io.ReadAll(ok.Body)
		t.Fatalf("apply: %d %s called=%v quit=%v", ok.StatusCode, raw, called, quit)
	}
	if strings.Contains(helper.BaseURL, "0.0.0.0") || !strings.HasPrefix(helper.BaseURL, "http://127.0.0.1:") {
		t.Fatalf("listener: %s", helper.BaseURL)
	}
}

func TestApplyRefusesDowngradeTraversalAndDeferredReplace(t *testing.T) {
	helper := testHelper(t)
	version := futureUpdateVersion(t)
	requestBody := fmt.Sprintf(`{"version":%q,"file":%q}`, version, MacOSAsset)
	hash := writeAsset(t, helper.dir, []byte("disk-image"))
	helper.sums = func(string, string) (string, error) { return hash, nil }
	helper.apply = func(context.Context, string, string) error {
		t.Fatal("apply should not run")
		return nil
	}
	old := postApply(t, helper, helper.Token, `{"version":"1.3.0","file":"BoomBigNose-macos-arm64.dmg"}`)
	if old.StatusCode != http.StatusBadRequest {
		t.Fatalf("downgrade: %d", old.StatusCode)
	}
	escape := postApply(t, helper, helper.Token, fmt.Sprintf(`{"version":%q,"file":%q}`, version, "../"+MacOSAsset))
	if escape.StatusCode != http.StatusBadRequest {
		t.Fatalf("traversal: %d", escape.StatusCode)
	}
	helper.apply = func(context.Context, string, string) error { return ErrDeferred }
	deferred := postApply(t, helper, helper.Token, requestBody)
	var decoded map[string]string
	if err := json.NewDecoder(deferred.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if deferred.StatusCode != http.StatusConflict || decoded["error"] != "deferred" {
		t.Fatalf("deferred: %d %+v", deferred.StatusCode, decoded)
	}
}

func TestListenerStaysOnLoopback(t *testing.T) {
	helper := testHelper(t)
	if !strings.Contains(helper.Token, "") || len(helper.Token) != 64 {
		t.Fatalf("token length %d", len(helper.Token))
	}
	req, err := http.NewRequest(http.MethodGet, helper.BaseURL+"/v1/status", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+helper.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if _, ok := body["apply"].(bool); !ok {
		t.Fatalf("status body %#v", body)
	}
	if strings.Contains(string(mustJSON(body)), helper.Token) {
		t.Fatal("status leaked the token")
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func TestFullscreenRouteNeedsTheTokenAndAWindow(t *testing.T) {
	helper := testHelper(t)
	call := func(method, token, body string) (*http.Response, string) {
		req, _ := http.NewRequest(method, helper.BaseURL+"/v1/fullscreen", strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out, _ := io.ReadAll(res.Body)
		return res, strings.TrimSpace(string(out))
	}
	if res, _ := call(http.MethodGet, "", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d", res.StatusCode)
	}
	if res, _ := call(http.MethodGet, helper.Token, ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("no window: %d", res.StatusCode)
	}
	on := false
	helper.SetWindow(Window{IsFullscreen: func() bool { return on }, SetFullscreen: func(v bool) { on = v }})
	if _, out := call(http.MethodPost, helper.Token, `{"fullscreen":true}`); out != `{"fullscreen":true}` || !on {
		t.Fatalf("set: %s on=%v", out, on)
	}
	if res, _ := call(http.MethodPost, helper.Token, `nope`); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad body: %d", res.StatusCode)
	}
}
