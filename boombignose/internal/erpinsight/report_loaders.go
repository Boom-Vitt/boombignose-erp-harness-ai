package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

func (s *Service) reportOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/(app)/reports/page.tsx::load":            s.reportPage,
		"app/(app)/reports/statements/page.tsx::load": s.reportStatements,
		"app/(app)/reports/vat/page.tsx::load": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportSupportPage(ctx, a, "vat", r)
		},
		"app/(app)/reports/wht/page.tsx::load": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportSupportPage(ctx, a, "wht", r)
		},
		"app/(app)/reports/accountant-pack/page.tsx::load": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportSupportPage(ctx, a, "pack", r)
		},
		"app/(app)/reports/print/route.ts::GET": s.reportPrint,
		"app/(app)/reports/vat/export/route.ts::GET": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportExport(ctx, a, "vat_support_csv", r)
		},
		"app/(app)/reports/wht/export/route.ts::GET": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportExport(ctx, a, "wht_support_csv", r)
		},
		"app/(app)/reports/accountant-pack/export/route.ts::GET": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportExport(ctx, a, "accountant_pack_csv", r)
		},
		"app/(app)/reports/accountant-pack/print/route.ts::GET": func(ctx context.Context, a erpwire.Actor, r json.RawMessage) (any, error) {
			return s.reportExport(ctx, a, "accountant_pack_print", r)
		},
		"app/(app)/reports/wht/actions.ts::recordPurchaseWithholding": s.reportRecordWHT,
		"app/(app)/reports/lang-action.ts::saveLang":                  s.reportSaveLang,
	}
}

type reportPivot struct {
	Rows       []string           `json:"rowKeys"`
	Cols       []string           `json:"colKeys"`
	Cells      erpwire.BrowserMap `json:"cells"`
	RowTotals  erpwire.BrowserMap `json:"rowTotals"`
	ColTotals  erpwire.BrowserMap `json:"colTotals"`
	GrandTotal int64              `json:"grandTotal"`
	grid       map[string]map[string]int64
	rowTotals  map[string]int64
	colTotals  map[string]int64
}
type reportProjectHours struct {
	Name          string  `json:"project_name"`
	Minutes       int64   `json:"totalMinutes"`
	Billable      int64   `json:"billableMinutes"`
	NonBillable   int64   `json:"nonBillableMinutes"`
	Hours         float64 `json:"totalHours"`
	BillableHours float64 `json:"billableHours"`
}
type reportHours struct {
	Projects      []reportProjectHours `json:"projects"`
	Minutes       int64                `json:"totalMinutes"`
	Billable      int64                `json:"billableMinutes"`
	Hours         float64              `json:"totalHours"`
	BillableHours float64              `json:"billableHours"`
}
type reportMonthAmount struct {
	Month  string `json:"month"`
	Amount int64  `json:"amount_satang"`
}
type reportPurchaseVAT struct {
	Month string `json:"month"`
	Base  int64  `json:"base_satang"`
	VAT   int64  `json:"input_vat_satang"`
	Total int64  `json:"total_satang"`
}
type reportData struct {
	OrgName      string              `json:"orgName"`
	Months       []string            `json:"months"`
	Range        string              `json:"rangeLabel"`
	Generated    string              `json:"generatedAt"`
	Revenue      reportPivot         `json:"revenue"`
	Hours        reportHours         `json:"hours"`
	TotalRevenue int64               `json:"totalRevenueSatang"`
	COGS         []reportMonthAmount `json:"cogsByMonth"`
	PurchaseVAT  []reportPurchaseVAT `json:"purchaseVatByMonth"`
	TotalCOGS    int64               `json:"totalCogsSatang"`
}

