package erpinsight

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type insightAuditStore struct {
	tables   map[string][]erpwire.Row
	queries  []erpwire.Select
	commands []struct {
		name string
		row  erpwire.Row
	}
	selectError map[string]error
	rpcError    error
	reviewed    map[string]bool
}

func (f *insightAuditStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(f)
}
func (f *insightAuditStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(f)
}
func (f *insightAuditStore) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	f.queries = append(f.queries, q)
	if e := f.selectError[q.Table]; e != nil {
		return erpwire.Selection{}, e
	}
	rows := []erpwire.Row{}
	for _, row := range f.tables[q.Table] {
		matches := true
		for _, p := range q.Where {
			switch p.Op {
			case erpwire.Equal:
				matches = matches && reflect.DeepEqual(row[p.Column], p.Value)
			case erpwire.In:
				found := false
				values := reflect.ValueOf(p.Value)
				for i := 0; i < values.Len(); i++ {
					if reflect.DeepEqual(row[p.Column], values.Index(i).Interface()) {
						found = true
					}
				}
				matches = matches && found
			default:
				return erpwire.Selection{}, fmt.Errorf("unhandled predicate %s", p.Op)
			}
		}
		if matches {
			copy := erpwire.Row{}
			for _, column := range q.Columns {
				copy[column] = row[column]
			}
			rows = append(rows, copy)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, o := range q.Order {
			a, b := fmt.Sprint(rows[i][o.Column]), fmt.Sprint(rows[j][o.Column])
			if a == b {
				continue
			}
			if o.Descending {
				return a > b
			}
			return a < b
		}
		return false
	})
	total := int64(len(rows))
	if q.Offset > len(rows) {
		rows = []erpwire.Row{}
	} else {
		rows = rows[q.Offset:]
	}
	more := q.Limit > 0 && len(rows) > q.Limit
	if more {
		rows = rows[:q.Limit]
	}
	return erpwire.Selection{Rows: rows, Total: &total, HasMore: more}, nil
}
func (f *insightAuditStore) ReadRPC(_ context.Context, name string, row erpwire.Row) (json.RawMessage, error) {
	f.commands = append(f.commands, struct {
		name string
		row  erpwire.Row
	}{name, row})
	if f.rpcError != nil {
		return nil, f.rpcError
	}
	if name == "verify_close_activity_chain" {
		return json.RawMessage(`{"ok":true,"checked":0}`), nil
	}
	if name == "find_support_export" {
		return json.RawMessage(`{"sha256":"stored","kind":"close_activity_csv","period":"2026-11-08","bytes":12,"summary":"file"}`), nil
	}
	return nil, fmt.Errorf("unexpected read command %s", name)
}
func (f *insightAuditStore) Command(_ context.Context, name string, row erpwire.Row) (json.RawMessage, error) {
	f.commands = append(f.commands, struct {
		name string
		row  erpwire.Row
	}{name, row})
	if f.rpcError != nil {
		return nil, f.rpcError
	}
	if name == "review_support_pack" {
		if f.reviewed == nil {
			f.reviewed = map[string]bool{}
		}
		key := text(row["p_org_id"]) + text(row["p_sha256"])
		already := f.reviewed[key]
		f.reviewed[key] = true
		return json.Marshal(erpwire.Row{"already": already})
	}
	if name == "record_support_export" {
		return json.RawMessage(`null`), nil
	}
	return nil, fmt.Errorf("unexpected command %s", name)
}
func (f *insightAuditStore) Insert(context.Context, erpwire.Insert) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected insert")
}
func (f *insightAuditStore) Update(context.Context, string, erpwire.Row, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected update")
}
func (f *insightAuditStore) Delete(context.Context, string, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected delete")
}

func insightAuditActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: "11111111-1111-4111-8111-111111111111", Email: "tester@example.test", Assurance: erpwire.AAL2, FactorStateKnown: true, ExpiresAt: time.Now().Add(time.Hour)}, erpwire.Membership{UserID: "11111111-1111-4111-8111-111111111111", OrgID: "22222222-2222-4222-8222-222222222222", OrgName: "Workspace", Role: role}, false, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func insightAuditService(t *testing.T, f *insightAuditStore) *Service {
	t.Helper()
	s, e := New(Options{Store: f, Now: func() time.Time { return time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC) }, AppOrigin: "https://example.test"})
	if e != nil {
		t.Fatal(e)
	}
	return s
}

