package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
)

func (s *Service) importOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{"app/(app)/import/actions.ts::importSheet": s.importSheet, "app/(app)/import/page.tsx::load": s.importPage}
}

func importNull(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func importResult(value erpwire.Row, path string) (any, error) {
	out := response("")
	out.Value = value
	if path != "" {
		out.Refresh = []string{path}
	}
	return out, nil
}

func (s *Service) importSheet(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	form, e := args.Form(0)
	if e != nil {
		return nil, e
	}
	kind, _ := form.Text("kind")
	file, ok := form.File("file")
	warehouse, _ := form.Text("warehouseId")
	if !has([]string{"customers", "products", "opening-stock"}, kind) {
		return invalid("Choose what to import.")
	}
	if !ok {
		return invalid("Choose a CSV or Excel file.")
	}
	if len(file.Data) > 1_000_000 {
		return invalid("The file is larger than 1 MB.")
	}
	capability := erpwire.Capability("record:write")
	if kind == "products" {
		capability = "product:manage"
	} else if kind == "opening-stock" {
		capability = "inventory:manage"
	}
	if authorize(a, capability) != nil {
		return invalid("Your role cannot import this list.")
	}
	grid, e := parseSpreadsheet(file.Name, file.Data)
	if e != nil {
		return invalid(e.Error())
	}
	parsed := validateImport(kind, grid)
	if len(parsed.errors) > 0 {
		return importResult(erpwire.Row{"errors": parsed.errors}, "")
	}
	if kind == "customers" {
		for index, row := range parsed.customers {
			var id any
			e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
				rows, e := tx.Insert(ctx, erpwire.Insert{Table: "clients", Rows: []erpwire.Row{{"org_id": a.OrgID(), "owner": a.UserID(), "name": row.name, "tax_id": importNull(row.taxID), "billing_address": importNull(row.address), "source": "import"}}, Returning: []string{"id"}})
				if e != nil {
					return e
				}
				if len(rows) != 1 {
					return errors.New("Customer was not saved.")
				}
				id = rows[0]["id"]
				return nil
			})
			if e != nil {
				if authError(e) {
					return nil, e
				}
				return invalid(fmt.Sprintf("Row %d was not saved. Earlier rows in this file were saved. %s", index+2, publicMessage(e, "Customer was not saved.")))
			}
			if row.phone != "" || row.email != "" {
				e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
					_, e := tx.Insert(ctx, erpwire.Insert{Table: "contacts", Rows: []erpwire.Row{{"org_id": a.OrgID(), "client_id": id, "name": row.name, "phone": importNull(row.phone), "email": importNull(row.email)}}})
					return e
				})
				if e != nil {
					if authError(e) {
						return nil, e
					}
					return invalid(fmt.Sprintf("Row %d saved the customer without a contact. %s", index+2, publicMessage(e, "Contact was not saved.")))
				}
			}
		}
		return importResult(erpwire.Row{"saved": len(parsed.customers)}, "/clients")
	}
	if kind == "products" {
		for index, row := range parsed.products {
			e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
				_, e := tx.Insert(ctx, erpwire.Insert{Table: "products", Rows: []erpwire.Row{{"org_id": a.OrgID(), "sku": importNull(row.sku), "name": row.name, "unit": row.unit, "type": row.kind, "list_price_satang": int64(row.price), "cost_satang": int64(row.cost), "tax_rate_bps": row.tax, "is_stockable": row.stockable}}})
				return e
			})
			if e != nil {
				if authError(e) {
					return nil, e
				}
				message := publicMessage(e, "Product was not saved.")
				var code interface{ SQLState() string }
				if errors.As(e, &code) && code.SQLState() == "23505" {
					message = "This SKU is already used in your workspace."
				}
				return invalid(fmt.Sprintf("Row %d was not saved. Earlier rows in this file were saved. %s", index+2, message))
			}
		}
		return importResult(erpwire.Row{"saved": len(parsed.products)}, "/products")
	}
	if warehouse == "" {
		return invalid("Choose the warehouse for the opening quantities.")
	}
	skus := make([]string, len(parsed.stock))
	for i, row := range parsed.stock {
		skus[i] = row.sku
	}
	bySKU := map[string]erpwire.Row{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		rows, e := all(ctx, tx, selection(a, "products", []string{"id", "sku", "is_stockable"}, erpwire.Predicate{Column: "sku", Op: erpwire.In, Value: skus}))
		if e != nil {
			return e
		}
		for _, product := range rows {
			if sku := text(product["sku"]); sku != "" {
				bySKU[strings.ToLower(sku)] = product
			}
		}
		return nil
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		return invalid("Products could not be read.")
	}
	missing := []importError{}
	for i, row := range parsed.stock {
		product := bySKU[strings.ToLower(row.sku)]
		if product == nil {
			missing = append(missing, importError{i + 2, "รหัส is not a product in this workspace."})
		} else if product["is_stockable"] != true {
			missing = append(missing, importError{i + 2, "รหัส is not a stockable product."})
		}
	}
	if len(missing) > 0 {
		return importResult(erpwire.Row{"errors": missing}, "")
	}
	for index, row := range parsed.stock {
		product := bySKU[strings.ToLower(row.sku)]
		e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
			_, e := tx.Command(ctx, "adjust_stock", erpwire.Row{"p_org_id": a.OrgID(), "p_product_id": product["id"], "p_warehouse_id": warehouse, "p_count": importQuantityNumber(row.quantity), "p_reason": "Opening stock import", "p_key": uuid.NewString(), "p_unit_cost_satang": int64(row.cost)})
			return e
		})
		if e != nil {
			if authError(e) {
				return nil, e
			}
			return invalid(fmt.Sprintf("Row %d was not counted. Earlier rows in this file were counted. %s", index+2, publicMessage(e, "Stock was not counted.")))
		}
	}
	return importResult(erpwire.Row{"saved": len(parsed.stock)}, "/inventory")
}

func importQuantityNumber(value string) json.Number {
	whole, fraction, _ := strings.Cut(value, ".")
	whole = strings.TrimLeft(whole, "0")
	if whole == "" {
		whole = "0"
	}
	fraction = strings.TrimRight(fraction, "0")
	if fraction != "" {
		whole += "." + fraction
	}
	return json.Number(whole)
}

func (s *Service) importPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	warehouses := []erpwire.Row{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		query := selection(a, "warehouses", []string{"id", "name", "code"}, eq("active", true))
		query.Order = []erpwire.Order{{Column: "code"}, {Column: "id"}}
		var e error
		warehouses, e = all(ctx, tx, query)
		return e
	})
	if authError(e) {
		return nil, e
	}
	if e != nil {
		warehouses = []erpwire.Row{}
	}
	return erpwire.Row{"warehouses": warehouses}, nil
}
