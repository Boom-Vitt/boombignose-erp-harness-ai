package erpcrm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func validDealInput() erpwire.Row {
	return erpwire.Row{"clientId": testClient, "title": "  งานใหม่  ", "stage": "lead", "valueBaht": "1.01"}
}
func form(values map[string]string) erpwire.FormData {
	out := erpwire.FormData{Kind: "form"}
	for name, value := range values {
		v := value
		out.Entries = append(out.Entries, erpwire.FormEntry{Name: name, Text: &v})
	}
	return out
}

func TestAuthorizationForEveryOperation(t *testing.T) {
	s, store := testService(t)
	for key, op := range s.Operations() {
		t.Run(key, func(t *testing.T) {
			_, err := op(context.Background(), erpwire.Actor{}, json.RawMessage(`[]`))
			if !errors.Is(err, erpwire.ErrUnauthenticated) {
				t.Fatalf("unauthenticated operation got %v", err)
			}
		})
	}
	a := testActor(t, erpwire.Member)
	for _, op := range []erpwire.Operation{s.reasonsPage, s.addLostReason, s.setLostReasonActive} {
		_, err := op(context.Background(), a, json.RawMessage(`[]`))
		if !errors.Is(err, erpwire.ErrForbidden) {
			t.Fatal(err)
		}
	}
	expectError(t, invoke(t, s.deleteClient, a, testClient), "Only owners and admins can delete clients.")
	expectError(t, invoke(t, s.deleteContact, a, otherID, testClient), "Only owners and admins can delete contacts.")
	expectError(t, invoke(t, s.deleteDeal, a, testDeal), "Only owners and admins can delete deals.")
	if store.reads != 0 || store.writes != 0 {
		t.Fatal("authorization denial reached store")
	}
}

func TestDealMoneyAndValidation(t *testing.T) {
	for _, test := range []struct {
		name    string
		value   any
		want    int64
		message string
	}{
		{"zero", "0", 0, ""}, {"satang", "0.01", 1, ""}, {"half up", "1.005", 101, ""}, {"below half", "1.0049", 100, ""}, {"exponent", json.Number("1e2"), 10000, ""}, {"leading decimal", ".01", 1, ""}, {"hex", "0x10", 1600, ""}, {"empty coerces zero", "", 0, ""}, {"null coerces zero", nil, 0, ""}, {"boolean coercion", true, 100, ""}, {"negative zero", "-0", 0, ""},
		{"maximum", "90071992547409.91", 9007199254740991, ""}, {"rounds to maximum", "90071992547409.914", 9007199254740991, ""}, {"rounds above maximum", "90071992547409.915", 0, "Money exceeds safe satang bounds"}, {"overflow", "90071992547409.92", 0, "Money exceeds safe satang bounds"}, {"negative", "-0.001", 0, "Value can't be negative"}, {"not a number", "NaN", 0, "Invalid input"}, {"infinite", "Infinity", 0, "Invalid input"}, {"fraction syntax", "1/2", 0, "Invalid input"}, {"huge exponent", "1e999999999", 0, "Invalid input"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, store := testService(t)
			input := validDealInput()
			input["valueBaht"] = test.value
			result := invoke(t, s.quickCreateDeal, testActor(t, erpwire.Member), input)
			if test.message != "" {
				expectError(t, result, test.message)
				if store.writes != 0 {
					t.Fatal("invalid money wrote data")
				}
				return
			}
			rows := store.tables["deals"]
			if len(rows) != 1 || rows[0]["value_satang"] != test.want {
				t.Fatalf("wrong satang %#v", rows)
			}
			if result.(erpwire.ActionResponse).Redirect != "" || !reflect.DeepEqual(result.(erpwire.ActionResponse).Refresh, []string{"/deals"}) {
				t.Fatal(result)
			}
		})
	}
	for _, test := range []struct {
		key     string
		value   any
		message string
	}{
		{"clientId", "invalid", "Pick a client"}, {"title", "", "Title is required"}, {"stage", "invalid", "Invalid input"}, {"probability", "101", "Probability is 0 to 100"}, {"probability", "0.5", "Probability is 0 to 100"}, {"probability", "-1", "Probability is 0 to 100"}, {"lostReasonId", nil, "Invalid input"}, {"notes", false, "Invalid input"}, {"stage", "lost", "Pick a lost reason"},
	} {
		t.Run(test.key+fmt.Sprint(test.value), func(t *testing.T) {
			s, store := testService(t)
			input := validDealInput()
			input[test.key] = test.value
			expectError(t, invoke(t, s.createDeal, testActor(t, erpwire.Member), input), test.message)
			if store.writes != 0 {
				t.Fatal("invalid input wrote data")
			}
		})
	}
	s, _ := testService(t)
	input := validDealInput()
	input["stage"] = "lost"
	expectError(t, invoke(t, s.quickCreateDeal, testActor(t, erpwire.Member), input), "Create the deal first, then mark it lost")
}

