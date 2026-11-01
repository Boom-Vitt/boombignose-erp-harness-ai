package policy

import (
	"strings"
	"testing"
)

func TestAllowEndpoint(t *testing.T) {
	ok := []string{
		"",
		"   ",
		"http://127.0.0.1:3100",
		"http://127.0.0.1:54421",
		"http://localhost:3100/login",
		"http://[::1]:3100",
	}
	for _, raw := range ok {
		if err := AllowEndpoint(raw); err != nil {
			t.Fatalf("AllowEndpoint(%q) = %v", raw, err)
		}
	}
	bad := []string{
		"https://models.example/v1/chat/completions",
		"https://mail.example/emails",
		"https://llm.example/v1",
		"https://chat.example",
		"https://xyzcompany.supabase.co",
		"https://example.com",
		"file:///etc/passwd",
		"not a url",
	}
	for _, raw := range bad {
		if err := AllowEndpoint(raw); err == nil {
			t.Fatalf("AllowEndpoint(%q) accepted a non-local endpoint", raw)
		}
	}
}

func TestCheckEnv(t *testing.T) {
	if err := CheckEnv(func(string) string { return "" }); err != nil {
		t.Fatal(err)
	}
	local := map[string]string{"NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54421"}
	if err := CheckEnv(func(k string) string { return local[k] }); err != nil {
		t.Fatal(err)
	}
	err := CheckEnv(func(k string) string {
		if k == "OPENROUTER_API_KEY" {
			return "secret-value"
		}
		return ""
	})
	if err == nil {
		t.Fatal("expected cloud key to be refused")
	}
	if strings.Contains(err.Error(), "secret-value") {
		t.Fatal("error leaked the secret value")
	}
	if err := CheckEnv(func(k string) string {
		if k == "N8N_OUTBOUND_URL" {
			return "https://hooks.example.com/hook"
		}
		return ""
	}); err == nil {
		t.Fatal("expected hosted webhook to be refused")
	}
	if err := CheckEnv(func(k string) string {
		if k == "OLLAMA_HOST" {
			return "127.0.0.1:11434"
		}
		return ""
	}); err != nil {
		t.Fatal(err)
	}
	err = CheckEnv(func(k string) string {
		if k == "OLLAMA_HOST" {
			return "https://ollama.example.com"
		}
		return ""
	})
	if err == nil || strings.Contains(err.Error(), "ollama.example.com") {
		t.Fatalf("remote ollama: %v", err)
	}
	if err := CheckEnv(func(k string) string {
		if k == "BOOMBIGNOSE_UPDATE_URL" {
			return "http://127.0.0.1:9"
		}
		return ""
	}); err != nil {
		t.Fatal(err)
	}
	err = CheckEnv(func(k string) string {
		if k == "BOOMBIGNOSE_UPDATE_URL" {
			return "https://updates.example/apply"
		}
		return ""
	})
	if err == nil || strings.Contains(err.Error(), "updates.example") {
		t.Fatalf("remote update helper: %v", err)
	}
}
