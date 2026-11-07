package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

const purTestOrg = "10000000-0000-4000-8000-000000000001"
const purTestOther = "10000000-0000-4000-8000-000000000002"
const purTestID = "20000000-0000-4000-8000-000000000001"
const purTestLine = "30000000-0000-4000-8000-000000000001"
const purTestKey = "40000000-0000-4000-8000-000000000001"

func purTestActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	user := "50000000-0000-4000-8000-000000000001"
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: user, ExpiresAt: time.Now().Add(time.Hour), Assurance: erpwire.AAL1, FactorStateKnown: true}, erpwire.Membership{UserID: user, OrgID: purTestOrg, OrgName: "Test", Role: role}, false, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	return a
}

type purTestCall struct {
	Name  string
	Input erpwire.Row
}
type purTestStore struct {
	t             *testing.T
	tables        map[string][]erpwire.Row
	calls         []purTestCall
	reads, writes int
	command       func(string, erpwire.Row) (json.RawMessage, error)
	selectError   map[string]error
}

func (f *purTestStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	f.reads++
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(f)
}
func (f *purTestStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	f.writes++
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(f)
}
func (f *purTestStore) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	if e := f.selectError[q.Table]; e != nil {
		return erpwire.Selection{}, e
	}
	scoped := false
	for _, p := range q.Where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == purTestOrg {
			scoped = true
		}
	}
	if !scoped {
		f.t.Fatalf("unscoped %s query %#v", q.Table, q.Where)
	}
	rows := []erpwire.Row{}
	for _, row := range f.tables[q.Table] {
		if purTestMatches(row, q.Where) {
			rows = append(rows, row)
		}
	}
	count := int64(len(rows))
	offset := q.Offset
	if offset > len(rows) {
		offset = len(rows)
	}
	end := len(rows)
	more := false
	if q.Limit > 0 && offset+q.Limit < end {
		end = offset + q.Limit
		more = true
	}
	return erpwire.Selection{Rows: rows[offset:end], HasMore: more, Total: &count}, nil
}
func purTestMatches(row erpwire.Row, predicates []erpwire.Predicate) bool {
	for _, p := range predicates {
		switch p.Op {
		case erpwire.Equal, erpwire.Is:
			if !reflect.DeepEqual(row[p.Column], p.Value) {
				return false
			}
		case erpwire.NotEqual:
			if reflect.DeepEqual(row[p.Column], p.Value) {
				return false
			}
		case erpwire.Less:
			if text(row[p.Column]) >= text(p.Value) {
				return false
			}
		}
	}
	return true
}
func (f *purTestStore) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected read RPC")
}
func (f *purTestStore) Command(_ context.Context, name string, row erpwire.Row) (json.RawMessage, error) {
	if row["p_org_id"] != purTestOrg {
		f.t.Fatalf("command lacks trusted org %#v", row)
	}
	f.calls = append(f.calls, purTestCall{name, row})
	if f.command != nil {
		return f.command(name, row)
	}
	return json.RawMessage(`null`), nil
}
func (f *purTestStore) Insert(_ context.Context, q erpwire.Insert) ([]erpwire.Row, error) {
	out := []erpwire.Row{}
	for _, row := range q.Rows {
		conflict := false
		if q.IgnoreConflicts {
			for _, old := range f.tables[q.Table] {
				same := true
				for _, column := range q.ConflictColumns {
					if !reflect.DeepEqual(row[column], old[column]) {
						same = false
					}
				}
				if same {
					conflict = true
					break
				}
			}
		}
		if conflict {
			continue
		}
		if row["org_id"] != purTestOrg {
			f.t.Fatal("unscoped insert")
		}
		if row["id"] == nil {
			row["id"] = purTestID
		}
		if f.tables == nil {
			f.tables = map[string][]erpwire.Row{}
		}
		f.tables[q.Table] = append(f.tables[q.Table], row)
		out = append(out, row)
	}
	return out, nil
}
func (f *purTestStore) Update(_ context.Context, table string, values erpwire.Row, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	org := false
	for _, p := range where {
		if p.Column == "org_id" && p.Value == purTestOrg {
			org = true
		}
	}
	if !org {
		f.t.Fatal("unscoped update")
	}
	out := []erpwire.Row{}
	for _, row := range f.tables[table] {
		if purTestMatches(row, where) {
			for k, v := range values {
				row[k] = v
			}
			out = append(out, row)
		}
	}
	return out, nil
}
func (f *purTestStore) Delete(context.Context, string, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	f.t.Fatal("unexpected delete")
	return nil, nil
}
func purTestRaw(t *testing.T, args ...any) json.RawMessage {
	t.Helper()
	raw, e := json.Marshal(args)
	if e != nil {
		t.Fatal(e)
	}
	return raw
}
func purTestError(t *testing.T, value any, err error, want string) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected transport error %v", err)
	}
	response, ok := value.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("not action response %#v", value)
	}
	row, ok := response.Value.(erpwire.Row)
	if !ok || text(row["error"]) != want {
		t.Fatalf("error got %#v want %q", response.Value, want)
	}
}
func TestPurchaseAuthorizationBeforeStore(t *testing.T) {
	for _, op := range []string{"createPurchase", "updatePurchase", "transitionPurchase", "receivePurchase", "returnPurchase", "createPurchaseBill", "markBillPaid", "linkVendorCredit", "updateBillTolerance", "approvePurchase", "reopenPurchaseRFQ"} {
		t.Run(op, func(t *testing.T) {
			store := &purTestStore{t: t}
			s, _ := New(Options{Store: store})
			_, e := s.Operations()["app/(app)/purchases/actions.ts::"+op](context.Background(), purTestActor(t, erpwire.Member), json.RawMessage(`[]`))
			if !errors.Is(e, erpwire.ErrForbidden) || store.writes != 0 || store.reads != 0 {
				t.Fatalf("authorization e=%v reads=%d writes=%d", e, store.reads, store.writes)
			}
		})
	}
	for _, key := range []string{"app/(app)/vendors/actions.ts::saveVendor", "app/(app)/vendors/new/page.tsx::load", "app/(app)/purchases/email-actions.ts::sendPurchaseRFQ"} {
		store := &purTestStore{t: t}
		s, _ := New(Options{Store: store})
		_, e := s.Operations()[key](context.Background(), purTestActor(t, erpwire.Member), json.RawMessage(`[]`))
		if !errors.Is(e, erpwire.ErrForbidden) {
			t.Fatalf("%s e=%v", key, e)
		}
	}
}
func TestPurchaseTransitionCommandAndExactFailure(t *testing.T) {
	for _, status := range []string{"confirmed", "closed", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			store := &purTestStore{t: t}
			s, _ := New(Options{Store: store})
			value, e := s.transitionPurchase(context.Background(), purTestActor(t, erpwire.Owner), purTestRaw(t, purTestID, status))
			if e != nil {
				t.Fatal(e)
			}
			if len(store.calls) != 1 || store.calls[0].Name != "transition_purchase_order" || !reflect.DeepEqual(store.calls[0].Input, erpwire.Row{"p_org_id": purTestOrg, "p_order_id": purTestID, "p_status": status}) {
				t.Fatalf("wrong transition %#v", store.calls)
			}
			if !reflect.DeepEqual(value.(erpwire.ActionResponse).Refresh, purchaseRefresh(purTestID)) {
				t.Fatalf("wrong invalidation %#v", value)
			}
		})
	}
	store := &purTestStore{t: t, command: func(string, erpwire.Row) (json.RawMessage, error) {
		return nil, purchaseBusinessError("Owner/admin approval required for current purchase content")
	}}
	s, _ := New(Options{Store: store})
	value, e := s.transitionPurchase(context.Background(), purTestActor(t, erpwire.Owner), purTestRaw(t, purTestID, "confirmed"))
	purTestError(t, value, e, "Owner/admin approval required for current purchase content")
	value, e = s.transitionPurchase(context.Background(), purTestActor(t, erpwire.Owner), purTestRaw(t, purTestID, "sent"))
	purTestError(t, value, e, "Invalid purchase transition")
	if len(store.calls) != 1 {
		t.Fatal("invalid transition called store")
	}
}
func TestPurchaseCrossOrgReadsAndBillPayment(t *testing.T) {
	foreign := erpwire.Row{"org_id": purTestOther, "id": purTestID, "vendor_id": purTestLine, "paid_at": nil, "bill_number": "secret"}
	store := &purTestStore{t: t, tables: map[string][]erpwire.Row{"vendors": {{"org_id": purTestOther, "id": purTestID, "name": "secret"}}, "purchase_orders": {{"org_id": purTestOther, "id": purTestID}}, "costs": {foreign}}}
	s, _ := New(Options{Store: store})
	actor := purTestActor(t, erpwire.Owner)
	for _, fn := range []erpwire.Operation{s.vendorDetailOperation, s.purchaseDetailOperation} {
		_, e := fn(context.Background(), actor, purTestRaw(t, purTestID))
		if !errors.Is(e, erpwire.ErrNotFound) {
			t.Fatalf("foreign detail visible %v", e)
		}
	}
	value, e := s.markBillPaid(context.Background(), actor, purTestRaw(t, purTestID))
	if e != nil {
		t.Fatal(e)
	}
	if foreign["paid_at"] != nil || len(value.(erpwire.ActionResponse).Refresh) != 0 || len(store.tables["audit_log"]) != 0 {
		t.Fatal("foreign bill changed")
	}
}
func TestPurchaseMoneyBoundariesAndCumulativeRounding(t *testing.T) {
	for _, test := range []struct {
		name, quantity string
		cost           int64
		want           money.Satang
		valid          bool
	}{{"half satang", "0.5", 1, 1, true}, {"less than half", "0.499", 1, 0, true}, {"safe maximum", "1", int64(money.MaxSafeSatang), money.MaxSafeSatang, true}, {"fractional maximum", "0.001", int64(money.MaxSafeSatang), 9007199254741, true}, {"overflow", "2", int64(money.MaxSafeSatang), 0, false}, {"quantity overflow", "1000000000", 1, 0, false}, {"extra decimals", "0.0001", 1, 0, false}, {"zero line", "0", 1, 0, false}} {
		t.Run(test.name, func(t *testing.T) {
			got, e := purchaseLineAmount(test.quantity, test.cost)
			if (e == nil) != test.valid || (test.valid && got != test.want) {
				t.Fatalf("got %d,%v want %d valid=%v", got, e, test.want, test.valid)
			}
		})
	}
	amount, billable, e := purchaseBillAmount([]erpwire.Row{{"received_quantity": "1", "returned_quantity": "0", "billed_quantity": "0.5", "unit_cost_satang": int64(1)}})
	if e != nil || amount != 0 || !billable {
		t.Fatalf("cumulative rounding got %d,%v,%v", amount, billable, e)
	}
	_, e = purchaseTotal([]erpwire.Row{{"quantity": "1", "unit_cost_satang": int64(money.MaxSafeSatang)}, {"quantity": "1", "unit_cost_satang": int64(1)}})
	if e == nil {
		t.Fatal("unsafe total accepted")
	}
}
func TestPurchaseReceiptValidationAndCompleteSnapshot(t *testing.T) {
	lines := []erpwire.Row{{"id": purTestLine, "quantity": "1.001", "received_quantity": "0.5"}, {"id": purTestKey, "quantity": "2", "received_quantity": "0"}}
	for _, test := range []struct{ name, current, previous, tolerance, want string }{{"allowed", "1.101", "0.5", "10", ""}, {"exceeds", "1.102", "0.5", "10", "Received total must be between the previous receipt and the allowed receipt quantity"}, {"stale", "1", "0", "0", "Receipt changed, reload"}, {"lower", "0.499", "0.5", "0", "Received total must be between the previous receipt and the allowed receipt quantity"}, {"invalid policy", "1", "0.5", "100.01", "Invalid receipt tolerance"}} {
		t.Run(test.name, func(t *testing.T) {
			result, e := purchaseApplyReceipt(lines, []erpwire.Row{{"id": purTestLine, "received_quantity": test.current, "previous_received_quantity": test.previous}}, test.tolerance)
			if test.want != "" {
				if e == nil || e.Error() != test.want {
					t.Fatalf("got %v want %q", e, test.want)
				}
				return
			}
			if e != nil || len(result) != 2 || result[1]["received_quantity"] != "0" || result[1]["previous_received_quantity"] != "0" {
				t.Fatalf("incomplete snapshot %#v %v", result, e)
			}
			if text(lines[0]["received_quantity"]) != "0.5" {
				t.Fatal("input mutated")
			}
		})
	}
	_, e := purchaseApplyReceipt(lines, []erpwire.Row{{"id": purTestLine, "received_quantity": "1", "previous_received_quantity": "0.5"}, {"id": purTestLine, "received_quantity": "1", "previous_received_quantity": "0.5"}}, "0")
	if e == nil || e.Error() != "Unknown or duplicate receipt line" {
		t.Fatalf("duplicate accepted %v", e)
	}
}
func TestPurchaseValidationErrorsBeforeStore(t *testing.T) {
	for _, test := range []struct {
		op   string
		args []any
		want string
	}{{"createPurchase", []any{map[string]any{}}, "Invalid purchase details"}, {"receivePurchase", []any{purTestID, []any{}}, "Invalid receipt"}, {"returnPurchase", []any{purTestID, []any{}}, "Invalid return"}, {"createPurchaseBill", []any{purTestID, map[string]any{}}, "Invalid vendor bill details"}, {"linkVendorCredit", []any{purTestID, map[string]any{}}, "Invalid vendor credit details"}, {"updateBillTolerance", []any{10001}, "Tolerance must be between 0 and 100 percent"}, {"reopenPurchaseRFQ", []any{purTestID, purTestKey, false}, "Verify non-delivery before reopening this RFQ"}} {
		t.Run(test.op, func(t *testing.T) {
			store := &purTestStore{t: t}
			s, _ := New(Options{Store: store})
			v, e := s.Operations()["app/(app)/purchases/actions.ts::"+test.op](context.Background(), purTestActor(t, erpwire.Owner), purTestRaw(t, test.args...))
			purTestError(t, v, e, test.want)
			if store.reads+store.writes != 0 {
				t.Fatal("invalid input reached store")
			}
		})
	}
}
func TestVendorInputExactBoundaries(t *testing.T) {
	base := func() erpwire.Row {
		return erpwire.Row{"name": "  ร้านค้า  ", "tax_id": " ", "email": "", "phone": "", "address": "", "payment_terms_days": "3650", "notes": "", "active": true}
	}
	valid := base()
	row, ok := purchaseVendorInput(valid)
	if !ok || row["name"] != "ร้านค้า" || row["tax_id"] != nil || row["payment_terms_days"] != int64(3650) {
		t.Fatalf("bad normalization %#v", row)
	}
	for _, test := range []struct {
		key   string
		value any
	}{{"name", strings.Repeat("😀", 101)}, {"payment_terms_days", "3651"}, {"email", " name@example.com "}, {"active", "true"}, {"notes", nil}} {
		input := base()
		input[test.key] = test.value
		if _, ok := purchaseVendorInput(input); ok {
			t.Fatalf("invalid %s accepted", test.key)
		}
	}
}

