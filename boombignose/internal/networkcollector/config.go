package networkcollector

import (
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const maxConfigBytes = 16 * 1024

var bareOrigin = regexp.MustCompile(`^https?://(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?/?$`)
var deviceIdentity = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var deviceCredential = regexp.MustCompile(`^[A-Za-z0-9_-]{32,512}$`)

var errConfig = errors.New("invalid collector config: require a private current-user-owned regular file, HTTPS ERP origin (HTTP loopback only), and valid device identity/credential")

type config struct {
	ERPURL      string `json:"erpUrl"`
	DeviceID    string `json:"deviceId"`
	DeviceToken string `json:"deviceToken"`
}

func parseConfig(raw []byte) (config, error) {
	var cfg config
	if len(raw) > maxConfigBytes || json.Unmarshal(raw, &cfg) != nil || !bareOrigin.MatchString(cfg.ERPURL) || len(cfg.ERPURL) > 2048 || !deviceIdentity.MatchString(cfg.DeviceID) || !deviceCredential.MatchString(cfg.DeviceToken) {
		return config{}, errConfig
	}
	target, err := url.Parse(cfg.ERPURL)
	if err != nil || target.User != nil || target.RawQuery != "" || target.Fragment != "" || (target.Path != "" && target.Path != "/") {
		return config{}, errConfig
	}
	host := strings.ToLower(target.Hostname())
	address, addressErr := netip.ParseAddr(host)
	if strings.HasPrefix(target.Host, "[") && (addressErr != nil || !address.Is6()) {
		return config{}, errConfig
	}
	loopback := host == "localhost" || (addressErr == nil && address.IsLoopback())
	if target.Scheme != "https" && !(target.Scheme == "http" && loopback) {
		return config{}, errConfig
	}
	if target.Port() != "" {
		port, err := strconv.ParseUint(target.Port(), 10, 16)
		if err != nil || port == 0 {
			return config{}, errConfig
		}
	}
	target.Path = ""
	cfg.ERPURL = target.String()
	return cfg, nil
}

func loadConfig(name string) (config, error) {
	if !filepath.IsAbs(name) {
		return config{}, errConfig
	}
	before, err := os.Lstat(name)
	if err != nil || !before.Mode().IsRegular() {
		return config{}, errConfig
	}
	file, err := openPrivateConfig(name)
	if err != nil {
		return config{}, errConfig
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !os.SameFile(before, stat) || !stat.Mode().IsRegular() || stat.Mode().Perm() & ^os.FileMode(0o600) != 0 || stat.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || stat.Size() > maxConfigBytes {
		return config{}, errConfig
	}
	raw, err := io.ReadAll(io.LimitReader(file, maxConfigBytes+1))
	if err != nil {
		return config{}, errConfig
	}
	return parseConfig(raw)
}
