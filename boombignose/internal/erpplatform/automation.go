package erpplatform

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpbilling"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/localai"
	"github.com/google/uuid"
)

// AutomationAuthority resolves live least-privilege identities, never roles from
// request JSON. The scheduler list must contain every configured workspace once.
type AutomationAuthority interface {
	SchedulerActors(context.Context) ([]erpwire.Actor, error)
	WebhookActor(context.Context, string) (erpwire.Actor, error)
}

type AssistantChat interface {
	Chat(context.Context, erpwire.Actor, erpwire.ChatRequest) (erpwire.ChatReply, error)
}

type RasterValidator interface {
	ValidateRaster(context.Context, []byte, string) error
}

type McpProbe interface {
	Probe(context.Context, erpwire.Actor) (McpStatus, error)
}

type McpStatus struct {
	Server   string    `json:"server"`
	Protocol string    `json:"protocol"`
	ReadOnly bool      `json:"readOnly"`
	Tools    []McpTool `json:"tools"`
}
type McpTool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// AttachmentReader reads immutable, flat UUID objects. Implementations must
// reject symlinks/unsafe ancestors, changed inode/size/mtime, extra bytes, writable
// or multiply linked files and non-owner access, as native-attachments.ts does.
type AttachmentReader interface {
	ReadAttachment(context.Context, string, int64) ([]byte, error)
}

// OutboundSender must POST with redirects disabled and return only the HTTP
// status. The supplied context is bounded to thirty seconds per attempt.
type OutboundSender interface {
	Send(context.Context, string, map[string]string, []byte) (int, error)
}

type AutomationOptions struct {
	CronSecret     string
	WebhookSecret  string
	OutboundURL    string
	OutboundSecret string
	Authority      AutomationAuthority
	Sender         OutboundSender
	Chat           AssistantChat
	Raster         RasterValidator
	Mcp            McpProbe
	Attachments    AttachmentReader
}

func (s *Service) automationOperations() map[string]erpwire.Operation {
	ops := map[string]erpwire.Operation{
		"app/api/assistant/chat/route.ts::POST":  s.assistantChat,
		"app/api/assistant/mcp/route.ts::GET":    s.assistantMcp,
		"app/api/attachments/[id]/route.ts::GET": s.attachment,
		"app/api/cron/outbox/route.ts::POST":     s.outbox,
	}
	for _, kind := range []string{"followups", "subscriptions", "replenishment"} {
		for _, method := range []string{"GET", "POST"} {
			ops["app/api/cron/"+kind+"/route.ts::"+method] = s.cronOperation(kind, method)
		}
	}
	for _, event := range []string{"followup", "invoice-overdue", "project-deadline"} {
		ops["app/api/webhooks/n8n/"+event+"/route.ts::POST"] = s.webhook(event)
		ops["app/api/webhooks/n8n/"+event+"/route.ts::GET"] = func(_ context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
			if _, err := arguments(raw, 0, 1); err != nil {
				return nil, err
			}
			return jsonResponse(200, erpwire.Row{"status": "ok", "endpoint": event}), nil
		}
	}
	return ops
}

