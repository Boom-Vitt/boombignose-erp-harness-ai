//go:build desktop

// Command boombignose-desktop is the BoomBigNose window. It refuses cloud
// credentials, then opens a Wails webview and navigates that window to the
// local ERP. It does not proxy the page and it does not call a cloud model.
package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/bundle"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/launch"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/shell"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/update"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/nav"
	"github.com/wailsapp/wails/v2"
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
	return wails.Run(&options.App{
		Title:            "BoomBigNose ERP Harness AI",
		Width:            1280,
		Height:           800,
		BackgroundColour: options.NewRGB(0x0B, 0x12, 0x22),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Bind: []interface{}{
			app,
		},
		OnStartup: app.startup,
		OnDomReady: func(ctx context.Context) {
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
}

func (a *App) startup(ctx context.Context) {
	if a.helper == nil {
		return
	}
	a.helper.SetQuit(func() { runtime.Quit(ctx) })
}

// PullLocalModel runs `ollama pull qwen2.5:3b` on loopback. The splash button
// is the only caller. A cloud host is refused and is not included in the error.
func (a *App) PullLocalModel() error {
	if err := policy.CheckEnv(os.Getenv); err != nil {
		return err
	}
	root := os.Getenv("BOOMBIGNOSE_BUNDLE")
	if root == "" {
		if exe, err := os.Executable(); err == nil {
			root = filepath.Join(filepath.Dir(exe), "bundle")
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
	return bundle.PullModel(ctx, layout, os.Getenv("OLLAMA_HOST"), os.Environ())
}

func startLocal(ctx context.Context, target string) error {
	root := os.Getenv("BOOMBIGNOSE_BUNDLE")
	if root == "" {
		if exe, err := os.Executable(); err == nil {
			root = filepath.Join(filepath.Dir(exe), "bundle")
		}
	}
	if bundle.Valid(root) {
		layout, err := bundle.Discover(root)
		if err != nil {
			return err
		}
		ollamaWait, cancel := context.WithTimeout(ctx, 5*time.Second)
		err = bundle.EnsureOllama(ollamaWait, layout, os.Getenv("OLLAMA_HOST"), nil, nil)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "boombignose: ollama: %s\n", err.Error())
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
