//go:build !darwin

package update

import "context"

func canApply() bool { return false }

func defaultApply(context.Context, string, string) error {
	return ErrDeferred
}
