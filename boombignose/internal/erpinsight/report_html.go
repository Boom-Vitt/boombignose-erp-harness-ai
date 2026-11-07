package erpinsight

import (
	"fmt"
	"strconv"
	"strings"
)

func reportEscape(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(value)
}
func reportMoneyHTML(n int64) string {
	s := reportBaht(n)
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign = "-"
		s = s[1:]
	}
	whole, fraction, _ := strings.Cut(s, ".")
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return sign + "฿" + whole + "." + fraction
}
func reportFmtHours(value float64) string { return fmt.Sprintf("%.2f h", value) }
func reportFilingHTML() string {
	out := []string{}
	for _, p := range reportFilingParties {
		out = append(out, "<li>"+reportEscape(p)+"</li>")
	}
	return strings.Join(out, "")
}
func reportCOGSTableRows(rows []reportMonthAmount) string {
	out := []string{}
	for _, r := range rows {
		out = append(out, `<tr><td>`+reportEscape(r.Month)+`</td><td class="num">`+reportMoneyHTML(r.Amount)+`</td></tr>`)
	}
	return strings.Join(out, "\n")
}
func reportPurchaseVATRows(rows []reportPurchaseVAT) string {
	out := []string{}
	for _, r := range rows {
		out = append(out, `<tr><td>`+reportEscape(r.Month)+`</td><td>`+reportMoneyHTML(r.Base)+`</td><td>`+reportMoneyHTML(r.VAT)+`</td><td>`+reportMoneyHTML(r.Total)+`</td></tr>`)
	}
	return strings.Join(out, "")
}
func reportRevenueTable(r reportPivot) string {
	if len(r.Rows) == 0 {
		return `<p class="muted">No issued invoices in this range.</p>`
	}
	headCols := []string{}
	for _, month := range r.Cols {
		headCols = append(headCols, `<th class="num">`+reportEscape(month)+`</th>`)
	}
	head := `<tr>
      <th>Client</th>
      ` + strings.Join(headCols, "\n      ") + `
      <th class="num">Total</th>
    </tr>`
	rows := []string{}
	for _, name := range r.Rows {
		cells := []string{}
		for _, month := range r.Cols {
			cells = append(cells, `<td class="num">`+reportMoneyHTML(r.grid[name][month])+`</td>`)
		}
		rows = append(rows, `<tr>
      <td>`+reportEscape(name)+`</td>
      `+strings.Join(cells, "\n      ")+`
      <td class="num strong">`+reportMoneyHTML(r.rowTotals[name])+`</td>
    </tr>`)
	}
	cols := []string{}
	for _, month := range r.Cols {
		cols = append(cols, `<td class="num strong">`+reportMoneyHTML(r.colTotals[month])+`</td>`)
	}
	footer := `<tr class="totals-row">
      <td class="strong">Total</td>
      ` + strings.Join(cols, "\n      ") + `
      <td class="num strong">` + reportMoneyHTML(r.GrandTotal) + `</td>
    </tr>`
	return `<table>
      <thead>` + head + `</thead>
      <tbody>
        ` + strings.Join(rows, "\n") + `
        ` + footer + `
      </tbody>
    </table>`
}
func reportHoursTable(h reportHours) string {
	if len(h.Projects) == 0 {
		return `<p class="muted">No time logged in this range.</p>`
	}
	rows := []string{}
	for _, p := range h.Projects {
		rows = append(rows, `<tr>
      <td>`+reportEscape(p.Name)+`</td>
      <td class="num">`+reportFmtHours(p.Hours)+`</td>
      <td class="num">`+reportFmtHours(p.BillableHours)+`</td>
      <td class="num">`+reportFmtHours(p.Hours-p.BillableHours)+`</td>
    </tr>`)
	}
	footer := `<tr class="totals-row">
      <td class="strong">Total</td>
      <td class="num strong">` + reportFmtHours(h.Hours) + `</td>
      <td class="num strong">` + reportFmtHours(h.BillableHours) + `</td>
      <td class="num strong">` + reportFmtHours(h.Hours-h.BillableHours) + `</td>
    </tr>`
	return `<table>
      <thead>
        <tr>
          <th>Project</th>
          <th class="num">Total</th>
          <th class="num">Billable</th>
          <th class="num">Non-billable</th>
        </tr>
      </thead>
      <tbody>
        ` + strings.Join(rows, "\n") + `
        ` + footer + `
      </tbody>
    </table>`
}
func reportLinesTable(rows []reportLine, empty string) string {
	if len(rows) == 0 {
		return `<p class="muted">` + reportEscape(empty) + `</p>`
	}
	head := []string{}
	for i, h := range reportLineHeaders {
		class := ""
		if i >= 5 {
			class = ` class="num"`
		}
		head = append(head, "<th"+class+">"+reportEscape(h)+"</th>")
	}
	body := []string{}
	for _, r := range rows {
		body = append(body, `<tr><td>`+reportEscape(reportDateLabel(r.Date))+`</td><td>`+reportEscape(reportKindLabels[r.Kind])+`</td><td>`+reportEscape(r.Number)+`</td><td>`+reportEscape(r.PartyName)+`</td><td>`+reportEscape(reportTaxText(r.TaxID))+`</td><td class="num">`+reportMoneyHTML(r.Base)+`</td><td class="num">`+reportMoneyHTML(r.VAT)+`</td><td class="num">`+reportMoneyHTML(r.WHT)+`</td></tr>`)
	}
	return `<table>
    <thead><tr>` + strings.Join(head, "") + `</tr></thead>
    <tbody>` + strings.Join(body, "") + `</tbody>
  </table>`
}
func reportPartyTable(pack reportPack) string {
	if len(pack.Parties) == 0 {
		return `<p class="muted">ไม่มีหัก ณ ที่จ่ายที่บันทึกไว้ในเดือนนี้ / No stored withholding in this month.</p>`
	}
	head := []string{}
	for i, h := range reportWHTHeaders {
		class := ""
		if i >= 2 {
			class = ` class="num"`
		}
		head = append(head, "<th"+class+">"+reportEscape(h)+"</th>")
	}
	body := []string{}
	for _, r := range pack.Parties {
		body = append(body, `<tr><td>`+reportEscape(r.Name)+`</td><td>`+reportEscape(reportTaxText(r.TaxID))+`</td><td class="num">`+reportMoneyHTML(r.Base)+`</td><td class="num">`+reportMoneyHTML(r.WHT)+`</td><td class="num">`+strconv.Itoa(r.Count)+`</td></tr>`)
	}
	return `<table>
      <thead><tr>` + strings.Join(head, "") + `</tr></thead>
      <tbody>
        ` + strings.Join(body, "") + `
        <tr class="totals-row"><td class="strong">รวม / Total</td><td></td><td></td><td class="num strong">` + reportMoneyHTML(pack.WHT) + `</td><td></td></tr>
      </tbody>
    </table>`
}

