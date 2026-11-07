package erpledger

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func monthEnd(month string) string {
	if !monthPattern.MatchString(month) {
		return ""
	}
	t, e := time.Parse("2006-01", month)
	if e != nil || t.Year() < 100 {
		return ""
	}
	return t.AddDate(0, 1, -1).Format("2006-01-02")
}
func closeWindow(requested string) (string, string, error) {
	if requested == "" {
		now := time.Now().In(bangkok)
		requested = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, bangkok).AddDate(0, -1, 0).Format("2006-01")
	}
	end := monthEnd(requested)
	if end == "" {
		return "", "", businessError("Enter a month as YYYY-MM.")
	}
	return requested, end, nil
}
func inWindow(date, through string) bool { return through == "" || validDate(date) && date <= through }
func addTotal(row erpwire.Row, key string, v money.Satang) error {
	var current money.Satang
	if row[key] != nil {
		current = row[key].(money.Satang)
	}
	total, e := sum(current, v)
	if e == nil {
		row[key] = total
	}
	return e
}
func zeroTotals(keys ...string) erpwire.Row {
	r := erpwire.Row{}
	for _, k := range keys {
		r[k] = money.Satang(0)
	}
	return r
}
func increment(r erpwire.Row, key string) { n, _ := r[key].(int); r[key] = n + 1 }
func openStatus(s string) bool {
	return has([]string{"ready", "ambiguous", "unmatched", "money_out"}, s)
}

func classifyBank(lines, payments []erpwire.Row, through string) ([]erpwire.Row, error) {
	taken := map[string]bool{}
	for _, line := range lines {
		if id := text(line["matched_payment_id"]); id != "" {
			taken[id] = true
		}
	}
	out := []erpwire.Row{}
	for _, line := range lines {
		amount, e := satang(line["amount_satang"])
		if e != nil {
			return nil, e
		}
		status := "unmatched"
		var suggested any
		if text(line["matched_payment_id"]) != "" {
			status = "matched"
		} else if trim(text(line["close_note"])) != "" {
			status = "explained"
		} else {
			hits := []string{}
			reference := trim(text(line["reference"]))
			if reference != "" && amount != 0 {
				for _, p := range payments {
					v, e := satang(p["amount_satang"])
					if e != nil {
						return nil, e
					}
					id := text(p["id"])
					if p["verification_state"] == "verified" && p["reversal_of"] == nil && !taken[id] && v == amount && trim(text(p["verification_reference"])) == reference {
						hits = append(hits, id)
					}
				}
			}
			if len(hits) == 1 {
				status = "ready"
				suggested = hits[0]
			} else if len(hits) > 1 {
				status = "ambiguous"
			} else if amount < 0 {
				status = "money_out"
			}
		}
		out = append(out, erpwire.Row{"id": line["id"], "bookedOn": line["booked_on"], "amountSatang": amount, "reference": line["reference"], "matchedPaymentId": line["matched_payment_id"], "closeNote": line["close_note"], "status": status, "suggestedPaymentId": suggested, "blocksClose": inWindow(text(line["booked_on"]), through) && openStatus(status)})
	}
	return out, nil
}
func bankSummary(lines []erpwire.Row, through string) (erpwire.Row, error) {
	out := zeroTotals("openNetSatang", "explainedNetSatang", "matchedNetSatang")
	out["periodEnd"] = nullable(through)
	for _, key := range []string{"openCount", "readyCount", "ambiguousCount", "unmatchedCount", "moneyOutCount", "explainedCount", "matchedCount", "laterOpenCount"} {
		out[key] = 0
	}
	for _, line := range lines {
		status := text(line["status"])
		date := text(line["bookedOn"])
		if !inWindow(date, through) {
			if validDate(date) && date > through && openStatus(status) {
				increment(out, "laterOpenCount")
			}
			continue
		}
		amount := line["amountSatang"].(money.Satang)
		if line["blocksClose"] == true {
			increment(out, "openCount")
			if e := addTotal(out, "openNetSatang", amount); e != nil {
				return nil, e
			}
			key := map[string]string{"ready": "readyCount", "ambiguous": "ambiguousCount", "unmatched": "unmatchedCount", "money_out": "moneyOutCount"}[status]
			increment(out, key)
		}
		if status == "explained" || status == "matched" {
			increment(out, status+"Count")
			if e := addTotal(out, status+"NetSatang", amount); e != nil {
				return nil, e
			}
		}
	}
	return out, nil
}
func (s *Service) bankPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "profit:view") != nil {
		return erpwire.Row{"error": "เฉพาะเจ้าของ ผู้ดูแล และนักบัญชี / Only owners, admins, and accountants can reconcile bank lines."}, nil
	}
	params, e := paramsInput(raw)
	if e != nil {
		return nil, e
	}
	month, through := "", ""
	allDates := text(params["through"]) == "all"
	if !allDates {
		month, through, e = closeWindow(text(params["through"]))
		if e != nil {
			return erpwire.Row{"error": e.Error()}, nil
		}
	}
	queue := text(params["queue"])
	if !has([]string{"explained", "matched", "all"}, queue) {
		queue = "open"
	}
	var classified []erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		lines, e := all(ctx, tx, erpwire.Select{Table: "bank_lines", Columns: []string{"id", "booked_on", "amount_satang", "reference", "matched_payment_id", "close_note"}, Where: scope(a), Order: []erpwire.Order{order("booked_on", true), order("id", false)}})
		if e != nil {
			return e
		}
		payments, e := rows(ctx, tx, a, "payments", []string{"id", "amount_satang", "verification_reference", "verification_state", "reversal_of"})
		if e != nil {
			return e
		}
		classified, e = classifyBank(lines, payments, through)
		return e
	})
	if e != nil {
		return nil, e
	}
	summary, e := bankSummary(classified, through)
	if e != nil {
		return nil, e
	}
	visible := []erpwire.Row{}
	for _, line := range classified {
		if inWindow(text(line["bookedOn"]), through) && (queue == "all" || queue == "open" && line["blocksClose"] == true || line["status"] == queue) {
			visible = append(visible, line)
		}
	}
	window := erpwire.Row{"ok": true, "scope": "month", "month": month, "periodEnd": nullable(through)}
	throughParam := month
	if allDates {
		window["scope"] = "all"
		window["month"] = nil
		throughParam = "all"
	}
	return erpwire.Row{"today": today(), "through": window, "throughParam": throughParam, "queue": queue, "classified": classified, "summary": summary, "visible": visible}, nil
}

