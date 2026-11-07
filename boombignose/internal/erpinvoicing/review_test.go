package erpinvoicing

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestSuppliedDraftSubtotalSkipsUnsafeFallback(t *testing.T) {
	doc, err := draftInvoiceDocument(erpwire.Row{"id": testInvoice, "number": "draft", "status": "draft", "amount_satang": int64(money.MaxSafeSatang), "discount_satang": int64(1), "subtotal_satang": int64(money.MaxSafeSatang), "total_satang": int64(money.MaxSafeSatang)}, nil, testActor(t, erpwire.Owner), 0, 0, "2026-11-08")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 1 || doc.Items[0].AmountSatang != money.MaxSafeSatang || doc.SubtotalSatang != money.MaxSafeSatang {
		t.Fatalf("supplied subtotal lost: %#v", doc)
	}
}

func TestEffectiveInvoiceStateTransitions(t *testing.T) {
	for _, tt := range []struct {
		stored, due         string
		total, paid, credit money.Satang
		want                string
	}{
		{"draft", "2026-11-01", 100, 100, 0, "draft"},
		{"cancelled", "2026-11-01", 100, 0, 0, "cancelled"},
		{"sent", "2026-11-09", 100, 0, 0, "sent"},
		{"sent", "2026-11-09", 100, 1, 0, "partially_paid"},
		{"sent", "2026-11-09", 100, 0, 1, "partially_paid"},
		{"partially_paid", "2026-11-07", 100, 1, 0, "overdue"},
		{"overdue", "2026-11-07", 100, 80, 20, "paid"},
		{"overdue", "2026-11-07", 100, 0, 100, "paid"},
		{"sent", "2026-11-09", money.MaxSafeSatang, money.MaxSafeSatang - 1, 1, "paid"},
		{"paid", "2026-11-09", 100, 0, 0, "sent"},
	} {
		t.Run(fmt.Sprintf("%s-%d-%d", tt.stored, tt.paid, tt.credit), func(t *testing.T) {
			r := erpwire.Row{"status": tt.stored, "due_date": tt.due, "amount_satang": tt.total}
			if got := status(r, tt.paid, tt.credit, "2026-11-08"); got != tt.want {
				t.Fatalf("state %q want %q", got, tt.want)
			}
			want := tt.total - tt.paid - tt.credit
			if want < 0 {
				want = 0
			}
			if got := outstanding(tt.total, tt.paid, tt.credit); got != want {
				t.Fatalf("outstanding %d want %d", got, want)
			}
		})
	}
}

func TestScopedReadTraversesEveryPage(t *testing.T) {
	store := newMemoryStore()
	for i := 0; i < 1001; i++ {
		store.rows["costs"] = append(store.rows["costs"], erpwire.Row{"id": fmt.Sprintf("cost-%04d", i), "org_id": testOrg, "amount_satang": int64(1)})
	}
	store.rows["costs"] = append(store.rows["costs"], erpwire.Row{"id": "foreign", "org_id": otherOrg, "amount_satang": int64(999999)})
	a := testActor(t, erpwire.Owner)
	var rows []erpwire.Row
	e := store.Read(context.Background(), a, func(tx erpwire.ReadTx) error {
		var err error
		rows, err = all(context.Background(), tx, erpwire.Select{Table: "costs", Columns: []string{"id", "amount_satang"}, Where: scope(a), Order: ordered("id")})
		return err
	})
	if e != nil {
		t.Fatal(e)
	}
	if len(rows) != 1001 || rows[1000]["id"] != "cost-1000" || len(store.queries) != 2 || store.queries[1].Offset != 1000 {
		t.Fatalf("truncated pagination rows=%d queries=%#v", len(rows), store.queries)
	}
}

