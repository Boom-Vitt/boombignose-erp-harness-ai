package erpprojects

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type BoardColumn struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	FoldedByDefault bool   `json:"foldedByDefault,omitempty"`
}

var boardColumns = []BoardColumn{{ID: "in_progress", Label: "In progress"}, {ID: "review", Label: "Review"}, {ID: "not_started", Label: "Not started"}, {ID: "support", Label: "Support"}, {ID: "paused", Label: "Paused"}, {ID: "delivered", Label: "Delivered"}, {ID: "cancelled", Label: "Cancelled", FoldedByDefault: true}}

type BoardCard struct {
	ID           string        `json:"id"`
	Stage        string        `json:"stage"`
	Title        string        `json:"title"`
	Href         string        `json:"href"`
	AmountSatang *money.Satang `json:"amountSatang"`
	Client       any           `json:"client"`
	Owner        any           `json:"owner"`
	Due          any           `json:"due"`
}
type ProjectsPageData struct {
	AllRows     []erpwire.Row      `json:"allRows"`
	Rows        []erpwire.Row      `json:"rows"`
	ListRows    []erpwire.Row      `json:"listRows"`
	Config      FacetConfig        `json:"config"`
	View        string             `json:"view"`
	FacetQuery  string             `json:"facetQuery"`
	SavedViews  []SavedView        `json:"savedViews"`
	OwnerNames  erpwire.BrowserMap `json:"ownerNames"`
	Cards       []BoardCard        `json:"cards"`
	Columns     []BoardColumn      `json:"columns"`
	MoveTargets []BoardColumn      `json:"moveTargets"`
	Groups      []RowGroup         `json:"groups"`
	Today       string             `json:"today"`
	StorageKey  string             `json:"storageKey"`
	Deadlines   erpwire.BrowserMap `json:"deadlines"`
}
type DeadlineMeta struct {
	Label string  `json:"label"`
	Note  *string `json:"note"`
	Tone  string  `json:"tone"`
}

