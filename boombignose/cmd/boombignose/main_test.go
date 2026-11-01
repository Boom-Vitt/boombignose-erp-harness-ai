package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
)

func TestRunCheckRequiresLocalEnv(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	if err := run([]string{"check"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENROUTER_API_KEY", "secret-value")
	err := run([]string{"check"})
	if err == nil {
		t.Fatal("expected refusal")
	}
	if policy.ErrNotLocal == nil {
		t.Fatal("sentinel missing")
	}
}

func TestRunCutoverDoesNotApply(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	if err := run([]string{"cutover"}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"apply"}); err == nil {
		t.Fatal("unknown command must fail")
	}
	err := run([]string{"cutover", "dry-run", "--source", "postgresql://boombignose:secret-value@db.example.com:5432/boombignose", "--target", "postgresql://boombignose@127.0.0.1:54329/boombignose"})
	if err == nil {
		t.Fatal("remote cutover must fail")
	}
	if strings.Contains(err.Error(), "secret-value") || strings.Contains(err.Error(), "example.com") {
		t.Fatalf("error includes the URL: %s", err)
	}
}

func TestRunServeRequiresBundle(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("OLLAMA_HOST", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	t.Setenv("BOOMBIGNOSE_DATA", t.TempDir())
	t.Setenv("BOOMBIGNOSE_BUNDLE", t.TempDir())
	err := run([]string{"serve"})
	if err == nil {
		t.Fatal("empty bundle must fail")
	}
	if strings.Contains(err.Error(), "http://") || strings.Contains(err.Error(), "sk-") {
		t.Fatalf("error leaked a remote value: %v", err)
	}
}

func TestRunPullModelWithoutBinary(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("OLLAMA_HOST", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	t.Setenv("BOOMBIGNOSE_BUNDLE", "")
	t.Setenv("PATH", t.TempDir())
	err := run([]string{"pull-model"})
	if err == nil {
		t.Fatal("missing ollama must fail")
	}
	if strings.Contains(err.Error(), "http://") || strings.Contains(err.Error(), "sk-") {
		t.Fatalf("error leaked a remote value: %v", err)
	}
}

func TestRunModelCommandsStayOnTheAllowlist(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", "")
	t.Setenv("N8N_OUTBOUND_URL", "")
	t.Setenv("OLLAMA_HOST", "")
	t.Setenv("BOOMBIGNOSE_ERP_URL", "")
	t.Setenv("BOOMBIGNOSE_BUNDLE", "")
	t.Setenv("PATH", t.TempDir())
	err := run([]string{"pull-model", "phonon"})
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		if err == nil || err.Error() == "not available in this build" {
			t.Fatalf("speech pull should look for the binary: %v", err)
		}
	} else if err == nil || err.Error() != "not available in this build" {
		t.Fatalf("speech pull: %v", err)
	}
	err = run([]string{"pull-model", "llama3"})
	if err == nil || err.Error() != "refusing model pull" || strings.Contains(err.Error(), "llama3") {
		t.Fatalf("unknown pull: %v", err)
	}
	err = run([]string{"remove-model", "llama3"})
	if err == nil || err.Error() != "refusing model pull" {
		t.Fatalf("unknown remove: %v", err)
	}
	err = run([]string{"pull-model", "qwen2.5vl:3b"})
	if err == nil || strings.Contains(err.Error(), "not available") {
		t.Fatalf("vision pull should reach the binary lookup: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tags" {
			fmt.Fprint(w, `{"models":[{"name":"qwen3:4b","size":4}]}`)
			return
		}
		if r.URL.Path == "/api/delete" && r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	t.Setenv("OLLAMA_HOST", strings.TrimPrefix(srv.URL, "http://"))
	if err := run([]string{"models"}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"remove-model", "qwen3:4b"}); err != nil {
		t.Fatal(err)
	}
}

func TestRunStopOnEmptyData(t *testing.T) {
	t.Setenv("BOOMBIGNOSE_BUNDLE", "")
	t.Setenv("BOOMBIGNOSE_DATA", t.TempDir())
	if err := run([]string{"stop"}); err != nil {
		t.Fatal(err)
	}
}
