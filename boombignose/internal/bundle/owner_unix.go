//go:build !windows

package bundle

import (
	"os"
	"syscall"
)

func currentOwner(_ string, info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Getuid())
}

func hardenCreated(_ string) error      { return nil }
func privateMode(info os.FileInfo) bool { return info.Mode().Perm()&0o077 == 0 }
