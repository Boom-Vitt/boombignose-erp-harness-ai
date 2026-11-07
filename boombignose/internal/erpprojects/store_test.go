package erpprojects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const testOrg = "22222222-2222-4222-8222-222222222222"
const otherOrg = "99999999-9999-4999-8999-999999999999"
const testUser = "11111111-1111-4111-8111-111111111111"
const otherUser = "33333333-3333-4333-8333-333333333333"
const projectID = "44444444-4444-4444-8444-444444444444"
const invoiceID = "55555555-5555-4555-8555-555555555555"
const billingKey = "66666666-6666-4666-8666-666666666666"

var testNow = time.Date(2026, 11, 8, 17, 30, 0, 0, time.UTC)

func testActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	now := time.Now()
	a, err := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: testUser, Email: "member@example.invalid", Assurance: erpwire.AAL1, ExpiresAt: now.Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: testUser, OrgID: testOrg, OrgName: "Test workspace", Role: role}, false, now)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

type commandCall struct {
	name string
	args erpwire.Row
}
type fakeStore struct {
	rows                              map[string][]erpwire.Row
	assignees                         map[string][]erpwire.Row
	queries                           []erpwire.Select
	commands                          []commandCall
	reads, writes, sequence, pageSize int
	readErrors                        map[string]error
	insertErrors                      map[string]error
	writeError                        error
	rpcError                          error
	command                           func(string, erpwire.Row) (json.RawMessage, error)
}
type fakeTx struct {
	store *fakeStore
	actor erpwire.Actor
}

