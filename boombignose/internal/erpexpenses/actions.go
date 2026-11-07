package erpexpenses

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var guid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func textLength(value string) int {
	length := 0
	for _, r := range value { length += utf16.RuneLen(r) }
	return length
}

// Match ECMAScript trim rather than Go's different Unicode whitespace set.
func trimText(value string) string {
	return strings.TrimFunc(value, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680',
			'\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
			return true
		}
		return r >= '\u2000' && r <= '\u200a'
	})
}

func trimmedField(args erpwire.Arguments, index int, field string, maximum int) (string, bool) {
	var input map[string]any
	if args.Decode(index, &input) != nil { return "", false }
	value, ok := input[field].(string)
	value = trimText(value)
	return value, ok && value != "" && textLength(value) <= maximum
}

func (s *Service) createClaim(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 1)
	if err != nil { return nil, err }
	title, valid := trimmedField(args, 0, "title", 200)
	if !valid { return failure("Enter a title of up to 200 characters") }
	var id string
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		result, err := tx.Command(ctx, "create_expense_claim", erpwire.Row{"p_org_id": actor.OrgID(), "p_title": title})
		if err != nil { return err }
		if erpwire.DecodeJSON(result, &id) != nil || !guid.MatchString(id) { return errors.New("invalid expense command result") }
		return nil
	})
	if err != nil { return actionResult(err, "", "Expense claim could not be created. Please try again.") }
	return erpwire.ActionResponse{Value: ActionValue{}, Redirect: "/expenses/"+id, Refresh: []string{"/expenses"}}, nil
}

func parseLine(args erpwire.Arguments) (erpwire.Row, string) {
	var input map[string]any
	if args.Decode(0, &input) != nil || input == nil { return nil, "Invalid expense line" }
	claim, _ := input["claim_id"].(string)
	if !guid.MatchString(claim) { return nil, "Invalid GUID" }
	date, _ := input["spent_on"].(string)
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil || len(date) != 10 || parsed.Format("2006-01-02") != date { return nil, "Invalid ISO date" }
	category, _ := input["category"].(string)
	switch category {
	case "software", "contractor", "infra", "marketing", "salary", "other", "inventory":
	default: return nil, `Invalid option: expected one of "software"|"contractor"|"infra"|"marketing"|"salary"|"other"|"inventory"`
	}
	description, ok := input["description"].(string)
	if !ok { return nil, "Invalid expense line" }
	description = trimText(description)
	if description == "" { return nil, "Too small: expected string to have >=1 characters" }
	if textLength(description) > 1000 { return nil, "Too big: expected string to have <=1000 characters" }
	var amountText string
	switch value := input["amountBaht"].(type) {
	case string: amountText = value
	case json.Number: amountText = value.String()
	default: return nil, "Enter a THB amount above zero with up to two decimals"
	}
	amount, err := money.ParseBaht(amountText)
	if err != nil || amount <= 0 { return nil, "Enter a THB amount above zero with up to two decimals" }
	project, ok := input["project_id"].(string)
	if !ok || project != "" && !guid.MatchString(project) { return nil, "Invalid input" }
	var projectID any
	if project != "" { projectID = project }
	return erpwire.Row{"claim_id": claim, "spent_on": date, "category": category, "description": description, "amount_satang": int64(amount), "project_id": projectID}, ""
}

func (s *Service) addLine(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 1)
	if err != nil { return nil, err }
	line, message := parseLine(args)
	if message != "" { return failure(message) }
	id := line["claim_id"].(string)
	line["org_id"] = actor.OrgID()
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		last, err := tx.Select(ctx, erpwire.Select{Table: "expense_lines", Columns: []string{"position"}, Where: append(orgWhere(actor), eq("claim_id", id)), Order: []erpwire.Order{{Column: "position", Descending: true}, {Column: "id"}}, Limit: 1})
		if err != nil { return err }
		position := int64(0)
		if len(last.Rows) > 0 {
			previous, err := integer(last.Rows[0]["position"])
			if err != nil || previous < 0 || previous >= math.MaxInt32 { return errors.New("expense line position unavailable") }
			position = previous+1
		}
		line["position"] = position
		_, err = tx.Insert(ctx, erpwire.Insert{Table: "expense_lines", Rows: []erpwire.Row{line}})
		return err
	})
	return actionResult(err, id, "Expense line could not be added. Please reload and try again.")
}

var errNoRemoval = errors.New("no editable expense line")

func (s *Service) removeLine(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 2)
	if err != nil { return nil, err }
	var claimID, lineID string
	if args.Decode(0, &claimID) != nil || args.Decode(1, &lineID) != nil || !guid.MatchString(claimID) || !guid.MatchString(lineID) { return failure("Invalid line") }
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		rows, err := tx.Delete(ctx, "expense_lines", append(orgWhere(actor), eq("claim_id", claimID), eq("id", lineID)), []string{"id"})
		if err != nil { return err }
		if len(rows) == 0 { return errNoRemoval }
		return nil
	})
	if errors.Is(err, errNoRemoval) { return failure("Only lines on your draft claims can be removed. Reload to see the latest status.") }
	return actionResult(err, claimID, "Expense line could not be removed. Please reload and try again.")
}

func (s *Service) transitionClaim(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authenticated(actor); err != nil { return nil, err }
	args, err := arguments(raw, 2)
	if err != nil { return nil, err }
	var id, status string
	if args.Decode(0, &id) != nil || args.Decode(1, &status) != nil || !guid.MatchString(id) { return failure("Invalid expense transition") }
	switch status {
	case "submitted", "draft":
	case "approved", "paid":
		if err := actor.Authorize("expense:approve", time.Now()); err != nil { return nil, err }
	default: return failure("Invalid expense transition")
	}
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		_, err := tx.Command(ctx, "transition_expense_claim", erpwire.Row{"p_org_id": actor.OrgID(), "p_claim_id": id, "p_status": status})
		return err
	})
	return actionResult(err, id, "Expense transition could not be completed. Please reload and try again.")
}

func (s *Service) rejectClaim(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := actor.Authorize("expense:approve", time.Now()); err != nil { return nil, err }
	args, err := arguments(raw, 2)
	if err != nil { return nil, err }
	var id string
	note, valid := trimmedField(args, 1, "note", 2000)
	if args.Decode(0, &id) != nil || !guid.MatchString(id) || !valid { return failure("Enter a reason of up to 2,000 characters") }
	err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
		_, err := tx.Command(ctx, "transition_expense_claim", erpwire.Row{"p_org_id": actor.OrgID(), "p_claim_id": id, "p_status": "rejected", "p_note": note})
		return err
	})
	return actionResult(err, id, "Expense claim could not be rejected. Please reload and try again.")
}
