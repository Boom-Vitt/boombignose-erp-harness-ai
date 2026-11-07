package erpsales

import (
	"encoding/json"
	"errors"
	"math/big"
	"net/mail"
	"regexp"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var purDecimal = regexp.MustCompile(`^\d+(\.\d{1,3})?$`)
var purEmail = regexp.MustCompile(`^[A-Za-z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$`)

func purchaseNumber(v any) (string, bool) {
	switch n := v.(type) {
	case json.Number:
		return n.String(), true
	case int:
		return strconv.Itoa(n), true
	case int64:
		return strconv.FormatInt(n, 10), true
	case int32:
		return strconv.FormatInt(int64(n), 10), true
	}
	return "", false
}
func purchaseRational(v any, allowString bool) (*big.Rat, error) {
	n, ok := purchaseNumber(v)
	if !ok && allowString {
		n, ok = v.(string)
	}
	if !ok {
		return nil, errors.New("Invalid quantity")
	}
	r, ok := new(big.Rat).SetString(jsTrim(n))
	if !ok {
		return nil, errors.New("Invalid quantity")
	}
	return r, nil
}
func purchaseExactInt(v any) (int64, error) {
	r, e := purchaseRational(v, true)
	if e != nil || !r.IsInt() || !r.Num().IsInt64() {
		return 0, errors.New("Invalid integer")
	}
	return r.Num().Int64(), nil
}
func purchaseQuantity(v any, zero, allowString bool) (int64, error) {
	n, numeric := purchaseNumber(v)
	if !numeric {
		var ok bool
		n, ok = v.(string)
		if !ok || !allowString {
			return 0, errors.New("Enter a positive quantity with up to three decimals")
		}
		n = jsTrim(n)
		if !purDecimal.MatchString(n) {
			return 0, errors.New("Enter a positive quantity with up to three decimals")
		}
	}
	r, ok := new(big.Rat).SetString(n)
	if !ok {
		return 0, errors.New("Enter a positive quantity with up to three decimals")
	}
	r.Mul(r, big.NewRat(1000, 1))
	if !r.IsInt() {
		return 0, errors.New("Enter a positive quantity with up to three decimals")
	}
	if !r.Num().IsInt64() {
		return 0, errors.New("Quantity outside supported bounds")
	}
	q := r.Num().Int64()
	if q < 0 || (!zero && q == 0) || q > 999999999999 {
		return 0, errors.New("Quantity outside supported bounds")
	}
	return q, nil
}
func purchaseDecimal(milli int64) json.Number {
	whole := strconv.FormatInt(milli/1000, 10)
	fraction := strings.TrimRight(strconv.FormatInt(1000+milli%1000, 10)[1:], "0")
	if fraction != "" {
		whole += "." + fraction
	}
	return json.Number(whole)
}
func purchaseLineAmount(quantity, unit any) (money.Satang, error) {
	q, e := purchaseQuantity(quantity, false, true)
	if e != nil {
		return 0, e
	}
	c, e := integer(unit)
	if e != nil || c < 0 || c > int64(money.MaxSafeSatang) {
		return 0, errors.New("Invalid unit price")
	}
	n := new(big.Int).Mul(big.NewInt(q), big.NewInt(c))
	n.Add(n, big.NewInt(500))
	n.Quo(n, big.NewInt(1000))
	if !n.IsInt64() || n.Int64() > int64(money.MaxSafeSatang) {
		return 0, errors.New("Amount outside safe satang bounds")
	}
	return money.Satang(n.Int64()), nil
}
func purchaseTotal(lines []erpwire.Row) (money.Satang, error) {
	var total money.Satang
	for _, line := range lines {
		n, e := purchaseLineAmount(line["quantity"], line["unit_cost_satang"])
		if e != nil {
			return 0, e
		}
		if n > money.MaxSafeSatang-total {
			return 0, errors.New("Amount outside safe satang bounds")
		}
		total += n
	}
	return total, nil
}
func purchaseNullableText(input erpwire.Row, key string, max int) (any, bool) {
	v, ok := input[key].(string)
	if !ok {
		return nil, false
	}
	v = jsTrim(v)
	if jsLength(v) > max {
		return nil, false
	}
	if v == "" {
		return nil, true
	}
	return v, true
}
func purchaseEmail(v string) bool {
	if !purEmail.MatchString(v) {
		return false
	}
	a, e := mail.ParseAddress(v)
	return e == nil && a.Address == v
}
func purchaseVendorInput(input erpwire.Row) (erpwire.Row, bool) {
	name, ok := input["name"].(string)
	name = jsTrim(name)
	if !ok || jsLength(name) < 1 || jsLength(name) > 200 {
		return nil, false
	}
	row := erpwire.Row{"name": name}
	for key, max := range map[string]int{"tax_id": 80, "phone": 80, "address": 2000, "notes": 10000} {
		v, ok := purchaseNullableText(input, key, max)
		if !ok {
			return nil, false
		}
		row[key] = v
	}
	email, ok := input["email"].(string)
	if !ok || (email != "" && (jsLength(email) > 320 || !purchaseEmail(email))) {
		return nil, false
	}
	if email == "" {
		row["email"] = nil
	} else {
		row["email"] = email
	}
	terms, ok := numberText(input["payment_terms_days"])
	if !ok {
		if input["payment_terms_days"] == nil {
			terms = "0"
		} else if b, isBool := input["payment_terms_days"].(bool); isBool {
			if b {
				terms = "1"
			} else {
				terms = "0"
			}
		} else {
			return nil, false
		}
	}
	terms = jsTrim(terms)
	if terms == "" {
		terms = "0"
	}
	r, e := purchaseRational(terms, true)
	if e != nil || !r.IsInt() || !r.Num().IsInt64() || r.Num().Int64() < 0 || r.Num().Int64() > 3650 {
		return nil, false
	}
	row["payment_terms_days"] = r.Num().Int64()
	active, ok := input["active"].(bool)
	if !ok {
		return nil, false
	}
	row["active"] = active
	return row, true
}
func purchaseOrderInput(input erpwire.Row) (erpwire.Row, bool) {
	vendor := text(input["vendor_id"])
	date := text(input["order_date"])
	expected, ok := input["expected_date"].(string)
	if !validID(vendor) || !validDate(date) || !ok || (expected != "" && !validDate(expected)) {
		return nil, false
	}
	notes, ok := purchaseNullableText(input, "notes", 10000)
	if !ok {
		return nil, false
	}
	var arrival any
	if expected != "" {
		arrival = expected
	}
	return erpwire.Row{"p_vendor_id": vendor, "p_order_date": date, "p_expected_date": arrival, "p_notes": notes}, true
}
func purchaseBillInput(input erpwire.Row) (erpwire.Row, bool) {
	reference, ok := input["vendor_reference"].(string)
	reference = jsTrim(reference)
	date, due := text(input["bill_date"]), text(input["due_date"])
	if !ok || jsLength(reference) < 1 || jsLength(reference) > 200 || !validDate(date) || !validDate(due) || due < date {
		return nil, false
	}
	vat, ok := purchaseNumber(input["input_vat_satang"])
	if !ok {
		return nil, false
	}
	v, e := purchaseExactInt(json.Number(vat))
	if e != nil || v < 0 || v > int64(money.MaxSafeSatang) {
		return nil, false
	}
	total, ok := purchaseNumber(input["vendor_total_satang"])
	if !ok {
		return nil, false
	}
	t, e := purchaseExactInt(json.Number(total))
	if e != nil || t < v || t > int64(money.MaxSafeSatang) {
		return nil, false
	}
	rate, e := purchaseRational(input["input_vat_rate"], false)
	if e != nil || rate.Sign() < 0 || rate.Cmp(big.NewRat(100, 1)) > 0 {
		return nil, false
	}
	rate.Mul(rate, big.NewRat(100, 1))
	if !rate.IsInt() {
		return nil, false
	}
	reason, ok := input["variance_reason"].(string)
	reason = jsTrim(reason)
	if !ok || jsLength(reason) > 2000 {
		return nil, false
	}
	source, ok := input["lines"].([]any)
	if !ok || len(source) == 0 {
		return nil, false
	}
	lines := []erpwire.Row{}
	for _, item := range source {
		line, ok := item.(map[string]any)
		if !ok || !validID(text(line["id"])) {
			return nil, false
		}
		q, e := purchaseQuantity(line["quantity"], false, true)
		if e != nil {
			return nil, false
		}
		previous, e := purchaseQuantity(line["expected_quantity"], false, true)
		if e != nil {
			return nil, false
		}
		costN, ok := purchaseNumber(line["unit_cost_satang"])
		cost, e := purchaseExactInt(json.Number(costN))
		if !ok || e != nil || cost < 0 || cost > int64(money.MaxSafeSatang) {
			return nil, false
		}
		lines = append(lines, erpwire.Row{"id": line["id"], "quantity": purchaseDecimal(q), "expected_quantity": purchaseDecimal(previous), "unit_cost_satang": cost})
	}
	return erpwire.Row{"vendor_reference": reference, "bill_date": date, "due_date": due, "input_vat_rate": input["input_vat_rate"], "input_vat_satang": v, "vendor_total_satang": t, "variance_reason": reason, "lines": lines}, true
}
func purchaseCreditInput(input erpwire.Row) (erpwire.Row, bool) {
	reference, ok := input["vendor_reference"].(string)
	reference = jsTrim(reference)
	date := text(input["bill_date"])
	if !ok || jsLength(reference) < 1 || jsLength(reference) > 200 || !validDate(date) {
		return nil, false
	}
	n, ok := purchaseNumber(input["input_vat_satang"])
	vat, e := purchaseExactInt(json.Number(n))
	if !ok || e != nil || vat < 0 || vat > int64(money.MaxSafeSatang) {
		return nil, false
	}
	reason := ""
	if x, present := input["variance_reason"]; present {
		var ok bool
		reason, ok = x.(string)
		if !ok {
			return nil, false
		}
		reason = jsTrim(reason)
		if jsLength(reason) > 2000 {
			return nil, false
		}
	}
	row := erpwire.Row{"vendor_reference": reference, "bill_date": date, "input_vat_satang": vat, "variance_reason": reason}
	if source, present := input["cost_ids"]; present {
		ids, ok := source.([]any)
		if !ok || len(ids) == 0 {
			return nil, false
		}
		seen := map[string]bool{}
		for _, id := range ids {
			s, ok := id.(string)
			lower := strings.ToLower(s)
			if !ok || !validID(s) || seen[lower] {
				return nil, false
			}
			seen[lower] = true
		}
		row["cost_ids"] = ids
	}
	allocations, ok := input["allocations"].([]any)
	if !ok {
		if !validID(text(input["original_bill_id"])) {
			return nil, false
		}
		allocations = []any{map[string]any{"original_bill_id": input["original_bill_id"], "lines": input["lines"]}}
	}
	if len(allocations) == 0 {
		return nil, false
	}
	out := []erpwire.Row{}
	seen := map[string]bool{}
	for _, entry := range allocations {
		allocation, ok := entry.(map[string]any)
		if !ok {
			return nil, false
		}
		id := text(allocation["original_bill_id"])
		lower := strings.ToLower(id)
		if !validID(id) || seen[lower] {
			return nil, false
		}
		seen[lower] = true
		lines, ok := allocation["lines"].([]any)
		if !ok || len(lines) == 0 {
			return nil, false
		}
		lineSeen := map[string]bool{}
		lineOut := []erpwire.Row{}
		for _, entry := range lines {
			line, ok := entry.(map[string]any)
			if !ok {
				return nil, false
			}
			id := text(line["id"])
			lower := strings.ToLower(id)
			q, e := purchaseQuantity(line["quantity"], false, true)
			if !validID(id) || lineSeen[lower] || e != nil {
				return nil, false
			}
			lineSeen[lower] = true
			lineOut = append(lineOut, erpwire.Row{"id": id, "quantity": purchaseDecimal(q)})
		}
		out = append(out, erpwire.Row{"original_bill_id": id, "lines": lineOut})
	}
	row["allocations"] = out
	return row, true
}
