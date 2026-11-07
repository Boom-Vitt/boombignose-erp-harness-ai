package erpinvoicing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var invoiceExportHeaders = []string{"Invoice ID", "Number", "Client", "Stored status", "Effective status", "Amount (THB)", "Discount (THB)", "Verified receipts (THB)", "Outstanding (THB)", "Due date", "Issue date", "Source quote ID", "Source milestone ID", "Credit notes (THB)", "Net due (THB)"}
var paymentExportHeaders = []string{"Receipt ID", "Invoice ID", "Verification state", "Amount (THB)", "Recorded payment instant", "Evidence reference", "Method", "Reconciled receipt ID"}
var outstandingExportHeaders = []string{"Side", "Document ID", "Number", "Party", "Document date", "Due date", "Amount (THB)", "Days past due", "Aging bucket", "Status"}
var financeCSVNumber = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$`)

func financeCSV(headers []string, rows [][]string) string {
	escape := func(cell string) string {
		if cell != "" && strings.ContainsRune("=+-@\t\r", rune(cell[0])) && !financeCSVNumber.MatchString(cell) {
			cell = "'" + cell
		}
		if strings.ContainsAny(cell, ",\"\n\r") {
			cell = "\"" + strings.ReplaceAll(cell, "\"", "\"\"") + "\""
		}
		return cell
	}
	lines := make([]string, 0, len(rows)+1)
	for _, row := range append([][]string{headers}, rows...) {
		cells := make([]string, len(row))
		for i, cell := range row {
			cells[i] = escape(cell)
		}
		lines = append(lines, strings.Join(cells, ","))
	}
	return "\ufeff" + strings.Join(lines, "\r\n")
}
func financeRoute(status int, body string) RouteResponse {
	return RouteResponse{Status: status, Body: []byte(body)}
}
func financeDownload(filename, body string) RouteResponse {
	return RouteResponse{Status: 200, Body: []byte(body), Headers: map[string]string{"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="` + filename + `"`}}
}

func (s *Service) invoiceExport(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	_, params, e := routeArgs(raw)
	if e != nil {
		return nil, e
	}
	selected := text(financeFacets(params)["status"])
	rows := [][]string{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		invoices, e := all(ctx, tx, invoiceQuery(a, []string{"id", "number", "amount_satang", "discount_satang", "status", "due_date", "issue_date", "source_quote_id", "source_milestone_id"}))
		if e != nil {
			return e
		}
		balances, _, e := financeBalanceRows(ctx, tx, a)
		if e != nil {
			return e
		}
		for _, inv := range invoices {
			value, e := amount(inv["amount_satang"])
			if e != nil {
				return e
			}
			discount, e := amount(inv["discount_satang"])
			if e != nil {
				return e
			}
			paid, e := balanceValue(balances[text(inv["id"])], "paid_satang")
			if e != nil {
				return e
			}
			credited, e := balanceValue(balances[text(inv["id"])], "credited_satang")
			if e != nil {
				return e
			}
			effective := status(inv, paid, credited, s.today())
			if selected != "" && !includes(strings.Split(selected, ","), effective) {
				continue
			}
			net, e := sum(value, -credited)
			if e != nil {
				return e
			}
			rows = append(rows, []string{text(inv["id"]), text(inv["number"]), text(object(inv["clients"])["name"]), text(inv["status"]), effective, money.FormatBaht(value), money.FormatBaht(discount), money.FormatBaht(paid), money.FormatBaht(outstanding(value, paid, credited)), text(inv["due_date"]), text(inv["issue_date"]), text(inv["source_quote_id"]), text(inv["source_milestone_id"]), money.FormatBaht(credited), money.FormatBaht(net)})
		}
		return nil
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return financeRoute(503, "Receivables export unavailable"), nil
	}
	return financeDownload("invoices-"+s.today()+".csv", financeCSV(invoiceExportHeaders, rows)), nil
}

