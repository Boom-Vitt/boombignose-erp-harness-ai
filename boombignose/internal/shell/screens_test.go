package shell

import (
	"strings"
	"testing"
)

func TestFinanceScreensStayOnTheDesktopERP(t *testing.T) {
	if len(FinanceScreens) == 0 {
		t.Fatal("desktop close screens are missing")
	}
	for _, screen := range FinanceScreens {
		got, err := ScreenURL("", screen.Path)
		if err != nil {
			t.Fatalf("%s: %v", screen.Name, err)
		}
		if !strings.HasPrefix(got, DefaultERPURL) {
			t.Fatalf("%s left the desktop ERP: %s", screen.Name, got)
		}
		if strings.Contains(got, "github.io") || strings.Contains(got, "/site") {
			t.Fatalf("%s points at the brochure: %s", screen.Name, got)
		}
	}
	got, err := ScreenURL("", "/reports#month-end-close")
	if err != nil || got != "http://127.0.0.1:3100/reports#month-end-close" {
		t.Fatalf("checklist: %q %v", got, err)
	}
	if _, err := ScreenURL("https://boom-vitt.github.io/nose-erp/", "/finance"); err == nil {
		t.Fatal("brochure host was accepted as the ERP")
	}
	if _, err := ScreenURL("", "/site/download"); err == nil {
		t.Fatal("brochure path was accepted")
	}
	if _, err := ScreenURL("", "https://example.com/finance"); err == nil {
		t.Fatal("absolute screen URL was accepted")
	}
	for _, blocked := range []string{"", "//finance", "/finance/../site", "/reports/../../site/download"} {
		if _, err := ScreenURL("", blocked); err == nil {
			t.Fatalf("screen path %q was accepted", blocked)
		}
	}
	cash, err := ScreenURL("", "/finance/cash?month=2026-01")
	if err != nil || cash != "http://127.0.0.1:3100/finance/cash?month=2026-01" {
		t.Fatalf("cash query: %q %v", cash, err)
	}
	for _, screen := range []string{"/settings/finance", "/settings/accounting"} {
		got, err := ScreenURL("", screen)
		if err != nil || got != DefaultERPURL+screen {
			t.Fatalf("%s: %q %v", screen, got, err)
		}
		if _, err := ScreenURL("https://boom-vitt.github.io/nose-erp/", screen); err == nil {
			t.Fatalf("%s was placed on the brochure", screen)
		}
	}
}
