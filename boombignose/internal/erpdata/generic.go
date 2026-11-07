package erpdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (r *Reader) catalog(a erpwire.Actor, args map[string]any) (erpwire.ToolResult, error) {
	if err := allowed(args, "entity", "search", "limit", "offset"); err != nil {
		return erpwire.ToolResult{}, err
	}
	key, err := str(args, "entity", 100, false)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	search, err := str(args, "search", 500, false)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	if _, present := args["entity"]; present && key == "" {
		return erpwire.ToolResult{}, errors.New("unknown catalog entity")
	}
	limit, err := bound(args, "limit", 10, 1, 100)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	offset, err := bound(args, "offset", 0, 0, 1000000)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	items := []any{}
	total := 0
	for _, e := range r.entities {
		if key != "" && e.Key != key {
			continue
		}
		if key == "" && !strings.Contains(strings.ToLower(e.Key+" "+e.LabelEn+" "+e.LabelTh), strings.ToLower(search)) {
			continue
		}
		total++
		if key == "" && (total <= offset || len(items) >= limit) {
			continue
		}
		m := map[string]any{"key": e.Key, "labelEn": e.LabelEn, "labelTh": e.LabelTh, "available": e.available(a), "requiredCapability": e.RequiredCapability, "scope": e.Scope}
		if e.Reason != "" {
			m["reason"] = e.Reason
		}
		if key == "" {
			m["field_count"] = len(e.Fields)
			m["inspect"] = map[string]any{"tool": "erp_data_catalog", "entity": e.Key}
		} else {
			m["fields"] = e.Fields
			m["primaryKey"] = e.PrimaryKey
			m["exclusions"] = e.Exclusions
			m["excludedFields"] = e.ExcludedFields
			m["route"] = e.Route
			m["financialAuthority"] = e.FinancialAuthority
			m["text_access"] = "erp_data_text; Unicode-code-point offsets; complete primaryKey"
			if e.Key == "record_attachments" {
				m["attachment_content"] = map[string]any{"configured": r.documents != nil, "field": "content", "requires": "DocumentReader reauthorizes attachment and parent and validates original bytes; MIME/extension alone never authorizes extraction", "formats": "determined by configured DocumentReader; unsupported formats return errors"}
				if r.documents != nil {
					fields := make([]any, 0, len(e.Fields)+1)
					for _, f := range e.Fields {
						fields = append(fields, f)
					}
					fields = append(fields, map[string]any{"key": "content", "labelEn": "Retained attachment content", "labelTh": "เนื้อหาไฟล์แนบ", "kind": "text", "textReadable": true, "virtual": true, "readWith": "erp_data_text"})
					m["fields"] = fields
				}
			}
		}
		items = append(items, m)
	}
	if key != "" {
		if total == 0 {
			return erpwire.ToolResult{}, errors.New("unknown catalog entity")
		}
		limit = 1
		offset = 0
	}
	out, err := result(map[string]any{"org_id": a.OrgID(), "total_entities": len(r.entities), "items": items, "total": total, "limit": limit, "offset": offset, "has_more": offset+len(items) < total})
	out.MetadataOnly = true
	return out, err
}

type request struct {
	fields              []string
	filters             map[string]any
	search, searchField string
	limit, offset       int
}