func secretMatches(provided, expected string) bool {
	return provided != "" && expected != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func automationJSON(status int, message string) Response {
	return jsonResponse(status, erpwire.Row{"error": message})
}
func privateResponse(status int, body any) Response {
	r := jsonResponse(status, body)
	if r.Headers == nil {
		r.Headers = map[string]string{}
	}
	r.Headers["cache-control"] = "private, no-store"
	return r
}

func (s *Service) webhook(event string) erpwire.Operation {
	return func(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
		req, err := apiRequest(raw)
		if err != nil {
			return nil, err
		}
		if !secretMatches(header(req, "X-Webhook-Secret"), s.automation.WebhookSecret) {
			return automationJSON(401, "unauthorized"), nil
		}
		key := header(req, "Idempotency-Key")
		if !automationUUID(key, true) {
			return automationJSON(400, "invalid idempotency key"), nil
		}
		if len(req.Body) > 16384 {
			return automationJSON(413, "payload too large"), nil
		}
		var body map[string]json.RawMessage
		if !utf8.Valid(req.Body) || erpwire.DecodeJSON(req.Body, &body) != nil || len(body) != 2 {
			return automationJSON(400, "invalid payload"), nil
		}
		var org string
		var payload map[string]any
		if erpwire.DecodeJSON(body["orgId"], &org) != nil || !automationUUID(org, false) || erpwire.DecodeJSON(body["payload"], &payload) != nil || payload == nil {
			return automationJSON(400, "invalid payload"), nil
		}
		if s.automation.Authority == nil {
			return automationJSON(503, "event receipt failed"), nil
		}
		actor, err := s.automation.Authority.WebhookActor(ctx, org)
		if err != nil || actor.OrgID() != org || actor.Authorize("settings:manage", s.now()) != nil {
			return automationJSON(503, "event receipt failed"), nil
		}
		var receipt struct {
			EventID   string `json:"eventId"`
			Duplicate *bool  `json:"duplicate"`
		}
		err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
			result, e := tx.Command(ctx, "accept_integration_event", erpwire.Row{"p_org_id": actor.OrgID(), "p_event_type": event, "p_key": key, "p_payload": payload})
			if e != nil {
				return e
			}
			if erpwire.DecodeJSON(result, &receipt) != nil || !automationUUID(receipt.EventID, false) || receipt.Duplicate == nil {
				return errors.New("invalid receipt result")
			}
			return nil
		})
		if err != nil {
			var state interface{ SQLState() string }
			if (errors.As(err, &state) && state.SQLState() == "23505") || strings.Contains(strings.ToLower(err.Error()), "conflict") {
				return automationJSON(409, "idempotency conflict"), nil
			}
			return automationJSON(503, "event receipt failed"), nil
		}
		return jsonResponse(200, erpwire.Row{"ok": true, "event": event, "eventId": receipt.EventID, "duplicate": *receipt.Duplicate}), nil
	}
}

func automationUUID(value string, versioned bool) bool {
	if len(value) != 36 || uuid.Validate(value) != nil {
		return false
	}
	if !versioned {
		return true
	}
	id, err := uuid.Parse(value)
	return err == nil && ((id.Variant() == uuid.RFC4122 && id.Version() >= 1 && id.Version() <= 8) || id == uuid.Nil || id == uuid.Max)
}

type reminderSpec struct {
	Entity   string `json:"entity"`
	EntityID string `json:"entityId"`
	Title    string `json:"title"`
	DueDate  string `json:"dueDate"`
}

func dueFollowUps(deals, activities []erpwire.Row, today string) []reminderSpec {
	out := []reminderSpec{}
	for _, row := range deals {
		due := text(row["next_follow_up_date"])
		stage := text(row["stage"])
		if due != "" && due <= today && stage != "won" && stage != "lost" {
			out = append(out, reminderSpec{"deal", text(row["id"]), text(row["title"]), due})
		}
	}
	labels := map[string]string{"note": "Follow up on note", "call": "Follow up: call", "email": "Follow up: email", "meeting": "Follow up: meeting", "follow_up": "Follow-up due"}
	for _, row := range activities {
		due := text(row["due_date"])
		done, _ := row["done"].(bool)
		if done || due == "" || due > today {
			continue
		}
		title := strings.TrimSpace(text(row["body"]))
		if title == "" {
			title = labels[text(row["type"])]
			if title == "" {
				title = "Follow-up due"
			}
		}
		out = append(out, reminderSpec{"activity", text(row["id"]), title, due})
	}
	return out
}

