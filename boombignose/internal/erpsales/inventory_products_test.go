package erpsales

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

const invTestOrg = "a0000000-0000-0000-0000-000000000001"
const invTestOther = "b0000000-0000-0000-0000-000000000001"
const invTestUser = "a0000000-0000-0000-0000-000000000002"
const invTestProduct = "a0000000-0000-0000-0000-000000000003"
const invTestWarehouse = "a0000000-0000-0000-0000-000000000004"
const invTestWarehouse2 = "a0000000-0000-0000-0000-000000000005"
const invTestKey = "550e8400-e29b-41d4-a716-446655440000"

func invTestActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: invTestUser, Email: "worker@example.test", Assurance: erpwire.AAL1, ExpiresAt: time.Now().Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: invTestUser, OrgID: invTestOrg, OrgName: "<Org>", Role: role}, false, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func invTestArgs(values ...any) json.RawMessage {
	if values == nil {
		values = []any{}
	}
	b, _ := json.Marshal(values)
	return b
}
func invTestObject(t *testing.T, value any) erpwire.Row {
	t.Helper()
	result, ok := value.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("expected ActionResponse, got %#v", value)
	}
	if m, ok := result.Value.(erpwire.Row); ok {
		return m
	}
	if m, ok := result.Value.(map[string]any); ok {
		return m
	}
	t.Fatalf("unexpected action value %#v", result.Value)
	return nil
}
func invTestError(t *testing.T, value any, want string) {
	t.Helper()
	if got := text(invTestObject(t, value)["error"]); got != want {
		t.Fatalf("error=%q, want %q", got, want)
	}
}

type invTestCall struct {
	name   string
	params erpwire.Row
}
type invTestStore struct {
	rows          map[string][]erpwire.Row
	reads, writes int
	queries       []erpwire.Select
	calls         []invTestCall
	rpc           map[string]json.RawMessage
	commandError  error
	mutationError error
	command       func(string, erpwire.Row) (json.RawMessage, error)
}

