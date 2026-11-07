package erpinsight

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

type reportLine struct {
	Kind      string  `json:"kind"`
	ID        string  `json:"id"`
	Number    string  `json:"number"`
	Date      string  `json:"date"`
	PartyKind string  `json:"partyKind"`
	PartyName string  `json:"partyName"`
	TaxID     *string `json:"taxId"`
	Base      int64   `json:"baseSatang"`
	VAT       int64   `json:"vatSatang"`
	WHT       int64   `json:"whtSatang"`
	Note      string  `json:"note"`
}
type reportParty struct {
	Kind  string  `json:"partyKind"`
	ID    string  `json:"partyId"`
	Name  string  `json:"partyName"`
	TaxID *string `json:"taxId"`
	Base  int64   `json:"baseSatang"`
	WHT   int64   `json:"whtSatang"`
	Count int     `json:"documentCount"`
}
type reportPurchaseWHT struct {
	ID     string  `json:"id"`
	CostID string  `json:"costId"`
	Number string  `json:"certificateNo"`
	PaidOn string  `json:"paidOn"`
	Form   string  `json:"form"`
	Income string  `json:"incomeType"`
	Rate   int64   `json:"rateBps"`
	Name   string  `json:"vendorName"`
	TaxID  *string `json:"vendorTaxId"`
	Base   int64   `json:"baseSatang"`
	WHT    int64   `json:"whtSatang"`
}
type reportPack struct {
	OrgName       string              `json:"orgName"`
	Month         string              `json:"month"`
	BuddhistMonth string              `json:"buddhistMonth"`
	Output        []reportLine        `json:"outputLines"`
	Input         []reportLine        `json:"inputLines"`
	OutputBase    int64               `json:"outputBaseSatang"`
	OutputVAT     int64               `json:"outputVatSatang"`
	OutputWHT     int64               `json:"outputWhtSatang"`
	InputBase     int64               `json:"inputBaseSatang"`
	InputVAT      int64               `json:"inputVatSatang"`
	Difference    int64               `json:"outputMinusInputVatSatang"`
	Parties       []reportParty       `json:"whtParties"`
	WHT           int64               `json:"whtSatang"`
	Purchase      []reportPurchaseWHT `json:"purchaseWht"`
	PurchaseWHT   int64               `json:"purchaseWhtSatang"`
}
type reportPackLoad struct {
	OK      bool        `json:"ok"`
	Pack    *reportPack `json:"pack,omitempty"`
	Status  int         `json:"status,omitempty"`
	Message string      `json:"message,omitempty"`
}

var reportZone = time.FixedZone("Asia/Bangkok", 7*3600)
var reportUnavailable = errors.New("Accountant pack unavailable. Reload before relying on totals.")

