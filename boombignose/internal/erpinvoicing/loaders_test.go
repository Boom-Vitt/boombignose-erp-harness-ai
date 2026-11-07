package erpinvoicing

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func financeFixtureStore() *memoryStore {
	store := newMemoryStore()
	store.rows["clients"] = []erpwire.Row{{"id": testClient, "org_id": testOrg, "name": "ลูกค้า = client", "owner": testUser}, {"id": "foreign-client", "org_id": otherOrg, "name": "Private other tenant"}}
	store.rows["invoices"] = []erpwire.Row{
		{"id": testInvoice, "org_id": testOrg, "number": "INV-2026-000001", "issued_snapshot_id": "snapshot", "client_id": testClient, "project_id": nil, "amount_satang": int64(10300), "total_satang": int64(10700), "vat_satang": int64(700), "subtotal_satang": int64(10000), "discount_satang": int64(0), "wht_satang": int64(400), "wht_rate_bps": int64(400), "prices_include_vat": false, "status": "sent", "issue_date": "2026-11-01", "due_date": "2026-11-07", "is_recurring": false, "recurring_interval": nil, "source_quote_id": nil, "source_milestone_id": nil, "notes": nil, "version": int64(1)},
		{"id": "30000000-0000-4000-8000-000000000002", "org_id": testOrg, "number": "DRAFT-2", "issued_snapshot_id": nil, "client_id": testClient, "amount_satang": int64(500), "discount_satang": int64(0), "total_satang": int64(500), "vat_satang": int64(0), "status": "draft", "issue_date": "2026-11-01", "due_date": nil},
		{"id": "foreign-invoice", "org_id": otherOrg, "number": "PRIVATE", "amount_satang": int64(9000000), "total_satang": int64(9000000), "vat_satang": int64(0), "status": "sent", "issue_date": "2026-11-01"},
	}
	store.rows["invoice_balances"] = []erpwire.Row{{"org_id": testOrg, "client_id": testClient, "invoice_id": testInvoice, "paid_satang": int64(1000), "credited_satang": int64(300), "outstanding_satang": int64(9000)}}
	store.rows["payments"] = []erpwire.Row{{"id": testPayment, "org_id": testOrg, "client_id": testClient, "invoice_id": testInvoice, "amount_satang": int64(1000), "verification_state": "verified", "paid_at": "2026-11-03T12:00:00Z", "method": "transfer", "reversal_of": nil}, {"id": "legacy", "org_id": testOrg, "invoice_id": testInvoice, "amount_satang": int64(50000), "verification_state": "legacy_unverified", "paid_at": "2026-11-03T12:00:00Z", "method": "cash"}, {"id": "foreign-payment", "org_id": otherOrg, "amount_satang": int64(800000), "verification_state": "verified", "paid_at": "2026-11-03T12:00:00Z"}}
	store.rows["costs"] = []erpwire.Row{{"id": "cost1", "org_id": testOrg, "amount_satang": int64(10700), "input_vat_satang": int64(700), "category": "software", "incurred_on": "2026-11-02", "vendor_id": "vendor", "paid_at": nil}, {"id": "asset", "org_id": testOrg, "amount_satang": int64(500000), "input_vat_satang": int64(0), "category": "inventory", "incurred_on": "2026-11-02", "vendor_id": "vendor", "paid_at": nil}}
	store.rows["credit_note_revenue"] = []erpwire.Row{{"id": "credit1", "org_id": testOrg, "issue_date": "2026-11-02", "base_satang": int64(300), "total_satang": int64(321)}}
	store.rows["subscriptions"] = []erpwire.Row{{"id": "s1", "org_id": testOrg, "status": "active", "amount_satang": int64(100), "interval": "weekly"}, {"id": "s2", "org_id": testOrg, "status": "active", "amount_satang": int64(200), "interval": "monthly"}, {"id": "s3", "org_id": testOrg, "status": "cancelled", "amount_satang": int64(900000), "interval": "monthly"}}
	store.rows["org_settings"] = []erpwire.Row{{"org_id": testOrg, "vat_registered": true, "vat_rate_bps": int64(700)}}
	return store
}

