package localai

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type evidenceSet struct {
	sources            []erpwire.AssistantSource
	byKey              map[string]int
	documents          map[string]string
	erpCount, docCount int
	question           string
}

func newEvidence(question string) *evidenceSet {
	return &evidenceSet{sources: []erpwire.AssistantSource{}, byKey: map[string]int{}, documents: map[string]string{}, question: question}
}
func (s *evidenceSet) hasKind(kind string) bool {
	for _, source := range s.sources {
		if source.Kind == kind {
			return true
		}
	}
	return false
}
func safeHref(href string) bool {
	if href == "" {
		return true
	}
	if !strings.HasPrefix(href, "/") || strings.HasPrefix(href, "//") || strings.ContainsAny(href, "\\") || strings.Contains(href, "://") {
		return false
	}
	for _, r := range href {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

func (s *evidenceSet) add(key string, source erpwire.AssistantSource, read *erpwire.ReadText) (erpwire.AssistantSource, error) {
	if index, ok := s.byKey[key]; ok {
		return s.sources[index], nil
	}
	if key == "" || source.ID != "" || (source.Kind != "erp" && source.Kind != "document") || !safeHref(source.Href) {
		return erpwire.AssistantSource{}, errors.New("invalid source identity")
	}
	if source.Kind == "document" && (read == nil || read.Text == "") {
		return erpwire.AssistantSource{}, errors.New("document evidence requires actual read text")
	}
	if source.Kind == "document" {
		s.docCount++
		source.ID = fmt.Sprintf("doc-%d", s.docCount)
	} else {
		s.erpCount++
		source.ID = fmt.Sprintf("erp-%d", s.erpCount)
	}
	if source.ObservedAt.IsZero() {
		source.ObservedAt = time.Now().UTC()
	}
	if source.Facts == nil {
		source.Facts = []erpwire.SourceFact{}
	}
	if source.Records == nil {
		source.Records = []erpwire.SourceRecord{}
	}
	ids := map[string]string{}
	source.Facts = append([]erpwire.SourceFact{}, source.Facts...)
	for i := range source.Facts {
		f := &source.Facts[i]
		if f.ID == "" || ids[f.ID] != "" || !safeHref(f.Href) {
			return erpwire.AssistantSource{}, errors.New("invalid source fact")
		}
		ids[f.ID] = source.ID + ":" + f.ID
		f.ID = ids[f.ID]
	}
	prefix := func(values []string) ([]string, error) {
		out := make([]string, 0, len(values))
		for _, id := range values {
			mapped, ok := ids[id]
			if !ok {
				return nil, errors.New("coverage fact missing from source")
			}
			out = append(out, mapped)
		}
		return out, nil
	}
	var err error
	source.RequiredFactIDs, err = prefix(source.RequiredFactIDs)
	if err != nil {
		return erpwire.AssistantSource{}, err
	}
	if source.Coverage != nil {
		factIDs, err := prefix(source.Coverage.FactIDs)
		if err != nil {
			return erpwire.AssistantSource{}, err
		}
		source.Coverage = &erpwire.Coverage{FactIDs: factIDs, Partial: source.Coverage.Partial}
	}
	for _, record := range source.Records {
		if !safeHref(record.Href) {
			return erpwire.AssistantSource{}, errors.New("invalid record link")
		}
	}
	for _, n := range []*int64{source.Total, source.Returned} {
		if n != nil && (*n < 0 || *n > erpwire.MaxSafeInteger) {
			return erpwire.AssistantSource{}, errors.New("invalid source count")
		}
	}
	if source.Kind == "document" {
		if !utf8.ValidString(read.Text) {
			return erpwire.AssistantSource{}, errors.New("invalid document UTF-8")
		}
		source.TextSHA256 = hashText(read.Text)
		source.Partial = source.Partial || read.Partial
		if read.Label != "" {
			source.Label = read.Label
		}
		if !read.ObservedAt.IsZero() {
			source.ObservedAt = read.ObservedAt
		}
		returned := int64(utf16Length(read.Text))
		source.Returned = &returned
		s.documents[source.ID] = read.Text
	}
	referenceEvidence(&source, s.question)
	s.byKey[key] = len(s.sources)
	s.sources = append(s.sources, source)
	return source, nil
}
func (s *evidenceSet) collect(result erpwire.ToolResult) ([]erpwire.AssistantSource, error) {
	added := []erpwire.AssistantSource{}
	if result.MetadataOnly {
		return added, nil
	}
	for _, e := range result.Evidence {
		source, err := s.add("source:"+e.Key, e.Source, e.ReadText)
		if err != nil {
			return nil, err
		}
		added = append(added, source)
		if e.Source.Kind == "erp" && e.ReadText != nil && e.ReadText.Text != "" {
			doc := erpwire.AssistantSource{Kind: "document", Label: e.ReadText.Label, Partial: e.ReadText.Partial, ObservedAt: e.ReadText.ObservedAt, Records: []erpwire.SourceRecord{}, Facts: []erpwire.SourceFact{}}
			source, err = s.add("text:"+e.Key, doc, e.ReadText)
			if err != nil {
				return nil, err
			}
			added = append(added, source)
		}
	}
	return added, nil
}

var referenceUUID = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)

func referenceEvidence(source *erpwire.AssistantSource, question string) {
	if source.Kind != "erp" {
		return
	}
	for _, reference := range uniqueStrings(referenceUUID.FindAllString(strings.ToLower(question), -1)) {
		id := source.ID + ":reference:" + reference
		present := false
		href := ""
		for _, record := range source.Records {
			if strings.HasSuffix(strings.ToLower(record.Href), "/"+reference) {
				present = true
				href = record.Href
				break
			}
		}
		for _, recordID := range source.RecordIDs {
			if strings.EqualFold(recordID, reference) {
				present = true
			}
		}
		for _, fact := range source.Facts {
			if strings.Contains(strings.ToLower(fact.ID), ":row:"+reference+":") {
				present = true
			}
		}
		presence, value := "not-returned", "Not returned in this scoped read / ไม่พบในผลอ่านตามขอบเขตนี้"
		if present {
			presence, value = "present", "Present in this read / พบในผลอ่านนี้"
		} else if source.Partial || (source.Coverage != nil && source.Coverage.Partial) {
			presence, value = "partial", "Not returned; source is partial / ยังไม่พบในข้อมูลบางส่วน"
		}
		source.Facts = append(source.Facts, erpwire.SourceFact{ID: id, Label: erpwire.Label{English: "Requested record reference " + reference, Thai: "ตรวจเลขอ้างอิง " + reference}, Value: value, Scope: "matching-records", RecordPresence: presence, Href: href})
		source.RequiredFactIDs = append(source.RequiredFactIDs, id)
	}
}

// answerText retains latest mandatory receivables coverage even if the model
// chooses fewer facts. Every amount, status, date, link and factual table value
// comes from the authorized source projection, never model arithmetic/prose.
func answerText(answer erpwire.AssistantAnswer, sources []erpwire.AssistantSource) string {
	parts := []string{}
	erp := false
	selected := map[string]bool{}
	for _, id := range answer.FactIDs {
		selected[id] = true
	}
	for _, f := range answer.Findings {
		for _, id := range f.FactIDs {
			selected[id] = true
		}
	}
	latestCoverage := -1
	for i, s := range sources {
		if s.Kind == "erp" {
			erp = true
		}
		if s.Coverage != nil {
			latestCoverage = i
		}
		for _, id := range s.RequiredFactIDs {
			selected[id] = true
		}
	}
	if !erp {
		parts = append(parts, "No workspace records were retrieved for this answer. Attachments and guidance are not evidence of current ERP balances.")
	}
	parts = append(parts, answer.Summary)
	for _, f := range answer.Findings {
		text := f.Text
		if len(f.SourceIDs) > 0 {
			text += " [" + strings.Join(f.SourceIDs, ", ") + "]"
		}
		parts = append(parts, text)
	}
	seen := map[string]bool{}
	add := func(s erpwire.AssistantSource, f erpwire.SourceFact) {
		metric := f.ID
		if at := strings.LastIndex(metric, ":"); at >= 0 {
			metric = metric[at+1:]
		}
		key := f.ID
		if f.Href != "" {
			key = "record:" + f.Href + ":" + metric + ":" + f.Value
		} else if f.Scope == "workspace" {
			key = "workspace:" + metric + ":" + f.Value
		}
		if !seen[key] {
			seen[key] = true
			parts = append(parts, f.Label.English+": "+f.Value+" ["+s.ID+"]")
		}
	}
	if latestCoverage >= 0 {
		s := sources[latestCoverage]
		required := map[string]bool{}
		for _, id := range s.Coverage.FactIDs {
			required[id] = true
		}
		for _, f := range s.Facts {
			if required[f.ID] {
				add(s, f)
			}
		}
	}
	for _, s := range sources {
		for _, f := range s.Facts {
			if selected[f.ID] {
				add(s, f)
			}
		}
	}
	for _, f := range answer.Findings {
		for _, q := range f.Quotes {
			parts = append(parts, "“"+q.Text+"” ["+q.SourceID+"; unreviewed attachment]")
		}
	}
	for _, action := range answer.NextActions {
		parts = append(parts, "→ "+action)
	}
	for _, limitation := range answer.Limitations {
		parts = append(parts, "! "+limitation)
	}
	return strings.Join(parts, "\n\n")
}