func automationQuery(a erpwire.Actor, table string, columns []string, where ...erpwire.Predicate) erpwire.Select {
	return erpwire.Select{Table: table, Columns: columns, Where: append([]erpwire.Predicate{eq("org_id", a.OrgID())}, where...), Order: []erpwire.Order{{Column: "id"}}, Limit: 1000}
}
func (s *Service) schedulerActors(ctx context.Context) ([]erpwire.Actor, error) {
	if s.automation.Authority == nil {
		return nil, errors.New("Scheduler authority unavailable")
	}
	actors, err := s.automation.Authority.SchedulerActors(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, a := range actors {
		if err := a.Authorize("settings:manage", s.now()); err != nil {
			return nil, err
		}
		if seen[a.OrgID()] {
			return nil, errors.New("Duplicate scheduler workspace")
		}
		seen[a.OrgID()] = true
	}
	return actors, nil
}
func (s *Service) cronOperation(kind, method string) erpwire.Operation {
	return func(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
		req, err := apiRequest(raw)
		if err != nil {
			return nil, err
		}
		req.Method = method
		if !secretMatches(header(req, "X-Cron-Secret"), s.automation.CronSecret) {
			return automationJSON(401, "unauthorized"), nil
		}
		actors, err := s.schedulerActors(ctx)
		if err != nil {
			message := map[string]string{"followups": "scan failed", "subscriptions": "Subscription scan failed", "replenishment": "Replenishment scan failed"}[kind]
			return automationJSON(500, message), nil
		}
		switch kind {
		case "followups":
			return s.scanFollowups(ctx, actors)
		case "subscriptions":
			return s.scanSubscriptions(ctx, actors)
		default:
			return s.scanReplenishment(ctx, actors, req)
		}
	}
}

func (s *Service) scanFollowups(ctx context.Context, actors []erpwire.Actor) (any, error) {
	orgs, reminders, events := int64(0), int64(0), int64(0)
	today := s.now().In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01-02")
	for _, actor := range actors {
		var deals, activities []erpwire.Row
		err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
			var e error
			deals, e = all(ctx, tx, automationQuery(actor, "deals", []string{"id", "title", "next_follow_up_date", "stage"}, erpwire.Predicate{Column: "next_follow_up_date", Op: erpwire.LessEqual, Value: today}))
			if e != nil {
				return e
			}
			activities, e = all(ctx, tx, automationQuery(actor, "activities", []string{"id", "body", "due_date", "done", "type"}, eq("done", false), erpwire.Predicate{Column: "due_date", Op: erpwire.LessEqual, Value: today}))
			return e
		})
		if err != nil {
			return automationJSON(500, "scan failed"), nil
		}
		specs := dueFollowUps(deals, activities, today)
		if len(specs) == 0 {
			continue
		}
		var result struct {
			Reminders json.Number `json:"remindersUpserted"`
			Events    json.Number `json:"eventsQueued"`
		}
		err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
			raw, e := tx.Command(ctx, "enqueue_reminders", erpwire.Row{"p_org_id": actor.OrgID(), "p_specs": specs})
			if e != nil {
				return e
			}
			if erpwire.DecodeJSON(raw, &result) != nil {
				return errors.New("Invalid reminder command result")
			}
			return nil
		})
		if err != nil {
			return automationJSON(500, "dispatchReminders: "+automationSafeError(err, "scan failed")), nil
		}
		r, e1 := result.Reminders.Int64()
		e, e2 := result.Events.Int64()
		if e1 != nil || e2 != nil || r < 0 || e < 0 || r > erpwire.MaxSafeInteger-reminders || e > erpwire.MaxSafeInteger-events {
			return automationJSON(500, "Invalid reminder command result"), nil
		}
		orgs++
		reminders += r
		events += e
	}
	return jsonResponse(200, erpwire.Row{"ok": true, "orgsScanned": orgs, "remindersUpserted": reminders, "eventsQueued": events}), nil
}

func automationSafeError(err error, fallback string) string {
	var business interface{ BusinessMessage() string }
	if errors.As(err, &business) && business.BusinessMessage() != "" {
		return business.BusinessMessage()
	}
	return fallback
}

func (s *Service) scanSubscriptions(ctx context.Context, actors []erpwire.Actor) (any, error) {
	processed, failed := 0, 0
	today := s.now().In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01-02")
	billing, _ := erpbilling.New(erpbilling.Options{Store: s.store})
	for _, actor := range actors {
		var rows []erpwire.Row
		err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
			var e error
			rows, e = all(ctx, tx, automationQuery(actor, "subscriptions", []string{"id", "next_run_date"}, eq("status", "active"), eq("auto_generate", true), erpwire.Predicate{Column: "next_run_date", Op: erpwire.LessEqual, Value: today}))
			return e
		})
		if err != nil {
			return automationJSON(500, "Subscription scan failed"), nil
		}
		for _, row := range rows {
			id, date := text(row["id"]), text(row["next_run_date"])
			err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
				_, e := billing.GenerateOccurrenceInTx(ctx, tx, actor.OrgID(), id, date)
				return e
			})
			if err == nil {
				processed++
				continue
			}
			failed++
			reason := automationSafeError(err, "Invoice generation failed")
			_ = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
				_, e := tx.Insert(ctx, erpwire.Insert{Table: "audit_log", Rows: []erpwire.Row{{"org_id": actor.OrgID(), "entity": "subscription", "entity_id": id, "action": "generation_failed", "summary": "Scheduled invoice failed: " + reason, "meta": erpwire.Row{"occurrence": date, "reason": reason}}}})
				return e
			})
		}
	}
	status := 200
	if failed > 0 {
		status = 503
	}
	return jsonResponse(status, erpwire.Row{"ok": failed == 0, "processed": processed, "failed": failed}), nil
}

