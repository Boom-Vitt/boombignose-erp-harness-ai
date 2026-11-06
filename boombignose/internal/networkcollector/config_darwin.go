//go:build darwin

package networkcollector

import (
	"os"
	"syscall"
)

func openPrivateConfig(name string) (*os.File, error) {
	fd, err := syscall.Open(name, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errConfig
	}
	file := os.NewFile(uintptr(fd), "collector-config")
	var stat syscall.Stat_t
	if syscall.Fstat(fd, &stat) != nil || stat.Uid != uint32(os.Getuid()) {
		file.Close()
		return nil, errConfig
	}
	return file, nil
}
