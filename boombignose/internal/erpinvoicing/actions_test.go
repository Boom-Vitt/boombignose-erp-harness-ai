package erpinvoicing

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestOperationCoverageMatchesSource(t *testing.T) {
	s := testService(t, newMemoryStore())
	root := filepath.Join("..", "..", "..")
	files := []string{financePath + "page.tsx"}
	for _, name := range []string{"actions.ts", "email-actions.ts", "close-summary-actions.ts", "correction-actions.ts", "receipt-actions.ts"} {
		files = append(files, financePath+name)
	}
	for _, dir := range []string{"business-profile", "invoices", "receipts", "credit-notes", "payments", "outstanding"} {
		e := filepath.WalkDir(filepath.Join(root, financePath, dir), func(path string, entry fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if !entry.IsDir() {
				rel, e := filepath.Rel(root, path)
				if e != nil {
					return e
				}
				files = append(files, filepath.ToSlash(rel))
			}
			return nil
		})
		if e != nil {
			t.Fatal(e)
		}
	}
	want := []string{}
	exports := regexp.MustCompile(`export\s+async\s+function\s+([A-Za-z][A-Za-z0-9_]*)`)
	for _, file := range files {
		if !strings.HasSuffix(file, ".ts") && !strings.HasSuffix(file, "page.tsx") {
			continue
		}
		raw, e := os.ReadFile(filepath.Join(root, file))
		if e != nil {
			t.Fatal(e)
		}
		if strings.HasSuffix(file, "page.tsx") {
			want = append(want, file+"::load")
			continue
		}
		if strings.HasSuffix(file, "route.ts") || strings.Contains(string(raw), `"use server"`) {
			for _, m := range exports.FindAllStringSubmatch(string(raw), -1) {
				want = append(want, file+"::"+m[1])
			}
		}
	}
	got := []string{}
	for key := range s.Operations() {
		got = append(got, key)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("registry differs from all scoped exported source operations\ngot: %v\nwant: %v", got, want)
	}
}

func TestEveryOperationRejectsUnboundActorBeforeStore(t *testing.T) {
	store := newMemoryStore()
	s := testService(t, store)
	for key, operation := range s.Operations() {
		t.Run(key, func(t *testing.T) {
			_, e := operation(context.Background(), erpwire.Actor{}, json.RawMessage("[]"))
			if !errors.Is(e, erpwire.ErrUnauthenticated) {
				t.Fatalf("unauthenticated operation = %v", e)
			}
		})
	}
	if store.readCount != 0 || store.writeCount != 0 {
		t.Fatalf("unauthenticated store access reads=%d writes=%d", store.readCount, store.writeCount)
	}
}

