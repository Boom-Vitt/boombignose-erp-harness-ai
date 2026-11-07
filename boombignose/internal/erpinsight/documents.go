package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (s *Service) setPublicDocumentRefsEnabled(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "settings:manage") {
		return invalid("Only an owner or admin can update settings.")
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var enabled bool
	if args.Null(0) || args.Decode(0, &enabled) != nil {
		return invalid("Choose whether public references are enabled.")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "org_settings", Rows: []erpwire.Row{{"org_id": a.OrgID(), "public_document_refs_enabled": enabled}}, ConflictColumns: []string{"org_id"}})
		return e
	})
	if e != nil {
		return actionFailure(e, "Unable to update settings.")
	}
	summary := "Disabled typed public document references"
	if enabled {
		summary = "Enabled typed public document references"
	}
	s.audit(ctx, a, "settings", a.OrgID(), "updated", summary, nil)
	return response("", "/settings", "/documents/lookup"), nil
}

func documentTarget(ctx context.Context, tx selector, a erpwire.Actor, kind, id string) (bool, error) {
	table := ""
	switch kind {
	case "quote":
		table = "quotes"
	case "invoice":
		table = "invoices"
	case "purchase_order":
		table = "purchase_orders"
	default:
		table = "stock_documents"
	}
	q := selection(a, table, []string{"id"}, eq("id", id))
	if table == "stock_documents" {
		q.Where = append(q.Where, eq("kind", kind))
	}
	row, e := one(ctx, tx, q)
	return row != nil, e
}

func (s *Service) issueDocumentPublicReference(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "record:write") {
		return invalid("You cannot issue a public reference.")
	}
	args, e := arguments(raw, 2, 2)
	if e != nil {
		return nil, e
	}
	var kind, id string
	if args.Decode(0, &kind) != nil || args.Decode(1, &id) != nil || documentPrefixes[kind] == "" || !validID(id) {
		return invalid("Choose a document before issuing a public reference.")
	}
	enabled, exists, checkingTarget := false, false, false
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		row, e := one(ctx, tx, selection(a, "org_settings", []string{"public_document_refs_enabled"}))
		if e != nil {
			return e
		}
		enabled = row["public_document_refs_enabled"] == true
		if !enabled {
			return nil
		}
		checkingTarget = true
		exists, e = documentTarget(ctx, tx, a, kind, id)
		return e
	})
	if e != nil {
		if checkingTarget {
			if authError(e) {
				return nil, e
			}
			return nil, errors.New(publicMessage(e, "Document unavailable."))
		}
		return actionFailure(e, "Document unavailable.")
	}
	if !enabled {
		return invalid("Public document references are off for this workspace.")
	}
	if !exists {
		return invalid("Document unavailable.")
	}
	for attempt := 0; attempt < 5; attempt++ {
		var existing string
		e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
			query := selection(a, "document_public_refs", []string{"reference"}, eq("kind", kind), eq("record_id", id))
			query.Order = []erpwire.Order{{Column: "reference"}}
			row, e := one(ctx, tx, query)
			if e != nil {
				return e
			}
			existing = text(row["reference"])
			return nil
		})
		if e != nil {
			return actionFailure(e, "Document unavailable.")
		}
		if existing != "" {
			stored, message := parsePublicReference(existing, true)
			if message != "" || stored.Kind != kind {
				return invalid("The stored public reference failed validation.")
			}
			return erpwire.ActionResponse{Value: erpwire.Row{"display": stored.Display}}, nil
		}
		minted, e := generatePublicReference(kind)
		if e != nil {
			return invalid("Could not issue a unique public reference.")
		}
		parsed, message := parsePublicReference(minted.Canonical, true)
		if message != "" || parsed.Kind != kind {
			return invalid("The new public reference failed validation.")
		}
		e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
			_, e := tx.Insert(ctx, erpwire.Insert{Table: "document_public_refs", Rows: []erpwire.Row{{"org_id": a.OrgID(), "reference": minted.Canonical, "kind": kind, "record_id": id, "created_by": a.UserID()}}})
			return e
		})
		if e == nil {
			s.audit(ctx, a, "document_public_ref", id, "issued", "Issued a "+strings.ReplaceAll(kind, "_", " ")+" public reference", erpwire.Row{"kind": kind, "reference": minted.Display})
			result := response("", documentHref(kind, id), "/documents/lookup", "/inventory/documents")
			result.Value = erpwire.Row{"display": minted.Display}
			return result, nil
		}
		if authError(e) {
			return nil, e
		}
		var db interface{ SQLState() string }
		if !errors.As(e, &db) || db.SQLState() != "23505" {
			return actionFailure(e, "Could not issue a unique public reference.")
		}
	}
	return invalid("Could not issue a unique public reference.")
}

var lookupMessages = map[string]string{
	"disabled": "Typed public references are off for this workspace. Document numbers and tax IDs are unchanged.",
	"type":     "Enter the public reference as text.", "too_long": "That code is too long to be a public reference.",
	"format": "That code is not a typed public reference. Accounting numbers and tax IDs stay in their own fields.",
	"case":   "Use one case for the whole code.", "character": "That code contains a character this reference alphabet does not use.",
	"checksum": "The checksum does not match. This looks like a typo, not a different document.",
	"prefix":   "That checksum is valid for a different reference type than this workspace uses.",
	"length":   "That code uses a different reference length than this workspace.", "non_canonical": "Use the printed reference.",
	"not_found": "The code is valid, and this workspace has no matching document. A checksum does not grant access.",
	"mismatch":  "The stored row does not match the reference type. It was not opened.",
}

func (s *Service) lookupPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	params := erpwire.Row{}
	if len(args) > 0 && args.Decode(0, &params) != nil {
		return nil, erpwire.ErrBadArguments
	}
	code := params["code"]
	if code == nil {
		code = ""
	}
	hasCode := true
	switch value := code.(type) {
	case string:
		hasCode = value != ""
	case bool:
		hasCode = value
	case json.Number:
		if n, ok := auditExactInteger(value); ok && n == 0 {
			hasCode = false
		}
	}
	out := erpwire.Row{"code": code, "enabled": false, "message": "", "match": nil}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		row, e := one(ctx, tx, selection(a, "org_settings", []string{"public_document_refs_enabled"}))
		if e != nil {
			return e
		}
		enabled := row["public_document_refs_enabled"] == true
		out["enabled"] = enabled
		if !hasCode {
			return nil
		}
		if !enabled {
			out["message"] = lookupMessages["disabled"]
			return nil
		}
		codeText, isText := code.(string)
		if !isText {
			out["message"] = lookupMessages["type"]
			return nil
		}
		parsed, message := parsePublicReference(codeText, false)
		if message != "" {
			out["message"] = lookupMessages[message]
			return nil
		}
		query := selection(a, "document_public_refs", []string{"kind", "record_id"}, eq("reference", parsed.Canonical))
		query.Order = []erpwire.Order{{Column: "reference"}}
		found, e := one(ctx, tx, query)
		if e != nil {
			return e
		}
		kind := text(found["kind"])
		if documentPrefixes[kind] == "" {
			out["message"] = lookupMessages["not_found"]
			return nil
		}
		if kind != parsed.Kind {
			out["message"] = lookupMessages["mismatch"]
			return nil
		}
		out["match"] = erpwire.Row{"label": documentLabels[kind], "href": documentHref(kind, text(found["record_id"])), "display": parsed.Display}
		return nil
	})
	if e != nil {
		return nil, e
	}
	return out, nil
}
