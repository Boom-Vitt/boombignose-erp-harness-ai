package erpdata

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
)

var toolRoutes = map[string]string{"list_clients": "/clients", "list_deals": "/deals", "list_quotes": "/quotes", "list_projects": "/projects", "list_invoices": "/finance", "list_payment_claims": "/finance/receipts", "finance_summary": "/finance"}
var metricLabels = map[string]erpwire.Label{
	"amount": {English: "Payable amount", Thai: "ยอดที่ต้องชำระ"}, "outstanding": {English: "Outstanding", Thai: "ยอดค้างชำระ"}, "paid": {English: "Verified receipts", Thai: "ยอดรับที่ตรวจสอบแล้ว"}, "credited": {English: "Applied credits (not cash)", Thai: "ยอดลดหนี้ที่ใช้แล้ว ไม่ใช่เงินสด"},
	"cash_balance": {English: "Recorded cash setting", Thai: "ยอดเงินสดที่ตั้งไว้"}, "monthly_burn": {English: "Monthly burn setting or current-month cost fallback", Thai: "ค่าใช้จ่ายต่อเดือนที่ตั้งไว้ หรือรายการเดือนนี้"}, "invoiced_total": {English: "Net invoiced total", Thai: "ยอดออกใบแจ้งหนี้สุทธิ"}, "verified_paid": {English: "Verified payments", Thai: "ยอดชำระที่ตรวจสอบแล้ว"}, "unpaid": {English: "Issued outstanding total", Thai: "ยอดค้างชำระที่ออกแล้ว"}, "costs_total": {English: "Recorded costs", Thai: "ต้นทุนที่บันทึก"}, "mrr": {English: "Monthly recurring revenue", Thai: "รายได้ประจำต่อเดือน"}, "open_quotes": {English: "Open quotation value", Thai: "มูลค่าใบเสนอราคาที่ยังเปิด"}, "pipeline": {English: "Open deal pipeline", Thai: "มูลค่าดีลที่ยังเปิด"}, "pending_claims": {English: "Pending payment claims", Thai: "ยอดแจ้งชำระที่รอตรวจ"},
	"issued_unpaid_count": {English: "Issued unpaid invoices", Thai: "ใบแจ้งหนี้ที่ออกแล้วและยังค้าง"}, "unpaid_invoice_count": {English: "Unpaid invoices", Thai: "ใบแจ้งหนี้ค้างชำระ"}, "open_quotes_count": {English: "Open quotations", Thai: "ใบเสนอราคาที่ยังเปิด"}, "pending_claims_count": {English: "Pending claims", Thai: "รายการแจ้งชำระที่รอตรวจ"},
}

