package cutover

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Backup exports or restores one loopback database.
// export writes a custom dump and a sha256 sidecar into a directory the user chose.
// restore checks that sidecar before pg_restore starts.
func Backup(ctx context.Context, args []string, stdout io.Writer) error {
	return backup(ctx, args, stdout, "", RealRunner, time.Now)
}

func backup(ctx context.Context, args []string, stdout io.Writer, binDir string, run Runner, now func() time.Time) error {
	if len(args) == 0 {
		return errors.New("backup needs export or restore")
	}
	if run == nil {
		run = RealRunner
	}
	if now == nil {
		now = time.Now
	}
	switch args[0] {
	case "export":
		url, dir, err := backupFlags(args[1:], "--url", "--dir")
		if err != nil {
			return err
		}
		return exportBackup(ctx, url, dir, stdout, binDir, run, now)
	case "restore":
		url, file, err := backupFlags(args[1:], "--url", "--file")
		if err != nil {
			return err
		}
		return restoreBackup(ctx, url, file, stdout, binDir, run)
	default:
		return errors.New("backup needs export or restore")
	}
}

func backupFlags(args []string, urlFlag, otherFlag string) (string, string, error) {
	var url, other string
	for i := 0; i < len(args); i++ {
		flag := args[i]
		value := ""
		if flag != urlFlag && flag != otherFlag {
			if strings.HasPrefix(flag, urlFlag+"=") || strings.HasPrefix(flag, otherFlag+"=") {
				flag, value, _ = strings.Cut(flag, "=")
			} else {
				return "", "", errors.New("unknown backup flag")
			}
		}
		if value == "" {
			if i+1 >= len(args) {
				return "", "", fmt.Errorf("%s needs a value", flag)
			}
			i++
			value = args[i]
		}
		switch flag {
		case urlFlag:
			if url != "" {
				return "", "", errors.New("unknown backup flag")
			}
			url = value
		case otherFlag:
			if other != "" {
				return "", "", errors.New("unknown backup flag")
			}
			other = value
		default:
			return "", "", errors.New("unknown backup flag")
		}
	}
	if url == "" || other == "" {
		return "", "", errors.New("backup needs a local database and a folder or file")
	}
	return url, other, nil
}

func exportBackup(ctx context.Context, rawURL, dir string, stdout io.Writer, binDir string, run Runner, now func() time.Time) error {
	ep, err := ParseLocalURL(rawURL)
	if err != nil {
		return err
	}
	if err := safeBackupDir(dir); err != nil {
		return err
	}
	name := "boombignose-" + now().UTC().Format("20060102T150405Z") + ".dump"
	file := filepath.Join(dir, name)
	if err := safeDumpPath(file); err != nil {
		return err
	}
	if _, err := os.Stat(file); err == nil {
		return errors.New("backup path already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return errors.New("backup path is not a new file")
	}
	dumpBin, err := findTool(binDir, "pg_dump")
	if err != nil {
		return err
	}
	if err := dump(ctx, toolPaths{dump: dumpBin}, ep, file, run); err != nil {
		_ = os.Remove(file)
		return err
	}
	if err := dumpHeaderOK(file); err != nil {
		_ = os.Remove(file)
		return err
	}
	if err := writeChecksum(file); err != nil {
		_ = os.Remove(file)
		_ = os.Remove(file + ".sha256")
		return err
	}
	if _, err := fmt.Fprintf(stdout, "wrote %s\nchecksum %s\n", file, file+".sha256"); err != nil {
		return err
	}
	return nil
}

func restoreBackup(ctx context.Context, rawURL, file string, stdout io.Writer, binDir string, run Runner) error {
	ep, err := ParseLocalURL(rawURL)
	if err != nil {
		return err
	}
	if err := verifyChecksum(file); err != nil {
		return err
	}
	if err := dumpHeaderOK(file); err != nil {
		return err
	}
	restoreBin, err := findTool(binDir, "pg_restore")
	if err != nil {
		return err
	}
	if err := restore(ctx, toolPaths{restore: restoreBin}, ep, file, run); err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "restored backup into %s\n", ep.Label())
	return err
}

func safeBackupDir(path string) error {
	if path == "" || strings.ContainsAny(path, "\x00\r\n $`|&;<>*?\"'=") {
		return errors.New("backup folder is not a local directory")
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("backup folder is not a local directory")
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return errors.New("backup folder is not a local directory")
	}
	return nil
}

func writeChecksum(dumpPath string) error {
	sum, err := fileSHA256(dumpPath)
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	parent := filepath.Dir(dumpPath)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	defer root.Close()
	side, err := root.Create(filepath.Base(dumpPath) + ".sha256")
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	defer side.Close()
	_, err = fmt.Fprintf(side, "%s  %s\n", sum, filepath.Base(dumpPath))
	if err != nil {
		return errors.New("backup checksum could not be written")
	}
	return nil
}

func verifyChecksum(dumpPath string) error {
	if err := safeDumpPath(dumpPath); err != nil {
		return err
	}
	parent := filepath.Dir(dumpPath)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return errors.New("backup checksum is missing")
	}
	defer root.Close()
	side, err := root.Open(filepath.Base(dumpPath) + ".sha256")
	if err != nil {
		return errors.New("backup checksum is missing")
	}
	defer side.Close()
	body, err := io.ReadAll(io.LimitReader(side, 256))
	if err != nil {
		return errors.New("backup checksum does not match")
	}
	line := strings.TrimSuffix(string(body), "\n")
	if strings.Contains(line, "\n") {
		return errors.New("backup checksum does not match")
	}
	hexPart, name, ok := strings.Cut(line, "  ")
	if !ok || name != filepath.Base(dumpPath) || len(hexPart) != 64 {
		return errors.New("backup checksum does not match")
	}
	sum, err := fileSHA256(dumpPath)
	if err != nil {
		return errors.New("backup checksum does not match")
	}
	if subtle.ConstantTimeCompare([]byte(hexPart), []byte(sum)) != 1 {
		return errors.New("backup checksum does not match")
	}
	return nil
}

func fileSHA256(dumpPath string) (string, error) {
	parent := filepath.Dir(dumpPath)
	root, err := os.OpenRoot(parent)
	if err != nil {
		return "", err
	}
	defer root.Close()
	file, err := root.Open(filepath.Base(dumpPath))
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
