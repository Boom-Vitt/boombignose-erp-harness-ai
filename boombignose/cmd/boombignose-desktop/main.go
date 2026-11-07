//go:build desktop

// Command boombignose-desktop is the BoomBigNose window. It refuses cloud
// credentials, then opens a Wails webview and navigates that window to the
// local ERP. It does not proxy the page and it does not call a cloud model.
package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/bundle"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/launch"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/networkcollector"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/policy"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/shell"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/update"
	"github.com/Boom-Vitt/nose-erp/boombignose/nav"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

// appIcon is the BoomBigNose brandmark from boombignose.org.
// Windows uses rsrc_windows_amd64.syso. macOS uses packaging/macos/icon.icns
// inside the app bundle. This PNG is the Linux window icon.
//
//go:embed icon.png
var appIcon []byte

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "boombignose: %s\n", err.Error())
		os.Exit(1)
	}
}

func run() error {
	// Explicit opt-in headless mode uses the same native collector as the harness.
	// It never launches the webview, local services, or an automatic collector.
	if len(os.Args) > 1 && os.Args[1] == "--network-collector" {
		return networkcollector.Execute(context.Background(), os.Args[2:], os.Stdout)
	}
	if err := bundle.LoadRuntimeConfig(); err != nil {
		return err
	}
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	app := &App{}
	if dir, err := update.Dir(); err == nil {
		if helper, err := update.Start(dir); err == nil {
			app.helper = helper
			_ = os.Setenv("BOOMBIGNOSE_UPDATE_URL", helper.BaseURL)
			_ = os.Setenv("BOOMBIGNOSE_UPDATE_TOKEN", helper.Token)
		} else {
			fmt.Fprintf(os.Stderr, "boombignose: update helper did not start\n")
		}
	}
	// The window loads the local Next server. Finance, bank lines, cash at
	// close, the month-end checklist, statements, and the accountant pack
	// are routes on that server (shell.FinanceScreens). The brochure in
	// site/ is not this window's target.
	target, err := shell.ERPURL(os.Getenv("BOOMBIGNOSE_ERP_URL"))
	if err != nil {
		return fmt.Errorf("BOOMBIGNOSE_ERP_URL: %w", err)
	}
	script, err := nav.Script(target)
	if err != nil {
		return err
	}
	app.target, app.script = target, script
	var firstLoad sync.Once
	return wails.Run(&options.App{
		Title:            "BoomBigNose ERP Harness AI",
		Width:            1280,
		Height:           800,
		BackgroundColour: options.NewRGB(0x0B, 0x12, 0x22),
		// macOS routes Cmd+V/C/X/A/Z to the webview only through an Edit menu.
		// Without it, login fields refuse paste and editing shortcuts.
		Menu: appMenu(),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Bind: []interface{}{
			app,
		},
		OnStartup: app.startup,
		// Once: the ERP page also fires DOM ready and must not be re-navigated.
		// If this path is lost, the splash polls ERPReady and calls OpenERP.
		OnDomReady: func(ctx context.Context) {
			firstLoad.Do(func() {
				go func() {
					wait, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
					defer cancel()
					err := startLocal(wait, target)
					if err != nil {
						fmt.Fprintf(os.Stderr, "boombignose: %s\n", err.Error())
						if failure, scriptErr := nav.BootFailure(err.Error()); scriptErr == nil {
							runtime.WindowExecJS(ctx, failure)
						}
						return
					}
					runtime.WindowExecJS(ctx, script)
				}()
			})
		},
		OnShutdown: func(context.Context) {
			bundle.StopRunning()
		},
		Linux: &linux.Options{
			Icon:             appIcon,
			ProgramName:      "BoomBigNose",
			WebviewGpuPolicy: linux.WebviewGpuPolicyNever,
		},
	})
}

