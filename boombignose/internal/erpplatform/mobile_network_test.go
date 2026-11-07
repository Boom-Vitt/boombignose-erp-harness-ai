package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

var mnNow = time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC)

const mnUser = "11111111-1111-4111-8111-111111111111"
const mnOrg = "22222222-2222-4222-8222-222222222222"
const mnOtherOrg = "33333333-3333-4333-8333-333333333333"
const mnDevice = "44444444-4444-4444-8444-444444444444"

func mnActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: mnUser, Email: "owner@example.test", Assurance: erpwire.AAL2, ExpiresAt: mnNow.Add(time.Hour), FactorStateKnown: true, HasVerifiedFactor: true}, erpwire.Membership{UserID: mnUser, OrgID: mnOrg, OrgName: "Example", Role: role}, false, mnNow)
	if e != nil {
		t.Fatal(e)
	}
	return a
}

type mnStore struct {
	rows   map[string][]erpwire.Row
	writes int
	reads  int
}
type mnTx struct{ store *mnStore }

func (m *mnStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if e := a.Validate(mnNow); e != nil {
		return e
	}
	m.reads++
	return fn(&mnTx{m})
}
func (m *mnStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if e := a.Validate(mnNow); e != nil {
		return e
	}
	m.writes++
	copy := map[string][]erpwire.Row{}
	for table, rows := range m.rows {
		for _, row := range rows {
			r := erpwire.Row{}
			for k, v := range row {
				r[k] = v
			}
			copy[table] = append(copy[table], r)
		}
	}
	tx := &mnTx{&mnStore{rows: copy}}
	if e := fn(tx); e != nil {
		return e
	}
	m.rows = copy
	return nil
}
func mnMatch(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		switch p.Op {
		case erpwire.Equal, erpwire.Is:
			if !reflect.DeepEqual(row[p.Column], p.Value) {
				return false
			}
		case erpwire.Greater:
			if text(row[p.Column]) <= text(p.Value) {
				return false
			}
		default:
			panic("unsupported predicate in mobile/network test")
		}
	}
	return true
}
func (m *mnTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	rows := []erpwire.Row{}
	for _, row := range m.store.rows[q.Table] {
		if mnMatch(row, q.Where) {
			projected := erpwire.Row{}
			for _, key := range q.Columns {
				projected[key] = row[key]
			}
			rows = append(rows, projected)
		}
	}
	if q.Offset >= len(rows) {
		rows = []erpwire.Row{}
	} else {
		rows = rows[q.Offset:]
	}
	if q.Limit > 0 && len(rows) > q.Limit {
		rows = rows[:q.Limit]
	}
	return erpwire.Selection{Rows: rows}, nil
}
func (m *mnTx) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected read RPC")
}
func (m *mnTx) Insert(_ context.Context, q erpwire.Insert) ([]erpwire.Row, error) {
	rows := []erpwire.Row{}
	for _, r := range q.Rows {
		if r["id"] == nil {
			r["id"] = mnDevice
		}
		m.store.rows[q.Table] = append(m.store.rows[q.Table], r)
		rows = append(rows, r)
	}
	return rows, nil
}
func (m *mnTx) Update(_ context.Context, table string, values erpwire.Row, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	rows := []erpwire.Row{}
	for _, r := range m.store.rows[table] {
		if mnMatch(r, where) {
			for k, v := range values {
				r[k] = v
			}
			rows = append(rows, r)
		}
	}
	return rows, nil
}
func (m *mnTx) Delete(context.Context, string, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected delete")
}
func (m *mnTx) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	switch name {
	case "set_network_policy":
		m.store.rows["network_policy"] = []erpwire.Row{{"org_id": args["p_org_id"], "allowed_cidrs": args["p_allowed_cidrs"]}}
		return json.RawMessage(`null`), nil
	case "ingest_network_report":
		for _, r := range m.store.rows["network_devices"] {
			if r["org_id"] == args["p_org_id"] && r["id"] == args["p_device_id"] && r["token_hash"] == args["p_token_hash"] && r["revoked_at"] == nil && text(r["capture"]) < text(args["p_captured_at"]) {
				r["capture"] = args["p_captured_at"]
				r["latest_report"] = args["p_report"]
				return json.Marshal(mnTime(mnNow))
			}
		}
		return json.RawMessage(`null`), nil
	default:
		return nil, errors.New("unexpected command")
	}
}

