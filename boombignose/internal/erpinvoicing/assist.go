package erpinvoicing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

// ErrTextNotConfigured lets an injected model adapter preserve the source fallback.
var ErrTextNotConfigured = errors.New("text generation not configured")

type CloseOpenItems struct {
	AsOf                    string       `json:"asOf"`
	OverdueReceivableCount  int          `json:"overdueReceivableCount"`
	OverdueReceivableSatang money.Satang `json:"overdueReceivableSatang"`
	UnpaidBillCount         int          `json:"unpaidBillCount"`
	UnpaidBillSatang        money.Satang `json:"unpaidBillSatang"`
	UnmatchedBankCount      *int         `json:"unmatchedBankCount"`
}

func closeCounts(today string, invoices, costs []erpwire.Row, balances map[string]erpwire.Row, bank []erpwire.Row) (CloseOpenItems, error) {
	c := CloseOpenItems{AsOf: today}
	for _, r := range invoices {
		v, e := amount(r["amount_satang"])
		if e != nil {
			return c, e
		}
		paid, credited := money.Satang(0), money.Satang(0)
		if b := balances[text(r["id"])]; b != nil {
			paid, e = amount(b["paid_satang"])
			if e != nil {
				return c, e
			}
			credited, e = amount(b["credited_satang"])
			if e != nil {
				return c, e
			}
		}
		if status(r, paid, credited, today) != "overdue" {
			continue
		}
		owed := outstanding(v, paid, credited)
		if owed > 0 {
			c.OverdueReceivableCount++
			c.OverdueReceivableSatang, e = sum(c.OverdueReceivableSatang, owed)
			if e != nil {
				return c, e
			}
		}
	}
	for _, r := range costs {
		v, e := amount(r["amount_satang"])
		if e != nil {
			return c, e
		}
		if text(r["vendor_id"]) != "" && r["paid_at"] == nil && v > 0 {
			c.UnpaidBillCount++
			c.UnpaidBillSatang, e = sum(c.UnpaidBillSatang, v)
			if e != nil {
				return c, e
			}
		}
	}
	if bank != nil {
		n := 0
		for _, r := range bank {
			if r["matched_payment_id"] == nil {
				n++
			}
		}
		c.UnmatchedBankCount = &n
	}
	return c, nil
}

func closePrompt(c CloseOpenItems) (string, string) {
	system := "You are a bookkeeping assistant for a Thai SME. Write a short month-end note from the counts you are given. Start in polite Thai, then one English sentence. Use only those figures. Do not invent invoices, journals, VAT filings, or e-Tax steps. Keep it under 120 words. This is operational finance, not a statutory close."
	date := c.AsOf
	if d, e := time.Parse("2006-01-02", date); e == nil {
		date = fmt.Sprintf("%s (%02d/%02d/%04d)", date, d.Day(), d.Month(), d.Year()+543)
	}
	bank := "Unmatched bank lines: not available"
	if c.UnmatchedBankCount != nil {
		bank = fmt.Sprintf("Unmatched bank lines: %d", *c.UnmatchedBankCount)
	}
	prompt := fmt.Sprintf("As of %s. Amounts are Thai baht (THB).\nOverdue receivables: %d (%s).\nUnpaid vendor bills: %d (%s).\n%s.\nTell the owner what to clear before they treat the month as ready. Do not tell them to file a tax return. Do not call these figures a ภ.พ.30 filing.", date, c.OverdueReceivableCount, formatTHB(c.OverdueReceivableSatang, false), c.UnpaidBillCount, formatTHB(c.UnpaidBillSatang, false), bank)
	return system, prompt
}

func (s *Service) summarizeMonthEnd(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var invoices, costs, bank []erpwire.Row
	balances := map[string]erpwire.Row{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		invoices, e = all(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "status", "amount_satang", "due_date"}, Where: scope(a), Order: ordered("id")})
		if e != nil {
			return e
		}
		costs, e = all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"id", "vendor_id", "paid_at", "amount_satang"}, Where: scope(a), Order: ordered("id")})
		return e
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return erpwire.Row{"error": "Could not read open items."}, nil
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		rows, e := all(ctx, tx, erpwire.Select{Table: "invoice_balances", Columns: []string{"invoice_id", "paid_satang", "credited_satang", "outstanding_satang"}, Where: scope(a), Order: ordered("invoice_id")})
		if e != nil {
			return e
		}
		for _, r := range rows {
			balances[text(r["invoice_id"])] = r
		}
		return nil
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return erpwire.Row{"error": "Could not read invoice balances."}, nil
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		bank, e = all(ctx, tx, erpwire.Select{Table: "bank_lines", Columns: []string{"id", "matched_payment_id"}, Where: scope(a), Order: ordered("id")})
		return e
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		bank = nil
	}
	counts, e := closeCounts(s.today(), invoices, costs, balances, bank)
	if e != nil {
		return erpwire.Row{"error": "Could not read open items."}, nil
	}
	out := erpwire.Row{"counts": counts}
	if s.generator == nil {
		out["notConfigured"] = true
		return out, nil
	}
	system, prompt := closePrompt(counts)
	content, e := s.generator.GenerateText(ctx, system, prompt, 400)
	content = visibleReply(content)
	if e == nil && content == "" {
		e = errors.New("Ollama returned no text")
	}
	if errors.Is(e, ErrTextNotConfigured) {
		out["notConfigured"] = true
	} else if e != nil {
		out["error"] = "Ollama ไม่ได้ส่งบันทึกกลับมา ตัวเลขด้านบนยังมาจากเวิร์กสเปซนี้ / Ollama returned no note. The counts above are still from this workspace."
	} else {
		out["content"] = content
	}
	return out, nil
}

