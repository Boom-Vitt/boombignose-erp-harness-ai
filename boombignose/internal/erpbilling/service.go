// Package erpbilling preserves recurring agreement commands; PostgreSQL remains
// the sole owner of invoice creation, occurrence idempotency and schedule advancement.
package erpbilling

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
)

const actionPath = "app/(app)/finance/subscription-actions.ts::"
const pagePath = "app/(app)/finance/subscriptions/"
const listPath = "/finance/subscriptions"

var errCommandResult = errors.New("Invalid subscription command result")
var errProductUnavailable = errors.New("Product unavailable. Choose an active product or a free-text line.")

type Options struct {
	Store erpwire.Store
}

type Service struct {
	store erpwire.Store
}

func New(options Options) (*Service, error) {
	if options.Store == nil {
		return nil, errors.New("subscription store is required")
	}
	return &Service{store: options.Store}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		actionPath + "createSubscription": s.createSubscription,
		actionPath + "updateSubscription": s.updateSubscription,
		actionPath + "setSubscriptionStatus": s.setSubscriptionStatus,
		actionPath + "deleteSubscription": s.deleteSubscription,
		actionPath + "generateInvoiceNow": s.generateInvoiceNow,
		pagePath + "page.tsx::load": s.loadList,
		pagePath + "new/page.tsx::load": s.loadNew,
		pagePath + "[id]/page.tsx::load": s.loadDetail,
	}
}

// GenerateOccurrenceInTx executes the existing durable database command inside
// the caller's already-authorized transaction. It is reusable by a separately
// authorized scheduler; it does not select a role, create an Actor, scan dates,
// or substitute the current next_run_date for an explicit occurrence on retry.
// The transaction implementation must enforce its trusted organization scope.
func (s *Service) GenerateOccurrenceInTx(ctx context.Context, tx erpwire.WriteTx, orgID, subscriptionID, occurrence string) (string, error) {
	if tx == nil || !validID(orgID) || !validID(subscriptionID) || !validDate(occurrence) {
		return "", erpwire.ErrBadArguments
	}
	raw, err := tx.Command(ctx, "generate_subscription_occurrence", erpwire.Row{
		"p_org_id": orgID, "p_subscription_id": subscriptionID, "p_occurrence": occurrence,
	})
	if err != nil {
		return "", err
	}
	var invoiceID string
	if erpwire.DecodeJSON(raw, &invoiceID) != nil || !validID(invoiceID) {
		return "", errCommandResult
	}
	return invoiceID, nil
}

func validID(value string) bool {
	// z.guid accepts seed-shaped UUIDs without imposing RFC version/variant bits.
	return len(value) == 36 && uuid.Validate(value) == nil
}

func validDate(value string) bool {
	date, err := time.Parse("2006-01-02", value)
	return len(value) == 10 && err == nil && date.Format("2006-01-02") == value
}

func today() string {
	return time.Now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2006-01-02")
}

func objectArgument(raw json.RawMessage) (erpwire.Row, error) {
	args, err := erpwire.ParseArguments(raw)
	if err != nil || len(args) != 1 || args.Null(0) {
		return nil, erpwire.ErrBadArguments
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil || input == nil {
		return nil, erpwire.ErrBadArguments
	}
	return input, nil
}

func noArguments(raw json.RawMessage) error {
	args, err := erpwire.ParseArguments(raw)
	if err != nil || len(args) != 0 {
		return erpwire.ErrBadArguments
	}
	return nil
}

func eq(column string, value any) erpwire.Predicate {
	return erpwire.Predicate{Column: column, Op: erpwire.Equal, Value: value}
}

func scope(actor erpwire.Actor) []erpwire.Predicate {
	return []erpwire.Predicate{eq("org_id", actor.OrgID())}
}

func authError(err error) bool {
	for _, candidate := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, candidate) {
			return true
		}
	}
	return false
}

func actionFailure(err error, fallback string) (any, error) {
	if authError(err) {
		return nil, err
	}
	message := fallback
	if errors.Is(err, errProductUnavailable) || errors.Is(err, errCommandResult) {
		message = err.Error()
	}
	// Core exposes only allowlisted static business messages. Keep a second,
	// domain-local allowlist so another Store cannot leak arbitrary SQL details.
	var business interface{ BusinessMessage() string }
	if errors.As(err, &business) {
		switch text := business.BusinessMessage(); text {
		case "Only staff may manage subscriptions", "Only staff may bill subscriptions":
			return nil, erpwire.ErrForbidden
		case "Billed subscription must be retained",
			"Billed subscription scope and cadence require a new agreement",
			"Schedule changes require the subscription command",
			"Invalid subscription changes", "Invalid start date",
			"Invalid subscription name", "Subscription unavailable",
			"Product unavailable", "Scheduled occurrence required",
			"Invalid scheduled billing occurrence",
			"Occurrence does not match cadence",
			"Occurrence does not match anchor date",
			"Subscription project customer mismatch":
			message = text
		}
	}
	return erpwire.ActionResponse{Value: map[string]string{"error": message}}, nil
}

func invalidInput() (any, error) {
	return erpwire.ActionResponse{Value: map[string]string{"error": "Invalid input"}}, nil
}

func success(redirect string, paths ...string) (any, error) {
	return erpwire.ActionResponse{Value: struct{}{}, Redirect: redirect, Refresh: paths}, nil
}

func decodeRow(row erpwire.Row, destination any) error {
	raw, err := json.Marshal(row)
	if err != nil {
		return errors.New("Subscription data unavailable. Please reload.")
	}
	return erpwire.DecodeJSON(raw, destination)
}
