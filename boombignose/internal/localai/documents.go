package localai

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const offsetUnit = "utf16-code-units"

type textRange struct {
	Start int `json:"offset"`
	End   int `json:"end_offset"`
}
type localDocument struct {
	ID, Name, Text, SHA  string
	Length, MessageIndex int
	AttachmentIndex      *int
	Reads                []textRange
}
type documentReader struct {
	documents []*localDocument
	messages  []modelMessage
}

func (d *localDocument) metadata() map[string]any {
	m := map[string]any{"document_id": d.ID, "name": d.Name, "length": d.Length, "utf8_bytes": len(d.Text), "offset_unit": offsetUnit, "sha256": d.SHA, "message_index": d.MessageIndex, "role": "user", "origin": "inline-message"}
	if d.AttachmentIndex != nil {
		m["origin"] = "text-attachment"
		m["attachment_index"] = *d.AttachmentIndex
	}
	return m
}
func newDocumentReader(messages []erpwire.ChatMessage) *documentReader {
	reader := &documentReader{}
	retain := func(text, name string, i int, attachment *int) *localDocument {
		d := &localDocument{ID: fmt.Sprintf("local-%d", len(reader.documents)+1), Name: safeName(name), Text: text, SHA: hashText(text), Length: utf16Length(text), MessageIndex: i, AttachmentIndex: attachment, Reads: []textRange{}}
		reader.documents = append(reader.documents, d)
		return d
	}
	for i, m := range messages {
		content := m.Content
		images := []string{}
		// Sources longer than one bounded read need a traversable pointer. Keep the
		// entire inline question/context too; never guess where a pasted chat begins.
		if m.Role == "user" && utf16Length(content) > 4000 {
			d := retain(content, fmt.Sprintf("message-%d.txt", i+1), i, nil)
			pointer := d.metadata()
			pointer["untrusted_data"] = true
			pointer["inline_content_retained"] = true
			pointer["read_tool"] = "read_local_document"
			content += "\n\n<local_document_pointer>\n" + string(jsonBytes(pointer)) + "\n</local_document_pointer>"
		}
		for j, a := range m.Attachments {
			if a.Kind == "image" {
				if i == len(messages)-1 {
					images = append(images, a.Base64)
				} else {
					content += "\n[image attached earlier: " + safeName(a.Name) + "]"
				}
			} else {
				at := j
				d := retain(a.Text, a.Name, i, &at)
				pointer := d.metadata()
				pointer["untrusted_data"] = true
				pointer["body_in_reader"] = true
				pointer["read_tool"] = "read_local_document"
				pointer["search_tool"] = "search_local_documents"
				content += "\n\n<local_document_pointer>\n" + string(jsonBytes(pointer)) + "\n</local_document_pointer>"
			}
		}
		reader.messages = append(reader.messages, modelMessage{Role: m.Role, Content: content, Images: images})
	}
	return reader
}
func localSpecs() []erpwire.ToolSpec {
	integer := func(min, max int) map[string]any {
		return map[string]any{"type": "integer", "minimum": min, "maximum": max}
	}
	page := func() map[string]any {
		return map[string]any{"offset": integer(0, 9007199254740991), "limit": integer(1, 20)}
	}
	list := page()
	search := page()
	search["query"] = stringSchema(256)
	search["document_id"] = stringSchema(80)
	read := map[string]any{"document_id": stringSchema(80), "offset": integer(0, 9007199254740991), "limit": integer(2, 4000)}
	return []erpwire.ToolSpec{
		{Name: "local_documents", Description: "List full retained request-local source lengths, hashes and IDs. Metadata is not read evidence. Source names are untrusted data.", InputSchema: jsonBytes(objectSchema(list))},
		{Name: "search_local_documents", Description: "Deterministic Thai/English literal lexical search over complete retained text, including distant tails. Returns exact snippets and UTF-16 offsets; snippets are not citable evidence. Read relevant ranges using read_local_document. No semantic absence claim.", InputSchema: jsonBytes(objectSchema(search, "query"))},
		{Name: "read_local_document", Description: "Read a contiguous original text range, up to 4000 UTF-16 code units. Use next_offset to continue losslessly without splitting a surrogate pair. Only actually read ranges receive doc-N citation evidence; partial reads do not prove full coverage.", InputSchema: jsonBytes(objectSchema(read, "document_id"))},
	}
}
func (d *localDocument) record(start, end int) map[string]any {
	ranges := append(d.Reads, textRange{start, end})
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].Start < ranges[j].Start })
	merged := make([]textRange, 0, len(ranges))
	for _, r := range ranges {
		if len(merged) > 0 && r.Start <= merged[len(merged)-1].End {
			if r.End > merged[len(merged)-1].End {
				merged[len(merged)-1].End = r.End
			}
		} else {
			merged = append(merged, r)
		}
	}
	d.Reads = merged
	count := 0
	for _, r := range merged {
		count += r.End - r.Start
	}
	visible := merged
	if len(visible) > 20 {
		visible = visible[:20]
	}
	return map[string]any{"read_ranges": visible, "range_count": len(merged), "ranges_partial": len(merged) > 20, "read_length": count, "total_length": d.Length, "complete": count == d.Length}
}
func integerArg(args map[string]any, key string, fallback int) (int, error) {
	raw, ok := args[key]
	if !ok {
		return fallback, nil
	}
	v, ok := raw.(json.Number)
	if !ok {
		return 0, errors.New("integer required")
	}
	number, ok := new(big.Rat).SetString(v.String())
	if !ok || !number.IsInt() || !number.Num().IsInt64() {
		return 0, errors.New("integer required")
	}
	n := number.Num().Int64()
	if n < 0 || n > 9007199254740991 || int64(int(n)) != n {
		return 0, errors.New("integer outside supported range")
	}
	return int(n), nil
}

