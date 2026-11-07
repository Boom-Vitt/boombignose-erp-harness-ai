package erpinsight

import (
	"bytes"
	"compress/flate"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestImportCSVPreservesSourceParsing(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         [][]string
		message      string
	}{
		{"Thai semicolon", "\ufeffชื่อ;ที่อยู่\r\nร้าน;\"12; ถนนสุขุมวิท\"\r\n", [][]string{{"ชื่อ", "ที่อยู่"}, {"ร้าน", "12; ถนนสุขุมวิท"}}, ""},
		{"tab", "name\taddress\n\"A\"\t\"a\n\"\"b\"\"\"\n\n", [][]string{{"name", "address"}, {"A", "a\n\"b\""}}, ""},
		{"source permissive quotes", "name\nA\"B\"C", [][]string{{"name"}, {"ABC"}}, ""},
		{"empty", " \n\r\n", [][]string{}, ""},
		{"open quote", "name\n\"x", nil, "A quoted cell was not closed."},
		{"columns", strings.Repeat("x,", 40) + "x", nil, "A file can have at most 40 columns."},
		{"rows", "name\n" + strings.Repeat("x\n", 2001), nil, "A file can have at most 2000 data rows."},
	} {
		t.Run(test.name, func(t *testing.T) {
			rows, err := parseImportCSV(test.source)
			if test.message != "" {
				if err == nil || err.Error() != test.message {
					t.Fatalf("error=%v, want %q", err, test.message)
				}
				return
			}
			if err != nil || !reflect.DeepEqual(rows, test.want) {
				t.Fatalf("rows=%#v, error=%v; want %#v", rows, err, test.want)
			}
		})
	}
}

func TestImportUTF8PreservesNodeReplacementSequences(t *testing.T) {
	for _, test := range []struct {
		data []byte
		want string
	}{
		{[]byte{0xff, 0xff}, "\ufffd\ufffd"},
		{[]byte{0xe2, 0x82}, "\ufffd"},
		{[]byte{0xe2, 0x82, 'A'}, "\ufffdA"},
		{[]byte{0xed, 0xa0, 0x80}, "\ufffd\ufffd\ufffd"},
		{[]byte("ร้าน😀"), "ร้าน😀"},
	} {
		if got := importUTF8(test.data); got != test.want {
			t.Fatalf("UTF8 %x=%q, want %q", test.data, got, test.want)
		}
	}
}

func TestImportRowsExactErrorsAndMoney(t *testing.T) {
	grid, e := parseImportCSV("ชื่อ,เลขผู้เสียภาษี,ที่อยู่,โทร,อีเมล\nร้านทดสอบ,1234567890123,\"12, ถนนสุขุมวิท\",0812345678,shop@example.invalid\n,,ที่อยู่,\n")
	if e != nil {
		t.Fatal(e)
	}
	got := validateImport("customers", grid)
	if !reflect.DeepEqual(got.errors, []importError{{3, "ชื่อ is required and must be 200 characters or fewer."}}) || !reflect.DeepEqual(got.customers, []importCustomer{{"ร้านทดสอบ", "1234567890123", "12, ถนนสุขุมวิท", "0812345678", "shop@example.invalid"}}) {
		t.Fatalf("unexpected customer rows %#v", got)
	}
	for _, test := range []struct {
		amount string
		want   money.Satang
		valid  bool
	}{
		{"0.01", 1, true}, {"฿ 1,234.50", 123450, true}, {"90071992547409.91", money.MaxSafeSatang, true}, {"90071992547409.92", 0, false}, {"1.001", 0, false}, {"-1", 0, false}, {"1e2", 0, false},
	} {
		t.Run(test.amount, func(t *testing.T) {
			result := validateImport("products", [][]string{{"name", "price"}, {"x", test.amount}})
			if test.valid {
				if len(result.errors) != 0 || len(result.products) != 1 || result.products[0].price != test.want {
					t.Fatalf("money %#v, want %d", result, test.want)
				}
			} else if !reflect.DeepEqual(result.errors, []importError{{2, "ราคา must be a baht amount with up to two decimals."}}) {
				t.Fatalf("unsafe money accepted or changed error %#v", result)
			}
		})
	}
	result := validateImport("opening-stock", [][]string{{"รหัส", "จำนวน", "ต้นทุนต่อหน่วย"}, {"RICE", "1.5", "10"}, {"rice", "2", "10"}, {"NONE", "", ""}})
	want := []importError{{3, "รหัส is repeated in this file."}, {4, "จำนวน must be greater than zero with at most three decimals."}, {4, "ต้นทุนต่อหน่วย is required."}}
	if !reflect.DeepEqual(result.errors, want) || !reflect.DeepEqual(result.stock, []importStock{{"RICE", "1.5", 1000}}) {
		t.Fatalf("stock=%#v", result)
	}
	for _, qty := range []string{"0", "-1", "1.0001", "1000000000", "999999999.9991", "1e2"} {
		r := validateImport("opening-stock", [][]string{{"sku", "qty", "unit cost"}, {"x", qty, "0"}})
		if !reflect.DeepEqual(r.errors, []importError{{2, "จำนวน must be greater than zero with at most three decimals."}}) {
			t.Fatalf("invalid quantity %q=%#v", qty, r)
		}
	}
	maximum := validateImport("opening-stock", [][]string{{"sku", "qty", "unit cost"}, {"x", "999999999.999", "0"}})
	if len(maximum.errors) != 0 || maximum.stock[0].quantity != "999999999.999" {
		t.Fatalf("max quantity lost %#v", maximum)
	}
}