func deadlineMeta(date string, now time.Time) *DeadlineMeta {
	if date == "" {
		return nil
	}
	target, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil
	}
	day, _ := time.Parse("2006-01-02", now.In(time.Local).Format("2006-01-02"))
	diff := int(target.Sub(day).Hours() / 24)
	out := &DeadlineMeta{Label: strings.Replace(target.Format("2 Jan 2006"), " Sep ", " Sept ", 1), Tone: "default"}
	note := ""
	switch {
	case diff < 0:
		out.Tone = "danger"
		note = fmt.Sprintf("%d days overdue", -diff)
		if diff == -1 {
			note = "1 day overdue"
		}
	case diff == 0:
		out.Tone = "warning"
		note = "Due today"
	case diff <= 7:
		out.Tone = "warning"
		note = fmt.Sprintf("In %d days", diff)
		if diff == 1 {
			note = "Due tomorrow"
		}
	}
	if note != "" {
		out.Note = &note
	}
	return out
}
func statusIndex(status string) int {
	for i, c := range boardColumns {
		if c.ID == status {
			return i
		}
	}
	return -1
}
func projectLabel(status string) string {
	for _, c := range boardColumns {
		if c.ID == status {
			return c.Label
		}
	}
	return status
}
func (s *Service) projectsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := searchParams(raw)
	if err != nil {
		return nil, err
	}
	now := s.now()
	config := parseFacets(params, "projects")
	out := ProjectsPageData{Config: config, View: "list", FacetQuery: serializeFacets(config), Rows: []erpwire.Row{}, Cards: []BoardCard{}, Columns: []BoardColumn{}, MoveTargets: append([]BoardColumn{}, boardColumns...), Today: today(now), StorageKey: "kanban:projects:" + a.UserID()}
	if text(params["view"]) == "board" {
		out.View = "board"
	}
	var names map[string]string
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.SavedViews, err = savedViews(ctx, tx, a, "projects")
		if err != nil {
			return err
		}
		out.AllRows, err = all(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"id", "name", "status", "deadline", "owner", "client_id", "budget_satang"}, Relations: []erpwire.Relation{clientRelation("client")}, Where: scope(a), Order: []erpwire.Order{{Column: "deadline"}, {Column: "created_at", Descending: true}, {Column: "id"}}})
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	profiles, err := s.optionalPeople(ctx, a)
	if err != nil {
		return nil, err
	}
	names, out.OwnerNames = namesMap(profiles)
	for _, column := range boardColumns {
		if config.Status == "" || has(strings.Split(config.Status, ","), column.ID) {
			out.Columns = append(out.Columns, column)
		}
	}
	deadlines := [][2]any{}
	for _, row := range out.AllRows {
		if !matches(config, text(row["name"])+" "+text(relation(row, "client")["name"]), text(row["status"]), text(row["deadline"]), text(row["owner"]), a, now) {
			continue
		}
		out.Rows = append(out.Rows, row)
		id := text(row["id"])
		var amount *money.Satang
		if row["budget_satang"] != nil {
			value, err := satang(row["budget_satang"])
			if err != nil {
				return nil, err
			}
			amount = &value
		}
		due := row["deadline"]
		if has([]string{"delivered", "cancelled"}, text(row["status"])) {
			due = nil
		}
		out.Cards = append(out.Cards, BoardCard{ID: id, Stage: text(row["status"]), Title: text(row["name"]), Href: "/projects/" + id, AmountSatang: amount, Client: nullable(text(relation(row, "client")["name"])), Owner: nullable(names[text(row["owner"])]), Due: due})
		deadlines = append(deadlines, [2]any{id, deadlineMeta(text(row["deadline"]), now)})
	}
	out.Deadlines = erpwire.Map(deadlines)
	out.ListRows = append([]erpwire.Row{}, out.Rows...)
	if config.GroupBy == "status" {
		sort.SliceStable(out.ListRows, func(i, j int) bool {
			return statusIndex(text(out.ListRows[i]["status"])) < statusIndex(text(out.ListRows[j]["status"]))
		})
	}
	var group func(erpwire.Row) (string, string)
	if config.GroupBy != "" {
		group = func(row erpwire.Row) (string, string) {
			switch config.GroupBy {
			case "status":
				status := text(row["status"])
				return status, projectLabel(status)
			case "client":
				return text(row["client_id"]), fallback(text(relation(row, "client")["name"]), "No client")
			case "owner":
				return text(row["owner"]), fallback(names[text(row["owner"])], "Unassigned")
			default:
				month := monthKey(text(row["deadline"]))
				return month, fallback(month, "No deadline")
			}
		}
	}
	out.Groups, err = groupRows(out.ListRows, group, nil)
	return out, err
}

type ProjectFormData struct {
	Project            erpwire.Row   `json:"project,omitempty"`
	Clients            []erpwire.Row `json:"clients"`
	Members            []erpwire.Row `json:"members"`
	DefaultValues      erpwire.Row   `json:"defaultValues"`
	ResolvedDealID     any           `json:"resolvedDealId"`
	SubmitLabel        string        `json:"submitLabel"`
	Description        string        `json:"description,omitempty"`
	RedirectsOnSuccess bool          `json:"redirectsOnSuccess"`
}

