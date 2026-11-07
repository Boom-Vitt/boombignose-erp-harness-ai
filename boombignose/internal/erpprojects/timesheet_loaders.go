package erpprojects

import (
	"context"
	"encoding/json"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type TimesheetsPageData struct {
	AllEntries     []erpwire.Row      `json:"allEntries"`
	Entries        []erpwire.Row      `json:"entries"`
	Projects       []erpwire.Row      `json:"projects"`
	ProjectOptions []erpwire.Row      `json:"projectOptions"`
	Members        []erpwire.Row      `json:"members"`
	NameByID       erpwire.BrowserMap `json:"nameById"`
	Config         FacetConfig        `json:"config"`
	SavedViews     []SavedView        `json:"savedViews"`
	Groups         []RowGroup         `json:"groups"`
	Month          string             `json:"month"`
	Today          string             `json:"today"`
	Staff          bool               `json:"staff"`
	MonthMinutes   int64              `json:"monthMinutes"`
	MonthHours     json.Number        `json:"monthHours"`
	MonthBillable  money.Satang       `json:"monthBillable"`
	MonthUtil      json.Number        `json:"monthUtil"`
}

func (s *Service) timesheetsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := searchParams(raw)
	if err != nil {
		return nil, err
	}
	now := s.now()
	out := TimesheetsPageData{Config: parseFacets(params, "timesheets"), Month: now.In(bangkok).Format("2006-01"), Today: today(now), Staff: erpwire.Can(a.Role(), "settings:manage"), Entries: []erpwire.Row{}, ProjectOptions: []erpwire.Row{}, Members: []erpwire.Row{}}
	names := map[string]string{}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.SavedViews, err = savedViews(ctx, tx, a, "timesheets")
		if err != nil {
			return err
		}
		out.AllEntries, err = all(ctx, tx, erpwire.Select{Table: "time_entries", Columns: []string{"id", "work_date", "minutes", "billable", "rate_satang", "project_id", "user_id", "notes", "invoice_id"}, Relations: []erpwire.Relation{{Name: "invoices", Table: "invoices", LocalColumn: "invoice_id", ForeignColumn: "id", Columns: []string{"status", "number"}}, {Name: "projects", Table: "projects", LocalColumn: "project_id", ForeignColumn: "id", Columns: []string{"name"}}}, Where: scope(a), Order: []erpwire.Order{{Column: "work_date", Descending: true}, {Column: "id"}}})
		if err != nil {
			return loadError(err, "Timesheets unavailable. Please reload.")
		}
		out.Projects, err = options(ctx, tx, a, "projects")
		if err != nil {
			return loadError(err, "Timesheets unavailable. Please reload.")
		}
		members, err := all(ctx, tx, erpwire.Select{Table: "memberships", Columns: []string{"user_id"}, Where: scope(a), Order: ordered("id")})
		if err != nil {
			return loadError(err, "Timesheets unavailable. Please reload.")
		}
		rates := []erpwire.Row{}
		if out.Staff {
			rates, err = all(ctx, tx, erpwire.Select{Table: "member_cost_rates", Columns: []string{"user_id", "cost_rate_satang"}, Where: scope(a), Order: ordered("user_id")})
			if err != nil {
				return loadError(err, "Timesheets unavailable. Please reload.")
			}
		}
		profiles, err := people(ctx, tx, a)
		if err != nil {
			return loadError(err, "Time-entry users unavailable. Please reload.")
		}
		names, out.NameByID = namesMap(profiles)
		rateByID := map[string]money.Satang{}
		for _, row := range rates {
			rate, err := satang(row["cost_rate_satang"])
			if err != nil {
				return err
			}
			rateByID[text(row["user_id"])] = rate
		}
		for _, member := range members {
			id := text(member["user_id"])
			out.Members = append(out.Members, erpwire.Row{"value": id, "label": fallback(names[id], "Member"), "rate": rateByID[id]})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, project := range out.Projects {
		out.ProjectOptions = append(out.ProjectOptions, erpwire.Row{"value": project["id"], "label": project["name"]})
	}
	monthEntries := []erpwire.Row{}
	var billableMinutes int64
	for _, entry := range out.AllEntries {
		status := "non_billable"
		if boolean(entry["billable"]) {
			status = "billable"
		}
		name := names[text(entry["user_id"])]
		if matches(out.Config, text(relation(entry, "projects")["name"])+" "+name, status, text(entry["work_date"]), text(entry["user_id"]), a, now) {
			out.Entries = append(out.Entries, entry)
		}
		if monthKey(text(entry["work_date"])) == out.Month {
			monthEntries = append(monthEntries, entry)
			minutes, err := integer(entry["minutes"])
			if err != nil {
				return nil, err
			}
			total, err := add(money.Satang(out.MonthMinutes), money.Satang(minutes))
			if err != nil {
				return nil, err
			}
			out.MonthMinutes = int64(total)
			if boolean(entry["billable"]) {
				billableMinutes += minutes
			}
		}
	}
	out.MonthHours = ratio(out.MonthMinutes, 60, 16)
	out.MonthUtil = ratio(billableMinutes, out.MonthMinutes, 16)
	out.MonthBillable, err = billableValue(monthEntries)
	if err != nil {
		return nil, err
	}
	var group func(erpwire.Row) (string, string)
	if out.Config.GroupBy != "" {
		group = func(row erpwire.Row) (string, string) {
			if out.Config.GroupBy == "project" {
				return text(row["project_id"]), fallback(text(relation(row, "projects")["name"]), "No project")
			}
			month := monthKey(text(row["work_date"]))
			return month, month
		}
	}
	out.Groups, err = groupRows(out.Entries, group, entryValue)
	if err != nil {
		return nil, err
	}
	for _, entry := range out.AllEntries {
		entry["canEdit"] = canEditTime(a, entry)
		value, err := entryValue(entry)
		if err != nil {
			return nil, err
		}
		entry["valueSatang"] = value
	}
	return out, nil
}
