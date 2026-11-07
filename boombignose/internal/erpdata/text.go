package erpdata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
)

func hash(s string) string { b := sha256.Sum256([]byte(s)); return hex.EncodeToString(b[:]) }

var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func textValue(v any) (string, error) {
	if s, ok := v.(string); ok {
		if !utf8.ValidString(s) {
			return "", errors.New("invalid UTF-8 business source")
		}
		return s, nil
	}
	b, err := json.Marshal(v)
	return string(b), err
}

// TextSlice ranges use Unicode code points, never byte or UTF-16 offsets.
func TextSlice(text string, offset, length int) (map[string]any, error) {
	if !utf8.ValidString(text) || offset < 0 || length < 1 || length > 2048 {
		return nil, errors.New("invalid text range")
	}
	total := utf8.RuneCountInString(text)
	if offset > total {
		return nil, errors.New("text offset exceeds source length")
	}
	next := offset + length
	if next < offset || next > total {
		next = total
	}
	start, end := len(text), len(text)
	pos := 0
	for i := range text {
		if pos == offset {
			start = i
		}
		if pos == next {
			end = i
		}
		pos++
	}
	slice := text[start:end]
	return map[string]any{"text": slice, "offset_unit": "unicode-code-points", "offset": offset, "length": next - offset, "next_offset": next, "total_length": total, "has_more": next < total, "partial": offset != 0 || next < total, "sha256": hash(text), "text_sha256": hash(slice)}, nil
}
func project(row erpwire.Row, e entity, fields []string) (erpwire.Row, error) {
	out := erpwire.Row{}
	record := map[string]any{}
	for _, k := range e.PrimaryKey {
		if row[k] == nil {
			return nil, errors.New("business record identity is incomplete")
		}
		record[k] = row[k]
	}
	pointers := map[string]any{}
	for _, k := range fields {
		f, ok := e.field(k)
		if !ok {
			return nil, errors.New("unknown projection")
		}
		v, ok := row[k]
		if !ok {
			return nil, fmt.Errorf("business source omitted %s", k)
		}
		if v != nil && (f.Kind == "integer" || f.Kind == "money-in-satang") {
			n, err := integer(v)
			if err != nil {
				return nil, err
			}
			v = n
		}
		if v != nil && f.Kind == "number" {
			n, err := strconv.ParseFloat(fmt.Sprint(v), 64)
			if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				return nil, errors.New("invalid business numeric source")
			}
		}
		if e.Key == "saved_views" && k == "config" {
			v = savedConfig(v)
		}
		if v != nil && f.TextReadable {
			text, err := textValue(v)
			if err != nil {
				return nil, err
			}
			if utf8.RuneCountInString(text) > 512 || f.Kind == "json" || f.Kind == "text-array" {
				slice, _ := TextSlice(text, 0, 256)
				out[k] = slice["text"]
				format := "text"
				if f.Kind == "json" || f.Kind == "text-array" {
					format = "json"
				}
				pointers[k] = map[string]any{"preview": true, "format": format, "total_length": slice["total_length"], "offset_unit": slice["offset_unit"], "sha256": slice["sha256"], "retrieved_length": slice["length"], "has_more": slice["has_more"], "read": map[string]any{"tool": "erp_data_text", "entity": e.Key, "record": record, "field": k, "offset": 0, "expected_sha256": slice["sha256"]}}
				continue
			}
		}
		out[k] = v
	}
	if len(pointers) > 0 {
		out["_text"] = pointers
	}
	return out, nil
}
func (r *Reader) text(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, e entity, args map[string]any) (erpwire.ToolResult, error) {
	var out erpwire.ToolResult
	if err := allowed(args, "entity", "record", "field", "offset", "length", "expected_sha256"); err != nil {
		return out, err
	}
	offset, err := bound(args, "offset", 0, 0, int(erpwire.MaxSafeInteger))
	if err != nil {
		return out, err
	}
	length, err := bound(args, "length", 1500, 1, 2048)
	if err != nil {
		return out, err
	}
	expected, err := str(args, "expected_sha256", 64, false)
	if err != nil {
		return out, err
	}
	if _, ok := args["expected_sha256"]; ok && !hashPattern.MatchString(expected) {
		return out, errors.New("invalid source hash")
	}
	record, ok := args["record"].(map[string]any)
	if !ok || len(record) != len(e.PrimaryKey) {
		return out, errors.New("complete catalog primaryKey required")
	}
	for _, k := range e.PrimaryKey {
		if record[k] == nil || !scalar(record[k]) {
			return out, errors.New("invalid record identity")
		}
	}
	key, err := str(args, "field", 100, true)
	if err != nil {
		return out, err
	}
	f, known := e.field(key)
	attachment := e.Key == "record_attachments" && key == "content"
	if !attachment && (!known || !f.TextReadable) {
		return out, errors.New("field is not text-readable")
	}
	metadata := e
	metadata.Fields = []field{f}
	if attachment {
		metadata.Fields = []field{{Key: "content", LabelEn: "Retained attachment content", LabelTh: "เนื้อหาไฟล์แนบ", Kind: "text", TextReadable: true}}
	}
	var text string
	var doc *erpwire.DocumentText
	if attachment {
		if r.documents == nil {
			return out, errors.New("retained attachment DocumentReader is not configured")
		}
		id, ok := record["id"].(string)
		if !ok || uuid.Validate(id) != nil {
			return out, errors.New("invalid attachment ID")
		}
		got, err := r.documents.ReadDocument(ctx, a, id)
		if err != nil {
			return out, err
		}
		if !utf8.ValidString(got.Text) || !hashPattern.MatchString(got.OriginalSHA256) {
			return out, errors.New("invalid authorized document provenance")
		}
		doc = &got
		text = got.Text
	} else {
		q, err := e.validate(a, map[string]any{"fields": []any{key}, "filters": record, "limit": json.Number("1")})
		if err != nil {
			return out, err
		}
		got, err := r.selectRows(ctx, tx, a, e, q)
		if err != nil {
			return out, err
		}
		if got.Total == nil || *got.Total != 1 || len(got.Rows) != 1 {
			return out, erpwire.ErrNotFound
		}
		if _, err := project(got.Rows[0], e, q.fields); err != nil {
			return out, err
		}
		value := got.Rows[0][key]
		if e.Key == "saved_views" && key == "config" {
			value = savedConfig(value)
		}
		if value == nil {
			if offset != 0 || expected != "" {
				return out, errors.New("null source changed or invalid offset")
			}
			out, err = result(map[string]any{"org_id": a.OrgID(), "entity": e, "record": record, "field": key, "value": nil, "text": nil, "total_length": 0, "offset_unit": "unicode-code-points", "offset": 0, "length": 0, "next_offset": 0, "has_more": false, "partial": false, "sha256": nil, "text_sha256": nil})
			if err == nil {
				out.Evidence = []erpwire.Evidence{r.textEvidence(a, e, record, key, "", false, out.Content, false)}
			}
			return out, err
		}
		text, err = textValue(value)
		if err != nil {
			return out, err
		}
	}
	slice, err := TextSlice(text, offset, length)
	if err != nil {
		return out, err
	}
	if expected != "" && slice["sha256"] != expected {
		return out, errors.New("source changed since previous read; restart from offset zero")
	}
	slice["org_id"] = a.OrgID()
	slice["entity"] = metadata
	slice["record"] = record
	slice["field"] = key
	if doc != nil {
		slice["filename"] = doc.Filename
		slice["content_type"] = doc.MediaType
		slice["original_sha256"] = doc.OriginalSHA256
		slice["extraction"] = map[string]any{"method": doc.Model, "partial": doc.Partial, "limitations": doc.Warnings}
		slice["partial"] = slice["partial"].(bool) || doc.Partial
		out.Limitations = append(out.Limitations, doc.Warnings...)
	}
	res, err := result(slice)
	if err != nil {
		return out, err
	}
	res.Limitations = out.Limitations
	res.Evidence = []erpwire.Evidence{r.textEvidence(a, e, record, key, slice["text"].(string), slice["partial"].(bool), res.Content, true)}
	return res, nil
}
func savedConfig(v any) map[string]any {
	out := map[string]any{}
	var source map[string]any
	switch x := v.(type) {
	case map[string]any:
		source = x
	case erpwire.Row:
		source = map[string]any(x)
	}
	for _, k := range []string{"q", "status", "stage", "period", "mine", "groupBy", "warehouse", "product", "sourceId"} {
		if s, ok := source[k].(string); ok {
			out[k] = s
		}
	}
	return out
}
