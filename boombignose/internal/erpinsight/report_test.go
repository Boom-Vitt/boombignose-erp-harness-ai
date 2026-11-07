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

type reportCommand struct {
	name string
	args erpwire.Row
}
type reportFake struct {
	*insightFake
	commands   []reportCommand
	readErr    error
	commandErr error
}

func (f *reportFake) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if err := a.Validate(time.Now()); err != nil {
		return err
	}
	if f.readErr != nil {
		return f.readErr
	}
	return fn(f)
}
func (f *reportFake) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if err := a.Validate(time.Now()); err != nil {
		return err
	}
	f.writes++
	return fn(f)
}
func (f *reportFake) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	f.commands = append(f.commands, reportCommand{name, args})
	return json.RawMessage(`{}`), f.commandErr
}
func reportMatches(row erpwire.Row, p erpwire.Predicate) bool {
	compare := func(a, b any) int {
		left, lok := auditExactInteger(a)
		right, rok := auditExactInteger(b)
		if lok && rok {
			if left < right {
				return -1
			}
			if left > right {
				return 1
			}
			return 0
		}
		return strings.Compare(text(a), text(b))
	}
	switch p.Op {
	case erpwire.Equal, erpwire.Is:
		return reflect.DeepEqual(row[p.Column], p.Value)
	case erpwire.NotEqual:
		return !reflect.DeepEqual(row[p.Column], p.Value)
	case erpwire.Greater:
		return compare(row[p.Column], p.Value) > 0
	case erpwire.GreaterEqual:
		return compare(row[p.Column], p.Value) >= 0
	case erpwire.Less:
		return compare(row[p.Column], p.Value) < 0
	case erpwire.LessEqual:
		return compare(row[p.Column], p.Value) <= 0
	case erpwire.In:
		values, ok := p.Value.([]string)
		if !ok {
			panic("report fake expects []string IN")
		}
		return has(values, text(row[p.Column]))
	default:
		panic("unsupported report predicate")
	}
}
func (f *reportFake) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	f.queries = append(f.queries, q)
	if f.selectError != nil {
		return erpwire.Selection{}, f.selectError
	}
	rows := []erpwire.Row{}
	for _, row := range f.rows[q.Table] {
		match := true
		for _, p := range q.Where {
			match = match && reportMatches(row, p)
		}
		if match {
			rows = append(rows, row)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, order := range q.Order {
			cmp := strings.Compare(text(rows[i][order.Column]), text(rows[j][order.Column]))
			if cmp != 0 {
				if order.Descending {
					return cmp > 0
				}
				return cmp < 0
			}
		}
		return false
	})
	count := int64(len(rows))
	if q.Offset >= len(rows) {
		rows = []erpwire.Row{}
	} else {
		rows = rows[q.Offset:]
	}
	more := q.Limit > 0 && len(rows) > q.Limit
	if more {
		rows = rows[:q.Limit]
	}
	return erpwire.Selection{Rows: rows, Total: &count, HasMore: more}, nil
}
func reportTestService(t *testing.T) (*Service, *reportFake) {
	t.Helper()
	f := &reportFake{insightFake: &insightFake{rows: map[string][]erpwire.Row{}, insertError: map[string]error{}}}
	s, err := New(Options{Store: f, Now: func() time.Time { return time.Date(2026, 3, 31, 5, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	return s, f
}
func reportInvoice(id, org, number, status, issue, client string, total, vat, wht int64) erpwire.Row {
	return erpwire.Row{"id": id, "org_id": org, "number": number, "status": status, "issue_date": issue, "client_id": client, "clients": erpwire.Row{"name": "ลูกค้าเดียว", "tax_id": "1234567890123"}, "total_satang": total, "vat_satang": vat, "wht_satang": wht, "amount_satang": total, "due_date": "2026-02-01"}
}
func reportSnapshot(base, vat, wht any) erpwire.Row {
	return erpwire.Row{"buyer": erpwire.Row{"name": " ผู้ซื้อเดิม ", "taxId": " 123 "}, "document": erpwire.Row{"baseSatang": base, "vatSatang": vat, "whtSatang": wht}, "originalNumber": "INV-original"}
}

func TestReportMoneyTrustBoundary(t *testing.T) {
	for _, tt := range []struct {
		value any
		want  int64
		err   string
	}{{json.Number("9007199254740991"), erpwire.MaxSafeInteger, ""}, {json.Number("100.0"), 100, ""}, {json.Number("1e2"), 100, ""}, {int64(-1), 0, "Amount cannot be negative"}, {"100", 0, "Amount is not integer satang"}, {json.Number("1.01"), 0, "Amount is not integer satang"}, {json.Number("9007199254740992"), 0, "Amount is not integer satang"}, {nil, 0, "Amount is not integer satang"}} {
		t.Run(fmt.Sprint(tt.value), func(t *testing.T) {
			n, e := reportNumber(tt.value, "Amount", true)
			if tt.err != "" {
				if e == nil || e.Error() != tt.err {
					t.Fatalf("got %d,%v, want %q", n, e, tt.err)
				}
			} else if e != nil || n != tt.want {
				t.Fatalf("got %d,%v want %d", n, e, tt.want)
			}
		})
	}
	if _, e := reportSum(erpwire.MaxSafeInteger, 1); e == nil || e.Error() != "Unsafe integer-satang sum" {
		t.Fatal("unsafe aggregate accepted")
	}
	if got := reportBaht(erpwire.MaxSafeInteger); got != "90071992547409.91" {
		t.Fatalf("money drift: %s", got)
	}
}
func TestReportStoredCreditRejectsMalformedAmountsAndObjects(t *testing.T) {
	valid := reportSnapshot(json.Number("100.0"), json.Number("7e0"), int64(3))
	line, e := readReportCredit(valid)
	if e != nil || line.Base != -100 || line.VAT != -7 || line.WHT != -3 || line.PartyName != "ผู้ซื้อเดิม" || reportTaxText(line.TaxID) != "123" || line.Note != "Credit note against INV-original" {
		t.Fatalf("credit changed: %#v %v", line, e)
	}
	for _, input := range []any{nil, []any{valid}, reportSnapshot("100", int64(7), int64(3)), erpwire.Row{"buyer": []any{erpwire.Row{"name": "A"}}, "document": valid["document"]}, erpwire.Row{"buyer": valid["buyer"], "document": []any{valid["document"]}}, reportSnapshot(int64(-1), int64(7), int64(3)), reportSnapshot(json.Number("1.5"), int64(7), int64(3))} {
		_, e := readReportCredit(input)
		if e == nil || e.Error() != "Credit note snapshot is missing stored VAT or withholding" {
			t.Fatalf("invalid snapshot accepted: %#v, %v", input, e)
		}
	}
	valid["document"].(erpwire.Row)["totalSatang"] = int64(108)
	if _, e := readReportCredit(valid); e == nil {
		t.Fatal("mismatched snapshot total accepted")
	}
}

func TestReportPackTenantStatusCreditsAndStablePartyOrder(t *testing.T) {
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Accountant)
	f.rows["invoices"] = []erpwire.Row{reportInvoice("a", insightOrg, "INV1", "sent", "2026-02-02", "client-a", 10700, 700, 300), reportInvoice("b", insightOrg, "INV2", "paid", "2026-02-03", "client-b", 21400, 1400, 600), reportInvoice("draft", insightOrg, "DRAFT", "draft", "2026-02-02", "draft", 999999, 7, 3), reportInvoice("cancel", insightOrg, "CANCEL", "cancelled", "2026-02-02", "cancel", 999999, 7, 3), reportInvoice("foreign", insightOtherOrg, "FOREIGN", "sent", "2026-02-02", "foreign", 999999, 7, 3), reportInvoice("later", insightOrg, "LATER", "sent", "2026-03-02", "later", 999999, 7, 3)}
	f.rows["credit_notes"] = []erpwire.Row{{"id": "credit", "org_id": insightOrg, "number": "CN1", "issue_date": "2026-02-04", "invoice_id": "a", "snapshot": reportSnapshot(int64(1000), int64(70), int64(30))}}
	for i := 0; i < 10; i++ {
		loaded, e := s.loadReportPack(context.Background(), a, "2026-02")
		if e != nil || !loaded.OK {
			t.Fatalf("load: %#v %v", loaded, e)
		}
		p := loaded.Pack
		if len(p.Output) != 3 || p.OutputBase != 29000 || p.OutputVAT != 2030 || p.OutputWHT != 870 || p.WHT != 870 || p.Difference != 2030 || p.BuddhistMonth != "02/2569" {
			t.Fatalf("incorrect pack: %#v", p)
		}
		if len(p.Parties) != 2 || p.Parties[0].ID != "client-a" || p.Parties[0].Base != 9000 || p.Parties[0].WHT != 270 || p.Parties[0].Count != 2 || p.Parties[1].ID != "client-b" {
			t.Fatalf("unstable customer totals: %#v", p.Parties)
		}
		if p.Output[2].PartyName != "ผู้ซื้อเดิม" || p.Output[2].Base != -1000 {
			t.Fatal("live buyer overwrote stored credit buyer")
		}
	}
	for _, q := range f.queries {
		if q.Table == "profiles" {
			continue
		}
		found := false
		for _, p := range q.Where {
			if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == insightOrg {
				found = true
			}
		}
		if !found {
			t.Fatalf("unscoped query: %#v", q)
		}
	}
}
func TestReportPackMatchesPurchaseVATAndPayees(t *testing.T) {
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Admin)
	f.rows["costs"] = []erpwire.Row{{"id": "bill", "org_id": insightOrg, "bill_date": "2026-02-06", "vendor_id": "vendor", "vendor": "Fallback", "vendor_invoice_reference": "V-01", "purchase_cost_kind": "bill", "amount_satang": int64(10700), "input_vat_satang": int64(700), "vendor_bill_match_id": "match"}, {"id": "credit", "org_id": insightOrg, "bill_date": "2026-02-07", "vendor_id": "vendor", "vendor": "Fallback", "vendor_invoice_reference": "VC-01", "purchase_cost_kind": "credit", "amount_satang": int64(-1070), "input_vat_satang": int64(-70), "vendor_bill_match_id": "match"}, {"id": "unmatched", "org_id": insightOrg, "bill_date": "2026-02-08", "vendor_id": "vendor", "amount_satang": int64(999999), "input_vat_satang": int64(9), "vendor_bill_match_id": nil}}
	f.rows["vendors"] = []erpwire.Row{{"id": "vendor", "org_id": insightOrg, "name": "ชื่อผู้ขาย", "tax_id": " 9876543210123 "}, {"id": "vendor", "org_id": insightOtherOrg, "name": "Foreign", "tax_id": "1"}}
	f.rows["monthly_purchase_vat"] = []erpwire.Row{{"org_id": insightOrg, "month": "2026-02-01", "base_satang": int64(9000), "input_vat_satang": int64(630)}}
	f.rows["purchase_withholdings"] = []erpwire.Row{{"id": "wht", "org_id": insightOrg, "cost_id": "bill", "certificate_no": "WHT-01", "paid_on": "2026-02-08", "form": "pnd3", "income_type": "service_40_8", "rate_bps": int64(300), "base_satang": int64(10000), "wht_satang": int64(300)}}
	loaded, e := s.loadReportPack(context.Background(), a, "2026-02")
	if e != nil || !loaded.OK {
		t.Fatalf("load: %#v %v", loaded, e)
	}
	p := loaded.Pack
	if len(p.Input) != 2 || p.InputBase != 9000 || p.InputVAT != 630 || p.Difference != -630 || p.PurchaseWHT != 300 || len(p.Purchase) != 1 || p.Purchase[0].Name != "ชื่อผู้ขาย" || reportTaxText(p.Purchase[0].TaxID) != "9876543210123" {
		t.Fatalf("purchase pack %#v", p)
	}
	f.rows["monthly_purchase_vat"][0]["input_vat_satang"] = int64(629)
	loaded, e = s.loadReportPack(context.Background(), a, "2026-02")
	if e != nil || loaded.OK || loaded.Status != 503 || loaded.Message != "Matched vendor bills do not match the purchase VAT table for this month" {
		t.Fatalf("unreconciled VAT accepted: %#v %v", loaded, e)
	}
}

func TestReportCSVBytesAndDailyVAT(t *testing.T) {
	if got := reportCSV([]string{"A", "B"}, [][]any{{"=SUM(A1)", "ไทย,\"ทดสอบ\""}, {"-7.01", int64(-5)}, {"+text", "@cmd"}, {"line\nnext", nil}}); got != "\uFEFFA,B\r\n'=SUM(A1),\"ไทย,\"\"ทดสอบ\"\"\"\r\n-7.01,-5\r\n'+text,'@cmd\r\n\"line\nnext\"," {
		t.Fatalf("CSV bytes changed: %q", got)
	}
	p := reportPack{Month: "2026-02", OrgName: "ทดสอบ", Output: []reportLine{{Kind: "invoice", Date: "2026-02-01", Number: "ABB-2", Base: 200, VAT: 14}, {Kind: "invoice", Date: "2026-02-01", Number: "ABB-1", Base: 100, VAT: 7}, {Kind: "credit_note", Date: "2026-02-02", Number: "CN-1", Base: -100, VAT: -7}}, Input: []reportLine{}, OutputBase: 200, OutputVAT: 14, Difference: 14}
	r, e := reportBuildVAT(p)
	if e != nil || len(r.Output) != 2 || r.Output[0].Number != "ABB-1 … ABB-2" || r.Output[0].Documents != 2 || r.Output[0].Base != 300 || r.Output[0].VAT != 21 || r.Output[1].Base != -100 {
		t.Fatalf("daily VAT %#v %v", r, e)
	}
	csv := reportVATCSV(r)
	suffix := "\r\noutput_vat,abb_daily,ABB-1 … ABB-2,2026-02-01,2,ผู้ซื้อทั่วไป / Retail buyers (ABB),,3.00,0.21,ใบกำกับภาษีอย่างย่อ รายวัน / Abbreviated tax invoices, daily"
	if !strings.Contains(csv, `"ใบกำกับภาษีอย่างย่อ รายวัน / Abbreviated tax invoices, daily"`) || !strings.Contains(csv, "\r\noutput_vat,credit_note,CN-1,2026-02-02,1,,,-1.00,-0.07,ใบลดหนี้ / Credit note") {
		t.Fatalf("VAT bytes changed: %q want fragment %q", csv, suffix)
	}
	p.OutputBase++
	if _, e := reportBuildVAT(p); e == nil {
		t.Fatal("VAT mismatch accepted")
	}
}
func TestReportWHTCSVAndFormIsolation(t *testing.T) {
	p := reportPack{Month: "2026-02", OrgName: "A", PurchaseWHT: 305, Purchase: []reportPurchaseWHT{{ID: "w1", Form: "pnd3", Number: "WHT-01", PaidOn: "2026-02-02", Name: "=Evil", Income: "service_40_8", Rate: 300, Base: 10000, WHT: 300}, {ID: "w2", Form: "pnd53", Number: "WHT-02", PaidOn: "2026-02-03", Name: "บริษัท", Income: "other", Rate: 100, Base: 500, WHT: 5}}}
	r, e := reportBuildWHT(p, "pnd3")
	if e != nil || len(r.Lists) != 1 || r.WHT != 300 || r.Lists[0].Base != 10000 || r.Lists[0].Missing != 1 {
		t.Fatalf("WHT filter: %#v %v", r, e)
	}
	csv := reportWHTCSV(r)
	want := "\r\nsummary,pnd3,,2026-02,,,,,100.00,3.00,\"1 rows, 1 without payee tax ID\"\r\nline,pnd3,WHT-01,2026-02-02,'=Evil,,Service fees (40(8)),3,100.00,3.00,Payee tax ID missing"
	if !strings.HasSuffix(csv, want) || strings.Contains(csv, "WHT-02") {
		t.Fatalf("WHT CSV changed: %q", csv)
	}
	p.PurchaseWHT++
	if _, e := reportBuildWHT(p, ""); e == nil {
		t.Fatal("WHT mismatch accepted")
	}
}

func TestReportExportAuthorizationErrorsAndExactChecksum(t *testing.T) {
	for _, tt := range []struct {
		kind   string
		params map[string]string
		role   erpwire.Role
		status int
		body   string
	}{{"accountant_pack_csv", map[string]string{"month": "2026-02"}, erpwire.Member, 403, "Only an owner, an admin, or an accountant can download this pack."}, {"accountant_pack_csv", map[string]string{"month": "2026-13"}, erpwire.Owner, 400, "Choose a month as YYYY-MM."}, {"wht_support_csv", map[string]string{"form": "pnd1"}, erpwire.Owner, 400, "Unknown form."}} {
		s, f := reportTestService(t)
		raw, _ := json.Marshal([]any{tt.params})
		value, e := s.reportExport(context.Background(), insightActor(t, tt.role), tt.kind, raw)
		if e != nil {
			t.Fatal(e)
		}
		r := value.(HTTPResponse)
		if r.Status != tt.status || r.Body != tt.body || len(f.queries) != 0 || f.writes != 0 {
			t.Fatalf("bad denied export: %#v", r)
		}
	}
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Accountant)
	raw := json.RawMessage(`[{"month":"2026-02"}]`)
	value, e := s.reportExport(context.Background(), a, "accountant_pack_csv", raw)
	if e != nil {
		t.Fatal(e)
	}
	r := value.(HTTPResponse)
	sum := sha256.Sum256([]byte(r.Body))
	sha := hex.EncodeToString(sum[:])
	if r.Status != 200 || !strings.HasPrefix(r.Body, "\uFEFFSection,Kind,Number,Date,Party kind,Party,Tax ID,Base (THB),VAT (THB),WHT (THB),Document ID,Note\r\n") || r.Headers["X-Content-SHA256"] != sha || r.Headers["Content-Disposition"] != `attachment; filename="accountant-pack-2026-02.csv"` {
		t.Fatalf("export response: %#v", r)
	}
	if len(f.commands) != 1 || f.commands[0].name != "record_support_export" || !reflect.DeepEqual(f.commands[0].args, erpwire.Row{"p_org_id": insightOrg, "p_kind": "accountant_pack_csv", "p_period": "2026-02", "p_sha256": sha, "p_bytes": len([]byte(r.Body))}) {
		t.Fatalf("wrong checksum command: %#v", f.commands)
	}
	second, e := s.reportExport(context.Background(), a, "accountant_pack_csv", raw)
	if e != nil || second.(HTTPResponse).Body != r.Body {
		t.Fatal("retry changed exact export bytes")
	}
	f.commandErr = errors.New("sensitive SQL detail")
	value, e = s.reportExport(context.Background(), a, "accountant_pack_csv", raw)
	if e != nil || value.(HTTPResponse).Status != 503 || value.(HTTPResponse).Body != "Support export was not recorded. Reload and try the download again." {
		t.Fatalf("unrecorded download served: %#v %v", value, e)
	}
	for _, failure := range []error{erpwire.ErrUnauthenticated, erpwire.ErrIdentityChanged, context.Canceled, errors.New("sensitive SQL detail")} {
		s, f := reportTestService(t)
		f.selectError = failure
		loaded, e := s.loadReportPack(context.Background(), a, "2026-02")
		if reportSafeError(failure) {
			if !errors.Is(e, failure) {
				t.Fatalf("authorization lost: %v %v", failure, e)
			}
		} else if e != nil || loaded.Message != reportUnavailable.Error() {
			t.Fatalf("database detail leaked: %#v %v", loaded, e)
		}
	}
}

func TestReportMonthDefaultsAndLanguageOwnership(t *testing.T) {
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Owner)
	f.rows["profiles"] = []erpwire.Row{{"id": insightUser, "locale": "en"}, {"id": "someone-else", "locale": "th"}}
	value, e := s.reportSupportPage(context.Background(), a, "vat", json.RawMessage(`[]`))
	if e != nil {
		t.Fatal(e)
	}
	out := value.(erpwire.Row)
	if out["month"] != "2026-02" || out["lang"] != "en" || out["validMonth"] != true {
		t.Fatalf("31st month rollover: %#v", out)
	}
	if _, e = s.reportSaveLang(context.Background(), a, json.RawMessage(`["th"]`)); e != nil {
		t.Fatal(e)
	}
	if f.rows["profiles"][0]["locale"] != "th" || f.rows["profiles"][1]["locale"] != "th" {
		t.Fatal("language owner scope failed")
	}
	f.rows["profiles"][1]["locale"] = "en"
	_, _ = s.reportSaveLang(context.Background(), a, json.RawMessage(`["xx"]`))
	if f.rows["profiles"][1]["locale"] != "en" {
		t.Fatal("invalid language changed profile")
	}
	value, e = s.reportSupportPage(context.Background(), insightActor(t, erpwire.Member), "pack", json.RawMessage(`[]`))
	if e != nil || value.(erpwire.Row)["allowed"] != false {
		t.Fatal("member acquired finance report")
	}
}