type purTestEmail struct {
	configured bool
	messages   []EmailMessage
	result     EmailResult
	err        error
}

func (m *purTestEmail) Configured() bool { return m.configured }
func (m *purTestEmail) SendEmail(_ context.Context, message EmailMessage) (EmailResult, error) {
	m.messages = append(m.messages, message)
	return m.result, m.err
}
func purTestClaim(t *testing.T) json.RawMessage {
	t.Helper()
	raw, e := json.Marshal(erpwire.Row{"delivery_key": purTestKey, "snapshot": erpwire.Row{"to": "vendor@example.com", "number": "PO-1", "vendorName": "<ร้านค้า>", "orderDate": "2026-11-08", "expectedDate": nil, "notes": "<script>", "lines": []erpwire.Row{{"description": "A&B", "quantity": json.Number("0.5"), "unit": "piece", "unit_cost_satang": int64(1)}}, "sections": []erpwire.Row{{"id": purTestLine, "kind": "section", "description": "Header", "lines_before": int64(0), "position": int64(0)}}}})
	if e != nil {
		t.Fatal(e)
	}
	return raw
}
func TestPurchaseRFQClaimPreventsRepeatAndKeepsExactSnapshot(t *testing.T) {
	mail := &purTestEmail{configured: true, result: EmailResult{OK: true}}
	claim := purTestClaim(t)
	claimed := false
	store := &purTestStore{t: t, command: func(name string, row erpwire.Row) (json.RawMessage, error) {
		if name == "claim_purchase_rfq" {
			if claimed {
				return json.RawMessage(`null`), nil
			}
			claimed = true
			return claim, nil
		}
		if name == "finish_purchase_rfq" {
			if row["p_delivery_key"] != purTestKey || row["p_error"] != nil {
				t.Fatalf("finish %#v", row)
			}
			return json.RawMessage(`null`), nil
		}
		t.Fatalf("unexpected command %s", name)
		return nil, nil
	}}
	s, _ := New(Options{Store: store, EmailSender: mail})
	actor := purTestActor(t, erpwire.Owner)
	value, e := s.sendPurchaseRFQ(context.Background(), actor, purTestRaw(t, purTestID))
	if e != nil || len(value.(erpwire.ActionResponse).Refresh) != 2 {
		t.Fatalf("RFQ failed %#v %v", value, e)
	}
	if len(mail.messages) != 1 {
		t.Fatalf("mail count %d", len(mail.messages))
	}
	message := mail.messages[0]
	if message.To != "vendor@example.com" || message.Subject != "Request for quotation PO-1" || message.IdempotencyKey != "purchase-rfq/"+purTestKey {
		t.Fatalf("message %#v", message)
	}
	for _, fragment := range []string{"&lt;ร้านค้า&gt;", "A&amp;B", "฿0.01", "&lt;script&gt;"} {
		if !strings.Contains(message.HTML, fragment) {
			t.Fatalf("email missing %s in %s", fragment, message.HTML)
		}
	}
	if strings.Index(message.HTML, "Header") > strings.Index(message.HTML, "A&amp;B") {
		t.Fatal("section after priced line")
	}
	value, e = s.sendPurchaseRFQ(context.Background(), actor, purTestRaw(t, purTestID))
	purTestError(t, value, e, "RFQ has already been claimed or the order is no longer draft. Delivery will not be repeated.")
	if len(mail.messages) != 1 {
		t.Fatal("repeat delivery")
	}
}
func TestPurchaseRFQDeliveryRecoveryErrors(t *testing.T) {
	for _, test := range []struct {
		name      string
		result    EmailResult
		finishErr error
		want      string
	}{{"provider failure", EmailResult{Error: "Rejected"}, nil, "Rejected. The RFQ remains frozen for delivery verification; print it if needed."}, {"accepted finish fails", EmailResult{OK: true}, errors.New("storage failed"), "Email accepted. Delivery status could not be saved; verify delivery before recovery."}, {"not configured after claim", EmailResult{Reason: "not_configured"}, nil, "Email is not configured. The RFQ remains frozen for delivery verification; print it if needed."}} {
		t.Run(test.name, func(t *testing.T) {
			mail := &purTestEmail{configured: true, result: test.result}
			store := &purTestStore{t: t, command: func(name string, _ erpwire.Row) (json.RawMessage, error) {
				if name == "claim_purchase_rfq" {
					return purTestClaim(t), nil
				}
				return json.RawMessage(`null`), test.finishErr
			}}
			s, _ := New(Options{Store: store, EmailSender: mail})
			value, e := s.sendPurchaseRFQ(context.Background(), purTestActor(t, erpwire.Owner), purTestRaw(t, purTestID))
			purTestError(t, value, e, test.want)
			if len(mail.messages) != 1 || len(store.calls) != 2 {
				t.Fatalf("wrong delivery lifecycle mails=%d commands=%d", len(mail.messages), len(store.calls))
			}
		})
	}
}
func TestPurchaseBillAndCreditSchemaNormalizeAndReject(t *testing.T) {
	input := erpwire.Row{"vendor_reference": " V-1 ", "bill_date": "2026-11-08", "due_date": "2026-11-09", "input_vat_rate": json.Number("7"), "input_vat_satang": json.Number("1"), "vendor_total_satang": json.Number("10"), "variance_reason": " note ", "lines": []any{map[string]any{"id": purTestLine, "quantity": "0.5", "expected_quantity": json.Number("0.5"), "unit_cost_satang": json.Number("1")}}}
	row, ok := purchaseBillInput(input)
	if !ok || row["vendor_reference"] != "V-1" || row["variance_reason"] != "note" {
		t.Fatalf("valid bill rejected %#v", row)
	}
	for _, test := range []struct {
		key   string
		value any
	}{{"due_date", "2026-11-07"}, {"input_vat_rate", json.Number("7.001")}, {"input_vat_satang", json.Number("11")}, {"vendor_total_satang", json.Number("9007199254740992")}} {
		copy := erpwire.Row{}
		for k, v := range input {
			copy[k] = v
		}
		copy[test.key] = test.value
		if _, ok := purchaseBillInput(copy); ok {
			t.Fatalf("invalid %s accepted", test.key)
		}
	}
	credit := erpwire.Row{"vendor_reference": " CREDIT ", "bill_date": "2026-11-08", "input_vat_satang": json.Number("0"), "original_bill_id": purTestID, "lines": []any{map[string]any{"id": purTestLine, "quantity": "0.5"}}}
	row, ok = purchaseCreditInput(credit)
	if !ok {
		t.Fatal("legacy credit shape rejected")
	}
	allocations := row["allocations"].([]erpwire.Row)
	if len(allocations) != 1 || allocations[0]["original_bill_id"] != purTestID || row["variance_reason"] != "" {
		t.Fatalf("credit transform %#v", row)
	}
	credit["cost_ids"] = []any{purTestID, strings.ToUpper(purTestID)}
	if _, ok := purchaseCreditInput(credit); ok {
		t.Fatal("duplicate cost IDs accepted")
	}
}