func (e entity) field(k string) (field, bool) {
	for _, f := range e.Fields {
		if f.Key == k {
			return f, true
		}
	}
	return field{}, false
}
func scalar(v any) bool {
	switch x := v.(type) {
	case nil, bool:
		return true
	case string:
		return utf8.ValidString(x) && utf8.RuneCountInString(x) <= 2000
	case json.Number:
		if !strings.ContainsAny(string(x), ".eE") {
			_, err := integer(x)
			return err == nil
		}
		_, err := x.Float64()
		return err == nil
	}
	return false
}
func (e entity) validate(a erpwire.Actor, args map[string]any) (request, error) {
	q := request{filters: map[string]any{}}
	var err error
	q.limit, err = bound(args, "limit", 25, 1, 100)
	if err != nil {
		return q, err
	}
	q.offset, err = bound(args, "offset", 0, 0, 1000000)
	if err != nil {
		return q, err
	}
	seen := map[string]bool{}
	add := func(k string) {
		if !seen[k] {
			q.fields = append(q.fields, k)
			seen[k] = true
		}
	}
	for _, k := range e.PrimaryKey {
		add(k)
	}
	if v, ok := args["fields"]; ok {
		fs, ok := v.([]any)
		if !ok || len(fs) == 0 {
			return q, errors.New("fields must be a nonempty array")
		}
		input := map[string]bool{}
		for _, v := range fs {
			k, ok := v.(string)
			_, known := e.field(k)
			if !ok || !known || input[k] {
				return q, errors.New("fields must be unique catalog keys")
			}
			input[k] = true
			add(k)
		}
	} else {
		for _, f := range e.Fields {
			add(f.Key)
		}
	}
	if v, ok := args["filters"]; ok {
		fs, ok := v.(map[string]any)
		if !ok || len(fs) > 8 {
			return q, errors.New("invalid equality filters")
		}
		for k, v := range fs {
			f, ok := e.field(k)
			if !ok || f.Kind == "json" || f.Kind == "text-array" || !scalar(v) {
				return q, errors.New("invalid equality filter")
			}
			if (k == "org_id" || (e.Key == "organizations" && k == "id")) && v != a.OrgID() {
				return q, erpwire.ErrForbidden
			}
			if v != nil && (f.Kind == "integer" || f.Kind == "money-in-satang") {
				if _, err := integer(v); err != nil {
					return q, err
				}
			}
			q.filters[k] = v
		}
	}
	q.search, err = str(args, "search", 500, false)
	if err != nil {
		return q, err
	}
	q.searchField, err = str(args, "search_field", 100, false)
	if err != nil {
		return q, err
	}
	if _, ok := args["search"]; ok {
		f, found := e.field(q.searchField)
		if q.search == "" || strings.Contains(q.search, "*") || !found || !f.Searchable {
			return q, errors.New("search requires an allowlisted searchable text field")
		}
	} else if _, ok := args["search_field"]; ok {
		return q, errors.New("search_field requires search")
	}
	return q, nil
}
func (r *Reader) selectRows(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, e entity, q request) (erpwire.Selection, error) {
	if e.Key == "profiles" || e.Key == "finance_lock_reopen_requests" {
		return rpcRows(ctx, tx, a, e, q)
	}
	s := erpwire.Select{Table: e.Key, Columns: q.fields, Limit: q.limit, Offset: q.offset, Count: true}
	orgColumn := "org_id"
	if e.Key == "organizations" {
		orgColumn = "id"
	}
	s.Where = append(s.Where, erpwire.Predicate{Column: orgColumn, Op: erpwire.Equal, Value: a.OrgID()})
	if e.Key == "saved_views" {
		s.Where = append(s.Where, erpwire.Predicate{Column: "user_id", Op: erpwire.Equal, Value: a.UserID()})
	}
	keys := make([]string, 0, len(q.filters))
	for k := range q.filters {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		op := erpwire.Equal
		if q.filters[k] == nil {
			op = erpwire.Is
		}
		s.Where = append(s.Where, erpwire.Predicate{Column: k, Op: op, Value: q.filters[k]})
	}
	if q.search != "" {
		literal := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q.search)
		s.Where = append(s.Where, erpwire.Predicate{Column: q.searchField, Op: erpwire.ILike, Value: "%" + literal + "%"})
	}
	for _, k := range e.PrimaryKey {
		s.Order = append(s.Order, erpwire.Order{Column: k})
	}
	got, err := tx.Select(ctx, s)
	if err != nil {
		return got, err
	}
	if err = exactSelection(got, q.limit); err != nil {
		return got, err
	}
	return got, nil
}
func rpcRows(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, e entity, q request) (erpwire.Selection, error) {
	name := "assistant_workspace_profiles"
	if e.Key == "finance_lock_reopen_requests" {
		name = "list_finance_lock_reopen_requests"
	}
	raw, err := tx.ReadRPC(ctx, name, erpwire.Row{"p_org_id": a.OrgID()})
	if err != nil {
		return erpwire.Selection{}, err
	}
	var rows []erpwire.Row
	if err = decode(raw, &rows); err != nil || rows == nil {
		return erpwire.Selection{}, errors.New("authorized RPC rows unavailable")
	}
	all := []erpwire.Row{}
	for _, row := range rows {
		if e.Key == "finance_lock_reopen_requests" {
			row = erpwire.Row{"id": row["id"], "requested_by": row["requestedBy"], "lock_date": row["lockDate"], "previous_lock_date": row["previousLockDate"], "reason": row["reason"], "created_at": row["createdAt"], "requester_email": row["requesterEmail"]}
		}
		match := true
		for k, v := range q.filters {
			if !sameScalar(row[k], v) {
				match = false
			}
		}
		searchable, _ := row[q.searchField].(string)
		if q.search != "" && !strings.Contains(strings.ToLower(searchable), strings.ToLower(q.search)) {
			match = false
		}
		if match {
			all = append(all, row)
		}
	}
	sort.Slice(all, func(i, j int) bool { return fmt.Sprint(all[i]["id"]) < fmt.Sprint(all[j]["id"]) })
	n := int64(len(all))
	start := q.offset
	if start > len(all) {
		start = len(all)
	}
	end := start + q.limit
	if end > len(all) {
		end = len(all)
	}
	return erpwire.Selection{Rows: all[start:end], Total: &n, HasMore: end < len(all)}, nil
}
func (r *Reader) generic(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, name string, args map[string]any) (erpwire.ToolResult, error) {
	key, err := str(args, "entity", 100, true)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	e, ok := r.byKey[key]
	if !ok || !e.available(a) {
		return erpwire.ToolResult{}, erpwire.ErrForbidden
	}
	if name == "erp_data_text" {
		return r.text(ctx, tx, a, e, args)
	}
	if err = allowed(args, "entity", "fields", "filters", "search", "search_field", "limit", "offset"); err != nil {
		return erpwire.ToolResult{}, err
	}
	q, err := e.validate(a, args)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	got, err := r.selectRows(ctx, tx, a, e, q)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	items := []erpwire.Row{}
	for _, row := range got.Rows {
		item, err := project(row, e, q.fields)
		if err != nil {
			return erpwire.ToolResult{}, err
		}
		items = append(items, item)
	}
	selected := e
	selected.Fields = nil
	for _, k := range q.fields {
		f, _ := e.field(k)
		selected.Fields = append(selected.Fields, f)
	}
	payload := map[string]any{"org_id": a.OrgID(), "entity": selected, "items": items, "total": got.Total, "limit": q.limit, "offset": q.offset, "has_more": int64(q.offset+len(items)) < *got.Total, "coverage": map[string]any{"scope": e.Scope, "retrieved": len(items), "full_matching_count": got.Total, "text_previews": "Fields in _text are previews; follow erp_data_text pointers."}}
	items, err = boundRows(payload, items)
	if err != nil {
		return erpwire.ToolResult{}, err
	}
	payload["coverage"].(map[string]any)["retrieved"] = len(items)
	out, err := result(payload)
	if err != nil {
		return out, err
	}
	out.Total = got.Total
	out.Evidence = []erpwire.Evidence{r.rowsEvidence(a, name, e, items, got.Total, q.offset, out.Content)}
	return out, nil
}
func sameScalar(left, right any) bool {
	switch x := left.(type) {
	case nil:
		return right == nil
	case string:
		y, ok := right.(string)
		return ok && x == y
	case bool:
		y, ok := right.(bool)
		return ok && x == y
	case json.Number:
		y, ok := right.(json.Number)
		return ok && x == y
	}
	return false
}
