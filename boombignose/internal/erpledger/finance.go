package erpledger

import (
	"context"
	"encoding/json"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type RouteResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

var numericCell = regexp.MustCompile(`^-?(?:0|[1-9]\d*)(?:\.\d+)?$`)

func csvCell(s string) string {
	if len(s) > 0 && strings.ContainsRune("=+-@\t\r", rune(s[0])) && !numericCell.MatchString(s) {
		s = "'" + s
	}
	if strings.ContainsAny(s, ",\"\r\n") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}
func csv(headers []string, rows [][]string) string {
	lines := []string{}
	for _, row := range append([][]string{headers}, rows...) {
		cells := make([]string, len(row))
		for i, s := range row {
			cells[i] = csvCell(s)
		}
		lines = append(lines, strings.Join(cells, ","))
	}
	return "\ufeff" + strings.Join(lines, "\r\n")
}
func (s *Service) exportCosts(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var costs []erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		costs, e = all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"category", "vendor", "notes", "amount_satang", "incurred_on", "vendor_invoice_reference", "bill_date", "input_vat_rate", "input_vat_satang"}, Where: scope(a), Order: []erpwire.Order{order("incurred_on", true), order("id", false)}})
		return e
	})
	if e != nil {
		if auth := readFailure(e, ""); auth == e {
			return nil, e
		}
		return RouteResponse{Status: 503, Headers: map[string]string{}, Body: "Cost export unavailable"}, nil
	}
	data := [][]string{}
	for _, cost := range costs {
		amount, e := satang(cost["amount_satang"])
		if e != nil {
			return nil, e
		}
		vat, e := satang(cost["input_vat_satang"])
		if e != nil {
			return nil, e
		}
		vendor := text(cost["vendor"])
		if cost["vendor"] == nil {
			vendor = text(cost["notes"])
		}
		rate := ""
		switch v := cost["input_vat_rate"].(type) {
		case json.Number:
			rate = string(v)
		case string:
			rate = v
		default:
			n, e := whole(v)
			if e != nil {
				return nil, e
			}
			rate = big.NewInt(n).String()
		}
		if strings.Contains(rate, ".") {
			rate = strings.TrimSuffix(strings.TrimRight(rate, "0"), ".")
		}
		data = append(data, []string{text(cost["category"]), vendor, money.FormatBaht(amount), text(cost["incurred_on"]), text(cost["vendor_invoice_reference"]), text(cost["bill_date"]), rate, money.FormatBaht(vat)})
	}
	return RouteResponse{Status: 200, Headers: map[string]string{"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="costs-` + today() + `.csv"`}, Body: csv([]string{"Category", "Vendor / description", "Amount (THB)", "Date", "Vendor invoice reference", "Bill date", "Input VAT rate (%)", "Input VAT (THB)"}, data)}, nil
}
func (s *Service) newCostPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	projects := []erpwire.Row{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		r, e := all(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"id", "name"}, Where: scope(a), Order: []erpwire.Order{order("name", false), order("id", false)}})
		if e != nil {
			return e
		}
		for _, p := range r {
			projects = append(projects, erpwire.Row{"value": p["id"], "label": p["name"]})
		}
		return nil
	})
	if e != nil && readFailure(e, "") == e {
		return nil, e
	}
	return erpwire.Row{"projects": projects, "today": today()}, nil
}

var invoiceStatuses = []string{"draft", "sent", "partially_paid", "paid", "overdue", "cancelled"}

