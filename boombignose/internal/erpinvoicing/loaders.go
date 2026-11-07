package erpinvoicing

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type financeLoadMessage string

func (e financeLoadMessage) Error() string { return string(e) }
func financeReadError(err error, message string) error {
	if canonical(err) {
		return err
	}
	return financeLoadMessage(message)
}
func loaderError(err error, message string) error {
	var exact financeLoadMessage
	if canonical(err) || errors.Is(err, erpwire.ErrNotFound) || errors.As(err, &exact) {
		return err
	}
	return errors.New(message)
}
func invoiceClientRelation(owner bool) erpwire.Relation {
	columns := []string{"name"}
	if owner {
		columns = append(columns, "owner")
	}
	return erpwire.Relation{Name: "clients", Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: columns}
}
func invoiceProjectRelation() erpwire.Relation {
	return erpwire.Relation{Name: "projects", Table: "projects", LocalColumn: "project_id", ForeignColumn: "id", Columns: []string{"name"}}
}
func invoiceQuery(a erpwire.Actor, columns []string) erpwire.Select {
	return erpwire.Select{Table: "invoices", Columns: columns, Relations: []erpwire.Relation{invoiceClientRelation(false)}, Where: scope(a), Order: []erpwire.Order{{Column: "issue_date", Descending: true}, {Column: "id"}}}
}

func financeRows(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, table string, columns []string, where []erpwire.Predicate, order ...string) ([]erpwire.Row, error) {
	return all(ctx, tx, erpwire.Select{Table: table, Columns: columns, Where: append(scope(a), where...), Order: ordered(order...)})
}
func financeBalanceRows(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor) (map[string]erpwire.Row, erpwire.BrowserMap, error) {
	rows, e := financeRows(ctx, tx, a, "invoice_balances", []string{"invoice_id", "paid_satang", "credited_satang", "outstanding_satang"}, nil, "invoice_id")
	if e != nil {
		return nil, erpwire.BrowserMap{}, e
	}
	byID := map[string]erpwire.Row{}
	entries := [][2]any{}
	for _, r := range rows {
		for _, k := range []string{"paid_satang", "credited_satang", "outstanding_satang"} {
			v, e := amount(r[k])
			if e != nil {
				return nil, erpwire.BrowserMap{}, e
			}
			r[k] = v
		}
		byID[text(r["invoice_id"])] = r
		entries = append(entries, [2]any{r["invoice_id"], r})
	}
	return byID, erpwire.Map(entries), nil
}
func balanceValue(row erpwire.Row, column string) (money.Satang, error) {
	if row == nil {
		return 0, nil
	}
	return amount(row[column])
}
func financeOptions(rows []erpwire.Row) []erpwire.Row {
	out := []erpwire.Row{}
	for _, r := range rows {
		out = append(out, erpwire.Row{"value": r["id"], "label": r["name"]})
	}
	return out
}