func reportMonthKey(value string) string {
	if len(value) == 10 {
		return value[:7]
	}
	if instant, e := time.Parse(time.RFC3339Nano, value); e == nil {
		return instant.In(reportZone).Format("2006-01")
	}
	return ""
}
func reportHoursNumber(minutes int64) float64 { return math.Floor(float64(minutes)/60*100+0.5) / 100 }
func readReportData(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, now time.Time) (reportData, error) {
	current := now.In(reportZone)
	start := time.Date(current.Year(), current.Month(), 1, 0, 0, 0, 0, reportZone).AddDate(0, -5, 0)
	data := reportData{OrgName: a.OrgName(), Generated: "Generated " + current.Format("2006-01-02"), Months: []string{}, COGS: []reportMonthAmount{}, PurchaseVAT: []reportPurchaseVAT{}, Hours: reportHours{Projects: []reportProjectHours{}}}
	months := map[string]bool{}
	for i := 0; i < 6; i++ {
		month := start.AddDate(0, i, 0).Format("2006-01")
		data.Months = append(data.Months, month)
		months[month] = true
	}
	data.Range = data.Months[0] + " – " + data.Months[5]
	load := func(table string, columns []string, where ...erpwire.Predicate) ([]erpwire.Row, error) {
		return all(ctx, tx, selection(a, table, columns, where...))
	}
	q := selection(a, "invoices", []string{"id", "status", "total_satang", "vat_satang", "issue_date"}, erpwire.Predicate{Column: "issue_date", Op: erpwire.GreaterEqual, Value: start.Format("2006-01-02")}, erpwire.Predicate{Column: "status", Op: erpwire.NotEqual, Value: "draft"}, erpwire.Predicate{Column: "status", Op: erpwire.NotEqual, Value: "cancelled"})
	q.Relations = []erpwire.Relation{{Name: "clients", Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: []string{"name"}}}
	invoices, err := all(ctx, tx, q)
	if err != nil {
		return data, err
	}
	q = selection(a, "time_entries", []string{"id", "minutes", "billable", "work_date"}, erpwire.Predicate{Column: "work_date", Op: erpwire.GreaterEqual, Value: start.Format("2006-01-02")})
	q.Relations = []erpwire.Relation{{Name: "projects", Table: "projects", LocalColumn: "project_id", ForeignColumn: "id", Columns: []string{"name"}}}
	entries, err := all(ctx, tx, q)
	if err != nil {
		return data, err
	}
	cogsQ := selection(a, "monthly_inventory_cogs", []string{"month", "amount_satang"}, erpwire.Predicate{Column: "month", Op: erpwire.GreaterEqual, Value: start.Format("2006-01-02")})
	cogsQ.Order = []erpwire.Order{{Column: "month"}}
	cogs, err := all(ctx, tx, cogsQ)
	if err != nil {
		return data, err
	}
	vatQ := selection(a, "monthly_purchase_vat", []string{"month", "base_satang", "input_vat_satang", "total_satang"}, erpwire.Predicate{Column: "month", Op: erpwire.GreaterEqual, Value: start.Format("2006-01-02")})
	vatQ.Order = []erpwire.Order{{Column: "month"}}
	vat, err := all(ctx, tx, vatQ)
	if err != nil {
		return data, err
	}
	credits, err := load("credit_note_revenue", []string{"id", "invoice_id", "issue_date", "project_id", "client_name", "base_satang", "total_satang"})
	if err != nil {
		return data, err
	}
	pivot := reportPivot{Rows: []string{}, Cols: []string{}, grid: map[string]map[string]int64{}, rowTotals: map[string]int64{}, colTotals: map[string]int64{}}
	addRevenue := func(name, month string, value int64) error {
		if !months[month] {
			return nil
		}
		if pivot.grid[name] == nil {
			pivot.grid[name] = map[string]int64{}
			pivot.Rows = append(pivot.Rows, name)
		}
		if _, ok := pivot.colTotals[month]; !ok {
			pivot.Cols = append(pivot.Cols, month)
		}
		var e error
		pivot.grid[name][month], e = reportSum(pivot.grid[name][month], value)
		if e != nil {
			return e
		}
		pivot.rowTotals[name], e = reportSum(pivot.rowTotals[name], value)
		if e != nil {
			return e
		}
		pivot.colTotals[month], e = reportSum(pivot.colTotals[month], value)
		if e != nil {
			return e
		}
		pivot.GrandTotal, e = reportSum(pivot.GrandTotal, value)
		return e
	}
	for _, row := range invoices {
		if has([]string{"draft", "cancelled"}, text(row["status"])) || !months[reportMonthKey(text(row["issue_date"]))] {
			continue
		}
		total, e := reportNumber(row["total_satang"], "Invoice total", false)
		if e != nil {
			return data, e
		}
		vat, e := reportNumber(row["vat_satang"], "Invoice VAT", false)
		if e != nil {
			return data, e
		}
		base, e := reportSum(total, -vat)
		if e != nil {
			return data, e
		}
		name := text(reportObject(row["clients"])["name"])
		if reportObject(row["clients"])["name"] == nil {
			name = "Unassigned"
		}
		if e = addRevenue(name, reportMonthKey(text(row["issue_date"])), base); e != nil {
			return data, e
		}
	}
	for _, row := range credits {
		if !months[reportMonthKey(text(row["issue_date"]))] {
			continue
		}
		base, e := reportNumber(row["base_satang"], "Credit note base", false)
		if e != nil {
			return data, e
		}
		if e = addRevenue(text(row["client_name"]), reportMonthKey(text(row["issue_date"])), -base); e != nil {
			return data, e
		}
	}
	sort.Slice(pivot.Rows, func(i, j int) bool { return reportJSLess(pivot.Rows[i], pivot.Rows[j]) })
	sort.Slice(pivot.Cols, func(i, j int) bool { return reportJSLess(pivot.Cols[i], pivot.Cols[j]) })
	cells, rows, cols := [][2]any{}, [][2]any{}, [][2]any{}
	for _, name := range pivot.Rows {
		inner := [][2]any{}
		for _, month := range pivot.Cols {
			if value, ok := pivot.grid[name][month]; ok {
				inner = append(inner, [2]any{month, value})
			}
		}
		cells = append(cells, [2]any{name, erpwire.Map(inner)})
		rows = append(rows, [2]any{name, pivot.rowTotals[name]})
	}
	for _, month := range pivot.Cols {
		cols = append(cols, [2]any{month, pivot.colTotals[month]})
	}
	pivot.Cells = erpwire.Map(cells)
	pivot.RowTotals = erpwire.Map(rows)
	pivot.ColTotals = erpwire.Map(cols)
	data.Revenue = pivot
	data.TotalRevenue = pivot.GrandTotal
	projects := map[string]*reportProjectHours{}
	for _, row := range entries {
		if !months[reportMonthKey(text(row["work_date"]))] {
			continue
		}
		name := text(reportObject(row["projects"])["name"])
		if reportObject(row["projects"])["name"] == nil {
			name = "No project"
		}
		p := projects[name]
		if p == nil {
			p = &reportProjectHours{Name: name}
			projects[name] = p
		}
		minutes, e := integer(row["minutes"])
		if e != nil {
			return data, e
		}
		p.Minutes, e = reportSum(p.Minutes, minutes)
		if e != nil {
			return data, e
		}
		if row["billable"] == true {
			p.Billable, e = reportSum(p.Billable, minutes)
			if e != nil {
				return data, e
			}
		}
	}
	for _, p := range projects {
		p.NonBillable = p.Minutes - p.Billable
		p.Hours = reportHoursNumber(p.Minutes)
		p.BillableHours = reportHoursNumber(p.Billable)
		data.Hours.Projects = append(data.Hours.Projects, *p)
		data.Hours.Minutes, err = reportSum(data.Hours.Minutes, p.Minutes)
		if err != nil {
			return data, err
		}
		data.Hours.Billable, err = reportSum(data.Hours.Billable, p.Billable)
		if err != nil {
			return data, err
		}
	}
	compare := collate.New(language.English)
	sort.SliceStable(data.Hours.Projects, func(i, j int) bool {
		return compare.CompareString(data.Hours.Projects[i].Name, data.Hours.Projects[j].Name) < 0
	})
	data.Hours.Hours = reportHoursNumber(data.Hours.Minutes)
	data.Hours.BillableHours = reportHoursNumber(data.Hours.Billable)
	for _, month := range data.Months {
		c := reportMonthAmount{Month: month}
		for _, row := range cogs {
			if !strings.HasPrefix(text(row["month"]), month) {
				continue
			}
			amount, e := reportNumber(row["amount_satang"], "COGS", false)
			if e != nil {
				return data, e
			}
			c.Amount, e = reportSum(c.Amount, amount)
			if e != nil {
				return data, e
			}
		}
		data.COGS = append(data.COGS, c)
		data.TotalCOGS, err = reportSum(data.TotalCOGS, c.Amount)
		if err != nil {
			return data, err
		}
		v := reportPurchaseVAT{Month: month}
		for _, row := range vat {
			if !strings.HasPrefix(text(row["month"]), month) {
				continue
			}
			for _, field := range []struct {
				key string
				dst *int64
			}{{"base_satang", &v.Base}, {"input_vat_satang", &v.VAT}, {"total_satang", &v.Total}} {
				amount, e := reportNumber(row[field.key], "Purchase VAT", false)
				if e != nil {
					return data, e
				}
				*field.dst, e = reportSum(*field.dst, amount)
				if e != nil {
					return data, e
				}
			}
		}
		data.PurchaseVAT = append(data.PurchaseVAT, v)
	}
	return data, nil
}
func (s *Service) reportPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := reportParams(raw)
	if err != nil {
		return nil, err
	}
	view := params["view"]
	if view != "line" && view != "pivot" {
		view = "bar"
	}
	var data reportData
	var close any
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; data, e = readReportData(ctx, tx, a, s.now()); return e })
	if err != nil {
		if reportSafeError(err) {
			return nil, err
		}
		return nil, errors.New("Operational reports unavailable. Reload before relying on totals.")
	}
	close, err = s.reportCloseChecklist(ctx, a)
	if err != nil {
		return nil, err
	}
	return erpwire.Row{"data": data, "view": view, "close": close, "canReviewFinanceClose": erpwire.Can(a.Role(), "audit:view"), "canDownloadAccountantPack": erpwire.Can(a.Role(), "audit:view")}, nil
}
func (s *Service) reportPrint(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	if _, err := arguments(raw, 0, 0); err != nil {
		return nil, err
	}
	var data reportData
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; data, e = readReportData(ctx, tx, a, s.now()); return e })
	if err != nil {
		if reportSafeError(err) {
			return nil, err
		}
		return nil, errors.New("Operational reports unavailable. Reload before relying on totals.")
	}
	return HTTPResponse{Status: 200, Headers: map[string]string{"Content-Type": "text/html; charset=utf-8"}, Body: reportRenderOperational(data)}, nil
}
func (s *Service) reportSupportPage(ctx context.Context, a erpwire.Actor, kind string, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := reportParams(raw)
	if err != nil {
		return nil, err
	}
	lang := "th"
	if kind != "pack" {
		lang, err = s.reportLang(ctx, a)
		if err != nil {
			return nil, err
		}
	}
	out := erpwire.Row{"allowed": erpwire.Can(a.Role(), "audit:view"), "lang": lang}
	if !erpwire.Can(a.Role(), "audit:view") {
		out["message"] = "Only an owner, an admin, or an accountant can open this report."
		if kind == "pack" {
			out["message"] = "Only an owner, an admin, or an accountant can download this pack."
		}
		return out, nil
	}
	month := trimText(params["month"])
	if month == "" {
		now := s.now().In(reportZone)
		month = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, reportZone).AddDate(0, -1, 0).Format("2006-01")
	}
	out["month"] = month
	out["error"] = params["error"]
	out["saved"] = params["saved"] != ""
	if _, ok := reportMonth(month); !ok {
		out["message"] = "Choose a month as YYYY-MM."
		out["validMonth"] = false
		return out, nil
	}
	out["validMonth"] = true
	loaded, err := s.loadReportPack(ctx, a, month)
	if err != nil {
		return nil, err
	}
	if !loaded.OK {
		out["message"] = loaded.Message
		return out, nil
	}
	pack := *loaded.Pack
	switch kind {
	case "pack":
		out["pack"] = pack
	case "vat":
		report, e := reportBuildVAT(pack)
		if e != nil {
			return nil, e
		}
		out["report"] = report
	case "wht":
		report, e := reportBuildWHT(pack, "")
		if e != nil {
			return nil, e
		}
		out["report"] = report
		out["canRecord"] = a.Role() == erpwire.Owner || a.Role() == erpwire.Admin
		if out["canRecord"] == true {
			start, _ := reportMonth(month)
			open := []erpwire.Row{}
			e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
				costs, e := all(ctx, tx, selection(a, "costs", []string{"id", "vendor", "bill_number", "amount_satang", "input_vat_satang", "incurred_on"}, erpwire.Predicate{Column: "amount_satang", Op: erpwire.Greater, Value: int64(0)}, erpwire.Predicate{Column: "incurred_on", Op: erpwire.GreaterEqual, Value: start.Format("2006-01-02")}, erpwire.Predicate{Column: "incurred_on", Op: erpwire.Less, Value: start.AddDate(0, 1, 0).Format("2006-01-02")}))
				if e != nil {
					return e
				}
				done, e := all(ctx, tx, selection(a, "purchase_withholdings", []string{"id", "cost_id"}))
				if e != nil {
					return e
				}
				taken := map[string]bool{}
				for _, r := range done {
					taken[text(r["cost_id"])] = true
				}
				for _, r := range costs {
					if !taken[text(r["id"])] && len(open) < 200 {
						open = append(open, r)
					}
				}
				return nil
			})
			if reportSafeError(e) {
				return nil, e
			}
			if e != nil {
				out["costsError"] = "Could not load costs."
			} else {
				out["openCosts"] = open
			}
		}
	}
	return out, nil
}
func (s *Service) reportLang(ctx context.Context, a erpwire.Actor) (string, error) {
	lang := "th"
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		row, e := one(ctx, tx, erpwire.Select{Table: "profiles", Columns: []string{"locale"}, Where: []erpwire.Predicate{eq("id", a.UserID())}})
		if e != nil {
			return e
		}
		if text(row["locale"]) == "en" {
			lang = "en"
		}
		return nil
	})
	if reportSafeError(err) {
		return "", err
	}
	return lang, nil
}
func (s *Service) reportSaveLang(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	args, err := arguments(raw, 1, 1)
	if err != nil {
		return nil, err
	}
	var lang string
	if args.Decode(0, &lang) != nil || !has([]string{"th", "en"}, lang) {
		return response(""), nil
	}
	if err = authorize(a, ""); err != nil {
		return nil, err
	}
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Update(ctx, "profiles", erpwire.Row{"locale": lang}, []erpwire.Predicate{eq("id", a.UserID())}, nil)
		return e
	})
	if reportSafeError(err) {
		return nil, err
	}
	return response(""), nil
}
func (s *Service) reportRecordWHT(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	args, err := arguments(raw, 1, 1)
	if err != nil {
		return nil, err
	}
	form, err := args.Form(0)
	if err != nil {
		return nil, err
	}
	get := func(k string) string { v, _ := form.Text(k); return v }
	month := get("month")
	if _, ok := reportMonth(month); !ok {
		month = ""
	}
	rate := reportRateInput(get("rate_bps"))
	err = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "record_purchase_withholding", erpwire.Row{"p_org_id": a.OrgID(), "p_cost_id": get("cost_id"), "p_paid_on": get("paid_on"), "p_form": get("form"), "p_income_type": get("income_type"), "p_rate_bps": rate})
		return e
	})
	if err != nil {
		if reportSafeError(err) {
			return nil, err
		}
		message := publicMessage(err, "Unable to record purchase withholding.")
		units := utf16.Encode([]rune(message))
		if len(units) > 160 {
			if units[159] >= 0xD800 && units[159] <= 0xDBFF {
				return nil, errors.New("URI malformed")
			}
			message = string(utf16.Decode(units[:160]))
		}
		return response("/reports/wht?month=" + month + "&error=" + reportURIComponent(message)), nil
	}
	return response("/reports/wht?month="+month+"&saved=1", "/reports/wht"), nil
}

func reportJSLess(left, right string) bool {
	a, b := utf16.Encode([]rune(left)), utf16.Encode([]rune(right))
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}

func reportURIComponent(value string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*").Replace(url.QueryEscape(value))
}

func reportRateInput(value string) any {
	value = trimText(value)
	if value == "" {
		return int64(0)
	}
	if len(value) > 2 && (strings.HasPrefix(value, "0x") || strings.HasPrefix(value, "0X") || strings.HasPrefix(value, "0b") || strings.HasPrefix(value, "0B") || strings.HasPrefix(value, "0o") || strings.HasPrefix(value, "0O")) {
		if integer, ok := new(big.Int).SetString(value, 0); ok {
			number, _ := new(big.Float).SetInt(integer).Float64()
			if !math.IsInf(number, 0) {
				return json.Number(strconv.FormatFloat(number, 'g', -1, 64))
			}
		}
		return nil
	}
	// Rates follow Number(form text); financial amounts never enter this conversion.
	if !reportRateDecimal.MatchString(value) {
		return nil
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
		return nil
	}
	return json.Number(strconv.FormatFloat(number, 'g', -1, 64))
}
