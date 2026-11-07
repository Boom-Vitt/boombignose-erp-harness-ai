// Package erpdata implements authenticated, current-workspace, read-only ERP tools.
// Catalog projections originate in lib/mcp/reader-catalog.mjs. Database RLS is
// authoritative; capabilities here are additional gates, never database grants.
package erpdata

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

//go:embed catalog.json
var catalogJSON []byte

//go:embed tools.json
var toolsJSON []byte

type Options struct {
	Store     erpwire.ReadStore
	Documents erpwire.DocumentReader
	Now       func() time.Time
}
type Reader struct {
	store     erpwire.ReadStore
	documents erpwire.DocumentReader
	now       func() time.Time
	entities  []entity
	byKey     map[string]entity
	tools     []erpwire.ToolSpec
}
type field struct {
	Key          string `json:"key"`
	LabelEn      string `json:"labelEn"`
	LabelTh      string `json:"labelTh"`
	Kind         string `json:"kind"`
	Unit         string `json:"unit,omitempty"`
	Searchable   bool   `json:"searchable"`
	TextReadable bool   `json:"textReadable"`
}
type entity struct {
	Key                string             `json:"key"`
	LabelEn            string             `json:"labelEn"`
	LabelTh            string             `json:"labelTh"`
	Fields             []field            `json:"fields"`
	PrimaryKey         []string           `json:"primaryKey"`
	RequiredCapability erpwire.Capability `json:"requiredCapability"`
	Scope              string             `json:"scope"`
	Exclusions         map[string]string  `json:"exclusions"`
	Readable           *bool              `json:"readable,omitempty"`
	Route              string             `json:"route,omitempty"`
	FinancialAuthority string             `json:"financialAuthority,omitempty"`
	Reason             string             `json:"reason,omitempty"`
	ExcludedFields     []string           `json:"excludedFields,omitempty"`
}

func nilInterface(v any) bool {
	if v == nil {
		return true
	}
	k := reflect.ValueOf(v)
	switch k.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Func, reflect.Interface, reflect.Slice:
		return k.IsNil()
	}
	return false
}
func New(o Options) (*Reader, error) {
	if nilInterface(o.Store) {
		return nil, errors.New("ERP read store is required")
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	r := &Reader{store: o.Store, documents: o.Documents, now: o.Now, byKey: map[string]entity{}}
	if nilInterface(r.documents) {
		r.documents = nil
	}
	if err := json.Unmarshal(catalogJSON, &r.entities); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(toolsJSON, &r.tools); err != nil {
		return nil, err
	}
	for _, e := range r.entities {
		r.byKey[e.Key] = e
	}
	return r, nil
}
func (e entity) available(a erpwire.Actor) bool {
	return (e.Readable == nil || *e.Readable) && (e.RequiredCapability == "" || erpwire.Can(a.Role(), e.RequiredCapability))
}
func (r *Reader) Specs(ctx context.Context, a erpwire.Actor) (erpwire.ToolCatalog, error) {
	var out erpwire.ToolCatalog
	if err := a.Validate(r.now()); err != nil {
		return out, err
	}
	err := r.store.Read(ctx, a, func(erpwire.ReadTx) error {
		for _, s := range r.tools {
			if s.Name == "finance_summary" && !erpwire.Can(a.Role(), "profit:view") {
				out.Unavailable = append(out.Unavailable, s.Name)
				continue
			}
			s.InputSchema = append(json.RawMessage(nil), s.InputSchema...)
			out.Tools = append(out.Tools, s)
		}
		return nil
	})
	for _, e := range r.entities {
		if !e.available(a) {
			out.Unavailable = append(out.Unavailable, "erp_data_read:"+e.Key)
		}
	}
	if r.documents == nil {
		out.Unavailable = append(out.Unavailable, "erp_data_text: retained attachment content (DocumentReader not configured)")
	}
	return out, err
}
func decode(raw []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := d.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}
func argsObject(raw []byte) (map[string]any, error) {
	var a map[string]any
	if err := decode(raw, &a); err != nil {
		return nil, err
	}
	if a == nil {
		return nil, errors.New("tool arguments must be an object")
	}
	return a, nil
}
func allowed(a map[string]any, keys ...string) error {
	for k := range a {
		found := false
		for _, s := range keys {
			found = found || s == k
		}
		if !found {
			return fmt.Errorf("unknown argument %q", k)
		}
	}
	return nil
}
func integer(v any) (int64, error) {
	var s string
	switch x := v.(type) {
	case json.Number:
		s = string(x)
	case string:
		s = x
	case int:
		s = strconv.Itoa(x)
	case int64:
		s = strconv.FormatInt(x, 10)
	default:
		return 0, errors.New("exact integer required")
	}
	if s == "" || strings.ContainsAny(s, ".eE+") {
		return 0, errors.New("exact integer required")
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n > erpwire.MaxSafeInteger || n < -erpwire.MaxSafeInteger {
		return 0, erpwire.ErrUnsafeAmount
	}
	return n, nil
}
func bound(a map[string]any, k string, def, min, max int) (int, error) {
	v, ok := a[k]
	if !ok {
		return def, nil
	}
	if _, ok := v.(json.Number); !ok {
		return 0, fmt.Errorf("%s must be an integer", k)
	}
	n, err := integer(v)
	if err != nil || n < int64(min) || n > int64(max) {
		return 0, fmt.Errorf("invalid %s bounds", k)
	}
	return int(n), nil
}
func str(a map[string]any, k string, max int, required bool) (string, error) {
	v, ok := a[k]
	if !ok && !required {
		return "", nil
	}
	s, ok := v.(string)
	if !ok || !utf8.ValidString(s) || utf8.RuneCountInString(s) > max || (required && s == "") {
		return "", fmt.Errorf("invalid %s", k)
	}
	return s, nil
}
func (r *Reader) Call(ctx context.Context, a erpwire.Actor, name string, raw json.RawMessage) (erpwire.ToolResult, error) {
	var out erpwire.ToolResult
	if err := a.Validate(r.now()); err != nil {
		return out, err
	}
	args, err := argsObject(raw)
	if err != nil {
		return out, err
	}
	if _, ok := args["org_id"]; ok {
		return out, erpwire.ErrForbidden
	}
	if name == "finance_summary" {
		if err := a.Authorize("profit:view", r.now()); err != nil {
			return out, err
		}
	}
	err = r.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		switch name {
		case "erp_data_catalog":
			out, e = r.catalog(a, args)
		case "erp_data_read", "erp_data_text":
			out, e = r.generic(ctx, tx, a, name, args)
		default:
			out, e = r.special(ctx, tx, a, name, args)
		}
		return e
	})
	return out, err
}
func result(v any) (erpwire.ToolResult, error) {
	b, err := json.Marshal(v)
	return erpwire.ToolResult{Content: b}, err
}
func exactSelection(s erpwire.Selection, limit int) error {
	if s.Total == nil || *s.Total < 0 || *s.Total > erpwire.MaxSafeInteger || len(s.Rows) > limit {
		return errors.New("exact authorized count is unavailable")
	}
	return nil
}

var _ erpwire.ToolRunner = (*Reader)(nil)