type mnCredentials struct {
	actor   erpwire.Actor
	purpose string
	hash    string
}

func (c mnCredentials) ResolveCredential(_ context.Context, purpose, hash string) (erpwire.Actor, error) {
	if purpose != c.purpose || hash != c.hash {
		return erpwire.Actor{}, errors.New("invalid credential")
	}
	return c.actor, nil
}

type mnDiscovery struct{ status, serve string }

func (d mnDiscovery) Status(context.Context) (json.RawMessage, json.RawMessage, error) {
	return json.RawMessage(d.status), json.RawMessage(d.serve), nil
}

type mnQR struct{ uri *string }

func (q mnQR) EncodePairQR(_ context.Context, uri string, width, margin int, correction string) (string, error) {
	if width != 320 || margin != 2 || correction != "M" {
		return "", errors.New("wrong QR settings")
	}
	*q.uri = uri
	return "data:image/png;base64,test", nil
}
func mnService(store *mnStore) *Service {
	return &Service{store: store, now: func() time.Time { return mnNow }, origins: []string{"https://erp.tailnet.ts.net"}, mobile: MobileOptions{AppOrigin: "https://erp.tailnet.ts.net"}}
}
func mnRequest(method string, body any, params map[string]string) json.RawMessage {
	bytes, _ := json.Marshal(body)
	r := Request{Method: method, URL: "https://erp.tailnet.ts.net/api/network", Headers: map[string]string{"origin": "https://erp.tailnet.ts.net", "sec-fetch-site": "same-origin", "content-type": "application/json"}, Body: bytes, Params: params}
	out, _ := json.Marshal([]Request{r})
	return out
}
func mnCall(t *testing.T, fn erpwire.Operation, a erpwire.Actor, raw json.RawMessage) Response {
	t.Helper()
	value, e := fn(context.Background(), a, raw)
	if e != nil {
		t.Fatal(e)
	}
	response, ok := value.(Response)
	if !ok {
		t.Fatalf("unexpected response %T", value)
	}
	return response
}
func mnResponseError(r Response) string {
	switch v := r.Body.(type) {
	case erpwire.Row:
		return text(v["error"])
	case map[string]any:
		return text(v["error"])
	}
	return ""
}

