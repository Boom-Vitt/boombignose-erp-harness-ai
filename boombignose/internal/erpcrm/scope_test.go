package erpcrm

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestOperationsCoverTypeScriptServerExports(t *testing.T) {
	s, _ := testService(t)
	operations := s.Operations()
	want := map[string]bool{}
	exports := regexp.MustCompile(`export\s+async\s+function\s+(\w+)`)
	for _, directory := range []string{"clients", "deals"} {
		root := filepath.Join("..", "..", "..", "app", "(app)", directory)
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if !strings.HasSuffix(path, ".ts") && !strings.HasSuffix(path, ".tsx") {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			relative, err := filepath.Rel(filepath.Join("..", "..", ".."), path)
			if err != nil {
				return err
			}
			key := filepath.ToSlash(relative) + "::"
			if entry.Name() == "page.tsx" {
				want[key+"load"] = true
				return nil
			}
			if entry.Name() != "route.ts" && !strings.HasPrefix(string(data), `"use server"`) {
				return nil
			}
			for _, match := range exports.FindAllStringSubmatch(string(data), -1) {
				want[key+match[1]] = true
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(want) != 26 || len(operations) != len(want) {
		t.Fatalf("source has %d operations, port has %d", len(want), len(operations))
	}
	for key := range want {
		if operations[key] == nil {
			t.Errorf("missing TypeScript operation %s", key)
		}
	}
	for key := range operations {
		if !want[key] {
			t.Errorf("operation has no source export %s", key)
		}
	}
}

func TestForeignOrganizationCannotLoadDealOrClient(t *testing.T) {
	for _, test := range []struct {
		name     string
		selectOp func(*Service) erpwire.Operation
		id       string
	}{{"deal", func(s *Service) erpwire.Operation { return s.dealPage }, testDeal}, {"deal editor", func(s *Service) erpwire.Operation { return s.dealEditPage }, testDeal}, {"client", func(s *Service) erpwire.Operation { return s.clientPage }, testClient}, {"client editor", func(s *Service) erpwire.Operation { return s.clientEditPage }, testClient}} {
		t.Run(test.name, func(t *testing.T) {
			s, store := testService(t)
			seedDeal(store)
			store.tables["deals"][0]["org_id"] = otherOrg
			store.tables["clients"][0]["org_id"] = otherOrg
			raw, _ := json.Marshal([]any{test.id})
			_, err := test.selectOp(s)(context.Background(), testActor(t, erpwire.Member), raw)
			if !errors.Is(err, erpwire.ErrNotFound) {
				t.Fatalf("foreign record returned %v", err)
			}
		})
	}
	s, store := testService(t)
	seedDeal(store)
	store.tables["deals"][0]["org_id"] = otherOrg
	g := &fakeGenerator{}
	s.generator = g
	s.model = "test-model"
	for _, op := range []erpwire.Operation{s.summarizeDeal, s.draftFollowup} {
		expectError(t, invoke(t, op, testActor(t, erpwire.Member), testDeal), "Deal not found.")
	}
	if g.calls != 0 || store.writes != 0 {
		t.Fatal("foreign context reached generator/cache")
	}
}

func TestForeignOrganizationCannotMutateRecords(t *testing.T) {
	s, store := testService(t)
	seedDeal(store)
	a := testActor(t, erpwire.Owner)
	for table, rows := range store.tables {
		for _, row := range rows {
			row["org_id"] = otherOrg
		}
		store.tables[table] = rows
	}
	store.tables["contacts"] = []erpwire.Row{{"org_id": otherOrg, "id": otherID, "name": "SECRET"}}
	store.tables["activities"] = []erpwire.Row{{"org_id": otherOrg, "id": otherID, "done": false}}
	expectError(t, invoke(t, s.updateDeal, a, testDeal, validDealInput()), gone)
	expectError(t, invoke(t, s.updateDealStage, a, testDeal, "won"), gone)
	expectError(t, invoke(t, s.addActivity, a, erpwire.Row{"dealId": testDeal, "type": "note"}), "Deal not found in the active workspace")
	invoke(t, s.updateClient, a, testClient, erpwire.Row{"name": "overwrite"})
	invoke(t, s.deleteClient, a, testClient)
	invoke(t, s.deleteContact, a, otherID, testClient)
	invoke(t, s.toggleActivityDone, a, otherID, true, testDeal)
	got := invoke(t, s.setLostReasonActive, a, form(map[string]string{"id": testReason, "active": "false"})).(erpwire.ActionResponse)
	if got.Redirect != reasonsPath+"?error=save" {
		t.Fatal(got)
	}
	if len(store.tables["deals"]) != 1 || store.tables["deals"][0]["stage"] != "proposal" || len(store.tables["clients"]) != 1 || store.tables["clients"][0]["name"] != "ลูกค้า" || len(store.tables["contacts"]) != 1 || store.tables["contacts"][0]["name"] != "SECRET" || len(store.tables["activities"]) != 1 || store.tables["activities"][0]["done"] != false || store.tables["deal_lost_reasons"][0]["active"] != true {
		t.Fatalf("foreign records changed %#v", store.tables)
	}
	store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
		if name != "delete_deal" || args["p_org_id"] != testOrg || args["p_deal_id"] != testDeal {
			t.Fatal(name, args)
		}
		return nil, testDBError{state: "P0002"}
	}
	expectError(t, invoke(t, s.deleteDeal, a, testDeal), gone)
}

func TestListsAreScopedAndPreserveBrowserMaps(t *testing.T) {
	s, store := testService(t)
	seedDeal(store)
	a := testActor(t, erpwire.Member)
	store.pageSize = 1
	for _, table := range []string{"deals", "clients", "deal_lost_reasons"} {
		foreign := cloneRow(store.tables[table][0])
		foreign["org_id"] = otherOrg
		foreign["id"] = otherID
		foreign["name"] = "SECRET"
		foreign["title"] = "SECRET"
		store.tables[table] = append(store.tables[table], foreign)
	}
	store.tables["deal_next_activity"] = []erpwire.Row{{"org_id": testOrg, "deal_id": testDeal, "next_due_date": "1999-01-01"}, {"org_id": otherOrg, "deal_id": otherID, "next_due_date": "1998-01-01"}}
	store.tables["assignees"] = []erpwire.Row{{"user_id": testUser, "full_name": "Owner"}}
	store.tables["saved_views"] = []erpwire.Row{{"org_id": testOrg, "user_id": testUser, "module": "deals", "id": "view", "name": "Mine", "created_at": "2026-01-01", "config": erpwire.Row{"mine": "1"}}, {"org_id": otherOrg, "user_id": testUser, "module": "deals", "id": "foreign-view", "config": erpwire.Row{}}}
	got := invoke(t, s.dealsPage, a).(DealsPageData)
	if len(got.AllDeals) != 1 || len(got.Deals) != 1 || len(got.Cards) != 1 || len(got.Clients) != 1 || len(got.LostReasons) != 1 || len(got.SavedViews) != 1 || got.OpenValue != 123456 || got.Weighted != 61728 {
		t.Fatalf("scoped board %#v", got)
	}
	if !reflect.DeepEqual(got.OwnerName, erpwire.Map([][2]any{{testUser, "Owner"}})) || !reflect.DeepEqual(got.NextActivity, erpwire.Map([][2]any{{testDeal, "1999-01-01"}})) || got.Cards[0].Due == nil || *got.Cards[0].Due != "1999-01-01" {
		t.Fatalf("board maps %#v", got)
	}
	clients := invoke(t, s.clientsPage, a).(ClientsPageData)
	if len(clients.Clients) != 1 || clients.Clients[0]["id"] != testClient {
		t.Fatal(clients)
	}
	newDeal := invoke(t, s.dealNewPage, a).(DealFormData)
	if len(newDeal.Clients) != 1 || len(newDeal.LostReasons) != 1 {
		t.Fatal(newDeal)
	}
	export := invoke(t, s.exportDeals, a).(CSVResponse)
	if strings.Contains(export.Body, "SECRET") {
		t.Fatal(export.Body)
	}
}

func TestFacetFiltersMatchExportAndBoard(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, bangkok)
	a := testActor(t, erpwire.Member)
	for _, test := range []struct {
		params                    erpwire.Row
		stage, owner, date, label string
		want                      bool
	}{
		{erpwire.Row{"stage": "lead", "q": "ลูกค้า", "mine": "1", "period": "last_month"}, "lead", testUser, "2025-12-31", "งาน ลูกค้า", true},
		{erpwire.Row{"status": "lead"}, "won", testUser, "", "", false},
		{erpwire.Row{"mine": "1"}, "lead", otherID, "", "", false},
		{erpwire.Row{"period": "this_quarter"}, "lead", testUser, "2026-03-31", "", true},
		{erpwire.Row{"period": "this_quarter"}, "lead", testUser, "2026-04-01", "", false},
		{erpwire.Row{"period": "this_year"}, "lead", testUser, "2026-12-31", "", true},
		{erpwire.Row{"period": "this_month"}, "lead", testUser, "2025-12-31T18:00:00Z", "", true},
	} {
		config := parseFacets(test.params, "deals")
		if got := matches(config, erpwire.Row{"stage": test.stage, "owner": test.owner}, test.label, test.date, a, now); got != test.want {
			t.Errorf("%#v got %v", test, got)
		}
	}
	config := parseFacets(erpwire.Row{"status": "lost,lead,lead,bad", "stage": "won", "q": " x y ", "period": "bad", "mine": "true", "groupBy": "stage"}, "deals")
	if config.Status != "lead,lost" || config.Q != "x y" || config.Period != "" || config.Mine != "" || serializeFacets(config) != "q=x+y&status=lead%2Clost&groupBy=stage" {
		t.Fatal(config)
	}
}

func TestInvalidClientContactAndActivityDoNotWrite(t *testing.T) {
	for _, test := range []struct {
		name  string
		op    func(*Service) erpwire.Operation
		input erpwire.Row
		want  string
	}{
		{"client name", func(s *Service) erpwire.Operation { return s.createClient }, erpwire.Row{"name": ""}, "Invalid input"},
		{"client tax", func(s *Service) erpwire.Operation { return s.createClient }, erpwire.Row{"name": "C", "tax_id": "123"}, "Invalid input"},
		{"branch length", func(s *Service) erpwire.Operation { return s.createClient }, erpwire.Row{"name": "C", "branch_label": strings.Repeat("😀", 101)}, "Invalid input"},
		{"contact client", func(s *Service) erpwire.Operation { return s.addContact }, erpwire.Row{"name": "C", "client_id": "bad"}, "Invalid input"},
		{"contact type", func(s *Service) erpwire.Operation { return s.addContact }, erpwire.Row{"name": "C", "client_id": testClient, "phone": nil}, "Invalid input"},
		{"activity type", func(s *Service) erpwire.Operation { return s.addActivity }, erpwire.Row{"dealId": testDeal, "type": "bad"}, "Invalid activity"},
		{"activity deal", func(s *Service) erpwire.Operation { return s.addActivity }, erpwire.Row{"dealId": "bad", "type": "note"}, "Invalid activity"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, store := testService(t)
			expectError(t, invoke(t, test.op(s), testActor(t, erpwire.Member), test.input), test.want)
			if store.reads != 0 || store.writes != 0 {
				t.Fatal("invalid action accessed data")
			}
		})
	}
}
