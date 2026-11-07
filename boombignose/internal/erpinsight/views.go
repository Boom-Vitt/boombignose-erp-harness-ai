package erpinsight

import (
	"bytes"
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

var viewPaths = map[string]string{"deals": "/deals", "finance": "/finance", "clients": "/clients", "quotes": "/quotes", "timesheets": "/timesheets", "projects": "/projects", "purchases": "/purchases", "vendors": "/vendors", "inventory": "/inventory/moves"}
var viewModules = []string{"deals", "finance", "clients", "quotes", "timesheets", "projects", "purchases", "vendors", "inventory"}

func zodType(value any, want string, present bool) string {
	got := "object"
	if !present {
		got = "undefined"
	} else {
		switch value.(type) {
		case nil:
			got = "null"
		case string:
			got = "string"
		case bool:
			got = "boolean"
		case json.Number:
			got = "number"
		case []any:
			got = "array"
		}
	}
	return "Invalid input: expected " + want + ", received " + got
}
func zodEnum(values []string) string {
	return `Invalid option: expected one of "` + strings.Join(values, `"|"`) + `"`
}

func savedViewInput(value any, configOrder []string) (erpwire.Row, string) {
	input, ok := value.(map[string]any)
	if !ok {
		return nil, zodType(value, "object", true)
	}
	module := text(input["module"])
	if !has(viewModules, module) {
		return nil, zodEnum(viewModules)
	}
	name, ok := input["name"].(string)
	if !ok {
		_, present := input["name"]
		return nil, zodType(input["name"], "string", present)
	}
	name = trimText(name)
	if name == "" {
		return nil, "Name is required"
	}
	if jsLength(name) > 80 {
		return nil, "Name is too long"
	}
	config := map[string]any{}
	if raw, present := input["config"]; present {
		var ok bool
		config, ok = raw.(map[string]any)
		if !ok {
			return nil, zodType(raw, "object", true)
		}
	}
	keys := []string{"stage", "status", "q", "period", "mine", "warehouse", "product", "sourceId", "groupBy"}
	for _, key := range keys {
		v, present := config[key]
		if !present {
			continue
		}
		s, ok := v.(string)
		switch key {
		case "stage", "status", "q":
			if !ok {
				return nil, zodType(v, "string", true)
			}
			if key == "q" && jsLength(s) > 200 {
				return nil, "Too big: expected string to have <=200 characters"
			}
		case "period":
			if !has([]string{"this_month", "last_month", "this_quarter", "this_year"}, s) {
				return nil, zodEnum([]string{"this_month", "last_month", "this_quarter", "this_year"})
			}
		case "mine":
			if !ok || s != "1" {
				return nil, `Invalid input: expected "1"`
			}
		case "groupBy":
			values := []string{"status", "client", "month", "industry", "source", "project", "stage", "owner", "vendor"}
			if !has(values, s) {
				return nil, zodEnum(values)
			}
		default:
			if !ok {
				return nil, zodType(v, "string", true)
			}
			if !validID(s) {
				return nil, "Invalid GUID"
			}
		}
	}
	unknown := []string{}
	for _, key := range configOrder {
		if !has(keys, key) {
			unknown = append(unknown, `"`+key+`"`)
		}
	}
	if len(unknown) > 0 {
		suffix := ""
		if len(unknown) > 1 {
			suffix = "s"
		}
		return nil, "Unrecognized key" + suffix + ": " + strings.Join(unknown, ", ")
	}
	return erpwire.Row{"module": module, "name": name, "config": config}, ""
}

func viewConfigKeys(raw json.RawMessage) []string {
	var input map[string]json.RawMessage
	if erpwire.DecodeJSON(raw, &input) != nil {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(input["config"]))
	token, e := decoder.Token()
	if e != nil || token != json.Delim('{') {
		return nil
	}
	keys := []string{}
	seen := map[string]bool{}
	for decoder.More() {
		token, e := decoder.Token()
		if e != nil {
			return nil
		}
		key, ok := token.(string)
		if !ok {
			return nil
		}
		if !seen[key] {
			keys = append(keys, key)
			seen[key] = true
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return nil
		}
	}
	index := func(key string) (uint64, bool) {
		n, e := strconv.ParseUint(key, 10, 32)
		return n, e == nil && n < 4294967295 && strconv.FormatUint(n, 10) == key
	}
	sort.SliceStable(keys, func(i, j int) bool {
		a, ai := index(keys[i])
		b, bi := index(keys[j])
		if ai != bi {
			return ai
		}
		return ai && a < b
	})
	return keys
}

func (s *Service) createSavedView(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var input any
	if args.Decode(0, &input) != nil {
		return invalid("Invalid input")
	}
	row, message := savedViewInput(input, viewConfigKeys(args[0]))
	if message != "" {
		return invalid(message)
	}
	row["org_id"] = a.OrgID()
	row["user_id"] = a.UserID()
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "saved_views", Rows: []erpwire.Row{row}})
		return e
	})
	if e != nil {
		return actionFailure(e, "Unable to save view.")
	}
	return response("", viewPaths[text(row["module"])]), nil
}

func (s *Service) deleteSavedView(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var id string
	if args.Decode(0, &id) != nil || !validID(id) {
		return invalid("Invalid view")
	}
	var module string
	where := append(scoped(a, id), eq("user_id", a.UserID()))
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		row, e := one(ctx, tx, erpwire.Select{Table: "saved_views", Columns: []string{"module"}, Where: where})
		if e != nil {
			return e
		}
		module = text(row["module"])
		return nil
	})
	if authError(e) {
		return nil, e
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error { _, e := tx.Delete(ctx, "saved_views", where, nil); return e })
	if e != nil {
		return actionFailure(e, "Unable to delete view.")
	}
	if path := viewPaths[module]; path != "" {
		return response("", path), nil
	}
	return response(""), nil
}
