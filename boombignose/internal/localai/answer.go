package localai

import (
	"errors"
	"regexp"
	"sort"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func answerSchema(e *evidenceSet) map[string]any {
	sourceIDs, docIDs := []string{}, []string{}
	hasFacts := false
	for _, source := range e.sources {
		sourceIDs = append(sourceIDs, source.ID)
		if source.Kind == "document" {
			docIDs = append(docIDs, source.ID)
		}
		hasFacts = hasFacts || len(source.Facts) > 0
	}
	facts := func(max int) map[string]any {
		if !hasFacts {
			max = 0
		}
		return arraySchema(stringSchema(120), max)
	}
	refs := func(ids []string, max int) map[string]any {
		if len(ids) == 0 {
			return arraySchema(stringSchema(80), 0)
		}
		return arraySchema(enumSchema(ids), max)
	}
	quote := objectSchema(map[string]any{"sourceId": enumSchema(docIDs), "text": stringSchema(600)}, "sourceId", "text")
	quotes := arraySchema(quote, 3)
	if len(docIDs) == 0 {
		quotes["maxItems"] = 0
	}
	if e.hasKind("erp") {
		actions := []string{}
		for code, action := range reviewActions {
			for _, source := range e.sources {
				if actionAccepts(action, source) {
					actions = append(actions, code)
					break
				}
			}
		}
		sort.Strings(actions)
		ids := refs(sourceIDs, 8)
		ids["minItems"] = 1
		task := objectSchema(map[string]any{"action": enumSchema(actions), "sourceIds": ids, "factIds": facts(8), "quotes": quotes}, "action", "sourceIds", "factIds", "quotes")
		return objectSchema(map[string]any{"language": enumSchema([]string{"th", "en"}), "factIds": facts(24), "tasks": arraySchema(task, 6)}, "language", "factIds", "tasks")
	}
	finding := objectSchema(map[string]any{"text": narrativeSchema(1200), "sourceIds": refs(sourceIDs, 8), "factIds": facts(16), "quotes": quotes}, "text", "sourceIds", "factIds", "quotes")
	maxFindings := 8
	if len(e.sources) == 0 {
		maxFindings = 0
	}
	return objectSchema(map[string]any{"summary": narrativeSchema(1600), "findings": arraySchema(finding, maxFindings), "nextActions": arraySchema(narrativeSchema(600), 6), "limitations": arraySchema(narrativeSchema(600), 0)}, "summary", "findings", "nextActions", "limitations")
}

// Qualitative prose may repeat a reference only when the independent validator
// can bind its exact token to an actual-read quote in the same finding.
func narrativeSchema(max int) map[string]any {
	schema := stringSchema(max)
	schema["description"] = "Qualitative prose. A separator-delimited reference code containing letters and digits may repeat ONLY when that exact code appears in this finding's verbatim source quote. Never invent a reference, spell out its digits, calculate amounts or put counts, dates or financial numbers in prose. Put printed figures and dates in exact source quotes."
	return schema
}

var linkProse = regexp.MustCompile(`(?i)https?://|www\.|\[[^\]]*\]\(`)

var referenceProse = regexp.MustCompile(`[A-Za-z][A-Za-z0-9]*(?:[-_/][A-Za-z0-9]+)+`)

func quotedReference(code string, quotes []erpwire.Quote, evidence *evidenceSet) bool {
	if strings.IndexAny(code, "0123456789") < 0 {
		return false
	}
	separator := strings.IndexAny(code, "-_/")
	if separator < 0 {
		return false
	}
	prefix := strings.ToUpper(strings.TrimRight(code[:separator], "0123456789"))
	switch prefix {
	case "THB", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF", "SGD", "MYR", "INR", "IDR", "KRW", "VAT", "TAX", "TOTAL", "SUBTOTAL", "AMOUNT", "PRICE", "NET", "GROSS", "COUNT", "QTY", "QUANTITY", "DATE", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC":
		return false
	}
	// Number words disguised as a reference are still quantitative prose.
	if hasNumericProse(strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return -1
		}
		return r
	}, code)) {
		return false
	}
	for _, quote := range quotes {
		text, read := evidence.documents[quote.SourceID]
		if !read || quote.Text == "" {
			continue
		}
		complete := false
		for _, source := range evidence.sources {
			if source.ID == quote.SourceID {
				complete = !source.Partial
				break
			}
		}
		for cursor := 0; cursor <= len(text)-len(quote.Text); {
			at := strings.Index(text[cursor:], quote.Text)
			if at < 0 {
				break
			}
			at += cursor
			for start := 0; start <= len(quote.Text)-len(code); {
				offset := strings.Index(quote.Text[start:], code)
				if offset < 0 {
					break
				}
				offset += start
				left, right := at+offset, at+offset+len(code)
				// A clipped quote cannot manufacture an identifier boundary.
				// At a partial read's edge the adjacent source byte is unknown.
				leftOK := left > 0 && !referenceByte(text[left-1]) || left == 0 && complete
				rightOK := right < len(text) && !referenceByte(text[right]) || right == len(text) && complete
				if leftOK && rightOK {
					return true
				}
				start = offset + 1
			}
			cursor = at + 1
		}
	}
	return false
}

func referenceByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '_' || b == '/'
}

