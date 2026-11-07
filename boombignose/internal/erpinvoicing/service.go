// Package erpinvoicing ports the finance operations. Durable financial commands
// remain owned by PostgreSQL; the host supplies authenticated Store transactions.
package erpinvoicing

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"github.com/google/uuid"
)

type TextGenerator interface {
	GenerateText(context.Context, string, string, int) (string, error)
}

type EmailMessage struct {
	To      string
	Subject string
	HTML    string
}
type EmailResult struct {
	OK     bool
	Reason string
	Error  string
}
type EmailSender interface {
	SendEmail(context.Context, EmailMessage) (EmailResult, error)
}

type Options struct {
	Store         erpwire.Store
	PDFRenderer   PDFRenderer
	TextGenerator TextGenerator
	EmailSender   EmailSender
	AppURL        string
	Now           func() time.Time
}
type Service struct {
	store     erpwire.Store
	renderer  PDFRenderer
	generator TextGenerator
	emailer   EmailSender
	appURL    string
	now       func() time.Time
}

func New(o Options) (*Service, error) {
	if o.Store == nil {
		return nil, errors.New("invoicing store is required")
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Service{store: o.Store, renderer: o.PDFRenderer, generator: o.TextGenerator, emailer: o.EmailSender, appURL: o.AppURL, now: o.Now}, nil
}

const financeActions = "app/(app)/finance/actions.ts::"
const financePath = "app/(app)/finance/"

func (s *Service) Operations() map[string]erpwire.Operation {
	ops := map[string]erpwire.Operation{
		financeActions + "createInvoice":                            s.createInvoice,
		financeActions + "updateInvoice":                            s.updateInvoice,
		financeActions + "createCost":                               s.createCost,
		financeActions + "deleteCost":                               s.deleteCost,
		financeActions + "updateInvoiceWithholding":                 s.updateInvoiceWithholding,
		financePath + "email-actions.ts::sendInvoiceEmail":          s.sendInvoiceEmail,
		financePath + "close-summary-actions.ts::summarizeMonthEnd": s.summarizeMonthEnd,
		financePath + "page.tsx::load":                              s.financePage,
		financePath + "business-profile/page.tsx::load":             s.businessProfilePage,
		financePath + "invoices/new/page.tsx::load":                 s.newInvoicePage,
		financePath + "invoices/[id]/page.tsx::load":                s.invoicePage,
		financePath + "receipts/page.tsx::load":                     s.receiptsPage,
		financePath + "invoices/export/route.ts::GET":               s.invoiceExport,
		financePath + "payments/export/route.ts::GET":               s.paymentExport,
		financePath + "outstanding/export/route.ts::GET":            s.outstandingExport,
		financePath + "invoices/[id]/pdf/route.ts::GET":             s.invoicePDF,
		financePath + "invoices/[id]/wht/route.ts::GET":             s.invoiceWHT,
		financePath + "credit-notes/[id]/pdf/route.ts::GET":         s.creditNotePDF,
	}
	for key, spec := range commandActions {
		ops[key] = s.commandAction(spec)
	}
	return ops
}

// RouteResponse is a data-only response for the host HTTP adapter, including bytes.
type RouteResponse struct {
	Status  int
	Headers map[string]string
	Body    []byte
}

var bangkok = time.FixedZone("Asia/Bangkok", 7*60*60)

func (s *Service) today() string         { return s.now().In(bangkok).Format("2006-01-02") }
func authenticate(a erpwire.Actor) error { return a.Validate(time.Now()) }
func canonical(e error) bool {
	for _, v := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(e, v) {
			return true
		}
	}
	return false
}
func invalid(message string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{"error": message}}, nil
}
func success(paths ...string) (any, error) {
	return erpwire.ActionResponse{Value: erpwire.Row{}, Refresh: paths}, nil
}

type businessError string

