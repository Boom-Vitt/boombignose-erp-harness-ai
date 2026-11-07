package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func (s *Service) inventoryProductOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"lib/products/actions.ts::saveProduct":                   s.saveProduct,
		"lib/products/actions.ts::setProductActive":              s.setProductActive,
		"lib/products/queries.ts::activeProductOptions":          s.activeProductOptions,
		"lib/inventory/actions.ts::saveWarehouse":                s.saveWarehouse,
		"lib/inventory/actions.ts::deleteWarehouse":              s.deleteWarehouse,
		"lib/inventory/actions.ts::adjustStock":                  s.adjustStock,
		"lib/inventory/actions.ts::deliverInvoice":               s.deliverInvoice,
		"lib/inventory/actions.ts::returnInvoiceDelivery":        s.returnInvoiceDelivery,
		"lib/inventory/actions.ts::saveReorder":                  s.saveReorder,
		"lib/inventory/actions.ts::createReplenishment":          s.createReplenishment,
		"lib/inventory/actions.ts::setNegativeStock":             s.setNegativeStock,
		"lib/inventory/actions.ts::transferStock":                s.transferStock,
		"lib/inventory/actions.ts::savePurchasingPolicy":         s.savePurchasingPolicy,
		"app/(app)/products/page.tsx::load":                      s.productsLoad,
		"app/(app)/products/new/page.tsx::load":                  s.productNewLoad,
		"app/(app)/products/[id]/page.tsx::load":                 s.productDetailLoad,
		"app/(app)/products/[id]/edit/page.tsx::load":            s.productEditLoad,
		"app/(app)/inventory/page.tsx::load":                     s.inventoryLoad,
		"app/(app)/inventory/adjust/page.tsx::load":              s.inventoryAdjustLoad,
		"app/(app)/inventory/transfer/page.tsx::load":            s.inventoryTransferLoad,
		"app/(app)/inventory/replenish/page.tsx::load":           s.inventoryReplenishLoad,
		"app/(app)/inventory/warehouses/page.tsx::load":          s.inventoryWarehousesLoad,
		"app/(app)/inventory/moves/page.tsx::load":               s.inventoryMovesLoad,
		"app/(app)/inventory/documents/page.tsx::load":           s.inventoryDocumentsLoad,
		"app/(app)/inventory/documents/[id]/print/route.ts::GET": s.inventoryDocumentPrint,
	}
}

var productOptionColumns = []string{"id", "sku", "name", "description", "unit", "list_price_satang", "tax_rate_bps", "cost_satang"}