func (s *Service) financePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	params, e := pageParams(raw)
	if e != nil {
		return nil, e
	}
	config := financeFacets(params)
	today := s.today()
	month := today[:7]
	out := erpwire.Row{"config": config, "today": today, "month": month, "defaultTab": "invoices", "canReviewMonthEndClose": a.Role() != erpwire.Member, "canReviewFinanceClose": a.Role() != erpwire.Member, "canDownloadAccountantPack": a.Role() != erpwire.Member, "canDeleteCost": erpwire.Can(a.Role(), "cost:delete")}
	if text(params["tab"]) == "costs" {
		out["defaultTab"] = "costs"
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		query := invoiceQuery(a, []string{"id", "number", "issued_snapshot_id", "amount_satang", "total_satang", "vat_satang", "status", "due_date", "issue_date", "is_recurring", "recurring_interval", "client_id"})
		query.Relations = []erpwire.Relation{invoiceClientRelation(true)}
		invoices, e := all(ctx, tx, query)
		if e != nil {
			return e
		}
		payments, e := financeRows(ctx, tx, a, "payments", []string{"invoice_id", "amount_satang", "paid_at"}, []erpwire.Predicate{eq("verification_state", "verified")}, "id")
		if e != nil {
			return e
		}
		costs, e := all(ctx, tx, erpwire.Select{Table: "costs", Columns: []string{"id", "category", "amount_satang", "incurred_on", "vendor", "project_id", "vendor_id", "purchase_order_id", "expense_claim_id", "bill_number", "bill_date", "due_date", "paid_at", "vendor_invoice_reference", "input_vat_rate", "input_vat_satang"}, Relations: []erpwire.Relation{invoiceProjectRelation()}, Where: scope(a), Order: []erpwire.Order{{Column: "incurred_on", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		subscriptions, e := financeRows(ctx, tx, a, "subscriptions", []string{"status", "amount_satang", "interval"}, []erpwire.Predicate{eq("status", "active")}, "id")
		if e != nil {
			return e
		}
		settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"vat_registered"}, Where: scope(a)})
		if e != nil {
			return e
		}
		views, e := financeRows(ctx, tx, a, "saved_views", []string{"id", "name", "config"}, []erpwire.Predicate{eq("user_id", a.UserID()), eq("module", "finance")}, "created_at", "id")
		if e != nil {
			return financeReadError(e, "Saved views unavailable. Please reload.")
		}
		for _, view := range views {
			view["config"] = financeFacets(object(view["config"]))
		}
		balances, browserBalances, e := financeBalanceRows(ctx, tx, a)
		if e != nil {
			return e
		}
		credits, e := financeRows(ctx, tx, a, "credit_note_revenue", []string{"id", "invoice_id", "issue_date", "project_id", "client_name", "base_satang", "total_satang"}, nil, "id")
		if e != nil {
			return e
		}
		invoiceRows, filtered := []erpwire.Row{}, []erpwire.Row{}
		var unpaid, revenue, cash, costTotal money.Satang
		openCount := 0
		for _, inv := range invoices {
			value, e := amount(inv["amount_satang"])
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
			inv["displayNumber"] = displayNumber(inv)
			inv["paid_satang"] = paid
			inv["credited_satang"] = credited
			inv["outstanding"] = outstanding(value, paid, credited)
			inv["effectiveStatus"] = status(inv, paid, credited, today)
			invoiceRows = append(invoiceRows, inv)
			if financeMatches(config, inv, a.UserID(), s.now()) {
				filtered = append(filtered, inv)
			}
			if text(inv["status"]) != "draft" && text(inv["status"]) != "cancelled" {
				owed := outstanding(value, paid, credited)
				unpaid, e = sum(unpaid, owed)
				if e != nil {
					return e
				}
				if owed > 0 {
					openCount++
				}
				if financeMonth(text(inv["issue_date"])) == month {
					gross, e := amount(inv["total_satang"])
					if e != nil {
						return e
					}
					vat, e := amount(inv["vat_satang"])
					if e != nil {
						return e
					}
					base, e := sum(gross, -vat)
					if e != nil {
						return e
					}
					revenue, e = sum(revenue, base)
					if e != nil {
						return e
					}
				}
			}
		}
		var creditTotal money.Satang
		for _, credit := range credits {
			if financeMonth(text(credit["issue_date"])) == month {
				v, e := amount(credit["base_satang"])
				if e != nil {
					return e
				}
				creditTotal, e = sum(creditTotal, v)
				if e != nil {
					return e
				}
			}
		}
		revenue, e = sum(revenue, -creditTotal)
		if e != nil {
			return e
		}
		for _, payment := range payments {
			if financeMonth(text(payment["paid_at"])) == month {
				v, e := amount(payment["amount_satang"])
				if e != nil {
					return e
				}
				cash, e = sum(cash, v)
				if e != nil {
					return e
				}
			}
		}
		registered, _ := settings["vat_registered"].(bool)
		for _, cost := range costs {
			if text(cost["category"]) == "inventory" || financeMonth(text(cost["incurred_on"])) != month {
				continue
			}
			v, e := amount(cost["amount_satang"])
			if e != nil {
				return e
			}
			var vat money.Satang
			if registered {
				vat, e = amount(cost["input_vat_satang"])
				if e != nil {
					return e
				}
			}
			net, e := sum(v, -vat)
			if e != nil {
				return e
			}
			costTotal, e = sum(costTotal, net)
			if e != nil {
				return e
			}
		}
		mrr, e := financeMRR(subscriptions)
		if e != nil {
			return e
		}
		groups, e := financeGroups(filtered, text(config["groupBy"]))
		if e != nil {
			return e
		}
		out["invoices"] = invoices
		out["invoiceRows"] = invoiceRows
		out["filteredInvoiceRows"] = filtered
		out["costs"] = costs
		out["payments"] = payments
		out["activeSubscriptions"] = subscriptions
		out["savedViews"] = views
		out["balances"] = browserBalances
		out["groups"] = groups
		out["unpaidSatang"] = unpaid
		out["openCount"] = openCount
		out["revenueSatang"] = revenue
		out["cashReceivedSatang"] = cash
		out["costsSatang"] = costTotal
		out["mrrSatang"] = mrr
		return nil
	})
	if e != nil {
		return nil, loaderError(e, "Finance data unavailable. Reload before relying on totals.")
	}
	return out, nil
}

