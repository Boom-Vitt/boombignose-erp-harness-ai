package erpinvoicing

import (
	"context"
	"encoding/json"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type commandSpec struct {
	command    string
	capability erpwire.Capability
	denied     string
	invalid    string
}

var commandActions = map[string]commandSpec{
	financeActions + "recordPayment":                                 {"submit_internal_payment_claim", "payment:verify", "Only owners and admins can report staff payment claims.", "Invalid payment report"},
	financeActions + "reconcileLegacyPayment":                        {"reconcile_legacy_payment_with_evidence", "payment:verify", "Only owners and admins can reconcile legacy receipts.", "Invalid reconciliation details"},
	financeActions + "reviewPaymentClaim":                            {"review_payment_claim_with_evidence", "payment:verify", "Only owners and admins can verify receipts.", "Invalid verification details"},
	financeActions + "issueInvoice":                                  {"issue_invoice", "payment:verify", "Only owners and admins can issue invoices.", "Invalid issue request"},
	financeActions + "issueTaxInvoice":                               {"issue_tax_invoice", "payment:verify", "Only owners and admins can issue invoices.", "Invalid issue request"},
	financeActions + "adoptLegacyInvoice":                            {"adopt_legacy_invoice", "payment:verify", "Only owners and admins can adopt legacy invoices.", "Enter a reason of 1 to 1000 characters and a valid invoice version and retry key."},
	financeActions + "updateBusinessProfile":                         {"update_tax_business_profile", "settings:manage", "Only owners and admins can update the business profile.", "Enter the legal business name, address and explicit tax status."},
	financeActions + "saveTaxInvoiceTemplate":                        {"save_tax_invoice_template", "settings:manage", "Only owners and admins can update the business profile.", "Phone and the copy label can be 40 characters. Branch code is blank or 5 digits."},
	financeActions + "cancelDraftInvoice":                            {"cancel_draft_invoice", "invoice:delete", "Only owners and admins can cancel drafts.", "Invalid invoice"},
	financeActions + "updateFinanceLockDate":                         {"propose_finance_lock", "settings:manage", "Only owners and admins can change the finance lock date.", "Enter a valid lock date or leave it blank."},
	financeActions + "confirmFinanceLockReopen":                      {"confirm_finance_lock_reopen", "settings:manage", "Only owners and admins can change the finance lock date.", "Invalid input"},
	financeActions + "cancelFinanceLockReopen":                       {"cancel_finance_lock_reopen", "settings:manage", "Only owners and admins can change the finance lock date.", "Invalid input"},
	financeActions + "closeCompletedMonth":                           {"close_completed_month", "settings:manage", "Only owners and admins can change the finance lock date.", "Enter a month as YYYY-MM."},
	financePath + "correction-actions.ts::issueCreditNote":           {"issue_credit_note", "payment:verify", "", "Enter source lines, a positive quantity or amount, and a correction reason."},
	financePath + "correction-actions.ts::reversePayment":            {"reverse_payment", "payment:verify", "", "Enter the reversal date and reason."},
	financePath + "correction-actions.ts::updatePaymentReviewPolicy": {"update_payment_review_policy", "settings:manage", "", "Workspace changed. Reload finance settings."},
	financePath + "receipt-actions.ts::reportCustomerReceipt":        {"submit_customer_payment_claim", "payment:verify", "", "Invalid receipt details"},
	financePath + "receipt-actions.ts::applyCustomerCredit":          {"apply_customer_credit", "payment:verify", "", "Select invoice allocation amounts."},
	financePath + "receipt-actions.ts::refundCustomerCredit":         {"refund_customer_credit", "payment:verify", "", "Enter refund amount, bank date, method and reference."},
}

func (s *Service) commandAction(spec commandSpec) erpwire.Operation {
	return func(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
		if v, e, ok := gate(a, spec.capability, spec.denied); !ok {
			return v, e
		}
		input, e := objectArgument(raw)
		if e != nil {
			return invalid(spec.invalid)
		}
		args, message := s.commandInput(a, spec, input)
		if message != "" {
			return invalid(message)
		}
		var result json.RawMessage
		e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { var e error; result, e = tx.Command(ctx, spec.command, args); return e })
		if e != nil {
			return failure(e)
		}
		value := erpwire.Row{}
		switch spec.command {
		case "issue_credit_note":
			var id any
			if erpwire.DecodeJSON(result, &id) != nil {
				return failure(erpwire.ErrBadArguments)
			}
			value["id"] = id
		case "propose_finance_lock":
			var r erpwire.Row
			if erpwire.DecodeJSON(result, &r) == nil && r["pending"] == true {
				value["pending"] = true
			}
		case "close_completed_month":
			var date string
			if erpwire.DecodeJSON(result, &date) == nil {
				value["lockDate"] = date
			}
		}
		return erpwire.ActionResponse{Value: value, Refresh: commandRefresh(spec.command, input)}, nil
	}
}