func TestMobileAndNetworkAuthorization(t *testing.T) {
	for _, test := range []struct {
		name      string
		operation func(*Service) erpwire.Operation
		status    int
		message   string
	}{{"mobile list", func(s *Service) erpwire.Operation { return s.mobileDevices }, 403, "Your role does not permit this action."}, {"network list", func(s *Service) erpwire.Operation { return s.networkSnapshot }, 403, "Forbidden."}, {"network enroll", func(s *Service) erpwire.Operation { return s.networkEnroll }, 403, "Forbidden."}} {
		t.Run(test.name, func(t *testing.T) {
			db := &mnStore{rows: map[string][]erpwire.Row{}}
			s := mnService(db)
			r := mnCall(t, test.operation(s), mnActor(t, erpwire.Member), mnRequest("POST", erpwire.Row{"name": "Device"}, nil))
			if r.Status != test.status || mnResponseError(r) != test.message || db.reads != 0 || db.writes != 0 {
				t.Fatalf("authorization bypass: %+v, %d reads %d writes", r, db.reads, db.writes)
			}
		})
	}
}
func TestMobileRevokeIsScopedAndIdempotent(t *testing.T) {
	for _, org := range []string{mnOrg, mnOtherOrg} {
		t.Run(org, func(t *testing.T) {
			db := &mnStore{rows: map[string][]erpwire.Row{"mobile_devices": {{"id": mnDevice, "org_id": org, "revoked_at": nil}}}}
			s := mnService(db)
			a := mnActor(t, erpwire.Owner)
			first := mnCall(t, s.mobileRevoke, a, mnRequest("DELETE", nil, map[string]string{"id": mnDevice}))
			if org == mnOtherOrg {
				if first.Status != 404 || db.rows["mobile_devices"][0]["revoked_at"] != nil {
					t.Fatalf("cross-org revoke: %+v", first)
				}
				return
			}
			if first.Status != 200 || db.rows["mobile_devices"][0]["revoked_at"] != mnTime(mnNow) {
				t.Fatalf("not revoked: %+v", first)
			}
			second := mnCall(t, s.mobileRevoke, a, mnRequest("DELETE", nil, map[string]string{"id": mnDevice}))
			if second.Status != 404 || mnResponseError(second) != "Device not found." {
				t.Fatalf("replayed revoke: %+v", second)
			}
		})
	}
}
func TestMobilePairingOneUseAndHashOnly(t *testing.T) {
	token := strings.Repeat("a", 43)
	a := mnActor(t, erpwire.Owner)
	db := &mnStore{rows: map[string][]erpwire.Row{"mobile_pairings": {{"org_id": mnOrg, "created_by": mnUser, "token_hash": tokenHash(token), "expires_at": mnTime(mnNow.Add(time.Minute)), "consumed_at": nil}}, "organizations": {{"id": mnOrg, "name": "Example"}}}}
	s := mnService(db)
	s.mobile.Credentials = mnCredentials{a, "mobile_pairing", tokenHash(token)}
	request := mnRequest("POST", erpwire.Row{"token": token, "deviceName": " Phone "}, nil)
	first := mnCall(t, s.mobileRedeem, erpwire.Actor{}, request)
	if first.Status != 200 {
		t.Fatalf("redemption failed: %+v", first)
	}
	body := first.Body.(map[string]any)
	credential := text(body["deviceToken"])
	device := db.rows["mobile_devices"][0]
	if len(credential) != 43 || device["token_hash"] != tokenHash(credential) || device["name"] != "Phone" || body["connectionOnly"] != true || body["orgName"] != "Example" {
		t.Fatalf("bad device: %+v / %+v", device, body)
	}
	replay := mnCall(t, s.mobileRedeem, erpwire.Actor{}, request)
	if replay.Status != 400 || mnResponseError(replay) != "Invalid or expired pairing code." || len(db.rows["mobile_devices"]) != 1 {
		t.Fatalf("replayed pairing: %+v", replay)
	}
}
func TestPairingExpiryAndForeignOrganization(t *testing.T) {
	for _, test := range []struct{ name, org, expiry string }{{"expired", mnOrg, mnTime(mnNow)}, {"foreign", mnOtherOrg, mnTime(mnNow.Add(time.Minute))}} {
		t.Run(test.name, func(t *testing.T) {
			token := strings.Repeat("a", 43)
			db := &mnStore{rows: map[string][]erpwire.Row{"mobile_pairings": {{"org_id": test.org, "created_by": mnUser, "token_hash": tokenHash(token), "expires_at": test.expiry, "consumed_at": nil}}}}
			s := mnService(db)
			s.mobile.Credentials = mnCredentials{mnActor(t, erpwire.Owner), "mobile_pairing", tokenHash(token)}
			r := mnCall(t, s.mobileRedeem, erpwire.Actor{}, mnRequest("POST", erpwire.Row{"token": token}, nil))
			if r.Status != 400 || len(db.rows["mobile_devices"]) != 0 {
				t.Fatalf("invalid pairing accepted: %+v", r)
			}
		})
	}
}
func TestPrivateTailscaleReadiness(t *testing.T) {
	status := json.RawMessage(`{"BackendState":"Running","Self":{"Online":true,"DNSName":"erp.tailnet.ts.net."}}`)
	for _, test := range []struct{ name, serve, want string }{{"private", `{"TCP":{"443":{"HTTPS":true}},"Web":{"erp.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3128"}}}}}`, "https://erp.tailnet.ts.net"}, {"funnel", `{"TCP":{"443":{"HTTPS":true}},"Web":{"erp.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3128"}}}},"AllowFunnel":{"erp.tailnet.ts.net:443":true}}`, ""}, {"wrong backend", `{"TCP":{"443":{"HTTPS":true}},"Web":{"erp.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3100"}}}}}`, ""}, {"ambiguous", `{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"erp.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3128"}}},"erp.tailnet.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3128"}}}}}`, ""}} {
		t.Run(test.name, func(t *testing.T) {
			if got := verifiedServeOrigin(status, json.RawMessage(test.serve), "http://127.0.0.1:3128"); got != test.want {
				t.Fatalf("got %q want %q", got, test.want)
			}
		})
	}
	for _, input := range []string{"https://user:pass@erp.tailnet.ts.net", "https://erp.tailnet.ts.net/path", "http://erp.tailnet.ts.net", "https://public.example", "https://erp.tailnet.ts.net:0", "https://erp.tailnet.ts.net/?q=1"} {
		if normalizePairBase(input) != "" {
			t.Fatalf("unsafe base accepted: %s", input)
		}
	}
}
func TestNetworkMetadataValidationAndBoundaries(t *testing.T) {
	socket := erpwire.Row{"id": "socket_1", "localAddress": "192.0.2.1", "remoteAddress": "2001:db8::1", "localPort": json.Number("51234"), "remotePort": json.Number("443"), "protocol": "tcp", "process": "Google_Chrome", "pid": json.Number("42"), "password": "discard"}
	report := erpwire.Row{"capturedAt": "2026-11-08T01:00:00.123456789Z", "coverage": "current_user_tcp_snapshot", "truncated": false, "observations": []any{socket}, "rawLogs": "discard"}
	parsed := parseNetworkReport(report)
	if parsed == nil || parsed.CapturedAt != "2026-11-08T01:00:00.123Z" || len(parsed.Observations) != 1 || parsed.Observations[0].PID != 42 {
		t.Fatalf("wrong projection: %+v", parsed)
	}
	bytes, _ := json.Marshal(parsed)
	if strings.Contains(string(bytes), "discard") {
		t.Fatal("metadata leaked")
	}
	for _, patch := range []erpwire.Row{{"pid": json.Number("1.5")}, {"pid": json.Number("2147483648")}, {"remotePort": json.Number("65536")}, {"protocol": "udp"}, {"remoteAddress": "fe80::1%en0"}, {"process": "curl --password secret"}} {
		copy := erpwire.Row{}
		for k, v := range socket {
			copy[k] = v
		}
		for k, v := range patch {
			copy[k] = v
		}
		report["observations"] = []any{copy}
		if parseNetworkReport(report) != nil {
			t.Fatalf("invalid metadata accepted: %+v", patch)
		}
	}
	for _, test := range []struct {
		offset time.Duration
		want   bool
	}{{-5 * time.Minute, true}, {time.Minute, true}, {-5*time.Minute - time.Millisecond, false}, {time.Minute + time.Millisecond, false}} {
		if got := captureAllowed(mnTime(mnNow.Add(test.offset)), mnNow); got != test.want {
			t.Fatalf("offset %s got %v", test.offset, got)
		}
	}
}
func TestNetworkBodyAndOriginBoundaries(t *testing.T) {
	s := mnService(&mnStore{})
	for _, test := range []struct {
		name   string
		r      Request
		status int
	}{{"media", Request{Headers: map[string]string{"content-type": "text/plain"}, Body: []byte("{}")}, 415}, {"claimed excess", Request{Headers: map[string]string{"content-type": "application/json", "content-length": "262145"}, Body: []byte("{}")}, 413}, {"actual excess", Request{Headers: map[string]string{"content-type": "application/json", "content-length": "1"}, Body: []byte(strings.Repeat("x", networkMaxBody+1))}, 413}, {"utf8", Request{Headers: map[string]string{"content-type": "application/json"}, Body: []byte{0xff}}, 400}} {
		t.Run(test.name, func(t *testing.T) {
			_, e := networkBody(test.r)
			var safe networkError
			if !errors.As(e, &safe) || safe.status != test.status {
				t.Fatalf("got %v", e)
			}
		})
	}
	if e := s.networkOrigin(Request{URL: "https://erp.tailnet.ts.net/api", Headers: map[string]string{"origin": "https://evil.example", "x-forwarded-host": "evil.example"}}); e == nil {
		t.Fatal("forged origin accepted")
	}
}
func TestNetworkPolicyValidationAndDeduplication(t *testing.T) {
	for _, test := range []struct {
		cidrs  []string
		status int
	}{{[]string{"192.0.2.0/24", "2001:db8::/32", "192.0.2.0/24"}, 200}, {[]string{"192.0.2.1/033"}, 400}, {[]string{"fe80::1%en0/64"}, 400}, {[]string{"0.0.0.0/33"}, 400}} {
		db := &mnStore{rows: map[string][]erpwire.Row{}}
		s := mnService(db)
		r := mnCall(t, s.networkPolicy, mnActor(t, erpwire.Owner), mnRequest("POST", erpwire.Row{"allowedCidrs": test.cidrs}, nil))
		if r.Status != test.status {
			t.Fatalf("CIDRs %+v got %+v", test.cidrs, r)
		}
		if r.Status == 200 {
			if !reflect.DeepEqual(db.rows["network_policy"][0]["allowed_cidrs"], []string{"192.0.2.0/24", "2001:db8::/32"}) {
				t.Fatal("deduplication failed")
			}
		} else if db.writes != 0 {
			t.Fatal("invalid policy persisted")
		}
	}
}

