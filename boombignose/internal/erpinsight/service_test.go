package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const insightOrg = "11111111-1111-1111-1111-111111111111"
const insightOtherOrg = "22222222-2222-2222-2222-222222222222"
const insightUser = "33333333-3333-3333-3333-333333333333"
const insightID = "44444444-4444-4444-4444-444444444444"

type insightFake struct {
	rows             map[string][]erpwire.Row
	queries          []erpwire.Select
	writes           int
	insertError      map[string]error
	selectError      error
	selectErrorTable string
}

func (f *insightFake) Read(ctx context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	return fn(f)
}
func (f *insightFake) Write(ctx context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if e := a.Validate(time.Now()); e != nil {
		return e
	}
	f.writes++
	return fn(f)
}
func insightMatch(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		if p.Op != erpwire.Equal {
			panic("unsupported insight fake predicate")
		}
		if !reflect.DeepEqual(row[p.Column], p.Value) {
			return false
		}
	}
	return true
}
func (f *insightFake) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	f.queries = append(f.queries, q)
	if q.Table == "document_public_refs" {
		for _, order := range q.Order {
			if order.Column != "reference" && order.Column != "org_id" && order.Column != "created_at" {
				return erpwire.Selection{}, errors.New("unknown document reference order column")
			}
		}
	}
	if f.selectError != nil && (f.selectErrorTable == "" || f.selectErrorTable == q.Table) {
		e := f.selectError
		f.selectError = nil
		return erpwire.Selection{}, e
	}
	out := []erpwire.Row{}
	for _, row := range f.rows[q.Table] {
		if insightMatch(row, q.Where) {
			out = append(out, row)
		}
	}
	n := int64(len(out))
	if q.Offset < len(out) {
		out = out[q.Offset:]
	} else {
		out = []erpwire.Row{}
	}
	more := q.Limit > 0 && len(out) > q.Limit
	if more {
		out = out[:q.Limit]
	}
	return erpwire.Selection{Rows: out, Total: &n, HasMore: more}, nil
}
func (f *insightFake) ReadRPC(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected read RPC")
}
func (f *insightFake) Command(context.Context, string, erpwire.Row) (json.RawMessage, error) {
	return nil, errors.New("unexpected command")
}
func (f *insightFake) Insert(_ context.Context, in erpwire.Insert) ([]erpwire.Row, error) {
	if e := f.insertError[in.Table]; e != nil {
		return nil, e
	}
	out := []erpwire.Row{}
	for _, row := range in.Rows {
		if row["id"] == nil {
			row["id"] = fmt.Sprintf("generated-%d", len(f.rows[in.Table])+1)
		}
		replaced := false
		if len(in.ConflictColumns) > 0 {
			for i, existing := range f.rows[in.Table] {
				match := true
				for _, c := range in.ConflictColumns {
					match = match && existing[c] == row[c]
				}
				if match {
					for k, v := range row {
						existing[k] = v
					}
					f.rows[in.Table][i] = existing
					replaced = true
					break
				}
			}
		}
		if !replaced {
			f.rows[in.Table] = append(f.rows[in.Table], row)
		}
		out = append(out, row)
	}
	return out, nil
}
func (f *insightFake) Update(_ context.Context, table string, values erpwire.Row, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	out := []erpwire.Row{}
	for _, row := range f.rows[table] {
		if insightMatch(row, where) {
			for k, v := range values {
				row[k] = v
			}
			out = append(out, row)
		}
	}
	return out, nil
}
func (f *insightFake) Delete(_ context.Context, table string, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	out, kept := []erpwire.Row{}, []erpwire.Row{}
	for _, row := range f.rows[table] {
		if insightMatch(row, where) {
			out = append(out, row)
		} else {
			kept = append(kept, row)
		}
	}
	f.rows[table] = kept
	return out, nil
}
func insightActor(t *testing.T, role erpwire.Role) erpwire.Actor {
	t.Helper()
	now := time.Now()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: insightUser, Email: "unit@example.test", Assurance: erpwire.AAL2, ExpiresAt: now.Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: insightUser, OrgID: insightOrg, OrgName: "ทดสอบ", Role: role}, false, now)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func insightService(t *testing.T) (*Service, *insightFake) {
	t.Helper()
	f := &insightFake{rows: map[string][]erpwire.Row{}, insertError: map[string]error{}}
	s, e := New(Options{Store: f})
	if e != nil {
		t.Fatal(e)
	}
	return s, f
}
func insightCall(t *testing.T, op erpwire.Operation, a erpwire.Actor, args ...any) any {
	t.Helper()
	if args == nil {
		args = []any{}
	}
	raw, e := json.Marshal(args)
	if e != nil {
		t.Fatal(e)
	}
	result, e := op(context.Background(), a, raw)
	if e != nil {
		t.Fatal(e)
	}
	return result
}
func insightAction(t *testing.T, result any) erpwire.ActionResponse {
	t.Helper()
	r, ok := result.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("expected action response: %#v", result)
	}
	return r
}