func isString(r erpwire.Row, key string) bool { _, ok := r[key].(string); return ok }
func stringBound(r erpwire.Row, key string, min, max int) bool {
	if !isString(r, key) {
		return false
	}
	n := textLength(trim(text(r[key])))
	return n >= min && n <= max
}
func optionalString(r erpwire.Row, key string) bool {
	_, exists := r[key]
	return !exists || isString(r, key)
}
func guid(r erpwire.Row, key string) bool { return isString(r, key) && validID(text(r[key])) }
func optionalGuid(r erpwire.Row, key string) bool {
	_, exists := r[key]
	return !exists || guid(r, key)
}
func number(r erpwire.Row, key string) (*big.Rat, bool) {
	n, ok := r[key].(json.Number)
	if !ok {
		return nil, false
	}
	coefficient, exponent, hasExponent := strings.Cut(strings.ToLower(string(n)), "e")
	negative := strings.HasPrefix(coefficient, "-")
	coefficient = strings.TrimPrefix(coefficient, "-")
	whole, fraction, _ := strings.Cut(coefficient, ".")
	digits := strings.TrimLeft(whole+fraction, "0")
	if digits == "" {
		return new(big.Rat), true
	}
	var power int64
	if hasExponent {
		var err error
		power, err = strconv.ParseInt(exponent, 10, 32)
		if err != nil {
			return nil, false
		}
	}
	trimmed := strings.TrimRight(digits, "0")
	power += int64(len(digits) - len(trimmed) - len(fraction))
	digits = trimmed
	// Inputs here are bounded integer fields or milliquantities; reject huge
	// exponents before math/big allocates their numerator or denominator.
	if len(digits) > 16 || power < -3 || power > 16 || int64(len(digits))+power > 16 {
		return nil, false
	}
	if negative {
		digits = "-" + digits
	}
	v, ok := new(big.Rat).SetString(digits + "e" + strconv.FormatInt(power, 10))
	return v, ok
}
func boundedInt(r erpwire.Row, key string, min, max int64) (int64, bool) {
	n, ok := number(r, key)
	if !ok || !n.IsInt() || !n.Num().IsInt64() {
		return 0, false
	}
	i := n.Num().Int64()
	return i, i >= min && i <= max
}
func boolean(r erpwire.Row, key string) (bool, bool) { b, ok := r[key].(bool); return b, ok }
func defaultBool(r erpwire.Row, key string, def bool) (bool, bool) {
	if _, exists := r[key]; !exists {
		return def, true
	}
	return boolean(r, key)
}
func defaultInt(r erpwire.Row, key string, min, max, def int64) (int64, bool) {
	if _, exists := r[key]; !exists {
		return def, true
	}
	return boundedInt(r, key, min, max)
}
func positiveMoney(r erpwire.Row, key string) (money.Satang, string) {
	if !isString(r, key) {
		return 0, "Enter a positive THB amount with up to two decimals"
	}
	v := trim(text(r[key]))
	if !bahtPattern.MatchString(v) {
		return 0, "Enter a positive THB amount with up to two decimals"
	}
	n, e := money.ParseBaht(v)
	if e != nil {
		return 0, "Amount outside safe satang bounds"
	}
	if n == 0 {
		return 0, "Enter a positive payment amount"
	}
	return n, ""
}

