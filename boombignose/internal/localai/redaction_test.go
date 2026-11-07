package localai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func replacing(secret string) func(string) (string, bool) {
	return func(s string) (string, bool) {
		next := strings.ReplaceAll(s, secret, "[redacted]")
		return next, next != s
	}
}
func TestRedactedReadRehashesVisibleBytesAndKeepsOriginalSliceSeparate(t *testing.T) {
	const nativeSecret = "static-private-test-value"
	const bearer = "request-private-test-value"
	p, err := NewProvider(Config{Redact: replacing(nativeSecret)})
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithRedactor(context.Background(), replacing(bearer))
	original := "ต้นฉบับ😀 " + nativeSecret + " and " + bearer + " tail"
	originalHash := hashText(original)
	fullHash := hashText("full original source\n" + original)
	data := map[string]any{"text": original, "text_sha256": originalHash, "sha256": fullHash, "coverage": map[string]any{"complete": true}, "notes": map[string]any{nativeSecret: "untrusted key"}}
	read := &erpwire.ReadText{Label: "Authorized original range", Text: original}
	coverage := &erpwire.Coverage{FactIDs: []string{"count"}}
	result := erpwire.ToolResult{Content: jsonBytes(data), Evidence: []erpwire.Evidence{{Key: "range:" + nativeSecret, Source: erpwire.AssistantSource{Kind: "erp", Label: "erp_data_text", Coverage: coverage, Facts: []erpwire.SourceFact{{ID: "count", Label: erpwire.Label{English: "Source note"}, Value: original, Scope: "record"}}}, ReadText: read}}}
	projected, visible, ranges := p.redactTool(ctx, result, data)
	source := projected.Evidence[0]
	text := source.ReadText.Text
	payload := visible.(map[string]any)
	if text == original || strings.Contains(text, nativeSecret) || strings.Contains(text, bearer) {
		t.Fatal("actual read bytes were not protected")
	}
	if payload["original_slice_sha256"] != originalHash || payload["text_sha256"] != hashText(text) || payload["sha256"] != fullHash {
		t.Fatal("visible and original source identities were conflated")
	}
	if source.Source.TextSHA256 != hashText(text) || !source.Source.Partial || !source.Source.Coverage.Partial || !source.ReadText.Partial {
		t.Fatal("source hashes or partial coverage stayed stale")
	}
	if payload["coverage"].(map[string]any)["complete"] != false || payload["redacted"] != true {
		t.Fatal("redacted source claimed unredacted complete coverage")
	}
	serialized := string(jsonBytes(map[string]any{"data": visible, "ranges": ranges, "facts": source.Source.Facts}))
	if strings.Contains(serialized, nativeSecret) || strings.Contains(serialized, bearer) {
		t.Fatal("secret remained in a value, map key or provenance identity")
	}
	if read.Text != original || coverage.Partial || result.Evidence[0].Source.Facts[0].Value != original {
		t.Fatal("caller-owned originals were overwritten by model projection")
	}
	e := newEvidence("")
	sources, err := e.collect(projected)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 2 {
		t.Fatal("ERP and actual document source were not kept distinct")
	}
	doc := sources[1]
	if e.documents[doc.ID] != text || doc.TextSHA256 != hashText(text) {
		t.Fatal("quote map did not use exact visible read bytes")
	}
	raw := string(jsonBytes(map[string]any{"language": "en", "factIds": []string{}, "tasks": []any{map[string]any{"action": "review-original-document", "sourceIds": []string{doc.ID}, "factIds": []string{}, "quotes": []erpwire.Quote{{SourceID: doc.ID, Text: original}}}}}))
	if _, err := parseAnswer(raw, e); err == nil {
		t.Fatal("unredacted original was accepted as a quote from the visible range")
	}
	metadata := projected
	metadata.MetadataOnly = true
	only := newEvidence("")
	if added, err := only.collect(metadata); err != nil || len(added) != 0 || only.hasKind("erp") {
		t.Fatal("redacted metadata became fresh business evidence")
	}
}
func TestModelGetsRedactedHistoryWithoutChangingCallerAndEscapedSecretOutputIsRejected(t *testing.T) {
	const secret = "private-test-bearer"
	p := testProvider(t)
	ctx := WithRedactor(context.Background(), replacing(secret))
	original := "Please review this request, " + secret
	messages := []modelMessage{{Role: "user", Content: original}}
	received := false
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/show" {
			return localCheckpoint(), nil
		}
		b, _ := io.ReadAll(r.Body)
		var body map[string]any
		if strictJSON(b, &body) != nil {
			t.Fatal("invalid request JSON")
		}
		sent := body["messages"].([]any)[0].(map[string]any)["content"].(string)
		if strings.Contains(sent, secret) || !strings.Contains(sent, "[redacted]") {
			t.Fatal("model received original protected history")
		}
		received = true
		// Escaped JSON strings must not bypass the final decoded-value guard.
		encoded := `{"summary":"\u0070rivate-test-bearer","findings":[],"nextActions":[],"limitations":[]}`
		return inferenceText(encoded), nil
	})
	if _, err := p.infer(ctx, p.chatModel, messages, nil, false, true); err == nil {
		t.Fatal("accepted escaped protected output")
	}
	if !received || messages[0].Content != original {
		t.Fatal("history projection mutated the caller's original message")
	}
}
func TestMetadataPaginationRemainsBoundedWithEscapedUnicodeLabels(t *testing.T) {
	messages := []erpwire.ChatMessage{}
	for range 20 {
		messages = append(messages, erpwire.ChatMessage{Role: "user", Content: "Inspect attachment", Attachments: []erpwire.ChatAttachment{{Kind: "text", Name: strings.Repeat("<", 120), Text: "original"}}})
	}
	reader := newDocumentReader(messages)
	result, err := reader.call("local_documents", map[string]any{"limit": json.Number("20")})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Content) > 12000 {
		t.Fatal("escaped filenames broke metadata transport bound")
	}
	var payload map[string]any
	if strictJSON(result.Content, &payload) != nil {
		t.Fatal("metadata JSON invalid")
	}
	next, _ := payload["next_offset"].(json.Number).Int64()
	if next <= 0 || next >= 20 || payload["has_more"] != true {
		t.Fatal("metadata pagination silently lost the bounded remainder")
	}
}