func TestCommandBoundariesPreserveAuthoritativeTransitions(t *testing.T) {
	base := func() erpwire.Row {
		return erpwire.Row{"invoiceId": testInvoice, "key": testKey, "amountBaht": "90071992547409.91", "reference": " bank reference "}
	}
	issue := erpwire.Row{"invoiceId": testInvoice, "key": testKey, "expectedVersion": 7}
	tests := []struct {
		name, key, command string
		input              erpwire.Row
		want               erpwire.Row
		paths              []string
		reply              string
		result             erpwire.Row
	}{
		{"staff pending", financeActions + "recordPayment", "submit_internal_payment_claim", base(), erpwire.Row{"p_invoice_id": testInvoice, "p_key": testKey, "p_amount_satang": int64(money.MaxSafeSatang), "p_reference": "bank reference"}, []string{"/finance", "/finance/invoices/" + testInvoice}, "null", erpwire.Row{}},
		{"legacy reconcile", financeActions + "reconcileLegacyPayment", "reconcile_legacy_payment_with_evidence", mergeInput(base(), erpwire.Row{"legacyPaymentId": testPayment, "paidOn": "2026-11-08", "method": "transfer"}), erpwire.Row{"p_legacy_payment_id": testPayment, "p_key": testKey, "p_amount_satang": int64(money.MaxSafeSatang), "p_reference": "bank reference", "p_paid_on": "2026-11-08", "p_method": "transfer"}, nil, "null", erpwire.Row{}},
		{"verify receipt", financeActions + "reviewPaymentClaim", "review_payment_claim_with_evidence", mergeInput(base(), erpwire.Row{"claimId": testPayment, "decision": "verified", "paidOn": "2026-11-08", "method": "promptpay"}), erpwire.Row{"p_claim_id": testPayment, "p_key": testKey, "p_amount_satang": int64(money.MaxSafeSatang), "p_reference": "bank reference", "p_decision": "verified", "p_paid_on": "2026-11-08", "p_method": "promptpay"}, nil, "null", erpwire.Row{}},
		{"reject receipt", financeActions + "reviewPaymentClaim", "review_payment_claim_with_evidence", mergeInput(base(), erpwire.Row{"claimId": testPayment, "decision": "rejected", "amountBaht": "not money"}), erpwire.Row{"p_claim_id": testPayment, "p_key": testKey, "p_amount_satang": int64(0), "p_reference": "bank reference", "p_decision": "rejected", "p_paid_on": nil, "p_method": nil}, nil, "null", erpwire.Row{}},
		{"issue", financeActions + "issueInvoice", "issue_invoice", issue, erpwire.Row{"p_invoice_id": testInvoice, "p_key": testKey, "p_expected_version": int64(7)}, nil, "null", erpwire.Row{}},
		{"tax issue", financeActions + "issueTaxInvoice", "issue_tax_invoice", mergeInput(issue, erpwire.Row{"docType": "ABB"}), erpwire.Row{"p_invoice_id": testInvoice, "p_key": testKey, "p_expected_version": int64(7), "p_doc_type": "ABB"}, nil, "null", erpwire.Row{}},
		{"adopt legacy", financeActions + "adoptLegacyInvoice", "adopt_legacy_invoice", mergeInput(issue, erpwire.Row{"reason": " retained evidence "}), erpwire.Row{"p_invoice_id": testInvoice, "p_key": testKey, "p_expected_version": int64(7), "p_reason": "retained evidence"}, nil, "null", erpwire.Row{}},
		{"profile", financeActions + "updateBusinessProfile", "update_tax_business_profile", erpwire.Row{"expectedOrgId": testOrg, "legalName": " บริษัท ", "address": " Bangkok ", "taxId": "1234567890123", "taxStatus": "registered"}, erpwire.Row{"p_legal_name": "บริษัท", "p_business_address": "Bangkok", "p_tax_id": "1234567890123", "p_tax_status": "registered", "p_vat_rate_bps": int64(700), "p_prices_include_vat": false, "p_branch_label": ""}, nil, "null", erpwire.Row{}},
		{"template", financeActions + "saveTaxInvoiceTemplate", "save_tax_invoice_template", erpwire.Row{"expectedOrgId": testOrg, "branch_code": " 00000 "}, erpwire.Row{"p_template": erpwire.Row{"seller_phone": "", "copy_label": "", "branch_code": "00000"}}, nil, "null", erpwire.Row{}},
		{"cancel draft", financeActions + "cancelDraftInvoice", "cancel_draft_invoice", erpwire.Row{"invoiceId": testInvoice}, erpwire.Row{"p_invoice_id": testInvoice}, nil, "null", erpwire.Row{}},
		{"propose reopen", financeActions + "updateFinanceLockDate", "propose_finance_lock", erpwire.Row{"expectedOrgId": testOrg, "lockDate": "", "reason": " reopen "}, erpwire.Row{"p_lock_date": nil, "p_reason": "reopen"}, nil, `{"pending":true}`, erpwire.Row{"pending": true}},
		{"confirm reopen", financeActions + "confirmFinanceLockReopen", "confirm_finance_lock_reopen", erpwire.Row{"expectedOrgId": testOrg, "requestId": testKey}, erpwire.Row{"p_request_id": testKey}, nil, "null", erpwire.Row{}},
		{"cancel reopen", financeActions + "cancelFinanceLockReopen", "cancel_finance_lock_reopen", erpwire.Row{"expectedOrgId": testOrg, "requestId": testKey}, erpwire.Row{"p_request_id": testKey}, nil, "null", erpwire.Row{}},
		{"close month", financeActions + "closeCompletedMonth", "close_completed_month", erpwire.Row{"expectedOrgId": testOrg, "month": "2026-10"}, erpwire.Row{"p_month": "2026-10"}, nil, `"2026-10-31"`, erpwire.Row{"lockDate": "2026-10-31"}},
		{"credit amount", financePath + "correction-actions.ts::issueCreditNote", "issue_credit_note", erpwire.Row{"invoiceId": testInvoice, "key": testKey, "reason": " correction ", "lines": []any{erpwire.Row{"mode": "amount", "amountSatang": int64(money.MaxSafeSatang)}}}, erpwire.Row{"p_invoice_id": testInvoice, "p_key": testKey, "p_reason": "correction", "p_lines": []erpwire.Row{{"amount_satang": int64(money.MaxSafeSatang)}}}, nil, `"credit-id"`, erpwire.Row{"id": "credit-id"}},
		{"credit quantity", financePath + "correction-actions.ts::issueCreditNote", "issue_credit_note", erpwire.Row{"invoiceId": testInvoice, "key": testKey, "reason": " correction ", "lines": []any{erpwire.Row{"mode": "quantity", "invoiceItemId": testPayment, "quantity": json.Number("999999999.999")}}}, erpwire.Row{"p_invoice_id": testInvoice, "p_key": testKey, "p_reason": "correction", "p_lines": []erpwire.Row{{"invoice_item_id": testPayment, "quantity": json.Number("999999999.999")}}}, nil, `"credit-id"`, erpwire.Row{"id": "credit-id"}},
		{"reverse receipt", financePath + "correction-actions.ts::reversePayment", "reverse_payment", erpwire.Row{"paymentId": testPayment, "key": testKey, "reason": " duplicate ", "reversedOn": "2026-11-08"}, erpwire.Row{"p_payment_id": testPayment, "p_key": testKey, "p_reason": "duplicate", "p_reversed_on": "2026-11-08"}, nil, "null", erpwire.Row{}},
		{"review policy", financePath + "correction-actions.ts::updatePaymentReviewPolicy", "update_payment_review_policy", erpwire.Row{"expectedOrgId": testOrg, "required": false}, erpwire.Row{"p_required": false}, nil, "null", erpwire.Row{}},
		{"customer pending", financePath + "receipt-actions.ts::reportCustomerReceipt", "submit_customer_payment_claim", erpwire.Row{"clientId": testClient, "key": testKey, "amountBaht": "0.01", "reference": " receipt ", "allocations": []any{}}, erpwire.Row{"p_client_id": testClient, "p_key": testKey, "p_amount_satang": int64(1), "p_reference": "receipt", "p_allocations": []erpwire.Row{}}, nil, "null", erpwire.Row{}},
		{"allocate credit", financePath + "receipt-actions.ts::applyCustomerCredit", "apply_customer_credit", erpwire.Row{"clientId": testClient, "key": testKey, "allocations": []any{erpwire.Row{"invoiceId": testInvoice, "amountSatang": 1}}}, erpwire.Row{"p_client_id": testClient, "p_key": testKey, "p_allocations": []erpwire.Row{{"invoice_id": testInvoice, "amount_satang": int64(1)}}}, nil, "null", erpwire.Row{}},
		{"refund credit", financePath + "receipt-actions.ts::refundCustomerCredit", "refund_customer_credit", erpwire.Row{"paymentId": testPayment, "key": testKey, "amountBaht": "0.01", "reference": " refund ", "paidOn": "2026-11-09", "method": "cash"}, erpwire.Row{"p_payment_id": testPayment, "p_key": testKey, "p_amount_satang": int64(1), "p_reference": "refund", "p_paid_on": "2026-11-09", "p_method": "cash"}, nil, "null", erpwire.Row{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newMemoryStore()
			store.replies[tt.command] = json.RawMessage(tt.reply)
			s := testService(t, store)
			r, e := invoke(t, s, testActor(t, erpwire.Owner), tt.key, tt.input)
			value := actionValue(t, r, e)
			if !reflect.DeepEqual(value, tt.result) {
				t.Fatalf("value %#v want %#v", value, tt.result)
			}
			if len(store.commands) != 1 || store.commands[0].Name != tt.command {
				t.Fatalf("wrong command: %#v", store.commands)
			}
			tt.want["p_org_id"] = testOrg
			if !reflect.DeepEqual(store.commands[0].Args, tt.want) {
				t.Fatalf("command args %#v want %#v", store.commands[0].Args, tt.want)
			}
			if tt.paths != nil && !reflect.DeepEqual(r.(erpwire.ActionResponse).Refresh, tt.paths) {
				t.Fatalf("refresh %#v", r)
			}
		})
	}
}