func TestAuditAuthorizationBeforeStoreAccess(t *testing.T) {
	f := &insightAuditStore{}
	s := insightAuditService(t, f)
	for _, op := range []erpwire.Operation{s.auditPage, s.closeAuditPage, s.findSupportExport, s.reviewSupportPack, s.exportCloseAudit, s.automationPage, s.networkPage} {
		if _, e := op(context.Background(), erpwire.Actor{}, json.RawMessage(`[]`)); !errors.Is(e, erpwire.ErrUnauthenticated) {
			t.Fatalf("unbound actor acquired data: %v", e)
		}
	}
	if len(f.queries) != 0 || len(f.commands) != 0 {
		t.Fatal("unauthenticated request reached store")
	}
	a := insightAuditActor(t, erpwire.Member)
	for _, op := range []erpwire.Operation{s.auditPage, s.closeAuditPage} {
		v, e := op(context.Background(), a, json.RawMessage(`[]`))
		if e != nil || v.(AuditPageData).Allowed {
			t.Fatalf("member acquired audit page: %#v %v", v, e)
		}
	}
	for _, test := range []struct {
		op      erpwire.Operation
		message string
	}{{s.findSupportExport, "Only owners, admins, and accountants can check an export."}, {s.reviewSupportPack, "Only owners, admins, and accountants can review a support file."}} {
		v, e := test.op(context.Background(), a, json.RawMessage(`["invalid"]`))
		if e != nil || v.(erpwire.ActionResponse).Value.(erpwire.Row)["error"] != test.message {
			t.Fatalf("denial changed: %#v %v", v, e)
		}
	}
	v, e := s.exportCloseAudit(context.Background(), a, json.RawMessage(`[]`))
	if e != nil || v.(HTTPResponse).Status != 403 {
		t.Fatalf("member exported close activity: %#v %v", v, e)
	}
	if _, e = s.networkPage(context.Background(), a, json.RawMessage(`[]`)); !errors.Is(e, erpwire.ErrForbidden) {
		t.Fatalf("member acquired network visibility: %v", e)
	}
	if len(f.queries) != 0 || len(f.commands) != 0 {
		t.Fatal("role denial reached store")
	}
}

func TestAuditScopedRowsAndReviewIdempotency(t *testing.T) {
	a := insightAuditActor(t, erpwire.Accountant)
	hash := strings.Repeat("a", 64)
	f := &insightAuditStore{tables: map[string][]erpwire.Row{"audit_log": {{"id": "own", "org_id": a.OrgID(), "actor_id": a.UserID(), "action": "support_pack_reviewed", "meta": erpwire.Row{"sha256": hash}, "created_at": "2026-11-08T00:00:00Z"}, {"id": "foreign", "org_id": "another-org", "action": "support_exported", "meta": erpwire.Row{"sha256": "private"}, "created_at": "2026-11-08T00:00:00Z"}}}}
	s := insightAuditService(t, f)
	v, e := s.closeAuditPage(context.Background(), a, json.RawMessage(`[]`))
	if e != nil {
		t.Fatal(e)
	}
	out := v.(AuditPageData)
	if len(out.Entries) != 1 || out.Entries[0]["id"] != "own" || !reflect.DeepEqual(out.Reviewed, []string{hash}) {
		t.Fatalf("cross-org rows/reviews: %#v", out)
	}
	for i := 0; i < 2; i++ {
		v, e = s.reviewSupportPack(context.Background(), a, json.RawMessage(`[" `+strings.ToUpper(hash)+` "]`))
		if e != nil {
			t.Fatal(e)
		}
		got := v.(erpwire.ActionResponse).Value.(erpwire.Row)["already"]
		if i == 0 && got != nil || i == 1 && got != true {
			t.Fatalf("review retry %d: %#v", i, v)
		}
	}
	for _, call := range f.commands {
		if call.row["p_org_id"] != a.OrgID() {
			t.Fatalf("RPC escaped actor organization: %#v", call)
		}
	}
	for _, op := range []erpwire.Operation{s.findSupportExport, s.reviewSupportPack} {
		v, e = op(context.Background(), a, json.RawMessage(`["bad"]`))
		if e != nil || v.(erpwire.ActionResponse).Value.(erpwire.Row)["error"] != "Enter a SHA-256 checksum." {
			t.Fatalf("checksum validation: %#v %v", v, e)
		}
	}
}

