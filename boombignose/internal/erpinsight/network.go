package erpinsight

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (s *Service) networkOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{"app/(app)/network/page.tsx::load": s.networkPage}
}

type NetworkObservation struct {
	ID            string `json:"id"`
	LocalAddress  string `json:"localAddress"`
	LocalPort     int64  `json:"localPort"`
	RemoteAddress string `json:"remoteAddress"`
	RemotePort    int64  `json:"remotePort"`
	Protocol      string `json:"protocol"`
	Process       string `json:"process"`
	PID           int64  `json:"pid"`
}
type CollectorReport struct {
	CapturedAt   string               `json:"capturedAt"`
	Coverage     string               `json:"coverage"`
	Observations []NetworkObservation `json:"observations"`
	Truncated    bool                 `json:"truncated"`
}
type NetworkDevice struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	CreatedAt  string           `json:"createdAt"`
	LastSeenAt any              `json:"lastSeenAt"`
	RevokedAt  any              `json:"revokedAt"`
	Report     *CollectorReport `json:"report"`
}
type NetworkPolicy struct {
	AllowedCIDRs []string `json:"allowedCidrs"`
}
type NetworkSnapshot struct {
	Devices    []NetworkDevice `json:"devices"`
	Policy     NetworkPolicy   `json:"policy"`
	ServerTime string          `json:"serverTime"`
}
type NetworkPageData struct {
	Initial   NetworkSnapshot `json:"initial"`
	AppOrigin string          `json:"appOrigin"`
}

var networkCapturedAt = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)
var networkObservationID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
var networkProcess = regexp.MustCompile(`^[A-Za-z0-9_.+\-]{1,80}$`)

func networkCaptureTime(stamp string) (time.Time, bool) {
	if !networkCapturedAt.MatchString(stamp) {
		return time.Time{}, false
	}
	part := func(from, to int) int { n, _ := strconv.Atoi(stamp[from:to]); return n }
	year, month, day, hour, minute, second := part(0, 4), part(5, 7), part(8, 10), part(11, 13), part(14, 16), part(17, 19)
	if month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 59 {
		return time.Time{}, false
	}
	rest := stamp[19:]
	nanos := 0
	if strings.HasPrefix(rest, ".") {
		end := strings.IndexAny(rest, "Z+-")
		fraction := rest[1:end]
		nanos, _ = strconv.Atoi(fraction + strings.Repeat("0", 9-len(fraction)))
		rest = rest[end:]
	}
	if hour == 24 && (minute != 0 || second != 0 || nanos != 0) {
		return time.Time{}, false
	}
	offset := 0
	if rest != "Z" {
		hours, _ := strconv.Atoi(rest[1:3])
		minutes, _ := strconv.Atoi(rest[4:6])
		if hours > 23 || minutes > 59 {
			return time.Time{}, false
		}
		offset = (hours*60 + minutes) * 60
		if rest[0] == '-' {
			offset = -offset
		}
	}
	// Date.parse normalizes ISO day overflow and a midnight written as 24:00.
	return time.Date(year, time.Month(month), day, hour, minute, second, nanos, time.FixedZone("", offset)), true
}

func networkInteger(value any, min, max int64) (int64, bool) {
	if _, ok := value.(string); ok {
		return 0, false
	}
	n, ok := auditExactInteger(value)
	return n, ok && n >= min && n <= max
}
func networkAddress(value any) (string, bool) {
	s, ok := value.(string)
	return s, ok && len(s) <= 45 && !strings.Contains(s, "%") && net.ParseIP(s) != nil
}
func parseCollectorReport(value any) *CollectorReport {
	row := auditRecord(value)
	stamp, ok := row["capturedAt"].(string)
	if !ok || len(stamp) > 40 || !networkCapturedAt.MatchString(stamp) || text(row["coverage"]) != "current_user_tcp_snapshot" {
		return nil
	}
	captured, ok := networkCaptureTime(stamp)
	if !ok {
		return nil
	}
	truncated, ok := row["truncated"].(bool)
	if !ok {
		return nil
	}
	items, ok := row["observations"].([]any)
	if !ok || len(items) > 500 {
		return nil
	}
	out := &CollectorReport{CapturedAt: captured.UTC().Format("2006-01-02T15:04:05.000Z"), Coverage: "current_user_tcp_snapshot", Truncated: truncated, Observations: []NetworkObservation{}}
	ids := map[string]bool{}
	for _, value := range items {
		item := auditRecord(value)
		id := text(item["id"])
		process := text(item["process"])
		if !networkObservationID.MatchString(id) || ids[id] || text(item["protocol"]) != "tcp" || !networkProcess.MatchString(process) {
			return nil
		}
		local, ok := networkAddress(item["localAddress"])
		if !ok {
			return nil
		}
		remote, ok := networkAddress(item["remoteAddress"])
		if !ok {
			return nil
		}
		localPort, ok := networkInteger(item["localPort"], 1, 65535)
		if !ok {
			return nil
		}
		remotePort, ok := networkInteger(item["remotePort"], 1, 65535)
		if !ok {
			return nil
		}
		pid, ok := networkInteger(item["pid"], 1, 2147483647)
		if !ok {
			return nil
		}
		ids[id] = true
		out.Observations = append(out.Observations, NetworkObservation{ID: id, LocalAddress: local, LocalPort: localPort, RemoteAddress: remote, RemotePort: remotePort, Protocol: "tcp", Process: process, PID: pid})
	}
	return out
}
func (s *Service) networkPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if a.Role() != erpwire.Owner && a.Role() != erpwire.Admin {
		return nil, erpwire.ErrForbidden
	}
	out := NetworkPageData{AppOrigin: s.appOrigin, Initial: NetworkSnapshot{Devices: []NetworkDevice{}, Policy: NetworkPolicy{AllowedCIDRs: []string{}}, ServerTime: s.now().UTC().Format("2006-01-02T15:04:05.000Z")}}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		devices, e := all(ctx, tx, selection(a, "network_devices", []string{"id", "name", "created_at", "last_received_at", "revoked_at", "latest_report"}))
		if e != nil {
			return e
		}
		policyQuery := selection(a, "network_policy", []string{"allowed_cidrs"})
		policyQuery.Order = []erpwire.Order{{Column: "org_id"}}
		policy, e := one(ctx, tx, policyQuery)
		if e != nil {
			return e
		}
		if policy != nil && policy["allowed_cidrs"] != nil {
			data, e := json.Marshal(policy["allowed_cidrs"])
			if e != nil {
				return e
			}
			if erpwire.DecodeJSON(data, &out.Initial.Policy.AllowedCIDRs) != nil {
				return errors.New("Could not load network visibility.")
			}
		}
		for _, device := range devices {
			out.Initial.Devices = append(out.Initial.Devices, NetworkDevice{ID: text(device["id"]), Name: text(device["name"]), CreatedAt: text(device["created_at"]), LastSeenAt: device["last_received_at"], RevokedAt: device["revoked_at"], Report: parseCollectorReport(device["latest_report"])})
		}
		return nil
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		return nil, errors.New("Could not load network visibility.")
	}
	return out, nil
}
