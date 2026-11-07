package erpprojects

import (
	"context"
	"net/url"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var bangkok = time.FixedZone("Asia/Bangkok", 7*60*60)

func today(now time.Time) string { return now.In(bangkok).Format("2006-01-02") }
func dateOnly(value string) string {
	if len(value) == 10 {
		return value
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return ""
	}
	return today(t)
}
func monthKey(value string) string {
	date := dateOnly(value)
	if len(date) < 7 {
		return ""
	}
	return date[:7]
}

type FacetConfig struct {
	Q       string `json:"q,omitempty"`
	Status  string `json:"status,omitempty"`
	Period  string `json:"period,omitempty"`
	Mine    string `json:"mine,omitempty"`
	GroupBy string `json:"groupBy,omitempty"`
}
type SavedView struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Config FacetConfig `json:"config"`
}
type RowGroup struct {
	Key         string        `json:"key"`
	Label       string        `json:"label"`
	Rows        []erpwire.Row `json:"rows"`
	TotalSatang *money.Satang `json:"totalSatang,omitempty"`
}

func searchParams(raw []byte) (erpwire.Row, error) {
	args, err := arguments(raw, 0, 1)
	if err != nil {
		return nil, err
	}
	out := erpwire.Row{}
	if len(args) == 0 || args.Null(0) {
		return out, nil
	}
	if args.Decode(0, &out) != nil || out == nil {
		return nil, erpwire.ErrBadArguments
	}
	return out, nil
}
func parseFacets(params erpwire.Row, list string) FacetConfig {
	get := func(key string) string { return trim(text(params[key])) }
	q := get("q")
	units := utf16.Encode([]rune(q))
	if len(units) > 200 {
		q = string(utf16.Decode(units[:200]))
	}
	c := FacetConfig{Q: q}
	statuses, groups := projectStatuses, []string{"status", "client", "owner", "month"}
	if list == "timesheets" {
		statuses = []string{"billable", "non_billable"}
		groups = []string{"project", "month"}
	}
	picked := []string{}
	for _, value := range strings.Split(get("status"), ",") {
		picked = append(picked, trim(value))
	}
	values := []string{}
	for _, status := range statuses {
		if has(picked, status) {
			values = append(values, status)
		}
	}
	c.Status = strings.Join(values, ",")
	if has([]string{"this_month", "last_month", "this_quarter", "this_year"}, get("period")) {
		c.Period = get("period")
	}
	if get("mine") == "1" {
		c.Mine = "1"
	}
	if has(groups, get("groupBy")) {
		c.GroupBy = get("groupBy")
	}
	return c
}
func serializeFacets(c FacetConfig) string {
	parts := []string{}
	for _, pair := range [][2]string{{"q", c.Q}, {"status", c.Status}, {"period", c.Period}, {"mine", c.Mine}, {"groupBy", c.GroupBy}} {
		if pair[1] != "" {
			parts = append(parts, url.QueryEscape(pair[0])+"="+url.QueryEscape(pair[1]))
		}
	}
	return strings.Join(parts, "&")
}
func inPeriod(date, period string, now time.Time) bool {
	date = dateOnly(date)
	if date == "" {
		return false
	}
	now = now.In(bangkok)
	year, month, _ := now.Date()
	startMonth, length := int(month), 1
	switch period {
	case "last_month":
		startMonth--
	case "this_year":
		startMonth, length = 1, 12
	case "this_quarter":
		startMonth, length = (startMonth-1)/3*3+1, 3
	}
	start := time.Date(year, time.Month(startMonth), 1, 0, 0, 0, 0, time.UTC)
	return date >= start.Format("2006-01-02") && date < start.AddDate(0, length, 0).Format("2006-01-02")
}
func matches(c FacetConfig, label, status, date, owner string, a erpwire.Actor, now time.Time) bool {
	return (c.Q == "" || strings.Contains(strings.ToLower(label), strings.ToLower(c.Q))) && (c.Status == "" || has(strings.Split(c.Status, ","), status)) && (c.Period == "" || inPeriod(date, c.Period, now)) && (c.Mine == "" || owner == a.UserID())
}
func savedViews(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, list string) ([]SavedView, error) {
	rows, err := all(ctx, tx, erpwire.Select{Table: "saved_views", Columns: []string{"id", "name", "config"}, Where: append(scope(a), eq("user_id", a.UserID()), eq("module", list)), Order: ordered("created_at", "id")})
	if err != nil {
		return nil, loadError(err, "Saved views unavailable. Please reload.")
	}
	out := make([]SavedView, 0, len(rows))
	for _, row := range rows {
		out = append(out, SavedView{ID: text(row["id"]), Name: text(row["name"]), Config: parseFacets(relation(row, "config"), list)})
	}
	return out, nil
}
func groupRows(rows []erpwire.Row, group func(erpwire.Row) (string, string), amount func(erpwire.Row) (money.Satang, error)) ([]RowGroup, error) {
	out := []RowGroup{}
	positions := map[string]int{}
	for _, row := range rows {
		key, label := "all", ""
		if group != nil {
			key, label = group(row)
		}
		i, ok := positions[key]
		if !ok {
			i = len(out)
			positions[key] = i
			g := RowGroup{Key: key, Label: label, Rows: []erpwire.Row{}}
			if amount != nil {
				g.TotalSatang = new(money.Satang)
			}
			out = append(out, g)
		}
		out[i].Rows = append(out[i].Rows, row)
		if amount != nil {
			value, err := amount(row)
			if err != nil {
				return nil, err
			}
			total, err := add(*out[i].TotalSatang, value)
			if err != nil {
				return nil, err
			}
			*out[i].TotalSatang = total
		}
	}
	return out, nil
}
func namesMap(rows []erpwire.Row) (map[string]string, erpwire.BrowserMap) {
	names := map[string]string{}
	entries := [][2]any{}
	for _, row := range rows {
		if name := text(row["full_name"]); name != "" {
			id := text(row["user_id"])
			names[id] = name
			entries = append(entries, [2]any{id, name})
		}
	}
	return names, erpwire.Map(entries)
}
func options(ctx context.Context, tx selector, a erpwire.Actor, table string) ([]erpwire.Row, error) {
	return all(ctx, tx, erpwire.Select{Table: table, Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("name", "id")})
}
func fallback(value, otherwise string) string {
	if value == "" {
		return otherwise
	}
	return value
}
