package erpinvoicing

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

func documentFixture() erpwire.Row {
	return erpwire.Row{
		"version":  1,
		"seller":   erpwire.Row{"legalName": "ร้านเดิม", "address": "ที่อยู่เดิม", "taxId": nil, "taxStatus": "unknown"},
		"buyer":    erpwire.Row{"id": "client", "name": "ลูกค้าเดิม", "address": "ที่อยู่ลูกค้า", "taxId": nil},
		"document": erpwire.Row{"number": "INV-FROZEN", "issueDate": "2026-01-01", "dueDate": "2026-02-01", "notes": "frozen", "subtotalSatang": 10001, "discountSatang": 1000, "totalSatang": 9001},
		"lines":    []erpwire.Row{{"description": "งานเดิม", "quantity": 1, "unitPriceSatang": 10001, "amountSatang": 10001, "position": 0}},
	}
}
func TestIssuedDocumentSnapshot(t *testing.T) {
	snapshot := documentFixture()
	parsed, e := parseIssuedSnapshot(snapshot, "partially_paid", 1001, 2000, false)
	if e != nil {
		t.Fatal(e)
	}
	doc := parsed.doc
	if doc.OrgName != "ร้านเดิม" || doc.ClientName != "ลูกค้าเดิม" || doc.TotalSatang != 9001 || doc.DiscountSatang != 1000 || doc.OutstandingSatang == nil || *doc.OutstandingSatang != 6000 || doc.SellerAddress == nil || *doc.SellerAddress != "ที่อยู่เดิม" || doc.Items[0].AmountSatang != 10001 {
		t.Fatalf("snapshot fields changed: %#v", doc)
	}
	if doc.Items[0].Unit != nil {
		t.Fatal("invented missing unit")
	}
	for _, unit := range []any{nil, "hour", strings.Repeat(" ", 40) + "hour" + strings.Repeat(" ", 40)} {
		fixture := documentFixture()
		objectLines := fixture["lines"].([]erpwire.Row)
		objectLines[0]["unit"] = unit
		parsed, e := parseIssuedSnapshot(fixture, "sent", 0, 0, false)
		if e != nil {
			t.Fatal(e)
		}
		if unit == nil {
			if parsed.doc.Items[0].Unit != nil {
				t.Fatal("invented null unit")
			}
		} else if parsed.doc.Items[0].Unit == nil || *parsed.doc.Items[0].Unit != unit {
			t.Fatalf("unit changed: %#v", parsed.doc.Items[0])
		}
	}
}

func TestIssuedSnapshotRejectsCorruption(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(erpwire.Row)
	}{
		{"version", func(s erpwire.Row) { s["version"] = 2 }},
		{"string version", func(s erpwire.Row) { s["version"] = "1" }},
		{"empty lines", func(s erpwire.Row) { s["lines"] = []erpwire.Row{} }},
		{"null lines", func(s erpwire.Row) { s["lines"] = nil }},
		{"missing buyer field", func(s erpwire.Row) { delete(object(s["buyer"]), "taxId") }},
		{"string amount", func(s erpwire.Row) { object(s["document"])["totalSatang"] = "9001" }},
		{"unsafe amount", func(s erpwire.Row) { object(s["document"])["totalSatang"] = money.MaxSafeSatang + 1 }},
		{"inconsistent total", func(s erpwire.Row) { object(s["document"])["totalSatang"] = 9002 }},
		{"decimal amount", func(s erpwire.Row) { object(s["document"])["totalSatang"] = json.Number("9001.01") }},
		{"negative quantity", func(s erpwire.Row) { s["lines"].([]erpwire.Row)[0]["quantity"] = -1 }},
		{"quantity bound", func(s erpwire.Row) { s["lines"].([]erpwire.Row)[0]["quantity"] = json.Number("1000000000") }},
		{"invalid wht", func(s erpwire.Row) { object(s["document"])["whtRateBps"] = 400 }},
		{"malformed tax invoice", func(s erpwire.Row) {
			s["taxInvoice"] = erpwire.Row{"docType": "TX", "branchCode": "12", "copyLabel": "ต้นฉบับ"}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := documentFixture()
			tc.mutate(s)
			if _, e := parseIssuedSnapshot(s, "sent", 0, 0, false); e == nil {
				t.Fatal("corrupted issued snapshot accepted")
			}
		})
	}
}

