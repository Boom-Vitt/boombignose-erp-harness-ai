package erpcrm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestDealDetailAndEditor(t *testing.T) {
	s, store := testService(t)
	seedDeal(store)
	store.pageSize = 1
	a := testActor(t, erpwire.Member)
	store.tables["activities"] = []erpwire.Row{
		{"org_id": testOrg, "id": "a", "deal_id": testDeal, "done": true, "created_at": "2026-11-03", "body": "done"},
		{"org_id": testOrg, "id": "b", "deal_id": testDeal, "done": false, "created_at": "2026-11-01", "body": "older"},
		{"org_id": testOrg, "id": "c", "deal_id": testDeal, "done": false, "created_at": "2026-11-02", "body": "newest"},
		{"org_id": otherOrg, "id": "secret", "deal_id": testDeal, "done": false, "created_at": "9999", "body": "SECRET"},
	}
	store.tables["projects"] = []erpwire.Row{{"org_id": testOrg, "id": "p", "deal_id": testDeal}, {"org_id": otherOrg, "id": "foreign", "deal_id": testDeal}}
	store.tables["deal_lost_reasons"] = append(store.tables["deal_lost_reasons"], erpwire.Row{"org_id": testOrg, "id": otherID, "name": "archived", "active": false})
	got := invoke(t, s.dealPage, a, testDeal).(DealPageData)
	if got.Deal["id"] != testDeal || got.Client["name"] != "ลูกค้า" || got.ExpectedRevenueSatang != 61728 || got.Projects.Count != 1 || got.Projects.ID == nil || *got.Projects.ID != "p" || got.Projects.Href != "/projects/p" {
		t.Fatalf("bad detail %#v", got)
	}
	if got.ProjectCount != 1 || got.CreateProjectHref != "" || got.CanManageReasons || !got.QuoteNextStep || !got.FollowUpOverdue || got.FollowUpDueToday || got.RecordRef != (RecordRef{"deal", testDeal}) {
		t.Fatalf("bad detail controls %#v", got)
	}
	if got.Quotes.Count != 0 || got.Quotes.Href != "/quotes/new?clientId="+testClient+"&dealId="+testDeal {
		t.Fatal(got.Quotes)
	}
	if len(got.LostReasons) != 1 || len(got.Activities) != 3 || got.Activities[0]["id"] != "c" || got.Activities[1]["id"] != "b" || got.Activities[2]["id"] != "a" {
		t.Fatalf("incorrect ordering/paging %#v", got)
	}
	store.tables["deals"][0]["value_satang"] = int64(money.MaxSafeSatang)
	edit := invoke(t, s.dealEditPage, a, testDeal).(DealFormData)
	want := erpwire.Row{"clientId": testClient, "title": "งานใหม่", "stage": "proposal", "valueBaht": json.Number("90071992547409.91"), "probability": int64(50), "lostReasonId": "", "expectedCloseDate": "2026-12-01", "nextFollowUpDate": "2000-01-01", "source": "", "notes": ""}
	if !reflect.DeepEqual(edit.DefaultValues, want) || edit.SubmitLabel != "Save changes" || !edit.RedirectsOnSuccess || len(edit.Clients) != 1 || len(edit.LostReasons) != 1 {
		t.Fatalf("bad editor %#v", edit)
	}
	store.pageSize = 0
	store.tables["projects"] = nil
	store.tables["quotes"] = []erpwire.Row{{"org_id": testOrg, "id": "q", "deal_id": testDeal}}
	store.tables["deals"][0]["next_follow_up_date"] = today(time.Now())
	got = invoke(t, s.dealPage, testActor(t, erpwire.Owner), testDeal).(DealPageData)
	if got.CreateProjectHref != "/projects/new?dealId="+testDeal+"&clientId="+testClient || got.Quotes.Href != "/quotes/q" || !got.CanManageReasons || got.FollowUpOverdue || !got.FollowUpDueToday {
		t.Fatalf("bad smart buttons %#v", got)
	}
}

func TestNewDealDefaults(t *testing.T) {
	for _, test := range []struct{ amount, stage, wantAmount, wantStage string }{
		{"", "", "0", "lead"}, {"invalid", "invalid", "0", "lead"}, {"-1", "lost", "0", "lost"}, {"0", "won", "0", "won"}, {"1.005", "proposal", "1.005", "proposal"}, {"90071992547409.91", "lead", "90071992547409.91", "lead"}, {"1e3", "lead", "1000", "lead"}, {"0x10", "lead", "16", "lead"},
	} {
		t.Run(test.amount+test.stage, func(t *testing.T) {
			s, store := testService(t)
			seedDeal(store)
			got := invoke(t, s.dealNewPage, testActor(t, erpwire.Member), erpwire.Row{"title": "  title  ", "clientId": testClient, "amount": test.amount, "stage": test.stage}).(DealFormData)
			want := erpwire.Row{"title": "  title  ", "clientId": testClient, "stage": test.wantStage, "valueBaht": json.Number(test.wantAmount)}
			if !reflect.DeepEqual(got.DefaultValues, want) || got.SubmitLabel != "Create deal" || len(got.Clients) != 1 || len(got.LostReasons) != 1 {
				t.Fatalf("got %#v", got)
			}
		})
	}
}

