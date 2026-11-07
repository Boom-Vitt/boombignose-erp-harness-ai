package erpinvoicing

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var invoiceStatuses = []string{"draft", "sent", "partially_paid", "paid", "overdue", "cancelled"}

func includes(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func financeFacets(params erpwire.Row) erpwire.Row {
	out := erpwire.Row{}
	get := func(key string) string { return trim(text(params[key])) }
	if q := get("q"); q != "" {
		units := utf16.Encode([]rune(q))
		if len(units) > 200 {
			q = string(utf16.Decode(units[:200]))
		}
		out["q"] = q
	}
	picked := strings.Split(get("status"), ",")
	for i := range picked {
		picked[i] = trim(picked[i])
	}
	selected := []string{}
	for _, candidate := range invoiceStatuses {
		if includes(picked, candidate) {
			selected = append(selected, candidate)
		}
	}
	if len(selected) > 0 {
		out["status"] = strings.Join(selected, ",")
	}
	if p := get("period"); includes([]string{"this_month", "last_month", "this_quarter", "this_year"}, p) {
		out["period"] = p
	}
	if get("mine") == "1" {
		out["mine"] = "1"
	}
	if group := get("groupBy"); includes([]string{"status", "client", "month"}, group) {
		out["groupBy"] = group
	}
	return out
}

func financeInPeriod(date, period string, now time.Time) bool {
	date = dateOnly(date)
	if date == "" {
		return false
	}
	now = now.In(time.FixedZone("Asia/Bangkok", 7*3600))
	year, month, _ := now.Date()
	startMonth, length := int(month), 1
	switch period {
	case "last_month":
		startMonth--
	case "this_quarter":
		startMonth = (startMonth-1)/3*3 + 1
		length = 3
	case "this_year":
		startMonth = 1
		length = 12
	}
	start := time.Date(year, time.Month(startMonth), 1, 0, 0, 0, 0, time.UTC)
	return date >= start.Format("2006-01-02") && date < start.AddDate(0, length, 0).Format("2006-01-02")
}

func financeMatches(config, invoice erpwire.Row, user string, now time.Time) bool {
	client := object(invoice["clients"])
	haystack := text(invoice["number"]) + " " + text(invoice["displayNumber"]) + " " + text(client["name"])
	if q := text(config["q"]); q != "" && !strings.Contains(strings.ToLower(haystack), strings.ToLower(q)) {
		return false
	}
	if selected := text(config["status"]); selected != "" && !includes(strings.Split(selected, ","), text(invoice["effectiveStatus"])) {
		return false
	}
	if period := text(config["period"]); period != "" && !financeInPeriod(text(invoice["issue_date"]), period, now) {
		return false
	}
	return text(config["mine"]) != "1" || text(client["owner"]) == user
}

func financeGroups(rows []erpwire.Row, groupBy string) ([]erpwire.Row, error) {
	groups := []erpwire.Row{}
	positions := map[string]int{}
	for _, row := range rows {
		key, label := "all", ""
		switch groupBy {
		case "client":
			key = text(row["client_id"])
			label = text(object(row["clients"])["name"])
			if label == "" {
				label = "Unassigned"
			}
		case "status":
			key = text(row["effectiveStatus"])
			label = financeLabel(key)
		case "month":
			key = dateOnly(text(row["issue_date"]))
			if len(key) >= 7 {
				key = key[:7]
			}
			label = key
			if label == "" {
				label = "No date"
			}
		}
		at, ok := positions[key]
		if !ok {
			at = len(groups)
			positions[key] = at
			groups = append(groups, erpwire.Row{"key": key, "label": label, "rows": []erpwire.Row{}, "totalSatang": money.Satang(0)})
		}
		groups[at]["rows"] = append(groups[at]["rows"].([]erpwire.Row), row)
		value, e := amount(row["amount_satang"])
		if e != nil {
			return nil, e
		}
		total, e := sum(groups[at]["totalSatang"].(money.Satang), value)
		if e != nil {
			return nil, e
		}
		groups[at]["totalSatang"] = total
	}
	return groups, nil
}

func financeLabel(s string) string {
	words := strings.Split(s, "_")
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

var financeBranchPattern = regexp.MustCompile(`^(?:|[0-9]{5})$`)
var financeTaxIDPattern = regexp.MustCompile(`^[0-9]{13}$`)

func financeTemplate(value any) erpwire.Row {
	row := object(value)
	out := erpwire.Row{"seller_phone": "", "branch_code": "", "copy_label": ""}
	if value != nil && row == nil {
		return out
	}
	for _, key := range []string{"seller_phone", "branch_code", "copy_label"} {
		v, exists := row[key]
		if !exists {
			continue
		}
		s, ok := v.(string)
		if !ok {
			return erpwire.Row{"seller_phone": "", "branch_code": "", "copy_label": ""}
		}
		s = trim(s)
		if key == "branch_code" {
			if !financeBranchPattern.MatchString(s) {
				return erpwire.Row{"seller_phone": "", "branch_code": "", "copy_label": ""}
			}
		} else if len(utf16.Encode([]rune(s))) > 40 {
			return erpwire.Row{"seller_phone": "", "branch_code": "", "copy_label": ""}
		}
		out[key] = s
	}
	return out
}
func financeTaxChecklist(initial, template erpwire.Row) []erpwire.Row {
	const note = "Saving this issues nothing. It is copied into a snapshot only when the invoice is issued as TX or ABB."
	present := func(value string) string {
		if trim(value) != "" {
			return "present"
		}
		return "missing"
	}
	item := func(id, label, state, detail string) erpwire.Row {
		return erpwire.Row{"id": id, "label": label, "state": state, "detail": detail}
	}
	taxOK := financeTaxIDPattern.MatchString(trim(text(initial["taxId"])))
	taxState, taxDetail := "missing", "A 13-digit tax ID is blank or incomplete here."
	if taxOK {
		taxState, taxDetail = "present", "13 digits are stored on the profile."
	}
	branchState := "missing"
	if len(text(template["branch_code"])) == 5 && financeBranchPattern.MatchString(text(template["branch_code"])) {
		branchState = "present"
	}
	out := []erpwire.Row{
		item("seller-name", "Seller name", present(text(initial["legalName"])), "Statutory tax invoices name the seller."),
		item("seller-address", "Seller address", present(text(initial["address"])), "Statutory tax invoices show the seller address."),
		item("seller-tax-id", "Seller tax ID", taxState, taxDetail),
		item("seller-branch", "Seller branch", present(text(initial["branchLabel"])), "Branch text such as สำนักงานใหญ่. A blank branch is not a five-digit branch code."),
		item("seller-phone", "Seller phone", present(text(template["seller_phone"])), "Optional. "+note),
		item("branch-code", "Branch code", branchState, "Required to issue TX or ABB: five digits, 00000 for head office. "+note),
		item("copy-label", "Original or copy label", present(text(template["copy_label"])), "Optional label for the issued original, default ต้นฉบับ. A reprint of an issued TX or ABB says สำเนา. "+note),
	}
	for _, pair := range [][2]string{{"buyer-name", "Buyer name"}, {"buyer-address", "Buyer address"}, {"buyer-tax-id", "Buyer tax ID"}, {"number", "Document number"}, {"date", "Issue date"}, {"lines", "Lines with quantity and price"}, {"currency", "THB amounts"}} {
		out = append(out, item(pair[0], pair[1], "per_document", "Taken from each issued invoice snapshot. This page does not inspect one invoice."))
	}
	out = append(out, item("series", "Tax-invoice number series (TX / ABB)", "per_document", "Issue as TX (full) or ABB (abbreviated) to take a number from its own series, TX-YYYY-000001 and ABB-YYYY-000001. A refused or failed issue does not use a number. The operational INV series is separate."))
	vatDetail := "VAT is calculated only when the profile is registered. An unregistered profile does not produce a tax invoice."
	if text(initial["taxStatus"]) == "registered" {
		vatDetail = "Registered profiles calculate VAT on the document. That calculation is not an e-Tax Invoice."
	}
	out = append(out, item("vat", "VAT", "per_document", vatDetail))
	if text(initial["taxStatus"]) != "registered" {
		out = append(out, item("registration", "VAT registration", "gap", "The profile is not registered for VAT, so these documents are not tax invoices."))
	}
	return append(out,
		item("statutory-name", "Calling the document a statutory ใบกำกับภาษี", "gap", "Only a document issued as TX or ABB is labelled ใบกำกับภาษี. A plain issue stays an operational invoice. Whether it meets the Revenue Code is for your accountant."),
		item("etax", "e-Tax Invoice submission", "gap", "Nothing is sent to the Revenue Department."),
		item("signature", "Authorized signature as a legal control", "gap", "No signature is captured or checked."),
		item("cash-credit", "Cash or credit classification", "gap", "The document does not classify the sale as cash or credit."),
		item("original-copy", "Original or copy as a legal control", "gap", "The issued snapshot says original and a reprint says copy. Print count and who holds the original are not controlled."))
}
