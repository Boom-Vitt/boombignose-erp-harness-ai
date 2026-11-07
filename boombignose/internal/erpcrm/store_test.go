package erpcrm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const testOrg = "11111111-1111-1111-1111-111111111111"
const otherOrg = "22222222-2222-2222-2222-222222222222"
const testUser = "33333333-3333-3333-3333-333333333333"
const testDeal = "44444444-4444-4444-4444-444444444444"
const testClient = "55555555-5555-5555-5555-555555555555"
const testReason = "66666666-6666-6666-6666-666666666666"
const otherID = "77777777-7777-7777-7777-777777777777"

type fakeStore struct {
	tables            map[string][]erpwire.Row
	reads, writes     int
	queries           []erpwire.Select
	readErr, writeErr error
	insertErr         map[string]error
	command           func(string, erpwire.Row) (json.RawMessage, error)
	pageSize          int
}

type fakeTx struct {
	store *fakeStore
	actor erpwire.Actor
}

func cloneRow(row erpwire.Row) erpwire.Row {
	out := erpwire.Row{}
	for k, v := range row {
		out[k] = v
	}
	return out
}
func (s *fakeStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	s.reads++
	if err := a.Validate(time.Now()); err != nil {
		return err
	}
	if s.readErr != nil {
		return s.readErr
	}
	return fn(fakeTx{s, a})
}
func (s *fakeStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	s.writes++
	if err := a.Validate(time.Now()); err != nil {
		return err
	}
	if s.writeErr != nil {
		return s.writeErr
	}
	snapshot := map[string][]erpwire.Row{}
	for table, rows := range s.tables {
		for _, row := range rows {
			snapshot[table] = append(snapshot[table], cloneRow(row))
		}
	}
	if err := fn(fakeTx{s, a}); err != nil {
		s.tables = snapshot
		return err
	}
	return nil
}

