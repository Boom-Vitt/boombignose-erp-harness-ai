package bundle

import (
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type persistedRuntime struct {
	PublicOrigin    string   `json:"publicOrigin"`
	OperatorUserIDs []string `json:"operatorUserIds,omitempty"`
}

// ConfigurePublicOrigin persists only this reviewed setting. It neither enrolls
// a tunnel nor starts/rebinds a server. "off" removes the public front door.
func ConfigurePublicOrigin(data, value string) error {
	if value == "off" {
		value = ""
	}
	origin, err := PublicOrigin(value)
	if err != nil {
		return err
	}
	cfg, err := readPersistedRuntime(data)
	if err != nil {
		return err
	}
	cfg.PublicOrigin = origin
	return saveRuntimeConfig(data, cfg)
}

// ConfigureOperators is an OS-owner action, never an ERP/browser setting.
func ConfigureOperators(data string, ids []string) error {
	values, err := canonicalOperators(ids)
	if err != nil {
		return err
	}
	cfg, err := readPersistedRuntime(data)
	if err != nil {
		return err
	}
	cfg.OperatorUserIDs = values
	return saveRuntimeConfig(data, cfg)
}

func saveRuntimeConfig(data string, cfg persistedRuntime) error {
	if !filepath.IsAbs(data) {
		return errors.New("native data directory must be absolute")
	}
	parent := secretsDir(data)
	if err := privateDirectory(parent); err != nil {
		return err
	}
	body, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(parent, ".boombignose-runtime-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = hardenCreated(name); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Chmod(0o600); err == nil {
		_, err = file.Write(append(body, '\n'))
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, filepath.Join(parent, "runtime.json"))
}

// LoadRuntimeConfig is called before either GUI or CLI startup so Launch
// Services does not need shell environment inheritance. An explicit env value
// takes precedence; all values pass the same strict origin validation.
func LoadRuntimeConfig() error {
	explicitOrigin := os.Getenv("BOOMBIGNOSE_PUBLIC_ORIGIN")
	if _, err := PublicOrigin(explicitOrigin); err != nil {
		return err
	}
	data, err := DataDir()
	if err != nil {
		return err
	}
	cfg, err := readPersistedRuntime(data)
	if err != nil {
		return err
	}
	// Operator authority is never inherited from shell/Launch Services env.
	if err := os.Unsetenv("BOOMBIGNOSE_OPERATOR_USER_IDS"); err != nil {
		return err
	}
	if explicitOrigin == "" {
		return os.Setenv("BOOMBIGNOSE_PUBLIC_ORIGIN", cfg.PublicOrigin)
	}
	return nil
}

func readPersistedRuntime(data string) (persistedRuntime, error) {
	var cfg persistedRuntime
	if !filepath.IsAbs(data) {
		return cfg, errors.New("native data directory must be absolute")
	}
	if _, err := os.Lstat(secretsDir(data)); os.IsNotExist(err) {
		return cfg, nil
	} else if err != nil {
		return cfg, err
	}
	if err := privateDirectory(secretsDir(data)); err != nil {
		return cfg, err
	}
	body, err := privateRead(filepath.Join(secretsDir(data), "runtime.json"))
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, errors.New("private native runtime configuration could not be read")
	}
	if json.Unmarshal(body, &cfg) != nil {
		return persistedRuntime{}, errors.New("invalid native runtime configuration")
	}
	cfg.PublicOrigin, err = PublicOrigin(cfg.PublicOrigin)
	if err != nil {
		return persistedRuntime{}, err
	}
	cfg.OperatorUserIDs, err = canonicalOperators(cfg.OperatorUserIDs)
	if err != nil {
		return persistedRuntime{}, err
	}
	return cfg, nil
}

func canonicalOperators(ids []string) ([]string, error) {
	if len(ids) > 16 {
		return nil, errors.New("configure at most 16 native operator user UUIDs")
	}
	values := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, raw := range ids {
		id, err := uuid.Parse(raw)
		if err != nil || len(raw) != 36 || id == uuid.Nil {
			return nil, errors.New("native operators must be explicit nonzero user UUIDs")
		}
		value := id.String()
		if !seen[value] {
			values = append(values, value)
			seen[value] = true
		}
	}
	sort.Strings(values)
	return values, nil
}

func nativeOperatorIDs(data string) (string, error) {
	if data == "" {
		return "", nil
	}
	cfg, err := readPersistedRuntime(data)
	if err != nil {
		return "", err
	}
	return strings.Join(cfg.OperatorUserIDs, ","), nil
}
