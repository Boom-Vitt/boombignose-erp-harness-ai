package erpprojects

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestProjectBoardFacetsGroupsAndUncappedReads(t *testing.T) {
	s, f, a := fixture(t)
	f.rows["clients"] = []erpwire.Row{{"org_id": testOrg, "id": "client", "name": "Client"}}
	f.rows["projects"] = nil
	for i, status := range []string{"review", "not_started", "in_progress", "cancelled"} {
		row := erpwire.Row{"org_id": testOrg, "id": status, "name": "โครงการ " + status, "status": status, "deadline": "2026-11-09", "owner": testUser, "client_id": "client", "budget_satang": int64(i + 1), "created_at": "2026-11-01"}
		f.rows["projects"] = append(f.rows["projects"], row)
	}
	f.rows["projects"] = append(f.rows["projects"], erpwire.Row{"org_id": otherOrg, "id": "foreign", "name": "โครงการ foreign", "status": "in_progress", "owner": testUser})
	f.rows["saved_views"] = []erpwire.Row{{"org_id": testOrg, "id": "own-view", "user_id": testUser, "module": "projects", "name": "My view", "config": erpwire.Row{"status": "cancelled,review,bad", "groupBy": "status", "mine": "1", "product": "ignored"}}, {"org_id": otherOrg, "id": "other-org", "user_id": testUser, "module": "projects", "name": "Forbidden"}, {"org_id": testOrg, "id": "other-user", "user_id": otherUser, "module": "projects", "name": "Forbidden"}}
	value, err := invoke(t, s, a, "app/(app)/projects/page.tsx::load", erpwire.Row{"view": "board", "q": " โครงการ ", "status": "not_started,in_progress,review", "mine": "1", "period": "this_month", "groupBy": "status"})
	if err != nil {
		t.Fatal(err)
	}
	out := value.(ProjectsPageData)
	if len(out.AllRows) != 4 || len(out.Rows) != 3 || out.View != "board" || len(out.Columns) != 3 || len(out.MoveTargets) != 7 || len(out.Cards) != 3 {
		t.Fatalf("board counts %#v", out)
	}
	if out.Config.Status != "not_started,in_progress,review" || out.FacetQuery != "q=%E0%B9%82%E0%B8%84%E0%B8%A3%E0%B8%87%E0%B8%81%E0%B8%B2%E0%B8%A3&status=not_started%2Cin_progress%2Creview&period=this_month&mine=1&groupBy=status" {
		t.Fatalf("facet normalization %s", out.FacetQuery)
	}
	if len(out.Groups) != 3 || out.Groups[0].Key != "in_progress" || out.Groups[1].Key != "review" || out.Groups[2].Key != "not_started" {
		t.Fatalf("board lifecycle sorting %#v", out.Groups)
	}
	if len(out.SavedViews) != 1 || out.SavedViews[0].Config.Status != "review,cancelled" {
		t.Fatalf("saved view isolation %#v", out.SavedViews)
	}
	for _, card := range out.Cards {
		if card.Client != "Client" || card.Owner != "Owner" || card.Due != "2026-11-09" || card.AmountSatang == nil {
			t.Fatalf("card projection %#v", card)
		}
	}
	value, err = invoke(t, s, a, "app/(app)/projects/page.tsx::load", erpwire.Row{"status": "cancelled"})
	if err != nil {
		t.Fatal(err)
	}
	closed := value.(ProjectsPageData)
	if len(closed.Cards) != 1 || closed.Cards[0].Due != nil || !closed.MoveTargets[6].FoldedByDefault {
		t.Fatal("closed deadline or folded column changed")
	}
}
func TestProjectNewAndEditPrefills(t *testing.T) {
	for _, test := range []struct {
		name   string
		params erpwire.Row
		want   erpwire.Row
		deal   any
	}{
		{"board", erpwire.Row{"name": "Board", "budget": "0.01", "status": "review"}, erpwire.Row{"name": "Board", "budgetBaht": "0.01", "status": "review"}, nil},
		{"client replaces board", erpwire.Row{"clientId": "client", "name": "Board", "budget": "1"}, erpwire.Row{"clientId": "client"}, nil},
		{"won deal replaces board", erpwire.Row{"dealId": "deal", "clientId": "ignored", "name": "Board", "status": "paused"}, erpwire.Row{"name": "Won deal", "clientId": "client", "budgetBaht": "90071992547409.91"}, "deal"},
		{"foreign deal retains board", erpwire.Row{"dealId": "foreign", "clientId": "ignored", "name": "Board", "status": "bogus"}, erpwire.Row{"name": "Board"}, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, f, a := fixture(t)
			f.rows["clients"] = []erpwire.Row{{"org_id": testOrg, "id": "client", "name": "Customer"}, {"org_id": otherOrg, "id": "other", "name": "Forbidden"}}
			f.rows["deals"] = []erpwire.Row{{"org_id": testOrg, "id": "deal", "title": "Won deal", "client_id": "client", "value_satang": int64(9007199254740991)}, {"org_id": otherOrg, "id": "foreign", "title": "Forbidden", "value_satang": int64(1)}}
			value, err := invoke(t, s, a, "app/(app)/projects/new/page.tsx::load", test.params)
			if err != nil {
				t.Fatal(err)
			}
			out := value.(ProjectFormData)
			if !reflect.DeepEqual(out.DefaultValues, test.want) || out.ResolvedDealID != test.deal || len(out.Clients) != 1 || len(out.Members) != 2 {
				t.Fatalf("form prefill %#v", out)
			}
		})
	}
	s, f, a := fixture(t)
	f.rows["projects"][0]["owner"] = "former"
	f.rows["projects"][0]["budget_satang"] = int64(1)
	value, err := invoke(t, s, a, "app/(app)/projects/[id]/edit/page.tsx::load", erpwire.Row{"id": projectID})
	if err != nil {
		t.Fatal(err)
	}
	out := value.(ProjectFormData)
	assertFields(t, out.DefaultValues, erpwire.Row{"budgetBaht": "0.01", "clientId": "none", "owner": "former"})
	if last := out.Members[len(out.Members)-1]; last["id"] != "former" || last["name"] != "Former member" {
		t.Fatalf("former owner lost %#v", out.Members)
	}
}
func TestProjectDetailTotalsProfitAndPrivilegeBoundary(t *testing.T) {
	for _, role := range []erpwire.Role{erpwire.Member, erpwire.Accountant, erpwire.Owner} {
		t.Run(string(role), func(t *testing.T) {
			s, f, _ := fixture(t)
			a := testActor(t, role)
			for i, done := range []bool{true, false, true} {
				f.rows["project_tasks"] = append(f.rows["project_tasks"], erpwire.Row{"id": string(rune('a' + i)), "org_id": testOrg, "project_id": projectID, "done": done, "status": "todo"})
			}
			f.rows["milestones"] = []erpwire.Row{{"id": "milestone", "org_id": testOrg, "project_id": projectID, "done": true}}
			f.rows["invoices"] = []erpwire.Row{{"org_id": testOrg, "id": invoiceID, "project_id": projectID, "number": "INV-1", "status": "sent", "amount_satang": int64(8000), "total_satang": int64(10700), "vat_satang": int64(700)}, {"org_id": testOrg, "id": "draft", "project_id": projectID, "status": "draft", "total_satang": int64(999999), "vat_satang": int64(0)}}
			f.rows["costs"] = []erpwire.Row{{"org_id": testOrg, "id": "cost", "project_id": projectID, "amount_satang": int64(2140), "input_vat_satang": int64(140)}}
			f.rows["time_entries"] = []erpwire.Row{{"org_id": testOrg, "id": "time", "project_id": projectID, "minutes": int64(90), "billable": true, "rate_satang": int64(101)}}
			f.rows["project_time_totals"] = []erpwire.Row{{"org_id": testOrg, "project_id": projectID, "minutes": int64(90)}}
			f.rows["project_labour_totals"] = []erpwire.Row{{"org_id": testOrg, "project_id": projectID, "labour_cost_satang": int64(1000)}}
			f.rows["credit_note_revenue"] = []erpwire.Row{{"org_id": testOrg, "id": "credit", "project_id": projectID, "base_satang": int64(1000)}, {"org_id": testOrg, "id": "other-project", "project_id": "other", "base_satang": int64(99999)}, {"org_id": otherOrg, "id": "other-org", "project_id": projectID, "base_satang": int64(99999)}}
			f.rows["org_settings"] = []erpwire.Row{{"org_id": testOrg, "vat_registered": true}}
			for _, id := range []string{"q1", "q2", "q3"} {
				f.rows["quotes"] = append(f.rows["quotes"], erpwire.Row{"org_id": testOrg, "id": id, "project_id": projectID})
			}
			value, err := invoke(t, s, a, "app/(app)/projects/[id]/page.tsx::load", projectID)
			if err != nil {
				t.Fatal(err)
			}
			out := value.(ProjectPageData)
			if out.TaskCount != 3 || out.DoneTaskCount != 2 || out.DoneMilestones != 1 || out.QuoteCount != 3 || out.LoggedMinutes != 90 || out.LoggedBillable != 152 || out.LoggedHours != "1.5000000000000000" {
				t.Fatalf("detail totals %#v", out)
			}
			assertFields(t, out.RecordRef, erpwire.Row{"recordType": "project", "recordId": projectID})
			profitAllowed := role != erpwire.Member
			if out.SeesProfit != profitAllowed || (out.Profit != nil) != profitAllowed {
				t.Fatalf("profit visibility %#v", out.Profit)
			}
			if profitAllowed {
				if out.Profit.RevenueSatang != 9000 || out.Profit.CostSatang != 3000 || out.Profit.ProfitSatang != 6000 {
					t.Fatalf("profit %#v", out.Profit)
				}
			} else {
				for _, q := range f.queries {
					if has([]string{"project_labour_totals", "member_cost_rates", "org_settings", "credit_note_revenue"}, q.Table) {
						t.Fatalf("member read sensitive projection %s", q.Table)
					}
				}
			}
		})
	}
}
func TestTimesheetFilteringKeepsMonthlyMetricsAndRatePrivacy(t *testing.T) {
	for _, role := range []erpwire.Role{erpwire.Member, erpwire.Owner} {
		t.Run(string(role), func(t *testing.T) {
			s, f, _ := fixture(t)
			a := testActor(t, role)
			f.rows["memberships"] = []erpwire.Row{{"org_id": testOrg, "id": "m1", "user_id": testUser}, {"org_id": testOrg, "id": "m2", "user_id": otherUser}, {"org_id": otherOrg, "id": "foreign", "user_id": "secret"}}
			f.rows["member_cost_rates"] = []erpwire.Row{{"org_id": testOrg, "user_id": testUser, "cost_rate_satang": int64(12345)}}
			f.rows["time_entries"] = []erpwire.Row{{"org_id": testOrg, "id": "a", "project_id": projectID, "user_id": testUser, "work_date": "2026-11-01", "minutes": int64(30), "billable": true, "rate_satang": int64(1), "invoice_id": nil}, {"org_id": testOrg, "id": "b", "project_id": projectID, "user_id": otherUser, "work_date": "2026-11-02", "minutes": int64(90), "billable": false, "rate_satang": int64(999), "invoice_id": nil}, {"org_id": testOrg, "id": "c", "project_id": projectID, "user_id": testUser, "work_date": "2026-10-31", "minutes": int64(10), "billable": true, "rate_satang": nil, "invoice_id": invoiceID}, {"org_id": otherOrg, "id": "secret", "project_id": projectID, "user_id": testUser, "work_date": "2026-11-01", "minutes": int64(999), "billable": true, "rate_satang": int64(99999)}}
			f.rows["invoices"] = []erpwire.Row{{"org_id": testOrg, "id": invoiceID, "status": "sent", "number": "INV-1"}}
			value, err := invoke(t, s, a, "app/(app)/timesheets/page.tsx::load", erpwire.Row{"status": "billable", "mine": "1", "groupBy": "month", "q": "Owner"})
			if err != nil {
				t.Fatal(err)
			}
			out := value.(TimesheetsPageData)
			if len(out.AllEntries) != 3 || len(out.Entries) != 2 || out.MonthMinutes != 120 || out.MonthBillable != 1 || out.MonthUtil != "0.2500000000000000" || out.MonthHours != "2.0000000000000000" || out.Today != "2026-11-09" || len(out.Groups) != 2 {
				t.Fatalf("timesheet totals %#v", out)
			}
			if out.Groups[0].Key != "2026-11" || *out.Groups[0].TotalSatang != 1 || out.Groups[1].Key != "2026-10" {
				t.Fatalf("groups %#v", out.Groups)
			}
			staff := role == erpwire.Owner
			if out.Staff != staff || len(out.Members) != 2 {
				t.Fatalf("members %#v", out.Members)
			}
			wantRate := int64(0)
			if staff {
				wantRate = 12345
			}
			gotRate, _ := integer(out.Members[0]["rate"])
			if gotRate != wantRate {
				t.Fatalf("rate %d want %d", gotRate, wantRate)
			}
			for _, row := range out.AllEntries {
				switch row["id"] {
				case "c":
					if row["canEdit"] != false {
						t.Fatal("issued time unlocked")
					}
				case "a":
					if row["canEdit"] != true {
						t.Fatal("author locked")
					}
				case "b":
					if row["canEdit"] != staff {
						t.Fatal("staff authority changed")
					}
				}
			}
			if !staff {
				for _, q := range f.queries {
					if q.Table == "member_cost_rates" {
						t.Fatal("member queried individual cost rates")
					}
				}
			}
		})
	}
}
func TestCrossOrgMutationAndDetailIsolation(t *testing.T) {
	s, f, a := fixture(t)
	f.rows["projects"] = append(f.rows["projects"], erpwire.Row{"org_id": otherOrg, "id": "foreign", "name": "Private", "status": "paused"})
	f.rows["project_tasks"] = []erpwire.Row{{"org_id": otherOrg, "id": "task", "done": false, "status": "in_progress"}}
	f.rows["milestones"] = []erpwire.Row{{"org_id": otherOrg, "id": "milestone", "done": false}}
	f.rows["time_entries"] = []erpwire.Row{{"org_id": otherOrg, "id": "entry", "user_id": testUser, "minutes": int64(10), "invoice_id": nil, "project_id": projectID}}
	callAction(t, s, a, projectsActions+"updateProjectStatus", erpwire.Row{"id": "foreign", "status": "delivered", "org_id": otherOrg})
	callAction(t, s, a, projectsActions+"toggleTask", erpwire.Row{"id": "task", "projectId": projectID, "done": true})
	callAction(t, s, a, projectsActions+"toggleMilestone", erpwire.Row{"id": "milestone", "projectId": projectID, "done": true})
	if f.rows["projects"][1]["status"] != "paused" || f.rows["project_tasks"][0]["done"] != false || f.rows["milestones"][0]["done"] != false {
		t.Fatal("cross-org mutation succeeded")
	}
	for _, op := range []string{"deleteTimeEntry", "updateTimeEntry"} {
		if got := callError(t, s, a, timesheetsActions+op, erpwire.Row{"id": "entry", "minutes": 0, "billable": true, "rateBaht": "", "notes": ""}); got != editTimeError {
			t.Fatalf("cross-org time response %q", got)
		}
	}
	for _, page := range []string{"app/(app)/projects/[id]/page.tsx::load", "app/(app)/projects/[id]/edit/page.tsx::load"} {
		if _, err := invoke(t, s, a, page, "foreign"); !errors.Is(err, erpwire.ErrNotFound) {
			t.Fatalf("foreign project returned %v", err)
		}
	}
	if got := callError(t, s, a, projectsActions+"addTask", erpwire.Row{"projectId": "foreign", "title": "Task", "status": "todo"}); got != safeFailure {
		t.Fatalf("foreign parent insert returned %q", got)
	}
}
func TestLoaderErrorsAreNeverPartialFinancialTotals(t *testing.T) {
	for _, test := range []struct{ page, table, message string }{{"timesheets/page.tsx", "time_entries", "Timesheets unavailable. Please reload."}, {"timesheets/page.tsx", "member_cost_rates", "Timesheets unavailable. Please reload."}, {"timesheets/page.tsx", "saved_views", "Saved views unavailable. Please reload."}, {"projects/[id]/page.tsx", "project_labour_totals", "Project labour cost unavailable. Please reload."}, {"projects/[id]/page.tsx", "org_settings", "Project VAT registration unavailable. Please reload."}, {"activities/page.tsx", "activities", "Unable to load activities. Please try again."}} {
		t.Run(test.page+"/"+test.table, func(t *testing.T) {
			s, f, _ := fixture(t)
			f.readErrors[test.table] = errors.New("private database detail")
			args := []any{}
			if strings.Contains(test.page, "[id]") {
				args = append(args, projectID)
			}
			_, err := invoke(t, s, testActor(t, erpwire.Owner), "app/(app)/"+test.page+"::load", args...)
			if err == nil || err.Error() != test.message {
				t.Fatalf("error %v want %s", err, test.message)
			}
		})
	}
	s, f, a := fixture(t)
	f.rpcError = errors.New("private RPC detail")
	if _, err := invoke(t, s, a, "app/(app)/timesheets/page.tsx::load"); err == nil || err.Error() != "Time-entry users unavailable. Please reload." {
		t.Fatalf("profile error %v", err)
	}
	for _, raw := range []json.RawMessage{nil, json.RawMessage(`{}`), json.RawMessage(`null`), json.RawMessage(`[{},{}]`), json.RawMessage(`[{}] trailing`)} {
		if _, err := s.projectsPage(context.Background(), a, raw); !errors.Is(err, erpwire.ErrBadArguments) {
			t.Fatalf("bad arguments %s accepted: %v", raw, err)
		}
	}
}

