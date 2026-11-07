package erpinsight

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func reportDateLabel(value string) string {
	date, e := time.Parse("2006-01-02", value)
	if e != nil || date.Year() < 100 {
		return value
	}
	return fmt.Sprintf("%s (%02d/%02d/%d)", value, date.Day(), int(date.Month()), date.Year()+543)
}
func reportMonthLabel(value string) string {
	date, ok := reportMonth(value)
	if !ok {
		return value
	}
	return fmt.Sprintf("%s (%02d/%d)", value, int(date.Month()), date.Year()+543)
}
func reportNoun(count int, one, many string) string {
	if count == 1 {
		return fmt.Sprintf("%d %s", count, one)
	}
	return fmt.Sprintf("%d %s", count, many)
}

var reportCalendarDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var reportTaxID = regexp.MustCompile(`^[0-9]{13}$`)

type reportCloseInput struct {
	Month                                                 string
	Today                                                 string
	Lock                                                  string
	Viewer                                                string
	Invoices, Balances, Bills, Bank, Claims, Credits, VAT []erpwire.Row
	Settings                                              erpwire.Row
}

func (s *Service) reportCloseChecklist(ctx context.Context, a erpwire.Actor) (any, error) {
	if !erpwire.Can(a.Role(), "audit:view") {
		return nil, nil
	}
	today := s.now().In(reportZone)
	start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, reportZone)
	input := reportCloseInput{Month: start.AddDate(0, -1, 0).Format("2006-01"), Today: today.Format("2006-01-02"), Viewer: a.UserID()}
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		for _, query := range []struct {
			table   string
			columns []string
			dst     *[]erpwire.Row
		}{{"invoices", []string{"id", "status", "issue_date", "due_date", "amount_satang", "vat_satang"}, &input.Invoices}, {"invoice_balances", []string{"invoice_id", "paid_satang", "credited_satang"}, &input.Balances}, {"costs", []string{"id", "vendor_id", "expense_claim_id", "paid_at", "due_date", "amount_satang", "purchase_cost_kind"}, &input.Bills}, {"bank_lines", []string{"id", "booked_on", "amount_satang", "matched_payment_id"}, &input.Bank}, {"expense_claims", []string{"id", "status", "employee"}, &input.Claims}, {"credit_note_revenue", []string{"id", "issue_date", "base_satang", "total_satang"}, &input.Credits}, {"monthly_purchase_vat", []string{"month", "input_vat_satang"}, &input.VAT}} {
			q := selection(a, query.table, query.columns)
			if query.table == "invoice_balances" {
				q.Order = []erpwire.Order{{Column: "invoice_id"}}
			}
			if query.table == "monthly_purchase_vat" {
				q.Order = []erpwire.Order{{Column: "month"}}
			}
			rows, e := all(ctx, tx, q)
			if e != nil {
				return e
			}
			*query.dst = rows
		}
		settings, e := one(ctx, tx, selection(a, "org_settings", []string{"lock_date", "legal_name", "business_address", "tax_id", "branch_label", "tax_status"}))
		input.Settings = settings
		input.Lock = text(settings["lock_date"])
		return e
	})
	if err != nil {
		if reportSafeError(err) {
			return nil, err
		}
		return nil, errors.New("Month-end close data unavailable. Reload before relying on the list.")
	}
	return buildReportClose(input)
}
func buildReportClose(input reportCloseInput) (erpwire.Row, error) {
	start, ok := reportMonth(input.Month)
	if !ok {
		return nil, errors.New("Enter a month as YYYY-MM.")
	}
	if !reportCalendarDate.MatchString(input.Today) {
		return nil, errors.New("Enter today as YYYY-MM-DD.")
	}
	end := start.AddDate(0, 1, -1).Format("2006-01-02")
	lock := input.Lock
	if !reportCalendarDate.MatchString(lock) {
		lock = ""
	}
	closed := lock != "" && lock >= end
	closable := end < input.Today && !closed
	balances := map[string]erpwire.Row{}
	for _, row := range input.Balances {
		id := text(row["invoice_id"])
		if id != "" && balances[id] == nil {
			balances[id] = row
		}
	}
	var overdueCount, unpaidCount, pastDueCount, unmatchedCount, laterBank, draftCount, laterDrafts, submitted, own int
	var overdueAmount, unpaidAmount, unmatchedAmount, draftAmount, outputVAT, inputVAT int64
	add := func(dst *int64, value int64) error {
		sum, e := reportSum(*dst, value)
		if e != nil {
			return e
		}
		*dst = sum
		return nil
	}
	for _, row := range input.Invoices {
		status, issue, due := text(row["status"]), text(row["issue_date"]), text(row["due_date"])
		amount, e := reportNumber(row["amount_satang"], "Invoice total", false)
		if e != nil {
			return nil, e
		}
		balance := balances[text(row["id"])]
		paid, e := reportNumber(reportDefaultNumber(balance["paid_satang"]), "Paid amount", false)
		if e != nil {
			return nil, e
		}
		credited, e := reportNumber(reportDefaultNumber(balance["credited_satang"]), "Credited amount", false)
		if e != nil {
			return nil, e
		}
		settled, e := reportSum(paid, credited)
		if e != nil {
			return nil, e
		}
		if status != "draft" && status != "cancelled" && !(amount > 0 && settled >= amount) && due != "" && due < input.Today {
			overdueCount++
			remaining, e := reportSum(amount, -paid, -credited)
			if e != nil {
				return nil, e
			}
			if remaining < 0 {
				remaining = 0
			}
			if e = add(&overdueAmount, remaining); e != nil {
				return nil, e
			}
		}
		if status == "draft" && reportCalendarDate.MatchString(issue) {
			if issue <= end {
				draftCount++
				if e = add(&draftAmount, amount); e != nil {
					return nil, e
				}
			} else {
				laterDrafts++
			}
		}
		if status != "draft" && status != "cancelled" && reportCalendarDate.MatchString(issue) && strings.HasPrefix(issue, input.Month) {
			vat, e := reportNumber(row["vat_satang"], "Invoice VAT", false)
			if e != nil {
				return nil, e
			}
			if e = add(&outputVAT, vat); e != nil {
				return nil, e
			}
		}
	}
	for _, row := range input.Bills {
		amount, e := reportNumber(row["amount_satang"], "Vendor bill total", false)
		if e != nil {
			return nil, e
		}
		if text(row["vendor_id"]) == "" || row["expense_claim_id"] != nil || row["paid_at"] != nil || has([]string{"credit", "return_adjustment"}, text(row["purchase_cost_kind"])) || amount <= 0 {
			continue
		}
		unpaidCount++
		if due := text(row["due_date"]); due != "" && due < input.Today {
			pastDueCount++
		}
		if e = add(&unpaidAmount, amount); e != nil {
			return nil, e
		}
	}
	for _, row := range input.Bank {
		booked := text(row["booked_on"])
		if row["matched_payment_id"] != nil || !reportCalendarDate.MatchString(booked) {
			continue
		}
		if booked > end {
			laterBank++
			continue
		}
		unmatchedCount++
		amount, e := reportNumber(row["amount_satang"], "Bank amount", false)
		if e != nil {
			return nil, e
		}
		if amount < 0 {
			amount = -amount
		}
		if e = add(&unmatchedAmount, amount); e != nil {
			return nil, e
		}
	}
	for _, row := range input.Claims {
		if text(row["status"]) == "submitted" {
			submitted++
			if text(row["employee"]) == input.Viewer {
				own++
			}
		}
	}
	missing, missingTH := []string{}, []string{}
	for _, field := range []struct{ key, en, th string }{{"legal_name", "seller name", "ชื่อผู้ขาย"}, {"business_address", "seller address", "ที่อยู่ผู้ขาย"}, {"tax_id", "13-digit tax ID", "เลขประจำตัวผู้เสียภาษี 13 หลัก"}, {"branch_label", "branch", "สาขา"}} {
		value := trimText(text(input.Settings[field.key]))
		valid := value != ""
		if field.key == "tax_id" {
			valid = reportTaxID.MatchString(value)
		}
		if !valid {
			missing = append(missing, field.en)
			missingTH = append(missingTH, field.th)
		}
	}
	taxStatus := text(input.Settings["tax_status"])
	if taxStatus != "registered" && taxStatus != "not_registered" {
		missing = append(missing, "VAT registration")
		missingTH = append(missingTH, "สถานะจดทะเบียนภาษีมูลค่าเพิ่ม")
	}
	for _, row := range input.Credits {
		issue := text(row["issue_date"])
		if !reportCalendarDate.MatchString(issue) || !strings.HasPrefix(issue, input.Month) {
			continue
		}
		base, e := reportNumber(row["base_satang"], "Credit note base", false)
		if e != nil {
			return nil, e
		}
		total, e := reportNumber(row["total_satang"], "Credit note total", false)
		if e != nil {
			return nil, e
		}
		if e = add(&outputVAT, base-total); e != nil {
			return nil, e
		}
	}
	for _, row := range input.VAT {
		if !strings.HasPrefix(text(row["month"]), input.Month) {
			continue
		}
		vat, e := reportNumber(row["input_vat_satang"], "Input VAT", false)
		if e != nil {
			return nil, e
		}
		if e = add(&inputVAT, vat); e != nil {
			return nil, e
		}
	}
	items := []erpwire.Row{}
	item := func(id, title, detail string, count int, amount any, href, state string) {
		items = append(items, erpwire.Row{"id": id, "title": title, "detail": detail, "count": count, "amountSatang": amount, "href": href, "state": state, "outputVatSatang": nil, "inputVatSatang": nil})
	}
	state := func(count int) string {
		if count == 0 {
			return "clear"
		}
		return "review"
	}
	detail := "ไม่มีใบแจ้งหนี้ที่ออกแล้วเกินกำหนด / No issued invoice is past its due date."
	if overdueCount > 0 {
		detail = fmt.Sprintf("ใบแจ้งหนี้ที่ออกแล้ว %d ใบเกินกำหนดและยังชำระไม่ครบ / %s past due and not fully paid.", overdueCount, reportNoun(overdueCount, "issued invoice is", "issued invoices are"))
	}
	item("overdue_ar", "ลูกหนี้เกินกำหนด / Overdue receivables", detail, overdueCount, overdueAmount, "/finance?status=overdue", state(overdueCount))
	detail = "ไม่มีบิลผู้ขายค้างจ่าย / No vendor bill is unpaid."
	if unpaidCount > 0 {
		detail = fmt.Sprintf("มีบิลผู้ขายค้างจ่าย และ %d ใบเกินกำหนด ณ %s / %s unpaid. %d past due as of %s.", pastDueCount, reportDateLabel(input.Today), reportNoun(unpaidCount, "vendor bill is", "vendor bills are"), pastDueCount, reportDateLabel(input.Today))
	}
	item("unpaid_ap", "บิลเจ้าหนี้ค้างจ่าย / Unpaid vendor bills", detail, unpaidCount, unpaidAmount, "/finance?tab=costs", state(unpaidCount))
	detail = fmt.Sprintf("ไม่มีรายการธนาคารที่บันทึกในหรือก่อน %s ที่ยังไม่จับคู่ / No bank line booked on or before %s is unmatched.", reportDateLabel(end), reportDateLabel(end))
	if unmatchedCount > 0 {
		verb := "are"
		if unmatchedCount == 1 {
			verb = "is"
		}
		detail = fmt.Sprintf("มีรายการธนาคาร %d รายการที่บันทึกในหรือก่อน %s ยังไม่จับคู่กับใบเสร็จที่ยืนยันแล้ว / %s booked on or before %s %s not matched to a verified receipt.", unmatchedCount, reportDateLabel(end), reportNoun(unmatchedCount, "bank line", "bank lines"), reportDateLabel(end), verb)
	}
	if laterBank > 0 {
		verb := "stay"
		if laterBank == 1 {
			verb = "stays"
		}
		detail += fmt.Sprintf(" รายการที่ยังไม่จับคู่ %d รายการที่บันทึกหลัง %s ไปกับงวดถัดไป / %s after %s %s with the next close.", laterBank, reportDateLabel(end), reportNoun(laterBank, "unmatched line booked", "unmatched lines booked"), reportDateLabel(end), verb)
	}
	item("unmatched_bank", "รายการธนาคารที่ยังไม่จับคู่ / Unmatched bank lines", detail, unmatchedCount, unmatchedAmount, "/finance/bank", state(unmatchedCount))
	detail = fmt.Sprintf("ไม่มีใบแจ้งหนี้ฉบับร่างที่มีวันที่ในหรือก่อน %s / No draft invoice is dated on or before %s.", reportDateLabel(end), reportDateLabel(end))
	if draftCount > 0 {
		pronoun := "them"
		if draftCount == 1 {
			pronoun = "it"
		}
		detail = fmt.Sprintf("มีใบแจ้งหนี้ฉบับร่าง %d ใบที่มีวันที่ในหรือก่อน %s หากออกหลังล็อกขณะที่วันออกยังอยู่ในงวดที่ล็อก การออกจะไม่ผ่าน / %s dated on or before %s. Issuing %s after the lock fails while the issue date stays in the locked period.", draftCount, reportDateLabel(end), reportNoun(draftCount, "draft invoice is", "draft invoices are"), reportDateLabel(end), pronoun)
	}
	if laterDrafts > 0 {
		verb := "stay"
		if laterDrafts == 1 {
			verb = "stays"
		}
		detail += fmt.Sprintf(" ใบร่าง %d ใบที่ลงวันที่หลัง %s ยังเปิดอยู่ / %s after %s %s open.", laterDrafts, reportDateLabel(end), reportNoun(laterDrafts, "draft invoice dated", "draft invoices dated"), reportDateLabel(end), verb)
	}
	item("draft_invoices", "ใบแจ้งหนี้ฉบับร่าง / Draft invoices", detail, draftCount, draftAmount, "/finance?status=draft", state(draftCount))
	detail = "ไม่มีเคลมที่ส่งแล้วรออนุมัติ / No submitted expense claim is waiting for approval."
	if submitted > 0 {
		th, en := "", ""
		if own > 0 {
			th = " คุณอนุมัติเคลมของตัวเองไม่ได้"
			en = " You cannot approve your own claim."
		}
		detail = fmt.Sprintf("มีเคลมที่ส่งแล้ว %d รายการรออนุมัติ%s / %s waiting for approval.%s", submitted, th, reportNoun(submitted, "submitted expense claim is", "submitted expense claims are"), en)
	}
	href := "/expenses?tab=approve"
	if submitted > 0 && submitted == own {
		href = "/expenses"
	}
	item("expense_claims", "เคลมรออนุมัติ / Expense claims awaiting approval", detail, submitted, nil, href, state(submitted))
	if len(missing) > 0 {
		detail = "Missing " + strings.Join(missing, ", ") + ". ยังขาด " + strings.Join(missingTH, ", ") + "."
	} else {
		th, en, status := "ยังไม่จดทะเบียน เอกสารเหล่านี้เป็นใบแจ้งหนี้สำหรับงานปฏิบัติการ", "These documents stay operational invoices.", "not registered"
		if taxStatus == "registered" {
			th = "จดทะเบียนแล้ว การบันทึกข้อมูลนี้ไม่ได้ทำให้เอกสารเป็นใบกำกับภาษีตามกฎหมาย"
			en = "Saving the profile does not make a document a statutory tax invoice."
			status = "registered"
		}
		detail = "ชื่อผู้ขาย ที่อยู่ เลขผู้เสียภาษี 13 หลัก และสาขาครบแล้ว สถานะจด VAT บันทึกเป็น" + th + " / Seller name, address, 13-digit tax ID, and branch are filled. VAT registration is recorded as " + status + ". " + en
	}
	item("tax_profile", "ข้อมูลผู้ขาย / Seller profile", detail, len(missing), nil, "/finance/business-profile", state(len(missing)))
	detail = fmt.Sprintf("ภาษีขายคืองบใบแจ้งหนี้ที่ออกใน %s หักใบลดหนี้ในเดือนนั้น ภาษีซื้อคือบิลผู้ขายที่จับคู่ในเดือนนั้น / Output VAT is issued-invoice VAT in %s minus credit notes in that month. Input VAT is matched vendor bills in %s. %s %s", reportMonthLabel(input.Month), reportMonthLabel(input.Month), input.Month, reportVatSupportEn, reportVatSupportTh)
	item("vat_support", "ข้อมูล VAT / VAT support", detail, 0, nil, "/reports#purchase-vat", "info")
	items[len(items)-1]["outputVatSatang"] = outputVAT
	items[len(items)-1]["inputVatSatang"] = inputVAT
	if closed {
		detail = fmt.Sprintf("ล็อกถึง %s. เอกสารและใบเสร็จในวันที่นั้นหรือก่อนหน้านั้นถูกบล็อก / Locked through %s. Documents and receipts dated on or before that date stay blocked.", reportDateLabel(lock), reportDateLabel(lock))
	} else if lock != "" {
		detail = fmt.Sprintf("ล็อกถึง %s แล้ว การปิด %s จะขยายการบล็อกถึง %s / Locked through %s. Documents and receipts on or before that date are already blocked. Closing %s extends the block through %s.", reportDateLabel(lock), reportMonthLabel(input.Month), reportDateLabel(end), reportDateLabel(lock), input.Month, reportDateLabel(end))
	} else {
		detail = fmt.Sprintf("ยังไม่กำหนดวันล็อก การปิด %s จะบล็อกการออกใบแจ้งหนี้ ใบเสร็จ และการแก้ไขที่มีวันที่ในหรือก่อน %s / No lock date is set. Closing %s blocks invoice issues, receipts, and corrections dated on or before %s.", reportMonthLabel(input.Month), reportDateLabel(end), input.Month, reportDateLabel(end))
	}
	item("finance_lock", "ล็อกงวด / Finance lock", detail, 0, nil, "/settings/finance", "info")
	review := 0
	for _, row := range items {
		if row["state"] == "review" {
			review++
		}
	}
	boundary := "It is not a general-ledger close or a tax filing."
	summary := ""
	switch {
	case !closable && !closed:
		summary = fmt.Sprintf("งวด %s ยังไม่จบ / Close a completed month. The current month stays open. %s", reportMonthLabel(input.Month), boundary)
	case closed:
		open := "ไม่มีรายการในรายการนี้ที่ยังเปิดอยู่ / Nothing on this list is still open."
		if review > 0 {
			open = reportNoun(review, "item", "items") + " on this list stayed open. ล็อกแล้วไม่ได้ล้างรายการนี้ / The lock does not clear them."
		}
		summary = fmt.Sprintf("งวด %s ล็อกแล้ว / This month is already locked through %s. %s การแก้ไขในวันล็อกหรือก่อนหน้านั้นถูกบล็อก / Edits on or before the lock date are blocked. %s", reportMonthLabel(input.Month), reportDateLabel(lock), open, boundary)
	case review == 0:
		summary = fmt.Sprintf("พร้อมปิดงวด %s / Nothing in this list still needs review. An owner or admin can close it in finance settings. The lock then blocks documents and receipts dated on or before %s. %s", reportMonthLabel(input.Month), reportDateLabel(end), boundary)
	default:
		summary = fmt.Sprintf("ตรวจก่อนปิดงวด %s / %s review. An owner or admin can still set the lock. The lock blocks documents and receipts dated on or before %s. The lock does not clear this list. %s", reportMonthLabel(input.Month), reportNoun(review, "item still needs", "items still need"), reportDateLabel(end), boundary)
	}
	return erpwire.Row{"month": input.Month, "periodEnd": end, "today": input.Today, "summary": summary, "ready": review == 0, "closable": closable, "alreadyClosed": closed, "reviewCount": review, "items": items}, nil
}