func TestReportStatementsAgingAndStateFilters(t *testing.T) {
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Accountant)
	f.rows["invoices"] = []erpwire.Row{reportInvoice("open", insightOrg, "I", "sent", "2026-02-01", "c", 10700, 700, 0), reportInvoice("draft", insightOrg, "D", "draft", "2026-02-01", "c", 999999, 9999, 0), reportInvoice("foreign", insightOtherOrg, "F", "sent", "2026-02-01", "c", 999999, 9999, 0)}
	f.rows["invoice_balances"] = []erpwire.Row{{"org_id": insightOrg, "invoice_id": "open", "outstanding_satang": int64(5700)}}
	f.rows["costs"] = []erpwire.Row{{"id": "cost", "org_id": insightOrg, "incurred_on": "2026-02-02", "due_date": "2025-10-01", "paid_at": nil, "amount_satang": int64(2140), "input_vat_satang": int64(140)}, {"id": "paid", "org_id": insightOrg, "incurred_on": "2026-02-02", "due_date": "2026-02-28", "paid_at": "2026-02-10", "amount_satang": int64(1070), "input_vat_satang": int64(70)}}
	f.rows["monthly_inventory_cogs"] = []erpwire.Row{{"org_id": insightOrg, "month": "2026-02-01", "amount_satang": int64(2500)}}
	f.rows["org_settings"] = []erpwire.Row{{"org_id": insightOrg, "cash_balance_satang": int64(5000)}}
	value, e := s.reportStatements(context.Background(), a, json.RawMessage(`[{"month":"2026-02"}]`))
	if e != nil {
		t.Fatal(e)
	}
	out := value.(erpwire.Row)
	if !reflect.DeepEqual(out["profit"], erpwire.Row{"revenueSatang": int64(10000), "outputVatSatang": int64(700), "cogsSatang": int64(2500), "expenseSatang": int64(3000), "inputVatSatang": int64(210), "profitSatang": int64(4500)}) || !reflect.DeepEqual(out["balance"], erpwire.Row{"cashSatang": int64(5000), "receivablesSatang": int64(5700), "payablesSatang": int64(2140), "balances": false}) {
		t.Fatalf("statement totals: %#v", out)
	}
	if out["receivableAging"].(erpwire.Row)["days1to30"] != int64(5700) || out["payableAging"].(erpwire.Row)["days91plus"] != int64(2140) || out["vat"].(erpwire.Row)["netVatSatang"] != int64(490) {
		t.Fatalf("aging/VAT: %#v", out)
	}
	rows := []struct {
		due    string
		amount int64
	}{{"2026-02-28", 1}, {"2026-02-27", 2}, {"2026-01-29", 3}, {"2026-01-28", 4}, {"2025-12-30", 5}, {"2025-12-29", 6}, {"2025-11-30", 7}, {"2025-11-29", 8}, {"invalid", 9}, {"2025-11-29", -10}}
	aging, e := reportAging("2026-02-28", rows)
	if e != nil || !reflect.DeepEqual(aging, erpwire.Row{"current": int64(10), "days1to30": int64(5), "days31to60": int64(9), "days61to90": int64(13), "days91plus": int64(8)}) {
		t.Fatalf("aging boundary: %#v %v", aging, e)
	}
}

