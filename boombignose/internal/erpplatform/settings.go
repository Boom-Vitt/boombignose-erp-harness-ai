package erpplatform

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
	"github.com/google/uuid"
)

func (s *Service) settingsOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/(app)/settings/actions.ts::updateOrgSettings":          s.updateOrgSettings,
		"app/(app)/settings/org-actions.ts::inviteMember":           s.inviteMember,
		"app/(app)/settings/org-actions.ts::revokeInvitation":       s.revokeInvitation,
		"app/(app)/settings/org-actions.ts::acceptInvitation":       s.acceptInvitation,
		"app/(app)/settings/chart/actions.ts::installThaiSmeChart":  s.installThaiSmeChart,
		"app/(app)/settings/lead-forms/actions.ts::createLeadForm":  s.createLeadForm,
		"app/(app)/settings/lead-forms/actions.ts::disableLeadForm": s.disableLeadForm,
		"app/(app)/settings/page.tsx::load":                         s.settingsPage,
		"app/(app)/settings/chart/page.tsx::load":                   s.chartPage,
		"app/(app)/settings/finance/page.tsx::load":                 s.financePage,
		"app/(app)/settings/purchasing/page.tsx::load":              s.purchasingPage,
		"app/(app)/settings/lead-forms/page.tsx::load":              s.leadFormsPage,
		"app/(app)/settings/accounting/page.tsx::load":              s.accountingPage,
		"app/(app)/settings/connections/page.tsx::load":             s.connectionsPage,
	}
}

func objectArg(raw json.RawMessage) (erpwire.Row, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var row erpwire.Row
	if args.Decode(0, &row) != nil || row == nil {
		return nil, erpwire.ErrBadArguments
	}
	return row, nil
}
func jsLength(v string) int { return len(utf16.Encode([]rune(v))) }
func inputType(value any, present bool) string {
	if !present {
		return "undefined"
	}
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case json.Number:
		return "number"
	case []any:
		return "array"
	default:
		return "object"
	}
}

var settingsDecimal = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
var settingsRadix = regexp.MustCompile(`^(?:0[xX][a-fA-F0-9]+|0[bB][01]+|0[oO][0-7]+)$`)

// Settings coerce numbers and round to satang in the source; use exact rationals
// so a decimal never travels through binary floating point.
func settingsMoney(v any, present bool) (money.Satang, string) {
	if !present {
		return 0, "Invalid input: expected number, received NaN"
	}
	value := ""
	switch n := v.(type) {
	case nil:
		value = "0"
	case bool:
		if n {
			value = "1"
		} else {
			value = "0"
		}
	case string:
		value = trim(n)
		if value == "" {
			value = "0"
		}
	case json.Number:
		value = n.String()
	default:
		return 0, "Invalid input: expected number, received NaN"
	}
	if !settingsDecimal.MatchString(value) && !settingsRadix.MatchString(value) {
		return 0, "Invalid input: expected number, received NaN"
	}
	if index := strings.IndexAny(value, "eE"); index >= 0 && !settingsRadix.MatchString(value) {
		exponent, err := strconv.ParseInt(value[index+1:], 10, 64)
		if err != nil || exponent > 4096 || exponent < -4096 {
			if strings.HasPrefix(value[index+1:], "-") {
				if strings.HasPrefix(value, "-") {
					return 0, "Cannot be negative"
				}
				return 0, ""
			}
			return 0, erpwire.ErrUnsafeAmount.Error()
		}
	}
	rat, ok := new(big.Rat).SetString(value)
	if settingsRadix.MatchString(value) {
		n, valid := new(big.Int).SetString(value, 0)
		ok = valid
		if valid {
			rat = new(big.Rat).SetInt(n)
		}
	}
	if !ok {
		return 0, "Invalid input: expected number, received NaN"
	}
	if rat.Sign() < 0 {
		return 0, "Cannot be negative"
	}
	rat.Mul(rat, big.NewRat(100, 1))
	rat.Add(rat, big.NewRat(1, 2))
	n := new(big.Int).Quo(rat.Num(), rat.Denom())
	if !n.IsInt64() || n.Int64() > int64(money.MaxSafeSatang) {
		return 0, erpwire.ErrUnsafeAmount.Error()
	}
	return money.Satang(n.Int64()), ""
}
func (s *Service) updateOrgSettings(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	if s.authorize(a, "settings:manage") != nil {
		return invalid("Only an owner or admin can update settings.")
	}
	input, e := objectArg(raw)
	if e != nil {
		return nil, e
	}
	value, present := input["orgName"]
	name, ok := value.(string)
	if !ok {
		return invalid("Invalid input: expected string, received " + inputType(value, present))
	}
	if name == "" {
		return invalid("Workspace name is required")
	}
	cash, exists := input["cashBalanceBaht"]
	amount, message := settingsMoney(cash, exists)
	if message != "" {
		return invalid(message)
	}
	var burn any
	if value, present := input["monthlyBurnBaht"]; present {
		n, msg := settingsMoney(value, true)
		if msg != "" {
			return invalid(msg)
		}
		burn = n
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "org_settings", Rows: []erpwire.Row{{"org_id": a.OrgID(), "cash_balance_satang": amount, "monthly_burn_satang": burn}}, ConflictColumns: []string{"org_id"}})
		if e != nil {
			return e
		}
		_, e = tx.Update(ctx, "organizations", erpwire.Row{"name": name}, []erpwire.Predicate{eq("id", a.OrgID())}, nil)
		return e
	})
	if e != nil {
		return actionFailure(e)
	}
	s.audit(ctx, a, "settings", a.OrgID(), "updated", "Updated workspace settings")
	return response("", "/settings", "/dashboard"), nil
}

