package bundle

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"
)

//go:embed ollama_models.json
var ollamaModelsJSON []byte

// ErrModelUnavailable means the name is in the catalog but this OS cannot run it.
var ErrModelUnavailable = errors.New("not available in this build")

// ErrModelRefused means the name is not an allowlisted local model.
var ErrModelRefused = errors.New("refusing model pull")

type catalogModel struct {
	ID        string   `json:"id"`
	Platforms []string `json:"platforms"`
	Arches    []string `json:"arches"`
}

type ollamaCatalog struct {
	Models []catalogModel `json:"models"`
}

func loadCatalog() ollamaCatalog {
	var file ollamaCatalog
	if err := json.Unmarshal(ollamaModelsJSON, &file); err != nil {
		panic(err)
	}
	return file
}

func safeModelID(id string) bool {
	if id == "" || len(id) > 80 || strings.Contains(id, "..") || strings.HasPrefix(id, "/") {
		return false
	}
	if strings.ContainsAny(id, "\\ \t\r\n\x00") {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '_', r == ':', r == '/', r == '-':
		default:
			return false
		}
	}
	return true
}

func findModel(id string) (catalogModel, bool) {
	if !safeModelID(id) {
		return catalogModel{}, false
	}
	for _, model := range loadCatalog().Models {
		if model.ID == id {
			return model, true
		}
	}
	return catalogModel{}, false
}

// KnownModel reports whether id is one of the bundled catalog names.
func KnownModel(id string) bool {
	_, ok := findModel(id)
	return ok
}

// PullAllowed reports whether this operating system may download id.
// goos uses Go names (windows, not win32). goarch uses Go names (amd64, not x64).
func PullAllowed(id, goos, goarch string) bool {
	model, ok := findModel(id)
	if !ok {
		return false
	}
	if !contains(model.Platforms, goos) {
		return false
	}
	if len(model.Arches) == 0 {
		return false
	}
	if model.Arches[0] == "any" {
		return true
	}
	return contains(model.Arches, goarch)
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// CatalogIDs is the allowlist order from ollama_models.json.
func CatalogIDs() []string {
	file := loadCatalog()
	ids := make([]string, 0, len(file.Models))
	for _, model := range file.Models {
		ids = append(ids, model.ID)
	}
	return ids
}

type tagList struct {
	Models []struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	} `json:"models"`
}

// LocalModelInfo is one model the local daemon already has.
type LocalModelInfo struct {
	Name string
	Size int64
}

// ListLocalModels reads GET /api/tags on loopback. A remote host is refused
// and is not included in the error. The daemon must already be running.
func ListLocalModels(ctx context.Context, host string) ([]LocalModelInfo, error) {
	base, err := ollamaListen(host)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+base+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, errors.New("ollama is not running")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, errors.New("ollama is not running")
	}
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("ollama is not running")
	}
	var parsed tagList
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, errors.New("ollama is not running")
	}
	out := make([]LocalModelInfo, 0, len(parsed.Models))
	for _, model := range parsed.Models {
		name := strings.TrimSpace(model.Name)
		if name == "" || strings.ContainsAny(name, "\r\n") {
			continue
		}
		out = append(out, LocalModelInfo{Name: name, Size: model.Size})
	}
	return out, nil
}

// DeleteLocalModel removes one allowlisted model through DELETE /api/delete.
// Names outside the catalog never reach the daemon.
func DeleteLocalModel(ctx context.Context, host, model string) error {
	if !KnownModel(model) {
		return ErrModelRefused
	}
	if !PullAllowed(model, runtime.GOOS, runtime.GOARCH) {
		return ErrModelUnavailable
	}
	base, err := ollamaListen(host)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]string{"model": model})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, "http://"+base+"/api/delete", strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("ollama is not running")
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode != http.StatusOK {
		return errors.New("ollama could not remove the model")
	}
	return nil
}