func TestCreateAndUpdateDealColumns(t *testing.T) {
	for _, stage := range stages {
		t.Run(stage, func(t *testing.T) {
			s, store := testService(t)
			input := validDealInput()
			input["stage"] = stage
			input["probability"] = "50.0"
			input["lostReasonId"] = testReason
			input["source"] = "  Referral  "
			input["notes"] = "   "
			result := invoke(t, s.createDeal, testActor(t, erpwire.Member), input).(erpwire.ActionResponse)
			rows := store.tables["deals"]
			if len(rows) != 1 {
				t.Fatal(rows)
			}
			row := rows[0]
			if row["org_id"] != testOrg || row["client_id"] != testClient || row["title"] != "งานใหม่" || row["stage"] != stage || row["value_satang"] != int64(101) || row["probability"] != int64(50) || row["source"] != "Referral" || row["notes"] != nil {
				t.Fatal(row)
			}
			if stage == "lost" {
				if row["lost_reason_id"] != testReason {
					t.Fatal(row)
				}
			} else if row["lost_reason_id"] != nil {
				t.Fatal(row)
			}
			if _, ok := row["won_at"]; ok {
				t.Fatal("application replaced database stage trigger")
			}
			if _, ok := row["lost_at"]; ok {
				t.Fatal("application replaced database stage trigger")
			}
			if result.Redirect != "/deals/"+text(row["id"]) || !reflect.DeepEqual(result.Refresh, []string{"/deals"}) {
				t.Fatal(result)
			}
			audits := store.tables["audit_log"]
			if len(audits) != 1 || audits[0]["action"] != "created" || audits[0]["summary"] != `Created deal "งานใหม่"` || audits[0]["actor_id"] != testUser {
				t.Fatal(audits)
			}
			updated := invoke(t, s.updateDeal, testActor(t, erpwire.Member), row["id"], input).(erpwire.ActionResponse)
			if updated.Redirect != result.Redirect || !reflect.DeepEqual(updated.Refresh, []string{"/deals", result.Redirect}) || len(store.tables["audit_log"]) != 1 {
				t.Fatal(updated)
			}
		})
	}
}

func TestEveryStageTransitionDelegatesExactCommandAndAudit(t *testing.T) {
	for _, from := range stages {
		for _, to := range stages {
			t.Run(from+" to "+to, func(t *testing.T) {
				s, store := testService(t)
				seedDeal(store)
				store.tables["deals"][0]["stage"] = from
				place := erpwire.Row{"after": otherID, "lostReasonId": testReason, "note": "  called client  "}
				calls := 0
				store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
					calls++
					var note any
					if to == "lost" {
						note = "Lost: called client"
					}
					want := erpwire.Row{"p_org_id": testOrg, "p_deal_id": testDeal, "p_stage": to, "p_after_id": otherID, "p_lost_reason_id": testReason, "p_note": note}
					if name != "move_deal" || !reflect.DeepEqual(args, want) {
						t.Fatalf("command %s %#v, want %#v", name, args, want)
					}
					return json.Marshal(from)
				}
				got := invoke(t, s.updateDealStage, testActor(t, erpwire.Member), testDeal, to, place).(erpwire.ActionResponse)
				if calls != 1 || got.Redirect != "" || !reflect.DeepEqual(got.Refresh, []string{"/deals", "/deals/" + testDeal}) {
					t.Fatal(got)
				}
				audits := store.tables["audit_log"]
				if from == to {
					if len(audits) != 0 {
						t.Fatal("same-stage reorder wrote a transition audit")
					}
					return
				}
				wantMeta := erpwire.Row{"from": from, "to": to, "lostReasonId": testReason}
				if len(audits) != 1 || audits[0]["summary"] != `Moved deal "งานใหม่" from `+from+" → "+to || audits[0]["action"] != "stage_changed" || !reflect.DeepEqual(audits[0]["meta"], wantMeta) {
					t.Fatal(audits)
				}
			})
		}
	}
}

type testDBError struct{ state, constraint, message string }

