package erpplatform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/localai"
)

type batchSender struct {
	started atomic.Int32
	ready   chan struct{}
}

func (s *batchSender) Send(ctx context.Context, _ string, _ map[string]string, _ []byte) (int, error) {
	if s.started.Add(1) == 10 {
		close(s.ready)
	}
	select {
	case <-s.ready:
		return 204, nil
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}
func TestOutboxStartsWholeBatchAndAwaitsAllAcknowledgements(t *testing.T) {
	claims := []outboundClaim{}
	for i := 0; i < 10; i++ {
		claims = append(claims, outboundClaim{ID: fmt.Sprintf("44444444-4444-4444-8444-%012d", i), OrgID: autoOrg, Type: "followup", Payload: json.RawMessage(`{}`), Attempts: 1, Lease: autoKey})
	}
	acks := 0
	db := &autoStore{command: func(name string, args erpwire.Row) (json.RawMessage, error) {
		if name == "claim_outbound_events" {
			return json.Marshal(claims)
		}
		acks++
		if text(args["p_event_id"]) == claims[0].ID {
			return nil, errors.New("lost acknowledgement")
		}
		return json.RawMessage(`true`), nil
	}}
	sender := &batchSender{ready: make(chan struct{})}
	s := autoService(t, db, AutomationOptions{CronSecret: "cron", OutboundURL: "https://hooks.example.test", OutboundSecret: "outbound-secret", Authority: autoAuthority{actors: []erpwire.Actor{autoActor(t, autoOrg, erpwire.Admin)}}, Sender: sender})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, e := s.outbox(ctx, erpwire.Actor{}, securityRequest(Request{Method: "POST", Headers: map[string]string{"X-Cron-Secret": "cron"}}))
	if e != nil {
		t.Fatal(e)
	}
	if ctx.Err() != nil || sender.started.Load() != 10 || acks != 10 || result.(Response).Status != 503 {
		t.Fatalf("batch not concurrent or settled: sends=%d acks=%d result=%#v ctx=%v", sender.started.Load(), acks, result, ctx.Err())
	}
}

type deadlineModels struct {
	nativeModelFake
	t *testing.T
}
type errorOCR struct{ err error }

func (o errorOCR) RecognizePage(context.Context, []byte, localai.PageMetadata) (localai.OCRPage, error) {
	return localai.OCRPage{}, o.err
}

func (m *deadlineModels) List(ctx context.Context) ([]InstalledModel, error) {
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) > 3*time.Second || time.Until(deadline) <= 0 {
		m.t.Fatal("model snapshot lacks 3 second bound")
	}
	return nil, errors.New("unavailable")
}
func TestModelSnapshotDeadlineAndOCRErrorCodes(t *testing.T) {
	s := nativeService()
	s.native.Models = &deadlineModels{t: t}
	out := s.nativeModelSnapshot(context.Background())
	if out["daemonUp"] != false {
		t.Fatal("failed snapshot reported ready")
	}
	for _, tc := range []struct {
		e      error
		code   string
		status int
	}{{errors.New("private diagnostic"), "ocr_failed", 500}, {&NativeError{Status: 422, Code: "invalid_result", Message: "Manual review required"}, "invalid_result", 422}, {&localai.Error{Status: 503, Code: "unavailable", Message: "Model unavailable"}, "unavailable", 503}} {
		s.native.OCR = errorOCR{tc.e}
		r := nativeCall(t, s.ocrPage, nativeActor(t, erpwire.Member, false), nativeRaw(t, "POST", nativePNG(t), map[string]string{"x-ocr-page": "1", "x-ocr-pages": "1", "x-ocr-source-sha256": strings.Repeat("a", 64), "content-type": "image/png"}))
		body := r.Body.(map[string]any)
		if r.Status != tc.status || body["code"] != tc.code {
			t.Fatalf("error code lost %#v", r)
		}
	}
}
func TestReviewOriginAndRedirectRegressions(t *testing.T) {
	origins := configuredOrigins([]string{"https://ERP.EXAMPLE.TEST:443/", "http://LOCALHOST:80/"})
	if len(origins) != 2 || origins[0] != "https://erp.example.test" || origins[1] != "http://localhost" {
		t.Fatalf("origins not normalized %v", origins)
	}
	s := &Service{origins: origins}
	if !s.trustedBrowser(Request{Method: "GET", Headers: map[string]string{"referer": "https://ERP.EXAMPLE.TEST:443/settings"}}) {
		t.Fatal("normalized referer denied")
	}
	for _, value := range []string{"/x/%2e%2e/login", "/%ff"} {
		if SafeReturnPath(value) != "/dashboard" {
			t.Fatalf("unsafe destination %q accepted", value)
		}
	}
	if got := encodeURIComponent("/invite/a +:@!()'"); got != "%2Finvite%2Fa%20%2B%3A%40!()'" {
		t.Fatalf("component encoding %q", got)
	}
}
func TestSettingsRejectsNonJavaScriptNumbersAndEmailEdges(t *testing.T) {
	for _, value := range []string{"1/2", "1_000", "+0x10"} {
		if _, message := settingsMoney(value, true); message != "Invalid input: expected number, received NaN" {
			t.Fatalf("unexpected number %q accepted", value)
		}
	}
	db := &settingsStore{rows: map[string][]erpwire.Row{}}
	s := settingsService(db)
	for _, email := range []string{".person@example.test", "person.@example.test", "person@example.c", "person@example.123"} {
		out := settingsAction(t, s.inviteMember, mnActor(t, erpwire.Owner), settingsArgs(erpwire.Row{"email": email}))
		if settingsError(out) != "Enter a valid email" {
			t.Fatalf("invalid email accepted %q", email)
		}
	}
	if db.writes != 0 {
		t.Fatal("invalid inputs reached store")
	}
}

