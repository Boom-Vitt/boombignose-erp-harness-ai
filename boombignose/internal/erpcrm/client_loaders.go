package erpcrm

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type ClientsPageData struct {
	Clients    []erpwire.Row `json:"clients"`
	Config     FacetConfig   `json:"config"`
	SavedViews []SavedView   `json:"savedViews"`
	Groups     []RowGroup    `json:"groups"`
}
type RecordRef struct {
	RecordType string `json:"recordType"`
	RecordID   string `json:"recordId"`
}
type CountLink struct {
	Count int64   `json:"count"`
	ID    *string `json:"id"`
	Href  string  `json:"href"`
}
type ClientPageData struct {
	Client            erpwire.Row   `json:"client"`
	Contacts          []erpwire.Row `json:"contacts"`
	Deals             []erpwire.Row `json:"deals"`
	Activities        []erpwire.Row `json:"activities"`
	DealCount         int64         `json:"dealCount"`
	Quotes            CountLink     `json:"quotes"`
	Invoices          CountLink     `json:"invoices"`
	Projects          CountLink     `json:"projects"`
	BalanceKnown      bool          `json:"balanceKnown"`
	OpenBalanceSatang *money.Satang `json:"openBalanceSatang"`
	CreditSatang      *money.Satang `json:"creditSatang"`
	Today             string        `json:"today"`
	RecordRef         RecordRef     `json:"recordRef"`
}
type ClientFormData struct {
	Client             erpwire.Row `json:"client"`
	DefaultValues      erpwire.Row `json:"defaultValues"`
	SubmitLabel        string      `json:"submitLabel"`
	RedirectsOnSuccess bool        `json:"redirectsOnSuccess"`
}

