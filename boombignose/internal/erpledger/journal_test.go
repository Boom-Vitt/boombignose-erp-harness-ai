package erpledger

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var testAccounts = []string{"1110", "1120", "1130", "2120", "2130", "4100"}

func saleFixture() erpwire.Row {
	return erpwire.Row{"id": recordID, "status": "sent", "quote_invoice_kind": "lines", "quote_deposit_satang": int64(0), "quote_deposit_deduction_satang": int64(0), "quote_discount_satang": int64(0), "source_quote_id": nil, "issue_date": "2026-10-15", "number": "INV-2026-000001", "prices_include_vat": false, "subtotal_satang": int64(100000), "discount_satang": int64(0), "vat_satang": int64(7000), "total_satang": int64(107000), "wht_satang": int64(0), "wht_rate_bps": int64(0), "amount_satang": int64(107000), "tax_breakdown": []any{erpwire.Row{"rateBps": int64(700), "baseSatang": int64(100000), "vatSatang": int64(7000)}}, "issued_snapshot_id": otherID}
}
func saleSnapshot(inv erpwire.Row) erpwire.Row {
	doc := erpwire.Row{}
	for key, column := range map[string]string{"number": "number", "issueDate": "issue_date", "pricesIncludeVat": "prices_include_vat", "subtotalSatang": "subtotal_satang", "discountSatang": "discount_satang", "vatSatang": "vat_satang", "totalSatang": "total_satang", "whtSatang": "wht_satang", "whtRateBps": "wht_rate_bps", "amountDueSatang": "amount_satang", "vatByRate": "tax_breakdown"} {
		doc[key] = inv[column]
	}
	return erpwire.Row{"kind": "operational_invoice", "document": doc}
}
func setSaleAmounts(inv erpwire.Row, subtotal, discount, base, vat, total, rate int64) {
	inv["subtotal_satang"] = subtotal
	inv["discount_satang"] = discount
	inv["vat_satang"] = vat
	inv["total_satang"] = total
	inv["amount_satang"] = total
	inv["tax_breakdown"] = []any{erpwire.Row{"rateBps": rate, "baseSatang": base, "vatSatang": vat}}
}
func TestDraftJournalValidationAndExactCommand(t *testing.T) {
	for _, test := range []struct {
		name, date, memo string
		lines            []JournalLine
		want             string
	}{
		{"valid", "2026-10-31", "  ปิดงวด  ", []JournalLine{{"1110", money.MaxSafeSatang, 0}, {"4100", 0, money.MaxSafeSatang}}, ""},
		{"open", "2026-11-01", "memo", []JournalLine{{"1110", 1, 0}, {"4100", 0, 1}}, "Post a journal only into a closed period."},
		{"bad date", "2026-02-30", "memo", nil, "Enter a journal date."},
		{"blank memo", "2026-10-01", " ", nil, "Enter a journal memo."},
		{"long emoji memo", "2026-10-01", strings.Repeat("😀", 101), nil, "Enter a journal memo."},
		{"line count", "2026-10-01", "memo", []JournalLine{{"1110", 1, 0}}, "A journal needs 2 to 20 lines."},
		{"missing chart", "2026-10-01", "memo", []JournalLine{{"9999", 1, 0}, {"4100", 0, 1}}, chartError},
		{"both sides", "2026-10-01", "memo", []JournalLine{{"1110", 1, 1}, {"4100", 0, 1}}, "A journal line is debit or credit, not both."},
		{"empty side", "2026-10-01", "memo", []JournalLine{{"1110", 0, 0}, {"4100", 0, 1}}, "A journal line needs an amount."},
		{"unbalanced", "2026-10-01", "memo", []JournalLine{{"1110", 2, 0}, {"4100", 0, 1}}, "Journal debits and credits do not balance."},
		{"unsafe", "2026-10-01", "memo", []JournalLine{{"1110", money.MaxSafeSatang + 1, 0}, {"4100", 0, 1}}, amountError},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newFake(t)
			fakeChart(f)
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Accountant, orgID), "journal/actions.ts", "postDraftJournal", erpwire.Row{"entryDate": test.date, "memo": test.memo, "lines": test.lines})
			if test.want != "" {
				expectError(t, v, e, test.want)
				if len(f.commands) > 0 {
					t.Fatal("invalid journal posted")
				}
				return
			}
			r := action(t, v, e)
			if len(f.commands) != 1 || f.commands[0].Name != "post_draft_journal" || f.commands[0].Args["p_memo"] != "ปิดงวด" || f.commands[0].Args["p_entry_date"] != test.date || !reflect.DeepEqual(r.Refresh, []string{"/finance/journal", "/audit/close"}) {
				t.Fatalf("post %#v, response %#v", f.commands, r)
			}
			raw, _ := json.Marshal(f.commands[0].Args["p_lines"])
			if !strings.Contains(string(raw), "9007199254740991") {
				t.Fatal("lost maximum exact amount")
			}
		})
	}
}
func TestSalesJournalTotalsAndRefusals(t *testing.T) {
	for _, test := range []struct {
		name     string
		change   func(erpwire.Row)
		snapshot func(erpwire.Row)
		lock     string
		accounts []string
		want     string
	}{
		{"exclusive", nil, nil, "2026-10-31", testAccounts, ""},
		{"inclusive", func(r erpwire.Row) { r["prices_include_vat"] = true; r["subtotal_satang"] = int64(107000) }, nil, "2026-10-31", testAccounts, ""},
		{"no VAT max", func(r erpwire.Row) {
			setSaleAmounts(r, int64(money.MaxSafeSatang), 0, int64(money.MaxSafeSatang), 0, int64(money.MaxSafeSatang), 0)
		}, nil, "2026-10-31", testAccounts, ""},
		{"draft", func(r erpwire.Row) { r["status"] = "draft" }, nil, "2026-10-31", testAccounts, invoiceError},
		{"cancelled", func(r erpwire.Row) { r["status"] = "cancelled" }, nil, "2026-10-31", testAccounts, invoiceError},
		{"legacy", nil, func(r erpwire.Row) { r["kind"] = "legacy_operational_invoice" }, "2026-10-31", testAccounts, invoiceError},
		{"withholding", func(r erpwire.Row) { r["wht_satang"] = int64(3000) }, nil, "2026-10-31", testAccounts, "Withholding is not posted from the invoice."},
		{"deposit", func(r erpwire.Row) { r["quote_invoice_kind"] = "deposit" }, nil, "2026-10-31", testAccounts, "A deposit invoice is not posted."},
		{"snapshot tampering", nil, func(r erpwire.Row) { object(r["document"])["totalSatang"] = int64(106999) }, "2026-10-31", testAccounts, invoiceSnapshotError},
		{"rate mismatch", func(r erpwire.Row) { setSaleAmounts(r, 100000, 0, 100000, 6999, 106999, 700) }, nil, "2026-10-31", testAccounts, rateError},
		{"total mismatch", func(r erpwire.Row) { r["total_satang"] = int64(107001); r["amount_satang"] = int64(107001) }, nil, "2026-10-31", testAccounts, totalsError},
		{"open period", nil, nil, "", testAccounts, "Post a journal only into a closed period."},
		{"chart missing VAT", nil, nil, "2026-10-31", []string{"1130", "4100"}, chartError},
	} {
		t.Run(test.name, func(t *testing.T) {
			inv := saleFixture()
			if test.change != nil {
				test.change(inv)
			}
			snapshot := saleSnapshot(inv)
			if test.snapshot != nil {
				test.snapshot(snapshot)
			}
			p, e := plainSale(inv, snapshot, test.lock, test.accounts)
			if test.want != "" {
				if e == nil || e.Error() != test.want {
					t.Fatalf("error=%v want %q", e, test.want)
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			total, _ := satang(inv["total_satang"])
			vat, _ := satang(inv["vat_satang"])
			want := []JournalLine{{"1130", total, 0}}
			if vat > 0 {
				want = append(want, JournalLine{"2130", 0, vat})
			}
			want = append(want, JournalLine{"4100", 0, total - vat})
			if !reflect.DeepEqual(p.Lines, want) || p.Date != "2026-10-15" || p.Memo != "Issued sales invoice INV-2026-000001" {
				t.Fatalf("posting %#v", p)
			}
		})
	}
	if !vatAgrees(vatBucket{700, 100000, 7000}, false) || vatAgrees(vatBucket{700, 100000, 6999}, false) || !vatAgrees(vatBucket{10000, 1, 1}, true) {
		t.Fatal("exact VAT rounding failed")
	}
}
func TestDepositAndFinalJournal(t *testing.T) {
	deposit := saleFixture()
	deposit["quote_invoice_kind"] = "deposit"
	deposit["quote_deposit_satang"] = int64(2500)
	deposit["source_quote_id"] = thirdID
	setSaleAmounts(deposit, 2500, 0, 2500, 175, 2675, 700)
	p, e := depositSale(deposit, saleSnapshot(deposit), "2026-10-31", []string{"1130", "2120", "2130"})
	if e != nil || !reflect.DeepEqual(p.Lines, []JournalLine{{"1130", 2675, 0}, {"2130", 0, 175}, {"2120", 0, 2500}}) {
		t.Fatalf("deposit=%#v %v", p, e)
	}
	final := saleFixture()
	final["source_quote_id"] = thirdID
	final["quote_deposit_deduction_satang"] = int64(2500)
	setSaleAmounts(final, 10000, 2500, 7500, 525, 8025, 700)
	for _, test := range []struct {
		held             money.Satang
		unposted, credit bool
		discount         int64
		want             string
	}{
		{2500, false, false, 0, ""}, {2000, false, false, 0, "This final invoice does not apply the whole posted deposit."}, {2500, true, false, 0, "Post the deposit invoice before this final invoice."}, {2500, false, true, 0, "A credit note on a deposit invoice is not applied."}, {2500, false, false, 100, "This deposit deduction is not in the invoice discount."},
	} {
		t.Run(test.want, func(t *testing.T) {
			r := copyRow(final)
			r["quote_discount_satang"] = test.discount
			p, e := finalSale(r, saleSnapshot(r), "2026-10-31", testAccounts, test.held, test.unposted, test.credit)
			if test.want != "" {
				if e == nil || e.Error() != test.want {
					t.Fatalf("got %v want %s", e, test.want)
				}
				return
			}
			if e != nil || !reflect.DeepEqual(p.Lines, []JournalLine{{"1130", 8025, 0}, {"2130", 0, 525}, {"4100", 0, 10000}, {"2120", 2500, 0}}) {
				t.Fatalf("final=%#v %v", p, e)
			}
		})
	}
}
func creditFixture() erpwire.Row {
	return erpwire.Row{"id": otherID, "invoice_id": recordID, "number": "CN-2026-000001", "issue_date": "2026-10-20", "amount_satang": int64(10700), "snapshot": erpwire.Row{"kind": "credit_note", "document": erpwire.Row{"number": "CN-2026-000001", "issueDate": "2026-10-20", "pricesIncludeVat": false, "baseSatang": int64(10000), "vatSatang": int64(700), "totalSatang": int64(10700), "whtSatang": int64(0), "whtRateBps": int64(0), "amountDueSatang": int64(10700), "vatByRate": []any{erpwire.Row{"rateBps": int64(700), "baseSatang": int64(10000), "vatSatang": int64(700)}}}}}
}
func TestCreditJournalLimits(t *testing.T) {
	for _, test := range []struct {
		name                                         string
		posted                                       bool
		creditBase, creditVAT, creditTotal, receipts money.Satang
		want                                         string
	}{
		{"valid", true, 0, 0, 0, 0, ""}, {"unposted sale", false, 0, 0, 0, 0, "Post the sales invoice before this credit note."}, {"too much base", true, 95000, 0, 0, 0, "This credit is larger than the sale still posted."}, {"too much VAT", true, 0, 6500, 0, 0, "This credit is larger than the sale still posted."}, {"too much total", true, 0, 0, 100000, 0, "This credit is larger than the sale still posted."}, {"cash already posted", true, 0, 0, 0, 100000, "This credit is larger than the receivable still posted."},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, e := creditJournal(creditFixture(), creditContext{saleFixture(), test.posted, test.creditBase, test.creditVAT, test.creditTotal, test.receipts, "2026-10-31", testAccounts})
			if test.want != "" {
				if e == nil || e.Error() != test.want {
					t.Fatalf("got %v want %s", e, test.want)
				}
				return
			}
			if e != nil || !reflect.DeepEqual(p.Lines, []JournalLine{{"4100", 10000, 0}, {"2130", 700, 0}, {"1130", 0, 10700}}) {
				t.Fatalf("credit=%#v %v", p, e)
			}
		})
	}
}
func paymentFixture() erpwire.Row {
	return erpwire.Row{"id": thirdID, "verification_state": "verified", "method": "cash", "amount_satang": int64(5000), "paid_at": "2026-10-20T18:00:00Z", "reversal_of": nil, "refund_of": nil, "notes": " เงินสดหน้าร้าน ", "verification_reference": "fallback"}
}
func TestReceiptJournalMethodsAndLimits(t *testing.T) {
	for _, method := range []string{"cash", "transfer", "promptpay", "card", "cheque"} {
		t.Run(method, func(t *testing.T) {
			pmt := paymentFixture()
			pmt["method"] = method
			p, e := receiptJournal(pmt, []erpwire.Row{{"invoice_id": recordID, "amount_satang": int64(5000)}}, map[string]receiptInvoice{recordID: {true, 0, 107000, 10700, 0}}, "2026-10-31", testAccounts)
			account, label := "1120", "Bank"
			if method == "cash" {
				account, label = "1110", "Cash"
			}
			if e != nil || !reflect.DeepEqual(p.Lines, []JournalLine{{account, 5000, 0}, {"1130", 0, 5000}}) || p.Date != "2026-10-21" || p.Memo != label+" receipt 2026-10-21 เงินสดหน้าร้าน" {
				t.Fatalf("receipt=%#v %v", p, e)
			}
		})
	}
	for _, test := range []struct {
		name       string
		change     func(erpwire.Row)
		invoice    receiptInvoice
		allocation int64
		want       string
	}{
		{"pending", func(p erpwire.Row) { p["verification_state"] = "pending" }, receiptInvoice{true, 0, 107000, 0, 0}, 5000, receiptError},
		{"reversed", func(p erpwire.Row) { p["reversal_of"] = recordID }, receiptInvoice{true, 0, 107000, 0, 0}, 5000, receiptError},
		{"refund", func(p erpwire.Row) { p["refund_of"] = recordID }, receiptInvoice{true, 0, 107000, 0, 0}, 5000, receiptError},
		{"other", func(p erpwire.Row) { p["method"] = "other" }, receiptInvoice{true, 0, 107000, 0, 0}, 5000, "This receipt method is not posted."},
		{"partial allocation", nil, receiptInvoice{true, 0, 107000, 0, 0}, 4999, "This receipt is not fully allocated to posted invoices."},
		{"unposted sale", nil, receiptInvoice{false, 0, 107000, 0, 0}, 5000, "Post the sales invoice before this receipt."},
		{"withholding", nil, receiptInvoice{true, 3000, 107000, 0, 0}, 5000, "Withholding is not posted from the receipt."},
		{"exceeds remainder", nil, receiptInvoice{true, 0, 107000, 10700, 92000}, 5000, "This receipt is larger than the receivable still posted."},
	} {
		t.Run(test.name, func(t *testing.T) {
			payment := paymentFixture()
			if test.change != nil {
				test.change(payment)
			}
			_, e := receiptJournal(payment, []erpwire.Row{{"invoice_id": recordID, "amount_satang": test.allocation}}, map[string]receiptInvoice{recordID: test.invoice}, "2026-10-31", testAccounts)
			if e == nil || e.Error() != test.want {
				t.Fatalf("got %v want %s", e, test.want)
			}
		})
	}
}
func TestPostingOperationsAndTenantIsolation(t *testing.T) {
	for _, test := range []struct{ name, command, arg string }{
		{"postIssuedSalesInvoice", "post_issued_sales_invoice", recordID}, {"postIssuedCreditNote", "post_issued_credit_note", otherID}, {"postCashReceipt", "post_cash_receipt", thirdID},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newFake(t)
			fakeChart(f)
			inv := saleFixture()
			f.add("invoices", inv)
			f.add("invoice_snapshots", erpwire.Row{"id": otherID, "snapshot": saleSnapshot(inv)})
			f.add("credit_notes", creditFixture())
			f.add("payments", paymentFixture())
			f.add("payment_allocations", erpwire.Row{"id": recordID, "invoice_id": recordID, "payment_id": thirdID, "amount_satang": int64(5000)})
			if test.name != "postIssuedSalesInvoice" {
				f.add("journal_entries", erpwire.Row{"id": recordID, "source_invoice_id": recordID})
			}
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Accountant, orgID), "journal/actions.ts", test.name, test.arg)
			r := action(t, v, e)
			if len(f.commands) != 1 || f.commands[0].Name != test.command || object(r.Value)["error"] != nil {
				t.Fatalf("posting command=%#v response=%#v", f.commands, r)
			}
			if f.reads != 0 || f.writes != 1 {
				t.Fatal("posting did not use one transaction")
			}
			f.commands = nil
			v, e = call(t, s, actor(t, erpwire.Accountant, otherOrg), "journal/actions.ts", test.name, test.arg)
			want := map[string]string{"postIssuedSalesInvoice": invoiceError, "postIssuedCreditNote": creditError, "postCashReceipt": receiptError}[test.name]
			expectError(t, v, e, want)
			if len(f.commands) > 0 {
				t.Fatal("posted another tenant's document")
			}
		})
	}
}