func title(s string) string { return strings.ReplaceAll(s, "_", " ") }
func fact(key string, label erpwire.Label, value, scope, href string) erpwire.SourceFact {
	return erpwire.SourceFact{ID: key, Label: label, Value: value, Scope: scope, Href: href}
}
func identity(e entity, row erpwire.Row) (string, string, string, []string) {
	record := map[string]any{}
	ids := []string{}
	for _, k := range e.PrimaryKey {
		record[k] = row[k]
		if s, ok := row[k].(string); ok && uuid.Validate(s) == nil {
			ids = append(ids, s)
		}
	}
	b, _ := json.Marshal(record)
	tag := hash(e.Key + ":" + string(b))[:24]
	label := string(b)
	for _, k := range []string{"number", "name", "title", "sku", "filename"} {
		if s, ok := row[k].(string); ok && s != "" {
			label = s
			break
		}
	}
	href := ""
	if id, ok := row["id"].(string); ok && uuid.Validate(id) == nil && e.Route != "" {
		href = strings.ReplaceAll(e.Route, "{id}", id)
	}
	return tag, label, href, ids
}
func (r *Reader) rowsEvidence(a erpwire.Actor, name string, e entity, rows []erpwire.Row, total *int64, offset int, content []byte) erpwire.Evidence {
	returned := int64(len(rows))
	s := erpwire.AssistantSource{Kind: "erp", Label: name, Href: toolRoutes[name], Entity: e.Key, ObservedAt: r.now(), Total: total, Returned: &returned, Partial: offset > 0 || (total != nil && int64(offset+len(rows)) < *total), Records: []erpwire.SourceRecord{}, Facts: []erpwire.SourceFact{}}
	if total != nil {
		s.Facts = append(s.Facts, fact("total", erpwire.Label{English: e.LabelEn + " · Matching accessible records", Thai: e.LabelTh + " · รายการที่อ่านได้ตรงเงื่อนไข"}, fmt.Sprint(*total), "matching-records", ""))
	}
	seen := map[string]bool{}
	for _, row := range rows {
		tag, label, href, ids := identity(e, row)
		for _, id := range ids {
			if !seen[id] {
				s.RecordIDs = append(s.RecordIDs, id)
				seen[id] = true
			}
		}
		if href != "" {
			s.Records = append(s.Records, erpwire.SourceRecord{Label: label, Href: href})
		}
		keys := make([]string, 0, len(row))
		for k := range row {
			if k != "_text" {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		pointers, _ := row["_text"].(map[string]any)
		for _, k := range keys {
			v := row[k]
			if v == nil || strings.HasSuffix(k, "_thb") {
				continue
			}
			f, known := e.field(k)
			metric := strings.TrimSuffix(k, "_satang")
			ml, metricKnown := metricLabels[metric]
			if !known && !metricKnown {
				continue
			}
			value := fmt.Sprint(v)
			labelEn, labelTh := f.LabelEn, f.LabelTh
			if !known {
				labelEn = ml.English
				labelTh = ml.Thai
			}
			if strings.HasSuffix(k, "_satang") {
				if n, err := integer(v); err == nil {
					value = moneyString(n)
					if metricKnown {
						labelEn = ml.English
						labelTh = ml.Thai
					} else {
						labelEn = title(metric) + " (THB)"
						labelTh = strings.ReplaceAll(labelTh, "สตางค์", "บาท")
					}
				}
			}
			if name == "list_payment_claims" && k == "amount_satang" {
				labelEn = "Claimed amount (not verified cash)"
				labelTh = "ยอดที่แจ้งชำระ ยังไม่ใช่เงินรับที่ยืนยันแล้ว"
			}
			if k == "status" && name == "list_invoices" {
				if v == "partially_paid" {
					value = "partially settled (receipts and/or credits)"
				}
				if v == "paid" {
					value = "settled (receipts and/or credits)"
				}
				labelEn = "Settlement status"
				labelTh = "สถานะยอดค้าง"
			}
			if p, ok := pointers[k].(map[string]any); ok {
				labelEn += " (text preview; full text available)"
				labelTh += " (ข้อความตัวอย่าง อ่านฉบับเต็มได้)"
				if p["has_more"] == true {
					s.Partial = true
				}
			}
			sf := fact("row:"+tag+":"+k, erpwire.Label{English: label + " · " + labelEn, Thai: label + " · " + labelTh}, value, "record", href)
			sf.RecordPresence = "present"
			s.Facts = append(s.Facts, sf)
		}
	}
	return erpwire.Evidence{Key: a.OrgID() + ":" + name + ":" + hash(string(content)), Source: s}
}
func (r *Reader) textEvidence(a erpwire.Actor, e entity, record map[string]any, key, text string, partial bool, content []byte, read bool) erpwire.Evidence {
	tag, _, href, ids := identity(e, erpwire.Row(record))
	s := erpwire.AssistantSource{Kind: "erp", Label: "erp_data_text", Entity: e.Key, ObservedAt: r.now(), Partial: partial, RecordIDs: ids, Records: []erpwire.SourceRecord{}, Facts: []erpwire.SourceFact{fact("row:"+tag+":reference", erpwire.Label{English: e.LabelEn + " · Source record", Thai: e.LabelTh + " · รายการต้นทาง"}, fmt.Sprint(record), "record", href)}}
	var p map[string]any
	_ = json.Unmarshal(content, &p)
	s.Facts = append(s.Facts, fact("row:"+tag+":read-range", erpwire.Label{English: "Read text range / full length (Unicode code points)", Thai: "ช่วงข้อความที่อ่าน / ความยาวเต็ม (Unicode code points)"}, fmt.Sprintf("%v–%v / %v", p["offset"], p["next_offset"], p["total_length"]), "record", href))
	ev := erpwire.Evidence{Key: a.OrgID() + ":erp_data_text:" + hash(string(content)), Source: s}
	if read {
		ev.ReadText = &erpwire.ReadText{Label: e.LabelEn + " · " + key, Text: text, Partial: partial, ObservedAt: r.now()}
		ev.Source.TextSHA256 = hash(text)
	}
	return ev
}
func metrics(s *erpwire.AssistantSource, m map[string]any, prefix, scope string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	ids := []string{}
	for _, k := range keys {
		metric := strings.TrimSuffix(k, "_satang")
		label, ok := metricLabels[metric]
		if !ok {
			continue
		}
		n, err := integer(m[k])
		if err != nil {
			continue
		}
		value := fmt.Sprint(n)
		if strings.HasSuffix(k, "_satang") {
			value = moneyString(n)
		}
		id := prefix + metric
		s.Facts = append(s.Facts, fact(id, label, value, scope, ""))
		ids = append(ids, id)
	}
	return ids
}
func (r *Reader) financeEvidence(a erpwire.Actor, name string, m map[string]any, content []byte) erpwire.Evidence {
	s := erpwire.AssistantSource{Kind: "erp", Label: name, Href: "/finance", ObservedAt: r.now(), Records: []erpwire.SourceRecord{}, Facts: []erpwire.SourceFact{}}
	metrics(&s, m, "", "workspace")
	return erpwire.Evidence{Key: a.OrgID() + ":" + name + ":" + hash(string(content)), Source: s}
}
func (r *Reader) invoiceFacts(ev *erpwire.Evidence, summary, coverage map[string]any, coverageRows []any, rows []erpwire.Row) {
	metrics(&ev.Source, summary, "summary:", "matching-records")
	ids := metrics(&ev.Source, map[string]any{"issued_unpaid_count": coverage["invoice_count"], "outstanding_satang": coverage["outstanding_satang"]}, "coverage:", "workspace")
	seen := map[string]bool{}
	for _, row := range rows {
		tag, _, _, _ := identity(r.byKey["invoices"], row)
		seen[tag] = true
	}
	for _, v := range coverageRows {
		row := v.(erpwire.Row)
		tag, _, _, _ := identity(r.byKey["invoices"], row)
		if !seen[tag] {
			extra := r.rowsEvidence(erpwire.Actor{}, "list_invoices", r.byKey["invoices"], []erpwire.Row{row}, nil, 0, nil)
			ev.Source.Facts = append(ev.Source.Facts, extra.Source.Facts...)
			ev.Source.Records = append(ev.Source.Records, extra.Source.Records...)
			ev.Source.RecordIDs = append(ev.Source.RecordIDs, extra.Source.RecordIDs...)
			seen[tag] = true
		}
		ids = append(ids, "row:"+tag+":outstanding_satang")
	}
	ev.Source.Coverage = &erpwire.Coverage{FactIDs: ids, Partial: coverage["has_more"] == true}
	ev.Source.RequiredFactIDs = append([]string(nil), ids[:2]...)
}
