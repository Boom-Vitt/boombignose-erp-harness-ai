package erpsales

import (
	"context"
	"encoding/json"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

var templateDecimal = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

func templateMoney(v any) (money.Satang, bool) {
	var s string
	switch value := v.(type) {
	case string:
		s = jsTrim(value)
		if s == "" {
			s = "0"
		}
	case json.Number:
		s = value.String()
	case bool:
		if value {
			s = "1"
		} else {
			s = "0"
		}
	case []any:
		if len(value) == 0 {
			s = "0"
		} else if len(value) == 1 {
			if value[0] == nil {
				s = "0"
			} else if x, ok := numberText(value[0]); ok {
				s = jsTrim(x)
				if s == "" {
					s = "0"
				}
			}
		}
	default:
		return 0, false
	}
	if len(s) > 1024 {
		return 0, false
	}
	var n *big.Rat
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") || strings.HasPrefix(s, "0b") || strings.HasPrefix(s, "0B") || strings.HasPrefix(s, "0o") || strings.HasPrefix(s, "0O") {
		i, ok := new(big.Int).SetString(s, 0)
		if !ok {
			return 0, false
		}
		n = new(big.Rat).SetInt(i)
	} else {
		if !templateDecimal.MatchString(s) {
			return 0, false
		}
		if _, exponent, scientific := strings.Cut(strings.ToLower(s), "e"); scientific {
			exp, err := strconv.Atoi(exponent)
			if err != nil || exp > 400 || exp < -400 {
				return 0, false
			}
		}
		var ok bool
		n, ok = new(big.Rat).SetString(s)
		if !ok {
			return 0, false
		}
	}
	if n.Sign() < 0 {
		return 0, false
	}
	n.Mul(n, big.NewRat(100, 1))
	n.Add(n, big.NewRat(1, 2))
	rounded := new(big.Int).Quo(n.Num(), n.Denom())
	if !rounded.IsInt64() || rounded.Int64() > int64(money.MaxSafeSatang) {
		return 0, false
	}
	return money.Satang(rounded.Int64()), true
}
func templateStrings(v any, trim bool) ([]string, bool) {
	out := []string{}
	if v == nil {
		return out, false
	}
	values, ok := v.([]any)
	if !ok {
		if strings, yes := v.([]string); yes {
			for _, s := range strings {
				values = append(values, s)
			}
			ok = true
		}
	}
	if !ok {
		return nil, false
	}
	for _, x := range values {
		s, ok := x.(string)
		if !ok {
			return nil, false
		}
		if trim {
			s = jsTrim(s)
			if s == "" {
				continue
			}
		}
		out = append(out, s)
	}
	return out, true
}
func templateColumns(input erpwire.Row, a erpwire.Actor) (erpwire.Row, bool) {
	name, ok := input["name"].(string)
	if !ok || jsLength(name) < 1 {
		return nil, false
	}
	row := erpwire.Row{"org_id": a.OrgID(), "name": jsTrim(name), "category_id": nil, "description": nil, "internal_value_satang": nil, "price_satang": nil, "reusable_notes": nil, "implementation_checklist": []string{}, "tags": []string{}}
	if value, ok := input["categoryId"]; ok && value != nil {
		if !validID(text(value)) {
			return nil, false
		}
		row["category_id"] = value
	}
	for key, dest := range map[string]string{"description": "description", "reusableNotes": "reusable_notes"} {
		if v, ok := input[key]; ok && v != nil {
			str, ok := v.(string)
			if !ok {
				return nil, false
			}
			row[dest] = nilText(str)
		}
	}
	for key, dest := range map[string]string{"internalValueBaht": "internal_value_satang", "priceBaht": "price_satang"} {
		if v, ok := input[key]; ok && v != nil {
			amount, ok := templateMoney(v)
			if !ok {
				return nil, false
			}
			row[dest] = int64(amount)
		}
	}
	for key, dest := range map[string]string{"implementationChecklist": "implementation_checklist", "tags": "tags"} {
		if v, ok := input[key]; ok {
			values, ok := templateStrings(v, true)
			if !ok {
				return nil, false
			}
			row[dest] = values
		}
	}
	return row, true
}
func (s *Service) createTemplate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "template:manage") != nil {
		return invalid("Only owners and admins can manage templates.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil {
		return invalid("Invalid input")
	}
	row, ok := templateColumns(input, a)
	if !ok {
		return invalid("Invalid input")
	}
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Insert(ctx, erpwire.Insert{Table: "automation_templates", Rows: []erpwire.Row{row}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(rows) != 1 {
			return erpwire.ErrNotFound
		}
		id = text(rows[0]["id"])
		return nil
	})
	if e != nil {
		return failure(e)
	}
	return response("/templates/"+id, "/templates"), nil
}
func (s *Service) updateTemplate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "template:manage") != nil {
		return invalid("Only owners and admins can manage templates.")
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	if e != nil {
		return nil, e
	}
	if !validID(id) {
		return invalid("Invalid template.")
	}
	var input erpwire.Row
	if args.Decode(1, &input) != nil {
		return invalid("Invalid input")
	}
	row, ok := templateColumns(input, a)
	if !ok {
		return invalid("Invalid input")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Update(ctx, "automation_templates", row, scoped(a, id), []string{"id"})
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return businessError("Template not found or unavailable.")
		}
		return nil
	})
	if e != nil {
		return failure(e)
	}
	return response("/templates/"+id, "/templates", "/templates/"+id), nil
}
func (s *Service) deleteTemplate(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "template:manage") != nil {
		return invalid("Only owners and admins can delete templates.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	id, e := stringArg(args, 0)
	if e != nil {
		return nil, e
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Delete(ctx, "automation_templates", scoped(a, id), nil)
		return e
	})
	if e != nil {
		return failure(e)
	}
	return response("/templates", "/templates"), nil
}

var categoryNonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func (s *Service) createCategory(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if authorize(a, "template:manage") != nil {
		return invalid("Only owners and admins can manage template categories.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input erpwire.Row
	if args.Decode(0, &input) != nil || jsLength(text(input["name"])) < 1 {
		return invalid("Invalid input")
	}
	name := jsTrim(text(input["name"]))
	slug := strings.Trim(categoryNonSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		return invalid("Name must contain letters or numbers")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "template_categories", Rows: []erpwire.Row{{"org_id": a.OrgID(), "name": name, "slug": slug}}})
		return e
	})
	if e != nil {
		return failure(e)
	}
	return response("", "/templates"), nil
}

var templateFields = []string{"id", "name", "description", "internal_value_satang", "price_satang", "reusable_notes", "implementation_checklist", "tags", "category_id"}

func (s *Service) templatesPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	out := erpwire.Row{"manage": authorize(a, "template:manage") == nil}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		categories, e := all(ctx, tx, erpwire.Select{Table: "template_categories", Columns: []string{"id", "name", "slug"}, Where: scope(a), Order: ordered("name", "id")})
		if e != nil {
			return e
		}
		templates, e := all(ctx, tx, erpwire.Select{Table: "automation_templates", Columns: []string{"id", "name", "description", "internal_value_satang", "price_satang", "tags", "category_id"}, Where: scope(a), Order: ordered("name", "id")})
		if e != nil {
			return e
		}
		cards := []erpwire.Row{}
		for _, t := range templates {
			tags := t["tags"]
			if tags == nil {
				tags = []string{}
			}
			cards = append(cards, erpwire.Row{"id": t["id"], "name": t["name"], "description": t["description"], "internalValueSatang": t["internal_value_satang"], "priceSatang": t["price_satang"], "tags": tags, "categoryId": t["category_id"]})
		}
		out["categories"] = categories
		out["cards"] = cards
		return nil
	})
	if e != nil {
		return nil, loadError(e, "Templates unavailable. Please reload.")
	}
	return out, nil
}
func templateSteps(v any, trim bool) []string {
	out := []string{}
	values, _ := v.([]any)
	if strs, ok := v.([]string); ok {
		for _, s := range strs {
			values = append(values, s)
		}
	}
	for _, v := range values {
		if s, ok := v.(string); ok {
			if trim {
				s = jsTrim(s)
				if s == "" {
					continue
				}
			}
			out = append(out, s)
		}
	}
	return out
}
func (s *Service) templatePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	out := erpwire.Row{"manage": authorize(a, "template:manage") == nil}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		t, e := one(ctx, tx, erpwire.Select{Table: "automation_templates", Columns: templateFields, Where: scoped(a, id)})
		if e != nil {
			return loadError(e, "Template unavailable. Please reload.")
		}
		if t == nil {
			return erpwire.ErrNotFound
		}
		var category erpwire.Row
		if text(t["category_id"]) != "" {
			category, e = one(ctx, tx, erpwire.Select{Table: "template_categories", Columns: []string{"name"}, Where: scoped(a, text(t["category_id"]))})
			if e != nil {
				return loadError(e, "Template category unavailable. Please reload.")
			}
		}
		out["template"] = t
		out["category"] = category
		out["steps"] = templateSteps(t["implementation_checklist"], true)
		tags := t["tags"]
		if tags == nil {
			tags = []string{}
		}
		out["tags"] = tags
		return nil
	})
	if e != nil {
		return nil, e
	}
	return out, nil
}
func (s *Service) templateNewPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "template:manage"); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	var categories []erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		categories, e = all(ctx, tx, erpwire.Select{Table: "template_categories", Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("name", "id")})
		return e
	})
	if e != nil {
		return nil, loadError(e, "Template categories unavailable. Please reload.")
	}
	return erpwire.Row{"categories": categories, "submitLabel": "Create template"}, nil
}
func (s *Service) templateEditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, "template:manage"); e != nil {
		return nil, e
	}
	id, e := loadID(raw)
	if e != nil {
		return nil, e
	}
	out := erpwire.Row{"submitLabel": "Save changes"}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		t, e := one(ctx, tx, erpwire.Select{Table: "automation_templates", Columns: templateFields, Where: scoped(a, id)})
		if e != nil {
			return e
		}
		if t == nil {
			return erpwire.ErrNotFound
		}
		categories, e := all(ctx, tx, erpwire.Select{Table: "template_categories", Columns: []string{"id", "name"}, Where: scope(a), Order: ordered("name", "id")})
		if e != nil {
			return e
		}
		defaults := erpwire.Row{"name": t["name"], "categoryId": t["category_id"], "description": t["description"], "internalValueBaht": nil, "priceBaht": nil, "reusableNotes": t["reusable_notes"], "checklist": templateSteps(t["implementation_checklist"], false), "tags": t["tags"]}
		if defaults["tags"] == nil {
			defaults["tags"] = []string{}
		}
		for key, dest := range map[string]string{"internal_value_satang": "internalValueBaht", "price_satang": "priceBaht"} {
			if t[key] != nil {
				amount, e := satang(t[key])
				if e != nil {
					return e
				}
				defaults[dest] = json.Number(money.FormatBaht(amount))
			}
		}
		out["template"] = t
		out["categories"] = categories
		out["defaults"] = defaults
		return nil
	})
	if e != nil {
		return nil, loadError(e, "Template editor unavailable. Please reload.")
	}
	return out, nil
}
