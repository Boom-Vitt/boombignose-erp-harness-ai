// Package erpinsight implements workspace reporting, intake and document operations.
package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
)

type TextGenerator interface {
	GenerateText(context.Context, string, string, int) (string, error)
}

type Options struct {
	Store         erpwire.Store
	TextGenerator TextGenerator
	Model         string
	Now           func() time.Time
	AppOrigin     string
}

type Service struct {
	store     erpwire.Store
	generator TextGenerator
	model     string
	now       func() time.Time
	appOrigin string
}

func New(options Options) (*Service, error) {
	if options.Store == nil {
		return nil, errors.New("insight store is required")
	}
	if options.TextGenerator != nil && strings.TrimSpace(options.Model) == "" {
		return nil, errors.New("insight configured model identifier is required")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &Service{store: options.Store, generator: options.TextGenerator, model: strings.TrimSpace(options.Model), now: options.Now, appOrigin: options.AppOrigin}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
	ops := map[string]erpwire.Operation{
		"app/(app)/views/actions.ts::createSavedView":                  s.createSavedView,
		"app/(app)/views/actions.ts::deleteSavedView":                  s.deleteSavedView,
		"app/(app)/intake/actions.ts::intakeMeeting":                   s.intakeMeeting,
		"app/(app)/documents/actions.ts::setPublicDocumentRefsEnabled": s.setPublicDocumentRefsEnabled,
		"app/(app)/documents/actions.ts::issueDocumentPublicReference": s.issueDocumentPublicReference,
		"app/(app)/documents/lookup/page.tsx::load":                    s.lookupPage,
		"app/(app)/documents/ocr/page.tsx::load":                       s.ocrPage,
		"app/(app)/assistant/page.tsx::load":                           s.assistantPage,
	}
	for _, group := range []map[string]erpwire.Operation{s.importOperations(), s.reportOperations(), s.auditOperations(), s.automationOperations(), s.networkOperations()} {
		for key, op := range group {
			if _, exists := ops[key]; exists {
				panic("duplicate insight operation: " + key)
			}
			ops[key] = op
		}
	}
	return ops
}

// HTTPResponse retains route status, exact UTF-8 body bytes and download headers.
type HTTPResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

func authorize(a erpwire.Actor, capability erpwire.Capability) error {
	return a.Authorize(capability, time.Now())
}
func arguments(raw json.RawMessage, min, max int) (erpwire.Arguments, error) {
	args, e := erpwire.ParseArguments(raw)
	if e != nil || len(args) < min || len(args) > max {
		return nil, erpwire.ErrBadArguments
	}
	return args, nil
}
func text(v any) string { s, _ := v.(string); return s }
func trimText(v string) string {
	return strings.TrimFunc(v, func(r rune) bool {
		return r == '\uFEFF' || r == '\u0009' || r == '\u000A' || r == '\u000B' || r == '\u000C' || r == '\u000D' || r == '\u0020' || r == '\u00A0' || r == '\u1680' || r >= '\u2000' && r <= '\u200A' || r == '\u2028' || r == '\u2029' || r == '\u202F' || r == '\u205F' || r == '\u3000'
	})
}
func jsLength(v string) int { return len(utf16.Encode([]rune(v))) }
func validID(v string) bool { return len(v) == 36 && uuid.Validate(v) == nil }
func has(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func integer(v any) (int64, error) {
	switch n := v.(type) {
	case int64:
		return n, nil
	case int:
		return int64(n), nil
	case int32:
		return int64(n), nil
	case int16:
		return int64(n), nil
	case json.Number:
		return strconv.ParseInt(string(n), 10, 64)
	case string:
		return strconv.ParseInt(n, 10, 64)
	default:
		return 0, errors.New("insight numeric value unavailable")
	}
}
func eq(column string, value any) erpwire.Predicate {
	return erpwire.Predicate{Column: column, Op: erpwire.Equal, Value: value}
}
func scoped(a erpwire.Actor, id string) []erpwire.Predicate {
	return []erpwire.Predicate{eq("org_id", a.OrgID()), eq("id", id)}
}
func selection(a erpwire.Actor, table string, columns []string, where ...erpwire.Predicate) erpwire.Select {
	return erpwire.Select{Table: table, Columns: columns, Where: append([]erpwire.Predicate{eq("org_id", a.OrgID())}, where...), Order: []erpwire.Order{{Column: "id"}}, Limit: 1000}
}

type selector interface {
	Select(context.Context, erpwire.Select) (erpwire.Selection, error)
}

func all(ctx context.Context, tx selector, q erpwire.Select) ([]erpwire.Row, error) {
	q.Limit = 1000
	rows := []erpwire.Row{}
	for {
		page, e := tx.Select(ctx, q)
		if e != nil {
			return nil, e
		}
		rows = append(rows, page.Rows...)
		if !page.HasMore {
			return rows, nil
		}
		if len(page.Rows) == 0 {
			return nil, errors.New("Insight page unavailable")
		}
		q.Offset += len(page.Rows)
	}
}
func one(ctx context.Context, tx selector, q erpwire.Select) (erpwire.Row, error) {
	q.Limit = 1
	p, e := tx.Select(ctx, q)
	if e != nil {
		return nil, e
	}
	if len(p.Rows) == 0 {
		return nil, nil
	}
	return p.Rows[0], nil
}
func invalid(message string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{"error": message}}, nil
}
func response(redirect string, paths ...string) erpwire.ActionResponse {
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: redirect, Refresh: paths}
}
func authError(err error) bool {
	for _, e := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}
func publicMessage(err error, fallback string) string {
	var safe interface{ BusinessMessage() string }
	if errors.As(err, &safe) && safe.BusinessMessage() != "" {
		return safe.BusinessMessage()
	}
	return fallback
}
func actionFailure(err error, fallback string) (any, error) {
	if authError(err) {
		return nil, err
	}
	return invalid(publicMessage(err, fallback))
}
func (s *Service) audit(ctx context.Context, a erpwire.Actor, entity, id, action, summary string, meta erpwire.Row) {
	if meta == nil {
		meta = erpwire.Row{}
	}
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": a.OrgID(), "actor_id": a.UserID(), "actor_email": a.Email(), "entity": entity, "entity_id": id, "action": action, "summary": summary, "meta": meta}}})
		return e
	})
}