var emailPattern = regexp.MustCompile(`^[A-Za-z0-9_'+\-\.]*[A-Za-z0-9_+\-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

func (s *Service) inviteMember(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, "team:manage"); e != nil {
		return nil, e
	}
	input, e := objectArg(raw)
	if e != nil {
		return nil, e
	}
	value, present := input["email"]
	if _, ok := value.(string); !ok {
		return invalid("Invalid input: expected string, received " + inputType(value, present))
	}
	email := strings.ToLower(trim(text(value)))
	if !emailPattern.MatchString(email) || strings.Contains(email, "..") || strings.HasPrefix(email, ".") {
		return invalid("Enter a valid email")
	}
	role := "member"
	if v, present := input["role"]; present {
		role = text(v)
	}
	if !contains([]string{"admin", "accountant", "member"}, role) {
		return invalid(`Invalid option: expected one of "admin"|"accountant"|"member"`)
	}
	token := strings.ReplaceAll(uuid.NewString(), "-", "")
	expires := s.now().Add(time.Duration(365*24*60*60) * time.Second / 12).UTC().Format(time.RFC3339Nano)
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Insert(ctx, erpwire.Insert{Table: "invitations", ConflictColumns: []string{"org_id", "email"}, Rows: []erpwire.Row{{"org_id": a.OrgID(), "email": email, "role": role, "token": token, "status": "pending", "invited_by": a.UserID(), "accepted_by": nil, "expires_at": expires}}})
		return e
	})
	if e != nil {
		return actionFailure(e)
	}
	s.audit(ctx, a, "invitation", "", "invited", "Invited "+email+" as "+role)
	out := response("", "/settings")
	out.Value = erpwire.Row{"token": token}
	return out, nil
}
func (s *Service) revokeInvitation(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, "team:manage"); e != nil {
		return nil, e
	}
	in, e := objectArg(raw)
	if e != nil {
		return nil, e
	}
	id := text(in["id"])
	if id == "" {
		return invalid("Invalid input")
	}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Update(ctx, "invitations", erpwire.Row{"status": "revoked"}, append(scoped(a, id), eq("status", "pending")), nil)
		return e
	})
	if e != nil {
		return actionFailure(e)
	}
	s.audit(ctx, a, "invitation", id, "revoked", "Revoked a pending invitation")
	return response("", "/settings"), nil
}
func (s *Service) acceptInvitation(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	in, e := objectArg(raw)
	if e != nil {
		return nil, e
	}
	token := trim(text(in["token"]))
	if token == "" || jsLength(token) > 256 {
		return invalid("Invalid invitation")
	}
	if e = s.authorize(a, ""); e != nil {
		if errors.Is(e, erpwire.ErrUnauthenticated) {
			return response("/login?redirect=" + encodeURIComponent("/invite/"+encodeURIComponent(token))), nil
		}
		return nil, e
	}
	if s.security.Workspaces == nil {
		return nil, errors.New("verified workspace session activation is unavailable")
	}
	var org string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		data, e := tx.Command(ctx, "accept_workspace_invitation", erpwire.Row{"p_token": token})
		if e != nil {
			return e
		}
		return erpwire.DecodeJSON(data, &org)
	})
	if e != nil {
		return actionFailure(e)
	}
	if org == "" {
		return invalid("Unable to accept this invitation. Please try again.")
	}
	if e = s.security.Workspaces.ActivateWorkspace(ctx, a, org); e != nil {
		return nil, e
	}
	return response("/dashboard", "/"), nil
}
func (s *Service) installThaiSmeChart(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	if s.authorize(a, "settings:manage") != nil {
		return invalid("Only owners and admins can install the chart.")
	}
	e := s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "install_thai_sme_chart", erpwire.Row{"p_org_id": a.OrgID()})
		return e
	})
	if e != nil {
		return actionFailure(e)
	}
	return response("", "/settings/chart"), nil
}

const leadPath = "/settings/lead-forms"

func (s *Service) createLeadForm(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, "settings:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	form, e := args.Form(0)
	if e != nil {
		return nil, e
	}
	name, _ := form.Text("name")
	owner, _ := form.Text("defaultOwner")
	success, _ := form.Text("successMessage")
	name = trim(name)
	success = trim(success)
	if name == "" || jsLength(name) > 120 || !validID(owner) || success == "" || jsLength(success) > 500 {
		return response(leadPath + "?error=invalid"), nil
	}
	valid := false
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		data, e := tx.ReadRPC(ctx, "record_activity_assignees", erpwire.Row{"p_org_id": a.OrgID()})
		if e != nil {
			return e
		}
		var people []erpwire.Row
		if e = erpwire.DecodeJSON(data, &people); e != nil {
			return e
		}
		for _, p := range people {
			if text(p["user_id"]) == owner {
				valid = true
			}
		}
		return nil
	})
	if e != nil || !valid {
		return response(leadPath + "?error=invalid"), nil
	}
	token := make([]byte, 32)
	if _, e = rand.Read(token); e != nil {
		return nil, e
	}
	var id string
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Insert(ctx, erpwire.Insert{Table: "lead_forms", Rows: []erpwire.Row{{"org_id": a.OrgID(), "token": base64.RawURLEncoding.EncodeToString(token), "name": name, "default_owner": owner, "success_message": success}}, Returning: []string{"id"}})
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return errors.New("missing inserted lead form")
		}
		id = text(rows[0]["id"])
		return nil
	})
	if e != nil {
		if isAuthError(e) {
			return nil, e
		}
		return response(leadPath + "?error=save"), nil
	}
	s.audit(ctx, a, "lead_form", id, "created", "Created a lead capture form")
	return response(leadPath, leadPath), nil
}
func validID(v string) bool { return len(v) == 36 && uuid.Validate(v) == nil }
func (s *Service) disableLeadForm(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, "settings:manage"); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	form, e := args.Form(0)
	if e != nil {
		return nil, e
	}
	id, _ := form.Text("id")
	if !validID(id) {
		return response(leadPath + "?error=invalid"), nil
	}
	var changed bool
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		rows, e := tx.Update(ctx, "lead_forms", erpwire.Row{"enabled": false}, append(scoped(a, id), eq("enabled", true)), []string{"id"})
		changed = len(rows) > 0
		return e
	})
	if e != nil {
		if isAuthError(e) {
			return nil, e
		}
		return response(leadPath + "?error=save"), nil
	}
	if changed {
		s.audit(ctx, a, "lead_form", id, "disabled", "Disabled a lead capture form")
	}
	return response(leadPath, leadPath), nil
}