func (s *Service) scanReplenishment(ctx context.Context, actors []erpwire.Actor, req Request) (any, error) {
	u, _ := url.Parse(req.URL)
	dry := req.Method == "GET" || u == nil || u.Query().Get("dry_run") != "false"
	processed, skipped, failed := 0, 0, 0
	preview := []erpwire.Row{}
	today := s.now().In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("2006-01-02")
	for _, actor := range actors {
		var enabled bool
		var plan []erpwire.Row
		err := s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
			row, e := one(ctx, tx, automationQuery(actor, "org_settings", []string{"org_id"}, eq("scheduled_replenishment_enabled", true)))
			if e != nil {
				return e
			}
			enabled = row != nil
			if !enabled {
				return nil
			}
			raw, e := tx.ReadRPC(ctx, "replenishment_plan", erpwire.Row{"p_org_id": actor.OrgID(), "p_date": today})
			if e != nil {
				return e
			}
			return erpwire.DecodeJSON(raw, &plan)
		})
		if err != nil {
			failed++
			continue
		}
		if !enabled {
			continue
		}
		if plan == nil {
			plan = []erpwire.Row{}
		}
		for _, row := range plan {
			row["id"] = row["product_id"]
		}
		if dry {
			preview = append(preview, erpwire.Row{"orgId": actor.OrgID(), "lines": plan})
			continue
		}
		vendors := map[string]bool{}
		for _, row := range plan {
			vendor := text(row["vendor_id"])
			if vendors[vendor] {
				continue
			}
			vendors[vendor] = true
			err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
				_, e := tx.Command(ctx, "create_replenishment_rfq", erpwire.Row{"p_org_id": actor.OrgID(), "p_vendor_id": vendor})
				return e
			})
			if err == nil {
				processed++
			} else if automationSafeError(err, "") == "No products require replenishment" {
				skipped++
			} else {
				failed++
			}
		}
	}
	status := 200
	if failed > 0 {
		status = 503
	}
	body := erpwire.Row{"ok": failed == 0, "dryRun": dry, "processed": processed, "skipped": skipped, "failed": failed}
	if dry {
		body["preview"] = preview
	}
	return jsonResponse(status, body), nil
}

type outboundClaim struct {
	ID       string          `json:"id"`
	OrgID    string          `json:"org_id"`
	Type     string          `json:"event_type"`
	Payload  json.RawMessage `json:"payload"`
	Attempts int             `json:"attempts"`
	Lease    string          `json:"lease_token"`
}

