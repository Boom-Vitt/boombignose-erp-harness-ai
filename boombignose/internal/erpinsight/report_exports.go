package erpinsight

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

var reportCSVNumeric = regexp.MustCompile(`^-?(?:0|[1-9]\d*)(?:\.\d+)?$`)
var reportRateDecimal = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)

func reportCSV(headers []string, rows [][]any) string {
	lines := make([]string, 0, len(rows)+1)
	write := func(row []any) {
		cells := make([]string, len(row))
		for i, value := range row {
			if value == nil {
				continue
			}
			s, ok := value.(string)
			if !ok {
				s = fmt.Sprint(value)
			} else if len(s) > 0 && strings.ContainsRune("=+-@\t\r", rune(s[0])) && !reportCSVNumeric.MatchString(s) {
				s = "'" + s
			}
			if strings.ContainsAny(s, ",\"\r\n") {
				s = "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
			}
			cells[i] = s
		}
		lines = append(lines, strings.Join(cells, ","))
	}
	head := make([]any, len(headers))
	for i, h := range headers {
		head[i] = h
	}
	write(head)
	for _, row := range rows {
		write(row)
	}
	return "\uFEFF" + strings.Join(lines, "\r\n")
}
func reportTaxText(tax *string) string {
	if tax == nil {
		return ""
	}
	return *tax
}

var reportLineHeaders = []string{"วันที่ / Date", "เอกสาร / Document", "เลขที่ / Number", "คู่ค้า / Party", "เลขผู้เสียภาษี / Tax ID", "ฐานภาษี / Base", "ภาษีมูลค่าเพิ่ม / VAT", "หัก ณ ที่จ่าย / WHT"}
var reportWHTHeaders = []string{"ลูกค้า / Customer", "เลขผู้เสียภาษี / Tax ID", "ฐานภาษี / Base", "หัก ณ ที่จ่าย / WHT", "จำนวนเอกสาร / Documents"}
var reportKindLabels = map[string]string{"invoice": "ใบแจ้งหนี้ / Invoice", "credit_note": "ใบลดหนี้ / Credit note", "vendor_bill": "บิลผู้ขาย / Vendor bill", "vendor_credit": "ใบลดหนี้ผู้ขาย / Vendor credit", "return_adjustment": "ปรับคืนสินค้า / Return adjustment", "matched_cost": "ต้นทุนที่จับคู่แล้ว / Matched cost", "abb_daily": "ใบกำกับภาษีอย่างย่อ รายวัน / Abbreviated tax invoices, daily"}
var reportIncomeLabels = map[string]string{"service_40_8": "Service fees (40(8))", "professional_40_6": "Professional fees (40(6))", "contract_40_7": "Contract work (40(7))", "rent_40_5": "Rent (40(5))", "royalty_40_3": "Royalty (40(3))", "other": "Other"}

