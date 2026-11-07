package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func securityService() *Service {
	return &Service{now: func() time.Time { return mnNow }, origins: []string{"http://127.0.0.1:3100", "https://erp.example.test"}, security: SecurityOptions{Native: true, AuthBase: "http://127.0.0.1:54321", AnonKey: "anon", ForbiddenServiceKey: "private"}}
}
func securityRequest(r Request) json.RawMessage { b, _ := json.Marshal([]Request{r}); return b }
func securityResponse(t *testing.T, fn erpwire.Operation, r Request) Response {
	t.Helper()
	v, e := fn(context.Background(), erpwire.Actor{}, securityRequest(r))
	if e != nil {
		t.Fatal(e)
	}
	return v.(Response)
}
func TestTrustedOriginUsesOnlyExplicitConfiguration(t *testing.T) {
	s := securityService()
	for _, tc := range []struct {
		name             string
		r                Request
		trusted, browser bool
	}{
		{"origin", Request{Method: "POST", Headers: map[string]string{"Origin": "http://127.0.0.1:3100"}}, true, true},
		{"referer GET", Request{Method: "GET", Headers: map[string]string{"Referer": "https://erp.example.test/settings"}}, false, true},
		{"empty Origin never falls back", Request{Method: "GET", Headers: map[string]string{"Origin": "", "Referer": "https://erp.example.test/settings"}}, false, false},
		{"host cannot authorize", Request{Method: "POST", Headers: map[string]string{"Host": "erp.example.test", "Origin": "https://attacker.test"}}, false, false},
		{"cross site", Request{Method: "POST", Headers: map[string]string{"Origin": "https://erp.example.test", "sec-fetch-site": "cross-site"}}, false, false},
		{"referer not a mutation proof", Request{Method: "POST", Headers: map[string]string{"Referer": "https://erp.example.test"}}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if s.trustedOrigin(tc.r) != tc.trusted || s.trustedBrowser(tc.r) != tc.browser {
				t.Fatalf("origin %v browser %v", s.trustedOrigin(tc.r), s.trustedBrowser(tc.r))
			}
		})
	}
	if got := configuredOrigins([]string{"https://erp.example.test/", "https://erp.example.test", "http://public.test", "https://user:pass@private.test", "https://example.test/path"}); !reflect.DeepEqual(got, []string{"https://erp.example.test"}) {
		t.Fatalf("configuration accepted unsafe origins %v", got)
	}
}
func TestSafeReturnPaths(t *testing.T) {
	for _, tc := range []struct{ in, want string }{{"/clients?x=1#contact", "/clients?x=1#contact"}, {"//attacker.test", "/dashboard"}, {"/%2fattacker.test", "/dashboard"}, {"/\\attacker.test", "/dashboard"}, {"/auth/local/token", "/dashboard"}, {"/login?redirect=/clients", "/dashboard"}, {"https://attacker.test", "/dashboard"}, {"/%00bad", "/dashboard"}, {"/bad%", "/dashboard"}, {"/one/../clients", "/clients"}} {
		if got := SafeReturnPath(tc.in); got != tc.want {
			t.Errorf("%q -> %q want %q", tc.in, got, tc.want)
		}
	}
}
func TestAuthProxyAllowlistAndQuery(t *testing.T) {
	s := securityService()
	calls := 0
	s.security.AuthTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "http://127.0.0.1:54321/auth/v1/token?grant_type=password" || r.Header.Get("cookie") != "" || r.Header.Get("authorization") != "Bearer user.token" || r.Header.Get("apikey") != "anon" {
			t.Fatalf("unsafe request %+v", r)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"access_token":"test"}`))}, nil
	})
	r := Request{Method: "POST", URL: "http://evil.test/auth/local/token?grant_type=password", Headers: map[string]string{"Origin": "http://127.0.0.1:3100", "Authorization": "Bearer user.token", "Cookie": "must-not-forward=1"}, Params: map[string]string{"path": "token"}, Body: []byte(`{"password":"example"}`)}
	out := securityResponse(t, s.nativeAuth, r)
	if out.Status != 200 || calls != 1 || out.Headers["x-content-type-options"] != "nosniff" {
		t.Fatalf("result %#v", out)
	}
	for _, tc := range []struct {
		path, url, method string
		status            int
		message           string
	}{{"rest/v1/profiles", r.URL, "POST", 404, "Auth operation not available."}, {"admin/users", r.URL, "GET", 404, "Auth operation not available."}, {"token", "http://localhost/auth?redirect_to=https://evil.test", "POST", 400, "Invalid Auth query."}, {"user", "http://localhost/auth", "DELETE", 404, "Auth operation not available."}} {
		copy := r
		copy.Params = map[string]string{"path": tc.path}
		copy.URL = tc.url
		copy.Method = tc.method
		result := securityResponse(t, s.nativeAuth, copy)
		if result.Status != tc.status || mnResponseError(result) != tc.message {
			t.Fatalf("unsafe endpoint %+v", result)
		}
	}
	if calls != 1 {
		t.Fatal("denied request reached upstream")
	}
}
func TestAuthProxyResponseAndSizeLimits(t *testing.T) {
	for _, tc := range []struct {
		status     int
		kind, body string
		want       int
		message    string
	}{{302, "application/json", "{}", 502, "Auth redirect refused."}, {200, "text/html", "private diagnostics", 502, "Auth service unavailable."}, {503, "application/json", "private diagnostics", 502, "Authentication failed. Check your credentials or authenticator."}, {429, "application/json", "private diagnostics", 429, "Too many attempts. Please try again later."}, {200, "application/json", strings.Repeat("x", 256*1024+1), 413, "Auth payload too large."}} {
		s := securityService()
		s.security.AuthTransport = roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": []string{tc.kind}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})
		r := Request{Method: "POST", URL: "http://localhost/auth", Headers: map[string]string{"origin": "http://127.0.0.1:3100"}, Params: map[string]string{"path": "token"}}
		out := securityResponse(t, s.nativeAuth, r)
		if out.Status != tc.want || mnResponseError(out) != tc.message {
			t.Fatalf("response %+v", out)
		}
	}
	s := securityService()
	r := Request{Method: "POST", URL: "http://localhost/auth", Headers: map[string]string{"origin": "http://127.0.0.1:3100", "content-length": "32769"}, Params: map[string]string{"path": "token"}}
	if out := securityResponse(t, s.nativeAuth, r); out.Status != 413 {
		t.Fatalf("declared oversized body %+v", out)
	}
	s.security.AuthBase = "https://public.test"
	if out := securityResponse(t, s.nativeAuth, r); out.Status != 503 {
		t.Fatal("non-loopback upstream accepted")
	}
	s.security.AuthBase = "http://127.0.0.1:54321"
	s.security.AnonKey = "private"
	if out := securityResponse(t, s.nativeAuth, r); out.Status != 503 {
		t.Fatal("service credential accepted")
	}
}
func TestAuthEnrollmentGetsSeparateResponseLimit(t *testing.T) {
	s := securityService()
	payload := `{"svg":"` + strings.Repeat("x", 400*1024) + `"}`
	s.security.AuthTransport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(payload))}, nil
	})
	r := Request{Method: "POST", URL: "http://localhost/auth", Headers: map[string]string{"origin": "http://127.0.0.1:3100"}, Params: map[string]string{"path": "factors"}}
	out := securityResponse(t, s.nativeAuth, r)
	if out.Status != 200 || string(out.Body.(json.RawMessage)) != payload {
		t.Fatal("enrollment QR truncated")
	}
}

type securityAuth struct {
	current     bool
	exchangeErr error
	signouts    int
}

func (a *securityAuth) ExchangeCode(context.Context, string) ([]string, error) {
	return []string{"session=verified; HttpOnly"}, a.exchangeErr
}
func (a *securityAuth) VerifyEmailOTP(context.Context, string, string) ([]string, error) {
	return a.ExchangeCode(context.Background(), "")
}
func (a *securityAuth) CurrentUser(context.Context) (erpwire.VerifiedIdentity, error) {
	if a.current {
		return erpwire.VerifiedIdentity{UserID: mnUser}, nil
	}
	return erpwire.VerifiedIdentity{}, errors.New("signed out")
}
func (a *securityAuth) SignOut(context.Context, string) ([]string, error) {
	a.signouts++
	return []string{"provider=; Max-Age=0"}, nil
}
func TestConfirmationAndLogoutTransitions(t *testing.T) {
	s := securityService()
	auth := &securityAuth{}
	s.security.Auth = auth
	r := Request{Method: "GET", URL: "http://evil.test/auth/confirm?code=verified&redirect=%2Fclients", Headers: map[string]string{"Host": "evil.test", "x-forwarded-host": "evil.test"}}
	out := securityResponse(t, s.confirmEmail, r)
	if out.Status != 303 || out.Headers["location"] != "http://127.0.0.1:3100/clients" || len(out.Cookies) != 1 {
		t.Fatalf("confirmation %#v", out)
	}
	auth.exchangeErr = errors.New("consumed")
	auth.current = true
	out = securityResponse(t, s.confirmEmail, r)
	if out.Headers["location"] != "http://127.0.0.1:3100/clients" {
		t.Fatal("consumed link discarded session")
	}
	auth.current = false
	out = securityResponse(t, s.confirmEmail, r)
	if out.Headers["location"] != "http://127.0.0.1:3100/login?error=consumed" {
		t.Fatalf("incorrect error redirect %v", out)
	}
	r = Request{Method: "POST", URL: "http://evil.test/auth/signout", Headers: map[string]string{"Origin": "https://erp.example.test", "Cookie": "sb-127-auth-token.0=a; sb-127-auth-token.1=b; sb-127-auth-token-code-verifier=c; unrelated=keep; active_org=x"}}
	out = securityResponse(t, s.signout, r)
	if auth.signouts != 1 || out.Headers["location"] != "https://erp.example.test/login" || len(out.Cookies) != 5 {
		t.Fatalf("logout %#v", out)
	}
	for _, cookie := range out.Cookies {
		if strings.HasPrefix(cookie, "unrelated=") {
			t.Fatal("unrelated cookie deleted")
		}
	}
	r.Headers["Origin"] = "https://attacker.test"
	out = securityResponse(t, s.signout, r)
	if out.Status != 403 || auth.signouts != 1 {
		t.Fatal("untrusted logout accepted")
	}
}
func TestLocaleRequiresRealRequestActorAndSelfScope(t *testing.T) {
	db := &settingsStore{rows: map[string][]erpwire.Row{"profiles": {{"id": mnUser, "locale": "th"}, {"id": mnDevice, "locale": "th"}}}}
	s := securityService()
	s.store = db
	actor := mnActor(t, erpwire.Member)
	r := Request{Method: "POST", Headers: map[string]string{"Origin": "https://erp.example.test"}}
	ctx := WithRequest(context.Background(), r)
	for _, tc := range []struct {
		ctx    context.Context
		a      erpwire.Actor
		locale string
		want   bool
	}{{context.Background(), actor, "en", false}, {ctx, erpwire.Actor{}, "en", false}, {ctx, actor, "es", false}, {ctx, actor, "en", true}} {
		got, e := s.saveLoginLocale(tc.ctx, tc.a, settingsArgs(tc.locale))
		if e != nil || got != tc.want {
			t.Fatalf("locale %v %v", got, e)
		}
	}
	if db.rows["profiles"][0]["locale"] != "en" || db.rows["profiles"][1]["locale"] != "th" {
		t.Fatal("profile scope failed")
	}
}
func TestLogsAreBoundedRedactedAndConfined(t *testing.T) {
	directory := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside")
	if e := os.WriteFile(outside, []byte("private"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(outside, filepath.Join(directory, "auth.log")); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(directory, "server.log"), []byte(strings.Repeat("x", 65536)+"\npassword=hidden token:secret postgres://user:password@host/db\n"), 0600); e != nil {
		t.Fatal(e)
	}
	s := securityService()
	s.security.DataDir = directory
	actor := mnActor(t, erpwire.Owner)
	for _, tc := range []struct{ name, error string }{{"../outside", "That log is not available."}, {"auth.log", "That log cannot be read."}, {"postgrest.log", "That log is not on this computer yet."}} {
		value, e := s.readLocalLog(context.Background(), actor, settingsArgs(tc.name))
		if e != nil || value.(erpwire.Row)["error"] != tc.error {
			t.Fatalf("log boundary %v %v", value, e)
		}
	}
	value, e := s.readLocalLog(context.Background(), actor, settingsArgs("server.log"))
	if e != nil {
		t.Fatal(e)
	}
	got := text(value.(erpwire.Row)["text"])
	if got != "password=[redacted] token:[redacted] [redacted]\n" {
		t.Fatalf("log redaction %q", got)
	}
}
