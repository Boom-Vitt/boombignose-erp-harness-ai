package erpbilling

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type NamedRecord struct {
	Name string `json:"name"`
}

type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type ProductOption struct {
	ID string `json:"id"`
	SKU *string `json:"sku"`
	Name string `json:"name"`
	Description *string `json:"description"`
	Unit string `json:"unit"`
	ListPriceSatang money.Satang `json:"list_price_satang"`
	TaxRateBPS int64 `json:"tax_rate_bps"`
}

type ListSubscription struct {
	ID string `json:"id"`
	Name string `json:"name"`
	AmountSatang money.Satang `json:"amount_satang"`
	Interval string `json:"interval"`
	Status string `json:"status"`
	NextRunDate string `json:"next_run_date"`
	Clients *NamedRecord `json:"clients"`
}

type Subscription struct {
	ListSubscription
	StartDate string `json:"start_date"`
	LastGeneratedOn *string `json:"last_generated_on"`
	AutoGenerate bool `json:"auto_generate"`
	Notes *string `json:"notes"`
	ClientID string `json:"client_id"`
	ProjectID *string `json:"project_id"`
	ProductID *string `json:"product_id"`
	Unit *string `json:"unit"`
	TaxRateBPS int64 `json:"tax_rate_bps"`
	WHTRateBPS int64 `json:"wht_rate_bps"`
	PricesIncludeVAT bool `json:"prices_include_vat"`
	Projects *NamedRecord `json:"projects"`
}

// AmountBaht is exact decimal form text, not a floating-point conversion. The
// browser form must retain this text through submission (number|string input).
// Omitted rates preserve the original undefined creation-default semantics.
type FormValues struct {
	Name string `json:"name"`
	ClientID string `json:"client_id"`
	ProjectID string `json:"project_id"`
	AmountBaht string `json:"amountBaht"`
	Interval string `json:"interval"`
	StartDate string `json:"start_date"`
	Notes string `json:"notes"`
	ProductID *string `json:"product_id"`
	Unit string `json:"unit"`
	TaxRateBPS *int64 `json:"tax_rate_bps,omitempty"`
	WHTRateBPS *int64 `json:"wht_rate_bps,omitempty"`
	PricesIncludeVAT bool `json:"prices_include_vat"`
}

type ListDTO struct {
	Subscriptions []ListSubscription `json:"subscriptions"`
	Total int64 `json:"total"`
}

type NewDTO struct {
	Clients []Option `json:"clients"`
	Projects []Option `json:"projects"`
	Products []ProductOption `json:"products"`
	DefaultValues FormValues `json:"defaultValues"`
}

type InvoiceRef struct {
	ID string `json:"id"`
}

type OccurrencesDTO struct {
	Data []InvoiceRef `json:"data"`
	Count int64 `json:"count"`
}

type ControlsDTO struct {
	ID string `json:"id"`
	OrgID string `json:"orgId"`
	Status string `json:"status"`
	CanManage bool `json:"canManage"`
	Occurrence string `json:"occurrence"`
	IsDue bool `json:"isDue"`
}

type DetailDTO struct {
	Subscription Subscription `json:"subscription"`
	Clients []Option `json:"clients"`
	Projects []Option `json:"projects"`
	Products []ProductOption `json:"products"`
	DefaultValues FormValues `json:"defaultValues"`
	Occurrences OccurrencesDTO `json:"occurrences"`
	InvoicesHref string `json:"invoicesHref"`
	ProjectCount int `json:"projectCount"`
	ProjectHref string `json:"projectHref"`
	CanManage bool `json:"canManage"`
	Controls ControlsDTO `json:"controls"`
	Today string `json:"today"`
}

const pageSize = 1000

func readAll(ctx context.Context, tx erpwire.ReadTx, query erpwire.Select) ([]erpwire.Row, int64, error) {
	rows := make([]erpwire.Row, 0)
	query.Limit = pageSize
	query.Count = true
	var total int64
	for {
		selection, err := tx.Select(ctx, query)
		if err != nil {
			return nil, 0, err
		}
		if selection.Total == nil || *selection.Total < 0 {
			return nil, 0, errors.New("Subscription exact count unavailable")
		}
		if query.Offset == 0 {
			total = *selection.Total
		} else if *selection.Total != total {
			return nil, 0, errors.New("Subscription read snapshot changed")
		}
		rows = append(rows, selection.Rows...)
		if int64(len(rows)) == total {
			return rows, total, nil
		}
		if int64(len(rows)) > total || len(selection.Rows) == 0 {
			return nil, 0, errors.New("Subscription read incomplete")
		}
		query.Offset += len(selection.Rows)
	}
}

