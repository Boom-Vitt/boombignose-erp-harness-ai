package erpsales

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func invHTML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
}
func inventoryStockDocumentHTML(org string, doc erpwire.Row, lines []erpwire.Row, reference string) string {
	title := "Delivery order"
	if doc["kind"] == "receipt" {
		title = "Goods receipt"
	}
	ref := ""
	if reference != "" {
		ref = "<p>Public reference " + invHTML(reference) + "</p>"
	}
	var rows strings.Builder
	for _, line := range lines {
		rows.WriteString("<tr><td>" + invHTML(text(line["description"])) + "</td><td>" + invHTML(invString(line["quantity"])) + "</td><td>" + invHTML(text(line["unit"])) + "</td></tr>")
	}
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>` + invHTML(text(doc["number"])) + `</title><style>body{font:16px system-ui;margin:40px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #ccc}@media print{button{display:none}}</style></head><body><h1>` + title + `</h1><p>` + invHTML(org) + `</p><h2>` + invHTML(text(doc["number"])) + `</h2>` + ref + `<p>Date ` + invHTML(text(doc["document_date"])) + `</p><table><thead><tr><th>Description</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>` + rows.String() + `</tbody></table><p>Received by ____________________ Date __________</p><button type="button" onclick="window.print()">Print / Save PDF</button></body></html>`
}
func (s *Service) inventoryDocumentPrint(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := invIDArgument(raw)
	if e != nil {
		return nil, e
	}
	var body []byte
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		doc, e := one(ctx, tx, erpwire.Select{Table: "stock_documents", Columns: []string{"*"}, Where: scoped(a, id)})
		if e != nil {
			return invReadError(e, "Stock document unavailable")
		}
		if doc == nil {
			return erpwire.ErrNotFound
		}
		lines, e := all(ctx, tx, erpwire.Select{Table: "stock_document_lines", Columns: []string{"*"}, Where: append(scope(a), eq("document_id", id)), Order: []erpwire.Order{{Column: "id"}}})
		if e != nil {
			return e
		}
		kind := "delivery"
		if doc["kind"] == "receipt" {
			kind = "receipt"
		}
		ref, e := salesPublicReference(ctx, tx, a, kind, id)
		if e != nil {
			return e
		}
		body = []byte(inventoryStockDocumentHTML(a.OrgName(), doc, lines, text(ref["display"])))
		return nil
	})
	if e != nil {
		return nil, e
	}
	return RouteResponse{Status: 200, Headers: map[string]string{"Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store"}, Body: body}, nil
}
