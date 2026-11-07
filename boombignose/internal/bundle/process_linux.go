//go:build linux

package bundle

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strconv"
)

func processIdentity(pid int) (string, error) {
	if pid <= 1 {
		return "", errors.New("invalid child pid")
	}
	root := "/proc/" + strconv.Itoa(pid)
	stat, err := os.ReadFile(root + "/stat")
	if err != nil {
		return "", err
	}
	// comm can contain spaces and parentheses and can change with process.title.
	// Only field 22 (kernel start ticks) contributes to the identity.
	end := bytes.LastIndexByte(stat, ')')
	if end < 0 {
		return "", errors.New("child process identity unavailable")
	}
	fieldNumber := 3
	for field := range bytes.FieldsSeq(stat[end+1:]) {
		if fieldNumber == 22 {
			start, err := strconv.ParseUint(string(field), 10, 64)
			if err != nil || start == 0 {
				return "", errors.New("child process identity unavailable")
			}
			boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
			if err != nil {
				return "", err
			}
			boot = bytes.TrimSpace(boot)
			if len(boot) != 36 {
				return "", errors.New("kernel boot identity unavailable")
			}
			namespace, err := os.Readlink(root + "/ns/pid")
			if err != nil || namespace == "" {
				return "", errors.New("process namespace identity unavailable")
			}
			return fmt.Sprintf("linux:%s:%s:%d", boot, namespace, start), nil
		}
		fieldNumber++
	}
	return "", errors.New("child process identity unavailable")
}
