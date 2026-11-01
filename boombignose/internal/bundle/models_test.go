package bundle

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCatalogIDsMatchTheShippedAllowlist(t *testing.T) {
	got := CatalogIDs()
	want := []string{"qwen3:4b", "qwen2.5vl:3b", "x/flux2-klein:4b", "phonon"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("catalog = %#v", got)
	}
}

func TestPullAllowedByOS(t *testing.T) {
	if !PullAllowed("qwen3:4b", "linux", "amd64") || !PullAllowed("qwen2.5vl:3b", "windows", "amd64") {
		t.Fatal("text and vision must install on linux and windows")
	}
	if PullAllowed("x/flux2-klein:4b", "linux", "amd64") || PullAllowed("phonon", "linux", "amd64") {
		t.Fatal("image and speech must not install on linux")
	}
	if PullAllowed("x/flux2-klein:4b", "darwin", "amd64") != true {
		t.Fatal("image generation is a macOS model")
	}
	if PullAllowed("phonon", "darwin", "amd64") {
		t.Fatal("speech is Apple Silicon only")
	}
	if !PullAllowed("phonon", "darwin", "arm64") {
		t.Fatal("speech must install on darwin/arm64")
	}
	if PullAllowed("llama3", "linux", "amd64") || PullAllowed("../qwen3:4b", "linux", "amd64") || PullAllowed("qwen3:4b\n", "linux", "amd64") {
		t.Fatal("names outside the catalog must be refused")
	}
}

func TestPullCommandForRefusesTheWrongMachineBeforeExec(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, exeName("ollama"))
	if err := os.WriteFile(binary, []byte("ollama"), 0o755); err != nil {
		t.Fatal(err)
	}
	vision, err := PullCommandFor(binary, "", []string{"HOME=/home/me", "OPENAI_API_KEY=sk-test"}, "qwen2.5vl:3b")
	if err != nil {
		t.Fatal(err)
	}
	if err := allowPullCommand(vision); err != nil {
		t.Fatal(err)
	}
	if strings.Join(vision.Args, " ") != "pull qwen2.5vl:3b" {
		t.Fatalf("args: %#v", vision.Args)
	}
	if strings.Contains(strings.Join(vision.Env, "\n"), "OPENAI") {
		t.Fatal("cloud key leaked")
	}
	if err := allowedBundleCommand(vision); err == nil {
		t.Fatal("startup must refuse a vision pull")
	}
	_, err = PullCommandFor(binary, "https://models.example", nil, "qwen3:4b")
	if err == nil || strings.Contains(err.Error(), "models.example") {
		t.Fatalf("remote pull: %v", err)
	}
	_, err = PullCommandFor(binary, "", nil, "llama3")
	if !errors.Is(err, ErrModelRefused) {
		t.Fatalf("unknown model: %v", err)
	}
	_, err = PullCommandFor(binary, "", nil, "phonon")
	speechHere := runtime.GOOS == "darwin" && runtime.GOARCH == "arm64"
	if speechHere {
		if err != nil {
			t.Fatalf("speech on Apple Silicon: %v", err)
		}
	} else if !errors.Is(err, ErrModelUnavailable) || strings.Contains(err.Error(), "phonon") {
		t.Fatalf("speech on this OS: %v", err)
	}
	err = PullNamedModel(context.Background(), Layout{}, "", nil, "phonon")
	if speechHere {
		if err == nil || errors.Is(err, ErrModelUnavailable) {
			t.Fatalf("named speech pull should reach the binary lookup: %v", err)
		}
	} else if !errors.Is(err, ErrModelUnavailable) {
		t.Fatalf("named pull: %v", err)
	}
	if err := PullNamedModel(context.Background(), Layout{}, "", nil, "not-a-model"); !errors.Is(err, ErrModelRefused) {
		t.Fatalf("refused pull: %v", err)
	}
}

func TestListAndDeleteLocalModelsOnLoopback(t *testing.T) {
	var deleted string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"models":[{"name":"qwen3:4b","size":10},{"name":"qwen3:4b:latest","size":11},{"name":"bad\nname","size":1}]}`)
		case "/api/delete":
			if r.Method != http.MethodDelete {
				t.Errorf("method %s", r.Method)
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			deleted = body["model"]
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	listed, err := ListLocalModels(context.Background(), host)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].Name != "qwen3:4b" || listed[0].Size != 10 || listed[1].Size != 11 {
		t.Fatalf("listed: %#v", listed)
	}
	if err := DeleteLocalModel(context.Background(), host, "qwen3:4b"); err != nil {
		t.Fatal(err)
	}
	if deleted != "qwen3:4b" {
		t.Fatalf("deleted %q", deleted)
	}
	if err := DeleteLocalModel(context.Background(), host, "llama3"); !errors.Is(err, ErrModelRefused) {
		t.Fatalf("unknown delete: %v", err)
	}
	if err := DeleteLocalModel(context.Background(), "https://models.example", "qwen3:4b"); err == nil || strings.Contains(err.Error(), "models.example") {
		t.Fatalf("remote delete: %v", err)
	}
	_, err = ListLocalModels(context.Background(), "http://ollama.example:11434")
	if err == nil || strings.Contains(err.Error(), "ollama.example") {
		t.Fatalf("remote list: %v", err)
	}
}
