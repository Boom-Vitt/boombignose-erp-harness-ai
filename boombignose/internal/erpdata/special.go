package erpdata

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
)

var specializedColumns = map[string]string{
	"organizations":  "id,name,slug,created_at,updated_at",
	"clients":        "id,org_id,name,industry,source,created_at,updated_at",
	"deals":          "id,org_id,client_id,title,stage,value_satang,currency,expected_close_date,next_follow_up_date,source,created_at,updated_at",
	"quotes":         "id,org_id,client_id,project_id,number,status,issue_date,valid_until,subtotal_satang,discount_satang,total_satang,converted_invoice_id,created_at,updated_at",
	"projects":       "id,org_id,deal_id,client_id,source_quote_id,name,status,deadline,budget_satang,created_at,updated_at",
	"invoices":       "id,org_id,client_id,project_id,source_quote_id,source_milestone_id,number,status,issue_date,due_date,amount_satang,total_satang,vat_satang,wht_satang,wht_rate_bps,discount_satang,is_recurring,recurring_interval,created_at,updated_at",
	"payment_claims": "id,org_id,client_id,invoice_id,amount_satang,status,source,reviewed_at,payment_id,created_at,updated_at",
}
var enums = map[string][]string{
	"list_deals":          {"lead", "contacted", "discovery", "proposal", "negotiation", "won", "lost"},
	"list_quotes":         {"draft", "sent", "accepted", "declined", "expired", "converted"},
	"list_projects":       {"not_started", "in_progress", "review", "delivered", "support", "paused", "cancelled"},
	"list_invoices":       {"draft", "sent", "partially_paid", "paid", "overdue", "cancelled"},
	"list_payment_claims": {"pending", "verified", "rejected"},
}