func (e testDBError) Error() string           { return "private database details" }
func (e testDBError) SQLState() string        { return e.state }
func (e testDBError) ConstraintName() string  { return e.constraint }
func (e testDBError) BusinessMessage() string { return e.message }

func TestStageValidationAndDatabaseFailures(t *testing.T) {
	for _, place := range []any{erpwire.Row{"after": "bad"}, erpwire.Row{"lostReasonId": nil}, erpwire.Row{"note": strings.Repeat("😀", 1001)}, erpwire.Row{"note": false}, erpwire.Row{"stage": "bad"}, erpwire.Row{"id": "bad"}, "bad"} {
		s, store := testService(t)
		expectError(t, invoke(t, s.updateDealStage, testActor(t, erpwire.Member), testDeal, "lead", place), "Invalid stage")
		if store.writes != 0 {
			t.Fatal("invalid stage reached store")
		}
	}
	for _, test := range []struct {
		err  error
		want string
	}{{testDBError{state: "P0002"}, gone}, {testDBError{constraint: "quotes_deal_client_fkey"}, quotedClient}, {testDBError{message: "Pick a lost reason"}, "Pick a lost reason"}, {errors.New("private details"), "Unable to save changes. Please try again."}} {
		s, store := testService(t)
		seedDeal(store)
		store.command = func(string, erpwire.Row) (json.RawMessage, error) { return nil, test.err }
		expectError(t, invoke(t, s.updateDealStage, testActor(t, erpwire.Member), testDeal, "lost"), test.want)
		if len(store.tables["audit_log"]) != 0 {
			t.Fatal("failed move wrote audit")
		}
	}
	s, store := testService(t)
	seedDeal(store)
	store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
		if args["p_after_id"] != nil || args["p_lost_reason_id"] != nil || args["p_note"] != nil {
			t.Fatal(args)
		}
		return json.Marshal("proposal")
	}
	invoke(t, s.updateDealStage, testActor(t, erpwire.Member), testDeal, "won")
}

func TestClientContactAndActivityActions(t *testing.T) {
	s, store := testService(t)
	a := testActor(t, erpwire.Owner)
	input := erpwire.Row{"name": "  Client  ", "tax_id": " 1234567890123 ", "branch_label": "  HQ  ", "notes": " "}
	created := invoke(t, s.createClient, a, input).(erpwire.ActionResponse)
	row := store.tables["clients"][0]
	id := text(row["id"])
	if row["name"] != "Client" || row["tax_id"] != "1234567890123" || row["branch_label"] != "HQ" || row["notes"] != nil || row["owner"] != testUser || created.Redirect != "/clients/"+id {
		t.Fatal(row, created)
	}
	updated := invoke(t, s.updateClient, a, id, erpwire.Row{"name": "Updated"}).(erpwire.ActionResponse)
	if updated.Redirect != "" || !reflect.DeepEqual(updated.Refresh, []string{"/clients", "/clients/" + id}) || store.tables["clients"][0]["name"] != "Updated" {
		t.Fatal(updated)
	}
	contact := invoke(t, s.addContact, a, erpwire.Row{"client_id": id, "name": " Name ", "email": " mail ", "phone": " "}).(erpwire.ActionResponse)
	c := store.tables["contacts"][0]
	if c["client_id"] != id || c["name"] != "Name" || c["email"] != "mail" || c["phone"] != nil || !reflect.DeepEqual(contact.Refresh, []string{"/clients/" + id}) {
		t.Fatal(c, contact)
	}
	invoke(t, s.deleteContact, a, c["id"], id)
	if len(store.tables["contacts"]) != 0 {
		t.Fatal("contact not deleted")
	}
	invoke(t, s.deleteClient, a, id)
	if len(store.tables["clients"]) != 0 {
		t.Fatal("client not deleted")
	}
	seedDeal(store)
	for _, kind := range []string{"note", "call", "email", "meeting", "follow_up"} {
		invoke(t, s.addActivity, a, erpwire.Row{"dealId": testDeal, "type": kind, "body": " note ", "dueDate": " "})
	}
	activities := store.tables["activities"]
	if len(activities) != 5 {
		t.Fatal(activities)
	}
	for _, activity := range activities {
		if activity["deal_id"] != testDeal || activity["client_id"] != testClient || activity["body"] != "note" || activity["due_date"] != nil {
			t.Fatal(activity)
		}
	}
	for _, done := range []bool{true, false} {
		invoke(t, s.toggleActivityDone, a, activities[0]["id"], done, testDeal)
		if activities[0]["done"] != done {
			t.Fatal("activity state not persisted")
		}
	}
}

