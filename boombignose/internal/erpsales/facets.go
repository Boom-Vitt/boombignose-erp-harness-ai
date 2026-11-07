package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type SalesFacets struct {
	Q         string `json:"q,omitempty"`
	Status    string `json:"status,omitempty"`
	Period    string `json:"period,omitempty"`
	Mine      string `json:"mine,omitempty"`
	GroupBy   string `json:"groupBy,omitempty"`
	Warehouse string `json:"warehouse,omitempty"`
	Product   string `json:"product,omitempty"`
	SourceID  string `json:"sourceId,omitempty"`
}
type SalesGroup struct {
	Key         string        `json:"key"`
	Label       string        `json:"label"`
	Rows        []erpwire.Row `json:"rows"`
	TotalSatang *money.Satang `json:"totalSatang,omitempty"`
}

func salesParams(args erpwire.Arguments) (erpwire.Row, error) {
	out := erpwire.Row{}
	if len(args) == 0 {
		return out, nil
	}
	if args.Null(0) || args.Decode(0, &out) != nil || out == nil {
		return nil, erpwire.ErrBadArguments
	}
	return out, nil
}
func salesFacetValues(s string) []string {
	out := []string{}
	for _, v := range strings.Split(s, ",") {
		if v = jsTrim(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}
func salesParseFacets(p erpwire.Row, list string) SalesFacets {
	get := func(k string) string { return jsTrim(text(p[k])) }
	q := get("q")
	units := utf16.Encode([]rune(q))
	if len(units) > 200 {
		q = string(utf16.Decode(units[:200]))
	}
	statuses, groups := []string{}, []string{}
	switch list {
	case "quotes":
		statuses = []string{"draft", "sent", "accepted", "declined", "expired", "converted"}
		groups = []string{"status", "client", "month"}
	case "purchases":
		statuses = []string{"draft", "sent", "confirmed", "received", "billed", "cancelled", "closed"}
		groups = []string{"status", "vendor", "month"}
	case "vendors":
		statuses = []string{"active", "archived"}
		groups = []string{"status", "month"}
	case "inventory":
		statuses = []string{"receipt", "delivery", "adjustment_in", "adjustment_out", "transfer_in", "transfer_out", "vendor_return", "customer_return"}
	}
	selected := salesFacetValues(get("status"))
	valid := []string{}
	for _, v := range statuses {
		if has(selected, v) {
			valid = append(valid, v)
		}
	}
	out := SalesFacets{Q: q, Status: strings.Join(valid, ",")}
	if has([]string{"this_month", "last_month", "this_quarter", "this_year"}, get("period")) {
		out.Period = get("period")
	}
	if get("mine") == "1" {
		out.Mine = "1"
	}
	if has(groups, get("groupBy")) {
		out.GroupBy = get("groupBy")
	}
	if list == "inventory" {
		if validID(get("warehouse")) {
			out.Warehouse = get("warehouse")
		}
		if validID(get("product")) {
			out.Product = get("product")
		}
		if validID(get("sourceId")) {
			out.SourceID = get("sourceId")
		}
	}
	return out
}
func salesFacetLabel(v string) string {
	parts := strings.Split(v, "_")
	for i, p := range parts {
		if p != "" {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}
func salesMonthKey(value string) string {
	if len(value) == 10 {
		return value[:7]
	}
	instant, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return ""
	}
	return instant.In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01")
}
func salesPeriodRange(period string, now time.Time) (string, string) {
	now = now.In(time.FixedZone("Asia/Bangkok", 7*3600))
	year, month, _ := now.Date()
	m := int(month)
	length := 1
	switch period {
	case "last_month":
		m--
	case "this_quarter":
		m = (m-1)/3*3 + 1
		length = 3
	case "this_year":
		m = 1
		length = 12
	}
	start := time.Date(year, time.Month(m), 1, 0, 0, 0, 0, time.UTC)
	return start.Format("2006-01-02"), start.AddDate(0, length, 0).Format("2006-01-02")
}
func salesMatches(f SalesFacets, row erpwire.Row, searchText, date string, a erpwire.Actor, now time.Time) bool {
	if f.Q != "" && !strings.Contains(strings.ToLower(searchText), strings.ToLower(f.Q)) {
		return false
	}
	if f.Status != "" && !has(salesFacetValues(f.Status), text(row["status"])) {
		return false
	}
	if f.Mine != "" && text(row["owner"]) != a.UserID() {
		return false
	}
	if f.Period != "" {
		if date == "" {
			return false
		}
		if len(date) != 10 {
			d, e := time.Parse(time.RFC3339, date)
			if e != nil {
				return false
			}
			date = d.In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01-02")
		}
		start, end := salesPeriodRange(f.Period, now)
		if date < start || date >= end {
			return false
		}
	}
	return true
}
func salesSavedViews(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, list string) ([]erpwire.Row, error) {
	rows, e := all(ctx, tx, erpwire.Select{Table: "saved_views", Columns: []string{"id", "name", "config"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("user_id", a.UserID()), eq("module", list)}, Order: ordered("created_at", "id")})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		return nil, errors.New("Saved views unavailable. Please reload.")
	}
	for _, row := range rows {
		config := erpwire.Row{}
		switch v := row["config"].(type) {
		case erpwire.Row:
			config = v
		case map[string]any:
			config = v
		case json.RawMessage:
			_ = erpwire.DecodeJSON(v, &config)
		}
		row["config"] = salesParseFacets(config, list)
	}
	return rows, nil
}
func salesGroups(rows []erpwire.Row, key func(erpwire.Row) (string, string), amountColumn string) ([]SalesGroup, error) {
	out := []SalesGroup{}
	indices := map[string]int{}
	for _, row := range rows {
		k, label := "all", ""
		if key != nil {
			k, label = key(row)
		}
		i, ok := indices[k]
		if !ok {
			i = len(out)
			indices[k] = i
			out = append(out, SalesGroup{Key: k, Label: label, Rows: []erpwire.Row{}})
			if amountColumn != "" {
				v := money.Satang(0)
				out[i].TotalSatang = &v
			}
		}
		out[i].Rows = append(out[i].Rows, row)
		if amountColumn != "" {
			v, e := satang(row[amountColumn])
			if e != nil {
				return nil, e
			}
			sum, e := checkedSum(*out[i].TotalSatang, v)
			if e != nil {
				return nil, e
			}
			out[i].TotalSatang = &sum
		}
	}
	return out, nil
}