func TestInsightRejectsUnboundActorsBeforeDataAccess(t *testing.T) {
	s, f := insightService(t)
	for key, op := range s.Operations() {
		raw := json.RawMessage(`[]`)
		if strings.HasSuffix(key, "::saveLang") {
			raw = json.RawMessage(`["en"]`)
		}
		if _, e := op(context.Background(), erpwire.Actor{}, raw); !errors.Is(e, erpwire.ErrUnauthenticated) {
			t.Errorf("%s: %v", key, e)
		}
	}
	if f.writes != 0 || len(f.queries) != 0 {
		t.Fatal("unauthenticated operation reached store")
	}
}
func TestInsightRegistryExcludesOwnedOperations(t *testing.T) {
	s, _ := insightService(t)
	for key := range s.Operations() {
		if strings.Contains(key, "/expenses/") || strings.Contains(key, "/dashboard/") || strings.Contains(key, "/blueprint/") {
			t.Fatalf("duplicated existing operation: %s", key)
		}
	}
}

func TestSavedViewValidationAndTenantOwnership(t *testing.T) {
	s, f := insightService(t)
	a := insightActor(t, erpwire.Member)
	for _, tt := range []struct {
		input any
		want  string
	}{
		{erpwire.Row{"module": "clients", "name": " "}, "Name is required"},
		{erpwire.Row{"module": "clients", "name": strings.Repeat("😀", 41)}, "Name is too long"},
		{erpwire.Row{"module": "clients", "name": "A", "config": erpwire.Row{"injected": "x"}}, `Unrecognized key: "injected"`},
		{erpwire.Row{"module": "clients", "name": "A", "config": erpwire.Row{"warehouse": "foreign"}}, "Invalid GUID"},
	} {
		r := insightAction(t, insightCall(t, s.createSavedView, a, tt.input))
		if !reflect.DeepEqual(r.Value, erpwire.Row{"error": tt.want}) {
			t.Errorf("input %#v: %#v", tt.input, r.Value)
		}
	}
	if f.writes != 0 {
		t.Fatal("invalid view was persisted")
	}
	r := insightAction(t, insightCall(t, s.createSavedView, a, erpwire.Row{"module": "clients", "name": " \ufeff งาน \ufeff ", "config": erpwire.Row{"q": "ไทย", "mine": "1"}, "org_id": insightOtherOrg}))
	if !reflect.DeepEqual(r.Refresh, []string{"/clients"}) {
		t.Fatalf("refresh: %#v", r)
	}
	row := f.rows["saved_views"][0]
	if row["org_id"] != insightOrg || row["user_id"] != insightUser || row["name"] != "งาน" {
		t.Fatalf("unsafe create: %#v", row)
	}
	f.rows["saved_views"] = []erpwire.Row{{"id": insightID, "org_id": insightOtherOrg, "user_id": insightUser, "module": "clients"}, {"id": insightID, "org_id": insightOrg, "user_id": "another-user", "module": "deals"}, {"id": insightID, "org_id": insightOrg, "user_id": insightUser, "module": "quotes"}}
	r = insightAction(t, insightCall(t, s.deleteSavedView, a, insightID))
	if !reflect.DeepEqual(r.Refresh, []string{"/quotes"}) || len(f.rows["saved_views"]) != 2 {
		t.Fatalf("owner isolation: %#v %#v", r, f.rows["saved_views"])
	}
}

