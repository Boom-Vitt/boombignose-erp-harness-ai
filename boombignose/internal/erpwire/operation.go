package erpwire

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

var ErrBadArguments = errors.New("invalid application operation arguments")

// Arguments is the ordered, presence-preserving application argument list.
// Missing arguments differ from explicit null. No argument may select SQL,
// an organization identity, a role, or a Go symbol to invoke.
type Arguments []json.RawMessage

func ParseArguments(raw json.RawMessage) (Arguments, error) {
	var args Arguments
	if len(raw) == 0 || DecodeJSON(raw, &args) != nil || args == nil || len(args) > 64 {
		return nil, ErrBadArguments
	}
	return args, nil
}

func (args Arguments) Present(index int) bool { return index >= 0 && index < len(args) }
func (args Arguments) Null(index int) bool {
	return args.Present(index) && bytes.Equal(bytes.TrimSpace(args[index]), []byte("null"))
}
func (args Arguments) Decode(index int, destination any) error {
	if !args.Present(index) {
		return ErrBadArguments
	}
	return DecodeJSON(args[index], destination)
}

// DecodeJSON preserves database-safe integer/decimal representations. Struct
// consumers still perform their source-backed domain and capability validation.
func DecodeJSON(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(destination) != nil {
		return ErrBadArguments
	}
	if decoder.Decode(new(any)) != io.EOF {
		return ErrBadArguments
	}
	return nil
}

// ActionResponse separates navigation/invalidation from the original action's
// value. Queries may return their DTO directly. The transport never interprets
// an arbitrary returned object as navigation or as executable instructions.
type ActionResponse struct {
	Value    any
	Redirect string
	Refresh  []string
}

// BrowserMap deliberately represents a JavaScript Map, including empty maps.
// The browser transport restores only this reserved, explicitly tagged value.
type BrowserMap struct {
	Kind    string   `json:"$erp"`
	Entries [][2]any `json:"entries"`
}

func Map(entries [][2]any) BrowserMap {
	if entries == nil {
		entries = [][2]any{}
	}
	return BrowserMap{Kind: "map", Entries: entries}
}

// FormData preserves repeated fields, empty text, filename, MIME and exact file
// bytes. HTTP and each operation enforce their own limits; a file is not a path.
type Upload struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Data []byte `json:"data"`
}

type FormEntry struct {
	Name string  `json:"name"`
	Text *string `json:"text,omitempty"`
	File *Upload `json:"file,omitempty"`
}

type FormData struct {
	Kind    string      `json:"$erp"`
	Entries []FormEntry `json:"entries"`
}

func (args Arguments) Form(index int) (FormData, error) {
	var form FormData
	if args.Decode(index, &form) != nil || form.Kind != "form" || len(form.Entries) > 256 {
		return FormData{}, ErrBadArguments
	}
	for _, entry := range form.Entries {
		if entry.Name == "" || (entry.Text == nil) == (entry.File == nil) {
			return FormData{}, ErrBadArguments
		}
	}
	return form, nil
}

func (form FormData) Text(name string) (string, bool) {
	for _, entry := range form.Entries {
		if entry.Name == name {
			if entry.Text != nil {
				return *entry.Text, true
			}
			return "", false
		}
	}
	return "", false
}

func (form FormData) File(name string) (*Upload, bool) {
	for _, entry := range form.Entries {
		if entry.Name == name {
			return entry.File, entry.File != nil
		}
	}
	return nil, false
}
