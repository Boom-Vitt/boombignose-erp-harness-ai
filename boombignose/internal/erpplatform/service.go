// Package erpplatform implements workspace settings and platform request operations.
package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type Options struct {
	Store      erpwire.Store
	Now        func() time.Time
	Origins    []string
	Mobile     MobileOptions
	Native     NativeOptions
	Automation AutomationOptions
	Security   SecurityOptions
}

type Service struct {
	store      erpwire.Store
	now        func() time.Time
	origins    []string
	mobile     MobileOptions
	native     NativeOptions
	automation AutomationOptions
	security   SecurityOptions
}

func New(o Options) (*Service, error) {
	if o.Store == nil {
		return nil, errors.New("platform store is required")
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Service{store: o.Store, now: o.Now, origins: configuredOrigins(o.Origins), mobile: o.Mobile, native: o.Native, automation: o.Automation, security: o.Security}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
	out := s.settingsOperations()
	for _, operations := range []map[string]erpwire.Operation{s.securityOperations(), s.mobileOperations(), s.nativeOperations(), s.automationOperations()} {
		for key, operation := range operations {
			if _, exists := out[key]; exists {
				panic("duplicate platform operation: " + key)
			}
			out[key] = operation
		}
	}
	out["app/api/health/route.ts::GET"] = func(_ context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
		if _, e := arguments(raw, 0, 1); e != nil {
			return nil, e
		}
		return jsonResponse(200, erpwire.Row{"ok": true, "app": "boombignose-erp"}), nil
	}
	for key, operation := range out {
		if !strings.Contains(key, "/route.ts::") || key == "app/api/health/route.ts::GET" {
			continue
		}
		method := strings.Split(key, "::")[1]
		out[key] = func(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
			r, e := apiRequest(raw)
			if e != nil || r.Method != method {
				return nil, erpwire.ErrBadArguments
			}
			return operation(ctx, a, raw)
		}
	}
	return out
}

func text(v any) string { s, _ := v.(string); return s }
func eq(column string, value any) erpwire.Predicate {
	return erpwire.Predicate{Column: column, Op: erpwire.Equal, Value: value}
}
func scoped(a erpwire.Actor, id string) []erpwire.Predicate {
	return []erpwire.Predicate{eq("org_id", a.OrgID()), eq("id", id)}
}
func arguments(raw json.RawMessage, min, max int) (erpwire.Arguments, error) {
	args, e := erpwire.ParseArguments(raw)
	if e != nil || len(args) < min || len(args) > max {
		return nil, erpwire.ErrBadArguments
	}
	return args, nil
}
func invalid(message string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{"error": message}}, nil
}
func response(redirect string, paths ...string) erpwire.ActionResponse {
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: redirect, Refresh: paths}
}

type selector interface {
	Select(context.Context, erpwire.Select) (erpwire.Selection, error)
}

func one(ctx context.Context, tx selector, q erpwire.Select) (erpwire.Row, error) {
	q.Limit = 1
	r, e := tx.Select(ctx, q)
	if e != nil {
		return nil, e
	}
	if len(r.Rows) == 0 {
		return nil, nil
	}
	return r.Rows[0], nil
}
func all(ctx context.Context, tx selector, q erpwire.Select) ([]erpwire.Row, error) {
	q.Limit = 1000
	rows := []erpwire.Row{}
	for {
		r, e := tx.Select(ctx, q)
		if e != nil {
			return nil, e
		}
		rows = append(rows, r.Rows...)
		if !r.HasMore {
			return rows, nil
		}
		if len(r.Rows) == 0 {
			return nil, errors.New("Platform data unavailable")
		}
		q.Offset += len(r.Rows)
	}
}
func (s *Service) authorize(a erpwire.Actor, c erpwire.Capability) error {
	return a.Authorize(c, s.now())
}
func isAuthError(e error) bool {
	return errors.Is(e, erpwire.ErrUnauthenticated) || errors.Is(e, erpwire.ErrForbidden) || errors.Is(e, erpwire.ErrStepUpRequired) || errors.Is(e, erpwire.ErrAuthUnavailable) || errors.Is(e, erpwire.ErrIdentityChanged)
}
func actionFailure(e error) (any, error) {
	if isAuthError(e) {
		return nil, e
	}
	var public interface{ BusinessMessage() string }
	if errors.As(e, &public) {
		return invalid(public.BusinessMessage())
	}
	return invalid("Unable to save changes. Please try again.")
}
func (s *Service) audit(ctx context.Context, a erpwire.Actor, entity, id, action, summary string) {
	var entityID any
	if id != "" {
		entityID = id
	}
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": a.OrgID(), "actor_id": a.UserID(), "actor_email": a.Email(), "entity": entity, "entity_id": entityID, "action": action, "summary": summary, "meta": erpwire.Row{}}}})
		return e
	})
}
func trim(v string) string {
	return strings.Trim(v, " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
}
