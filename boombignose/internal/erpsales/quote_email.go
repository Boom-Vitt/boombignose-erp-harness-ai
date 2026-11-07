package erpsales

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func salesEscape(v string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(v)
}
func salesFormatTHB(v money.Satang) string {
	amount := money.FormatBaht(v)
	sign := ""
	if strings.HasPrefix(amount, "-") {
		sign = "-"
		amount = amount[1:]
	}
	whole, fraction, _ := strings.Cut(amount, ".")
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return sign + "฿" + whole + "." + fraction
}
func salesQuoteEmail(number, client string, total money.Satang, url, validUntil string) string {
	greeting := "Hello,"
	if client != "" {
		greeting = "Dear " + salesEscape(client) + ","
	}
	valid := ""
	if validUntil != "" {
		valid = `<p>This quote is valid until <strong>` + salesEscape(validUntil) + `</strong>.</p>`
	}
	return `<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.5;">` + `<p>` + greeting + `</p><p>Please find quote <strong>` + salesEscape(number) + `</strong> for <strong>` + salesEscape(salesFormatTHB(total)) + `</strong>.</p>` + valid + `<p style="margin: 20px 0;"><a href="` + salesEscape(url) + `" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">View quote PDF</a></p><p>We look forward to working with you.</p><p style="color: #888; font-size: 12px; margin-top: 24px;">Sent from BoomBigNose ERP.</p></div>`
}
func (s *Service) sendQuoteEmail(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	if e != nil {
		return nil, e
	}
	var quote, contact erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		quote, e = one(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"id", "number", "total_satang", "valid_until", "client_id"}, Relations: []erpwire.Relation{salesClientRelation()}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if quote == nil {
			return businessError("Quote not found")
		}
		contact, e = one(ctx, tx, erpwire.Select{Table: "contacts", Columns: []string{"email", "name"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("client_id", quote["client_id"]), {Column: "email", Op: erpwire.NotEqual, Value: nil}}, Order: ordered("created_at", "id")})
		return e
	})
	if e != nil {
		return failure(e)
	}
	to := text(contact["email"])
	if to == "" {
		return invalid("No client email on file. Add a contact with an email to this client first.")
	}
	if s.mail == nil || !s.mail.Configured() {
		return erpwire.ActionResponse{Value: erpwire.Row{"ok": false, "reason": "not_configured"}}, nil
	}
	total, e := satang(quote["total_satang"])
	if e != nil {
		return nil, e
	}
	number := text(quote["number"])
	result, e := s.mail.SendEmail(ctx, EmailMessage{To: to, Subject: "Quote " + number, HTML: salesQuoteEmail(number, text(salesRelation(quote, "clients")["name"]), total, s.appURL+"/quotes/"+text(quote["id"])+"/pdf", text(quote["valid_until"]))})
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
	s.audit(ctx, a, "quote", text(quote["id"]), "emailed", "Emailed quote "+number+" to "+to, erpwire.Row{"to": to, "total_satang": total})
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "activities", Rows: []erpwire.Row{{"org_id": a.OrgID(), "client_id": quote["client_id"], "type": "email", "owner": a.UserID(), "body": "Sent quote " + number + " (" + salesFormatTHB(total) + ") to " + to}}})
		return e
	})
	return erpwire.ActionResponse{Value: erpwire.Row{"ok": true}}, nil
}
