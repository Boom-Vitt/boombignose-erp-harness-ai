package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (s *Service) purchaseVendorOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/(app)/vendors/actions.ts::saveVendor":              s.saveVendor,
		"app/(app)/purchases/actions.ts::createPurchase":        s.createPurchase,
		"app/(app)/purchases/actions.ts::updatePurchase":        s.updatePurchase,
		"app/(app)/purchases/actions.ts::transitionPurchase":    s.transitionPurchase,
		"app/(app)/purchases/actions.ts::receivePurchase":       s.receivePurchase,
		"app/(app)/purchases/actions.ts::returnPurchase":        s.returnPurchase,
		"app/(app)/purchases/actions.ts::createPurchaseBill":    s.createPurchaseBill,
		"app/(app)/purchases/actions.ts::markBillPaid":          s.markBillPaid,
		"app/(app)/purchases/actions.ts::linkVendorCredit":      s.linkVendorCredit,
		"app/(app)/purchases/actions.ts::updateBillTolerance":   s.updateBillTolerance,
		"app/(app)/purchases/actions.ts::approvePurchase":       s.approvePurchase,
		"app/(app)/purchases/actions.ts::reopenPurchaseRFQ":     s.reopenPurchaseRFQ,
		"app/(app)/purchases/email-actions.ts::sendPurchaseRFQ": s.sendPurchaseRFQ,
		"app/(app)/purchases/page.tsx::load":                    s.purchasesPage,
		"app/(app)/purchases/new/page.tsx::load":                s.purchaseNewPage,
		"app/(app)/purchases/[id]/page.tsx::load":               s.purchasePage,
		"app/(app)/purchases/[id]/pdf/route.ts::GET":            s.purchasePDF,
		"app/(app)/vendors/page.tsx::load":                      s.vendorsPage,
		"app/(app)/vendors/new/page.tsx::load":                  s.vendorNewPage,
		"app/(app)/vendors/[id]/page.tsx::load":                 s.vendorPage,
		"app/(app)/vendors/[id]/edit/page.tsx::load":            s.vendorEditPage,
		"lib/purchasing/queries.ts::purchaseOptions":            s.purchaseOptionsOperation,
		"lib/purchasing/queries.ts::purchaseDetail":             s.purchaseDetailOperation,
		"lib/purchasing/queries.ts::vendorDetail":               s.vendorDetailOperation,
		"lib/purchasing/queries.ts::overdueVendorBillCount":     s.overdueVendorBillCount,
	}
}
func purchaseRefresh(id string) []string {
	return []string{"/purchases/" + id, "/purchases", "/vendors", "/finance", "/dashboard", "/reports"}
}
func purchaseObject(args erpwire.Arguments, index int) (erpwire.Row, bool) {
	var row erpwire.Row
	if args.Null(index) || args.Decode(index, &row) != nil || row == nil {
		return nil, false
	}
	return row, true
}
func (s *Service) purchaseCommand(ctx context.Context, a erpwire.Actor, name string, input erpwire.Row) error {
	return s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { _, e := tx.Command(ctx, name, input); return e })
}
func (s *Service) saveVendor(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	id := ""
	if !args.Null(0) {
		id, e = stringArg(args, 0)
		if e != nil || !validID(id) {
			return invalid("Invalid vendor details")
		}
	}
	input, ok := purchaseObject(args, 1)
	row, valid := purchaseVendorInput(input)
	if !ok || !valid {
		return invalid("Invalid vendor details")
	}
	var resultID string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		var rows []erpwire.Row
		var err error
		if id != "" {
			rows, err = tx.Update(ctx, "vendors", row, scoped(a, id), []string{"id"})
		} else {
			row["org_id"] = a.OrgID()
			rows, err = tx.Insert(ctx, erpwire.Insert{Table: "vendors", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
		}
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			return erpwire.ErrNotFound
		}
		resultID = text(rows[0]["id"])
		return nil
	})
	if e != nil {
		return failure(e)
	}
	action, verb := "created", "Created"
	if id != "" {
		action, verb = "updated", "Updated"
	}
	s.audit(ctx, a, "vendor", resultID, action, verb+" vendor "+text(row["name"]), nil)
	return response("/vendors/"+resultID, "/vendors", "/vendors/"+resultID), nil
}
func (s *Service) createPurchase(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	input, ok := purchaseObject(args, 0)
	row, valid := purchaseOrderInput(input)
	if !ok || !valid {
		return invalid("Invalid purchase details")
	}
	row["p_org_id"] = a.OrgID()
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		result, e := tx.Command(ctx, "create_purchase_order", row)
		if e != nil {
			return e
		}
		if erpwire.DecodeJSON(result, &id) != nil || !validID(id) {
			return errors.New("Purchase command returned invalid ID")
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	return response("/purchases/"+id, "/purchases"), nil
}
func (s *Service) updatePurchase(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	input, ok := purchaseObject(args, 1)
	row, valid := purchaseOrderInput(input)
	if e != nil || !validID(id) || !ok || !valid {
		return invalid("Invalid purchase details")
	}
	row["p_org_id"] = a.OrgID()
	row["p_order_id"] = id
	if e = s.purchaseCommand(ctx, a, "update_purchase_order", row); e != nil {
		return failure(e)
	}
	return response("", purchaseRefresh(id)...), nil
}
func (s *Service) transitionPurchase(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	status, e2 := stringArg(args, 1)
	if e != nil || e2 != nil || !validID(id) || !has([]string{"confirmed", "closed", "cancelled"}, status) {
		return invalid("Invalid purchase transition")
	}
	if e = s.purchaseCommand(ctx, a, "transition_purchase_order", erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id, "p_status": status}); e != nil {
		return failure(e)
	}
	return response("", purchaseRefresh(id)...), nil
}
func purchaseReceiptInput(args erpwire.Arguments) ([]erpwire.Row, bool) {
	var input []erpwire.Row
	if args.Decode(1, &input) != nil || len(input) == 0 {
		return nil, false
	}
	rows := []erpwire.Row{}
	for _, line := range input {
		current, e := purchaseRational(line["received_quantity"], false)
		previous, e2 := purchaseRational(line["previous_received_quantity"], false)
		if !validID(text(line["id"])) || e != nil || e2 != nil || current.Sign() < 0 || previous.Sign() < 0 {
			return nil, false
		}
		rows = append(rows, erpwire.Row{"id": line["id"], "received_quantity": line["received_quantity"], "previous_received_quantity": line["previous_received_quantity"]})
	}
	return rows, true
}
func purchaseApplyReceipt(lines, receipt []erpwire.Row, tolerance any) ([]erpwire.Row, error) {
	rate, e := purchaseRational(tolerance, true)
	if e != nil || rate.Sign() < 0 || rate.Cmp(big.NewRat(100, 1)) > 0 {
		return nil, errors.New("Invalid receipt tolerance")
	}
	rate.Mul(rate, big.NewRat(100, 1))
	if !rate.IsInt() {
		return nil, errors.New("Invalid receipt tolerance")
	}
	bps := rate.Num().Int64()
	targets := map[string]any{}
	for _, target := range receipt {
		id := text(target["id"])
		var line erpwire.Row
		for _, candidate := range lines {
			if text(candidate["id"]) == id {
				line = candidate
				break
			}
		}
		if _, duplicate := targets[id]; line == nil || duplicate {
			return nil, errors.New("Unknown or duplicate receipt line")
		}
		previous, e := purchaseRational(target["previous_received_quantity"], true)
		received, e2 := purchaseRational(line["received_quantity"], true)
		if e != nil || e2 != nil || previous.Cmp(received) != 0 {
			return nil, errors.New("Receipt changed, reload")
		}
		q, e := purchaseQuantity(target["received_quantity"], true, true)
		if e != nil {
			return nil, e
		}
		ordered, e := purchaseQuantity(line["quantity"], false, true)
		if e != nil {
			return nil, e
		}
		allowed := new(big.Int).Mul(big.NewInt(ordered), big.NewInt(10000+bps))
		allowed.Quo(allowed, big.NewInt(10000))
		limit := new(big.Rat).SetFrac(allowed, big.NewInt(1000))
		if limit.Cmp(received) < 0 {
			limit = received
		}
		current := big.NewRat(q, 1000)
		if current.Cmp(received) < 0 || current.Cmp(limit) > 0 {
			return nil, errors.New("Received total must be between the previous receipt and the allowed receipt quantity")
		}
		targets[id] = purchaseDecimal(q)
	}
	out := []erpwire.Row{}
	for _, line := range lines {
		id := text(line["id"])
		target, ok := targets[id]
		if !ok {
			target = line["received_quantity"]
		}
		out = append(out, erpwire.Row{"id": id, "received_quantity": target, "previous_received_quantity": line["received_quantity"]})
	}
	return out, nil
}
func (s *Service) receivePurchase(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 4)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	receipt, ok := purchaseReceiptInput(args)
	warehouse, date := "", ""
	if args.Present(2) {
		warehouse, e = stringArg(args, 2)
		if e != nil || !validID(warehouse) {
			return invalid("Invalid receipt")
		}
	}
	if args.Present(3) {
		date, e = stringArg(args, 3)
		if e != nil || !validDate(date) {
			return invalid("Invalid receipt")
		}
	}
	if e != nil || !validID(id) || !ok {
		return invalid("Invalid receipt")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		lines, e := all(ctx, tx, erpwire.Select{Table: "purchase_order_items", Columns: []string{"*"}, Where: append(scope(a), eq("purchase_order_id", id)), Order: []erpwire.Order{{Column: "id"}}})
		if e != nil {
			return e
		}
		policy, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"over_receipt_tolerance_percent"}, Where: scope(a)})
		if e != nil {
			if authError(e) {
				return e
			}
			return purchaseBusinessError("Receipt policy unavailable")
		}
		var tolerance any = json.Number("0")
		if policy != nil && policy["over_receipt_tolerance_percent"] != nil {
			tolerance = policy["over_receipt_tolerance_percent"]
		}
		applied, e := purchaseApplyReceipt(lines, receipt, tolerance)
		if e != nil {
			return purchaseBusinessError(e.Error())
		}
		params := erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id, "p_lines": applied}
		if warehouse != "" {
			params["p_warehouse_id"] = warehouse
		}
		if date != "" {
			params["p_date"] = date
		}
		_, e = tx.Command(ctx, "receive_purchase_order", params)
		return e
	})
	if e != nil {
		return failure(e)
	}
	return response("", append(purchaseRefresh(id), "/inventory", "/products")...), nil
}