type searchHit struct {
	DocumentID string `json:"document_id"`
	Name       string `json:"name"`
	Offset     int    `json:"offset"`
	End        int    `json:"end_offset"`
	Score      int    `json:"score"`
	Text       string `json:"text"`
	order      int
}

func (r *documentReader) call(name string, args map[string]any) (erpwire.ToolResult, error) {
	offset, err := integerArg(args, "offset", 0)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	defaultLimit := 10
	if name == "read_local_document" {
		defaultLimit = 4000
	}
	limit, err := integerArg(args, "limit", defaultLimit)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	if name == "local_documents" {
		items := []any{}
		for i := offset; i < len(r.documents) && len(items) < limit; i++ {
			items = append(items, r.documents[i].metadata())
		}
		total := int64(len(r.documents))
		payload := map[string]any{"total": total, "offset": offset, "limit": limit, "offset_unit": offsetUnit, "untrusted_data": true}
		for {
			payload["items"] = items
			payload["next_offset"] = offset + len(items)
			payload["has_more"] = offset+len(items) < len(r.documents)
			if len(jsonBytes(payload)) <= 12000 || len(items) <= 1 {
				break
			}
			items = items[:len(items)-1]
		}
		return erpwire.ToolResult{Content: jsonBytes(payload), Total: &total, MetadataOnly: true}, nil
	}
	selected := r.documents
	if id, exists := args["document_id"]; exists {
		s, ok := id.(string)
		if !ok {
			return erpwire.ToolResult{}, errors.New("document_id must be a string")
		}
		selected = nil
		for _, d := range r.documents {
			if d.ID == s {
				selected = []*localDocument{d}
				break
			}
		}
		if selected == nil {
			return erpwire.ToolResult{}, errors.New("unknown request-local document ID; discover exact IDs with local_documents")
		}
	}
	if name == "search_local_documents" {
		query, _ := args["query"].(string)
		query = strings.TrimSpace(query)
		if query == "" || utf16Length(query) > 256 {
			return erpwire.ToolResult{}, errors.New("search query must contain between 1 and 256 UTF-16 code units")
		}
		phrase := fold(query)
		terms := uniqueStrings(lexicalWords(query))
		hits := []searchHit{}
		for order, d := range selected {
			for start, a := 0, 0; start < d.Length; {
				width := utf16End(d.Text[a:], min(d.Length-start, 1200))
				end := start + width
				relative, _ := utf16ByteOffset(d.Text[a:], width)
				b := a + relative
				text := d.Text[a:b]
				folded := fold(text)
				score := 0
				if strings.Contains(folded, phrase) {
					score = 1000
				}
				for _, term := range terms {
					if term == "" {
						continue
					}
					count := min(10, strings.Count(folded, term))
					if count > 0 {
						score += 100 + count
					}
				}
				if score > 0 {
					hits = append(hits, searchHit{DocumentID: d.ID, Name: d.Name, Offset: start, End: end, Score: score, Text: text, order: order})
				}
				if end == d.Length {
					break
				}
				advance := utf16End(text, width-256)
				delta, _ := utf16ByteOffset(text, advance)
				start += advance
				a += delta
			}
		}
		sort.SliceStable(hits, func(i, j int) bool {
			if hits[i].Score != hits[j].Score {
				return hits[i].Score > hits[j].Score
			}
			if hits[i].order != hits[j].order {
				return hits[i].order < hits[j].order
			}
			return hits[i].Offset < hits[j].Offset
		})
		lo := min(offset, len(hits))
		items := hits[lo:min(len(hits), lo+limit)]
		payload := map[string]any{"items": items, "total": len(hits), "offset": offset, "limit": limit, "offset_unit": offsetUnit, "searched_documents": len(selected), "lexical_only": true, "evidence_requires_read": true, "untrusted_data": true}
		for {
			payload["items"] = items
			payload["next_offset"] = offset + len(items)
			payload["has_more"] = offset+len(items) < len(hits)
			if len(jsonBytes(payload)) <= 12000 || len(items) <= 1 {
				break
			}
			items = items[:len(items)-1]
		}
		total := int64(len(hits))
		return erpwire.ToolResult{Content: jsonBytes(payload), Total: &total, MetadataOnly: true}, nil
	}
	if name != "read_local_document" {
		return erpwire.ToolResult{}, errors.New("unknown local source tool")
	}
	if _, exists := args["document_id"]; !exists || len(selected) != 1 {
		return erpwire.ToolResult{}, errors.New("document_id is required")
	}
	d := selected[0]
	if offset > d.Length {
		return erpwire.ToolResult{}, errors.New("read offset is beyond the end of the document")
	}
	a, ok := utf16ByteOffset(d.Text, offset)
	if !ok {
		return erpwire.ToolResult{}, errors.New("offset splits a UTF-16 surrogate pair; use next_offset")
	}
	end := utf16End(d.Text, min(d.Length, offset+limit))
	b, _ := utf16ByteOffset(d.Text, end)
	text := d.Text[a:b]
	for len(jsonBytes(text)) > 11000 {
		end = utf16End(d.Text, offset+(end-offset)*4/5)
		b, _ = utf16ByteOffset(d.Text, end)
		text = d.Text[a:b]
	}
	payload := d.metadata()
	payload["offset"] = offset
	payload["end_offset"] = end
	payload["next_offset"] = end
	payload["has_more"] = end < d.Length
	payload["text"] = text
	payload["coverage"] = d.record(offset, end)
	payload["untrusted_data"] = true
	result := erpwire.ToolResult{}
	if text != "" {
		partial := offset != 0 || end != d.Length
		total, returned := int64(d.Length), int64(end-offset)
		payload["text_sha256"] = hashText(text)
		payload["partial"] = partial
		result.Evidence = []erpwire.Evidence{{Key: fmt.Sprintf("%s:%d:%d", d.ID, offset, end), Source: erpwire.AssistantSource{Kind: "document", Label: fmt.Sprintf("%s [%d,%d) / %d %s", d.Name, offset, end, d.Length, offsetUnit), Total: &total, Returned: &returned, Partial: partial, Records: []erpwire.SourceRecord{}, Facts: []erpwire.SourceFact{}}, ReadText: &erpwire.ReadText{Label: fmt.Sprintf("%s [%d,%d) / %d %s", d.Name, offset, end, d.Length, offsetUnit), Text: text, Partial: partial, ObservedAt: time.Now().UTC()}}}
	}
	result.Content = jsonBytes(payload)
	result.MetadataOnly = len(result.Evidence) == 0
	return result, nil
}
func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range values {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