func TestTaxInvoiceCopyAndAbbreviation(t *testing.T) {
	for _, kind := range []string{"TX", "ABB"} {
		for _, copy := range []bool{false, true} {
			snapshot := documentFixture()
			snapshot["taxInvoice"] = erpwire.Row{"docType": kind, "branchCode": "00000", "copyLabel": "ต้นฉบับ"}
			buyer := object(snapshot["buyer"])
			buyer["taxId"] = "9876543210123"
			parsed, e := parseIssuedSnapshot(snapshot, "sent", 0, 0, copy)
			if e != nil {
				t.Fatal(e)
			}
			doc := parsed.doc
			label := "ต้นฉบับ"
			if copy {
				label = "สำเนา"
			}
			if doc.TaxInvoice == nil || doc.TaxInvoice.CopyLabel != label || doc.TaxInvoice.BranchCode != "00000" {
				t.Fatalf("copy label lost: %#v", doc)
			}
			if kind == "ABB" {
				if doc.BuyerAddress != nil || doc.BuyerTaxID != nil || doc.Kind != "Abbreviated Tax Invoice / ใบกำกับภาษีอย่างย่อ" {
					t.Fatalf("abbreviated buyer data exposed: %#v", doc)
				}
			} else if doc.BuyerTaxID == nil || *doc.BuyerTaxID != "9876543210123" || doc.Kind != "Tax Invoice / ใบกำกับภาษี" {
				t.Fatalf("full invoice changed: %#v", doc)
			}
		}
	}
}

func TestLegacySnapshotKeepsFrozenHeaders(t *testing.T) {
	snapshot := documentFixture()
	snapshot["kind"] = "legacy_operational_invoice"
	snapshot["lines"] = []erpwire.Row{}
	d := object(snapshot["document"])
	d["subtotalSatang"] = 30000
	d["discountSatang"] = 2000
	d["totalSatang"] = 29000
	d["vatSatang"] = 1000
	d["whtSatang"] = 3000
	d["whtRateBps"] = 300
	d["amountDueSatang"] = 26000
	d["vatByRate"] = []erpwire.Row{{"rateBps": 700, "baseSatang": 25000, "vatSatang": 1750}}
	parsed, e := parseIssuedSnapshot(snapshot, "partially_paid", 6000, 0, false)
	if e != nil {
		t.Fatal(e)
	}
	doc := parsed.doc
	if !parsed.legacy || len(doc.Items) != 0 || doc.TotalSatang != 29000 || doc.VATSatang != 1000 || doc.WHTSatang != 3000 || doc.AmountDueSatang != 26000 || doc.OutstandingSatang == nil || *doc.OutstandingSatang != 20000 || len(doc.VATByRate) != 1 {
		t.Fatalf("legacy header recomputed: %#v", doc)
	}
}