func nameRelation(name, table, localColumn string) erpwire.Relation {
	return erpwire.Relation{Name: name, Table: table, LocalColumn: localColumn, ForeignColumn: "id", Columns: []string{"name"}}
}

func readOptions(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor, table string) ([]Option, error) {
	rows, _, err := readAll(ctx, tx, erpwire.Select{
		Table: table, Columns: []string{"id", "name"}, Where: scope(actor), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}},
	})
	if err != nil {
		return nil, err
	}
	options := make([]Option, 0, len(rows))
	for _, row := range rows {
		var value struct {
			ID string `json:"id"`
			Name string `json:"name"`
		}
		if err := decodeRow(row, &value); err != nil {
			return nil, err
		}
		options = append(options, Option{Value: value.ID, Label: value.Name})
	}
	return options, nil
}

// activeProductOptions() intentionally returns the same first 20 named active
// products; additional searches remain the existing product-domain operation.
func readProducts(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor) ([]ProductOption, error) {
	selection, err := tx.Select(ctx, erpwire.Select{
		Table: "products", Columns: []string{"id", "sku", "name", "description", "unit", "list_price_satang", "tax_rate_bps"},
		Where: []erpwire.Predicate{eq("org_id", actor.OrgID()), eq("active", true)},
		Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}, Limit: 20,
	})
	if err != nil {
		return nil, err
	}
	products := make([]ProductOption, 0, len(selection.Rows))
	for _, row := range selection.Rows {
		var product ProductOption
		if err := decodeRow(row, &product); err != nil {
			return nil, err
		}
		products = append(products, product)
	}
	return products, nil
}

func readFormOptions(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor) ([]Option, []Option, []ProductOption, error) {
	clients, err := readOptions(ctx, tx, actor, "clients")
	if err != nil {
		return nil, nil, nil, err
	}
	projects, err := readOptions(ctx, tx, actor, "projects")
	if err != nil {
		return nil, nil, nil, err
	}
	products, err := readProducts(ctx, tx, actor)
	return clients, projects, products, err
}

func loadFailure(err error, message string) (any, error) {
	if authError(err) || errors.Is(err, erpwire.ErrNotFound) {
		return nil, err
	}
	return nil, errors.New(message)
}

func (s *Service) loadList(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Validate(time.Now()); err != nil {
		return nil, err
	}
	if err := noArguments(raw); err != nil {
		return nil, err
	}
	result := ListDTO{Subscriptions: []ListSubscription{}}
	err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
		rows, total, err := readAll(ctx, tx, erpwire.Select{
			Table: "subscriptions", Columns: []string{"id", "name", "amount_satang", "interval", "status", "next_run_date"},
			Relations: []erpwire.Relation{nameRelation("clients", "clients", "client_id")}, Where: scope(actor),
			Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}},
		})
		if err != nil {
			return err
		}
		result.Total = total
		for _, row := range rows {
			var subscription ListSubscription
			if err := decodeRow(row, &subscription); err != nil {
				return err
			}
			result.Subscriptions = append(result.Subscriptions, subscription)
		}
		return nil
	})
	if err != nil {
		return loadFailure(err, "Subscriptions unavailable. Please reload.")
	}
	return result, nil
}

func (s *Service) loadNew(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Validate(time.Now()); err != nil {
		return nil, err
	}
	if err := noArguments(raw); err != nil {
		return nil, err
	}
	result := NewDTO{DefaultValues: FormValues{
		AmountBaht: "0.00", Interval: "monthly", StartDate: today(), Unit: "period",
	}}
	err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
		var err error
		result.Clients, result.Projects, result.Products, err = readFormOptions(ctx, tx, actor)
		if err != nil {
			return err
		}
		selection, err := tx.Select(ctx, erpwire.Select{Table: "org_settings", Columns: []string{"prices_include_vat"}, Where: scope(actor), Limit: 1})
		if err != nil {
			return err
		}
		if len(selection.Rows) != 0 {
			var settings struct {
				PricesIncludeVAT bool `json:"prices_include_vat"`
			}
			if err := decodeRow(selection.Rows[0], &settings); err != nil {
				return err
			}
			result.DefaultValues.PricesIncludeVAT = settings.PricesIncludeVAT
		}
		return nil
	})
	if err != nil {
		return loadFailure(err, "Subscription form unavailable. Please reload.")
	}
	return result, nil
}

