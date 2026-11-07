// Package erpcore owns the Go application's authenticated HTTP/database boundary.
package erpcore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/policy"
	"github.com/google/uuid"
)

const (
	maxSessionBytes = 64 * 1024
	maxJWTBytes     = 16 * 1024
	maxUserBytes    = 1024 * 1024
)

type AuthConfig struct {
	Origin     string
	AnonKey    string
	CookieName string
	Client     *http.Client
	Now        func() time.Time
}

type Authenticator struct {
	origin     string
	anonKey    string
	cookieName string
	client     *http.Client
	now        func() time.Time
}

type authClaims struct {
	Subject   string            `json:"sub"`
	Role      string            `json:"role"`
	Assurance erpwire.Assurance `json:"aal"`
	Expires   int64             `json:"exp"`
}

type authUser struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Factors []struct {
		Status string `json:"status"`
	} `json:"factors"`
}

// Cookie sessions retain the public Supabase SSR session serialization so the
// native data/key set does not need rotation or a parallel session backend.
// Tokens are private server-side request state, never model/source/profile DTOs.
type cookieSession struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at,omitempty"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	TokenType    string `json:"token_type,omitempty"`
}

type verifiedRequest struct {
	token    string
	identity erpwire.VerifiedIdentity
}

type verifiedRequestKey struct{}

func NewAuthenticator(config AuthConfig) (*Authenticator, error) {
	if config.Origin == "" || policy.AllowEndpoint(config.Origin) != nil {
		return nil, errors.New("Go authentication requires a configured loopback provider")
	}
	origin, err := url.Parse(config.Origin)
	if err != nil || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Opaque != "" {
		return nil, errors.New("invalid local authentication origin")
	}
	name := config.CookieName
	if name == "" {
		// auth-js derives its default key from the first hostname label. Native
		// browser API and GoTrue share the same loopback hostname.
		name = "sb-" + strings.Split(origin.Hostname(), ".")[0] + "-auth-token"
	}
	if err := (&http.Cookie{Name: name, Value: "session"}).Valid(); err != nil {
		return nil, errors.New("invalid authentication cookie name")
	}
	client := http.Client{Timeout: 10 * time.Second}
	if config.Client != nil {
		client = *config.Client
		if client.Timeout == 0 {
			client.Timeout = 10 * time.Second
		}
	}
	// A local provider redirect must never forward a bearer to another host.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	clock := config.Now
	if clock == nil {
		clock = time.Now
	}
	return &Authenticator{
		origin: strings.TrimRight(origin.String(), "/"), anonKey: config.AnonKey,
		cookieName: name, client: &client, now: clock,
	}, nil
}

// VerifyToken trusts claims only AFTER the very same bearer was authenticated
// through GoTrue's live /user endpoint. A decoded JWT alone grants no authority.
func (a *Authenticator) VerifyToken(ctx context.Context, token string) (erpwire.VerifiedIdentity, error) {
	claims, err := parseClaims(token)
	if err != nil || claims.Role != "authenticated" || uuid.Validate(claims.Subject) != nil || claims.Expires <= a.now().Unix() {
		return erpwire.VerifiedIdentity{}, erpwire.ErrUnauthenticated
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, a.origin+"/user", nil)
	if err != nil {
		return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	if a.anonKey != "" {
		request.Header.Set("apikey", a.anonKey)
	}
	response, err := a.client.Do(request)
	if err != nil {
		return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
			return erpwire.VerifiedIdentity{}, erpwire.ErrUnauthenticated
		}
		return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxUserBytes+1))
	if err != nil || len(body) > maxUserBytes {
		return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
	}
	var user authUser
	if json.Unmarshal(body, &user) != nil || uuid.Validate(user.ID) != nil {
		return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
	}
	if user.ID != claims.Subject {
		return erpwire.VerifiedIdentity{}, erpwire.ErrUnauthenticated
	}
	if claims.Assurance != erpwire.AAL1 && claims.Assurance != erpwire.AAL2 {
		return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
	}
	hasFactor := false
	for _, factor := range user.Factors {
		switch factor.Status {
		case "verified":
			hasFactor = true
		case "unverified":
		default:
			return erpwire.VerifiedIdentity{}, erpwire.ErrAuthUnavailable
		}
	}
	if claims.Expires <= a.now().Unix() {
		return erpwire.VerifiedIdentity{}, erpwire.ErrUnauthenticated
	}
	return erpwire.VerifiedIdentity{
		UserID: user.ID, Email: user.Email, Assurance: claims.Assurance,
		ExpiresAt:        time.Unix(claims.Expires, 0).UTC(),
		FactorStateKnown: true, HasVerifiedFactor: hasFactor,
	}, nil
}