func rowMatches(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		equal := reflect.DeepEqual(row[p.Column], p.Value)
		switch p.Op {
		case erpwire.Equal, erpwire.Is:
			if !equal {
				return false
			}
		case erpwire.NotEqual:
			if equal {
				return false
			}
		case erpwire.In:
			match := false
			for _, v := range p.Value.([]string) {
				if row[p.Column] == v {
					match = true
				}
			}
			if !match {
				return false
			}
		case erpwire.ILike:
			needle := strings.Trim(text(p.Value), "%")
			needle = strings.ReplaceAll(needle, `\`, "")
			if !strings.Contains(strings.ToLower(text(row[p.Column])), strings.ToLower(needle)) {
				return false
			}
		default:
			panic("unimplemented fake predicate " + p.Op)
		}
	}
	return true
}

func (tx fakeTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	tx.store.queries = append(tx.store.queries, q)
	if !rowMatches(erpwire.Row{"org_id": tx.actor.OrgID()}, orgPredicates(q.Where)) || len(orgPredicates(q.Where)) != 1 {
		return erpwire.Selection{}, errors.New("query must explicitly bind the actor organization")
	}
	rows := []erpwire.Row{}
	for _, source := range tx.store.tables[q.Table] {
		if !rowMatches(source, q.Where) {
			continue
		}
		row := cloneRow(source)
		for _, relation := range q.Relations {
			row[relation.Name] = nil
			for _, related := range tx.store.tables[relation.Table] {
				if related["org_id"] == tx.actor.OrgID() && related[relation.ForeignColumn] == source[relation.LocalColumn] {
					row[relation.Name] = cloneRow(related)
					break
				}
			}
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, order := range q.Order {
			a, b := rows[i][order.Column], rows[j][order.Column]
			if reflect.DeepEqual(a, b) {
				continue
			}
			if a == nil {
				return order.NullsFirst
			}
			if b == nil {
				return !order.NullsFirst
			}
			less := fmt.Sprint(a) < fmt.Sprint(b)
			if order.Descending {
				return !less
			}
			return less
		}
		return false
	})
	total := int64(len(rows))
	start := min(q.Offset, len(rows))
	end := len(rows)
	limit := q.Limit
	if tx.store.pageSize > 0 && (limit == 0 || tx.store.pageSize < limit) {
		limit = tx.store.pageSize
	}
	if limit > 0 {
		end = min(end, start+limit)
	}
	page := []erpwire.Row{}
	for _, row := range rows[start:end] {
		if len(q.Columns) == 0 {
			page = append(page, row)
			continue
		}
		out := erpwire.Row{}
		for _, column := range q.Columns {
			out[column] = row[column]
		}
		for _, rel := range q.Relations {
			out[rel.Name] = row[rel.Name]
		}
		page = append(page, out)
	}
	out := erpwire.Selection{Rows: page, HasMore: end < len(rows)}
	if q.Count {
		out.Total = &total
	}
	return out, nil
}

func orgPredicates(where []erpwire.Predicate) []erpwire.Predicate {
	out := []erpwire.Predicate{}
	for _, p := range where {
		if p.Column == "org_id" {
			out = append(out, p)
		}
	}
	return out
}
func (tx fakeTx) ReadRPC(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if name != "record_activity_assignees" || args["p_org_id"] != tx.actor.OrgID() {
		return nil, errors.New("unexpected read command")
	}
	return json.Marshal(tx.store.tables["assignees"])
}
func (tx fakeTx) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if args["p_org_id"] != tx.actor.OrgID() {
		return nil, erpwire.ErrForbidden
	}
	if tx.store.command == nil {
		return nil, errors.New("unexpected command")
	}
	return tx.store.command(name, args)
}
func (tx fakeTx) Insert(_ context.Context, ins erpwire.Insert) ([]erpwire.Row, error) {
	if err := tx.store.insertErr[ins.Table]; err != nil {
		return nil, err
	}
	rows := []erpwire.Row{}
	for _, source := range ins.Rows {
		if source["org_id"] != tx.actor.OrgID() {
			return nil, erpwire.ErrForbidden
		}
		row := cloneRow(source)
		if row["id"] == nil {
			row["id"] = fmt.Sprintf("99999999-9999-9999-9999-%012d", len(tx.store.tables[ins.Table])+1)
		}
		tx.store.tables[ins.Table] = append(tx.store.tables[ins.Table], row)
		rows = append(rows, cloneRow(row))
	}
	return rows, nil
}
func (tx fakeTx) Update(_ context.Context, table string, values erpwire.Row, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	if len(orgPredicates(where)) != 1 {
		return nil, errors.New("unscoped update")
	}
	rows := []erpwire.Row{}
	for _, row := range tx.store.tables[table] {
		if row["org_id"] == tx.actor.OrgID() && rowMatches(row, where) {
			for key, value := range values {
				row[key] = value
			}
			rows = append(rows, cloneRow(row))
		}
	}
	return rows, nil
}
func (tx fakeTx) Delete(_ context.Context, table string, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	if len(orgPredicates(where)) != 1 {
		return nil, errors.New("unscoped delete")
	}
	kept, deleted := []erpwire.Row{}, []erpwire.Row{}
	for _, row := range tx.store.tables[table] {
		if row["org_id"] == tx.actor.OrgID() && rowMatches(row, where) {
			deleted = append(deleted, row)
		} else {
			kept = append(kept, row)
		}
	}
	tx.store.tables[table] = kept
	return deleted, nil
}

func testActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	now := time.Now()
	a, err := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: testUser, Email: "staff@example.invalid", Assurance: erpwire.AAL2, ExpiresAt: now.Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: testUser, OrgID: testOrg, Role: role}, false, now)
	if err != nil {
		t.Fatal(err)
	}
	return a
}
func testService(t *testing.T) (*Service, *fakeStore) {
	t.Helper()
	store := &fakeStore{tables: map[string][]erpwire.Row{}, insertErr: map[string]error{}}
	s, err := New(Options{Store: store})
	if err != nil {
		t.Fatal(err)
	}
	return s, store
}
func invoke(t *testing.T, op erpwire.Operation, a erpwire.Actor, args ...any) any {
	t.Helper()
	if args == nil {
		args = []any{}
	}
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	value, err := op(context.Background(), a, raw)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func actionValue(t *testing.T, result any) erpwire.Row {
	t.Helper()
	response, ok := result.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("unexpected response %#v", result)
	}
	switch value := response.Value.(type) {
	case erpwire.Row:
		return value
	case map[string]any:
		return value
	}
	t.Fatalf("unexpected action value %#v", response.Value)
	return nil
}
func expectError(t *testing.T, result any, want string) {
	t.Helper()
	value := actionValue(t, result)
	if value["error"] != want {
		t.Fatalf("got %#v, want error %q", value, want)
	}
}
func seedDeal(store *fakeStore) {
	store.tables["deals"] = []erpwire.Row{{"org_id": testOrg, "id": testDeal, "client_id": testClient, "title": "งานใหม่", "stage": "proposal", "value_satang": int64(123456), "probability": int64(50), "sequence": int64(1), "created_at": "2026-01-01T00:00:00Z", "expected_close_date": "2026-12-01", "next_follow_up_date": "2000-01-01", "owner": testUser}}
	store.tables["clients"] = []erpwire.Row{{"org_id": testOrg, "id": testClient, "name": "ลูกค้า"}}
	store.tables["deal_lost_reasons"] = []erpwire.Row{{"org_id": testOrg, "id": testReason, "name": "ราคา", "active": true}}
}
