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
	if _, err := ScreenURL("https://boom-vitt.github.io/boombignose-erp-harness-ai/", "/finance"); err == nil {
		t.Fatal("brochure host was accepted as the ERP")
	}
	if _, err := ScreenURL("", "/site/download"); err == nil {
		t.Fatal("brochure path was accepted")
	}
	if _, err := ScreenURL("", "https://example.com/finance"); err == nil {
		t.Fatal("absolute screen URL was accepted")
	}
}
