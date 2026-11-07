package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var quoteStatuses = []string{"draft", "sent", "accepted", "declined", "expired"}

func quoteEditable(status string) bool { return status == "draft" || status == "sent" }
func quoteTransitionError(from, to, validUntil, date string) string {
	if to == "converted" {
		return "Use quote conversion to create the linked records."
	}
	if from == to {
		return ""
	}
	if to == "accepted" && validUntil != "" && validUntil < date {
		return "This quote has expired."
	}
	if from == "draft" && to == "sent" || from == "sent" && has([]string{"accepted", "declined", "expired"}, to) {
		return ""
	}
	return fmt.Sprintf("Cannot change a %s quote to %s.", from, to)
}
func quoteColumns(input erpwire.Row, create bool) (erpwire.Row, bool) {
	client := text(input["client_id"])
	if jsLength(client) == 0 || !optionalStrings(input, "project_id", "deal_id", "number", "issue_date", "valid_until", "notes") {
		return nil, false
	}
	if !create && jsLength(text(input["id"])) == 0 {
		return nil, false
	}
	v, present := input["discountBaht"]
	if !present && create {
		v = "0"
	}
	amountText, ok := numberText(v)
	if !ok {
		return nil, false
	}
	amount, e := salesMoney(amountText)
	if e != nil {
		return nil, false
	}
	row := erpwire.Row{"client_id": client, "project_id": nil, "deal_id": nil, "valid_until": nil, "discount_satang": int64(amount)}
	for _, k := range []string{"project_id", "deal_id", "valid_until"} {
		if value := text(input[k]); value != "" {
			row[k] = value
		}
	}
	for _, k := range []string{"number", "notes"} {
		if value := jsTrim(text(input[k])); value != "" {
			row[k] = value
		}
	}
	if date := text(input["issue_date"]); date != "" {
		row["issue_date"] = date
	}
	return row, true
}
func (s *Service) createQuote(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil {
		return invalid("Invalid input")
	}
	row, ok := quoteColumns(input, true)
	if !ok {
		return invalid("Invalid input")
	}
	row["org_id"] = a.OrgID()
	row["status"] = "draft"
	row["subtotal_satang"] = int64(0)
	row["total_satang"] = int64(0)
	var id string
	if text(row["number"]) == "" {
		// Reservations commit independently, as the source RPC does before insert.
		e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
			year, _ := strconv.Atoi(today()[:4])
			result, e := tx.Command(ctx, "reserve_document_number", erpwire.Row{"p_org_id": a.OrgID(), "p_kind": "quote", "p_year": year})
			if e != nil {
				return e
			}
			var number string
			if string(result) != "null" && erpwire.DecodeJSON(result, &number) != nil {
				return businessError("Could not reserve a quote number. Please retry.")
			}
			if number == "" {
				return businessError("Could not reserve a quote number. Please retry.")
			}
			row["number"] = number
			return nil
		})
		if e != nil {
			return failure(e)
		}
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Insert(ctx, erpwire.Insert{Table: "quotes", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(rows) != 1 {
			return erpwire.ErrNotFound
		}
		id = text(rows[0]["id"])
		if id == "" {
			return erpwire.ErrNotFound
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "quote", id, "created", "Created quote "+text(row["number"]), nil)
	return response("/quotes/"+id, "/quotes"), nil
}
func (s *Service) updateQuote(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "record:write"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil {
		return invalid("Invalid input")
	}
	row, ok := quoteColumns(input, false)
	if !ok {
		return invalid("Invalid input")
	}
	id := text(input["id"])
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		current, e := one(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"status"}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if current == nil {
			return businessError("Quote not found")
		}
		if !quoteEditable(text(current["status"])) {
			return businessError("This quote is locked")
		}
		_, e = tx.Update(ctx, "quotes", row, scoped(a, id), nil)
		return e
	})
	if e != nil {
		return failure(e)
	}
	return response("", "/quotes", "/quotes/"+id), nil
}
func (s *Service) deleteQuote(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "quote:delete") != nil {
		return invalid("Only owners and admins can delete quotes.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil || jsLength(text(input["id"])) == 0 {
		return invalid("Invalid input")
	}
	id := text(input["id"])
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { _, e := tx.Delete(ctx, "quotes", scoped(a, id), nil); return e })
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "quote", id, "deleted", "Deleted a quote", nil)
	return response("/quotes", "/quotes"), nil
}
func (s *Service) setQuoteStatus(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "record:write"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil || jsLength(text(input["id"])) == 0 || !has(quoteStatuses, text(input["status"])) {
		return invalid("Invalid input")
	}
	id, status := text(input["id"]), text(input["status"])
	if status == "accepted" && authorize(a, "quote:convert") != nil {
		return invalid("Only owners and admins can accept quotes.")
	}
	var number string
	changed := false
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		current, e := one(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"status", "valid_until"}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if current == nil {
			return businessError("Quote not found")
		}
		if message := quoteTransitionError(text(current["status"]), status, text(current["valid_until"]), today()); message != "" {
			return businessError(message)
		}
		if text(current["status"]) == status {
			return nil
		}
		where := append(scoped(a, id), eq("status", current["status"]))
		rows, e := tx.Update(ctx, "quotes", erpwire.Row{"status": status}, where, []string{"number"})
		if e != nil {
			return e
		}
		if len(rows) != 1 {
			return businessError("Quote changed. Reload and try again.")
		}
		number = text(rows[0]["number"])
		changed = true
		return nil
	})
	if e != nil {
		return failure(e)
	}
	if !changed {
		return response(""), nil
	}
	s.audit(ctx, a, "quote", id, "status_changed", "Set quote "+number+" to "+status, erpwire.Row{"status": status})
	return response("", "/quotes", "/quotes/"+id), nil
}

var quoteQuantityPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]{1,3})?$`)

func quoteQuantity(v any) (json.Number, bool) {
	value, ok := numberText(v)
	value = jsTrim(value)
	if !ok || !quoteQuantityPattern.MatchString(value) {
		return "", false
	}
	whole, fraction := value, ""
	for i, c := range value {
		if c == '.' {
			whole, fraction = value[:i], value[i+1:]
			break
		}
	}
	n, e := strconv.ParseInt(whole, 10, 64)
	if e != nil || n > 999999999 {
		return "", false
	}
	for len(fraction) < 3 {
		fraction += "0"
	}
	f, _ := strconv.ParseInt(fraction, 10, 64)
	if n*1000+f == 0 {
		return "", false
	}
	canonical, ok := numberText(json.Number(value))
	return json.Number(canonical), ok
}
func quoteConversion(input erpwire.Row, a erpwire.Actor) (erpwire.Row, bool) {
	id, key := text(input["id"]), text(input["key"])
	if !validID(id) || !salesUUID(key) {
		return nil, false
	}
	row := erpwire.Row{"p_org_id": a.OrgID(), "p_quote_id": id, "p_key": key}
	modes := 0
	if value, ok := input["lines"]; ok {
		modes++
		lines, ok := value.([]any)
		if !ok || len(lines) == 0 {
			return nil, false
		}
		out := []erpwire.Row{}
		seen := map[string]bool{}
		for _, v := range lines {
			line, ok := v.(map[string]any)
			if !ok {
				if r, yes := v.(erpwire.Row); yes {
					line = r
					ok = true
				}
			}
			if !ok {
				return nil, false
			}
			id := text(line["quote_item_id"])
			qty, ok := quoteQuantity(line["quantity"])
			if !validID(id) || seen[id] || !ok {
				return nil, false
			}
			seen[id] = true
			out = append(out, erpwire.Row{"quote_item_id": id, "quantity": qty})
		}
		row["p_lines"] = out
	}
	for k, dest := range map[string]string{"depositSatang": "p_deposit_satang", "depositBps": "p_deposit_bps"} {
		if v, ok := input[k]; ok {
			modes++
			if _, ok := v.(json.Number); !ok {
				return nil, false
			}
			n, e := integer(v)
			max := int64(money.MaxSafeSatang)
			if k == "depositBps" {
				max = 10000
			}
			if e != nil || n < 1 || n > max {
				return nil, false
			}
			row[dest] = n
		}
	}
	return row, modes <= 1
}

// z.uuid requires RFC variant and a supported UUID version, unlike z.guid.
func salesUUID(s string) bool {
	return validID(s) && (s[14] >= '1' && s[14] <= '8') && (s[19] == '8' || s[19] == '9' || s[19] == 'a' || s[19] == 'b' || s[19] == 'A' || s[19] == 'B') || s == "00000000-0000-0000-0000-000000000000" || s == "ffffffff-ffff-ffff-ffff-ffffffffffff"
}
func (s *Service) convertQuoteToInvoice(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "quote:convert") != nil {
		return invalid("Only owners and admins can convert quotes.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil {
		return invalid("Invalid input")
	}
	row, ok := quoteConversion(input, a)
	if !ok {
		return invalid("Invalid input")
	}
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		result, e := tx.Command(ctx, "convert_accepted_quote", row)
		if e != nil {
			return e
		}
		if string(result) == "null" {
			return nil
		}
		return erpwire.DecodeJSON(result, &id)
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		value, _ := failure(e)
		result := value.(erpwire.ActionResponse)
		var safe interface {
			BusinessMessage() string
			SQLState() string
		}
		if errors.As(e, &safe) && safe.SQLState() == "P0001" && safe.BusinessMessage() != "" && safe.BusinessMessage() != "Only owners and admins may convert quotes" && safe.BusinessMessage() != "Idempotency conflict" {
			result.Value.(erpwire.Row)["rejected"] = true
		}
		return result, nil
	}
	if id == "" {
		return invalid("Conversion did not return an invoice. Retry this request.")
	}
	return response("/finance/invoices/"+id, "/quotes", "/quotes/"+text(input["id"]), "/projects", "/finance"), nil
}
func (s *Service) cancelQuoteInvoice(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "quote:convert") != nil {
		return invalid("Only owners and admins can cancel quote invoices.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil || !validID(text(input["quoteId"])) || !validID(text(input["invoiceId"])) {
		return invalid("Invalid input")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "cancel_quote_invoice", erpwire.Row{"p_org_id": a.OrgID(), "p_invoice_id": input["invoiceId"]})
		return e
	})
	if e != nil {
		return failure(e)
	}
	return response("", "/quotes/"+text(input["quoteId"]), "/quotes", "/finance/invoices/"+text(input["invoiceId"]), "/finance"), nil
}
