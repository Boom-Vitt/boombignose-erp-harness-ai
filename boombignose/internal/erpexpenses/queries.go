package erpexpenses

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var claimColumns = []string{"id", "org_id", "number", "employee", "title", "status", "submitted_at", "decided_by", "decided_at", "decision_note", "paid_at", "created_at", "updated_at"}
var lineColumns = []string{"id", "org_id", "claim_id", "spent_on", "category", "description", "amount_satang", "project_id", "position"}

type Context struct {
	UserID string `json:"userId"`
	Email *string `json:"email"`
	OrgID string `json:"orgId"`
	OrgName string `json:"orgName"`
	Role erpwire.Role `json:"role"`
}

func viewer(actor erpwire.Actor) Context {
	var email *string
	if actor.Email() != "" { value := actor.Email(); email = &value }
	return Context{UserID: actor.UserID(), Email: email, OrgID: actor.OrgID(), OrgName: actor.OrgName(), Role: actor.Role()}
}

type ClaimLists struct {
	Mine []erpwire.Row `json:"mine"`
	ToApprove []erpwire.Row `json:"toApprove"`
	Totals erpwire.BrowserMap `json:"totals"`
	Names erpwire.BrowserMap `json:"names"`
}

type Detail struct {
	Context Context `json:"ctx"`
	Claim erpwire.Row `json:"claim"`
	Lines []erpwire.Row `json:"lines"`
	CostCount int64 `json:"costCount"`
	Names erpwire.BrowserMap `json:"names"`
}

type selector interface { Select(context.Context, erpwire.Select) (erpwire.Selection, error) }

func all(ctx context.Context, tx selector, query erpwire.Select) ([]erpwire.Row, error) {
	query.Limit = 1000
	query.Offset = 0
	rows := make([]erpwire.Row, 0)
	for {
		page, err := tx.Select(ctx, query)
		if err != nil { return nil, err }
		rows = append(rows, page.Rows...)
		if !page.HasMore { return rows, nil }
		if len(page.Rows) == 0 { return nil, errData }
		query.Offset += len(page.Rows)
	}
}

func integer(value any) (int64, error) {
	var number int64
	var err error
	switch value := value.(type) {
	case int64: number = value
	case int: number = int64(value)
	case int32: number = int64(value)
	case json.Number: number, err = strconv.ParseInt(value.String(), 10, 64)
	default: return 0, errData
	}
	if err != nil || number < -int64(money.MaxSafeSatang) || number > int64(money.MaxSafeSatang) { return 0, errData }
	return number, nil
}

func totalLines(lines []erpwire.Row) (erpwire.BrowserMap, error) {
	positions := make(map[string]int)
	entries := make([][2]any, 0)
	for _, line := range lines {
		id, ok := line["claim_id"].(string)
		amount, err := integer(line["amount_satang"])
		if !ok || err != nil || amount <= 0 { return erpwire.BrowserMap{}, errData }
		index, exists := positions[id]
		if !exists { index = len(entries); positions[id] = index; entries = append(entries, [2]any{id, int64(0)}) }
		previous := entries[index][1].(int64)
		if previous > int64(money.MaxSafeSatang)-amount { return erpwire.BrowserMap{}, errData }
		entries[index][1] = previous+amount
	}
	return erpwire.Map(entries), nil
}

func profileNames(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor, ids []string) (erpwire.BrowserMap, error) {
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids { if id != "" { wanted[id] = true } }
	if len(wanted) == 0 { return erpwire.Map(nil), nil }
	// This existing member-authorized projection retains co-member display
	// names without broadening direct profiles or membership-list privileges.
	raw, err := tx.ReadRPC(ctx, "record_activity_assignees", erpwire.Row{"p_org_id": actor.OrgID()})
	if err != nil { return erpwire.BrowserMap{}, err }
	var profiles []struct { ID string `json:"user_id"`; Name *string `json:"full_name"` }
	if erpwire.DecodeJSON(raw, &profiles) != nil || profiles == nil { return erpwire.BrowserMap{}, errData }
	names := make(map[string]string, len(wanted))
	for _, profile := range profiles {
		if !wanted[profile.ID] { continue }
		name := "Team member"
		if profile.Name != nil && *profile.Name != "" { name = *profile.Name }
		names[profile.ID] = name
	}
	entries := make([][2]any, 0, len(wanted))
	for _, id := range ids {
		if name, ok := names[id]; ok {
			entries = append(entries, [2]any{id, name})
			delete(names, id)
		}
	}
	return erpwire.Map(entries), nil
}

