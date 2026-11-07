// Package erpprojects implements project delivery, time, and calendar operations.
package erpprojects

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type Options struct{ Store erpwire.Store }
type Service struct {
	store erpwire.Store
	now   func() time.Time
}

func New(options Options) (*Service, error) {
	if options.Store == nil {
		return nil, errors.New("projects store is required")
	}
	return &Service{store: options.Store, now: time.Now}, nil
}

const projectsActions = "app/(app)/projects/actions.ts::"
const timesheetsActions = "app/(app)/timesheets/actions.ts::"

func (s *Service) Operations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		projectsActions + "createProject":             s.createProject,
		projectsActions + "quickCreateProject":        s.quickCreateProject,
		projectsActions + "updateProject":             s.updateProject,
		projectsActions + "updateProjectStatus":       s.updateProjectStatus,
		projectsActions + "addTask":                   s.addTask,
		projectsActions + "toggleTask":                s.toggleTask,
		projectsActions + "addMilestone":              s.addMilestone,
		projectsActions + "toggleMilestone":           s.toggleMilestone,
		timesheetsActions + "logTime":                 s.logTime,
		timesheetsActions + "deleteTimeEntry":         s.deleteTimeEntry,
		timesheetsActions + "updateTimeEntry":         s.updateTimeEntry,
		timesheetsActions + "billTime":                s.billTime,
		timesheetsActions + "setMemberCostRate":       s.setMemberCostRate,
		"app/(app)/projects/page.tsx::load":           s.projectsPage,
		"app/(app)/projects/[id]/page.tsx::load":      s.projectPage,
		"app/(app)/projects/[id]/edit/page.tsx::load": s.projectEditPage,
		"app/(app)/projects/new/page.tsx::load":       s.projectNewPage,
		"app/(app)/timesheets/page.tsx::load":         s.timesheetsPage,
		"app/(app)/calendar/page.tsx::load":           s.calendarPage,
		"app/(app)/activities/page.tsx::load":         s.activitiesPage,
	}
}

var projectStatuses = []string{"not_started", "in_progress", "review", "delivered", "support", "paused", "cancelled"}
var taskStatuses = []string{"todo", "in_progress", "done"}

const ownerError = "Choose a team member as the owner."
const editTimeError = "Only authors or staff can change unbilled time. Cancel the invoice to unlock billed time."
const safeFailure = "Unable to save changes. Please try again."

type businessError string

func (e businessError) Error() string { return string(e) }

func canonical(err error) bool {
	for _, candidate := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, candidate) {
			return true
		}
	}
	return false
}
func authorize(a erpwire.Actor, cap erpwire.Capability) error { return a.Authorize(cap, time.Now()) }
func invalid(message string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{"error": message}}, nil
}
func success(redirect string, paths ...string) erpwire.ActionResponse {
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: redirect, Refresh: paths}
}
func failure(err error) (any, error) {
	if canonical(err) {
		return nil, err
	}
	var local businessError
	if errors.As(err, &local) {
		return invalid(local.Error())
	}
	var safe interface{ BusinessMessage() string }
	if errors.As(err, &safe) {
		switch message := safe.BusinessMessage(); message {
		case "Only staff may bill time", "Invalid time billing request", "Idempotency conflict", "Project needs a client before billing", "Time invoice exceeds safe satang bounds", "No billable unbilled time", "Only staff may set cost rates", "Invalid cost rate", "Member unavailable", "Billed time is frozen until its invoice is cancelled", "Time author is immutable", "Time billing links require the billing command", "Task must belong to time entry project", "Time invoice and line must match project", "Workspace membership required":
			return invalid(message)
		}
	}
	return invalid(safeFailure)
}
func loadError(err error, message string) error {
	if err == nil || canonical(err) || errors.Is(err, erpwire.ErrNotFound) {
		return err
	}
	return errors.New(message)
}
func text(value any) string  { s, _ := value.(string); return s }
func boolean(value any) bool { b, _ := value.(bool); return b }
func eq(column string, value any) erpwire.Predicate {
	return erpwire.Predicate{Column: column, Op: erpwire.Equal, Value: value}
}
func scope(a erpwire.Actor) []erpwire.Predicate             { return []erpwire.Predicate{eq("org_id", a.OrgID())} }
func scoped(a erpwire.Actor, id string) []erpwire.Predicate { return append(scope(a), eq("id", id)) }
func ordered(columns ...string) []erpwire.Order {
	out := make([]erpwire.Order, 0, len(columns))
	for _, column := range columns {
		out = append(out, erpwire.Order{Column: column})
	}
	return out
}

