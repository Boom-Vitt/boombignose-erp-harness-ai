package bundle

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Secrets live beside (not inside) PGDATA so initdb can use an empty directory.
// They are part of the backup/recovery set, never process arguments or logs.
type dbCredentials struct{ admin, auth, rest string }

var databaseCredentials = struct {
	sync.RWMutex
	values map[string]dbCredentials
}{values: make(map[string]dbCredentials)}

func secretsDir(data string) string   { return data + ".secrets" }
func passwordPath(data string) string { return filepath.Join(secretsDir(data), "admin.password") }

func privateDirectory(path string) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		if err = os.MkdirAll(path, 0o700); err != nil {
			return err
		}
		if err = hardenCreated(path); err != nil {
			return err
		}
		info, err = os.Lstat(path)
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !currentOwner(path, info) || !privateMode(info) {
		return errors.New("native data requires a private current-user-owned directory (0700/private ACL); refusing to change unrelated permissions")
	}
	return nil
}
func privateRead(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || !currentOwner(path, info) || !privateMode(info) {
		return nil, errors.New("database credential must be a private current-user-owned regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	after, err := f.Stat()
	if err != nil || !os.SameFile(info, after) || after.Size() > 1024 {
		return nil, errors.New("database credential changed or is invalid")
	}
	body := make([]byte, after.Size())
	_, err = f.ReadAt(body, 0)
	return body, err
}

func loadDBCredentials(data string, create bool) (dbCredentials, error) {
	var result dbCredentials
	if err := privateDirectory(secretsDir(data)); err != nil {
		return result, err
	}
	for _, item := range []struct {
		name string
		dest *string
	}{{"admin.password", &result.admin}, {"auth.password", &result.auth}, {"rest.password", &result.rest}} {
		path := filepath.Join(secretsDir(data), item.name)
		body, err := privateRead(path)
		if os.IsNotExist(err) && create {
			bytes := make([]byte, 32)
			if _, err = rand.Read(bytes); err != nil {
				return result, err
			}
			value := hex.EncodeToString(bytes)
			f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if e != nil {
				return result, e
			}
			if e = hardenCreated(path); e != nil {
				_ = f.Close()
				return result, e
			}
			_, e = f.WriteString(value + "\n")
			if e == nil {
				e = f.Sync()
			}
			closeErr := f.Close()
			if e != nil {
				return result, e
			}
			if closeErr != nil {
				return result, closeErr
			}
			body = []byte(value)
		} else if err != nil {
			return result, errors.New("private database credentials are unavailable; use the documented secure-db migration for an owned legacy cluster")
		}
		value := strings.TrimSpace(string(body))
		if len(value) != 64 {
			return result, errors.New("invalid private database credential")
		}
		if _, err := hex.DecodeString(value); err != nil {
			return result, errors.New("invalid private database credential")
		}
		*item.dest = value
	}
	return result, nil
}
func rememberCredentials(addr string, credentials dbCredentials) {
	databaseCredentials.Lock()
	databaseCredentials.values[addr] = credentials
	databaseCredentials.Unlock()
}
func passwordFor(addr, user string) string {
	databaseCredentials.RLock()
	credentials := databaseCredentials.values[addr]
	databaseCredentials.RUnlock()
	switch user {
	case "boombignose":
		return credentials.admin
	case "boombignose_auth":
		return credentials.auth
	case "boombignose_rest":
		return credentials.rest
	}
	return ""
}

func secureClusterMarker(data string) string { return filepath.Join(secretsDir(data), "cluster.path") }
func markSecureCluster(data string) error {
	return writeDataFile(secretsDir(data), "cluster.path", []byte(filepath.Clean(data)+"\n"))
}
func isSecureCluster(data string) bool {
	value, err := privateRead(secureClusterMarker(data))
	return err == nil && strings.TrimSpace(string(value)) == filepath.Clean(data)
}
