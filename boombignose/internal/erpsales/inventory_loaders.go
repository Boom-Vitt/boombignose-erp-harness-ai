package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"net/url"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func invRows(v any) ([]erpwire.Row, bool) {
	data, e := json.Marshal(v)
	if e != nil {
		return nil, false
	}
	var rows []erpwire.Row
	if erpwire.DecodeJSON(data, &rows) != nil || rows == nil {
		return nil, false
	}
	return rows, true
}
func invNullableString(v any) bool {
	if v == nil {
		return true
	}
	_, ok := v.(string)
	return ok
}
func invFinite(v any) bool { _, ok := invRat(v, false); return ok }
func invSnapshot(raw json.RawMessage, a erpwire.Actor) (erpwire.Row, error) {
	var snapshot erpwire.Row
	if erpwire.DecodeJSON(raw, &snapshot) != nil {
		return nil, invDataError()
	}
	products, ok := invRows(snapshot["products"])
	if !ok {
		return nil, invDataError()
	}
	balances, ok := invRows(snapshot["balances"])
	if !ok {
		return nil, invDataError()
	}
	for _, p := range products {
		if !validID(text(p["id"])) || text(p["org_id"]) != a.OrgID() {
			return nil, invDataError()
		}
		for _, key := range []string{"name", "unit", "created_at", "updated_at"} {
			if _, ok := p[key].(string); !ok {
				return nil, invDataError()
			}
		}
		for _, key := range []string{"sku", "description"} {
			v, present := p[key]
			if !present || !invNullableString(v) {
				return nil, invDataError()
			}
		}
		for _, key := range []string{"active", "is_stockable"} {
			if _, ok := p[key].(bool); !ok {
				return nil, invDataError()
			}
		}
		if !has([]string{"service", "goods"}, text(p["type"])) {
			return nil, invDataError()
		}
		for _, key := range []string{"list_price_satang", "cost_satang"} {
			if _, ok := invNumberInt(p[key], 0, erpwire.MaxSafeInteger); !ok {
				return nil, invDataError()
			}
		}
		if _, ok := invNumberInt(p["tax_rate_bps"], 0, 10000); !ok {
			return nil, invDataError()
		}
		if _, ok := p["lead_days"]; !ok {
			p["lead_days"] = int64(0)
		}
		if _, ok := invNumberInt(p["lead_days"], 0, 3650); !ok {
			return nil, invDataError()
		}
		for _, key := range []string{"quantity", "on_order", "reserved_quantity", "reorder_min", "reorder_qty"} {
			if !invFinite(p[key]) {
				return nil, invDataError()
			}
		}
		vendor, present := p["default_vendor_id"]
		if !present || vendor != nil && !validID(text(vendor)) {
			return nil, invDataError()
		}
		if _, ok := invNumberInt(p["value_satang"], -erpwire.MaxSafeInteger, erpwire.MaxSafeInteger); !ok {
			return nil, invDataError()
		}
	}
	for _, b := range balances {
		if text(b["org_id"]) != a.OrgID() || !validID(text(b["product_id"])) || !validID(text(b["warehouse_id"])) || !invFinite(b["quantity"]) {
			return nil, invDataError()
		}
		if _, ok := invNumberInt(b["average_cost_satang"], 0, erpwire.MaxSafeInteger); !ok {
			return nil, invDataError()
		}
		if _, ok := invNumberInt(b["value_satang"], -erpwire.MaxSafeInteger, erpwire.MaxSafeInteger); !ok {
			return nil, invDataError()
		}
	}
	return erpwire.Row{"products": products, "balances": balances}, nil
}
func invReadError(err error, message string) error {
	for _, known := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, known) {
			return err
		}
	}
	return errors.New(message)
}
func invSnapshotRead(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, warehouse, product string) (erpwire.Row, error) {
	result, e := invSnapshotSelect(ctx, tx, a, warehouse, product)
	if e != nil {
		return nil, invReadError(e, "Inventory data unavailable. Please reload.")
	}

	warehouses, e := all(ctx, tx, erpwire.Select{Table: "warehouses", Columns: []string{"*"}, Where: scope(a), Order: []erpwire.Order{{Column: "code"}, {Column: "id"}}})
	if e != nil {
		return nil, invReadError(e, "Inventory data unavailable. Please reload.")
	}
	vendors, e := all(ctx, tx, erpwire.Select{Table: "vendors", Columns: []string{"id", "name", "active"}, Where: scope(a), Order: []erpwire.Order{{Column: "id"}}})
	if e != nil {
		return nil, invReadError(e, "Inventory data unavailable. Please reload.")
	}
	result["warehouses"] = warehouses
	result["vendors"] = vendors
	return result, nil
}
func (s *Service) inventoryLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
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
	warehouse, product := text(params["warehouse"]), text(params["product"])
	if !validID(warehouse) {
		warehouse = ""
	}
	if !validID(product) {
		product = ""
	}
	var result erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		result, e = invSnapshotRead(ctx, tx, a, warehouse, product)
		return e
	})
	if e != nil {
		return nil, e
	}
	rows, _ := result["products"].([]erpwire.Row)
	total := money.Satang(0)
	for _, p := range rows {
		v, e := satang(p["value_satang"])
		if e != nil {
			return nil, e
		}
		if v > 0 && total > money.MaxSafeSatang-v || v < 0 && total < -money.MaxSafeSatang-v {
			return nil, errors.New("Amount outside safe satang bounds")
		}
		total += v
	}
	result["stockValueSatang"] = int64(total)
	result["warehouse"] = nilText(warehouse)
	result["product"] = nilText(product)
	return result, nil
}
func (s *Service) inventoryAdjustLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.inventoryFormLoad(ctx, a, raw, true)
}
func (s *Service) inventoryTransferLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.inventoryFormLoad(ctx, a, raw, false)
}
func (s *Service) inventoryFormLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage, adjust bool) (any, error) {
	if e := authorize(a, "inventory:manage"); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var result erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; result, e = invSnapshotRead(ctx, tx, a, "", ""); return e })
	if e != nil {
		return nil, e
	}
	if adjust {
		warehouses, _ := result["warehouses"].([]erpwire.Row)
		active := []erpwire.Row{}
		for _, w := range warehouses {
			if w["active"] == true {
				active = append(active, w)
			}
		}
		result["warehouses"] = active
	}
	result["scope"] = a.OrgID() + "/" + a.UserID()
	return result, nil
}
func (s *Service) inventoryWarehousesLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var result erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		result, e = invSnapshotRead(ctx, tx, a, "", "")
		if e != nil {
			return e
		}
		settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"allow_negative_stock"}, Where: scope(a)})
		if e != nil {
			return invReadError(e, "Stock policy unavailable")
		}
		result["allowNegativeStock"] = settings["allow_negative_stock"] == true
		return nil
	})
	if e != nil {
		return nil, e
	}
	result["canManage"] = erpwire.Can(a.Role(), "inventory:manage")
	return result, nil
}
func invReplenishmentQuantity(product erpwire.Row) (json.Number, error) {
	values := map[string]*big.Rat{}
	for _, key := range []string{"reorder_min", "quantity", "on_order", "reorder_qty"} {
		r, ok := invRat(product[key], false)
		if !ok {
			return "", invDataError()
		}
		values[key] = r
	}
	shortfall := new(big.Rat)
	for i, key := range []string{"reorder_min", "quantity", "on_order"} {
		scaled := new(big.Rat).Mul(values[key], big.NewRat(1000, 1))
		rounded := invRoundRat(scaled)
		term := new(big.Rat).SetInt(rounded)
		if i == 0 {
			shortfall.Set(term)
		} else {
			shortfall.Sub(shortfall, term)
		}
	}
	shortfall.Quo(shortfall, big.NewRat(1000, 1))
	if values["reorder_qty"].Sign() <= 0 || shortfall.Sign() <= 0 {
		return json.Number("0"), nil
	}
	if values["reorder_qty"].Cmp(shortfall) > 0 {
		return invDecimal(values["reorder_qty"]), nil
	}
	return invDecimal(shortfall), nil
}
func invRoundRat(r *big.Rat) *big.Int {
	n := new(big.Int).Mul(r.Num(), big.NewInt(2))
	n.Add(n, r.Denom())
	d := new(big.Int).Mul(r.Denom(), big.NewInt(2))
	q, rem := new(big.Int), new(big.Int)
	q.QuoRem(n, d, rem)
	if n.Sign() < 0 && rem.Sign() != 0 {
		q.Sub(q, big.NewInt(1))
	}
	return q
}
func (s *Service) inventoryReplenishLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var result erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		result, e = invSnapshotRead(ctx, tx, a, "", "")
		if e != nil {
			return e
		}
		preview, e := invReplenishmentPlan(result)
		if e != nil {
			return e
		}
		result["preview"] = preview
		return nil
	})
	if e != nil {
		return nil, e
	}
	products, _ := result["products"].([]erpwire.Row)
	active := []erpwire.Row{}
	groups := []erpwire.Row{}
	indexes := map[string]int{}
	for _, p := range products {
		if p["active"] != true {
			continue
		}
		active = append(active, p)
		q, e := invReplenishmentQuantity(p)
		if e != nil {
			return nil, e
		}
		if q == "0" {
			continue
		}
		vendor := text(p["default_vendor_id"])
		i, exists := indexes[vendor]
		if !exists {
			i = len(groups)
			indexes[vendor] = i
			groups = append(groups, erpwire.Row{"vendorId": nilText(vendor), "products": []erpwire.Row{}})
		}
		p["orderQuantity"] = q
		groups[i]["products"] = append(groups[i]["products"].([]erpwire.Row), p)
	}
	result["active"] = active
	result["groups"] = groups
	result["canManage"] = erpwire.Can(a.Role(), "inventory:manage")
	return result, nil
}

