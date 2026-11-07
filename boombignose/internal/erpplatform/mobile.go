package erpplatform

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// CredentialResolver is trusted authentication, never an actor decoded from HTTP.
// It must bind live, least-privilege authority for the named credential purpose.
type CredentialResolver interface {
	ResolveCredential(context.Context, string, string) (erpwire.Actor, error)
}
type TailscaleDiscovery interface {
	Status(context.Context) (json.RawMessage, json.RawMessage, error)
}
type PairQREncoder interface {
	EncodePairQR(context.Context, string, int, int, string) (string, error)
}
type MobileOptions struct {
	Credentials CredentialResolver
	Tailscale   TailscaleDiscovery
	QR          PairQREncoder
	Backend     string
	AppOrigin   string
}

func (s *Service) mobileOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/api/mobile/pair/start/route.ts::POST":           s.mobileStart,
		"app/api/mobile/pair/redeem/route.ts::POST":          s.mobileRedeem,
		"app/api/mobile/devices/route.ts::GET":               s.mobileDevices,
		"app/api/mobile/devices/[id]/route.ts::DELETE":       s.mobileRevoke,
		"app/api/mobile/status/route.ts::GET":                s.mobileStatus,
		"app/api/network/route.ts::GET":                      s.networkSnapshot,
		"app/api/network/devices/route.ts::POST":             s.networkEnroll,
		"app/api/network/devices/[id]/revoke/route.ts::POST": s.networkRevoke,
		"app/api/network/policy/route.ts::POST":              s.networkPolicy,
		"app/api/network/telemetry/route.ts::POST":           s.networkTelemetry,
	}
}
func mnError(status int, message string) Response {
	return jsonResponse(status, map[string]any{"error": message})
}
func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func randomToken() (string, error) {
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
func sameHash(a, b string) bool {
	return len(a) == 64 && len(b) == 64 && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func mnTime(now time.Time) string { return now.UTC().Format("2006-01-02T15:04:05.000Z") }
func trimUnits(value string, max int) string {
	units := utf16.Encode([]rune(value))
	if len(units) > max {
		units = units[:max]
	}
	return string(utf16.Decode(units))
}
func mnBody(r Request, max int) (erpwire.Row, error) {
	if boundedBody(r, max) != nil {
		return nil, errors.New("body exceeds limit")
	}
	var value any
	if erpwire.DecodeJSON(r.Body, &value) != nil {
		return nil, erpwire.ErrBadArguments
	}
	body := mnRecord(value)
	if body == nil {
		body = erpwire.Row{}
	}
	return body, nil
}
func mnTruthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case json.Number:
		n, _ := strconv.ParseFloat(v.String(), 64)
		return n != 0
	default:
		return true
	}
}

var tailHost = regexp.MustCompile(`(?i)^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$`)

func normalizePairBase(input string) string {
	u, e := url.Parse(strings.TrimSpace(input))
	if e != nil || u.Scheme != "https" || !tailHost.MatchString(u.Hostname()) || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Port() == "0" {
		return ""
	}
	port := u.Port()
	if port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return ""
		}
		port = strconv.Itoa(n)
	}
	host := strings.ToLower(u.Hostname())
	if port != "" && port != "443" {
		host = net.JoinHostPort(host, port)
	}
	return "https://" + host
}
func mnURLOrigin(u *url.URL) string {
	port := u.Port()
	host := strings.ToLower(u.Hostname())
	if port != "" {
		n, e := strconv.Atoi(port)
		if e == nil {
			port = strconv.Itoa(n)
		}
	}
	if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return strings.ToLower(u.Scheme) + "://" + host
}
func verifiedServeOrigin(status, serve json.RawMessage, backend string) string {
	var node struct {
		BackendState string
		Self         struct {
			DNSName string
			Online  bool
		}
	}
	var config struct {
		TCP map[string]struct{ HTTPS bool }
		Web map[string]struct {
			Handlers map[string]struct{ Proxy string }
		}
		AllowFunnel map[string]bool
	}
	if json.Unmarshal(status, &node) != nil || json.Unmarshal(serve, &config) != nil || node.BackendState != "Running" || !node.Self.Online {
		return ""
	}
	host := strings.TrimSuffix(node.Self.DNSName, ".")
	if normalizePairBase("https://"+host) == "" {
		return ""
	}
	expected, e := url.Parse(backend)
	if e != nil || expected.Scheme != "http" || (strings.ToLower(expected.Hostname()) != "localhost" && expected.Hostname() != "127.0.0.1" && expected.Hostname() != "::1") || expected.User != nil || (expected.Path != "" && expected.Path != "/") || expected.RawQuery != "" || expected.ForceQuery || expected.Fragment != "" {
		return ""
	}
	origin := ""
	for port, listener := range config.TCP {
		if !listener.HTTPS || !regexp.MustCompile(`^[1-9]\d{0,4}$`).MatchString(port) {
			continue
		}
		candidate := normalizePairBase("https://" + host + ":" + port)
		if candidate == "" {
			continue
		}
		endpoint := host + ":" + port
		actual, e := url.Parse(config.Web[endpoint].Handlers["/"].Proxy)
		if e != nil || mnURLOrigin(actual) != mnURLOrigin(expected) || actual.User != nil || (actual.Path != "" && actual.Path != "/") || actual.RawQuery != "" || actual.ForceQuery || actual.Fragment != "" {
			continue
		}
		if config.AllowFunnel[endpoint] || origin != "" {
			return ""
		}
		origin = candidate
	}
	return origin
}
func pairURI(base, token, org string, expires time.Time) string {
	return "bbn-pair://redeem?u=" + url.QueryEscape(base) + "&t=" + url.QueryEscape(token) + "&o=" + url.QueryEscape(org) + "&e=" + strconv.FormatInt(expires.Unix(), 10)
}

