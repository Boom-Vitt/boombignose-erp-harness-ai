package erpledger

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestTrialBalanceNetsAndValidatesBeforeFiltering(t *testing.T) {
	accounts := []erpwire.Row{{"code": "1110", "name_th": "เงินสด", "name_en": "Cash", "kind": "asset"}, {"code": "4100", "name_th": "ขาย", "name_en": "Sales", "kind": "income"}}
	entries := []erpwire.Row{{"id": recordID, "entry_date": "2026-10-01"}, {"id": otherID, "entry_date": "2026-11-01"}}
	lines := []erpwire.Row{{"entry_id": recordID, "account_code": "1110", "debit_satang": int64(10000), "credit_satang": int64(0)}, {"entry_id": recordID, "account_code": "1110", "debit_satang": int64(0), "credit_satang": int64(3000)}, {"entry_id": recordID, "account_code": "4100", "debit_satang": int64(0), "credit_satang": int64(7000)}, {"entry_id": otherID, "account_code": "1110", "debit_satang": int64(1), "credit_satang": int64(0)}}
	b, e := trialBalance(lines, accounts, entries, "2026-10-31")
	want := TrialBalance{Rows: []TrialBalanceRow{{"1110", "เงินสด", "Cash", "asset", 7000, 0}, {"4100", "ขาย", "Sales", "income", 0, 7000}}, Debit: 7000, Credit: 7000, Balanced: true, LineCount: 3}
	if e != nil || !reflect.DeepEqual(b, want) {
		t.Fatalf("balance=%#v %v", b, e)
	}
	all, e := trialBalance(lines, accounts, entries, "")
	if e != nil || all.Balanced || all.Debit != 7001 || all.LineCount != 4 {
		t.Fatalf("all=%#v %v", all, e)
	}
	for _, test := range []struct {
		name          string
		change        func([]erpwire.Row)
		through, want string
	}{
		{"missing entry", func(r []erpwire.Row) { r[0]["entry_id"] = "missing" }, "2026-10-31", "A journal date on this trial balance is not a calendar date."},
		{"blank account", func(r []erpwire.Row) { r[0]["account_code"] = " " }, "2026-10-31", chartError},
		{"fraction", func(r []erpwire.Row) { r[0]["debit_satang"] = json.Number("0.1") }, "2026-10-31", amountError},
		{"negative", func(r []erpwire.Row) { r[0]["debit_satang"] = int64(-1) }, "2026-10-31", amountError},
		{"overflow", func(r []erpwire.Row) {
			r[0]["debit_satang"] = int64(money.MaxSafeSatang)
			r[2]["account_code"] = "1110"
			r[2]["debit_satang"] = int64(1)
		}, "2026-10-31", amountError},
		{"bad through", nil, "2026-02-30", "Enter a trial balance date."},
	} {
		t.Run(test.name, func(t *testing.T) {
			copy := []erpwire.Row{}
			for _, r := range lines {
				copy = append(copy, copyRow(r))
			}
			if test.change != nil {
				test.change(copy)
			}
			_, e := trialBalance(copy, accounts, entries, test.through)
			if e == nil || e.Error() != test.want {
				t.Fatalf("got %v want %s", e, test.want)
			}
		})
	}
}
func TestAcceptanceHashMatchesTypeScriptFixture(t *testing.T) {
	b := TrialBalance{Rows: []TrialBalanceRow{{Code: "1110", Debit: 5700}, {Code: "4100", Credit: 10700}}, Debit: 5700, Credit: 5700, Balanced: true, LineCount: 4}
	result := acceptanceFigures("2026-01-31", "2026-01-31", b)
	if object(result["figures"])["sha256"] != "0d81d438d9aa57c10218f99424be58d9ccd7ebe7836f7ed732bf0922a74b6722" {
		t.Fatalf("hash=%#v", result)
	}
	for _, test := range []struct {
		lock, through string
		balanced      bool
		want          string
	}{{"", "2026-01-31", true, "Accept a draft close only inside a locked period."}, {"2026-01-15", "2026-01-31", true, "Accept a draft close only inside a locked period."}, {"2026-01-31", "", true, "Accept a draft close only inside a locked period."}, {"2026-01-31", "2026-01-31", false, "Accept a trial balance only when debits equal credits."}} {
		b.Balanced = test.balanced
		r := acceptanceFigures(test.lock, test.through, b)
		if r["ok"] != false || r["error"] != test.want {
			t.Fatalf("acceptance %#v", r)
		}
	}
}
func TestBankStatusesQueuesAndWindow(t *testing.T) {
	lines := []erpwire.Row{}
	for i, status := range []string{"matched", "explained", "ready", "ambiguous", "unmatched", "money_out", "later"} {
		line := erpwire.Row{"id": status, "booked_on": "2026-10-01", "amount_satang": int64(100 + i), "reference": status, "matched_payment_id": nil, "close_note": nil}
		switch status {
		case "matched":
			line["matched_payment_id"] = "taken"
		case "explained":
			line["close_note"] = "fee"
		case "money_out":
			line["amount_satang"] = int64(-10)
		case "later":
			line["booked_on"] = "2026-11-01"
		}
		lines = append(lines, line)
	}
	payments := []erpwire.Row{{"id": "single", "amount_satang": int64(102), "verification_state": "verified", "verification_reference": " ready ", "reversal_of": nil}, {"id": "duplicate1", "amount_satang": int64(103), "verification_state": "verified", "verification_reference": "ambiguous", "reversal_of": nil}, {"id": "duplicate2", "amount_satang": int64(103), "verification_state": "verified", "verification_reference": "ambiguous", "reversal_of": nil}, {"id": "taken", "amount_satang": int64(104), "verification_state": "verified", "verification_reference": "unmatched", "reversal_of": nil}}
	classified, e := classifyBank(lines, payments, "2026-10-31")
	if e != nil {
		t.Fatal(e)
	}
	wantStatuses := []string{"matched", "explained", "ready", "ambiguous", "unmatched", "money_out", "unmatched"}
	for i, line := range classified {
		if line["status"] != wantStatuses[i] {
			t.Fatalf("line=%#v", line)
		}
	}
	if classified[2]["suggestedPaymentId"] != "single" || classified[3]["suggestedPaymentId"] != nil || classified[6]["blocksClose"] != false {
		t.Fatalf("classification %#v", classified)
	}
	summary, e := bankSummary(classified, "2026-10-31")
	want := erpwire.Row{"periodEnd": "2026-10-31", "openCount": 4, "openNetSatang": money.Satang(299), "readyCount": 1, "ambiguousCount": 1, "unmatchedCount": 1, "moneyOutCount": 1, "explainedCount": 1, "explainedNetSatang": money.Satang(101), "matchedCount": 1, "matchedNetSatang": money.Satang(100), "laterOpenCount": 1}
	if e != nil || !reflect.DeepEqual(summary, want) {
		t.Fatalf("summary=%#v %v", summary, e)
	}
	f := newFake(t)
	f.pageSize = 2
	f.add("bank_lines", lines...)
	f.add("payments", payments...)
	f.add("bank_lines", erpwire.Row{"id": "foreign", "org_id": otherOrg, "amount_satang": int64(999)})
	s := service(t, f)
	a := actor(t, erpwire.Accountant, orgID)
	for _, test := range []struct {
		queue string
		count int
	}{{"open", 4}, {"explained", 1}, {"matched", 1}, {"all", 6}, {"invalid", 4}} {
		v, e := call(t, s, a, "bank/page.tsx", "load", erpwire.Row{"through": "2026-10", "queue": test.queue})
		if e != nil {
			t.Fatal(e)
		}
		r := object(v)
		if len(r["visible"].([]erpwire.Row)) != test.count || !reflect.DeepEqual(r["summary"], want) {
			t.Fatalf("queue %s: %#v", test.queue, r)
		}
	}
	if f.writes != 0 {
		t.Fatal("bank loader wrote")
	}
}
func TestCashTruthExactDateAndReversalTotals(t *testing.T) {
	receipts := []erpwire.Row{{"id": "matched", "amount_satang": int64(10000), "paid_at": "2026-10-01T00:00:00Z", "verification_state": "verified"}, {"id": "loose", "amount_satang": int64(500), "paid_at": "2026-10-31T16:59:59Z", "verification_state": "verified"}, {"id": "reversal", "amount_satang": int64(-100), "paid_at": "2026-10-02T00:00:00Z", "verification_state": "verified"}, {"id": "later", "amount_satang": int64(99999), "paid_at": "2026-10-31T17:00:00Z", "verification_state": "verified"}, {"id": "pending", "amount_satang": int64(99999), "paid_at": "2026-10-01T00:00:00Z", "verification_state": "pending"}}
	costs := []erpwire.Row{{"paid_at": "2026-10-01T00:00:00Z", "amount_satang": int64(2000)}, {"paid_at": nil, "amount_satang": int64(88888)}}
	lines := []erpwire.Row{{"booked_on": "2026-10-01", "amount_satang": int64(10000), "matched_payment_id": "matched", "close_note": nil}, {"booked_on": "2026-10-02", "amount_satang": int64(-10), "matched_payment_id": nil, "close_note": "fee"}, {"booked_on": "2026-10-03", "amount_satang": int64(500), "matched_payment_id": nil, "close_note": nil}, {"booked_on": "2026-11-01", "amount_satang": int64(99999), "matched_payment_id": "loose", "close_note": nil}}
	r, e := cashTruth("2026-10-31", int64(9000), receipts, costs, lines)
	want := erpwire.Row{"asOf": "2026-10-31", "recordedBalanceSatang": money.Satang(9000), "verifiedReceiptsSatang": money.Satang(10400), "paidCostsSatang": money.Satang(2000), "cashInSystemSatang": money.Satang(8400), "differenceSatang": money.Satang(600), "statementNetSatang": money.Satang(10490), "matchedStatementSatang": money.Satang(10000), "openStatementSatang": money.Satang(500), "openStatementCount": 1, "explainedStatementSatang": money.Satang(-10), "explainedStatementCount": 1, "receiptsWithoutStatementSatang": money.Satang(400), "receiptsWithoutStatementCount": 2}
	if e != nil || r["ok"] != true || !reflect.DeepEqual(r["truth"], want) {
		t.Fatalf("cash=%#v %v", r, e)
	}
	_, e = cashTruth("2026-10-31", int64(money.MaxSafeSatang), []erpwire.Row{{"id": "reverse", "amount_satang": int64(-1), "paid_at": "2026-10-01", "verification_state": "verified"}}, nil, nil)
	if e == nil || e.Error() != "Unsafe integer-satang sum" {
		t.Fatalf("unsafe difference %v", e)
	}
	f := newFake(t)
	f.pageSize = 2
	f.add("org_settings", erpwire.Row{"cash_balance_satang": int64(9000)})
	f.add("payments", receipts...)
	f.add("costs", costs...)
	f.add("bank_lines", lines...)
	f.add("costs", erpwire.Row{"org_id": otherOrg, "paid_at": "2026-10-01", "amount_satang": int64(999999)})
	v, e := call(t, service(t, f), actor(t, erpwire.Accountant, orgID), "cash/page.tsx", "load", erpwire.Row{"month": "2026-10"})
	if e != nil || !reflect.DeepEqual(object(object(v)["result"])["truth"], want) {
		t.Fatalf("cash page=%#v %v", v, e)
	}
	if f.writes != 0 {
		t.Fatal("cash loader wrote")
	}
}
func TestJournalLoadersScopePaginationAndAcceptance(t *testing.T) {
	f := newFake(t)
	fakeChart(f)
	f.pageSize = 1
	f.add("journal_entries", erpwire.Row{"id": recordID, "entry_date": "2026-10-01", "memo": "sale", "created_at": "2026-10-02"})
	f.add("journal_lines", erpwire.Row{"entry_id": recordID, "line_no": int64(2), "account_code": "4100", "debit_satang": int64(0), "credit_satang": int64(100)}, erpwire.Row{"entry_id": recordID, "line_no": int64(1), "account_code": "1110", "debit_satang": int64(100), "credit_satang": int64(0)}, erpwire.Row{"org_id": otherOrg, "entry_id": "foreign", "debit_satang": int64(999)})
	f.add("draft_close_acceptance_requests", erpwire.Row{"id": otherID, "through_date": "2026-10-31", "status": "pending", "requested_by": userID, "figures_sha256": "old"}, erpwire.Row{"id": thirdID, "through_date": "2026-10-31", "status": "confirmed", "requested_by": userID, "figures_sha256": "accepted"})
	s := service(t, f)
	a := actor(t, erpwire.Accountant, orgID)
	v, e := call(t, s, a, "journal/page.tsx", "load")
	if e != nil {
		t.Fatal(e)
	}
	r := object(v)
	lines := r["lines"].([]erpwire.Row)
	if len(lines) != 2 || lines[0]["line_no"] != int64(1) || len(r["chart"].([]erpwire.Row)) != 6 {
		t.Fatalf("journal=%#v", r)
	}
	names := r["names"].(erpwire.BrowserMap)
	if names.Kind != "map" || len(names.Entries) != 6 {
		t.Fatalf("names=%#v", names)
	}
	v, e = call(t, s, a, "journal/trial-balance/page.tsx", "load")
	if e != nil {
		t.Fatal(e)
	}
	r = object(v)
	b := object(r["result"])["balance"].(TrialBalance)
	if b.Debit != 100 || b.Credit != 100 || !b.Balanced || b.LineCount != 2 || r["through"] != "2026-10-31" || object(r["pending"])["id"] != otherID || r["acceptedSha"] != "accepted" || object(r["acceptance"])["ok"] != true {
		t.Fatalf("trial=%#v", r)
	}
	v, e = call(t, s, a, "journal/trial-balance/page.tsx", "load", erpwire.Row{"through": "all"})
	if e != nil || object(v)["through"] != nil || object(object(v)["acceptance"])["ok"] != false {
		t.Fatalf("all=%#v %v", v, e)
	}
	v, e = call(t, s, a, "journal/trial-balance/page.tsx", "load", erpwire.Row{"through": "2026-02-30"})
	if e != nil || object(object(v)["result"])["error"] != "Enter a trial balance date." {
		t.Fatalf("bad date=%#v %v", v, e)
	}
}
func TestCostExportExactCSVAndFailureStatus(t *testing.T) {
	f := newFake(t)
	f.pageSize = 1
	f.add("costs", erpwire.Row{"id": recordID, "category": "other", "vendor": "=สูตร,\"ไทย\"", "amount_satang": int64(money.MaxSafeSatang), "incurred_on": "2026-10-01", "vendor_invoice_reference": nil, "bill_date": nil, "input_vat_rate": json.Number("7"), "input_vat_satang": int64(1)}, erpwire.Row{"id": otherID, "category": "infra", "vendor": nil, "notes": "fallback", "amount_satang": int64(1), "incurred_on": "2026-09-01", "input_vat_rate": int64(0), "input_vat_satang": int64(0)}, erpwire.Row{"id": thirdID, "org_id": otherOrg, "category": "secret"})
	s := service(t, f)
	a := actor(t, erpwire.Member, orgID)
	v, e := call(t, s, a, "costs/export/route.ts", "GET")
	if e != nil {
		t.Fatal(e)
	}
	r := v.(RouteResponse)
	want := "\ufeffCategory,Vendor / description,Amount (THB),Date,Vendor invoice reference,Bill date,Input VAT rate (%),Input VAT (THB)\r\nother,\"'=สูตร,\"\"ไทย\"\"\",90071992547409.91,2026-10-01,,,7,0.01\r\ninfra,fallback,0.01,2026-09-01,,,0,0.00"
	if r.Status != 200 || r.Body != want || r.Headers["Content-Type"] != "text/csv; charset=utf-8" || r.Headers["Content-Disposition"] != `attachment; filename="costs-`+today()+`.csv"` {
		t.Fatalf("export=%#v", r)
	}
	f.failTable = "costs"
	v, e = call(t, s, a, "costs/export/route.ts", "GET")
	if e != nil || v.(RouteResponse).Status != 503 || v.(RouteResponse).Body != "Cost export unavailable" {
		t.Fatalf("failure=%#v %v", v, e)
	}
	f.failRead = erpwire.ErrIdentityChanged
	_, e = call(t, s, a, "costs/export/route.ts", "GET")
	if !errors.Is(e, erpwire.ErrIdentityChanged) {
		t.Fatal("export swallowed revoked identity")
	}
	for _, test := range []struct{ input, want string }{{"-7.01", "-7.01"}, {"+formula", "'+formula"}, {"@ไทย", "'@ไทย"}, {"a\r\nb", "\"a\r\nb\""}} {
		if csvCell(test.input) != test.want {
			t.Fatalf("csv cell %q", test.input)
		}
	}
}
func TestFinanceOverviewMetricsFacetsAndIsolation(t *testing.T) {
	f := newFake(t)
	f.pageSize = 1
	date := today()
	month := date[:7]
	f.add("org_settings", erpwire.Row{"vat_registered": true})
	f.add("clients", erpwire.Row{"id": recordID, "name": "ลูกค้า", "owner": userID}, erpwire.Row{"id": recordID, "org_id": otherOrg, "name": "secret", "owner": userID})
	f.add("invoices", erpwire.Row{"id": recordID, "number": "INV-2026-001", "issued_snapshot_id": thirdID, "amount_satang": int64(10700), "total_satang": int64(10700), "vat_satang": int64(700), "status": "sent", "issue_date": date, "due_date": "2020-01-01", "client_id": recordID}, erpwire.Row{"id": otherID, "number": "draft", "issued_snapshot_id": nil, "amount_satang": int64(100), "total_satang": int64(100), "vat_satang": int64(0), "status": "draft", "issue_date": date, "client_id": recordID}, erpwire.Row{"id": thirdID, "org_id": otherOrg, "amount_satang": int64(99999)})
	f.add("invoice_balances", erpwire.Row{"invoice_id": recordID, "paid_satang": int64(2000), "credited_satang": int64(1070), "outstanding_satang": int64(7630)})
	f.add("credit_note_revenue", erpwire.Row{"id": recordID, "issue_date": date, "base_satang": int64(1000), "total_satang": int64(1070)})
	f.add("payments", erpwire.Row{"id": recordID, "invoice_id": recordID, "amount_satang": int64(2000), "paid_at": date + "T00:00:00Z", "verification_state": "verified"}, erpwire.Row{"id": otherID, "amount_satang": int64(99999), "paid_at": date, "verification_state": "pending"})
	f.add("costs", erpwire.Row{"id": recordID, "category": "software", "amount_satang": int64(1070), "input_vat_satang": int64(70), "incurred_on": date}, erpwire.Row{"id": otherID, "category": "inventory", "amount_satang": int64(99999), "input_vat_satang": int64(0), "incurred_on": date})
	f.add("subscriptions", erpwire.Row{"id": recordID, "status": "active", "amount_satang": int64(1), "interval": "yearly"}, erpwire.Row{"id": otherID, "status": "active", "amount_satang": int64(1), "interval": "yearly"}, erpwire.Row{"id": thirdID, "status": "active", "amount_satang": int64(1), "interval": "weekly"})
	f.add("saved_views", erpwire.Row{"id": recordID, "user_id": userID, "module": "finance", "name": "mine", "created_at": date, "config": erpwire.Row{"status": "overdue,bogus", "mine": "1"}}, erpwire.Row{"id": otherID, "user_id": otherID, "module": "finance", "config": erpwire.Row{}})
	s := service(t, f)
	a := actor(t, erpwire.Member, orgID)
	v, e := call(t, s, a, "page.tsx", "load", erpwire.Row{"status": "overdue,bogus", "mine": "1", "period": "this_month", "groupBy": "client", "q": "ลูกค้า", "tab": "costs"})
	if e != nil {
		t.Fatal(e)
	}
	r := object(v)
	want := erpwire.Row{"unpaidSatang": money.Satang(7630), "revenueSatang": money.Satang(9000), "cashReceivedSatang": money.Satang(2000), "costsSatang": money.Satang(1000), "mrrSatang": money.Satang(5), "openCount": 1}
	if !reflect.DeepEqual(r["metrics"], want) || r["month"] != month || r["tab"] != "costs" || len(r["invoices"].([]erpwire.Row)) != 2 || len(r["filteredInvoiceRows"].([]erpwire.Row)) != 1 || len(r["savedViews"].([]erpwire.Row)) != 1 {
		t.Fatalf("finance=%#v", r)
	}
	row := r["filteredInvoiceRows"].([]erpwire.Row)[0]
	if row["displayNumber"] != "INV-2026-001" || row["paid_satang"] != money.Satang(2000) || row["outstanding"] != money.Satang(7630) || object(row["clients"])["name"] != "ลูกค้า" {
		t.Fatalf("invoice=%#v", row)
	}
	if r["canReviewClose"] != false || f.writes != 0 {
		t.Fatal("finance reader exceeded authority")
	}
	f.failTable = "invoices"
	_, e = call(t, s, a, "page.tsx", "load")
	if e == nil || e.Error() != "Finance data unavailable. Reload before relying on totals." {
		t.Fatalf("unavailable=%v", e)
	}
}
func TestForecastRoundsWholeTotalAndBounds(t *testing.T) {
	subs := []erpwire.Row{}
	for i := 0; i < 6; i++ {
		subs = append(subs, erpwire.Row{"status": "active", "amount_satang": int64(1), "interval": "yearly"})
	}
	n, e := forecast(subs)
	if e != nil || n != 1 {
		t.Fatalf("aggregate rounding %d %v", n, e)
	}
	_, e = forecast([]erpwire.Row{{"status": "active", "amount_satang": int64(money.MaxSafeSatang), "interval": "weekly"}})
	if e == nil || e.Error() != "MRR total outside safe satang bounds" {
		t.Fatalf("MRR overflow %v", e)
	}
}

