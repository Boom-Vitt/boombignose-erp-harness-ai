package networkcollector

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/netip"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxObservations = 500

var safeProcess = regexp.MustCompile(`^[A-Za-z0-9_.+-]+$`)
var safeZone = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,32}$`)

// Observation is an allowlist, not an arbitrary log or a claim of TCP initiation.
type Observation struct {
	ID            string `json:"id"`
	LocalAddress  string `json:"localAddress"`
	LocalPort     uint16 `json:"localPort"`
	RemoteAddress string `json:"remoteAddress"`
	RemotePort    uint16 `json:"remotePort"`
	Protocol      string `json:"protocol"`
	Process       string `json:"process"`
	PID           int    `json:"pid"`
}

// Report describes one current-user TCP snapshot. Empty snapshots do not prove
// that no traffic occurred; short-lived connections can fall between snapshots.
type Report struct {
	CapturedAt   string        `json:"capturedAt"`
	Coverage     string        `json:"coverage"`
	Observations []Observation `json:"observations"`
	Truncated    bool          `json:"truncated"`
}

func parseEndpoint(value string) (string, uint16, bool) {
	host, portText, err := net.SplitHostPort(value)
	if err != nil {
		return "", 0, false
	}
	address, err := netip.ParseAddr(host)
	if err != nil || strings.ContainsAny(portText, "+- \t\r\n") {
		return "", 0, false
	}
	if address.Zone() != "" {
		if !address.Is6() || !safeZone.MatchString(address.Zone()) {
			return "", 0, false
		}
		address = address.WithZone("")
	}
	if strings.HasPrefix(value, "[") && !address.Is6() {
		return "", 0, false
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil || port == 0 {
		return "", 0, false
	}
	return address.String(), uint16(port), true
}

func parseSnapshot(raw string, capturedAt time.Time) Report {
	report := Report{
		CapturedAt:   capturedAt.UTC().Format(time.RFC3339Nano),
		Coverage:     "current_user_tcp_snapshot",
		Observations: make([]Observation, 0),
	}
	seen := make(map[string]struct{})
	pid := 0
	process := "unknown"
	for line := range strings.SplitSeq(raw, "\n") {
		if len(line) == 0 {
			continue
		}
		switch line[0] {
		case 'p':
			pid = 0
			process = "unknown"
			candidate, err := strconv.ParseUint(line[1:], 10, 31)
			if err == nil && candidate > 0 {
				pid = int(candidate)
			}
		case 'c':
			process = "unknown"
			// lsof's command field is not an argv source. Never retain any
			// whitespace suffix even if a malformed source includes arguments.
			fields := strings.Fields(line[1:])
			if len(fields) > 0 {
				name := path.Base(fields[0])
				if safeProcess.MatchString(name) {
					if len(name) > 64 {
						name = name[:64]
					}
					process = name
				}
			}
		case 'n':
			if pid == 0 {
				continue
			}
			local, remote, found := strings.Cut(line[1:], "->")
			if !found {
				continue
			}
			localAddress, localPort, localOK := parseEndpoint(local)
			remoteAddress, remotePort, remoteOK := parseEndpoint(remote)
			if !localOK || !remoteOK {
				continue
			}
			observation := Observation{LocalAddress: localAddress, LocalPort: localPort,
				RemoteAddress: remoteAddress, RemotePort: remotePort,
				Protocol: "tcp", Process: process, PID: pid}
			// Hash only allowlisted, normalized fields, never raw lsof records.
			encoded, _ := json.Marshal(observation)
			digest := sha256.Sum256(encoded)
			observation.ID = "socket_" + hex.EncodeToString(digest[:20])
			if _, exists := seen[observation.ID]; exists {
				continue
			}
			seen[observation.ID] = struct{}{}
			if len(report.Observations) == maxObservations {
				report.Truncated = true
				continue
			}
			report.Observations = append(report.Observations, observation)
		}
	}
	return report
}
