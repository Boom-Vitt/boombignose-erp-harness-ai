package update

import (
	"errors"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	// MacOSAsset is the only file this helper will replace the running app with.
	MacOSAsset = "BoomBigNose-macos-arm64.dmg"
	// SumsName is the checksum file published next to the installers.
	SumsName    = "SHA256SUMS"
	releaseRepo = "Boom-Vitt/nose-erp"
)

var (
	errVersion = errors.New("refusing update version")
	errRoot    = errors.New("refusing install location")
	semverRE   = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
	hashLineRE = regexp.MustCompile(`^([a-fA-F0-9]{64}) [ *](\S+)$`)
	mountRE    = regexp.MustCompile(`<key>mount-point</key>\s*<string>(/Volumes/[^<]+)</string>`)
)

// SumsURL is the checksum file for one boombignose-v* tag. The version is a semver.
func SumsURL(version string) (string, error) {
	if !semverRE.MatchString(version) {
		return "", errVersion
	}
	return "https://github.com/" + releaseRepo + "/releases/download/boombignose-v" + version + "/" + SumsName, nil
}

// Newer reports whether version is a semver greater than current.
func Newer(version, current string) bool {
	left, ok := parts(version)
	if !ok {
		return false
	}
	right, ok := parts(current)
	if !ok {
		return false
	}
	for i := 0; i < 3; i++ {
		if left[i] != right[i] {
			return left[i] > right[i]
		}
	}
	return false
}

func parts(value string) ([3]int, bool) {
	var out [3]int
	if !semverRE.MatchString(value) {
		return out, false
	}
	fields := strings.Split(value, ".")
	for i := 0; i < 3; i++ {
		n, err := strconv.Atoi(fields[i])
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// ParseSums returns the lowercase SHA-256 for file. A malformed line or two
// different hashes for that file fail closed.
func ParseSums(text, file string) (string, error) {
	if file != MacOSAsset && file != SumsName && file != "BoomBigNose-windows-x64-setup.exe" && file != "BoomBigNose-linux-amd64.tar.gz" && file != "BoomBigNose-linux-amd64.AppImage" {
		return "", errors.New("refusing checksum name")
	}
	if text == "" || len(text) > 100_000 {
		return "", errors.New("refusing checksum file")
	}
	found := ""
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		match := hashLineRE.FindStringSubmatch(line)
		if match == nil {
			return "", errors.New("refusing checksum file")
		}
		if match[2] != file {
			continue
		}
		hash := strings.ToLower(match[1])
		if found != "" && found != hash {
			return "", errors.New("refusing checksum file")
		}
		found = hash
	}
	if found == "" {
		return "", errors.New("refusing checksum file")
	}
	return found, nil
}

// ParseMountPoint reads an hdiutil -plist mount path under /Volumes.
func ParseMountPoint(plist []byte) (string, error) {
	match := mountRE.FindSubmatch(plist)
	if match == nil {
		return "", errors.New("disk image did not mount")
	}
	point := string(match[1])
	if strings.Contains(point, "..") || strings.ContainsAny(point, "\r\n") {
		return "", errors.New("disk image did not mount")
	}
	cleaned := filepath.Clean(point)
	if cleaned != point || !strings.HasPrefix(cleaned, "/Volumes/") {
		return "", errors.New("disk image did not mount")
	}
	return cleaned, nil
}

// InstallRootFrom is the folder that contains BoomBigNose.app or the raw binary.
// System prefixes are refused. The returned path is where bundle/ is replaced.
func InstallRootFrom(exe string) (string, error) {
	exe = filepath.Clean(exe)
	slash := filepath.ToSlash(exe)
	var root string
	if i := strings.Index(slash, ".app/Contents/MacOS/"); i >= 0 {
		app := slash[:i+len(".app")]
		root = filepath.Clean(filepath.FromSlash(path.Dir(app)))
	} else {
		root = filepath.Dir(exe)
	}
	if !filepath.IsAbs(root) || forbiddenRoot(root) {
		return "", errRoot
	}
	return root, nil
}

func forbiddenRoot(root string) bool {
	clean := filepath.Clean(root)
	switch clean {
	case "/", "/System", "/usr", "/bin", "/sbin", "/private", "/Library", "/etc", "/var", "/opt":
		return true
	}
	slash := filepath.ToSlash(clean) + "/"
	for _, prefix := range []string{"/System/", "/usr/", "/bin/", "/sbin/", "/private/", "/etc/", "/var/"} {
		if strings.HasPrefix(slash, prefix) {
			return true
		}
	}
	return false
}

// DownloadHostAllowed is the GitHub host list for a release-asset redirect.
func DownloadHostAllowed(host string) bool {
	switch strings.ToLower(host) {
	case "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		return true
	default:
		return false
	}
}