func mergeInput(base, patch erpwire.Row) erpwire.Row {
	out := erpwire.Row{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range patch {
		out[k] = v
	}
	return out
}

func TestActionValidationDeniesWrites(t *testing.T) {
	issue := erpwire.Row{"invoiceId": testInvoice, "key": testKey, "expectedVersion": 1}
	report := erpwire.Row{"clientId": testClient, "key": testKey, "amountBaht": "1.00", "reference": "bank", "allocations": []any{}}
	allocation := erpwire.Row{"invoiceId": testInvoice, "amountSatang": 1}
	tests := []struct {
		name, key string
		input     erpwire.Row
		want      string
	}{
		{"stale workspace", financeActions + "updateBusinessProfile", erpwire.Row{"expectedOrgId": otherOrg, "legalName": "name", "address": "address", "taxStatus": "unknown", "taxId": ""}, "Workspace changed. Reload this form before saving the business profile."},
		{"missing registered ID", financeActions + "updateBusinessProfile", erpwire.Row{"expectedOrgId": testOrg, "legalName": "name", "address": "address", "taxStatus": "registered", "taxId": ""}, "Enter the legal business name, address and explicit tax status."},
		{"bad version", financeActions + "issueInvoice", mergeInput(issue, erpwire.Row{"expectedVersion": 0}), "Invalid issue request"},
		{"huge numeric exponent", financeActions + "issueInvoice", mergeInput(issue, erpwire.Row{"expectedVersion": json.Number("1e1000000")}), "Invalid issue request"},
		{"tiny numeric exponent", financeActions + "issueInvoice", mergeInput(issue, erpwire.Row{"expectedVersion": json.Number("1e-1000000")}), "Invalid issue request"},
		{"string version", financeActions + "issueInvoice", mergeInput(issue, erpwire.Row{"expectedVersion": "1"}), "Invalid issue request"},
		{"version overflow", financeActions + "issueInvoice", mergeInput(issue, erpwire.Row{"expectedVersion": 2147483648}), "Invalid issue request"},
		{"bad tax kind", financeActions + "issueTaxInvoice", mergeInput(issue, erpwire.Row{"docType": "INV"}), "Invalid issue request"},
		{"future lock", financeActions + "updateFinanceLockDate", erpwire.Row{"expectedOrgId": testOrg, "lockDate": "2026-11-09"}, "Finance lock date cannot be in the future."},
		{"bad leap lock", financeActions + "updateFinanceLockDate", erpwire.Row{"expectedOrgId": testOrg, "lockDate": "2025-02-29"}, "Enter a valid lock date or leave it blank."},
		{"bad template", financeActions + "saveTaxInvoiceTemplate", erpwire.Row{"expectedOrgId": testOrg, "branch_code": "1234"}, "Phone and the copy label can be 40 characters. Branch code is blank or 5 digits."},
		{"empty allocation", financePath + "receipt-actions.ts::applyCustomerCredit", erpwire.Row{"clientId": testClient, "key": testKey, "allocations": []any{}}, "Select invoice allocation amounts."},
		{"duplicate allocation", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"allocations": []any{allocation, allocation}}), "Invalid or duplicate allocation"},
		{"over allocation", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"allocations": []any{erpwire.Row{"invoiceId": testInvoice, "amountSatang": 101}}}), "Allocations exceed receipt"},
		{"fraction allocation", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"allocations": []any{erpwire.Row{"invoiceId": testInvoice, "amountSatang": json.Number("0.5")}}}), "Invalid receipt details"},
		{"unsafe amount", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"amountBaht": "90071992547409.92"}), "Amount outside safe satang bounds"},
		{"zero amount", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"amountBaht": "0"}), "Enter a positive payment amount"},
		{"rounding forbidden", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"amountBaht": "1.005"}), "Enter a positive THB amount with up to two decimals"},
		{"numeric amount", financePath + "receipt-actions.ts::reportCustomerReceipt", mergeInput(report, erpwire.Row{"amountBaht": 1}), "Invalid receipt details"},
		{"credit quantity precision", financePath + "correction-actions.ts::issueCreditNote", erpwire.Row{"invoiceId": testInvoice, "key": testKey, "reason": "correction", "lines": []any{erpwire.Row{"mode": "quantity", "invoiceItemId": testPayment, "quantity": json.Number("0.0001")}}}, "Enter source lines, a positive quantity or amount, and a correction reason."},
		{"withholding not allowed", financeActions + "updateInvoiceWithholding", erpwire.Row{"invoiceId": testInvoice, "rateBps": 400}, "Invalid withholding rate"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newMemoryStore()
			s := testService(t, store)
			r, e := invoke(t, s, testActor(t, erpwire.Owner), tt.key, tt.input)
			value := actionValue(t, r, e)
			if value["error"] != tt.want {
				t.Fatalf("error=%#v want %q", value, tt.want)
			}
			if store.writeCount != 0 {
				t.Fatal("validation reached a write")
			}
		})
	}
}

