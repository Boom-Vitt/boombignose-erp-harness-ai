# BoomBigNose ERP Harness AI

Go harness, Wails desktop and separate headless server entrypoint. **Current-source instructions:** the confirmed published release is [1.4.4 (`ddc5c11`)](https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.4.4); new headless/operator/secure-db/OCR features are not represented as shipped in that release. Do not run a data reset to upgrade.

The Wails window remains the native desktop GUI (`cmd/boombignose-desktop`, `-tags desktop`), opening the bundled ERP at `http://127.0.0.1:3100` by default. Headless `cmd/boombignose` supervises the same stack without Wails/WebKit. The Next.js ERP is the application; `site/` is a static brochure, not a hosted ERP. Operational month-end close is separate from statutory/legal accounting; see [`LEGAL_CLOSE.md`](../docs/boombignose/LEGAL_CLOSE.md).

Offline source entrypoint (Go toolchain pinned in `go.mod`):

```sh
cd boombignose
go run ./cmd/boombignose check
go run ./cmd/boombignose cutover
CGO_ENABLED=0 go build -trimpath -buildvcs=false -o ../dist/boombignose ./cmd/boombignose
```

`check` validates local endpoint/port policy offline; it is not a service/AI/security test. `cutover` without a subcommand only prints a plan; `dry-run`, `apply` and `rollback` explicitly contact loopback databases. Building the CLI alone does not create its portable Node/ERP/PostgreSQL/Auth/Ollama bundle.

For a **current-source assembled** macOS app, the headless CLI is `/Applications/BoomBigNose.app/Contents/MacOS/boombignose` and resources are `Contents/Resources/bundle`; Linux tar.gz places `boombignose` beside `BoomBigNose` and `bundle/`; Windows installs `boombignose.exe` beside `BoomBigNose.exe`. Do not modify a signed app in place. Exact desktop/source assembly, server account/systemd setup, local-first onboarding, private Tailscale HTTPS and recovery commands are in [`BUNDLE.md`](../docs/boombignose/BUNDLE.md#headless-server-installation-and-private-access).

`boombignose serve` runs in the foreground; Ctrl+C gracefully stops its owned children. `boombignose stop` targets the configured profile only, not every process with that name. Use a private absolute `BOOMBIGNOSE_DATA` and distinct ERP/API/Auth/REST/PG ports for parallel profiles. Settings persist in `BOOMBIGNOSE_DATA + ".secrets/runtime.json"`. Local accounts/workspaces must be created before remote HTTPS turns signup invitation-only; normal login/MFA uses the same-origin native Auth relay, not direct public Auth.

`boombignose models` lists local weights; `boombignose pull-model` or `boombignose pull-model qwen3.5:9b-q4_k_m` explicitly installs chat/assistant-image default GGUF (6,550,825,550 bytes), while `boombignose pull-model qwen3.5:4b` installs separate OCR (3,973,305,013 bytes). Named pull/removal must be catalog/platform-allowed. Browser host mutations require owner/admin plus an OS-enrolled operator UUID; workspace ownership alone is insufficient. No startup weight pull, silent model fallback, prompt truncation or cloud fallback. Chat requires portable bounded-context GGUF, not the bare Mac 9B alias that may resolve to MLX; separate OCR may use local MLX. `OLLAMA_MODEL` and `OCR_MODEL` are separate selectors; restart after changing them. Plan 24 GB+ RAM for chat or 12 GB for OCR plus ERP, not cross-host measured minima. See the [catalog](./internal/bundle/ollama_models.json) and [measured quality/license boundaries](../README.en.md#local-models); no complete current AI quality acceptance has passed. Review original documents and explicit save actions.

The [backup/migration runbook](../docs/boombignose/BUNDLE.md#backup-migration-and-recovery) covers `configure-operators USER_UUID [USER_UUID...]`, `configure-operators off`, offline `secure-db`, DB-only versus full cold backup, and administrator-SQL restore risk. Source implementation is not completed recovery/mobile/page acceptance proof.

## Native macOS network collector

`/network` is an owner/admin page inside the existing desktop ERP. React/Three.js renders the view; **Go collects connections**, without a Node.js agent on monitored Macs. See [`acceptance.md`](../acceptance.md) for scope, rules, limits, and verification.

Apply `supabase/migrations/20261106090000_network_visibility.sql` through the normal migration process before opening the new page. Do not reset an existing database. Source changes do not update an already installed application.

1. In **Network 3D → Live telemetry**, enroll each authorized Mac and download its private `bbn-collector.json`. The device credential is returned once, stored hashed, and excluded from graph/snapshot responses.
2. Remote Macs need a reachable **HTTPS ERP origin**. The desktop loopback URL is not remotely accessible. Use the [private front-door runbook](../docs/boombignose/BUNDLE.md#private-tailscale-https-without-replacing-other-services) and `boombignose configure-public-origin https://EXACT_HOST:PORT` for native mode, then restart; do not expose Auth/REST/DB/model ports. A separately managed non-native server uses its reviewed `NEXT_PUBLIC_APP_URL`. HTTP is permitted only on loopback for testing.
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
