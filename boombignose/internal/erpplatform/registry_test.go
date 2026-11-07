package erpplatform

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func TestOperationCoverageAgainstSource(t *testing.T) {
	root := filepath.Clean("../../..")
	s := settingsService(&settingsStore{rows: map[string][]erpwire.Row{}})
	operations := s.Operations()
	expected := map[string]bool{"app/forbidden.tsx::load": true}
	functions := regexp.MustCompile(`export\s+(?:async\s+)?function\s+([A-Za-z][A-Za-z0-9_]*)\s*\(`)
	aliases := regexp.MustCompile(`\bas\s+(GET|POST|DELETE|PUT|PATCH|OPTIONS|HEAD)\b`)
	for _, scope := range []string{"app/(app)/settings", "app/api", "app/auth", "app/login/actions.ts"} {
		err := filepath.WalkDir(filepath.Join(root, scope), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			data, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			source := string(data)
			relative, e := filepath.Rel(root, path)
			if e != nil {
				return e
			}
			relative = filepath.ToSlash(relative)
			switch {
			case entry.Name() == "page.tsx":
				expected[relative+"::load"] = true
			case entry.Name() == "route.ts":
				for _, match := range functions.FindAllStringSubmatch(source, -1) {
					if contains([]string{"GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS", "HEAD"}, match[1]) {
						expected[relative+"::"+match[1]] = true
					}
				}
				for _, match := range aliases.FindAllStringSubmatch(source, -1) {
					expected[relative+"::"+match[1]] = true
				}
			case strings.HasPrefix(strings.TrimSpace(source), `"use server"`) || strings.HasPrefix(strings.TrimSpace(source), `'use server'`):
				for _, match := range functions.FindAllStringSubmatch(source, -1) {
					expected[relative+"::"+match[1]] = true
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for key := range expected {
		if operations[key] == nil {
			t.Errorf("missing scoped operation %s", key)
		}
	}
	for key := range operations {
		if !expected[key] {
			t.Errorf("operation has no scoped source export %s", key)
		}
	}
	// Warehouse is already registered by erpmetrics; no duplicate domain ownership.
	if operations["app/warehouse/page.tsx::load"] != nil {
		t.Fatal("duplicated warehouse operation")
	}
	existing, e := os.ReadFile("../erpmetrics/service.go")
	if e != nil || !strings.Contains(string(existing), `"app/warehouse/page.tsx::load"`) {
		t.Fatal("warehouse coverage is missing from its owner")
	}
	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if path == "../erpplatform" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		for key := range operations {
			if strings.Contains(string(data), `"`+key+`"`) {
				t.Errorf("duplicate operation in %s: %s", path, key)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("covered all %d scoped operation exports; warehouse remains owned by erpmetrics", len(operations))
}
func TestRouteMethodCannotBeForgedThroughOperationEnvelope(t *testing.T) {
	s := settingsService(&settingsStore{rows: map[string][]erpwire.Row{}})
	_, e := s.Operations()["app/auth/local/[...path]/route.ts::GET"](context.Background(), erpwire.Actor{}, securityRequest(Request{Method: "POST"}))
	if e != erpwire.ErrBadArguments {
		t.Fatalf("method override permitted %v", e)
	}
}