func TestReportOperationalRevenueRangePaginationAndPrint(t *testing.T) {
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Member)
	f.rows["invoices"] = []erpwire.Row{reportInvoice("issued", insightOrg, "I", "sent", "2026-02-28", "c", 10700, 700, 0), reportInvoice("draft", insightOrg, "D", "draft", "2026-02-01", "c", 999999, 9999, 0), reportInvoice("foreign", insightOtherOrg, "F", "sent", "2026-02-01", "c", 999999, 9999, 0), reportInvoice("future", insightOrg, "FUTURE", "sent", "2026-04-01", "c", 999999, 9999, 0)}
	f.rows["credit_note_revenue"] = []erpwire.Row{{"id": "cn", "org_id": insightOrg, "issue_date": "2026-02-28", "client_name": "ลูกค้าเดียว", "base_satang": int64(1000)}}
	f.rows["time_entries"] = []erpwire.Row{{"id": "one", "org_id": insightOrg, "minutes": int64(61), "billable": true, "work_date": "2026-02-28", "projects": erpwire.Row{"name": "งาน"}}, {"id": "two", "org_id": insightOrg, "minutes": int64(29), "billable": false, "work_date": "2026-02-28", "projects": erpwire.Row{"name": "งาน"}}, {"id": "future", "org_id": insightOrg, "minutes": int64(999), "billable": true, "work_date": "2026-04-01"}}
	f.rows["monthly_inventory_cogs"] = []erpwire.Row{{"org_id": insightOrg, "month": "2026-02-01", "amount_satang": int64(2000)}}
	f.rows["monthly_purchase_vat"] = []erpwire.Row{{"org_id": insightOrg, "month": "2026-02-01", "base_satang": int64(2000), "input_vat_satang": int64(140), "total_satang": int64(2140)}}
	value, e := s.reportPage(context.Background(), a, json.RawMessage(`[{"view":"pivot"}]`))
	if e != nil {
		t.Fatal(e)
	}
	out := value.(erpwire.Row)
	data := out["data"].(reportData)
	if out["view"] != "pivot" || out["close"] != nil || data.TotalRevenue != 9000 || data.TotalCOGS != 2000 || data.Revenue.grid["ลูกค้าเดียว"]["2026-02"] != 9000 || data.Hours.Minutes != 90 || data.Hours.Billable != 61 || data.Hours.Hours != 1.5 || data.Hours.BillableHours != 1.02 || data.Months[0] != "2025-10" || data.Months[5] != "2026-03" {
		t.Fatalf("operational totals %#v", out)
	}
	print, e := s.reportPrint(context.Background(), a, json.RawMessage(`[]`))
	if e != nil {
		t.Fatal(e)
	}
	html := print.(HTTPResponse)
	if html.Status != 200 || html.Headers["Content-Type"] != "text/html; charset=utf-8" || !strings.Contains(html.Body, `<td class="num">฿90.00</td>`) || !strings.Contains(html.Body, `<td class="num">1.02 h</td>`) || !strings.Contains(html.Body, "Generated 2026-03-31") || f.writes != 0 {
		t.Fatalf("print contents: %#v", html)
	}
	f.rows["invoices"] = nil
	f.rows["credit_note_revenue"] = nil
	for i := 0; i < 1002; i++ {
		f.rows["invoices"] = append(f.rows["invoices"], reportInvoice(fmt.Sprintf("%04d", i), insightOrg, "I", "sent", "2026-02-28", "c", 1, 0, 0))
	}
	value, e = s.reportPage(context.Background(), a, json.RawMessage(`[]`))
	if e != nil || value.(erpwire.Row)["data"].(reportData).TotalRevenue != 1002 {
		t.Fatalf("paginated totals %#v %v", value, e)
	}
	found := false
	for _, q := range f.queries {
		if q.Table == "invoices" && q.Offset == 1000 {
			found = true
		}
	}
	if !found {
		t.Fatal("report stopped at first page")
	}
}

