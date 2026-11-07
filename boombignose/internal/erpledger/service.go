// Package erpledger implements finance ledger, reconciliation and cost operations.
package erpledger

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"github.com/google/uuid"
)

type Options struct{ Store erpwire.Store }
type Service struct{ store erpwire.Store }

func New(options Options) (*Service, error) {
	if options.Store == nil {
		return nil, errors.New("ledger store is required")
	}
	return &Service{store: options.Store}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/(app)/finance/page.tsx::load":                                             s.financePage,
		"app/(app)/finance/actions.ts::createCost":                                     s.createCost,
		"app/(app)/finance/actions.ts::deleteCost":                                     s.deleteCost,
		"app/(app)/finance/actions.ts::updateFinanceLockDate":                          s.updateFinanceLockDate,
		"app/(app)/finance/actions.ts::confirmFinanceLockReopen":                       s.confirmFinanceLockReopen,
		"app/(app)/finance/actions.ts::cancelFinanceLockReopen":                        s.cancelFinanceLockReopen,
		"app/(app)/finance/actions.ts::closeCompletedMonth":                            s.closeCompletedMonth,
		"app/(app)/finance/costs/new/page.tsx::load":                                   s.newCostPage,
		"app/(app)/finance/costs/export/route.ts::GET":                                 s.exportCosts,
		"app/(app)/finance/bank/actions.ts::addBankLine":                               s.addBankLine,
		"app/(app)/finance/bank/actions.ts::matchBankLine":                             s.matchBankLine,
		"app/(app)/finance/bank/actions.ts::noteBankLine":                              s.noteBankLine,
		"app/(app)/finance/bank/page.tsx::load":                                        s.bankPage,
		"app/(app)/finance/cash/page.tsx::load":                                        s.cashPage,
		"app/(app)/finance/journal/actions.ts::postDraftJournal":                       s.postDraftJournal,
		"app/(app)/finance/journal/actions.ts::postIssuedSalesInvoice":                 s.postIssuedSalesInvoice,
		"app/(app)/finance/journal/actions.ts::postIssuedCreditNote":                   s.postIssuedCreditNote,
		"app/(app)/finance/journal/actions.ts::postCashReceipt":                        s.postCashReceipt,
		"app/(app)/finance/journal/acceptance-actions.ts::proposeDraftCloseAcceptance": s.proposeDraftCloseAcceptance,
		"app/(app)/finance/journal/acceptance-actions.ts::confirmDraftCloseAcceptance": s.confirmDraftCloseAcceptance,
		"app/(app)/finance/journal/acceptance-actions.ts::cancelDraftCloseAcceptance":  s.cancelDraftCloseAcceptance,
		"app/(app)/finance/journal/page.tsx::load":                                     s.journalPage,
		"app/(app)/finance/journal/trial-balance/page.tsx::load":                       s.trialBalancePage,
	}
}

var bangkok = time.FixedZone("Asia/Bangkok", 7*60*60)

func today() string { return time.Now().In(bangkok).Format("2006-01-02") }
func authorize(a erpwire.Actor, capability erpwire.Capability) error {
	return a.Authorize(capability, time.Now())
}
func text(v any) string { s, _ := v.(string); return s }
func object(v any) erpwire.Row {
	switch r := v.(type) {
	case erpwire.Row:
		return r
	case map[string]any:
		return erpwire.Row(r)
	}
	return nil
}
func trim(s string) string {
	return strings.Trim(s, "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
}
func length(s string) int { return len(utf16.Encode([]rune(s))) }
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func validID(s string) bool { return len(s) == 36 && uuid.Validate(s) == nil }
func validDate(s string) bool {
	d, e := time.Parse("2006-01-02", s)
	return len(s) == 10 && e == nil && d.Year() >= 100 && d.Format("2006-01-02") == s
}
func dateOnly(s string) string {
	if len(s) == 10 {
		return s
	}
	t, e := time.Parse(time.RFC3339Nano, s)
	if e != nil {
		return ""
	}
	return t.In(bangkok).Format("2006-01-02")
}
func eq(c string, v any) erpwire.Predicate {
	return erpwire.Predicate{Column: c, Op: erpwire.Equal, Value: v}
}
func scope(a erpwire.Actor) []erpwire.Predicate             { return []erpwire.Predicate{eq("org_id", a.OrgID())} }
func scoped(a erpwire.Actor, id string) []erpwire.Predicate { return append(scope(a), eq("id", id)) }
func in(c string, v []string) erpwire.Predicate {
	return erpwire.Predicate{Column: c, Op: erpwire.In, Value: v}
}
func order(c string, desc bool) erpwire.Order { return erpwire.Order{Column: c, Descending: desc} }
func has(values []string, v string) bool {
	for _, s := range values {
		if s == v {
			return true
		}
	}
	return false
}
func arguments(raw json.RawMessage, min, max int) (erpwire.Arguments, error) {
	args, e := erpwire.ParseArguments(raw)
	if e != nil || len(args) < min || len(args) > max {
		return nil, erpwire.ErrBadArguments
	}
	return args, nil
}
func inputObject(raw json.RawMessage) (erpwire.Row, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var r erpwire.Row
	if args.Decode(0, &r) != nil || r == nil {
		return nil, erpwire.ErrBadArguments
	}
	return r, nil
}
func stringInput(raw json.RawMessage) (string, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return "", e
	}
	var v string
	e = args.Decode(0, &v)
	if args.Null(0) {
		e = erpwire.ErrBadArguments
	}
	return v, e
}
func paramsInput(raw json.RawMessage) (erpwire.Row, error) {
	args, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	r := erpwire.Row{}
	if len(args) > 0 && !args.Null(0) {
		if args.Decode(0, &r) != nil {
			return nil, erpwire.ErrBadArguments
		}
	}
	return r, nil
}
func invalid(message string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{"error": message}}, nil
}
func success(paths ...string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{}, Refresh: paths}, nil
}

