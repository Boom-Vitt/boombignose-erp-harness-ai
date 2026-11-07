package erpplatform

import (
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// Request is constructed by the authenticated HTTP adapter, never deserialized
// directly as an operation argument from the public application dispatcher.
type Request struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
	Params  map[string]string `json:"params"`
}
type Response struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    any               `json:"body"`
	// Repeated Set-Cookie fields must remain separate in the HTTP adapter.
	Cookies []string `json:"cookies,omitempty"`
}

func apiRequest(raw json.RawMessage) (Request, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return Request{}, e
	}
	var r Request
	if args.Decode(0, &r) != nil || r.Method == "" {
		return r, erpwire.ErrBadArguments
	}
	return r, nil
}
func jsonResponse(status int, body any) Response {
	return Response{Status: status, Headers: map[string]string{"content-type": "application/json", "cache-control": "no-store"}, Body: body}
}
func header(r Request, key string) string {
	for k, v := range r.Headers {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}
func encodeURIComponent(v string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*").Replace(url.QueryEscape(v))
}
func hasHeader(r Request, key string) bool {
	for k := range r.Headers {
		if strings.EqualFold(k, key) {
			return true
		}
	}
	return false
}
func configuredOrigins(values []string) []string {
	out := []string{}
	for _, v := range values {
		u, e := url.Parse(v)
		if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Host == "" {
			continue
		}
		if u.Scheme != "https" && (u.Scheme != "http" || !loopback(strings.ToLower(u.Hostname()))) {
			continue
		}
		origin := mnURLOrigin(u)
		if !contains(out, origin) {
			out = append(out, origin)
		}
	}
	return out
}
func contains(values []string, v string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}
func loopback(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
func (s *Service) trustedOrigin(r Request) bool {
	return header(r, "origin") != "" && contains(s.origins, header(r, "origin")) && header(r, "sec-fetch-site") != "cross-site"
}
func (s *Service) trustedBrowser(r Request) bool {
	if hasHeader(r, "origin") {
		return s.trustedOrigin(r)
	}
	if r.Method != "GET" || header(r, "sec-fetch-site") == "cross-site" {
		return false
	}
	u, e := url.Parse(header(r, "referer"))
	return e == nil && contains(s.origins, mnURLOrigin(u))
}
func (s *Service) apiAccess(a erpwire.Actor, r Request, c erpwire.Capability, mutation bool) *Response {
	deny := func(status int, message string) *Response {
		x := jsonResponse(status, erpwire.Row{"error": message})
		return &x
	}
	if mutation && !s.trustedOrigin(r) {
		return deny(403, "Untrusted request origin.")
	}
	if e := s.authorize(a, c); e != nil {
		switch {
		case errors.Is(e, erpwire.ErrUnauthenticated):
			return deny(401, "Sign in required.")
		case errors.Is(e, erpwire.ErrStepUpRequired):
			return deny(403, "Authenticator verification required.")
		case errors.Is(e, erpwire.ErrAuthUnavailable):
			return deny(503, "Unable to verify session assurance. Please try again.")
		case errors.Is(e, erpwire.ErrForbidden):
			return deny(403, "Your role does not permit this action.")
		default:
			return deny(503, "Unable to verify workspace access. Please try again.")
		}
	}
	return nil
}
func boundedBody(r Request, max int) error {
	if len(r.Body) > max {
		return errors.New("body_limit")
	}
	if n, e := strconv.ParseInt(header(r, "content-length"), 10, 64); e == nil && n > int64(max) {
		return errors.New("body_limit")
	}
	return nil
}
func (s *Service) appOrigin(r Request) (string, error) {
	if len(s.origins) == 0 {
		return "", errors.New("An explicit application origin is required.")
	}
	if contains(s.origins, header(r, "origin")) {
		return header(r, "origin"), nil
	}
	for _, origin := range s.origins {
		u, _ := url.Parse(origin)
		if u.Host == header(r, "host") {
			return origin, nil
		}
	}
	u, e := url.Parse(r.URL)
	if e == nil && contains(s.origins, mnURLOrigin(u)) {
		return mnURLOrigin(u), nil
	}
	return s.origins[0], nil
}
