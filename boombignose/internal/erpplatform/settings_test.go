package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type settingsStore struct {
	rows                    map[string][]erpwire.Row
	reads, writes, commands int
	assignees               []erpwire.Row
	commandResult           json.RawMessage
	failure                 error
}
type settingsTx struct{ db *settingsStore }

func (d *settingsStore) Read(_ context.Context, a erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	if e := a.Validate(mnNow); e != nil {
		return e
	}
	d.reads++
	if d.failure != nil {
		return d.failure
	}
	return fn(&settingsTx{d})
}
func (d *settingsStore) Write(_ context.Context, a erpwire.Actor, fn func(erpwire.WriteTx) error) error {
	if e := a.Validate(mnNow); e != nil {
		return e
	}
	d.writes++
	if d.failure != nil {
		return d.failure
	}
	copy := map[string][]erpwire.Row{}
	for table, rows := range d.rows {
		for _, r := range rows {
			row := erpwire.Row{}
			for k, v := range r {
				row[k] = v
			}
			copy[table] = append(copy[table], row)
		}
	}
	old := d.rows
	d.rows = copy
	if e := fn(&settingsTx{d}); e != nil {
		d.rows = old
		return e
	}
	return nil
}
func settingsMatch(row erpwire.Row, where []erpwire.Predicate) bool {
	for _, p := range where {
		if p.Op == erpwire.In {
			found := false
			for _, id := range p.Value.([]string) {
				found = found || row[p.Column] == id
			}
			if !found {
				return false
			}
		} else if !reflect.DeepEqual(row[p.Column], p.Value) {
			return false
		}
	}
	return true
}
func (tx *settingsTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	rows := []erpwire.Row{}
	for _, r := range tx.db.rows[q.Table] {
		if settingsMatch(r, q.Where) {
			row := erpwire.Row{}
			for _, key := range q.Columns {
				row[key] = r[key]
			}
			rows = append(rows, row)
		}
	}
	if q.Offset >= len(rows) {
		rows = []erpwire.Row{}
	} else {
		rows = rows[q.Offset:]
	}
	more := q.Limit > 0 && len(rows) > q.Limit
	if more {
		rows = rows[:q.Limit]
	}
	return erpwire.Selection{Rows: rows, HasMore: more}, nil
}
func (tx *settingsTx) ReadRPC(_ context.Context, name string, _ erpwire.Row) (json.RawMessage, error) {
	if name == "record_activity_assignees" {
		return json.Marshal(tx.db.assignees)
	}
	if name == "list_finance_lock_reopen_requests" {
		return json.RawMessage(`[]`), nil
	}
	return nil, errors.New("unexpected read command")
}
func (tx *settingsTx) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	tx.db.commands++
	if name == "accept_workspace_invitation" {
		return tx.db.commandResult, nil
	}
	if name == "install_thai_sme_chart" {
		if args["p_org_id"] != mnOrg {
			return nil, errors.New("foreign org")
		}
		return json.RawMessage(`null`), nil
	}
	return nil, errors.New("unexpected command")
}
func (tx *settingsTx) Insert(_ context.Context, q erpwire.Insert) ([]erpwire.Row, error) {
	out := []erpwire.Row{}
	for _, r := range q.Rows {
		if q.Table == "audit_log" && r["entity_id"] != nil && !validID(text(r["entity_id"])) {
			return nil, errors.New("invalid UUID entity_id")
		}
		var existing erpwire.Row
		if len(q.ConflictColumns) > 0 {
			for _, row := range tx.db.rows[q.Table] {
				match := true
				for _, key := range q.ConflictColumns {
					match = match && row[key] == r[key]
				}
				if match {
					existing = row
					break
				}
			}
		}
		if existing != nil {
			if q.IgnoreConflicts {
				continue
			}
			for k, v := range r {
				existing[k] = v
			}
			out = append(out, existing)
			continue
		}
		if r["id"] == nil {
			r["id"] = mnDevice
		}
		tx.db.rows[q.Table] = append(tx.db.rows[q.Table], r)
		out = append(out, r)
	}
	return out, nil
}
func (tx *settingsTx) Update(_ context.Context, table string, values erpwire.Row, where []erpwire.Predicate, _ []string) ([]erpwire.Row, error) {
	out := []erpwire.Row{}
	for _, r := range tx.db.rows[table] {
		if settingsMatch(r, where) {
			for k, v := range values {
				r[k] = v
			}
			out = append(out, r)
		}
	}
	return out, nil
}
func (tx *settingsTx) Delete(context.Context, string, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected deletion")
}
func settingsService(db *settingsStore) *Service {
	return &Service{store: db, now: func() time.Time { return mnNow }}
}
func settingsArgs(values ...any) json.RawMessage {
	if values == nil {
		values = []any{}
	}
	b, _ := json.Marshal(values)
	return b
}
func settingsAction(t *testing.T, fn erpwire.Operation, a erpwire.Actor, raw json.RawMessage) erpwire.ActionResponse {
	t.Helper()
	v, e := fn(context.Background(), a, raw)
	if e != nil {
		t.Fatal(e)
	}
	out, ok := v.(erpwire.ActionResponse)
	if !ok {
		t.Fatalf("unexpected action %T", v)
	}
	return out
}
func settingsError(r erpwire.ActionResponse) string { return text(r.Value.(erpwire.Row)["error"]) }