func TestReportCloseChecklistStatesAndExactCounts(t *testing.T) {
	base := reportCloseInput{Month: "2026-02", Today: "2026-03-31", Viewer: "me", Settings: erpwire.Row{"legal_name": "Company", "business_address": "Address", "tax_id": "1234567890123", "branch_label": "Head office", "tax_status": "registered"}}
	for _, tt := range []struct {
		month, today, lock      string
		ready, closable, closed bool
		fragment                string
	}{{"2026-02", "2026-03-31", "", true, true, false, "พร้อมปิดงวด 2026-02 (02/2569)"}, {"2026-03", "2026-03-31", "", true, false, false, "The current month stays open."}, {"2026-02", "2026-03-31", "2026-02-28", true, false, true, "already locked through 2026-02-28 (28/02/2569)"}} {
		input := base
		input.Month = tt.month
		input.Today = tt.today
		input.Lock = tt.lock
		out, e := buildReportClose(input)
		if e != nil || out["ready"] != tt.ready || out["closable"] != tt.closable || out["alreadyClosed"] != tt.closed || !strings.Contains(text(out["summary"]), tt.fragment) {
			t.Fatalf("close state %#v %v", out, e)
		}
	}
	input := base
	input.Invoices = []erpwire.Row{{"id": "open", "status": "sent", "issue_date": "2026-02-02", "due_date": "2026-02-20", "amount_satang": int64(10700), "vat_satang": int64(700)}, {"id": "credited", "status": "sent", "issue_date": "2026-02-03", "due_date": "2026-02-20", "amount_satang": int64(1000), "vat_satang": int64(0)}, {"id": "draft", "status": "draft", "issue_date": "2026-02-02", "amount_satang": int64(500), "vat_satang": int64(0)}, {"id": "later", "status": "draft", "issue_date": "2026-03-02", "amount_satang": int64(500), "vat_satang": int64(0)}}
	input.Balances = []erpwire.Row{{"invoice_id": "open", "paid_satang": int64(1000), "credited_satang": int64(700)}, {"invoice_id": "credited", "paid_satang": int64(0), "credited_satang": int64(1000)}}
	input.Bills = []erpwire.Row{{"vendor_id": "vendor", "expense_claim_id": nil, "paid_at": nil, "due_date": "2026-02-20", "amount_satang": int64(2140), "purchase_cost_kind": "bill"}, {"vendor_id": "vendor", "expense_claim_id": nil, "paid_at": nil, "amount_satang": int64(-1070), "purchase_cost_kind": "credit"}, {"vendor_id": "vendor", "expense_claim_id": "claim", "paid_at": nil, "amount_satang": int64(1070), "purchase_cost_kind": "bill"}}
	input.Bank = []erpwire.Row{{"booked_on": "2026-02-20", "matched_payment_id": nil, "amount_satang": int64(-500)}, {"booked_on": "2026-03-20", "matched_payment_id": nil, "amount_satang": int64(600)}, {"booked_on": "2026-02-20", "matched_payment_id": "paid", "amount_satang": int64(900)}}
	input.Claims = []erpwire.Row{{"status": "submitted", "employee": "me"}, {"status": "draft", "employee": "other"}}
	input.Credits = []erpwire.Row{{"issue_date": "2026-02-20", "base_satang": int64(1000), "total_satang": int64(1070)}}
	input.VAT = []erpwire.Row{{"month": "2026-02-01", "input_vat_satang": int64(140)}}
	out, e := buildReportClose(input)
	if e != nil {
		t.Fatal(e)
	}
	if out["reviewCount"] != 5 || out["ready"] != false || out["closable"] != true {
		t.Fatalf("close review summary %#v", out)
	}
	items := out["items"].([]erpwire.Row)
	wantIDs := []string{"overdue_ar", "unpaid_ap", "unmatched_bank", "draft_invoices", "expense_claims", "tax_profile", "vat_support", "finance_lock"}
	for i, id := range wantIDs {
		if items[i]["id"] != id {
			t.Fatal("close item order changed")
		}
	}
	if items[0]["count"] != 1 || items[0]["amountSatang"] != int64(9000) || items[1]["amountSatang"] != int64(2140) || items[2]["amountSatang"] != int64(500) || items[3]["amountSatang"] != int64(500) || items[4]["href"] != "/expenses" || items[6]["outputVatSatang"] != int64(630) || items[6]["inputVatSatang"] != int64(140) {
		t.Fatalf("wrong close counts %#v", items)
	}
	if items[0]["detail"] != "ใบแจ้งหนี้ที่ออกแล้ว 1 ใบเกินกำหนดและยังชำระไม่ครบ / 1 issued invoice is past due and not fully paid." || !strings.Contains(text(items[2]["detail"]), "1 unmatched line booked after 2026-02-28 (28/02/2569) stays with the next close.") || !strings.Contains(text(items[4]["detail"]), "You cannot approve your own claim.") {
		t.Fatalf("close detail changed %#v", items)
	}
	input.Lock = "2026-02-28"
	out, e = buildReportClose(input)
	if e != nil || out["alreadyClosed"] != true || out["reviewCount"] != 5 || !strings.Contains(text(out["summary"]), "The lock does not clear them.") {
		t.Fatalf("lock erased review items %#v %v", out, e)
	}
	for _, bad := range []reportCloseInput{{Month: "2026-13", Today: "2026-03-31"}, {Month: "2026-02", Today: "bad"}} {
		if _, e := buildReportClose(bad); e == nil {
			t.Fatalf("invalid close accepted %#v", bad)
		}
	}
}

