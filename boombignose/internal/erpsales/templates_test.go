package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestTemplateMoneyRoundingAndBounds(t *testing.T) {
	for _, test := range []struct {
		input any
		want  money.Satang
		valid bool
	}{{"1.005", 101, true}, {"1.004", 100, true}, {json.Number("1e-2"), 1, true}, {"0x10", 1600, true}, {"", 0, true}, {true, 100, true}, {"90071992547409.91", money.MaxSafeSatang, true}, {"90071992547409.915", 0, false}, {"-0.001", 0, false}, {"Infinity", 0, false}, {"1/2", 0, false}} {
		v, ok := templateMoney(test.input)
		if ok != test.valid || ok && v != test.want {
			t.Fatalf("%#v => %d,%v want %d,%v", test.input, v, ok, test.want, test.valid)
		}
	}
}
func TestTemplateCreateNormalizeEditAndCrossOrgIsolation(t *testing.T) {
	f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"automation_templates": {{"org_id": salesTestForeign, "id": salesTestID, "name": "Private"}}}}
	s, _ := New(Options{Store: f})
	owner := salesTestActor(t, erpwire.Owner)
	payload := erpwire.Row{"name": "  ตัวอย่าง  ", "categoryId": nil, "internalValueBaht": "1.005", "priceBaht": "0.01", "description": "  ", "reusableNotes": " ทำซ้ำ ", "implementationChecklist": []any{" เริ่ม ", "", " จบ "}, "tags": []any{" tag ", " "}}
	v, e := s.createTemplate(context.Background(), owner, salesTestRaw(t, payload))
	if e != nil {
		t.Fatal(e)
	}
	if v.(erpwire.ActionResponse).Redirect != "/templates/"+salesTestID {
		t.Fatal(v)
	}
	row := f.tables["automation_templates"][1]
	if row["name"] != "ตัวอย่าง" || row["internal_value_satang"] != int64(101) || row["price_satang"] != int64(1) || row["description"] != nil || !reflect.DeepEqual(row["implementation_checklist"], []string{"เริ่ม", "จบ"}) {
		t.Fatalf("wrong template %#v", row)
	}
	v, e = s.updateTemplate(context.Background(), owner, salesTestRaw(t, salesTestID, erpwire.Row{"name": "New"}))
	if e != nil {
		t.Fatal(e)
	}
	if f.tables["automation_templates"][0]["name"] != "Private" || f.tables["automation_templates"][1]["name"] != "New" {
		t.Fatal("template crossed tenant boundary")
	}
	_, e = s.deleteTemplate(context.Background(), owner, salesTestRaw(t, salesTestID))
	if e != nil || len(f.tables["automation_templates"]) != 1 || f.tables["automation_templates"][0]["name"] != "Private" {
		t.Fatalf("foreign template deleted %v", e)
	}
	v, e = s.updateTemplate(context.Background(), owner, salesTestRaw(t, salesTestID, erpwire.Row{"name": "New"}))
	salesTestError(t, v, e, "Template not found or unavailable.")
	_, e = s.templatePage(context.Background(), owner, salesTestRaw(t, salesTestID))
	if !errors.Is(e, erpwire.ErrNotFound) {
		t.Fatal("foreign template read")
	}
}
func TestTemplateCapabilityAndValidationErrors(t *testing.T) {
	member := salesTestActor(t, erpwire.Member)
	f := &salesTestStore{t: t}
	s, _ := New(Options{Store: f})
	for _, test := range []struct {
		op   erpwire.Operation
		args []any
		want string
	}{{s.createTemplate, []any{erpwire.Row{}}, "Only owners and admins can manage templates."}, {s.updateTemplate, []any{salesTestID, erpwire.Row{}}, "Only owners and admins can manage templates."}, {s.deleteTemplate, []any{salesTestID}, "Only owners and admins can delete templates."}, {s.createCategory, []any{erpwire.Row{}}, "Only owners and admins can manage template categories."}} {
		v, e := test.op(context.Background(), member, salesTestRaw(t, test.args...))
		salesTestError(t, v, e, test.want)
	}
	if f.reads+f.writes != 0 {
		t.Fatal("denied template call accessed store")
	}
	for _, test := range []struct{ name, want string }{{"", "Invalid input"}, {"ภาษาไทย", "Name must contain letters or numbers"}, {"  !!!  ", "Name must contain letters or numbers"}} {
		v, e := s.createCategory(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"name": test.name}))
		salesTestError(t, v, e, test.want)
	}
	v, e := s.createCategory(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"name": " Thai & Sales 2026 "}))
	if e != nil {
		t.Fatal(e)
	}
	_ = v
	if row := f.tables["template_categories"][0]; row["name"] != "Thai & Sales 2026" || row["slug"] != "thai-sales-2026" {
		t.Fatalf("bad slug %#v", row)
	}
}

type salesTestPDF struct {
	kind  string
	model erpwire.Row
	calls int
}

