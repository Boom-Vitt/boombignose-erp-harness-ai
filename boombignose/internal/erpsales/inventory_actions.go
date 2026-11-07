package erpsales

import (
	"context"
	"encoding/json"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

var invNumeric = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

func invRat(v any, coerce bool) (*big.Rat, bool) {
	var s string
	switch n := v.(type) {
	case json.Number:
		s = n.String()
	case int:
		s = big.NewInt(int64(n)).String()
	case int64:
		s = big.NewInt(n).String()
	case int32:
		s = big.NewInt(int64(n)).String()
	case string:
		if !coerce {
			return nil, false
		}
		s = jsTrim(n)
		if s == "" {
			s = "0"
		}
	case bool:
		if !coerce {
			return nil, false
		}
		s = "0"
		if n {
			s = "1"
		}
	case nil:
		if !coerce {
			return nil, false
		}
		s = "0"
	default:
		return nil, false
	}
	if len(s) > 256 || !invNumeric.MatchString(s) {
		return nil, false
	}
	if i := strings.IndexAny(s, "eE"); i >= 0 {
		exponent, err := strconv.ParseInt(s[i+1:], 10, 32)
		if err != nil || exponent < -1000 || exponent > 1000 {
			return nil, false
		}
	}
	r, ok := new(big.Rat).SetString(s)
	return r, ok
}
func invCoercedInt(v any, min, max int64) (int64, bool) {
	r, ok := invRat(v, true)
	if !ok || !r.IsInt() || !r.Num().IsInt64() {
		return 0, false
	}
	n := r.Num().Int64()
	return n, n >= min && n <= max
}
func invNumberInt(v any, min, max int64) (int64, bool) {
	r, ok := invRat(v, false)
	if !ok || !r.IsInt() || !r.Num().IsInt64() {
		return 0, false
	}
	n := r.Num().Int64()
	return n, n >= min && n <= max
}
func invDecimal(r *big.Rat) json.Number {
	denominator := new(big.Int).Set(r.Denom())
	counts := [2]int{}
	for i, factor := range []int64{2, 5} {
		divisor := big.NewInt(factor)
		for {
			quotient, remainder := new(big.Int), new(big.Int)
			quotient.QuoRem(denominator, divisor, remainder)
			if remainder.Sign() != 0 {
				break
			}
			denominator = quotient
			counts[i]++
		}
	}
	scale := max(counts[0], counts[1])
	s := r.FloatString(scale)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	if s == "" || s == "-0" {
		s = "0"
	}
	return json.Number(s)
}
func invQuantity(v any, positive bool) (json.Number, int64, bool) {
	r, ok := invRat(v, true)
	if !ok || r.Sign() < 0 || r.Cmp(big.NewRat(999999999999, 1000)) > 0 || positive && r.Sign() == 0 {
		return "", 0, false
	}
	scaled := new(big.Rat).Mul(r, big.NewRat(1000, 1))
	rounded := new(big.Int).Quo(new(big.Int).Add(new(big.Int).Mul(scaled.Num(), big.NewInt(2)), scaled.Denom()), new(big.Int).Mul(scaled.Denom(), big.NewInt(2)))
	diff := new(big.Rat).Abs(new(big.Rat).Sub(scaled, new(big.Rat).SetInt(rounded)))
	if diff.Cmp(big.NewRat(1, 100000)) >= 0 || !rounded.IsInt64() {
		return "", 0, false
	}
	return invDecimal(r), rounded.Int64(), true
}
func invUUID(v any) bool { return salesUUID(text(v)) }
func invReason(v any) (string, bool) {
	s, ok := v.(string)
	s = jsTrim(s)
	return s, ok && s != "" && jsLength(s) <= 2000
}
func invObject(args erpwire.Arguments, index int) (erpwire.Row, bool) {
	var v erpwire.Row
	if args.Decode(index, &v) != nil || v == nil {
		return nil, false
	}
	return v, true
}
func invResult(e error, rejected bool) (any, error) {
	if e == nil {
		return response("", "/inventory", "/products"), nil
	}
	value, err := failure(e)
	if err != nil {
		return nil, err
	}
	if rejected && invSQLState(e) == "P0001" {
		if r, ok := value.(erpwire.ActionResponse); ok {
			if m, ok := r.Value.(map[string]any); ok {
				m["rejected"] = true
			} else if m, ok := r.Value.(erpwire.Row); ok {
				m["rejected"] = true
			} else {
				r.Value = erpwire.Row{"error": invBusinessMessage(e), "rejected": true}
			}
			return r, nil
		}
	}
	return value, nil
}
func (s *Service) inventoryCommand(ctx context.Context, a erpwire.Actor, command string, p erpwire.Row, rejected bool) (any, error) {
	p["p_org_id"] = a.OrgID()
	e := s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { _, e := tx.Command(ctx, command, p); return e })
	return invResult(e, rejected)
}
func (s *Service) saveWarehouse(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	v, ok := invObject(args, 0)
	message := "Enter a code, name and valid warehouse details."
	if !ok {
		return invalid(message)
	}
	id, present := v["id"]
	if !present || (id != nil && !validID(text(id))) {
		return invalid(message)
	}
	p := erpwire.Row{"p_id": id}
	for key, max := range map[string]int{"code": 40, "name": 200, "address": 2000} {
		value, ok := v[key].(string)
		value = jsTrim(value)
		if !ok || jsLength(value) > max || (key != "address" && value == "") {
			return invalid(message)
		}
		if key == "address" {
			p["p_"+key] = nilText(value)
		} else {
			p["p_"+key] = value
		}
	}
	for key, column := range map[string]string{"is_default": "p_default", "active": "p_active"} {
		b, ok := v[key].(bool)
		if !ok {
			return invalid(message)
		}
		p[column] = b
	}
	return s.inventoryCommand(ctx, a, "save_warehouse", p, false)
}
func (s *Service) deleteWarehouse(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var id string
	if args.Decode(0, &id) != nil || !validID(id) {
		return invalid("Invalid warehouse")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "delete_warehouse", erpwire.Row{"p_org_id": a.OrgID(), "p_id": id})
		return e
	})
	if invSQLState(e) == "23503" {
		return invalid("This warehouse has stock history. Deactivate it instead.")
	}
	return invResult(e, false)
}
func (s *Service) adjustStock(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	v, ok := invObject(args, 0)
	message := "Choose a product and warehouse, and enter a nonnegative count and reason."
	if !ok || !validID(text(v["product_id"])) || !validID(text(v["warehouse_id"])) || !invUUID(v["key"]) {
		return invalid(message)
	}
	q, _, ok := invQuantity(v["quantity"], false)
	if _, exists := v["quantity"]; !exists {
		ok = false
	}
	reason, valid := invReason(v["reason"])
	if !ok || !valid {
		return invalid(message)
	}
	p := erpwire.Row{"p_product_id": v["product_id"], "p_warehouse_id": v["warehouse_id"], "p_count": q, "p_reason": reason, "p_key": v["key"]}
	if cost, exists := v["unit_cost_satang"]; exists {
		if cost == nil {
			p["p_unit_cost_satang"] = nil
		} else if n, ok := invNumberInt(cost, 0, erpwire.MaxSafeInteger); ok {
			p["p_unit_cost_satang"] = n
		} else {
			return invalid(message)
		}
	}
	return s.inventoryCommand(ctx, a, "adjust_stock", p, true)
}
func invDeliveryLines(raw json.RawMessage) ([]erpwire.Row, bool) {
	var lines []erpwire.Row
	if erpwire.DecodeJSON(raw, &lines) != nil || len(lines) == 0 {
		return nil, false
	}
	out := make([]erpwire.Row, 0, len(lines))
	for _, line := range lines {
		if !validID(text(line["id"])) {
			return nil, false
		}
		row := erpwire.Row{"id": line["id"]}
		for _, k := range []string{"delivered_quantity", "previous_delivered_quantity"} {
			v, present := line[k]
			q, _, ok := invQuantity(v, false)
			if !present || !ok {
				return nil, false
			}
			row[k] = q
		}
		out = append(out, row)
	}
	return out, true
}
func (s *Service) deliverInvoice(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 4)
	if e != nil {
		return nil, e
	}
	var id string
	if args.Decode(0, &id) != nil || !validID(id) {
		return invalid("Invalid delivery")
	}
	p := erpwire.Row{"p_invoice_id": id}
	if args.Present(1) {
		var warehouse string
		if args.Decode(1, &warehouse) != nil || !validID(warehouse) {
			return invalid("Invalid delivery")
		}
		p["p_warehouse_id"] = warehouse
	}
	if args.Present(2) {
		lines, ok := invDeliveryLines(args[2])
		if !ok {
			return invalid("Invalid delivery")
		}
		p["p_lines"] = lines
	}
	if args.Present(3) {
		var date string
		if args.Decode(3, &date) != nil || !validDate(date) {
			return invalid("Invalid delivery")
		}
		p["p_date"] = date
	}
	r, e := s.inventoryCommand(ctx, a, "deliver_invoice", p, false)
	if e != nil {
		return nil, e
	}
	if result, ok := r.(erpwire.ActionResponse); ok {
		if m, ok := result.Value.(map[string]any); ok && m["error"] != nil {
			return r, nil
		}
		if m, ok := result.Value.(erpwire.Row); ok && m["error"] != nil {
			return r, nil
		}
		result.Refresh = append(result.Refresh, "/finance/invoices/"+id, "/dashboard", "/reports")
		return result, nil
	}
	return r, nil
}
func (s *Service) returnInvoiceDelivery(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 3, 3)
	if e != nil {
		return nil, e
	}
	var id, move string
	if args.Decode(0, &id) != nil || args.Decode(1, &move) != nil || !validID(id) || !validID(move) {
		return invalid("Invalid return")
	}
	var value any
	if args.Decode(2, &value) != nil {
		return invalid("Invalid return")
	}
	q, _, ok := invQuantity(value, false)
	if !ok {
		return invalid("Invalid return")
	}
	p := erpwire.Row{"p_org_id": a.OrgID(), "p_invoice_id": id, "p_move_id": move, "p_returned_quantity": q}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { _, e := tx.Command(ctx, "return_invoice_delivery", p); return e })
	if e != nil {
		return failure(e)
	}
	return response("", "/inventory", "/products", "/finance/invoices/"+id, "/dashboard", "/reports"), nil
}
func (s *Service) saveReorder(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	v, ok := invObject(args, 0)
	if !ok || !validID(text(v["product_id"])) {
		return invalid("Invalid replenishment rule")
	}
	vendor, ok := v["default_vendor_id"].(string)
	if !ok || (vendor != "" && !validID(vendor)) {
		return invalid("Invalid replenishment rule")
	}
	min, _, ok := invQuantity(v["reorder_min"], false)
	qty, _, ok2 := invQuantity(v["reorder_qty"], true)
	if _, exists := v["reorder_min"]; !exists {
		ok = false
	}
	if _, exists := v["reorder_qty"]; !exists {
		ok2 = false
	}
	days := int64(0)
	if value, exists := v["lead_days"]; exists {
		var daysOK bool
		days, daysOK = invCoercedInt(value, 0, 3650)
		if !daysOK {
			return invalid("Invalid replenishment rule")
		}
	}
	if !ok || !ok2 {
		return invalid("Invalid replenishment rule")
	}
	return s.inventoryCommand(ctx, a, "save_reorder_rule", erpwire.Row{"p_product_id": v["product_id"], "p_vendor_id": nilText(vendor), "p_min": min, "p_quantity": qty, "p_lead_days": days}, false)
}
func (s *Service) createReplenishment(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	if e := authorize(a, "purchase:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var id string
	if args.Decode(0, &id) != nil || !validID(id) {
		return invalid("Invalid vendor")
	}
	var purchase string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		data, e := tx.Command(ctx, "create_replenishment_rfq", erpwire.Row{"p_org_id": a.OrgID(), "p_vendor_id": id})
		if e != nil {
			return e
		}
		if erpwire.DecodeJSON(data, &purchase) != nil || purchase == "" {
			return invBusiness("Replenishment did not return a purchase order")
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	return response("/purchases/"+purchase, "/purchases", "/inventory", "/products"), nil
}
func (s *Service) setNegativeStock(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var allow bool
	if args.Null(0) || args.Decode(0, &allow) != nil {
		return invalid("Invalid stock policy")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "org_settings", Rows: []erpwire.Row{{"org_id": a.OrgID(), "allow_negative_stock": allow}}, ConflictColumns: []string{"org_id"}})
		return e
	})
	if e != nil {
		return failure(e)
	}
	label := "blocked"
	if allow {
		label = "allowed"
	}
	s.audit(ctx, a, "settings", "", "stock_policy_updated", "Negative stock "+label, nil)
	return response("", "/inventory", "/products"), nil
}
func (s *Service) transferStock(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	v, ok := invObject(args, 0)
	message := "Choose different warehouses, a positive quantity and a reason."
	if !ok || !validID(text(v["product_id"])) || !validID(text(v["from_warehouse_id"])) || !validID(text(v["to_warehouse_id"])) || v["from_warehouse_id"] == v["to_warehouse_id"] || !invUUID(v["key"]) {
		return invalid(message)
	}
	qty, _, ok := invQuantity(v["quantity"], true)
	reason, ok2 := invReason(v["reason"])
	if !ok || !ok2 {
		return invalid(message)
	}
	return s.inventoryCommand(ctx, a, "transfer_stock", erpwire.Row{"p_product_id": v["product_id"], "p_from_warehouse_id": v["from_warehouse_id"], "p_to_warehouse_id": v["to_warehouse_id"], "p_quantity": qty, "p_reason": reason, "p_key": v["key"]}, true)
}
func (s *Service) savePurchasingPolicy(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "settings:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	v, ok := invObject(args, 0)
	message := "Enter a tolerance from 0 to 100 with up to two decimals."
	if !ok {
		return invalid(message)
	}
	enabled, ok := v["scheduled_replenishment_enabled"].(bool)
	if !ok {
		return invalid(message)
	}
	threshold, present := v["purchase_approval_threshold_satang"]
	if !present {
		return invalid(message)
	}
	if threshold != nil {
		n, ok := invNumberInt(threshold, 0, erpwire.MaxSafeInteger)
		if !ok {
			return invalid(message)
		}
		threshold = n
	}
	tolerance, ok := invRat(v["over_receipt_tolerance_percent"], false)
	if !ok || tolerance.Sign() < 0 || tolerance.Cmp(big.NewRat(100, 1)) > 0 {
		return invalid(message)
	}
	scaled := new(big.Rat).Mul(tolerance, big.NewRat(100, 1))
	difference := new(big.Rat).Abs(new(big.Rat).Sub(scaled, new(big.Rat).SetInt(invRoundRat(scaled))))
	if difference.Cmp(big.NewRat(1, 100000)) >= 0 {
		return invalid(message)
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "org_settings", Rows: []erpwire.Row{{"org_id": a.OrgID(), "scheduled_replenishment_enabled": enabled, "purchase_approval_threshold_satang": threshold, "over_receipt_tolerance_percent": invDecimal(tolerance)}}, ConflictColumns: []string{"org_id"}})
		return e
	})
	if e != nil {
		return failure(e)
	}
	s.audit(ctx, a, "settings", "", "purchase_policy_updated", "Updated purchasing policy", nil)
	return response("", "/settings/purchasing", "/purchases"), nil
}