func TestPublicReferenceParsing(t *testing.T) {
	words := make([]uint32, 14)
	for i := range words {
		words[i] = uint32(i)
	}
	for kind, prefix := range documentPrefixes {
		canonical := encodeReference(prefix, words)
		ref, message := parsePublicReference(canonical, true)
		if message != "" || ref.Kind != kind || ref.Canonical != canonical {
			t.Fatalf("%s: %#v %s", kind, ref, message)
		}
		normalized, message := parsePublicReference("  "+strings.ToUpper(ref.Display)+"\r\n", false)
		if message != "" || normalized != ref {
			t.Fatalf("display parse: %#v %s", normalized, message)
		}
		if _, message := parsePublicReference(ref.Display, true); message != "non_canonical" {
			t.Fatal(message)
		}
	}
	canonical := encodeReference("inv", words)
	for _, tt := range []struct{ input, want string }{
		{strings.Repeat("a", 129), "too_long"}, {"ⅰnv1abc", "character"}, {"INV" + canonical[3:], "case"}, {"INV-2026-001", "format"}, {"a1lqfn3a", "prefix"}, {encodeReference("inv", []uint32{1}), "length"}, {canonical[:len(canonical)-1] + "!", "character"}, {canonical[:len(canonical)-1] + "q", "checksum"},
	} {
		if _, got := parsePublicReference(tt.input, false); got != tt.want {
			t.Errorf("%q: %s, want %s", tt.input, got, tt.want)
		}
	}
}

func TestSavedViewDeleteSurvivesModuleReadFailure(t *testing.T) {
	s, f := insightService(t)
	a := insightActor(t, erpwire.Member)
	f.rows["saved_views"] = []erpwire.Row{{"id": insightID, "org_id": insightOrg, "user_id": insightUser, "module": "clients"}}
	f.selectError = errors.New("transient module read failure")
	r := insightAction(t, insightCall(t, s.deleteSavedView, a, insightID))
	if len(f.rows["saved_views"]) != 0 || len(r.Refresh) != 0 || !reflect.DeepEqual(r.Value, erpwire.Row{}) {
		t.Fatalf("best-effort module read blocked delete: %#v %#v", r, f.rows)
	}
}

func TestSavedViewStrictKeysUseBrowserObjectOrder(t *testing.T) {
	s, _ := insightService(t)
	r, e := s.createSavedView(context.Background(), insightActor(t, erpwire.Member), json.RawMessage(`[{"module":"clients","name":"A","config":{"2":0,"1":0,"2":1,"extra":true}}]`))
	if e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(insightAction(t, r).Value, erpwire.Row{"error": `Unrecognized keys: "1", "2", "extra"`}) {
		t.Fatal(r)
	}
	r = insightCall(t, s.createSavedView, insightActor(t, erpwire.Member), erpwire.Row{"module": "clients", "name": "A", "config": erpwire.Row{`a"b`: true}})
	if !reflect.DeepEqual(insightAction(t, r).Value, erpwire.Row{"error": `Unrecognized key: "a"b"`}) {
		t.Fatal(r)
	}
}

func TestIntakeParserPreservesJavaScriptLineAndWhitespaceRules(t *testing.T) {
	for _, tt := range []struct {
		content string
		want    []ActionItem
	}{
		{"- alpha\rbeta", []ActionItem{}},
		{"- alpha\u2028beta", []ActionItem{}},
		{"-\u00a0[x]\ufeffงาน", []ActionItem{{"งาน"}}},
		{"\ufeff- task\ufeff", []ActionItem{{"task"}}},
	} {
		if got := parseActionItems(tt.content); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("%q: %#v, want %#v", tt.content, got, tt.want)
		}
	}
}

