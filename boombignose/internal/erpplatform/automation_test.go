package erpplatform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const autoOrg = "22222222-2222-4222-8222-222222222222"
const autoOtherOrg = "33333333-3333-4333-8333-333333333333"
const autoUser = "11111111-1111-4111-8111-111111111111"
const autoID = "44444444-4444-4444-8444-444444444444"
const autoKey = "55555555-5555-4555-8555-555555555555"

var autoNow = time.Date(2026, 11, 8, 1, 2, 3, 0, time.UTC)

func autoActor(t *testing.T, org string, role erpwire.Role) erpwire.Actor {
	t.Helper()
	a, e := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: autoUser, Email: "a@example.test", Assurance: erpwire.AAL2, ExpiresAt: autoNow.Add(time.Hour), FactorStateKnown: true, HasVerifiedFactor: true}, erpwire.Membership{UserID: autoUser, OrgID: org, Role: role}, false, autoNow)
	if e != nil {
		t.Fatal(e)
	}
	return a
}

type autoStore struct {
	mu            sync.Mutex
	rows          map[string][]erpwire.Row
	calls         []autoCall
	inserts       []erpwire.Insert
	command       func(string, erpwire.Row) (json.RawMessage, error)
	reads, writes int
}
type autoCall struct {
	name string
	args erpwire.Row
	org  string
}
type autoTx struct {
	store *autoStore
	actor erpwire.Actor
}

