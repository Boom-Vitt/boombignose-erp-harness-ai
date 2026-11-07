package localai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestNumericProseUsesThaiDictionaryBoundaries(t *testing.T) {
	for _, text := range []string{"สามารถตรวจเอกสารและผูกพันตามข้อตกลง", "ทีมงานสามารถตรวจหลักฐานต้นฉบับก่อนตัดสินใจ", "Review the original document before deciding.", "The stone is someone else's."} {
		if hasNumericProse(text) {
			t.Errorf("qualitative prose rejected: %q", text)
		}
	}
	for _, text := range []string{"หนึ่งรายการ", "สามร้อยห้าสิบบาท", "มียอดค้างหกใบแจ้งหนี้", "one record", "THREE invoices", "มีลูกค้า๖ราย", "ｓｉｘ records", "ยอดรวม二บาท", "the amount is 385096", "total ฿", "The total is s\u200bix baht.", "s\u034fix records", "s\ufe0fix records", "ห\u200bกบาท"} {
		if !hasNumericProse(text) {
			t.Errorf("numeric prose accepted: %q", text)
		}
	}
}

func TestReadRangesTraverseFullOriginalWithoutSurrogateLoss(t *testing.T) {
	original := "\ufeff" + strings.Repeat("ต้นฉบับ😀 English\n", 7000) + "TAIL-ต้นทาง"
	messages := []erpwire.ChatMessage{{Role: "assistant", Content: "Generated text is not a document."}, {Role: "user", Content: "Inspect the tail", Attachments: []erpwire.ChatAttachment{{Kind: "text", Name: "chat.txt", Text: original}}}}
	reader := newDocumentReader(messages)
	if len(reader.documents) != 1 {
		t.Fatal("historical assistant prose was made into source evidence")
	}
	d := reader.documents[0]
	if d.SHA != hashText(original) {
		t.Fatal("original hash changed")
	}
	e := newEvidence("Inspect the tail")
	offset := 0
	var rebuilt strings.Builder
	for offset < d.Length {
		result, err := reader.call("read_local_document", map[string]any{"document_id": "local-1", "offset": json.Number(jsonInteger(offset)), "limit": json.Number("3999")})
		if err != nil {
			t.Fatal(err)
		}
		sources, err := e.collect(result)
		if err != nil {
			t.Fatal(err)
		}
		if len(sources) != 1 {
			t.Fatal("read did not materialize one range")
		}
		var payload map[string]any
		if strictJSON(result.Content, &payload) != nil {
			t.Fatal("invalid range payload")
		}
		text := payload["text"].(string)
		rebuilt.WriteString(text)
		if sources[0].TextSHA256 != hashText(text) || e.documents[sources[0].ID] != text {
			t.Fatal("visible source hash or exact quote map mismatch")
		}
		next, _ := payload["next_offset"].(json.Number).Int64()
		if int(next) <= offset {
			t.Fatal("continuation did not advance")
		}
		offset = int(next)
	}
	if rebuilt.String() != original {
		t.Fatal("full continuation lost original bytes, BOM or Unicode")
	}
	if len(d.Reads) != 1 || d.Reads[0].Start != 0 || d.Reads[0].End != d.Length {
		t.Fatal("merged complete coverage is wrong")
	}
	// The first emoji's second UTF-16 unit is not an admissible next offset.
	emoji := strings.Index(original, "😀")
	split := utf16Length(original[:emoji]) + 1
	if _, err := reader.call("read_local_document", map[string]any{"document_id": "local-1", "offset": json.Number(jsonInteger(split))}); err == nil {
		t.Fatal("accepted a split surrogate pair")
	}
	search, err := reader.call("search_local_documents", map[string]any{"query": "TAIL-ต้นทาง"})
	if err != nil {
		t.Fatal(err)
	}
	if !search.MetadataOnly || len(search.Evidence) != 0 || !strings.Contains(string(search.Content), "TAIL-") {
		t.Fatal("tail search failed or invented read evidence")
	}
}

func TestQuotesCannotUseUnreadTextSearchSnippetsOrGeneratedHistory(t *testing.T) {
	e := newEvidence("")
	source, err := e.add("range", erpwire.AssistantSource{Kind: "document", Label: "actual range", Partial: true}, &erpwire.ReadText{Text: "Read original text only.", Partial: true})
	if err != nil {
		t.Fatal(err)
	}
	makeAnswer := func(quote string) string {
		return string(jsonBytes(map[string]any{"summary": "Review the original wording.", "findings": []any{map[string]any{"text": "Compare the quoted passage with the request.", "sourceIds": []string{source.ID}, "factIds": []string{}, "quotes": []erpwire.Quote{{SourceID: source.ID, Text: quote}}}}, "nextActions": []string{}, "limitations": []string{}}))
	}
	if _, err := parseAnswer(makeAnswer("Read original text only."), e); err != nil {
		t.Fatal(err)
	}
	for _, unread := range []string{"Unread tail.", "Generated earlier assistant prose.", "Read original text only. Unread tail."} {
		if _, err := parseAnswer(makeAnswer(unread), e); err == nil {
			t.Fatalf("accepted unmaterialized quote %q", unread)
		}
	}
	if _, err := parseAnswer(strings.Replace(makeAnswer("Read original text only."), "Review the original wording.", "There are six records.", 1), e); err == nil {
		t.Fatal("accepted counted-word narrative")
	}
}