func (f *salesTestPDF) RenderPDF(_ context.Context, kind string, model erpwire.Row) ([]byte, error) {
	f.calls++
	f.kind = kind
	f.model = model
	return []byte("<html>print</html>"), nil
}
func TestQuotePDFModelAndFailures(t *testing.T) {
	f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestOrg, "id": salesTestID, "number": "Q1", "status": "sent", "subtotal_satang": int64(9007199254740991), "discount_satang": int64(0), "total_satang": int64(9007199254740991), "issue_date": "2026-11-08", "valid_until": "2026-11-30", "clients": erpwire.Row{"name": "ลูกค้า"}}}, "quote_items": {{"org_id": salesTestOrg, "id": salesTestKey, "quote_id": salesTestID, "description": "งาน", "quantity": json.Number("0.001"), "unit_price_satang": int64(1), "amount_satang": int64(0), "unit": "ชิ้น"}}}}
	renderer := &salesTestPDF{}
	s, _ := New(Options{Store: f, PDFRenderer: renderer})
	v, e := s.quotePDF(context.Background(), salesTestActor(t, erpwire.Member), salesTestRaw(t, salesTestID))
	if e != nil {
		t.Fatal(e)
	}
	r := v.(RouteResponse)
	if r.Status != 200 || r.Headers["Content-Type"] != "text/html; charset=utf-8" || string(r.Body) != "<html>print</html>" || renderer.kind != "quote" || renderer.model["kind"] != "Quotation" || renderer.model["clientName"] != "ลูกค้า" || renderer.model["totalSatang"] != int64(9007199254740991) {
		t.Fatalf("wrong printable model %#v %#v", r, renderer.model)
	}
	f.selectError = map[string]error{"quote_items": errors.New("database secret")}
	v, e = s.quotePDF(context.Background(), salesTestActor(t, erpwire.Member), salesTestRaw(t, salesTestID))
	if e != nil || v.(RouteResponse).Status != 503 || string(v.(RouteResponse).Body) != "Quote details unavailable" || renderer.calls != 1 {
		t.Fatalf("partial PDF %v %#v", e, v)
	}
}

type salesTestMail struct {
	messages   []EmailMessage
	result     EmailResult
	configured bool
}

func (f *salesTestMail) Configured() bool { return f.configured }
func (f *salesTestMail) SendEmail(_ context.Context, m EmailMessage) (EmailResult, error) {
	f.messages = append(f.messages, m)
	return f.result, nil
}
func TestQuoteEmailUnconfiguredAndSuccessful(t *testing.T) {
	f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestOrg, "id": salesTestID, "client_id": salesTestKey, "number": "Q<&", "total_satang": int64(1), "clients": erpwire.Row{"name": "ร้าน"}}}, "contacts": {{"org_id": salesTestOrg, "id": salesTestID, "client_id": salesTestKey, "email": "client@example.test"}}}}
	mail := &salesTestMail{}
	s, _ := New(Options{Store: f, EmailSender: mail, AppURL: "https://erp.example.test"})
	v, e := s.sendQuoteEmail(context.Background(), salesTestActor(t, erpwire.Member), salesTestRaw(t, salesTestID))
	if e != nil || !reflect.DeepEqual(v.(erpwire.ActionResponse).Value, erpwire.Row{"ok": false, "reason": "not_configured"}) || len(mail.messages) != 0 || f.writes != 0 {
		t.Fatalf("bad email degrade %#v %v", v, e)
	}
	mail.configured = true
	mail.result = EmailResult{OK: true}
	v, e = s.sendQuoteEmail(context.Background(), salesTestActor(t, erpwire.Member), salesTestRaw(t, salesTestID))
	if e != nil || v.(erpwire.ActionResponse).Value.(erpwire.Row)["ok"] != true || len(mail.messages) != 1 || mail.messages[0].Subject != "Quote Q<&" || f.tables["activities"][0]["body"] != "Sent quote Q<& (฿0.01) to client@example.test" || len(f.tables["audit_log"]) != 1 {
		t.Fatalf("email failed %#v %v", v, e)
	}
}
func TestFacetsPeriodsAndSavedViewNormalization(t *testing.T) {
	if salesMonthKey("2026-10-31T18:00:00Z") != "2026-11" {
		t.Fatal("month grouping ignored Bangkok midnight")
	}
	a := salesTestActor(t, erpwire.Member)
	f := salesParseFacets(erpwire.Row{"q": " ร้าน ", "status": "accepted,draft,unknown", "period": "this_month", "mine": "1", "groupBy": "client"}, "quotes")
	if f.Q != "ร้าน" || f.Status != "draft,accepted" || f.GroupBy != "client" {
		t.Fatalf("wrong facets %#v", f)
	}
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.FixedZone("Asia/Bangkok", 7*3600))
	if !salesMatches(f, erpwire.Row{"owner": a.UserID(), "status": "draft"}, "ร้าน", "2026-10-31T18:00:00Z", a, now) {
		t.Fatal("Bangkok month ignored")
	}
	if salesMatches(f, erpwire.Row{"owner": a.UserID(), "status": "sent"}, "ร้าน", "2026-11-01", a, now) {
		t.Fatal("status filter ignored")
	}
	rows := []erpwire.Row{{"total": int64(money.MaxSafeSatang)}, {"total": int64(1)}}
	if _, e := salesGroups(rows, nil, "total"); e == nil {
		t.Fatal("group overflow ignored")
	}
	if g, e := salesGroups(nil, nil, "total"); e != nil || len(g) != 0 {
		t.Fatal("empty groups changed")
	}
}
func TestNumericInputsPreserveIntegerAndFractionSemantics(t *testing.T) {
	for _, test := range []struct{ raw, want string }{{"1.0", "1"}, {"1e2", "100"}, {"1e-2", "0.01"}, {"0.00100", "0.001"}, {"-0.000", "0"}, {"9007199254740991", "9007199254740991"}} {
		got, ok := numberText(json.Number(test.raw))
		if !ok || got != test.want {
			t.Fatalf("%s => %q,%v", test.raw, got, ok)
		}
	}
	if v, e := integer(json.Number("1e2")); e != nil || v != 100 {
		t.Fatal("integer numeric exponent rejected")
	}
	if _, e := integer(json.Number("1.1")); e == nil {
		t.Fatal("fraction accepted as integer")
	}
}
