package erpinsight

import (
	"math/big"
	"regexp"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type importError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}
type importCustomer struct{ name, taxID, address, phone, email string }
type importProduct struct {
	sku, name, unit, kind string
	price, cost           money.Satang
	tax                   int64
	stockable             bool
}
type importStock struct {
	sku, quantity string
	cost          money.Satang
}
type importRows struct {
	customers []importCustomer
	products  []importProduct
	stock     []importStock
	errors    []importError
}

var importCustomerAliases = map[string][]string{
	"name": {"name", "ชื่อ", "ชื่อลูกค้า"}, "tax": {"tax id", "tax_id", "เลขผู้เสียภาษี", "เลขประจำตัวผู้เสียภาษี"}, "address": {"address", "ที่อยู่", "billing address"}, "phone": {"phone", "โทร", "โทรศัพท์"}, "email": {"email", "อีเมล"},
}
var importProductAliases = map[string][]string{
	"sku": {"sku", "รหัส", "รหัสสินค้า"}, "name": {"name", "ชื่อ", "ชื่อสินค้า"}, "unit": {"unit", "หน่วย"}, "price": {"price", "ราคา", "ราคาขาย"}, "cost": {"cost", "ต้นทุน"}, "tax": {"vat", "ภาษี", "vat %"}, "type": {"type", "ประเภท"}, "stock": {"stockable", "สต็อก", "สินค้าคงคลัง"},
}
var importStockAliases = map[string][]string{"sku": {"sku", "รหัส", "รหัสสินค้า"}, "quantity": {"quantity", "qty", "จำนวน"}, "cost": {"unit cost", "ต้นทุนต่อหน่วย", "ต้นทุน"}}
var importTaxIDPattern = regexp.MustCompile(`^[0-9]{13}$`)
var importEmailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+$`)
var importVATPattern = regexp.MustCompile(`^\d+(\.\d)?$`)
var importQuantityPattern = regexp.MustCompile(`^\d+(\.\d{1,3})?$`)

func validateImport(kind string, grid [][]string) importRows {
	out := importRows{customers: []importCustomer{}, products: []importProduct{}, stock: []importStock{}, errors: []importError{}}
	add := func(row int, message string) { out.errors = append(out.errors, importError{row, message}) }
	if len(grid) == 0 {
		add(1, "The file is empty.")
		return out
	}
	aliases := importCustomerAliases
	if kind == "products" {
		aliases = importProductAliases
	} else if kind == "opening-stock" {
		aliases = importStockAliases
	}
	columns := map[string]int{}
	for key, names := range aliases {
		columns[key] = -1
		for i, header := range grid[0] {
			if has(names, importHeader(header)) {
				columns[key] = i
				break
			}
		}
	}
	if kind == "opening-stock" {
		if columns["sku"] < 0 || columns["quantity"] < 0 {
			add(1, "The first row needs รหัส and จำนวน columns.")
			return out
		}
	} else if columns["name"] < 0 {
		add(1, "The first row needs a ชื่อ or name column.")
		return out
	}
	seen := map[string]bool{}
	for i, line := range grid[1:] {
		row, before := i+2, len(out.errors)
		cell := func(key string) string {
			col, ok := columns[key]
			if !ok || col < 0 || col >= len(line) {
				return ""
			}
			return importTrim(line[col])
		}
		name := cell("name")
		if kind != "opening-stock" && (name == "" || jsLength(name) > 200) {
			add(row, "ชื่อ is required and must be 200 characters or fewer.")
		}
		switch kind {
		case "customers":
			tax := strings.Map(func(r rune) rune {
				if importSpace(r) || r == '-' {
					return -1
				}
				return r
			}, cell("tax"))
			if tax != "" && !importTaxIDPattern.MatchString(tax) {
				add(row, "เลขผู้เสียภาษี must be 13 digits or blank.")
			}
			address, phone, email := cell("address"), cell("phone"), cell("email")
			if jsLength(address) > 1000 {
				add(row, "ที่อยู่ must be 1000 characters or fewer.")
			}
			if jsLength(phone) > 40 {
				add(row, "โทร must be 40 characters or fewer.")
			}
			if email != "" && (!importEmailPattern.MatchString(email) || strings.ContainsFunc(email, importSpace)) {
				add(row, "อีเมล is not an email address.")
			}
			if before == len(out.errors) {
				out.customers = append(out.customers, importCustomer{name, tax, address, phone, email})
			}
		case "products":
			sku := cell("sku")
			if jsLength(sku) > 80 {
				add(row, "รหัส must be 80 characters or fewer.")
			}
			if sku != "" {
				key := strings.ToLower(sku)
				if seen[key] {
					add(row, "รหัส is repeated in this file.")
				}
				seen[key] = true
			}
			unit := cell("unit")
			if unit == "" {
				unit = "piece"
			}
			if jsLength(unit) > 40 {
				add(row, "หน่วย must be 40 characters or fewer.")
			}
			productType := strings.ToLower(cell("type"))
			switch productType {
			case "", "goods", "สินค้า":
				productType = "goods"
			case "service", "บริการ":
				productType = "service"
			default:
				productType = ""
				add(row, "ประเภท must be สินค้า, บริการ, goods, or service.")
			}
			price, e := importBaht(cell("price"))
			if e != nil {
				add(row, "ราคา must be a baht amount with up to two decimals.")
			}
			cost, e := importBaht(cell("cost"))
			if e != nil {
				add(row, "ต้นทุน must be a baht amount with up to two decimals.")
			}
			tax, ok := importVAT(cell("tax"))
			if !ok {
				add(row, "ภาษี must be a percent from 0 to 100.")
			}
			stock, ok := importStockFlag(cell("stock"), productType == "goods")
			if !ok {
				add(row, "สต็อก must be ใช่, ไม่, yes, or no.")
			}
			if before == len(out.errors) {
				out.products = append(out.products, importProduct{sku, name, unit, productType, price, cost, tax, stock})
			}
		default:
			sku := cell("sku")
			if sku == "" || jsLength(sku) > 80 {
				add(row, "รหัส is required.")
			}
			if sku != "" {
				key := strings.ToLower(sku)
				if seen[key] {
					add(row, "รหัส is repeated in this file.")
				}
				seen[key] = true
			}
			quantity := strings.ReplaceAll(cell("quantity"), ",", "")
			qty, ok := new(big.Rat).SetString(quantity)
			maximum := new(big.Rat).SetFrac64(999999999999, 1000)
			if !importQuantityPattern.MatchString(quantity) || !ok || qty.Sign() <= 0 || qty.Cmp(maximum) > 0 {
				add(row, "จำนวน must be greater than zero with at most three decimals.")
			}
			rawCost := cell("cost")
			cost, e := importBaht(rawCost)
			if rawCost == "" || e != nil {
				add(row, "ต้นทุนต่อหน่วย is required.")
			}
			if before == len(out.errors) {
				out.stock = append(out.stock, importStock{sku, quantity, cost})
			}
		}
	}
	if len(out.errors) == 0 && len(out.customers)+len(out.products)+len(out.stock) == 0 {
		label := "customer"
		if kind == "products" {
			label = "product"
		} else if kind == "opening-stock" {
			label = "stock"
		}
		add(2, "There are no "+label+" rows.")
	}
	return out
}

func importHeader(value string) string {
	value = importTrim(strings.TrimPrefix(value, "\ufeff"))
	var b strings.Builder
	space := false
	for _, c := range value {
		if importSpace(c) {
			if !space {
				b.WriteByte(' ')
			}
			space = true
		} else {
			b.WriteRune(c)
			space = false
		}
	}
	value = b.String()
	value = strings.TrimPrefix(value, "*")
	value = strings.TrimSuffix(value, "*")
	return strings.ToLower(importTrim(value))
}

func importBaht(value string) (money.Satang, error) {
	value = strings.Map(func(c rune) rune {
		if c == '฿' || c == ',' || importSpace(c) {
			return -1
		}
		return c
	}, value)
	if value == "" {
		return 0, nil
	}
	return money.ParseBaht(value)
}

func importVAT(value string) (int64, bool) {
	value = strings.ReplaceAll(importTrim(value), "%", "")
	if value == "" {
		return 0, true
	}
	if !importVATPattern.MatchString(value) {
		return 0, false
	}
	amount, e := money.ParseBaht(value)
	if e != nil || amount > 10000 {
		return 0, false
	}
	return int64(amount), true
}

func importStockFlag(value string, fallback bool) (bool, bool) {
	value = strings.ToLower(importTrim(value))
	if value == "" {
		return fallback, true
	}
	if has([]string{"yes", "y", "true", "1", "ใช่", "มี"}, value) {
		return true, true
	}
	if has([]string{"no", "n", "false", "0", "ไม่", "ไม่มี"}, value) {
		return false, true
	}
	return false, false
}
