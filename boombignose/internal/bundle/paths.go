package bundle

import (
	"errors"
	"os"
	"path/filepath"
)

// canonicalPath resolves an existing ancestor before joining missing leaves.
// This keeps a fresh profile canonical on macOS (/var -> /private/var), without
// creating it or accepting a broken symlink as a future data directory.
func canonicalPath(value string) (string, error) {
	path, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	var missing []string
	for {
		resolved, err := filepath.EvalSymlinks(path)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		if info, statErr := os.Lstat(path); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("native profile contains an unresolved symlink")
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", err
		}
		missing = append(missing, filepath.Base(path))
		path = parent
	}
}