func (s *Service) outbox(ctx context.Context, _ erpwire.Actor, raw json.RawMessage) (any, error) {
	req, err := apiRequest(raw)
	if err != nil {
		return nil, err
	}
	if !secretMatches(header(req, "X-Cron-Secret"), s.automation.CronSecret) {
		return automationJSON(401, "unauthorized"), nil
	}
	if s.automation.OutboundURL == "" || s.automation.OutboundSecret == "" {
		return jsonResponse(200, erpwire.Row{"ok": true, "disabled": true}), nil
	}
	target, err := url.Parse(s.automation.OutboundURL)
	if err != nil || target.Host == "" || target.User != nil || (target.Scheme != "https" && !(target.Scheme == "http" && (target.Hostname() == "127.0.0.1" || target.Hostname() == "localhost" || target.Hostname() == "::1"))) {
		return automationJSON(503, "Outbox delivery failed"), nil
	}
	actors, err := s.schedulerActors(ctx)
	if err != nil || s.automation.Sender == nil {
		return automationJSON(503, "Outbox delivery failed"), nil
	}
	attempted, delivered, failed, unacknowledged := 0, 0, 0, 0
	for _, actor := range actors {
		if attempted >= 10 {
			break
		}
		var claims []outboundClaim
		err = s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
			result, e := tx.Command(ctx, "claim_outbound_events", erpwire.Row{"p_limit": 10 - attempted, "p_lease_seconds": 120})
			if e != nil {
				return e
			}
			if erpwire.DecodeJSON(result, &claims) != nil || len(claims) > 10-attempted {
				return errors.New("Invalid outbox claim result")
			}
			for _, c := range claims {
				if !automationUUID(c.ID, false) || c.OrgID != actor.OrgID() || !automationUUID(c.Lease, true) || c.Attempts < 1 || c.Type == "" || len(c.Payload) == 0 || !json.Valid(c.Payload) {
					return errors.New("Invalid outbox claim result")
				}
			}
			return nil
		})
		if err != nil {
			return automationJSON(503, "Outbox delivery failed"), nil
		}
		results := make([]int, len(claims))
		var pending sync.WaitGroup
		for i, claim := range claims {
			pending.Add(1)
			go func() {
				defer pending.Done()
				results[i] = 3
				if actor.Authorize("settings:manage", s.now()) != nil {
					return
				}
				body, e := json.Marshal(erpwire.Row{"version": 1, "eventId": claim.ID, "orgId": claim.OrgID, "type": claim.Type, "payload": claim.Payload})
				if e != nil {
					return
				}
				sendCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				status, sendErr := s.automation.Sender.Send(sendCtx, target.String(), map[string]string{"Content-Type": "application/json", "X-Webhook-Secret": s.automation.OutboundSecret, "Idempotency-Key": claim.ID}, body)
				cancel()
				failure := ""
				if sendErr != nil {
					failure = "Delivery failed"
				} else if status < 200 || status > 299 {
					failure = "HTTP " + strconv.Itoa(status)
				}
				ack := false
				err := s.store.Write(ctx, actor, func(tx erpwire.WriteTx) error {
					args := erpwire.Row{"p_event_id": claim.ID, "p_lease_token": claim.Lease}
					if failure != "" {
						args["p_error"] = failure
					}
					result, e := tx.Command(ctx, "finish_outbound_event", args)
					if e != nil {
						return e
					}
					return erpwire.DecodeJSON(result, &ack)
				})
				if err != nil {
					return
				}
				if !ack {
					results[i] = 2
				} else if failure != "" {
					results[i] = 1
				} else {
					results[i] = 0
				}
			}()
		}
		pending.Wait()
		attempted += len(claims)
		for _, result := range results {
			switch result {
			case 0:
				delivered++
			case 1:
				failed++
			case 2:
				unacknowledged++
			default:
				return automationJSON(503, "Outbox delivery failed"), nil
			}
		}
	}
	status := 200
	if failed > 0 || unacknowledged > 0 {
		status = 503
	}
	return jsonResponse(status, erpwire.Row{"ok": status == 200, "disabled": false, "attempted": attempted, "delivered": delivered, "failed": failed, "unacknowledged": unacknowledged}), nil
}

