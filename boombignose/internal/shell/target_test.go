package shell

import "testing"

func TestERPURL(t *testing.T) {
	got, err := ERPURL("")
	if err != nil || got != DefaultERPURL {
		t.Fatalf("empty: %q %v", got, err)
	}
	got, err = ERPURL("http://127.0.0.1:3100")
	if err != nil || got != "http://127.0.0.1:3100" {
		t.Fatalf("loopback: %q %v", got, err)
	}
	if _, err := ERPURL("https://boom-vitt.github.io/nose-erp/"); err == nil {
		t.Fatal("pages URL must not be a window target")
	}
}
