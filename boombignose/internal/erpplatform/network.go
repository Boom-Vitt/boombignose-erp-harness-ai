package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const networkMaxBody = 256 * 1024

type networkError struct {
	status  int
	message string
}

func (e networkError) Error() string { return e.message }
func networkJSON(status int, body any) Response {
	r := jsonResponse(status, body)
	r.Headers["Cache-Control"] = "private, no-store, max-age=0"
	delete(r.Headers, "cache-control")
	r.Headers["Pragma"] = "no-cache"
	r.Headers["X-Content-Type-Options"] = "nosniff"
	return r
}
func networkFailure(e error) Response {
	var safe networkError
	if errors.As(e, &safe) {
		return networkJSON(safe.status, map[string]any{"error": safe.message})
	}
	return networkJSON(500, map[string]any{"error": "Network request could not be completed."})
}
func (s *Service) networkAdmin(a erpwire.Actor) error {
	if a.UserID() == "" || a.OrgID() == "" {
		return networkError{401, "Sign in required."}
	}
	if a.Role() != erpwire.Owner && a.Role() != erpwire.Admin {
		return networkError{403, "Forbidden."}
	}
	if a.Validate(s.now()) != nil {
		return networkError{403, "Complete two-factor verification before accessing network visibility."}
	}
	return nil
}
func (s *Service) networkOrigin(r Request) error {
	configured := s.mobile.AppOrigin
	if configured == "" {
		configured = r.URL
	}
	u, e := url.Parse(configured)
	if e != nil || u.Scheme == "" || u.Host == "" {
		return networkError{403, "Same-origin request required."}
	}
	site := header(r, "sec-fetch-site")
	if header(r, "origin") != u.Scheme+"://"+u.Host || (site != "" && site != "same-origin" && site != "none") {
		return networkError{403, "Same-origin request required."}
	}
	return nil
}

var networkJSONType = regexp.MustCompile(`(?i)^application/json(?:\s*;|$)`)
var digitsOnly = regexp.MustCompile(`^\d+$`)

func networkBody(r Request) (erpwire.Row, error) {
	if !networkJSONType.MatchString(header(r, "content-type")) {
		return nil, networkError{415, "JSON request required."}
	}
	if length := header(r, "content-length"); hasHeader(r, "content-length") {
		n, e := strconv.ParseUint(length, 10, 64)
		if !digitsOnly.MatchString(length) || e != nil || n > networkMaxBody {
			return nil, networkError{413, "Request body too large."}
		}
	}
	if len(r.Body) > networkMaxBody {
		return nil, networkError{413, "Request body too large."}
	}
	if !utf8.Valid(r.Body) {
		return nil, networkError{400, "Invalid JSON request."}
	}
	var body erpwire.Row
	if erpwire.DecodeJSON(r.Body, &body) != nil {
		return nil, networkError{400, "Invalid JSON request."}
	}
	return body, nil
}

var networkDeviceID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var networkObsID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
var networkProcess = regexp.MustCompile(`^[A-Za-z0-9_.+-]{1,80}$`)
var networkTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)

type NetworkObservation struct {
	ID            string `json:"id"`
	LocalAddress  string `json:"localAddress"`
	LocalPort     int64  `json:"localPort"`
	RemoteAddress string `json:"remoteAddress"`
	RemotePort    int64  `json:"remotePort"`
	Protocol      string `json:"protocol"`
	Process       string `json:"process"`
	PID           int64  `json:"pid"`
}
type NetworkReport struct {
	CapturedAt   string               `json:"capturedAt"`
	Coverage     string               `json:"coverage"`
	Observations []NetworkObservation `json:"observations"`
	Truncated    bool                 `json:"truncated"`
}