func creditDocumentFixture() erpwire.Row {
	return erpwire.Row{"version": 1, "kind": "credit_note", "originalNumber": "INV-2026-001", "seller": erpwire.Row{"legalName": "ผู้ขาย", "address": "ที่อยู่", "taxId": nil, "vatRegistered": true}, "buyer": erpwire.Row{"name": "ผู้ซื้อ", "address": nil, "taxId": nil}, "document": erpwire.Row{"number": "CN-2026-001", "issueDate": "2026-01-02", "reason": "corrected", "baseSatang": 9000, "vatSatang": 630, "totalSatang": 9630, "whtSatang": 270, "amountDueSatang": 9360, "pricesIncludeVat": false, "whtRateBps": 300, "vatByRate": []erpwire.Row{{"rateBps": 700, "baseSatang": 9000, "vatSatang": 630}}}, "lines": []erpwire.Row{{"description": "คืนสินค้า", "quantity": 1, "unit": "ชิ้น", "unitPriceSatang": 10000, "amountSatang": 10000}}}
}
func TestCreditDocumentTotals(t *testing.T) {
	doc, e := parseCreditDocument(creditDocumentFixture())
	if e != nil {
		t.Fatal(e)
	}
	if doc.Kind != "Tax credit note / ใบลดหนี้" || doc.OriginalNumber != "INV-2026-001" || doc.SubtotalSatang != 10000 || doc.DiscountSatang != 1000 || doc.TotalSatang != 9630 || doc.AmountDueSatang != 9360 {
		t.Fatalf("credit totals changed: %#v", doc)
	}
	for _, field := range []string{"totalSatang", "vatSatang", "amountDueSatang"} {
		s := creditDocumentFixture()
		object(s["document"])[field] = 1
		if _, e := parseCreditDocument(s); e == nil {
			t.Fatalf("invalid credit %s accepted", field)
		}
	}
}

type documentTestStore struct {
	t         *testing.T
	tables    map[string][]erpwire.Row
	failTable string
	failure   error
	reads     int
}

func (d *documentTestStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	d.reads++
	return fn(d)
}
func (d *documentTestStore) Write(context.Context, erpwire.Actor, func(erpwire.WriteTx) error) error {
	d.t.Fatal("document route attempted a write")
	return nil
}
func (d *documentTestStore) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	d.t.Fatal("unexpected document RPC")
	return nil, nil
}
func (d *documentTestStore) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	if q.Table == d.failTable {
		return erpwire.Selection{}, d.failure
	}
	hasOrg := false
	for _, p := range q.Where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == documentOrg {
			hasOrg = true
		}
	}
	if !hasOrg {
		d.t.Fatalf("unscoped document read: %#v", q)
	}
	rows := []erpwire.Row{}
	for _, row := range d.tables[q.Table] {
		match := true
		for _, p := range q.Where {
			if p.Op != erpwire.Equal {
				d.t.Fatalf("unexpected document filter: %#v", p)
			}
			if !reflect.DeepEqual(row[p.Column], p.Value) {
				match = false
			}
		}
		if match {
			rows = append(rows, row)
		}
	}
	return erpwire.Selection{Rows: rows}, nil
}

type documentTestRenderer struct {
	model DocumentModel
	calls int
}

func (r *documentTestRenderer) Render(_ context.Context, model DocumentModel) (RenderedDocument, error) {
	r.calls++
	r.model = model
	return RenderedDocument{Body: []byte("<html>rendered</html>"), ContentType: "text/html; charset=utf-8"}, nil
}

const documentOrg = "10000000-0000-4000-8000-000000000001"
const documentID = "20000000-0000-4000-8000-000000000002"

func documentActor(t *testing.T) erpwire.Actor {
	t.Helper()
	user := "30000000-0000-4000-8000-000000000003"
	actor, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: user, Email: "test@example.invalid", Assurance: erpwire.AAL1, ExpiresAt: time.Now().Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: user, OrgID: documentOrg, OrgName: "LIVE NAME", Role: erpwire.Member}, false, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	return actor
}
func documentRouteInput(t *testing.T) json.RawMessage {
	t.Helper()
	raw, e := json.Marshal([]any{erpwire.Row{"params": erpwire.Row{"id": documentID}, "searchParams": erpwire.Row{"copy": "1"}}})
	if e != nil {
		t.Fatal(e)
	}
	return raw
}
func TestDocumentRoutesDenyUnauthenticatedActors(t *testing.T) {
	store := &documentTestStore{t: t}
	service, e := New(Options{Store: store})
	if e != nil {
		t.Fatal(e)
	}
	for _, op := range []erpwire.Operation{service.invoicePDF, service.invoiceWHT, service.creditNotePDF} {
		if _, e := op(context.Background(), erpwire.Actor{}, documentRouteInput(t)); !errors.Is(e, erpwire.ErrUnauthenticated) {
			t.Fatalf("unbound actor permitted: %v", e)
		}
	}
	if store.reads != 0 {
		t.Fatal("unauthenticated database access")
	}
}