func reportRenderOperational(data reportData) string {
	return "<!doctype html>\n<html lang=\"th\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n<title>Operational report — " +
		reportEscape(data.OrgName) +
		"</title>\n<style>\n  * { box-sizing: border-box; }\n  body { font-family: ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif; color: #18181b; margin: 0; padding: 40px; }\n  .doc { max-width: 880px; margin: 0 auto; }\n  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }\n  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }\n  h2 { font-size: 16px; margin: 32px 0 8px; }\n  .org { font-size: 15px; font-weight: 600; }\n  .range { font-size: 12px; color: #71717a; }\n  .stats { display: flex; gap: 12px; margin: 16px 0 8px; flex-wrap: wrap; }\n  .stat { border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 16px; min-width: 180px; }\n  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #71717a; }\n  .stat .value { font-size: 20px; font-weight: 700; margin-top: 2px; }\n  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 13px; }\n  th { text-align: left; border-bottom: 2px solid #18181b; padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #3f3f46; }\n  td { padding: 8px 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }\n  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }\n  .strong { font-weight: 700; }\n  .totals-row td { border-top: 2px solid #18181b; }\n  .muted { color: #a1a1aa; padding: 8px 0; }\n  footer { margin-top: 40px; font-size: 11px; color: #a1a1aa; text-align: center; }\n  @media print { body { padding: 0; } .no-print { display: none; } }\n</style>\n</head>\n<body>\n  <div class=\"doc\">\n    <header>\n      <div>\n        <h1>Operational report</h1>\n        <div class=\"org\">" +
		reportEscape(data.OrgName) +
		"</div>\n        <div class=\"range\">" +
		reportEscape(data.Range) +
		" · " +
		reportEscape(data.Generated) +
		"</div>\n      </div>\n    </header>\n\n    <div class=\"stats\">\n      <div class=\"stat\">\n        <div class=\"label\">Cost of goods sold</div>\n        <div class=\"value\">" +
		reportMoneyHTML(data.TotalCOGS) +
		"</div>\n      </div>\n      <div class=\"stat\">\n        <div class=\"label\">Revenue before VAT</div>\n        <div class=\"value\">" +
		reportMoneyHTML(data.TotalRevenue) +
		"</div>\n      </div>\n      <div class=\"stat\">\n        <div class=\"label\">Billable hours</div>\n        <div class=\"value\">" +
		reportFmtHours(data.Hours.BillableHours) +
		"</div>\n      </div>\n      <div class=\"stat\">\n        <div class=\"label\">Total hours</div>\n        <div class=\"value\">" +
		reportFmtHours(data.Hours.Hours) +
		"</div>\n      </div>\n    </div>\n\n    <h2>Issued revenue by client × month</h2>\n    " +
		reportRevenueTable(data.Revenue) +
		"\n\n    <h2>Cost of goods sold by month</h2>\n    <p>Delivered stock cost less customer returns, grouped by Bangkok month.</p>\n    <table>\n      <thead><tr><th>Month</th><th class=\"num\">Cost of goods sold</th></tr></thead>\n      <tbody>\n        " +
		reportCOGSTableRows(data.COGS) +
		"\n        <tr class=\"totals-row\"><td class=\"strong\">Total</td><td class=\"num strong\">" +
		reportMoneyHTML(data.TotalCOGS) +
		"</td></tr>\n      </tbody>\n    </table>\n\n    <h2>Hours by project</h2>\n    " +
		reportHoursTable(data.Hours) +
		"\n\n    <h2>Purchase VAT by month</h2>\n    <p>Matched vendor invoices less linked credit notes, including inventory purchases. Operational report only.</p>\n    <table><thead><tr><th>Month</th><th>Purchase base</th><th>Input VAT</th><th>Vendor total</th></tr></thead><tbody>" +
		reportPurchaseVATRows(data.PurchaseVAT) +
		"</tbody></table>\n\n    <footer>Generated by BoomBigNose ERP · Operational report, not a legal document.</footer>\n  </div>\n</body>\n</html>"
}