func mnRecord(v any) erpwire.Row {
	switch x := v.(type) {
	case erpwire.Row:
		return x
	case map[string]any:
		return erpwire.Row(x)
	default:
		return nil
	}
}
func networkInteger(v any) (int64, bool) {
	switch x := v.(type) {
	case json.Number:
		n, e := x.Int64()
		if e == nil {
			return n, true
		}
		number, e := strconv.ParseFloat(x.String(), 64)
		if e != nil || number < 0 || number > 2147483647 || number != math.Trunc(number) {
			return 0, false
		}
		return int64(number), true
	case int64:
		return x, true
	case int:
		return int64(x), true
	default:
		return 0, false
	}
}
func networkAddress(v any) bool {
	s, ok := v.(string)
	if !ok || len(s) > 45 || strings.Contains(s, "%") {
		return false
	}
	_, e := netip.ParseAddr(s)
	return e == nil
}
func parseNetworkReport(v any) *NetworkReport {
	value := mnRecord(v)
	capture := text(value["capturedAt"])
	truncated, boolean := value["truncated"].(bool)
	observations, array := value["observations"].([]any)
	if value == nil || value["coverage"] != "current_user_tcp_snapshot" || len(capture) > 40 || !networkTimestamp.MatchString(capture) || !boolean || !array || len(observations) > 500 {
		return nil
	}
	instant, e := time.Parse(time.RFC3339Nano, capture)
	if e != nil {
		return nil
	}
	out := &NetworkReport{CapturedAt: mnTime(instant), Coverage: "current_user_tcp_snapshot", Truncated: truncated, Observations: []NetworkObservation{}}
	ids := map[string]bool{}
	for _, v := range observations {
		item := mnRecord(v)
		id := text(item["id"])
		process := text(item["process"])
		lp, lok := networkInteger(item["localPort"])
		rp, rok := networkInteger(item["remotePort"])
		pid, pok := networkInteger(item["pid"])
		if item == nil || !networkObsID.MatchString(id) || ids[id] || item["protocol"] != "tcp" || !networkAddress(item["localAddress"]) || !networkAddress(item["remoteAddress"]) || !lok || lp < 1 || lp > 65535 || !rok || rp < 1 || rp > 65535 || !networkProcess.MatchString(process) || !pok || pid < 1 || pid > 2147483647 {
			return nil
		}
		ids[id] = true
		out.Observations = append(out.Observations, NetworkObservation{ID: id, LocalAddress: text(item["localAddress"]), LocalPort: lp, RemoteAddress: text(item["remoteAddress"]), RemotePort: rp, Protocol: "tcp", Process: process, PID: pid})
	}
	return out
}
func captureAllowed(capture string, now time.Time) bool {
	t, e := time.Parse(time.RFC3339Nano, capture)
	return e == nil && !t.Before(now.Add(-5*time.Minute)) && !t.After(now.Add(time.Minute))
}
func validNetworkCIDR(cidr string) bool {
	parts := strings.Split(cidr, "/")
	if len(parts) != 2 || !regexp.MustCompile(`^(0|[1-9]\d{0,2})$`).MatchString(parts[1]) {
		return false
	}
	_, e := netip.ParsePrefix(cidr)
	return e == nil
}
func (s *Service) networkSnapshot(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := apiRequest(raw); e != nil {
		return nil, e
	}
	if e := s.networkAdmin(a); e != nil {
		return networkFailure(e), nil
	}
	devices := []erpwire.Row{}
	policy := []any{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		rows, e := all(ctx, tx, erpwire.Select{Table: "network_devices", Columns: []string{"id", "name", "created_at", "last_received_at", "revoked_at", "latest_report"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "id"}}})
		if e != nil {
			return e
		}
		for _, row := range rows {
			devices = append(devices, erpwire.Row{"id": row["id"], "name": row["name"], "createdAt": row["created_at"], "lastSeenAt": row["last_received_at"], "revokedAt": row["revoked_at"], "report": parseNetworkReport(row["latest_report"])})
		}
		p, e := one(ctx, tx, erpwire.Select{Table: "network_policy", Columns: []string{"allowed_cidrs"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}})
		if e != nil {
			return e
		}
		switch v := p["allowed_cidrs"].(type) {
		case []any:
			policy = v
		case []string:
			for _, x := range v {
				policy = append(policy, x)
			}
		}
		return nil
	})
	if e != nil {
		return networkFailure(e), nil
	}
	return networkJSON(200, erpwire.Row{"devices": devices, "policy": erpwire.Row{"allowedCidrs": policy}, "serverTime": mnTime(s.now())}), nil
}
func (s *Service) networkEnroll(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if e = s.networkOrigin(r); e != nil {
		return networkFailure(e), nil
	}
	if e = s.networkAdmin(a); e != nil {
		return networkFailure(e), nil
	}
	body, e := networkBody(r)
	if e != nil {
		return networkFailure(e), nil
	}
	name, ok := body["name"].(string)
	size := len(utf16.Encode([]rune(strings.TrimSpace(name))))
	if !ok || size < 1 || size > 80 || strings.ContainsAny(name, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f\x7f") {
		return networkFailure(networkError{400, "Device name must be 1–80 characters without control characters."}), nil
	}
	token, e := randomToken()
	if e != nil {
		return networkFailure(e), nil
	}
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Insert(ctx, erpwire.Insert{Table: "network_devices", Rows: []erpwire.Row{{"org_id": a.OrgID(), "created_by": a.UserID(), "name": strings.TrimSpace(name), "token_hash": tokenHash(token)}}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(rows) != 1 {
			return errors.New("Could not enroll device.")
		}
		id = text(rows[0]["id"])
		return nil
	})
	if e != nil {
		return networkFailure(e), nil
	}
	out := networkJSON(201, erpwire.Row{"deviceId": id, "deviceToken": token})
	out.Headers["Content-Disposition"] = `attachment; filename="network-device-` + id + `.json"`
	return out, nil
}
func (s *Service) networkRevoke(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if e = s.networkOrigin(r); e != nil {
		return networkFailure(e), nil
	}
	if e = s.networkAdmin(a); e != nil {
		return networkFailure(e), nil
	}
	id := r.Params["id"]
	if !networkDeviceID.MatchString(id) {
		return networkFailure(networkError{400, "Invalid device identifier."}), nil
	}
	var rows []erpwire.Row
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		var e error
		rows, e = tx.Update(ctx, "network_devices", erpwire.Row{"revoked_at": mnTime(s.now())}, append(scoped(a, id), erpwire.Predicate{Column: "revoked_at", Op: erpwire.Is, Value: nil}), []string{"id"})
		return e
	})
	if e != nil {
		return networkFailure(e), nil
	}
	if len(rows) == 0 {
		return networkFailure(networkError{404, "Active device not found."}), nil
	}
	return networkJSON(200, erpwire.Row{"revoked": true}), nil
}
func (s *Service) networkPolicy(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	if e = s.networkOrigin(r); e != nil {
		return networkFailure(e), nil
	}
	if e = s.networkAdmin(a); e != nil {
		return networkFailure(e), nil
	}
	body, e := networkBody(r)
	if e != nil {
		return networkFailure(e), nil
	}
	cidrs, ok := body["allowedCidrs"].([]any)
	invalid := !ok || len(cidrs) > 100
	allowed := []string{}
	seen := map[string]bool{}
	for _, v := range cidrs {
		cidr, ok := v.(string)
		if !ok || !validNetworkCIDR(cidr) {
			invalid = true
			break
		}
		if !seen[cidr] {
			allowed = append(allowed, cidr)
			seen[cidr] = true
		}
	}
	if invalid {
		return networkFailure(networkError{400, "Provide up to 100 valid IPv4 or IPv6 CIDRs."}), nil
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "set_network_policy", erpwire.Row{"p_org_id": a.OrgID(), "p_allowed_cidrs": allowed})
		return e
	})
	if e != nil {
		return networkFailure(e), nil
	}
	return networkJSON(200, erpwire.Row{"allowedCidrs": allowed}), nil
}

