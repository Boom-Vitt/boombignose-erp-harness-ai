package erpplatform

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type WorkspaceSession interface {
	ActivateWorkspace(context.Context, erpwire.Actor, string) error
}

// SessionAuth must authenticate live provider state and attach every returned
// session cookie to this request's response. No cached user or decoded JWT suffices.
type SessionAuth interface {
	ExchangeCode(context.Context, string) ([]string, error)
	VerifyEmailOTP(context.Context, string, string) ([]string, error)
	CurrentUser(context.Context) (erpwire.VerifiedIdentity, error)
	SignOut(context.Context, string) ([]string, error)
}
type SettingsProbe interface {
	Models(context.Context) (any, error)
	ASR(context.Context) (any, error)
	MCP(context.Context, erpwire.Actor) (bool, error)
}
type SecurityOptions struct {
	Workspaces             WorkspaceSession
	Auth                   SessionAuth
	Probe                  SettingsProbe
	AppURL                 string
	ModelHost              string
	ProEdition             bool
	AccountingTokenSet     bool
	TotpEnroll             bool
	Native                 bool
	AuthBase               string
	AnonKey                string
	ForbiddenServiceKey    string
	AuthTransport          http.RoundTripper
	ReleaseTransport       http.RoundTripper
	DataDir                string
	Version                string
	Platform               string
	Arch                   string
	UpdateHelperConfigured bool
}
type requestContextKey struct{}

// WithRequest is called by a trusted HTTP adapter for server actions needing
// request headers. The public RPC decoder must never set this context value.
func WithRequest(ctx context.Context, r Request) context.Context {
	return context.WithValue(ctx, requestContextKey{}, r)
}
func (s *Service) securityOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/auth/confirm/route.ts::GET":                      s.confirmEmail,
		"app/auth/signout/route.ts::POST":                     s.signout,
		"app/auth/local/[...path]/route.ts::GET":              s.nativeAuth,
		"app/auth/local/[...path]/route.ts::POST":             s.nativeAuth,
		"app/auth/local/[...path]/route.ts::DELETE":           s.nativeAuth,
		"app/login/actions.ts::saveLoginLocale":               s.saveLoginLocale,
		"app/(app)/settings/security/page.tsx::load":          s.securityPage,
		"app/(app)/settings/local-actions.ts::readLocalLog":   s.readLocalLog,
		"app/(app)/settings/local-actions.ts::checkForUpdate": s.checkForUpdate,
		"app/forbidden.tsx::load": func(_ context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
			if _, e := arguments(raw, 0, 0); e != nil {
				return nil, e
			}
			return erpwire.Row{"status": 403, "label": "403 · Access restricted / จำกัดสิทธิ์การเข้าถึง", "title": "This workspace action is not available to your session.", "description": "Your role may not allow this page, or session assurance could not be verified. Ask a workspace owner for access, or sign in again and complete your authenticator check.", "thai": "หน้านี้ต้องใช้สิทธิ์ที่เหมาะสมและยืนยันตัวตนสำเร็จ โปรดติดต่อเจ้าของพื้นที่ทำงานหรือเข้าสู่ระบบอีกครั้ง", "links": []erpwire.Row{{"href": "/dashboard", "label": "Back to workspace"}, {"href": "/login/mfa", "label": "Verify authenticator"}}}, nil
		},
	}
}
func secretEqual(left, right string) bool {
	a, b := sha256.Sum256([]byte(left)), sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}