func (s *Service) mobileStart(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.apiAccess(a, r, "team:manage", true); deny != nil {
		return *deny, nil
	}
	body, e := mnBody(r, 2048)
	if e != nil {
		return mnError(400, "Invalid pairing request."), nil
	}
	detected := ""
	if s.mobile.Tailscale != nil {
		status, serve, e := s.mobile.Tailscale.Status(ctx)
		if e == nil {
			detected = verifiedServeOrigin(status, serve, s.mobile.Backend)
		}
	}
	manual := normalizePairBase(text(body["baseUrl"]))
	configured := false
	for _, origin := range s.origins {
		if origin == detected {
			configured = true
		}
	}
	supplied := mnTruthy(body["baseUrl"])
	if detected == "" || (supplied && manual != detected) || !configured {
		return mnError(400, "Configure this ERP's public HTTPS .ts.net origin and private Tailscale Serve mapping to its actual loopback backend. DNS alone is not a ready connection."), nil
	}
	if s.mobile.QR == nil {
		return nil, errors.New("pairing QR encoder unavailable")
	}
	token, e := randomToken()
	if e != nil {
		return nil, e
	}
	expires := s.now().Add(5 * time.Minute)
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "mobile_pairings", Rows: []erpwire.Row{{"org_id": a.OrgID(), "created_by": a.UserID(), "token_hash": tokenHash(token), "expires_at": mnTime(expires)}}})
		return e
	})
	if e != nil {
		return nil, errors.New("Could not create a pairing code.")
	}
	qr, e := s.mobile.QR.EncodePairQR(ctx, pairURI(detected, token, a.OrgName(), expires), 320, 2, "M")
	if e != nil {
		return nil, e
	}
	return jsonResponse(200, map[string]any{"baseUrl": detected, "qr": qr, "expiresAt": mnTime(expires)}), nil
}
func (s *Service) mobileRedeem(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if hasHeader(r, "origin") && !s.trustedOrigin(r) {
		return mnError(403, "Untrusted request origin."), nil
	}
	body, e := mnBody(r, 2048)
	if e != nil {
		return mnError(400, "Invalid pairing request."), nil
	}
	token := text(body["token"])
	if len(token) < 20 || len(token) > 200 {
		return mnError(400, "Invalid or expired pairing code."), nil
	}
	if s.mobile.Credentials == nil {
		return mnError(503, "Device authentication unavailable."), nil
	}
	hash := tokenHash(token)
	a, e := s.mobile.Credentials.ResolveCredential(ctx, "mobile_pairing", hash)
	if e != nil || a.Validate(s.now()) != nil {
		return mnError(400, "Invalid or expired pairing code."), nil
	}
	now := mnTime(s.now())
	deviceToken, e := randomToken()
	if e != nil {
		return nil, e
	}
	var deviceID, orgName string
	found := false
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		pair, e := one(ctx, tx, erpwire.Select{Table: "mobile_pairings", Columns: []string{"org_id", "created_by", "token_hash"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("token_hash", hash), {Column: "consumed_at", Op: erpwire.Is, Value: nil}, {Column: "expires_at", Op: erpwire.Greater, Value: now}}})
		if e != nil {
			return e
		}
		if pair == nil || !sameHash(text(pair["token_hash"]), hash) || text(pair["created_by"]) != a.UserID() {
			return nil
		}
		consumed, e := tx.Update(ctx, "mobile_pairings", erpwire.Row{"consumed_at": now}, []erpwire.Predicate{eq("org_id", a.OrgID()), eq("token_hash", hash), {Column: "consumed_at", Op: erpwire.Is, Value: nil}, {Column: "expires_at", Op: erpwire.Greater, Value: now}}, []string{"org_id", "created_by"})
		if e != nil {
			return e
		}
		if len(consumed) != 1 {
			return nil
		}
		found = true
		return nil
	})
	if e != nil {
		return nil, e
	}
	if !found {
		return mnError(400, "Invalid or expired pairing code."), nil
	}
	// Consumption remains committed if registration fails, as in the source flow.
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		name := trimUnits(trim(text(body["deviceName"])), 80)
		if name == "" {
			name = "Mobile"
		}
		devices, e := tx.Insert(ctx, erpwire.Insert{Table: "mobile_devices", Rows: []erpwire.Row{{"org_id": a.OrgID(), "user_id": a.UserID(), "name": name, "token_hash": tokenHash(deviceToken)}}, Returning: []string{"id"}})
		if e != nil || len(devices) != 1 {
			return errors.New("Could not register the device.")
		}
		deviceID = text(devices[0]["id"])
		return nil
	})
	if e != nil {
		return nil, e
	}
	_ = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		org, e := one(ctx, tx, erpwire.Select{Table: "organizations", Columns: []string{"name"}, Where: []erpwire.Predicate{eq("id", a.OrgID())}})
		if e == nil {
			orgName = text(org["name"])
		}
		return e
	})
	return jsonResponse(200, map[string]any{"deviceToken": deviceToken, "deviceId": deviceID, "orgName": orgName, "connectionOnly": true}), nil
}
func (s *Service) mobileDevices(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if !s.trustedBrowser(r) {
		return mnError(403, "Untrusted request origin."), nil
	}
	if deny := s.apiAccess(a, r, "team:manage", false); deny != nil {
		return *deny, nil
	}
	var devices []erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		devices, e = all(ctx, tx, erpwire.Select{Table: "mobile_devices", Columns: []string{"id", "name", "created_at", "last_seen_at", "revoked_at"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
		return e
	})
	if e != nil {
		return nil, errors.New("Could not load devices.")
	}
	return jsonResponse(200, map[string]any{"devices": devices}), nil
}

var mobileID = regexp.MustCompile(`(?i)^[0-9a-f-]{36}$`)

func (s *Service) mobileRevoke(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if deny := s.apiAccess(a, r, "team:manage", true); deny != nil {
		return *deny, nil
	}
	id := r.Params["id"]
	if !mobileID.MatchString(id) {
		return mnError(404, "Device not found."), nil
	}
	var rows []erpwire.Row
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		var e error
		rows, e = tx.Update(ctx, "mobile_devices", erpwire.Row{"revoked_at": mnTime(s.now())}, append(scoped(a, id), erpwire.Predicate{Column: "revoked_at", Op: erpwire.Is, Value: nil}), []string{"id"})
		return e
	})
	if e != nil || len(rows) == 0 {
		return mnError(404, "Device not found."), nil
	}
	return jsonResponse(200, map[string]any{"ok": true, "browserSessionsSignedOut": false}), nil
}