func TestMemberCapabilityDenialAndAccountantAuthority(t *testing.T) {
	store := newMemoryStore()
	s := testService(t, store)
	member := testActor(t, erpwire.Member)
	for key, spec := range commandActions {
		t.Run(key, func(t *testing.T) {
			r, e := invoke(t, s, member, key, erpwire.Row{})
			if spec.denied != "" {
				if value := actionValue(t, r, e); value["error"] != spec.denied {
					t.Fatalf("denial %#v want %q", value, spec.denied)
				}
			} else if !errors.Is(e, erpwire.ErrForbidden) {
				t.Fatalf("denial = %#v %v", r, e)
			}
		})
	}
	if store.writeCount != 0 {
		t.Fatal("denied write reached store")
	}
	r, e := invoke(t, s, testActor(t, erpwire.Accountant), financeActions+"issueInvoice", erpwire.Row{"invoiceId": testInvoice, "key": testKey, "expectedVersion": 1})
	if value := actionValue(t, r, e); len(value) != 0 || len(store.commands) != 1 {
		t.Fatalf("accountant issue %#v calls=%d", value, len(store.commands))
	}
}

func TestDraftMutationTenantAndStateGuards(t *testing.T) {
	for _, tt := range []struct {
		name, org, state string
		snapshot         any
		want             string
	}{
		{"own draft", testOrg, "draft", nil, ""}, {"other tenant", otherOrg, "draft", nil, "Draft invoice unavailable"}, {"issued", testOrg, "sent", testKey, "Draft invoice unavailable"}, {"cancelled", testOrg, "cancelled", nil, "Draft invoice unavailable"}, {"snapshot draft", testOrg, "draft", testKey, "Draft invoice unavailable"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := newMemoryStore()
			store.rows["invoices"] = []erpwire.Row{{"org_id": tt.org, "id": testInvoice, "status": tt.state, "issued_snapshot_id": tt.snapshot, "amount_satang": int64(100)}}
			s := testService(t, store)
			r, e := invoke(t, s, testActor(t, erpwire.Owner), financeActions+"updateInvoice", erpwire.Row{"id": testInvoice, "client_id": testClient, "amountBaht": "0.01"})
			value := actionValue(t, r, e)
			if tt.want != "" {
				if value["error"] != tt.want {
					t.Fatalf("wrong error %#v", value)
				}
				if store.rows["invoices"][0]["amount_satang"] != int64(100) {
					t.Fatal("unavailable draft changed")
				}
			} else if len(value) != 0 || store.rows["invoices"][0]["amount_satang"] != int64(1) {
				t.Fatalf("draft update %#v %#v", value, store.rows)
			}
		})
	}
}

