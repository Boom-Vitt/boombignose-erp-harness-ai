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

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/bundle"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/cutover"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/networkcollector"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/policy"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/shell"
)

const usage = "usage: boombignose check | boombignose configure-public-origin <https-origin|off> | boombignose configure-operators <user-uuid> [user-uuid...] | boombignose configure-operators off | boombignose secure-db | boombignose cutover [plan|dry-run|apply|rollback] | boombignose backup [export|restore] | boombignose serve | boombignose stop | boombignose models | boombignose pull-model [name] | boombignose remove-model <name> | boombignose network-collector --config ABS_PATH [--once]"

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
	if args[0] == "configure-public-origin" {
		if len(args) != 2 {
			return fmt.Errorf("%s", usage)
		}
		data, err := bundle.DataDir()
		if err != nil {
			return err
		}
		return bundle.ConfigurePublicOrigin(data, args[1])
	}
	if args[0] == "configure-operators" {
		if len(args) < 2 {
			return fmt.Errorf("%s", usage)
		}
		data, err := bundle.DataDir()
		if err != nil {
			return err
		}
		ids := args[1:]
		if len(ids) == 1 && ids[0] == "off" {
			ids = nil
		}
		return bundle.ConfigureOperators(data, ids)
	}
	if args[0] == "cutover" {
		return runCutover(args[1:])
	}
	if args[0] == "backup" {
		return runBackup(args[1:])
	}
	if args[0] == "pull-model" {
		return runPullModel(args[1:])
	}
	if args[0] == "remove-model" {
		return runRemoveModel(args[1:])
	}
	if args[0] == "network-collector" {
		ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer cancel()
		return networkcollector.Execute(ctx, args[1:], os.Stdout)
	}
	if err := bundle.LoadRuntimeConfig(); err != nil {
		return err
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
		if _, err := bundle.ValidateConfig(url); err != nil {
			return err
		}
		fmt.Printf("boombignose local-ok erp=%s\n", url)
		return nil
	case "serve":
		return serveBundle()
	case "secure-db":
		layout, err := bundle.Discover(bundleRoot())
		if err != nil {
			return err
		}
		data, err := bundle.DataDir()
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		return bundle.SecureDatabase(ctx, layout, data)
	case "stop":
		return stopBundle()
	case "models":
		return listModels()
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
	data, err := bundle.DataDir()
	if err != nil {
		return err
	}
	passwordFile, err := bundle.BackupPasswordFile(data)
	if err != nil {
		return err
	}
	return cutover.Backup(context.Background(), args, os.Stdout, passwordFile)
}

func runPullModel(args []string) error {
	if len(args) > 1 {
		return fmt.Errorf("%s", usage)
	}
	model := bundle.LocalModel
	if len(args) == 1 {
		model = args[0]
	}
	return pullNamed(model)
}

func runRemoveModel(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("%s", usage)
	}
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return bundle.DeleteLocalModel(ctx, os.Getenv("OLLAMA_HOST"), args[0])
}

func listModels() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	models, err := bundle.ListLocalModels(ctx, os.Getenv("OLLAMA_HOST"))
	if err != nil {
		return err
	}
	if len(models) == 0 {
		fmt.Println("no local models")
		return nil
	}
	for _, model := range models {
		fmt.Println(model.Name)
	}
	return nil
}

func pullNamed(model string) error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	root := bundleRoot()
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
	return bundle.PullNamedModel(ctx, layout, os.Getenv("OLLAMA_HOST"), os.Environ(), model)
}

func serveBundle() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	root := bundleRoot()
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
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	defer bundle.StopRunning()
	if err := bundle.StartStack(ctx, layout, data, target, os.Environ(), nil); err != nil {
		return err
	}
	fmt.Printf("ready %s\n", target)
	<-ctx.Done()
	return nil
}

func stopBundle() error {
	root := bundleRoot()
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

func bundleRoot() string {
	if root := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_BUNDLE")); root != "" {
		return root
	}
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return bundle.DefaultRoot(executable)
}
