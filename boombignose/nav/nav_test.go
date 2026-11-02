package nav

import (
	"strings"
	"testing"
)

func TestScript(t *testing.T) {
	got, err := Script("http://127.0.0.1:3100")
	if err != nil {
		t.Fatal(err)
	}
	want := `window.location.replace("http://127.0.0.1:3100")`
	if got != want {
		t.Fatalf("got %s", got)
	}
	if _, err := Script("https://example.com"); err == nil {
		t.Fatal("non-loopback target must be refused")
	}
	got, err = Script(`http://127.0.0.1:3100/x"y`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `\"`) || strings.Contains(got, `");alert`) {
		t.Fatalf("quote was not kept inside the script string: %s", got)
	}
}

func TestBootFailureStaysOnTheSplash(t *testing.T) {
	got, err := BootFailure("127.0.0.1:3100 is already in use\n<script>")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "location.replace") || strings.Contains(got, "<script>") {
		t.Fatalf("script = %s", got)
	}
	if !strings.Contains(got, "boot-status") || !strings.Contains(got, "เปิด ERP ไม่สำเร็จ") || !strings.Contains(got, "already in use") || !strings.Contains(got, "ลองใหม่") {
		t.Fatalf("script = %s", got)
	}
}
