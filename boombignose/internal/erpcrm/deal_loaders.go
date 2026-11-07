package erpcrm

import (
	"context"
	"encoding/json"
	"net/url"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type DealPageData struct {
	Deal                  erpwire.Row   `json:"deal"`
	Client                erpwire.Row   `json:"client"`
	Activities            []erpwire.Row `json:"activities"`
	LostReasons           []erpwire.Row `json:"lostReasons"`
	Projects              CountLink     `json:"projects"`
	Quotes                CountLink     `json:"quotes"`
	ProjectCount          int64         `json:"projectCount"`
	ExpectedRevenueSatang money.Satang  `json:"expectedRevenueSatang"`
	Today                 string        `json:"today"`
	FollowUpOverdue       bool          `json:"followUpOverdue"`
	FollowUpDueToday      bool          `json:"followUpDueToday"`
	CanManageReasons      bool          `json:"canManageReasons"`
	QuoteNextStep         bool          `json:"quoteNextStep"`
	CreateProjectHref     string        `json:"createProjectHref,omitempty"`
	RecordRef             RecordRef     `json:"recordRef"`
}

type DealFormData struct {
	Deal               erpwire.Row   `json:"deal"`
	Clients            []erpwire.Row `json:"clients"`
	LostReasons        []erpwire.Row `json:"lostReasons"`
	DefaultValues      erpwire.Row   `json:"defaultValues"`
	SubmitLabel        string        `json:"submitLabel"`
	RedirectsOnSuccess bool          `json:"redirectsOnSuccess"`
}

func (s *Service) dealPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	id, err := loadID(raw)
	if err != nil {
		return nil, err
	}
	out := DealPageData{Today: today(time.Now()), CanManageReasons: authorize(a, "settings:manage") == nil, RecordRef: RecordRef{RecordType: "deal", RecordID: id}}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Deal, err = one(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "client_id", "title", "stage", "value_satang", "probability", "won_at", "lost_at", "expected_close_date", "next_follow_up_date", "source", "notes", "created_at"}, Relations: []erpwire.Relation{reasonRelation()}, Where: scoped(a, id)})
		if err != nil {
			return err
		}
		if out.Deal == nil {
			return erpwire.ErrNotFound
		}
		out.Client, err = one(ctx, tx, erpwire.Select{Table: "clients", Columns: []string{"id", "name"}, Where: scoped(a, text(out.Deal["client_id"]))})
		if err != nil {
			return err
		}
		out.Activities, err = all(ctx, tx, erpwire.Select{Table: "activities", Columns: []string{"id", "type", "body", "due_date", "done", "created_at"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("deal_id", id)}, Order: []erpwire.Order{{Column: "done"}, {Column: "created_at", Descending: true}, {Column: "id"}}})
		if err != nil {
			return err
		}
		out.Projects, err = countLink(ctx, tx, a, "projects", "deal_id", id, "/projects/", "/projects")
		if err != nil {
			return err
		}
		out.Quotes, err = countLink(ctx, tx, a, "quotes", "deal_id", id, "/quotes/", "/quotes")
		if err != nil {
			return err
		}
		out.LostReasons, err = namedOptions(ctx, tx, a, "deal_lost_reasons", true)
		return err
	})
	if err != nil {
		return nil, loadError(err, "Deal details unavailable. Please reload.")
	}
	value, err := satang(out.Deal["value_satang"])
	if err != nil {
		return nil, err
	}
	probability, err := integer(out.Deal["probability"])
	if err != nil {
		return nil, err
	}
	out.ExpectedRevenueSatang, err = expected(value, probability)
	if err != nil {
		return nil, err
	}
	out.ProjectCount = out.Projects.Count
	if out.ProjectCount == 0 {
		out.CreateProjectHref = "/projects/new?dealId=" + id + "&clientId=" + text(out.Deal["client_id"])
	}
	if out.Quotes.Count == 0 {
		out.Quotes.Href = "/quotes/new?clientId=" + url.QueryEscape(text(out.Deal["client_id"])) + "&dealId=" + url.QueryEscape(id)
	}
	stage := text(out.Deal["stage"])
	out.QuoteNextStep = stage == "proposal" || stage == "negotiation"
	followup := text(out.Deal["next_follow_up_date"])
	out.FollowUpOverdue = out.Deal["next_follow_up_date"] != nil && followup < out.Today
	out.FollowUpDueToday = followup == out.Today
	return out, nil
}

