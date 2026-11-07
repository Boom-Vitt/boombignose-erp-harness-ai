package erpledger

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var bahtPattern = regexp.MustCompile(`^\d+(\.\d{1,2})?$`)
var monthPattern = regexp.MustCompile(`^\d{4}-\d{2}$`)

func (s *Service) createCost(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	r, e := inputObject(raw)
	if e != nil {
		return invalid("Invalid input")
	}
	category := "other"
	if v, ok := r["category"]; ok {
		category = text(v)
	}
	if !has([]string{"software", "contractor", "infra", "marketing", "salary", "other"}, category) {
		return invalid("Invalid input")
	}
	value, ok := r["amountBaht"].(string)
	if !ok {
		return invalid("Invalid input")
	}
	amount, e := amountInput(value)
	if e != nil {
		return invalid("Invalid input")
	}
	row := erpwire.Row{"org_id": a.OrgID(), "category": category, "amount_satang": int64(amount), "project_id": nil}
	for _, key := range []string{"incurred_on", "vendor", "project_id", "notes"} {
		if v, present := r[key]; present {
			value, ok := v.(string)
			if !ok {
				return invalid("Invalid input")
			}
			if key == "vendor" || key == "notes" {
				value = trim(value)
			}
			if value != "" {
				row[key] = value
			}
		}
	}
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		saved, e := tx.Insert(ctx, erpwire.Insert{Table: "costs", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(saved) != 1 {
			return erpwire.ErrNotFound
		}
		id = text(saved[0]["id"])
		return nil
	})
	if e != nil {
		return failure(e, "Unable to save cost. Please try again.")
	}
	// Source audit is best effort after the cost transaction has succeeded.
	_ = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": a.OrgID(), "actor_id": a.UserID(), "actor_email": a.Email(), "entity": "cost", "entity_id": id, "action": "created", "summary": "Recorded " + formatWhole(amount) + " " + category + " cost", "meta": erpwire.Row{"category": category, "vendor": row["vendor"]}}}})
		return e
	})
	return erpwire.ActionResponse{Value: erpwire.Row{}, Redirect: "/finance", Refresh: []string{"/finance"}}, nil
}

func formatWhole(amount money.Satang) string {
	whole := (amount + 50) / 100
	s := money.FormatBaht(whole * 100)
	s = strings.TrimSuffix(s, ".00")
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return "฿" + s
}

func (s *Service) deleteCost(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "cost:delete", "Only owners and admins can delete costs."); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	if e != nil || text(r["id"]) == "" {
		return invalid("Invalid input")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Delete(ctx, "costs", scoped(a, text(r["id"])), nil)
		return e
	})
	if e != nil {
		return failure(e, "Unable to delete cost. Please try again.")
	}
	return success("/finance")
}

func (s *Service) addBankLine(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "payment:verify", "Only owners and admins can add a bank line."); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	if e != nil {
		return invalid("Enter a date, a non-zero amount, and a reference.")
	}
	amountText, ok := r["amount"].(string)
	reference := trim(text(r["reference"]))
	amountText = trim(amountText)
	if !ok || !validDate(text(r["bookedOn"])) || length(amountText) < 1 || length(amountText) > 20 || length(reference) < 1 || length(reference) > 200 {
		return invalid("Enter a date, a non-zero amount, and a reference.")
	}
	negative := strings.HasPrefix(amountText, "-")
	if negative {
		amountText = amountText[1:]
	}
	amount, e := amountInput(amountText)
	if e != nil {
		return invalid(e.Error())
	}
	if amount == 0 {
		return invalid("Enter a non-zero THB amount")
	}
	if negative {
		amount = -amount
	}
	_, e = s.command(ctx, a, "add_bank_line", erpwire.Row{"p_booked_on": r["bookedOn"], "p_amount_satang": int64(amount), "p_reference": reference})
	if e != nil {
		return failure(e, "Unable to add bank line. Please try again.")
	}
	return success("/finance/bank", "/finance/cash")
}
func (s *Service) matchBankLine(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "payment:verify", "Only owners and admins can match a bank line."); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	if e != nil || !validID(text(r["lineId"])) || !validID(text(r["paymentId"])) {
		return invalid("Choose a bank line and a receipt.")
	}
	_, e = s.command(ctx, a, "match_bank_line", erpwire.Row{"p_line_id": r["lineId"], "p_payment_id": r["paymentId"]})
	if e != nil {
		return failure(e, "Unable to match bank line. Please try again.")
	}
	return success("/finance/bank", "/finance/cash")
}
func (s *Service) noteBankLine(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "payment:verify", "Only owners, admins, and accountants can note a bank line."); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	note, ok := r["note"].(string)
	note = trim(note)
	if e != nil || !validID(text(r["lineId"])) || !ok || length(note) > 200 {
		return invalid("Choose a bank line. Keep the note to 200 characters.")
	}
	_, e = s.command(ctx, a, "note_bank_line", erpwire.Row{"p_line_id": r["lineId"], "p_note": note})
	if e != nil {
		return failure(e, "Unable to note bank line. Please try again.")
	}
	return success("/finance/bank", "/finance/cash")
}