func TestNetworkTelemetryTransitions(t *testing.T) {
	token := strings.Repeat("a", 43)
	db := &mnStore{rows: map[string][]erpwire.Row{"network_devices": {{"id": mnDevice, "org_id": mnOrg, "token_hash": tokenHash(token), "revoked_at": nil}}}}
	s := mnService(db)
	s.mobile.Credentials = mnCredentials{mnActor(t, erpwire.Owner), "network_device", tokenHash(token)}
	request := func(capture time.Time, id string) json.RawMessage {
		body, _ := json.Marshal(erpwire.Row{"deviceId": id, "report": erpwire.Row{"capturedAt": mnTime(capture), "coverage": "current_user_tcp_snapshot", "truncated": false, "observations": []any{}}})
		raw, _ := json.Marshal([]Request{{Method: "POST", Headers: map[string]string{"authorization": "Bearer " + token, "content-type": "application/json"}, Body: body}})
		return raw
	}
	for _, test := range []struct {
		name    string
		capture time.Time
		id      string
		status  int
		message string
	}{
		{"first", mnNow, mnDevice, 202, ""}, {"replay", mnNow, mnDevice, 409, "Report not accepted: device revoked or report is not newer."}, {"older", mnNow.Add(-time.Second), mnDevice, 409, "Report not accepted: device revoked or report is not newer."}, {"future", mnNow.Add(time.Minute + time.Millisecond), mnDevice, 400, "Invalid, expired, or future-dated metadata report."}, {"wrong device", mnNow.Add(time.Second), mnOtherOrg, 400, "Report device does not match the registered device."}, {"newer", mnNow.Add(time.Second), mnDevice, 202, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := mnCall(t, s.networkTelemetry, erpwire.Actor{}, request(test.capture, test.id))
			if r.Status != test.status || mnResponseError(r) != test.message {
				t.Fatalf("got %+v", r)
			}
		})
	}
	db.rows["network_devices"][0]["revoked_at"] = mnTime(mnNow)
	revoked := mnCall(t, s.networkTelemetry, erpwire.Actor{}, request(mnNow.Add(2*time.Second), mnDevice))
	if revoked.Status != 401 || mnResponseError(revoked) != "Device authentication required." {
		t.Fatalf("revoked accepted: %+v", revoked)
	}
	if db.rows["network_devices"][0]["capture"] != mnTime(mnNow.Add(time.Second)) {
		t.Fatal("rejected report replaced latest metadata")
	}
}

