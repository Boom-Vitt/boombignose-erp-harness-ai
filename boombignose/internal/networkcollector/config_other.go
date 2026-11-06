//go:build !darwin

package networkcollector

import "os"

func openPrivateConfig(string) (*os.File, error) {
	return nil, errConfig
}