// App exposes the explicit model download. Startup does not call it.
type App struct {
	helper *update.Helper
	ctx    context.Context
	target string
	script string
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.helper == nil {
		return
	}
	a.helper.SetQuit(func() { runtime.Quit(ctx) })
	a.helper.SetWindow(update.Window{
		IsFullscreen: func() bool { return runtime.WindowIsFullscreen(ctx) },
		SetFullscreen: func(on bool) {
			if on {
				runtime.WindowFullscreen(ctx)
			} else {
				runtime.WindowUnfullscreen(ctx)
			}
		},
	})
}

// ERPReady reports whether the ERP health check answers {"ok":true} with the ERP fingerprint. The
// splash polls it, so a lost one-shot navigation never strands the user.
func (a *App) ERPReady() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ok, _ := launch.Ready(ctx, a.target)
	return ok
}

// ERPTarget is the ERP URL the splash falls back to when OpenERP is lost.
func (a *App) ERPTarget() string { return a.target }

// OpenERP navigates the window to the ERP with the same script as startup.
func (a *App) OpenERP() {
	if a.ctx != nil && a.script != "" {
		runtime.WindowExecJS(a.ctx, a.script)
	}
}

// PullLocalModel explicitly downloads the allowlisted default on loopback, starting the Ollama
// daemon first. The splash button is the only caller. A cloud host is refused
// and is not included in the error. Errors start with a class the splash maps
// to Thai text: "ollama", "network", "timeout" or "other", then ": detail".
func (a *App) PullLocalModel() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	root := os.Getenv("BOOMBIGNOSE_BUNDLE")
	if root == "" {
		if exe, err := os.Executable(); err == nil {
			root = bundle.DefaultRoot(exe)
		}
	}
	layout := bundle.Layout{}
	if bundle.Valid(root) {
		found, err := bundle.Discover(root)
		if err != nil {
			return err
		}
		layout = found
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	upCtx, upCancel := context.WithTimeout(ctx, 20*time.Second)
	err := bundle.EnsureOllama(upCtx, layout, os.Getenv("OLLAMA_HOST"), nil, nil)
	upCancel()
	if err != nil {
		return pullError(err, true)
	}
	return pullError(bundle.PullModel(ctx, layout, os.Getenv("OLLAMA_HOST"), os.Environ()), false)
}

// pullError prefixes err with the class the splash reads. A failed pull that
// exited non-zero after the daemon started is most often a network failure.
func pullError(err error, starting bool) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, bundle.ErrNoOllama) || starting:
		return fmt.Errorf("ollama: %w", err)
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("timeout: %w", err)
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return fmt.Errorf("network: %w", err)
	}
	return fmt.Errorf("other: %w", err)
}

func startLocal(ctx context.Context, target string) error {
	root := os.Getenv("BOOMBIGNOSE_BUNDLE")
	if root == "" {
		if exe, err := os.Executable(); err == nil {
			root = bundle.DefaultRoot(exe)
		}
	}
	if bundle.Valid(root) {
		layout, err := bundle.Discover(root)
		if err != nil {
			return err
		}
		data, err := bundle.DataDir()
		if err != nil {
			return err
		}
		return bundle.StartStack(ctx, layout, data, target, os.Environ(), nil)
	}
	return launch.Ensure(ctx, launch.FindCheckout(os.Getenv("BOOMBIGNOSE_ERP_DIR"), checkoutStarts()), os.Getenv("BOOMBIGNOSE_NODE"), target, nil)
}

func checkoutStarts() []string {
	var dirs []string
	if wd, err := os.Getwd(); err == nil {
		dirs = append(dirs, wd)
	}
	if exe, err := os.Executable(); err == nil {
		dirs = append(dirs, filepath.Dir(exe))
	}
	return dirs
}

// appMenu gives the window the standard App and Edit menus so text inputs
// (email, password) receive keyboard editing on macOS.
func appMenu() *menu.Menu {
	m := menu.NewMenu()
	m.Append(menu.AppMenu())
	m.Append(menu.EditMenu())
	return m
}