func SafeReturnPath(value string) string {
	if !strings.HasPrefix(value, "/") {
		return "/dashboard"
	}
	decoded, e := url.PathUnescape(value)
	if e != nil || !utf8.ValidString(decoded) || strings.HasPrefix(decoded, "//") {
		return "/dashboard"
	}
	for _, r := range decoded {
		if r == '\\' || r <= 32 {
			return "/dashboard"
		}
	}
	base, _ := url.Parse("https://local.invalid")
	relative, e := url.Parse(value)
	if e != nil {
		return "/dashboard"
	}
	target := base.ResolveReference(relative)
	if target.Scheme != "https" || target.Host != "local.invalid" {
		return "/dashboard"
	}
	segments := strings.Split(target.EscapedPath(), "/")
	normalized := []string{}
	for i, segment := range segments {
		dot, _ := url.PathUnescape(segment)
		switch dot {
		case ".":
			if i == len(segments)-1 {
				normalized = append(normalized, "")
			}
		case "..":
			if len(normalized) > 1 {
				normalized = normalized[:len(normalized)-1]
			}
			if i == len(segments)-1 {
				normalized = append(normalized, "")
			}
		default:
			normalized = append(normalized, segment)
		}
	}
	escaped := strings.Join(normalized, "/")
	target.Path, _ = url.PathUnescape(escaped)
	target.RawPath = escaped
	for _, prefix := range []string{"/login", "/signup", "/auth"} {
		if target.EscapedPath() == prefix || strings.HasPrefix(target.EscapedPath(), prefix+"/") {
			return "/dashboard"
		}
	}
	return target.RequestURI() + fragment(target)
}
func fragment(u *url.URL) string {
	if u.Fragment != "" {
		return "#" + u.EscapedFragment()
	}
	return ""
}
func (s *Service) redirectRequest(r Request, path string) (Response, error) {
	origin, e := s.appOrigin(r)
	if e != nil {
		return Response{}, e
	}
	base, _ := url.Parse(origin)
	relative, e := url.Parse(path)
	if e != nil {
		return Response{}, e
	}
	return Response{Status: 303, Headers: map[string]string{"location": base.ResolveReference(relative).String(), "cache-control": "no-store"}}, nil
}
func (s *Service) confirmEmail(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	u, e := url.Parse(r.URL)
	if e != nil {
		return nil, erpwire.ErrBadArguments
	}
	params := u.Query()
	message := "Invalid or expired confirmation link."
	cookies := []string{}
	success := false
	if s.security.Auth != nil {
		if code := params.Get("code"); code != "" {
			cookies, e = s.security.Auth.ExchangeCode(ctx, code)
			success = e == nil
			if e != nil {
				message = e.Error()
			}
		} else if token, kind := params.Get("token_hash"), params.Get("type"); token != "" && kind != "" {
			cookies, e = s.security.Auth.VerifyEmailOTP(ctx, kind, token)
			success = e == nil
			if e != nil {
				message = e.Error()
			}
		}
		if !success {
			identity, err := s.security.Auth.CurrentUser(ctx)
			success = err == nil && identity.UserID != ""
		}
	}
	path := "/login?error=" + url.QueryEscape(message)
	if success {
		path = SafeReturnPath(params.Get("redirect"))
	}
	out, e := s.redirectRequest(r, path)
	out.Cookies = cookies
	return out, e
}
func (s *Service) signout(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if !s.trustedOrigin(r) {
		return jsonResponse(403, erpwire.Row{"error": "Untrusted request origin."}), nil
	}
	out, e := s.redirectRequest(r, "/login")
	if e != nil {
		return nil, e
	}
	if s.security.Auth == nil {
		return nil, errors.New("session authentication is unavailable")
	}
	out.Cookies, _ = s.security.Auth.SignOut(ctx, header(r, "cookie"))
	base, e := url.Parse(s.security.AuthBase)
	if e != nil || base.Host == "" {
		return nil, errors.New("Auth is not configured.")
	}
	key := "sb-" + strings.Split(base.Hostname(), ".")[0] + "-auth-token"
	names := []string{"active_org"}
	for _, part := range strings.Split(header(r, "cookie"), ";") {
		name, _, _ := strings.Cut(strings.TrimSpace(part), "=")
		name = strings.TrimSpace(name)
		if name == key || strings.HasPrefix(name, key+".") || strings.HasPrefix(name, key+"-") {
			names = append(names, name)
		}
	}
	for _, name := range names {
		if !validCookieName(name) {
			continue
		}
		out.Cookies = append(out.Cookies, name+"=; Path=/; Max-Age=0; SameSite=Lax")
	}
	return out, nil
}
func validCookieName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if r <= 32 || r >= 127 || strings.ContainsRune("()<>@,;:\\\"/[]?={}", r) {
			return false
		}
	}
	return true
}

var authFactor = regexp.MustCompile(`^factors/[a-fA-F0-9-]{36}$`)
var authChallenge = regexp.MustCompile(`^factors/[a-fA-F0-9-]{36}/(challenge|verify)$`)
var authBearer = regexp.MustCompile(`^Bearer [A-Za-z0-9._-]+$`)