func TestCostExportNormalizesStoredNumericRate(t *testing.T) {
	for _, test := range []struct{ stored, want string }{{"7.00", "7"}, {"7.50", "7.5"}, {"0.00", "0"}} {
		t.Run(test.stored, func(t *testing.T) {
			f := newFake(t)
			f.add("costs", erpwire.Row{"id": recordID, "category": "other", "amount_satang": int64(100), "incurred_on": "2026-10-01", "input_vat_rate": json.Number(test.stored), "input_vat_satang": int64(0)})
			v, e := call(t, service(t, f), actor(t, erpwire.Member, orgID), "costs/export/route.ts", "GET")
			if e != nil {
				t.Fatal(e)
			}
			want := "\r\nother,,1.00,2026-10-01,,," + test.want + ",0.00"
			if !strings.HasSuffix(v.(RouteResponse).Body, want) {
				t.Fatalf("CSV = %q", v.(RouteResponse).Body)
			}
		})
	}
}

func TestFinanceOverpaidBoundaryClampsBeforeSumming(t *testing.T) {
	f := newFake(t)
	f.add("invoices", erpwire.Row{"id": recordID, "number": "INV-max", "issued_snapshot_id": otherID, "amount_satang": int64(money.MaxSafeSatang), "total_satang": int64(money.MaxSafeSatang), "vat_satang": int64(0), "status": "paid", "issue_date": "2020-01-01"})
	f.add("invoice_balances", erpwire.Row{"invoice_id": recordID, "paid_satang": int64(money.MaxSafeSatang), "credited_satang": int64(money.MaxSafeSatang), "outstanding_satang": int64(0)})
	v, e := call(t, service(t, f), actor(t, erpwire.Member, orgID), "page.tsx", "load")
	if e != nil {
		t.Fatal(e)
	}
	r := object(v)
	invoice := r["invoices"].([]erpwire.Row)[0]
	if invoice["outstanding"] != money.Satang(0) || invoice["effectiveStatus"] != "paid" || object(r["metrics"])["unpaidSatang"] != money.Satang(0) {
		t.Fatalf("boundary invoice=%#v", r)
	}
}
func TestPageDenialsAndNewCostOptions(t *testing.T) {
	f := newFake(t)
	s := service(t, f)
	a := actor(t, erpwire.Member, orgID)
	for _, path := range []string{"journal/page.tsx", "journal/trial-balance/page.tsx", "bank/page.tsx", "cash/page.tsx"} {
		v, e := call(t, s, a, path, "load")
		if e != nil || !strings.Contains(text(object(v)["error"]), "Only owners, admins, and accountants") {
			t.Fatalf("denial %s: %#v %v", path, v, e)
		}
	}
	if f.reads != 0 {
		t.Fatal("denied page read store")
	}
	f.add("projects", erpwire.Row{"id": recordID, "name": "Z"}, erpwire.Row{"id": otherID, "name": "A"}, erpwire.Row{"id": thirdID, "org_id": otherOrg, "name": "secret"})
	v, e := call(t, s, a, "costs/new/page.tsx", "load")
	if e != nil || !reflect.DeepEqual(object(v)["projects"], []erpwire.Row{{"value": otherID, "label": "A"}, {"value": recordID, "label": "Z"}}) {
		t.Fatalf("options=%#v %v", v, e)
	}
	if monthEnd("2024-02") != "2024-02-29" || monthEnd("2025-02") != "2025-02-28" || monthEnd("2026-13") != "" {
		t.Fatal("month window normalization changed")
	}
	if dateOnly("2026-10-31T17:00:00Z") != "2026-11-01" {
		t.Fatal("Bangkok cutoff changed")
	}
}
