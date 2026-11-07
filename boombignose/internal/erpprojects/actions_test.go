package erpprojects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type safeDBError string

func (e safeDBError) Error() string           { return "private database detail" }
func (e safeDBError) BusinessMessage() string { return string(e) }

func TestDatabaseErrorsAndBestEffortAudit(t *testing.T) {
	for _, test := range []struct {
		err     error
		message string
	}{{errors.New("private SQL and credentials"), safeFailure}, {safeDBError("private SQL and credentials"), safeFailure}, {safeDBError("Time invoice exceeds safe satang bounds"), "Time invoice exceeds safe satang bounds"}} {
		s, f, a := fixture(t)
		f.writeError = test.err
		if got := callError(t, s, a, projectsActions+"updateProjectStatus", erpwire.Row{"id": projectID, "status": "review"}); got != test.message {
			t.Fatalf("error message %q want %q", got, test.message)
		}
		if f.rows["projects"][0]["status"] != "not_started" {
			t.Fatal("failed transaction changed project")
		}
	}
	s, f, a := fixture(t)
	f.writeError = erpwire.ErrIdentityChanged
	if _, err := invoke(t, s, a, projectsActions+"updateProjectStatus", erpwire.Row{"id": projectID, "status": "review"}); !errors.Is(err, erpwire.ErrIdentityChanged) {
		t.Fatalf("revocation swallowed %v", err)
	}
	f.writeError = nil
	f.insertErrors = map[string]error{"audit_log": errors.New("audit unavailable")}
	out := callAction(t, s, a, timesheetsActions+"logTime", erpwire.Row{"project_id": projectID, "hours": "1", "rateBaht": ""})
	if text(out.Value.(erpwire.Row)["error"]) != "" || len(f.rows["time_entries"]) != 1 || len(f.rows["audit_log"]) != 0 {
		t.Fatalf("audit failure undid mutation %#v", out)
	}
	if f.rows["time_entries"][0]["rate_satang"] != nil {
		t.Fatal("omitted rate converted to zero")
	}
}