func (s *Service) assistantChat(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	req, err := apiRequest(raw)
	if err != nil {
		return nil, err
	}
	if deny := s.apiAccess(a, req, "", true); deny != nil {
		return *deny, nil
	}
	if declared := header(req, "Content-Length"); declared != "" {
		n, e := strconv.ParseInt(strings.TrimSpace(declared), 10, 64)
		if e != nil || n < 0 || n > erpwire.MaxSafeInteger {
			return automationJSON(400, "Invalid request size."), nil
		}
		if n > 14000000 {
			return automationJSON(413, "The request is too large."), nil
		}
	}
	if len(req.Body) == 0 {
		return automationJSON(400, "Send a JSON request body."), nil
	}
	if len(req.Body) > 14000000 {
		return automationJSON(413, "The request is too large."), nil
	}
	if !utf8.Valid(req.Body) {
		return automationJSON(400, "The request is not valid UTF-8 JSON."), nil
	}
	request, message := parseAutomationChat(req.Body)
	if message != "" {
		return automationJSON(400, message), nil
	}
	for _, attachment := range request.Messages[len(request.Messages)-1].Attachments {
		if attachment.Kind != "image" {
			continue
		}
		data, _ := base64.RawStdEncoding.DecodeString(strings.TrimRight(attachment.Base64, "="))
		if s.automation.Raster == nil {
			return automationJSON(503, "Native image validation is unavailable or busy. Install the complete native runtime (including boombignose/bin/boombignose-image), or build it with pnpm build:raster, then retry. No image was sent for inference."), nil
		}
		if err = s.automation.Raster.ValidateRaster(ctx, data, attachment.MediaType); err != nil {
			return automationModelError(err, 400, "Invalid image."), nil
		}
	}
	if s.automation.Chat == nil {
		return automationJSON(503, "Authorized ERP data tools are unavailable. No ungrounded fallback was used."), nil
	}
	reply, err := s.automation.Chat.Chat(ctx, a, request)
	if err != nil {
		return automationModelError(err, 502, "The local model service could not complete the request. No cloud fallback was used."), nil
	}
	return privateResponse(200, reply), nil
}

func automationModelError(err error, status int, fallback string) Response {
	var problem *localai.Error
	if errors.As(err, &problem) {
		return automationJSON(problem.Status, problem.Message)
	}
	return automationJSON(status, fallback)
}

var chatBase64 = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)