func cashTruth(asOf string, recorded any, receipts, costs, lines []erpwire.Row) (erpwire.Row, error) {
	if !validDate(asOf) {
		return erpwire.Row{"ok": false, "error": "Enter the close date as YYYY-MM-DD."}, nil
	}
	balance, e := satang(recorded)
	if e != nil {
		return erpwire.Row{"ok": false, "error": "Recorded balance is not a whole number of satang."}, nil
	}
	out := zeroTotals("verifiedReceiptsSatang", "paidCostsSatang", "statementNetSatang", "matchedStatementSatang", "openStatementSatang", "explainedStatementSatang", "receiptsWithoutStatementSatang")
	out["asOf"] = asOf
	out["recordedBalanceSatang"] = balance
	for _, key := range []string{"openStatementCount", "explainedStatementCount", "receiptsWithoutStatementCount"} {
		out[key] = 0
	}
	matched := map[string]bool{}
	for _, line := range lines {
		date := text(line["booked_on"])
		if !validDate(date) || date > asOf {
			continue
		}
		v, e := satang(line["amount_satang"])
		if e != nil {
			return nil, errors.New("Unsafe integer-satang sum")
		}
		if e = addTotal(out, "statementNetSatang", v); e != nil {
			return nil, e
		}
		key := "openStatement"
		id := text(line["matched_payment_id"])
		if id != "" {
			matched[id] = true
			key = "matchedStatement"
		} else if trim(text(line["close_note"])) != "" {
			key = "explainedStatement"
		}
		if e = addTotal(out, key+"Satang", v); e != nil {
			return nil, e
		}
		if key != "matchedStatement" {
			increment(out, key+"Count")
		}
	}
	for _, receipt := range receipts {
		date := dateOnly(text(receipt["paid_at"]))
		if receipt["verification_state"] != "verified" || !validDate(date) || date > asOf {
			continue
		}
		v, e := satang(receipt["amount_satang"])
		if e != nil {
			return nil, errors.New("Unsafe integer-satang sum")
		}
		if e = addTotal(out, "verifiedReceiptsSatang", v); e != nil {
			return nil, e
		}
		if !matched[text(receipt["id"])] {
			increment(out, "receiptsWithoutStatementCount")
			if e = addTotal(out, "receiptsWithoutStatementSatang", v); e != nil {
				return nil, e
			}
		}
	}
	for _, cost := range costs {
		date := dateOnly(text(cost["paid_at"]))
		if cost["paid_at"] == nil || !validDate(date) || date > asOf {
			continue
		}
		v, e := satang(cost["amount_satang"])
		if e != nil {
			return nil, errors.New("Unsafe integer-satang sum")
		}
		if e = addTotal(out, "paidCostsSatang", v); e != nil {
			return nil, e
		}
	}
	cash, e := sum(out["verifiedReceiptsSatang"].(money.Satang), -out["paidCostsSatang"].(money.Satang))
	if e != nil {
		return nil, e
	}
	difference, e := sum(balance, -cash)
	if e != nil {
		return nil, e
	}
	out["cashInSystemSatang"] = cash
	out["differenceSatang"] = difference
	return erpwire.Row{"ok": true, "truth": out}, nil
}
func (s *Service) cashPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "profit:view") != nil {
		return erpwire.Row{"error": "เฉพาะเจ้าของ ผู้ดูแล และนักบัญชี / Only owners, admins, and accountants can review cash at close."}, nil
	}
	params, e := paramsInput(raw)
	if e != nil {
		return nil, e
	}
	month, end, e := closeWindow(text(params["month"]))
	if e != nil {
		return erpwire.Row{"error": e.Error()}, nil
	}
	var truth erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		setting, e := settings(ctx, tx, a, "cash_balance_satang")
		if e != nil {
			return readFailure(e, "Cash at close is unavailable. Reload before relying on totals.")
		}
		receipts, e := rows(ctx, tx, a, "payments", []string{"id", "amount_satang", "paid_at", "verification_state"})
		if e != nil {
			return e
		}
		costs, e := rows(ctx, tx, a, "costs", []string{"id", "amount_satang", "paid_at"})
		if e != nil {
			return e
		}
		lines, e := rows(ctx, tx, a, "bank_lines", []string{"id", "booked_on", "amount_satang", "matched_payment_id", "close_note"})
		if e != nil {
			return e
		}
		balance := setting["cash_balance_satang"]
		if balance == nil {
			balance = int64(0)
		}
		truth, e = cashTruth(end, balance, receipts, costs, lines)
		return e
	})
	if e != nil {
		return nil, e
	}
	return erpwire.Row{"today": today(), "window": erpwire.Row{"ok": true, "month": month, "periodEnd": end}, "result": truth}, nil
}