func (s *Service) paymentExport(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	if _, _, e := routeArgs(raw); e != nil {
		return nil, e
	}
	rows := [][]string{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		payments, e := all(ctx, tx, erpwire.Select{Table: "payments", Columns: []string{"id", "invoice_id", "verification_state", "amount_satang", "paid_at", "verification_reference", "method", "reconciled_payment_id"}, Where: scope(a), Order: []erpwire.Order{{Column: "paid_at", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		for _, payment := range payments {
			v, e := amount(payment["amount_satang"])
			if e != nil {
				return e
			}
			rows = append(rows, []string{text(payment["id"]), text(payment["invoice_id"]), text(payment["verification_state"]), money.FormatBaht(v), text(payment["paid_at"]), text(payment["verification_reference"]), text(payment["method"]), text(payment["reconciled_payment_id"])})
		}
		return nil
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return financeRoute(503, "Receipt evidence export unavailable"), nil
	}
	return financeDownload("receipt-evidence-"+s.today()+".csv", financeCSV(paymentExportHeaders, rows)), nil
}

func financeCalendar(value string) bool {
	date, e := time.Parse("2006-01-02", value)
	return len(value) == 10 && e == nil && date.Year() >= 100 && date.Format("2006-01-02") == value
}
func financeDaysLate(due, asOf string) int64 {
	if !financeCalendar(due) || !financeCalendar(asOf) || due >= asOf {
		return 0
	}
	start, _ := time.Parse("2006-01-02", due)
	end, _ := time.Parse("2006-01-02", asOf)
	return (end.Unix() - start.Unix()) / 86400
}
func financeAging(days int64) string {
	switch {
	case days <= 0:
		return "Not yet due"
	case days <= 30:
		return "1–30 days"
	case days <= 60:
		return "31–60 days"
	case days <= 90:
		return "61–90 days"
	default:
		return "91 days or more"
	}
}

type outstandingLine struct {
	side, id, number, party, date, due, status string
	amount                                     money.Satang
	days                                       int64
}

func financeOutstanding(asOf string, invoices, costs []erpwire.Row, balances map[string]erpwire.Row) ([][]string, error) {
	rows := []outstandingLine{}
	var ar, ap money.Satang
	for _, inv := range invoices {
		issued := text(inv["status"])
		if !includes([]string{"sent", "partially_paid", "paid", "overdue"}, issued) || !financeCalendar(text(inv["issue_date"])) || text(inv["issue_date"]) > asOf {
			continue
		}
		v, e := amount(inv["amount_satang"])
		if e != nil {
			return nil, e
		}
		balance := balances[text(inv["id"])]
		paid, e := balanceValue(balance, "paid_satang")
		if e != nil {
			return nil, e
		}
		credited, e := balanceValue(balance, "credited_satang")
		if e != nil {
			return nil, e
		}
		owed := outstanding(v, paid, credited)
		if balance != nil {
			owed, e = amount(balance["outstanding_satang"])
			if e != nil {
				return nil, e
			}
		}
		if owed <= 0 {
			continue
		}
		due := text(inv["due_date"])
		if !financeCalendar(due) {
			due = ""
		}
		rows = append(rows, outstandingLine{side: "AR", id: text(inv["id"]), number: text(inv["number"]), party: text(object(inv["clients"])["name"]), date: text(inv["issue_date"]), due: due, status: status(inv, paid, credited, asOf), amount: owed, days: financeDaysLate(due, asOf)})
		ar, e = sum(ar, owed)
		if e != nil {
			return nil, e
		}
	}
	for _, cost := range costs {
		if text(cost["vendor_id"]) == "" || cost["expense_claim_id"] != nil || includes([]string{"credit", "return_adjustment"}, text(cost["purchase_cost_kind"])) || !financeCalendar(text(cost["incurred_on"])) || text(cost["incurred_on"]) > asOf {
			continue
		}
		v, e := amount(cost["amount_satang"])
		if e != nil {
			return nil, e
		}
		if v <= 0 {
			continue
		}
		paidOn := dateOnly(text(cost["paid_at"]))
		if financeCalendar(paidOn) && paidOn <= asOf {
			continue
		}
		due := text(cost["due_date"])
		if !financeCalendar(due) {
			due = ""
		}
		stored := "unpaid"
		if financeCalendar(paidOn) {
			stored = "unpaid at close"
		}
		rows = append(rows, outstandingLine{side: "AP", id: text(cost["id"]), number: text(cost["bill_number"]), party: text(cost["vendor"]), date: text(cost["incurred_on"]), due: due, status: stored, amount: v, days: financeDaysLate(due, asOf)})
		ap, e = sum(ap, v)
		if e != nil {
			return nil, e
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.side != b.side {
			return a.side == "AR"
		}
		ad, bd := a.due, b.due
		if ad == "" {
			ad = "9999-99-99"
		}
		if bd == "" {
			bd = "9999-99-99"
		}
		if ad != bd {
			return ad < bd
		}
		return a.id < b.id
	})
	cells := [][]string{}
	for _, row := range rows {
		cells = append(cells, []string{row.side, row.id, row.number, row.party, row.date, row.due, money.FormatBaht(row.amount), strconv.FormatInt(row.days, 10), financeAging(row.days), row.status})
	}
	cells = append(cells, []string{"AR total", "", "", "", "", "", money.FormatBaht(ar), "", "", ""}, []string{"AP total", "", "", "", "", "", money.FormatBaht(ap), "", "", ""})
	return cells, nil
}

func (s *Service) outstandingExport(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	if a.Role() != erpwire.Owner && a.Role() != erpwire.Admin && a.Role() != erpwire.Accountant {
		return financeRoute(403, "Only owners, admins, and accountants can export the outstanding pack."), nil
	}
	_, params, e := routeArgs(raw)
	if e != nil {
		return nil, e
	}
	asOf := text(params["asOf"])
	if asOf != "" && !financeCalendar(asOf) {
		return financeRoute(400, "Enter the close date as YYYY-MM-DD."), nil
	}
	if asOf == "" {
		today, e := time.Parse("2006-01-02", s.today())
		if e != nil {
			return financeRoute(400, "Enter today as YYYY-MM-DD."), nil
		}
		asOf = time.Date(today.Year(), today.Month(), 0, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}
	rows := [][]string{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		query := invoiceQuery(a, []string{"id", "number", "amount_satang", "status", "due_date", "issue_date"})
		query.Order = ordered("id")
		invoices, e := all(ctx, tx, query)
		if e != nil {
			return e
		}
		costs, e := financeRows(ctx, tx, a, "costs", []string{"id", "amount_satang", "incurred_on", "due_date", "paid_at", "vendor", "vendor_id", "expense_claim_id", "purchase_cost_kind", "bill_number"}, nil, "id")
		if e != nil {
			return e
		}
		balances, _, e := financeBalanceRows(ctx, tx, a)
		if e != nil {
			return e
		}
		rows, e = financeOutstanding(asOf, invoices, costs, balances)
		return e
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return financeRoute(503, "Outstanding pack unavailable"), nil
	}
	body := financeCSV(outstandingExportHeaders, rows)
	digest := sha256.Sum256([]byte(body))
	checksum := hex.EncodeToString(digest[:])
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "record_support_export", erpwire.Row{"p_org_id": a.OrgID(), "p_kind": "outstanding_pack_csv", "p_period": asOf, "p_sha256": checksum, "p_bytes": len([]byte(body))})
		return e
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return financeRoute(503, "Support export was not recorded. Reload and try the download again."), nil
	}
	response := financeDownload(fmt.Sprintf("outstanding-pack-%s.csv", asOf), body)
	response.Headers["X-Content-SHA256"] = checksum
	response.Headers["X-Robots-Tag"] = "noindex"
	return response, nil
}