func TestIntegerJSONSpellingsRemainExact(t *testing.T) {
	for _, test := range []struct {
		literal string
		valid   bool
		want    int64
	}{{"1.0", true, 1}, {"1e3", true, 1000}, {"1e-3", false, 0}, {"9007199254740991.0", true, int64(money.MaxSafeSatang)}, {"9007199254740992", false, 0}, {"1e999999999999", false, 0}, {"0e999999999999", true, 0}} {
		t.Run(test.literal, func(t *testing.T) {
			n, e := satang(json.Number(test.literal))
			if (e == nil) != test.valid || test.valid && n != money.Satang(test.want) {
				t.Fatalf("satang(%s)=%d %v", test.literal, n, e)
			}
		})
	}
	f := newFake(t)
	fakeChart(f)
	s := service(t, f)
	for _, literal := range []string{"1.0", "1e3"} {
		raw := json.RawMessage(`[{"entryDate":"2026-10-01","memo":"exact","lines":[{"accountCode":"1110","debitSatang":` + literal + `,"creditSatang":0},{"accountCode":"4100","debitSatang":0,"creditSatang":` + literal + `}]}]`)
		v, e := s.Operations()["app/(app)/finance/journal/actions.ts::postDraftJournal"](context.Background(), actor(t, erpwire.Accountant, orgID), raw)
		r := action(t, v, e)
		if object(r.Value)["error"] != nil {
			t.Fatalf("integer JSON refused: %#v", r)
		}
	}
}