type purTestPDF struct {
	kind  string
	model erpwire.Row
}

func (p *purTestPDF) RenderPDF(_ context.Context, kind string, model erpwire.Row) ([]byte, error) {
	p.kind = kind
	p.model = model
	return []byte("rendered"), nil
}
func TestPurchasePDFExactModelAndHTMLContract(t *testing.T) {
	renderer := &purTestPDF{}
	store := &purTestStore{t: t, tables: map[string][]erpwire.Row{"purchase_orders": {{"org_id": purTestOrg, "id": purTestID, "status": "sent", "number": "PO-1", "order_date": "2026-11-08", "vendors": map[string]any{"name": "ร้านค้า", "address": "Bangkok", "tax_id": "123"}}}, "purchase_order_items": {{"org_id": purTestOrg, "id": purTestLine, "purchase_order_id": purTestID, "description": "Product", "unit": "pc", "quantity": json.Number("0.5"), "unit_cost_satang": int64(1)}}}}
	s, _ := New(Options{Store: store, PDFRenderer: renderer})
	value, e := s.purchasePDF(context.Background(), purTestActor(t, erpwire.Member), purTestRaw(t, purTestID))
	if e != nil {
		t.Fatal(e)
	}
	route := value.(RouteResponse)
	if route.Status != 200 || route.Headers["Content-Type"] != "text/html; charset=utf-8" || route.Headers["Cache-Control"] != "private, no-store" || string(route.Body) != "rendered" {
		t.Fatalf("bad route %#v", route)
	}
	if renderer.kind != "purchase_order" || renderer.model["kind"] != "Request for quotation" || renderer.model["clientName"] != "ร้านค้า" || renderer.model["totalSatang"] != money.Satang(1) {
		t.Fatalf("wrong PDF model %#v", renderer.model)
	}
	items := renderer.model["items"].([]erpwire.Row)
	if len(items) != 1 || items[0]["amount_satang"] != money.Satang(1) || items[0]["description"] != "Product (pc)" {
		t.Fatalf("wrong PDF lines %#v", items)
	}
}
func TestPurchaseBillPaidRetryAndToleranceUpsert(t *testing.T) {
	bill := erpwire.Row{"org_id": purTestOrg, "id": purTestID, "vendor_id": purTestLine, "purchase_order_id": purTestKey, "bill_number": "B-1", "paid_at": nil}
	settings := erpwire.Row{"org_id": purTestOrg, "public_document_refs_enabled": true, "bill_variance_tolerance_bps": int64(100)}
	store := &purTestStore{t: t, tables: map[string][]erpwire.Row{"costs": {bill}, "org_settings": {settings}}}
	s, _ := New(Options{Store: store})
	actor := purTestActor(t, erpwire.Owner)
	for range 2 {
		_, e := s.markBillPaid(context.Background(), actor, purTestRaw(t, purTestID))
		if e != nil {
			t.Fatal(e)
		}
	}
	if text(bill["paid_at"]) == "" || len(store.tables["audit_log"]) != 1 {
		t.Fatalf("non-idempotent paid %#v %#v", bill, store.tables["audit_log"])
	}
	_, e := s.updateBillTolerance(context.Background(), actor, purTestRaw(t, 321))
	if e != nil {
		t.Fatal(e)
	}
	if len(store.tables["org_settings"]) != 1 || settings["bill_variance_tolerance_bps"] != int64(321) || settings["public_document_refs_enabled"] != true {
		t.Fatalf("destructive settings upsert %#v", store.tables["org_settings"])
	}
}
