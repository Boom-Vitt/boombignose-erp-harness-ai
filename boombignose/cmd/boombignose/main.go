// Command boombignose is the local harness for BoomBigNose.
// It prints no secrets. check and `cutover` with no subcommand do not open a socket.
// cutover dry-run, apply, and rollback talk only to loopback Postgres.
// backup export and restore talk only to loopback Postgres.
// serve binds the bundled ERP on loopback and does not call a cloud service.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/bundle"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/cutover"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/shell"
)

const usage = "usage: boombignose check | boombignose cutover [plan|dry-run|apply|rollback] | boombignose backup [export|restore] | boombignose serve | boombignose stop | boombignose pull-model"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "boombignose: %s\n", err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("%s", usage)
	}
	if args[0] == "cutover" {
		return runCutover(args[1:])
	}
	if args[0] == "backup" {
		return runBackup(args[1:])
	}
	if len(args) != 1 {
		return fmt.Errorf("%s", usage)
	}
	switch args[0] {
	case "check":
		if err := policy.CheckEnv(os.Getenv); err != nil {
			return err
		}
		url, err := shell.ERPURL(os.Getenv("BOOMBIGNOSE_ERP_URL"))
		if err != nil {
			return fmt.Errorf("BOOMBIGNOSE_ERP_URL: %w", err)
		}
		fmt.Printf("boombignose local-ok erp=%s\n", url)
		return nil
	case "serve":
		return serveBundle()
	case "stop":
		return stopBundle()
	case "pull-model":
		return pullModel()
	default:
		return fmt.Errorf("%s", usage)
	}
}

func runCutover(args []string) error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	return cutover.Execute(context.Background(), args, os.Stdout)
}

func runBackup(args []string) error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	return cutover.Backup(context.Background(), args, os.Stdout)
}

func pullModel() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	root := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_BUNDLE"))
	layout := bundle.Layout{}
	if root != "" {
		found, err := bundle.Discover(root)
		if err != nil && !errors.Is(err, bundle.ErrIncomplete) {
			return err
		}
		if err == nil {
			layout = found
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	return bundle.PullModel(ctx, layout, os.Getenv("OLLAMA_HOST"), os.Environ())
}

func serveBundle() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	root := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_BUNDLE"))
	layout, err := bundle.Discover(root)
	if err != nil {
		return err
	}
	data, err := bundle.DataDir()
	if err != nil {
		return err
	}
	target, err := shell.ERPURL(os.Getenv("BOOMBIGNOSE_ERP_URL"))
	if err != nil {
		return fmt.Errorf("BOOMBIGNOSE_ERP_URL: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := bundle.StartStack(ctx, layout, data, target, os.Environ(), nil); err != nil {
		bundle.StopRunning()
		return err
	}
	fmt.Printf("ready %s\n", target)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sig)
	<-sig
	bundle.StopRunning()
	return nil
}

func stopBundle() error {
	root := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_BUNDLE"))
	layout := bundle.Layout{}
	if root != "" {
		found, err := bundle.Discover(root)
		if err == nil {
			layout = found
		} else if !errors.Is(err, bundle.ErrIncomplete) {
			return err
		}
	}
	data, err := bundle.DataDir()
	if err != nil {
		return err
	}
	return bundle.StopAt(layout, data)
}
