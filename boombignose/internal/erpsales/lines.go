package erpsales

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func salesLinesInput(input erpwire.Row) (string, string, []erpwire.Row, []string, bool) {
	document, id := text(input["document"]), text(input["documentId"])
	if !has([]string{"quote", "invoice", "purchase_order"}, document) || !validID(id) {
		return "", "", nil, nil, false
	}
	values, ok := input["rows"].([]any)
	if !ok || len(values) > 500 {
		return "", "", nil, nil, false
	}
	rows := []erpwire.Row{}
	for _, value := range values {
		row, ok := value.(map[string]any)
		if !ok {
			return "", "", nil, nil, false
		}
		kind := text(row["kind"])
		description, ok := row["description"].(string)
		description = jsTrim(description)
		if !ok || description == "" || jsLength(description) > 4000 || !validID(text(row["id"])) || !has([]string{"line", "section", "note"}, kind) {
			return "", "", nil, nil, false
		}
		out := erpwire.Row{"kind": kind, "id": row["id"], "description": description}
		if kind == "line" {
			if value, present := row["product_id"]; !present || value != nil && !validID(text(value)) {
				return "", "", nil, nil, false
			}
			unit, unitPresent := row["unit"]
			if !unitPresent {
				return "", "", nil, nil, false
			}
			if unit != nil {
				str, ok := unit.(string)
				if !ok || jsTrim(str) == "" || jsLength(jsTrim(str)) > 40 {
					return "", "", nil, nil, false
				}
				unit = jsTrim(str)
			}
			quantity, ok := row["quantity"].(string)
			if !ok {
				return "", "", nil, nil, false
			}
			quantity = jsTrim(quantity)
			if _, ok := row["unit_price_satang"].(json.Number); !ok {
				return "", "", nil, nil, false
			}
			price, e := satang(row["unit_price_satang"])
			if e != nil || price < 0 {
				return "", "", nil, nil, false
			}
			if _, err := purchaseLineAmount(quantity, price); err != nil {
				return "", "", nil, nil, false
			}
			if _, ok := row["tax_rate_bps"].(json.Number); !ok {
				return "", "", nil, nil, false
			}
			rate, e := integer(row["tax_rate_bps"])
			if e != nil || rate < 0 || rate > 10000 {
				return "", "", nil, nil, false
			}
			out["product_id"] = row["product_id"]
			out["unit"] = unit
			out["quantity"] = quantity
			out["unit_price_satang"] = int64(price)
			out["tax_rate_bps"] = rate
		}
		rows = append(rows, out)
	}
	rawDeleted, ok := input["deleted"].([]any)
	if !ok || len(rawDeleted) > 500 {
		return "", "", nil, nil, false
	}
	deleted := []string{}
	for _, v := range rawDeleted {
		if !validID(text(v)) {
			return "", "", nil, nil, false
		}
		deleted = append(deleted, text(v))
	}
	return document, id, rows, deleted, true
}
func salesReadGrid(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, document, id string) ([]erpwire.Row, error) {
	parent, table := "quote_id", "quote_items"
	columns := []string{"id", "product_id", "description", "quantity", "unit", "unit_price_satang", "tax_rate_bps", "invoiced_quantity"}
	if document == "invoice" {
		parent, table = "invoice_id", "invoice_items"
		columns = columns[:len(columns)-1]
	}
	if document == "purchase_order" {
		parent, table = "purchase_order_id", "purchase_order_items"
		columns = []string{"id", "product_id", "description", "quantity", "unit", "unit_cost_satang", "received_quantity", "returned_quantity", "billed_quantity"}
	}
	lines, e := all(ctx, tx, erpwire.Select{Table: table, Columns: columns, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq(parent, id)}, Order: ordered("position", "id")})
	if e != nil {
		return nil, e
	}
	sections, e := salesDocumentSections(ctx, tx, a, parent, id)
	if e != nil {
		return nil, e
	}
	for _, line := range lines {
		switch document {
		case "purchase_order":
			line["unit_price_satang"] = line["unit_cost_satang"]
			extras := []string{}
			for _, key := range []string{"received_quantity", "returned_quantity", "billed_quantity"} {
				v, e := salesDecimalText(line[key])
				if e != nil {
					return nil, e
				}
				extras = append(extras, v)
			}
			line["extras"] = extras
		case "quote":
			value, e := salesDecimalText(line["invoiced_quantity"])
			if e != nil {
				return nil, e
			}
			line["extras"] = []string{value}
		}
	}
	return salesGridRows(lines, sections)
}
func (s *Service) saveDocumentLines(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil {
		return invalid("Some lines are invalid. Fix the highlighted cells and save again.")
	}
	document, id, rows, deleted, ok := salesLinesInput(input)
	if !ok {
		return invalid("Some lines are invalid. Fix the highlighted cells and save again.")
	}
	capability := erpwire.Capability("record:write")
	path := "/quotes"
	if document == "invoice" {
		capability = "payment:verify"
		path = "/finance/invoices"
	} else if document == "purchase_order" {
		capability = "purchase:manage"
		path = "/purchases"
	}
	if authorize(a, capability) != nil {
		return invalid("You cannot edit these lines.")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		table := map[string]string{"quote": "quotes", "invoice": "invoices", "purchase_order": "purchase_orders"}[document]
		parent, e := one(ctx, tx, erpwire.Select{Table: table, Columns: []string{"id"}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if parent == nil {
			return businessError("Document unavailable")
		}
		_, e = tx.Command(ctx, "save_document_lines", erpwire.Row{"p_document": document, "p_document_id": id, "p_rows": rows, "p_deleted": deleted})
		return e
	})
	if e != nil {
		return failure(e)
	}
	lines := 0
	for _, row := range rows {
		if row["kind"] == "line" {
			lines++
		}
	}
	plural := func(n int) string {
		if n == 1 {
			return ""
		}
		return "s"
	}
	summary := fmt.Sprintf("Saved %d line%s and %d section or note row%s", lines, plural(lines), len(rows)-lines, plural(len(rows)-lines))
	if len(deleted) > 0 {
		summary += fmt.Sprintf("; removed %d", len(deleted))
	}
	s.audit(ctx, a, document, id, "lines_saved", summary, erpwire.Row{"lines": lines, "sections": len(rows) - lines, "removed": len(deleted)})
	result := response("", strings.TrimSuffix(path, "/")+"/"+id)
	var grid []erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		grid, e = salesReadGrid(ctx, tx, a, document, id)
		return e
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		result.Value = erpwire.Row{"error": "Lines saved, but reloading them failed. Reload the page."}
		return result, nil
	}
	result.Value = erpwire.Row{"rows": grid}
	return result, nil
}
