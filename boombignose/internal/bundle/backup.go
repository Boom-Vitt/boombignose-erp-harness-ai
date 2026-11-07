package bundle

import (
	"os"
	"path/filepath"
)

// BackupPasswordFile returns a private libpq credential file scoped to exactly
// this native host/port/database/user. No URL/argument contains the password.
// Explicit generic loopback backups remain usable when no native credentials
// exist; that path cannot authenticate to a secured native database.
func BackupPasswordFile(data string) (string, error) {
	if _, err := os.Lstat(passwordPath(data)); os.IsNotExist(err) {
		return "", nil
	} else if err != nil {
		return "", err
	}
	if _, err := configuredPort("BOOMBIGNOSE_PG_PORT", defaultPGPort); err != nil {
		return "", err
	}
	credentials, err := loadDBCredentials(data, false)
	if err != nil {
		return "", err
	}
	body := []byte("127.0.0.1:" + pgPort() + ":boombignose:boombignose:" + credentials.admin + "\n")
	if err := writeDataFile(secretsDir(data), "backup.pgpass", body); err != nil {
		return "", err
	}
	return filepath.Join(secretsDir(data), "backup.pgpass"), nil
}