const acceptanceDenied = "Only owners, admins, and accountants can accept a draft close."

func (s *Service) acceptance(ctx context.Context, a erpwire.Actor, raw json.RawMessage, command, key string) (any, error) {
	if e := actionGate(a, "profit:view", acceptanceDenied); e != nil {
		return failure(e, "")
	}
	v, e := stringInput(raw)
	if e != nil {
		return nil, e
	}
	result, e := s.command(ctx, a, command, erpwire.Row{key: v})
	if e != nil {
		return failure(e, "Draft close acceptance unavailable.")
	}
	value := erpwire.Row{}
	if command == "propose_draft_close_acceptance" {
		var r erpwire.Row
		_ = erpwire.DecodeJSON(result, &r)
		value["pending"] = r["pending"] == true
	}
	return erpwire.ActionResponse{Value: value, Refresh: []string{"/finance/journal/trial-balance", "/audit/close"}}, nil
}
func (s *Service) proposeDraftCloseAcceptance(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.acceptance(ctx, a, raw, "propose_draft_close_acceptance", "p_through")
}
func (s *Service) confirmDraftCloseAcceptance(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.acceptance(ctx, a, raw, "confirm_draft_close_acceptance", "p_request_id")
}
func (s *Service) cancelDraftCloseAcceptance(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.acceptance(ctx, a, raw, "cancel_draft_close_acceptance", "p_request_id")
}

const lockDenied = "Only owners and admins can change the finance lock date."
const workspaceChanged = "Workspace changed. Reload before saving."

func (s *Service) updateFinanceLockDate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "settings:manage", lockDenied); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	date, ok := r["lockDate"].(string)
	reason := ""
	reasonOK := true
	if v, present := r["reason"]; present {
		reason, reasonOK = v.(string)
	}
	if e != nil || !validID(text(r["expectedOrgId"])) || !ok || date != "" && !validDate(date) || !reasonOK || length(reason) > 200 {
		return invalid("Enter a valid lock date or leave it blank.")
	}
	if r["expectedOrgId"] != a.OrgID() {
		return invalid(workspaceChanged)
	}
	if date > today() {
		return invalid("Finance lock date cannot be in the future.")
	}
	reason = trim(reason)
	if length(reason) > 200 {
		return invalid("The reopen reason can be 200 characters.")
	}
	result, e := s.command(ctx, a, "propose_finance_lock", erpwire.Row{"p_lock_date": nullable(date), "p_reason": nullable(reason)})
	if e != nil {
		return failure(e, "Finance lock unavailable.")
	}
	var body erpwire.Row
	_ = erpwire.DecodeJSON(result, &body)
	value := erpwire.Row{}
	if body["pending"] == true {
		value["pending"] = true
	}
	return erpwire.ActionResponse{Value: value, Refresh: []string{"/settings", "/settings/finance", "/audit", "/audit/close"}}, nil
}
func (s *Service) reopen(ctx context.Context, a erpwire.Actor, raw json.RawMessage, command string) (any, error) {
	if e := actionGate(a, "settings:manage", lockDenied); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	if e != nil {
		return nil, e
	}
	if text(r["expectedOrgId"]) != a.OrgID() {
		return invalid(workspaceChanged)
	}
	_, e = s.command(ctx, a, command, erpwire.Row{"p_request_id": r["requestId"]})
	if e != nil {
		return failure(e, "Finance lock unavailable.")
	}
	return success("/settings/finance", "/audit/close")
}
func (s *Service) confirmFinanceLockReopen(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.reopen(ctx, a, raw, "confirm_finance_lock_reopen")
}
func (s *Service) cancelFinanceLockReopen(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.reopen(ctx, a, raw, "cancel_finance_lock_reopen")
}
func (s *Service) closeCompletedMonth(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "settings:manage", lockDenied); e != nil {
		return failure(e, "")
	}
	r, e := inputObject(raw)
	if e != nil || !validID(text(r["expectedOrgId"])) || !monthPattern.MatchString(text(r["month"])) {
		return invalid("Enter a month as YYYY-MM.")
	}
	if r["expectedOrgId"] != a.OrgID() {
		return invalid(workspaceChanged)
	}
	result, e := s.command(ctx, a, "close_completed_month", erpwire.Row{"p_month": r["month"]})
	if e != nil {
		return failure(e, "Finance lock unavailable.")
	}
	value := erpwire.Row{}
	var date string
	if erpwire.DecodeJSON(result, &date) == nil && string(result) != "null" {
		value["lockDate"] = date
	}
	return erpwire.ActionResponse{Value: value, Refresh: []string{"/settings", "/settings/finance", "/reports", "/audit"}}, nil
}