func financeMonth(value string) string {
	date := dateOnly(value)
	if len(date) < 7 {
		return ""
	}
	return date[:7]
}
func financeMRR(subscriptions []erpwire.Row) (money.Satang, error) {
	total := new(big.Int)
	factors := map[string]int64{"weekly": 52, "monthly": 12, "quarterly": 4, "yearly": 1}
	for _, sub := range subscriptions {
		if text(sub["status"]) != "active" {
			continue
		}
		v, e := amount(sub["amount_satang"])
		if e != nil || v < 0 {
			return 0, errors.New("MRR amount outside safe satang bounds")
		}
		factor, ok := factors[text(sub["interval"])]
		if !ok {
			return 0, errors.New("Invalid recurring interval")
		}
		total.Add(total, new(big.Int).Mul(big.NewInt(int64(v)), big.NewInt(factor)))
	}
	total.Add(total, big.NewInt(6))
	total.Quo(total, big.NewInt(12))
	if !total.IsInt64() || total.Int64() > int64(money.MaxSafeSatang) {
		return 0, errors.New("MRR total outside safe satang bounds")
	}
	return money.Satang(total.Int64()), nil
}

func invoiceDefaults(invoice erpwire.Row) erpwire.Row {
	out := erpwire.Row{"client_id": text(invoice["client_id"]), "project_id": text(invoice["project_id"]), "number": text(invoice["number"]), "issue_date": text(invoice["issue_date"]), "due_date": text(invoice["due_date"]), "amountBaht": "0.00", "is_recurring": false, "notes": text(invoice["notes"])}
	if invoice != nil {
		out["is_recurring"] = invoice["is_recurring"]
		if invoice["recurring_interval"] != nil {
			out["recurring_interval"] = invoice["recurring_interval"]
		}
		if v, e := amount(invoice["amount_satang"]); e == nil {
			out["amountBaht"] = money.FormatBaht(v)
		}
	}
	return out
}
func (s *Service) newInvoicePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	out := erpwire.Row{"defaultValues": invoiceDefaults(nil)}
	object(out["defaultValues"])["issue_date"] = s.today()
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		clients, e := financeRows(ctx, tx, a, "clients", []string{"id", "name"}, nil, "name", "id")
		if e != nil {
			return e
		}
		projects, e := financeRows(ctx, tx, a, "projects", []string{"id", "name"}, nil, "name", "id")
		if e != nil {
			return e
		}
		out["clients"] = financeOptions(clients)
		out["projects"] = financeOptions(projects)
		return nil
	})
	if e != nil {
		return nil, loaderError(e, "Invoice form unavailable")
	}
	return out, nil
}

