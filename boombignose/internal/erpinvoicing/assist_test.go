package erpinvoicing

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type textStub struct {
	content          string
	err              error
	system, prompt   string
	maxTokens, calls int
}

func (g *textStub) GenerateText(ctx context.Context, system, prompt string, maxTokens int) (string, error) {
	g.calls++
	g.system = system
	g.prompt = prompt
	g.maxTokens = maxTokens
	return g.content, g.err
}

type emailStub struct {
	message EmailMessage
	result  EmailResult
	err     error
	calls   int
}

func (g *emailStub) SendEmail(ctx context.Context, message EmailMessage) (EmailResult, error) {
	g.calls++
	g.message = message
	return g.result, g.err
}

func TestMonthEndCountsAndUnavailableBankRemainDistinct(t *testing.T) {
	for _, tt := range []struct {
		name      string
		bankError bool
		wantBank  *int
	}{
		{"read empty bank", false, new(int)}, {"bank unavailable", true, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := financeFixtureStore()
			if tt.bankError {
				store.readErrors["bank_lines"] = errors.New("read failed")
			}
			s := testService(t, store)
			result, e := invoke(t, s, testActor(t, erpwire.Member), financePath+"close-summary-actions.ts::summarizeMonthEnd")
			if e != nil {
				t.Fatal(e)
			}
			out := result.(erpwire.Row)
			if out["notConfigured"] != true {
				t.Fatalf("missing configuration fallback %#v", out)
			}
			c := out["counts"].(CloseOpenItems)
			if c.AsOf != "2026-11-08" || c.OverdueReceivableCount != 1 || c.OverdueReceivableSatang != 9000 || c.UnpaidBillCount != 2 || c.UnpaidBillSatang != 510700 {
				t.Fatalf("counts=%#v", c)
			}
			if (c.UnmatchedBankCount == nil) != (tt.wantBank == nil) || c.UnmatchedBankCount != nil && *c.UnmatchedBankCount != 0 {
				t.Fatalf("bank availability %#v", c.UnmatchedBankCount)
			}
			if store.writeCount != 0 {
				t.Fatal("summary wrote data")
			}
		})
	}
}

func TestMonthEndGeneratorBoundaries(t *testing.T) {
	for _, tt := range []struct {
		name, content string
		err           error
		field         string
		want          any
	}{
		{"answer", "  สรุปยอดจากตัวเลขนี้  ", nil, "content", "สรุปยอดจากตัวเลขนี้"},
		{"strip reasoning", "<think>private reasoning</think>\n\nสรุปยอด", nil, "content", "สรุปยอด"},
		{"not configured", "", ErrTextNotConfigured, "notConfigured", true},
		{"empty answer", " \n ", nil, "error", "Ollama ไม่ได้ส่งบันทึกกลับมา ตัวเลขด้านบนยังมาจากเวิร์กสเปซนี้ / Ollama returned no note. The counts above are still from this workspace."},
		{"transport error", "", errors.New("private error"), "error", "Ollama ไม่ได้ส่งบันทึกกลับมา ตัวเลขด้านบนยังมาจากเวิร์กสเปซนี้ / Ollama returned no note. The counts above are still from this workspace."},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := financeFixtureStore()
			s := testService(t, store)
			generator := &textStub{content: tt.content, err: tt.err}
			s.generator = generator
			r, e := invoke(t, s, testActor(t, erpwire.Owner), financePath+"close-summary-actions.ts::summarizeMonthEnd")
			if e != nil {
				t.Fatal(e)
			}
			out := r.(erpwire.Row)
			if out[tt.field] != tt.want {
				t.Fatalf("result %#v want %s=%v", out, tt.field, tt.want)
			}
			if generator.calls != 1 || generator.maxTokens != 400 || !strings.Contains(generator.prompt, "2026-11-08 (08/11/2569)") || !strings.Contains(generator.prompt, "Overdue receivables: 1 (฿90.00).") || !strings.Contains(generator.prompt, "Unpaid vendor bills: 2 (฿5,107.00).") || !strings.Contains(generator.system, "Do not invent invoices") {
				t.Fatalf("bad prompt %#v", generator)
			}
		})
	}
}

func TestMonthEndReadFailuresDoNotInventCounts(t *testing.T) {
	for _, tt := range []struct{ table, want string }{
		{"invoices", "Could not read open items."}, {"costs", "Could not read open items."}, {"invoice_balances", "Could not read invoice balances."},
	} {
		t.Run(tt.table, func(t *testing.T) {
			store := financeFixtureStore()
			store.readErrors[tt.table] = errors.New("private error")
			r, e := invoke(t, testService(t, store), testActor(t, erpwire.Owner), financePath+"close-summary-actions.ts::summarizeMonthEnd")
			if e != nil {
				t.Fatal(e)
			}
			out := r.(erpwire.Row)
			if len(out) != 1 || out["error"] != tt.want {
				t.Fatalf("fabricated counts: %#v", out)
			}
		})
	}
}