func TestFactPrefixesOwnershipAndMandatoryCoverageSurvive(t *testing.T) {
	e := newEvidence("")
	source, err := e.add("invoice-snapshot", erpwire.AssistantSource{Kind: "erp", Label: "list_invoices", Coverage: &erpwire.Coverage{FactIDs: []string{"coverage:outstanding"}}, Facts: []erpwire.SourceFact{{ID: "coverage:outstanding", Label: erpwire.Label{English: "Issued outstanding total"}, Value: "THB 3,850.96", Scope: "workspace"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if source.Facts[0].ID != "erp-1:coverage:outstanding" || source.Coverage.FactIDs[0] != source.Facts[0].ID {
		t.Fatal("prefixing separated coverage from its fact")
	}
	raw := `{"language":"en","factIds":[],"tasks":[]}`
	answer, err := parseAnswer(raw, e)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(answerText(answer, e.sources), "THB 3,850.96") {
		t.Fatal("AI omission hid mandatory coverage")
	}
	if _, err := parseAnswer(`{"language":"en","factIds":["erp-9:coverage:outstanding"],"tasks":[]}`, e); err == nil {
		t.Fatal("accepted stale turn fact")
	}
	if _, err := parseAnswer(`{"language":"en","factIds":[],"tasks":[{"action":"review-payment-claim","sourceIds":["erp-1"],"factIds":[],"quotes":[]}]}`, e); err == nil {
		t.Fatal("accepted mismatched task source")
	}
	if _, err := parseAnswer(`{"language":"en","factIds":[],"tasks":[{"action":"pay-invoice","sourceIds":["erp-1"],"factIds":[],"quotes":[]}]}`, e); err == nil {
		t.Fatal("accepted write action")
	}
}

func TestStrictJSONAndSchemaRejectIndependentBoundaryViolations(t *testing.T) {
	for _, raw := range []string{`{"kind":"complete","kind":"read"}`, `{} {}`, `{"x":1,"x":2}`} {
		var value any
		if strictJSON([]byte(raw), &value) == nil {
			t.Fatalf("accepted ambiguous JSON %s", raw)
		}
	}
	schema := lookupSchema(localSpecs(), func() map[string]any {
		m := map[string]any{}
		for _, s := range localSpecs() {
			var v any
			_ = strictJSON(s.InputSchema, &v)
			m[s.Name] = v
		}
		return m
	}(), false, nil)
	for _, raw := range []string{`{"kind":"complete"}`, `{"kind":"read","operations":[{"name":"read_local_document","arguments":{"document_id":"local-1","org_id":"other"}}]}`, `{"kind":"read","operations":[{"name":"read_local_document","arguments":{"document_id":"local-1","offset":0.5}}]}`} {
		var value any
		if strictJSON([]byte(raw), &value) != nil {
			t.Fatal("fixture JSON invalid")
		}
		if validateSchema(schema, value) == nil {
			t.Fatalf("accepted invalid read transition %s", raw)
		}
	}
}

func TestAcceptedLongInlineTextIsTraversableWithoutReplacingQuestionOrHistory(t *testing.T) {
	original := strings.Repeat("original ", 700) + "TAIL"
	request, err := normalizeRequest(erpwire.ChatRequest{DataScope: erpwire.GuidanceScope, Messages: []erpwire.ChatMessage{{Role: "assistant", Content: "Earlier generated context"}, {Role: "user", Content: original}}})
	if err != nil {
		t.Fatal(err)
	}
	reader := newDocumentReader(request.Messages)
	if len(reader.documents) != 1 || reader.documents[0].Text != original || reader.documents[0].SHA != hashText(original) {
		t.Fatal("accepted long inline text was not retained as its exact original")
	}
	if len(reader.messages) != 2 || reader.messages[0].Content != "Earlier generated context" || !strings.HasPrefix(reader.messages[1].Content, original) {
		t.Fatal("pointer registration replaced or clipped accepted original history")
	}
	result, err := reader.call("read_local_document", map[string]any{"document_id": "local-1", "offset": json.Number("4000")})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(result.Content), "TAIL") || len(result.Evidence) != 1 {
		t.Fatal("accepted inline source tail was not materially readable")
	}
}
