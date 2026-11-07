package erpdata

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestUnicodeContinuationRetainsEntireLongSource(t *testing.T) {
	source := "\ufeff" + strings.Repeat("ข้อความ WhatsApp 🐘 e\u0301\n", 1500) + "TAIL-ครบถ้วน"
	var rebuilt strings.Builder
	offset := 0
	digest := hash(source)
	for {
		part, err := TextSlice(source, offset, 997)
		if err != nil {
			t.Fatal(err)
		}
		text := part["text"].(string)
		if !utf8.ValidString(text) || part["sha256"] != digest || part["text_sha256"] != hash(text) || part["offset_unit"] != "unicode-code-points" {
			t.Fatal("invalid source identity or Unicode range")
		}
		rebuilt.WriteString(text)
		offset = part["next_offset"].(int)
		if !part["has_more"].(bool) {
			break
		}
	}
	if rebuilt.String() != source || offset != utf8.RuneCountInString(source) {
		t.Fatal("continuation omitted or duplicated source text")
	}
	if _, err := TextSlice(source, offset+1, 1); err == nil {
		t.Fatal("accepted out-of-range cursor")
	}
	end, err := TextSlice(source, offset, 1)
	if err != nil || end["text"] != "" || end["length"] != 0 {
		t.Fatal("invalid exact-end cursor")
	}
}
func TestExactMoneyRejectsUnsafeAndFloatSources(t *testing.T) {
	for _, v := range []any{json.Number("9007199254740992"), "-9007199254740992", json.Number("1.5"), float64(125)} {
		if _, err := integer(v); err == nil {
			t.Fatalf("accepted inexact source %v", v)
		}
	}
	for _, v := range []any{json.Number("9007199254740991"), "-9007199254740991", int64(0)} {
		if _, err := integer(v); err != nil {
			t.Fatal(err)
		}
	}
	if moneyString(-1) != "-฿0.01" || moneyString(38509600) != "฿385,096.00" {
		t.Fatal("incorrect exact satang formatting")
	}
}
func TestSavedViewProjectionCannotExposeUnknownNestedKeys(t *testing.T) {
	e := entity{Key: "saved_views", PrimaryKey: []string{"id"}, Fields: []field{{Key: "id", Kind: "text", TextReadable: true}, {Key: "config", Kind: "json", TextReadable: true}}}
	row := erpwire.Row{"id": "view", "config": erpwire.Row{"q": "authorized business notes", "status": "open", "access_token": "secret", "arbitrary": map[string]any{"q": "hidden"}, "mine": true}}
	got, err := project(row, e, []string{"id", "config"})
	if err != nil {
		t.Fatal(err)
	}
	text := got["config"].(string)
	if strings.Contains(text, "secret") || strings.Contains(text, "hidden") || strings.Contains(text, "mine") {
		t.Fatal("saved-view projection exposed non-ViewConfig data")
	}
	full, err := textValue(savedConfig(row["config"]))
	if err != nil || hash(full) != got["_text"].(map[string]any)["config"].(map[string]any)["sha256"] {
		t.Fatal("preview hash and full sanitized source disagree")
	}
}

type textStore struct {
	text    string
	failure error
}

func (s *textStore) Read(ctx context.Context, a erpwire.Actor, f func(erpwire.ReadTx) error) error {
	if s.failure != nil {
		return s.failure
	}
	return f(s)
}
func (s *textStore) Select(context.Context, erpwire.Select) (erpwire.Selection, error) {
	n := int64(1)
	return erpwire.Selection{Rows: []erpwire.Row{{"id": "20000000-0000-0000-0000-000000000001", "notes": s.text}}, Total: &n}, nil
}
func (s *textStore) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected RPC")
}
func testActor(t *testing.T, now time.Time) erpwire.Actor {
	t.Helper()
	id := "10000000-0000-0000-0000-000000000001"
	a, err := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: id, Assurance: erpwire.AAL1, FactorStateKnown: true, ExpiresAt: now.Add(time.Hour)}, erpwire.Membership{UserID: id, OrgID: "30000000-0000-0000-0000-000000000001", Role: erpwire.Member}, false, now)
	if err != nil {
		t.Fatal(err)
	}
	return a
}
func TestChangedSourceFailsClosedAndReadTextIsOnlyActualSlice(t *testing.T) {
	now := time.Date(2026, 11, 7, 0, 0, 0, 0, time.UTC)
	a := testActor(t, now)
	store := &textStore{text: strings.Repeat("🐘ไทย", 1000) + "tail"}
	r, err := New(Options{Store: store, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"entity": "clients", "record": map[string]any{"id": "20000000-0000-0000-0000-000000000001"}, "field": "notes", "length": 17}
	raw, _ := json.Marshal(args)
	got, err := r.Call(context.Background(), a, "erp_data_text", raw)
	if err != nil {
		t.Fatal(err)
	}
	ev := got.Evidence[0]
	if ev.ReadText == nil || utf8.RuneCountInString(ev.ReadText.Text) != 17 || !ev.ReadText.Partial || ev.Source.ID != "" {
		t.Fatal("text evidence contains unread bytes or final IDs")
	}
	args["offset"] = 17
	args["expected_sha256"] = hash(store.text)
	store.text += "changed"
	raw, _ = json.Marshal(args)
	if _, err = r.Call(context.Background(), a, "erp_data_text", raw); err == nil {
		t.Fatal("accepted stale source hash")
	}
	store.failure = errors.New("RLS identity revoked")
	if _, err = r.Call(context.Background(), a, "erp_data_catalog", json.RawMessage(`{}`)); err == nil {
		t.Fatal("catalog bypassed live store reauthorization")
	}
}
func TestBoundedRowsDoNotMakeFinancialTotalsPartial(t *testing.T) {
	rows := []erpwire.Row{}
	for i := range 40 {
		rows = append(rows, erpwire.Row{"id": i, "name": strings.Repeat("a", 600)})
	}
	payload := map[string]any{"total": int64(40), "offset": 0, "has_more": false, "receivables_coverage": map[string]any{"invoice_count": int64(6), "outstanding_satang": int64(38509600), "items": []any{}, "has_more": false}}
	bounded, err := boundRows(payload, rows)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(payload)
	if len(raw) > maxToolBytes || len(bounded) > maxToolItems || payload["has_more"] != true || payload["next_offset"] != len(bounded) || payload["total"] != int64(40) {
		t.Fatal("incorrect bounded traversal/count")
	}
	coverage := payload["receivables_coverage"].(map[string]any)
	if coverage["outstanding_satang"] != int64(38509600) || coverage["invoice_count"] != int64(6) {
		t.Fatal("bounded page changed canonical totals")
	}
}
