package erpledger

import (
	"context"
	"encoding/json"
	"math/big"
	"regexp"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type JournalLine struct {
	AccountCode string       `json:"accountCode"`
	Debit       money.Satang `json:"debitSatang"`
	Credit      money.Satang `json:"creditSatang"`
}
type journalPosting struct {
	Date, Memo string
	Lines      []JournalLine
	Treatment  string
}
type vatBucket struct {
	Rate      int64
	Base, VAT money.Satang
}

const journalDenied = "Only owners, admins, and accountants can post a draft journal."
const amountError = "Journal line amount must be integer satang."
const chartError = "Journal line account is not on the chart."
const totalsError = "The stored totals do not match the VAT treatment."
const rateError = "The stored VAT does not match the stated rate."
const invoiceError = "Only an issued operational sales invoice can post."
const invoiceSnapshotError = "The issued snapshot does not match the invoice."
const creditError = "Only an issued credit note can post."
const receiptError = "Only a verified receipt can post."

var accountPattern = regexp.MustCompile(`^[0-9]{4}$`)

func journalDate(date, lock string) error {
	if !validDate(date) {
		return businessError("Enter a journal date.")
	}
	if !validDate(lock) || date > lock {
		return businessError("Post a journal only into a closed period.")
	}
	return nil
}
func journalMemo(memo string) (string, error) {
	memo = trim(memo)
	if length(memo) < 1 || length(memo) > 200 {
		return "", businessError("Enter a journal memo.")
	}
	return memo, nil
}
func journalLines(lines []JournalLine, accounts []string) (money.Satang, error) {
	if len(lines) < 2 || len(lines) > 20 {
		return 0, businessError("A journal needs 2 to 20 lines.")
	}
	var debit, credit money.Satang
	for _, l := range lines {
		if !accountPattern.MatchString(l.AccountCode) || !has(accounts, l.AccountCode) {
			return 0, businessError(chartError)
		}
		if l.Debit < 0 || l.Credit < 0 || l.Debit > money.MaxSafeSatang || l.Credit > money.MaxSafeSatang {
			return 0, businessError(amountError)
		}
		if l.Debit > 0 && l.Credit > 0 {
			return 0, businessError("A journal line is debit or credit, not both.")
		}
		if l.Debit == 0 && l.Credit == 0 {
			return 0, businessError("A journal line needs an amount.")
		}
		var e error
		debit, e = sum(debit, l.Debit)
		if e != nil {
			return 0, e
		}
		credit, e = sum(credit, l.Credit)
		if e != nil {
			return 0, e
		}
	}
	if debit != credit || debit <= 0 {
		return 0, businessError("Journal debits and credits do not balance.")
	}
	return debit, nil
}
func decodeLines(v any) ([]JournalLine, error) {
	items, ok := v.([]any)
	if !ok {
		return nil, businessError("A journal needs 2 to 20 lines.")
	}
	lines := make([]JournalLine, 0, len(items))
	for _, v := range items {
		r := object(v)
		d, e := nonnegative(r["debitSatang"])
		if e != nil {
			return nil, businessError(amountError)
		}
		c, e := nonnegative(r["creditSatang"])
		if e != nil {
			return nil, businessError(amountError)
		}
		lines = append(lines, JournalLine{text(r["accountCode"]), d, c})
	}
	return lines, nil
}
func chart(ctx context.Context, tx selector, a erpwire.Actor) ([]string, error) {
	r, e := all(ctx, tx, erpwire.Select{Table: "gl_accounts", Columns: []string{"code"}, Where: scope(a), Order: []erpwire.Order{order("code", false)}})
	if e != nil {
		return nil, e
	}
	return ids(r, "code"), nil
}
func (s *Service) postDraftJournal(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := actionGate(a, "profit:view", journalDenied); e != nil {
		return failure(e, "")
	}
	input, e := inputObject(raw)
	if e != nil {
		return nil, e
	}
	var lock string
	var accounts []string
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		r, e := settings(ctx, tx, a, "lock_date")
		if e != nil {
			return e
		}
		lock = text(r["lock_date"])
		accounts, e = chart(ctx, tx, a)
		return e
	})
	if e != nil {
		return failure(e, "Draft journal unavailable.")
	}
	if e = journalDate(text(input["entryDate"]), lock); e != nil {
		return invalid(e.Error())
	}
	memo, e := journalMemo(text(input["memo"]))
	if e != nil {
		return invalid(e.Error())
	}
	lines, e := decodeLines(input["lines"])
	if e != nil {
		return invalid(e.Error())
	}
	if _, e = journalLines(lines, accounts); e != nil {
		return invalid(e.Error())
	}
	_, e = s.command(ctx, a, "post_draft_journal", erpwire.Row{"p_entry_date": input["entryDate"], "p_memo": memo, "p_lines": input["lines"]})
	if e != nil {
		return failure(e, "Draft journal unavailable.")
	}
	return success("/finance/journal", "/audit/close")
}