func reportRate(rate int64) string {
	if rate%100 == 0 {
		return strconv.FormatInt(rate/100, 10)
	}
	return strings.TrimRight(strings.TrimRight(reportBaht(rate), "0"), ".")
}
func reportPackCSV(pack reportPack) string {
	rows := [][]any{}
	summary := func(kind string, base, vat, wht any, note string) {
		format := func(v any) any {
			if n, ok := v.(int64); ok {
				return reportBaht(n)
			}
			return v
		}
		rows = append(rows, []any{"summary", kind, "", pack.Month, "", "", "", format(base), format(vat), format(wht), "", note})
	}
	summary("disclaimer", "", "", "", reportAccountantPackDisclaimerEn)
	summary("disclaimer_th", "", "", "", reportAccountantPackDisclaimerTh)
	summary("responsibility_th", "", "", "", reportFilingLeadTh)
	summary("responsibility_en", "", "", "", reportFilingLeadEn)
	for _, p := range reportFilingParties {
		summary("responsibility", "", "", "", p)
	}
	summary("responsibility_limit_th", "", "", "", reportFilingLimitTh)
	summary("responsibility_limit_en", "", "", "", reportFilingLimitEn)
	summary("output_vat", pack.OutputBase, pack.OutputVAT, pack.OutputWHT, "Issued invoices minus credit notes. Output VAT support, not a filing.")
	summary("input_vat", pack.InputBase, pack.InputVAT, "", "Matched vendor bills on the purchase VAT table, including linked credits. Input VAT support, not a filing.")
	summary("output_minus_input", "", pack.Difference, "", "Support difference only. Not tax payable and not a ภ.พ.30 filing.")
	summary("wht", "", "", pack.WHT, reportVendorWhtNote)
	summary("purchase_wht", "", "", pack.PurchaseWHT, "Withholding deducted on purchases, from purchase withholding records. Support for ภ.ง.ด.3/53 lists, not a filing.")
	for _, group := range []struct {
		section string
		lines   []reportLine
	}{{"output_vat", pack.Output}, {"input_vat", pack.Input}} {
		for _, r := range group.lines {
			rows = append(rows, []any{group.section, r.Kind, r.Number, r.Date, r.PartyKind, r.PartyName, reportTaxText(r.TaxID), reportBaht(r.Base), reportBaht(r.VAT), reportBaht(r.WHT), r.ID, r.Note})
		}
	}
	for _, r := range pack.Purchase {
		rows = append(rows, []any{"purchase_wht", r.Form, r.Number, r.PaidOn, "vendor", r.Name, reportTaxText(r.TaxID), reportBaht(r.Base), "", reportBaht(r.WHT), r.ID, reportRate(r.Rate) + "% " + r.Income})
	}
	for _, r := range pack.Parties {
		noun := "documents"
		if r.Count == 1 {
			noun = "document"
		}
		rows = append(rows, []any{"wht", "customer_total", "", pack.Month, "customer", r.Name, reportTaxText(r.TaxID), reportBaht(r.Base), "", reportBaht(r.WHT), r.ID, fmt.Sprintf("%d %s with stored withholding", r.Count, noun)})
	}
	return reportCSV([]string{"Section", "Kind", "Number", "Date", "Party kind", "Party", "Tax ID", "Base (THB)", "VAT (THB)", "WHT (THB)", "Document ID", "Note"}, rows)
}

type reportVATRow struct {
	Kind      string  `json:"kind"`
	Date      string  `json:"date"`
	Number    string  `json:"number"`
	Documents int     `json:"documents"`
	Name      string  `json:"partyName"`
	TaxID     *string `json:"taxId"`
	Base      int64   `json:"baseSatang"`
	VAT       int64   `json:"vatSatang"`
}
type reportVAT struct {
	Month      string         `json:"month"`
	OrgName    string         `json:"orgName"`
	Output     []reportVATRow `json:"output"`
	Input      []reportVATRow `json:"input"`
	OutputBase int64          `json:"outputBaseSatang"`
	OutputVAT  int64          `json:"outputVatSatang"`
	InputBase  int64          `json:"inputBaseSatang"`
	InputVAT   int64          `json:"inputVatSatang"`
	NetVAT     int64          `json:"netVatSatang"`
}

