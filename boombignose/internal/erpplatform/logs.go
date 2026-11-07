package erpplatform

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

var logDSN = regexp.MustCompile(`(?i)postgres(?:ql)?://\S+`)
var logJWT = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`)
var logSecret = regexp.MustCompile(`(?i)(secret|password|token|api[_-]?key|service_role|anon_key)(["']?\s*[:=]\s*["']?)[^\s"',]+`)

func redactLog(v string) string {
	v = logDSN.ReplaceAllString(v, "[redacted]")
	v = logJWT.ReplaceAllString(v, "[redacted]")
	return logSecret.ReplaceAllString(v, "${1}${2}[redacted]")
}
func (s *Service) readLocalLog(_ context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := s.authorize(a, ""); e != nil {
		return nil, e
	}
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return nil, e
	}
	var name string
	if args.Decode(0, &name) != nil {
		return nil, erpwire.ErrBadArguments
	}
	fail := func(message string) (any, error) { return erpwire.Row{"error": message}, nil }
	if s.security.DataDir == "" {
		return fail("No local data directory yet.")
	}
	if !contains([]string{"server.log", "auth.log", "postgrest.log"}, name) {
		return fail("That log is not available.")
	}
	root, e := filepath.EvalSymlinks(s.security.DataDir)
	if e != nil {
		return fail("No local data directory yet.")
	}
	resolved, e := filepath.EvalSymlinks(filepath.Join(root, name))
	if e != nil {
		return fail("That log is not on this computer yet.")
	}
	relative, e := filepath.Rel(root, resolved)
	if e != nil || relative != name {
		return fail("That log cannot be read.")
	}
	directory, e := os.OpenRoot(root)
	if e != nil {
		return fail("That log cannot be read.")
	}
	defer directory.Close()
	file, e := directory.Open(name)
	if e != nil {
		return fail("That log cannot be read.")
	}
	defer file.Close()
	info, e := file.Stat()
	if e != nil || !info.Mode().IsRegular() {
		return fail("That log cannot be read.")
	}
	start := max(int64(0), info.Size()-64*1024)
	if _, e = file.Seek(start, io.SeekStart); e != nil {
		return fail("That log cannot be read.")
	}
	data, e := io.ReadAll(io.LimitReader(file, 64*1024))
	if e != nil {
		return fail("That log cannot be read.")
	}
	value := strings.ToValidUTF8(string(data), "�")
	if start > 0 {
		if index := strings.IndexByte(value, '\n'); index >= 0 {
			value = value[index+1:]
		}
	}
	return erpwire.Row{"text": redactLog(value)}, nil
}