var bahtPattern = regexp.MustCompile(`^[0-9]+(\.[0-9]{1,2})?$`)

var paymentMethods = []string{"transfer", "cash", "card", "promptpay", "cheque", "other"}

func has(items []string, value string) bool {
	for _, v := range items {
		if v == value {
			return true
		}
	}
	return false
}
func (s *Service) evidence(r erpwire.Row) bool {
	return isString(r, "paidOn") && validDate(text(r["paidOn"])) && text(r["paidOn"]) <= s.today() && has(paymentMethods, text(r["method"]))
}

func allocations(r erpwire.Row) ([]erpwire.Row, bool) {
	items, ok := r["allocations"].([]any)
	if !ok {
		return nil, false
	}
	out := make([]erpwire.Row, 0, len(items))
	for _, v := range items {
		line := object(v)
		n, ok := boundedInt(line, "amountSatang", 1, int64(money.MaxSafeSatang))
		if !guid(line, "invoiceId") || !ok {
			return nil, false
		}
		out = append(out, erpwire.Row{"invoice_id": line["invoiceId"], "amount_satang": n})
	}
	return out, true
}

var monthPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}$`)
var taxIDPattern = regexp.MustCompile(`^[0-9]{13}$`)
var branchPattern = regexp.MustCompile(`^[0-9]{5}$`)

func (s *Service) commandInput(a erpwire.Actor, spec commandSpec, r erpwire.Row) (erpwire.Row, string) {
	args := erpwire.Row{"p_org_id": a.OrgID()}
	bad := func() (erpwire.Row, string) { return nil, spec.invalid }
	switch spec.command {
	case "submit_internal_payment_claim", "reconcile_legacy_payment_with_evidence", "review_payment_claim_with_evidence":
		if !strictUUID(text(r["key"])) || !isString(r, "amountBaht") || !stringBound(r, "reference", 3, 500) {
			return bad()
		}
		args["p_key"] = r["key"]
		args["p_reference"] = trim(text(r["reference"]))
		if spec.command == "review_payment_claim_with_evidence" {
			decision := text(r["decision"])
			if !guid(r, "claimId") || !optionalGuid(r, "invoiceId") || !has([]string{"verified", "rejected"}, decision) || decision == "verified" && !s.evidence(r) {
				return bad()
			}
			args["p_claim_id"] = r["claimId"]
			args["p_decision"] = decision
			args["p_paid_on"] = nil
			args["p_method"] = nil
			args["p_amount_satang"] = int64(0)
			if decision == "verified" {
				n, msg := positiveMoney(r, "amountBaht")
				if msg != "" {
					return nil, "Enter a valid positive THB amount"
				}
				args["p_amount_satang"] = int64(n)
				args["p_paid_on"] = r["paidOn"]
				args["p_method"] = r["method"]
			}
		} else {
			if !guid(r, "invoiceId") {
				return bad()
			}
			if spec.command == "reconcile_legacy_payment_with_evidence" && (!guid(r, "legacyPaymentId") || !s.evidence(r)) {
				return bad()
			}
			n, msg := positiveMoney(r, "amountBaht")
			if msg != "" {
				return nil, "Enter a valid positive THB amount with up to two decimals"
			}
			args["p_amount_satang"] = int64(n)
			if spec.command == "submit_internal_payment_claim" {
				args["p_invoice_id"] = r["invoiceId"]
			} else {
				args["p_legacy_payment_id"] = r["legacyPaymentId"]
				args["p_paid_on"] = r["paidOn"]
				args["p_method"] = r["method"]
			}
		}
	case "issue_invoice", "issue_tax_invoice", "adopt_legacy_invoice":
		version, ok := boundedInt(r, "expectedVersion", 1, 2147483647)
		if !guid(r, "invoiceId") || !strictUUID(text(r["key"])) || !ok {
			return bad()
		}
		args["p_invoice_id"] = r["invoiceId"]
		args["p_key"] = r["key"]
		args["p_expected_version"] = version
		if spec.command == "issue_tax_invoice" {
			if !has([]string{"TX", "ABB"}, text(r["docType"])) {
				return bad()
			}
			args["p_doc_type"] = r["docType"]
		}
		if spec.command == "adopt_legacy_invoice" {
			if !stringBound(r, "reason", 1, 1000) {
				return bad()
			}
			args["p_reason"] = trim(text(r["reason"]))
		}
	case "update_tax_business_profile":
		rate, rateOK := defaultInt(r, "vatRateBps", 0, 10000, 700)
		include, boolOK := defaultBool(r, "pricesIncludeVat", false)
		branch := ""
		if _, exists := r["branchLabel"]; exists {
			if !stringBound(r, "branchLabel", 0, 200) {
				return bad()
			}
			branch = trim(text(r["branchLabel"]))
		}
		if _, exists := r["vatRegistered"]; exists {
			if _, ok := boolean(r, "vatRegistered"); !ok {
				return bad()
			}
		}
		taxID := trim(text(r["taxId"]))
		taxStatus := text(r["taxStatus"])
		if !guid(r, "expectedOrgId") || !stringBound(r, "legalName", 1, 200) || !stringBound(r, "address", 1, 1000) || !rateOK || !boolOK || !isString(r, "taxId") || taxID != "" && !taxIDPattern.MatchString(taxID) || !has([]string{"unknown", "not_registered", "registered"}, taxStatus) || taxStatus == "registered" && !taxIDPattern.MatchString(taxID) {
			return bad()
		}
		if text(r["expectedOrgId"]) != a.OrgID() {
			return nil, "Workspace changed. Reload this form before saving the business profile."
		}
		args["p_legal_name"] = trim(text(r["legalName"]))
		args["p_business_address"] = trim(text(r["address"]))
		args["p_tax_id"] = taxID
		args["p_tax_status"] = taxStatus
		args["p_vat_rate_bps"] = rate
		args["p_prices_include_vat"] = include
		args["p_branch_label"] = branch
	case "save_tax_invoice_template":
		if !guid(r, "expectedOrgId") {
			return bad()
		}
		template := erpwire.Row{}
		for _, key := range []string{"seller_phone", "branch_code", "copy_label"} {
			v := ""
			if _, exists := r[key]; exists {
				if !isString(r, key) {
					return bad()
				}
				v = trim(text(r[key]))
			}
			if key == "branch_code" {
				if v != "" && !branchPattern.MatchString(v) {
					return bad()
				}
			} else if textLength(v) > 40 {
				return bad()
			}
			template[key] = v
		}
		if text(r["expectedOrgId"]) != a.OrgID() {
			return nil, "Workspace changed. Reload this form before saving."
		}
		args["p_template"] = template
	case "cancel_draft_invoice":
		if !guid(r, "invoiceId") {
			return bad()
		}
		args["p_invoice_id"] = r["invoiceId"]
	case "propose_finance_lock":
		if !guid(r, "expectedOrgId") || !isString(r, "lockDate") || text(r["lockDate"]) != "" && !validDate(text(r["lockDate"])) || !optionalString(r, "reason") || textLength(text(r["reason"])) > 200 {
			return bad()
		}
		if text(r["expectedOrgId"]) != a.OrgID() {
			return nil, "Workspace changed. Reload before saving."
		}
		date := text(r["lockDate"])
		if date != "" && !financeCalendar(date) {
			return nil, "Enter a valid lock date or leave it blank."
		}
		if date > s.today() {
			return nil, "Finance lock date cannot be in the future."
		}
		args["p_lock_date"] = nilText(date)
		args["p_reason"] = nilText(trim(text(r["reason"])))
	case "confirm_finance_lock_reopen", "cancel_finance_lock_reopen":
		if text(r["expectedOrgId"]) != a.OrgID() {
			return nil, "Workspace changed. Reload before saving."
		}
		if !isString(r, "requestId") {
			return bad()
		}
		args["p_request_id"] = r["requestId"]
	case "close_completed_month":
		if !guid(r, "expectedOrgId") || !monthPattern.MatchString(text(r["month"])) {
			return bad()
		}
		if text(r["expectedOrgId"]) != a.OrgID() {
			return nil, "Workspace changed. Reload before saving."
		}
		args["p_month"] = r["month"]
	case "issue_credit_note":
		if !guid(r, "invoiceId") || !guid(r, "key") || !stringBound(r, "reason", 3, 1000) {
			return bad()
		}
		items, ok := r["lines"].([]any)
		if !ok || len(items) == 0 {
			return bad()
		}
		lines := make([]erpwire.Row, 0, len(items))
		for _, v := range items {
			line := object(v)
			out := erpwire.Row{}
			switch text(line["mode"]) {
			case "quantity":
				n, ok := number(line, "quantity")
				if !guid(line, "invoiceItemId") || !ok || n.Sign() <= 0 || n.Cmp(big.NewRat(999999999999, 1000)) > 0 || !new(big.Rat).Mul(n, big.NewRat(1000, 1)).IsInt() {
					return bad()
				}
				out["invoice_item_id"] = line["invoiceItemId"]
				out["quantity"] = line["quantity"]
			case "amount":
				n, ok := boundedInt(line, "amountSatang", 1, int64(money.MaxSafeSatang))
				if !ok || !optionalGuid(line, "invoiceItemId") {
					return bad()
				}
				out["amount_satang"] = n
				if _, exists := line["invoiceItemId"]; exists {
					out["invoice_item_id"] = line["invoiceItemId"]
				}
			default:
				return bad()
			}
			lines = append(lines, out)
		}
		args["p_invoice_id"] = r["invoiceId"]
		args["p_key"] = r["key"]
		args["p_reason"] = trim(text(r["reason"]))
		args["p_lines"] = lines
	case "reverse_payment":
		if !guid(r, "paymentId") || !guid(r, "key") || !optionalGuid(r, "invoiceId") || !stringBound(r, "reason", 3, 1000) || !validDate(text(r["reversedOn"])) {
			return bad()
		}
		args["p_payment_id"] = r["paymentId"]
		args["p_key"] = r["key"]
		args["p_reason"] = trim(text(r["reason"]))
		args["p_reversed_on"] = r["reversedOn"]
	case "update_payment_review_policy":
		required, ok := boolean(r, "required")
		if !guid(r, "expectedOrgId") || !ok || text(r["expectedOrgId"]) != a.OrgID() {
			return bad()
		}
		args["p_required"] = required
	case "submit_customer_payment_claim", "apply_customer_credit":
		lines, ok := allocations(r)
		if !guid(r, "clientId") || !guid(r, "key") || !ok || spec.command == "apply_customer_credit" && len(lines) == 0 {
			return bad()
		}
		args["p_client_id"] = r["clientId"]
		args["p_key"] = r["key"]
		args["p_allocations"] = lines
		if spec.command == "submit_customer_payment_claim" {
			if !isString(r, "amountBaht") || !stringBound(r, "reference", 1, 500) {
				return bad()
			}
			n, msg := positiveMoney(r, "amountBaht")
			if msg != "" {
				return nil, msg
			}
			seen := map[string]bool{}
			total := new(big.Int)
			for _, line := range lines {
				id := text(line["invoice_id"])
				if seen[id] {
					return nil, "Invalid or duplicate allocation"
				}
				seen[id] = true
				total.Add(total, big.NewInt(line["amount_satang"].(int64)))
			}
			if total.Cmp(big.NewInt(int64(n))) > 0 {
				return nil, "Allocations exceed receipt"
			}
			args["p_amount_satang"] = int64(n)
			args["p_reference"] = trim(text(r["reference"]))
		}
	case "refund_customer_credit":
		if !guid(r, "paymentId") || !guid(r, "key") || !isString(r, "amountBaht") || !stringBound(r, "reference", 3, 500) || !validDate(text(r["paidOn"])) || !has(paymentMethods, text(r["method"])) {
			return bad()
		}
		n, msg := positiveMoney(r, "amountBaht")
		if msg != "" {
			return nil, "Invalid refund amount"
		}
		args["p_payment_id"] = r["paymentId"]
		args["p_key"] = r["key"]
		args["p_amount_satang"] = int64(n)
		args["p_reference"] = trim(text(r["reference"]))
		args["p_paid_on"] = r["paidOn"]
		args["p_method"] = r["method"]
	default:
		return bad()
	}
	return args, ""
}

func commandRefresh(command string, r erpwire.Row) []string {
	invoice := "/finance/invoices/" + text(r["invoiceId"])
	switch command {
	case "submit_internal_payment_claim", "reconcile_legacy_payment_with_evidence", "issue_invoice", "issue_tax_invoice", "adopt_legacy_invoice", "cancel_draft_invoice":
		return []string{"/finance", invoice}
	case "review_payment_claim_with_evidence", "reverse_payment":
		paths := []string{"/finance"}
		if text(r["invoiceId"]) != "" {
			paths = append(paths, invoice)
		}
		paths = append(paths, "/finance/receipts")
		if command == "reverse_payment" {
			paths = append(paths, "/clients")
		}
		return paths
	case "issue_credit_note":
		return []string{"/finance", invoice, "/clients"}
	case "update_tax_business_profile", "save_tax_invoice_template":
		return []string{"/finance/business-profile"}
	case "propose_finance_lock":
		return []string{"/settings", "/settings/finance", "/audit", "/audit/close"}
	case "confirm_finance_lock_reopen", "cancel_finance_lock_reopen":
		return []string{"/settings/finance", "/audit/close"}
	case "close_completed_month":
		return []string{"/settings", "/settings/finance", "/reports", "/audit"}
	case "update_payment_review_policy":
		return []string{"/settings/finance"}
	case "submit_customer_payment_claim":
		return []string{"/finance/receipts"}
	case "apply_customer_credit":
		return []string{"/finance", "/finance/receipts", "/clients/" + text(r["clientId"])}
	case "refund_customer_credit":
		return []string{"/finance", "/finance/receipts"}
	}
	return nil
}

var issuedNumberPattern = regexp.MustCompile(`(?i)^(INV|TX|ABB)-[0-9]{4}-[0-9]+$`)
var recurringIntervals = []string{"weekly", "monthly", "quarterly", "yearly"}
var costCategories = []string{"software", "contractor", "infra", "marketing", "salary", "other"}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		mantissa, _, _ := strings.Cut(strings.ToLower(string(x)), "e")
		return strings.ContainsAny(mantissa, "123456789")
	default:
		return true
	}
}

func invoiceColumns(r erpwire.Row, update bool) (erpwire.Row, bool) {
	if !isString(r, "client_id") || textLength(text(r["client_id"])) < 1 || update && (!isString(r, "id") || text(r["id"]) == "") {
		return nil, false
	}
	for _, key := range []string{"project_id", "number", "issue_date", "due_date", "notes"} {
		if !optionalString(r, key) {
			return nil, false
		}
	}
	if !isString(r, "amountBaht") || !bahtPattern.MatchString(trim(text(r["amountBaht"]))) || issuedNumberPattern.MatchString(trim(text(r["number"]))) {
		return nil, false
	}
	n, e := money.ParseBaht(trim(text(r["amountBaht"])))
	if e != nil {
		return nil, false
	}
	interval := r["recurring_interval"]
	if interval != nil && !has(recurringIntervals, text(interval)) {
		return nil, false
	}
	cols := erpwire.Row{"client_id": r["client_id"], "project_id": nilText(text(r["project_id"])), "due_date": nilText(text(r["due_date"])), "amount_satang": int64(n), "is_recurring": truthy(r["is_recurring"]), "recurring_interval": nil}
	if cols["is_recurring"] == true {
		cols["recurring_interval"] = interval
	}
	if number := trim(text(r["number"])); number != "" {
		cols["number"] = number
	}
	if date := text(r["issue_date"]); date != "" {
		cols["issue_date"] = date
	}
	if notes := trim(text(r["notes"])); notes != "" {
		cols["notes"] = notes
	}
	return cols, true
}
