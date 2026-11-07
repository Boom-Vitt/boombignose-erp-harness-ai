package erpsales

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func purchaseRFQClaim(raw json.RawMessage) (string, erpwire.Row, bool) {
	var claim erpwire.Row
	if erpwire.DecodeJSON(raw, &claim) != nil {
		return "", nil, false
	}
	key := text(claim["delivery_key"])
	if !validID(key) {
		return "", nil, false
	}
	source, ok := claim["snapshot"].(map[string]any)
	if !ok {
		return "", nil, false
	}
	snapshot := erpwire.Row(source)
	if !purchaseEmail(text(snapshot["to"])) || jsLength(text(snapshot["number"])) < 1 || jsLength(text(snapshot["vendorName"])) < 1 || !validDate(text(snapshot["orderDate"])) {
		return "", nil, false
	}
	if snapshot["expectedDate"] != nil && !validDate(text(snapshot["expectedDate"])) {
		return "", nil, false
	}
	if _, present := snapshot["expectedDate"]; !present {
		return "", nil, false
	}
	if _, present := snapshot["notes"]; !present {
		return "", nil, false
	}
	if snapshot["notes"] != nil {
		if _, ok := snapshot["notes"].(string); !ok {
			return "", nil, false
		}
	}
	sourceLines, ok := snapshot["lines"].([]any)
	if !ok || len(sourceLines) == 0 {
		return "", nil, false
	}
	lines := []erpwire.Row{}
	for _, entry := range sourceLines {
		line, ok := entry.(map[string]any)
		if !ok || jsLength(text(line["description"])) < 1 || jsLength(text(line["unit"])) < 1 {
			return "", nil, false
		}
		q, e := purchaseQuantity(line["quantity"], false, true)
		n, valid := purchaseNumber(line["unit_cost_satang"])
		cost, e2 := purchaseExactInt(json.Number(n))
		if e != nil || !valid || e2 != nil || cost < 0 || cost > int64(money.MaxSafeSatang) {
			return "", nil, false
		}
		lines = append(lines, erpwire.Row{"description": line["description"], "quantity": purchaseDecimal(q), "unit": line["unit"], "unit_cost_satang": cost})
	}
	snapshot["lines"] = lines
	sections := []erpwire.Row{}
	if value, present := snapshot["sections"]; present {
		entries, ok := value.([]any)
		if !ok {
			return "", nil, false
		}
		for _, entry := range entries {
			section, ok := entry.(map[string]any)
			if !ok || !validID(text(section["id"])) || !has([]string{"section", "note"}, text(section["kind"])) || jsLength(text(section["description"])) < 1 || jsLength(text(section["description"])) > 4000 {
				return "", nil, false
			}
			for _, field := range []string{"lines_before", "position"} {
				n, ok := purchaseNumber(section[field])
				i, e := purchaseExactInt(json.Number(n))
				if !ok || e != nil || i < 0 {
					return "", nil, false
				}
			}
			sections = append(sections, erpwire.Row(section))
		}
	}
	snapshot["sections"] = sections
	return key, snapshot, true
}
func purchaseRFQHTML(snapshot erpwire.Row) (string, error) {
	lines := snapshot["lines"].([]erpwire.Row)
	sections := append([]erpwire.Row{}, snapshot["sections"].([]erpwire.Row)...)
	sort.SliceStable(sections, func(i, j int) bool {
		a, _ := integer(sections[i]["lines_before"])
		b, _ := integer(sections[j]["lines_before"])
		if a != b {
			return a < b
		}
		a, _ = integer(sections[i]["position"])
		b, _ = integer(sections[j]["position"])
		return a < b
	})
	rows := strings.Builder{}
	next := 0
	renderSection := func(section erpwire.Row) {
		style := ""
		if text(section["kind"]) == "section" {
			style = ";font-weight:bold"
		}
		rows.WriteString(`<tr><td colspan="4" style="white-space:pre-wrap` + style + `">` + salesEscape(text(section["description"])) + `</td></tr>`)
	}
	for index, line := range lines {
		for next < len(sections) {
			before, _ := integer(sections[next]["lines_before"])
			if before > int64(index) {
				break
			}
			renderSection(sections[next])
			next++
		}
		amount, e := purchaseLineAmount(line["quantity"], line["unit_cost_satang"])
		if e != nil {
			return "", e
		}
		cost, e := satang(line["unit_cost_satang"])
		if e != nil {
			return "", e
		}
		q, _ := numberText(line["quantity"])
		rows.WriteString(`<tr><td>` + salesEscape(text(line["description"])) + `</td><td>` + q + ` ` + salesEscape(text(line["unit"])) + `</td><td>` + salesEscape(salesFormatTHB(cost)) + `</td><td>` + salesEscape(salesFormatTHB(amount)) + `</td></tr>`)
	}
	for next < len(sections) {
		renderSection(sections[next])
		next++
	}
	total, e := purchaseTotal(lines)
	if e != nil {
		return "", e
	}
	expected := ""
	if text(snapshot["expectedDate"]) != "" {
		expected = `<br>Expected arrival: ` + salesEscape(text(snapshot["expectedDate"]))
	}
	notes := ""
	if text(snapshot["notes"]) != "" {
		notes = `<p style="white-space:pre-wrap">` + salesEscape(text(snapshot["notes"])) + `</p>`
	}
	return `<div style="font-family:Arial,sans-serif;line-height:1.5"><p>Dear ` + salesEscape(text(snapshot["vendorName"])) + `,</p>
<h1>Request for quotation ` + salesEscape(text(snapshot["number"])) + `</h1><p>Please confirm availability and pricing for these requested items.</p>
<p>Order date: ` + salesEscape(text(snapshot["orderDate"])) + expected + `</p>
<table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse"><thead><tr><th>Description</th><th>Quantity</th><th>Unit cost</th><th>Amount</th></tr></thead><tbody>` + rows.String() + `</tbody></table>
<p>Total: <strong>` + salesEscape(salesFormatTHB(total)) + `</strong></p>
` + notes + `<p>Sent from BoomBigNose ERP.</p></div>`, nil
}
func (s *Service) sendPurchaseRFQ(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	if e != nil || !validID(id) {
		return invalid("Invalid purchase")
	}
	if s.mail == nil || !s.mail.Configured() {
		return invalid("Email is not configured. Print the RFQ or configure email delivery.")
	}
	var claim json.RawMessage
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		var e error
		claim, e = tx.Command(ctx, "claim_purchase_rfq", erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id})
		return e
	})
	if e != nil {
		return failure(e)
	}
	if len(claim) == 0 || string(claim) == "null" || string(claim) == "false" || string(claim) == `""` {
		return invalid("RFQ has already been claimed or the order is no longer draft. Delivery will not be repeated.")
	}
	key, snapshot, ok := purchaseRFQClaim(claim)
	if !ok {
		return invalid("RFQ snapshot is invalid. No delivery was attempted.")
	}
	html, e := purchaseRFQHTML(snapshot)
	if e != nil {
		return nil, e
	}
	result, sendErr := s.mail.SendEmail(ctx, EmailMessage{To: text(snapshot["to"]), Subject: "Request for quotation " + text(snapshot["number"]), HTML: html, IdempotencyKey: "purchase-rfq/" + key})
	deliveryError := ""
	if sendErr != nil {
		deliveryError = "Unable to send RFQ"
	} else if !result.OK {
		deliveryError = result.Error
		if result.Reason == "not_configured" {
			deliveryError = "Email is not configured"
		} else if deliveryError == "" {
			deliveryError = "Unable to send RFQ"
		}
	}
	var savedError any
	if deliveryError != "" {
		savedError = deliveryError
	}
	e = s.purchaseCommand(ctx, a, "finish_purchase_rfq", erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id, "p_delivery_key": key, "p_error": savedError})
	paths := []string{"/purchases/" + id, "/purchases"}
	if e != nil {
		if authError(e) {
			return nil, e
		}
		message := deliveryError
		if message == "" {
			message = "Email accepted"
		}
		return erpwire.ActionResponse{Value: erpwire.Row{"error": message + ". Delivery status could not be saved; verify delivery before recovery."}, Refresh: paths}, nil
	}
	if deliveryError != "" {
		return erpwire.ActionResponse{Value: erpwire.Row{"error": deliveryError + ". The RFQ remains frozen for delivery verification; print it if needed."}, Refresh: paths}, nil
	}
	s.audit(ctx, a, "purchase_order", id, "emailed", "Sent RFQ "+text(snapshot["number"]), nil)
	return response("", paths...), nil
}
