package erpinvoicing

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
	"github.com/google/uuid"
)

const testOrg = "10000000-0000-4000-8000-000000000001"
const otherOrg = "10000000-0000-4000-8000-000000000002"
const testUser = "20000000-0000-4000-8000-000000000001"
const testInvoice = "30000000-0000-4000-8000-000000000001"
const testClient = "40000000-0000-4000-8000-000000000001"
const testKey = "50000000-0000-4000-8000-000000000001"
const testPayment = "60000000-0000-4000-8000-000000000001"

type commandCall struct {
	Name string
	Args erpwire.Row
}
type memoryStore struct {
	rows                  map[string][]erpwire.Row
	queries               []erpwire.Select
	commands              []commandCall
	replies               map[string]json.RawMessage
	commandErrors         map[string]error
	readErrors            map[string]error
	readCount, writeCount int
	onCommand             func(*memoryTx, string, erpwire.Row) (json.RawMessage, error)
}
type memoryTx struct {
	store *memoryStore
	actor erpwire.Actor
	rows  map[string][]erpwire.Row
}

func newMemoryStore() *memoryStore {
	return &memoryStore{rows: map[string][]erpwire.Row{}, replies: map[string]json.RawMessage{}, commandErrors: map[string]error{}, readErrors: map[string]error{}}
}
func cloneRows(rows map[string][]erpwire.Row) map[string][]erpwire.Row {
	result := map[string][]erpwire.Row{}
	for table, entries := range rows {
		for _, r := range entries {
			out := erpwire.Row{}
			for k, v := range r {
				out[k] = v
			}
			result[table] = append(result[table], out)
		}
	}
	return result
}
func (s *memoryStore) Read(ctx context.Context, a erpwire.Actor, f func(erpwire.ReadTx) error) error {
	s.readCount++
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return f(&memoryTx{store: s, actor: a, rows: cloneRows(s.rows)})
}
func (s *memoryStore) Write(ctx context.Context, a erpwire.Actor, f func(erpwire.WriteTx) error) error {
	s.writeCount++
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	tx := &memoryTx{store: s, actor: a, rows: cloneRows(s.rows)}
	if e := f(tx); e != nil {
		return e
	}
	s.rows = tx.rows
	return nil
}
func requiresScope(a erpwire.Actor, where []erpwire.Predicate) bool {
	for _, p := range where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == a.OrgID() {
			return true
		}
	}
	return false
}
func compareValue(a, b any) int {
	if reflect.DeepEqual(a, b) {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if ai, e := integer(a); e == nil {
		if bi, e := integer(b); e == nil {
			if ai < bi {
				return -1
			}
			if ai == bi {
				return 0
			}
			return 1
		}
	}
	returnValue := fmt.Sprint(a)
	if returnValue < fmt.Sprint(b) {
		return -1
	}
	if returnValue == fmt.Sprint(b) {
		return 0
	}
	return 1
}
func matchesWhere(r erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		v := r[p.Column]
		n := compareValue(v, p.Value)
		switch p.Op {
		case erpwire.Equal, erpwire.Is:
			if n != 0 {
				return false
			}
		case erpwire.NotEqual:
			if n == 0 || v == nil && p.Value != nil {
				return false
			}
		case erpwire.Greater:
			if n <= 0 {
				return false
			}
		case erpwire.GreaterEqual:
			if n < 0 {
				return false
			}
		case erpwire.Less:
			if n >= 0 {
				return false
			}
		case erpwire.LessEqual:
			if n > 0 {
				return false
			}
		case erpwire.In:
			found := false
			values := reflect.ValueOf(p.Value)
			for i := 0; i < values.Len(); i++ {
				if compareValue(v, values.Index(i).Interface()) == 0 {
					found = true
				}
			}
			if !found {
				return false
			}
		default:
			panic("unsupported test predicate " + p.Op)
		}
	}
	return true
}
func (tx *memoryTx) Select(ctx context.Context, q erpwire.Select) (erpwire.Selection, error) {
	tx.store.queries = append(tx.store.queries, q)
	if !requiresScope(tx.actor, q.Where) {
		return erpwire.Selection{}, errors.New("missing explicit organization scope")
	}
	if e := tx.store.readErrors[q.Table]; e != nil {
		return erpwire.Selection{}, e
	}
	rows := []erpwire.Row{}
	for _, r := range tx.rows[q.Table] {
		if r["org_id"] != tx.actor.OrgID() || !matchesWhere(r, q.Where) {
			continue
		}
		row := erpwire.Row{}
		if q.Columns == nil {
			for k, v := range r {
				row[k] = v
			}
		} else {
			for _, c := range q.Columns {
				row[c] = r[c]
			}
		}
		for _, relation := range q.Relations {
			var related erpwire.Row
			for _, candidate := range tx.rows[relation.Table] {
				if candidate["org_id"] == tx.actor.OrgID() && compareValue(r[relation.LocalColumn], candidate[relation.ForeignColumn]) == 0 {
					related = erpwire.Row{}
					for _, c := range relation.Columns {
						related[c] = candidate[c]
					}
					break
				}
			}
			row[relation.Name] = related
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, order := range q.Order {
			n := compareValue(rows[i][order.Column], rows[j][order.Column])
			if n != 0 {
				if order.Descending {
					return n > 0
				}
				return n < 0
			}
		}
		return false
	})
	count := int64(len(rows))
	start := q.Offset
	if start > len(rows) {
		start = len(rows)
	}
	end := len(rows)
	if q.Limit > 0 && start+q.Limit < end {
		end = start + q.Limit
	}
	result := erpwire.Selection{Rows: rows[start:end], HasMore: end < len(rows)}
	if q.Count {
		result.Total = &count
	}
	return result, nil
}
func (tx *memoryTx) ReadRPC(ctx context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if args["p_org_id"] != tx.actor.OrgID() {
		return nil, erpwire.ErrForbidden
	}
	return nil, fmt.Errorf("unexpected read RPC %s", name)
}
func (tx *memoryTx) Insert(ctx context.Context, input erpwire.Insert) ([]erpwire.Row, error) {
	out := []erpwire.Row{}
	for _, r := range input.Rows {
		if r["org_id"] != tx.actor.OrgID() {
			return nil, erpwire.ErrForbidden
		}
		row := erpwire.Row{}
		for k, v := range r {
			row[k] = v
		}
		if row["id"] == nil {
			row["id"] = uuid.NewString()
		}
		tx.rows[input.Table] = append(tx.rows[input.Table], row)
		out = append(out, row)
	}
	return out, nil
}
func (tx *memoryTx) Update(ctx context.Context, table string, columns erpwire.Row, where []erpwire.Predicate, returning []string) ([]erpwire.Row, error) {
	if !requiresScope(tx.actor, where) {
		return nil, erpwire.ErrForbidden
	}
	out := []erpwire.Row{}
	for _, r := range tx.rows[table] {
		if matchesWhere(r, where) && r["org_id"] == tx.actor.OrgID() {
			for k, v := range columns {
				r[k] = v
			}
			out = append(out, r)
		}
	}
	return out, nil
}
func (tx *memoryTx) Delete(ctx context.Context, table string, where []erpwire.Predicate, returning []string) ([]erpwire.Row, error) {
	if !requiresScope(tx.actor, where) {
		return nil, erpwire.ErrForbidden
	}
	kept, deleted := []erpwire.Row{}, []erpwire.Row{}
	for _, r := range tx.rows[table] {
		if matchesWhere(r, where) && r["org_id"] == tx.actor.OrgID() {
			deleted = append(deleted, r)
		} else {
			kept = append(kept, r)
		}
	}
	tx.rows[table] = kept
	return deleted, nil
}
func (tx *memoryTx) Command(ctx context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if args["p_org_id"] != tx.actor.OrgID() {
		return nil, erpwire.ErrForbidden
	}
	tx.store.commands = append(tx.store.commands, commandCall{name, args})
	if e := tx.store.commandErrors[name]; e != nil {
		return nil, e
	}
	if tx.store.onCommand != nil {
		return tx.store.onCommand(tx, name, args)
	}
	if reply := tx.store.replies[name]; reply != nil {
		return reply, nil
	}
	return json.RawMessage("null"), nil
}
func testActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	now := time.Now()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: testUser, Email: "tester@example.invalid", Assurance: erpwire.AAL1, ExpiresAt: now.Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: testUser, OrgID: testOrg, OrgName: "Test workspace", Role: role}, false, now)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func testService(t *testing.T, store *memoryStore) *Service {
	t.Helper()
	s, e := New(Options{Store: store, Now: func() time.Time { return time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC) }})
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func invoke(t *testing.T, s *Service, a erpwire.Actor, key string, args ...any) (any, error) {
	t.Helper()
	if args == nil {
		args = []any{}
	}
	raw, e := json.Marshal(args)
	if e != nil {
		t.Fatal(e)
	}
	operation := s.Operations()[key]
	if operation == nil {
		t.Fatal("missing operation", key)
	}
	return operation(context.Background(), a, raw)
}
func actionValue(t *testing.T, result any, e error) erpwire.Row {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
	response, ok := result.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("not ActionResponse: %#v", result)
	}
	value, ok := response.Value.(erpwire.Row)
	if !ok {
		t.Fatalf("not action value: %#v", response.Value)
	}
	return value
}
