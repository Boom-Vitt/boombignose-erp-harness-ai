package erpledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type TrialBalanceRow struct {
	Code   string       `json:"code"`
	NameTH string       `json:"nameTh"`
	NameEN string       `json:"nameEn"`
	Kind   string       `json:"kind"`
	Debit  money.Satang `json:"debitSatang"`
	Credit money.Satang `json:"creditSatang"`
}
type TrialBalance struct {
	Rows      []TrialBalanceRow `json:"rows"`
	Debit     money.Satang      `json:"debitSatang"`
	Credit    money.Satang      `json:"creditSatang"`
	Balanced  bool              `json:"balanced"`
	LineCount int               `json:"lineCount"`
}

func trialBalance(lines, accounts, entries []erpwire.Row, through string) (TrialBalance, error) {
	out := TrialBalance{Rows: []TrialBalanceRow{}}
	if through != "" && !validDate(through) {
		return out, businessError("Enter a trial balance date.")
	}
	dates := keyed(entries, "id")
	names := keyed(accounts, "code")
	buckets := map[string][2]money.Satang{}
	for _, line := range lines {
		date := text(dates[text(line["entry_id"])]["entry_date"])
		if !validDate(date) {
			return out, businessError("A journal date on this trial balance is not a calendar date.")
		}
		if through != "" && date > through {
			continue
		}
		code := text(line["account_code"])
		if trim(code) == "" {
			return out, businessError(chartError)
		}
		debit, e := nonnegative(line["debit_satang"])
		if e != nil {
			return out, businessError(amountError)
		}
		credit, e := nonnegative(line["credit_satang"])
		if e != nil {
			return out, businessError(amountError)
		}
		bucket := buckets[code]
		bucket[0], e = sum(bucket[0], debit)
		if e != nil {
			return out, businessError(amountError)
		}
		bucket[1], e = sum(bucket[1], credit)
		if e != nil {
			return out, businessError(amountError)
		}
		buckets[code] = bucket
		out.LineCount++
	}
	codes := []string{}
	for code := range buckets {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		b := buckets[code]
		net := b[0] - b[1]
		if net == 0 {
			continue
		}
		account := names[code]
		row := TrialBalanceRow{Code: code, NameTH: text(account["name_th"]), NameEN: text(account["name_en"]), Kind: text(account["kind"])}
		if net > 0 {
			row.Debit = net
		} else {
			row.Credit = -net
		}
		var e error
		out.Debit, e = sum(out.Debit, row.Debit)
		if e != nil {
			return out, businessError(amountError)
		}
		out.Credit, e = sum(out.Credit, row.Credit)
		if e != nil {
			return out, businessError(amountError)
		}
		out.Rows = append(out.Rows, row)
	}
	out.Balanced = out.Debit == out.Credit
	return out, nil
}
func acceptanceFigures(lock, through string, balance TrialBalance) erpwire.Row {
	if !validDate(through) || !validDate(lock) || through > lock {
		return erpwire.Row{"ok": false, "error": "Accept a draft close only inside a locked period."}
	}
	if !balance.Balanced {
		return erpwire.Row{"ok": false, "error": "Accept a trial balance only when debits equal credits."}
	}
	rows := []string{}
	for _, r := range balance.Rows {
		rows = append(rows, fmt.Sprintf("%s %d %d", r.Code, r.Debit, r.Credit))
	}
	payload := fmt.Sprintf("v1\n%s\n%s\n%d\n%d\n%d", through, strings.Join(rows, "\n"), balance.Debit, balance.Credit, balance.LineCount)
	hash := sha256.Sum256([]byte(payload))
	return erpwire.Row{"ok": true, "figures": erpwire.Row{"through": through, "debitSatang": balance.Debit, "creditSatang": balance.Credit, "lineCount": balance.LineCount, "sha256": hex.EncodeToString(hash[:])}}
}
func (s *Service) journalPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "profit:view") != nil {
		return erpwire.Row{"error": journalDenied}, nil
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	out := erpwire.Row{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		accounts, e := all(ctx, tx, erpwire.Select{Table: "gl_accounts", Columns: []string{"code", "name_th", "name_en"}, Where: scope(a), Order: []erpwire.Order{order("code", false)}})
		if e != nil {
			return e
		}
		setting, e := settings(ctx, tx, a, "lock_date")
		if e != nil {
			return e
		}
		result, e := tx.Select(ctx, erpwire.Select{Table: "journal_entries", Columns: []string{"id", "entry_date", "memo", "created_at", "source_invoice_id", "source_credit_note_id", "source_payment_id"}, Where: scope(a), Order: []erpwire.Order{order("created_at", true), order("id", false)}, Limit: 20})
		if e != nil {
			return e
		}
		entries := result.Rows
		if entries == nil {
			entries = []erpwire.Row{}
		}
		lines := []erpwire.Row{}
		if len(entries) > 0 {
			lines, e = rows(ctx, tx, a, "journal_lines", []string{"entry_id", "line_no", "account_code", "debit_satang", "credit_satang"}, in("entry_id", ids(entries, "id")))
			if e != nil {
				return e
			}
		}
		chart := []erpwire.Row{}
		names := [][2]any{}
		for _, r := range accounts {
			chart = append(chart, erpwire.Row{"code": r["code"], "nameTh": r["name_th"], "nameEn": r["name_en"]})
			names = append(names, [2]any{r["code"], text(r["name_th"]) + " / " + text(r["name_en"])})
		}
		out = erpwire.Row{"accounts": accounts, "chart": chart, "names": erpwire.Map(names), "lockDate": setting["lock_date"], "entries": entries, "lines": lines}
		return nil
	})
	if e != nil {
		return nil, readFailure(e, "Draft journal unavailable")
	}
	return out, nil
}
func (s *Service) trialBalancePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "profit:view") != nil {
		return erpwire.Row{"error": "Only owners, admins, and accountants can view the trial balance."}, nil
	}
	params, e := paramsInput(raw)
	if e != nil {
		return nil, e
	}
	out := erpwire.Row{}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		accounts, e := all(ctx, tx, erpwire.Select{Table: "gl_accounts", Columns: []string{"code", "name_th", "name_en", "kind"}, Where: scope(a), Order: []erpwire.Order{order("code", false)}})
		if e != nil {
			return e
		}
		setting, e := settings(ctx, tx, a, "lock_date")
		if e != nil {
			return e
		}
		entries, e := rows(ctx, tx, a, "journal_entries", []string{"id", "entry_date"})
		if e != nil {
			return e
		}
		lines, e := rows(ctx, tx, a, "journal_lines", []string{"entry_id", "account_code", "debit_satang", "credit_satang"})
		if e != nil {
			return e
		}
		lock := text(setting["lock_date"])
		requested := text(params["through"])
		through := requested
		if requested == "all" {
			through = ""
		} else if requested == "" {
			through = ""
			if validDate(lock) {
				through = lock
			}
		}
		out["lockDate"] = setting["lock_date"]
		out["through"] = nullable(through)
		out["throughValue"] = through
		out["acceptance"] = nil
		out["pending"] = nil
		out["acceptedSha"] = nil
		out["viewerId"] = a.UserID()
		if through != "" && !validDate(through) {
			out["throughValue"] = ""
			out["result"] = erpwire.Row{"ok": false, "error": "Enter a trial balance date."}
			return nil
		}
		balance, e := trialBalance(lines, accounts, entries, through)
		if e != nil {
			out["result"] = erpwire.Row{"ok": false, "error": e.Error()}
			return nil
		}
		out["result"] = erpwire.Row{"ok": true, "balance": balance}
		acceptance := acceptanceFigures(lock, through, balance)
		out["acceptance"] = acceptance
		if acceptance["ok"] != true {
			return nil
		}
		figures := object(acceptance["figures"])
		out["currentSha"] = figures["sha256"]
		requests, e := rows(ctx, tx, a, "draft_close_acceptance_requests", []string{"id", "requested_by", "figures_sha256", "status"}, eq("through_date", through), in("status", []string{"pending", "confirmed"}))
		if e != nil {
			return e
		}
		for _, r := range requests {
			if r["status"] == "pending" && out["pending"] == nil {
				out["pending"] = erpwire.Row{"id": r["id"], "requestedBy": r["requested_by"], "sha256": r["figures_sha256"]}
			}
			if r["status"] == "confirmed" && out["acceptedSha"] == nil {
				out["acceptedSha"] = r["figures_sha256"]
			}
		}
		return nil
	})
	if e != nil {
		return nil, readFailure(e, "Trial balance unavailable")
	}
	return out, nil
}