func AllowedAuthEndpoint(path, method string) bool {
	return method == "POST" && (path == "token" || path == "logout" || path == "factors" || authChallenge.MatchString(path)) || method == "GET" && path == "user" || method == "DELETE" && authFactor.MatchString(path)
}
func authResponse(status int, message string) Response {
	return jsonResponse(status, erpwire.Row{"error": message, "msg": message})
}
func (s *Service) nativeAuth(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if !s.security.Native {
		return authResponse(404, "Not found."), nil
	}
	if !s.trustedBrowser(r) {
		return authResponse(403, "Untrusted request origin."), nil
	}
	path := r.Params["path"]
	if !AllowedAuthEndpoint(path, r.Method) {
		return authResponse(404, "Auth operation not available."), nil
	}
	incoming, e := url.Parse(r.URL)
	if e != nil {
		return nil, erpwire.ErrBadArguments
	}
	query, e := url.ParseQuery(incoming.RawQuery)
	if e != nil {
		return authResponse(400, "Invalid Auth query."), nil
	}
	params := url.Values{}
	for key, values := range query {
		for _, value := range values {
			if path == "token" && key == "grant_type" && contains([]string{"password", "refresh_token"}, value) || path == "logout" && key == "scope" && contains([]string{"global", "local", "others"}, value) {
				params.Set(key, value)
			} else {
				return authResponse(400, "Invalid Auth query."), nil
			}
		}
	}
	base, e := url.Parse(s.security.AuthBase)
	if e != nil || base.Scheme != "http" || !loopback(base.Hostname()) || base.User != nil || (base.Path != "" && base.Path != "/") || base.RawQuery != "" || base.Fragment != "" || s.security.AnonKey == "" || secretEqual(s.security.AnonKey, s.security.ForbiddenServiceKey) {
		return authResponse(503, "Auth is not configured."), nil
	}
	authorization := header(r, "authorization")
	if authorization != "" && (!authBearer.MatchString(authorization) || secretEqual(authorization, "Bearer "+s.security.ForbiddenServiceKey)) {
		return authResponse(401, "Invalid authorization."), nil
	}
	if r.Method != "GET" && boundedBody(r, 32*1024) != nil {
		return authResponse(413, "Auth payload too large."), nil
	}
	if s.security.AuthTransport == nil {
		return authResponse(502, "Auth service unavailable."), nil
	}
	requestURL := *base
	requestURL.Path = "/auth/v1/" + path
	requestURL.RawQuery = params.Encode()
	var body io.Reader
	if r.Method != "GET" {
		body = strings.NewReader(string(r.Body))
	}
	request, e := http.NewRequestWithContext(ctx, r.Method, requestURL.String(), body)
	if e != nil {
		return authResponse(502, "Auth service unavailable."), nil
	}
	request.Header.Set("apikey", s.security.AnonKey)
	request.Header.Set("content-type", "application/json")
	request.Header.Set("accept", "application/json")
	if authorization != "" {
		request.Header.Set("authorization", authorization)
	}
	client := http.Client{Transport: s.security.AuthTransport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	upstream, e := client.Do(request)
	if e != nil {
		return authResponse(502, "Auth service unavailable."), nil
	}
	defer upstream.Body.Close()
	if upstream.StatusCode >= 300 && upstream.StatusCode < 400 {
		return authResponse(502, "Auth redirect refused."), nil
	}
	if upstream.StatusCode == 204 {
		return Response{Status: 204, Headers: map[string]string{"cache-control": "no-store"}}, nil
	}
	if !strings.Contains(upstream.Header.Get("content-type"), "application/json") {
		return authResponse(502, "Auth service unavailable."), nil
	}
	maximum := 256 * 1024
	if path == "factors" && r.Method == "POST" {
		maximum = 1024 * 1024
	}
	bytes, e := io.ReadAll(io.LimitReader(upstream.Body, int64(maximum)+1))
	if e != nil {
		return authResponse(502, "Auth service unavailable."), nil
	}
	if len(bytes) > maximum || upstream.ContentLength > int64(maximum) {
		return authResponse(413, "Auth payload too large."), nil
	}
	if upstream.StatusCode < 200 || upstream.StatusCode >= 300 {
		message := "Authentication failed. Check your credentials or authenticator."
		if upstream.StatusCode == 429 {
			message = "Too many attempts. Please try again later."
		}
		status := upstream.StatusCode
		if status >= 500 {
			status = 502
		}
		return authResponse(status, message), nil
	}
	return Response{Status: upstream.StatusCode, Headers: map[string]string{"content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff"}, Body: json.RawMessage(bytes)}, nil
}
func (s *Service) saveLoginLocale(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var locale string
	if args.Decode(0, &locale) != nil {
		return false, nil
	}
	r, ok := ctx.Value(requestContextKey{}).(Request)
	if !ok || !s.trustedOrigin(r) || !contains([]string{"th", "en"}, locale) || s.authorize(a, "") != nil {
		return false, nil
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Update(ctx, "profiles", erpwire.Row{"locale": locale}, []erpwire.Predicate{eq("id", a.UserID())}, nil)
		return e
	})
	return e == nil, nil
}
func (s *Service) securityPage(_ context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	state := "one-step"
	if a.HasVerifiedFactor() {
		state = "aal2"
	} else if s.security.TotpEnroll {
		state = "enroll"
	}
	return erpwire.Row{"rollout": state, "note": rolloutNote(state)}, nil
}
func rolloutNote(state string) string {
	switch state {
	case "enroll":
		return "Enrollment is open for this process. An account stays on one step until a factor is verified. Restart with LOCAL_TOTP_ENROLL unset to close this form. Closing it does not remove a factor that is already verified."
	case "challenge":
		return "This account has a verified authenticator. Enter the code at /login/mfa. Other accounts are not asked."
	case "aal2":
		return "This session is aal2. Turning LOCAL_TOTP_ENROLL off does not remove the authenticator. Accounts that never enrolled stay on one step."
	default:
		return "Enrollment is off. This account has no authenticator and stays on one step. Set LOCAL_TOTP_ENROLL=1 and restart the local ERP to open enrollment. Accounts that never enroll are not asked for a code."
	}
}
func (s *Service) checkForUpdate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	unavailable := func(message string) (any, error) { return erpwire.Row{"state": "unavailable", "message": message}, nil }
	if s.security.ReleaseTransport == nil {
		return unavailable("The release page could not be reached.")
	}
	request, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/Boom-Vitt/nose-erp/releases/latest", nil)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "BoomBigNose")
	client := http.Client{Transport: s.security.ReleaseTransport, Timeout: 8 * time.Second}
	r, e := client.Do(request)
	if e != nil {
		return unavailable("The release page could not be reached.")
	}
	defer r.Body.Close()
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return unavailable("The release page did not respond.")
	}
	body, e := io.ReadAll(io.LimitReader(r.Body, 1024*1024))
	if e != nil {
		return unavailable("The release page could not be reached.")
	}
	var release erpwire.Row
	if erpwire.DecodeJSON(body, &release) != nil {
		return unavailable("The release page could not be reached.")
	}
	current := s.security.Version
	if current == "" {
		current = "1.5.0"
	}
	tag := text(release["tag_name"])
	next := strings.TrimPrefix(strings.TrimPrefix(tag, "boombignose-"), "v")
	link := "https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v" + next
	left, right := versionParts(next), versionParts(current)
	if left == nil || right == nil || (!strings.HasPrefix(tag, "boombignose-v") && !strings.HasPrefix(tag, "v")) || text(release["html_url"]) != link {
		return unavailable("The release page could not be read.")
	}
	state, version := "current", current
	for i := 0; i < 3; i++ {
		if left[i] != right[i] {
			if left[i] > right[i] {
				state, version = "available", next
			}
			break
		}
	}
	capability := "deferred"
	if s.security.Platform == "darwin" && s.security.Arch == "arm64" {
		capability = "needs-window"
		if s.security.UpdateHelperConfigured {
			capability = "apply"
		}
	}
	return erpwire.Row{"state": state, "version": version, "url": link, "capability": capability}, nil
}

var settingsSemver = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

func versionParts(v string) []uint64 {
	if !settingsSemver.MatchString(v) {
		return nil
	}
	var a, b, c uint64
	if _, e := fmt.Sscanf(v, "%d.%d.%d", &a, &b, &c); e != nil {
		return nil
	}
	return []uint64{a, b, c}
}
