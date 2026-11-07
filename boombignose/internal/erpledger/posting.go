package erpledger

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var saleColumns = []string{"status", "quote_invoice_kind", "quote_deposit_satang", "quote_deposit_deduction_satang", "quote_discount_satang", "source_quote_id", "issue_date", "number", "prices_include_vat", "subtotal_satang", "discount_satang", "vat_satang", "total_satang", "wht_satang", "wht_rate_bps", "amount_satang", "tax_breakdown", "issued_snapshot_id"}

func (s *Service) postIssuedSalesInvoice(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "profit:view", journalDenied); e != nil {
		return failure(e, "")
	}
	id, e := stringInput(raw)
	if e != nil {
		return nil, e
	}
	command := "post_issued_sales_invoice"
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		inv, e := record(ctx, tx, a, "invoices", id, saleColumns...)
		if e != nil || inv == nil {
			return readFailure(e, invoiceError)
		}
		setting, e := settings(ctx, tx, a, "lock_date")
		if e != nil {
			return readFailure(e, invoiceError)
		}
		accounts, e := chart(ctx, tx, a)
		if e != nil {
			return readFailure(e, invoiceError)
		}
		snapshot := erpwire.Row{}
		if sid := text(inv["issued_snapshot_id"]); sid != "" {
			row, e := record(ctx, tx, a, "invoice_snapshots", sid, "snapshot")
			if e != nil {
				return readFailure(e, invoiceError)
			}
			snapshot = object(row["snapshot"])
		}
		lock := text(setting["lock_date"])
		if text(inv["quote_invoice_kind"]) == "deposit" {
			command = "post_deposit_invoice"
			_, e = depositSale(inv, snapshot, lock, accounts)
		} else if deduction, _ := satang(inv["quote_deposit_deduction_satang"]); deduction > 0 {
			command = "post_final_with_deposit"
			const unavailable = "This final invoice does not apply the whole posted deposit."
			deposits := []erpwire.Row{}
			if quote := text(inv["source_quote_id"]); quote != "" {
				deposits, e = rows(ctx, tx, a, "invoices", []string{"id"}, eq("source_quote_id", quote), eq("quote_invoice_kind", "deposit"), erpwire.Predicate{Column: "status", Op: erpwire.NotEqual, Value: "cancelled"})
				if e != nil {
					return readFailure(e, unavailable)
				}
			}
			depositIDs := ids(deposits, "id")
			posted := []erpwire.Row{}
			if len(depositIDs) > 0 {
				posted, e = rows(ctx, tx, a, "journal_entries", []string{"id", "source_invoice_id"}, in("source_invoice_id", depositIDs))
				if e != nil {
					return readFailure(e, unavailable)
				}
			}
			postedIDs := keyed(posted, "source_invoice_id")
			unposted := false
			for _, id := range depositIDs {
				if postedIDs[id] == nil {
					unposted = true
				}
			}
			var held money.Satang
			if len(posted) > 0 {
				lines, e := rows(ctx, tx, a, "journal_lines", []string{"credit_satang"}, eq("account_code", "2120"), in("entry_id", ids(posted, "id")))
				if e != nil {
					return readFailure(e, unavailable)
				}
				for _, line := range lines {
					v, e := satang(line["credit_satang"])
					if e != nil {
						return businessError(amountError)
					}
					held, e = sum(held, v)
					if e != nil {
						return e
					}
				}
			}
			notes := []erpwire.Row{}
			if len(depositIDs) > 0 {
				notes, e = rows(ctx, tx, a, "credit_notes", []string{"id"}, in("invoice_id", depositIDs))
				if e != nil {
					return readFailure(e, "A credit note on a deposit invoice is not applied.")
				}
			}
			_, e = finalSale(inv, snapshot, lock, accounts, held, unposted, len(notes) > 0)
		} else {
			_, e = plainSale(inv, snapshot, lock, accounts)
		}
		if e != nil {
			return e
		}
		_, e = tx.Command(ctx, command, erpwire.Row{"p_org_id": a.OrgID(), "p_invoice_id": id})
		return e
	})
	if e != nil {
		return failure(e, invoiceError)
	}
	return success("/finance/invoices/"+id, "/finance/journal", "/finance/journal/trial-balance", "/audit/close")
}

