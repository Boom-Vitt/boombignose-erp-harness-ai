package erpinvoicing

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestFinanceCSVExactEscaping(t *testing.T) {
	got := financeCSV([]string{"ไทย", "Amount"}, [][]string{{"=SUM(A1)", "-7.01"}, {"a,\"b\"\r\nc", "0.01"}, {"@unsafe", "90071992547409.91"}})
	want := "\ufeffไทย,Amount\r\n'=SUM(A1),-7.01\r\n\"a,\"\"b\"\"\r\nc\",0.01\r\n'@unsafe,90071992547409.91"
	if got != want {
		t.Fatalf("CSV=%q want %q", got, want)
	}
}

func TestInvoiceExportUsesEffectiveStatusAndExactMoney(t *testing.T) {
	store := financeFixtureStore()
	s := testService(t, store)
	result, e := invoke(t, s, testActor(t, erpwire.Member), financePath+"invoices/export/route.ts::GET", erpwire.Row{"url": "https://example.invalid/finance/invoices/export?status=overdue"})
	if e != nil {
		t.Fatal(e)
	}
	response := result.(RouteResponse)
	body := string(response.Body)
	if response.Status != 200 || response.Headers["Content-Disposition"] != `attachment; filename="invoices-2026-11-08.csv"` {
		t.Fatalf("response=%#v", response)
	}
	expected := testInvoice + ",INV-2026-000001,ลูกค้า = client,sent,overdue,103.00,0.00,10.00,90.00,2026-11-07,2026-11-01,,,3.00,100.00"
	if !strings.Contains(body, expected) || strings.Contains(body, "PRIVATE") || strings.Contains(body, "DRAFT-2") {
		t.Fatalf("CSV=%q", body)
	}
	if store.writeCount != 0 {
		t.Fatal("invoice export mutated")
	}
}

func TestReceiptExportRetainsLegacyWithoutTreatingItAsCash(t *testing.T) {
	store := financeFixtureStore()
	result, e := invoke(t, testService(t, store), testActor(t, erpwire.Member), financePath+"payments/export/route.ts::GET")
	if e != nil {
		t.Fatal(e)
	}
	body := string(result.(RouteResponse).Body)
	if !strings.Contains(body, ",legacy_unverified,500.00,") || !strings.Contains(body, ",verified,10.00,") || strings.Contains(body, "foreign-payment") {
		t.Fatalf("retained evidence CSV=%q", body)
	}
}

func TestFinanceAgingBoundaries(t *testing.T) {
	for _, tc := range []struct {
		due   string
		days  int64
		label string
	}{{"2026-10-31", 0, "Not yet due"}, {"2026-10-30", 1, "1–30 days"}, {"2026-10-01", 30, "1–30 days"}, {"2026-09-30", 31, "31–60 days"}, {"2026-09-01", 60, "31–60 days"}, {"2026-08-31", 61, "61–90 days"}, {"2026-08-02", 90, "61–90 days"}, {"2026-08-01", 91, "91 days or more"}, {"invalid", 0, "Not yet due"}} {
		got := financeDaysLate(tc.due, "2026-10-31")
		if got != tc.days || financeAging(got) != tc.label {
			t.Errorf("%s=%d,%s want %d,%s", tc.due, got, financeAging(got), tc.days, tc.label)
		}
	}
}

func TestOutstandingPackFiltersAndUsesCurrentBalances(t *testing.T) {
	inv := func(id, status, issue, due string) erpwire.Row {
		return erpwire.Row{"id": id, "number": id, "status": status, "issue_date": issue, "due_date": due, "amount_satang": int64(1000), "clients": erpwire.Row{"name": "Client"}}
	}
	invoices := []erpwire.Row{inv("ar", "sent", "2026-10-01", "2026-10-30"), inv("draft", "draft", "2026-10-01", "2026-10-01"), inv("later", "sent", "2026-11-01", "2026-10-01")}
	costs := []erpwire.Row{
		{"id": "ap", "vendor_id": "v", "expense_claim_id": nil, "purchase_cost_kind": "bill", "incurred_on": "2026-10-01", "amount_satang": int64(2000), "due_date": "2026-09-01", "paid_at": "2026-11-01T00:00:00Z"},
		{"id": "paid", "vendor_id": "v", "incurred_on": "2026-10-01", "amount_satang": int64(2000), "paid_at": "2026-10-31T00:00:00Z"},
		{"id": "credit", "vendor_id": "v", "incurred_on": "2026-10-01", "amount_satang": int64(2000), "purchase_cost_kind": "credit"},
	}
	balances := map[string]erpwire.Row{"ar": {"paid_satang": money.Satang(400), "credited_satang": money.Satang(100), "outstanding_satang": money.Satang(500)}}
	rows, e := financeOutstanding("2026-10-31", invoices, costs, balances)
	if e != nil {
		t.Fatal(e)
	}
	if len(rows) != 4 || rows[0][0] != "AR" || rows[0][6] != "5.00" || rows[0][7] != "1" || rows[1][0] != "AP" || rows[1][8] != "31–60 days" || rows[1][9] != "unpaid at close" || rows[2][6] != "5.00" || rows[3][6] != "20.00" {
		t.Fatalf("outstanding=%#v", rows)
	}
}

func TestOutstandingExportRecordsExactChecksumBeforeDownload(t *testing.T) {
	store := financeFixtureStore()
	store.rows["invoices"][0]["issue_date"] = "2026-10-01"
	result, e := invoke(t, testService(t, store), testActor(t, erpwire.Accountant), financePath+"outstanding/export/route.ts::GET")
	if e != nil {
		t.Fatal(e)
	}
	response := result.(RouteResponse)
	if response.Status != 200 || len(store.commands) != 1 {
		t.Fatalf("response=%#v commands=%#v", response, store.commands)
	}
	digest := sha256.Sum256(response.Body)
	expected := hex.EncodeToString(digest[:])
	command := store.commands[0]
	if command.Name != "record_support_export" || command.Args["p_org_id"] != testOrg || command.Args["p_period"] != "2026-10-31" || command.Args["p_kind"] != "outstanding_pack_csv" || command.Args["p_sha256"] != expected || command.Args["p_bytes"] != len(response.Body) || response.Headers["X-Content-SHA256"] != expected {
		t.Fatalf("checksum contract=%#v headers=%#v", command, response.Headers)
	}
}

func TestOutstandingExportRefusesUnrecordedDownloadAndMember(t *testing.T) {
	for _, tc := range []struct {
		name         string
		role         erpwire.Role
		args         any
		commandError bool
		status       int
		body         string
	}{
		{"member", erpwire.Member, erpwire.Row{}, false, 403, "Only owners, admins, and accountants can export the outstanding pack."},
		{"invalid close", erpwire.Owner, erpwire.Row{"asOf": "2026-02-30"}, false, 400, "Enter the close date as YYYY-MM-DD."},
		{"audit failure", erpwire.Owner, erpwire.Row{}, true, 503, "Support export was not recorded. Reload and try the download again."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := financeFixtureStore()
			if tc.commandError {
				store.commandErrors["record_support_export"] = errors.New("DB failure")
			}
			result, e := invoke(t, testService(t, store), testActor(t, tc.role), financePath+"outstanding/export/route.ts::GET", tc.args)
			if e != nil {
				t.Fatal(e)
			}
			response := result.(RouteResponse)
			if response.Status != tc.status || string(response.Body) != tc.body {
				t.Fatalf("response=%#v", response)
			}
		})
	}
}