func (s *Service) loadDetail(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Validate(time.Now()); err != nil {
		return nil, err
	}
	args, err := erpwire.ParseArguments(raw)
	var id string
	if err != nil || len(args) != 1 || args.Decode(0, &id) != nil || !validID(id) {
		return nil, erpwire.ErrNotFound
	}
	result := DetailDTO{Today: today(), CanManage: actor.Authorize("subscription:manage", time.Now()) == nil}
	err = s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
		selection, err := tx.Select(ctx, erpwire.Select{
			Table: "subscriptions", Columns: []string{"id", "name", "amount_satang", "interval", "status", "start_date", "next_run_date", "last_generated_on", "auto_generate", "notes", "client_id", "project_id", "product_id", "unit", "tax_rate_bps", "wht_rate_bps", "prices_include_vat"},
			Relations: []erpwire.Relation{nameRelation("clients", "clients", "client_id"), nameRelation("projects", "projects", "project_id")},
			Where: []erpwire.Predicate{eq("org_id", actor.OrgID()), eq("id", id)}, Limit: 1,
		})
		if err != nil {
			return err
		}
		if len(selection.Rows) == 0 {
			return erpwire.ErrNotFound
		}
		if err := decodeRow(selection.Rows[0], &result.Subscription); err != nil {
			return err
		}
		result.Clients, result.Projects, result.Products, err = readFormOptions(ctx, tx, actor)
		if err != nil {
			return err
		}
		occurrences, err := tx.Select(ctx, erpwire.Select{
			Table: "subscription_occurrences", Columns: []string{"invoice_id"},
			Where: []erpwire.Predicate{eq("org_id", actor.OrgID()), eq("subscription_id", id)},
			Order: []erpwire.Order{{Column: "occurrence_date"}, {Column: "invoice_id"}}, Limit: 1, Count: true,
		})
		if err != nil {
			return err
		}
		if occurrences.Total == nil || *occurrences.Total < 0 {
			return errors.New("Subscription occurrence exact count unavailable")
		}
		result.Occurrences = OccurrencesDTO{Data: []InvoiceRef{}, Count: *occurrences.Total}
		for _, row := range occurrences.Rows {
			invoiceID, _ := row["invoice_id"].(string)
			if !validID(invoiceID) {
				return errors.New("Subscription invoice reference unavailable")
			}
			result.Occurrences.Data = append(result.Occurrences.Data, InvoiceRef{ID: invoiceID})
		}
		if result.Occurrences.Count > 0 && len(result.Occurrences.Data) == 0 {
			return errors.New("Subscription invoice reference unavailable")
		}
		return nil
	})
	if err != nil {
		return loadFailure(err, "Subscription details unavailable. Please reload.")
	}
	sub := result.Subscription
	result.DefaultValues = FormValues{
		Name: sub.Name, ClientID: sub.ClientID, AmountBaht: money.FormatBaht(sub.AmountSatang),
		Interval: sub.Interval, StartDate: sub.StartDate, ProductID: sub.ProductID, Unit: "period",
		TaxRateBPS: &sub.TaxRateBPS, WHTRateBPS: &sub.WHTRateBPS, PricesIncludeVAT: sub.PricesIncludeVAT,
	}
	if sub.ProjectID != nil {
		result.DefaultValues.ProjectID = *sub.ProjectID
		result.ProjectCount = 1
		result.ProjectHref = "/projects/"+*sub.ProjectID
	}
	if sub.Notes != nil {
		result.DefaultValues.Notes = *sub.Notes
	}
	if sub.Unit != nil {
		result.DefaultValues.Unit = *sub.Unit
	}
	result.InvoicesHref = "/finance"
	if result.Occurrences.Count == 1 {
		result.InvoicesHref = "/finance/invoices/"+result.Occurrences.Data[0].ID
	}
	result.Controls = ControlsDTO{ID: sub.ID, OrgID: actor.OrgID(), Status: sub.Status, CanManage: result.CanManage, Occurrence: sub.NextRunDate, IsDue: sub.NextRunDate <= result.Today}
	return result, nil
}