func invTestNew() *invTestStore {
	return &invTestStore{rows: map[string][]erpwire.Row{}, rpc: map[string]json.RawMessage{}}
}
func (f *invTestStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	f.reads++
	return fn(f)
}
func (f *invTestStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	f.writes++
	return fn(f)
}
func invTestClone(row erpwire.Row) erpwire.Row {
	out := erpwire.Row{}
	for k, v := range row {
		out[k] = v
	}
	return out
}
func invTestPredicate(row erpwire.Row, p erpwire.Predicate) bool {
	switch p.Op {
	case erpwire.Equal:
		return fmt.Sprint(row[p.Column]) == fmt.Sprint(p.Value)
	case erpwire.In:
		values := reflect.ValueOf(p.Value)
		for i := 0; i < values.Len(); i++ {
			if fmt.Sprint(row[p.Column]) == fmt.Sprint(values.Index(i).Interface()) {
				return true
			}
		}
		return false
	case erpwire.ILike:
		term := strings.Trim(fmt.Sprint(p.Value), "%")
		term = strings.NewReplacer(`\\`, `\`, `\%`, `%`, `\_`, `_`).Replace(term)
		return strings.Contains(strings.ToLower(fmt.Sprint(row[p.Column])), strings.ToLower(term))
	case erpwire.Less, erpwire.LessEqual, erpwire.Greater, erpwire.GreaterEqual:
		comparison := strings.Compare(fmt.Sprint(row[p.Column]), fmt.Sprint(p.Value))
		left, leftOK := invRat(row[p.Column], false)
		right, rightOK := invRat(p.Value, false)
		if leftOK && rightOK {
			comparison = left.Cmp(right)
		}
		switch p.Op {
		case erpwire.Less:
			return comparison < 0
		case erpwire.LessEqual:
			return comparison <= 0
		case erpwire.Greater:
			return comparison > 0
		default:
			return comparison >= 0
		}
	case erpwire.Is:
		return (row[p.Column] == nil) == (p.Value == nil)
	}
	return false
}
func invTestMatches(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		if !invTestPredicate(row, p) {
			return false
		}
	}
	return true
}
func (f *invTestStore) Select(ctx context.Context, q erpwire.Select) (erpwire.Selection, error) {
	f.queries = append(f.queries, q)
	rows := []erpwire.Row{}
	for _, r := range f.rows[q.Table] {
		if !invTestMatches(r, q.Where) {
			continue
		}
		matched := true
		for _, group := range q.Any {
			some := false
			for _, p := range group {
				some = some || invTestPredicate(r, p)
			}
			matched = matched && some
		}
		if matched {
			rows = append(rows, invTestClone(r))
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, o := range q.Order {
			a, b := fmt.Sprint(rows[i][o.Column]), fmt.Sprint(rows[j][o.Column])
			comparison := strings.Compare(a, b)
			left, leftOK := invRat(rows[i][o.Column], false)
			right, rightOK := invRat(rows[j][o.Column], false)
			if leftOK && rightOK {
				comparison = left.Cmp(right)
			}
			if comparison != 0 {
				if o.Descending {
					return comparison > 0
				}
				return comparison < 0
			}
		}
		return false
	})
	total := int64(len(rows))
	start := q.Offset
	if start > len(rows) {
		start = len(rows)
	}
	end := len(rows)
	if q.Limit > 0 && end > start+q.Limit {
		end = start + q.Limit
	}
	out := erpwire.Selection{Rows: rows[start:end], HasMore: end < len(rows)}
	if q.Count {
		out.Total = &total
	}
	return out, nil
}
func (f *invTestStore) ReadRPC(ctx context.Context, name string, p erpwire.Row) (json.RawMessage, error) {
	f.calls = append(f.calls, invTestCall{name, invTestClone(p)})
	if data, ok := f.rpc[name]; ok {
		return data, nil
	}
	return nil, errors.New("unexpected read RPC")
}
func (f *invTestStore) Command(ctx context.Context, name string, p erpwire.Row) (json.RawMessage, error) {
	f.calls = append(f.calls, invTestCall{name, invTestClone(p)})
	if f.command != nil {
		return f.command(name, p)
	}
	if f.commandError != nil {
		return nil, f.commandError
	}
	return json.RawMessage(`"a0000000-0000-0000-0000-000000000099"`), nil
}
func (f *invTestStore) Insert(ctx context.Context, in erpwire.Insert) ([]erpwire.Row, error) {
	if f.mutationError != nil {
		return nil, f.mutationError
	}
	rows := []erpwire.Row{}
	for _, r := range in.Rows {
		r = invTestClone(r)
		if r["id"] == nil {
			r["id"] = invTestProduct
		}
		f.rows[in.Table] = append(f.rows[in.Table], r)
		rows = append(rows, invTestClone(r))
	}
	return rows, nil
}
func (f *invTestStore) Update(ctx context.Context, table string, values erpwire.Row, where []erpwire.Predicate, columns []string) ([]erpwire.Row, error) {
	if f.mutationError != nil {
		return nil, f.mutationError
	}
	rows := []erpwire.Row{}
	for _, r := range f.rows[table] {
		if invTestMatches(r, where) {
			for k, v := range values {
				r[k] = v
			}
			rows = append(rows, invTestClone(r))
		}
	}
	return rows, nil
}
func (f *invTestStore) Delete(ctx context.Context, table string, where []erpwire.Predicate, columns []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected delete")
}

type invTestDBError struct{ message, code string }

func (e invTestDBError) Error() string           { return e.message }
func (e invTestDBError) BusinessMessage() string { return e.message }
func (e invTestDBError) SQLState() string        { return e.code }

func TestInventoryProductAuthorization(t *testing.T) {
	store := invTestNew()
	s, _ := New(Options{Store: store})
	member := invTestActor(t, erpwire.Member)
	for key, op := range s.inventoryProductOperations() {
		t.Run(key, func(t *testing.T) {
			if _, e := op(context.Background(), erpwire.Actor{}, invTestArgs()); !errors.Is(e, erpwire.ErrUnauthenticated) {
				t.Fatalf("unauthenticated=%v", e)
			}
		})
	}
	for key, op := range s.inventoryProductOperations() {
		if strings.HasPrefix(key, "lib/inventory/actions.ts::") || key == "app/(app)/inventory/adjust/page.tsx::load" || key == "app/(app)/inventory/transfer/page.tsx::load" || key == "app/(app)/products/new/page.tsx::load" || key == "app/(app)/products/[id]/edit/page.tsx::load" {
			t.Run("member/"+key, func(t *testing.T) {
				if _, e := op(context.Background(), member, invTestArgs()); !errors.Is(e, erpwire.ErrForbidden) {
					t.Fatalf("member=%v", e)
				}
			})
		}
	}
	for _, op := range []erpwire.Operation{s.saveProduct, s.setProductActive} {
		v, e := op(context.Background(), member, invTestArgs())
		if e != nil {
			t.Fatal(e)
		}
		invTestError(t, v, "Only owners and admins can manage products.")
	}
	if store.reads != 0 || store.writes != 0 {
		t.Fatalf("denied calls reached store: %#v", store)
	}
}
func TestProductValidationAndExactMoney(t *testing.T) {
	base := erpwire.Row{"name": " Training ", "sku": " TRAIN ", "description": " Training day ", "type": "service", "unit": " day ", "listPriceBaht": "1.01", "costBaht": "0.50", "taxRateBps": 700, "isStockable": false}
	for _, test := range []struct {
		name, key string
		value     any
		valid     bool
		price     int64
	}{{"one satang", "listPriceBaht", "0.01", true, 1}, {"safe maximum", "listPriceBaht", "90071992547409.91", true, 9007199254740991}, {"overflow", "listPriceBaht", "90071992547409.92", false, 0}, {"precision", "listPriceBaht", "1.001", false, 0}, {"negative", "costBaht", "-1", false, 0}, {"blank name", "name", " ", false, 0}, {"invalid tax", "taxRateBps", 10001, false, 0}, {"tax string", "taxRateBps", "700", false, 0}, {"boolean stockable", "isStockable", "true", false, 0}} {
		t.Run(test.name, func(t *testing.T) {
			input := invTestClone(base)
			input[test.key] = test.value
			args := invTestArgs(input)
			parsed, _ := arguments(args, 1, 1)
			v, _ := invObject(parsed, 0)
			row, ok := productInput(v)
			if ok != test.valid {
				t.Fatalf("valid=%v, row=%#v", ok, row)
			}
			if ok {
				if test.price != 0 && row["list_price_satang"] != test.price {
					t.Fatalf("price=%#v", row["list_price_satang"])
				}
				if row["name"] != "Training" || row["unit"] != "day" || row["sku"] != "TRAIN" {
					t.Fatalf("normalization=%#v", row)
				}
			}
		})
	}
}
func TestProductMutationIsolationAndArchiveRestore(t *testing.T) {
	store := invTestNew()
	own := erpwire.Row{"id": invTestProduct, "org_id": invTestOrg, "name": "Own", "active": true}
	foreign := erpwire.Row{"id": invTestProduct, "org_id": invTestOther, "name": "Foreign", "active": true}
	store.rows["products"] = []erpwire.Row{own, foreign}
	s, _ := New(Options{Store: store})
	a := invTestActor(t, erpwire.Owner)
	for _, active := range []bool{false, true} {
		v, e := s.setProductActive(context.Background(), a, invTestArgs(invTestProduct, active))
		if e != nil {
			t.Fatal(e)
		}
		if text(invTestObject(t, v)["error"]) != "" || own["active"] != active || foreign["active"] != true {
			t.Fatalf("active=%v own=%#v foreign=%#v result=%#v", active, own, foreign, v)
		}
	}
	audits := store.rows["audit_log"]
	if len(audits) != 2 || audits[0]["action"] != "archived" || audits[1]["action"] != "restored" {
		t.Fatalf("audits=%#v", audits)
	}
	store.rows["products"] = []erpwire.Row{foreign}
	v, e := s.setProductActive(context.Background(), a, invTestArgs(invTestProduct, false))
	if e != nil {
		t.Fatal(e)
	}
	invTestError(t, v, "Product not found")
	if foreign["active"] != true {
		t.Fatal("other org mutated")
	}
}
func TestProductReadsScopeAndOmitCost(t *testing.T) {
	store := invTestNew()
	store.rows["products"] = []erpwire.Row{{"id": invTestProduct, "org_id": invTestOrg, "name": "Training", "sku": "TRAIN", "active": true, "cost_satang": int64(500)}, {"id": "other", "org_id": invTestOther, "name": "Training", "active": true, "cost_satang": int64(999)}}
	s, _ := New(Options{Store: store})
	a := invTestActor(t, erpwire.Member)
	value, e := s.activeProductOptions(context.Background(), a, invTestArgs(" TRAIN "))
	if e != nil {
		t.Fatal(e)
	}
	rows := value.([]erpwire.Row)
	if len(rows) != 1 || rows[0]["id"] != invTestProduct {
		t.Fatalf("rows=%#v", rows)
	}
	if _, ok := rows[0]["cost_satang"]; ok {
		t.Fatalf("cost leaked: %#v", rows)
	}
	if _, e := s.activeProductOptions(context.Background(), a, invTestArgs("", true)); !errors.Is(e, erpwire.ErrForbidden) {
		t.Fatalf("cost permission=%v", e)
	}
	_, e = s.productDetailLoad(context.Background(), a, invTestArgs("b0000000-0000-0000-0000-000000000099"))
	if !errors.Is(e, erpwire.ErrNotFound) {
		t.Fatalf("foreign detail=%v", e)
	}
}
func TestInventoryActionValidation(t *testing.T) {
	count := erpwire.Row{"product_id": invTestProduct, "warehouse_id": invTestWarehouse, "quantity": "1.001", "unit_cost_satang": int64(9007199254740991), "reason": " Count ", "key": invTestKey}
	transfer := erpwire.Row{"product_id": invTestProduct, "from_warehouse_id": invTestWarehouse, "to_warehouse_id": invTestWarehouse2, "quantity": "0.001", "reason": " Move ", "key": invTestKey}
	for _, test := range []struct {
		name    string
		op      string
		input   erpwire.Row
		key     string
		bad     any
		message string
	}{{"count precision", "adjustStock", count, "quantity", "0.0001", "Choose a product and warehouse, and enter a nonnegative count and reason."}, {"count negative", "adjustStock", count, "quantity", "-1", "Choose a product and warehouse, and enter a nonnegative count and reason."}, {"cost unsafe", "adjustStock", count, "unit_cost_satang", json.Number("9007199254740992"), "Choose a product and warehouse, and enter a nonnegative count and reason."}, {"same warehouse", "transferStock", transfer, "to_warehouse_id", invTestWarehouse, "Choose different warehouses, a positive quantity and a reason."}, {"zero transfer", "transferStock", transfer, "quantity", 0, "Choose different warehouses, a positive quantity and a reason."}, {"invalid retry key", "transferStock", transfer, "key", invTestProduct, "Choose different warehouses, a positive quantity and a reason."}} {
		t.Run(test.name, func(t *testing.T) {
			store := invTestNew()
			s, _ := New(Options{Store: store})
			input := invTestClone(test.input)
			input[test.key] = test.bad
			v, e := s.inventoryProductOperations()["lib/inventory/actions.ts::"+test.op](context.Background(), invTestActor(t, erpwire.Owner), invTestArgs(input))
			if e != nil {
				t.Fatal(e)
			}
			invTestError(t, v, test.message)
			if store.writes != 0 {
				t.Fatal("invalid input reached write")
			}
		})
	}
}
func TestInventoryTransitionCommandParameters(t *testing.T) {
	count := erpwire.Row{"product_id": invTestProduct, "warehouse_id": invTestWarehouse, "quantity": "1.001", "unit_cost_satang": int64(9007199254740991), "reason": " Count ", "key": invTestKey}
	transfer := erpwire.Row{"product_id": invTestProduct, "from_warehouse_id": invTestWarehouse, "to_warehouse_id": invTestWarehouse2, "quantity": "0.001", "reason": " Move ", "key": invTestKey}
	tests := []struct {
		name, command string
		args          []any
		expected      erpwire.Row
	}{
		{"saveWarehouse", "save_warehouse", []any{erpwire.Row{"id": nil, "code": " MAIN ", "name": " Main ", "address": " ", "is_default": true, "active": true}}, erpwire.Row{"p_id": nil, "p_code": "MAIN", "p_name": "Main", "p_address": nil, "p_default": true, "p_active": true}},
		{"deleteWarehouse", "delete_warehouse", []any{invTestWarehouse}, erpwire.Row{"p_id": invTestWarehouse}},
		{"adjustStock", "adjust_stock", []any{count}, erpwire.Row{"p_product_id": invTestProduct, "p_warehouse_id": invTestWarehouse, "p_count": json.Number("1.001"), "p_unit_cost_satang": int64(9007199254740991), "p_reason": "Count", "p_key": invTestKey}},
		{"transferStock", "transfer_stock", []any{transfer}, erpwire.Row{"p_product_id": invTestProduct, "p_from_warehouse_id": invTestWarehouse, "p_to_warehouse_id": invTestWarehouse2, "p_quantity": json.Number("0.001"), "p_reason": "Move", "p_key": invTestKey}},
		{"deliverInvoice", "deliver_invoice", []any{invTestProduct, invTestWarehouse, []erpwire.Row{{"id": invTestProduct, "delivered_quantity": "1.5", "previous_delivered_quantity": "0"}}, "2026-11-08"}, erpwire.Row{"p_invoice_id": invTestProduct, "p_warehouse_id": invTestWarehouse, "p_lines": []erpwire.Row{{"id": invTestProduct, "delivered_quantity": json.Number("1.5"), "previous_delivered_quantity": json.Number("0")}}, "p_date": "2026-11-08"}},
		{"returnInvoiceDelivery", "return_invoice_delivery", []any{invTestProduct, invTestWarehouse, "0.001"}, erpwire.Row{"p_invoice_id": invTestProduct, "p_move_id": invTestWarehouse, "p_returned_quantity": json.Number("0.001")}},
		{"saveReorder", "save_reorder_rule", []any{erpwire.Row{"product_id": invTestProduct, "default_vendor_id": "", "reorder_min": "0.1", "reorder_qty": "0.001", "lead_days": "3650"}}, erpwire.Row{"p_product_id": invTestProduct, "p_vendor_id": nil, "p_min": json.Number("0.1"), "p_quantity": json.Number("0.001"), "p_lead_days": int64(3650)}},
		{"createReplenishment", "create_replenishment_rfq", []any{invTestProduct}, erpwire.Row{"p_vendor_id": invTestProduct}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := invTestNew()
			s, _ := New(Options{Store: store})
			v, e := s.inventoryProductOperations()["lib/inventory/actions.ts::"+test.name](context.Background(), invTestActor(t, erpwire.Owner), invTestArgs(test.args...))
			if e != nil {
				t.Fatal(e)
			}
			if m := invTestObject(t, v); m["error"] != nil {
				t.Fatalf("result=%#v", v)
			}
			if len(store.calls) != 1 {
				t.Fatalf("commands=%#v", store.calls)
			}
			test.expected["p_org_id"] = invTestOrg
			if store.calls[0].name != test.command || !reflect.DeepEqual(store.calls[0].params, test.expected) {
				t.Fatalf("call=%#v want=%#v", store.calls[0], test.expected)
			}
		})
	}
}
func TestInventoryCommandErrorsAndRetryIdentity(t *testing.T) {
	store := invTestNew()
	s, _ := New(Options{Store: store})
	a := invTestActor(t, erpwire.Owner)
	input := erpwire.Row{"product_id": invTestProduct, "warehouse_id": invTestWarehouse, "quantity": "0", "reason": "Count", "key": invTestKey}
	for i := 0; i < 2; i++ {
		if _, e := s.adjustStock(context.Background(), a, invTestArgs(input)); e != nil {
			t.Fatal(e)
		}
	}
	if len(store.calls) != 2 || !reflect.DeepEqual(store.calls[0].params, store.calls[1].params) {
		t.Fatalf("retry changed command: %#v", store.calls)
	}
	store.commandError = invTestDBError{"Insufficient stock", "P0001"}
	v, e := s.adjustStock(context.Background(), a, invTestArgs(input))
	if e != nil {
		t.Fatal(e)
	}
	invTestError(t, v, "Insufficient stock")
	if invTestObject(t, v)["rejected"] != true {
		t.Fatal("definite rejection not marked")
	}
	store.commandError = invTestDBError{"foreign key", "23503"}
	v, e = s.deleteWarehouse(context.Background(), a, invTestArgs(invTestWarehouse))
	if e != nil {
		t.Fatal(e)
	}
	invTestError(t, v, "This warehouse has stock history. Deactivate it instead.")
}
func TestInventoryQuantityAndForecastBoundaries(t *testing.T) {
	for _, test := range []struct {
		input       any
		valid       bool
		thousandths int64
	}{{"0", true, 0}, {"0.001", true, 1}, {"999999999.999", true, 999999999999}, {"1000000000", false, 0}, {"1.0001", false, 0}, {"-1", false, 0}, {json.Number("0.10000000000000002"), true, 100}, {"1e-3", true, 1}} {
		q, n, ok := invQuantity(test.input, false)
		if ok != test.valid || ok && n != test.thousandths {
			t.Fatalf("input=%v quantity=%s n=%d valid=%v", test.input, q, n, ok)
		}
	}
	for _, test := range []struct{ quantity, onOrder, min, reorder, want string }{{"1", "3", "10", "2", "6"}, {"0.1", "0.2", "0.4", "0.001", "0.1"}, {"1", "9", "10", "2", "0"}, {"1", "0", "10", "0", "0"}} {
		got, e := invReplenishmentQuantity(erpwire.Row{"quantity": json.Number(test.quantity), "on_order": json.Number(test.onOrder), "reorder_min": json.Number(test.min), "reorder_qty": json.Number(test.reorder)})
		if e != nil || got.String() != test.want {
			t.Fatalf("forecast=%s, %v want %s", got, e, test.want)
		}
	}
	for _, kind := range invMoveKinds {
		got, e := invSignedQuantity(kind, json.Number("1.125"))
		want := "1.125"
		if has([]string{"delivery", "adjustment_out", "transfer_out", "vendor_return"}, kind) {
			want = "-1.125"
		}
		if e != nil || got.String() != want {
			t.Fatalf("kind=%s quantity=%s err=%v", kind, got, e)
		}
	}
}
func TestInventorySnapshotRejectsUnsafeAndForeignRows(t *testing.T) {
	p := erpwire.Row{"id": invTestProduct, "org_id": invTestOrg, "sku": nil, "name": "Product", "description": nil, "type": "goods", "unit": "piece", "list_price_satang": int64(200), "cost_satang": int64(100), "tax_rate_bps": int64(0), "is_stockable": true, "active": true, "reorder_min": int64(5), "reorder_qty": int64(10), "default_vendor_id": nil, "created_at": "2026-11-08", "updated_at": "2026-11-08", "quantity": json.Number("0.001"), "on_order": int64(0), "reserved_quantity": int64(0), "value_satang": int64(1)}
	a := invTestActor(t, erpwire.Owner)
	for _, test := range []struct {
		name, key string
		value     any
		valid     bool
	}{{"valid", "value_satang", int64(9007199254740991), true}, {"unsafe money", "value_satang", json.Number("9007199254740992"), false}, {"foreign org", "org_id", invTestOther, false}, {"unknown quantity", "quantity", nil, false}, {"bad type", "type", "unknown", false}} {
		t.Run(test.name, func(t *testing.T) {
			row := invTestClone(p)
			row[test.key] = test.value
			raw, _ := json.Marshal(erpwire.Row{"products": []erpwire.Row{row}, "balances": []erpwire.Row{}})
			value, e := invSnapshot(raw, a)
			if (e == nil) != test.valid {
				t.Fatalf("snapshot=%#v error=%v", value, e)
			}
		})
	}
}
func TestInventoryPrintEscapesAndRetainsIdentity(t *testing.T) {
	html := inventoryStockDocumentHTML("<Org>", erpwire.Row{"kind": "delivery", "number": "DO-2026-000001", "document_date": "2026-10-23"}, []erpwire.Row{{"description": "<script>alert(1)</script>", "quantity": json.Number("1.5"), "unit": "piece"}}, "dlv1qqqq-qqqq-qqqq-qqqq-qqqq")
	for _, want := range []string{"DO-2026-000001", "2026-10-23", "1.5", "&lt;script&gt;", "&lt;Org&gt;", "Public reference dlv1qqqq-qqqq-qqqq-qqqq-qqqq"} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %q in %s", want, html)
		}
	}
	if strings.Contains(html, "<script>") {
		t.Fatal("unescaped user text")
	}
}

func TestInventorySnapshotLoadsCompleteRelatedPages(t *testing.T) {
	store := invTestNew()
	store.rpc["inventory_snapshot"] = json.RawMessage(`{"products":[],"balances":[]}`)
	for i := 0; i < 1001; i++ {
		store.rows["warehouses"] = append(store.rows["warehouses"], erpwire.Row{"id": fmt.Sprintf("w-%04d", i), "org_id": invTestOrg, "code": fmt.Sprintf("W-%04d", i)})
	}
	store.rows["warehouses"] = append(store.rows["warehouses"], erpwire.Row{"id": "foreign", "org_id": invTestOther, "code": "Foreign"})
	s, _ := New(Options{Store: store})
	value, e := s.inventoryLoad(context.Background(), invTestActor(t, erpwire.Member), invTestArgs(erpwire.Row{"warehouse": invTestWarehouse, "product": invTestProduct}))
	if e != nil {
		t.Fatal(e)
	}
	result := value.(erpwire.Row)
	if got := len(result["warehouses"].([]erpwire.Row)); got != 1001 {
		t.Fatalf("warehouse count=%d", got)
	}
	if len(store.calls) != 0 {
		t.Fatalf("unexpected read RPC: %#v", store.calls)
	}
	checkedScope := false
	for _, q := range store.queries {
		if q.Table == "stock_on_hand" {
			want := []erpwire.Predicate{eq("org_id", invTestOrg), eq("product_id", invTestProduct), eq("warehouse_id", invTestWarehouse)}
			if !reflect.DeepEqual(q.Where, want) {
				t.Fatalf("snapshot predicates=%#v", q.Where)
			}
			checkedScope = true
		}
	}
	if !checkedScope {
		t.Fatal("missing snapshot balance query")
	}
	seenLater := false
	for _, q := range store.queries {
		if q.Table == "warehouses" && q.Offset == 1000 {
			seenLater = true
		}
	}
	if !seenLater {
		t.Fatal("related rows were truncated at 1000")
	}
}
func TestInventoryMovesKeepSelectorsAndCursor(t *testing.T) {
	store := invTestNew()
	store.rows["products"] = []erpwire.Row{{"org_id": invTestOrg, "id": invTestProduct, "name": "search Product", "is_stockable": false}}
	store.rows["warehouses"] = []erpwire.Row{{"org_id": invTestOrg, "id": invTestWarehouse, "code": "MAIN"}}
	for i := 0; i < 101; i++ {
		store.rows["stock_moves"] = append(store.rows["stock_moves"], erpwire.Row{"org_id": invTestOrg, "id": fmt.Sprint(i), "product_id": invTestProduct, "warehouse_id": invTestWarehouse, "source_id": invTestWarehouse2, "created_by": invTestUser, "kind": "delivery", "quantity": json.Number("0.001"), "sequence": int64(1000 - i)})
	}
	s, _ := New(Options{Store: store})
	params := erpwire.Row{"warehouse": invTestWarehouse, "product": invTestProduct, "sourceId": invTestWarehouse2, "status": "delivery,invalid", "mine": "1", "q": " search ", "before": "5000"}
	value, e := s.inventoryMovesLoad(context.Background(), invTestActor(t, erpwire.Member), invTestArgs(params))
	if e != nil {
		t.Fatal(e)
	}
	result := value.(erpwire.Row)
	shown := result["moves"].([]erpwire.Row)
	if len(shown) != 100 || shown[0]["signedQuantity"] != json.Number("-0.001") {
		t.Fatalf("shown=%#v", shown)
	}
	found := false
	for _, q := range store.queries {
		if q.Table != "stock_moves" {
			continue
		}
		for _, want := range []erpwire.Predicate{eq("org_id", invTestOrg), eq("warehouse_id", invTestWarehouse), eq("product_id", invTestProduct), eq("source_id", invTestWarehouse2), eq("created_by", invTestUser), {Column: "sequence", Op: erpwire.Less, Value: int64(5000)}, {Column: "kind", Op: erpwire.In, Value: []string{"delivery"}}} {
			present := false
			for _, actual := range q.Where {
				present = present || reflect.DeepEqual(actual, want)
			}
			if !present {
				t.Fatalf("missing %#v in %#v", want, q.Where)
			}
		}
		found = true
	}
	if !found {
		t.Fatal("ledger not queried")
	}
	older := text(result["older"])
	for _, piece := range []string{"status=delivery", "warehouse=" + invTestWarehouse, "product=" + invTestProduct, "sourceId=" + invTestWarehouse2, "before=901"} {
		if !strings.Contains(older, piece) {
			t.Fatalf("lost %s from cursor %s", piece, older)
		}
	}
	if len(store.calls) != 0 {
		t.Fatal("used unavailable read RPC")
	}
}

func TestInventoryPolicyValidationAndAudit(t *testing.T) {
	for _, test := range []struct {
		name      string
		threshold any
		tolerance any
		valid     bool
	}{{"max", json.Number("9007199254740991"), json.Number("100"), true}, {"unlimited", nil, json.Number("0.01"), true}, {"unsafe", json.Number("9007199254740992"), json.Number("1"), false}, {"fractional satang", json.Number("1.1"), json.Number("1"), false}, {"tolerance precision", nil, json.Number("1.001"), false}, {"tolerance negative", nil, json.Number("-1"), false}} {
		t.Run(test.name, func(t *testing.T) {
			store := invTestNew()
			s, _ := New(Options{Store: store})
			v, e := s.savePurchasingPolicy(context.Background(), invTestActor(t, erpwire.Owner), invTestArgs(erpwire.Row{"scheduled_replenishment_enabled": true, "purchase_approval_threshold_satang": test.threshold, "over_receipt_tolerance_percent": test.tolerance}))
			if e != nil {
				t.Fatal(e)
			}
			message := text(invTestObject(t, v)["error"])
			if (message == "") != test.valid {
				t.Fatalf("message=%q valid=%v", message, test.valid)
			}
			if test.valid {
				rows := store.rows["org_settings"]
				if len(rows) != 1 || rows[0]["org_id"] != invTestOrg || rows[0]["scheduled_replenishment_enabled"] != true {
					t.Fatalf("policy=%#v", rows)
				}
				audits := store.rows["audit_log"]
				if len(audits) != 1 || audits[0]["action"] != "purchase_policy_updated" || audits[0]["entity_id"] != nil {
					t.Fatalf("policy audit=%#v", audits)
				}
			} else if store.writes != 0 {
				t.Fatal("invalid policy reached database")
			}
		})
	}
}

func invTestSnapshotProduct() erpwire.Row {
	return erpwire.Row{"id": invTestProduct, "org_id": invTestOrg, "sku": nil, "name": "Product", "description": nil, "type": "goods", "unit": "piece", "list_price_satang": int64(200), "cost_satang": int64(100), "tax_rate_bps": int64(0), "is_stockable": true, "active": true, "reorder_min": json.Number("10"), "reorder_qty": json.Number("2"), "default_vendor_id": invTestWarehouse2, "created_at": "2026-11-08", "updated_at": "2026-11-08"}
}
func TestInventoryLocalSnapshotAndReplenishment(t *testing.T) {
	store := invTestNew()
	store.rows["products"] = []erpwire.Row{invTestSnapshotProduct()}
	store.rows["inventory_forecast"] = []erpwire.Row{{"org_id": invTestOrg, "product_id": invTestProduct, "on_order": json.Number("3"), "reserved_quantity": json.Number("0.01")}}
	store.rows["stock_on_hand"] = []erpwire.Row{{"org_id": invTestOrg, "product_id": invTestProduct, "warehouse_id": invTestWarehouse, "quantity": json.Number("0.1"), "average_cost_satang": int64(1010), "value_satang": int64(101)}, {"org_id": invTestOrg, "product_id": invTestProduct, "warehouse_id": invTestWarehouse2, "quantity": json.Number("0.2"), "average_cost_satang": int64(510), "value_satang": int64(102)}, {"org_id": invTestOther, "product_id": invTestProduct, "warehouse_id": invTestWarehouse, "quantity": json.Number("999"), "average_cost_satang": int64(500), "value_satang": int64(9999)}}
	store.rows["product_vendor_lead_times"] = []erpwire.Row{{"org_id": invTestOrg, "product_id": invTestProduct, "vendor_id": invTestWarehouse2, "lead_days": int64(3)}}
	store.rows["vendors"] = []erpwire.Row{{"org_id": invTestOrg, "id": invTestWarehouse2, "name": "Vendor", "active": true}}
	s, _ := New(Options{Store: store})
	a := invTestActor(t, erpwire.Member)
	value, e := s.inventoryLoad(context.Background(), a, invTestArgs())
	if e != nil {
		t.Fatal(e)
	}
	snapshot := value.(erpwire.Row)
	products := snapshot["products"].([]erpwire.Row)
	if len(products) != 1 || products[0]["quantity"] != json.Number("0.3") || products[0]["value_satang"] != json.Number("203") || products[0]["lead_days"] != json.Number("3") {
		t.Fatalf("snapshot products=%#v", products)
	}
	value, e = s.inventoryReplenishLoad(context.Background(), a, invTestArgs())
	if e != nil {
		t.Fatal(e)
	}
	preview := value.(erpwire.Row)["preview"].([]erpwire.Row)
	date, _ := time.Parse("2006-01-02", today())
	if len(preview) != 1 || preview[0]["order_quantity"] != json.Number("6.7") || preview[0]["expected_date"] != date.AddDate(0, 0, 3).Format("2006-01-02") || preview[0]["vendor_id"] != invTestWarehouse2 {
		t.Fatalf("preview=%#v", preview)
	}
	if len(store.calls) != 0 {
		t.Fatal("used unavailable ReadRPC")
	}
}