func (s *Service) invoicePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	if !validID(id) {
		return nil, erpwire.ErrNotFound
	}
	out := erpwire.Row{"today": s.today(), "orgId": a.OrgID(), "manageStock": erpwire.Can(a.Role(), "inventory:manage"), "canFinance": erpwire.Can(a.Role(), "payment:verify"), "canReverse": erpwire.Can(a.Role(), "invoice:delete"), "canPostJournal": erpwire.Can(a.Role(), "profit:view"), "accounting": erpwire.Row{"connected": false, "sync": nil}, "recordRef": erpwire.Row{"recordType": "invoice", "recordId": id}}
	claims := []erpwire.Row{}
	claimsErr := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		claims, err = financeRows(ctx, tx, a, "payment_claims", []string{"id", "amount_satang", "reference", "status"}, []erpwire.Predicate{eq("invoice_id", id)}, "created_at", "id")
		return err
	})
	if canonical(claimsErr) {
		return nil, claimsErr
	}
	out["claims"] = claims
	out["claimsError"] = nil
	if claimsErr != nil {
		out["claims"] = []erpwire.Row{}
		out["claimsError"] = "Payment queue unavailable. Reload before approving."
		claims = nil
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		query := invoiceQuery(a, []string{"id", "number", "amount_satang", "status", "issue_date", "due_date", "is_recurring", "recurring_interval", "notes", "client_id", "project_id", "discount_satang", "subtotal_satang", "vat_satang", "total_satang", "wht_satang", "wht_rate_bps", "tax_breakdown", "prices_include_vat", "source_quote_id", "source_milestone_id", "quote_invoice_kind", "quote_deposit_deduction_satang", "version", "issued_snapshot_id"})
		query.Where = scoped(a, id)
		query.Relations = append(query.Relations, invoiceProjectRelation())
		invoice, e := one(ctx, tx, query)
		if e != nil {
			return e
		}
		if invoice == nil {
			return erpwire.ErrNotFound
		}
		out["invoice"] = invoice
		where := []erpwire.Predicate{eq("invoice_id", id)}
		legacy, e := financeRows(ctx, tx, a, "payments", []string{"id", "amount_satang", "notes", "paid_at", "method", "verification_state", "reconciled_payment_id"}, append(where, erpwire.Predicate{Column: "verification_state", Op: erpwire.NotEqual, Value: "verified"}), "id")
		if e != nil {
			return e
		}
		out["legacyPayments"] = legacy
		payments, e := all(ctx, tx, erpwire.Select{Table: "invoice_receipts", Columns: []string{"id", "amount_satang", "paid_at", "method", "notes"}, Where: append(scope(a), append(where, eq("verification_state", "verified"))...), Order: []erpwire.Order{{Column: "paid_at", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		out["payments"] = payments
		paymentCount, e := tx.Select(ctx, erpwire.Select{Table: "invoice_receipts", Columns: []string{"id"}, Where: append(scope(a), append(where, eq("verification_state", "verified"))...), Order: ordered("id"), Limit: 1, Count: true})
		if e != nil {
			return e
		}
		if paymentCount.Total == nil {
			return errors.New("Invoice evidence count unavailable")
		}
		out["paymentCount"] = *paymentCount.Total
		balance, e := one(ctx, tx, erpwire.Select{Table: "invoice_balances", Columns: []string{"paid_satang", "credited_satang"}, Where: append(scope(a), where...)})
		if e != nil {
			return e
		}
		paid, e := balanceValue(balance, "paid_satang")
		if e != nil {
			return e
		}
		credited, e := balanceValue(balance, "credited_satang")
		if e != nil {
			return e
		}
		value, e := amount(invoice["amount_satang"])
		if e != nil {
			return e
		}
		out["paid"] = paid
		out["credited"] = credited
		out["outstanding"] = outstanding(value, paid, credited)
		out["effectiveStatus"] = status(invoice, paid, credited, s.today())
		out["displayNumber"] = displayNumber(invoice)
		for _, table := range []string{"clients", "projects"} {
			rows, e := financeRows(ctx, tx, a, table, []string{"id", "name"}, nil, "name", "id")
			if e != nil {
				return e
			}
			out[table] = financeOptions(rows)
		}
		settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"vat_registered", "vat_rate_bps"}, Where: scope(a)})
		if e != nil {
			return e
		}
		vatRate := any(int64(0))
		if settings["vat_registered"] == true {
			vatRate = settings["vat_rate_bps"]
		}
		out["vatRate"] = vatRate
		out["defaultValues"] = invoiceDefaults(invoice)
		items, e := financeRows(ctx, tx, a, "invoice_items", []string{"id", "product_id", "description", "quantity", "unit", "unit_price_satang", "tax_rate_bps"}, where, "position", "id")
		if e != nil {
			return e
		}
		sections, e := financeRows(ctx, tx, a, "document_sections", []string{"id", "kind", "description", "lines_before", "position"}, where, "position", "id")
		if e != nil {
			return e
		}
		grid, e := financeGridRows(items, sections)
		if e != nil {
			return e
		}
		out["lineRows"] = grid
		pending := false
		for _, c := range claims {
			if text(c["status"]) == "pending" {
				pending = true
			}
		}
		out["pendingClaim"] = pending
		lock := ""
		if invoice["issued_snapshot_id"] != nil {
			lock = "Issued lines are frozen; corrections must preserve the original document."
		} else if invoice["source_quote_id"] != nil {
			lock = "Lines come from the accepted quote."
		} else if paid > 0 || pending {
			lock = "Payment evidence locks these lines."
		}
		out["lineLock"] = nil
		if lock != "" {
			out["lineLock"] = lock
		}
		out["products"] = []erpwire.Row{}
		if lock == "" {
			products, e := tx.Select(ctx, erpwire.Select{Table: "products", Columns: []string{"id", "sku", "name", "description", "unit", "list_price_satang", "tax_rate_bps"}, Where: append(scope(a), eq("active", true)), Order: ordered("name", "id"), Limit: 20})
			if e != nil {
				return e
			}
			out["products"] = products.Rows
		}
		quoteStatus := ""
		if quoteID := text(invoice["source_quote_id"]); quoteID != "" {
			quote, e := one(ctx, tx, erpwire.Select{Table: "quotes", Columns: []string{"status"}, Where: scoped(a, quoteID)})
			if e != nil {
				return financeReadError(e, "Source quote unavailable")
			}
			quoteStatus = text(quote["status"])
		}
		chain := financeSalesChain(quoteStatus, text(out["effectiveStatus"]), invoice["issued_snapshot_id"] != nil, out["outstanding"].(money.Satang), settings["vat_registered"] == true)
		out["chain"] = chain
		out["chainAnchor"] = nil
		if out["canFinance"] == true {
			switch text(object(chain["next"])["command"]) {
			case "pay":
				out["chainAnchor"] = "#payment-claims"
			case "issue":
				out["chainAnchor"] = "#issue-invoice"
			}
		}
		if e = s.invoiceInventory(ctx, tx, a, id, out); e != nil {
			return e
		}
		out["postedJournal"] = nil
		out["creditNotes"] = []erpwire.Row{}
		out["cashReceiptPosts"] = []erpwire.Row{}
		if invoice["issued_snapshot_id"] != nil {
			if out["canPostJournal"] == true {
				posted, e := one(ctx, tx, erpwire.Select{Table: "journal_entries", Columns: []string{"id"}, Where: append(scope(a), eq("source_invoice_id", id))})
				if e != nil {
					return financeReadError(e, "Draft journal unavailable")
				}
				out["postedJournal"] = posted
			}
			if e = s.invoiceFollowOn(ctx, tx, a, id, out); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return nil, loaderError(e, "Invoice evidence unavailable. Reload before making financial changes.")
	}
	return out, nil
}

func financeGridRows(lines, sections []erpwire.Row) ([]erpwire.Row, error) {
	sections = append([]erpwire.Row{}, sections...)
	sort.SliceStable(sections, func(i, j int) bool {
		a, _ := integer(sections[i]["lines_before"])
		b, _ := integer(sections[j]["lines_before"])
		if a == b {
			x, _ := integer(sections[i]["position"])
			y, _ := integer(sections[j]["position"])
			return x < y
		}
		return a < b
	})
	out := []erpwire.Row{}
	next := 0
	addSection := func(r erpwire.Row) {
		kind := "section"
		if text(r["kind"]) == "note" {
			kind = "note"
		}
		out = append(out, erpwire.Row{"kind": kind, "id": r["id"], "description": r["description"]})
	}
	for index, line := range lines {
		for next < len(sections) {
			before, e := integer(sections[next]["lines_before"])
			if e != nil {
				return nil, e
			}
			if before > int64(index) {
				break
			}
			addSection(sections[next])
			next++
		}
		price, e := amount(line["unit_price_satang"])
		if e != nil {
			return nil, e
		}
		rate := line["tax_rate_bps"]
		if rate == nil {
			rate = int64(0)
		}
		quantity := text(line["quantity"])
		if n, ok := line["quantity"].(json.Number); ok {
			quantity = n.String()
		}
		if quantity == "" {
			n, e := integer(line["quantity"])
			if e != nil {
				return nil, e
			}
			quantity = strconv.FormatInt(n, 10)
		}
		if strings.Contains(quantity, ".") && !strings.ContainsAny(quantity, "eE") {
			quantity = strings.TrimRight(strings.TrimRight(quantity, "0"), ".")
		}
		out = append(out, erpwire.Row{"kind": "line", "id": line["id"], "productId": line["product_id"], "description": line["description"], "quantity": quantity, "unit": text(line["unit"]), "unitPrice": money.FormatBaht(price), "taxRateBps": rate})
	}
	for next < len(sections) {
		addSection(sections[next])
		next++
	}
	return out, nil
}

func (s *Service) invoiceInventory(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, id string, out erpwire.Row) error {
	count, e := tx.Select(ctx, erpwire.Select{Table: "stock_moves", Columns: []string{"id"}, Where: append(scope(a), eq("source_id", id)), Order: ordered("id"), Limit: 1, Count: true})
	if e != nil {
		return financeReadError(e, "Stock move count unavailable")
	}
	if count.Total == nil {
		return financeLoadMessage("Stock move count unavailable")
	}
	out["deliveryCount"] = *count.Total
	lines, e := financeRows(ctx, tx, a, "invoice_stock_lines", nil, []erpwire.Predicate{eq("invoice_id", id), eq("is_stockable", true)}, "id")
	if e != nil {
		return e
	}
	moves, e := financeRows(ctx, tx, a, "stock_moves", nil, []erpwire.Predicate{eq("source_type", "invoice"), eq("source_id", id)}, "sequence", "id")
	if e != nil {
		return e
	}
	out["stock"] = erpwire.Row{"lines": lines, "moves": moves}
	pending := []erpwire.Row{}
	for _, line := range lines {
		delivered, ok := new(big.Rat).SetString(financeDecimal(line["delivered_quantity"]))
		quantity, valid := new(big.Rat).SetString(financeDecimal(line["quantity"]))
		if !ok || !valid {
			return financeLoadMessage("Inventory data unavailable. Please reload.")
		}
		if delivered.Cmp(quantity) < 0 {
			pending = append(pending, line)
		}
	}
	out["pendingDelivery"] = pending
	out["stockableCount"] = len(lines)
	out["inventory"] = erpwire.Row{"products": []erpwire.Row{}, "warehouses": []erpwire.Row{}}
	if len(lines) == 0 {
		return nil
	}
	snapshot, e := financeInventorySnapshot(ctx, tx, a)
	if e != nil {
		return financeReadError(e, "Inventory data unavailable. Please reload.")
	}
	warehouses, e := financeRows(ctx, tx, a, "warehouses", nil, nil, "code", "id")
	if e != nil {
		return e
	}
	vendors, e := financeRows(ctx, tx, a, "vendors", []string{"id", "name", "active"}, nil, "id")
	if e != nil {
		return e
	}
	snapshot["warehouses"] = warehouses
	snapshot["vendors"] = vendors
	out["inventory"] = snapshot
	return nil
}
func financeDecimal(v any) string {
	switch n := v.(type) {
	case json.Number:
		return n.String()
	case string:
		return n
	default:
		if i, e := integer(v); e == nil {
			return strconv.FormatInt(i, 10)
		}
	}
	return ""
}

// inventory_snapshot is not a shared ReadRPC; these scoped views reproduce its unfiltered projection.
func financeInventorySnapshot(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor) (erpwire.Row, error) {
	products, e := financeRows(ctx, tx, a, "products", nil, []erpwire.Predicate{eq("is_stockable", true)}, "name", "id")
	if e != nil {
		return nil, e
	}
	balances, e := financeRows(ctx, tx, a, "stock_on_hand", nil, nil, "product_id", "warehouse_id")
	if e != nil {
		return nil, e
	}
	totals, e := financeRows(ctx, tx, a, "inventory_totals", []string{"product_id", "quantity", "value_satang"}, nil, "product_id")
	if e != nil {
		return nil, e
	}
	forecast, e := financeRows(ctx, tx, a, "inventory_forecast", []string{"product_id", "on_order", "reserved_quantity"}, nil, "product_id")
	if e != nil {
		return nil, e
	}
	leads, e := financeRows(ctx, tx, a, "product_vendor_lead_times", []string{"product_id", "vendor_id", "lead_days"}, nil, "product_id", "vendor_id")
	if e != nil {
		return nil, e
	}
	totalMap, forecastMap := map[string]erpwire.Row{}, map[string]erpwire.Row{}
	for _, row := range totals {
		totalMap[text(row["product_id"])] = row
	}
	for _, row := range forecast {
		forecastMap[text(row["product_id"])] = row
	}
	result := []erpwire.Row{}
	for _, product := range products {
		pid := text(product["id"])
		f, exists := forecastMap[pid]
		if !exists {
			continue
		}
		product["quantity"] = json.Number("0")
		product["value_satang"] = money.Satang(0)
		if total := totalMap[pid]; total != nil {
			product["quantity"] = total["quantity"]
			v, e := amount(total["value_satang"])
			if e != nil {
				return nil, e
			}
			product["value_satang"] = v
		}
		product["on_order"] = f["on_order"]
		product["reserved_quantity"] = f["reserved_quantity"]
		product["lead_days"] = int64(0)
		for _, lead := range leads {
			if text(lead["product_id"]) == pid && text(lead["vendor_id"]) == text(product["default_vendor_id"]) {
				product["lead_days"] = lead["lead_days"]
				break
			}
		}
		for _, key := range []string{"list_price_satang", "cost_satang"} {
			v, e := amount(product[key])
			if e != nil || v < 0 {
				return nil, errors.New("Inventory data unavailable. Please reload.")
			}
			product[key] = v
		}
		result = append(result, product)
	}
	return erpwire.Row{"products": result, "balances": balances}, nil
}

func (s *Service) invoiceFollowOn(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, id string, out erpwire.Row) error {
	notes, e := financeRows(ctx, tx, a, "credit_notes", []string{"id", "number", "amount_satang", "reason"}, []erpwire.Predicate{eq("invoice_id", id)}, "created_at", "id")
	if e != nil {
		return financeReadError(e, "Credit notes unavailable")
	}
	out["creditNotes"] = notes
	if out["canPostJournal"] != true {
		return nil
	}
	ids := []string{}
	for _, note := range notes {
		ids = append(ids, text(note["id"]))
	}
	postedNotes := map[string]bool{}
	if len(ids) > 0 {
		posted, e := financeRows(ctx, tx, a, "journal_entries", []string{"source_credit_note_id"}, []erpwire.Predicate{{Column: "source_credit_note_id", Op: erpwire.In, Value: ids}}, "id")
		if e != nil {
			return financeReadError(e, "Draft journal unavailable")
		}
		for _, row := range posted {
			postedNotes[text(row["source_credit_note_id"])] = true
		}
	}
	for _, note := range notes {
		note["posted"] = postedNotes[text(note["id"])]
	}
	allocations, e := financeRows(ctx, tx, a, "payment_allocations", []string{"payment_id", "amount_satang"}, []erpwire.Predicate{eq("invoice_id", id), {Column: "amount_satang", Op: erpwire.Greater, Value: 0}}, "id")
	if e != nil {
		return financeReadError(e, "Draft journal unavailable")
	}
	ids = []string{}
	seen := map[string]bool{}
	for _, allocation := range allocations {
		paymentID := text(allocation["payment_id"])
		if !seen[paymentID] {
			ids = append(ids, paymentID)
			seen[paymentID] = true
		}
	}
	out["otherReceiptMethod"] = false
	if len(ids) == 0 {
		return nil
	}
	payments, e := financeRows(ctx, tx, a, "payments", []string{"id", "method", "verification_state", "reversal_of", "refund_of"}, []erpwire.Predicate{{Column: "id", Op: erpwire.In, Value: ids}}, "id")
	if e != nil {
		return financeReadError(e, "Draft journal unavailable")
	}
	posted, e := financeRows(ctx, tx, a, "journal_entries", []string{"source_payment_id"}, []erpwire.Predicate{{Column: "source_payment_id", Op: erpwire.In, Value: ids}}, "id")
	if e != nil {
		return financeReadError(e, "Draft journal unavailable")
	}
	postedIDs := map[string]bool{}
	for _, row := range posted {
		postedIDs[text(row["source_payment_id"])] = true
	}
	ready := []erpwire.Row{}
	for _, payment := range payments {
		if text(payment["verification_state"]) != "verified" || payment["reversal_of"] != nil || payment["refund_of"] != nil {
			continue
		}
		if !includes([]string{"cash", "transfer", "promptpay", "card", "cheque"}, text(payment["method"])) {
			out["otherReceiptMethod"] = true
			continue
		}
		payment["posted"] = postedIDs[text(payment["id"])]
		ready = append(ready, payment)
	}
	out["cashReceiptPosts"] = ready
	return nil
}

func financeSalesChain(quoteStatus, invoiceStatus string, issued bool, owed money.Satang, vatRegistered bool) erpwire.Row {
	live := invoiceStatus != "cancelled"
	issued = issued && live
	paid := issued && owed <= 0
	quoteDone := live || quoteStatus == "accepted" || quoteStatus == "converted"
	stopped := !live && (quoteStatus == "declined" || quoteStatus == "expired")
	pick := func(done, current bool) string {
		if done {
			return "done"
		}
		if current {
			return "current"
		}
		return "todo"
	}
	steps := []erpwire.Row{}
	if quoteStatus != "" {
		state := pick(quoteDone, true)
		if stopped {
			state = "stopped"
		}
		steps = append(steps, erpwire.Row{"key": "quote", "th": "ใบเสนอราคา", "en": "Quotation", "state": state})
	}
	issueTH, issueEN := "ออกเอกสาร", "Issued"
	if vatRegistered {
		issueTH = "ออกเอกสาร + VAT"
		issueEN = "Issued + VAT"
	}
	steps = append(steps, erpwire.Row{"key": "invoice", "th": "ใบแจ้งหนี้ (ร่าง)", "en": "Invoice draft", "state": pick(issued, quoteDone && !live || live && !issued)}, erpwire.Row{"key": "issued", "th": issueTH, "en": issueEN, "state": pick(issued, false)}, erpwire.Row{"key": "receipt", "th": "ใบเสร็จ", "en": "Receipt", "state": pick(paid, issued && !paid)})
	out := erpwire.Row{"steps": steps, "next": nil, "vatNote": nil}
	if !stopped && !paid {
		command, th, en := "", "", ""
		switch {
		case issued:
			command, th, en = "pay", "บันทึกรับเงิน / ใบเสร็จ", "Record payment / receipt"
		case live:
			command, th, en = "issue", "ออกใบแจ้งหนี้", "Issue the invoice"
		case quoteStatus == "accepted" || quoteStatus == "converted":
			command, th, en = "convert", "สร้างใบแจ้งหนี้ฉบับร่าง", "Create draft invoice"
		case quoteStatus == "sent":
			command, th, en = "accept", "อนุมัติใบเสนอราคา", "Accept the quotation"
		}
		if command != "" {
			out["next"] = erpwire.Row{"command": command, "th": th, "en": en}
		}
	}
	if issued && vatRegistered {
		out["vatNote"] = "ข้อมูล VAT พร้อมให้ตรวจ — เอกสารนี้ยังไม่ใช่ใบกำกับภาษีตามกฎหมายและยังไม่ได้ยื่นกรมสรรพากร / VAT figures ready for review. Operational document, not a statutory tax invoice and not filed."
	}
	return out
}

func (s *Service) receiptsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	params, e := pageParams(raw)
	if e != nil {
		return nil, e
	}
	out := erpwire.Row{"today": s.today(), "orgId": a.OrgID(), "manage": a.Role() != erpwire.Member, "client": nil, "customer": nil, "open": []erpwire.Row{}, "claims": []erpwire.Row{}, "receipts": []erpwire.Row{}, "available": []erpwire.Row{}}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		clients, e := financeRows(ctx, tx, a, "clients", []string{"id", "name"}, nil, "name", "id")
		if e != nil {
			return e
		}
		out["clients"] = clients
		id := text(params["client"])
		if !validID(id) {
			return nil
		}
		var selected erpwire.Row
		for _, client := range clients {
			if text(client["id"]) == id {
				selected = client
			}
		}
		if selected == nil {
			return nil
		}
		out["client"] = selected
		where := []erpwire.Predicate{eq("client_id", id)}
		invoices, e := financeRows(ctx, tx, a, "invoices", []string{"id", "number"}, append(where, erpwire.Predicate{Column: "issued_snapshot_id", Op: erpwire.NotEqual, Value: nil}, erpwire.Predicate{Column: "status", Op: erpwire.NotEqual, Value: "cancelled"}), "id")
		if e != nil {
			return e
		}
		balances, e := financeRows(ctx, tx, a, "invoice_balances", []string{"invoice_id", "outstanding_satang"}, where, "invoice_id")
		if e != nil {
			return e
		}
		byID := map[string]money.Satang{}
		for _, balance := range balances {
			v, e := amount(balance["outstanding_satang"])
			if e != nil {
				return e
			}
			byID[text(balance["invoice_id"])] = v
		}
		open := []erpwire.Row{}
		for _, inv := range invoices {
			if owed := byID[text(inv["id"])]; owed > 0 {
				inv["outstanding"] = owed
				open = append(open, inv)
			}
		}
		out["open"] = open
		out["invoices"] = invoices
		claims, e := financeRows(ctx, tx, a, "payment_claims", []string{"id", "amount_satang", "reference", "requested_allocations"}, append(where, erpwire.Predicate{Column: "invoice_id", Op: erpwire.Is, Value: nil}, eq("status", "pending")), "id")
		if e != nil {
			return e
		}
		for _, claim := range claims {
			allocations, ok := claim["requested_allocations"].([]any)
			if !ok {
				return errors.New("Invalid receipt allocation evidence")
			}
			for _, entry := range allocations {
				allocation := object(entry)
				if !validID(text(allocation["invoice_id"])) {
					return errors.New("Invalid receipt allocation evidence")
				}
				if _, e := amount(allocation["amount_satang"]); e != nil {
					return e
				}
			}
		}
		out["claims"] = claims
		receipts, e := financeRows(ctx, tx, a, "payments", []string{"id", "amount_satang", "paid_at", "verification_reference", "reversal_of"}, append(where, eq("verification_state", "verified")), "created_at", "id")
		if e != nil {
			return e
		}
		available, e := financeRows(ctx, tx, a, "customer_receipt_balances", []string{"payment_id", "available_satang"}, where, "payment_id")
		if e != nil {
			return e
		}
		credits := map[string]money.Satang{}
		for _, row := range available {
			v, e := amount(row["available_satang"])
			if e != nil {
				return e
			}
			credits[text(row["payment_id"])] = v
		}
		reversed := map[string]bool{}
		for _, receipt := range receipts {
			if r := text(receipt["reversal_of"]); r != "" {
				reversed[r] = true
			}
		}
		for _, receipt := range receipts {
			receipt["availableCredit"] = credits[text(receipt["id"])]
			receipt["canReverse"] = a.Role() != erpwire.Member && receipt["reversal_of"] == nil && !reversed[text(receipt["id"])]
		}
		out["receipts"] = receipts
		out["available"] = available
		customer, e := one(ctx, tx, erpwire.Select{Table: "client_balances", Columns: []string{"credit_satang", "outstanding_satang"}, Where: append(scope(a), where...)})
		if e != nil {
			return financeReadError(e, "Customer balance unavailable")
		}
		out["customer"] = customer
		return nil
	})
	if e != nil {
		return nil, loaderError(e, "Customer receipts unavailable")
	}
	return out, nil
}