type purchaseBusinessError string

func (e purchaseBusinessError) Error() string           { return string(e) }
func (e purchaseBusinessError) BusinessMessage() string { return string(e) }
func (s *Service) returnPurchase(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 3)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	var input []erpwire.Row
	valid := args.Decode(1, &input) == nil && len(input) > 0
	lines := []erpwire.Row{}
	for _, line := range input {
		q, err := purchaseQuantity(line["returned_quantity"], true, false)
		if !validID(text(line["id"])) || err != nil {
			valid = false
			break
		}
		lines = append(lines, erpwire.Row{"id": line["id"], "returned_quantity": purchaseDecimal(q)})
	}
	warehouse := ""
	if args.Present(2) {
		warehouse, e = stringArg(args, 2)
		if e != nil || !validID(warehouse) {
			valid = false
		}
	}
	if e != nil || !validID(id) || !valid {
		return invalid("Invalid return")
	}
	params := erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id, "p_lines": lines}
	if warehouse != "" {
		params["p_warehouse_id"] = warehouse
	}
	if e = s.purchaseCommand(ctx, a, "return_purchase_order", params); e != nil {
		return failure(e)
	}
	return response("", append(purchaseRefresh(id), "/inventory", "/products")...), nil
}
func (s *Service) createPurchaseBill(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	input, ok := purchaseObject(args, 1)
	bill, valid := purchaseBillInput(input)
	if e != nil || !validID(id) || !ok || !valid {
		return invalid("Invalid vendor bill details")
	}
	if e = s.purchaseCommand(ctx, a, "bill_purchase_order", erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id, "p_bill": bill}); e != nil {
		return failure(e)
	}
	return response("", purchaseRefresh(id)...), nil
}
func (s *Service) markBillPaid(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	if e != nil || !validID(id) {
		return invalid("Invalid bill")
	}
	var row erpwire.Row
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Update(ctx, "costs", erpwire.Row{"paid_at": time.Now().UTC().Format(time.RFC3339Nano)}, append(scoped(a, id), erpwire.Predicate{Column: "vendor_id", Op: erpwire.NotEqual, Value: nil}, erpwire.Predicate{Column: "paid_at", Op: erpwire.Is, Value: nil}), []string{"purchase_order_id", "vendor_id", "bill_number"})
		if e != nil {
			return e
		}
		if len(rows) > 0 {
			row = rows[0]
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	if row == nil {
		return response(""), nil
	}
	order := text(row["purchase_order_id"])
	s.audit(ctx, a, "purchase_order", order, "bill_paid", "Marked bill "+text(row["bill_number"])+" paid", erpwire.Row{"costId": id})
	return response("", append(purchaseRefresh(order), "/vendors/"+text(row["vendor_id"]))...), nil
}
func (s *Service) linkVendorCredit(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	input, ok := purchaseObject(args, 1)
	bill, valid := purchaseCreditInput(input)
	if e != nil || !validID(id) || !ok || !valid {
		return invalid("Invalid vendor credit details")
	}
	if e = s.purchaseCommand(ctx, a, "link_vendor_credit", erpwire.Row{"p_org_id": a.OrgID(), "p_cost_id": id, "p_bill": bill}); e != nil {
		return failure(e)
	}
	return response("", "/purchases", "/vendors", "/finance", "/reports", "/dashboard"), nil
}
func (s *Service) updateBillTolerance(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "settings:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input any
	if args.Decode(0, &input) != nil {
		return invalid("Tolerance must be between 0 and 100 percent")
	}
	n, ok := purchaseNumber(input)
	bps, e := purchaseExactInt(json.Number(n))
	if !ok || e != nil || bps < 0 || bps > 10000 {
		return invalid("Tolerance must be between 0 and 100 percent")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "org_settings", Rows: []erpwire.Row{{"org_id": a.OrgID(), "bill_variance_tolerance_bps": bps}}, ConflictColumns: []string{"org_id"}, IgnoreConflicts: true})
		if e != nil {
			return e
		}
		_, e = tx.Update(ctx, "org_settings", erpwire.Row{"bill_variance_tolerance_bps": bps}, scope(a), nil)
		return e
	})
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "organization", a.OrgID(), "bill_tolerance_updated", "Updated vendor bill matching tolerance", erpwire.Row{"tolerance_bps": bps})
	return response("", "/settings/finance", "/purchases"), nil
}
func (s *Service) approvePurchase(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:approve"); e != nil {
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
	if e = s.purchaseCommand(ctx, a, "approve_purchase_order", erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id}); e != nil {
		return failure(e)
	}
	return response("", purchaseRefresh(id)...), nil
}
func (s *Service) reopenPurchaseRFQ(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 3, 3)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	key, e2 := stringArg(args, 1)
	var verified bool
	if e != nil || e2 != nil || !validID(id) || !validID(key) || args.Decode(2, &verified) != nil || !verified {
		return invalid("Verify non-delivery before reopening this RFQ")
	}
	if e = s.purchaseCommand(ctx, a, "reopen_purchase_rfq", erpwire.Row{"p_org_id": a.OrgID(), "p_order_id": id, "p_delivery_key": key, "p_verified_not_delivered": true}); e != nil {
		return failure(e)
	}
	return response("", purchaseRefresh(id)...), nil
}