func (s *Service) dealEditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	id, err := loadID(raw)
	if err != nil {
		return nil, err
	}
	out := DealFormData{SubmitLabel: "Save changes", RedirectsOnSuccess: true}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Deal, err = one(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "client_id", "title", "stage", "value_satang", "probability", "lost_reason_id", "expected_close_date", "next_follow_up_date", "source", "notes"}, Where: scoped(a, id)})
		if err != nil {
			return err
		}
		if out.Deal == nil {
			return erpwire.ErrNotFound
		}
		out.Clients, err = namedOptions(ctx, tx, a, "clients", false)
		if err != nil {
			return err
		}
		out.LostReasons, err = namedOptions(ctx, tx, a, "deal_lost_reasons", true)
		return err
	})
	if err != nil {
		return nil, loadError(err, "Deal editor unavailable. Please reload.")
	}
	value, err := satang(out.Deal["value_satang"])
	if err != nil {
		return nil, err
	}
	out.DefaultValues = erpwire.Row{"clientId": out.Deal["client_id"], "title": out.Deal["title"], "stage": out.Deal["stage"], "valueBaht": json.Number(money.FormatBaht(value)), "probability": out.Deal["probability"]}
	for column, key := range map[string]string{"lost_reason_id": "lostReasonId", "expected_close_date": "expectedCloseDate", "next_follow_up_date": "nextFollowUpDate", "source": "source", "notes": "notes"} {
		out.DefaultValues[key] = text(out.Deal[column])
	}
	return out, nil
}

func (s *Service) dealNewPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	args, err := arguments(raw, 0, 1)
	if err != nil {
		return nil, err
	}
	params, err := searchParams(args)
	if err != nil {
		return nil, err
	}
	stage := text(params["stage"])
	if !has(stages, stage) {
		stage = "lead"
	}
	amount := json.Number("0")
	if number, ok := coerceNumber(params["amount"]); ok && number.Sign() > 0 {
		amount = json.Number(decimalText(number))
	}
	out := DealFormData{SubmitLabel: "Create deal", RedirectsOnSuccess: true, DefaultValues: erpwire.Row{"title": text(params["title"]), "clientId": text(params["clientId"]), "stage": stage, "valueBaht": amount}}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Clients, err = namedOptions(ctx, tx, a, "clients", false)
		if err != nil {
			return err
		}
		out.LostReasons, err = namedOptions(ctx, tx, a, "deal_lost_reasons", true)
		return err
	})
	if err != nil {
		return nil, loadError(err, "New deal unavailable. Please reload.")
	}
	return out, nil
}

type ReasonsPageData struct {
	Reasons []erpwire.Row `json:"reasons"`
	Error   string        `json:"error,omitempty"`
}

func (s *Service) reasonsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, "settings:manage"); err != nil {
		return nil, err
	}
	args, err := arguments(raw, 0, 1)
	if err != nil {
		return nil, err
	}
	params, err := searchParams(args)
	if err != nil {
		return nil, err
	}
	out := ReasonsPageData{}
	if code := text(params["error"]); code != "" {
		out.Error = map[string]string{"invalid": "Enter a reason of 1 to 80 characters.", "duplicate": "That reason is already on the list."}[code]
		if out.Error == "" {
			out.Error = "Unable to save the reason. Please try again."
		}
	}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Reasons, err = all(ctx, tx, erpwire.Select{Table: "deal_lost_reasons", Columns: []string{"id", "name", "active"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "active", Descending: true}, {Column: "name"}, {Column: "id"}}})
		return err
	})
	if err != nil {
		return nil, loadError(err, "Unable to load lost reasons. Please try again.")
	}
	return out, nil
}