func TestFinanceLoaderUsesVerifiedScopedEvidence(t *testing.T) {
	store := financeFixtureStore()
	s := testService(t, store)
	result, e := invoke(t, s, testActor(t, erpwire.Accountant), financePath+"page.tsx::load", erpwire.Row{"searchParams": erpwire.Row{"status": "overdue", "mine": "1", "groupBy": "client"}})
	if e != nil {
		t.Fatal(e)
	}
	out := result.(erpwire.Row)
	for field, want := range map[string]money.Satang{"unpaidSatang": 9000, "revenueSatang": 9700, "cashReceivedSatang": 1000, "costsSatang": 10000, "mrrSatang": 633} {
		if got := out[field]; got != want {
			t.Errorf("%s=%v, want %v", field, got, want)
		}
	}
	if out["openCount"] != 1 {
		t.Fatalf("open count=%v", out["openCount"])
	}
	visible := out["filteredInvoiceRows"].([]erpwire.Row)
	if len(visible) != 1 || visible[0]["id"] != testInvoice || visible[0]["effectiveStatus"] != "overdue" {
		t.Fatalf("effective scoped facets: %#v", visible)
	}
	if all := out["invoiceRows"].([]erpwire.Row); len(all) != 2 {
		t.Fatalf("foreign tenant exposed: %#v", all)
	}
	if entries := out["balances"].(erpwire.BrowserMap).Entries; len(entries) != 1 {
		t.Fatalf("balances map=%#v", entries)
	}
	if store.writeCount != 0 {
		t.Fatal("loader wrote data")
	}
}

func TestFinanceLoaderFailsClosedOnMissingEvidence(t *testing.T) {
	for _, table := range []string{"invoices", "payments", "costs", "org_settings", "invoice_balances", "credit_note_revenue", "subscriptions"} {
		t.Run(table, func(t *testing.T) {
			store := financeFixtureStore()
			store.readErrors[table] = errors.New("private database failure")
			_, e := invoke(t, testService(t, store), testActor(t, erpwire.Owner), financePath+"page.tsx::load")
			if e == nil || e.Error() != "Finance data unavailable. Reload before relying on totals." {
				t.Fatalf("failure=%v", e)
			}
		})
	}
}

func TestFinanceNetTotalsDoNotOverflowOnGrossIntermediate(t *testing.T) {
	store := newMemoryStore()
	maximum := int64(money.MaxSafeSatang)
	store.rows["org_settings"] = []erpwire.Row{{"org_id": testOrg, "vat_registered": true}}
	store.rows["invoices"] = []erpwire.Row{
		{"id": "a", "org_id": testOrg, "status": "sent", "issue_date": "2026-11-01", "amount_satang": int64(0), "total_satang": maximum - 100, "vat_satang": int64(0)},
		{"id": "b", "org_id": testOrg, "status": "sent", "issue_date": "2026-11-01", "amount_satang": int64(0), "total_satang": int64(150), "vat_satang": int64(100)},
	}
	store.rows["costs"] = []erpwire.Row{
		{"id": "a", "org_id": testOrg, "category": "software", "incurred_on": "2026-11-01", "amount_satang": maximum - 100, "input_vat_satang": int64(0)},
		{"id": "b", "org_id": testOrg, "category": "software", "incurred_on": "2026-11-01", "amount_satang": int64(150), "input_vat_satang": int64(100)},
	}
	result, e := invoke(t, testService(t, store), testActor(t, erpwire.Owner), financePath+"page.tsx::load")
	if e != nil {
		t.Fatal(e)
	}
	out := result.(erpwire.Row)
	if out["revenueSatang"] != money.MaxSafeSatang-50 || out["costsSatang"] != money.MaxSafeSatang-50 {
		t.Fatalf("valid net totals=%#v", out)
	}
}

func TestInvoiceClaimsFailureKeepsEvidenceAndSignalsQueue(t *testing.T) {
	store := financeFixtureStore()
	store.readErrors["payment_claims"] = errors.New("queue failure")
	out, e := invoke(t, testService(t, store), testActor(t, erpwire.Member), financePath+"invoices/[id]/page.tsx::load", erpwire.Row{"params": erpwire.Row{"id": testInvoice}})
	if e != nil {
		t.Fatal(e)
	}
	row := out.(erpwire.Row)
	if row["claimsError"] != "Payment queue unavailable. Reload before approving." || row["paid"] != money.Satang(1000) || row["outstanding"] != money.Satang(9000) {
		t.Fatalf("unsafe queue fallback: %#v", row)
	}
	if store.readCount != 2 {
		t.Fatalf("failed queue reused transaction: %d reads", store.readCount)
	}
	if row["accounting"].(erpwire.Row)["connected"] != false {
		t.Fatal("community accounting changed")
	}
}

func TestInvoiceLoaderRejectsForeignInvoiceAndPreservesAuthorization(t *testing.T) {
	store := financeFixtureStore()
	foreign := "30000000-0000-4000-8000-000000000099"
	store.rows["invoices"] = append(store.rows["invoices"], erpwire.Row{"id": foreign, "org_id": otherOrg})
	_, e := invoke(t, testService(t, store), testActor(t, erpwire.Owner), financePath+"invoices/[id]/page.tsx::load", foreign)
	if !errors.Is(e, erpwire.ErrNotFound) {
		t.Fatalf("cross-org invoice=%v", e)
	}
	store = financeFixtureStore()
	store.readErrors["payment_claims"] = erpwire.ErrIdentityChanged
	_, e = invoke(t, testService(t, store), testActor(t, erpwire.Owner), financePath+"invoices/[id]/page.tsx::load", testInvoice)
	if !errors.Is(e, erpwire.ErrIdentityChanged) {
		t.Fatalf("identity failure hidden: %v", e)
	}
}

func TestFinanceMRRExactBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name string
		rows []erpwire.Row
		want money.Satang
		bad  bool
	}{
		{"half rounded once", []erpwire.Row{{"status": "active", "amount_satang": int64(6), "interval": "yearly"}}, 1, false},
		{"sum then round", []erpwire.Row{{"status": "active", "amount_satang": int64(5), "interval": "yearly"}, {"status": "active", "amount_satang": int64(5), "interval": "yearly"}}, 1, false},
		{"maximum monthly", []erpwire.Row{{"status": "active", "amount_satang": int64(money.MaxSafeSatang), "interval": "monthly"}}, money.MaxSafeSatang, false},
		{"overflow weekly", []erpwire.Row{{"status": "active", "amount_satang": int64(money.MaxSafeSatang), "interval": "weekly"}}, 0, true},
		{"negative", []erpwire.Row{{"status": "active", "amount_satang": int64(-1), "interval": "monthly"}}, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, e := financeMRR(tc.rows)
			if (e != nil) != tc.bad || e == nil && got != tc.want {
				t.Fatalf("got %d,%v want %d bad=%v", got, e, tc.want, tc.bad)
			}
		})
	}
}

func TestFinanceGridAndTaxChecklist(t *testing.T) {
	lines := []erpwire.Row{{"id": "line", "quantity": json.Number("1.125"), "unit_price_satang": int64(money.MaxSafeSatang), "description": "สินค้า"}}
	sections := []erpwire.Row{{"id": "after", "lines_before": int64(1), "position": int64(1), "kind": "note", "description": "end"}, {"id": "before", "lines_before": int64(0), "position": int64(0), "kind": "section", "description": "start"}}
	rows, e := financeGridRows(lines, sections)
	if e != nil {
		t.Fatal(e)
	}
	if rows[0]["id"] != "before" || rows[1]["quantity"] != "1.125" || rows[1]["unitPrice"] != "90071992547409.91" || rows[2]["id"] != "after" {
		t.Fatalf("grid=%#v", rows)
	}
	initial := erpwire.Row{"taxStatus": "registered", "legalName": "บริษัท", "address": "Bangkok", "taxId": "1234567890123", "branchLabel": "สำนักงานใหญ่"}
	checks := financeTaxChecklist(initial, financeTemplate(erpwire.Row{"branch_code": "00000"}))
	byID := map[string]erpwire.Row{}
	for _, c := range checks {
		byID[text(c["id"])] = c
	}
	if len(checks) != 21 || byID["seller-tax-id"]["state"] != "present" || byID["branch-code"]["state"] != "present" || byID["etax"]["state"] != "gap" {
		t.Fatalf("checks=%#v", checks)
	}
	invalid := financeTemplate(erpwire.Row{"seller_phone": "valid", "copy_label": strings.Repeat("😀", 21)})
	if !reflect.DeepEqual(invalid, erpwire.Row{"seller_phone": "", "branch_code": "", "copy_label": ""}) {
		t.Fatalf("invalid template partially accepted: %#v", invalid)
	}
}

func TestFinanceInventoryUsesScopedViewsWithoutRPC(t *testing.T) {
	store := newMemoryStore()
	store.rows["products"] = []erpwire.Row{{"id": "p", "org_id": testOrg, "name": "Stock", "is_stockable": true, "list_price_satang": int64(100), "cost_satang": int64(20), "default_vendor_id": "v"}, {"id": "foreign", "org_id": otherOrg, "is_stockable": true}}
	store.rows["inventory_forecast"] = []erpwire.Row{{"product_id": "p", "org_id": testOrg, "on_order": json.Number("2.001"), "reserved_quantity": json.Number("1.001")}}
	store.rows["inventory_totals"] = []erpwire.Row{{"product_id": "p", "org_id": testOrg, "quantity": json.Number("3.001"), "value_satang": int64(60)}}
	store.rows["product_vendor_lead_times"] = []erpwire.Row{{"org_id": testOrg, "product_id": "p", "vendor_id": "v", "lead_days": int64(7)}}
	var snapshot erpwire.Row
	e := store.Read(context.Background(), testActor(t, erpwire.Owner), func(tx erpwire.ReadTx) error {
		var err error
		snapshot, err = financeInventorySnapshot(context.Background(), tx, testActor(t, erpwire.Owner))
		return err
	})
	if e != nil {
		t.Fatal(e)
	}
	products := snapshot["products"].([]erpwire.Row)
	if len(products) != 1 || products[0]["quantity"] != json.Number("3.001") || products[0]["lead_days"] != int64(7) || products[0]["value_satang"] != money.Satang(60) {
		t.Fatalf("snapshot=%#v", snapshot)
	}
}