func TestCloseAuditCSVExactBytesAndStoredChecksum(t *testing.T) {
	a := insightAuditActor(t, erpwire.Owner)
	f := &insightAuditStore{tables: map[string][]erpwire.Row{"audit_log": {{"id": "event", "org_id": a.OrgID(), "actor_email": "=danger", "action": "finance_lock_reopened", "summary": "เปิด,\"งวด\"", "created_at": "2026-11-07T00:00:00Z", "meta": erpwire.Row{"lockDate": "2026-10-31", "previousLockDate": "2026-11-30", "reason": "review", "requestedBy": "one", "confirmedBy": "two", "kind": "operational_lock"}, "close_chain_seq": int64(1), "close_chain_prev": "", "close_chain_sha256": "chain"}}}}
	s := insightAuditService(t, f)
	v, e := s.exportCloseAudit(context.Background(), a, json.RawMessage(`[]`))
	if e != nil {
		t.Fatal(e)
	}
	got := v.(HTTPResponse)
	if got.Status != 200 {
		t.Fatalf("export status %d", got.Status)
	}
	lines := strings.Split(got.Body, "\r\n")
	if len(lines) != 8 || !strings.HasPrefix(lines[0], "\ufeffSection,Id,Recorded at,Actor,Action,Summary,") {
		t.Fatalf("CSV records/terminators: %q", got.Body)
	}
	expected := `event,event,2026-11-07T00:00:00Z,'=danger,finance_lock_reopened,"เปิด,""งวด""",2026-11-30 (30/11/2569),2026-10-31 (31/10/2569),,review,คนที่สองยืนยัน / a second owner or admin confirmed,,,,,1,,chain`
	if lines[7] != expected {
		t.Fatalf("CSV event bytes\ngot  %q\nwant %q", lines[7], expected)
	}
	if !strings.Contains(lines[1], closeActivityDisclaimerTH) || !strings.Contains(lines[6], closeActivityChainEN) {
		t.Fatal("support disclaimers missing")
	}
	hash := sha256.Sum256([]byte(got.Body))
	sum := hex.EncodeToString(hash[:])
	call := f.commands[len(f.commands)-1]
	if call.name != "record_support_export" || call.row["p_sha256"] != sum || call.row["p_bytes"] != len([]byte(got.Body)) || call.row["p_kind"] != "close_activity_csv" || call.row["p_period"] != "2026-11-08" {
		t.Fatalf("recorded checksum drift: %#v", call)
	}
	if got.Headers["X-Content-SHA256"] != sum || got.Headers["Content-Disposition"] != `attachment; filename="close-activity-2026-11-08.csv"` {
		t.Fatalf("download headers: %#v", got.Headers)
	}
	f.rpcError = errors.New("offline")
	v, e = s.exportCloseAudit(context.Background(), a, json.RawMessage(`[]`))
	if e != nil || v.(HTTPResponse).Status != 503 || v.(HTTPResponse).Body != "Support export was not recorded. Reload and try the download again." {
		t.Fatalf("unrecorded export escaped: %#v %v", v, e)
	}
}

func TestCloseActivityActionViewsAndBoundaries(t *testing.T) {
	if got := auditSentence(erpwire.Row{"action": "__foo__", "entity": "record"}); got != "System Foo record" {
		t.Fatalf("unknown action humanization: %q", got)
	}
	if got := closeActivityView("finance_lock_updated", erpwire.Row{"lockDate": "0099-01-01"})["lockDate"]; got != "0099-01-01" {
		t.Fatalf("JS Date.UTC ancient-year behavior changed: %v", got)
	}
	for _, action := range closeAuditActions {
		view := closeActivityView(action, nil)
		if view["actionLabel"] != closeAuditLabels[action] {
			t.Fatalf("missing label %s: %#v", action, view)
		}
	}
	for _, test := range []struct {
		meta    erpwire.Row
		control string
	}{{erpwire.Row{}, "คำสั่งเก่า ไม่มีเหตุผล / older command, no reason recorded"}, {erpwire.Row{"reason": "review", "requestedBy": "same", "confirmedBy": "same"}, "คนเดียว / one owner or admin"}, {erpwire.Row{"reason": "review", "requestedBy": "one", "confirmedBy": "two"}, "คนที่สองยืนยัน / a second owner or admin confirmed"}} {
		if got := closeActivityView("finance_lock_reopened", test.meta)["control"]; got != test.control {
			t.Fatalf("reopen control %#v", got)
		}
	}
	for _, test := range []struct {
		n    any
		want any
	}{{json.Number("9007199254740991"), int64(9007199254740991)}, {json.Number("9007199254740992"), nil}, {json.Number("1e3"), int64(1000)}, {json.Number("1.1"), nil}, {"12", nil}, {int64(-1), nil}} {
		if got := auditWhole(test.n); got != test.want {
			t.Fatalf("whole(%v)=%v want %v", test.n, got, test.want)
		}
	}
	if got := closeActivityView("unknown", erpwire.Row{"lockDate": "2026-02-30", "bytes": json.Number("1.0")}); got["lockDate"] != "2026-02-30" || got["bytes"] != int64(1) || got["actionLabel"] != "unknown" {
		t.Fatalf("malformed dates normalized: %#v", got)
	}
	for _, test := range []struct{ input, want string }{{"=A1", "'=A1"}, {"-7.01", "-7.01"}, {"-01", "'-01"}, {"a,b", `"a,b"`}, {"a\"b", `"a""b"`}} {
		if got := auditCSVCell(test.input); got != test.want {
			t.Fatalf("csv(%q)=%q want %q", test.input, got, test.want)
		}
	}
}