func (s *Service) formOptions(ctx context.Context, a erpwire.Actor, out *ProjectFormData) error {
	var err error
	out.Clients, err = s.optionalRows(ctx, a, erpwire.Select{Table: "clients", Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("name", "id")})
	if err != nil {
		return err
	}
	people, err := s.optionalPeople(ctx, a)
	if err != nil {
		return err
	}
	out.Members = []erpwire.Row{}
	for _, person := range people {
		out.Members = append(out.Members, erpwire.Row{"id": person["user_id"], "name": fallback(text(person["full_name"]), "Team member")})
	}
	return nil
}
func (s *Service) projectNewPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := searchParams(raw)
	if err != nil {
		return nil, err
	}
	out := ProjectFormData{DefaultValues: erpwire.Row{}, SubmitLabel: "Create project", Description: "Set up a new delivery project.", RedirectsOnSuccess: true}
	for _, key := range []string{"name", "budget", "status"} {
		if value := text(params[key]); value != "" {
			switch key {
			case "name":
				out.DefaultValues["name"] = value
			case "budget":
				out.DefaultValues["budgetBaht"] = value
			case "status":
				if has(projectStatuses, value) {
					out.DefaultValues["status"] = value
				}
			}
		}
	}
	if err := s.formOptions(ctx, a, &out); err != nil {
		return nil, err
	}
	if id := text(params["dealId"]); id != "" {
		deals, err := s.optionalRows(ctx, a, erpwire.Select{Table: "deals", Columns: []string{"id", "title", "client_id", "value_satang"}, Where: scoped(a, id), Order: ordered("id")})
		if err != nil {
			return nil, err
		}
		if len(deals) > 0 {
			deal := deals[0]
			var amount money.Satang
			if deal["value_satang"] != nil {
				amount, err = satang(deal["value_satang"])
				if err != nil {
					return nil, err
				}
			}
			if amount < 0 {
				return nil, businessError("Invalid satang amount")
			}
			out.ResolvedDealID = deal["id"]
			out.Description = "Prefilled from a won deal — review and create."
			out.DefaultValues = erpwire.Row{"name": deal["title"], "clientId": fallback(text(deal["client_id"]), "none"), "budgetBaht": money.FormatBaht(amount)}
		}
	} else if client := text(params["clientId"]); client != "" {
		out.DefaultValues = erpwire.Row{"clientId": client}
	}
	return out, nil
}
func (s *Service) projectEditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	id, err := loadID(raw)
	if err != nil {
		return nil, err
	}
	out := ProjectFormData{SubmitLabel: "Save changes", RedirectsOnSuccess: true}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Project, err = one(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"id", "name", "client_id", "status", "deadline", "budget_satang", "owner"}, Where: scoped(a, id)})
		return err
	})
	if canonical(err) {
		return nil, err
	}
	if err != nil || out.Project == nil {
		return nil, erpwire.ErrNotFound
	}
	if err := s.formOptions(ctx, a, &out); err != nil {
		return nil, err
	}
	p := out.Project
	owner := text(p["owner"])
	if owner != "" {
		found := false
		for _, member := range out.Members {
			found = found || text(member["id"]) == owner
		}
		if !found {
			out.Members = append(out.Members, erpwire.Row{"id": owner, "name": "Former member"})
		}
	}
	var amount any = int64(0)
	if p["budget_satang"] != nil {
		value, err := satang(p["budget_satang"])
		if err != nil {
			return nil, err
		}
		if value < 0 {
			return nil, businessError("Invalid satang amount")
		}
		amount = money.FormatBaht(value)
	}
	out.DefaultValues = erpwire.Row{"name": p["name"], "clientId": fallback(text(p["client_id"]), "none"), "status": p["status"], "deadline": text(p["deadline"]), "budgetBaht": amount, "owner": fallback(owner, "none")}
	return out, nil
}

type ProjectProfit struct {
	RevenueSatang money.Satang `json:"revenueSatang"`
	CostSatang    money.Satang `json:"costSatang"`
	ProfitSatang  money.Satang `json:"profitSatang"`
	MarginPct     json.Number  `json:"marginPct"`
}

