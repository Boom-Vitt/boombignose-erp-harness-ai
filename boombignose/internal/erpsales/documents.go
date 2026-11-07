package erpsales

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func salesTaxBreakdown(value any) ([]erpwire.Row, error) {
	if value == nil {
		return []erpwire.Row{}, nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, errors.New("Invalid tax breakdown")
	}
	var rows []erpwire.Row
	if erpwire.DecodeJSON(raw, &rows) != nil || rows == nil {
		return nil, errors.New("Invalid tax breakdown")
	}
	out := make([]erpwire.Row, 0, len(rows))
	for _, row := range rows {
		if _, ok := row["rateBps"].(json.Number); !ok {
			return nil, errors.New("Invalid tax breakdown")
		}
		if _, ok := row["vatSatang"].(json.Number); !ok {
			return nil, errors.New("Invalid tax breakdown")
		}
		vat, err := satang(row["vatSatang"])
		if err != nil {
			return nil, errors.New("Invalid tax breakdown")
		}
		out = append(out, erpwire.Row{"rateBps": row["rateBps"], "vatSatang": vat})
	}
	return out, nil
}

func salesPublicReference(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, kind, id string) (erpwire.Row, error) {
	settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"public_document_refs_enabled"}, Where: scope(a)})
	if e != nil {
		return nil, e
	}
	enabled, _ := settings["public_document_refs_enabled"].(bool)
	out := erpwire.Row{"enabled": enabled, "display": nil}
	if !enabled {
		return out, nil
	}
	row, e := one(ctx, tx, erpwire.Select{Table: "document_public_refs", Columns: []string{"reference"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("kind", kind), eq("record_id", id)}})
	if e != nil {
		return nil, e
	}
	if display := salesReferenceDisplay(text(row["reference"]), kind); display != "" {
		out["display"] = display
	}
	return out, nil
}
func salesReferenceDisplay(code, kind string) string {
	prefix := map[string]string{"quote": "quo", "purchase_order": "po", "receipt": "grn", "delivery": "dlv", "invoice": "inv"}[kind]
	if prefix == "" || !strings.HasPrefix(code, prefix+"1") || len(code) != len(prefix)+21 {
		return ""
	}
	alphabet := "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
	values := []uint32{}
	for _, c := range []byte(prefix) {
		values = append(values, uint32(c>>5))
	}
	values = append(values, 0)
	for _, c := range []byte(prefix) {
		values = append(values, uint32(c&31))
	}
	body := code[len(prefix)+1:]
	for _, c := range body {
		i := strings.IndexRune(alphabet, c)
		if i < 0 {
			return ""
		}
		values = append(values, uint32(i))
	}
	chk := uint32(1)
	gen := []uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	for _, v := range values {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ v
		for i, g := range gen {
			if top>>i&1 != 0 {
				chk ^= g
			}
		}
	}
	if chk != 0x2bc830a3 {
		return ""
	}
	parts := []string{}
	for i := 0; i < len(body); i += 4 {
		end := i + 4
		if end > len(body) {
			end = len(body)
		}
		parts = append(parts, body[i:end])
	}
	return prefix + "1" + strings.Join(parts, "-")
}
func salesDocumentSections(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, parent, id string) ([]erpwire.Row, error) {
	return all(ctx, tx, erpwire.Select{Table: "document_sections", Columns: []string{"id", "kind", "description", "lines_before", "position"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq(parent, id)}, Order: ordered("position", "id")})
}
func salesDecimalText(v any) (string, error) {
	s, ok := numberText(v)
	if !ok {
		n, e := integer(v)
		if e != nil {
			return "", e
		}
		s = strconv.FormatInt(n, 10)
	}
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	if s == "" {
		s = "0"
	}
	return s, nil
}
func salesGridRows(lines, sections []erpwire.Row) ([]erpwire.Row, error) {
	sections = append([]erpwire.Row{}, sections...)
	sort.SliceStable(sections, func(i, j int) bool {
		a, _ := integer(sections[i]["lines_before"])
		b, _ := integer(sections[j]["lines_before"])
		if a != b {
			return a < b
		}
		a, _ = integer(sections[i]["position"])
		b, _ = integer(sections[j]["position"])
		return a < b
	})
	out := []erpwire.Row{}
	next := 0
	addSection := func(r erpwire.Row) {
		kind := text(r["kind"])
		if kind != "note" {
			kind = "section"
		}
		out = append(out, erpwire.Row{"kind": kind, "id": r["id"], "description": r["description"]})
	}
	for i, r := range lines {
		for next < len(sections) {
			before, e := integer(sections[next]["lines_before"])
			if e != nil {
				return nil, e
			}
			if before > int64(i) {
				break
			}
			addSection(sections[next])
			next++
		}
		amount, e := satang(r["unit_price_satang"])
		if e != nil || amount < 0 {
			return nil, errors.New("Invalid satang amount")
		}
		qty, e := salesDecimalText(r["quantity"])
		if e != nil {
			return nil, e
		}
		rate := r["tax_rate_bps"]
		if rate == nil {
			rate = int64(0)
		}
		row := erpwire.Row{"kind": "line", "id": r["id"], "productId": r["product_id"], "description": r["description"], "quantity": qty, "unit": text(r["unit"]), "unitPrice": money.FormatBaht(amount), "taxRateBps": rate}
		if extras, ok := r["extras"]; ok {
			row["extras"] = extras
		}
		out = append(out, row)
	}
	for ; next < len(sections); next++ {
		addSection(sections[next])
	}
	return out, nil
}
