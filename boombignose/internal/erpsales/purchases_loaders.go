package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func purchaseID(raw json.RawMessage) (string, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return "", e
	}
	id, e := stringArg(args, 0)
	if e != nil {
		return "", e
	}
	if !validID(id) {
		return "", erpwire.ErrNotFound
	}
	return id, nil
}
func purchaseReadError(e error, message string) error {
	if e == nil {
		return nil
	}
	if errors.Is(e, erpwire.ErrUnauthenticated) || errors.Is(e, erpwire.ErrForbidden) || errors.Is(e, erpwire.ErrStepUpRequired) || errors.Is(e, erpwire.ErrAuthUnavailable) || errors.Is(e, erpwire.ErrIdentityChanged) || errors.Is(e, erpwire.ErrNotFound) || errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded) {
		return e
	}
	return errors.New(message)
}
func purchaseOptionsRead(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor) (erpwire.Row, error) {
	vendors, e := all(ctx, tx, erpwire.Select{Table: "vendors", Columns: []string{"id", "name"}, Where: append(scope(a), eq("active", true)), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	products, e := all(ctx, tx, erpwire.Select{Table: "products", Columns: []string{"id", "sku", "name", "description", "unit", "list_price_satang", "cost_satang"}, Where: append(scope(a), eq("active", true)), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	return erpwire.Row{"vendors": vendors, "products": products}, nil
}
func purchaseDetailRead(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, id string) (erpwire.Row, error) {
	order, e := one(ctx, tx, erpwire.Select{Table: "purchase_orders", Columns: []string{"*"}, Relations: []erpwire.Relation{{Name: "vendors", Table: "vendors", LocalColumn: "vendor_id", ForeignColumn: "id", Columns: []string{"*"}}}, Where: scoped(a, id)})
	if e != nil {
		return nil, purchaseReadError(e, "Purchase data unavailable. Please reload.")
	}
	if order == nil {
		return nil, erpwire.ErrNotFound
	}
	where := append(scope(a), eq("purchase_order_id", id))
	lines, e := all(ctx, tx, erpwire.Select{Table: "purchase_order_items", Columns: []string{"*"}, Where: where, Order: []erpwire.Order{{Column: "position"}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	bills, e := all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"*"}, Where: where, Order: []erpwire.Order{{Column: "created_at"}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"bill_variance_tolerance_bps"}, Where: scope(a)})
	if e != nil {
		return nil, purchaseReadError(e, "Bill matching settings unavailable")
	}
	var tolerance any = int64(100)
	if settings != nil && settings["bill_variance_tolerance_bps"] != nil {
		tolerance = settings["bill_variance_tolerance_bps"]
	}
	matches, e := all(ctx, tx, erpwire.Select{Table: "vendor_bill_matches", Columns: []string{"*"}, Where: where, Order: []erpwire.Order{{Column: "created_at"}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	return erpwire.Row{"order": order, "lines": lines, "bills": bills, "matches": matches, "toleranceBps": tolerance}, nil
}
func vendorDetailRead(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, id string) (erpwire.Row, error) {
	vendor, e := one(ctx, tx, erpwire.Select{Table: "vendors", Columns: []string{"*"}, Where: scoped(a, id)})
	if e != nil {
		return nil, purchaseReadError(e, "Vendor data unavailable. Please reload.")
	}
	if vendor == nil {
		return nil, erpwire.ErrNotFound
	}
	where := append(scope(a), eq("vendor_id", id))
	orders, e := all(ctx, tx, erpwire.Select{Table: "purchase_orders", Columns: []string{"*"}, Where: where, Order: []erpwire.Order{{Column: "order_date", Descending: true}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	bills, e := all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"*"}, Where: where, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
	if e != nil {
		return nil, e
	}
	return erpwire.Row{"vendor": vendor, "orders": orders, "bills": bills}, nil
}
func (s *Service) purchaseOptionsOperation(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var out erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; out, e = purchaseOptionsRead(ctx, tx, a); return e })
	return out, purchaseReadError(e, "Purchase options unavailable. Please reload.")
}
func (s *Service) purchaseDetailOperation(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := purchaseID(raw)
	if e != nil {
		return nil, e
	}
	var out erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; out, e = purchaseDetailRead(ctx, tx, a, id); return e })
	return out, e
}
func (s *Service) vendorDetailOperation(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := purchaseID(raw)
	if e != nil {
		return nil, e
	}
	var out erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; out, e = vendorDetailRead(ctx, tx, a, id); return e })
	return out, e
}
func (s *Service) overdueVendorBillCount(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var count int64
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		result, e := tx.Select(ctx, erpwire.Select{Table: "costs", Columns: []string{"id"}, Where: append(scope(a), erpwire.Predicate{Column: "vendor_id", Op: erpwire.NotEqual, Value: nil}, erpwire.Predicate{Column: "paid_at", Op: erpwire.Is, Value: nil}, erpwire.Predicate{Column: "due_date", Op: erpwire.Less, Value: today()}), Order: []erpwire.Order{{Column: "id"}}, Limit: 1, Count: true})
		if e != nil {
			return e
		}
		if result.Total == nil {
			return errors.New("Vendor bill attention count unavailable")
		}
		count = *result.Total
		return nil
	})
	return count, purchaseReadError(e, "Vendor bill attention count unavailable")
}
func (s *Service) purchaseNewPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
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
	var options erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; options, e = purchaseOptionsRead(ctx, tx, a); return e })
	if e != nil {
		return nil, e
	}
	return erpwire.Row{"vendors": options["vendors"], "today": today(), "vendorId": params["vendor"]}, nil
}
func (s *Service) vendorNewPage(_ context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	return erpwire.Row{}, nil
}
func (s *Service) vendorEditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	id, e := purchaseID(raw)
	if e != nil {
		return nil, e
	}
	var out erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		detail, e := vendorDetailRead(ctx, tx, a, id)
		if e != nil {
			return e
		}
		out = erpwire.Row{"vendor": detail["vendor"]}
		return nil
	})
	return out, e
}
func (s *Service) vendorPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := purchaseID(raw)
	if e != nil {
		return nil, e
	}
	var out erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		out, e = vendorDetailRead(ctx, tx, a, id)
		if e != nil {
			return e
		}
		open := []erpwire.Row{}
		var owed money.Satang
		for _, bill := range out["bills"].([]erpwire.Row) {
			if bill["paid_at"] == nil || bill["paid_at"] == "" {
				amount, e := satang(bill["amount_satang"])
				if e != nil {
					return e
				}
				sum := new(big.Int).Add(big.NewInt(int64(owed)), big.NewInt(int64(amount)))
				if sum.Cmp(big.NewInt(int64(money.MaxSafeSatang))) > 0 || sum.Cmp(big.NewInt(-int64(money.MaxSafeSatang))) < 0 {
					return errors.New("Amount outside safe satang bounds")
				}
				owed = money.Satang(sum.Int64())
				open = append(open, bill)
			}
		}
		out["openBills"] = open
		out["amountOwedSatang"] = owed
		out["canManage"] = erpwire.Can(a.Role(), "purchase:manage")
		return nil
	})
	return out, e
}
func (s *Service) purchasesPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
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
	config := salesParseFacets(params, "purchases")
	vendor := text(params["vendor"])
	rows := []erpwire.Row{}
	out := erpwire.Row{"config": config, "canManage": erpwire.Can(a.Role(), "purchase:manage")}
	now := time.Now()
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		orders, e := all(ctx, tx, erpwire.Select{Table: "purchase_orders", Columns: []string{"*"}, Relations: []erpwire.Relation{{Name: "vendors", Table: "vendors", LocalColumn: "vendor_id", ForeignColumn: "id", Columns: []string{"name"}}}, Where: scope(a), Order: []erpwire.Order{{Column: "order_date", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		lines, e := all(ctx, tx, erpwire.Select{Table: "purchase_order_items", Columns: []string{"purchase_order_id", "quantity", "unit_cost_satang"}, Where: scope(a), Order: []erpwire.Order{{Column: "id"}}})
		if e != nil {
			return e
		}
		byOrder := map[string][]erpwire.Row{}
		for _, line := range lines {
			id := text(line["purchase_order_id"])
			byOrder[id] = append(byOrder[id], line)
		}
		for _, order := range orders {
			if validID(vendor) && text(order["vendor_id"]) != vendor {
				continue
			}
			vendorName := ""
			switch v := order["vendors"].(type) {
			case erpwire.Row:
				vendorName = text(v["name"])
			case map[string]any:
				vendorName = text(v["name"])
			}
			facetRow := erpwire.Row{"status": order["status"], "owner": order["created_by"]}
			if !salesMatches(config, facetRow, text(order["number"])+" "+vendorName, text(order["order_date"]), a, now) {
				continue
			}
			total, e := purchaseTotal(byOrder[text(order["id"])])
			if e != nil {
				return e
			}
			order["total"] = total
			rows = append(rows, order)
		}
		out["savedViews"], e = salesSavedViews(ctx, tx, a, "purchases")
		return e
	})
	if e != nil {
		return nil, e
	}
	out["rows"] = rows
	if validID(vendor) {
		out["vendorId"] = vendor
	}
	var key func(erpwire.Row) (string, string)
	if config.GroupBy != "" {
		key = func(row erpwire.Row) (string, string) {
			switch config.GroupBy {
			case "vendor":
				label := "Vendor"
				switch v := row["vendors"].(type) {
				case erpwire.Row:
					label = text(v["name"])
				case map[string]any:
					label = text(v["name"])
				}
				return text(row["vendor_id"]), label
			case "month":
				date := salesMonthKey(text(row["order_date"]))
				return date, date
			default:
				value := text(row["status"])
				return value, salesFacetLabel(value)
			}
		}
	}
	out["groups"], e = salesGroups(rows, key, "total")
	return out, e
}
func (s *Service) vendorsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
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
	config := salesParseFacets(params, "vendors")
	rows := []erpwire.Row{}
	out := erpwire.Row{"config": config, "canManage": erpwire.Can(a.Role(), "purchase:manage")}
	now := time.Now()
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		vendors, e := all(ctx, tx, erpwire.Select{Table: "vendors", Columns: []string{"*"}, Where: scope(a), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}})
		if e != nil {
			return e
		}
		for _, vendor := range vendors {
			status := "archived"
			if active, _ := vendor["active"].(bool); active {
				status = "active"
			}
			if salesMatches(config, erpwire.Row{"status": status, "owner": nil}, text(vendor["name"])+" "+text(vendor["tax_id"])+" "+text(vendor["email"]), text(vendor["created_at"]), a, now) {
				rows = append(rows, vendor)
			}
		}
		out["savedViews"], e = salesSavedViews(ctx, tx, a, "vendors")
		return e
	})
	if e != nil {
		return nil, e
	}
	out["rows"] = rows
	var key func(erpwire.Row) (string, string)
	if config.GroupBy != "" {
		key = func(row erpwire.Row) (string, string) {
			if config.GroupBy == "month" {
				date := salesMonthKey(text(row["created_at"]))
				return date, date
			}
			active, _ := row["active"].(bool)
			label := "Archived"
			if active {
				label = "Active"
			}
			return strconv.FormatBool(active), label
		}
	}
	out["groups"], e = salesGroups(rows, key, "")
	return out, e
}
func purchaseBillAmount(lines []erpwire.Row) (money.Satang, bool, error) {
	var total money.Satang
	unbilled := false
	for _, line := range lines {
		received, e := purchaseQuantity(line["received_quantity"], true, true)
		if e != nil {
			return 0, false, e
		}
		returned := int64(0)
		if line["returned_quantity"] != nil {
			returned, e = purchaseQuantity(line["returned_quantity"], true, true)
			if e != nil {
				return 0, false, e
			}
		}
		billed, e := purchaseQuantity(line["billed_quantity"], true, true)
		if e != nil {
			return 0, false, e
		}
		if billed > received {
			return 0, false, errors.New("Invalid billed quantity")
		}
		if returned > received {
			return 0, false, errors.New("Invalid returned quantity")
		}
		net := received - returned
		if net > billed {
			unbilled = true
		}
		var receivedAmount, billedAmount money.Satang
		if net > 0 {
			receivedAmount, e = purchaseLineAmount(purchaseDecimal(net), line["unit_cost_satang"])
			if e != nil {
				return 0, false, e
			}
		}
		if billed > 0 {
			billedAmount, e = purchaseLineAmount(purchaseDecimal(billed), line["unit_cost_satang"])
			if e != nil {
				return 0, false, e
			}
		}
		if receivedAmount > billedAmount {
			n := receivedAmount - billedAmount
			if n > money.MaxSafeSatang-total {
				return 0, false, errors.New("Amount outside safe satang bounds")
			}
			total += n
		}
	}
	return total, unbilled, nil
}
func (s *Service) purchasePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := purchaseID(raw)
	if e != nil {
		return nil, e
	}
	var out erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		out, e = purchaseDetailRead(ctx, tx, a, id)
		if e != nil {
			return e
		}
		warehouses, e := all(ctx, tx, erpwire.Select{Table: "warehouses", Columns: []string{"*"}, Where: scope(a), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}})
		if e != nil {
			return e
		}
		out["warehouses"] = warehouses
		count, e := tx.Select(ctx, erpwire.Select{Table: "stock_moves", Columns: []string{"id"}, Where: append(scope(a), eq("source_id", id)), Order: []erpwire.Order{{Column: "id"}}, Limit: 1, Count: true})
		if e != nil {
			return e
		}
		if count.Total == nil {
			return errors.New("Stock move count unavailable")
		}
		out["receiptCount"] = *count.Total
		sections, e := salesDocumentSections(ctx, tx, a, "purchase_order_id", id)
		if e != nil {
			return e
		}
		gridLines := []erpwire.Row{}
		lines := out["lines"].([]erpwire.Row)
		for _, line := range lines {
			copy := erpwire.Row{}
			for k, v := range line {
				copy[k] = v
			}
			copy["unit_price_satang"] = line["unit_cost_satang"]
			extras := []string{}
			for _, key := range []string{"received_quantity", "returned_quantity", "billed_quantity"} {
				q, e := purchaseQuantity(line[key], true, true)
				if e != nil {
					return e
				}
				extras = append(extras, purchaseDecimal(q).String())
			}
			copy["extras"] = extras
			gridLines = append(gridLines, copy)
		}
		out["lineRows"], e = salesGridRows(gridLines, sections)
		if e != nil {
			return e
		}
		policy, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"over_receipt_tolerance_percent", "purchase_approval_threshold_satang"}, Where: scope(a)})
		if e != nil {
			return purchaseReadError(e, "Purchase policy unavailable")
		}
		out["policy"] = policy
		manage := erpwire.Can(a.Role(), "purchase:manage")
		order := out["order"].(erpwire.Row)
		editable := manage && text(order["status"]) == "draft"
		out["canManage"] = manage
		out["editable"] = editable
		out["options"] = erpwire.Row{"products": []erpwire.Row{}, "vendors": []erpwire.Row{}}
		if editable {
			out["options"], e = purchaseOptionsRead(ctx, tx, a)
			if e != nil {
				return e
			}
		}
		total, e := purchaseTotal(lines)
		if e != nil {
			return e
		}
		out["totalSatang"] = total
		amount, billable, e := purchaseBillAmount(lines)
		if e != nil {
			return e
		}
		out["unbilledSatang"] = amount
		out["billable"] = billable
		var tolerance any = json.Number("0")
		if policy != nil && policy["over_receipt_tolerance_percent"] != nil {
			tolerance = policy["over_receipt_tolerance_percent"]
		}
		out["tolerancePercent"] = tolerance
		receivable, hasReceipts := false, false
		for _, line := range lines {
			received, e := purchaseQuantity(line["received_quantity"], true, true)
			if e != nil {
				return e
			}
			if received > 0 {
				hasReceipts = true
			}
			limit, e := purchaseReceiptLimit(line, tolerance)
			if e != nil {
				return e
			}
			if big.NewRat(received, 1000).Cmp(limit) < 0 {
				receivable = true
			}
		}
		out["receivable"] = has([]string{"confirmed", "received", "billed"}, text(order["status"])) && receivable
		out["hasReceipts"] = hasReceipts
		out["recordRef"] = erpwire.Row{"recordType": "purchase_order", "recordId": id}
		out["publicReference"], e = salesPublicReference(ctx, tx, a, "purchase_order", id)
		if e != nil {
			return e
		}
		return nil
	})
	return out, e
}
func purchaseReceiptLimit(line erpwire.Row, tolerance any) (*big.Rat, error) {
	r, e := purchaseRational(tolerance, true)
	if e != nil {
		return nil, e
	}
	r.Mul(r, big.NewRat(100, 1))
	if !r.IsInt() || !r.Num().IsInt64() {
		return nil, errors.New("Invalid receipt tolerance")
	}
	q, e := purchaseQuantity(line["quantity"], false, true)
	if e != nil {
		return nil, e
	}
	allowed := new(big.Int).Mul(big.NewInt(q), new(big.Int).Add(big.NewInt(10000), r.Num()))
	allowed.Quo(allowed, big.NewInt(10000))
	limit := new(big.Rat).SetFrac(allowed, big.NewInt(1000))
	received, e := purchaseRational(line["received_quantity"], true)
	if e != nil {
		return nil, e
	}
	if received.Cmp(limit) > 0 {
		limit = received
	}
	return limit, nil
}
func (s *Service) purchasePDF(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := purchaseID(raw)
	if e != nil {
		return nil, e
	}
	var model erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		detail, e := purchaseDetailRead(ctx, tx, a, id)
		if e != nil {
			return e
		}
		order := detail["order"].(erpwire.Row)
		lines := detail["lines"].([]erpwire.Row)
		sections, e := salesDocumentSections(ctx, tx, a, "purchase_order_id", id)
		if e != nil {
			return e
		}
		reference, e := salesPublicReference(ctx, tx, a, "purchase_order", id)
		if e != nil {
			return e
		}
		total, e := purchaseTotal(lines)
		if e != nil {
			return e
		}
		vendor := erpwire.Row{}
		switch v := order["vendors"].(type) {
		case erpwire.Row:
			vendor = v
		case map[string]any:
			vendor = erpwire.Row(v)
		}
		name := text(vendor["name"])
		if name == "" {
			name = "Vendor"
		}
		kind := "Purchase order"
		if has([]string{"draft", "sent"}, text(order["status"])) {
			kind = "Request for quotation"
		}
		items := []erpwire.Row{}
		for _, line := range lines {
			amount, e := purchaseLineAmount(line["quantity"], line["unit_cost_satang"])
			if e != nil {
				return e
			}
			items = append(items, erpwire.Row{"description": text(line["description"]) + " (" + text(line["unit"]) + ")", "quantity": line["quantity"], "unit_price_satang": line["unit_cost_satang"], "amount_satang": amount})
		}
		model = erpwire.Row{"kind": kind, "number": order["number"], "status": order["status"], "orgName": a.OrgName(), "clientName": name, "buyerAddress": vendor["address"], "buyerTaxId": vendor["tax_id"], "issueDate": order["order_date"], "notes": order["notes"], "subtotalSatang": total, "totalSatang": total, "sections": sections, "items": items, "publicReference": reference["display"]}
		return nil
	})
	if e != nil {
		return nil, e
	}
	if s.pdf == nil {
		return nil, errors.New("PDF renderer is required")
	}
	body, e := s.pdf.RenderPDF(ctx, "purchase_order", model)
	if e != nil {
		return nil, e
	}
	return RouteResponse{Status: 200, Headers: map[string]string{"Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store"}, Body: body}, nil
}
