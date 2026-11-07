package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func settingSelect(a erpwire.Actor, columns ...string) erpwire.Select {
	return erpwire.Select{Table: "org_settings", Columns: columns, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}}
}
func fallback(row erpwire.Row, key string, value any) any {
	if row[key] == nil {
		return value
	}
	return row[key]
}
func (s *Service) softSetting(ctx context.Context, a erpwire.Actor, q erpwire.Select) (erpwire.Row, error) {
	var row erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; row, e = one(ctx, tx, q); return e })
	if isAuthError(e) {
		return nil, e
	}
	return row, nil
}
func (s *Service) softRows(ctx context.Context, a erpwire.Actor, q erpwire.Select) ([]erpwire.Row, error) {
	rows := []erpwire.Row{}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error { var e error; rows, e = all(ctx, tx, q); return e })
	if isAuthError(e) {
		return nil, e
	}
	if e != nil {
		return []erpwire.Row{}, nil
	}
	return rows, nil
}
func (s *Service) settingsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	canEdit := erpwire.Can(a.Role(), "settings:manage")
	out := erpwire.Row{"orgName": a.OrgName(), "canEdit": canEdit, "appUrl": s.security.AppURL, "mobileDevices": []erpwire.Row{}, "pendingInvites": []erpwire.Row{}, "asr": erpwire.Row{"offered": false, "installed": false}}
	settings, e := s.softSetting(ctx, a, settingSelect(a, "cash_balance_satang", "monthly_burn_satang", "public_document_refs_enabled"))
	if e != nil {
		return nil, e
	}
	out["cashSatang"] = fallback(settings, "cash_balance_satang", int64(0))
	out["burnSatang"] = settings["monthly_burn_satang"]
	out["publicDocumentRefsEnabled"] = fallback(settings, "public_document_refs_enabled", false)
	members, e := s.softRows(ctx, a, erpwire.Select{Table: "memberships", Columns: []string{"user_id", "role", "created_at"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "created_at"}, {Column: "user_id"}}})
	if e != nil {
		return nil, e
	}
	ids := []string{}
	for _, m := range members {
		ids = append(ids, text(m["user_id"]))
	}
	profiles := []erpwire.Row{}
	if len(ids) > 0 {
		e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
			raw, e := tx.ReadRPC(ctx, "record_activity_assignees", erpwire.Row{"p_org_id": a.OrgID()})
			if e != nil {
				return e
			}
			return erpwire.DecodeJSON(raw, &profiles)
		})
		if isAuthError(e) {
			return nil, e
		}
	}
	names := map[string]any{}
	entries := [][2]any{}
	for _, p := range profiles {
		id := text(p["user_id"])
		if !contains(ids, id) {
			continue
		}
		names[id] = p["full_name"]
		entries = append(entries, [2]any{id, p["full_name"]})
	}
	team := []erpwire.Row{}
	for _, m := range members {
		id := text(m["user_id"])
		var email any
		if id == a.UserID() {
			email = a.Email()
		}
		team = append(team, erpwire.Row{"userId": id, "role": m["role"], "fullName": names[id], "email": email, "isSelf": id == a.UserID()})
	}
	out["team"] = team
	out["nameById"] = erpwire.Map(entries)
	if canEdit {
		out["pendingInvites"], e = s.softRows(ctx, a, erpwire.Select{Table: "invitations", Columns: []string{"id", "email", "role", "token"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID()), eq("status", "pending")}, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
		if e != nil {
			return nil, e
		}
		out["mobileDevices"], e = s.softRows(ctx, a, erpwire.Select{Table: "mobile_devices", Columns: []string{"id", "name", "created_at", "last_seen_at", "revoked_at"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
		if e != nil {
			return nil, e
		}
	}
	out["localModels"] = s.nativeModelSnapshot(ctx)
	if s.native.ASR != nil {
		if installed, e := s.native.ASR.Installed(ctx); e == nil {
			out["asr"] = erpwire.Row{"offered": s.asrAvailable(), "installed": installed}
		}
	}
	if s.security.Probe != nil {
		if models, e := s.security.Probe.Models(ctx); e == nil {
			out["localModels"] = models
		}
		if asr, e := s.security.Probe.ASR(ctx); e == nil {
			out["asr"] = asr
		}
	}
	return out, nil
}
func (s *Service) chartPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "profit:view") {
		return erpwire.Row{"denied": "Only owners, admins, and accountants can view the chart of accounts."}, nil
	}
	var rows []erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		rows, e = all(ctx, tx, erpwire.Select{Table: "gl_accounts", Columns: []string{"code", "name_th", "name_en", "kind"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "code"}}})
		return e
	})
	if e != nil {
		if isAuthError(e) {
			return nil, e
		}
		return nil, errors.New("Chart of accounts unavailable")
	}
	return erpwire.Row{"accounts": rows, "canInstall": erpwire.Can(a.Role(), "settings:manage")}, nil
}
func (s *Service) financePage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "settings:manage") {
		return erpwire.Row{"denied": "เฉพาะเจ้าของและผู้ดูแลที่เปลี่ยนการตั้งค่างวดบัญชีได้ / Only owners and admins can change finance settings."}, nil
	}
	out := erpwire.Row{"orgId": a.OrgID(), "viewerId": a.UserID(), "today": s.now().In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01-02")}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		row, e := one(ctx, tx, settingSelect(a, "lock_date", "require_different_payment_reviewer", "bill_variance_tolerance_bps"))
		if e != nil {
			return e
		}
		out["lockDate"] = fallback(row, "lock_date", "")
		out["required"] = fallback(row, "require_different_payment_reviewer", false)
		out["toleranceBps"] = fallback(row, "bill_variance_tolerance_bps", int64(100))
		data, e := tx.ReadRPC(ctx, "list_finance_lock_reopen_requests", erpwire.Row{"p_org_id": a.OrgID()})
		if e != nil {
			return e
		}
		out["requests"] = reopenRequests(data)
		return nil
	})
	if e != nil {
		if isAuthError(e) {
			return nil, e
		}
		return nil, errors.New("Finance settings unavailable")
	}
	return out, nil
}
func reopenRequests(raw json.RawMessage) []erpwire.Row {
	var rows []erpwire.Row
	out := []erpwire.Row{}
	if erpwire.DecodeJSON(raw, &rows) != nil {
		return out
	}
	for _, r := range rows {
		valid := true
		for _, k := range []string{"id", "requestedBy", "reason", "createdAt"} {
			if trim(text(r[k])) == "" {
				valid = false
			}
		}
		if !valid {
			continue
		}
		row := erpwire.Row{}
		for _, k := range []string{"id", "requestedBy", "reason", "createdAt", "requesterEmail", "lockDate", "previousLockDate"} {
			var v any
			if trim(text(r[k])) != "" {
				v = r[k]
			}
			row[k] = v
		}
		out = append(out, row)
	}
	return out
}
func (s *Service) purchasingPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, "settings:manage"); e != nil {
		return nil, e
	}
	var row erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		row, e = one(ctx, tx, settingSelect(a, "over_receipt_tolerance_percent", "purchase_approval_threshold_satang", "scheduled_replenishment_enabled"))
		return e
	})
	if e != nil {
		if isAuthError(e) {
			return nil, e
		}
		return nil, errors.New("Purchasing settings unavailable")
	}
	return erpwire.Row{"tolerancePercent": fallback(row, "over_receipt_tolerance_percent", int64(0)), "approvalThreshold": row["purchase_approval_threshold_satang"], "scheduled": fallback(row, "scheduled_replenishment_enabled", false)}, nil
}
func (s *Service) leadFormsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, "settings:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 0, 1)
	if e != nil {
		return nil, e
	}
	params := erpwire.Row{}
	if len(args) > 0 && !args.Null(0) {
		if args.Decode(0, &params) != nil {
			return nil, erpwire.ErrBadArguments
		}
	}
	out := erpwire.Row{"appUrl": strings.TrimSuffix(s.security.AppURL, "/"), "defaultOwner": a.UserID()}
	if errorCode := text(params["error"]); errorCode != "" {
		message := "Unable to save this form. Please try again."
		if errorCode == "invalid" {
			message = "Enter a form name, success message, and a team member as the default owner."
		}
		out["error"] = message
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		forms, e := all(ctx, tx, erpwire.Select{Table: "lead_forms", Columns: []string{"id", "token", "name", "default_owner", "success_message", "enabled", "created_at"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}, Order: []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id"}}})
		if e != nil {
			return e
		}
		for _, f := range forms {
			href := text(out["appUrl"]) + "/f/" + text(f["token"])
			f["href"] = href
			f["embed"] = `<iframe src="` + href + `" title="Contact form" width="100%" height="760" style="border:0" loading="lazy"></iframe>`
		}
		out["forms"] = forms
		data, e := tx.ReadRPC(ctx, "record_activity_assignees", erpwire.Row{"p_org_id": a.OrgID()})
		if e != nil {
			return e
		}
		var people []erpwire.Row
		if e = erpwire.DecodeJSON(data, &people); e != nil {
			return e
		}
		if people == nil {
			people = []erpwire.Row{}
		}
		out["people"] = people
		return nil
	})
	if e != nil {
		if isAuthError(e) {
			return nil, e
		}
		return nil, errors.New("Unable to load lead forms. Please try again.")
	}
	return out, nil
}
func (s *Service) accountingPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if !s.security.ProEdition {
		return nil, erpwire.ErrNotFound
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	var row erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		row, e = one(ctx, tx, erpwire.Select{Table: "accounting_connections", Columns: []string{"provider", "status", "config", "updated_at"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}})
		return e
	})
	if isAuthError(e) {
		return nil, e
	}
	transport := "fixture"
	switch config := row["config"].(type) {
	case map[string]any:
		if config["transport"] == "sandbox" {
			transport = "sandbox"
		}
	case erpwire.Row:
		if config["transport"] == "sandbox" {
			transport = "sandbox"
		}
	}
	return erpwire.Row{"connection": row, "status": fallback(row, "status", "disconnected"), "canEdit": erpwire.Can(a.Role(), "settings:manage"), "transport": transport, "sandboxTokenSet": s.security.AccountingTokenSet}, nil
}
func (s *Service) connectionsPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "settings:manage") {
		return response("/settings"), nil
	}
	locale := "th"
	accounting := "unavailable"
	if s.security.ProEdition {
		accounting = "available"
	}
	profile, e := s.softSetting(ctx, a, erpwire.Select{Table: "profiles", Columns: []string{"locale"}, Where: []erpwire.Predicate{eq("id", a.UserID())}})
	if e != nil {
		return nil, e
	}
	if profile["locale"] == "en" {
		locale = "en"
	}
	if s.security.ProEdition {
		row, e := s.softSetting(ctx, a, erpwire.Select{Table: "accounting_connections", Columns: []string{"status"}, Where: []erpwire.Predicate{eq("org_id", a.OrgID())}})
		if e != nil {
			return nil, e
		}
		if row["status"] == "connected" {
			accounting = "connected"
		}
	}
	mcp := false
	models := s.nativeModelSnapshot(ctx)["daemonUp"] == true
	if s.automation.Mcp != nil {
		_, e := s.automation.Mcp.Probe(ctx, a)
		mcp = e == nil
	}
	if s.security.Probe != nil {
		mcp, _ = s.security.Probe.MCP(ctx, a)
		if value, e := s.security.Probe.Models(ctx); e == nil {
			b, _ := json.Marshal(value)
			var row erpwire.Row
			if erpwire.DecodeJSON(b, &row) == nil {
				models = row["daemonUp"] == true
			}
		}
	}
	return erpwire.Row{"probes": erpwire.Row{"erpMcp": mcp, "ollama": models, "flowaccount": accounting}, "profileLocale": locale}, nil
}