func TestVisibleReplyPreservesAnswerOnly(t *testing.T) {
	for _, tt := range []struct{ input, want string }{
		{"hello", "hello"}, {"<think>plan</think>\n\nAnswer", "Answer"}, {"plan it out\n</think>\nAnswer", "Answer"}, {"Answer first.<think>still thinking", "Answer first."}, {"<think>only this</think>", ""}, {"Okay, so the user wants a note.\n\nI should be brief.", ""}, {"Deal summary.\n\nOkay to close this week.", "Deal summary.\n\nOkay to close this week."},
	} {
		if got := visibleReply(tt.input); got != tt.want {
			t.Errorf("visibleReply(%q)=%q want %q", tt.input, got, tt.want)
		}
	}
}

func TestInvoiceEmailDataAndAuditStayScoped(t *testing.T) {
	store := financeFixtureStore()
	store.rows["contacts"] = []erpwire.Row{
		{"org_id": otherOrg, "client_id": testClient, "email": "private@example.invalid", "created_at": "2020-01-01"},
		{"org_id": testOrg, "client_id": testClient, "email": nil, "created_at": "2020-01-01"},
		{"org_id": testOrg, "client_id": testClient, "email": "first@example.invalid", "created_at": "2026-01-01"},
		{"org_id": testOrg, "client_id": testClient, "email": "second@example.invalid", "created_at": "2026-02-01"},
	}
	s := testService(t, store)
	sender := &emailStub{result: EmailResult{OK: true}}
	s.emailer = sender
	s.appURL = "https://example.invalid"
	r, e := invoke(t, s, testActor(t, erpwire.Member), financePath+"email-actions.ts::sendInvoiceEmail", testInvoice)
	if out := actionValue(t, r, e); out["ok"] != true {
		t.Fatalf("email outcome %#v", out)
	}
	if sender.calls != 1 || sender.message.To != "first@example.invalid" || sender.message.Subject != "Invoice INV-2026-000001" || !strings.Contains(sender.message.HTML, "฿103.00") || !strings.Contains(sender.message.HTML, "https://example.invalid/finance/invoices/"+testInvoice+"/pdf") {
		t.Fatalf("wrong email %#v", sender)
	}
	audit := store.rows["audit_log"]
	if len(audit) != 1 || audit[0]["org_id"] != testOrg || audit[0]["entity_id"] != testInvoice || audit[0]["summary"] != "Emailed invoice INV-2026-000001 to first@example.invalid" {
		t.Fatalf("audit %#v", audit)
	}
	activities := store.rows["activities"]
	if len(activities) != 1 || activities[0]["body"] != "Sent invoice INV-2026-000001 (฿103.00) to first@example.invalid" || activities[0]["owner"] != testUser {
		t.Fatalf("activity %#v", activities)
	}
}

func TestEmailFallbacksAndHTML(t *testing.T) {
	for _, tt := range []struct {
		name    string
		contact bool
		sender  *emailStub
		want    erpwire.Row
	}{
		{"no contact", false, nil, erpwire.Row{"error": "No client email on file. Add a contact with an email to this client first."}},
		{"no adapter", true, nil, erpwire.Row{"ok": false, "reason": "not_configured"}},
		{"adapter unconfigured", true, &emailStub{result: EmailResult{Reason: "not_configured"}}, erpwire.Row{"ok": false, "reason": "not_configured"}},
		{"provider error", true, &emailStub{result: EmailResult{Error: "Could not deliver"}}, erpwire.Row{"error": "Could not deliver"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := financeFixtureStore()
			if tt.contact {
				store.rows["contacts"] = []erpwire.Row{{"org_id": testOrg, "client_id": testClient, "email": "test@example.invalid", "created_at": "2026-01-01"}}
			}
			s := testService(t, store)
			if tt.sender != nil {
				s.emailer = tt.sender
			}
			r, e := invoke(t, s, testActor(t, erpwire.Owner), financePath+"email-actions.ts::sendInvoiceEmail", testInvoice)
			out := actionValue(t, r, e)
			for key, want := range tt.want {
				if out[key] != want {
					t.Fatalf("fallback=%#v want %#v", out, tt.want)
				}
			}
			if store.writeCount != 0 {
				t.Fatal("failed delivery wrote activity/audit")
			}
		})
	}
	html := invoiceEmailHTML(erpwire.Row{"number": "<INV>&\"'", "due_date": "<date>"}, "<client>", money.MaxSafeSatang, `https://example.invalid/?q="&x=<`)
	for _, part := range []string{"&lt;INV&gt;&amp;&quot;&#39;", "Dear &lt;client&gt;,", "&lt;date&gt;", "฿90,071,992,547,409.91", `q=&quot;&amp;x=&lt;`} {
		if !strings.Contains(html, part) {
			t.Errorf("missing exact escaped HTML %q", part)
		}
	}
}