func (e businessError) Error() string { return string(e) }
func failure(e error) (any, error) {
	if canonical(e) {
		return nil, e
	}
	var safe interface{ BusinessMessage() string }
	if errors.As(e, &safe) && safe.BusinessMessage() != "" {
		return invalid(safe.BusinessMessage())
	}
	var business businessError
	if errors.As(e, &business) {
		return invalid(string(business))
	}
	return invalid("Unable to save changes. Please try again.")
}
func gate(a erpwire.Actor, cap erpwire.Capability, message string) (any, error, bool) {
	if e := authenticate(a); e != nil {
		return nil, e, false
	}
	if e := a.Authorize(cap, time.Now()); e != nil {
		if message != "" {
			v, e := invalid(message)
			return v, e, false
		}
		return nil, e, false
	}
	return nil, nil, true
}
func text(v any) string { s, _ := v.(string); return s }
func object(v any) erpwire.Row {
	switch r := v.(type) {
	case erpwire.Row:
		return r
	case map[string]any:
		return r
	}
	return nil
}
func trim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return r == '\ufeff' || r != '\u0085' && unicode.IsSpace(r) })
}
func textLength(s string) int { return len(utf16.Encode([]rune(s))) }
func nilText(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func eq(c string, v any) erpwire.Predicate {
	return erpwire.Predicate{Column: c, Op: erpwire.Equal, Value: v}
}
func scope(a erpwire.Actor) []erpwire.Predicate             { return []erpwire.Predicate{eq("org_id", a.OrgID())} }
func scoped(a erpwire.Actor, id string) []erpwire.Predicate { return append(scope(a), eq("id", id)) }
func ordered(cols ...string) []erpwire.Order {
	out := make([]erpwire.Order, 0, len(cols))
	for _, c := range cols {
		out = append(out, erpwire.Order{Column: c})
	}
	return out
}

type selector interface {
	Select(context.Context, erpwire.Select) (erpwire.Selection, error)
}

func all(ctx context.Context, tx selector, q erpwire.Select) ([]erpwire.Row, error) {
	q.Offset = 0
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
			return nil, errors.New("Finance page unavailable")
		}
		q.Offset += len(page.Rows)
	}
}
func one(ctx context.Context, tx selector, q erpwire.Select) (erpwire.Row, error) {
	q.Limit = 1
	rows, e := tx.Select(ctx, q)
	if e != nil {
		return nil, e
	}
	if len(rows.Rows) == 0 {
		return nil, nil
	}
	return rows.Rows[0], nil
}
func integer(v any) (int64, error) {
	switch n := v.(type) {
	case money.Satang:
		return int64(n), nil
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	case int32:
		return int64(n), nil
	case int16:
		return int64(n), nil
	case json.Number:
		return strconv.ParseInt(string(n), 10, 64)
	case string:
		return strconv.ParseInt(n, 10, 64)
	}
	return 0, errors.New("Invalid integer satang")
}
func amount(v any) (money.Satang, error) {
	n, e := integer(v)
	if e != nil || n < -int64(money.MaxSafeSatang) || n > int64(money.MaxSafeSatang) {
		return 0, errors.New("Invalid integer satang")
	}
	return money.Satang(n), nil
}
func sum(values ...money.Satang) (money.Satang, error) {
	var total money.Satang
	for _, n := range values {
		if n < -money.MaxSafeSatang || n > money.MaxSafeSatang || n > 0 && total > money.MaxSafeSatang-n || n < 0 && total < -money.MaxSafeSatang-n {
			return 0, errors.New("Unsafe integer-satang sum")
		}
		total += n
	}
	return total, nil
}
func validID(s string) bool { return len(s) == 36 && uuid.Validate(s) == nil }
func strictUUID(s string) bool {
	if !validID(s) {
		return false
	}
	if s == "00000000-0000-0000-0000-000000000000" || s == "ffffffff-ffff-ffff-ffff-ffffffffffff" {
		return true
	}
	return s[14] >= '1' && s[14] <= '8' && strings.ContainsRune("89abAB", rune(s[19]))
}
func validDate(s string) bool {
	d, e := time.Parse("2006-01-02", s)
	return len(s) == 10 && e == nil && d.Format("2006-01-02") == s
}
func dateOnly(s string) string {
	if validDate(s) {
		return s
	}
	d, e := time.Parse(time.RFC3339Nano, s)
	if e != nil {
		return ""
	}
	return d.In(bangkok).Format("2006-01-02")
}
func arguments(raw json.RawMessage, min, max int) (erpwire.Arguments, error) {
	a, e := erpwire.ParseArguments(raw)
	if e != nil || len(a) < min || len(a) > max {
		return nil, erpwire.ErrBadArguments
	}
	return a, nil
}
func objectArgument(raw json.RawMessage) (erpwire.Row, error) {
	a, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var r erpwire.Row
	if a.Decode(0, &r) != nil || r == nil {
		return nil, erpwire.ErrBadArguments
	}
	return r, nil
}
func pageParams(raw json.RawMessage) (erpwire.Row, error) {
	a, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	r := erpwire.Row{}
	if len(a) > 0 && !a.Null(0) {
		if a.Decode(0, &r) != nil || r == nil {
			return nil, erpwire.ErrBadArguments
		}
	}
	if p, ok := r["searchParams"]; ok {
		if p == nil {
			return erpwire.Row{}, nil
		}
		if object(p) == nil {
			return nil, erpwire.ErrBadArguments
		}
		return object(p), nil
	}
	return r, nil
}
func loadID(raw json.RawMessage) (string, error) {
	a, e := arguments(raw, 1, 1)
	if e != nil {
		return "", e
	}
	var id string
	if a.Decode(0, &id) != nil {
		var p erpwire.Row
		if a.Decode(0, &p) != nil {
			return "", erpwire.ErrBadArguments
		}
		id = text(object(p["params"])["id"])
	}
	if !validID(id) {
		return "", erpwire.ErrNotFound
	}
	return id, nil
}
func routeArgs(raw json.RawMessage) (string, erpwire.Row, error) {
	a, e := arguments(raw, 0, 2)
	if e != nil {
		return "", nil, e
	}
	params := erpwire.Row{}
	id := ""
	for _, arg := range a {
		var v any
		if erpwire.DecodeJSON(arg, &v) != nil {
			return "", nil, erpwire.ErrBadArguments
		}
		switch p := v.(type) {
		case string:
			if validID(p) {
				id = p
			} else if u, e := url.Parse(p); e == nil {
				for k, vs := range u.Query() {
					if len(vs) == 1 {
						params[k] = vs[0]
					}
				}
			} else {
				return "", nil, erpwire.ErrBadArguments
			}
		case map[string]any:
			if u := text(p["url"]); u != "" {
				parsed, e := url.Parse(u)
				if e != nil {
					return "", nil, erpwire.ErrBadArguments
				}
				for k, vs := range parsed.Query() {
					if len(vs) == 1 {
						params[k] = vs[0]
					}
				}
			}
			if pp := object(p["params"]); pp != nil {
				id = text(pp["id"])
			}
			if q := object(p["searchParams"]); q != nil {
				for k, v := range q {
					params[k] = v
				}
			}
			for k, v := range p {
				if k != "params" && k != "searchParams" && k != "url" {
					params[k] = v
				}
			}
			if id == "" {
				id = text(p["id"])
			}
		case nil:
		default:
			return "", nil, erpwire.ErrBadArguments
		}
	}
	return id, params, nil
}
func outstanding(total, paid, credited money.Satang) money.Satang {
	n := total - paid - credited
	if n < 0 {
		return 0
	}
	return n
}
func status(r erpwire.Row, paid, credited money.Satang, today string) string {
	state := text(r["status"])
	if state == "draft" || state == "cancelled" {
		return state
	}
	n, e := amount(r["amount_satang"])
	if e != nil {
		return ""
	}
	if n > 0 && paid+credited >= n {
		return "paid"
	}
	if due := text(r["due_date"]); due != "" && due < today {
		return "overdue"
	}
	if paid+credited > 0 {
		return "partially_paid"
	}
	return "sent"
}
func displayNumber(r erpwire.Row) string {
	if text(r["issued_snapshot_id"]) != "" {
		return text(r["number"])
	}
	id := text(r["id"])
	if len(id) > 8 {
		id = id[:8]
	}
	return "DRAFT-" + id
}
func formatTHB(n money.Satang, whole bool) string {
	negative := n < 0
	if negative {
		n = -n
	}
	value := money.FormatBaht(n)
	if whole {
		value = strconv.FormatInt(int64((n+50)/100), 10)
	}
	parts := strings.Split(value, ".")
	digits := parts[0]
	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}
	if len(parts) > 1 {
		digits += "." + parts[1]
	}
	if negative {
		return "-฿" + digits
	}
	return "฿" + digits
}
func (s *Service) audit(ctx context.Context, a erpwire.Actor, entity, id, action, summary string, meta erpwire.Row) {
	if meta == nil {
		meta = erpwire.Row{}
	}
	// Audit is best effort in the TypeScript source, after the business transaction.
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": a.OrgID(), "actor_id": a.UserID(), "actor_email": a.Email(), "entity": entity, "entity_id": id, "action": action, "summary": summary, "meta": meta}}})
		return e
	})
}