func moneyString(n int64) string {
	sign := ""
	if n < 0 {
		sign = "-"
		n = -n
	}
	whole := fmt.Sprint(n / 100)
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return fmt.Sprintf("%s฿%s.%02d", sign, whole, n%100)
}
func normalizeRow(row erpwire.Row, columns []string) (erpwire.Row, error) {
	out := erpwire.Row{}
	for _, k := range columns {
		v, ok := row[k]
		if !ok {
			return nil, fmt.Errorf("source omitted %s", k)
		}
		if v != nil && (strings.HasSuffix(k, "_satang") || k == "wht_rate_bps") {
			n, err := integer(v)
			if err != nil {
				return nil, err
			}
			v = n
		}
		out[k] = v
	}
	return out, nil
}
func addMoney(row erpwire.Row, keys ...string) error {
	for _, k := range keys {
		v, ok := row[k+"_satang"]
		if !ok {
			return fmt.Errorf("source omitted %s", k)
		}
		if v == nil {
			row[k+"_thb"] = nil
			continue
		}
		n, err := integer(v)
		if err != nil {
			return err
		}
		row[k+"_satang"] = n
		row[k+"_thb"] = moneyString(n)
	}
	return nil
}
func (r *Reader) special(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, name string, args map[string]any) (erpwire.ToolResult, error) {
	var out erpwire.ToolResult
	table := strings.TrimPrefix(name, "list_")
	if name == "list_workspaces" {
		table = "organizations"
	}
	_, known := specializedColumns[table]
	if name != "finance_summary" && !known {
		return out, errors.New("unknown read tool")
	}
	keys := []string{"org_id"}
	if name != "finance_summary" {
		keys = append(keys, "limit", "offset")
	}
	if name == "list_workspaces" {
		keys = []string{"limit", "offset"}
	}
	if len(enums[name]) > 0 {
		keys = append(keys, "client_id")
		if name == "list_deals" {
			keys = append(keys, "stage")
		} else {
			keys = append(keys, "status")
		}
	}
	if name == "list_payment_claims" {
		keys = append(keys, "invoice_id")
	}
	if err := allowed(args, keys...); err != nil {
		return out, err
	}
	limit, offset := 50, 0
	var err error
	if name != "finance_summary" {
		limit, err = bound(args, "limit", 50, 1, 100)
		if err != nil {
			return out, err
		}
		offset, err = bound(args, "offset", 0, 0, 1000000)
		if err != nil {
			return out, err
		}
	}
	for _, k := range []string{"client_id", "invoice_id"} {
		if v, ok := args[k]; ok {
			s, ok := v.(string)
			if !ok || uuid.Validate(s) != nil {
				return out, fmt.Errorf("invalid %s", k)
			}
		}
	}
	filterKey := "status"
	if name == "list_deals" {
		filterKey = "stage"
	}
	if v, ok := args[filterKey]; ok {
		s, ok := v.(string)
		found := false
		for _, valid := range enums[name] {
			found = found || s == valid
		}
		if !ok || !found {
			return out, errors.New("invalid status/stage")
		}
	}
	if name == "finance_summary" {
		return r.finance(ctx, tx, a)
	}
	if name == "list_invoices" {
		return r.invoices(ctx, tx, a, args, limit, offset)
	}
	supported := false
	for _, tool := range r.tools {
		supported = supported || tool.Name == name
	}
	if !supported {
		return out, errors.New("unknown read tool")
	}
	s := erpwire.Select{Table: table, Columns: strings.Split(specializedColumns[table], ","), Limit: limit, Offset: offset, Count: true, Order: []erpwire.Order{{Column: "created_at", Descending: name != "list_workspaces"}, {Column: "id"}}}
	org := "org_id"
	if table == "organizations" {
		org = "id"
	}
	s.Where = append(s.Where, erpwire.Predicate{Column: org, Op: erpwire.Equal, Value: a.OrgID()})
	for _, k := range []string{"stage", "status", "client_id", "invoice_id"} {
		if v, ok := args[k]; ok {
			s.Where = append(s.Where, erpwire.Predicate{Column: k, Op: erpwire.Equal, Value: v})
		}
	}
	got, err := tx.Select(ctx, s)
	if err != nil {
		return out, err
	}
	if err = exactSelection(got, limit); err != nil {
		return out, err
	}
	items := []erpwire.Row{}
	for _, row := range got.Rows {
		clean, err := normalizeRow(row, s.Columns)
		if err != nil {
			return out, err
		}
		var money []string
		switch table {
		case "deals":
			money = []string{"value"}
		case "quotes":
			money = []string{"subtotal", "discount", "total"}
		case "projects":
			money = []string{"budget"}
		case "payment_claims":
			money = []string{"amount"}
		}
		if err = addMoney(clean, money...); err != nil {
			return out, err
		}
		items = append(items, clean)
	}
	payload := map[string]any{"org_id": a.OrgID(), "items": items, "total": got.Total, "limit": limit, "offset": offset, "has_more": int64(offset+len(items)) < *got.Total}
	items, err = boundRows(payload, items)
	if err != nil {
		return out, err
	}
	out, err = result(payload)
	if err != nil {
		return out, err
	}
	out.Total = got.Total
	out.Evidence = []erpwire.Evidence{r.rowsEvidence(a, name, r.byKey[table], items, got.Total, offset, out.Content)}
	return out, nil
}
func requiredInt(m map[string]any, k string, nonnegative bool) (int64, error) {
	v, ok := m[k]
	if !ok || v == nil {
		return 0, fmt.Errorf("incomplete snapshot: %s", k)
	}
	n, err := integer(v)
	if err != nil {
		return 0, err
	}
	if nonnegative && n < 0 {
		return 0, errors.New("negative snapshot count")
	}
	m[k] = n
	return n, nil
}
func object(v any) (map[string]any, error) {
	m, ok := v.(map[string]any)
	if !ok || m == nil {
		return nil, errors.New("incomplete financial snapshot")
	}
	return m, nil
}
func rpcObject(ctx context.Context, tx erpwire.ReadTx, name string, args erpwire.Row) (map[string]any, error) {
	raw, err := tx.ReadRPC(ctx, name, args)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err = decode(raw, &m); err != nil || m == nil {
		return nil, errors.New("financial snapshot unavailable")
	}
	return m, nil
}
func (r *Reader) finance(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor) (erpwire.ToolResult, error) {
	var out erpwire.ToolResult
	m, err := rpcObject(ctx, tx, "assistant_finance_snapshot", erpwire.Row{"p_org_id": a.OrgID(), "p_as_of": r.now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return out, err
	}
	known, ok := m["cash_balance_known"].(bool)
	if !ok {
		return out, errors.New("incomplete cash balance provenance")
	}
	resultMap := map[string]any{"org_id": a.OrgID(), "cash_balance_known": known, "cash_balance_satang": nil}
	for _, k := range []string{"cash_balance_satang", "monthly_burn_satang", "invoiced_total_satang", "verified_paid_satang", "unpaid_satang", "costs_total_satang", "mrr_satang", "open_quotes_satang", "pipeline_satang", "pending_claims_satang", "unpaid_invoice_count", "open_quotes_count", "pending_claims_count"} {
		if k == "cash_balance_satang" && !known {
			resultMap["cash_balance_thb"] = nil
			continue
		}
		n, err := requiredInt(m, k, strings.HasSuffix(k, "_count"))
		if err != nil {
			return out, err
		}
		resultMap[k] = n
		if strings.HasSuffix(k, "_satang") {
			resultMap[strings.TrimSuffix(k, "_satang")+"_thb"] = moneyString(n)
		}
	}
	out, err = result(resultMap)
	if err != nil {
		return out, err
	}
	out.Evidence = []erpwire.Evidence{r.financeEvidence(a, "finance_summary", resultMap, out.Content)}
	return out, nil
}
func (r *Reader) invoices(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, args map[string]any, limit, offset int) (erpwire.ToolResult, error) {
	var out erpwire.ToolResult
	params := erpwire.Row{"p_org_id": a.OrgID(), "p_status": args["status"], "p_client_id": args["client_id"], "p_limit": limit, "p_offset": offset, "p_as_of": r.now().UTC().Format(time.RFC3339Nano)}
	m, err := rpcObject(ctx, tx, "assistant_invoice_snapshot", params)
	if err != nil {
		return out, err
	}
	total, err := requiredInt(m, "total", true)
	if err != nil {
		return out, err
	}
	rows, ok := m["rows"].([]any)
	if !ok || len(rows) > limit {
		return out, errors.New("incomplete invoice rows")
	}
	summary, err := object(m["summary"])
	if err != nil {
		return out, err
	}
	for _, k := range []string{"issued_unpaid_count", "outstanding_satang"} {
		if _, err = requiredInt(summary, k, true); err != nil {
			return out, err
		}
	}
	summary["scope"] = "all_matching_records"
	summary["status_filter"] = args["status"]
	summary["outstanding_thb"] = moneyString(summary["outstanding_satang"].(int64))
	coverage, err := object(m["receivables_coverage"])
	if err != nil {
		return out, err
	}
	for _, k := range []string{"invoice_count", "outstanding_satang"} {
		if _, err = requiredInt(coverage, k, true); err != nil {
			return out, err
		}
	}
	coverageMore, ok := coverage["has_more"].(bool)
	if !ok {
		return out, errors.New("incomplete coverage bound")
	}
	coverageItems, ok := coverage["items"].([]any)
	if !ok || len(coverageItems) > 16 {
		return out, errors.New("invalid coverage rows")
	}
	cleanCoverage := []any{}
	for _, v := range coverageItems {
		row, err := object(v)
		if err != nil {
			return out, err
		}
		if _, err = requiredInt(row, "outstanding_satang", true); err != nil {
			return out, err
		}
		cleanCoverage = append(cleanCoverage, erpwire.Row{"id": row["id"], "number": row["number"], "status": row["status"], "due_date": row["due_date"], "outstanding_satang": row["outstanding_satang"]})
	}
	items := []erpwire.Row{}
	for _, v := range rows {
		row, err := object(v)
		if err != nil {
			return out, err
		}
		clean, err := normalizeRow(erpwire.Row(row), strings.Split(specializedColumns["invoices"], ","))
		if err != nil {
			return out, err
		}
		status, ok := row["effective_status"].(string)
		if !ok {
			return out, errors.New("missing authoritative settlement status")
		}
		clean["stored_status"] = clean["status"]
		clean["status"] = status
		for _, k := range []string{"paid_satang", "credited_satang", "outstanding_satang"} {
			n, err := requiredInt(row, k, true)
			if err != nil {
				return out, err
			}
			clean[k] = n
		}
		if err = addMoney(clean, "amount", "discount", "paid", "credited", "outstanding"); err != nil {
			return out, err
		}
		items = append(items, clean)
	}
	payload := map[string]any{"org_id": a.OrgID(), "items": items, "total": total, "limit": limit, "offset": offset, "has_more": int64(offset+len(items)) < total, "summary": summary, "receivables_coverage": map[string]any{"invoice_count": coverage["invoice_count"], "outstanding_satang": coverage["outstanding_satang"], "items": cleanCoverage, "has_more": coverageMore}}
	items, err = boundRows(payload, items)
	if err != nil {
		return out, err
	}
	coverage = payload["receivables_coverage"].(map[string]any)
	cleanCoverage = coverage["items"].([]any)
	out, err = result(payload)
	if err != nil {
		return out, err
	}
	out.Total = &total
	ev := r.rowsEvidence(a, "list_invoices", r.byKey["invoices"], items, &total, offset, out.Content)
	r.invoiceFacts(&ev, summary, coverage, cleanCoverage, items)
	out.Evidence = []erpwire.Evidence{ev}
	return out, nil
}