func projectProfit(invoices, costs []erpwire.Row, labour, credits money.Satang, vatRegistered bool) (*ProjectProfit, error) {
	out := &ProjectProfit{MarginPct: json.Number("0")}
	var err error
	for _, invoice := range invoices {
		if has([]string{"draft", "cancelled"}, text(invoice["status"])) {
			continue
		}
		total, err := satang(invoice["total_satang"])
		if err != nil {
			return nil, err
		}
		vat, err := satang(invoice["vat_satang"])
		if err != nil {
			return nil, err
		}
		base, err := add(total, -vat)
		if err != nil {
			return nil, err
		}
		out.RevenueSatang, err = add(out.RevenueSatang, base)
		if err != nil {
			return nil, err
		}
	}
	out.RevenueSatang, err = add(out.RevenueSatang, -credits)
	if err != nil {
		return nil, err
	}
	for _, cost := range costs {
		value, err := satang(cost["amount_satang"])
		if err != nil {
			return nil, err
		}
		if vatRegistered {
			vat, err := satang(cost["input_vat_satang"])
			if err != nil {
				return nil, err
			}
			value, err = add(value, -vat)
			if err != nil {
				return nil, err
			}
		}
		out.CostSatang, err = add(out.CostSatang, value)
		if err != nil {
			return nil, err
		}
	}
	out.CostSatang, err = add(out.CostSatang, labour)
	if err != nil {
		return nil, err
	}
	out.ProfitSatang, err = add(out.RevenueSatang, -out.CostSatang)
	if err != nil {
		return nil, err
	}
	if out.RevenueSatang > 0 {
		pct := new(big.Rat).Mul(big.NewRat(int64(out.ProfitSatang), int64(out.RevenueSatang)), big.NewRat(100, 1))
		out.MarginPct = json.Number(pct.FloatString(16))
	}
	return out, nil
}

type ProjectPageData struct {
	Project        erpwire.Row        `json:"project"`
	Tasks          []erpwire.Row      `json:"tasks"`
	Milestones     []erpwire.Row      `json:"milestones"`
	Invoices       []erpwire.Row      `json:"invoices"`
	SourceQuotes   []erpwire.Row      `json:"sourceQuotes"`
	Names          erpwire.BrowserMap `json:"names"`
	TaskCount      int64              `json:"taskCount"`
	DoneTaskCount  int64              `json:"doneTaskCount"`
	DoneMilestones int64              `json:"doneMilestones"`
	QuoteCount     int64              `json:"quoteCount"`
	LoggedMinutes  int64              `json:"loggedMinutes"`
	LoggedHours    json.Number        `json:"loggedHours"`
	LoggedBillable money.Satang       `json:"loggedBillable"`
	Profit         *ProjectProfit     `json:"profit"`
	SeesProfit     bool               `json:"seesProfit"`
	Deadline       *DeadlineMeta      `json:"deadline"`
	Today          string             `json:"today"`
	RecordRef      erpwire.Row        `json:"recordRef"`
}

