package bundle

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type processRecord struct {
	PID      int    `json:"pid"`
	Identity string `json:"identity"`
}

func writeProcessRecord(data, name string, pid int) error {
	identity, err := processIdentity(pid)
	if err != nil {
		return err
	}
	body, err := json.Marshal(processRecord{PID: pid, Identity: identity})
	if err != nil {
		return err
	}
	return writeDataFile(data, name, append(body, '\n'))
}

// Legacy numeric PID files are deliberately not trusted: PIDs are reusable.
// A current-user-owned private record must match the kernel process lifetime
// before a signal is sent. Unrelated/reused PIDs are left untouched.
func stopOwnedProcess(data, name string) {
	body, err := privateRead(filepath.Join(data, name))
	if err != nil {
		return
	}
	var record processRecord
	if json.Unmarshal(body, &record) != nil || record.PID <= 1 || record.Identity == "" {
		return
	}
	identity, err := processIdentity(record.PID)
	if err != nil || identity != record.Identity {
		return
	}
	process, err := os.FindProcess(record.PID)
	if err != nil {
		return
	}
	if process.Kill() == nil {
		_ = os.Remove(filepath.Join(data, name))
	}
}
