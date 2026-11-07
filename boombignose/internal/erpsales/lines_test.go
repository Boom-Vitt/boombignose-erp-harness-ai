package erpsales

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func salesTestLinePayload(document string) erpwire.Row {
	return erpwire.Row{"document": document, "documentId": salesTestID, "rows": []any{erpwire.Row{"kind": "line", "id": salesTestKey, "product_id": nil, "description": " งาน ", "quantity": " 0001.000 ", "unit": nil, "unit_price_satang": int64(1), "tax_rate_bps": int64(700)}, erpwire.Row{"kind": "section", "id": "50000000-0000-4000-8000-000000000001", "description": " หัวข้อ "}}, "deleted": []string{}}
}
func TestLineGridSaveContractAndScope(t *testing.T) {
	for _, document := range []string{"quote", "purchase_order", "invoice"} {
		t.Run(document, func(t *testing.T) {
			table := map[string]string{"quote": "quotes", "purchase_order": "purchase_orders", "invoice": "invoices"}[document]
			f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{table: {{"org_id": salesTestOrg, "id": salesTestID}}}}
			s, _ := New(Options{Store: f})
			payload := salesTestLinePayload(document)
			v, e := s.saveDocumentLines(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, payload))
			if e != nil {
				t.Fatal(e)
			}
			if len(f.commands) != 1 || f.commands[0] != "save_document_lines" {
				t.Fatalf("commands %#v", f.commands)
			}
			call := f.calls[0]
			rows := call["p_rows"].([]erpwire.Row)
			if call["p_document"] != document || call["p_document_id"] != salesTestID || rows[0]["quantity"] != "0001.000" || rows[0]["description"] != "งาน" || rows[1]["description"] != "หัวข้อ" {
				t.Fatalf("payload %#v", call)
			}
			r := v.(erpwire.ActionResponse)
			if !reflect.DeepEqual(r.Value, erpwire.Row{"rows": []erpwire.Row{}}) || f.tables["audit_log"][0]["summary"] != "Saved 1 line and 1 section or note row" {
				t.Fatalf("save result %#v", r)
			}
		})
	}
	f := &salesTestStore{t: t, tables: map[string][]erpwire.Row{"quotes": {{"org_id": salesTestForeign, "id": salesTestID}}}}
	s, _ := New(Options{Store: f})
	v, e := s.saveDocumentLines(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, salesTestLinePayload("quote")))
	salesTestError(t, v, e, "Document unavailable")
	if len(f.commands) != 0 {
		t.Fatal("foreign document sent to command")
	}
}
func TestLineGridDenialAndMoneyBoundaries(t *testing.T) {
	for _, document := range []string{"invoice", "purchase_order"} {
		f := &salesTestStore{t: t}
		s, _ := New(Options{Store: f})
		v, e := s.saveDocumentLines(context.Background(), salesTestActor(t, erpwire.Member), salesTestRaw(t, salesTestLinePayload(document)))
		salesTestError(t, v, e, "You cannot edit these lines.")
		if f.reads+f.writes != 0 {
			t.Fatal("denied edit reached store")
		}
	}
	for _, test := range []struct {
		quantity string
		price    money.Satang
		want     money.Satang
		valid    bool
	}{{"0.5", 1, 1, true}, {"0.499", 1, 0, true}, {"1", money.MaxSafeSatang, money.MaxSafeSatang, true}, {"2", money.MaxSafeSatang, 0, false}, {"0", 1, 0, false}, {"1.0001", 1, 0, false}} {
		amount, err := purchaseLineAmount(test.quantity, test.price)
		ok := err == nil
		if ok != test.valid || ok && amount != test.want {
			t.Fatalf("%s * %d => %d,%v", test.quantity, test.price, amount, ok)
		}
	}
}

type salesTestBusiness struct{ message string }

func (e salesTestBusiness) Error() string           { return "database operation could not be completed" }
func (e salesTestBusiness) SQLState() string        { return "P0001" }
func (e salesTestBusiness) BusinessMessage() string { return e.message }
func TestQuoteConversionCanonicalQuantityAndRedactedRejections(t *testing.T) {
	for _, input := range []string{"0001.000", "00.001"} {
		q, ok := quoteQuantity(input)
		raw, e := json.Marshal(erpwire.Row{"quantity": q})
		if !ok || e != nil {
			t.Fatalf("valid quantity not encodable %s %v", input, e)
		}
		want := `{"quantity":1}`
		if input == "00.001" {
			want = `{"quantity":0.001}`
		}
		if string(raw) != want {
			t.Fatalf("got %s want %s", raw, want)
		}
	}
	for _, test := range []struct {
		message  string
		rejected bool
	}{{"", false}, {"Idempotency conflict", false}, {"Only owners and admins may convert quotes", false}, {"Quote has no remaining quantity", true}} {
		f := &salesTestStore{t: t, command: func(string, erpwire.Row) (json.RawMessage, error) { return nil, salesTestBusiness{test.message} }}
		s, _ := New(Options{Store: f})
		v, e := s.convertQuoteToInvoice(context.Background(), salesTestActor(t, erpwire.Owner), salesTestRaw(t, erpwire.Row{"id": salesTestID, "key": salesTestKey}))
		if e != nil {
			t.Fatal(e)
		}
		value := v.(erpwire.ActionResponse).Value.(erpwire.Row)
		if (value["rejected"] == true) != test.rejected {
			t.Fatalf("%q => %#v", test.message, value)
		}
	}
}
func TestPrintableTaxBreakdownValidation(t *testing.T) {
	for _, value := range []any{map[string]any{}, []any{erpwire.Row{"rateBps": "700", "vatSatang": 1}}, []any{erpwire.Row{"rateBps": 700}}, []any{erpwire.Row{"rateBps": 700, "vatSatang": int64(money.MaxSafeSatang) + 1}}} {
		if _, e := salesTaxBreakdown(value); e == nil {
			t.Fatalf("invalid breakdown accepted %#v", value)
		}
	}
	rows, e := salesTaxBreakdown([]erpwire.Row{{"rateBps": 700, "vatSatang": int64(1), "baseSatang": int64(14)}})
	if e != nil || len(rows) != 1 || rows[0]["vatSatang"] != money.Satang(1) || rows[0]["baseSatang"] != nil {
		t.Fatalf("parsed tax %#v %v", rows, e)
	}
}