func validProse(s string, max int, quotes []erpwire.Quote, evidence *evidenceSet) bool {
	if strings.TrimSpace(s) == "" || utf16Length(s) > max || linkProse.MatchString(s) {
		return false
	}
	if !hasNumericProse(s) {
		return true
	}
	var quantitative strings.Builder
	last := 0
	for _, match := range referenceProse.FindAllStringIndex(s, -1) {
		if match[0] > 0 && referenceByte(s[match[0]-1]) || match[1] < len(s) && referenceByte(s[match[1]]) || !quotedReference(s[match[0]:match[1]], quotes, evidence) {
			continue
		}
		quantitative.WriteString(s[last:match[0]])
		quantitative.WriteByte(' ')
		last = match[1]
	}
	if last == 0 {
		return false
	}
	quantitative.WriteString(s[last:])
	return !hasNumericProse(quantitative.String())
}

func parseAnswer(raw string, e *evidenceSet) (erpwire.AssistantAnswer, error) {
	invalid := func() (erpwire.AssistantAnswer, error) {
		return erpwire.AssistantAnswer{}, problem(502, "invalid_answer", "The local model's answer could not be checked against its actual evidence. Nothing was saved.")
	}
	var value any
	if strictJSON([]byte(raw), &value) != nil || validateSchema(answerSchema(e), value) != nil {
		return invalid()
	}
	byID := map[string]erpwire.AssistantSource{}
	allFacts := map[string]bool{}
	for _, source := range e.sources {
		byID[source.ID] = source
		for _, fact := range source.Facts {
			allFacts[fact.ID] = true
		}
	}
	validateRefs := func(ids, factIDs []string, quotes []erpwire.Quote) error {
		facts := map[string]bool{}
		for _, id := range ids {
			source, ok := byID[id]
			if !ok {
				return errors.New("unknown source")
			}
			for _, f := range source.Facts {
				facts[f.ID] = true
			}
		}
		for _, id := range factIDs {
			if !facts[id] {
				return errors.New("mismatched fact ownership")
			}
		}
		for _, q := range quotes {
			source, ok := byID[q.SourceID]
			text, read := e.documents[q.SourceID]
			if !ok || source.Kind != "document" || !contains(ids, q.SourceID) || !read || q.Text == "" || utf16Length(q.Text) > 600 || !strings.Contains(text, q.Text) {
				return errors.New("quote was not read verbatim from the cited range")
			}
		}
		return nil
	}
	if e.hasKind("erp") {
		var plan erpwire.ReviewPlan
		if strictJSON([]byte(raw), &plan) != nil {
			return invalid()
		}
		for _, id := range plan.FactIDs {
			if !allFacts[id] {
				return invalid()
			}
		}
		answer := erpwire.AssistantAnswer{Kind: "erp-review", Summary: "Authorized ERP source data and proposed human review checks. This chat does not modify records.", Findings: []erpwire.Finding{}, FactIDs: plan.FactIDs, NextActions: []string{}, Limitations: []string{}}
		if plan.Language == "th" {
			answer.Summary = "ข้อมูล ERP ที่อ่านตามสิทธิ์และข้อเสนองานให้คนตรวจ แชทนี้ไม่แก้ไขรายการ"
		}
		for _, task := range plan.Tasks {
			action, ok := reviewActions[task.Action]
			if !ok || len(task.SourceIDs) == 0 || validateRefs(task.SourceIDs, task.FactIDs, task.Quotes) != nil {
				return invalid()
			}
			accepts := false
			for _, id := range task.SourceIDs {
				if actionAccepts(action, byID[id]) {
					accepts = true
				}
			}
			if !accepts {
				return invalid()
			}
			text := action.English
			if plan.Language == "th" {
				text = action.Thai
			}
			answer.Findings = append(answer.Findings, erpwire.Finding{Text: text, SourceIDs: task.SourceIDs, FactIDs: task.FactIDs, Quotes: task.Quotes})
		}
		return answer, nil
	}
	var model struct {
		Summary     string            `json:"summary"`
		Findings    []erpwire.Finding `json:"findings"`
		NextActions []string          `json:"nextActions"`
		Limitations []string          `json:"limitations"`
	}
	if strictJSON([]byte(raw), &model) != nil || len(model.Limitations) != 0 {
		return invalid()
	}
	var quoted []erpwire.Quote
	for _, f := range model.Findings {
		if (len(e.sources) > 0 && len(f.SourceIDs) == 0) || validateRefs(f.SourceIDs, f.FactIDs, f.Quotes) != nil || !validProse(f.Text, 1200, f.Quotes, e) {
			return invalid()
		}
		document := false
		for _, id := range f.SourceIDs {
			if byID[id].Kind == "document" {
				document = true
			}
		}
		if document && len(f.Quotes) == 0 {
			return invalid()
		}
		quoted = append(quoted, f.Quotes...)
	}
	if !validProse(model.Summary, 1600, quoted, e) {
		return invalid()
	}
	for _, action := range model.NextActions {
		if !validProse(action, 600, quoted, e) {
			return invalid()
		}
	}
	return erpwire.AssistantAnswer{Kind: "guidance", Summary: strings.TrimSpace(model.Summary), Findings: model.Findings, FactIDs: []string{}, NextActions: model.NextActions, Limitations: []string{}}, nil
}
