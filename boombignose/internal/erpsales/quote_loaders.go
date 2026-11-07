package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func salesClientRelation() erpwire.Relation {
	return erpwire.Relation{Name: "clients", Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: []string{"name"}}
}
func salesRelation(row erpwire.Row, key string) erpwire.Row {
	switch v := row[key].(type) {
	case erpwire.Row:
		return v
	case map[string]any:
		return erpwire.Row(v)
	}
	return nil
}
func salesNamedOptions(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, table string) ([]erpwire.Row, error) {
	rows, e := all(ctx, tx, erpwire.Select{Table: table, Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("name", "id")})
	if e != nil {
		return nil, e
	}
	out := []erpwire.Row{}
	for _, r := range rows {
		out = append(out, erpwire.Row{"value": r["id"], "label": r["name"]})
	}
	return out, nil
}
func salesDealOptions(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, current string) ([]erpwire.Row, error) {
	rows, e := all(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "title", "client_id"}, Where: append(scope(a), erpwire.Predicate{Column: "stage", Op: erpwire.In, Value: []string{"lead", "contacted", "discovery", "proposal", "negotiation"}}), Order: ordered("title", "id")})
	if e != nil {
		return nil, e
	}
	found := false
	for _, r := range rows {
		if text(r["id"]) == current {
			found = true
		}
	}
	if current != "" && !found {
		linked, e := one(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "title", "client_id"}, Where: scoped(a, current)})
		if e != nil {
			return nil, e
		}
		if linked != nil {
			rows = append([]erpwire.Row{linked}, rows...)
		}
	}
	out := []erpwire.Row{}
	for _, r := range rows {
		out = append(out, erpwire.Row{"value": r["id"], "label": r["title"], "clientId": r["client_id"]})
	}
	return out, nil
}
func (s *Service) quoteNewPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	params, e := salesParams(args)
	if e != nil {
		return nil, e
	}
	defaults := erpwire.Row{"client_id": "", "project_id": "", "deal_id": "", "number": "", "issue_date": today(), "valid_until": "", "discountBaht": 0, "notes": ""}
	out := erpwire.Row{"defaultValues": defaults, "submitLabel": "Create quote"}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		out["clients"], e = salesNamedOptions(ctx, tx, a, "clients")
		if e != nil {
			return e
		}
		out["projects"], e = salesNamedOptions(ctx, tx, a, "projects")
		if e != nil {
			return e
		}
		deals, e := salesDealOptions(ctx, tx, a, text(params["dealId"]))
		if e != nil {
			return e
		}
		for _, d := range deals {
			if text(d["value"]) == text(params["dealId"]) {
				defaults["client_id"] = d["clientId"]
				defaults["deal_id"] = d["value"]
			}
		}
		out["deals"] = deals
		return nil
	})
	if e != nil {
		return nil, e
	}
	return out, nil
}
func salesQuoteInvoices(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor) (erpwire.BrowserMap, map[string]erpwire.Row, error) {
	rows, e := all(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "number", "status", "source_quote_id", "issued_snapshot_id"}, Where: append(scope(a), erpwire.Predicate{Column: "source_quote_id", Op: erpwire.NotEqual, Value: nil}, erpwire.Predicate{Column: "status", Op: erpwire.NotEqual, Value: "cancelled"}), Order: ordered("created_at", "id")})
	if e != nil {
		return erpwire.BrowserMap{}, nil, e
	}
	balances, e := all(ctx, tx, erpwire.Select{Table: "invoice_balances", Columns: []string{"invoice_id", "outstanding_satang"}, Where: scope(a), Order: ordered("invoice_id")})
	if e != nil {
		return erpwire.BrowserMap{}, nil, e
	}
	byID := map[string]any{}
	for _, r := range balances {
		amount, e := satang(r["outstanding_satang"])
		if e != nil {
			return erpwire.BrowserMap{}, nil, e
		}
		byID[text(r["invoice_id"])] = amount
	}
	byQuote := map[string]erpwire.Row{}
	keys := []string{}
	for _, r := range rows {
		quote := text(r["source_quote_id"])
		if quote == "" {
			continue
		}
		if _, ok := byQuote[quote]; !ok {
			keys = append(keys, quote)
		}
		balance := byID[text(r["id"])]
		if balance == nil {
			balance = money.Satang(0)
		}
		byQuote[quote] = erpwire.Row{"id": r["id"], "number": r["number"], "status": r["status"], "issued": text(r["issued_snapshot_id"]) != "", "outstandingSatang": balance}
	}
	entries := [][2]any{}
	for _, id := range keys {
		entries = append(entries, [2]any{id, byQuote[id]})
	}
	return erpwire.Map(entries), byQuote, nil
}
func (s *Service) quotesPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	params, e := salesParams(args)
	if e != nil {
		return nil, e
	}
	config := salesParseFacets(params, "quotes")
	out := erpwire.Row{"config": config, "canConvert": authorize(a, "quote:convert") == nil}
	quotes := []erpwire.Row{}
	now := time.Now()
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		rows, e := all(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"id", "number", "status", "total_satang", "valid_until", "issue_date", "client_id", "owner"}, Relations: []erpwire.Relation{salesClientRelation()}, Where: scope(a), Order: []erpwire.Order{{Column: "issue_date", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		invoices, byQuote, e := salesQuoteInvoices(ctx, tx, a)
		if e != nil {
			return e
		}
		out["invoiceByQuote"] = invoices
		settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"vat_registered"}, Where: scope(a)})
		if e != nil {
			return e
		}
		out["settings"] = settings
		vat, _ := settings["vat_registered"].(bool)
		for _, q := range rows {
			if salesMatches(config, q, text(q["number"])+" "+text(salesRelation(q, "clients")["name"]), text(q["issue_date"]), a, now) {
				q["chain"] = salesChain(text(q["status"]), byQuote[text(q["id"])], vat)
				quotes = append(quotes, q)
			}
		}
		out["savedViews"], e = salesSavedViews(ctx, tx, a, "quotes")
		return e
	})
	if e != nil {
		return nil, loadError(e, "Quotes unavailable. Please reload.")
	}
	out["quotes"] = quotes
	var key func(erpwire.Row) (string, string)
	if config.GroupBy != "" {
		key = func(r erpwire.Row) (string, string) {
			switch config.GroupBy {
			case "client":
				name := text(salesRelation(r, "clients")["name"])
				if name == "" {
					name = "Unassigned"
				}
				return text(r["client_id"]), name
			case "month":
				date := salesMonthKey(text(r["issue_date"]))
				return date, date
			default:
				s := text(r["status"])
				return s, salesFacetLabel(s)
			}
		}
	}
	out["groups"], e = salesGroups(quotes, key, "total_satang")
	return out, e
}
func salesChain(status string, invoice erpwire.Row, vat bool) erpwire.Row {
	live := invoice != nil && text(invoice["status"]) != "cancelled"
	issued, _ := invoice["issued"].(bool)
	issued = live && issued
	amount, _ := satang(invoice["outstandingSatang"])
	paid := issued && amount <= 0
	stopped := !live && (status == "declined" || status == "expired")
	done := live || status == "accepted" || status == "converted"
	pick := func(done, current bool) string {
		if done {
			return "done"
		}
		if current {
			return "current"
		}
		return "todo"
	}
	quote := pick(done, true)
	if stopped {
		quote = "stopped"
	}
	steps := []erpwire.Row{}
	if status != "" {
		steps = append(steps, erpwire.Row{"key": "quote", "th": "ใบเสนอราคา", "en": "Quotation", "state": quote})
	}
	issueTH, issueEN := "ออกเอกสาร", "Issued"
	if vat {
		issueTH, issueEN = "ออกเอกสาร + VAT", "Issued + VAT"
	}
	steps = append(steps, erpwire.Row{"key": "invoice", "th": "ใบแจ้งหนี้ (ร่าง)", "en": "Invoice draft", "state": pick(issued, done && !live || live && !issued)}, erpwire.Row{"key": "issued", "th": issueTH, "en": issueEN, "state": pick(issued, false)}, erpwire.Row{"key": "receipt", "th": "ใบเสร็จ", "en": "Receipt", "state": pick(paid, issued && !paid)})
	var next any
	command := ""
	switch {
	case stopped || paid:
	case issued:
		command = "pay"
	case live:
		command = "issue"
	case status == "accepted" || status == "converted":
		command = "convert"
	case status == "sent":
		command = "accept"
	}
	if command != "" {
		labels := map[string][2]string{"pay": {"บันทึกรับเงิน / ใบเสร็จ", "Record payment / receipt"}, "issue": {"ออกใบแจ้งหนี้", "Issue the invoice"}, "convert": {"สร้างใบแจ้งหนี้ฉบับร่าง", "Create draft invoice"}, "accept": {"อนุมัติใบเสนอราคา", "Accept the quotation"}}
		label := labels[command]
		next = erpwire.Row{"command": command, "th": label[0], "en": label[1]}
	}
	var note any
	if issued && vat {
		note = "ข้อมูล VAT พร้อมให้ตรวจ — เอกสารนี้ยังไม่ใช่ใบกำกับภาษีตามกฎหมายและยังไม่ได้ยื่นกรมสรรพากร / VAT figures ready for review. Operational document, not a statutory tax invoice and not filed."
	}
	return erpwire.Row{"steps": steps, "next": next, "vatNote": note}
}
func (s *Service) quotePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	out := erpwire.Row{"canAccept": authorize(a, "quote:convert") == nil, "canManageProducts": authorize(a, "product:manage") == nil, "recordRef": erpwire.Row{"recordType": "quote", "recordId": id}}
	var quote erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		quote, e = one(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"id", "number", "status", "issue_date", "valid_until", "accepted_at", "subtotal_satang", "discount_satang", "total_satang", "vat_satang", "tax_breakdown", "prices_include_vat", "notes", "client_id", "project_id", "deal_id"}, Relations: []erpwire.Relation{salesClientRelation()}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if quote == nil {
			return erpwire.ErrNotFound
		}
		out["quote"] = quote
		out["publicReference"], e = salesPublicReference(ctx, tx, a, "quote", id)
		if e != nil {
			return e
		}
		lines, e := all(ctx, tx, erpwire.Select{Table: "quote_items", Columns: []string{"id", "product_id", "description", "quantity", "unit", "unit_price_satang", "tax_rate_bps", "invoiced_quantity"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("quote_id", id)}, Order: ordered("position", "id")})
		if e != nil {
			return e
		}
		items := []erpwire.Row{}
		for _, line := range lines {
			qty, e := salesDecimalText(line["invoiced_quantity"])
			if e != nil {
				return e
			}
			line["extras"] = []string{qty}
			items = append(items, erpwire.Row{"id": line["id"], "description": line["description"], "quantity": line["quantity"], "invoiced_quantity": line["invoiced_quantity"]})
		}
		out["items"] = items
		sections, e := salesDocumentSections(ctx, tx, a, "quote_id", id)
		if e != nil {
			return e
		}
		out["lineRows"], e = salesGridRows(lines, sections)
		if e != nil {
			return e
		}
		out["clients"], e = salesNamedOptions(ctx, tx, a, "clients")
		if e != nil {
			return e
		}
		projects, e := all(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("name", "id")})
		if e != nil {
			return e
		}
		options := []erpwire.Row{}
		out["linkedProject"] = nil
		for _, p := range projects {
			options = append(options, erpwire.Row{"value": p["id"], "label": p["name"]})
			if text(p["id"]) == text(quote["project_id"]) {
				out["linkedProject"] = p
			}
		}
		out["projects"] = options
		invoices, e := all(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "number", "status", "quote_invoice_kind", "quote_deposit_satang", "total_satang", "issued_snapshot_id"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("source_quote_id", id)}, Order: ordered("created_at", "id")})
		if e != nil {
			return e
		}
		out["invoices"] = invoices
		settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"vat_registered", "vat_rate_bps"}, Where: scope(a)})
		if e != nil {
			return e
		}
		out["settings"] = settings
		vat, _ := settings["vat_registered"].(bool)
		out["vatRate"] = int64(0)
		if vat {
			out["vatRate"] = settings["vat_rate_bps"]
		}
		out["deliveryMilestones"], e = all(ctx, tx, erpwire.Select{Table: "milestones", Columns: []string{"id", "title", "done", "project_id"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("source_quote_id", id)}, Order: ordered("created_at", "id")})
		if e != nil {
			return e
		}
		credits, e := all(ctx, tx, erpwire.Select{Table: "credit_note_revenue", Columns: []string{"id", "invoice_id", "issue_date", "project_id", "client_name", "base_satang", "total_satang"}, Where: scope(a), Order: ordered("id")})
		if e != nil {
			return e
		}
		linked := []erpwire.Row{}
		ids := map[string]bool{}
		total := money.Satang(0)
		var latest erpwire.Row
		for _, i := range invoices {
			ids[text(i["id"])] = true
			if text(i["status"]) != "cancelled" {
				amount, e := satang(i["total_satang"])
				if e != nil {
					return e
				}
				total, e = checkedSum(total, amount)
				if e != nil {
					return e
				}
				latest = i
			}
		}
		creditTotal := money.Satang(0)
		for _, c := range credits {
			if ids[text(c["invoice_id"])] {
				linked = append(linked, c)
				amount, e := satang(c["total_satang"])
				if e != nil {
					return e
				}
				creditTotal, e = checkedSum(creditTotal, amount)
				if e != nil {
					return e
				}
			}
		}
		out["linkedCredits"] = linked
		out["invoicedTotal"], e = checkedSum(total, -creditTotal)
		if e != nil {
			return e
		}
		var live erpwire.Row
		if latest != nil {
			outstanding := latest["total_satang"]
			if text(latest["issued_snapshot_id"]) != "" {
				balance, e := one(ctx, tx, erpwire.Select{Table: "invoice_balances", Columns: []string{"outstanding_satang"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("invoice_id", latest["id"])}})
				if e != nil {
					return e
				}
				if balance != nil && balance["outstanding_satang"] != nil {
					outstanding = balance["outstanding_satang"]
				}
			}
			live = erpwire.Row{"id": latest["id"], "status": latest["status"], "issued": text(latest["issued_snapshot_id"]) != "", "outstandingSatang": outstanding}
		}
		out["liveInvoice"] = live
		chain := salesChain(text(quote["status"]), live, vat)
		out["chain"] = chain
		out["nextAnchor"] = nil
		if next, ok := chain["next"].(erpwire.Row); ok {
			if text(next["command"]) == "pay" {
				out["nextAnchor"] = "#payment-claims"
			} else if text(next["command"]) == "issue" {
				out["nextAnchor"] = "#issue-invoice"
			}
		}
		editable := quoteEditable(text(quote["status"]))
		out["editable"] = editable
		out["canConvert"] = authorize(a, "quote:convert") == nil && has([]string{"accepted", "converted"}, text(quote["status"]))
		if editable {
			out["deals"], e = salesDealOptions(ctx, tx, a, text(quote["deal_id"]))
			if e != nil {
				return e
			}
		}
		discount, e := satang(quote["discount_satang"])
		if e != nil || discount < 0 {
			return errors.New("Invalid satang amount")
		}
		out["defaultValues"] = erpwire.Row{"client_id": quote["client_id"], "project_id": text(quote["project_id"]), "deal_id": text(quote["deal_id"]), "number": quote["number"], "issue_date": text(quote["issue_date"]), "valid_until": text(quote["valid_until"]), "discountBaht": money.FormatBaht(discount), "notes": text(quote["notes"])}
		return nil
	})
	if e != nil {
		return nil, loadError(e, "Quote details unavailable")
	}
	out["products"] = []erpwire.Row{}
	if quoteEditable(text(quote["status"])) {
		products, e := s.activeProductOptions(ctx, a, json.RawMessage(`[]`))
		if e != nil {
			return nil, e
		}
		out["products"] = products
	}
	return out, nil
}
func (s *Service) quotePDF(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	model := erpwire.Row{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		q, e := one(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"number", "status", "issue_date", "valid_until", "subtotal_satang", "discount_satang", "total_satang", "vat_satang", "tax_breakdown", "prices_include_vat", "notes"}, Relations: []erpwire.Relation{salesClientRelation()}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if q == nil {
			return erpwire.ErrNotFound
		}
		items, e := all(ctx, tx, erpwire.Select{Table: "quote_items", Columns: []string{"description", "quantity", "unit_price_satang", "amount_satang", "position", "unit"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("quote_id", id)}, Order: ordered("position", "id")})
		if e != nil {
			return e
		}
		sections, e := salesDocumentSections(ctx, tx, a, "quote_id", id)
		if e != nil {
			return e
		}
		reference, e := salesPublicReference(ctx, tx, a, "quote", id)
		if e != nil {
			return e
		}
		name := text(salesRelation(q, "clients")["name"])
		if name == "" {
			name = "—"
		}
		vat := q["vat_satang"]
		if vat == nil {
			vat = int64(0)
		}
		for _, key := range []string{"subtotal_satang", "discount_satang", "total_satang"} {
			if _, err := satang(q[key]); err != nil {
				return err
			}
		}
		if _, err := satang(vat); err != nil {
			return err
		}
		breakdown, e := salesTaxBreakdown(q["tax_breakdown"])
		if e != nil {
			return e
		}
		printItems := make([]erpwire.Row, 0, len(items))
		for _, item := range items {
			if _, err := satang(item["unit_price_satang"]); err != nil {
				return err
			}
			if _, err := satang(item["amount_satang"]); err != nil {
				return err
			}
			printItems = append(printItems, erpwire.Row{"description": item["description"], "quantity": item["quantity"], "unit": item["unit"], "unit_price_satang": item["unit_price_satang"], "amount_satang": item["amount_satang"]})
		}
		model = erpwire.Row{"kind": "Quotation", "number": q["number"], "status": q["status"], "orgName": a.OrgName(), "clientName": name, "issueDate": q["issue_date"], "validUntil": q["valid_until"], "items": printItems, "sections": sections, "subtotalSatang": q["subtotal_satang"], "discountSatang": q["discount_satang"], "totalSatang": q["total_satang"], "vatSatang": vat, "vatByRate": breakdown, "pricesIncludeVat": q["prices_include_vat"], "notes": q["notes"], "publicReference": reference["display"]}
		return nil
	})
	if e != nil {
		if authError(e) || errors.Is(e, erpwire.ErrNotFound) {
			return nil, e
		}
		return RouteResponse{Status: 503, Body: []byte("Quote details unavailable")}, nil
	}
	if s.pdf == nil {
		return nil, errors.New("PDF renderer is required")
	}
	body, e := s.pdf.RenderPDF(ctx, "quote", model)
	if e != nil {
		return nil, e
	}
	return RouteResponse{Status: 200, Headers: map[string]string{"Content-Type": "text/html; charset=utf-8"}, Body: body}, nil
}