func TestImportRowsAliasesAndValidationOrder(t *testing.T) {
	for _, test := range []struct {
		kind string
		grid [][]string
		want []importError
	}{
		{"customers", nil, []importError{{1, "The file is empty."}}},
		{"customers", [][]string{{"phone"}}, []importError{{1, "The first row needs a ชื่อ or name column."}}},
		{"products", [][]string{{"name"}}, []importError{{2, "There are no product rows."}}},
		{"opening-stock", [][]string{{"sku"}}, []importError{{1, "The first row needs รหัส and จำนวน columns."}}},
		{"products", [][]string{{"name", "type", "price", "cost", "vat", "stockable"}, {"", "bad", ".5", "1.001", "7.01", "bad"}}, []importError{{2, "ชื่อ is required and must be 200 characters or fewer."}, {2, "ประเภท must be สินค้า, บริการ, goods, or service."}, {2, "ราคา must be a baht amount with up to two decimals."}, {2, "ต้นทุน must be a baht amount with up to two decimals."}, {2, "ภาษี must be a percent from 0 to 100."}, {2, "สต็อก must be ใช่, ไม่, yes, or no."}}},
	} {
		got := validateImport(test.kind, test.grid)
		if !reflect.DeepEqual(got.errors, test.want) {
			t.Fatalf("%s errors=%#v, want %#v", test.kind, got.errors, test.want)
		}
	}
	rows := validateImport("products", [][]string{{" \ufeff*ชื่อ* ", "ราคา", "ภาษี", "ประเภท", "สต็อก"}, {"บริการ", "1.25", "7.5%", "บริการ", ""}})
	if len(rows.errors) > 0 || rows.products[0].price != 125 || rows.products[0].tax != 750 || rows.products[0].stockable {
		t.Fatalf("Thai aliases/defaults lost %#v", rows)
	}
	if got := validateImport("customers", [][]string{{"name"}, {strings.Repeat("😀", 101)}}); len(got.errors) != 1 {
		t.Fatalf("UTF16 maximum ignored %#v", got)
	}
}

func importTestXLSX(files ...importZipEntry) []byte {
	var result bytes.Buffer
	for _, file := range files {
		var compressed bytes.Buffer
		writer, _ := flate.NewWriter(&compressed, flate.DefaultCompression)
		_, _ = writer.Write(file.data)
		_ = writer.Close()
		header := make([]byte, 30)
		binary.LittleEndian.PutUint32(header, 0x04034b50)
		binary.LittleEndian.PutUint16(header[8:], 8)
		binary.LittleEndian.PutUint32(header[18:], uint32(compressed.Len()))
		binary.LittleEndian.PutUint16(header[26:], uint16(len(file.name)))
		result.Write(header)
		result.WriteString(file.name)
		result.Write(compressed.Bytes())
	}
	return result.Bytes()
}