func reportRenderPack(pack reportPack, generatedOn string) string {
	output := reportLinesTable(pack.Output, "ไม่มีใบแจ้งหนี้ที่ออกหรือใบลดหนี้ในเดือนนี้ / No issued invoices or credit notes in this month.")
	input := reportLinesTable(pack.Input, "ไม่มีบิลผู้ขายที่จับคู่ในเดือนนี้ / No matched vendor bills in this month.")
	wht := reportPartyTable(pack)
	return "<!DOCTYPE html>\n<html lang=\"th\">\n<head>\n<meta charset=\"utf-8\" />\n<title>ชุดข้อมูลนักบัญชี " +
		reportEscape(pack.Month) +
		"</title>\n<style>\n  body { font-family: \"Noto Sans Thai\", \"Segoe UI\", sans-serif; color: #18181b; margin: 32px; }\n  h1 { font-size: 22px; margin: 0 0 4px; }\n  h2 { font-size: 16px; margin: 28px 0 8px; }\n  .disclaimer { border: 1px solid #18181b; padding: 12px 14px; margin: 16px 0; }\n  .muted { color: #52525b; }\n  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 13px; }\n  th { text-align: left; border-bottom: 2px solid #18181b; padding: 6px; font-size: 11px; }\n  td { padding: 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }\n  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }\n  .strong { font-weight: 700; }\n  .totals-row td { border-top: 2px solid #18181b; }\n  button { margin-top: 8px; }\n  @media print { button { display: none; } body { margin: 0; } }\n</style>\n</head>\n<body>\n  <h1>ชุดข้อมูลนักบัญชี / Accountant pack</h1>\n  <p>" +
		reportEscape(pack.OrgName) +
		" · " +
		reportEscape(pack.Month) +
		" (" +
		reportEscape(pack.BuddhistMonth) +
		") · " +
		reportEscape(reportDateLabel(generatedOn)) +
		"</p>\n  <p class=\"muted\">" +
		reportEscape(reportBahtCaptionTh) +
		" / " +
		reportEscape(reportBahtCaptionEn) +
		" วันที่แสดงทั้ง ค.ศ. และ พ.ศ. / Dates show the Gregorian day and the Buddhist-era day.</p>\n  <div class=\"disclaimer\">\n    <p>" +
		reportEscape(reportAccountantPackDisclaimerTh) +
		"</p>\n    <p>" +
		reportEscape(reportAccountantPackDisclaimerEn) +
		"</p>\n    <p>" +
		reportEscape(reportVatSupportTh) +
		"</p>\n    <p>" +
		reportEscape(reportVatSupportEn) +
		"</p>\n    <p>" +
		reportEscape(reportFilingLeadTh) +
		"</p>\n    <p>" +
		reportEscape(reportFilingLeadEn) +
		"</p>\n    <ul>" +
		reportFilingHTML() +
		"</ul>\n    <p>" +
		reportEscape(reportFilingLimitTh) +
		"</p>\n    <p>" +
		reportEscape(reportFilingLimitEn) +
		"</p>\n  </div>\n  <button type=\"button\" onclick=\"window.print()\">พิมพ์ / Print / PDF</button>\n  <h2>ภาษีขาย / Output VAT</h2>\n  <p class=\"muted\">ใบแจ้งหนี้ที่ออกแล้วหักใบลดหนี้ในเดือนนี้ หนึ่งแถวต่อหนึ่งเอกสาร ภาษีมูลค่าเพิ่มคือยอดที่บันทึกในเอกสาร / Issued invoices minus credit notes dated in this month. One row per document. VAT is the amount stored on the document.</p>\n  <p>ฐานภาษี / Base " +
		reportMoneyHTML(pack.OutputBase) +
		" · ภาษีมูลค่าเพิ่ม / VAT " +
		reportMoneyHTML(pack.OutputVAT) +
		"</p>\n  " +
		output +
		"\n  <h2>ภาษีซื้อ / Input VAT</h2>\n  <p class=\"muted\">บิลผู้ขายที่จับคู่แล้วในตารางภาษีซื้อ ใบลดหนี้ที่เชื่อมกันลดยอด ต้นทุนที่ยังไม่จับคู่ไม่ถูกรวม / Matched vendor bills already on the purchase VAT table. Linked credit notes reduce the total. Unmatched costs are left out.</p>\n  <p>ฐานภาษี / Base " +
		reportMoneyHTML(pack.InputBase) +
		" · ภาษีมูลค่าเพิ่ม / VAT " +
		reportMoneyHTML(pack.InputVAT) +
		"</p>\n  " +
		input +
		"\n  <h2>ผลต่างภาษีขายกับภาษีซื้อ / Output minus input</h2>\n  <p>" +
		reportMoneyHTML(pack.Difference) +
		"</p>\n  <p class=\"muted\">ผลต่างนี้เป็นข้อมูลประกอบ ไม่ใช่ภาษีที่ต้องชำระ และไม่ใช่การยื่นแบบ ภ.พ.30 / Support difference only. Not tax payable and not a ภ.พ.30 filing.</p>\n  <h2>หัก ณ ที่จ่าย / Stored withholding</h2>\n  <p class=\"muted\">" +
		reportEscape(reportVendorWhtNote) +
		"</p>\n  " +
		wht +
		"\n</body>\n</html>"
}