func TestInvoicePDFUsesSnapshotAndScopedBalance(t *testing.T) {
	snapshot := documentFixture()
	snapshot["taxInvoice"] = erpwire.Row{"docType": "TX", "branchCode": "00000", "copyLabel": "ต้นฉบับ"}
	store := &documentTestStore{t: t, tables: map[string][]erpwire.Row{
		"invoices":          {{"org_id": documentOrg, "id": documentID, "number": "LIVE NUMBER", "status": "sent", "amount_satang": int64(9001), "issued_snapshot_id": "snapshot", "client_id": "client"}},
		"invoice_snapshots": {{"org_id": documentOrg, "invoice_id": documentID, "id": "snapshot", "snapshot": snapshot}, {"org_id": "40000000-0000-4000-8000-000000000004", "invoice_id": documentID, "id": "snapshot", "snapshot": nil}},
		"invoice_balances":  {{"org_id": documentOrg, "invoice_id": documentID, "paid_satang": int64(1001), "credited_satang": int64(2000)}, {"org_id": "40000000-0000-4000-8000-000000000004", "invoice_id": documentID, "paid_satang": int64(8000), "credited_satang": int64(1001)}},
	}}
	renderer := &documentTestRenderer{}
	service, e := New(Options{Store: store, PDFRenderer: renderer})
	if e != nil {
		t.Fatal(e)
	}
	value, e := service.invoicePDF(context.Background(), documentActor(t), documentRouteInput(t))
	if e != nil {
		t.Fatal(e)
	}
	response := value.(RouteResponse)
	doc := renderer.model.Document
	if response.Status != 200 || string(response.Body) != "<html>rendered</html>" || renderer.calls != 1 || doc == nil || doc.Number != "INV-FROZEN" || doc.OrgName != "ร้านเดิม" || doc.VerifiedPaidSatang == nil || *doc.VerifiedPaidSatang != 1001 || doc.CreditedSatang != 2000 || doc.OutstandingSatang == nil || *doc.OutstandingSatang != 6000 || doc.TaxInvoice.CopyLabel != "สำเนา" {
		t.Fatalf("snapshot/tenant boundary failed: response=%#v document=%#v", response, doc)
	}
}

func TestDocumentFailuresNeverRenderOrLeakDatabaseErrors(t *testing.T) {
	for _, fault := range []error{errors.New("secret SQL details"), erpwire.ErrIdentityChanged} {
		store := &documentTestStore{t: t, failTable: "invoices", failure: fault}
		renderer := &documentTestRenderer{}
		service, e := New(Options{Store: store, PDFRenderer: renderer})
		if e != nil {
			t.Fatal(e)
		}
		value, e := service.invoicePDF(context.Background(), documentActor(t), documentRouteInput(t))
		if errors.Is(fault, erpwire.ErrIdentityChanged) {
			if !errors.Is(e, fault) {
				t.Fatalf("identity failure hidden: %v", e)
			}
		} else if e != nil || value.(RouteResponse).Status != 503 || string(value.(RouteResponse).Body) != "Invoice evidence unavailable" {
			t.Fatalf("unsafe failure: %#v %v", value, e)
		}
		if renderer.calls != 0 {
			t.Fatal("rendered failed evidence")
		}
	}
}