func TestDraftCreationNumberingAndMoneyBoundaries(t *testing.T) {
	for _, tt := range []struct {
		name, number, baht string
		valid              bool
		want               int64
	}{
		{"zero", "", "0", true, 0}, {"max", "customer reference", "90071992547409.91", true, int64(money.MaxSafeSatang)}, {"issued INV", "inv-2026-001", "1", false, 0}, {"issued TX", "TX-2026-000001", "1", false, 0}, {"issued ABB", "abb-2026-01", "1", false, 0}, {"unsafe", "", "90071992547409.92", false, 0}, {"three decimals", "", "1.001", false, 0}, {"negative", "", "-0.01", false, 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := newMemoryStore()
			s := testService(t, store)
			r, e := invoke(t, s, testActor(t, erpwire.Owner), financeActions+"createInvoice", erpwire.Row{"client_id": testClient, "number": tt.number, "amountBaht": tt.baht})
			value := actionValue(t, r, e)
			if !tt.valid {
				if value["error"] != "Invalid input" || store.writeCount != 0 {
					t.Fatalf("invalid create %#v", value)
				}
				return
			}
			rows := store.rows["invoices"]
			if len(rows) != 1 || rows[0]["amount_satang"] != tt.want || rows[0]["org_id"] != testOrg || rows[0]["status"] != "draft" {
				t.Fatalf("created %#v", rows)
			}
			if tt.number == "" && rows[0]["number"] != "DRAFT-"+text(rows[0]["id"]) {
				t.Fatalf("draft allocated wrong number %#v", rows[0])
			}
			if r.(erpwire.ActionResponse).Redirect != "/finance/invoices/"+text(rows[0]["id"]) {
				t.Fatal("wrong redirect")
			}
			if len(store.rows["audit_log"]) != 1 {
				t.Fatal("missing audit")
			}
		})
	}
}

