package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type networkSchemaStore struct{ *insightAuditStore }

func (f *networkSchemaStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	return f.insightAuditStore.Read(ctx, a, func(erpwire.ReadTx) error { return fn(f) })
}

func (f *networkSchemaStore) Select(ctx context.Context, q erpwire.Select) (erpwire.Selection, error) {
	if q.Table == "network_policy" {
		for _, order := range q.Order {
			if order.Column == "id" {
				return erpwire.Selection{}, errors.New("network_policy has no id column")
			}
		}
	}
	return f.insightAuditStore.Select(ctx, q)
}

func networkTestReport() erpwire.Row {
	return erpwire.Row{"capturedAt": "2026-11-06T12:00:00.123456789Z", "coverage": "current_user_tcp_snapshot", "truncated": false, "observations": []any{erpwire.Row{"id": "socket_abc", "localAddress": "192.0.2.10", "localPort": int64(51234), "remoteAddress": "2001:db8::1", "remotePort": int64(443), "protocol": "tcp", "process": "Google_Chrome", "pid": int64(42)}}}
}
func TestNetworkMetadataValidationAndProjection(t *testing.T) {
	for _, test := range []struct {
		key   string
		value any
	}{{"process", "/usr/bin/curl"}, {"process", "curl --password secret"}, {"process", "curl\nsecret"}, {"process", strings.Repeat("a", 81)}, {"pid", int64(0)}, {"pid", int64(2147483648)}, {"pid", json.Number("1.5")}, {"localPort", int64(0)}, {"remotePort", int64(65536)}, {"remotePort", "443"}, {"protocol", "udp"}, {"remoteAddress", "example.org"}, {"localAddress", "999.0.0.1"}, {"remoteAddress", "fe80::1%en0"}, {"id", "socket unsafe"}} {
		t.Run(test.key+"="+auditCSVCell(test.value), func(t *testing.T) {
			row := networkTestReport()
			socket := row["observations"].([]any)[0].(erpwire.Row)
			socket[test.key] = test.value
			if result := parseCollectorReport(row); result != nil {
				t.Fatalf("unsafe metadata accepted: %#v", result)
			}
		})
	}
	row := networkTestReport()
	row["token"] = "discard"
	socket := row["observations"].([]any)[0].(erpwire.Row)
	socket["payload"] = "discard"
	socket["pid"] = json.Number("42.0")
	got := parseCollectorReport(row)
	if got == nil || got.CapturedAt != "2026-11-06T12:00:00.123Z" || got.Observations[0].PID != 42 {
		t.Fatalf("safe projected report changed: %#v", got)
	}
	data, e := json.Marshal(got)
	if e != nil || strings.Contains(string(data), "discard") || strings.Contains(string(data), "token") || strings.Contains(string(data), "payload") {
		t.Fatalf("non-allowlisted data escaped: %s %v", data, e)
	}
	row = networkTestReport()
	row["observations"] = []any{}
	if got = parseCollectorReport(row); got == nil || got.Observations == nil || len(got.Observations) != 0 {
		t.Fatal("empty heartbeat invalid")
	}
	row = networkTestReport()
	row["observations"] = append(row["observations"].([]any), row["observations"].([]any)[0])
	if parseCollectorReport(row) != nil {
		t.Fatal("duplicate IDs accepted")
	}
	for _, stamp := range []string{"2026-11-06T12:00:00.1234567890Z", "2026-11-06", "2026-13-06T00:00:00Z"} {
		row = networkTestReport()
		row["capturedAt"] = stamp
		if parseCollectorReport(row) != nil {
			t.Fatalf("invalid capture time accepted %q", stamp)
		}
	}
	for _, test := range []struct{ stamp, want string }{{"2026-02-30T00:00:00Z", "2026-03-02T00:00:00.000Z"}, {"2026-11-06T24:00:00Z", "2026-11-07T00:00:00.000Z"}, {"2026-11-06T12:00:00.123456789+07:00", "2026-11-06T05:00:00.123Z"}} {
		row = networkTestReport()
		row["capturedAt"] = test.stamp
		got := parseCollectorReport(row)
		if got == nil || got.CapturedAt != test.want {
			t.Fatalf("Date.parse normalization %q: %#v", test.stamp, got)
		}
	}
}

func TestNetworkOwnerScopeAndSafeStoredProjection(t *testing.T) {
	a := insightAuditActor(t, erpwire.Admin)
	f := &insightAuditStore{tables: map[string][]erpwire.Row{"network_devices": {{"id": "own", "name": "device", "org_id": a.OrgID(), "created_at": "2026-11-06T00:00:00Z", "last_received_at": "2026-11-08T00:00:00Z", "revoked_at": nil, "latest_report": networkTestReport(), "token_hash": "secret"}, {"id": "foreign", "org_id": "foreign", "latest_report": networkTestReport()}}, "network_policy": {{"org_id": a.OrgID(), "allowed_cidrs": []string{"192.0.2.0/24"}}, {"org_id": "foreign", "allowed_cidrs": []string{"private"}}}}}
	s := insightAuditService(t, f)
	s.store = &networkSchemaStore{f}
	v, e := s.networkPage(context.Background(), a, json.RawMessage(`[]`))
	if e != nil {
		t.Fatal(e)
	}
	out := v.(NetworkPageData)
	if out.AppOrigin != "https://example.test" || out.Initial.ServerTime != "2026-11-08T00:00:00.000Z" || len(out.Initial.Devices) != 1 || out.Initial.Devices[0].ID != "own" || !reflect.DeepEqual(out.Initial.Policy.AllowedCIDRs, []string{"192.0.2.0/24"}) {
		t.Fatalf("network snapshot scope/config drift: %#v", out)
	}
	data, e := json.Marshal(out)
	if e != nil || strings.Contains(string(data), "secret") || strings.Contains(string(data), "foreign") || strings.Contains(string(data), "org_id") {
		t.Fatalf("sensitive projection: %s %v", data, e)
	}
}
