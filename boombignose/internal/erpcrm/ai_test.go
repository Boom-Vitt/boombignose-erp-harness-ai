package erpcrm

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type fakeGenerator struct {
	system, prompt   string
	maxTokens, calls int
	content          string
	err              error
}

func (g *fakeGenerator) GenerateText(_ context.Context, system, prompt string, maxTokens int) (string, error) {
	g.calls++
	g.system = system
	g.prompt = prompt
	g.maxTokens = maxTokens
	return g.content, g.err
}

func TestAIConfigurationValidationAndFailures(t *testing.T) {
	for _, test := range []struct {
		name, op, id     string
		configured, seed bool
		generatorErr     error
		want             erpwire.Row
	}{
		{"unconfigured precedes validation", "summary", "bad", false, false, nil, erpwire.Row{"notConfigured": true}},
		{"unconfigured followup", "followup", "bad", false, false, nil, erpwire.Row{"notConfigured": true}},
		{"invalid id", "summary", "bad", true, false, nil, erpwire.Row{"error": "Invalid deal."}},
		{"missing deal", "summary", testDeal, true, false, nil, erpwire.Row{"error": "Deal not found."}},
		{"configuration lost", "summary", testDeal, true, true, fmt.Errorf("wrapped: %w", ErrAINotConfigured), erpwire.Row{"notConfigured": true}},
		{"summary failure", "summary", testDeal, true, true, errors.New("private provider failure"), erpwire.Row{"error": "Could not generate a summary. Please try again."}},
		{"followup failure", "followup", testDeal, true, true, errors.New("private provider failure"), erpwire.Row{"error": "Could not draft a follow-up. Please try again."}},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, store := testService(t)
			if test.seed {
				seedDeal(store)
			}
			if test.configured {
				s.generator = &fakeGenerator{err: test.generatorErr}
				s.model = "injected-test-model"
			}
			op := s.summarizeDeal
			if test.op == "followup" {
				op = s.draftFollowup
			}
			got := actionValue(t, invoke(t, op, testActor(t, erpwire.Member), test.id))
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("got %#v, want %#v", got, test.want)
			}
			if store.writes != 0 {
				t.Fatal("failed generation wrote cache")
			}
			if (!test.configured || test.id == "bad") && store.reads != 0 {
				t.Fatal("invalid/unconfigured generation read context")
			}
		})
	}
}

func TestSummaryPromptContextLimitAndCache(t *testing.T) {
	s, store := testService(t)
	seedDeal(store)
	g := &fakeGenerator{content: "สรุปงาน"}
	s.generator = g
	s.model = "injected-test-model"
	for i := 0; i < 14; i++ {
		store.tables["activities"] = append(store.tables["activities"], erpwire.Row{"org_id": testOrg, "id": fmt.Sprint(i), "deal_id": testDeal, "type": "note", "body": fmt.Sprintf("  note-%02d  ", i), "created_at": fmt.Sprintf("2026-01-%02d", i+1), "done": false})
	}
	store.tables["activities"] = append(store.tables["activities"], erpwire.Row{"org_id": otherOrg, "deal_id": testDeal, "type": "note", "body": "SECRET", "created_at": "9999"})
	got := actionValue(t, invoke(t, s.summarizeDeal, testActor(t, erpwire.Member), testDeal))
	if got["content"] != "สรุปงาน" {
		t.Fatal(got)
	}
	wantSystem := "You are a concise sales assistant for a Thai SME. Summarize the state of a sales deal for a busy founder: where it stands, momentum, risks, and the single most useful next step. Keep it under ~120 words. Be factual — do not invent details not present in the context. Write the output in the same language the notes/context use. If the context is Thai, respond in natural, polite Thai (สุภาพ) suitable for Thai SME business."
	wantPrompt := "Summarize this deal.\n\nDeal title: งานใหม่\nClient: ลูกค้า\nStage: proposal\nValue (THB): 1,234.56\n\nRecent activities:"
	for i := 13; i >= 2; i-- {
		wantPrompt += fmt.Sprintf("\n- [note] note-%02d", i)
	}
	if g.system != wantSystem || g.prompt != wantPrompt || g.maxTokens != 512 || g.calls != 1 {
		t.Fatalf("generation request differs\nsystem %q\nprompt %q\ntokens %d", g.system, g.prompt, g.maxTokens)
	}
	cache := store.tables["ai_outputs"]
	if len(cache) != 1 {
		t.Fatal(cache)
	}
	want := erpwire.Row{"org_id": testOrg, "entity": "deal", "entity_id": testDeal, "kind": "deal_summary", "model": "injected-test-model", "content": "สรุปงาน", "created_by": testUser}
	for key, value := range want {
		if cache[0][key] != value {
			t.Fatalf("cache %s = %#v, want %#v", key, cache[0][key], value)
		}
	}
	if len(store.tables["audit_log"]) != 0 {
		t.Fatal("AI assist invented an audit write")
	}
}