type safeFailure string

func (e safeFailure) Error() string           { return "opaque database failure" }
func (e safeFailure) BusinessMessage() string { return string(e) }

func TestCommandRetriesKeepKeysAndPropagateBusinessRefusals(t *testing.T) {
	for _, tt := range []struct {
		key, command, message string
		input                 erpwire.Row
	}{
		{financeActions + "issueInvoice", "issue_invoice", "Invoice changed. Reload before issuing.", erpwire.Row{"invoiceId": testInvoice, "key": testKey, "expectedVersion": 1}},
		{financeActions + "cancelDraftInvoice", "cancel_draft_invoice", "Only draft invoices may be cancelled", erpwire.Row{"invoiceId": testInvoice}},
		{financeActions + "closeCompletedMonth", "close_completed_month", "That month is already closed.", erpwire.Row{"expectedOrgId": testOrg, "month": "2026-10"}},
	} {
		t.Run(tt.command, func(t *testing.T) {
			store := newMemoryStore()
			store.commandErrors[tt.command] = safeFailure(tt.message)
			s := testService(t, store)
			for i := 0; i < 2; i++ {
				r, e := invoke(t, s, testActor(t, erpwire.Owner), tt.key, tt.input)
				if value := actionValue(t, r, e); value["error"] != tt.message {
					t.Fatalf("lost authoritative refusal %#v", value)
				}
			}
			if len(store.commands) != 2 || !reflect.DeepEqual(store.commands[0], store.commands[1]) {
				t.Fatal("retry parameters changed")
			}
			if len(store.rows["payments"]) != 0 || len(store.rows["invoices"]) != 0 {
				t.Fatal("handler attempted local financial transition")
			}
		})
	}
}