var networkBearer = regexp.MustCompile(`(?i)^Bearer ([A-Za-z0-9_-]{43})$`)

func (s *Service) networkTelemetry(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	r, e := apiRequest(raw)
	if e != nil {
		return nil, e
	}
	match := networkBearer.FindStringSubmatch(header(r, "authorization"))
	if len(match) != 2 {
		return networkFailure(networkError{401, "Device authentication required."}), nil
	}
	if s.mobile.Credentials == nil {
		return networkFailure(errors.New("Device authentication unavailable.")), nil
	}
	hash := tokenHash(match[1])
	a, e := s.mobile.Credentials.ResolveCredential(ctx, "network_device", hash)
	if e != nil {
		if errors.Is(e, erpwire.ErrUnauthenticated) {
			return networkFailure(networkError{401, "Device authentication required."}), nil
		}
		return networkFailure(e), nil
	}
	if a.Validate(s.now()) != nil {
		return networkFailure(networkError{401, "Device authentication required."}), nil
	}
	var device erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		device, e = one(ctx, tx, erpwire.Select{Table: "network_devices", Columns: []string{"id", "org_id", "token_hash"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("token_hash", hash), {Column: "revoked_at", Op: erpwire.Is, Value: nil}}})
		return e
	})
	if e != nil {
		return networkFailure(e), nil
	}
	if device == nil || !sameHash(text(device["token_hash"]), hash) {
		return networkFailure(networkError{401, "Device authentication required."}), nil
	}
	body, e := networkBody(r)
	if e != nil {
		return networkFailure(e), nil
	}
	id := text(body["deviceId"])
	if !networkDeviceID.MatchString(id) || id != text(device["id"]) {
		return networkFailure(networkError{400, "Report device does not match the registered device."}), nil
	}
	report := parseNetworkReport(body["report"])
	if report == nil || !captureAllowed(report.CapturedAt, s.now()) {
		return networkFailure(networkError{400, "Invalid, expired, or future-dated metadata report."}), nil
	}
	var received json.RawMessage
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		var e error
		received, e = tx.Command(ctx, "ingest_network_report", erpwire.Row{"p_device_id": id, "p_org_id": a.OrgID(), "p_token_hash": hash, "p_captured_at": report.CapturedAt, "p_report": report})
		return e
	})
	if e != nil {
		return networkFailure(e), nil
	}
	var stamp any
	if erpwire.DecodeJSON(received, &stamp) != nil {
		return networkFailure(errors.New("Could not receive report.")), nil
	}
	if stamp == nil || stamp == false || stamp == "" {
		return networkFailure(networkError{409, "Report not accepted: device revoked or report is not newer."}), nil
	}
	return networkJSON(202, erpwire.Row{"accepted": true, "receivedAt": stamp}), nil
}
