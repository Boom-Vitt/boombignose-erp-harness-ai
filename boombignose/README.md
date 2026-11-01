# BoomBigNose ERP Harness AI

Local gate for the desktop shell. It does not open a window and it does not make network calls.

```sh
cd boombignose
go test ./...
go run ./cmd/boombignose check
go run ./cmd/boombignose cutover
```

`check` exits 0 when cloud credentials are unset and service URLs are empty or on loopback. `cutover` with no subcommand prints the switch plan and does not touch a database. `cutover dry-run`, `cutover apply`, and `cutover rollback` move rows only between two loopback databases. See `docs/boombignose/CUTOVER.md`.

Milestone 1 is `cmd/boombignose-desktop`, a Wails window built with `-tags desktop`. It runs the same gate, then navigates the window to `http://127.0.0.1:3100`. That origin is the product. Month-end close is used there: `/finance`, `/finance/bank`, `/finance/cash`, `/reports#month-end-close`, `/reports/statements`, and `/reports/accountant-pack`. That close is operational. The statutory close, and the risk-management track around it, are in `docs/boombignose/LEGAL_CLOSE.md`. The same window also reaches sheet import at `/import`, the local backup control, and local AI model install at `/settings#local-models`. Milestone 2 bundles the local stack. See `docs/boombignose/ARCHITECTURE_LOCAL.md`. The static brochure in `site/` only points at the installer. It does not host these screens.

`boombignose models` lists models the local Ollama already has. `boombignose pull-model` downloads `qwen3:4b`. `boombignose pull-model <name>` downloads another allowlisted model when this operating system can run it. `boombignose remove-model <name>` deletes one allowlisted model. A name outside the list is refused, and startup does not pull. Text and vision install on Linux, Windows, and macOS. Image generation installs on macOS. English speech installs on Apple Silicon. Speech to text on Linux and Windows downloads whisper.cpp `b5454` and `ggml-tiny.bin` from Settings. macOS has no `whisper-cli` in that release. Video and voice cloning are not in this build. Thai speech synthesis is not in this build. Weights are not in the repository. The Settings screen is the path inside the ERP, so the operator does not install Ollama Desktop or another AI app.

## Linux CI

`ubuntu-latest` is amd64. That job runs `go test ./...` and `pnpm test`, then `go build -tags "desktop production webkit2_41"` for the window. The release workflow publishes `BoomBigNose-linux-amd64.tar.gz` and `BoomBigNose-linux-amd64.AppImage` from amd64 only.

`ubuntu-24.04-arm` is aarch64. That job runs `go test ./...` with the distro Postgres tools, then the same WebKitGTK 4.1 window build, and uploads the binary as the Actions artifact `linux-arm64-desktop`. It does not publish a tarball or an AppImage. It is a GitHub-hosted arm64 VM, not a physical NVIDIA DGX Spark.
