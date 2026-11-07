package erpprojects

import (
	"errors"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestMonthMatrixNavigationLeapDayAndSpillover(t *testing.T) {
	for _, test := range []struct {
		month             string
		year, number      int
		start, end, label string
		inMonth           int
	}{
		{"2026-11", 2026, 11, "2026-10-26", "2026-12-06", "November 2026", 30},
		{"2024-02", 2024, 2, "2024-01-29", "2024-03-10", "February 2024", 29},
		{"2026-02", 2026, 2, "2026-01-26", "2026-03-08", "February 2026", 28},
		{"2026-06", 2026, 6, "2026-06-01", "2026-07-12", "June 2026", 30},
	} {
		t.Run(test.month, func(t *testing.T) {
			ym := parseMonth(test.month, testNow)
			grid := monthMatrix(ym)
			count := 0
			for _, week := range grid {
				if len(week) != 7 {
					t.Fatal("short week")
				}
				for _, day := range week {
					if day.InMonth {
						count++
					}
				}
			}
			if ym.Year != test.year || ym.Month != test.number || len(grid) != 6 || grid[0][0].ISO != test.start || grid[5][6].ISO != test.end || monthLabel(ym) != test.label || count != test.inMonth {
				t.Fatalf("grid %#v count %d", grid, count)
			}
		})
	}
	for _, bad := range []string{"", "2026-00", "2026-13", "2026-1", " 2026-01", "invalid"} {
		if ym := parseMonth(bad, testNow); ym != (YearMonth{2026, 11}) {
			t.Fatalf("bad month %q = %#v", bad, ym)
		}
	}
	if previousMonth(YearMonth{2026, 1}) != (YearMonth{2025, 12}) || nextMonth(YearMonth{2026, 12}) != (YearMonth{2027, 1}) {
		t.Fatal("year rollover failed")
	}
	if first := monthMatrix(YearMonth{99, 1})[0][0].ISO; first != "1998-12-28" {
		t.Fatalf("Date.UTC year normalization differs %s", first)
	}
}
func TestCalendarAggregationStatusToneLinksAndTenantRange(t *testing.T) {
	s, f, a := fixture(t)
	f.rows["clients"] = []erpwire.Row{{"org_id": testOrg, "id": "client", "name": "ลูกค้า"}}
	f.rows["activities"] = []erpwire.Row{
		{"org_id": testOrg, "id": "a", "type": "follow_up", "due_date": "2026-10-26", "done": false, "client_id": "client", "record_type": "project", "record_id": projectID},
		{"org_id": testOrg, "id": "b", "type": "meeting", "due_date": "2026-11-09", "done": false, "client_id": "client"},
		{"org_id": testOrg, "id": "c", "type": "call", "due_date": "2026-11-10", "done": false},
		{"org_id": testOrg, "id": "d", "type": "email", "due_date": "2026-11-01", "done": true},
		{"org_id": testOrg, "id": "e", "type": "note", "due_date": nil, "done": false},
		{"org_id": testOrg, "id": "outside", "type": "call", "due_date": "2026-12-07", "done": false},
		{"org_id": otherOrg, "id": "foreign", "type": "call", "due_date": "2026-11-09", "done": false, "record_type": "client", "record_id": "secret"},
	}
	f.rows["invoices"] = []erpwire.Row{{"org_id": testOrg, "id": invoiceID, "number": "INV-ทดสอบ", "due_date": "2026-11-09"}, {"org_id": otherOrg, "id": "secret", "number": "Secret", "due_date": "2026-11-09"}}
	value, err := invoke(t, s, a, "app/(app)/calendar/page.tsx::load", erpwire.Row{"month": "2026-11"})
	if err != nil {
		t.Fatal(err)
	}
	out := value.(CalendarPageData)
	if out.Today != "2026-11-09" || out.RangeStart != "2026-10-26" || out.RangeEnd != "2026-12-06" || len(out.Items) != 6 || out.PrevHref != "/calendar?month=2026-10" || out.NextHref != "/calendar?month=2026-12" || out.TodayHref != "/calendar?month=2026-11" || len(out.ByDate["2026-11-09"]) != 3 {
		t.Fatalf("calendar %#v", out)
	}
	for i, want := range []CalendarItem{
		{ID: "activity-a", Date: "2026-10-26", Label: "Pending · Overdue · Follow-up · ลูกค้า", Tone: "red", Href: "/projects/" + projectID},
		{ID: "activity-b", Date: "2026-11-09", Label: "Pending · Today · Meeting · ลูกค้า", Tone: "orange", Href: "/clients/client"},
		{ID: "activity-c", Date: "2026-11-10", Label: "Pending · Future · Call", Tone: "emerald"},
		{ID: "activity-d", Date: "2026-11-01", Label: "Completed · Email", Tone: "neutral"},
		{ID: "invoice-" + invoiceID, Date: "2026-11-09", Label: "Invoice INV-ทดสอบ due", Tone: "red", Href: "/finance/invoices/" + invoiceID},
		{ID: "project-" + projectID, Date: "2026-11-09", Label: "โครงการทดสอบ deadline", Tone: "emerald", Href: "/projects/" + projectID},
	} {
		if out.Items[i] != want {
			t.Fatalf("item %d = %#v want %#v", i, out.Items[i], want)
		}
	}
}
func TestActivitiesGroupsOwnerScopeAndStableOrder(t *testing.T) {
	s, f, a := fixture(t)
	f.rows["activities"] = []erpwire.Row{
		{"org_id": testOrg, "owner": testUser, "id": "z", "type": "call", "body": "รายละเอียด", "due_date": "2026-11-08", "done": false, "record_type": "deal", "record_id": "deal"},
		{"org_id": testOrg, "owner": testUser, "id": "a", "type": "note", "body": "", "due_date": "2026-11-08", "done": false},
		{"org_id": testOrg, "owner": testUser, "id": "today", "type": "meeting", "due_date": "2026-11-09", "done": false},
		{"org_id": testOrg, "owner": testUser, "id": "future", "type": "email", "due_date": "2026-12-01", "done": false},
		{"org_id": testOrg, "owner": testUser, "id": "none", "type": "follow_up", "due_date": nil, "done": false},
		{"org_id": testOrg, "owner": testUser, "id": "done", "type": "call", "due_date": "2026-11-08", "done": true},
		{"org_id": testOrg, "owner": otherUser, "id": "other-user", "type": "call", "due_date": "2026-11-08", "done": false},
		{"org_id": otherOrg, "owner": testUser, "id": "other-org", "type": "call", "due_date": "2026-11-08", "done": false},
	}
	value, err := invoke(t, s, a, "app/(app)/activities/page.tsx::load")
	if err != nil {
		t.Fatal(err)
	}
	out := value.(ActivitiesPageData)
	if len(out.Activities) != 5 || len(out.Groups) != 4 || len(out.Groups[0].Activities) != 2 || out.Groups[0].Label != "Overdue" || out.Groups[0].Activities[0]["id"] != "a" || out.Groups[0].Activities[1]["id"] != "z" {
		t.Fatalf("activity groups %#v", out)
	}
	for i, state := range []string{"overdue", "today", "future", "none"} {
		if out.Groups[i].State != state || len(out.Groups[i].Activities) == 0 {
			t.Fatalf("group %d %#v", i, out.Groups[i])
		}
	}
	assertFields(t, out.Groups[0].Activities[0], erpwire.Row{"label": "Note · Activity", "href": ""})
	assertFields(t, out.Groups[0].Activities[1], erpwire.Row{"label": "Call · รายละเอียด", "href": "/deals/deal"})
}
func TestCalendarKeepsSourceEmptyOnFailureButPropagatesRevocation(t *testing.T) {
	s, f, a := fixture(t)
	f.readErrors["activities"] = errors.New("source unavailable")
	value, err := invoke(t, s, a, "app/(app)/calendar/page.tsx::load")
	if err != nil {
		t.Fatal(err)
	}
	out := value.(CalendarPageData)
	if len(out.Items) != 1 || out.Items[0].ID != "project-"+projectID {
		t.Fatalf("independent source reads %#v", out.Items)
	}
	f.readErrors["activities"] = erpwire.ErrIdentityChanged
	if _, err := invoke(t, s, a, "app/(app)/calendar/page.tsx::load"); !errors.Is(err, erpwire.ErrIdentityChanged) {
		t.Fatalf("revocation swallowed: %v", err)
	}
}
func TestDueStateAndRecordRoutes(t *testing.T) {
	for _, test := range []struct {
		date string
		done bool
		want string
	}{{"2026-11-08", false, "overdue"}, {"2026-11-09", false, "today"}, {"2026-11-10", false, "future"}, {"", false, "none"}, {"2026-11-08", true, "none"}} {
		if got := dueState(test.date, "2026-11-09", test.done); got != test.want {
			t.Fatalf("due state %q want %q", got, test.want)
		}
	}
	for kind, want := range map[string]string{"client": "/clients/id", "deal": "/deals/id", "quote": "/quotes/id", "invoice": "/finance/invoices/id", "project": "/projects/id", "subscription": "/finance/subscriptions/id", "vendor": "/vendors/id", "purchase_order": "/purchases/id", "expense_claim": "/expenses/id"} {
		if got := recordHref(kind, "id"); got != want {
			t.Fatalf("route %s = %s", kind, got)
		}
	}
	now := time.Date(2026, 12, 31, 18, 0, 0, 0, time.UTC)
	if ym := parseMonth("invalid", now); ym != (YearMonth{2027, 1}) {
		t.Fatalf("Bangkok year boundary %#v", ym)
	}
}
