//go:build windows

package bundle

import (
	"errors"
	"fmt"
	"golang.org/x/sys/windows"
)

func processIdentity(pid int) (string, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return "", err
	}
	path := make([]uint16, 32768)
	size := uint32(len(path))
	if err := windows.QueryFullProcessImageName(handle, 0, &path[0], &size); err != nil {
		return "", err
	}
	if size == 0 {
		return "", errors.New("child process identity unavailable")
	}
	return fmt.Sprintf("%d:%d:%s", creation.HighDateTime, creation.LowDateTime, windows.UTF16ToString(path[:size])), nil
}