func TestEveryAllowedWithholdingRateAndCostTenantGuard(t *testing.T) {
	for _, rate := range []int64{0, 100, 200, 300, 500} {
		t.Run(fmt.Sprint(rate), func(t *testing.T) {
			store := newMemoryStore()
			store.rows["invoices"] = []erpwire.Row{{"org_id": testOrg, "id": testInvoice, "status": "draft", "issued_snapshot_id": nil}}
			r, e := invoke(t, testService(t, store), testActor(t, erpwire.Accountant), financeActions+"updateInvoiceWithholding", erpwire.Row{"invoiceId": testInvoice, "rateBps": rate})
			if out := actionValue(t, r, e); len(out) != 0 || store.rows["invoices"][0]["wht_rate_bps"] != rate || object(store.rows["audit_log"][0]["meta"])["rateBps"] != rate {
				t.Fatalf("withholding %#v rows=%#v", out, store.rows)
			}
		})
	}
	store := newMemoryStore()
	store.rows["costs"] = []erpwire.Row{{"org_id": otherOrg, "id": testPayment, "amount_satang": int64(100)}}
	s := testService(t, store)
	r, e := invoke(t, s, testActor(t, erpwire.Owner), financeActions+"deleteCost", erpwire.Row{"id": testPayment})
	if out := actionValue(t, r, e); len(out) != 0 || len(store.rows["costs"]) != 1 {
		t.Fatalf("foreign cost deleted %#v", out)
	}
	r, e = invoke(t, s, testActor(t, erpwire.Member), financeActions+"deleteCost", erpwire.Row{"id": testPayment})
	if out := actionValue(t, r, e); out["error"] != "Only owners and admins can delete costs." {
		t.Fatalf("delete authorization %#v", out)
	}
	r, e = invoke(t, s, testActor(t, erpwire.Member), financeActions+"createCost", erpwire.Row{"amountBaht": "0.01", "vendor": " supplier "})
	if out := actionValue(t, r, e); len(out) != 0 {
		t.Fatalf("cost create %#v", out)
	}
	cost := store.rows["costs"][1]
	if cost["org_id"] != testOrg || cost["category"] != "other" || cost["vendor"] != "supplier" || cost["amount_satang"] != int64(1) {
		t.Fatalf("wrong cost %#v", cost)
	}
}

func TestAccountantMonthEndAccessAndGridQuantityNormalization(t *testing.T) {
	r, e := invoke(t, testService(t, financeFixtureStore()), testActor(t, erpwire.Accountant), financePath+"page.tsx::load")
	if e != nil {
		t.Fatal(e)
	}
	if r.(erpwire.Row)["canReviewMonthEndClose"] != true {
		t.Fatal("accountant lost month-end-close access")
	}
	for _, tt := range []struct{ quantity, want string }{{"1.000", "1"}, {"1.120", "1.12"}, {"0.001", "0.001"}, {"100", "100"}} {
		rows, e := financeGridRows([]erpwire.Row{{"id": "line", "quantity": json.Number(tt.quantity), "unit_price_satang": int64(1)}}, nil)
		if e != nil || rows[0]["quantity"] != tt.want {
			t.Fatalf("grid quantity %q => %#v,%v want %q", tt.quantity, rows, e, tt.want)
		}
	}
}

func TestMoneyInputKeepsJavaScriptWhitespaceBoundary(t *testing.T) {
	for _, tt := range []struct {
		key   string
		input erpwire.Row
		want  string
	}{
		{financeActions + "createInvoice", erpwire.Row{"client_id": testClient, "amountBaht": "\u00851\u0085"}, "Invalid input"},
		{financeActions + "createCost", erpwire.Row{"amountBaht": "\u00851\u0085"}, "Invalid input"},
		{financePath + "receipt-actions.ts::reportCustomerReceipt", erpwire.Row{"clientId": testClient, "key": testKey, "amountBaht": "\u00851\u0085", "reference": "receipt", "allocations": []any{}}, "Enter a positive THB amount with up to two decimals"},
	} {
		t.Run(tt.key, func(t *testing.T) {
			store := newMemoryStore()
			r, e := invoke(t, testService(t, store), testActor(t, erpwire.Owner), tt.key, tt.input)
			if got := actionValue(t, r, e); got["error"] != tt.want || store.writeCount != 0 {
				t.Fatalf("non-JS whitespace passed: %#v writes=%d", got, store.writeCount)
			}
		})
	}
}

func TestCreditDocumentOmitsInvoiceReceiptBalanceFields(t *testing.T) {
	doc := PrintableDocument{Kind: "Credit note / ใบลดหนี้"}
	raw, e := json.Marshal(doc)
	if e != nil {
		t.Fatal(e)
	}
	var fields erpwire.Row
	if e := erpwire.DecodeJSON(raw, &fields); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"verifiedPaidSatang", "outstandingSatang"} {
		if _, exists := fields[key]; exists {
			t.Fatalf("credit renderer would show invoice balance %s", key)
		}
	}
}
