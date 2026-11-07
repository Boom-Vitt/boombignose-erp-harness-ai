package bundle

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/policy"
)

// RuntimeConfig keeps every private service on a distinct loopback port. Only
// the explicitly configured HTTPS front door is advertised to remote clients.
type RuntimeConfig struct {
	ERPOrigin    string
	PublicOrigin string
	APIPort      string
	AuthPort     string
	RESTPort     string
	PGPort       string
}

func configuredPort(key, fallback string) (string, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != value {
		return "", fmt.Errorf("%s must be a decimal port from 1 to 65535", key)
	}
	return value, nil
}

func servicePort(key, fallback string) string {
	value, _ := configuredPort(key, fallback)
	return value // Invalid configuration never falls back to an installed stack.
}
func apiPort() string  { return servicePort("BOOMBIGNOSE_API_PORT", localAPIPort) }
func authPort() string { return servicePort("BOOMBIGNOSE_AUTH_PORT", localAuthPort) }
func restPort() string { return servicePort("BOOMBIGNOSE_REST_PORT", localRESTPort) }

// PublicOrigin accepts a bare HTTPS origin, not an arbitrary redirect URL.
func PublicOrigin(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	u, err := url.Parse(value)
	if err != nil || strings.TrimSpace(value) != value || strings.ContainsAny(value, "\\\r\n\x00?#") || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return "", errors.New("BOOMBIGNOSE_PUBLIC_ORIGIN must be a bare trusted HTTPS origin without credentials, path, query or fragment")
	}
	if !originHost(u.Hostname()) {
		return "", errors.New("BOOMBIGNOSE_PUBLIC_ORIGIN requires an exact DNS hostname or IP, not a wildcard")
	}
	if u.Port() != "" {
		n, e := strconv.Atoi(u.Port())
		if e != nil || n < 1 || n > 65535 || strconv.Itoa(n) != u.Port() {
			return "", errors.New("BOOMBIGNOSE_PUBLIC_ORIGIN has an invalid port")
		}
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", errors.New("BOOMBIGNOSE_PUBLIC_ORIGIN has an invalid port")
	}
	return u.String(), nil
}

func originHost(host string) bool {
	if net.ParseIP(host) != nil {
		return true
	}
	if len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if c != '-' && (c < '0' || c > '9') && (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') {
				return false
			}
		}
	}
	return true
}

func ValidateConfig(rawERP string) (RuntimeConfig, error) {
	var cfg RuntimeConfig
	if err := policy.AllowEndpoint(rawERP); err != nil {
		return cfg, err
	}
	u, err := url.Parse(rawERP)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" || u.Port() == "" {
		return cfg, errors.New("ERP URL must be a loopback origin with an explicit port")
	}
	n, err := strconv.Atoi(u.Port())
	if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != u.Port() {
		return cfg, errors.New("ERP URL has an invalid port")
	}
	cfg.ERPOrigin = u.Scheme + "://" + u.Host
	cfg.PublicOrigin, err = PublicOrigin(os.Getenv("BOOMBIGNOSE_PUBLIC_ORIGIN"))
	if err != nil {
		return cfg, err
	}
	seen := map[string]bool{u.Port(): true}
	for _, entry := range []struct {
		key, fallback string
		dest          *string
	}{
		{"BOOMBIGNOSE_API_PORT", localAPIPort, &cfg.APIPort},
		{"BOOMBIGNOSE_AUTH_PORT", localAuthPort, &cfg.AuthPort},
		{"BOOMBIGNOSE_REST_PORT", localRESTPort, &cfg.RESTPort},
		{"BOOMBIGNOSE_PG_PORT", defaultPGPort, &cfg.PGPort},
	} {
		port, err := configuredPort(entry.key, entry.fallback)
		if err != nil {
			return cfg, err
		}
		if seen[port] {
			return cfg, errors.New("ERP, API, Auth, REST and PostgreSQL ports must be distinct")
		}
		seen[port] = true
		*entry.dest = port
	}
	if v := os.Getenv("BOOMBIGNOSE_ALLOW_SIGNUP"); v != "" && v != "0" && v != "1" {
		return cfg, errors.New("BOOMBIGNOSE_ALLOW_SIGNUP must be 0 or 1")
	}
	return cfg, nil
}

func (cfg RuntimeConfig) AppOrigin() string {
	if cfg.PublicOrigin != "" {
		return cfg.PublicOrigin
	}
	return cfg.ERPOrigin
}

func (cfg RuntimeConfig) SignupAllowed() bool {
	return cfg.PublicOrigin == "" && os.Getenv("BOOMBIGNOSE_ALLOW_SIGNUP") != "0"
}

func preflightPorts(cfg RuntimeConfig, dataDir string) error {
	for _, port := range []string{cfg.APIPort, cfg.AuthPort, cfg.RESTPort, cfg.PGPort, mustERPPort(cfg.ERPOrigin)} {
		if port == cfg.PGPort && ourCluster(dataDir, port) {
			continue
		}
		ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
		if err != nil {
			return fmt.Errorf("private stack port %s is unavailable; choose distinct BOOMBIGNOSE ports (no existing service was stopped)", port)
		}
		_ = ln.Close()
	}
	return nil
}
func mustERPPort(origin string) string { u, _ := url.Parse(origin); return u.Port() }