type selector interface {
	Select(context.Context, erpwire.Select) (erpwire.Selection, error)
}

func all(ctx context.Context, tx selector, q erpwire.Select) ([]erpwire.Row, error) {
	q.Limit = 1000
	q.Offset = 0
	rows := []erpwire.Row{}
	for {
		page, err := tx.Select(ctx, q)
		if err != nil {
			return nil, err
		}
		rows = append(rows, page.Rows...)
		if !page.HasMore {
			return rows, nil
		}
		if len(page.Rows) == 0 {
			return nil, errors.New("Read failed")
		}
		q.Offset += len(page.Rows)
	}
}
func one(ctx context.Context, tx selector, q erpwire.Select) (erpwire.Row, error) {
	q.Limit = 1
	page, err := tx.Select(ctx, q)
	if err != nil {
		return nil, err
	}
	if len(page.Rows) == 0 {
		return nil, nil
	}
	return page.Rows[0], nil
}
func arguments(raw json.RawMessage, min, max int) (erpwire.Arguments, error) {
	args, err := erpwire.ParseArguments(raw)
	if err != nil || len(args) < min || len(args) > max {
		return nil, erpwire.ErrBadArguments
	}
	return args, nil
}
func inputArgument(raw json.RawMessage) (erpwire.Row, error) {
	args, err := arguments(raw, 1, 1)
	if err != nil {
		return nil, err
	}
	var row erpwire.Row
	if args.Decode(0, &row) != nil || row == nil {
		return nil, nil
	}
	return row, nil
}
func loadID(raw json.RawMessage) (string, error) {
	args, err := arguments(raw, 1, 1)
	if err != nil {
		return "", err
	}
	var id string
	if args.Decode(0, &id) == nil && id != "" {
		return id, nil
	}
	var params struct {
		ID string `json:"id"`
	}
	if args.Decode(0, &params) != nil || params.ID == "" {
		return "", erpwire.ErrBadArguments
	}
	return params.ID, nil
}
func (s *Service) audit(ctx context.Context, a erpwire.Actor, id, action, summary string, meta erpwire.Row) {
	if meta == nil {
		meta = erpwire.Row{}
	}
	// Audit is best effort after the business commit, matching writeAudit.
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": a.OrgID(), "actor_id": a.UserID(), "actor_email": a.Email(), "entity": "time_entry", "entity_id": id, "action": action, "summary": summary, "meta": meta}}})
		return err
	})
}
func people(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor) ([]erpwire.Row, error) {
	raw, err := tx.ReadRPC(ctx, "record_activity_assignees", erpwire.Row{"p_org_id": a.OrgID()})
	if err != nil {
		return nil, err
	}
	rows := []erpwire.Row{}
	err = erpwire.DecodeJSON(raw, &rows)
	return rows, err
}

func (s *Service) optionalRows(ctx context.Context, a erpwire.Actor, q erpwire.Select) ([]erpwire.Row, error) {
	var rows []erpwire.Row
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		rows, err = all(ctx, tx, q)
		return err
	})
	if canonical(err) {
		return nil, err
	}
	if err != nil || rows == nil {
		return []erpwire.Row{}, nil
	}
	return rows, nil
}

func (s *Service) optionalPeople(ctx context.Context, a erpwire.Actor) ([]erpwire.Row, error) {
	var rows []erpwire.Row
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		rows, err = people(ctx, tx, a)
		return err
	})
	if canonical(err) {
		return nil, err
	}
	if err != nil || rows == nil {
		return []erpwire.Row{}, nil
	}
	return rows, nil
}
func relation(row erpwire.Row, key string) erpwire.Row {
	switch value := row[key].(type) {
	case erpwire.Row:
		return value
	case map[string]any:
		return value
	}
	return nil
}
func clientRelation(name string) erpwire.Relation {
	return erpwire.Relation{Name: name, Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: []string{"name"}}
}