func TestWHTDraftUsesIssuedPayerAndExactTax(t *testing.T) {
	snapshot := documentFixture()
	d := object(snapshot["document"])
	d["whtRateBps"] = 300
	d["whtSatang"] = 270
	d["amountDueSatang"] = 8731
	store := &documentTestStore{t: t, tables: map[string][]erpwire.Row{
		"invoices":          {{"org_id": documentOrg, "id": documentID, "issued_snapshot_id": "snapshot"}},
		"invoice_snapshots": {{"org_id": documentOrg, "invoice_id": documentID, "id": "snapshot", "snapshot": snapshot}},
	}}
	renderer := &documentTestRenderer{}
	service, e := New(Options{Store: store, PDFRenderer: renderer})
	if e != nil {
		t.Fatal(e)
	}
	value, e := service.invoiceWHT(context.Background(), documentActor(t), documentRouteInput(t))
	if e != nil {
		t.Fatal(e)
	}
	response := value.(RouteResponse)
	draft := renderer.model.WHT
	if response.Status != 200 || response.Headers["X-Robots-Tag"] != "noindex" || draft == nil || draft.PayerName != "ลูกค้าเดิม" || draft.PayeeName != "ร้านเดิม" || draft.BaseSatang != 9001 || draft.WHTSatang != 270 || draft.WHTRateBps != 300 || draft.Income != "งานเดิม" || !strings.HasPrefix(draft.Banner, "DRAFT / ร่าง") {
		t.Fatalf("WHT draft changed: %#v %#v", response, draft)
	}
}

func TestWHTRefusesLegacyAndZeroWithholding(t *testing.T) {
	for _, tc := range []struct {
		name    string
		legacy  bool
		message string
	}{
		{"legacy", true, "A legacy record has no priced lines to draft a withholding certificate"},
		{"zero withholding", false, "No withholding to certify"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			snapshot := documentFixture()
			if tc.legacy {
				snapshot["kind"] = "legacy_operational_invoice"
			}
			store := &documentTestStore{t: t, tables: map[string][]erpwire.Row{
				"invoices":          {{"org_id": documentOrg, "id": documentID, "issued_snapshot_id": "snapshot"}},
				"invoice_snapshots": {{"org_id": documentOrg, "invoice_id": documentID, "id": "snapshot", "snapshot": snapshot}},
			}}
			renderer := &documentTestRenderer{}
			service, e := New(Options{Store: store, PDFRenderer: renderer})
			if e != nil {
				t.Fatal(e)
			}
			value, e := service.invoiceWHT(context.Background(), documentActor(t), documentRouteInput(t))
			if e != nil || value.(RouteResponse).Status != 404 || string(value.(RouteResponse).Body) != tc.message || renderer.calls != 0 {
				t.Fatalf("WHT refusal: %#v %v", value, e)
			}
		})
	}
}

func TestCreditPDFTenantIsolationAndRendererRequirement(t *testing.T) {
	for _, tc := range []struct {
		name     string
		org      string
		renderer bool
		want     int
	}{
		{"same workspace", documentOrg, true, 200},
		{"other workspace", "40000000-0000-4000-8000-000000000004", true, 404},
		{"unconfigured renderer", documentOrg, false, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &documentTestStore{t: t, tables: map[string][]erpwire.Row{"credit_notes": {{"org_id": tc.org, "id": documentID, "snapshot": creditDocumentFixture()}}}}
			options := Options{Store: store}
			renderer := &documentTestRenderer{}
			if tc.renderer {
				options.PDFRenderer = renderer
			}
			service, e := New(options)
			if e != nil {
				t.Fatal(e)
			}
			value, e := service.creditNotePDF(context.Background(), documentActor(t), documentRouteInput(t))
			if e != nil || value.(RouteResponse).Status != tc.want {
				t.Fatalf("credit response: %#v %v", value, e)
			}
			if tc.want == 200 {
				if renderer.calls != 1 || renderer.model.Document == nil || renderer.model.Document.Number != "CN-2026-001" {
					t.Fatalf("wrong credit model: %#v", renderer.model)
				}
			} else if renderer.calls != 0 {
				t.Fatal("failed route rendered")
			}
		})
	}
}
