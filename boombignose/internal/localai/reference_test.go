package localai

import (
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestGuidanceReferenceRequiresExactReadQuotedOwnership(t *testing.T) {
	original := "Agreement CR-TAIL-92: accounting reviews the original receipt before approval. THB-1070 is printed elsewhere. Agreement 9CR-OTHER-93 needs review."
	evidence := newEvidence("")
	source, err := evidence.add("actual-document-range", erpwire.AssistantSource{Kind: "document", Label: "Actual retained range", Partial: true}, &erpwire.ReadText{Text: original, Partial: true})
	if err != nil {
		t.Fatal(err)
	}
	makeAnswer := func(prose, quote string) string {
		return string(jsonBytes(map[string]any{
			"summary":     prose,
			"findings":    []any{map[string]any{"text": prose, "sourceIds": []string{source.ID}, "factIds": []string{}, "quotes": []erpwire.Quote{{SourceID: source.ID, Text: quote}}}},
			"nextActions": []string{"Ask accounting to compare the original before approval."},
			"limitations": []string{},
		}))
	}
	for _, test := range []struct {
		name, prose, quote string
		accepted           bool
	}{
		{"exact read and quoted reference", "Review the agreement for CR-TAIL-92 before approval.", "Agreement CR-TAIL-92: accounting reviews the original receipt before approval.", true},
		{"invented reference", "Review CR-TAIL-93 before approval.", "Agreement CR-TAIL-92: accounting reviews the original receipt before approval.", false},
		{"substring of another reference", "Review TAIL-92 before approval.", "Agreement CR-TAIL-92: accounting reviews the original receipt before approval.", false},
		{"quote clipped inside reference", "Review TAIL-92 before approval.", "TAIL-92", false},
		{"reference inside digit-prefixed identifier", "Review CR-OTHER-93 before approval.", "Agreement 9CR-OTHER-93 needs review.", false},
		{"invisible financial word", "The total is s\u200bix baht.", "accounting reviews the original receipt before approval.", false},
		{"read but not in selected quote", "Review CR-TAIL-92 before approval.", "accounting reviews the original receipt before approval.", false},
		{"unquoted financial amount", "The total is 1070 baht.", "THB-1070 is printed elsewhere.", false},
		{"currency-shaped reference", "The amount is THB-1070.", "THB-1070 is printed elsewhere.", false},
		{"spelled numeric replacement", "Review CR-TAIL-ninety-two before approval.", "Agreement CR-TAIL-92: accounting reviews the original receipt before approval.", false},
		{"reference plus invented quantity", "Review CR-TAIL-92 and three receipts.", "Agreement CR-TAIL-92: accounting reviews the original receipt before approval.", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseAnswer(makeAnswer(test.prose, test.quote), evidence)
			if (err == nil) != test.accepted {
				t.Fatalf("source-reference boundary: accepted=%t, want=%t, error=%v", err == nil, test.accepted, err)
			}
		})
	}
}