func fixture(t *testing.T) (*Service, *fakeStore, erpwire.Actor) {
	t.Helper()
	f := &fakeStore{rows: map[string][]erpwire.Row{}, assignees: map[string][]erpwire.Row{testOrg: {{"user_id": testUser, "full_name": "Owner"}, {"user_id": otherUser, "full_name": "ผู้ร่วมงาน"}}}, readErrors: map[string]error{}, pageSize: 2}
	f.rows["projects"] = []erpwire.Row{{"org_id": testOrg, "id": projectID, "name": "โครงการทดสอบ", "status": "not_started", "owner": testUser, "client_id": nil, "deadline": "2026-11-09", "budget_satang": int64(12345), "created_at": "2026-11-01"}}
	s, err := New(Options{Store: f})
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return testNow }
	return s, f, testActor(t, erpwire.Member)
}
func cloneRow(row erpwire.Row) erpwire.Row {
	if row == nil {
		return nil
	}
	out := erpwire.Row{}
	for key, value := range row {
		switch v := value.(type) {
		case erpwire.Row:
			out[key] = cloneRow(v)
		default:
			out[key] = value
		}
	}
	return out
}
func cloneTables(tables map[string][]erpwire.Row) map[string][]erpwire.Row {
	out := map[string][]erpwire.Row{}
	for table, rows := range tables {
		out[table] = []erpwire.Row{}
		for _, row := range rows {
			out[table] = append(out[table], cloneRow(row))
		}
	}
	return out
}
func (f *fakeStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	f.reads++
	if err := a.Validate(time.Now()); err != nil {
		return err
	}
	return fn(&fakeTx{f, a})
}
func (f *fakeStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	f.writes++
	if err := a.Validate(time.Now()); err != nil {
		return err
	}
	if f.writeError != nil {
		return f.writeError
	}
	before := cloneTables(f.rows)
	err := fn(&fakeTx{f, a})
	if err != nil {
		f.rows = before
	}
	return err
}
func explicitScope(where []erpwire.Predicate, org string) bool {
	for _, p := range where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == org {
			return true
		}
	}
	return false
}
func equalValue(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	an, ae := integer(a)
	bn, be := integer(b)
	if ae == nil && be == nil {
		return an == bn
	}
	return reflect.DeepEqual(a, b)
}
func lessValue(a, b any) bool {
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	if av, ok := a.(bool); ok {
		bv, _ := b.(bool)
		return !av && bv
	}
	an, ae := integer(a)
	bn, be := integer(b)
	if ae == nil && be == nil {
		return an < bn
	}
	return fmt.Sprint(a) < fmt.Sprint(b)
}
func predicate(row erpwire.Row, p erpwire.Predicate) bool {
	v := row[p.Column]
	switch p.Op {
	case erpwire.Equal, erpwire.Is:
		return equalValue(v, p.Value)
	case erpwire.NotEqual:
		return !equalValue(v, p.Value)
	case erpwire.GreaterEqual:
		return v != nil && (!lessValue(v, p.Value))
	case erpwire.LessEqual:
		return v != nil && (!lessValue(p.Value, v))
	case erpwire.Greater:
		return v != nil && lessValue(p.Value, v)
	case erpwire.Less:
		return v != nil && lessValue(v, p.Value)
	case erpwire.In:
		switch values := p.Value.(type) {
		case []string:
			for _, value := range values {
				if equalValue(v, value) {
					return true
				}
			}
		}
	}
	return false
}
func matchesWhere(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		if !predicate(row, p) {
			return false
		}
	}
	return true
}
func project(row erpwire.Row, columns []string) erpwire.Row {
	if len(columns) == 0 {
		return cloneRow(row)
	}
	out := erpwire.Row{}
	for _, column := range columns {
		out[column] = row[column]
	}
	return out
}
func (tx *fakeTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	if !explicitScope(q.Where, tx.actor.OrgID()) {
		return erpwire.Selection{}, fmt.Errorf("missing org predicate for %s", q.Table)
	}
	tx.store.queries = append(tx.store.queries, q)
	if err := tx.store.readErrors[q.Table]; err != nil {
		return erpwire.Selection{}, err
	}
	rows := []erpwire.Row{}
	for _, row := range tx.store.rows[q.Table] {
		if !matchesWhere(row, q.Where) {
			continue
		}
		matches := true
		for _, group := range q.Any {
			any := false
			for _, p := range group {
				any = any || predicate(row, p)
			}
			matches = matches && any
		}
		if matches {
			rows = append(rows, row)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, order := range q.Order {
			a, b := rows[i][order.Column], rows[j][order.Column]
			if equalValue(a, b) {
				continue
			}
			if a == nil || b == nil {
				return (a == nil) == order.NullsFirst
			}
			less := lessValue(a, b)
			if order.Descending {
				return !less
			}
			return less
		}
		return false
	})
	total := int64(len(rows))
	start := min(q.Offset, len(rows))
	limit := q.Limit
	if limit <= 0 {
		limit = len(rows)
	}
	if tx.store.pageSize > 0 {
		limit = min(limit, tx.store.pageSize)
	}
	end := min(start+limit, len(rows))
	out := erpwire.Selection{Rows: []erpwire.Row{}, HasMore: end < len(rows)}
	if q.Count {
		out.Total = &total
	}
	for _, row := range rows[start:end] {
		result := project(row, q.Columns)
		for _, rel := range q.Relations {
			result[rel.Name] = nil
			for _, child := range tx.store.rows[rel.Table] {
				if child["org_id"] == tx.actor.OrgID() && row[rel.LocalColumn] != nil && equalValue(child[rel.ForeignColumn], row[rel.LocalColumn]) {
					result[rel.Name] = project(child, rel.Columns)
					break
				}
			}
		}
		out.Rows = append(out.Rows, result)
	}
	return out, nil
}
func (tx *fakeTx) ReadRPC(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if name != "record_activity_assignees" || args["p_org_id"] != tx.actor.OrgID() {
		return nil, erpwire.ErrForbidden
	}
	if tx.store.rpcError != nil {
		return nil, tx.store.rpcError
	}
	rows := tx.store.assignees[tx.actor.OrgID()]
	if rows == nil {
		rows = []erpwire.Row{}
	}
	return json.Marshal(rows)
}
func (tx *fakeTx) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if args["p_org_id"] != tx.actor.OrgID() {
		return nil, erpwire.ErrForbidden
	}
	tx.store.commands = append(tx.store.commands, commandCall{name, cloneRow(args)})
	if tx.store.command == nil {
		return json.RawMessage("null"), nil
	}
	return tx.store.command(name, args)
}
func (tx *fakeTx) Insert(_ context.Context, in erpwire.Insert) ([]erpwire.Row, error) {
	if err := tx.store.insertErrors[in.Table]; err != nil {
		return nil, err
	}
	out := []erpwire.Row{}
	for _, input := range in.Rows {
		row := cloneRow(input)
		if row["org_id"] != tx.actor.OrgID() {
			return nil, erpwire.ErrForbidden
		}
		for _, ref := range []struct{ column, table string }{{"project_id", "projects"}, {"client_id", "clients"}, {"deal_id", "deals"}} {
			if row[ref.column] == nil {
				continue
			}
			found := false
			for _, parent := range tx.store.rows[ref.table] {
				if parent["org_id"] == row["org_id"] && equalValue(parent["id"], row[ref.column]) {
					found = true
				}
			}
			if !found {
				return nil, errors.New("foreign key unavailable")
			}
		}
		if row["id"] == nil {
			tx.store.sequence++
			row["id"] = fmt.Sprintf("77777777-7777-4777-8777-%012d", tx.store.sequence)
		}
		if in.Table == "time_entries" {
			if _, ok := row["work_date"]; !ok {
				row["work_date"] = "2026-11-09"
			}
			row["invoice_id"] = nil
		}
		tx.store.rows[in.Table] = append(tx.store.rows[in.Table], row)
		out = append(out, project(row, in.Returning))
	}
	return out, nil
}
func (tx *fakeTx) Update(_ context.Context, table string, values erpwire.Row, where []erpwire.Predicate, returning []string) ([]erpwire.Row, error) {
	if !explicitScope(where, tx.actor.OrgID()) {
		return nil, erpwire.ErrForbidden
	}
	out := []erpwire.Row{}
	for _, row := range tx.store.rows[table] {
		if !matchesWhere(row, where) {
			continue
		}
		for key, value := range values {
			row[key] = value
		}
		out = append(out, project(row, returning))
	}
	return out, nil
}
func (tx *fakeTx) Delete(_ context.Context, table string, where []erpwire.Predicate, returning []string) ([]erpwire.Row, error) {
	if !explicitScope(where, tx.actor.OrgID()) {
		return nil, erpwire.ErrForbidden
	}
	kept, out := []erpwire.Row{}, []erpwire.Row{}
	for _, row := range tx.store.rows[table] {
		if matchesWhere(row, where) {
			out = append(out, project(row, returning))
		} else {
			kept = append(kept, row)
		}
	}
	tx.store.rows[table] = kept
	return out, nil
}
func invoke(t *testing.T, s *Service, a erpwire.Actor, key string, args ...any) (any, error) {
	t.Helper()
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	if args == nil {
		raw = json.RawMessage("[]")
	}
	op, ok := s.Operations()[key]
	if !ok {
		t.Fatalf("operation missing: %s", key)
	}
	return op(context.Background(), a, raw)
}
func action(t *testing.T, value any, err error) erpwire.ActionResponse {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	out, ok := value.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("not an action response: %#v", value)
	}
	return out
}
func errorMessage(t *testing.T, value any, err error) string {
	t.Helper()
	out := action(t, value, err)
	row, ok := out.Value.(erpwire.Row)
	if !ok {
		t.Fatalf("unexpected action value %#v", out.Value)
	}
	return text(row["error"])
}
func callAction(t *testing.T, s *Service, a erpwire.Actor, key string, args ...any) erpwire.ActionResponse {
	t.Helper()
	value, err := invoke(t, s, a, key, args...)
	return action(t, value, err)
}
func callError(t *testing.T, s *Service, a erpwire.Actor, key string, args ...any) string {
	t.Helper()
	value, err := invoke(t, s, a, key, args...)
	return errorMessage(t, value, err)
}
func assertFields(t *testing.T, got, want erpwire.Row) {
	t.Helper()
	for key, value := range want {
		actual, present := got[key]
		if !present || !reflect.DeepEqual(actual, value) {
			t.Fatalf("field %s = %#v (present %v), want %#v; row %#v", key, actual, present, value, got)
		}
	}
}
func assertPaths(t *testing.T, out erpwire.ActionResponse, redirect string, paths ...string) {
	t.Helper()
	if out.Redirect != redirect || !reflect.DeepEqual(out.Refresh, paths) {
		t.Fatalf("navigation = %#v, want redirect %q and paths %#v", out, redirect, paths)
	}
}
