package erpledger

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

const orgID = "10000000-0000-4000-8000-000000000001"
const otherOrg = "10000000-0000-4000-8000-000000000002"
const userID = "20000000-0000-4000-8000-000000000001"
const recordID = "30000000-0000-4000-8000-000000000001"
const otherID = "30000000-0000-4000-8000-000000000002"
const thirdID = "30000000-0000-4000-8000-000000000003"

type commandCall struct {
	Name string
	Args erpwire.Row
}
type fakeStore struct {
	t             *testing.T
	tables        map[string][]erpwire.Row
	commands      []commandCall
	selects       []erpwire.Select
	reads, writes int
	failTable     string
	failRead      error
	commandError  error
	commandResult json.RawMessage
	pageSize      int
}
type fakeTx struct {
	store    *fakeStore
	actor    erpwire.Actor
	writable bool
}

func newFake(t *testing.T) *fakeStore {
	return &fakeStore{t: t, tables: map[string][]erpwire.Row{}, commandResult: json.RawMessage(`null`)}
}
func actor(t *testing.T, role erpwire.Role, org string) erpwire.Actor {
	t.Helper()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: userID, Email: "worker@example.test", Assurance: erpwire.AAL1, ExpiresAt: time.Now().Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: userID, OrgID: org, Role: role}, false, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func (f *fakeStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	f.reads++
	if f.failRead != nil {
		return f.failRead
	}
	return fn(&fakeTx{f, a, false})
}
func (f *fakeStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	f.writes++
	before := map[string][]erpwire.Row{}
	for k, rs := range f.tables {
		before[k] = append([]erpwire.Row{}, rs...)
	}
	e := fn(&fakeTx{f, a, true})
	if e != nil {
		f.tables = before
	}
	return e
}
func match(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		v := row[p.Column]
		switch p.Op {
		case erpwire.Equal:
			if !reflect.DeepEqual(v, p.Value) {
				return false
			}
		case erpwire.NotEqual:
			if reflect.DeepEqual(v, p.Value) {
				return false
			}
		case erpwire.Is:
			if !reflect.DeepEqual(v, p.Value) {
				return false
			}
		case erpwire.In:
			if !has(p.Value.([]string), text(v)) {
				return false
			}
		default:
			panic("unsupported fake predicate")
		}
	}
	return true
}
func (f *fakeTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	f.store.selects = append(f.store.selects, q)
	if f.store.failTable == q.Table {
		return erpwire.Selection{}, errors.New("private database detail")
	}
	scoped := false
	for _, p := range q.Where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == f.actor.OrgID() {
			scoped = true
		}
	}
	if !scoped {
		f.store.t.Fatalf("unscoped %s read: %#v", q.Table, q)
	}
	if q.Table == "journal_lines" {
		for _, o := range q.Order {
			if o.Column == "id" {
				f.store.t.Fatal("journal_lines has no id column")
			}
		}
	}
	selected := []erpwire.Row{}
	for _, r := range f.store.tables[q.Table] {
		if r["org_id"] == f.actor.OrgID() && match(r, q.Where) {
			selected = append(selected, r)
		}
	}
	sort.SliceStable(selected, func(i, j int) bool {
		for _, o := range q.Order {
			x, y := fmt.Sprint(selected[i][o.Column]), fmt.Sprint(selected[j][o.Column])
			if x == y {
				continue
			}
			a, ea := whole(selected[i][o.Column])
			b, eb := whole(selected[j][o.Column])
			less := x < y
			if ea == nil && eb == nil {
				less = a < b
			}
			if o.Descending {
				return !less
			}
			return less
		}
		return false
	})
	total := int64(len(selected))
	start := min(q.Offset, len(selected))
	limit := q.Limit
	if f.store.pageSize > 0 && limit == 1000 {
		limit = f.store.pageSize
	}
	end := len(selected)
	if limit > 0 {
		end = min(end, start+limit)
	}
	result := erpwire.Selection{Rows: []erpwire.Row{}, Total: &total, HasMore: end < len(selected)}
	for _, row := range selected[start:end] {
		projected := erpwire.Row{}
		for _, col := range q.Columns {
			projected[col] = row[col]
		}
		for _, relation := range q.Relations {
			projected[relation.Name] = nil
			for _, related := range f.store.tables[relation.Table] {
				if related["org_id"] == f.actor.OrgID() && related[relation.ForeignColumn] == row[relation.LocalColumn] {
					value := erpwire.Row{}
					for _, col := range relation.Columns {
						value[col] = related[col]
					}
					projected[relation.Name] = value
					break
				}
			}
		}
		result.Rows = append(result.Rows, projected)
	}
	return result, nil
}
func (f *fakeTx) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected read RPC")
}
func (f *fakeTx) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if !f.writable {
		f.store.t.Fatal("command in read-only transaction")
	}
	if args["p_org_id"] != f.actor.OrgID() {
		f.store.t.Fatalf("unscoped command %s", name)
	}
	f.store.commands = append(f.store.commands, commandCall{name, args})
	return f.store.commandResult, f.store.commandError
}
func (f *fakeTx) Insert(_ context.Context, q erpwire.Insert) ([]erpwire.Row, error) {
	if !f.writable {
		f.store.t.Fatal("read-only insert")
	}
	out := []erpwire.Row{}
	for _, row := range q.Rows {
		if row["org_id"] != f.actor.OrgID() {
			f.store.t.Fatal("unscoped insert")
		}
		saved := copyRow(row)
		if saved["id"] == nil {
			saved["id"] = recordID
		}
		f.store.tables[q.Table] = append(f.store.tables[q.Table], saved)
		result := erpwire.Row{}
		for _, c := range q.Returning {
			result[c] = saved[c]
		}
		out = append(out, result)
	}
	return out, nil
}
func (f *fakeTx) Update(context.Context, string, erpwire.Row, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected direct update")
}
func (f *fakeTx) Delete(_ context.Context, table string, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	if !f.writable {
		f.store.t.Fatal("read-only delete")
	}
	remaining := []erpwire.Row{}
	for _, r := range f.store.tables[table] {
		if r["org_id"] != f.actor.OrgID() || !match(r, where) {
			remaining = append(remaining, r)
		}
	}
	f.store.tables[table] = remaining
	return nil, nil
}
func (f *fakeStore) add(table string, rows ...erpwire.Row) {
	for _, row := range rows {
		if _, ok := row["org_id"]; !ok {
			row["org_id"] = orgID
		}
		f.tables[table] = append(f.tables[table], row)
	}
}
func service(t *testing.T, f *fakeStore) *Service {
	t.Helper()
	s, e := New(Options{Store: f})
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func call(t *testing.T, s *Service, a erpwire.Actor, path, name string, args ...any) (any, error) {
	t.Helper()
	op := s.Operations()["app/(app)/finance/"+path+"::"+name]
	if op == nil {
		t.Fatalf("missing %s::%s", path, name)
	}
	raw, e := json.Marshal(args)
	if args == nil {
		raw = []byte("[]")
	}
	if e != nil {
		t.Fatal(e)
	}
	return op(context.Background(), a, raw)
}
func action(t *testing.T, value any, err error) erpwire.ActionResponse {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	r, ok := value.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("not an action: %#v", value)
	}
	return r
}
func expectError(t *testing.T, value any, err error, want string) {
	t.Helper()
	r := action(t, value, err)
	got := text(object(r.Value)["error"])
	if got != want {
		t.Fatalf("error = %q, want %q", got, want)
	}
	if r.Redirect != "" || len(r.Refresh) > 0 {
		t.Fatal("failure returned success navigation")
	}
}
func fakeChart(f *fakeStore) {
	for _, code := range []string{"1110", "1120", "1130", "2120", "2130", "4100"} {
		f.add("gl_accounts", erpwire.Row{"code": code, "name_th": "ไทย " + code, "name_en": "Account " + code, "kind": "asset"})
	}
	f.add("org_settings", erpwire.Row{"lock_date": "2026-10-31", "cash_balance_satang": int64(0), "vat_registered": true})
}