func automationSafeName(value string) string {
	if at := strings.LastIndexAny(value, "/\\"); at >= 0 {
		value = value[at+1:]
	}
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, value)
	value = strings.TrimSpace(value)
	units := utf16.Encode([]rune(value))
	if len(units) > 120 {
		value = string(utf16.Decode(units[:120]))
	}
	if value == "" {
		return "file"
	}
	return value
}
func automationImageMIME(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(data, []byte{255, 216, 255}):
		return "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}
func parseAutomationChat(data []byte) (erpwire.ChatRequest, string) {
	var body map[string]json.RawMessage
	if erpwire.DecodeJSON(data, &body) != nil {
		return erpwire.ChatRequest{}, "The request is not valid UTF-8 JSON."
	}
	request := erpwire.ChatRequest{DataScope: erpwire.ERPDataScope}
	if scope, ok := body["dataScope"]; ok && !bytes.Equal(bytes.TrimSpace(scope), []byte("null")) {
		if json.Unmarshal(scope, &request.DataScope) != nil || request.DataScope != "erp" && request.DataScope != "guidance" {
			return request, "Choose ERP records or guidance/document review."
		}
	}
	var list []json.RawMessage
	if erpwire.DecodeJSON(body["messages"], &list) != nil || len(list) < 1 || len(list) > 40 {
		return request, "Send between 1 and 40 messages."
	}
	for _, raw := range list {
		var message map[string]json.RawMessage
		if erpwire.DecodeJSON(raw, &message) != nil || message == nil {
			return request, "Bad message."
		}
		var m erpwire.ChatMessage
		if !automationJSONString(message["role"], &m.Role) || !automationJSONString(message["content"], &m.Content) || m.Role != "user" && m.Role != "assistant" {
			return request, "Bad message."
		}
		maxChars := 8000
		if m.Role == "assistant" {
			maxChars = 64000
		}
		if len(utf16.Encode([]rune(m.Content))) > maxChars {
			return request, "Bad message."
		}
		var atts []json.RawMessage
		if rawAtt, ok := message["attachments"]; ok {
			if bytes.Equal(bytes.TrimSpace(rawAtt), []byte("null")) || erpwire.DecodeJSON(rawAtt, &atts) != nil {
				return request, "Too many attachments, or attachments on a reply."
			}
		}
		if len(atts) > 4 || len(atts) > 0 && m.Role != "user" {
			return request, "Too many attachments, or attachments on a reply."
		}
		for _, rawAtt := range atts {
			var att erpwire.ChatAttachment
			var fields map[string]json.RawMessage
			if erpwire.DecodeJSON(rawAtt, &fields) != nil || fields == nil || !automationJSONString(fields["name"], &att.Name) || !automationJSONString(fields["kind"], &att.Kind) {
				return request, "An attachment is not an accepted image, PDF or text file."
			}
			att.Name = automationSafeName(att.Name)
			switch att.Kind {
			case "image":
				if !automationJSONString(fields["base64"], &att.Base64) {
					return request, "An attachment is not an accepted image, PDF or text file."
				}
				att.Base64 = strings.Map(func(r rune) rune {
					if unicode.IsSpace(r) {
						return -1
					}
					return r
				}, att.Base64)
				if len(att.Base64) < 16 || len(att.Base64) > 2800000 || !chatBase64.MatchString(att.Base64) {
					return request, "An attachment is not an accepted image, PDF or text file."
				}
				decoded, e := base64.RawStdEncoding.DecodeString(strings.TrimRight(att.Base64, "="))
				if e != nil {
					return request, "An attachment is not an accepted image, PDF or text file."
				}
				att.MediaType = automationImageMIME(decoded)
				if att.MediaType == "" {
					return request, "An attachment is not an accepted image, PDF or text file."
				}
			case "text":
				if !automationJSONString(fields["text"], &att.Text) || len(att.Text) > 200000 || strings.ContainsRune(att.Text, 0) {
					return request, "An attachment is not an accepted image, PDF or text file."
				}
			default:
				return request, "An attachment is not an accepted image, PDF or text file."
			}
			m.Attachments = append(m.Attachments, att)
		}
		if strings.TrimSpace(m.Content) == "" && len(m.Attachments) == 0 {
			return request, "A message needs text or an attachment."
		}
		request.Messages = append(request.Messages, m)
	}
	if request.Messages[len(request.Messages)-1].Role != "user" {
		return request, "The last message must be from you."
	}
	return request, ""
}

func automationJSONString(raw json.RawMessage, destination *string) bool {
	raw = bytes.TrimSpace(raw)
	return len(raw) > 0 && raw[0] == '"' && json.Unmarshal(raw, destination) == nil
}

func (s *Service) assistantMcp(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	req, err := apiRequest(raw)
	if err != nil {
		return nil, err
	}
	if deny := s.apiAccess(a, req, "", false); deny != nil {
		return *deny, nil
	}
	if s.automation.Mcp == nil {
		return automationJSON(502, "The ERP MCP server did not answer."), nil
	}
	status, err := s.automation.Mcp.Probe(ctx, a)
	if err != nil || !status.ReadOnly {
		return automationJSON(502, "The ERP MCP server did not answer."), nil
	}
	if status.Server == "" {
		status.Server = "boombignose-erp"
	}
	tools := []McpTool{}
	allowed := map[string]bool{"list_clients": true, "list_deals": true, "list_quotes": true, "list_projects": true, "list_invoices": true, "list_payment_claims": true, "erp_data_catalog": true, "erp_data_read": true, "erp_data_text": true, "finance_summary": erpwire.Can(a.Role(), "profit:view")}
	for _, tool := range status.Tools {
		if !allowed[tool.Name] {
			continue
		}
		units := utf16.Encode([]rune(tool.Description))
		if len(units) > 200 {
			tool.Description = string(utf16.Decode(units[:200]))
		}
		tools = append(tools, tool)
	}
	status.Tools = tools
	return privateResponse(200, status), nil
}

var attachmentTables = map[string]string{"client": "clients", "deal": "deals", "quote": "quotes", "invoice": "invoices", "project": "projects", "subscription": "subscriptions", "vendor": "vendors", "purchase_order": "purchase_orders", "expense_claim": "expense_claims"}

func retainedAttachmentContent(data []byte, mime string) bool {
	if len(data) < 1 || len(data) > 10*1024*1024 {
		return false
	}
	switch mime {
	case "application/pdf":
		return bytes.HasPrefix(data, []byte("%PDF-"))
	case "image/jpeg", "image/png", "image/webp":
		return automationImageMIME(data) == mime
	case "text/plain", "text/csv":
		if !utf8.Valid(data) {
			return false
		}
		text := string(bytes.TrimPrefix(data, []byte{239, 187, 191}))
		if strings.HasPrefix(text, "%PDF-") || len(text) >= 12 && text[:4] == "RIFF" && text[8:12] == "WEBP" {
			return false
		}
		for _, r := range text {
			if r < 9 || r == 11 || r == 12 || r >= 14 && r < 32 || r == 127 {
				return false
			}
		}
		return true
	}
	return false
}
func attachmentFilename(value string) bool {
	if strings.TrimSpace(value) == "" || len(utf16.Encode([]rune(strings.TrimSpace(value)))) > 255 {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 || r == '/' || r == '\\' {
			return false
		}
	}
	return true
}
func attachmentDisposition(value string) string {
	fallback := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune(" ._-", r) {
			return r
		}
		return '_'
	}, value)
	if strings.HasPrefix(fallback, ".") {
		fallback = "_" + strings.TrimLeft(fallback, ".")
	}
	if fallback == "" {
		fallback = "attachment"
	}
	encoded := url.PathEscape(value)
	for _, pair := range [][2]string{{"+", "%2B"}, {"'", "%27"}, {"(", "%28"}, {")", "%29"}, {"*", "%2A"}, {":", "%3A"}, {"@", "%40"}, {"$", "%24"}, {"&", "%26"}, {"=", "%3D"}} {
		encoded = strings.ReplaceAll(encoded, pair[0], pair[1])
	}
	return "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded
}
func attachmentHeaders(r Response) Response {
	if r.Headers == nil {
		r.Headers = map[string]string{}
	}
	for k, v := range map[string]string{"cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer", "vary": "Cookie"} {
		r.Headers[k] = v
	}
	return r
}
func (s *Service) attachment(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	req, err := apiRequest(raw)
	if err != nil {
		return nil, err
	}
	notFound := func() (any, error) { return attachmentHeaders(automationJSON(404, "Attachment not found.")), nil }
	if s.automation.Attachments == nil {
		return notFound()
	}
	if deny := s.apiAccess(a, req, "", false); deny != nil {
		return attachmentHeaders(*deny), nil
	}
	id := req.Params["id"]
	if !automationUUID(id, false) {
		return notFound()
	}
	var metadata erpwire.Row
	var size int64
	err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var e error
		metadata, e = one(ctx, tx, automationQuery(a, "record_attachments", []string{"id", "org_id", "record_type", "record_id", "path", "filename", "size", "content_type"}, eq("id", id)))
		if e != nil || metadata == nil {
			return errors.New("attachment unavailable")
		}
		table, ok := attachmentTables[text(metadata["record_type"])]
		if !ok || !automationUUID(text(metadata["record_id"]), false) || !attachmentFilename(text(metadata["filename"])) || text(metadata["org_id"]) != a.OrgID() || text(metadata["id"]) != id {
			return errors.New("invalid attachment metadata")
		}
		switch n := metadata["size"].(type) {
		case int:
			size = int64(n)
		case int64:
			size = n
		case json.Number:
			size, e = n.Int64()
		default:
			e = errors.New("invalid attachment size")
		}
		if e != nil || size < 1 || size > 10*1024*1024 {
			return errors.New("invalid attachment size")
		}
		mime := text(metadata["content_type"])
		if mime != "application/pdf" && mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" && mime != "text/plain" && mime != "text/csv" {
			return errors.New("invalid attachment MIME")
		}
		expected := a.OrgID() + "/" + text(metadata["record_type"]) + "/" + text(metadata["record_id"]) + "/" + id
		if text(metadata["path"]) != expected {
			return errors.New("invalid attachment path")
		}
		parent, e := one(ctx, tx, automationQuery(a, table, []string{"id"}, eq("id", metadata["record_id"])))
		if e != nil || parent == nil {
			return errors.New("attachment parent unavailable")
		}
		return nil
	})
	if err != nil {
		return notFound()
	}
	data, err := s.automation.Attachments.ReadAttachment(ctx, id, size)
	if err != nil || int64(len(data)) != size || !retainedAttachmentContent(data, text(metadata["content_type"])) {
		return notFound()
	}
	r := attachmentHeaders(Response{Status: 200, Body: data})
	r.Headers["Content-Type"] = text(metadata["content_type"])
	r.Headers["Content-Length"] = strconv.Itoa(len(data))
	r.Headers["Content-Disposition"] = attachmentDisposition(text(metadata["filename"]))
	return r, nil
}
