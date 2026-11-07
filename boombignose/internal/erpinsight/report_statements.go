package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func reportAging(asOf string, rows []struct {
	due    string
	amount int64
}) (erpwire.Row, error) {
	buckets := erpwire.Row{"current": int64(0), "days1to30": int64(0), "days31to60": int64(0), "days61to90": int64(0), "days91plus": int64(0)}
	end, endErr := time.Parse("2006-01-02", asOf)
	for _, row := range rows {
		if row.amount <= 0 {
			continue
		}
		late := 0
		due, err := time.Parse("2006-01-02", row.due)
		if err == nil && endErr == nil {
			late = int(end.Sub(due).Hours() / 24)
		}
		bucket := "current"
		switch {
		case late > 90:
			bucket = "days91plus"
		case late > 60:
			bucket = "days61to90"
		case late > 30:
			bucket = "days31to60"
		case late > 0:
			bucket = "days1to30"
		}
		amount, err := reportSum(buckets[bucket].(int64), row.amount)
		if err != nil {
			return nil, err
		}
		buckets[bucket] = amount
	}
	return buckets, nil
}
func (s *Service) reportStatements(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := reportParams(raw)
	if err != nil {
		return nil, err
	}
	if !erpwire.Can(a.Role(), "profit:view") {
		return erpwire.Row{"allowed": false, "message": "คุณไม่มีสิทธิ์ดูรายงานนี้ / You do not have access to these reports."}, nil
	}
	month := params["month"]
	start, e := time.Parse("2006-01", month)
	if e != nil || start.Year() == 0 {
		month = s.now().In(reportZone).Format("2006-01")
		start, _ = time.Parse("2006-01", month)
	}
	from, to := start.Format("2006-01-02"), start.AddDate(0, 1, -1).Format("2006-01-02")
	out := erpwire.Row{"allowed": true, "month": month, "asOf": to}
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		load := func(table string, columns []string, where ...erpwire.Predicate) ([]erpwire.Row, error) {
			return all(ctx, tx, selection(a, table, columns, where...))
		}
		invoices, e := load("invoices", []string{"id", "status", "issue_date", "due_date", "total_satang", "vat_satang"})
		if e != nil {
			return e
		}
		bq := selection(a, "invoice_balances", []string{"invoice_id", "outstanding_satang"})
		bq.Order = []erpwire.Order{{Column: "invoice_id"}}
		balances, e := all(ctx, tx, bq)
		if e != nil {
			return e
		}
		costs, e := load("costs", []string{"incurred_on", "due_date", "paid_at", "amount_satang", "input_vat_satang"})
		if e != nil {
			return e
		}
		settings, e := one(ctx, tx, selection(a, "org_settings", []string{"cash_balance_satang"}))
		if e != nil {
			return e
		}
		cq := selection(a, "monthly_inventory_cogs", []string{"month", "amount_satang"}, erpwire.Predicate{Column: "month", Op: erpwire.GreaterEqual, Value: from}, erpwire.Predicate{Column: "month", Op: erpwire.LessEqual, Value: to})
		cq.Order = []erpwire.Order{{Column: "month"}}
		cogs, e := all(ctx, tx, cq)
		if e != nil {
			return e
		}
		outstanding := map[string]int64{}
		for _, row := range balances {
			v, e := reportNumber(row["outstanding_satang"], "Invoice balance", false)
			if e != nil {
				return e
			}
			outstanding[text(row["invoice_id"])] = v
		}
		profit := erpwire.Row{"revenueSatang": int64(0), "outputVatSatang": int64(0), "cogsSatang": int64(0), "expenseSatang": int64(0), "inputVatSatang": int64(0)}
		add := func(key string, value int64) error {
			sum, e := reportSum(profit[key].(int64), value)
			if e != nil {
				return e
			}
			profit[key] = sum
			return nil
		}
		var receivables, payables int64
		ar, ap := []struct {
			due    string
			amount int64
		}{}, []struct {
			due    string
			amount int64
		}{}
		for _, row := range invoices {
			issue, status := text(row["issue_date"]), text(row["status"])
			total, e := reportNumber(row["total_satang"], "Invoice total", false)
			if e != nil {
				return e
			}
			vat, e := reportNumber(row["vat_satang"], "Invoice VAT", false)
			if e != nil {
				return e
			}
			net, e := reportSum(total, -vat)
			if e != nil {
				return e
			}
			issued := has([]string{"sent", "partially_paid", "paid", "overdue"}, status)
			if issued && issue >= from && issue <= to {
				if e = add("revenueSatang", net); e != nil {
					return e
				}
				if e = add("outputVatSatang", vat); e != nil {
					return e
				}
			}
			if issued && issue <= to {
				receivables, e = reportSum(receivables, outstanding[text(row["id"])])
				if e != nil {
					return e
				}
			}
			if status != "draft" && status != "cancelled" && issue <= to {
				ar = append(ar, struct {
					due    string
					amount int64
				}{text(row["due_date"]), outstanding[text(row["id"])]})
			}
		}
		for _, row := range costs {
			incurred := text(row["incurred_on"])
			if row["incurred_on"] == nil {
				incurred = from
			}
			total, e := reportNumber(row["amount_satang"], "Cost total", false)
			if e != nil {
				return e
			}
			vat, e := reportNumber(row["input_vat_satang"], "Input VAT", false)
			if e != nil {
				return e
			}
			net, e := reportSum(total, -vat)
			if e != nil {
				return e
			}
			paid := text(row["paid_at"]) != ""
			payable := total
			if paid {
				payable = 0
			}
			if incurred >= from && incurred <= to {
				if e = add("expenseSatang", net); e != nil {
					return e
				}
				if e = add("inputVatSatang", vat); e != nil {
					return e
				}
			}
			if incurred <= to {
				ap = append(ap, struct {
					due    string
					amount int64
				}{text(row["due_date"]), payable})
				if !paid {
					payables, e = reportSum(payables, payable)
					if e != nil {
						return e
					}
				}
			}
		}
		for _, row := range cogs {
			v, e := reportNumber(row["amount_satang"], "COGS", false)
			if e != nil {
				return e
			}
			if e = add("cogsSatang", v); e != nil {
				return e
			}
		}
		profitValue, e := reportSum(profit["revenueSatang"].(int64), -profit["cogsSatang"].(int64), -profit["expenseSatang"].(int64))
		if e != nil {
			return e
		}
		profit["profitSatang"] = profitValue
		cash, e := reportNumber(reportDefaultNumber(settings["cash_balance_satang"]), "Cash balance", false)
		if e != nil {
			return e
		}
		netVAT, e := reportSum(profit["outputVatSatang"].(int64), -profit["inputVatSatang"].(int64))
		if e != nil {
			return e
		}
		agingAR, e := reportAging(to, ar)
		if e != nil {
			return e
		}
		agingAP, e := reportAging(to, ap)
		if e != nil {
			return e
		}
		out["profit"] = profit
		out["balance"] = erpwire.Row{"cashSatang": cash, "receivablesSatang": receivables, "payablesSatang": payables, "balances": false}
		out["vat"] = erpwire.Row{"outputVatSatang": profit["outputVatSatang"], "inputVatSatang": profit["inputVatSatang"], "netVatSatang": netVAT}
		out["receivableAging"] = agingAR
		out["payableAging"] = agingAP
		return nil
	})
	if err != nil {
		if reportSafeError(err) {
			return nil, err
		}
		return nil, errors.New("Support reports unavailable. Reload before relying on totals.")
	}
	return out, nil
}