func TestImportXLSXSourceSubset(t *testing.T) {
	sheet := `<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>ชื่อ</t></is></c><c r="C1" t="inlineStr"><is><t>ราคา</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>RICE</t></is></c><c r="B2" t="s"><v>1</v></c><c r="C2"><v>50.5</v></c></row></sheetData></worksheet>`
	data := importTestXLSX(importZipEntry{"xl/worksheets/sheet1.xml", []byte(sheet)}, importZipEntry{"xl/sharedStrings.xml", []byte(`<sst><si><t>รหัส</t></si><si><r><t>ข้าว</t></r><r><t>&amp;สาร</t></r></si></sst>`)})
	grid, e := parseSpreadsheet("file.xlsx", data)
	want := [][]string{{"รหัส", "ชื่อ", "ราคา"}, {"RICE", "ข้าว&สาร", "50.5"}}
	if e != nil || !reflect.DeepEqual(grid, want) {
		t.Fatalf("xlsx=%#v,%v; want %#v", grid, e, want)
	}
	parsed := validateImport("products", grid)
	if len(parsed.errors) != 0 || parsed.products[0].price != 5050 || parsed.products[0].sku != "RICE" {
		t.Fatalf("xlsx product=%#v", parsed)
	}
	blankFar := importTestXLSX(importZipEntry{"xl/worksheets/sheet1.xml", []byte(`<worksheet><row><c r="ZZZ1"/></row><row><c r="A2" t="inlineStr"><is><t>name</t></is></c></row></worksheet>`)})
	if rows, err := parseImportXLSX(blankFar); err != nil || !reflect.DeepEqual(rows, [][]string{{"name"}}) {
		t.Fatalf("blank far cells must be filtered before width check %#v %v", rows, err)
	}
	for _, test := range []struct {
		name    string
		data    []byte
		message string
	}{
		{"bad.xlsx", []byte("not a ZIP"), "The workbook could not be read."},
		{"empty.xlsx", importTestXLSX(importZipEntry{"xl/a.xml", []byte("x")}), "The workbook has no worksheet."},
		{"bad.xls", nil, "Choose a CSV or Excel .xlsx file."},
	} {
		_, err := parseSpreadsheet(test.name, test.data)
		if err == nil || err.Error() != test.message {
			t.Fatalf("%s error=%v", test.name, err)
		}
	}
	withDescriptor := append([]byte{}, data...)
	binary.LittleEndian.PutUint16(withDescriptor[6:], 8)
	_, e = parseSpreadsheet("x.xlsx", withDescriptor)
	if e == nil || e.Error() != "Save the workbook from Excel again. This file stores sizes after the data." {
		t.Fatalf("descriptor error=%v", e)
	}
}

type importFakeStore struct {
	rows        map[string][]erpwire.Row
	queries     []erpwire.Select
	commands    []erpwire.Row
	writes      int
	failName    string
	failContact bool
}
type importFakeTx struct {
	store *importFakeStore
	actor erpwire.Actor
}
type importFakeError struct{ message, state string }

func (e importFakeError) Error() string           { return e.message }
func (e importFakeError) BusinessMessage() string { return e.message }
func (e importFakeError) SQLState() string        { return e.state }
func (f *importFakeStore) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(importFakeTx{f, a})
}
func (f *importFakeStore) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	f.writes++
	return fn(importFakeTx{f, a})
}
func (tx importFakeTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	tx.store.queries = append(tx.store.queries, q)
	out := []erpwire.Row{}
	for _, row := range tx.store.rows[q.Table] {
		if row["org_id"] != tx.actor.OrgID() {
			continue
		}
		matches := true
		for _, p := range q.Where {
			switch p.Op {
			case erpwire.Equal:
				if !reflect.DeepEqual(row[p.Column], p.Value) {
					matches = false
				}
			case erpwire.In:
				found := false
				for _, s := range p.Value.([]string) {
					if row[p.Column] == s {
						found = true
					}
				}
				if !found {
					matches = false
				}
			}
		}
		if matches {
			out = append(out, row)
		}
	}
	if q.Offset >= len(out) {
		return erpwire.Selection{Rows: []erpwire.Row{}}, nil
	}
	return erpwire.Selection{Rows: out[q.Offset:]}, nil
}
func (tx importFakeTx) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected read RPC")
}
func (tx importFakeTx) Command(_ context.Context, name string, row erpwire.Row) (json.RawMessage, error) {
	if name != "adjust_stock" {
		return nil, errors.New("unexpected command")
	}
	if row["p_org_id"] != tx.actor.OrgID() {
		return nil, errors.New("wrong org")
	}
	tx.store.commands = append(tx.store.commands, row)
	return json.RawMessage(`null`), nil
}
func (tx importFakeTx) Insert(_ context.Context, in erpwire.Insert) ([]erpwire.Row, error) {
	for _, row := range in.Rows {
		if row["org_id"] != tx.actor.OrgID() {
			return nil, errors.New("wrong org")
		}
		if row["name"] == tx.store.failName {
			return nil, importFakeError{"Denied row", "23505"}
		}
		if in.Table == "contacts" && tx.store.failContact {
			return nil, importFakeError{"Contact constraint", "23514"}
		}
		copy := erpwire.Row{}
		for k, v := range row {
			copy[k] = v
		}
		copy["id"] = fmt.Sprintf("00000000-0000-0000-0000-%012d", len(tx.store.rows[in.Table])+1)
		tx.store.rows[in.Table] = append(tx.store.rows[in.Table], copy)
	}
	return tx.store.rows[in.Table][len(tx.store.rows[in.Table])-len(in.Rows):], nil
}
func (tx importFakeTx) Update(context.Context, string, erpwire.Row, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected update")
}
func (tx importFakeTx) Delete(context.Context, string, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected delete")
}

func importActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	now := time.Now()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: "12345678-1234-1234-1234-123456789abc", Email: "tester@example.invalid", Assurance: erpwire.AAL1, ExpiresAt: now.Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: "12345678-1234-1234-1234-123456789abc", OrgID: "22345678-1234-1234-1234-123456789abc", Role: role}, false, now)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func importForm(kind, name, body, warehouse string) json.RawMessage {
	entries := []erpwire.FormEntry{}
	for _, pair := range [][2]string{{"kind", kind}, {"warehouseId", warehouse}} {
		v := pair[1]
		entries = append(entries, erpwire.FormEntry{Name: pair[0], Text: &v})
	}
	entries = append(entries, erpwire.FormEntry{Name: "file", File: &erpwire.Upload{Name: name, Type: "text/csv", Data: []byte(body)}})
	raw, _ := json.Marshal([]any{erpwire.FormData{Kind: "form", Entries: entries}})
	return raw
}
func importActionValue(t *testing.T, v any) erpwire.Row {
	t.Helper()
	action, ok := v.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("unexpected action %#v", v)
	}
	value, ok := action.Value.(erpwire.Row)
	if !ok {
		t.Fatalf("unexpected value %#v", action.Value)
	}
	return value
}

func TestImportAuthorizationAndPartialPersistence(t *testing.T) {
	store := &importFakeStore{rows: map[string][]erpwire.Row{}, failName: "Second"}
	s, e := New(Options{Store: store})
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	if _, e := s.importSheet(ctx, erpwire.Actor{}, importForm("customers", "x.csv", "name\nx", "")); !errors.Is(e, erpwire.ErrUnauthenticated) {
		t.Fatalf("anonymous import allowed %v", e)
	}
	denied, e := s.importSheet(ctx, importActor(t, erpwire.Member), importForm("products", "x.csv", "name\nx", ""))
	if e != nil || importActionValue(t, denied)["error"] != "Your role cannot import this list." || store.writes != 0 {
		t.Fatalf("role denial %#v %v writes=%d", denied, e, store.writes)
	}
	got, e := s.importSheet(ctx, importActor(t, erpwire.Owner), importForm("customers", "x.csv", "name,phone\nFirst,123\nSecond,456\n", ""))
	if e != nil || importActionValue(t, got)["error"] != "Row 3 was not saved. Earlier rows in this file were saved. Denied row" {
		t.Fatalf("partial save error %#v %v", got, e)
	}
	if len(store.rows["clients"]) != 1 || len(store.rows["contacts"]) != 1 || store.rows["clients"][0]["owner"] != importActor(t, erpwire.Owner).UserID() {
		t.Fatalf("earlier rows not retained %#v", store.rows)
	}
	contactStore := &importFakeStore{rows: map[string][]erpwire.Row{}, failContact: true}
	s, _ = New(Options{Store: contactStore})
	got, e = s.importSheet(ctx, importActor(t, erpwire.Owner), importForm("customers", "x.csv", "name,phone\nFirst,123", ""))
	if e != nil || importActionValue(t, got)["error"] != "Row 2 saved the customer without a contact. Contact constraint" || len(contactStore.rows["clients"]) != 1 {
		t.Fatalf("contact partial save %#v %v", got, e)
	}
}