func TestOperationInventoryAndAuthentication(t *testing.T) {
	s, f, _ := fixture(t)
	ops := s.Operations()
	want := []string{}
	for _, name := range []string{"createProject", "quickCreateProject", "updateProject", "updateProjectStatus", "addTask", "toggleTask", "addMilestone", "toggleMilestone"} {
		want = append(want, projectsActions+name)
	}
	for _, name := range []string{"logTime", "deleteTimeEntry", "updateTimeEntry", "billTime", "setMemberCostRate"} {
		want = append(want, timesheetsActions+name)
	}
	for _, path := range []string{"projects/page.tsx", "projects/[id]/page.tsx", "projects/[id]/edit/page.tsx", "projects/new/page.tsx", "timesheets/page.tsx", "calendar/page.tsx", "activities/page.tsx"} {
		want = append(want, "app/(app)/"+path+"::load")
	}
	if len(ops) != len(want) {
		t.Fatalf("operations %d, want %d", len(ops), len(want))
	}
	for _, key := range want {
		t.Run(key, func(t *testing.T) {
			op, ok := ops[key]
			if !ok {
				t.Fatalf("missing %s", key)
			}
			if _, err := op(context.Background(), erpwire.Actor{}, json.RawMessage("[]")); !errors.Is(err, erpwire.ErrUnauthenticated) {
				t.Fatalf("unauthenticated operation returned %v", err)
			}
		})
	}
	if f.reads != 0 || f.writes != 0 {
		t.Fatal("unauthenticated request reached store")
	}
	if _, err := New(Options{}); err == nil {
		t.Fatal("nil store accepted")
	}
}
func TestStaffCapabilitiesReturnExactErrors(t *testing.T) {
	for _, role := range []erpwire.Role{erpwire.Member, erpwire.Accountant} {
		for _, test := range []struct{ name, want string }{{"billTime", "Only staff may bill time"}, {"setMemberCostRate", "Only staff may set cost rates"}} {
			t.Run(string(role)+test.name, func(t *testing.T) {
				s, f, _ := fixture(t)
				got := callError(t, s, testActor(t, role), timesheetsActions+test.name, erpwire.Row{})
				if got != test.want {
					t.Fatalf("got %q, want %q", got, test.want)
				}
				if f.writes != 0 {
					t.Fatal("denied request reached mutation")
				}
			})
		}
	}
}
func TestValidationMessages(t *testing.T) {
	for _, test := range []struct {
		name, key string
		input     erpwire.Row
		want      string
	}{
		{"create missing name", projectsActions + "createProject", erpwire.Row{"status": "not_started"}, "Invalid input"},
		{"create null optional", projectsActions + "createProject", erpwire.Row{"name": "Project", "status": "not_started", "deadline": nil}, "Invalid input"},
		{"create third decimal", projectsActions + "createProject", erpwire.Row{"name": "Project", "status": "not_started", "budgetBaht": "1.001"}, "Invalid input"},
		{"create unsafe budget", projectsActions + "createProject", erpwire.Row{"name": "Project", "status": "not_started", "budgetBaht": "90071992547409.92"}, "Invalid input"},
		{"quick empty name", projectsActions + "quickCreateProject", erpwire.Row{"name": " \ufeff ", "status": "not_started"}, "Project name is required"},
		{"quick missing name", projectsActions + "quickCreateProject", erpwire.Row{"status": "not_started"}, "Invalid input: expected string, received undefined"},
		{"quick bad status", projectsActions + "quickCreateProject", erpwire.Row{"name": "Project", "status": "invalid"}, `Invalid option: expected one of "not_started"|"in_progress"|"review"|"delivered"|"support"|"paused"|"cancelled"`},
		{"quick budget decimals", projectsActions + "quickCreateProject", erpwire.Row{"name": "Project", "status": "not_started", "budgetBaht": "0.001"}, "Enter a safe, nonnegative THB amount with up to two decimals"},
		{"update missing id", projectsActions + "updateProject", erpwire.Row{"name": "Project", "status": "not_started"}, "Invalid input"},
		{"invalid project status", projectsActions + "updateProjectStatus", erpwire.Row{"id": projectID, "status": "done"}, "Invalid input"},
		{"empty task title", projectsActions + "addTask", erpwire.Row{"projectId": projectID, "title": " ", "status": "todo"}, "Invalid input"},
		{"null assignee", projectsActions + "addTask", erpwire.Row{"projectId": projectID, "title": "Task", "status": "todo", "assignee": nil}, "Invalid input"},
		{"string task flag", projectsActions + "toggleTask", erpwire.Row{"id": "task", "projectId": projectID, "done": "true"}, "Invalid input"},
		{"empty milestone title", projectsActions + "addMilestone", erpwire.Row{"projectId": projectID, "title": ""}, "Invalid input"},
		{"milestone missing project", projectsActions + "toggleMilestone", erpwire.Row{"id": "milestone", "done": true}, "Invalid input"},
		{"negative hours", timesheetsActions + "logTime", erpwire.Row{"project_id": projectID, "hours": "-0.01"}, "Invalid input"},
		{"missing hours", timesheetsActions + "logTime", erpwire.Row{"project_id": projectID}, "Invalid input"},
		{"over integer minutes", timesheetsActions + "logTime", erpwire.Row{"project_id": projectID, "hours": "35791394.12"}, "Invalid input"},
		{"negative rate", timesheetsActions + "logTime", erpwire.Row{"project_id": projectID, "hours": 1, "rateBaht": "-1"}, "Rate must be 0 or more"},
		{"unsafe rate", timesheetsActions + "logTime", erpwire.Row{"project_id": projectID, "hours": 1, "rateBaht": "90071992547409.92"}, "Invalid hourly rate"},
		{"object rate", timesheetsActions + "logTime", erpwire.Row{"project_id": projectID, "hours": 1, "rateBaht": erpwire.Row{}}, "Invalid input"},
		{"bad delete", timesheetsActions + "deleteTimeEntry", erpwire.Row{"id": ""}, "Invalid input"},
		{"fractional minutes", timesheetsActions + "updateTimeEntry", erpwire.Row{"id": "entry", "minutes": "0.5", "billable": true, "rateBaht": "", "notes": ""}, "Invalid time entry"},
		{"unsafe update minutes", timesheetsActions + "updateTimeEntry", erpwire.Row{"id": "entry", "minutes": "2147483648", "billable": true, "rateBaht": "", "notes": ""}, "Invalid time entry"},
		{"strict update money", timesheetsActions + "updateTimeEntry", erpwire.Row{"id": "entry", "minutes": 1, "billable": true, "rateBaht": "1.005", "notes": ""}, "Invalid time entry"},
		{"strict update boolean", timesheetsActions + "updateTimeEntry", erpwire.Row{"id": "entry", "minutes": 1, "billable": "true", "rateBaht": "", "notes": ""}, "Invalid time entry"},
		{"invalid billing key", timesheetsActions + "billTime", erpwire.Row{"project_id": projectID, "key": "seed-id"}, "Invalid billing request"},
		{"strict billing uuid", timesheetsActions + "billTime", erpwire.Row{"project_id": projectID, "key": "11111111-1111-1111-1111-111111111111"}, "Invalid billing request"},
		{"numeric cost rate", timesheetsActions + "setMemberCostRate", erpwire.Row{"user_id": otherUser, "rateBaht": 1}, "Invalid cost rate"},
		{"cost precision", timesheetsActions + "setMemberCostRate", erpwire.Row{"user_id": otherUser, "rateBaht": "0.001"}, "Invalid cost rate"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, f, _ := fixture(t)
			got := callError(t, s, testActor(t, erpwire.Owner), test.key, test.input)
			if got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
			if f.writes != 0 {
				t.Fatal("invalid input wrote data")
			}
		})
	}
}
func TestProjectsCreationUpdateAndFormerOwner(t *testing.T) {
	s, f, a := fixture(t)
	out := callAction(t, s, a, projectsActions+"createProject", erpwire.Row{"name": " \ufeff ส่งมอบ \ufeff ", "status": "review", "budgetBaht": "90071992547409.91", "owner": otherUser, "clientId": "none", "dealId": "none", "deadline": "", "org_id": otherOrg})
	created := f.rows["projects"][1]
	id := text(created["id"])
	assertPaths(t, out, "/projects/"+id, "/projects")
	assertFields(t, created, erpwire.Row{"name": "ส่งมอบ", "status": "review", "budget_satang": int64(9007199254740991), "owner": otherUser, "client_id": nil, "deal_id": nil, "deadline": nil, "org_id": testOrg})
	f.assignees[testOrg] = []erpwire.Row{{"user_id": testUser, "full_name": "Owner"}}
	update := erpwire.Row{"id": id, "name": "Updated", "status": "support", "owner": otherUser, "budgetBaht": "0", "dealId": "unrelated"}
	out = callAction(t, s, a, projectsActions+"updateProject", update)
	assertPaths(t, out, "/projects/"+id, "/projects", "/projects/"+id)
	assertFields(t, created, erpwire.Row{"name": "Updated", "status": "support", "budget_satang": int64(0), "owner": otherUser, "deal_id": nil})
	update["owner"] = "88888888-8888-4888-8888-888888888888"
	if got := callError(t, s, a, projectsActions+"updateProject", update); got != ownerError {
		t.Fatalf("owner rejection %q", got)
	}
	if got := callError(t, s, a, projectsActions+"createProject", erpwire.Row{"name": "Unassigned", "status": "not_started", "owner": otherUser}); got != ownerError {
		t.Fatalf("former owner create %q", got)
	}
	out = callAction(t, s, a, projectsActions+"quickCreateProject", erpwire.Row{"name": "Quick", "status": "paused", "owner": "not-a-guid", "clientId": nil, "deadline": nil})
	assertPaths(t, out, "", "/projects")
	assertFields(t, f.rows["projects"][2], erpwire.Row{"owner": nil, "client_id": nil, "deadline": nil, "budget_satang": nil, "deal_id": nil})
}
func TestEveryProjectStateTransition(t *testing.T) {
	for _, from := range projectStatuses {
		for _, to := range projectStatuses {
			t.Run(from+" to "+to, func(t *testing.T) {
				s, f, a := fixture(t)
				f.rows["projects"][0]["status"] = from
				out := callAction(t, s, a, projectsActions+"updateProjectStatus", erpwire.Row{"id": projectID, "status": to})
				if f.rows["projects"][0]["status"] != to {
					t.Fatalf("status remains %v", f.rows["projects"][0]["status"])
				}
				assertPaths(t, out, "", "/projects", "/projects/"+projectID)
			})
		}
	}
}
func TestTaskAndMilestoneTransitions(t *testing.T) {
	for _, status := range taskStatuses {
		t.Run(status, func(t *testing.T) {
			s, f, a := fixture(t)
			out := callAction(t, s, a, projectsActions+"addTask", erpwire.Row{"projectId": projectID, "title": " งาน ", "status": status, "dueDate": "2026-12-01", "assignee": " "})
			assertPaths(t, out, "", "/projects/"+projectID)
			row := f.rows["project_tasks"][0]
			assertFields(t, row, erpwire.Row{"org_id": testOrg, "project_id": projectID, "title": "งาน", "status": status, "done": status == "done", "assignee": nil, "due_date": "2026-12-01"})
			for _, done := range []bool{true, false} {
				callAction(t, s, a, projectsActions+"toggleTask", erpwire.Row{"id": row["id"], "projectId": projectID, "done": done})
				want := "todo"
				if done {
					want = "done"
				}
				assertFields(t, row, erpwire.Row{"status": want, "done": done})
			}
		})
	}
	s, f, a := fixture(t)
	callAction(t, s, a, projectsActions+"addMilestone", erpwire.Row{"projectId": projectID, "title": " Release ", "dueDate": ""})
	row := f.rows["milestones"][0]
	assertFields(t, row, erpwire.Row{"title": "Release", "due_date": nil})
	for _, done := range []bool{true, false} {
		out := callAction(t, s, a, projectsActions+"toggleMilestone", erpwire.Row{"id": row["id"], "projectId": projectID, "done": done})
		assertPaths(t, out, "", "/projects/"+projectID)
		if row["done"] != done {
			t.Fatal("milestone flag not updated")
		}
	}
}
func TestTimeLoggingCoercionRoundingAuditAndProjectRules(t *testing.T) {
	for _, test := range []struct {
		name                  string
		hours, rate, billable any
		minutes, rateSatang   int64
		wantBillable          bool
	}{{"half minute", "0.025", "1.005", false, 2, 101, false}, {"zero nulls", nil, nil, nil, 0, 0, false}, {"browser truthiness", "1.5", "0.01", "false", 90, 1, true}, {"scientific rate", "1e0", "1e2", true, 60, 10000, true}, {"binary64 minute boundary", "0.008333333333333333", "0", true, 1, 0, true}, {"maximum minutes", "35791394.11666667", "0", true, 2147483647, 0, true}, {"underflow is zero", "1e-999", "-1e-999", true, 0, 0, true}, {"empty array rate", "1", []any{}, true, 60, 0, true}} {
		t.Run(test.name, func(t *testing.T) {
			s, f, a := fixture(t)
			out := callAction(t, s, a, timesheetsActions+"logTime", erpwire.Row{"project_id": projectID, "hours": test.hours, "rateBaht": test.rate, "billable": test.billable, "notes": " 作業 ", "work_date": "", "user_id": otherUser})
			assertPaths(t, out, "", "/timesheets", "/dashboard", "/projects/"+projectID)
			assertFields(t, f.rows["time_entries"][0], erpwire.Row{"org_id": testOrg, "user_id": testUser, "minutes": test.minutes, "rate_satang": test.rateSatang, "billable": test.wantBillable, "notes": "作業", "work_date": "2026-11-09"})
			audit := f.rows["audit_log"][0]
			assertFields(t, audit, erpwire.Row{"entity": "time_entry", "action": "time_logged", "entity_id": f.rows["time_entries"][0]["id"], "summary": "Logged " + string(ratio(test.minutes, 60, 2)) + "h", "actor_id": testUser, "org_id": testOrg})
		})
	}
	s, f, a := fixture(t)
	f.rows["project_tasks"] = []erpwire.Row{{"id": "task", "org_id": testOrg, "project_id": "another-project"}}
	got := callError(t, s, a, timesheetsActions+"logTime", erpwire.Row{"project_id": projectID, "task_id": "task", "hours": 1})
	if got != "Task must belong to time entry project" || len(f.rows["time_entries"]) != 0 || len(f.rows["audit_log"]) != 0 {
		t.Fatalf("bad task accepted %q", got)
	}
}
func TestTimeEditAuthorizationAndInvoiceStates(t *testing.T) {
	for _, role := range []erpwire.Role{erpwire.Member, erpwire.Accountant, erpwire.Admin, erpwire.Owner} {
		for _, author := range []string{testUser, otherUser, ""} {
			for _, state := range []string{"unbilled", "draft", "sent", "partially_paid", "paid", "overdue", "cancelled", "missing"} {
				for _, operation := range []string{"updateTimeEntry", "deleteTimeEntry"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", role, author, state, operation), func(t *testing.T) {
						s, f, _ := fixture(t)
						a := testActor(t, role)
						entry := erpwire.Row{"org_id": testOrg, "id": "entry", "project_id": projectID, "user_id": nullable(author), "invoice_id": nil, "minutes": int64(5)}
						if state != "unbilled" {
							entry["invoice_id"] = invoiceID
							if state != "missing" {
								f.rows["invoices"] = []erpwire.Row{{"org_id": testOrg, "id": invoiceID, "status": state}}
							}
						}
						f.rows["time_entries"] = []erpwire.Row{entry}
						input := erpwire.Row{"id": "entry", "minutes": "2147483647", "billable": false, "rateBaht": "90071992547409.91", "notes": " 更新 "}
						out := callAction(t, s, a, timesheetsActions+operation, input)
						message := text(out.Value.(erpwire.Row)["error"])
						staff := role == erpwire.Admin || role == erpwire.Owner
						allowed := (state == "unbilled" || state == "cancelled") && (author == testUser || staff)
						if !allowed {
							if message != editTimeError {
								t.Fatalf("unauthorized %q, want %q", message, editTimeError)
							}
							if entry["minutes"] != int64(5) || len(f.rows["audit_log"]) != 0 {
								t.Fatal("denied edit changed entry or audit")
							}
							return
						}
						if message != "" {
							t.Fatalf("allowed edit failed %q", message)
						}
						if operation == "updateTimeEntry" {
							assertFields(t, entry, erpwire.Row{"minutes": int64(2147483647), "billable": false, "rate_satang": int64(9007199254740991), "notes": "更新"})
							assertPaths(t, out, "", "/timesheets", "/dashboard", "/projects/"+projectID)
						} else {
							if len(f.rows["time_entries"]) != 0 {
								t.Fatal("entry retained")
							}
							assertPaths(t, out, "", "/projects/"+projectID, "/dashboard", "/timesheets")
						}
						if len(f.rows["audit_log"]) != 1 {
							t.Fatal("missing audit")
						}
					})
				}
			}
		}
	}
}
func TestBillingUsesDurableCommandAndUnchangedIdempotencyKey(t *testing.T) {
	s, f, _ := fixture(t)
	a := testActor(t, erpwire.Admin)
	f.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
		switch name {
		case "bill_project_time":
			return json.Marshal(invoiceID)
		case "set_member_cost_rate":
			return json.RawMessage("null"), nil
		}
		return nil, errors.New("unexpected command")
	}
	for range 2 {
		out := callAction(t, s, a, timesheetsActions+"billTime", erpwire.Row{"project_id": projectID, "key": billingKey, "org_id": otherOrg})
		assertFields(t, out.Value.(erpwire.Row), erpwire.Row{"invoiceId": invoiceID})
		assertPaths(t, out, "", "/timesheets", "/finance", "/projects/"+projectID)
	}
	if len(f.commands) != 2 || !reflect.DeepEqual(f.commands[0], f.commands[1]) {
		t.Fatal("retry changed command or key")
	}
	assertFields(t, f.commands[0].args, erpwire.Row{"p_org_id": testOrg, "p_project_id": projectID, "p_key": billingKey})
	if len(f.rows["invoices"]) != 0 || len(f.rows["audit_log"]) != 0 {
		t.Fatal("Go duplicated durable billing effects")
	}
	out := callAction(t, s, a, timesheetsActions+"setMemberCostRate", erpwire.Row{"user_id": otherUser, "rateBaht": "0.01"})
	assertPaths(t, out, "", "/timesheets", "/projects")
	call := f.commands[2]
	if call.name != "set_member_cost_rate" {
		t.Fatal(call.name)
	}
	assertFields(t, call.args, erpwire.Row{"p_org_id": testOrg, "p_user_id": otherUser, "p_rate_satang": int64(1)})
	for _, message := range []string{"Idempotency conflict", "Project needs a client before billing", "No billable unbilled time", "Time invoice exceeds safe satang bounds"} {
		f.command = func(string, erpwire.Row) (json.RawMessage, error) { return nil, businessError(message) }
		if got := callError(t, s, a, timesheetsActions+"billTime", erpwire.Row{"project_id": projectID, "key": billingKey}); got != message {
			t.Fatalf("got %q, want %q", got, message)
		}
	}
}