func TestSettingsMoneyBoundaries(t *testing.T) {
	for _, tc := range []struct {
		input   any
		present bool
		want    money.Satang
		message string
	}{
		{"0.01", true, 1, ""}, {json.Number("1.005"), true, 101, ""}, {"90071992547409.91", true, money.MaxSafeSatang, ""}, {"90071992547409.92", true, 0, erpwire.ErrUnsafeAmount.Error()}, {"-0.01", true, 0, "Cannot be negative"}, {"NaN", true, 0, "Invalid input: expected number, received NaN"}, {nil, false, 0, "Invalid input: expected number, received NaN"}, {nil, true, 0, ""}, {"", true, 0, ""}, {true, true, 100, ""}, {"1e2", true, 10000, ""},
	} {
		got, message := settingsMoney(tc.input, tc.present)
		if got != tc.want || message != tc.message {
			t.Fatalf("%v -> %d %q, want %d %q", tc.input, got, message, tc.want, tc.message)
		}
	}
}
func TestSettingsAuthorizationAndValidation(t *testing.T) {
	for _, tc := range []struct {
		role    erpwire.Role
		input   erpwire.Row
		message string
	}{
		{erpwire.Member, erpwire.Row{}, "Only an owner or admin can update settings."}, {erpwire.Owner, erpwire.Row{"orgName": "", "cashBalanceBaht": "1"}, "Workspace name is required"}, {erpwire.Owner, erpwire.Row{"orgName": "ERP", "cashBalanceBaht": "-1"}, "Cannot be negative"},
	} {
		db := &settingsStore{rows: map[string][]erpwire.Row{}}
		s := settingsService(db)
		r := settingsAction(t, s.updateOrgSettings, mnActor(t, tc.role), settingsArgs(tc.input))
		if settingsError(r) != tc.message || db.writes != 0 {
			t.Fatalf("validation %#v writes=%d", r, db.writes)
		}
	}
	db := &settingsStore{rows: map[string][]erpwire.Row{}}
	s := settingsService(db)
	if _, e := s.updateOrgSettings(context.Background(), erpwire.Actor{}, settingsArgs(erpwire.Row{})); !errors.Is(e, erpwire.ErrUnauthenticated) {
		t.Fatalf("anonymous permitted %v", e)
	}
}
func TestSettingsWriteScopesMoneyAuditAndRefresh(t *testing.T) {
	db := &settingsStore{rows: map[string][]erpwire.Row{"organizations": {{"id": mnOrg, "name": "Before"}, {"id": mnOtherOrg, "name": "Other"}}, "org_settings": {{"org_id": mnOtherOrg, "cash_balance_satang": money.Satang(999)}}}}
	s := settingsService(db)
	out := settingsAction(t, s.updateOrgSettings, mnActor(t, erpwire.Owner), settingsArgs(erpwire.Row{"orgName": "After", "cashBalanceBaht": "1.005", "org_id": mnOtherOrg}))
	if db.rows["organizations"][0]["name"] != "After" || db.rows["organizations"][1]["name"] != "Other" || db.rows["org_settings"][0]["cash_balance_satang"] != money.Satang(999) {
		t.Fatal("foreign workspace mutated")
	}
	saved := db.rows["org_settings"][1]
	if saved["cash_balance_satang"] != money.Satang(101) || saved["monthly_burn_satang"] != nil || saved["org_id"] != mnOrg {
		t.Fatalf("incorrect save %#v", saved)
	}
	if !reflect.DeepEqual(out.Refresh, []string{"/settings", "/dashboard"}) || len(db.rows["audit_log"]) != 1 || db.rows["audit_log"][0]["summary"] != "Updated workspace settings" {
		t.Fatalf("missing result/audit %#v", out)
	}
}
func TestInvitationReissueAndScopedRevocation(t *testing.T) {
	db := &settingsStore{rows: map[string][]erpwire.Row{"invitations": {{"id": mnDevice, "org_id": mnOtherOrg, "status": "pending"}}}}
	s := settingsService(db)
	actor := mnActor(t, erpwire.Owner)
	raw := settingsArgs(erpwire.Row{"email": "  TEST@Example.com ", "role": "accountant"})
	first := settingsAction(t, s.inviteMember, actor, raw)
	token := text(first.Value.(erpwire.Row)["token"])
	if len(token) != 32 {
		t.Fatal("invalid token")
	}
	settingsAction(t, s.inviteMember, actor, raw)
	if len(db.rows["invitations"]) != 2 {
		t.Fatal("reissue duplicated invitation")
	}
	row := db.rows["invitations"][1]
	if row["email"] != "test@example.com" || row["role"] != "accountant" || row["token"] == token || row["accepted_by"] != nil {
		t.Fatalf("incorrect reissue %#v", row)
	}
	expiry, e := time.Parse(time.RFC3339Nano, text(row["expires_at"]))
	if e != nil || !expiry.Equal(mnNow.Add(365*24*time.Hour/12)) {
		t.Fatalf("expiry %s", row["expires_at"])
	}
	settingsAction(t, s.revokeInvitation, actor, settingsArgs(erpwire.Row{"id": mnDevice}))
	if db.rows["invitations"][0]["status"] != "pending" || db.rows["invitations"][1]["status"] != "revoked" {
		t.Fatal("revocation scope failed")
	}
	settingsAction(t, s.revokeInvitation, actor, settingsArgs(erpwire.Row{"id": mnDevice}))
	if db.rows["invitations"][1]["status"] != "revoked" {
		t.Fatal("repeat revoke changed state")
	}
}
func settingsForm(fields map[string]string) erpwire.FormData {
	entries := []erpwire.FormEntry{}
	for key, value := range fields {
		v := value
		entries = append(entries, erpwire.FormEntry{Name: key, Text: &v})
	}
	return erpwire.FormData{Kind: "form", Entries: entries}
}
func TestLeadFormsMembershipValidationAndDisableTransition(t *testing.T) {
	db := &settingsStore{rows: map[string][]erpwire.Row{}, assignees: []erpwire.Row{{"user_id": mnUser}}}
	s := settingsService(db)
	a := mnActor(t, erpwire.Owner)
	for _, fields := range []map[string]string{{"name": "Lead", "defaultOwner": mnDevice, "successMessage": "Thanks"}, {"name": strings.Repeat("😀", 61), "defaultOwner": mnUser, "successMessage": "Thanks"}} {
		r := settingsAction(t, s.createLeadForm, a, settingsArgs(settingsForm(fields)))
		if r.Redirect != leadPath+"?error=invalid" || db.writes != 0 {
			t.Fatalf("invalid accepted %#v", r)
		}
	}
	r := settingsAction(t, s.createLeadForm, a, settingsArgs(settingsForm(map[string]string{"name": "  Sales  ", "defaultOwner": mnUser, "successMessage": " ขอบคุณ "})))
	if r.Redirect != leadPath || db.rows["lead_forms"][0]["name"] != "Sales" || db.rows["lead_forms"][0]["success_message"] != "ขอบคุณ" || len(text(db.rows["lead_forms"][0]["token"])) != 43 {
		t.Fatalf("wrong form %#v", db.rows)
	}
	db.rows["lead_forms"][0]["enabled"] = true
	db.rows["lead_forms"] = append(db.rows["lead_forms"], erpwire.Row{"org_id": mnOtherOrg, "id": mnDevice, "enabled": true})
	settingsAction(t, s.disableLeadForm, a, settingsArgs(settingsForm(map[string]string{"id": mnDevice})))
	if db.rows["lead_forms"][0]["enabled"] != false || db.rows["lead_forms"][1]["enabled"] != true {
		t.Fatal("disable scope failed")
	}
	audits := len(db.rows["audit_log"])
	settingsAction(t, s.disableLeadForm, a, settingsArgs(settingsForm(map[string]string{"id": mnDevice})))
	if len(db.rows["audit_log"]) != audits {
		t.Fatal("repeat disable audited nonexistent change")
	}
}
func TestSettingsLoaderTenantAndProfilePrivacy(t *testing.T) {
	db := &settingsStore{rows: map[string][]erpwire.Row{"org_settings": {{"org_id": mnOrg, "cash_balance_satang": int64(7)}, {"org_id": mnOtherOrg, "cash_balance_satang": int64(99)}}, "memberships": {{"org_id": mnOrg, "user_id": mnUser, "role": "owner"}, {"org_id": mnOtherOrg, "user_id": mnDevice, "role": "owner"}}, "profiles": {{"id": mnUser, "full_name": "Owner"}, {"id": mnDevice, "full_name": "Foreign"}}, "invitations": {{"org_id": mnOtherOrg, "status": "pending", "token": "secret"}}}}
	s := settingsService(db)
	db.assignees = []erpwire.Row{{"user_id": mnUser, "full_name": "Owner"}, {"user_id": mnDevice, "full_name": "Foreign"}}
	value, e := s.settingsPage(context.Background(), mnActor(t, erpwire.Owner), settingsArgs())
	if e != nil {
		t.Fatal(e)
	}
	out := value.(erpwire.Row)
	team := out["team"].([]erpwire.Row)
	if out["cashSatang"] != int64(7) || len(team) != 1 || team[0]["fullName"] != "Owner" || team[0]["email"] != "owner@example.test" || len(out["pendingInvites"].([]erpwire.Row)) != 0 {
		t.Fatalf("scope or privacy failure %#v", out)
	}
}
