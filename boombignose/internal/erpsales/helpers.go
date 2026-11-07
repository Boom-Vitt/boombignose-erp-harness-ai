package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"github.com/google/uuid"
)

func authorize(a erpwire.Actor, c erpwire.Capability) error { return a.Authorize(c, time.Now()) }
func validID(v string) bool                                 { return len(v) == 36 && uuid.Validate(v) == nil }
func validDate(v string) bool {
	d, e := time.Parse("2006-01-02", v)
	return e == nil && len(v) == 10 && d.Format("2006-01-02") == v
}
func today() string {
	return time.Now().In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01-02")
}
func text(v any) string     { s, _ := v.(string); return s }
func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return r == '\uFEFF' || r == '\u0009' || r == '\u000A' || r == '\u000B' || r == '\u000C' || r == '\u000D' || r == '\u0020' || r == '\u00A0' || r == '\u1680' || r >= '\u2000' && r <= '\u200A' || r == '\u2028' || r == '\u2029' || r == '\u202F' || r == '\u205F' || r == '\u3000'
	})
}
func nilText(v string) any {
	v = jsTrim(v)
	if v == "" {
		return nil
	}
	return v
}
func optionalStrings(v erpwire.Row, keys ...string) bool {
	for _, k := range keys {
		if x, ok := v[k]; ok {
			if _, ok := x.(string); !ok {
				return false
			}
		}
	}
	return true
}
func has(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func eq(c string, v any) erpwire.Predicate {
	return erpwire.Predicate{Column: c, Op: erpwire.Equal, Value: v}
}
func scope(a erpwire.Actor) []erpwire.Predicate { return []erpwire.Predicate{eq("org_id", a.OrgID())} }
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
func stringArg(args erpwire.Arguments, i int) (string, error) {
	var v string
	e := args.Decode(i, &v)
	return v, e
}
func response(redirect string, paths ...string) erpwire.ActionResponse {
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: redirect, Refresh: paths}
}
func invalid(v string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{"error": v}}, nil
}
func authError(err error) bool {
	for _, e := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}

type businessError string

func (e businessError) Error() string { return string(e) }
func failure(err error) (any, error) {
	if authError(err) {
		return nil, err
	}
	var business businessError
	if errors.As(err, &business) {
		return invalid(business.Error())
	}
	var safe interface{ BusinessMessage() string }
	if errors.As(err, &safe) && safe.BusinessMessage() != "" {
		return invalid(safe.BusinessMessage())
	}
	return invalid("Unable to save changes. Please try again.")
}
func loadError(e error, message string) error {
	if e == nil || authError(e) || errors.Is(e, erpwire.ErrNotFound) {
		return e
	}
	return errors.New(message)
}
func integer(v any) (int64, error) {
	switch n := v.(type) {
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	case int32:
		return int64(n), nil
	case int16:
		return int64(n), nil
	case money.Satang:
		return int64(n), nil
	case json.Number:
		s, ok := numberText(n)
		if !ok {
			return 0, errors.New("Sales numeric value unavailable")
		}
		return strconv.ParseInt(s, 10, 64)
	case string:
		return strconv.ParseInt(n, 10, 64)
	default:
		return 0, errors.New("Sales numeric value unavailable")
	}
}
func satang(v any) (money.Satang, error) {
	n, e := integer(v)
	if e != nil || n < -int64(money.MaxSafeSatang) || n > int64(money.MaxSafeSatang) {
		return 0, errors.New("Sales monetary value unavailable")
	}
	return money.Satang(n), nil
}
func numberText(v any) (string, bool) {
	switch n := v.(type) {
	case string:
		return n, true
	case json.Number:
		s := n.String()
		negative := strings.HasPrefix(s, "-")
		s = strings.TrimPrefix(s, "-")
		mantissa, exponent, scientific := strings.Cut(strings.ToLower(s), "e")
		exp := 0
		if scientific {
			var err error
			exp, err = strconv.Atoi(exponent)
			if err != nil || exp < -400 || exp > 400 {
				return "", false
			}
		}
		whole, fraction, _ := strings.Cut(mantissa, ".")
		digits := strings.TrimLeft(whole+fraction, "0")
		if digits == "" {
			return "0", true
		}
		scale := len(fraction) - exp
		if scale <= 0 {
			s = digits + strings.Repeat("0", -scale)
		} else {
			if len(digits) <= scale {
				digits = strings.Repeat("0", scale-len(digits)+1) + digits
			}
			s = digits[:len(digits)-scale] + "." + digits[len(digits)-scale:]
			s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
		}
		if negative {
			s = "-" + s
		}
		return s, true
	default:
		return "", false
	}
}

var salesMoneyPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]{1,2})?$`)

func salesMoney(value string) (money.Satang, error) {
	value = jsTrim(value)
	if !salesMoneyPattern.MatchString(value) {
		return 0, money.ErrInput
	}
	return money.ParseBaht(value)
}
func checkedSum(a, b money.Satang) (money.Satang, error) {
	v := a + b
	if v < -money.MaxSafeSatang || v > money.MaxSafeSatang {
		return 0, errors.New("Unsafe integer-satang sum")
	}
	return v, nil
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
	q.Offset = 0
	rows := []erpwire.Row{}
	for {
		p, e := tx.Select(ctx, q)
		if e != nil {
			return nil, e
		}
		rows = append(rows, p.Rows...)
		if !p.HasMore {
			return rows, nil
		}
		if len(p.Rows) == 0 {
			return nil, errors.New("Sales page unavailable")
		}
		q.Offset += len(p.Rows)
	}
}
func ordered(cols ...string) []erpwire.Order {
	out := make([]erpwire.Order, 0, len(cols))
	for _, c := range cols {
		out = append(out, erpwire.Order{Column: c})
	}
	return out
}
func (s *Service) audit(ctx context.Context, a erpwire.Actor, entity, id, action, summary string, meta erpwire.Row) {
	if meta == nil {
		meta = erpwire.Row{}
	}
	// Source audit logging is best effort after the business transaction commits.
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": a.OrgID(), "actor_id": a.UserID(), "actor_email": a.Email(), "entity": entity, "entity_id": nilText(id), "action": action, "summary": summary, "meta": meta}}})
		return e
	})
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
