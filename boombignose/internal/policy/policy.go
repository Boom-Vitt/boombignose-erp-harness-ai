// Package policy is the local-only gate for BoomBigNose.
// A runtime endpoint is allowed only when it is unset or on the loopback
// interface. Cloud model hosts and hosted Supabase are refused.
package policy

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ErrNotLocal is returned when a URL would leave the machine.
var ErrNotLocal = errors.New("refusing non-local endpoint")

// AllowEndpoint accepts an empty value or an http(s) URL whose host is
// localhost, 127.0.0.1, or ::1. The raw value is never included in the error.
func AllowEndpoint(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ErrNotLocal
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrNotLocal
	}
	if !isLoopback(u.Hostname()) {
		return ErrNotLocal
	}
	return nil
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// AllowService accepts an empty value, an http(s) loopback URL, or a
// loopback host:port without a scheme. Ollama's default host uses that form.
func AllowService(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	return AllowEndpoint(raw)
}

// CheckEnv refuses cloud credentials and any non-loopback service URL.
// Errors name the variable only. Values are never copied into the error.
func CheckEnv(getenv func(string) string) error {
	for _, name := range []string{
		"OPENROUTER_API_KEY",
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"RESEND_API_KEY",
	} {
		if strings.TrimSpace(getenv(name)) != "" {
			return fmt.Errorf("%s is set; cloud calls are refused", name)
		}
	}
	for _, name := range []string{
		"NEXT_PUBLIC_SUPABASE_URL",
		"N8N_OUTBOUND_URL",
		"BOOMBIGNOSE_ERP_URL",
	} {
		if err := AllowEndpoint(getenv(name)); err != nil {
			return fmt.Errorf("%s: %w", name, ErrNotLocal)
		}
	}
	if err := AllowService(getenv("OLLAMA_HOST")); err != nil {
		return fmt.Errorf("OLLAMA_HOST: %w", ErrNotLocal)
	}
	if err := AllowEndpoint(getenv("BOOMBIGNOSE_UPDATE_URL")); err != nil {
		return fmt.Errorf("BOOMBIGNOSE_UPDATE_URL: %w", ErrNotLocal)
	}
	return nil
}