func TestReasonsLoaderAndFailures(t *testing.T) {
	for _, test := range []struct{ code, message string }{{"", ""}, {"invalid", "Enter a reason of 1 to 80 characters."}, {"duplicate", "That reason is already on the list."}, {"save", "Unable to save the reason. Please try again."}, {"unknown", "Unable to save the reason. Please try again."}} {
		t.Run(test.code, func(t *testing.T) {
			s, store := testService(t)
			seedDeal(store)
			store.tables["deal_lost_reasons"] = append(store.tables["deal_lost_reasons"], erpwire.Row{"org_id": testOrg, "id": otherID, "name": "aaa archived", "active": false}, erpwire.Row{"org_id": otherOrg, "id": "secret", "name": "SECRET", "active": true})
			got := invoke(t, s.reasonsPage, testActor(t, erpwire.Admin), erpwire.Row{"error": test.code}).(ReasonsPageData)
			if got.Error != test.message || len(got.Reasons) != 2 || got.Reasons[0]["id"] != testReason {
				t.Fatal(got)
			}
		})
	}
	s, store := testService(t)
	store.readErr = errors.New("private database failure")
	_, err := s.reasonsPage(context.Background(), testActor(t, erpwire.Owner), json.RawMessage(`[]`))
	if err == nil || err.Error() != "Unable to load lost reasons. Please try again." {
		t.Fatal(err)
	}
	store.readErr = erpwire.ErrIdentityChanged
	_, err = s.reasonsPage(context.Background(), testActor(t, erpwire.Owner), json.RawMessage(`[]`))
	if !errors.Is(err, erpwire.ErrIdentityChanged) {
		t.Fatal(err)
	}
}

func TestExportBytesAndFilters(t *testing.T) {
	s, store := testService(t)
	seedDeal(store)
	store.pageSize = 1
	deal := store.tables["deals"][0]
	deal["title"] = "=SUM(1,2)\nงาน"
	deal["lost_reason_id"] = testReason
	deal["value_satang"] = int64(101)
	deal["probability"] = int64(50)
	deal["won_at"] = "2026-10-01T00:00:00Z"
	store.tables["clients"][0]["name"] = `ลูกค้า "เอ"`
	for i := 0; i < 3; i++ {
		row := cloneRow(deal)
		row["id"] = fmt.Sprint(i)
		row["title"] = "excluded"
		if i == 0 {
			row["stage"] = "lead"
		}
		if i == 1 {
			row["owner"] = otherID
		}
		if i == 2 {
			row["org_id"] = otherOrg
		}
		store.tables["deals"] = append(store.tables["deals"], row)
	}
	got := invoke(t, s.exportDeals, testActor(t, erpwire.Member), erpwire.Row{"stage": "proposal", "q": "ลูกค้า", "mine": "1"}).(CSVResponse)
	want := "\ufeffTitle,Client,Stage,Value (THB),Probability (%),Expected revenue (THB),Expected close,Next follow-up,Won at,Lost at,Lost reason\r\n\"'=SUM(1,2)\nงาน\",\"ลูกค้า \"\"เอ\"\"\",proposal,1.01,50,0.51,2026-12-01,2000-01-01,2026-10-01T00:00:00Z,,ราคา"
	if got.Body != want {
		t.Fatalf("CSV differs\ngot  %q\nwant %q", got.Body, want)
	}
	if got.Status != 200 || got.Headers["Content-Type"] != "text/csv; charset=utf-8" || got.Headers["Content-Disposition"] != `attachment; filename="deals-`+today(time.Now())+`.csv"` {
		t.Fatal(got.Headers)
	}
	maxDeal := cloneRow(deal)
	maxDeal["title"] = "maximum"
	maxDeal["value_satang"] = int64(money.MaxSafeSatang)
	maxDeal["probability"] = int64(100)
	store.tables["deals"] = []erpwire.Row{maxDeal}
	got = invoke(t, s.exportDeals, testActor(t, erpwire.Member)).(CSVResponse)
	if !strings.Contains(got.Body, ",90071992547409.91,100,90071992547409.91,") {
		t.Fatal(got.Body)
	}
	store.tables["deals"] = nil
	got = invoke(t, s.exportDeals, testActor(t, erpwire.Member)).(CSVResponse)
	if strings.Contains(got.Body, "\r\n") || !strings.HasPrefix(got.Body, "\ufeffTitle,") {
		t.Fatal(got.Body)
	}
}

func TestCSVTextEscaping(t *testing.T) {
	for _, test := range []struct{ input, want string }{{"=cmd", "'=cmd"}, {"+cmd", "'+cmd"}, {"-cmd", "'-cmd"}, {"@cmd", "'@cmd"}, {"\tcmd", "'\tcmd"}, {"\rcmd", "\"'\rcmd\""}, {"-7.01", "-7.01"}, {"-01", "'-01"}, {"a,b", "\"a,b\""}, {"a\"b", "\"a\"\"b\""}, {"a\nb", "\"a\nb\""}, {"ไทย", "ไทย"}, {"", ""}} {
		if got := csvField(test.input); got != test.want {
			t.Errorf("%q: got %q, want %q", test.input, got, test.want)
		}
	}
}