func TestImportStockIsOrgScopedAndExact(t *testing.T) {
	a := importActor(t, erpwire.Owner)
	store := &importFakeStore{rows: map[string][]erpwire.Row{"products": {{"org_id": "other", "id": "foreign", "sku": "FOREIGN", "is_stockable": true}, {"org_id": a.OrgID(), "id": "local", "sku": "RICE", "is_stockable": true}}}}
	s, _ := New(Options{Store: store})
	ctx := context.Background()
	got, e := s.importSheet(ctx, a, importForm("opening-stock", "x.csv", "sku,qty,unit cost\nFOREIGN,1,10", "warehouse"))
	if e != nil || !reflect.DeepEqual(importActionValue(t, got)["errors"], []importError{{2, "รหัส is not a product in this workspace."}}) || len(store.commands) != 0 {
		t.Fatalf("cross-org stock available %#v %v", got, e)
	}
	got, e = s.importSheet(ctx, a, importForm("opening-stock", "x.csv", "sku,qty,unit cost\nRICE,999999999.999,90071992547409.91", "warehouse"))
	if e != nil || importActionValue(t, got)["saved"] != 1 || !reflect.DeepEqual(got.(erpwire.ActionResponse).Refresh, []string{"/inventory"}) {
		t.Fatalf("stock import %#v %v", got, e)
	}
	if len(store.commands) != 1 {
		t.Fatalf("commands=%#v", store.commands)
	}
	command := store.commands[0]
	if command["p_count"] != json.Number("999999999.999") || command["p_unit_cost_satang"] != int64(money.MaxSafeSatang) || command["p_product_id"] != "local" || command["p_org_id"] != a.OrgID() || !validID(text(command["p_key"])) {
		t.Fatalf("stock values inexact %#v", command)
	}
	for _, q := range store.queries {
		found := false
		for _, p := range q.Where {
			if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == a.OrgID() {
				found = true
			}
		}
		if !found {
			t.Fatalf("unscoped query %#v", q)
		}
	}
	for _, test := range []struct{ input, want string }{{"0001.500", "1.5"}, {"0000.001", "0.001"}, {"0010", "10"}} {
		number := importQuantityNumber(test.input)
		encoded, e := json.Marshal(number)
		if e != nil || string(encoded) != test.want {
			t.Fatalf("quantity %q encodes %s %v", test.input, encoded, e)
		}
	}
}

func TestImportProductPersistsExactNormalizedColumns(t *testing.T) {
	a := importActor(t, erpwire.Owner)
	store := &importFakeStore{rows: map[string][]erpwire.Row{}}
	s, _ := New(Options{Store: store})
	result, e := s.importSheet(context.Background(), a, importForm("products", "x.csv", "รหัส,ชื่อ,ราคา,ต้นทุน,ภาษี,ประเภท,สต็อก\nRICE, ข้าว ,90071992547409.91,0.01,7.5%,สินค้า,ใช่", ""))
	if e != nil || importActionValue(t, result)["saved"] != 1 || !reflect.DeepEqual(result.(erpwire.ActionResponse).Refresh, []string{"/products"}) {
		t.Fatalf("product result %#v %v", result, e)
	}
	want := erpwire.Row{"id": "00000000-0000-0000-0000-000000000001", "org_id": a.OrgID(), "sku": "RICE", "name": "ข้าว", "unit": "piece", "type": "goods", "list_price_satang": int64(money.MaxSafeSatang), "cost_satang": int64(1), "tax_rate_bps": int64(750), "is_stockable": true}
	if !reflect.DeepEqual(store.rows["products"], []erpwire.Row{want}) {
		t.Fatalf("product columns %#v, want %#v", store.rows["products"], want)
	}
	store.failName = "Duplicate"
	result, e = s.importSheet(context.Background(), a, importForm("products", "x.csv", "name\nDuplicate", ""))
	if e != nil || importActionValue(t, result)["error"] != "Row 2 was not saved. Earlier rows in this file were saved. This SKU is already used in your workspace." || len(store.rows["products"]) != 1 {
		t.Fatalf("duplicate handling %#v %v", result, e)
	}
}