var invMoveKinds = []string{"receipt", "delivery", "adjustment_in", "adjustment_out", "transfer_in", "transfer_out", "vendor_return", "customer_return"}

func invMoveFacets(params erpwire.Row) erpwire.Row {
	f := salesParseFacets(params, "inventory")
	result := erpwire.Row{}
	for key, value := range map[string]string{"q": f.Q, "status": f.Status, "period": f.Period, "mine": f.Mine, "warehouse": f.Warehouse, "product": f.Product, "sourceId": f.SourceID} {
		if value != "" {
			result[key] = value
		}
	}
	return result
}
func invFacetQuery(config erpwire.Row) string {
	parts := []string{}
	for _, key := range []string{"q", "status", "period", "mine", "groupBy", "warehouse", "product", "sourceId"} {
		if value := text(config[key]); value != "" {
			parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(value))
		}
	}
	return strings.Join(parts, "&")
}
func invSignedQuantity(kind string, value any) (json.Number, error) {
	r, ok := invRat(value, false)
	if !ok || r.Sign() <= 0 || r.Cmp(big.NewRat(999999999999, 1000)) > 0 || !has(invMoveKinds, kind) {
		return "", errors.New("Enter a positive quantity with up to three decimals")
	}
	scaled := new(big.Rat).Mul(r, big.NewRat(1000, 1))
	if !scaled.IsInt() {
		return "", errors.New("Enter a positive quantity with up to three decimals")
	}
	if has([]string{"delivery", "adjustment_out", "transfer_out", "vendor_return"}, kind) {
		r.Neg(r)
	}
	return invDecimal(r), nil
}
func (s *Service) inventoryMovesLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
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
	config := invMoveFacets(params)
	p := erpwire.Row{"p_org_id": a.OrgID()}
	for key, column := range map[string]string{"warehouse": "p_warehouse_id", "product": "p_product_id", "sourceId": "p_source_id", "q": "p_query"} {
		if value := text(config[key]); value != "" {
			p[column] = value
		}
	}
	if before := text(params["before"]); regexpBefore(before) {
		if n, ok := invCoercedInt(before, 1, erpwire.MaxSafeInteger); ok {
			p["p_before"] = n
		}
	}
	if status := text(config["status"]); status != "" {
		p["p_kinds"] = strings.Split(status, ",")
	}
	if config["mine"] == "1" {
		p["p_actor_id"] = a.UserID()
	}
	if period := text(config["period"]); period != "" {
		start, end := salesPeriodRange(period, time.Now())
		p["p_start"] = start + "T00:00:00+07:00"
		p["p_end"] = end + "T00:00:00+07:00"
	}
	var result erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		result, e = invSnapshotRead(ctx, tx, a, "", "")
		if e != nil {
			return e
		}
		views, e := salesSavedViews(ctx, tx, a, "inventory")
		if e != nil {
			return invReadError(e, "Saved views unavailable. Please reload.")
		}
		result["views"] = views
		moves, e := invMovesPage(ctx, tx, a, p)
		if e != nil {
			return invReadError(e, "Stock ledger unavailable")
		}
		more := len(moves) > 100
		if more {
			moves = moves[:100]
		}
		for _, move := range moves {
			q, e := invSignedQuantity(text(move["kind"]), move["quantity"])
			if e != nil {
				return e
			}
			move["signedQuantity"] = q
		}
		result["moves"] = moves
		result["older"] = nil
		if more {
			result["older"] = "/inventory/moves?" + invFacetQuery(config) + "&before=" + invString(moves[len(moves)-1]["sequence"])
		}
		result["latest"] = nil
		if p["p_before"] != nil {
			result["latest"] = "/inventory/moves?" + invFacetQuery(config)
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	result["config"] = config
	return result, nil
}
func regexpBefore(s string) bool {
	if s == "" || s[0] < '1' || s[0] > '9' {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
func (s *Service) inventoryDocumentsLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
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
	source := text(params["sourceId"])
	q := erpwire.Select{Table: "stock_documents", Columns: []string{"*"}, Where: scope(a), Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}}
	if validID(source) {
		q.Any = [][]erpwire.Predicate{{eq("purchase_order_id", source), eq("invoice_id", source)}}
	}
	result := erpwire.Row{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		docs, e := all(ctx, tx, q)
		if e != nil {
			return e
		}
		result["documents"] = docs
		settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"public_document_refs_enabled"}, Where: scope(a)})
		if e != nil {
			return e
		}
		enabled := settings["public_document_refs_enabled"] == true
		result["publicRefs"] = enabled
		displays := [][2]any{}
		if enabled && len(docs) > 0 {
			refs, e := all(ctx, tx, erpwire.Select{Table: "document_public_refs", Columns: []string{"record_id", "reference", "kind"}, Where: append(scope(a), erpwire.Predicate{Column: "kind", Op: erpwire.In, Value: []string{"receipt", "delivery"}}), Order: []erpwire.Order{{Column: "record_id"}}})
			if e != nil {
				return e
			}
			indexes := map[string]int{}
			for _, ref := range refs {
				if display := salesReferenceDisplay(text(ref["reference"]), text(ref["kind"])); display != "" {
					id := text(ref["record_id"])
					if index, exists := indexes[id]; exists {
						displays[index][1] = display
					} else {
						indexes[id] = len(displays)
						displays = append(displays, [2]any{id, display})
					}
				}
			}
		}
		result["displays"] = erpwire.Map(displays)
		return nil
	})
	if e != nil {
		return nil, e
	}
	result["canIssue"] = erpwire.Can(a.Role(), "record:write")
	return result, nil
}