func TestMobileStartVerifiesMappingAndStoresNoRawToken(t *testing.T) {
	db := &mnStore{rows: map[string][]erpwire.Row{}}
	s := mnService(db)
	uri := ""
	s.mobile.QR = mnQR{&uri}
	s.mobile.Backend = "http://127.0.0.1:3128"
	s.mobile.Tailscale = mnDiscovery{`{"BackendState":"Running","Self":{"Online":true,"DNSName":"erp.tailnet.ts.net."}}`, `{"TCP":{"443":{"HTTPS":true}},"Web":{"erp.tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3128"}}}}}`}
	r := mnCall(t, s.mobileStart, mnActor(t, erpwire.Owner), mnRequest("POST", erpwire.Row{}, nil))
	if r.Status != 200 || len(db.rows["mobile_pairings"]) != 1 {
		t.Fatalf("start failed: %+v", r)
	}
	if !strings.HasPrefix(uri, "bbn-pair://redeem?u=https%3A%2F%2Ferp.tailnet.ts.net&t=") {
		t.Fatalf("invalid pairing URI %s", uri)
	}
	parts := strings.Split(strings.Split(uri, "&t=")[1], "&")
	token := parts[0]
	pair := db.rows["mobile_pairings"][0]
	if pair["token_hash"] != tokenHash(token) || pair["expires_at"] != mnTime(mnNow.Add(5*time.Minute)) || pair["org_id"] != mnOrg {
		t.Fatalf("bad pairing record %+v", pair)
	}
	serialized, _ := json.Marshal(pair)
	if strings.Contains(string(serialized), token) {
		t.Fatal("raw pairing token persisted")
	}
	before := db.writes
	bad := mnCall(t, s.mobileStart, mnActor(t, erpwire.Owner), mnRequest("POST", erpwire.Row{"baseUrl": "https://other.tailnet.ts.net"}, nil))
	if bad.Status != 400 || db.writes != before {
		t.Fatal("manual foreign mapping accepted")
	}
}

