package networkcollector

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

var captureTime = time.Date(2026, 11, 6, 1, 2, 3, 0, time.UTC)

const socketLine = "n192.0.2.10:49152->198.51.100.20:443"

func TestEmptySnapshot(t *testing.T) {
	report := parseSnapshot("", captureTime)
	if report.CapturedAt != "2026-11-06T01:02:03Z" || report.Coverage != "current_user_tcp_snapshot" || report.Truncated || len(report.Observations) != 0 {
		t.Fatal("invalid empty snapshot metadata")
	}
	encoded, _ := json.Marshal(report)
	if !strings.Contains(string(encoded), `"observations":[]`) {
		t.Fatal("empty observations must be an array, not null")
	}
}

func TestSnapshotMetadataProjection(t *testing.T) {
	report := parseSnapshot("p123\nc/usr/bin/node --password=never-retain\nf12\n"+socketLine+"\n", captureTime)
	if len(report.Observations) != 1 {
		t.Fatal("expected one TCP socket")
	}
	observation := report.Observations[0]
	want := Observation{ID: observation.ID, LocalAddress: "192.0.2.10", LocalPort: 49152, RemoteAddress: "198.51.100.20", RemotePort: 443, Protocol: "tcp", Process: "node", PID: 123}
	if observation != want || len(observation.ID) != len("socket_")+40 || !strings.HasPrefix(observation.ID, "socket_") {
		t.Fatal("incorrect socket metadata")
	}
	encoded, _ := json.Marshal(report)
	for _, forbidden := range []string{"password", "never-retain", "/usr/bin", "bytes", "direction", "outcome", "rawLog"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatal("unexpected metadata field or argument retained")
		}
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(encoded, &fields)
	if len(fields) != 4 {
		t.Fatal("report must expose only its four allowlisted fields")
	}
}

func TestIPv6AndScopes(t *testing.T) {
	report := parseSnapshot("p9\ncnode\nn[FE80::1%en0]:443->[2001:DB8::2]:65535\nn[::1]:1->[::1]:2\n", captureTime)
	if len(report.Observations) != 2 {
		t.Fatal("expected IPv6 sockets")
	}
	if report.Observations[0].LocalAddress != "fe80::1" || report.Observations[0].RemoteAddress != "2001:db8::2" || report.Observations[1].LocalAddress != "::1" {
		t.Fatal("IPv6 addresses must normalize and omit validated interface scope")
	}
}

func TestMultipleProcessesAndSockets(t *testing.T) {
	report := parseSnapshot("p10\ncfirst\n"+socketLine+"\nn192.0.2.10:49153->203.0.113.1:22\np11\ncsecond\n"+socketLine+"\np12\n"+socketLine, captureTime)
	var names []string
	var pids []int
	for _, observation := range report.Observations {
		names = append(names, observation.Process)
		pids = append(pids, observation.PID)
	}
	if !reflect.DeepEqual(names, []string{"first", "first", "second", "unknown"}) || !reflect.DeepEqual(pids, []int{10, 10, 11, 12}) {
		t.Fatal("process state leaked across records")
	}
}

func TestStableIDsAndDeduplication(t *testing.T) {
	first := parseSnapshot("p10\ncnode\n"+socketLine+"\nf13\n"+socketLine, captureTime)
	second := parseSnapshot("p11\ncother\n"+socketLine+"\np10\ncnode\n"+socketLine, captureTime.Add(time.Minute))
	if len(first.Observations) != 1 || len(second.Observations) != 2 || first.Observations[0].ID != second.Observations[1].ID || first.Observations[0].ID == second.Observations[0].ID {
		t.Fatal("socket IDs must be deterministic and process-specific")
	}
}

func TestMalformedProcessResetsState(t *testing.T) {
	raw := socketLine + "\np1\ncvalid\n" + socketLine
	for _, pid := range []string{"not-a-pid", "0", "2147483648", "-1"} {
		raw += "\np" + pid + "\n" + socketLine
	}
	report := parseSnapshot(raw, captureTime)
	if len(report.Observations) != 1 || report.Observations[0].PID != 1 {
		t.Fatal("invalid PID or orphan socket was accepted")
	}
}

func TestMalformedEndpoints(t *testing.T) {
	for _, line := range []string{
		"nexample.test:443->198.51.100.1:443", "n192.0.2.1:0->198.51.100.1:443",
		"n192.0.2.1:65536->198.51.100.1:443", "n192.0.2.1:443->198.51.100.1:0",
		"n999.0.2.1:443->198.51.100.1:443", "n192.0.2.1:https->198.51.100.1:443",
		"n192.0.2.1:443->198.51.100.1:443->203.0.113.1:22", "n*:443",
		"n[not-ipv6]:443->[::1]:443", "n[192.0.2.1]:443->[::1]:443", "n::1:443->[::1]:443",
		"n[fe80::1%bad scope]:443->[::1]:443", "n[fe80::1%]:443->[::1]:443",
		"nUDP 192.0.2.1:443->198.51.100.1:443", "n192.0.2.1:443->198.51.100.1:443 secret",
		"arbitrary raw log password=never-retain",
	} {
		if len(parseSnapshot("p1\ncnode\n"+line, captureTime).Observations) != 0 {
			t.Fatal("accepted malformed endpoint metadata")
		}
	}
}

func TestProcessBoundedAndSanitized(t *testing.T) {
	report := parseSnapshot("p1\nc"+strings.Repeat("n", 200)+"\n"+socketLine+"\np2\ncunsafe\x1b[31m\n"+socketLine+"\np3\nc\n"+socketLine, captureTime)
	if len(report.Observations) != 3 || report.Observations[0].Process != strings.Repeat("n", 64) || report.Observations[1].Process != "unknown" || report.Observations[2].Process != "unknown" {
		t.Fatal("unsafe or oversized process metadata retained")
	}
}

func TestTruncationBoundary(t *testing.T) {
	var raw strings.Builder
	raw.WriteString("p1\ncnode\n")
	for i := range maxObservations {
		fmt.Fprintf(&raw, "n192.0.2.1:%d->198.51.100.1:443\n", i+1)
	}
	exact := parseSnapshot(raw.String(), captureTime)
	if exact.Truncated || len(exact.Observations) != 500 {
		t.Fatal("exactly 500 unique sockets must not be truncated")
	}
	raw.WriteString("n192.0.2.1:1->198.51.100.1:443\nmalformed\n")
	if parseSnapshot(raw.String(), captureTime).Truncated {
		t.Fatal("duplicates/invalid records must not mark truncation")
	}
	raw.WriteString("n192.0.2.1:501->198.51.100.1:443\n")
	over := parseSnapshot(raw.String(), captureTime)
	if !over.Truncated || len(over.Observations) != 500 {
		t.Fatal("more than 500 sockets must be capped and marked truncated")
	}
}