func TestFollowupTonesAndBestEffortCache(t *testing.T) {
	for _, test := range []struct {
		tone                  any
		wantTone, instruction string
	}{
		{"friendly", "friendly", "Use a warm, friendly, approachable tone."},
		{"formal", "formal", "Use a professional, formal tone."},
		{"brief", "brief", "Use a very brief, to-the-point tone — a few short sentences only."},
		{"invalid", "friendly", "Use a warm, friendly, approachable tone."},
		{false, "friendly", "Use a warm, friendly, approachable tone."},
		{nil, "friendly", "Use a warm, friendly, approachable tone."},
	} {
		t.Run(fmt.Sprint(test.tone), func(t *testing.T) {
			s, store := testService(t)
			seedDeal(store)
			store.tables["clients"] = nil
			store.insertErr["ai_outputs"] = errors.New("cache unavailable")
			g := &fakeGenerator{content: "ส่งข้อความ"}
			s.generator = g
			s.model = "configured-model"
			got := actionValue(t, invoke(t, s.draftFollowup, testActor(t, erpwire.Member), testDeal, test.tone))
			if got["content"] != "ส่งข้อความ" || len(store.tables["ai_outputs"]) != 0 {
				t.Fatalf("lost content after cache failure %#v", got)
			}
			wantPrompt := `Draft a follow-up message for the deal "งานใหม่".` + "\nClient: (unknown)\nDesired tone: " + test.wantTone + "\n\nRecent activities (most recent first):\n(no activities logged yet)"
			wantSystem := "You are a sales assistant for a Thai SME. Draft a short follow-up message the founder can send to move this deal forward. " + test.instruction + " Reference the most recent context, propose a clear next step, and keep it ready to send (no placeholders like [name] unless the name is unknown). " + thaiOutput
			if g.prompt != wantPrompt || g.system != wantSystem {
				t.Fatalf("got system %q prompt %q", g.system, g.prompt)
			}
		})
	}
}

func TestActivitiesAndExactPromptAmounts(t *testing.T) {
	got := renderActivities([]erpwire.Row{{"type": "call", "due_date": "2026-11-08", "done": true, "body": "  คุยแล้ว  "}, {"type": "note", "body": nil}})
	if got != "- [call] (due 2026-11-08) (done) คุยแล้ว\n- [note] —" {
		t.Fatal(got)
	}
	for _, test := range []struct {
		value int64
		want  string
	}{{0, "0"}, {1, "0.01"}, {10, "0.1"}, {100, "1"}, {1010, "10.1"}, {9007199254740991, "90,071,992,547,409.91"}} {
		_, prompt, err := dealSummaryPrompt(erpwire.Row{"value_satang": test.value}, "", nil)
		if err != nil || !strings.Contains(prompt, "Value (THB): "+test.want+"\n") {
			t.Fatalf("%d: %q, %v", test.value, prompt, err)
		}
	}
}