func reportBuildVAT(pack reportPack) (reportVAT, error) {
	r := reportVAT{Month: pack.Month, OrgName: pack.OrgName, Output: []reportVATRow{}, Input: []reportVATRow{}, OutputBase: pack.OutputBase, OutputVAT: pack.OutputVAT, InputBase: pack.InputBase, InputVAT: pack.InputVAT, NetVAT: pack.Difference}
	toRow := func(l reportLine) reportVATRow {
		return reportVATRow{Kind: l.Kind, Date: l.Date, Number: l.Number, Documents: 1, Name: l.PartyName, TaxID: l.TaxID, Base: l.Base, VAT: l.VAT}
	}
	days := map[string][]reportLine{}
	for _, line := range pack.Output {
		if line.Kind == "invoice" && strings.HasPrefix(line.Number, "ABB-") {
			days[line.Date] = append(days[line.Date], line)
		} else {
			r.Output = append(r.Output, toRow(line))
		}
	}
	for date, lines := range days {
		row := reportVATRow{Kind: "abb_daily", Date: date, Documents: len(lines), Name: "ผู้ซื้อทั่วไป / Retail buyers (ABB)"}
		numbers := []string{}
		for _, line := range lines {
			numbers = append(numbers, line.Number)
			var e error
			row.Base, e = reportSum(row.Base, line.Base)
			if e != nil {
				return r, e
			}
			row.VAT, e = reportSum(row.VAT, line.VAT)
			if e != nil {
				return r, e
			}
		}
		sort.Strings(numbers)
		row.Number = numbers[0]
		if len(numbers) > 1 {
			row.Number += " … " + numbers[len(numbers)-1]
		}
		r.Output = append(r.Output, row)
	}
	compare := collate.New(language.English)
	sort.SliceStable(r.Output, func(i, j int) bool {
		x, y := r.Output[i], r.Output[j]
		if c := compare.CompareString(x.Date, y.Date); c != 0 {
			return c < 0
		}
		return compare.CompareString(x.Number, y.Number) < 0
	})
	for _, line := range pack.Input {
		r.Input = append(r.Input, toRow(line))
	}
	var ob, ov, ib, iv int64
	for _, row := range r.Output {
		var e error
		ob, e = reportSum(ob, row.Base)
		if e != nil {
			return r, e
		}
		ov, e = reportSum(ov, row.VAT)
		if e != nil {
			return r, e
		}
	}
	for _, row := range r.Input {
		var e error
		ib, e = reportSum(ib, row.Base)
		if e != nil {
			return r, e
		}
		iv, e = reportSum(iv, row.VAT)
		if e != nil {
			return r, e
		}
	}
	if ob != pack.OutputBase || ov != pack.OutputVAT || ib != pack.InputBase || iv != pack.InputVAT {
		return r, fmt.Errorf("VAT report does not match the accountant pack for this month")
	}
	return r, nil
}
func reportVATCSV(r reportVAT) string {
	note := func(v string) []any { return []any{"summary", "", "", r.Month, "", "", "", "", "", v} }
	rows := [][]any{note("disclaimer_th: " + reportVatReportDisclaimerTh), note("disclaimer_en: " + reportVatReportDisclaimerEn), {"summary", "output_vat", "", r.Month, "", "", "", reportBaht(r.OutputBase), reportBaht(r.OutputVAT), "Output VAT support"}, {"summary", "input_vat", "", r.Month, "", "", "", reportBaht(r.InputBase), reportBaht(r.InputVAT), "Input VAT support"}, {"summary", "output_minus_input", "", r.Month, "", "", "", "", reportBaht(r.NetVAT), "Support difference only. Not tax payable."}}
	for _, group := range []struct {
		section string
		lines   []reportVATRow
	}{{"output_vat", r.Output}, {"input_vat", r.Input}} {
		for _, row := range group.lines {
			rows = append(rows, []any{group.section, row.Kind, row.Number, row.Date, row.Documents, row.Name, reportTaxText(row.TaxID), reportBaht(row.Base), reportBaht(row.VAT), reportKindLabels[row.Kind]})
		}
	}
	return reportCSV([]string{"Section", "Kind", "Number", "Date", "Documents", "Party", "Tax ID", "Base (THB)", "VAT (THB)", "Note"}, rows)
}

type reportWHTList struct {
	Form    string              `json:"form"`
	Rows    []reportPurchaseWHT `json:"rows"`
	Base    int64               `json:"baseSatang"`
	WHT     int64               `json:"whtSatang"`
	Missing int                 `json:"missingTaxId"`
}
type reportWHT struct {
	Month   string          `json:"month"`
	OrgName string          `json:"orgName"`
	Lists   []reportWHTList `json:"lists"`
	WHT     int64           `json:"whtSatang"`
}

func reportBuildWHT(pack reportPack, only string) (reportWHT, error) {
	r := reportWHT{Month: pack.Month, OrgName: pack.OrgName, Lists: []reportWHTList{}}
	for _, form := range []string{"pnd3", "pnd53"} {
		if only != "" && only != form {
			continue
		}
		list := reportWHTList{Form: form, Rows: []reportPurchaseWHT{}}
		for _, row := range pack.Purchase {
			if row.Form != form {
				continue
			}
			list.Rows = append(list.Rows, row)
			var e error
			list.Base, e = reportSum(list.Base, row.Base)
			if e != nil {
				return r, e
			}
			list.WHT, e = reportSum(list.WHT, row.WHT)
			if e != nil {
				return r, e
			}
			if trimText(reportTaxText(row.TaxID)) == "" {
				list.Missing++
			}
		}
		r.Lists = append(r.Lists, list)
		var e error
		r.WHT, e = reportSum(r.WHT, list.WHT)
		if e != nil {
			return r, e
		}
	}
	if only == "" && r.WHT != pack.PurchaseWHT {
		return r, fmt.Errorf("WHT report does not match the accountant pack for this month")
	}
	return r, nil
}
func reportWHTCSV(r reportWHT) string {
	note := func(v string) []any { return []any{"summary", "", "", r.Month, "", "", "", "", "", "", v} }
	rows := [][]any{note("disclaimer_th: " + reportWhtReportDisclaimerTh), note("disclaimer_en: " + reportWhtReportDisclaimerEn)}
	for _, list := range r.Lists {
		rows = append(rows, []any{"summary", list.Form, "", r.Month, "", "", "", "", reportBaht(list.Base), reportBaht(list.WHT), fmt.Sprintf("%d rows, %d without payee tax ID", len(list.Rows), list.Missing)})
	}
	for _, list := range r.Lists {
		for _, row := range list.Rows {
			note := ""
			if trimText(reportTaxText(row.TaxID)) == "" {
				note = "Payee tax ID missing"
			}
			rows = append(rows, []any{"line", row.Form, row.Number, row.PaidOn, row.Name, reportTaxText(row.TaxID), reportNonempty(reportIncomeLabels[row.Income], row.Income), reportRate(row.Rate), reportBaht(row.Base), reportBaht(row.WHT), note})
		}
	}
	return reportCSV([]string{"Section", "Form", "WHT number", "Paid on", "Payee", "Payee tax ID", "Income type", "Rate (%)", "Base (THB)", "WHT (THB)", "Note"}, rows)
}