type reportBusiness string

func (e reportBusiness) Error() string           { return string(e) }
func (e reportBusiness) BusinessMessage() string { return string(e) }
func TestReportWithholdingCommandAndLanguageForm(t *testing.T) {
	s, f := reportTestService(t)
	a := insightActor(t, erpwire.Owner)
	form := erpwire.FormData{Kind: "form"}
	for _, pair := range [][2]string{{"month", "2026-02"}, {"cost_id", insightID}, {"paid_on", "2026-02-05"}, {"form", "pnd3"}, {"income_type", "service_40_8"}, {"rate_bps", " 0300.0 "}} {
		v := pair[1]
		form.Entries = append(form.Entries, erpwire.FormEntry{Name: pair[0], Text: &v})
	}
	raw, _ := json.Marshal([]any{form})
	value, e := s.reportRecordWHT(context.Background(), a, raw)
	if e != nil {
		t.Fatal(e)
	}
	r := value.(erpwire.ActionResponse)
	if r.Redirect != "/reports/wht?month=2026-02&saved=1" || !reflect.DeepEqual(r.Refresh, []string{"/reports/wht"}) || len(f.commands) != 1 || f.commands[0].name != "record_purchase_withholding" || !reflect.DeepEqual(f.commands[0].args, erpwire.Row{"p_org_id": insightOrg, "p_cost_id": insightID, "p_paid_on": "2026-02-05", "p_form": "pnd3", "p_income_type": "service_40_8", "p_rate_bps": json.Number("300")}) {
		t.Fatalf("withholding command %#v %#v", r, f.commands)
	}
	f.commandErr = reportBusiness("Cost is locked & unavailable")
	value, e = s.reportRecordWHT(context.Background(), a, raw)
	if e != nil || value.(erpwire.ActionResponse).Redirect != "/reports/wht?month=2026-02&error=Cost%20is%20locked%20%26%20unavailable" {
		t.Fatalf("withholding error redirect %#v %v", value, e)
	}
	f.commandErr = reportBusiness("Failed !'()* / ไทย")
	value, e = s.reportRecordWHT(context.Background(), a, raw)
	if e != nil || value.(erpwire.ActionResponse).Redirect != "/reports/wht?month=2026-02&error=Failed%20!'()*%20%2F%20%E0%B9%84%E0%B8%97%E0%B8%A2" {
		t.Fatalf("URI component parity: %#v %v", value, e)
	}
	f.commandErr = reportBusiness(strings.Repeat("a", 159) + "😀")
	if _, e = s.reportRecordWHT(context.Background(), a, raw); e == nil || e.Error() != "URI malformed" {
		t.Fatalf("split surrogate accepted: %v", e)
	}
	for _, tt := range []struct {
		input string
		want  any
	}{{"", int64(0)}, {"0x64", json.Number("100")}, {"1e2", json.Number("100")}, {" +300 ", json.Number("300")}, {"invalid", nil}, {"Infinity", nil}} {
		if got := reportRateInput(tt.input); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("rate %q => %#v want %#v", tt.input, got, tt.want)
		}
	}
}

