# BoomBigNose ERP Harness AI

Go harness and Wails desktop entrypoint. `check` is offline; explicit model/download, database, and network-collector commands perform only their documented operations.

```sh
cd boombignose
go test ./...
go run ./cmd/boombignose check
go run ./cmd/boombignose cutover
```

`check` exits 0 when cloud credentials are unset and service URLs are empty or on loopback. `cutover` with no subcommand prints the switch plan and does not touch a database. `cutover dry-run`, `cutover apply`, and `cutover rollback` move rows only between two loopback databases. See `docs/boombignose/CUTOVER.md`.

Milestone 1 is `cmd/boombignose-desktop`, a Wails window built with `-tags desktop`. It runs the same gate, then navigates the window to `http://127.0.0.1:3100`. That origin is the product. Month-end close is used there: `/finance`, `/finance/bank`, `/finance/cash`, `/reports#month-end-close`, `/reports/statements`, and `/reports/accountant-pack`. That close is operational. The statutory close, and the risk-management track around it, are in `docs/boombignose/LEGAL_CLOSE.md`. The same window also reaches sheet import at `/import`, the local backup control, and local AI model install at `/settings#local-models`. Milestone 2 bundles the local stack. See `docs/boombignose/ARCHITECTURE_LOCAL.md`. The static brochure in `site/` only points at the installer. It does not host these screens.

`boombignose models` lists models the local Ollama already has. `boombignose pull-model` downloads `qwen2.5:3b`. `boombignose pull-model <name>` downloads another allowlisted model when this operating system can run it. `boombignose remove-model <name>` deletes one allowlisted model. A name outside the list is refused, and startup does not pull. Text and vision install on Linux, Windows, and macOS. Image generation installs on macOS. English speech installs on Apple Silicon. Speech to text on Linux and Windows downloads whisper.cpp `b5454` and `ggml-tiny.bin` from Settings. macOS has no `whisper-cli` in that release. Video and voice cloning are not in this build. Thai speech synthesis is not in this build. Weights are not in the repository. The Settings screen is the path inside the ERP, so the operator does not install Ollama Desktop or another AI app.

## Native macOS network collector

`/network` is an owner/admin page inside the existing desktop ERP. React/Three.js renders the view; **Go collects connections**, without a Node.js agent on monitored Macs. See [`acceptance.md`](../acceptance.md) for scope, rules, limits, and verification.

Apply `supabase/migrations/20261106090000_network_visibility.sql` through the normal migration process before opening the new page. Do not reset an existing database. Source changes do not update an already installed application.

1. In **Network 3D → Live telemetry**, enroll each authorized Mac and download its private `bbn-collector.json`. The device credential is returned once, stored hashed, and excluded from graph/snapshot responses.
2. Remote Macs need a reachable **HTTPS ERP origin**. The default desktop loopback URL is not remotely accessible. Configure a trusted HTTPS endpoint separately and set `NEXT_PUBLIC_APP_URL` to its origin; this feature does not expose the desktop server automatically. HTTP is permitted only on loopback for testing.
3. Build and run the native collector explicitly:

   ```sh
   cd boombignose
   go build -o /tmp/boombignose-network ./cmd/boombignose
   chmod 600 ~/Downloads/bbn-collector.json
   /tmp/boombignose-network network-collector --config "$HOME/Downloads/bbn-collector.json" --once
   # Omit --once for snapshots every 30 seconds. Ctrl+C stops the process.
   ```

   Build toolchain: Go 1.27.3. Monitored Macs need the binary, not Go or Node.js. The rebuilt Wails executable also accepts `--network-collector --config ABS_PATH [--once]`, before launching any window/services. Config must be an absolute-path, current-user-owned regular file, mode `0600` or stricter; symlinks are rejected. Never share the credential.
4. Set allowed IPv4/IPv6 **CIDRs** in ERP. Empty policy means **unknown**, not trusted. Revoke a device to reject subsequent reports immediately.

Coverage and privacy:

- Only enrolled Macs are observed; other ERP clients are unmonitored. Enrollment is not hardware attestation or proof of a user ERP session.
- `/usr/sbin/lsof` snapshots established TCP sockets visible to the collector's OS account. Short-lived connections and privileged processes may be missed. No automatic startup, elevation, SSH, scanning, or packet capture.
- Only the latest snapshot is stored, not traffic history. Missing/stale reports (>120 seconds) and truncation at 500 sockets produce coverage gaps. Collection errors do not send a success heartbeat.
- Metadata: IP/port, process basename, PID, evidence ID, capture time. No arguments, credentials, environment, raw logs, payloads, or byte counts. Treat even metadata as sensitive.
- Dashed arrows are collector reports; TCP initiation direction is unknown. Allowed destinations are not a “safe” verdict. Policy is for review, not a firewall or DLP. Encryption prevents identifying whether a connection carries ERP data.
- All five rules produce **รอคนตรวจ** only. Real TCP snapshots cannot prove SSH authentication; the three SSH rules use separately labelled sample events.

`/network-preview` is sample-only and returns 404 unless server environment `ERP_NETWORK_PREVIEW=1` is explicitly set. It never loads workspace telemetry.

```sh
go test ./internal/networkcollector ./cmd/boombignose
BOOMBIGNOSE_NETWORK_COLLECTOR_SMOKE=1 go test ./internal/networkcollector -run '^TestMacOSLiveCollectorToIsolatedSink$' -count=1 -v
```

The opt-in smoke sends real local metadata to an ephemeral loopback test sink, never an existing ERP workspace.

## Linux CI

`ubuntu-latest` is amd64. That job runs `go test ./...` and `pnpm test`, then `go build -tags "desktop production webkit2_41"` for the window. The release workflow publishes `BoomBigNose-linux-amd64.tar.gz` and `BoomBigNose-linux-amd64.AppImage` from amd64 only.

`ubuntu-24.04-arm` is aarch64. That job runs `go test ./...` with the distro Postgres tools, then the same WebKitGTK 4.1 window build, and uploads the binary as the Actions artifact `linux-arm64-desktop`. It does not publish a tarball or an AppImage. It is a GitHub-hosted arm64 VM, not a physical NVIDIA DGX Spark.
