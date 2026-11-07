package localai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func replyHTTP(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func localCheckpoint() *http.Response {
	return replyHTTP(200, `{"details":{"format":"gguf"},"capabilities":["completion","vision"]}`)
}
func inferenceText(text string) *http.Response {
	return replyHTTP(200, string(jsonBytes(map[string]any{"done": true, "done_reason": "stop", "message": map[string]string{"content": text}})))
}
func testProvider(t *testing.T) *Provider {
	t.Helper()
	p, err := NewProvider(Config{})
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func testActor(t *testing.T) erpwire.Actor {
	t.Helper()
	now := time.Now()
	a, err := erpwire.BindActor(erpwire.VerifiedIdentity{UserID: "11111111-1111-4111-8111-111111111111", Assurance: erpwire.AAL1, ExpiresAt: now.Add(time.Hour), FactorStateKnown: true}, erpwire.Membership{UserID: "11111111-1111-4111-8111-111111111111", OrgID: "22222222-2222-4222-8222-222222222222", Role: erpwire.Owner}, false, now)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestLoopbackProviderRefusesRemoteRedirectCredentialsAndCloud(t *testing.T) {
	for _, origin := range []string{"https://models.example", "http://127.0.0.1.evil.test:11434", "http://user:password@127.0.0.1:11434", "file:///tmp/model", "http://127.0.0.1:11434/proxy", "http://127.0.0.1:11434/?secret=x"} {
		if _, err := NewProvider(Config{Origin: origin}); err == nil {
			t.Fatalf("accepted unsafe origin %q", origin)
		}
	}
	p := testProvider(t)
	var sent atomic.Int32
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/chat" {
			sent.Add(1)
			t.Error("private messages reached an unverified model")
		}
		return replyHTTP(200, `{"remote_host":"https://cloud.example","details":{"format":"gguf"},"capabilities":["completion","vision"]}`), nil
	})
	if _, err := p.infer(context.Background(), p.chatModel, []modelMessage{{Role: "user", Content: "private business source"}}, nil, false, false); err == nil {
		t.Fatal("accepted loopback cloud proxy")
	}
	if sent.Load() != 0 {
		t.Fatal("preflight was not completed before source transmission")
	}
}

func TestChatAndOCRShareCancellationAwareInferenceGate(t *testing.T) {
	p := testProvider(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	var requests atomic.Int32
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		if r.URL.Path == "/api/show" {
			return localCheckpoint(), nil
		}
		close(entered)
		select {
		case <-release:
			return inferenceText("Actual model text"), nil
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
	})
	go func() {
		_, err := p.infer(context.Background(), p.chatModel, []modelMessage{{Role: "user", Content: "Question"}}, nil, false, false)
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first inference did not enter")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := requests.Load()
	if _, err := p.infer(ctx, p.ocrModel, []modelMessage{{Role: "user", Content: "OCR"}}, nil, true, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("waiting OCR did not honor cancellation: %v", err)
	}
	if requests.Load() != before {
		t.Fatal("waiting OCR sent model requests while another inference held the gate")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestBackendContextOverflowPreservesEveryAcceptedHistoryTurn(t *testing.T) {
	p := testProvider(t)
	history := []modelMessage{{Role: "system", Content: "Policy"}, {Role: "user", Content: strings.Repeat("original ", 1000)}, {Role: "assistant", Content: "Earlier response"}, {Role: "user", Content: "Current question"}}
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/show" {
			return localCheckpoint(), nil
		}
		return replyHTTP(400, `{"error":"request exceeds the maximum context length"}`), nil
	})
	_, err := p.infer(context.Background(), p.chatModel, history, nil, false, false)
	var e *Error
	if !errors.As(err, &e) || e.Code != "context_overflow" {
		t.Fatalf("overflow not reported honestly: %v", err)
	}
	if len(history) != 4 || history[1].Content != strings.Repeat("original ", 1000) {
		t.Fatal("history mutated on overflow")
	}
}

type countingReader struct {
	reads int
	specs int
}

func (r *countingReader) Specs(context.Context, erpwire.Actor) (erpwire.ToolCatalog, error) {
	r.specs++
	return erpwire.ToolCatalog{}, erpwire.ErrForbidden
}
func (r *countingReader) Call(context.Context, erpwire.Actor, string, json.RawMessage) (erpwire.ToolResult, error) {
	r.reads++
	return erpwire.ToolResult{}, erpwire.ErrForbidden
}
func TestGuidanceNeverInvokesERPAndMissingOCRHelperDoesNotDisableChat(t *testing.T) {
	p := testProvider(t)
	runner := &countingReader{}
	service, _ := NewService(p, runner)
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/show" {
			return localCheckpoint(), nil
		}
		return inferenceText(`{"summary":"Review the original source before deciding.","findings":[],"nextActions":[],"limitations":[]}`), nil
	})
	result, err := service.Chat(context.Background(), testActor(t), erpwire.ChatRequest{DataScope: erpwire.GuidanceScope, Messages: []erpwire.ChatMessage{{Role: "user", Content: "How should I review a receipt?"}}})
	if err != nil {
		t.Fatal(err)
	}
	if runner.reads != 0 || runner.specs != 0 || len(result.Sources) != 0 || result.Answer.Kind != "guidance" {
		t.Fatal("guidance touched ERP authority")
	}
}

func TestInstalledSafetensorsOCRIsPreservedButNotUsedForChatHistory(t *testing.T) {
	p := testProvider(t)
	var inferred atomic.Int32
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/show" {
			return replyHTTP(200, `{"remote":false,"details":{"format":"safetensors","family":"qwen3_5"},"capabilities":["completion","vision","thinking","tools"]}`), nil
		}
		inferred.Add(1)
		return inferenceText("ข้อความจากต้นฉบับ\nOriginal text"), nil
	})
	if _, err := p.infer(context.Background(), p.ocrModel, []modelMessage{{Role: "user", Content: "Transcribe original raster"}}, nil, true, false); err != nil {
		t.Fatal(err)
	}
	if _, err := p.infer(context.Background(), p.chatModel, []modelMessage{{Role: "user", Content: "Preserve complete business history"}}, nil, false, false); err == nil {
		t.Fatal("chat silently used a backend without enforced history context")
	}
	if inferred.Load() != 1 {
		t.Fatal("refused chat was sent for inference or OCR was retried")
	}
}
