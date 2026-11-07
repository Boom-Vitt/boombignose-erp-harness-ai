package erpexpenses

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestReviewedExpenseLineBoundaries(t *testing.T) {
	for _, test := range []struct {
		name string
		amount any
		date string
		project any
		valid bool
	}{
		{"one satang", "0.01", "2024-02-29", "", true},
		{"exact maximum", "90071992547409.91", "2026-11-08", "", true},
		{"numeric amount", json.Number("12.34"), "2026-11-08", "", true},
		{"zero", "0", "2026-11-08", "", false},
		{"rounding forbidden", "1.001", "2026-11-08", "", false},
		{"overflow", "90071992547409.92", "2026-11-08", "", false},
		{"non leap day", "1", "2025-02-29", "", false},
		{"date normalization forbidden", "1", "2026-2-03", "", false},
		{"null project is not empty selection", "1", "2026-11-08", nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := map[string]any{"claim_id": "12345678-1234-1234-1234-123456789abc", "spent_on": test.date,
				"category": "other", "description": " Reviewed receipt ", "amountBaht": test.amount, "project_id": test.project}
			raw, err := json.Marshal(input)
			if err != nil { t.Fatal(err) }
			line, message := parseLine(erpwire.Arguments{raw})
			if (message == "") != test.valid { t.Fatalf("valid=%v, message=%q", test.valid, message) }
			if test.valid && (line["description"] != "Reviewed receipt" || line["project_id"] != nil) { t.Fatalf("line normalization failed: %#v", line) }
		})
	}
}

func TestClaimTotalsBoundIndependently(t *testing.T) {
	maximum := int64(money.MaxSafeSatang)
	totals, err := totalLines([]erpwire.Row{{"claim_id": "a", "amount_satang": maximum}, {"claim_id": "b", "amount_satang": json.Number("9007199254740991")}})
	if err != nil || len(totals.Entries) != 2 { t.Fatalf("independent safe claims rejected: %v", err) }
	if _, err := totalLines([]erpwire.Row{{"claim_id": "a", "amount_satang": maximum}, {"claim_id": "a", "amount_satang": int64(1)}}); err == nil { t.Fatal("unsafe claim total accepted") }
	if _, err := totalLines([]erpwire.Row{{"claim_id": "a", "amount_satang": nil}}); err == nil { t.Fatal("unknown money treated as zero") }
}

func TestClaimTextUsesBrowserLengthAndWhitespace(t *testing.T) {
	if trimText("\ufeff title \ufeff") != "title" { t.Fatal("browser BOM trimming lost") }
	if trimText("\u0085title\u0085") != "\u0085title\u0085" { t.Fatal("non-browser whitespace trimmed") }
	if textLength(strings.Repeat("😀", 101)) != 202 { t.Fatal("browser UTF-16 length not retained") }
}