func reportMonth(value string) (time.Time, bool) {
	date, err := time.Parse("2006-01", value)
	// Date.UTC in the source rejects the JavaScript 0..99 year remapping.
	return date, err == nil && len(value) == 7 && date.Year() >= 100
}
func reportNumber(value any, label string, nonnegative bool) (int64, error) {
	_, isString := value.(string)
	n, ok := auditExactInteger(value)
	if !ok || isString || n < -erpwire.MaxSafeInteger || n > erpwire.MaxSafeInteger {
		return 0, errors.New(label + " is not integer satang")
	}
	if nonnegative && n < 0 {
		return 0, errors.New(label + " cannot be negative")
	}
	return n, nil
}
func reportSum(values ...int64) (int64, error) {
	var sum int64
	for _, n := range values {
		if n < -erpwire.MaxSafeInteger || n > erpwire.MaxSafeInteger || sum+n < -erpwire.MaxSafeInteger || sum+n > erpwire.MaxSafeInteger {
			return 0, errors.New("Unsafe integer-satang sum")
		}
		sum += n
	}
	return sum, nil
}
func reportDefaultNumber(v any) any {
	if v == nil {
		return int64(0)
	}
	return v
}
func reportNonempty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
func reportNullable(v any) *string {
	x := trimText(text(v))
	if x == "" {
		return nil
	}
	return &x
}
func reportObject(v any) erpwire.Row {
	switch x := v.(type) {
	case erpwire.Row:
		return x
	case map[string]any:
		return erpwire.Row(x)
	case []any:
		if len(x) > 0 {
			return reportObject(x[0])
		}
	case []erpwire.Row:
		if len(x) > 0 {
			return x[0]
		}
	}
	return nil
}
func reportPartyInfo(v any) (string, *string) {
	row := reportObject(v)
	return reportNonempty(trimText(text(row["name"])), "Unassigned customer"), reportNullable(row["tax_id"])
}
func reportInSpan(date, from, to string) bool { return date != "" && date >= from && date < to }
func reportSafeError(err error) bool {
	for _, candidate := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, context.Canceled, context.DeadlineExceeded} {
		if errors.Is(err, candidate) {
			return true
		}
	}
	return false
}
func (s *Service) loadReportPack(ctx context.Context, a erpwire.Actor, month string) (reportPackLoad, error) {
	if err := authorize(a, ""); err != nil {
		return reportPackLoad{}, err
	}
	if !erpwire.Can(a.Role(), "audit:view") {
		return reportPackLoad{Status: 403, Message: "Only an owner, an admin, or an accountant can download this pack."}, nil
	}
	start, ok := reportMonth(month)
	if !ok {
		return reportPackLoad{Status: 400, Message: "Choose a month as YYYY-MM."}, nil
	}
	var pack reportPack
	var domainErr error
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		pack, err = readReportPack(ctx, tx, a, month, start.Format("2006-01-02"), start.AddDate(0, 1, 0).Format("2006-01-02"))
		domainErr = err
		return err
	})
	if err != nil {
		if reportSafeError(err) {
			return reportPackLoad{}, err
		}
		message := reportUnavailable.Error()
		if domainErr != nil && errors.Is(err, domainErr) {
			message = domainErr.Error()
		}
		return reportPackLoad{Status: 503, Message: message}, nil
	}
	return reportPackLoad{OK: true, Pack: &pack}, nil
}
func readReportPack(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, month, from, to string) (reportPack, error) {
	pack := reportPack{OrgName: a.OrgName(), Month: month, Output: []reportLine{}, Input: []reportLine{}, Parties: []reportParty{}, Purchase: []reportPurchaseWHT{}}
	start, _ := reportMonth(month)
	pack.BuddhistMonth = fmt.Sprintf("%02d/%d", int(start.Month()), start.Year()+543)
	span := func(column string) []erpwire.Predicate {
		return []erpwire.Predicate{{Column: column, Op: erpwire.GreaterEqual, Value: from}, {Column: column, Op: erpwire.Less, Value: to}}
	}
	load := func(table string, columns []string, where ...erpwire.Predicate) ([]erpwire.Row, error) {
		q := selection(a, table, columns, where...)
		rows, err := all(ctx, tx, q)
		if err != nil {
			return nil, reportReadError(err)
		}
		return rows, nil
	}
	invoiceQ := selection(a, "invoices", []string{"id", "number", "status", "issue_date", "client_id", "total_satang", "vat_satang", "wht_satang"}, span("issue_date")...)
	invoiceQ.Relations = []erpwire.Relation{{Name: "clients", Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: []string{"name", "tax_id"}}}
	invoices, err := all(ctx, tx, invoiceQ)
	if err != nil {
		return pack, reportReadError(err)
	}
	credits, err := load("credit_notes", []string{"id", "number", "issue_date", "invoice_id", "snapshot"}, span("issue_date")...)
	if err != nil {
		return pack, err
	}
	costWhere := append(span("bill_date"), erpwire.Predicate{Column: "vendor_bill_match_id", Op: erpwire.NotEqual, Value: nil})
	costs, err := load("costs", []string{"id", "bill_date", "vendor_id", "vendor", "vendor_invoice_reference", "purchase_cost_kind", "amount_satang", "input_vat_satang", "vendor_bill_match_id"}, costWhere...)
	if err != nil {
		return pack, err
	}
	vatQ := selection(a, "monthly_purchase_vat", []string{"month", "base_satang", "input_vat_satang"}, eq("month", from))
	vatQ.Order = []erpwire.Order{{Column: "month"}}
	vatRows, err := all(ctx, tx, vatQ)
	if err != nil {
		return pack, reportReadError(err)
	}
	withholdings, err := load("purchase_withholdings", []string{"id", "cost_id", "certificate_no", "paid_on", "form", "income_type", "rate_bps", "base_satang", "wht_satang"}, span("paid_on")...)
	if err != nil {
		return pack, err
	}
	known := map[string]erpwire.Row{}
	for _, row := range invoices {
		known[text(row["id"])] = row
	}
	missing := []string{}
	seen := map[string]bool{}
	for _, row := range credits {
		id := text(row["invoice_id"])
		if known[id] == nil && !seen[id] {
			missing = append(missing, id)
			seen[id] = true
		}
	}
	for offset := 0; offset < len(missing); offset += 100 {
		end := offset + 100
		if end > len(missing) {
			end = len(missing)
		}
		q := selection(a, "invoices", []string{"id", "client_id"}, erpwire.Predicate{Column: "id", Op: erpwire.In, Value: missing[offset:end]})
		q.Relations = invoiceQ.Relations
		rows, e := all(ctx, tx, q)
		if e != nil {
			return pack, reportReadError(e)
		}
		for _, row := range rows {
			known[text(row["id"])] = row
		}
	}
	vendors := map[string]erpwire.Row{}
	loadVendors := func(ids []string) error {
		if len(ids) == 0 {
			return nil
		}
		rows, e := load("vendors", []string{"id", "name", "tax_id"}, erpwire.Predicate{Column: "id", Op: erpwire.In, Value: ids})
		if e != nil {
			return e
		}
		for _, row := range rows {
			vendors[text(row["id"])] = row
		}
		return nil
	}
	vendorIDs := []string{}
	for _, row := range costs {
		if id := text(row["vendor_id"]); id != "" {
			vendorIDs = append(vendorIDs, id)
		}
	}
	if err := loadVendors(vendorIDs); err != nil {
		return pack, err
	}
	parties := map[string]*reportParty{}
	partyOrder := []string{}
	addParty := func(id, name string, tax *string, base, wht int64) error {
		if wht == 0 {
			return nil
		}
		key := reportNonempty(id, name, "unassigned")
		p := parties[key]
		if p == nil {
			p = &reportParty{Kind: "customer", ID: key, Name: reportNonempty(name, "Unassigned customer"), TaxID: tax}
			parties[key] = p
			partyOrder = append(partyOrder, key)
		}
		var e error
		p.Base, e = reportSum(p.Base, base)
		if e != nil {
			return e
		}
		p.WHT, e = reportSum(p.WHT, wht)
		p.Count++
		return e
	}
	for _, row := range invoices {
		status := text(row["status"])
		if status == "draft" || status == "cancelled" || !reportInSpan(text(row["issue_date"]), from, to) {
			continue
		}
		total, e := reportNumber(reportDefaultNumber(row["total_satang"]), "Invoice total", true)
		if e != nil {
			return pack, e
		}
		vat, e := reportNumber(reportDefaultNumber(row["vat_satang"]), "Invoice VAT", true)
		if e != nil {
			return pack, e
		}
		wht, e := reportNumber(reportDefaultNumber(row["wht_satang"]), "Invoice withholding", true)
		if e != nil {
			return pack, e
		}
		base, e := reportSum(total, -vat)
		if e != nil {
			return pack, e
		}
		name, tax := reportPartyInfo(row["clients"])
		line := reportLine{Kind: "invoice", ID: text(row["id"]), Number: reportNonempty(text(row["number"]), text(row["id"])), Date: text(row["issue_date"]), PartyKind: "customer", PartyName: name, TaxID: tax, Base: base, VAT: vat, WHT: wht, Note: "Issued invoice"}
		pack.Output = append(pack.Output, line)
		if e = addParty(text(row["client_id"]), name, tax, base, wht); e != nil {
			return pack, e
		}
	}
	for _, row := range credits {
		if !reportInSpan(text(row["issue_date"]), from, to) {
			continue
		}
		invoice := known[text(row["invoice_id"])]
		if invoice == nil {
			return pack, fmt.Errorf("Credit note %s is missing its invoice in this workspace", text(row["number"]))
		}
		stored, e := readReportCredit(row["snapshot"])
		if e != nil {
			return pack, e
		}
		name, tax := reportPartyInfo(invoice["clients"])
		stored.Kind = "credit_note"
		stored.ID = text(row["id"])
		stored.Number = reportNonempty(text(row["number"]), stored.ID)
		stored.Date = text(row["issue_date"])
		stored.PartyKind = "customer"
		if stored.TaxID == nil {
			stored.TaxID = tax
		}
		pack.Output = append(pack.Output, stored)
		if e = addParty(text(invoice["client_id"]), name, tax, stored.Base, stored.WHT); e != nil {
			return pack, e
		}
	}
	for _, row := range costs {
		if row["vendor_bill_match_id"] == nil || !reportInSpan(text(row["bill_date"]), from, to) {
			continue
		}
		amount, e := reportNumber(row["amount_satang"], "Vendor bill total", false)
		if e != nil {
			return pack, e
		}
		vat, e := reportNumber(row["input_vat_satang"], "Input VAT", false)
		if e != nil {
			return pack, e
		}
		base, e := reportSum(amount, -vat)
		if e != nil {
			return pack, e
		}
		vendor := vendors[text(row["vendor_id"])]
		kind := map[string]string{"bill": "vendor_bill", "credit": "vendor_credit", "return_adjustment": "return_adjustment"}[text(row["purchase_cost_kind"])]
		kind = reportNonempty(kind, "matched_cost")
		pack.Input = append(pack.Input, reportLine{Kind: kind, ID: text(row["id"]), Number: reportNonempty(trimText(text(row["vendor_invoice_reference"])), text(row["id"])), Date: text(row["bill_date"]), PartyKind: "vendor", PartyName: reportNonempty(text(vendor["name"]), trimText(text(row["vendor"])), "Unassigned vendor"), TaxID: reportNullable(vendor["tax_id"]), Base: base, VAT: vat, Note: "Matched vendor bill on the purchase VAT table"})
	}
	for _, line := range pack.Output {
		pack.OutputBase, err = reportSum(pack.OutputBase, line.Base)
		if err != nil {
			return pack, err
		}
		pack.OutputVAT, err = reportSum(pack.OutputVAT, line.VAT)
		if err != nil {
			return pack, err
		}
		pack.OutputWHT, err = reportSum(pack.OutputWHT, line.WHT)
		if err != nil {
			return pack, err
		}
	}
	for _, line := range pack.Input {
		pack.InputBase, err = reportSum(pack.InputBase, line.Base)
		if err != nil {
			return pack, err
		}
		pack.InputVAT, err = reportSum(pack.InputVAT, line.VAT)
		if err != nil {
			return pack, err
		}
	}
	var tableBase, tableVAT int64
	for _, row := range vatRows {
		if !strings.HasPrefix(text(row["month"]), month) {
			continue
		}
		base, e := reportNumber(row["base_satang"], "Purchase VAT base", false)
		if e != nil {
			return pack, e
		}
		vat, e := reportNumber(row["input_vat_satang"], "Purchase VAT", false)
		if e != nil {
			return pack, e
		}
		tableBase, e = reportSum(tableBase, base)
		if e != nil {
			return pack, e
		}
		tableVAT, e = reportSum(tableVAT, vat)
		if e != nil {
			return pack, e
		}
	}
	if tableBase != pack.InputBase || tableVAT != pack.InputVAT {
		return pack, errors.New("Matched vendor bills do not match the purchase VAT table for this month")
	}
	for _, key := range partyOrder {
		party := parties[key]
		pack.Parties = append(pack.Parties, *party)
		pack.WHT, err = reportSum(pack.WHT, party.WHT)
		if err != nil {
			return pack, err
		}
	}
	payees := map[string]erpwire.Row{}
	costIDs := []string{}
	for _, row := range withholdings {
		costIDs = append(costIDs, text(row["cost_id"]))
	}
	for offset := 0; offset < len(costIDs); offset += 100 {
		end := offset + 100
		if end > len(costIDs) {
			end = len(costIDs)
		}
		rows, e := load("costs", []string{"id", "vendor", "vendor_id"}, erpwire.Predicate{Column: "id", Op: erpwire.In, Value: costIDs[offset:end]})
		if e != nil {
			return pack, e
		}
		ids := []string{}
		for _, row := range rows {
			payees[text(row["id"])] = row
			if id := text(row["vendor_id"]); id != "" {
				ids = append(ids, id)
			}
		}
		if e = loadVendors(ids); e != nil {
			return pack, e
		}
	}
	for _, row := range withholdings {
		if !reportInSpan(text(row["paid_on"]), from, to) {
			continue
		}
		cost := payees[text(row["cost_id"])]
		vendor := vendors[text(cost["vendor_id"])]
		base, e := reportNumber(row["base_satang"], "Withholding base", true)
		if e != nil {
			return pack, e
		}
		wht, e := reportNumber(row["wht_satang"], "Withholding", true)
		if e != nil {
			return pack, e
		}
		rate, e := integer(row["rate_bps"])
		if e != nil {
			return pack, reportReadError(e)
		}
		form := "pnd53"
		if text(row["form"]) == "pnd3" {
			form = "pnd3"
		}
		pack.Purchase = append(pack.Purchase, reportPurchaseWHT{ID: text(row["id"]), CostID: text(row["cost_id"]), Number: text(row["certificate_no"]), PaidOn: text(row["paid_on"]), Form: form, Income: text(row["income_type"]), Rate: rate, Name: reportNonempty(text(vendor["name"]), trimText(text(cost["vendor"])), "Unassigned vendor"), TaxID: reportNullable(vendor["tax_id"]), Base: base, WHT: wht})
		pack.PurchaseWHT, e = reportSum(pack.PurchaseWHT, wht)
		if e != nil {
			return pack, e
		}
	}
	pack.Difference, err = reportSum(pack.OutputVAT, -pack.InputVAT)
	if err != nil {
		return pack, err
	}
	compare := collate.New(language.English)
	lineLess := func(x, y reportLine) bool {
		if c := compare.CompareString(x.Date, y.Date); c != 0 {
			return c < 0
		}
		if c := compare.CompareString(x.Number, y.Number); c != 0 {
			return c < 0
		}
		return compare.CompareString(x.ID, y.ID) < 0
	}
	sort.SliceStable(pack.Output, func(i, j int) bool { return lineLess(pack.Output[i], pack.Output[j]) })
	sort.SliceStable(pack.Input, func(i, j int) bool { return lineLess(pack.Input[i], pack.Input[j]) })
	thai := collate.New(language.Thai)
	sort.SliceStable(pack.Parties, func(i, j int) bool { return thai.CompareString(pack.Parties[i].Name, pack.Parties[j].Name) < 0 })
	sort.SliceStable(pack.Purchase, func(i, j int) bool {
		return compare.CompareString(pack.Purchase[i].Number, pack.Purchase[j].Number) < 0
	})
	return pack, nil
}
func readReportCredit(value any) (reportLine, error) {
	errMissing := errors.New("Credit note snapshot is missing stored VAT or withholding")
	body := reportRecord(value)
	buyer := reportRecord(body["buyer"])
	document := reportRecord(body["document"])
	name := trimText(text(buyer["name"]))
	if body == nil || buyer == nil || document == nil || name == "" {
		return reportLine{}, errMissing
	}
	if tax, ok := buyer["taxId"]; ok && tax != nil {
		if _, ok = tax.(string); !ok {
			return reportLine{}, errMissing
		}
	}
	base, e := reportNumber(document["baseSatang"], "", true)
	if e != nil {
		return reportLine{}, errMissing
	}
	vat, e := reportNumber(document["vatSatang"], "", true)
	if e != nil {
		return reportLine{}, errMissing
	}
	wht, e := reportNumber(document["whtSatang"], "", true)
	if e != nil {
		return reportLine{}, errMissing
	}
	if value := document["totalSatang"]; value != nil {
		total, e := reportNumber(value, "", true)
		sum, se := reportSum(base, vat)
		if e != nil || se != nil || total != sum {
			return reportLine{}, errMissing
		}
	}
	note := "Credit note"
	if original := trimText(text(body["originalNumber"])); original != "" {
		note += " against " + original
	}
	return reportLine{PartyName: name, TaxID: reportNullable(buyer["taxId"]), Base: -base, VAT: -vat, WHT: -wht, Note: note}, nil
}

func reportRecord(value any) erpwire.Row {
	switch row := value.(type) {
	case erpwire.Row:
		return row
	case map[string]any:
		return erpwire.Row(row)
	default:
		return nil
	}
}
func reportBaht(n int64) string { return money.FormatBaht(money.Satang(n)) }

func reportReadError(err error) error {
	if reportSafeError(err) {
		return err
	}
	return reportUnavailable
}
