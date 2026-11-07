package localai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"reflect"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Reject duplicate keys and a second JSON value independently of the inference
// backend. UseNumber preserves exact integers through tool argument validation.
func strictJSON(b []byte, dst any) error {
	if !utf8.Valid(b) {
		return errors.New("invalid UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if err := walkJSON(d, 0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("extra JSON value")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	d.DisallowUnknownFields()
	return d.Decode(dst)
}
func walkJSON(d *json.Decoder, depth int) error {
	if depth > 32 {
		return errors.New("JSON nesting limit")
	}
	t, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			key, e := d.Token()
			if e != nil {
				return e
			}
			s, ok := key.(string)
			if !ok || seen[s] {
				return errors.New("duplicate JSON key")
			}
			seen[s] = true
			if e = walkJSON(d, depth+1); e != nil {
				return e
			}
		}
		t, err = d.Token()
		if err != nil || t != json.Delim('}') {
			return errors.New("invalid object")
		}
	case '[':
		for d.More() {
			if err = walkJSON(d, depth+1); err != nil {
				return err
			}
		}
		t, err = d.Token()
		if err != nil || t != json.Delim(']') {
			return errors.New("invalid array")
		}
	default:
		return errors.New("invalid JSON delimiter")
	}
	return nil
}
func jsonBytes(v any) []byte { b, _ := json.Marshal(v); return b }
func objectSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}
func stringSchema(max int) map[string]any {
	return map[string]any{"type": "string", "minLength": 1, "maxLength": max}
}
func arraySchema(items any, max int) map[string]any {
	return map[string]any{"type": "array", "items": items, "maxItems": max}
}
func enumSchema(values []string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

// validateSchema implements the schema vocabulary used by authorized tools and
// output contracts. Schemas remain application-owned; model JSON cannot add
// fields or select identity/SQL overrides. Unknown assertion keywords fail
// closed, rather than pretending that schema-only decoding enforced them.
func validateSchema(schema any, value any) error { return validateNode(schema, value, schema, 0) }
func validateNode(raw, value, root any, depth int) error {
	if depth > 40 {
		return errors.New("schema depth limit")
	}
	if b, ok := raw.(bool); ok {
		if b {
			return nil
		}
		return errors.New("schema rejects value")
	}
	s, ok := raw.(map[string]any)
	if !ok {
		return errors.New("invalid schema")
	}
	allowed := map[string]bool{"type": true, "properties": true, "required": true, "additionalProperties": true, "items": true, "minItems": true, "maxItems": true, "minLength": true, "maxLength": true, "minimum": true, "maximum": true, "exclusiveMinimum": true, "exclusiveMaximum": true, "pattern": true, "enum": true, "const": true, "oneOf": true, "anyOf": true, "allOf": true, "not": true, "uniqueItems": true, "minProperties": true, "maxProperties": true, "multipleOf": true, "$ref": true, "$defs": true, "definitions": true, "$schema": true, "$id": true, "title": true, "description": true, "default": true, "examples": true, "deprecated": true, "readOnly": true, "writeOnly": true, "format": true}
	for key := range s {
		if !allowed[key] {
			return fmt.Errorf("unsupported schema assertion %s", key)
		}
	}
	if ref, ok := s["$ref"].(string); ok {
		if len(ref) < 2 || ref[:2] != "#/" {
			return errors.New("nonlocal schema reference")
		}
		target := root
		for _, key := range splitRef(ref[2:]) {
			m, ok := target.(map[string]any)
			if !ok {
				return errors.New("invalid schema reference")
			}
			target = m[key]
		}
		if err := validateNode(target, value, root, depth+1); err != nil {
			return err
		}
	}
	if e, ok := s["enum"]; ok {
		found := false
		for _, x := range anySlice(e) {
			if reflect.DeepEqual(x, value) {
				found = true
			}
		}
		if !found {
			return errors.New("value outside enum")
		}
	}
	if x, ok := s["const"]; ok && !reflect.DeepEqual(x, value) {
		return errors.New("wrong constant")
	}
	for _, kind := range []string{"oneOf", "anyOf", "allOf"} {
		if choices, ok := s[kind]; ok {
			list := anySlice(choices)
			matches := 0
			for _, x := range list {
				if validateNode(x, value, root, depth+1) == nil {
					matches++
				}
			}
			if (kind == "oneOf" && matches != 1) || (kind == "anyOf" && matches == 0) || (kind == "allOf" && matches != len(list)) {
				return errors.New("schema branch mismatch")
			}
		}
	}
	if n, ok := s["not"]; ok && validateNode(n, value, root, depth+1) == nil {
		return errors.New("negated schema matched")
	}
	if t, ok := s["type"]; ok {
		valid := false
		for _, kind := range schemaTypes(t) {
			switch kind {
			case "object":
				_, valid = value.(map[string]any)
			case "array":
				_, valid = value.([]any)
			case "string":
				_, valid = value.(string)
			case "boolean":
				_, valid = value.(bool)
			case "null":
				valid = value == nil
			case "number":
				_, valid = value.(json.Number)
			case "integer":
				if n, ok := value.(json.Number); ok {
					r, ok := new(big.Rat).SetString(n.String())
					valid = ok && r.IsInt()
				}
			}
			if valid {
				break
			}
		}
		if !valid {
			return errors.New("wrong JSON type")
		}
	}
	switch v := value.(type) {
	case map[string]any:
		props, _ := s["properties"].(map[string]any)
		for _, r := range anySlice(s["required"]) {
			key, ok := r.(string)
			if !ok {
				return errors.New("invalid required key")
			}
			if _, ok = v[key]; !ok {
				return errors.New("missing required field")
			}
		}
		for key, x := range v {
			if child, ok := props[key]; ok {
				if err := validateNode(child, x, root, depth+1); err != nil {
					return err
				}
			} else if extra, exists := s["additionalProperties"]; exists {
				if b, ok := extra.(bool); ok {
					if !b {
						return errors.New("unknown field")
					}
				} else if err := validateNode(extra, x, root, depth+1); err != nil {
					return err
				}
			}
		}
		if !lengthRange(len(v), s, "minProperties", "maxProperties") {
			return errors.New("object size limit")
		}
	case []any:
		if !lengthRange(len(v), s, "minItems", "maxItems") {
			return errors.New("array size limit")
		}
		for i, x := range v {
			if child, ok := s["items"]; ok {
				if err := validateNode(child, x, root, depth+1); err != nil {
					return err
				}
			}
			if s["uniqueItems"] == true {
				for j := range i {
					if reflect.DeepEqual(v[j], x) {
						return errors.New("duplicate array value")
					}
				}
			}
		}
	case string:
		if !lengthRange(utf8.RuneCountInString(v), s, "minLength", "maxLength") {
			return errors.New("string size limit")
		}
		if p, ok := s["pattern"].(string); ok {
			r, err := regexp.Compile(p)
			if err != nil || !r.MatchString(v) {
				return errors.New("pattern mismatch")
			}
		}
	case json.Number:
		number, ok := new(big.Rat).SetString(v.String())
		if !ok {
			return errors.New("invalid number")
		}
		for _, key := range []string{"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"} {
			if raw, exists := s[key]; exists {
				bound, ok := new(big.Rat).SetString(fmt.Sprint(raw))
				if !ok {
					return errors.New("invalid schema bound")
				}
				cmp := number.Cmp(bound)
				if (key == "minimum" && cmp < 0) || (key == "maximum" && cmp > 0) || (key == "exclusiveMinimum" && cmp <= 0) || (key == "exclusiveMaximum" && cmp >= 0) {
					return errors.New("number bound")
				}
				if key == "multipleOf" && (bound.Sign() <= 0 || !new(big.Rat).Quo(number, bound).IsInt()) {
					return errors.New("number multiple")
				}
			}
		}
	}
	return nil
}
func anySlice(v any) []any {
	switch x := v.(type) {
	case []any:
		return x
	case []string:
		out := make([]any, len(x))
		for i, s := range x {
			out[i] = s
		}
		return out
	}
	return nil
}
func schemaTypes(v any) []string {
	if x, ok := v.(string); ok {
		return []string{x}
	}
	out := []string{}
	for _, x := range anySlice(v) {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
func lengthRange(n int, s map[string]any, min, max string) bool {
	if v, ok := s[min]; ok {
		r, _ := new(big.Rat).SetString(fmt.Sprint(v))
		if r == nil || new(big.Rat).SetInt64(int64(n)).Cmp(r) < 0 {
			return false
		}
	}
	if v, ok := s[max]; ok {
		r, _ := new(big.Rat).SetString(fmt.Sprint(v))
		if r == nil || new(big.Rat).SetInt64(int64(n)).Cmp(r) > 0 {
			return false
		}
	}
	return true
}
func splitRef(s string) []string {
	parts := strings.Split(s, "/")
	for i, p := range parts {
		parts[i] = strings.ReplaceAll(strings.ReplaceAll(p, "~1", "/"), "~0", "~")
	}
	return parts
}

// Provider envelopes may contain evolving Ollama metadata, but not ambiguous
// duplicate keys or trailing objects. Model output contracts stay fully strict.
func decodeEnvelope(b []byte, dst any) error {
	var value any
	if err := strictJSON(b, &value); err != nil {
		return err
	}
	return json.Unmarshal(b, dst)
}