// Preserve authorization failures even when source queries show a domain fallback.
func readFailure(e error, message string) error {
	var business businessError
	if errors.As(e, &business) {
		return e
	}
	if e != nil {
		for _, auth := range []error{erpwire.ErrForbidden, erpwire.ErrUnauthenticated, erpwire.ErrIdentityChanged, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, context.Canceled, context.DeadlineExceeded} {
			if errors.Is(e, auth) {
				return e
			}
		}
	}
	return businessError(message)
}

func documentMoney(snapshot any, key string) money.Satang {
	doc := object(object(snapshot)["document"])
	v, e := satang(doc[key])
	if e != nil {
		return 0
	}
	return v
}
func postedRows(ctx context.Context, tx selector, a erpwire.Actor, source string, sourceIDs []string) (map[string]erpwire.Row, error) {
	if len(sourceIDs) == 0 {
		return map[string]erpwire.Row{}, nil
	}
	r, e := rows(ctx, tx, a, "journal_entries", []string{source}, in(source, sourceIDs))
	return keyed(r, source), e
}
func postedCreditTotals(notes []erpwire.Row, posted map[string]erpwire.Row) (money.Satang, money.Satang, money.Satang, error) {
	var base, vat, total money.Satang
	for _, r := range notes {
		if posted[text(r["id"])] == nil {
			continue
		}
		var e error
		base, e = sum(base, documentMoney(r["snapshot"], "baseSatang"))
		if e != nil {
			return 0, 0, 0, businessError(amountError)
		}
		vat, e = sum(vat, documentMoney(r["snapshot"], "vatSatang"))
		if e != nil {
			return 0, 0, 0, businessError(amountError)
		}
		total, e = sum(total, documentMoney(r["snapshot"], "totalSatang"))
		if e != nil {
			return 0, 0, 0, businessError(amountError)
		}
	}
	return base, vat, total, nil
}
func postedReceipts(allocations []erpwire.Row, posted map[string]erpwire.Row) (money.Satang, error) {
	var total money.Satang
	for _, r := range allocations {
		v, e := satang(r["amount_satang"])
		if e != nil {
			return 0, e
		}
		if v > 0 && posted[text(r["payment_id"])] != nil {
			total, e = sum(total, v)
			if e != nil {
				return 0, businessError(amountError)
			}
		}
	}
	return total, nil
}

type creditContext struct {
	Invoice                    erpwire.Row
	Posted                     bool
	Base, VAT, Total, Receipts money.Satang
	Lock                       string
	Accounts                   []string
}

