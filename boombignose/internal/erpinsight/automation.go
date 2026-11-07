package erpinsight

import (
	"context"
	"encoding/json"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (s *Service) automationOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{"app/(app)/automation/page.tsx::load": s.automationPage}
}

type AutomationPageData struct {
	PendingReminders []erpwire.Row `json:"pendingReminders"`
	RecentEvents     []erpwire.Row `json:"recentEvents"`
	Today            string        `json:"today"`
	BothEmpty        bool          `json:"bothEmpty"`
}

func (s *Service) automationPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	out := AutomationPageData{PendingReminders: []erpwire.Row{}, RecentEvents: []erpwire.Row{}, Today: s.now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2006-01-02")}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		q := selection(a, "reminders", []string{"id", "entity", "title", "due_date", "status"}, eq("status", "pending"))
		q.Order = []erpwire.Order{{Column: "due_date"}, {Column: "id"}}
		rows, err := tx.Select(ctx, q)
		if authError(err) {
			return err
		}
		if err == nil && rows.Rows != nil {
			out.PendingReminders = rows.Rows
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		q := selection(a, "outbound_events", []string{"id", "event_type", "status", "created_at", "attempts"})
		q.Order = []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id", Descending: true}}
		q.Limit = 25
		result, err := tx.Select(ctx, q)
		if authError(err) {
			return err
		}
		if err == nil && result.Rows != nil {
			out.RecentEvents = result.Rows
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	for _, row := range out.PendingReminders {
		date := text(row["due_date"])
		row["overdue"] = date != "" && date < out.Today
		if day, e := time.Parse("2006-01-02", date); e == nil {
			row["dueLabel"] = day.Format("2 Jan 2006")
		}
	}
	for _, row := range out.RecentEvents {
		if stamp, e := time.Parse(time.RFC3339Nano, text(row["created_at"])); e == nil {
			row["queuedLabel"] = stamp.In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2 Jan, 15:04")
		}
	}
	out.BothEmpty = len(out.PendingReminders) == 0 && len(out.RecentEvents) == 0
	return out, nil
}