var thinkBlock = regexp.MustCompile(`(?is)<think>.*?</think>`)
var thinkClose = regexp.MustCompile(`(?is)^.*</think>`)
var thinkOpen = regexp.MustCompile(`(?is)<think>.*$`)
var replyParagraphs = regexp.MustCompile(`\n\s*\n`)
var reasoningOpener = regexp.MustCompile(`(?i)^(okay|ok|alright|hmm+|wait|let me|let's|first,? (i|the|let)|the user (wants|is asking|asked|provided|says)|i need to|i should|so,? the user)\b`)

func visibleReply(content string) string {
	content = trim(thinkOpen.ReplaceAllString(thinkClose.ReplaceAllString(thinkBlock.ReplaceAllString(content, " "), " "), " "))
	paragraphs := replyParagraphs.Split(content, -1)
	for len(paragraphs) > 0 && reasoningOpener.MatchString(trim(paragraphs[0])) {
		paragraphs = paragraphs[1:]
	}
	answer := trim(strings.Join(paragraphs, "\n\n"))
	units := utf16.Encode([]rune(answer))
	if len(units) > 8000 {
		answer = string(utf16.Decode(units[:8000]))
	}
	return answer
}

func escapeHTML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(s)
}
func invoiceEmailHTML(r erpwire.Row, client string, n money.Satang, pdfURL string) string {
	greeting := "Hello,"
	if client != "" {
		greeting = "Dear " + escapeHTML(client) + ","
	}
	due := ""
	if date := text(r["due_date"]); date != "" {
		due = "<p>Payment is due by <strong>" + escapeHTML(date) + "</strong>.</p>"
	}
	return `<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.5;">` +
		"<p>" + greeting + "</p><p>Please find invoice <strong>" + escapeHTML(text(r["number"])) + "</strong> for <strong>" + escapeHTML(formatTHB(n, false)) + "</strong>.</p>" + due +
		`<p style="margin: 20px 0;"><a href="` + escapeHTML(pdfURL) + `" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">View invoice PDF</a></p>` +
		`<p>Thank you for your business.</p><p style="color: #888; font-size: 12px; margin-top: 24px;">Sent from BoomBigNose ERP.</p></div>`
}

func (s *Service) sendInvoiceEmail(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var id string
	if args.Decode(0, &id) != nil {
		return nil, erpwire.ErrBadArguments
	}
	var invoice, contact erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		invoice, e = one(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "number", "amount_satang", "due_date", "client_id"}, Relations: []erpwire.Relation{invoiceClientRelation(false)}, Where: scoped(a, id)})
		return e
	})
	if e != nil && canonical(e) {
		return nil, e
	}
	if invoice == nil {
		return erpwire.ActionResponse{Value: erpwire.Row{"error": "Invoice not found"}}, nil
	}
	// A failed contact lookup has the source's missing-contact result.
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		contact, e = one(ctx, tx, erpwire.Select{Table: "contacts", Columns: []string{"email", "name"}, Where: append(scope(a), eq("client_id", invoice["client_id"]), erpwire.Predicate{Column: "email", Op: erpwire.NotEqual, Value: nil}), Order: ordered("created_at", "id")})
		return e
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		contact = nil
	}
	to := text(contact["email"])
	if to == "" {
		return invalid("No client email on file. Add a contact with an email to this client first.")
	}
	if s.emailer == nil {
		return erpwire.ActionResponse{Value: erpwire.Row{"ok": false, "reason": "not_configured"}}, nil
	}
	n, e := amount(invoice["amount_satang"])
	if e != nil {
		return failure(e)
	}
	pdfURL := s.appURL + "/finance/invoices/" + text(invoice["id"]) + "/pdf"
	result, e := s.emailer.SendEmail(ctx, EmailMessage{To: to, Subject: "Invoice " + text(invoice["number"]), HTML: invoiceEmailHTML(invoice, text(object(invoice["clients"])["name"]), n, pdfURL)})
	if e != nil {
		return invalid("Failed to send email")
	}
	if !result.OK {
		if result.Reason == "not_configured" {
			return erpwire.ActionResponse{Value: erpwire.Row{"ok": false, "reason": "not_configured"}}, nil
		}
		message := result.Error
		if message == "" {
			message = "Failed to send email"
		}
		return invalid(message)
	}
	s.audit(ctx, a, "invoice", text(invoice["id"]), "emailed", "Emailed invoice "+text(invoice["number"])+" to "+to, erpwire.Row{"to": to, "amount_satang": int64(n)})
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "activities", Rows: []erpwire.Row{{"org_id": a.OrgID(), "client_id": invoice["client_id"], "type": "email", "owner": a.UserID(), "body": "Sent invoice " + text(invoice["number"]) + " (" + formatTHB(n, false) + ") to " + to}}})
		return e
	})
	return erpwire.ActionResponse{Value: erpwire.Row{"ok": true}}, nil
}