func (s *Service) businessProfilePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "settings:manage") {
		return erpwire.Row{"message": "Only owners and admins can manage the business profile."}, nil
	}
	out := erpwire.Row{"orgId": a.OrgID()}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		profile, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"legal_name", "business_address", "tax_id", "tax_status", "vat_registered", "vat_rate_bps", "prices_include_vat", "branch_label", "tax_invoice_template"}, Where: scope(a)})
		if e != nil {
			return e
		}
		taxStatus := text(profile["tax_status"])
		if taxStatus != "registered" && taxStatus != "not_registered" {
			taxStatus = "unknown"
		}
		vatRate := profile["vat_rate_bps"]
		if vatRate == nil {
			vatRate = int64(700)
		}
		initial := erpwire.Row{"vatRateBps": vatRate, "pricesIncludeVat": profile["prices_include_vat"] == true, "branchLabel": text(profile["branch_label"]), "legalName": text(profile["legal_name"]), "address": text(profile["business_address"]), "taxId": text(profile["tax_id"]), "taxStatus": taxStatus}
		template := financeTemplate(profile["tax_invoice_template"])
		out["initial"] = initial
		out["template"] = template
		out["checks"] = financeTaxChecklist(initial, template)
		return nil
	})
	if e != nil {
		return nil, loaderError(e, "Business profile unavailable")
	}
	return out, nil
}
