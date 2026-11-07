//go:build darwin

package bundle

import (
	"errors"
	"fmt"

	"golang.org/x/sys/unix"
)

func processIdentity(pid int) (string, error) {
	if pid <= 1 {
		return "", errors.New("invalid child pid")
	}
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return "", err
	}
	if info.Proc.P_pid != int32(pid) || info.Proc.P_starttime.Sec <= 0 {
		return "", errors.New("child process identity unavailable")
	}
	// Node changes its displayed command/title during startup. Kernel birth
	// time and UID identify this process lifetime without reading its arguments.
	return fmt.Sprintf("darwin:%d:%d:%d", info.Proc.P_starttime.Sec, info.Proc.P_starttime.Usec, info.Eproc.Ucred.Uid), nil
}
