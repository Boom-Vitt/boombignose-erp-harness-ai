package localai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func jsonInteger(n int) string { return strconv.Itoa(n) }

func TestPrintedMoneyAndDateAreExactAndUnknownsStayNullable(t *testing.T) {
	for raw, want := range map[string]int64{"๑,๒๓๔.๕๖ บาท": 123456, "THB 0.10": 10, "฿9,007,199,254.99": 900719925499} {
		got := PrintedMoneySatang(raw)
		if got == nil || *got != want {
			t.Errorf("%q money got %v want %d", raw, got, want)
		}
	}
	for _, raw := range []string{"1,23.45", "1.005", "-1.00", "USD 5", "9,007,199,254,740,991.00", "1e3", "NaN", "1 000.00"} {
		if PrintedMoneySatang(raw) != nil {
			t.Errorf("accepted malformed/unsafe money %q", raw)
		}
	}
	for raw, want := range map[string]string{"7 พฤศจิกายน 2569": "2026-11-07", "2026-11-07": "2026-11-07", "31/12/2569": "2026-12-31"} {
		got := PrintedDate(raw)
		if got == nil || *got != want {
			t.Errorf("date %q got %v want %s", raw, got, want)
		}
	}
	for _, raw := range []string{"01/02/2026", "2026-02-30", "31/13/2569", "unknown"} {
		if PrintedDate(raw) != nil {
			t.Errorf("accepted ambiguous/invalid date %q", raw)
		}
	}
	source := "Vendor A\nInvoice INV-X\nSubtotal 100.00\nVAT 7.00\nTotal 107.00\n7 พฤศจิกายน 2569"
	raw := `{"vendor":"Vendor A","date":"7 พฤศจิกายน 2569","documentNumber":"INV-X","description":null,"subtotal":"100.00","vat":"7.00","total":"107.00"}`
	fields, warnings := parseOCRFields(raw, source)
	if fields.Vendor == nil || fields.Description != nil || fields.TotalSatang == nil || *fields.TotalSatang != 10700 || len(warnings) == 0 {
		t.Fatal("exact advisory fields lost nullable/amount/review semantics")
	}
	fields, _ = parseOCRFields(strings.Replace(raw, "Vendor A", "Invented vendor", 1), source)
	if fields.Vendor != nil {
		t.Fatal("hallucinated vendor accepted")
	}
	fields, _ = parseOCRFields(raw, source+" USD")
	if fields.TotalSatang != nil || fields.SubtotalSatang != nil || fields.VATSatang != nil {
		t.Fatal("foreign/mixed currency converted or retained")
	}
	fields, _ = parseOCRFields(strings.Replace(raw, `"7.00"`, `"100.00"`, 1), source)
	if fields.VATSatang != nil || fields.SubtotalSatang != nil {
		t.Fatal("inconsistent satang arithmetic accepted")
	}
}
func TestStoredImageHashAndActorValidationHappenBeforeDecoderOrInference(t *testing.T) {
	p := testProvider(t)
	p.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("image was forwarded before authorization/hash validation")
		return nil, errors.New("unexpected request")
	})
	if _, err := p.ExtractImageText(context.Background(), []byte("different bytes"), "invoice.png", "image/png", strings.Repeat("0", 64)); err == nil {
		t.Fatal("changed original accepted")
	}
	req := &http.Request{Header: make(http.Header), Body: panicReader{}}
	if _, err := p.OCRHTTP(context.Background(), erpwire.Actor{}, req); !errors.Is(err, erpwire.ErrUnauthenticated) {
		t.Fatalf("zero actor not rejected first: %v", err)
	}
	req = &http.Request{Header: http.Header{"X-Ocr-Page": []string{"1"}, "X-Ocr-Pages": []string{"13"}, "X-Ocr-Source-Sha256": []string{strings.Repeat("0", 64)}}, Body: panicReader{}}
	if _, err := p.OCRHTTP(context.Background(), testActor(t), req); err == nil {
		t.Fatal("over-limit PDF page metadata accepted")
	}
}

type panicReader struct{}

func (panicReader) Read([]byte) (int, error) { panic("body must not be read") }
func (panicReader) Close() error             { return nil }

var _ io.ReadCloser = panicReader{}