func TestCreditSnapshotNumericValidationMessages(t *testing.T) {
	for _, test := range []struct {
		key   string
		value any
		want  string
	}{{"baseSatang", json.Number("10000.5"), amountError}, {"vatSatang", json.Number("700.5"), amountError}, {"totalSatang", json.Number("10700.5"), amountError}, {"whtSatang", json.Number("0.5"), "Withholding is not posted from the credit note."}, {"whtRateBps", json.Number("0.5"), "Withholding is not posted from the credit note."}, {"baseSatang", "10000", "The issued snapshot does not match the credit note."}} {
		t.Run(test.key+stringify(test.value), func(t *testing.T) {
			note := creditFixture()
			object(object(note["snapshot"])["document"])[test.key] = test.value
			_, e := creditJournal(note, creditContext{Invoice: saleFixture(), Posted: true, Lock: "2026-10-31", Accounts: testAccounts})
			if e == nil || e.Error() != test.want {
				t.Fatalf("got %v want %s", e, test.want)
			}
		})
	}
}

func TestDepositOperationDispatchAndHeldBase(t *testing.T) {
	for _, final := range []bool{false, true} {
		t.Run(stringify(final), func(t *testing.T) {
			f := newFake(t)
			fakeChart(f)
			inv := saleFixture()
			inv["source_quote_id"] = thirdID
			wantCommand := "post_deposit_invoice"
			if !final {
				inv["quote_invoice_kind"] = "deposit"
				inv["quote_deposit_satang"] = int64(2500)
				setSaleAmounts(inv, 2500, 0, 2500, 175, 2675, 700)
			} else {
				wantCommand = "post_final_with_deposit"
				inv["quote_deposit_deduction_satang"] = int64(2500)
				setSaleAmounts(inv, 10000, 2500, 7500, 525, 8025, 700)
				f.add("invoices", erpwire.Row{"id": otherID, "source_quote_id": thirdID, "quote_invoice_kind": "deposit", "status": "sent"})
				f.add("journal_entries", erpwire.Row{"id": otherID, "source_invoice_id": otherID})
				f.add("journal_lines", erpwire.Row{"entry_id": otherID, "line_no": int64(1), "account_code": "2120", "credit_satang": int64(2500)})
			}
			f.add("invoices", inv)
			f.add("invoice_snapshots", erpwire.Row{"id": otherID, "snapshot": saleSnapshot(inv)})
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Accountant, orgID), "journal/actions.ts", "postIssuedSalesInvoice", recordID)
			r := action(t, v, e)
			if object(r.Value)["error"] != nil || len(f.commands) != 1 || f.commands[0].Name != wantCommand || !reflect.DeepEqual(f.commands[0].Args, erpwire.Row{"p_org_id": orgID, "p_invoice_id": recordID}) {
				t.Fatalf("deposit op %#v %#v", r, f.commands)
			}
			if final {
				f.commands = nil
				f.tables["journal_lines"][0]["credit_satang"] = int64(2499)
				v, e = call(t, s, actor(t, erpwire.Accountant, orgID), "journal/actions.ts", "postIssuedSalesInvoice", recordID)
				expectError(t, v, e, "This final invoice does not apply the whole posted deposit.")
				if len(f.commands) != 0 {
					t.Fatal("partial held deposit posted")
				}
			}
		})
	}
}

func TestPostedFollowOnAggregatesRejectUnsafeTotals(t *testing.T) {
	for _, key := range []string{"baseSatang", "vatSatang", "totalSatang"} {
		notes := []erpwire.Row{{"id": recordID, "snapshot": erpwire.Row{"document": erpwire.Row{key: int64(money.MaxSafeSatang)}}}, {"id": otherID, "snapshot": erpwire.Row{"document": erpwire.Row{key: int64(1)}}}}
		_, _, _, e := postedCreditTotals(notes, map[string]erpwire.Row{recordID: {}, otherID: {}})
		if e == nil || e.Error() != amountError {
			t.Fatalf("aggregate %s: %v", key, e)
		}
	}
	_, e := postedReceipts([]erpwire.Row{{"payment_id": recordID, "amount_satang": int64(money.MaxSafeSatang)}, {"payment_id": otherID, "amount_satang": int64(1)}}, map[string]erpwire.Row{recordID: {}, otherID: {}})
	if e == nil || e.Error() != amountError {
		t.Fatalf("receipt aggregate: %v", e)
	}
}
