package erpinvoicing

import (
	"context"
	"encoding/json"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"github.com/google/uuid"
)

const manageInvoices = "Only owners, admins, and accountants can manage invoices."

func (s *Service) createInvoice(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if v, e, ok := gate(a, "payment:verify", manageInvoices); !ok {
		return v, e
	}
	input, e := objectArgument(raw)
	if e != nil {
		return invalid("Invalid input")
	}
	cols, ok := invoiceColumns(input, false)
	if !ok {
		return invalid("Invalid input")
	}
	id := uuid.NewString()
	cols["id"] = id
	cols["org_id"] = a.OrgID()
	cols["status"] = "draft"
	if cols["number"] == nil {
		cols["number"] = "DRAFT-" + id
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Insert(ctx, erpwire.Insert{Table: "invoices", Rows: []erpwire.Row{cols}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(rows) != 1 {
			return erpwire.ErrNotFound
		}
		id = text(rows[0]["id"])
		if !validID(id) {
			return erpwire.ErrNotFound
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	n, _ := amount(cols["amount_satang"])
	s.audit(ctx, a, "invoice", id, "created", "Created invoice "+text(cols["number"])+" for "+formatTHB(n, true), nil)
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: "/finance/invoices/" + id, Refresh: []string{"/finance"}}, nil
}

func (s *Service) updateInvoice(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if v, e, ok := gate(a, "payment:verify", manageInvoices); !ok {
		return v, e
	}
	input, e := objectArgument(raw)
	if e != nil {
		return invalid("Invalid input")
	}
	cols, ok := invoiceColumns(input, true)
	if !ok {
		return invalid("Invalid input")
	}
	id := text(input["id"])
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		where := append(scoped(a, id), eq("status", "draft"), erpwire.Predicate{Column: "issued_snapshot_id", Op: erpwire.Is, Value: nil})
		rows, e := tx.Update(ctx, "invoices", cols, where, []string{"id"})
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return businessError("Draft invoice unavailable")
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "invoice", id, "updated", "Updated invoice draft", nil)
	return success("/finance", "/finance/invoices/"+id)
}

func (s *Service) updateInvoiceWithholding(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if v, e, ok := gate(a, "payment:verify", "Only owners and admins can edit withholding."); !ok {
		return v, e
	}
	input, e := objectArgument(raw)
	if e != nil {
		return invalid("Invalid withholding rate")
	}
	rate, ok := boundedInt(input, "rateBps", 0, 500)
	if !ok || (rate != 0 && rate != 100 && rate != 200 && rate != 300 && rate != 500) || !guid(input, "invoiceId") {
		return invalid("Invalid withholding rate")
	}
	id := text(input["invoiceId"])
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Update(ctx, "invoices", erpwire.Row{"wht_rate_bps": rate}, append(scoped(a, id), eq("status", "draft"), erpwire.Predicate{Column: "issued_snapshot_id", Op: erpwire.Is, Value: nil}), []string{"id"})
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return businessError("Draft invoice unavailable")
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "invoice", id, "withholding_updated", "Updated invoice withholding", erpwire.Row{"rateBps": rate})
	return success("/finance/invoices/"+id, "/finance")
}

func (s *Service) createCost(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	r, e := objectArgument(raw)
	if e != nil {
		return invalid("Invalid input")
	}
	category := "other"
	if _, exists := r["category"]; exists {
		category = text(r["category"])
	}
	if !has(costCategories, category) || !isString(r, "amountBaht") {
		return invalid("Invalid input")
	}
	for _, key := range []string{"incurred_on", "vendor", "project_id", "notes"} {
		if !optionalString(r, key) {
			return invalid("Invalid input")
		}
	}
	if !bahtPattern.MatchString(trim(text(r["amountBaht"]))) {
		return invalid("Invalid input")
	}
	n, e := money.ParseBaht(trim(text(r["amountBaht"])))
	if e != nil {
		return invalid("Invalid input")
	}
	cols := erpwire.Row{"org_id": a.OrgID(), "category": category, "amount_satang": int64(n), "project_id": nilText(text(r["project_id"]))}
	for _, key := range []string{"vendor", "notes"} {
		if v := trim(text(r[key])); v != "" {
			cols[key] = v
		}
	}
	if date := text(r["incurred_on"]); date != "" {
		cols["incurred_on"] = date
	}
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Insert(ctx, erpwire.Insert{Table: "costs", Rows: []erpwire.Row{cols}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(rows) != 1 {
			return erpwire.ErrNotFound
		}
		id = text(rows[0]["id"])
		return nil
	})
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "cost", id, "created", "Recorded "+formatTHB(n, true)+" "+category+" cost", erpwire.Row{"category": category, "vendor": nilText(trim(text(r["vendor"])))})
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: "/finance", Refresh: []string{"/finance"}}, nil
}

func (s *Service) deleteCost(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if v, e, ok := gate(a, "cost:delete", "Only owners and admins can delete costs."); !ok {
		return v, e
	}
	r, e := objectArgument(raw)
	if e != nil || !isString(r, "id") || text(r["id"]) == "" {
		return invalid("Invalid input")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Delete(ctx, "costs", scoped(a, text(r["id"])), nil)
		return e
	})
	if e != nil {
		return failure(e)
	}
	return success("/finance")
}
