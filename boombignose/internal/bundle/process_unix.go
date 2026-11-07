//go:build !windows && !darwin && !linux

package bundle

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
)

func processIdentity(pid int) (string, error) {
	if pid <= 1 {
		return "", errors.New("invalid child pid")
	}
	// No command arguments or environment are collected. The process birth time
	// plus executable distinguish a live child from a stale/reused PID.
	command := exec.Command("/bin/ps", "-p", strconv.Itoa(pid), "-o", "lstart=", "-o", "comm=")
	body, err := command.Output()
	if err != nil {
		return "", errors.New("child process identity unavailable")
	}
	identity := strings.TrimSpace(string(body))
	if identity == "" {
		return "", errors.New("child process identity unavailable")
	}
	return identity, nil
}