func (s *autoStore) Read(ctx context.Context, a erpwire.Actor, f func(erpwire.ReadTx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	return f(autoTx{s, a})
}
func (s *autoStore) Write(ctx context.Context, a erpwire.Actor, f func(erpwire.WriteTx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writes++
	return f(autoTx{s, a})
}
func (tx autoTx) Select(_ context.Context, q erpwire.Select) (erpwire.Selection, error) {
	orgScoped := false
	for _, p := range q.Where {
		if p.Column == "org_id" && p.Op == erpwire.Equal && p.Value == tx.actor.OrgID() {
			orgScoped = true
		}
	}
	if !orgScoped {
		return erpwire.Selection{}, errors.New("unscoped query")
	}
	out := []erpwire.Row{}
	for _, row := range tx.store.rows[q.Table] {
		matches := true
		for _, p := range q.Where {
			v := row[p.Column]
			switch p.Op {
			case erpwire.Equal:
				matches = matches && reflect.DeepEqual(v, p.Value)
			case erpwire.LessEqual:
				matches = matches && text(v) != "" && text(v) <= text(p.Value)
			}
		}
		if matches {
			out = append(out, row)
		}
	}
	total := int64(len(out))
	if q.Offset > len(out) {
		out = nil
	} else {
		out = out[q.Offset:]
	}
	more := q.Limit > 0 && len(out) > q.Limit
	if more {
		out = out[:q.Limit]
	}
	return erpwire.Selection{Rows: out, Total: &total, HasMore: more}, nil
}
func (tx autoTx) ReadRPC(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if args["p_org_id"] != tx.actor.OrgID() {
		return nil, errors.New("unscoped RPC")
	}
	return tx.command(name, args)
}
func (tx autoTx) Command(_ context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	if org, ok := args["p_org_id"]; ok && org != tx.actor.OrgID() {
		return nil, errors.New("cross-org command")
	}
	return tx.command(name, args)
}
func (tx autoTx) command(name string, args erpwire.Row) (json.RawMessage, error) {
	tx.store.calls = append(tx.store.calls, autoCall{name, args, tx.actor.OrgID()})
	if tx.store.command != nil {
		return tx.store.command(name, args)
	}
	return json.RawMessage(`{}`), nil
}
func (tx autoTx) Insert(_ context.Context, in erpwire.Insert) ([]erpwire.Row, error) {
	for _, row := range in.Rows {
		if row["org_id"] != tx.actor.OrgID() {
			return nil, errors.New("unscoped insert")
		}
	}
	tx.store.inserts = append(tx.store.inserts, in)
	return in.Rows, nil
}
func (tx autoTx) Update(context.Context, string, erpwire.Row, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected update")
}
func (tx autoTx) Delete(context.Context, string, []erpwire.Predicate, []string) ([]erpwire.Row, error) {
	return nil, errors.New("unexpected delete")
}

type autoAuthority struct {
	actors  []erpwire.Actor
	webhook erpwire.Actor
}

func (a autoAuthority) SchedulerActors(context.Context) ([]erpwire.Actor, error) {
	return a.actors, nil
}
func (a autoAuthority) WebhookActor(context.Context, string) (erpwire.Actor, error) {
	return a.webhook, nil
}

func autoService(t *testing.T, store *autoStore, options AutomationOptions) *Service {
	t.Helper()
	s, e := New(Options{Store: store, Now: func() time.Time { return autoNow }, Origins: []string{"https://erp.example.test"}, Automation: options})
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func autoRequest(t *testing.T, s *Service, key string, a erpwire.Actor, req Request) Response {
	t.Helper()
	raw, e := json.Marshal([]Request{req})
	if e != nil {
		t.Fatal(e)
	}
	op := s.Operations()[key]
	if op == nil {
		t.Fatal("missing operation", key)
	}
	out, e := op(context.Background(), a, raw)
	if e != nil {
		t.Fatal(e)
	}
	r, ok := out.(Response)
	if !ok {
		t.Fatalf("wrong response %T", out)
	}
	return r
}
func autoResponseError(t *testing.T, r Response, status int, message string) {
	t.Helper()
	if r.Status != status {
		t.Fatalf("status %d, want %d, body %#v", r.Status, status, r.Body)
	}
	body, ok := r.Body.(erpwire.Row)
	if !ok || body["error"] != message {
		t.Fatalf("error %#v, want %q", r.Body, message)
	}
}
func autoTrustedRequest(method string, body string) Request {
	return Request{Method: method, URL: "https://erp.example.test/", Headers: map[string]string{"Origin": "https://erp.example.test"}, Body: []byte(body)}
}

func TestAutomationSecretComparison(t *testing.T) {
	for _, tc := range []struct {
		provided, expected string
		want               bool
	}{{"", "", false}, {"x", "", false}, {"", "x", false}, {"secret", "secret", true}, {"Secret", "secret", false}, {"secreu", "secret", false}, {"secret-more", "secret", false}, {"ไทย", "ไทย", true}, {"ไทย", "ไทน", false}} {
		if got := secretMatches(tc.provided, tc.expected); got != tc.want {
			t.Fatalf("comparison %q/%q=%v", tc.provided, tc.expected, got)
		}
	}
}

func TestWebhookValidationAndTrustedWorkspace(t *testing.T) {
	actor := autoActor(t, autoOrg, erpwire.Owner)
	store := &autoStore{}
	s := autoService(t, store, AutomationOptions{WebhookSecret: "secret", Authority: autoAuthority{webhook: actor}})
	base := Request{Method: "POST", Headers: map[string]string{"X-Webhook-Secret": "secret", "Idempotency-Key": autoKey}, Body: []byte(`{"orgId":"` + autoOrg + `","payload":{"amount":9007199254740991}}`)}
	for _, tc := range []struct {
		name    string
		edit    func(*Request)
		status  int
		message string
	}{
		{"secret", func(r *Request) { r.Headers["X-Webhook-Secret"] = "wrong" }, 401, "unauthorized"},
		{"key", func(r *Request) { r.Headers["Idempotency-Key"] = "wrong" }, 400, "invalid idempotency key"},
		{"large", func(r *Request) { r.Body = []byte(strings.Repeat(" ", 16385)) }, 413, "payload too large"},
		{"unknown field", func(r *Request) { r.Body = []byte(`{"orgId":"` + autoOrg + `","payload":{},"role":"owner"}`) }, 400, "invalid payload"},
		{"null payload", func(r *Request) { r.Body = []byte(`{"orgId":"` + autoOrg + `","payload":null}`) }, 400, "invalid payload"},
		{"wrong org", func(r *Request) { r.Body = []byte(`{"orgId":"` + autoOtherOrg + `","payload":{}}`) }, 503, "event receipt failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			r.Headers = map[string]string{}
			for k, v := range base.Headers {
				r.Headers[k] = v
			}
			tc.edit(&r)
			autoResponseError(t, autoRequest(t, s, "app/api/webhooks/n8n/followup/route.ts::POST", erpwire.Actor{}, r), tc.status, tc.message)
		})
	}
	if store.writes != 0 {
		t.Fatalf("invalid requests wrote %d times", store.writes)
	}
	for _, duplicate := range []bool{false, true} {
		store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
			if name != "accept_integration_event" || args["p_org_id"] != autoOrg || args["p_event_type"] != "followup" || args["p_key"] != autoKey {
				t.Fatalf("wrong command %s %#v", name, args)
			}
			payload := args["p_payload"].(map[string]any)
			if payload["amount"] != json.Number("9007199254740991") {
				t.Fatalf("money lost %#v", payload)
			}
			b, _ := json.Marshal(erpwire.Row{"eventId": autoID, "duplicate": duplicate})
			return b, nil
		}
		r := autoRequest(t, s, "app/api/webhooks/n8n/followup/route.ts::POST", erpwire.Actor{}, base)
		if r.Status != 200 || r.Body.(erpwire.Row)["duplicate"] != duplicate || r.Body.(erpwire.Row)["eventId"] != autoID {
			t.Fatalf("receipt %#v", r)
		}
	}
	store.command = func(string, erpwire.Row) (json.RawMessage, error) { return nil, errors.New("Idempotency conflict") }
	autoResponseError(t, autoRequest(t, s, "app/api/webhooks/n8n/followup/route.ts::POST", erpwire.Actor{}, base), 409, "idempotency conflict")
}

func TestDueFollowupStateTransitions(t *testing.T) {
	today := "2026-11-08"
	for _, tc := range []struct {
		name, stage, due string
		done             bool
		activity         bool
		want             int
		title            string
	}{
		{"due open", "lead", today, false, false, 1, "Deal"}, {"overdue", "proposal", "2026-11-01", false, false, 1, "Deal"}, {"future", "lead", "2026-11-09", false, false, 0, ""}, {"won", "won", today, false, false, 0, ""}, {"lost", "lost", today, false, false, 0, ""}, {"missing", "lead", "", false, false, 0, ""}, {"activity due", "", today, false, true, 1, "Follow up: call"}, {"completed", "", today, true, true, 0, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := erpwire.Row{"id": autoID, "title": "Deal", "stage": tc.stage, "next_follow_up_date": tc.due, "due_date": tc.due, "done": tc.done, "type": "call", "body": "  "}
			var got []reminderSpec
			if tc.activity {
				got = dueFollowUps(nil, []erpwire.Row{row}, today)
			} else {
				got = dueFollowUps([]erpwire.Row{row}, nil, today)
			}
			if len(got) != tc.want {
				t.Fatalf("%#v", got)
			}
			if tc.want > 0 && (got[0].Title != tc.title || got[0].EntityID != autoID || got[0].DueDate != tc.due) {
				t.Fatalf("wrong reminder %#v", got)
			}
		})
	}
}