func TestLostReasonActions(t *testing.T) {
	s, store := testService(t)
	a := testActor(t, erpwire.Admin)
	got := invoke(t, s.addLostReason, a, form(map[string]string{"name": " ราคา "})).(erpwire.ActionResponse)
	row := store.tables["deal_lost_reasons"][0]
	if row["name"] != "ราคา" || got.Redirect != reasonsPath || !reflect.DeepEqual(got.Refresh, []string{reasonsPath}) {
		t.Fatal(row, got)
	}
	for _, test := range []struct {
		value           string
		active          bool
		action, summary string
	}{{"false", false, "archived", `Archived lost reason "ราคา"`}, {"true", true, "restored", `Restored lost reason "ราคา"`}} {
		invoke(t, s.setLostReasonActive, a, form(map[string]string{"id": text(row["id"]), "active": test.value}))
		if row["active"] != test.active {
			t.Fatal(row)
		}
		audit := store.tables["audit_log"][len(store.tables["audit_log"])-1]
		if audit["action"] != test.action || audit["summary"] != test.summary {
			t.Fatal(audit)
		}
	}
	for _, name := range []string{" ", strings.Repeat("😀", 41)} {
		got = invoke(t, s.addLostReason, a, form(map[string]string{"name": name})).(erpwire.ActionResponse)
		if got.Redirect != reasonsPath+"?error=invalid" {
			t.Fatal(got)
		}
	}
	store.insertErr["deal_lost_reasons"] = testDBError{state: "23505"}
	got = invoke(t, s.addLostReason, a, form(map[string]string{"name": "duplicate"})).(erpwire.ActionResponse)
	if got.Redirect != reasonsPath+"?error=duplicate" {
		t.Fatal(got)
	}
	got = invoke(t, s.setLostReasonActive, a, form(map[string]string{"id": otherID, "active": "true"})).(erpwire.ActionResponse)
	if got.Redirect != reasonsPath+"?error=save" {
		t.Fatal(got)
	}
}

func TestMoneyExpectedRevenueAndSafeTotals(t *testing.T) {
	for _, test := range []struct {
		value money.Satang
		p     int64
		want  money.Satang
	}{{1, 50, 1}, {1, 49, 0}, {101, 50, 51}, {money.MaxSafeSatang, 100, money.MaxSafeSatang}, {money.MaxSafeSatang, 70, 6305039478318694}} {
		got, err := expected(test.value, test.p)
		if err != nil || got != test.want {
			t.Fatalf("expected(%d,%d)=%d,%v want %d", test.value, test.p, got, err, test.want)
		}
	}
	for _, test := range []struct {
		value money.Satang
		p     int64
	}{{-1, 50}, {1, -1}, {1, 101}} {
		if _, err := expected(test.value, test.p); err == nil {
			t.Fatal("invalid expected revenue accepted")
		}
	}
	if _, err := checkedSum(money.MaxSafeSatang, 1); err == nil {
		t.Fatal("overflow total accepted")
	}
	if _, err := satang(json.Number("9007199254740992")); err == nil {
		t.Fatal("unsafe database money accepted")
	}
}

func TestBrowserWhitespaceAndRepeatedFormFields(t *testing.T) {
	if trimText("\ufeff title \ufeff") != "title" || trimText("\u0085title\u0085") != "\u0085title\u0085" {
		t.Fatal("browser whitespace semantics lost")
	}
	if nilText("\ufeff  ") == "" || nilText("\ufeff  ") != nil {
		t.Fatal("blank optional value was not null")
	}
	s, store := testService(t)
	seedDeal(store)
	first, second := "true", "false"
	id := testReason
	got := invoke(t, s.setLostReasonActive, testActor(t, erpwire.Admin), erpwire.FormData{Kind: "form", Entries: []erpwire.FormEntry{{Name: "id", Text: &id}, {Name: "active", Text: &first}, {Name: "active", Text: &second}}}).(erpwire.ActionResponse)
	if got.Redirect != reasonsPath || store.tables["deal_lost_reasons"][0]["active"] != false {
		t.Fatal("Object.fromEntries must use the last repeated field")
	}
	for _, test := range []struct {
		value string
		want  money.Satang
		valid bool
	}{{"08", 800, true}, {"010", 1000, true}, {"0x1_0", 0, false}, {"\ufeff 1 \ufeff", 100, true}} {
		got, message := dealAmount(test.value)
		if (message == "") != test.valid || test.valid && got != test.want {
			t.Fatalf("%q = %d, %q", test.value, got, message)
		}
	}
}