func (s *Service) reportExport(ctx context.Context, a erpwire.Actor, kind string, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := reportParams(raw)
	if err != nil {
		return nil, err
	}
	month := params["month"]
	form := params["form"]
	if kind == "wht_support_csv" && form != "" && form != "pnd3" && form != "pnd53" {
		return HTTPResponse{Status: 400, Body: "Unknown form."}, nil
	}
	loaded, err := s.loadReportPack(ctx, a, month)
	if err != nil {
		return nil, err
	}
	if !loaded.OK {
		return HTTPResponse{Status: loaded.Status, Body: loaded.Message}, nil
	}
	pack := *loaded.Pack
	body, filename, contentType, disposition := "", "", "text/csv; charset=utf-8", "attachment"
	switch kind {
	case "vat_support_csv":
		var r reportVAT
		r, err = reportBuildVAT(pack)
		body = reportVATCSV(r)
		filename = "vat-support-" + month + ".csv"
	case "wht_support_csv":
		var r reportWHT
		r, err = reportBuildWHT(pack, form)
		body = reportWHTCSV(r)
		filename = "wht-support-" + month
		if form != "" {
			filename += "-" + form
		}
		filename += ".csv"
	case "accountant_pack_csv":
		body = reportPackCSV(pack)
		filename = "accountant-pack-" + month + ".csv"
	case "accountant_pack_print":
		body = reportRenderPack(pack, s.now().In(reportZone).Format("2006-01-02"))
		filename = "accountant-pack-" + month + ".html"
		contentType = "text/html; charset=utf-8"
		disposition = "inline"
	}
	if err != nil {
		return nil, err
	}
	return s.reportCommitExport(ctx, a, kind, month, body, filename, contentType, disposition)
}
func (s *Service) reportCommitExport(ctx context.Context, a erpwire.Actor, kind, period, body, filename, contentType, disposition string) (any, error) {
	sum := sha256.Sum256([]byte(body))
	checksum := hex.EncodeToString(sum[:])
	err := s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, err := tx.Command(ctx, "record_support_export", erpwire.Row{"p_org_id": a.OrgID(), "p_kind": kind, "p_period": period, "p_sha256": checksum, "p_bytes": len([]byte(body))})
		return err
	})
	if err != nil {
		if reportSafeError(err) {
			return nil, err
		}
		return HTTPResponse{Status: 503, Body: "Support export was not recorded. Reload and try the download again."}, nil
	}
	return HTTPResponse{Status: 200, Body: body, Headers: map[string]string{"Content-Type": contentType, "Content-Disposition": disposition + `; filename="` + filename + `"`, "X-Content-SHA256": checksum, "X-Robots-Tag": "noindex"}}, nil
}
func reportParams(raw json.RawMessage) (map[string]string, error) {
	args, err := arguments(raw, 0, 1)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	if len(args) == 0 || args.Null(0) {
		return out, nil
	}
	var value any
	if args.Decode(0, &value) != nil {
		return nil, erpwire.ErrBadArguments
	}
	switch v := value.(type) {
	case string:
		u, e := url.Parse(v)
		if e != nil {
			return nil, erpwire.ErrBadArguments
		}
		for k, list := range u.Query() {
			if len(list) > 0 {
				out[k] = list[0]
			}
		}
	case map[string]any:
		for k, v := range v {
			if s, ok := v.(string); ok {
				out[k] = s
			}
		}
	default:
		return nil, erpwire.ErrBadArguments
	}
	return out, nil
}