func (s *Service) projectPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	id, err := loadID(raw)
	if err != nil {
		return nil, err
	}
	out := ProjectPageData{SeesProfit: erpwire.Can(a.Role(), "profit:view"), Today: today(s.now()), RecordRef: erpwire.Row{"recordType": "project", "recordId": id}}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Project, err = one(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"id", "name", "status", "deadline", "budget_satang", "owner", "client_id"}, Relations: []erpwire.Relation{clientRelation("client")}, Where: scoped(a, id)})
		if err != nil {
			if canonical(err) {
				return err
			}
			return erpwire.ErrNotFound
		}
		if out.Project == nil {
			return erpwire.ErrNotFound
		}
		where := append(scope(a), eq("project_id", id))
		out.Invoices, err = all(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "number", "status", "amount_satang", "total_satang", "vat_satang", "source_quote_id", "source_milestone_id"}, Where: where, Order: ordered("created_at", "id")})
		if err != nil {
			return err
		}
		costs, err := all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"id", "amount_satang", "input_vat_satang"}, Where: where, Order: ordered("id")})
		if err != nil {
			return err
		}
		entries, err := all(ctx, tx, erpwire.Select{Table: "time_entries", Columns: []string{"project_id", "minutes", "billable", "rate_satang"}, Where: where, Order: ordered("id")})
		if err != nil {
			return err
		}
		out.LoggedBillable, err = billableValue(entries)
		if err != nil {
			return err
		}
		if out.SeesProfit {
			labourRow, err := one(ctx, tx, erpwire.Select{Table: "project_labour_totals", Columns: []string{"labour_cost_satang"}, Where: where})
			if err != nil {
				return loadError(err, "Project labour cost unavailable. Please reload.")
			}
			var labour, credits money.Satang
			if labourRow != nil {
				labour, err = satang(labourRow["labour_cost_satang"])
				if err != nil {
					return err
				}
			}
			creditRows, err := all(ctx, tx, erpwire.Select{Table: "credit_note_revenue", Columns: []string{"id", "base_satang"}, Where: where, Order: ordered("id")})
			if err != nil {
				return err
			}
			for _, credit := range creditRows {
				value, err := satang(credit["base_satang"])
				if err != nil {
					return err
				}
				credits, err = add(credits, value)
				if err != nil {
					return err
				}
			}
			settings, err := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"vat_registered"}, Where: scope(a)})
			if err != nil {
				return loadError(err, "Project VAT registration unavailable. Please reload.")
			}
			billed := []erpwire.Row{}
			for _, invoice := range out.Invoices {
				if has([]string{"sent", "partially_paid", "paid", "overdue"}, text(invoice["status"])) {
					billed = append(billed, invoice)
				}
			}
			if len(billed) > 0 || len(costs) > 0 || len(entries) > 0 {
				out.Profit, err = projectProfit(billed, costs, labour, credits, boolean(settings["vat_registered"]))
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	where := append(scope(a), eq("project_id", id))
	checkpointOrder := []erpwire.Order{{Column: "done"}, {Column: "due_date"}, {Column: "created_at"}, {Column: "id"}}
	out.Tasks, err = s.optionalRows(ctx, a, erpwire.Select{Table: "project_tasks", Columns: []string{"id", "title", "status", "assignee", "due_date", "done"}, Where: where, Order: checkpointOrder})
	if err != nil {
		return nil, err
	}
	out.TaskCount = int64(len(out.Tasks))
	done, err := s.optionalRows(ctx, a, erpwire.Select{Table: "project_tasks", Columns: []string{"id"}, Where: append(append([]erpwire.Predicate{}, where...), eq("done", true)), Order: ordered("id")})
	if err != nil {
		return nil, err
	}
	out.DoneTaskCount = int64(len(done))
	out.Milestones, err = s.optionalRows(ctx, a, erpwire.Select{Table: "milestones", Columns: []string{"id", "title", "due_date", "done", "source_quote_id"}, Where: where, Order: checkpointOrder})
	if err != nil {
		return nil, err
	}
	for _, milestone := range out.Milestones {
		if boolean(milestone["done"]) {
			out.DoneMilestones++
		}
	}
	totals, err := s.optionalRows(ctx, a, erpwire.Select{Table: "project_time_totals", Columns: []string{"minutes"}, Where: where, Order: ordered("project_id")})
	if err != nil {
		return nil, err
	}
	if len(totals) > 0 {
		out.LoggedMinutes, err = integer(totals[0]["minutes"])
		if err != nil {
			return nil, err
		}
	}
	out.LoggedHours = ratio(out.LoggedMinutes, 60, 16)
	out.SourceQuotes, err = s.optionalRows(ctx, a, erpwire.Select{Table: "quotes", Columns: []string{"id", "number", "status", "total_satang", "converted_invoice_id"}, Where: where, Order: ordered("created_at", "id")})
	if err != nil {
		return nil, err
	}
	out.QuoteCount = int64(len(out.SourceQuotes))
	profiles, err := s.optionalPeople(ctx, a)
	if err != nil {
		return nil, err
	}
	_, out.Names = namesMap(profiles)
	out.Deadline = deadlineMeta(text(out.Project["deadline"]), s.now())
	return out, nil
}