func buckets(v any) ([]vatBucket, bool) {
	items, ok := v.([]any)
	if !ok || len(items) == 0 {
		return nil, false
	}
	out := []vatBucket{}
	for _, item := range items {
		r := object(item)
		rate, e := whole(r["rateBps"])
		if e != nil || rate < -int64(money.MaxSafeSatang) || rate > int64(money.MaxSafeSatang) {
			return nil, false
		}
		base, e := satang(r["baseSatang"])
		if e != nil {
			return nil, false
		}
		vat, e := satang(r["vatSatang"])
		if e != nil {
			return nil, false
		}
		out = append(out, vatBucket{rate, base, vat})
	}
	return out, true
}
func vatAgrees(b vatBucket, inclusive bool) bool {
	if b.Rate < 0 || b.Rate > 10000 || b.Base < 0 || b.VAT < 0 {
		return false
	}
	base := big.NewInt(int64(b.Base))
	den := int64(10000)
	if inclusive {
		base.Add(base, big.NewInt(int64(b.VAT)))
		den += b.Rate
	}
	base.Mul(base, big.NewInt(b.Rate))
	base.Add(base, big.NewInt(den/2))
	base.Quo(base, big.NewInt(den))
	return base.Cmp(big.NewInt(int64(b.VAT))) == 0
}
func vatTotals(value any, inclusive bool) (money.Satang, money.Satang, error) {
	bs, ok := buckets(value)
	if !ok {
		return 0, 0, businessError(totalsError)
	}
	var base, vat money.Satang
	for _, b := range bs {
		if !vatAgrees(b, inclusive) {
			return 0, 0, businessError(rateError)
		}
		var e error
		base, e = sum(base, b.Base)
		if e != nil {
			return 0, 0, businessError(amountError)
		}
		vat, e = sum(vat, b.VAT)
		if e != nil {
			return 0, 0, businessError(amountError)
		}
	}
	return base, vat, nil
}
func snapshotAgrees(snapshot, inv erpwire.Row) bool {
	doc := object(snapshot["document"])
	if doc == nil {
		return false
	}
	for key, column := range map[string]string{"number": "number", "issueDate": "issue_date", "pricesIncludeVat": "prices_include_vat"} {
		if doc[key] != inv[column] {
			return false
		}
	}
	for key, column := range map[string]string{"subtotalSatang": "subtotal_satang", "discountSatang": "discount_satang", "vatSatang": "vat_satang", "totalSatang": "total_satang", "whtSatang": "wht_satang", "whtRateBps": "wht_rate_bps", "amountDueSatang": "amount_satang"} {
		x, e := whole(doc[key])
		y, f := whole(inv[column])
		if e != nil || f != nil || x != y {
			return false
		}
	}
	x, ok := buckets(doc["vatByRate"])
	y, ok2 := buckets(inv["tax_breakdown"])
	if !ok || !ok2 || len(x) != len(y) {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}
func plainSale(inv, snapshot erpwire.Row, lock string, accounts []string) (journalPosting, error) {
	p := journalPosting{Date: text(inv["issue_date"]), Memo: "Issued sales invoice " + text(inv["number"])}
	if text(snapshot["kind"]) != "operational_invoice" || !has([]string{"sent", "partially_paid", "paid", "overdue"}, text(inv["status"])) {
		return p, businessError(invoiceError)
	}
	deposit, e := whole(inv["quote_deposit_satang"])
	deduction, f := whole(inv["quote_deposit_deduction_satang"])
	if text(inv["quote_invoice_kind"]) != "lines" || e != nil || f != nil || deposit != 0 || deduction != 0 {
		return p, businessError("A deposit invoice is not posted.")
	}
	wht, e := whole(inv["wht_satang"])
	rate, f := whole(inv["wht_rate_bps"])
	if e != nil || f != nil || wht != 0 || rate != 0 {
		return p, businessError("Withholding is not posted from the invoice.")
	}
	if !validDate(p.Date) || !snapshotAgrees(snapshot, inv) {
		return p, businessError(invoiceSnapshotError)
	}
	if e = journalDate(p.Date, lock); e != nil {
		return p, e
	}
	values := map[string]money.Satang{}
	for _, key := range []string{"subtotal_satang", "discount_satang", "vat_satang", "total_satang", "amount_satang"} {
		n, e := nonnegative(inv[key])
		if e != nil {
			return p, businessError(amountError)
		}
		values[key] = n
	}
	if values["discount_satang"] > values["subtotal_satang"] {
		return p, businessError(totalsError)
	}
	inclusive := inv["prices_include_vat"] == true
	base, vat, e := vatTotals(inv["tax_breakdown"], inclusive)
	if e != nil {
		return p, e
	}
	total := values["total_satang"]
	gross := base
	if inclusive {
		gross = total
	}
	if vat != values["vat_satang"] || base+vat != total || values["amount_satang"] != total || values["subtotal_satang"]-values["discount_satang"] != gross || total <= 0 {
		return p, businessError(totalsError)
	}
	p.Lines = []JournalLine{{"1130", total, 0}}
	if vat > 0 {
		p.Lines = append(p.Lines, JournalLine{"2130", 0, vat})
	}
	if base > 0 {
		p.Lines = append(p.Lines, JournalLine{"4100", 0, base})
	}
	if length(p.Memo) > 200 {
		return p, businessError("Enter a journal memo.")
	}
	if _, e = journalLines(p.Lines, accounts); e != nil {
		return p, e
	}
	p.Treatment = "no_vat"
	if vat > 0 {
		p.Treatment = "vat_exclusive"
		if inclusive {
			p.Treatment = "vat_inclusive"
		}
	}
	return p, nil
}
func copyRow(r erpwire.Row) erpwire.Row {
	c := erpwire.Row{}
	for k, v := range r {
		c[k] = v
	}
	return c
}
func depositSale(inv, snapshot erpwire.Row, lock string, accounts []string) (journalPosting, error) {
	deposit, e := satang(inv["quote_deposit_satang"])
	deduction, f := satang(inv["quote_deposit_deduction_satang"])
	if text(inv["quote_invoice_kind"]) != "deposit" || e != nil || f != nil || deposit <= 0 || deduction != 0 || text(inv["source_quote_id"]) == "" {
		return journalPosting{}, businessError("A deposit invoice is not posted.")
	}
	plain := copyRow(inv)
	plain["quote_invoice_kind"] = "lines"
	plain["quote_deposit_satang"] = int64(0)
	p, e := plainSale(plain, snapshot, lock, append(append([]string{}, accounts...), "4100"))
	if e != nil {
		return p, e
	}
	held := money.Satang(0)
	for i, l := range p.Lines {
		if l.AccountCode == "4100" {
			held = l.Credit
			p.Lines[i].AccountCode = "2120"
		}
	}
	if held == 0 || held != deposit {
		return p, businessError("The deposit base does not match the stored sale.")
	}
	if !has(accounts, "2120") {
		return p, businessError(chartError)
	}
	p.Memo = "Issued deposit invoice " + text(inv["number"])
	if length(p.Memo) > 200 {
		return p, businessError("Enter a journal memo.")
	}
	return p, nil
}
func finalSale(inv, snapshot erpwire.Row, lock string, accounts []string, held money.Satang, unposted, credit bool) (journalPosting, error) {
	deduction, e := satang(inv["quote_deposit_deduction_satang"])
	deposit, f := satang(inv["quote_deposit_satang"])
	if text(inv["quote_invoice_kind"]) != "lines" || e != nil || f != nil || deduction <= 0 || deposit != 0 || text(inv["source_quote_id"]) == "" {
		return journalPosting{}, businessError("This final invoice does not apply the whole posted deposit.")
	}
	if credit {
		return journalPosting{}, businessError("A credit note on a deposit invoice is not applied.")
	}
	if unposted {
		return journalPosting{}, businessError("Post the deposit invoice before this final invoice.")
	}
	discount, e := satang(inv["discount_satang"])
	quoteDiscount, f := satang(inv["quote_discount_satang"])
	if e != nil || f != nil || discount != quoteDiscount+deduction {
		return journalPosting{}, businessError("This deposit deduction is not in the invoice discount.")
	}
	if held != deduction {
		return journalPosting{}, businessError("This final invoice does not apply the whole posted deposit.")
	}
	plain := copyRow(inv)
	plain["quote_deposit_satang"] = int64(0)
	plain["quote_deposit_deduction_satang"] = int64(0)
	p, e := plainSale(plain, snapshot, lock, accounts)
	if e != nil {
		return p, e
	}
	if !has(accounts, "2120") {
		return p, businessError(chartError)
	}
	found := false
	for i, l := range p.Lines {
		if l.AccountCode == "4100" && l.Credit > 0 {
			p.Lines[i].Credit += deduction
			found = true
		}
	}
	if !found {
		p.Lines = append(p.Lines, JournalLine{"4100", 0, deduction})
	}
	p.Lines = append(p.Lines, JournalLine{"2120", deduction, 0})
	if _, e = journalLines(p.Lines, accounts); e != nil {
		return p, e
	}
	p.Memo = "Issued sales invoice " + text(inv["number"]) + " applying posted deposit"
	if length(p.Memo) > 200 {
		return p, businessError("Enter a journal memo.")
	}
	return p, nil
}
