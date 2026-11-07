package bundle

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPullAllowedByOS(t *testing.T) {
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
	if PullAllowed("llama3", "linux", "amd64") || PullAllowed("../qwen2.5:3b", "linux", "amd64") || PullAllowed("qwen2.5:3b\n", "linux", "amd64") {
		t.Fatal("names outside the catalog must be refused")
	}
}

func TestPullCommandForRefusesTheWrongMachineBeforeExec(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, exeName("ollama"))
	if err := os.WriteFile(binary, []byte("ollama"), 0o755); err != nil {
		t.Fatal(err)
	}
	vision, err := PullCommandFor(binary, "", []string{"HOME=/home/me", "OPENAI_API_KEY=sk-test"}, LocalModel)
	if err != nil {
		t.Fatal(err)
	}
	if err := allowPullCommand(vision); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(vision.Env, "\n"), "OPENAI") {
		t.Fatal("cloud key leaked")
	}
	if err := allowedBundleCommand(vision); err == nil {
		t.Fatal("startup must refuse a vision pull")
	}
	_, err = PullCommandFor(binary, "https://models.example", nil, LocalModel)
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
	if err := PullNamedModel(context.Background(), Layout{}, "", nil, "not-a-model"); !errors.Is(err, ErrModelRefused) {
		t.Fatalf("refused pull: %v", err)
	}
}

func TestModelManagementRefusesRemoteAndUnrecognizedTargets(t *testing.T) {
	if err := DeleteLocalModel(context.Background(), "", "llama3"); !errors.Is(err, ErrModelRefused) {
		t.Fatalf("unknown delete: %v", err)
	}
	if err := DeleteLocalModel(context.Background(), "https://models.example", LocalModel); err == nil || strings.Contains(err.Error(), "models.example") {
		t.Fatalf("remote delete: %v", err)
	}
	_, err := ListLocalModels(context.Background(), "http://ollama.example:11434")
	if err == nil || strings.Contains(err.Error(), "ollama.example") {
		t.Fatalf("remote list: %v", err)
	}
}