var mobileBearer = regexp.MustCompile(`(?i)^Bearer\s+(\S+)$`)

func (s *Service) mobileStatus(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	match := mobileBearer.FindStringSubmatch(header(r, "authorization"))
	if len(match) != 2 || s.mobile.Credentials == nil {
		return mnError(401, "Device not linked."), nil
	}
	hash := tokenHash(match[1])
	a, e := s.mobile.Credentials.ResolveCredential(ctx, "mobile_device", hash)
	if e != nil || a.Validate(s.now()) != nil {
		return mnError(401, "Device not linked."), nil
	}
	var device erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		device, e = one(ctx, tx, erpwire.Select{Table: "mobile_devices", Columns: []string{"id", "org_id", "user_id", "name", "token_hash"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("token_hash", hash), {Column: "revoked_at", Op: erpwire.Is, Value: nil}}})
		return e
	})
	if e != nil || device == nil || !sameHash(text(device["token_hash"]), hash) {
		return mnError(401, "Device not linked."), nil
	}
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Update(ctx, "mobile_devices", erpwire.Row{"last_seen_at": mnTime(s.now())}, scoped(a, text(device["id"])), nil)
		return e
	})
	return jsonResponse(200, map[string]any{"ok": true, "deviceName": device["name"], "connectionOnly": true}), nil
}
