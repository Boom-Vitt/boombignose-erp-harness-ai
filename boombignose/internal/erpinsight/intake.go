package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type ActionItem struct {
	Title string `json:"title"`
}

var intakeHeader = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 ()/-]{0,40}:$`)

const jsSpace = `[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

var intakeMarker = regexp.MustCompile(`^(?:[-*•–—]|[0-9]{1,3}[.)]|[a-zA-Z][.)]|\[[ xX]?\])` + jsSpace + `+([^\r\n\x{2028}\x{2029}]*)$`)
var intakeCheckbox = regexp.MustCompile(`^\[[ xX]?\]` + jsSpace + `*`)
var intakeNone = regexp.MustCompile(`(?i)^\(?none\)?\.?$`)

// ErrAINotConfigured lets an injected generator preserve the source's unavailable result.
var ErrAINotConfigured = errors.New("AI is not configured")

func parseActionItems(content string) []ActionItem {
	items := []ActionItem{}
	for _, raw := range strings.Split(content, "\n") {
		line := trimText(raw)
		if line == "" || strings.HasPrefix(line, "#") || intakeHeader.MatchString(trimText(strings.ReplaceAll(line, "**", ""))) {
			continue
		}
		match := intakeMarker.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		title := trimText(intakeCheckbox.ReplaceAllString(match[1], ""))
		if title == "" || intakeNone.MatchString(title) {
			continue
		}
		items = append(items, ActionItem{Title: title})
	}
	return items
}

const intakeSystem = "You are an assistant that turns raw meeting notes into a clean, actionable record for a Thai SME. Respond with exactly two parts:\n1) A short summary (2–4 sentences).\n2) A line 'Action items:' followed by a bulleted list (one '- ' per line) of concrete next steps. If there are no action items, write '- (none)'.\nDo not add other sections. Write the output in the same language the notes/context use. If the context is Thai, respond in natural, polite Thai (สุภาพ) suitable for Thai SME business."

func (s *Service) intakeMeeting(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	if s.generator == nil {
		return erpwire.ActionResponse{Value: erpwire.Row{"notConfigured": true}}, nil
	}
	var notes string
	if args.Null(0) || args.Decode(0, &notes) != nil {
		var value any
		_ = args.Decode(0, &value)
		return invalid(zodType(value, "string", true))
	}
	notes = trimText(notes)
	if notes == "" {
		return invalid("Paste some meeting notes first.")
	}
	content, e := s.generator.GenerateText(ctx, intakeSystem, "Summarize the following meeting notes and extract action items.\n\nMeeting notes:\n"+notes, 800)
	if e != nil {
		if errors.Is(e, ErrAINotConfigured) {
			return erpwire.ActionResponse{Value: erpwire.Row{"notConfigured": true}}, nil
		}
		if authError(e) {
			return nil, e
		}
		return invalid("Could not process the notes. Please try again.")
	}
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "ai_outputs", Rows: []erpwire.Row{{"org_id": a.OrgID(), "entity": "meeting", "entity_id": nil, "kind": "meeting_intake", "model": s.model, "content": content, "created_by": a.UserID()}}})
		return e
	})
	return erpwire.ActionResponse{Value: erpwire.Row{"content": content, "items": parseActionItems(content)}}, nil
}

func (s *Service) assistantPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	locale := "th"
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		row, e := one(ctx, tx, erpwire.Select{Table: "profiles", Columns: []string{"locale"}, Where: []erpwire.Predicate{eq("id", a.UserID())}})
		if e != nil {
			return e
		}
		if row["locale"] != nil {
			locale = text(row["locale"])
		}
		return nil
	})
	if authError(e) {
		return nil, e
	}
	return erpwire.Row{"profileLocale": locale, "workspaceName": a.OrgName(), "key": a.UserID() + ":" + a.OrgID()}, nil
}
func (s *Service) ocrPage(_ context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	return erpwire.Row{}, nil
}