func productInput(input erpwire.Row) (erpwire.Row, bool) {
	normalized := erpwire.Row{}
	for key, max := range map[string]int{"sku": 80, "name": 200, "description": 4000, "unit": 40} {
		value, present := input[key]
		if !present && (key == "sku" || key == "description") {
			value = ""
		}
		v, ok := value.(string)
		if !ok {
			return nil, false
		}
		v = jsTrim(v)
		if jsLength(v) > max || ((key == "name" || key == "unit") && v == "") {
			return nil, false
		}
		normalized[key] = v
	}
	kind := text(input["type"])
	if kind != "service" && kind != "goods" {
		return nil, false
	}
	price, ok := numberText(input["listPriceBaht"])
	if !ok {
		return nil, false
	}
	p, e := salesMoney(price)
	if e != nil {
		return nil, false
	}
	cost, ok := numberText(input["costBaht"])
	if !ok {
		return nil, false
	}
	c, e := salesMoney(cost)
	if e != nil {
		return nil, false
	}
	tax, ok := invNumberInt(input["taxRateBps"], 0, 10000)
	if !ok {
		return nil, false
	}
	stockable, ok := input["isStockable"].(bool)
	if !ok {
		return nil, false
	}
	normalized["sku"] = nilText(text(normalized["sku"]))
	normalized["description"] = nilText(text(normalized["description"]))
	normalized["type"] = kind
	normalized["list_price_satang"] = int64(p)
	normalized["cost_satang"] = int64(c)
	normalized["tax_rate_bps"] = tax
	normalized["is_stockable"] = stockable
	return normalized, true
}
func (s *Service) saveProduct(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "product:manage") != nil {
		return invalid("Only owners and admins can manage products.")
	}
	args, e := arguments(raw, 1, 2)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil {
		return invalid("Invalid product input")
	}
	id := ""
	if args.Present(1) {
		if args.Null(1) || args.Decode(1, &id) != nil || !validID(id) {
			return invalid("Invalid product input")
		}
	}
	row, ok := productInput(input)
	if !ok {
		return invalid("Invalid product input")
	}
	var product erpwire.Row
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		var rows []erpwire.Row
		var err error
		if id != "" {
			rows, err = tx.Update(ctx, "products", row, scoped(a, id), productOptionColumns)
		} else {
			row["org_id"] = a.OrgID()
			rows, err = tx.Insert(ctx, erpwire.Insert{Table: "products", Rows: []erpwire.Row{row}, Returning: productOptionColumns})
		}
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return invBusiness("Product not found")
		}
		product = rows[0]
		return nil
	})
	if e != nil {
		message := invBusinessMessage(e)
		if message == "Stock unit is locked by stock history" {
			return invalid("This product has stock history. Keep its current unit or create a new product for a different unit.")
		}
		if invSQLState(e) == "23505" {
			return invalid("This SKU is already used in your workspace.")
		}
		return failure(e)
	}
	action, label := "created", "Created"
	if id != "" {
		action, label = "updated", "Updated"
	}
	id = text(product["id"])
	s.audit(ctx, a, "product", id, action, label+` product "`+text(product["name"])+`"`, nil)
	result := response("", "/products", "/products/"+id, "/quotes", "/finance/invoices")
	result.Value = erpwire.Row{"product": product}
	return result, nil
}
func (s *Service) setProductActive(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "product:manage") != nil {
		return invalid("Only owners and admins can manage products.")
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	var id string
	var active bool
	if args.Decode(0, &id) != nil || !validID(id) || args.Null(1) || args.Decode(1, &active) != nil {
		return invalid("Invalid product input")
	}
	var name string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Update(ctx, "products", erpwire.Row{"active": active}, scoped(a, id), []string{"id", "name"})
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return invBusiness("Product not found")
		}
		name = text(rows[0]["name"])
		return nil
	})
	if e != nil {
		return failure(e)
	}
	action, label := "archived", "Archived"
	if active {
		action, label = "restored", "Restored"
	}
	s.audit(ctx, a, "product", id, action, label+` product "`+name+`"`, nil)
	return response("", "/products", "/products/"+id, "/quotes", "/finance/invoices"), nil
}
func productSearch(term string) []erpwire.Predicate {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%"
	return []erpwire.Predicate{{Column: "name", Op: erpwire.ILike, Value: pattern}, {Column: "sku", Op: erpwire.ILike, Value: pattern}}
}
func (s *Service) activeProductOptions(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 0, 2)
	if e != nil {
		return nil, e
	}
	term := ""
	withCost := false
	if args.Present(0) && (args.Null(0) || args.Decode(0, &term) != nil) {
		return nil, erpwire.ErrBadArguments
	}
	term = jsTrim(term)
	if jsLength(term) > 200 {
		return nil, erpwire.ErrBadArguments
	}
	if args.Present(1) && (args.Null(1) || args.Decode(1, &withCost) != nil) {
		return nil, erpwire.ErrBadArguments
	}
	if withCost {
		if e := authorize(a, "purchase:manage"); e != nil {
			return nil, e
		}
	}
	q := erpwire.Select{Table: "products", Columns: productOptionColumns, Where: append(scope(a), eq("active", true)), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}, Limit: 20}
	if term != "" {
		q.Any = [][]erpwire.Predicate{productSearch(term)}
	}
	rows := []erpwire.Row{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		result, e := tx.Select(ctx, q)
		if e == nil {
			rows = result.Rows
			if rows == nil {
				rows = []erpwire.Row{}
			}
		}
		return e
	})
	if e != nil {
		return nil, e
	}
	if !withCost {
		for _, r := range rows {
			delete(r, "cost_satang")
		}
	}
	return rows, nil
}
func invFirstParam(v any) string {
	switch v := v.(type) {
	case string:
		return v
	case []any:
		if len(v) > 0 {
			return text(v[0])
		}
	case []string:
		if len(v) > 0 {
			return v[0]
		}
	}
	return ""
}
func invShortText(s string, max int) string {
	units := utf16.Encode([]rune(s))
	if len(units) > max {
		return string(utf16.Decode(units[:max]))
	}
	return s
}
func (s *Service) productsLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
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
	term := invShortText(jsTrim(invFirstParam(params["q"])), 200)
	status := invFirstParam(params["status"])
	if status != "archived" && status != "all" {
		status = "active"
	}
	page := int64(1)
	if p, ok := invCoercedInt(invFirstParam(params["page"]), 1, erpwire.MaxSafeInteger/50); ok {
		page = p
	}
	q := erpwire.Select{Table: "products", Columns: []string{"id", "sku", "name", "type", "unit", "list_price_satang", "active"}, Where: scope(a), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}, Limit: 51, Offset: int((page - 1) * 50)}
	if status != "all" {
		q.Where = append(q.Where, eq("active", status == "active"))
	}
	if term != "" {
		q.Any = [][]erpwire.Predicate{productSearch(term)}
	}
	var rows []erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { r, e := tx.Select(ctx, q); rows = r.Rows; return e })
	if e != nil {
		return nil, e
	}
	more := len(rows) > 50
	if more {
		rows = rows[:50]
	}
	if rows == nil {
		rows = []erpwire.Row{}
	}
	return erpwire.Row{"products": rows, "search": term, "status": status, "page": page, "hasNext": more, "canManage": erpwire.Can(a.Role(), "product:manage")}, nil
}
func (s *Service) productNewLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "product:manage"); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	return erpwire.Row{}, nil
}
func invIDArgument(raw json.RawMessage) (string, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return "", e
	}
	var id string
	if args.Decode(0, &id) != nil {
		var p erpwire.Row
		if args.Decode(0, &p) != nil {
			return "", erpwire.ErrBadArguments
		}
		id = text(p["id"])
	}
	if !validID(id) {
		return "", erpwire.ErrNotFound
	}
	return id, nil
}
func (s *Service) productDetailLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.productReadLoad(ctx, a, raw, false)
}
func (s *Service) productEditLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.productReadLoad(ctx, a, raw, true)
}
func (s *Service) productReadLoad(ctx context.Context, a erpwire.Actor, raw json.RawMessage, edit bool) (any, error) {
	capability := erpwire.Capability("")
	if edit {
		capability = "product:manage"
	}
	if e := authorize(a, capability); e != nil {
		return nil, e
	}
	id, e := invIDArgument(raw)
	if e != nil {
		return nil, e
	}
	var product erpwire.Row
	var onHand any = int64(0)
	var moves int64
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		product, e = one(ctx, tx, erpwire.Select{Table: "products", Columns: []string{"*"}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if product == nil {
			return erpwire.ErrNotFound
		}
		if edit {
			return nil
		}
		if stock, _ := product["is_stockable"].(bool); stock {
			balance, e := one(ctx, tx, erpwire.Select{Table: "inventory_totals", Columns: []string{"quantity"}, Where: append(scope(a), eq("product_id", id))})
			if e != nil {
				return errors.New("Stock balance unavailable")
			}
			if balance != nil {
				onHand = balance["quantity"]
			}
			result, e := tx.Select(ctx, erpwire.Select{Table: "stock_moves", Columns: []string{"id"}, Where: append(scope(a), eq("product_id", id)), Count: true, Limit: 1})
			if e != nil || result.Total == nil {
				return errors.New("Stock move count unavailable")
			}
			moves = *result.Total
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	result := erpwire.Row{"product": product, "onHand": onHand, "moves": moves, "canManage": erpwire.Can(a.Role(), "product:manage")}
	if edit {
		price, e := satang(product["list_price_satang"])
		if e != nil || price < 0 {
			return nil, errors.New("Invalid satang amount")
		}
		cost, e := satang(product["cost_satang"])
		if e != nil || cost < 0 {
			return nil, errors.New("Invalid satang amount")
		}
		result["defaults"] = erpwire.Row{"name": product["name"], "sku": text(product["sku"]), "description": text(product["description"]), "type": product["type"], "unit": product["unit"], "listPriceBaht": money.FormatBaht(price), "costBaht": money.FormatBaht(cost), "taxRateBps": product["tax_rate_bps"], "isStockable": product["is_stockable"]}
	}
	return result, nil
}

type invBusiness string

func (e invBusiness) Error() string           { return string(e) }
func (e invBusiness) BusinessMessage() string { return string(e) }
func invBusinessMessage(err error) string {
	var b interface{ BusinessMessage() string }
	if errors.As(err, &b) {
		return b.BusinessMessage()
	}
	return ""
}
func invSQLState(err error) string {
	var b interface{ SQLState() string }
	if errors.As(err, &b) {
		return b.SQLState()
	}
	return ""
}
func invDataError() error { return errors.New("Inventory data unavailable. Please reload.") }
func invString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if n, ok := v.(json.Number); ok {
		return n.String()
	}
	return fmt.Sprint(v)
}