func TestProjectOptionalReadFallbacksAndRevocation(t *testing.T) {
	s, f, a := fixture(t)
	f.readErrors["clients"] = errors.New("options unavailable")
	f.readErrors["deals"] = errors.New("deal unavailable")
	f.rpcError = errors.New("people unavailable")
	value, err := invoke(t, s, a, "app/(app)/projects/new/page.tsx::load", erpwire.Row{"dealId": "deal", "name": "Board"})
	if err != nil {
		t.Fatal(err)
	}
	form := value.(ProjectFormData)
	if len(form.Clients) != 0 || len(form.Members) != 0 || form.DefaultValues["name"] != "Board" || form.ResolvedDealID != nil {
		t.Fatalf("source option fallback %#v", form)
	}
	for _, table := range []string{"project_tasks", "milestones", "project_time_totals", "quotes"} {
		f.readErrors[table] = errors.New("optional section unavailable")
	}
	value, err = invoke(t, s, a, "app/(app)/projects/[id]/page.tsx::load", projectID)
	if err != nil {
		t.Fatal(err)
	}
	detail := value.(ProjectPageData)
	if len(detail.Tasks) != 0 || detail.TaskCount != 0 || detail.DoneTaskCount != 0 || len(detail.Milestones) != 0 || detail.LoggedMinutes != 0 || detail.QuoteCount != 0 || len(detail.Names.Entries) != 0 {
		t.Fatalf("source section fallback %#v", detail)
	}
	f.rpcError = erpwire.ErrIdentityChanged
	if _, err := invoke(t, s, a, "app/(app)/projects/new/page.tsx::load"); !errors.Is(err, erpwire.ErrIdentityChanged) {
		t.Fatalf("revocation swallowed %v", err)
	}
}
func TestFacetsAndDeadlineBoundaries(t *testing.T) {
	if label := deadlineMeta("2026-09-09", testNow).Label; label != "9 Sept 2026" {
		t.Fatalf("en-GB label %q", label)
	}
	params := erpwire.Row{"q": strings.Repeat("😀", 101), "status": "review,invalid,not_started,review", "period": "last_month", "groupBy": "month", "mine": "1"}
	c := parseFacets(params, "projects")
	if textLength(c.Q) != 200 || c.Status != "not_started,review" || c.Period != "last_month" || c.Mine != "1" {
		t.Fatalf("facet config %#v", c)
	}
	if got := parseFacets(erpwire.Row{"q": []any{"ignored"}, "status": "sent", "groupBy": "owner", "mine": "true", "period": "tomorrow"}, "timesheets"); got != (FacetConfig{}) {
		t.Fatalf("invalid facets retained %#v", got)
	}
	for _, test := range []struct {
		date, period string
		want         bool
	}{{"2026-10-31", "last_month", true}, {"2026-11-01", "last_month", false}, {"2026-10-01", "this_quarter", true}, {"2027-01-01", "this_year", false}, {"2026-10-31T18:00:00Z", "this_month", true}, {"", "this_month", false}} {
		if got := inPeriod(test.date, test.period, testNow); got != test.want {
			t.Fatalf("inPeriod %s %s = %v", test.date, test.period, got)
		}
	}
	now := time.Date(2026, 11, 9, 12, 0, 0, 0, time.Local)
	for _, test := range []struct{ date, tone, note string }{{"2026-11-07", "danger", "2 days overdue"}, {"2026-11-08", "danger", "1 day overdue"}, {"2026-11-09", "warning", "Due today"}, {"2026-11-10", "warning", "Due tomorrow"}, {"2026-11-16", "warning", "In 7 days"}, {"2026-11-17", "default", ""}} {
		out := deadlineMeta(test.date, now)
		if out == nil || out.Tone != test.tone || test.note != "" && (out.Note == nil || *out.Note != test.note) || test.note == "" && out.Note != nil {
			t.Fatalf("deadline %s = %#v", test.date, out)
		}
	}
}