func creditJournal(note erpwire.Row, c creditContext) (journalPosting, error) {
	p := journalPosting{Date: text(note["issue_date"]), Memo: "Issued credit note " + text(note["number"])}
	snapshot := object(note["snapshot"])
	if snapshot == nil || text(snapshot["kind"]) != "credit_note" {
		return p, businessError(creditError)
	}
	if !c.Posted {
		return p, businessError("Post the sales invoice before this credit note.")
	}
	doc := object(snapshot["document"])
	const mismatch = "The issued snapshot does not match the credit note."
	amount, e := whole(doc["amountDueSatang"])
	rowAmount, f := whole(note["amount_satang"])
	inclusive, ok := doc["pricesIncludeVat"].(bool)
	_, ok2 := buckets(doc["vatByRate"])
	if doc == nil || doc["number"] != note["number"] || doc["issueDate"] != note["issue_date"] || e != nil || f != nil || amount != rowAmount || !ok || !ok2 {
		return p, businessError(mismatch)
	}
	for _, key := range []string{"baseSatang", "vatSatang", "totalSatang", "whtSatang", "whtRateBps"} {
		switch doc[key].(type) {
		case int, int32, int64, json.Number:
		default:
			return p, businessError(mismatch)
		}
	}
	wht, e := whole(doc["whtSatang"])
	rate, f := whole(doc["whtRateBps"])
	if e != nil || f != nil || wht != 0 || rate != 0 {
		return p, businessError("Withholding is not posted from the credit note.")
	}
	if inclusive != (c.Invoice["prices_include_vat"] == true) {
		return p, businessError("The credit note VAT treatment does not match the invoice.")
	}
	if !validDate(p.Date) {
		return p, businessError(mismatch)
	}
	if e = journalDate(p.Date, c.Lock); e != nil {
		return p, e
	}
	base, e := nonnegative(doc["baseSatang"])
	if e != nil {
		return p, businessError(amountError)
	}
	vat, e := nonnegative(doc["vatSatang"])
	if e != nil {
		return p, businessError(amountError)
	}
	total, e := nonnegative(doc["totalSatang"])
	if e != nil {
		return p, businessError(amountError)
	}
	invoiceTotal, e := nonnegative(c.Invoice["total_satang"])
	if e != nil {
		return p, businessError(amountError)
	}
	invoiceVAT, e := nonnegative(c.Invoice["vat_satang"])
	if e != nil || invoiceVAT > invoiceTotal || c.Base < 0 || c.VAT < 0 || c.Total < 0 || c.Receipts < 0 {
		return p, businessError(amountError)
	}
	bucketBase, bucketVAT, e := vatTotals(doc["vatByRate"], inclusive)
	if e != nil {
		return p, e
	}
	if base != bucketBase || vat != bucketVAT || base+vat != total || money.Satang(amount) != total || total <= 0 {
		return p, businessError(totalsError)
	}
	if base > invoiceTotal-invoiceVAT-c.Base || vat > invoiceVAT-c.VAT || total > invoiceTotal-c.Total {
		return p, businessError("This credit is larger than the sale still posted.")
	}
	if total > invoiceTotal-c.Total-c.Receipts {
		return p, businessError("This credit is larger than the receivable still posted.")
	}
	p.Lines = []JournalLine{}
	if base > 0 {
		p.Lines = append(p.Lines, JournalLine{"4100", base, 0})
	}
	if vat > 0 {
		p.Lines = append(p.Lines, JournalLine{"2130", vat, 0})
	}
	p.Lines = append(p.Lines, JournalLine{"1130", 0, total})
	if length(p.Memo) > 200 {
		return p, businessError("Enter a journal memo.")
	}
	_, e = journalLines(p.Lines, c.Accounts)
	return p, e
}
func (s *Service) postIssuedCreditNote(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "profit:view", journalDenied); e != nil {
		return failure(e, "")
	}
	id, e := stringInput(raw)
	if e != nil {
		return nil, e
	}
	var invoiceID string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		note, e := record(ctx, tx, a, "credit_notes", id, "id", "invoice_id", "number", "issue_date", "amount_satang", "snapshot")
		if e != nil || note == nil {
			return readFailure(e, creditError)
		}
		invoiceID = text(note["invoice_id"])
		inv, e := record(ctx, tx, a, "invoices", invoiceID, "prices_include_vat", "vat_satang", "total_satang")
		if e != nil || inv == nil {
			return readFailure(e, creditError)
		}
		setting, e := settings(ctx, tx, a, "lock_date")
		if e != nil {
			return readFailure(e, creditError)
		}
		accounts, e := chart(ctx, tx, a)
		if e != nil {
			return readFailure(e, creditError)
		}
		notes, e := rows(ctx, tx, a, "credit_notes", []string{"id", "snapshot"}, eq("invoice_id", invoiceID))
		if e != nil {
			return readFailure(e, creditError)
		}
		invoicePost, e := postedRows(ctx, tx, a, "source_invoice_id", []string{invoiceID})
		if e != nil {
			return readFailure(e, creditError)
		}
		allocations, e := rows(ctx, tx, a, "payment_allocations", []string{"payment_id", "amount_satang"}, eq("invoice_id", invoiceID))
		if e != nil {
			return readFailure(e, creditError)
		}
		postedNotes, e := postedRows(ctx, tx, a, "source_credit_note_id", ids(notes, "id"))
		if e != nil {
			return readFailure(e, creditError)
		}
		postedPayments, e := postedRows(ctx, tx, a, "source_payment_id", ids(allocations, "payment_id"))
		if e != nil {
			return readFailure(e, creditError)
		}
		base, vat, total, e := postedCreditTotals(notes, postedNotes)
		if e != nil {
			return e
		}
		receipts, e := postedReceipts(allocations, postedPayments)
		if e != nil {
			return e
		}
		_, e = creditJournal(note, creditContext{inv, invoicePost[invoiceID] != nil, base, vat, total, receipts, text(setting["lock_date"]), accounts})
		if e != nil {
			return e
		}
		_, e = tx.Command(ctx, "post_issued_credit_note", erpwire.Row{"p_org_id": a.OrgID(), "p_credit_note_id": id})
		return e
	})
	if e != nil {
		return failure(e, creditError)
	}
	return success("/finance/invoices/"+invoiceID, "/finance/journal", "/finance/journal/trial-balance", "/audit/close")
}