func (s *Service) readLists(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor) (ClaimLists, error) {
	out := ClaimLists{}
	var err error
	out.Mine, err = all(ctx, tx, erpwire.Select{Table: "expense_claims", Columns: claimColumns,
		Where: append(orgWhere(actor), eq("employee", actor.UserID())), Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
	if err != nil { return out, err }
	if erpwire.Can(actor.Role(), "expense:approve") {
		out.ToApprove, err = all(ctx, tx, erpwire.Select{Table: "expense_claims", Columns: claimColumns,
			Where: append(orgWhere(actor), erpwire.Predicate{Column: "status", Op: erpwire.In, Value: []string{"submitted", "approved"}}, erpwire.Predicate{Column: "employee", Op: erpwire.NotEqual, Value: actor.UserID()}),
			Order: []erpwire.Order{{Column: "status"}, {Column: "submitted_at"}, {Column: "id"}}})
		if err != nil { return out, err }
	}
	lines, err := all(ctx, tx, erpwire.Select{Table: "expense_lines", Columns: []string{"id", "claim_id", "amount_satang"}, Where: orgWhere(actor), Order: []erpwire.Order{{Column: "id"}}})
	if err != nil { return out, err }
	out.Totals, err = totalLines(lines)
	if err != nil { return out, err }
	ids := make([]string, 0, len(out.ToApprove))
	for _, claim := range out.ToApprove { if id, ok := claim["employee"].(string); ok { ids = append(ids, id) } else { return out, errData } }
	out.Names, err = profileNames(ctx, tx, actor, ids)
	return out, err
}

func (s *Service) claimLists(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	if _, err := arguments(raw, 0); err != nil { return nil, err }
	var out ClaimLists
	err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) (err error) { out, err = s.readLists(ctx, tx, actor); return err })
	return out, readError(err, errData)
}

func (s *Service) readDetail(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor, id string) (Detail, error) {
	out := Detail{Context: viewer(actor)}
	claims, err := tx.Select(ctx, erpwire.Select{Table: "expense_claims", Columns: claimColumns, Where: append(orgWhere(actor), eq("id", id)), Limit: 1})
	if err != nil { return out, err }
	if len(claims.Rows) == 0 { return out, erpwire.ErrNotFound }
	out.Claim = claims.Rows[0]
	out.Lines, err = all(ctx, tx, erpwire.Select{Table: "expense_lines", Columns: lineColumns,
		Relations: []erpwire.Relation{{Name: "projects", Table: "projects", LocalColumn: "project_id", ForeignColumn: "id", Columns: []string{"name"}}},
		Where: append(orgWhere(actor), eq("claim_id", id)), Order: []erpwire.Order{{Column: "position"}, {Column: "id"}}})
	if err != nil { return out, err }
	costs, err := tx.Select(ctx, erpwire.Select{Table: "costs", Columns: []string{"id"}, Where: append(orgWhere(actor), eq("expense_claim_id", id)), Count: true, Limit: 1})
	if err != nil { return out, err }
	if costs.Total == nil || *costs.Total < 0 || *costs.Total > int64(money.MaxSafeSatang) { return out, errData }
	out.CostCount = *costs.Total
	employee, ok := out.Claim["employee"].(string)
	if !ok { return out, errData }
	decided, _ := out.Claim["decided_by"].(string)
	out.Names, err = profileNames(ctx, tx, actor, []string{employee, decided})
	return out, err
}

func (s *Service) detail(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 1)
	if err != nil { return nil, err }
	var id string
	if args.Decode(0, &id) != nil { return nil, erpwire.ErrBadArguments }
	var out Detail
	err = s.store.Read(ctx, actor, func(tx erpwire.ReadTx) (err error) { out, err = s.readDetail(ctx, tx, actor, id); return err })
	return out, readError(err, errData)
}

func readProjects(ctx context.Context, tx erpwire.ReadTx, actor erpwire.Actor) ([]erpwire.Row, error) {
	return all(ctx, tx, erpwire.Select{Table: "projects", Columns: []string{"id", "name"}, Where: orgWhere(actor), Order: []erpwire.Order{{Column: "name"}, {Column: "id"}}})
}

func (s *Service) projects(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	if _, err := arguments(raw, 0); err != nil { return nil, err }
	var out []erpwire.Row
	err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) (err error) { out, err = readProjects(ctx, tx, actor); return err })
	return out, readError(err, errData)
}

func (s *Service) approvalCount(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	if _, err := arguments(raw, 0); err != nil { return nil, err }
	if !erpwire.Can(actor.Role(), "expense:approve") { return nil, nil }
	var count int64
	err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
		selection, err := tx.Select(ctx, erpwire.Select{Table: "expense_claims", Columns: []string{"id"},
			Where: append(orgWhere(actor), eq("status", "submitted"), erpwire.Predicate{Column: "employee", Op: erpwire.NotEqual, Value: actor.UserID()}), Count: true, Limit: 1})
		if err != nil { return err }
		if selection.Total == nil || *selection.Total < 0 || *selection.Total > int64(money.MaxSafeSatang) { return errors.New("unknown expense approval count") }
		count = *selection.Total
		return nil
	})
	return count, readError(err, errCount)
}
