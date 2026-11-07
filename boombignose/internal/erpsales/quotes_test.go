package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

const salesTestOrg = "10000000-0000-4000-8000-000000000001"
const salesTestForeign = "10000000-0000-4000-8000-000000000002"
const salesTestID = "20000000-0000-4000-8000-000000000001"
const salesTestKey = "30000000-0000-4000-8000-000000000001"

func salesTestActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	now := time.Now()
	user := "40000000-0000-4000-8000-000000000001"
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: user, Email: "staff@example.test", ExpiresAt: now.Add(time.Hour), Assurance: erpwire.AAL1, FactorStateKnown: true}, erpwire.Membership{UserID: user, OrgID: salesTestOrg, OrgName: "ร้านทดสอบ", Role: role}, false, now)
	if e != nil {
		t.Fatal(e)
	}
	return a
}

type salesTestStore struct {
	t             *testing.T
	tables        map[string][]erpwire.Row
	calls         []erpwire.Row
	commands      []string
	reads, writes int
	command       func(string, erpwire.Row) (json.RawMessage, error)
	selectError   map[string]error
}

func (f *salesTestStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	f.reads++
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(f)
}
func (f *salesTestStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	f.writes++
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	old := map[string][]erpwire.Row{}
	for table, rows := range f.tables {
		for _, r := range rows {
			copy := erpwire.Row{}
			for k, v := range r {
				copy[k] = v
			}
			old[table] = append(old[table], copy)
		}
	}
	e := fn(f)
	if e != nil {
		f.tables = old
	}
	return e
}
func salesTestMatch(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		same := reflect.DeepEqual(row[p.Column], p.Value)
		switch p.Op {
		case erpwire.Equal, erpwire.Is:
			if !same {
				return false
			}
		case erpwire.NotEqual:
			if same {
				return false
			}
		case erpwire.In:
			found := false
			switch vs := p.Value.(type) {
			case []string:
				for _, v := range vs {
					if row[p.Column] == v {
						found = true
					}
				}
			}
			if !found {
				return false
			}
		default:
			panic("unsupported test predicate " + string(p.Op))
		}
	}
	return true
}
func (f *salesTestStore) requireScope(where []erpwire.Predicate) {
	f.t.Helper()
	for _, p := range where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == salesTestOrg {
			return
		}
	}
	f.t.Fatalf("unscoped access %#v", where)
}
func (f *salesTestStore) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	f.requireScope(q.Where)
	if e := f.selectError[q.Table]; e != nil {
		return erpwire.Selection{}, e
	}
	rows := []erpwire.Row{}
	for _, r := range f.tables[q.Table] {
		if salesTestMatch(r, q.Where) {
			copy := erpwire.Row{}
			for k, v := range r {
				copy[k] = v
			}
			rows = append(rows, copy)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, o := range q.Order {
			a, b := text(rows[i][o.Column]), text(rows[j][o.Column])
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
	start := q.Offset
	if start > len(rows) {
		start = len(rows)
	}
	end := len(rows)
	if q.Limit > 0 && start+q.Limit < end {
		end = start + q.Limit
	}
	return erpwire.Selection{Rows: rows[start:end], Total: &total, HasMore: end < len(rows)}, nil
}
func (f *salesTestStore) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected read RPC")
}
func (f *salesTestStore) Command(_ context.Context, name string, input erpwire.Row) (json.RawMessage, error) {
	if name != "save_document_lines" && input["p_org_id"] != salesTestOrg {
		f.t.Fatalf("unscoped command %#v", input)
	}
	f.calls = append(f.calls, input)
	f.commands = append(f.commands, name)
	if f.command != nil {
		return f.command(name, input)
	}
	return json.RawMessage(`null`), nil
}
func (f *salesTestStore) Insert(_ context.Context, q erpwire.Insert) ([]erpwire.Row, error) {
	if f.tables == nil {
		f.tables = map[string][]erpwire.Row{}
	}
	out := []erpwire.Row{}
	for _, r := range q.Rows {
		if r["org_id"] != salesTestOrg {
			f.t.Fatalf("unscoped insert %#v", r)
		}
		copy := erpwire.Row{}
		for k, v := range r {
			copy[k] = v
		}
		if copy["id"] == nil {
			copy["id"] = salesTestID
		}
		f.tables[q.Table] = append(f.tables[q.Table], copy)
		out = append(out, copy)
	}
	return out, nil
}
func (f *salesTestStore) Update(_ context.Context, table string, changes erpwire.Row, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	f.requireScope(where)
	out := []erpwire.Row{}
	for _, r := range f.tables[table] {
		if salesTestMatch(r, where) {
			for k, v := range changes {
				r[k] = v
			}
			out = append(out, r)
		}
	}
	return out, nil
}
func (f *salesTestStore) Delete(_ context.Context, table string, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	f.requireScope(where)
	kept, out := []erpwire.Row{}, []erpwire.Row{}
	for _, r := range f.tables[table] {
		if salesTestMatch(r, where) {
			out = append(out, r)
		} else {
			kept = append(kept, r)
		}
	}
	f.tables[table] = kept
	return out, nil
}
func salesTestRaw(t *testing.T, args ...any) json.RawMessage {
	t.Helper()
	if args == nil {
		return json.RawMessage(`[]`)
	}
	raw, e := json.Marshal(args)
	if e != nil {
		t.Fatal(e)
	}
	return raw
}
func salesTestError(t *testing.T, value any, e error, want string) {
	t.Helper()
	if e != nil {
		t.Fatalf("unexpected error %v", e)
	}
	r, ok := value.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("unexpected result %#v", value)
	}
	row, ok := r.Value.(erpwire.Row)
	if !ok || text(row["error"]) != want {
		t.Fatalf("got %#v want %q", r.Value, want)
	}
}
func TestAllSalesOperationsRejectUnboundActor(t *testing.T) {
	f := &salesTestStore{t: t}
	s, e := New(Options{Store: f})
	if e != nil {
		t.Fatal(e)
	}
	for key, op := range s.Operations() {
		t.Run(key, func(t *testing.T) {
			_, e := op(context.Background(), erpwire.Actor{}, json.RawMessage(`[]`))
			if !errors.Is(e, erpwire.ErrUnauthenticated) {
				t.Fatalf("unbound actor accepted %v", e)
			}
		})
	}
	if f.reads+f.writes != 0 {
		t.Fatal("unauthenticated actor reached store")
	}
}
func TestQuoteEveryTransition(t *testing.T) {
	states := []string{"draft", "sent", "accepted", "declined", "expired", "converted"}
	date := today()
	for _, from := range states {
		for _, to := range quoteStatuses {
			t.Run(from+"/"+to, func(t *testing.T) {
				f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestOrg, "id": salesTestID, "number": "QUO-2026-001", "status": from, "valid_until": date}}}}
				s, _ := New(Options{Store: f})
				v, e := s.setQuoteStatus(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"id": salesTestID, "status": to}))
				allowed := from == to || from == "draft" && to == "sent" || from == "sent" && (to == "accepted" || to == "declined" || to == "expired")
				if !allowed {
					salesTestError(t, v, e, "Cannot change a "+from+" quote to "+to+".")
					if f.tables["quotes"][0]["status"] != from {
						t.Fatal("rejected transition changed state")
					}
					return
				}
				if e != nil {
					t.Fatal(e)
				}
				if f.tables["quotes"][0]["status"] != to {
					t.Fatal("transition not persisted")
				}
				r := v.(erpwire.ActionResponse)
				if from == to {
					if len(r.Refresh) != 0 || len(f.tables["audit_log"]) != 0 {
						t.Fatal("noop transition had side effects")
					}
				} else {
					if !reflect.DeepEqual(r.Refresh, []string{"/quotes", "/quotes/" + salesTestID}) || len(f.tables["audit_log"]) != 1 {
						t.Fatalf("missing transition effects %#v", r)
					}
					audit := f.tables["audit_log"][0]
					if audit["summary"] != "Set quote QUO-2026-001 to "+to || !reflect.DeepEqual(audit["meta"], erpwire.Row{"status": to}) {
						t.Fatalf("wrong audit %#v", audit)
					}
				}
			})
		}
	}
	if got := quoteTransitionError("sent", "accepted", "2025-01-01", "2026-01-01"); got != "This quote has expired." {
		t.Fatalf("expired=%q", got)
	}
	if got := quoteTransitionError("accepted", "converted", "", "2026-01-01"); got != "Use quote conversion to create the linked records." {
		t.Fatal(got)
	}
}
func TestQuoteCapabilityErrorsAndIsolation(t *testing.T) {
	f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestForeign, "id": salesTestID, "status": "sent"}}}}
	s, _ := New(Options{Store: f})
	member := salesTestActor(t, erpwire.Member)
	for _, test := range []struct {
		op      erpwire.Operation
		args    []any
		message string
	}{{s.deleteQuote, []any{erpwire.Row{"id": salesTestID}}, "Only owners and admins can delete quotes."}, {s.setQuoteStatus, []any{erpwire.Row{"id": salesTestID, "status": "accepted"}}, "Only owners and admins can accept quotes."}, {s.convertQuoteToInvoice, []any{erpwire.Row{}}, "Only owners and admins can convert quotes."}, {s.cancelQuoteInvoice, []any{erpwire.Row{}}, "Only owners and admins can cancel quote invoices."}} {
		v, e := test.op(context.Background(), member, salesTestRaw(t, test.args...))
		salesTestError(t, v, e, test.message)
	}
	if f.writes+f.reads != 0 {
		t.Fatal("denied action reached store")
	}
	v, e := s.setQuoteStatus(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"id": salesTestID, "status": "accepted"}))
	salesTestError(t, v, e, "Quote not found")
	if f.tables["quotes"][0]["status"] != "sent" {
		t.Fatal("foreign state changed")
	}
	_, e = s.quotePDF(context.Background(), member, salesTestRaw(t, salesTestID))
	if !errors.Is(e, erpwire.ErrNotFound) {
		t.Fatalf("foreign PDF visible %v", e)
	}
}
func TestQuoteMoneyAndValidation(t *testing.T) {
	for _, test := range []struct {
		value any
		want  int64
		valid bool
	}{{"0.01", 1, true}, {"90071992547409.91", 9007199254740991, true}, {json.Number("12.34"), 1234, true}, {"90071992547409.92", 0, false}, {"1.001", 0, false}, {"-1", 0, false}, {nil, 0, false}, {true, 0, false}} {
		input := erpwire.Row{"client_id": salesTestID, "discountBaht": test.value}
		row, ok := quoteColumns(input, true)
		if ok != test.valid || ok && row["discount_satang"] != test.want {
			t.Fatalf("input %#v => %#v,%v", test.value, row, ok)
		}
	}
	row, ok := quoteColumns(erpwire.Row{"id": "q", "client_id": "c", "discountBaht": "0", "notes": " ", "number": " ", "issue_date": ""}, false)
	if !ok {
		t.Fatal("valid optional values rejected")
	}
	for _, key := range []string{"notes", "number", "issue_date"} {
		if _, present := row[key]; present {
			t.Fatalf("blank optional %s would overwrite existing field", key)
		}
	}
	for _, status := range []string{"accepted", "declined", "expired", "converted"} {
		f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestOrg, "id": salesTestID, "status": status}}}}
		s, _ := New(Options{Store: f})
		v, e := s.updateQuote(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"id": salesTestID, "client_id": salesTestID, "discountBaht": "0"}))
		salesTestError(t, v, e, "This quote is locked")
	}
}
func TestQuoteConversionModesAndRetryIdentity(t *testing.T) {
	for _, test := range []struct {
		name     string
		input    erpwire.Row
		valid    bool
		expected erpwire.Row
	}{{"full", erpwire.Row{}, true, erpwire.Row{}}, {"quantity", erpwire.Row{"lines": []any{erpwire.Row{"quote_item_id": salesTestID, "quantity": "0.001"}}}, true, erpwire.Row{"p_lines": []erpwire.Row{{"quote_item_id": salesTestID, "quantity": json.Number("0.001")}}}}, {"deposit", erpwire.Row{"depositSatang": json.Number("9007199254740991")}, true, erpwire.Row{"p_deposit_satang": int64(9007199254740991)}}, {"basis points", erpwire.Row{"depositBps": json.Number("10000")}, true, erpwire.Row{"p_deposit_bps": int64(10000)}}, {"conflict", erpwire.Row{"depositBps": json.Number("1"), "depositSatang": json.Number("1")}, false, nil}, {"duplicate", erpwire.Row{"lines": []any{erpwire.Row{"quote_item_id": salesTestID, "quantity": "1"}, erpwire.Row{"quote_item_id": salesTestID, "quantity": "1"}}}, false, nil}, {"fractional satang", erpwire.Row{"depositSatang": json.Number("1.1")}, false, nil}, {"overflow", erpwire.Row{"depositSatang": json.Number("9007199254740992")}, false, nil}, {"zero qty", erpwire.Row{"lines": []any{erpwire.Row{"quote_item_id": salesTestID, "quantity": "0"}}}, false, nil}} {
		t.Run(test.name, func(t *testing.T) {
			input := test.input
			input["id"] = salesTestID
			input["key"] = salesTestKey
			f := &salesTestStore{t: t, command: func(name string, input erpwire.Row) (json.RawMessage, error) {
				if name != "convert_accepted_quote" {
					t.Fatal(name)
				}
				return json.Marshal(salesTestID)
			}}
			s, _ := New(Options{Store: f})
			for range 2 {
				v, e := s.convertQuoteToInvoice(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, input))
				if !test.valid {
					salesTestError(t, v, e, "Invalid input")
					continue
				}
				if e != nil {
					t.Fatal(e)
				}
				if v.(erpwire.ActionResponse).Redirect != "/finance/invoices/"+salesTestID {
					t.Fatal("conversion redirect")
				}
			}
			if !test.valid {
				if len(f.calls) != 0 {
					t.Fatal("invalid conversion called store")
				}
				return
			}
			want := erpwire.Row{"p_org_id": salesTestOrg, "p_quote_id": salesTestID, "p_key": salesTestKey}
			for k, v := range test.expected {
				want[k] = v
			}
			if len(f.calls) != 2 || !reflect.DeepEqual(f.calls[0], want) || !reflect.DeepEqual(f.calls[0], f.calls[1]) {
				t.Fatalf("conversion/retry payload %#v want %#v", f.calls, want)
			}
		})
	}
}
func TestQuoteNumberReservationAndCrossOrgDelete(t *testing.T) {
	f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestForeign, "id": salesTestID, "number": "foreign"}}}, command: func(name string, input erpwire.Row) (json.RawMessage, error) {
		if name != "reserve_document_number" || input["p_kind"] != "quote" {
			t.Fatalf("number command %s %#v", name, input)
		}
		return json.RawMessage(`"QUO-2026-007"`), nil
	}}
	s, _ := New(Options{Store: f})
	v, e := s.createQuote(context.Background(), salesTestActor(t, erpwire.Member), salesTestRaw(t, erpwire.Row{"client_id": salesTestID, "discountBaht": "0.01"}))
	if e != nil {
		t.Fatal(e)
	}
	if v.(erpwire.ActionResponse).Redirect != "/quotes/"+salesTestID {
		t.Fatal(v)
	}
	created := f.tables["quotes"][1]
	if created["number"] != "QUO-2026-007" || created["discount_satang"] != int64(1) || created["status"] != "draft" {
		t.Fatalf("bad quote %#v", created)
	}
	_, e = s.deleteQuote(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"id": salesTestID}))
	if e != nil || len(f.tables["quotes"]) != 1 || f.tables["quotes"][0]["number"] != "foreign" {
		t.Fatalf("foreign deleted %v %#v", e, f.tables["quotes"])
	}
}
func TestSalesChainPreservesOutstandingMoney(t *testing.T) {
	for _, test := range []struct {
		status  string
		invoice erpwire.Row
		want    string
	}{{"sent", nil, "accept"}, {"accepted", nil, "convert"}, {"converted", nil, "convert"}, {"declined", nil, ""}, {"accepted", erpwire.Row{"status": "draft", "issued": false, "outstandingSatang": money.Satang(1)}, "issue"}, {"accepted", erpwire.Row{"status": "sent", "issued": true, "outstandingSatang": money.Satang(1)}, "pay"}, {"converted", erpwire.Row{"status": "paid", "issued": true, "outstandingSatang": int64(0)}, ""}} {
		chain := salesChain(test.status, test.invoice, true)
		next, _ := chain["next"].(erpwire.Row)
		if text(next["command"]) != test.want {
			t.Fatalf("chain %#v want %s", chain, test.want)
		}
	}
}
func TestSalesMoneyNeverLosesSatang(t *testing.T) {
	if got := salesFormatTHB(money.MaxSafeSatang); got != "฿90,071,992,547,409.91" {
		t.Fatal(got)
	}
	if got := salesFormatTHB(-1); got != "-฿0.01" {
		t.Fatal(got)
	}
	if _, e := checkedSum(money.MaxSafeSatang, 1); e == nil {
		t.Fatal("unsafe sum accepted")
	}
	html := salesQuoteEmail(`<script>`, `ลูกค้า & "x"`, 1, `https://example.test/a?x="`, "2026-01-01")
	if strings.Contains(html, "<script>") || !strings.Contains(html, "ลูกค้า &amp; &quot;x&quot;") || !strings.Contains(html, "฿0.01") {
		t.Fatal(html)
	}
}
