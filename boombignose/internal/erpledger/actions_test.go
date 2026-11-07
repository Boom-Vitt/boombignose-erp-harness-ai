package erpledger

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestAllOperationsDenyUnboundActor(t *testing.T) {
	f := newFake(t)
	s := service(t, f)
	if _, e := New(Options{}); e == nil {
		t.Fatal("accepted nil store")
	}
	if len(s.Operations()) != 23 {
		t.Fatalf("operation count = %d", len(s.Operations()))
	}
	for key, op := range s.Operations() {
		t.Run(key, func(t *testing.T) {
			_, e := op(context.Background(), erpwire.Actor{}, json.RawMessage(`[]`))
			if !errors.Is(e, erpwire.ErrUnauthenticated) {
				t.Fatalf("got %v", e)
			}
		})
	}
	if f.reads != 0 || f.writes != 0 {
		t.Fatal("unauthenticated request reached store")
	}
}
func TestCapabilityDenialsAndAccountantBankPolicy(t *testing.T) {
	for _, test := range []struct{ path, name, message string }{
		{"actions.ts", "deleteCost", "Only owners and admins can delete costs."},
		{"actions.ts", "updateFinanceLockDate", lockDenied}, {"actions.ts", "confirmFinanceLockReopen", lockDenied}, {"actions.ts", "cancelFinanceLockReopen", lockDenied}, {"actions.ts", "closeCompletedMonth", lockDenied},
		{"bank/actions.ts", "addBankLine", "Only owners and admins can add a bank line."}, {"bank/actions.ts", "matchBankLine", "Only owners and admins can match a bank line."}, {"bank/actions.ts", "noteBankLine", "Only owners, admins, and accountants can note a bank line."},
		{"journal/actions.ts", "postDraftJournal", journalDenied}, {"journal/actions.ts", "postIssuedSalesInvoice", journalDenied}, {"journal/actions.ts", "postIssuedCreditNote", journalDenied}, {"journal/actions.ts", "postCashReceipt", journalDenied},
		{"journal/acceptance-actions.ts", "proposeDraftCloseAcceptance", acceptanceDenied}, {"journal/acceptance-actions.ts", "confirmDraftCloseAcceptance", acceptanceDenied}, {"journal/acceptance-actions.ts", "cancelDraftCloseAcceptance", acceptanceDenied},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newFake(t)
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Member, orgID), test.path, test.name)
			expectError(t, v, e, test.message)
			if f.reads != 0 || f.writes != 0 {
				t.Fatal("denied action reached store")
			}
		})
	}
	f := newFake(t)
	s := service(t, f)
	v, e := call(t, s, actor(t, erpwire.Accountant, orgID), "bank/actions.ts", "addBankLine", erpwire.Row{"bookedOn": "2026-10-01", "amount": "0.01", "reference": "exact"})
	r := action(t, v, e)
	if len(f.commands) != 1 || object(r.Value)["error"] != nil {
		t.Fatalf("accountant capability changed: %#v", r)
	}
}
func TestCostValidationAuditAndIsolation(t *testing.T) {
	for _, test := range []struct {
		amount any
		valid  bool
		want   money.Satang
	}{
		{"0", true, 0}, {"0.01", true, 1}, {"90071992547409.91", true, money.MaxSafeSatang}, {"90071992547409.92", false, 0}, {"1.001", false, 0}, {"1e2", false, 0}, {json.Number("1"), false, 0}, {"-0.01", false, 0},
	} {
		t.Run(strings.TrimSpace(strings.ReplaceAll(strings.TrimSpace(stringify(test.amount)), ".", "_")), func(t *testing.T) {
			f := newFake(t)
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Member, orgID), "actions.ts", "createCost", erpwire.Row{"category": "software", "amountBaht": test.amount, "vendor": "  =สูตร  ", "notes": "  service ", "project_id": "", "incurred_on": ""})
			if !test.valid {
				expectError(t, v, e, "Invalid input")
				if f.writes != 0 {
					t.Fatal("invalid cost wrote")
				}
				return
			}
			r := action(t, v, e)
			if r.Redirect != "/finance" || !reflect.DeepEqual(r.Refresh, []string{"/finance"}) {
				t.Fatalf("navigation: %#v", r)
			}
			cost := f.tables["costs"][0]
			if cost["org_id"] != orgID || cost["amount_satang"] != int64(test.want) || cost["vendor"] != "=สูตร" || cost["notes"] != "service" || cost["project_id"] != nil {
				t.Fatalf("cost = %#v", cost)
			}
			if _, ok := cost["incurred_on"]; ok {
				t.Fatal("overrode default date")
			}
			audit := f.tables["audit_log"][0]
			if audit["actor_id"] != userID || audit["entity_id"] != recordID || audit["summary"] != "Recorded "+formatWhole(test.want)+" software cost" || object(audit["meta"])["vendor"] != "=สูตร" {
				t.Fatalf("audit = %#v", audit)
			}
		})
	}
	f := newFake(t)
	f.add("costs", erpwire.Row{"id": recordID, "org_id": otherOrg}, erpwire.Row{"id": otherID})
	s := service(t, f)
	v, e := call(t, s, actor(t, erpwire.Owner, orgID), "actions.ts", "deleteCost", erpwire.Row{"id": recordID})
	r := action(t, v, e)
	if len(f.tables["costs"]) != 2 || len(r.Refresh) != 1 {
		t.Fatal("deleted another org's cost")
	}
	v, e = call(t, s, actor(t, erpwire.Owner, orgID), "actions.ts", "deleteCost", erpwire.Row{"id": otherID})
	action(t, v, e)
	if len(f.tables["costs"]) != 1 || f.tables["costs"][0]["org_id"] != otherOrg {
		t.Fatal("tenant delete failed")
	}
}
func stringify(v any) string { raw, _ := json.Marshal(v); return string(raw) }
func TestBankValidationExactAmounts(t *testing.T) {
	for _, test := range []struct {
		amount, date, reference, want string
		value                         int64
	}{
		{"-90071992547409.91", "2024-02-29", "ไทย", "", -int64(money.MaxSafeSatang)},
		{"0.01", "2026-10-01", " reference ", "", 1},
		{"0", "2026-10-01", "reference", "Enter a non-zero THB amount", 0},
		{"-0", "2026-10-01", "reference", "Enter a non-zero THB amount", 0},
		{"1.001", "2026-10-01", "reference", "Enter a positive THB amount with up to two decimals", 0},
		{"90071992547409.92", "2026-10-01", "reference", "Amount outside safe satang bounds", 0},
		{"1", "2025-02-29", "reference", "Enter a date, a non-zero amount, and a reference.", 0},
		{"1", "2026-10-01", strings.Repeat("😀", 101), "Enter a date, a non-zero amount, and a reference.", 0},
	} {
		t.Run(test.amount+test.date, func(t *testing.T) {
			f := newFake(t)
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Owner, orgID), "bank/actions.ts", "addBankLine", erpwire.Row{"amount": test.amount, "bookedOn": test.date, "reference": test.reference, "org_id": otherOrg})
			if test.want != "" {
				expectError(t, v, e, test.want)
				if len(f.commands) > 0 {
					t.Fatal("invalid bank line command")
				}
				return
			}
			r := action(t, v, e)
			if !reflect.DeepEqual(r.Refresh, []string{"/finance/bank", "/finance/cash"}) {
				t.Fatalf("refresh %#v", r.Refresh)
			}
			want := erpwire.Row{"p_org_id": orgID, "p_booked_on": test.date, "p_amount_satang": test.value, "p_reference": trim(test.reference)}
			if len(f.commands) != 1 || f.commands[0].Name != "add_bank_line" || !reflect.DeepEqual(f.commands[0].Args, want) {
				t.Fatalf("command %#v", f.commands)
			}
		})
	}
}
func TestDurableTransitionCommands(t *testing.T) {
	for _, test := range []struct {
		path, name, command string
		input               any
		args                erpwire.Row
		result              string
		value               erpwire.Row
		refresh             []string
	}{
		{"bank/actions.ts", "matchBankLine", "match_bank_line", erpwire.Row{"lineId": recordID, "paymentId": otherID}, erpwire.Row{"p_line_id": recordID, "p_payment_id": otherID}, `null`, erpwire.Row{}, []string{"/finance/bank", "/finance/cash"}},
		{"bank/actions.ts", "noteBankLine", "note_bank_line", erpwire.Row{"lineId": recordID, "note": "  fee ธนาคาร  "}, erpwire.Row{"p_line_id": recordID, "p_note": "fee ธนาคาร"}, `null`, erpwire.Row{}, []string{"/finance/bank", "/finance/cash"}},
		{"bank/actions.ts", "noteBankLine", "note_bank_line", erpwire.Row{"lineId": recordID, "note": ""}, erpwire.Row{"p_line_id": recordID, "p_note": ""}, `null`, erpwire.Row{}, []string{"/finance/bank", "/finance/cash"}},
		{"journal/acceptance-actions.ts", "proposeDraftCloseAcceptance", "propose_draft_close_acceptance", "2026-10-31", erpwire.Row{"p_through": "2026-10-31"}, `{"pending":true}`, erpwire.Row{"pending": true}, []string{"/finance/journal/trial-balance", "/audit/close"}},
		{"journal/acceptance-actions.ts", "proposeDraftCloseAcceptance", "propose_draft_close_acceptance", "2026-10-31", erpwire.Row{"p_through": "2026-10-31"}, `{"already":true}`, erpwire.Row{"pending": false}, []string{"/finance/journal/trial-balance", "/audit/close"}},
		{"journal/acceptance-actions.ts", "confirmDraftCloseAcceptance", "confirm_draft_close_acceptance", recordID, erpwire.Row{"p_request_id": recordID}, `{"applied":true}`, erpwire.Row{}, []string{"/finance/journal/trial-balance", "/audit/close"}},
		{"journal/acceptance-actions.ts", "cancelDraftCloseAcceptance", "cancel_draft_close_acceptance", recordID, erpwire.Row{"p_request_id": recordID}, `null`, erpwire.Row{}, []string{"/finance/journal/trial-balance", "/audit/close"}},
		{"actions.ts", "updateFinanceLockDate", "propose_finance_lock", erpwire.Row{"expectedOrgId": orgID, "lockDate": "", "reason": " earlier "}, erpwire.Row{"p_lock_date": nil, "p_reason": "earlier"}, `{"pending":true}`, erpwire.Row{"pending": true}, []string{"/settings", "/settings/finance", "/audit", "/audit/close"}},
		{"actions.ts", "updateFinanceLockDate", "propose_finance_lock", erpwire.Row{"expectedOrgId": orgID, "lockDate": "2026-10-31"}, erpwire.Row{"p_lock_date": "2026-10-31", "p_reason": nil}, `{"applied":true}`, erpwire.Row{}, []string{"/settings", "/settings/finance", "/audit", "/audit/close"}},
		{"actions.ts", "confirmFinanceLockReopen", "confirm_finance_lock_reopen", erpwire.Row{"expectedOrgId": orgID, "requestId": recordID}, erpwire.Row{"p_request_id": recordID}, `null`, erpwire.Row{}, []string{"/settings/finance", "/audit/close"}},
		{"actions.ts", "cancelFinanceLockReopen", "cancel_finance_lock_reopen", erpwire.Row{"expectedOrgId": orgID, "requestId": recordID}, erpwire.Row{"p_request_id": recordID}, `null`, erpwire.Row{}, []string{"/settings/finance", "/audit/close"}},
		{"actions.ts", "closeCompletedMonth", "close_completed_month", erpwire.Row{"expectedOrgId": orgID, "month": "2026-10"}, erpwire.Row{"p_month": "2026-10"}, `"2026-10-31"`, erpwire.Row{"lockDate": "2026-10-31"}, []string{"/settings", "/settings/finance", "/reports", "/audit"}},
	} {
		t.Run(test.name+test.result, func(t *testing.T) {
			f := newFake(t)
			f.commandResult = json.RawMessage(test.result)
			s := service(t, f)
			v, e := call(t, s, actor(t, erpwire.Owner, orgID), test.path, test.name, test.input)
			r := action(t, v, e)
			want := copyRow(test.args)
			want["p_org_id"] = orgID
			if len(f.commands) != 1 || f.commands[0].Name != test.command || !reflect.DeepEqual(f.commands[0].Args, want) || !reflect.DeepEqual(r.Value, test.value) || !reflect.DeepEqual(r.Refresh, test.refresh) {
				t.Fatalf("command/response = %#v / %#v", f.commands, r)
			}
			f.commandError = businessError("Database transition refused.")
			v, e = call(t, s, actor(t, erpwire.Owner, orgID), test.path, test.name, test.input)
			expectError(t, v, e, "Database transition refused.")
		})
	}
}
func TestLockWorkspaceValidation(t *testing.T) {
	for _, test := range []struct {
		name  string
		input erpwire.Row
		want  string
	}{
		{"updateFinanceLockDate", erpwire.Row{"expectedOrgId": otherOrg, "lockDate": ""}, workspaceChanged},
		{"updateFinanceLockDate", erpwire.Row{"expectedOrgId": orgID, "lockDate": "9999-12-31"}, "Finance lock date cannot be in the future."},
		{"updateFinanceLockDate", erpwire.Row{"expectedOrgId": orgID, "lockDate": "2026-02-30"}, "Enter a valid lock date or leave it blank."},
		{"updateFinanceLockDate", erpwire.Row{"expectedOrgId": orgID, "lockDate": "", "reason": strings.Repeat("x", 201)}, "Enter a valid lock date or leave it blank."},
		{"confirmFinanceLockReopen", erpwire.Row{"expectedOrgId": otherOrg, "requestId": recordID}, workspaceChanged},
		{"cancelFinanceLockReopen", erpwire.Row{"expectedOrgId": otherOrg, "requestId": recordID}, workspaceChanged},
		{"closeCompletedMonth", erpwire.Row{"expectedOrgId": otherOrg, "month": "2026-10"}, workspaceChanged},
		{"closeCompletedMonth", erpwire.Row{"expectedOrgId": orgID, "month": "2026-1"}, "Enter a month as YYYY-MM."},
	} {
		t.Run(test.name+test.want, func(t *testing.T) {
			f := newFake(t)
			v, e := call(t, service(t, f), actor(t, erpwire.Owner, orgID), "actions.ts", test.name, test.input)
			expectError(t, v, e, test.want)
			if f.writes != 0 {
				t.Fatal("invalid lock request wrote")
			}
		})
	}
}