func TestCronFollowupsScansOnlyAuthorizedOrganizations(t *testing.T) {
	store := &autoStore{rows: map[string][]erpwire.Row{"deals": {{"id": autoID, "org_id": autoOrg, "title": "Due", "stage": "lead", "next_follow_up_date": "2026-11-08"}, {"id": autoKey, "org_id": autoOtherOrg, "title": "Private", "stage": "lead", "next_follow_up_date": "2026-11-08"}}, "activities": {}}}
	store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
		specs := args["p_specs"].([]reminderSpec)
		if name != "enqueue_reminders" || len(specs) != 1 || specs[0].EntityID != autoID || args["p_org_id"] != autoOrg {
			t.Fatalf("tenant escape %#v", args)
		}
		return json.RawMessage(`{"remindersUpserted":1,"eventsQueued":1}`), nil
	}
	s := autoService(t, store, AutomationOptions{CronSecret: "secret", Authority: autoAuthority{actors: []erpwire.Actor{autoActor(t, autoOrg, erpwire.Admin)}}})
	bad := Request{Method: "POST"}
	autoResponseError(t, autoRequest(t, s, "app/api/cron/followups/route.ts::POST", erpwire.Actor{}, bad), 401, "unauthorized")
	if store.reads != 0 {
		t.Fatal("unauthorized scan read database")
	}
	good := Request{Method: "GET", Headers: map[string]string{"X-Cron-Secret": "secret"}}
	r := autoRequest(t, s, "app/api/cron/followups/route.ts::GET", erpwire.Actor{}, good)
	want := erpwire.Row{"ok": true, "orgsScanned": int64(1), "remindersUpserted": int64(1), "eventsQueued": int64(1)}
	if r.Status != 200 || !reflect.DeepEqual(r.Body, want) {
		t.Fatalf("counts %#v", r)
	}
	member := autoService(t, &autoStore{}, AutomationOptions{CronSecret: "secret", Authority: autoAuthority{actors: []erpwire.Actor{autoActor(t, autoOrg, erpwire.Member)}}})
	autoResponseError(t, autoRequest(t, member, "app/api/cron/followups/route.ts::GET", erpwire.Actor{}, good), 500, "scan failed")
}