func loadError(err error, message string) error {
	if authError(err) || errors.Is(err, erpwire.ErrNotFound) {
		return err
	}
	return errors.New(message)
}
func loadID(raw json.RawMessage) (string, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return "", e
	}
	id, e := stringArg(args, 0)
	if e != nil {
		return "", e
	}
	if !validID(id) {
		return "", erpwire.ErrNotFound
	}
	return id, nil
}
func (s *Service) clientsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	params, e := searchParams(args)
	if e != nil {
		return nil, e
	}
	config := parseFacets(params, "clients")
	now := time.Now()
	out := ClientsPageData{Clients: []erpwire.Row{}, Config: config, SavedViews: []SavedView{}}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		query := erpwire.Select{Table: "clients", Columns: []string{"id", "name", "industry", "source", "created_at", "owner"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: ordered("name", "id")}
		if config.Q != "" {
			pattern := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_", "(", "\\(", ")", "\\)", ",", "\\,", ".", "\\.", "\"", "\\\"", ":", "\\:").Replace(config.Q)
			query.Where = append(query.Where, erpwire.Predicate{Column: "name", Op: erpwire.ILike, Value: "%" + pattern + "%"})
		}
		clients, e := all(ctx, tx, query)
		if e != nil {
			return e
		}
		deals, e := all(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "client_id"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), {Column: "stage", Op: erpwire.In, Value: stages[:5]}}, Order: ordered("id")})
		if e != nil {
			return e
		}
		counts := map[string]int64{}
		for _, d := range deals {
			counts[text(d["client_id"])]++
		}
		for _, client := range clients {
			if matches(config, client, text(client["name"]), text(client["created_at"]), a, now) {
				client["deals"] = []erpwire.Row{{"count": counts[text(client["id"])]}}
				out.Clients = append(out.Clients, client)
			}
		}
		out.SavedViews, e = s.savedViews(ctx, tx, a, "clients")
		return e
	})
	if e != nil {
		return nil, loadError(e, "Clients unavailable. Please reload.")
	}
	var group func(erpwire.Row) (string, string)
	if config.GroupBy != "" {
		group = func(row erpwire.Row) (string, string) {
			var value string
			if config.GroupBy == "month" {
				date := dateOnly(text(row["created_at"]))
				if len(date) >= 7 {
					value = date[:7]
				}
			} else {
				value = text(row[config.GroupBy])
			}
			if row[config.GroupBy] == nil && config.GroupBy != "month" {
				return "missing", "Unassigned"
			}
			return "value:" + value, value
		}
	}
	out.Groups, e = groupRows(out.Clients, group, false)
	if e != nil {
		return nil, e
	}
	return out, nil
}
func countLink(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, table, column, id, path, fallback string) (CountLink, error) {
	result, e := tx.Select(ctx, erpwire.Select{Table: table, Columns: []string{"id"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq(column, id)}, Order: ordered("id"), Limit: 1, Count: true})
	if e != nil {
		return CountLink{}, e
	}
	if result.Total == nil {
		return CountLink{}, errors.New("CRM exact count unavailable")
	}
	out := CountLink{Count: *result.Total, Href: fallback}
	if out.Count == 1 && len(result.Rows) > 0 {
		record := text(result.Rows[0]["id"])
		out.ID = &record
		out.Href = path + record
	}
	return out, nil
}
func (s *Service) clientPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	out := ClientPageData{Today: today(time.Now()), RecordRef: RecordRef{RecordType: "client", RecordID: id}}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		out.Client, e = one(ctx, tx, erpwire.Select{Table: "clients", Columns: []string{"id", "name", "industry", "source", "notes", "created_at"}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if out.Client == nil {
			return erpwire.ErrNotFound
		}
		where := []erpwire.Predicate{eq("org_id", a.OrgID()), eq("client_id", id)}
		out.Contacts, e = all(ctx, tx, erpwire.Select{Table: "contacts", Columns: []string{"id", "name", "email", "phone", "role"}, Where: where, Order: ordered("created_at", "id")})
		if e != nil {
			return e
		}
		out.Deals, e = all(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "title", "stage", "value_satang", "updated_at"}, Where: where, Order: []erpwire.Order{{Column: "updated_at", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		out.DealCount = int64(len(out.Deals))
		activities, e := tx.Select(ctx, erpwire.Select{Table: "activities", Columns: []string{"id", "type", "body", "due_date", "done", "created_at"}, Where: where, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}, Limit: 8})
		if e != nil {
			return e
		}
		out.Activities = activities.Rows
		if out.Activities == nil {
			out.Activities = []erpwire.Row{}
		}
		out.Quotes, e = countLink(ctx, tx, a, "quotes", "client_id", id, "/quotes/", "/quotes")
		if e != nil {
			return e
		}
		out.Invoices, e = countLink(ctx, tx, a, "invoices", "client_id", id, "/finance/invoices/", "/finance")
		if e != nil {
			return e
		}
		out.Projects, e = countLink(ctx, tx, a, "projects", "client_id", id, "/projects/", "/projects")
		return e
	})
	if e != nil {
		return nil, loadError(e, "Client details unavailable. Please reload.")
	}
	// A failed balance read is explicitly unknown, never a fabricated zero. It is
	// independent so the READ ONLY transaction's error cannot poison other reads.
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		balance, e := one(ctx, tx, erpwire.Select{Table: "client_balances", Columns: []string{"outstanding_satang", "credit_satang"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("client_id", id)}})
		if e != nil {
			return e
		}
		var open, credit money.Satang
		if balance != nil {
			open, e = satang(balance["outstanding_satang"])
			if e != nil {
				return e
			}
			credit, e = satang(balance["credit_satang"])
			if e != nil {
				return e
			}
		}
		out.OpenBalanceSatang = &open
		out.CreditSatang = &credit
		out.BalanceKnown = true
		return nil
	})
	if authError(e) {
		return nil, e
	}
	return out, nil
}
func clientDefaults(row erpwire.Row) erpwire.Row {
	values := erpwire.Row{}
	for _, key := range []string{"name", "tax_id", "branch_label", "industry", "source", "notes"} {
		values[key] = text(row[key])
	}
	return values
}
func (s *Service) clientEditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	out := ClientFormData{SubmitLabel: "Save changes"}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		out.Client, e = one(ctx, tx, erpwire.Select{Table: "clients", Columns: []string{"id", "name", "industry", "source", "notes", "tax_id", "branch_label"}, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if out.Client == nil {
			return erpwire.ErrNotFound
		}
		out.DefaultValues = clientDefaults(out.Client)
		return nil
	})
	if e != nil {
		return nil, loadError(e, "Client editor unavailable. Please reload.")
	}
	return out, nil
}
func (s *Service) clientNewPage(_ context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	return ClientFormData{DefaultValues: clientDefaults(nil), SubmitLabel: "Create client", RedirectsOnSuccess: true}, nil
}