func parseClaims(token string) (authClaims, error) {
	if len(token) == 0 || len(token) > maxJWTBytes {
		return authClaims{}, erpwire.ErrUnauthenticated
	}
	header, rest, ok := strings.Cut(token, ".")
	if !ok || header == "" {
		return authClaims{}, erpwire.ErrUnauthenticated
	}
	payloadPart, signature, ok := strings.Cut(rest, ".")
	if !ok || payloadPart == "" || signature == "" || strings.Contains(signature, ".") {
		return authClaims{}, erpwire.ErrUnauthenticated
	}
	payload, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return authClaims{}, erpwire.ErrUnauthenticated
	}
	var claims authClaims
	if json.Unmarshal(payload, &claims) != nil {
		return authClaims{}, erpwire.ErrUnauthenticated
	}
	return claims, nil
}

// RequestIdentity installs private request state only after live verification.
// MFA step-up is enforced when binding a business Actor; identity-only routes
// (factor challenge, onboarding) still need a verified signed-in subject.
func (a *Authenticator) RequestIdentity(request *http.Request) (context.Context, erpwire.VerifiedIdentity, error) {
	token, err := a.requestToken(request)
	if err != nil {
		return request.Context(), erpwire.VerifiedIdentity{}, err
	}
	identity, err := a.VerifyToken(request.Context(), token)
	if err != nil {
		return request.Context(), erpwire.VerifiedIdentity{}, err
	}
	state := &verifiedRequest{token: token, identity: identity}
	return context.WithValue(request.Context(), verifiedRequestKey{}, state), identity, nil
}

// reverify never treats the earlier request identity or model-supplied values as
// current authentication. Each later transaction sees live factor/user state.
func (a *Authenticator) reverify(ctx context.Context) (erpwire.VerifiedIdentity, error) {
	state, ok := ctx.Value(verifiedRequestKey{}).(*verifiedRequest)
	if !ok || state == nil || state.token == "" {
		return erpwire.VerifiedIdentity{}, erpwire.ErrUnauthenticated
	}
	identity, err := a.VerifyToken(ctx, state.token)
	if err != nil {
		return erpwire.VerifiedIdentity{}, err
	}
	if identity.UserID != state.identity.UserID {
		return erpwire.VerifiedIdentity{}, erpwire.ErrIdentityChanged
	}
	return identity, nil
}

func (a *Authenticator) requestToken(request *http.Request) (string, error) {
	if headers := request.Header.Values("Authorization"); len(headers) != 0 {
		if len(headers) != 1 {
			return "", erpwire.ErrUnauthenticated
		}
		scheme, token, ok := strings.Cut(headers[0], " ")
		token = strings.TrimSpace(token)
		if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" || len(token) > maxJWTBytes || strings.ContainsAny(token, " \t\r\n") {
			return "", erpwire.ErrUnauthenticated
		}
		return token, nil
	}
	session, err := a.readCookieSession(request)
	if err != nil || session.AccessToken == "" || len(session.AccessToken) > maxJWTBytes {
		return "", erpwire.ErrUnauthenticated
	}
	return session.AccessToken, nil
}

func (a *Authenticator) readCookieSession(request *http.Request) (cookieSession, error) {
	cookies := request.Cookies()
	find := func(name string) (string, error) {
		var value string
		found := false
		for _, cookie := range cookies {
			if cookie.Name == name {
				if found {
					return "", erpwire.ErrUnauthenticated
				}
				value, found = cookie.Value, true
			}
		}
		return value, nil
	}
	value, err := find(a.cookieName)
	if err != nil {
		return cookieSession{}, err
	}
	if value == "" {
		var joined strings.Builder
		for index := range 32 {
			chunk, err := find(a.cookieName + "." + strconv.Itoa(index))
			if err != nil {
				return cookieSession{}, err
			}
			if chunk == "" {
				break
			}
			if joined.Len()+len(chunk) > maxSessionBytes {
				return cookieSession{}, erpwire.ErrUnauthenticated
			}
			joined.WriteString(chunk)
		}
		value = joined.String()
	}
	if value == "" || len(value) > maxSessionBytes {
		return cookieSession{}, erpwire.ErrUnauthenticated
	}
	value, err = url.PathUnescape(value)
	if err != nil {
		return cookieSession{}, erpwire.ErrUnauthenticated
	}
	var body []byte
	if encoded, ok := strings.CutPrefix(value, "base64-"); ok {
		body, err = base64.RawURLEncoding.DecodeString(encoded)
		if err != nil {
			return cookieSession{}, erpwire.ErrUnauthenticated
		}
	} else {
		body = []byte(value)
	}
	var session cookieSession
	if json.Unmarshal(body, &session) != nil {
		return cookieSession{}, erpwire.ErrUnauthenticated
	}
	return session, nil
}