type insightCollision struct{}

func (insightCollision) Error() string    { return "unique violation" }
func (insightCollision) SQLState() string { return "23505" }
func TestPublicReferenceRetriesAndStoredValidation(t *testing.T) {
	s, f := insightService(t)
	a := insightActor(t, erpwire.Owner)
	f.rows["org_settings"] = []erpwire.Row{{"org_id": insightOrg, "public_document_refs_enabled": true}}
	f.rows["quotes"] = []erpwire.Row{{"id": insightID, "org_id": insightOrg}}
	f.insertError["document_public_refs"] = insightCollision{}
	r := insightAction(t, insightCall(t, s.issueDocumentPublicReference, a, "quote", insightID))
	if f.writes != 5 || !reflect.DeepEqual(r.Value, erpwire.Row{"error": "Could not issue a unique public reference."}) {
		t.Fatalf("retry count: %d, %#v", f.writes, r)
	}
	f.rows["document_public_refs"] = []erpwire.Row{{"org_id": insightOrg, "kind": "quote", "record_id": insightID, "reference": "invalid-stored-reference"}}
	r = insightAction(t, insightCall(t, s.issueDocumentPublicReference, a, "quote", insightID))
	if f.writes != 5 || !reflect.DeepEqual(r.Value, erpwire.Row{"error": "The stored public reference failed validation."}) {
		t.Fatalf("invalid stored code replaced: %#v", r)
	}
}

func TestPublicReferenceLookupRepeatedQueryParameters(t *testing.T) {
	s, f := insightService(t)
	a := insightActor(t, erpwire.Member)
	f.rows["org_settings"] = []erpwire.Row{{"org_id": insightOrg, "public_document_refs_enabled": true}}
	for _, tt := range []struct {
		params  erpwire.Row
		message string
	}{
		{erpwire.Row{"extra": []string{"a", "b"}}, ""},
		{erpwire.Row{"code": []string{"x", "y"}}, lookupMessages["type"]},
	} {
		out := insightCall(t, s.lookupPage, a, tt.params).(erpwire.Row)
		if out["message"] != tt.message || out["match"] != nil {
			t.Fatalf("query %#v: %#v", tt.params, out)
		}
	}
}

func TestPublicReferenceTargetReadRetainsThrownErrorBoundary(t *testing.T) {
	s, f := insightService(t)
	f.rows["org_settings"] = []erpwire.Row{{"org_id": insightOrg, "public_document_refs_enabled": true}}
	f.selectError = errors.New("private database detail")
	f.selectErrorTable = "quotes"
	_, e := s.issueDocumentPublicReference(context.Background(), insightActor(t, erpwire.Owner), json.RawMessage(`["quote","44444444-4444-4444-4444-444444444444"]`))
	if e == nil || e.Error() != "Document unavailable." {
		t.Fatalf("target read failure: %v", e)
	}
}