type queryFailureStore struct{ settingsStore }
type queryFailureTx struct{ settingsTx }

func (tx queryFailureTx) Select(ctx context.Context, q erpwire.Select) (erpwire.Selection, error) {
	if q.Table == "profiles" {
		return erpwire.Selection{}, errors.New("profile query failed")
	}
	return tx.settingsTx.Select(ctx, q)
}
func (s *queryFailureStore) Read(_ context.Context, _ erpwire.Actor, fn func(erpwire.ReadTx) error) error {
	s.reads++
	return fn(&queryFailureTx{settingsTx{&s.settingsStore}})
}
func TestConnectionsSoftQueriesUseIndependentTransactions(t *testing.T) {
	db := &queryFailureStore{settingsStore: settingsStore{rows: map[string][]erpwire.Row{"accounting_connections": {{"org_id": mnOrg, "status": "connected"}}}}}
	s := settingsService(&db.settingsStore)
	s.store = db
	s.security.ProEdition = true
	out, e := s.connectionsPage(context.Background(), mnActor(t, erpwire.Owner), settingsArgs())
	if e != nil {
		t.Fatal(e)
	}
	body := out.(erpwire.Row)
	if body["profileLocale"] != "th" || body["probes"].(erpwire.Row)["flowaccount"] != "connected" || db.reads != 2 {
		t.Fatalf("soft read poisoning %v reads=%d", out, db.reads)
	}
}
func TestAuditInvitationNullEntityID(t *testing.T) {
	db := &settingsStore{rows: map[string][]erpwire.Row{}}
	s := settingsService(db)
	settingsAction(t, s.inviteMember, mnActor(t, erpwire.Owner), settingsArgs(erpwire.Row{"email": "person@example.test"}))
	audits := db.rows["audit_log"]
	if len(audits) != 1 || audits[0]["entity_id"] != nil || !strings.HasPrefix(text(audits[0]["summary"]), "Invited person@example.test") {
		t.Fatalf("invitation audit missing %#v", audits)
	}
}