func TestSubscriptionCronPreservesOccurrenceAndFailureAudit(t *testing.T) {
	actor := autoActor(t, autoOrg, erpwire.Admin)
	store := &autoStore{rows: map[string][]erpwire.Row{"subscriptions": {{"id": autoID, "org_id": autoOrg, "status": "active", "auto_generate": true, "next_run_date": "2026-11-01"}, {"id": autoKey, "org_id": autoOtherOrg, "status": "active", "auto_generate": true, "next_run_date": "2026-11-01"}}}}
	s := autoService(t, store, AutomationOptions{CronSecret: "secret", Authority: autoAuthority{actors: []erpwire.Actor{actor}}})
	req := Request{Method: "POST", Headers: map[string]string{"X-Cron-Secret": "secret"}}
	store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
		if name != "generate_subscription_occurrence" || args["p_org_id"] != autoOrg || args["p_occurrence"] != "2026-11-01" || args["p_subscription_id"] != autoID {
			t.Fatalf("incorrect occurrence %#v", args)
		}
		return json.RawMessage(`"` + autoKey + `"`), nil
	}
	for range 2 {
		r := autoRequest(t, s, "app/api/cron/subscriptions/route.ts::POST", erpwire.Actor{}, req)
		if r.Status != 200 || r.Body.(erpwire.Row)["processed"] != 1 || r.Body.(erpwire.Row)["failed"] != 0 {
			t.Fatalf("generation %#v", r)
		}
	}
	store.command = func(string, erpwire.Row) (json.RawMessage, error) { return nil, errors.New("database failure") }
	r := autoRequest(t, s, "app/api/cron/subscriptions/route.ts::POST", erpwire.Actor{}, req)
	if r.Status != 503 || r.Body.(erpwire.Row)["failed"] != 1 {
		t.Fatalf("failure %#v", r)
	}
	if len(store.inserts) != 1 {
		t.Fatal("failure audit missing")
	}
	audit := store.inserts[0].Rows[0]
	if audit["org_id"] != autoOrg || audit["entity_id"] != autoID || audit["action"] != "generation_failed" || audit["summary"] != "Scheduled invoice failed: Invoice generation failed" {
		t.Fatalf("audit %#v", audit)
	}
}