type businessError string

func (e businessError) Error() string { return string(e) }
func failure(err error, fallback string) (any, error) {
	for _, e := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, e) {
			return nil, err
		}
	}
	var b businessError
	if errors.As(err, &b) {
		return invalid(string(b))
	}
	var safe interface{ BusinessMessage() string }
	if errors.As(err, &safe) && safe.BusinessMessage() != "" {
		return invalid(safe.BusinessMessage())
	}
	return invalid(fallback)
}
func actionGate(a erpwire.Actor, c erpwire.Capability, message string) error {
	if e := authorize(a, ""); e != nil {
		return e
	}
	if authorize(a, c) != nil {
		return businessError(message)
	}
	return nil
}
func whole(v any) (int64, error) {
	switch n := v.(type) {
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	case int32:
		return int64(n), nil
	case json.Number:
		value := string(n)
		if index := strings.IndexAny(value, "eE"); index >= 0 {
			if strings.Trim(value[:index], "-.0") == "" {
				return 0, nil
			}
			exponent, e := strconv.ParseInt(value[index+1:], 10, 64)
			if e != nil || exponent > int64(len(value)+20) || exponent < -int64(len(value)+20) {
				break
			}
		}
		rational, ok := new(big.Rat).SetString(value)
		if ok && rational.IsInt() && rational.Num().IsInt64() {
			return rational.Num().Int64(), nil
		}
	}
	return 0, errors.New("Journal line amount must be integer satang.")
}
func satang(v any) (money.Satang, error) {
	n, e := whole(v)
	if e != nil || n < -int64(money.MaxSafeSatang) || n > int64(money.MaxSafeSatang) {
		return 0, errors.New("Journal line amount must be integer satang.")
	}
	return money.Satang(n), nil
}
func nonnegative(v any) (money.Satang, error) {
	n, e := satang(v)
	if n < 0 {
		e = errors.New("Journal line amount must be integer satang.")
	}
	return n, e
}
func sum(a, b money.Satang) (money.Satang, error) {
	if b > 0 && a > money.MaxSafeSatang-b || b < 0 && a < -money.MaxSafeSatang-b {
		return 0, errors.New("Unsafe integer-satang sum")
	}
	return a + b, nil
}
func amountInput(s string) (money.Satang, error) {
	s = trim(s)
	if !bahtPattern.MatchString(s) {
		return 0, businessError("Enter a positive THB amount with up to two decimals")
	}
	v, e := money.ParseBaht(s)
	if e != nil {
		return 0, businessError("Amount outside safe satang bounds")
	}
	return v, nil
}

type selector interface {
	Select(context.Context, erpwire.Select) (erpwire.Selection, error)
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
			return nil, errors.New("Ledger page unavailable")
		}
		q.Offset += len(r.Rows)
	}
}
func one(ctx context.Context, tx selector, q erpwire.Select) (erpwire.Row, error) {
	q.Limit = 1
	r, e := tx.Select(ctx, q)
	if e != nil || len(r.Rows) == 0 {
		return nil, e
	}
	return r.Rows[0], nil
}
func rows(ctx context.Context, tx selector, a erpwire.Actor, table string, columns []string, extra ...erpwire.Predicate) ([]erpwire.Row, error) {
	ordering := []erpwire.Order{order("id", false)}
	if table == "journal_lines" {
		ordering = []erpwire.Order{order("entry_id", false), order("line_no", false)}
	}
	return all(ctx, tx, erpwire.Select{Table: table, Columns: columns, Where: append(scope(a), extra...), Order: ordering})
}
func settings(ctx context.Context, tx selector, a erpwire.Actor, columns ...string) (erpwire.Row, error) {
	return one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: columns, Where: scope(a)})
}
func record(ctx context.Context, tx selector, a erpwire.Actor, table, id string, columns ...string) (erpwire.Row, error) {
	return one(ctx, tx, erpwire.Select{Table: table, Columns: columns, Where: scoped(a, id)})
}
func ids(rows []erpwire.Row, key string) []string {
	out := []string{}
	for _, r := range rows {
		v := text(r[key])
		if !has(out, v) {
			out = append(out, v)
		}
	}
	return out
}
func keyed(rows []erpwire.Row, key string) map[string]erpwire.Row {
	m := map[string]erpwire.Row{}
	for _, r := range rows {
		m[text(r[key])] = r
	}
	return m
}
func (s *Service) command(ctx context.Context, a erpwire.Actor, name string, args erpwire.Row) (json.RawMessage, error) {
	args["p_org_id"] = a.OrgID()
	var result json.RawMessage
	e := s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { var e error; result, e = tx.Command(ctx, name, args); return e })
	return result, e
}
