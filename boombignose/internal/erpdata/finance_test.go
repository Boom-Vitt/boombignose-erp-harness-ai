package erpdata

import (
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// Deliberately different filtered/workspace fixture values establish that the
// source projector cannot replace canonical coverage with the bounded page.
func TestReceivablesEvidenceSeparatesCanonicalAndFilteredScopes(t *testing.T) {
	now := time.Date(2026, 11, 7, 0, 0, 0, 0, time.UTC)
	r, err := New(Options{Store: &textStore{}, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	summary := map[string]any{"issued_unpaid_count": int64(2), "outstanding_satang": int64(14500000)}
	coverage := map[string]any{"invoice_count": int64(6), "outstanding_satang": int64(38509600), "has_more": true}
	row := erpwire.Row{"id": "40000000-0000-0000-0000-000000000001", "number": "INV-test", "status": "partially_paid", "paid_satang": int64(0), "credited_satang": int64(20000), "outstanding_satang": int64(50000)}
	total := int64(2)
	ev := r.rowsEvidence(erpwire.Actor{}, "list_invoices", r.byKey["invoices"], []erpwire.Row{row}, &total, 0, nil)
	r.invoiceFacts(&ev, summary, coverage, []any{erpwire.Row{"id": row["id"], "number": row["number"], "status": row["status"], "due_date": nil, "outstanding_satang": row["outstanding_satang"]}}, []erpwire.Row{row})
	facts := map[string]erpwire.SourceFact{}
	for _, f := range ev.Source.Facts {
		if _, duplicate := facts[f.ID]; duplicate {
			t.Fatalf("duplicate fact %s", f.ID)
		}
		facts[f.ID] = f
	}
	if facts["summary:issued_unpaid_count"].Value != "2" || facts["summary:outstanding"].Value != "฿145,000.00" || facts["summary:outstanding"].Scope != "matching-records" {
		t.Fatal("lost filtered snapshot scope")
	}
	if facts["coverage:issued_unpaid_count"].Value != "6" || facts["coverage:outstanding"].Value != "฿385,096.00" || facts["coverage:outstanding"].Scope != "workspace" {
		t.Fatal("canonical coverage replaced by page/subset arithmetic")
	}
	if ev.Source.ID != "" || ev.Source.Coverage == nil || !ev.Source.Coverage.Partial || len(ev.Source.RequiredFactIDs) != 2 {
		t.Fatal("invalid allocator/coverage contract")
	}
	for _, key := range ev.Source.Coverage.FactIDs {
		if _, present := facts[key]; !present {
			t.Fatalf("coverage references missing local fact %s", key)
		}
	}
	tag, _, _, _ := identity(r.byKey["invoices"], row)
	if facts["row:"+tag+":paid_satang"].Value != "฿0.00" || facts["row:"+tag+":credited_satang"].Value != "฿200.00" || facts["row:"+tag+":status"].Value != "partially settled (receipts and/or credits)" {
		t.Fatal("credit settlement was represented as cash")
	}
}