func TestChatValidationMatchesSourceErrors(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"empty", "{}", "Send between 1 and 40 messages."}, {"scope", `{"dataScope":"all","messages":[]}`, "Choose ERP records or guidance/document review."}, {"null content", `{"messages":[{"role":"user","content":null}]}`, "Bad message."}, {"assistant final", `{"messages":[{"role":"assistant","content":"hi"}]}`, "The last message must be from you."}, {"empty content", `{"messages":[{"role":"user","content":"  "}]}`, "A message needs text or an attachment."}, {"reply attachments", `{"messages":[{"role":"assistant","content":"hi","attachments":[{}]}]}`, "Too many attachments, or attachments on a reply."}, {"null attachments", `{"messages":[{"role":"user","content":"hi","attachments":null}]}`, "Too many attachments, or attachments on a reply."}, {"attachment null text", `{"messages":[{"role":"user","content":"hi","attachments":[{"kind":"text","name":"x","text":null}]}]}`, "An attachment is not an accepted image, PDF or text file."}, {"valid", `{"messages":[{"role":"user","content":"สวัสดี"}]}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, got := parseAutomationChat([]byte(tc.body))
			if got != tc.want {
				t.Fatalf("%q, want %q", got, tc.want)
			}
		})
	}
	image := base64.StdEncoding.EncodeToString(append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 8)...))
	raw, _ := json.Marshal(erpwire.ChatRequest{DataScope: erpwire.ERPDataScope, Messages: []erpwire.ChatMessage{{Role: "user", Attachments: []erpwire.ChatAttachment{{Kind: "image", Name: "../../ไทย.png", MediaType: "image/jpeg", Base64: image}}}}})
	request, e := parseAutomationChat(raw)
	if e != "" || request.Messages[0].Attachments[0].Name != "ไทย.png" || request.Messages[0].Attachments[0].MediaType != "image/png" {
		t.Fatalf("image normalization %#v %s", request, e)
	}
	if automationSafeName("foo/") != "file" {
		t.Fatal("trailing path label is unsafe")
	}
}

func TestChatBoundaryDeniesOriginAndSizeBeforeCallingModel(t *testing.T) {
	s := autoService(t, &autoStore{}, AutomationOptions{})
	actor := autoActor(t, autoOrg, erpwire.Member)
	req := autoTrustedRequest("POST", `{"messages":[{"role":"user","content":"hi"}]}`)
	bad := req
	bad.Headers = map[string]string{"Origin": "https://evil.example"}
	autoResponseError(t, autoRequest(t, s, "app/api/assistant/chat/route.ts::POST", actor, bad), 403, "Untrusted request origin.")
	autoResponseError(t, autoRequest(t, s, "app/api/assistant/chat/route.ts::POST", erpwire.Actor{}, req), 401, "Sign in required.")
	req.Headers["Content-Length"] = "14000001"
	autoResponseError(t, autoRequest(t, s, "app/api/assistant/chat/route.ts::POST", actor, req), 413, "The request is too large.")
	req.Headers["Content-Length"] = "-1"
	autoResponseError(t, autoRequest(t, s, "app/api/assistant/chat/route.ts::POST", actor, req), 400, "Invalid request size.")
}

type autoAttachmentReader struct {
	data  []byte
	calls int
}

func (r *autoAttachmentReader) ReadAttachment(_ context.Context, id string, size int64) ([]byte, error) {
	r.calls++
	if id != autoID || int64(len(r.data)) != size {
		return nil, errors.New("invalid read")
	}
	return r.data, nil
}
func TestAttachmentReauthorizesParentAndTenantEveryRead(t *testing.T) {
	actor := autoActor(t, autoOrg, erpwire.Member)
	reader := &autoAttachmentReader{data: []byte("hello")}
	metadata := erpwire.Row{"id": autoID, "org_id": autoOrg, "record_type": "client", "record_id": autoKey, "path": autoOrg + "/client/" + autoKey + "/" + autoID, "filename": "ไทย.txt", "size": int64(5), "content_type": "text/plain"}
	store := &autoStore{rows: map[string][]erpwire.Row{"record_attachments": {metadata}, "clients": {{"org_id": autoOrg, "id": autoKey}}}}
	s := autoService(t, store, AutomationOptions{Attachments: reader})
	req := Request{Method: "GET", Params: map[string]string{"id": autoID}}
	r := autoRequest(t, s, "app/api/attachments/[id]/route.ts::GET", actor, req)
	if r.Status != 200 || string(r.Body.([]byte)) != "hello" || r.Headers["Content-Disposition"] != "attachment; filename=\"___.txt\"; filename*=UTF-8''%E0%B9%84%E0%B8%97%E0%B8%A2.txt" || r.Headers["cache-control"] != "private, no-store, max-age=0" {
		t.Fatalf("attachment %#v", r)
	}
	delete(store.rows, "clients")
	autoResponseError(t, autoRequest(t, s, "app/api/attachments/[id]/route.ts::GET", actor, req), 404, "Attachment not found.")
	if reader.calls != 1 {
		t.Fatal("read bytes after parent became invisible")
	}
	store.rows["clients"] = []erpwire.Row{{"org_id": autoOrg, "id": autoKey}}
	metadata["org_id"] = autoOtherOrg
	autoResponseError(t, autoRequest(t, s, "app/api/attachments/[id]/route.ts::GET", actor, req), 404, "Attachment not found.")
	if reader.calls != 1 {
		t.Fatal("read cross-org bytes")
	}
}

func TestAttachmentContentAndDisposition(t *testing.T) {
	for _, tc := range []struct {
		mime string
		data []byte
		want bool
	}{{"text/plain", []byte("ไทย\nhello"), true}, {"text/plain", []byte("%PDF-x"), false}, {"text/plain", []byte("x\x00y"), false}, {"text/plain", []byte{0xff}, false}, {"text/csv", []byte("a,b\r\n1,2"), true}, {"application/pdf", []byte("%PDF-x"), true}, {"image/png", []byte("\x89PNG\r\n\x1a\n"), true}, {"image/jpeg", []byte("%PDF-x"), false}, {"text/html", []byte("a"), false}, {"text/plain", nil, false}} {
		if got := retainedAttachmentContent(tc.data, tc.mime); got != tc.want {
			t.Fatalf("content %s %q=%v", tc.mime, tc.data, got)
		}
	}
	if got := attachmentDisposition("...a+'()*@.txt"); got != "attachment; filename=\"_a______.txt\"; filename*=UTF-8''...a%2B%27%28%29%2A%40.txt" {
		t.Fatalf("disposition %q", got)
	}
}

type autoMcp struct{}

func (autoMcp) Probe(context.Context, erpwire.Actor) (McpStatus, error) {
	return McpStatus{Server: "erp", Protocol: "2025-11-25", ReadOnly: true, Tools: []McpTool{{"list_clients", strings.Repeat("a", 201)}, {"finance_summary", "private"}, {"write_sql", "forbidden"}}}, nil
}
func TestMcpProbeExcludesUnapprovedAndFinancialTools(t *testing.T) {
	s := autoService(t, &autoStore{}, AutomationOptions{Mcp: autoMcp{}})
	r := autoRequest(t, s, "app/api/assistant/mcp/route.ts::GET", autoActor(t, autoOrg, erpwire.Member), Request{Method: "GET"})
	status := r.Body.(McpStatus)
	if len(status.Tools) != 1 || status.Tools[0].Name != "list_clients" || len(status.Tools[0].Description) != 200 {
		t.Fatalf("unsafe catalog %#v", status)
	}
}

type autoSender struct {
	status int
	err    error
	calls  int
	wantID string
	t      *testing.T
}

func (s *autoSender) Send(ctx context.Context, target string, headers map[string]string, body []byte) (int, error) {
	s.calls++
	if _, ok := ctx.Deadline(); !ok {
		s.t.Fatal("send lacks timeout")
	}
	if target != "https://hooks.example.test/receive" || headers["Idempotency-Key"] != s.wantID || headers["X-Webhook-Secret"] != "outbound-secret" {
		s.t.Fatalf("wrong delivery %q %#v", target, headers)
	}
	var data erpwire.Row
	if erpwire.DecodeJSON(body, &data) != nil || data["eventId"] != s.wantID || data["orgId"] != autoOrg || data["version"] != json.Number("1") {
		s.t.Fatalf("wrong envelope %s", body)
	}
	return s.status, s.err
}

func TestOutboxLeaseDeliveryAndAcknowledgementTransitions(t *testing.T) {
	for _, tc := range []struct {
		name                                 string
		status                               int
		sendErr                              error
		ack                                  bool
		ackErr                               bool
		wantStatus, delivered, failed, unack int
		errorText                            string
	}{
		{"delivered", 204, nil, true, false, 200, 1, 0, 0, ""},
		{"http failure", 429, nil, true, false, 503, 0, 1, 0, "HTTP 429"},
		{"transport failure", 0, errors.New("network"), true, false, 503, 0, 1, 0, "Delivery failed"},
		{"expired lease", 200, nil, false, false, 503, 0, 0, 1, ""},
		{"uncertain ack", 200, nil, false, true, 503, 0, 0, 0, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &autoStore{}
			sender := &autoSender{status: tc.status, err: tc.sendErr, t: t, wantID: autoID}
			store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
				switch name {
				case "claim_outbound_events":
					if args["p_limit"] != 10 || args["p_lease_seconds"] != 120 {
						t.Fatalf("lease bounds %#v", args)
					}
					return json.RawMessage(`[{"id":"` + autoID + `","org_id":"` + autoOrg + `","event_type":"followup.due","payload":{"title":"ไทย"},"attempts":1,"lease_token":"` + autoKey + `"}]`), nil
				case "finish_outbound_event":
					if args["p_event_id"] != autoID || args["p_lease_token"] != autoKey {
						t.Fatalf("wrong ack %#v", args)
					}
					if tc.errorText == "" {
						if _, exists := args["p_error"]; exists {
							t.Fatal("success ack contains failure")
						}
					} else if args["p_error"] != tc.errorText {
						t.Fatalf("wrong retry reason %#v", args)
					}
					if tc.ackErr {
						return nil, errors.New("lost acknowledgement")
					}
					result, _ := json.Marshal(tc.ack)
					return result, nil
				}
				t.Fatal("unexpected command", name)
				return nil, nil
			}
			s := autoService(t, store, AutomationOptions{CronSecret: "cron", OutboundURL: "https://hooks.example.test/receive", OutboundSecret: "outbound-secret", Authority: autoAuthority{actors: []erpwire.Actor{autoActor(t, autoOrg, erpwire.Admin)}}, Sender: sender})
			r := autoRequest(t, s, "app/api/cron/outbox/route.ts::POST", erpwire.Actor{}, Request{Method: "POST", Headers: map[string]string{"X-Cron-Secret": "cron"}})
			if r.Status != tc.wantStatus {
				t.Fatalf("wrong delivery status %#v", r)
			}
			if !tc.ackErr {
				body := r.Body.(erpwire.Row)
				if body["attempted"] != 1 || body["delivered"] != tc.delivered || body["failed"] != tc.failed || body["unacknowledged"] != tc.unack {
					t.Fatalf("wrong outcome %#v", body)
				}
			}
			if sender.calls != 1 || len(store.calls) != 2 {
				t.Fatalf("delivery was repeated or ack lost, calls %d %#v", sender.calls, store.calls)
			}
		})
	}
}

func TestOutboxRejectsForeignClaimBeforeSending(t *testing.T) {
	store := &autoStore{command: func(string, erpwire.Row) (json.RawMessage, error) {
		return json.RawMessage(`[{"id":"` + autoID + `","org_id":"` + autoOtherOrg + `","event_type":"followup.due","payload":{},"attempts":1,"lease_token":"` + autoKey + `"}]`), nil
	}}
	sender := &autoSender{t: t, wantID: autoID}
	s := autoService(t, store, AutomationOptions{CronSecret: "cron", OutboundURL: "https://hooks.example.test/receive", OutboundSecret: "outbound-secret", Authority: autoAuthority{actors: []erpwire.Actor{autoActor(t, autoOrg, erpwire.Admin)}}, Sender: sender})
	autoResponseError(t, autoRequest(t, s, "app/api/cron/outbox/route.ts::POST", erpwire.Actor{}, Request{Method: "POST", Headers: map[string]string{"X-Cron-Secret": "cron"}}), 503, "Outbox delivery failed")
	if sender.calls != 0 {
		t.Fatal("foreign event sent")
	}
}

type autoBusinessError string

func (e autoBusinessError) Error() string           { return string(e) }
func (e autoBusinessError) BusinessMessage() string { return string(e) }
func TestReplenishmentCronDryRunAndDeduplicatedVendorCommands(t *testing.T) {
	for _, method := range []string{"GET", "POST"} {
		t.Run(method, func(t *testing.T) {
			store := &autoStore{rows: map[string][]erpwire.Row{"org_settings": {{"org_id": autoOrg, "id": autoOrg, "scheduled_replenishment_enabled": true}}}}
			commands := 0
			store.command = func(name string, args erpwire.Row) (json.RawMessage, error) {
				if name == "replenishment_plan" {
					return json.RawMessage(`[{"product_id":"` + autoID + `","vendor_id":"` + autoKey + `"},{"product_id":"` + autoKey + `","vendor_id":"` + autoKey + `"}]`), nil
				}
				if name != "create_replenishment_rfq" || args["p_vendor_id"] != autoKey || args["p_org_id"] != autoOrg {
					t.Fatalf("wrong RFQ %#v", args)
				}
				commands++
				return nil, autoBusinessError("No products require replenishment")
			}
			s := autoService(t, store, AutomationOptions{CronSecret: "cron", Authority: autoAuthority{actors: []erpwire.Actor{autoActor(t, autoOrg, erpwire.Owner)}}})
			r := autoRequest(t, s, "app/api/cron/replenishment/route.ts::"+method, erpwire.Actor{}, Request{Method: method, URL: "https://erp.example.test/api/cron/replenishment?dry_run=false", Headers: map[string]string{"X-Cron-Secret": "cron"}})
			body := r.Body.(erpwire.Row)
			if r.Status != 200 || body["dryRun"] != (method == "GET") {
				t.Fatalf("dry-run %#v", r)
			}
			if method == "GET" {
				if commands != 0 || len(body["preview"].([]erpwire.Row)) != 1 {
					t.Fatalf("dry run wrote or omitted plan %#v", r)
				}
			} else if commands != 1 || body["skipped"] != 1 || body["processed"] != 0 {
				t.Fatalf("wrong deduplication %#v, commands %d", r, commands)
			}
		})
	}
}