func TestDocumentReferenceStateTransitionsAndOrgIsolation(t *testing.T) {
	s, f := insightService(t)
	a := insightActor(t, erpwire.Owner)
	denied := insightAction(t, insightCall(t, s.setPublicDocumentRefsEnabled, insightActor(t, erpwire.Member), true))
	if !reflect.DeepEqual(denied.Value, erpwire.Row{"error": "Only an owner or admin can update settings."}) || f.writes != 0 {
		t.Fatal(denied)
	}
	for _, enabled := range []bool{true, false, true} {
		r := insightAction(t, insightCall(t, s.setPublicDocumentRefsEnabled, a, enabled))
		if !reflect.DeepEqual(r.Refresh, []string{"/settings", "/documents/lookup"}) || f.rows["org_settings"][0]["public_document_refs_enabled"] != enabled {
			t.Fatalf("settings transition: %#v", r)
		}
	}
	f.rows["quotes"] = []erpwire.Row{{"id": insightID, "org_id": insightOtherOrg}}
	r := insightAction(t, insightCall(t, s.issueDocumentPublicReference, a, "quote", insightID))
	if !reflect.DeepEqual(r.Value, erpwire.Row{"error": "Document unavailable."}) {
		t.Fatal(r)
	}
	f.rows["quotes"] = append(f.rows["quotes"], erpwire.Row{"id": insightID, "org_id": insightOrg})
	r = insightAction(t, insightCall(t, s.issueDocumentPublicReference, a, "quote", insightID))
	display := text(r.Value.(erpwire.Row)["display"])
	parsed, message := parsePublicReference(display, false)
	if message != "" || parsed.Kind != "quote" || len(f.rows["document_public_refs"]) != 1 {
		t.Fatalf("issue: %#v", r)
	}
	r = insightAction(t, insightCall(t, s.issueDocumentPublicReference, a, "quote", insightID))
	if r.Value.(erpwire.Row)["display"] != display || len(f.rows["document_public_refs"]) != 1 || len(r.Refresh) != 0 {
		t.Fatalf("not idempotent: %#v", r)
	}
	out := insightCall(t, s.lookupPage, a, map[string]string{"code": display}).(erpwire.Row)
	if out["match"].(erpwire.Row)["href"] != "/quotes/"+insightID {
		t.Fatal(out)
	}
	f.rows["document_public_refs"][0]["org_id"] = insightOtherOrg
	out = insightCall(t, s.lookupPage, a, map[string]string{"code": display}).(erpwire.Row)
	if out["match"] != nil || out["message"] != lookupMessages["not_found"] {
		t.Fatalf("cross-org reference resolved: %#v", out)
	}
}

type insightGenerator struct {
	system, prompt string
	max            int
	content        string
	err            error
}

func (g *insightGenerator) GenerateText(_ context.Context, system, prompt string, max int) (string, error) {
	g.system, g.prompt, g.max = system, prompt, max
	return g.content, g.err
}
func TestMeetingIntakeParsingAndBestEffortCache(t *testing.T) {
	s, f := insightService(t)
	a := insightActor(t, erpwire.Member)
	r := insightAction(t, insightCall(t, s.intakeMeeting, a, ""))
	if !reflect.DeepEqual(r.Value, erpwire.Row{"notConfigured": true}) {
		t.Fatal(r)
	}
	g := &insightGenerator{content: "# Summary\nAction items:\n- [ ] โทรหาลูกค้า\n1. Send quote\na) Review\n- (none)\nPlain prose\n[x] Finish"}
	s.generator = g
	s.model = "injected-test-model"
	r = insightAction(t, insightCall(t, s.intakeMeeting, a, " \ufeff "))
	if !reflect.DeepEqual(r.Value, erpwire.Row{"error": "Paste some meeting notes first."}) {
		t.Fatal(r)
	}
	f.insertError["ai_outputs"] = errors.New("cache offline")
	r = insightAction(t, insightCall(t, s.intakeMeeting, a, " ประชุม "))
	want := []ActionItem{{"โทรหาลูกค้า"}, {"Send quote"}, {"Review"}, {"Finish"}}
	if !reflect.DeepEqual(r.Value.(erpwire.Row)["items"], want) || g.max != 800 || g.system != intakeSystem || g.prompt != "Summarize the following meeting notes and extract action items.\n\nMeeting notes:\nประชุม" {
		t.Fatalf("intake: %#v %#v", r, g)
	}
	g.err = errors.New("provider detail")
	r = insightAction(t, insightCall(t, s.intakeMeeting, a, "notes"))
	if !reflect.DeepEqual(r.Value, erpwire.Row{"error": "Could not process the notes. Please try again."}) {
		t.Fatal(r)
	}
}