func TestReportHTMLPreservesEscapingMoneyAndBuddhistDates(t *testing.T) {
	p := reportPack{OrgName: `<script>&"'`, Month: "2026-02", BuddhistMonth: "02/2569", Output: []reportLine{{Kind: "invoice", Number: "INV<script>", Date: "2026-02-01", PartyName: "A&B", Base: erpwire.MaxSafeInteger, VAT: 7, WHT: 3}}, Parties: []reportParty{{Name: "A&B", Base: 100, WHT: 3, Count: 1}}, WHT: 3}
	html := reportRenderPack(p, "2026-03-31")
	for _, fragment := range []string{`&lt;script&gt;&amp;&quot;&#39;`, `INV&lt;script&gt;`, `A&amp;B`, `฿90,071,992,547,409.91`, `2026-03-31 (31/03/2569)`, `2026-02-01 (01/02/2569)`, `<td class="num">1</td>`} {
		if !strings.Contains(html, fragment) {
			t.Fatalf("print missing %q", fragment)
		}
	}
	if strings.Contains(html, `INV<script>`) {
		t.Fatal("HTML injection")
	}
	if got := reportMoneyHTML(-1); got != "-฿0.01" {
		t.Fatal(got)
	}
	for _, tt := range []struct{ input, want string }{{"0099-01-01", "0099-01-01"}, {"0100-01-01", "0100-01-01 (01/01/643)"}, {"2026-02-30", "2026-02-30"}} {
		if got := reportDateLabel(tt.input); got != tt.want {
			t.Fatalf("date %s => %s", tt.input, got)
		}
	}
}