func facets(params erpwire.Row) erpwire.Row {
	config := erpwire.Row{}
	get := func(key string) string { return trim(text(params[key])) }
	if q := get("q"); q != "" {
		if length(q) > 200 {
			q = string(utf16.Decode(utf16.Encode([]rune(q))[:200]))
		}
		config["q"] = q
	}
	picked := strings.Split(get("status"), ",")
	for i, v := range picked {
		picked[i] = trim(v)
	}
	statuses := []string{}
	for _, v := range invoiceStatuses {
		if has(picked, v) {
			statuses = append(statuses, v)
		}
	}
	if len(statuses) > 0 {
		config["status"] = strings.Join(statuses, ",")
	}
	if v := get("period"); has([]string{"this_month", "last_month", "this_quarter", "this_year"}, v) {
		config["period"] = v
	}
	if get("mine") == "1" {
		config["mine"] = "1"
	}
	if v := get("groupBy"); has([]string{"status", "client", "month"}, v) {
		config["groupBy"] = v
	}
	return config
}
func facetMatches(config, row erpwire.Row, a erpwire.Actor, now time.Time) bool {
	client := object(row["clients"])
	label := text(row["number"]) + " " + text(row["displayNumber"]) + " " + text(client["name"])
	if q := text(config["q"]); q != "" && !strings.Contains(strings.ToLower(label), strings.ToLower(q)) {
		return false
	}
	if status := text(config["status"]); status != "" && !has(strings.Split(status, ","), text(row["effectiveStatus"])) {
		return false
	}
	if config["mine"] == "1" && text(client["owner"]) != a.UserID() {
		return false
	}
	if period := text(config["period"]); period != "" {
		local := now.In(bangkok)
		month := local.Month()
		months := 1
		switch period {
		case "this_year":
			month = 1
			months = 12
		case "this_quarter":
			month = time.Month((int(month)-1)/3*3 + 1)
			months = 3
		case "last_month":
			month--
		}
		start := time.Date(local.Year(), month, 1, 0, 0, 0, 0, bangkok)
		date := dateOnly(text(row["issue_date"]))
		if date < start.Format("2006-01-02") || date >= start.AddDate(0, months, 0).Format("2006-01-02") {
			return false
		}
	}
	return true
}
func effectiveStatus(inv erpwire.Row, paid, credited money.Satang, today string) string {
	status := text(inv["status"])
	if status == "draft" || status == "cancelled" {
		return status
	}
	amount, _ := satang(inv["amount_satang"])
	if amount > 0 && paid+credited >= amount {
		return "paid"
	}
	if due := text(inv["due_date"]); due != "" && due < today {
		return "overdue"
	}
	if paid+credited > 0 {
		return "partially_paid"
	}
	return "sent"
}
func forecast(subs []erpwire.Row) (money.Satang, error) {
	total := new(big.Int)
	factors := map[string]int64{"weekly": 52, "monthly": 12, "quarterly": 4, "yearly": 1}
	for _, r := range subs {
		if r["status"] != "active" {
			continue
		}
		v, e := nonnegative(r["amount_satang"])
		factor, ok := factors[text(r["interval"])]
		if e != nil || !ok {
			return 0, businessError("MRR amount outside safe satang bounds")
		}
		total.Add(total, new(big.Int).Mul(big.NewInt(int64(v)), big.NewInt(factor)))
	}
	total.Add(total, big.NewInt(6))
	total.Quo(total, big.NewInt(12))
	if !total.IsInt64() || total.Int64() > int64(money.MaxSafeSatang) {
		return 0, businessError("MRR total outside safe satang bounds")
	}
	return money.Satang(total.Int64()), nil
}
func monthKey(s string) string {
	s = dateOnly(s)
	if len(s) >= 7 {
		return s[:7]
	}
	return ""
}
func invoiceGroups(invoices []erpwire.Row, group string) ([]erpwire.Row, error) {
	groups := []erpwire.Row{}
	positions := map[string]int{}
	for _, inv := range invoices {
		key, label := "all", ""
		switch group {
		case "client":
			key = text(inv["client_id"])
			client := object(inv["clients"])
			label = text(client["name"])
			if client["name"] == nil {
				label = "Unassigned"
			}
		case "month":
			key = monthKey(text(inv["issue_date"]))
			label = key
		case "status":
			key = text(inv["effectiveStatus"])
			words := strings.Split(key, "_")
			for i, w := range words {
				if len(w) > 0 {
					words[i] = strings.ToUpper(w[:1]) + w[1:]
				}
			}
			label = strings.Join(words, " ")
		}
		index, ok := positions[key]
		if !ok {
			index = len(groups)
			positions[key] = index
			groups = append(groups, erpwire.Row{"key": key, "label": label, "rows": []erpwire.Row{}, "totalSatang": money.Satang(0)})
		}
		g := groups[index]
		g["rows"] = append(g["rows"].([]erpwire.Row), inv)
		v, e := satang(inv["amount_satang"])
		if e != nil {
			return nil, e
		}
		if e = addTotal(g, "totalSatang", v); e != nil {
			return nil, e
		}
	}
	return groups, nil
}
func (s *Service) financePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	params, e := paramsInput(raw)
	if e != nil {
		return nil, e
	}
	config := facets(params)
	now := time.Now()
	today := now.In(bangkok).Format("2006-01-02")
	month := today[:7]
	out := erpwire.Row{"today": today, "month": month, "config": config, "tab": "invoices"}
	if params["tab"] == "costs" {
		out["tab"] = "costs"
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		invoices, e := all(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "number", "issued_snapshot_id", "amount_satang", "total_satang", "vat_satang", "status", "due_date", "issue_date", "is_recurring", "recurring_interval", "client_id"}, Relations: []erpwire.Relation{{Name: "clients", Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: []string{"name", "owner"}}}, Where: scope(a), Order: []erpwire.Order{order("issue_date", true), order("id", false)}})
		if e != nil {
			return e
		}
		payments, e := rows(ctx, tx, a, "payments", []string{"invoice_id", "amount_satang", "paid_at"}, eq("verification_state", "verified"))
		if e != nil {
			return e
		}
		costs, e := all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"id", "category", "amount_satang", "incurred_on", "vendor", "project_id", "vendor_id", "purchase_order_id", "expense_claim_id", "bill_number", "bill_date", "due_date", "paid_at", "vendor_invoice_reference", "input_vat_rate", "input_vat_satang"}, Relations: []erpwire.Relation{{Name: "projects", Table: "projects", LocalColumn: "project_id", ForeignColumn: "id", Columns: []string{"name"}}}, Where: scope(a), Order: []erpwire.Order{order("incurred_on", true), order("id", false)}})
		if e != nil {
			return e
		}
		subs, e := rows(ctx, tx, a, "subscriptions", []string{"status", "amount_satang", "interval"}, eq("status", "active"))
		if e != nil {
			return e
		}
		setting, e := settings(ctx, tx, a, "vat_registered")
		if e != nil {
			return e
		}
		views, e := all(ctx, tx, erpwire.Select{Table: "saved_views", Columns: []string{"id", "name", "config"}, Where: append(scope(a), eq("user_id", a.UserID()), eq("module", "finance")), Order: []erpwire.Order{order("created_at", false), order("id", false)}})
		if e != nil {
			return readFailure(e, "Saved views unavailable. Please reload.")
		}
		for _, r := range views {
			r["config"] = facets(object(r["config"]))
		}
		balances, e := all(ctx, tx, erpwire.Select{Table: "invoice_balances", Columns: []string{"invoice_id", "paid_satang", "credited_satang", "outstanding_satang"}, Where: scope(a), Order: []erpwire.Order{order("invoice_id", false)}})
		if e != nil {
			return e
		}
		credits, e := rows(ctx, tx, a, "credit_note_revenue", []string{"id", "invoice_id", "issue_date", "project_id", "client_name", "base_satang", "total_satang"})
		if e != nil {
			return e
		}
		byID := keyed(balances, "invoice_id")
		invoiceRows := []erpwire.Row{}
		filtered := []erpwire.Row{}
		metrics := zeroTotals("unpaidSatang", "revenueSatang", "cashReceivedSatang", "costsSatang")
		metrics["openCount"] = 0
		for _, inv := range invoices {
			id := text(inv["id"])
			paid, credited := money.Satang(0), money.Satang(0)
			if b := byID[id]; b != nil {
				paid, e = satang(b["paid_satang"])
				if e != nil {
					return e
				}
				credited, e = satang(b["credited_satang"])
				if e != nil {
					return e
				}
			}
			amount, e := satang(inv["amount_satang"])
			if e != nil {
				return e
			}
			outstanding := amount - paid - credited
			if outstanding < 0 {
				outstanding = 0
			}
			if outstanding > money.MaxSafeSatang {
				return erpwire.ErrUnsafeAmount
			}
			inv["paid_satang"] = paid
			inv["outstanding"] = outstanding
			display := text(inv["number"])
			if text(inv["issued_snapshot_id"]) == "" {
				display = "DRAFT-" + id[:min(len(id), 8)]
			}
			inv["displayNumber"] = display
			inv["effectiveStatus"] = effectiveStatus(inv, paid, credited, today)
			invoiceRows = append(invoiceRows, inv)
			if facetMatches(config, inv, a, now) {
				filtered = append(filtered, inv)
			}
			status := text(inv["status"])
			if status != "draft" && status != "cancelled" {
				if e = addTotal(metrics, "unpaidSatang", outstanding); e != nil {
					return e
				}
				if outstanding > 0 {
					increment(metrics, "openCount")
				}
				if monthKey(text(inv["issue_date"])) == month {
					total, e := satang(inv["total_satang"])
					if e != nil {
						return e
					}
					vat, e := satang(inv["vat_satang"])
					if e != nil {
						return e
					}
					base, e := sum(total, -vat)
					if e != nil {
						return e
					}
					if e = addTotal(metrics, "revenueSatang", base); e != nil {
						return e
					}
				}
			}
		}
		for _, credit := range credits {
			if monthKey(text(credit["issue_date"])) != month {
				continue
			}
			base, e := satang(credit["base_satang"])
			if e != nil {
				return e
			}
			if e = addTotal(metrics, "revenueSatang", -base); e != nil {
				return e
			}
		}
		for _, payment := range payments {
			if monthKey(text(payment["paid_at"])) != month {
				continue
			}
			amount, e := satang(payment["amount_satang"])
			if e != nil {
				return e
			}
			if e = addTotal(metrics, "cashReceivedSatang", amount); e != nil {
				return e
			}
		}
		for _, cost := range costs {
			if cost["category"] == "inventory" || monthKey(text(cost["incurred_on"])) != month {
				continue
			}
			amount, e := satang(cost["amount_satang"])
			if e != nil {
				return e
			}
			if setting["vat_registered"] == true {
				vat, e := satang(cost["input_vat_satang"])
				if e != nil {
					return e
				}
				amount, e = sum(amount, -vat)
				if e != nil {
					return e
				}
			}
			if e = addTotal(metrics, "costsSatang", amount); e != nil {
				return e
			}
		}
		metrics["mrrSatang"], e = forecast(subs)
		if e != nil {
			return e
		}
		groups, e := invoiceGroups(filtered, text(config["groupBy"]))
		if e != nil {
			return e
		}
		balanceMap := [][2]any{}
		for _, r := range balances {
			balanceMap = append(balanceMap, [2]any{r["invoice_id"], r})
		}
		out["invoices"] = invoiceRows
		out["filteredInvoiceRows"] = filtered
		out["groups"] = groups
		out["costs"] = costs
		out["payments"] = payments
		out["activeSubscriptions"] = subs
		out["savedViews"] = views
		out["balances"] = erpwire.Map(balanceMap)
		out["metrics"] = metrics
		out["canReviewClose"] = erpwire.Can(a.Role(), "profit:view")
		out["canManagePurchases"] = erpwire.Can(a.Role(), "purchase:manage")
		return nil
	})
	if e != nil {
		return nil, readFailure(e, "Finance data unavailable. Reload before relying on totals.")
	}
	return out, nil
}
