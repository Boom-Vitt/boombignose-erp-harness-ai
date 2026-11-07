package erpinsight

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestAutomationScopedStatusAndDueDate(t *testing.T) {
	a := insightAuditActor(t, erpwire.Member)
	f := &insightAuditStore{tables: map[string][]erpwire.Row{"reminders": {{"id": "today", "org_id": a.OrgID(), "status": "pending", "due_date": "2026-11-08"}, {"id": "yesterday", "org_id": a.OrgID(), "status": "pending", "due_date": "2026-11-07"}, {"id": "delivered", "org_id": a.OrgID(), "status": "sent", "due_date": "2026-11-06"}, {"id": "foreign", "org_id": "foreign", "status": "pending", "due_date": "2026-11-06"}}, "outbound_events": {{"id": "one", "org_id": a.OrgID(), "status": "queued", "created_at": "2026-11-08T00:00:00Z", "attempts": int64(0)}, {"id": "two", "org_id": a.OrgID(), "status": "delivered", "created_at": "2026-11-07T00:00:00Z", "attempts": int64(1)}, {"id": "three", "org_id": a.OrgID(), "status": "failed", "created_at": "2026-11-06T00:00:00Z", "attempts": int64(3)}, {"id": "foreign", "org_id": "foreign", "status": "queued"}}}}
	s := insightAuditService(t, f)
	v, e := s.automationPage(context.Background(), a, json.RawMessage(`[]`))
	if e != nil {
		t.Fatal(e)
	}
	out := v.(AutomationPageData)
	if out.BothEmpty || out.Today != "2026-11-08" || len(out.PendingReminders) != 2 || len(out.RecentEvents) != 3 {
		t.Fatalf("automation scope/status drift %#v", out)
	}
	if out.PendingReminders[0]["id"] != "yesterday" || out.PendingReminders[0]["overdue"] != true || out.PendingReminders[1]["overdue"] != false || out.PendingReminders[1]["dueLabel"] != "8 Nov 2026" {
		t.Fatalf("due labels/order drift %#v", out.PendingReminders)
	}
	if out.RecentEvents[0]["queuedLabel"] != "8 Nov, 07:00" || out.RecentEvents[0]["status"] != "queued" || out.RecentEvents[1]["status"] != "delivered" || out.RecentEvents[2]["status"] != "failed" {
		t.Fatalf("event states/timezone drift %#v", out.RecentEvents)
	}
}