type receiptInvoice struct {
	Posted                        bool
	WHT, Total, Credits, Receipts money.Satang
}

func receiptJournal(payment erpwire.Row, allocations []erpwire.Row, invoices map[string]receiptInvoice, lock string, accounts []string) (journalPosting, error) {
	p := journalPosting{Date: dateOnly(text(payment["paid_at"]))}
	amount, e := nonnegative(payment["amount_satang"])
	if text(payment["verification_state"]) != "verified" || text(payment["reversal_of"]) != "" || text(payment["refund_of"]) != "" || e != nil || amount <= 0 {
		return p, businessError(receiptError)
	}
	account, label := "1120", "Bank"
	switch text(payment["method"]) {
	case "cash":
		account, label = "1110", "Cash"
	case "transfer", "promptpay", "card", "cheque":
	default:
		return p, businessError("This receipt method is not posted.")
	}
	if e = journalDate(p.Date, lock); e != nil {
		return p, e
	}
	const unallocated = "This receipt is not fully allocated to posted invoices."
	if len(allocations) == 0 {
		return p, businessError(unallocated)
	}
	var total money.Satang
	byInvoice := map[string]money.Satang{}
	invoiceIDs := []string{}
	for _, r := range allocations {
		id := text(r["invoice_id"])
		v, e := nonnegative(r["amount_satang"])
		if id == "" || e != nil || v <= 0 {
			return p, businessError(unallocated)
		}
		total, e = sum(total, v)
		if e != nil {
			return p, businessError(amountError)
		}
		byInvoice[id], e = sum(byInvoice[id], v)
		if e != nil {
			return p, businessError(amountError)
		}
		if !has(invoiceIDs, id) {
			invoiceIDs = append(invoiceIDs, id)
		}
	}
	if total != amount {
		return p, businessError(unallocated)
	}
	for _, id := range invoiceIDs {
		invoice, ok := invoices[id]
		if !ok || !invoice.Posted {
			return p, businessError("Post the sales invoice before this receipt.")
		}
		if invoice.WHT != 0 {
			return p, businessError("Withholding is not posted from the receipt.")
		}
		for _, v := range []money.Satang{invoice.Total, invoice.Credits, invoice.Receipts} {
			if v < 0 || v > money.MaxSafeSatang {
				return p, businessError(amountError)
			}
		}
		if byInvoice[id] > invoice.Total-invoice.Credits-invoice.Receipts {
			return p, businessError("This receipt is larger than the receivable still posted.")
		}
	}
	if !has(accounts, account) || !has(accounts, "1130") {
		return p, businessError(chartError)
	}
	reference := trim(text(payment["notes"]))
	if reference == "" {
		reference = trim(text(payment["verification_reference"]))
	}
	p.Memo = label + " receipt " + p.Date
	if reference != "" {
		p.Memo += " " + reference
	}
	if length(p.Memo) > 200 {
		return p, businessError("Enter a journal memo.")
	}
	p.Lines = []JournalLine{{account, amount, 0}, {"1130", 0, amount}}
	_, e = journalLines(p.Lines, accounts)
	return p, e
}
func (s *Service) postCashReceipt(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "profit:view", journalDenied); e != nil {
		return failure(e, "")
	}
	id, e := stringInput(raw)
	if e != nil {
		return nil, e
	}
	invoiceIDs := []string{}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		payment, e := record(ctx, tx, a, "payments", id, "id", "amount_satang", "paid_at", "method", "verification_state", "reversal_of", "refund_of", "notes", "verification_reference")
		if e != nil || payment == nil {
			return readFailure(e, receiptError)
		}
		setting, e := settings(ctx, tx, a, "lock_date")
		if e != nil {
			return readFailure(e, receiptError)
		}
		accounts, e := chart(ctx, tx, a)
		if e != nil {
			return readFailure(e, receiptError)
		}
		allocations, e := rows(ctx, tx, a, "payment_allocations", []string{"invoice_id", "amount_satang"}, eq("payment_id", id))
		if e != nil {
			return readFailure(e, receiptError)
		}
		invoiceIDs = ids(allocations, "invoice_id")
		known := map[string]receiptInvoice{}
		if len(invoiceIDs) > 0 {
			invoices, e := rows(ctx, tx, a, "invoices", []string{"id", "wht_satang", "total_satang"}, in("id", invoiceIDs))
			if e != nil {
				return readFailure(e, receiptError)
			}
			postedInvoices, e := postedRows(ctx, tx, a, "source_invoice_id", invoiceIDs)
			if e != nil {
				return readFailure(e, receiptError)
			}
			related, e := rows(ctx, tx, a, "payment_allocations", []string{"invoice_id", "payment_id", "amount_satang"}, in("invoice_id", invoiceIDs))
			if e != nil {
				return readFailure(e, receiptError)
			}
			notes, e := rows(ctx, tx, a, "credit_notes", []string{"id", "invoice_id", "snapshot"}, in("invoice_id", invoiceIDs))
			if e != nil {
				return readFailure(e, receiptError)
			}
			postedPayments, e := postedRows(ctx, tx, a, "source_payment_id", ids(related, "payment_id"))
			if e != nil {
				return readFailure(e, receiptError)
			}
			postedNotes, e := postedRows(ctx, tx, a, "source_credit_note_id", ids(notes, "id"))
			if e != nil {
				return readFailure(e, receiptError)
			}
			for _, inv := range invoices {
				iid := text(inv["id"])
				wht, e := satang(inv["wht_satang"])
				if e != nil {
					return e
				}
				total, e := satang(inv["total_satang"])
				if e != nil {
					return e
				}
				invoiceNotes := filterRows(notes, "invoice_id", iid)
				_, _, credits, e := postedCreditTotals(invoiceNotes, postedNotes)
				if e != nil {
					return e
				}
				receipts, e := postedReceipts(filterRows(related, "invoice_id", iid), postedPayments)
				if e != nil {
					return e
				}
				known[iid] = receiptInvoice{postedInvoices[iid] != nil, wht, total, credits, receipts}
			}
		}
		if _, e = receiptJournal(payment, allocations, known, text(setting["lock_date"]), accounts); e != nil {
			return e
		}
		_, e = tx.Command(ctx, "post_cash_receipt", erpwire.Row{"p_org_id": a.OrgID(), "p_payment_id": id})
		return e
	})
	if e != nil {
		return failure(e, receiptError)
	}
	paths := []string{"/finance/journal", "/finance/journal/trial-balance", "/audit/close"}
	for _, id := range invoiceIDs {
		paths = append(paths, "/finance/invoices/"+id)
	}
	return success(paths...)
}
func filterRows(rows []erpwire.Row, key, value string) []erpwire.Row {
	out := []erpwire.Row{}
	for _, r := range rows {
		if text(r[key]) == value {
			out = append(out, r)
		}
	}
	return out
}
