package erpcrm

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

// ErrAINotConfigured lets an injected generator report configuration loss mid-request.
var ErrAINotConfigured = errors.New("CRM text generation is not configured")

const thaiOutput = "Write the output in the same language the notes/context use. If the context is Thai, respond in natural, polite Thai (สุภาพ) suitable for Thai SME business."

func renderActivities(rows []erpwire.Row) string {
	if len(rows) == 0 {
		return "(no activities logged yet)"
	}
	lines := make([]string, 0, len(rows))
	for _, row := range rows {
		parts := []string{"- [" + text(row["type"]) + "]"}
		if due := text(row["due_date"]); due != "" {
			parts = append(parts, "(due "+due+")")
		}
		if row["done"] == true {
			parts = append(parts, "(done)")
		}
		body := trimText(text(row["body"]))
		if body == "" {
			body = "—"
		}
		lines = append(lines, strings.Join(append(parts, body), " "))
	}
	return strings.Join(lines, "\n")
}

func bahtText(value money.Satang) string {
	return strings.TrimSuffix(strings.TrimSuffix(money.FormatBaht(value), "0"), ".0")
}

func groupedBaht(value money.Satang) string {
	whole, fraction, decimal := strings.Cut(bahtText(value), ".")
	start := 0
	if strings.HasPrefix(whole, "-") {
		start = 1
	}
	for i := len(whole) - 3; i > start; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	if decimal {
		return whole + "." + fraction
	}
	return whole
}

func dealSummaryPrompt(deal erpwire.Row, client string, activities []erpwire.Row) (string, string, error) {
	value, err := satang(deal["value_satang"])
	if err != nil {
		return "", "", err
	}
	system := "You are a concise sales assistant for a Thai SME. Summarize the state of a sales deal for a busy founder: where it stands, momentum, risks, and the single most useful next step. Keep it under ~120 words. Be factual — do not invent details not present in the context. " + thaiOutput
	prompt := strings.Join([]string{"Summarize this deal.", "", "Deal title: " + text(deal["title"]), "Client: " + client, "Stage: " + text(deal["stage"]), "Value (THB): " + groupedBaht(value), "", "Recent activities:", renderActivities(activities)}, "\n")
	return system, prompt, nil
}

func followupDraftPrompt(title, client, tone string, activities []erpwire.Row) (string, string) {
	instructions := map[string]string{"friendly": "Use a warm, friendly, approachable tone.", "formal": "Use a professional, formal tone.", "brief": "Use a very brief, to-the-point tone — a few short sentences only."}
	if _, ok := instructions[tone]; !ok {
		tone = "friendly"
	}
	system := "You are a sales assistant for a Thai SME. Draft a short follow-up message the founder can send to move this deal forward. " + instructions[tone] + " Reference the most recent context, propose a clear next step, and keep it ready to send (no placeholders like [name] unless the name is unknown). " + thaiOutput
	prompt := strings.Join([]string{`Draft a follow-up message for the deal "` + title + `".`, "Client: " + client, "Desired tone: " + tone, "", "Recent activities (most recent first):", renderActivities(activities)}, "\n")
	return system, prompt
}

func (s *Service) summarizeDeal(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.generateDealText(ctx, a, raw, false)
}

func (s *Service) draftFollowup(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.generateDealText(ctx, a, raw, true)
}

func (s *Service) generateDealText(ctx context.Context, a erpwire.Actor, raw json.RawMessage, followup bool) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	maxArgs := 1
	if followup {
		maxArgs = 2
	}
	args, err := arguments(raw, 1, maxArgs)
	if err != nil {
		return nil, err
	}
	result := func(value erpwire.Row) (any, error) { return erpwire.ActionResponse{Value: value}, nil }
	if s.generator == nil {
		return result(erpwire.Row{"notConfigured": true})
	}
	id, err := stringArg(args, 0)
	if err != nil || !validID(id) {
		return result(erpwire.Row{"error": "Invalid deal."})
	}
	var deal erpwire.Row
	client := "(unknown)"
	activities := []erpwire.Row{}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		deal, err = one(ctx, tx, erpwire.Select{Table: "deals", Columns: []string{"id", "client_id", "title", "stage", "value_satang"}, Where: scoped(a, id)})
		if err != nil || deal == nil {
			return err
		}
		row, err := one(ctx, tx, erpwire.Select{Table: "clients", Columns: []string{"name"}, Where: scoped(a, text(deal["client_id"]))})
		if err != nil {
			return err
		}
		if row != nil && row["name"] != nil {
			client = text(row["name"])
		}
		page, err := tx.Select(ctx, erpwire.Select{Table: "activities", Columns: []string{"type", "body", "due_date", "done"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("deal_id", id)}, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}, Limit: 12})
		activities = page.Rows
		return err
	})
	if err != nil {
		return nil, err
	}
	if deal == nil {
		return result(erpwire.Row{"error": "Deal not found."})
	}
	kind, message := "deal_summary", "Could not generate a summary. Please try again."
	var system, prompt string
	if followup {
		tone := ""
		if args.Present(1) {
			_ = args.Decode(1, &tone)
		}
		system, prompt = followupDraftPrompt(text(deal["title"]), client, tone, activities)
		kind, message = "followup_draft", "Could not draft a follow-up. Please try again."
	} else {
		system, prompt, err = dealSummaryPrompt(deal, client, activities)
		if err != nil {
			return nil, err
		}
	}
	content, err := s.generator.GenerateText(ctx, system, prompt, 512)
	if errors.Is(err, ErrAINotConfigured) {
		return result(erpwire.Row{"notConfigured": true})
	}
	if err != nil {
		return result(erpwire.Row{"error": message})
	}
	// Cache errors must not discard text already generated for the user.
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Insert(ctx, erpwire.Insert{Table: "ai_outputs", Rows: []erpwire.Row{{"org_id": a.OrgID(), "entity": "deal", "entity_id": id, "kind": kind, "model": s.model, "content": content, "created_by": a.UserID()}}})
		return err
	})
	return result(erpwire.Row{"content": content})
}