func TestMobileEmptyOriginAndNetworkObservationLimit(t *testing.T) {
	db := &mnStore{rows: map[string][]erpwire.Row{}}
	s := mnService(db)
	raw, _ := json.Marshal([]Request{{Method: "POST", Headers: map[string]string{"origin": ""}, Body: []byte(`{"token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)}})
	r := mnCall(t, s.mobileRedeem, erpwire.Actor{}, raw)
	if r.Status != 403 || mnResponseError(r) != "Untrusted request origin." {
		t.Fatalf("empty Origin accepted: %+v", r)
	}
	observations := []any{}
	for i := 0; i < 500; i++ {
		observations = append(observations, erpwire.Row{"id": "socket_" + strconv.Itoa(i), "localAddress": "192.0.2.1", "remoteAddress": "::1", "localPort": json.Number("1"), "remotePort": json.Number("65535"), "protocol": "tcp", "process": "curl", "pid": json.Number("2147483647")})
	}
	report := erpwire.Row{"capturedAt": mnTime(mnNow), "coverage": "current_user_tcp_snapshot", "truncated": false, "observations": observations}
	if got := parseNetworkReport(report); got == nil || len(got.Observations) != 500 {
		t.Fatal("500 observation boundary rejected")
	}
	report["observations"] = append(observations, observations[0])
	if parseNetworkReport(report) != nil {
		t.Fatal("501 observations accepted")
	}
}
