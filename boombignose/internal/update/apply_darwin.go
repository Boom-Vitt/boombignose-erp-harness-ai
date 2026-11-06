//go:build darwin

package update

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
)

func canApply() bool { return runtime.GOARCH == "arm64" }

func defaultApply(ctx context.Context, dmgPath, updatesDir string) error {
	if runtime.GOARCH != "arm64" {
		return ErrDeferred
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	root, err := InstallRootFrom(exe)
	if err != nil {
		return err
	}
	payload := filepath.Join(updatesDir, "payload")
	if err := os.RemoveAll(payload); err != nil {
		return err
	}
	if err := os.MkdirAll(payload, 0o700); err != nil {
		return err
	}
	mount, err := attachDMG(ctx, dmgPath)
	if err != nil {
		return err
	}
	defer detachDMG(mount)
	appSrc := filepath.Join(mount, "BoomBigNose.app")
	bundleSrc := filepath.Join(appSrc, "Contents", "Resources", "bundle")
	if err := needFile(filepath.Join(appSrc, "Contents", "MacOS", "BoomBigNose")); err != nil {
		return err
	}
	if err := needFile(filepath.Join(bundleSrc, "node")); err != nil {
		return err
	}
	if err := needFile(filepath.Join(bundleSrc, "erp", "server.js")); err != nil {
		return err
	}
	if err := verifyApp(ctx, appSrc); err != nil {
		return err
	}
	if err := ditto(ctx, appSrc, filepath.Join(payload, "BoomBigNose.app")); err != nil {
		return err
	}
	// Keep the signed application intact; moving or rewriting its resources
	// invalidates its seal and can make the replacement unlaunchable.
	if err := verifyApp(ctx, filepath.Join(payload, "BoomBigNose.app")); err != nil {
		return err
	}
	script := filepath.Join(updatesDir, "relaunch.sh")
	if err := os.WriteFile(script, []byte(RelaunchScript), 0o700); err != nil {
		return err
	}
	cmd := exec.Command("/bin/sh", script,
		strconv.Itoa(os.Getpid()),
		filepath.Join(payload, "BoomBigNose.app"),
		root,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start()
}

func verifyApp(ctx context.Context, app string) error {
	if err := exec.CommandContext(ctx, "codesign", "--verify", "--deep", "--strict", app).Run(); err != nil {
		return errors.New("disk image application signature is invalid")
	}
	return nil
}

func needFile(path string) error {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return errors.New("disk image is incomplete")
	}
	return nil
}

func attachDMG(ctx context.Context, dmg string) (string, error) {
	out, err := exec.CommandContext(ctx, "hdiutil", "attach", "-nobrowse", "-readonly", "-plist", dmg).Output()
	if err != nil {
		return "", errors.New("disk image did not mount")
	}
	return ParseMountPoint(out)
}

func detachDMG(mount string) {
	_ = exec.Command("hdiutil", "detach", mount).Run()
}

func ditto(ctx context.Context, src, dest string) error {
	if err := exec.CommandContext(ctx, "ditto", src, dest).Run(); err != nil {
		return errors.New("could not stage the update")
	}
	return nil
}
