// Package erpexpenses implements the reviewed expense-claim application operations.
// Claim transitions and their audited finance effects remain owned by PostgreSQL.
package erpexpenses

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type Options struct { Store erpwire.Store }
type Service struct { store erpwire.Store }

func New(options Options) (*Service, error) {
	if options.Store == nil { return nil, errors.New("expense store is required") }
	return &Service{store: options.Store}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/(app)/expenses/actions.ts::createExpenseClaim": s.createClaim,
		"app/(app)/expenses/actions.ts::addExpenseLine": s.addLine,
		"app/(app)/expenses/actions.ts::removeExpenseLine": s.removeLine,
		"app/(app)/expenses/actions.ts::transitionExpenseClaim": s.transitionClaim,
		"app/(app)/expenses/actions.ts::rejectExpenseClaim": s.rejectClaim,
		"lib/expenses/queries.ts::expenseClaimLists": s.claimLists,
		"lib/expenses/queries.ts::expenseDetail": s.detail,
		"lib/expenses/queries.ts::expenseProjects": s.projects,
		"lib/expenses/queries.ts::expenseApprovalCount": s.approvalCount,
		"app/(app)/expenses/page.tsx::load": s.listLoad,
		"app/(app)/expenses/[id]/page.tsx::load": s.detailLoad,
		"app/(app)/expenses/new/page.tsx::load": s.newLoad,
	}
}

var errData = errors.New("Expense data unavailable. Please reload.")
var errCount = errors.New("Expense approval count unavailable")

func arguments(raw json.RawMessage, count int) (erpwire.Arguments, error) {
	args, err := erpwire.ParseArguments(raw)
	if err != nil || len(args) != count { return nil, erpwire.ErrBadArguments }
	return args, nil
}

func canonical(err error) bool {
	return errors.Is(err, erpwire.ErrUnauthenticated) || errors.Is(err, erpwire.ErrForbidden) ||
		errors.Is(err, erpwire.ErrStepUpRequired) || errors.Is(err, erpwire.ErrAuthUnavailable) ||
		errors.Is(err, erpwire.ErrIdentityChanged) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func readError(err, fallback error) error {
	if err == nil || canonical(err) || errors.Is(err, erpwire.ErrNotFound) { return err }
	return fallback
}

func authenticated(actor erpwire.Actor) error { return actor.Validate(time.Now()) }

func orgWhere(actor erpwire.Actor) []erpwire.Predicate {
	return []erpwire.Predicate{{Column: "org_id", Op: erpwire.Equal, Value: actor.OrgID()}}
}

func eq(column string, value any) erpwire.Predicate {
	return erpwire.Predicate{Column: column, Op: erpwire.Equal, Value: value}
}

type ActionValue struct { Error string `json:"error,omitempty"` }

func failure(message string) (any, error) {
	return erpwire.ActionResponse{Value: ActionValue{Error: message}}, nil
}

func actionResult(err error, id, fallback string) (any, error) {
	if err != nil {
		if canonical(err) { return nil, err }
		var business interface { BusinessMessage() string }
		if errors.As(err, &business) {
			switch message := business.BusinessMessage(); message {
			case "Expense claim unavailable", "Only draft expense lines are editable",
				"Expense total exceeds safe satang bounds", "Invalid expense transition",
				"Only owners and admins may decide expense claims",
				"Nobody may decide their own expense claim",
				"Only the claimant may submit, withdraw or reopen an expense claim",
				"Add expense lines first", "Rejection reason required":
				return failure(message)
			}
		}
		return failure(fallback)
	}
	return erpwire.ActionResponse{Value: ActionValue{}, Refresh: []string{"/expenses/"+id, "/expenses", "/finance", "/dashboard"}}, nil
}
