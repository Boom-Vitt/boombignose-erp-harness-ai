package erpsales

import (
	"context"
	"encoding/json"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// The shared ReadRPC allowlist excludes inventory reads; Select keeps the same repeatable-read snapshot.
func invSnapshotSelect(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, warehouse, product string) (erpwire.Row, error) {
	productWhere := append(scope(a), eq("is_stockable", true))
	balanceWhere := scope(a)
	relatedWhere := scope(a)
	if product != "" {
		productWhere = append(productWhere, eq("id", product))
		balanceWhere = append(balanceWhere, eq("product_id", product))
		relatedWhere = append(relatedWhere, eq("product_id", product))
	}
	if warehouse != "" {
		balanceWhere = append(balanceWhere, eq("warehouse_id", warehouse))
	}
	products, e := all(ctx, tx, erpwire.Select{Table: "products", Columns: []string{"*"}, Where: productWhere, Order: ordered("name", "id")})
	if e != nil {
		return nil, e
	}
	balances, e := all(ctx, tx, erpwire.Select{Table: "stock_on_hand", Columns: []string{"*"}, Where: balanceWhere, Order: ordered("product_id", "warehouse_id")})
	if e != nil {
		return nil, e
	}
	forecasts, e := all(ctx, tx, erpwire.Select{Table: "inventory_forecast", Columns: []string{"product_id", "on_order", "reserved_quantity"}, Where: relatedWhere, Order: ordered("product_id")})
	if e != nil {
		return nil, e
	}
	leads, e := all(ctx, tx, erpwire.Select{Table: "product_vendor_lead_times", Columns: []string{"product_id", "vendor_id", "lead_days"}, Where: relatedWhere, Order: ordered("product_id", "vendor_id")})
	if e != nil {
		return nil, e
	}
	forecastByProduct := map[string]erpwire.Row{}
	for _, f := range forecasts {
		forecastByProduct[text(f["product_id"])] = f
	}
	leadByProductVendor := map[[2]string]any{}
	for _, l := range leads {
		leadByProductVendor[[2]string{text(l["product_id"]), text(l["vendor_id"])}] = l["lead_days"]
	}
	quantities := map[string]*big.Rat{}
	values := map[string]*big.Int{}
	for _, b := range balances {
		id := text(b["product_id"])
		quantity, ok := invRat(b["quantity"], false)
		value, e := integer(b["value_satang"])
		if !ok || e != nil {
			return nil, invDataError()
		}
		if quantities[id] == nil {
			quantities[id] = new(big.Rat)
			values[id] = new(big.Int)
		}
		quantities[id].Add(quantities[id], quantity)
		values[id].Add(values[id], big.NewInt(value))
	}
	combined := []erpwire.Row{}
	for _, p := range products {
		id := text(p["id"])
		f, ok := forecastByProduct[id]
		if !ok {
			continue
		}
		p["quantity"] = json.Number("0")
		p["value_satang"] = int64(0)
		if q := quantities[id]; q != nil {
			p["quantity"] = invDecimal(q)
			if !values[id].IsInt64() {
				return nil, invDataError()
			}
			p["value_satang"] = values[id].Int64()
		}
		p["on_order"] = f["on_order"]
		p["reserved_quantity"] = f["reserved_quantity"]
		p["lead_days"] = int64(0)
		if lead, ok := leadByProductVendor[[2]string{id, text(p["default_vendor_id"])}]; ok {
			p["lead_days"] = lead
		}
		combined = append(combined, p)
	}
	raw, e := json.Marshal(erpwire.Row{"products": combined, "balances": balances})
	if e != nil {
		return nil, e
	}
	return invSnapshot(raw, a)
}
func invReplenishmentPlan(result erpwire.Row) ([]erpwire.Row, error) {
	products, _ := result["products"].([]erpwire.Row)
	vendors, _ := result["vendors"].([]erpwire.Row)
	activeVendors := map[string]bool{}
	for _, v := range vendors {
		activeVendors[text(v["id"])] = v["active"] == true
	}
	preview := []erpwire.Row{}
	date, e := time.Parse("2006-01-02", today())
	if e != nil {
		return nil, e
	}
	for _, p := range products {
		vendor := text(p["default_vendor_id"])
		if p["active"] != true || !activeVendors[vendor] {
			continue
		}
		q, e := invReplenishmentQuantity(p)
		if e != nil {
			return nil, e
		}
		if q == "0" {
			continue
		}
		lead, e := integer(p["lead_days"])
		if e != nil {
			return nil, e
		}
		preview = append(preview, erpwire.Row{"id": p["id"], "product_id": p["id"], "vendor_id": vendor, "product_name": p["name"], "unit": p["unit"], "order_quantity": q, "unit_cost_satang": p["cost_satang"], "lead_days": lead, "expected_date": date.AddDate(0, 0, int(lead)).Format("2006-01-02")})
	}
	sort.Slice(preview, func(i, j int) bool { return text(preview[i]["product_id"]) < text(preview[j]["product_id"]) })
	return preview, nil
}
func invMovesPage(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, p erpwire.Row) ([]erpwire.Row, error) {
	where := scope(a)
	for key, column := range map[string]string{"p_warehouse_id": "warehouse_id", "p_product_id": "product_id", "p_source_id": "source_id", "p_actor_id": "created_by"} {
		if value := p[key]; value != nil {
			where = append(where, eq(column, value))
		}
	}
	if before := p["p_before"]; before != nil {
		where = append(where, erpwire.Predicate{Column: "sequence", Op: erpwire.Less, Value: before})
	}
	if kinds := p["p_kinds"]; kinds != nil {
		where = append(where, erpwire.Predicate{Column: "kind", Op: erpwire.In, Value: kinds})
	}
	if start := p["p_start"]; start != nil {
		where = append(where, erpwire.Predicate{Column: "moved_at", Op: erpwire.GreaterEqual, Value: start})
	}
	if end := p["p_end"]; end != nil {
		where = append(where, erpwire.Predicate{Column: "moved_at", Op: erpwire.Less, Value: end})
	}
	products, e := all(ctx, tx, erpwire.Select{Table: "products", Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("id")})
	if e != nil {
		return nil, e
	}
	warehouses, e := all(ctx, tx, erpwire.Select{Table: "warehouses", Columns: []string{"id", "code"}, Where: scope(a), Order: ordered("id")})
	if e != nil {
		return nil, e
	}
	productNames, warehouseCodes := map[string]string{}, map[string]string{}
	for _, r := range products {
		productNames[text(r["id"])] = text(r["name"])
	}
	for _, r := range warehouses {
		warehouseCodes[text(r["id"])] = text(r["code"])
	}
	// shortcut: substring search scans ledger pages; use a scoped read RPC when its shared allowlist is extended.
	q := erpwire.Select{Table: "stock_moves", Columns: []string{"*"}, Where: where, Order: []erpwire.Order{{Column: "sequence", Descending: true}, {Column: "id"}}, Limit: 1000}
	moves := []erpwire.Row{}
	query := strings.ToLower(text(p["p_query"]))
	for {
		page, e := tx.Select(ctx, q)
		if e != nil {
			return nil, e
		}
		for _, m := range page.Rows {
			product, productExists := productNames[text(m["product_id"])]
			warehouse, warehouseExists := warehouseCodes[text(m["warehouse_id"])]
			if !productExists || !warehouseExists || query != "" && !strings.Contains(strings.ToLower(product+" "+warehouse+" "+text(m["note"])), query) {
				continue
			}
			moves = append(moves, m)
			if len(moves) == 101 {
				return moves, nil
			}
		}
		if !page.HasMore {
			return moves, nil
		}
		if len(page.Rows) == 0 {
			return nil, invDataError()
		}
		q.Offset += len(page.Rows)
	}
}
