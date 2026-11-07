# Portable bundle

This runbook describes the **current development source**, not a new published installer. The confirmed public baseline is [1.4.4 (`ddc5c11`)](https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.4.4); its downloads must not be assumed to contain the new headless CLI, secure-db, operator policy or OCR changes. Historical CI smoke results below apply to their named old commits only. Current-source packaging, all-page behavior, Thai/English AI/OCR accuracy, full recovery and actual mobile access require their own evidence.

## What the window does

`boombignose/internal/bundle` discovers `BOOMBIGNOSE_BUNDLE`, otherwise `bundle/` next to the executable; macOS `.app` uses `Contents/Resources/bundle`. AppImage stores `usr/bin/bundle` beside the mounted binary. Keep the immutable application/runtime separate from writable private data.

Required files:

- `bundle/node` (`bundle/node.exe` on Windows)
- `bundle/erp/server.js`
- `bundle/postgres/bin/postgres`, its matching support files and `prelude-after-auth.sql`
- `bundle/auth/auth` and its real Auth migrations; `bundle/postgrest/postgrest` (Windows adds `.exe`)

When the portable tree exists, the native supervisor runs its Node binary with `server.js`, never a PATH Node or Docker. ERP, PostgreSQL, API, Auth and REST use distinct validated loopback ports; a foreign listener fails startup rather than being adopted or stopped. Child environment is allowlisted. Native flags include private attachments/data/bundle paths, actual PostgreSQL port, separate local/public origins and signup policy. Chat defaults to `qwen3.5:9b-q4_k_m` (local GGUF), OCR separately to `qwen3.5:4b`; cloud keys are not forwarded. `LOCAL_TOTP_ENROLL` remains explicit opt-in. Node never receives Postgres library-path overrides. Missing native PostgreSQL/Auth/PostgREST fails clearly; ERP migrations run only after genuine Auth initialization, never a synthetic Auth prelude.

When those two files are absent, the window keeps the checkout path: `node scripts/local/stack.mjs serve --port 3100`.

`boombignose serve` starts the same native stack without Wails/WebKit. `boombignose stop` and native shutdown signal only private recorded children whose kernel process-lifetime identity still matches: Darwin birth time/UID, Linux boot/PID namespace/start ticks, or Windows creation time/image path. A mutable Node process title is not ownership. PostgreSQL is stopped only after authenticated data-directory ownership is confirmed. Stop a running older version with its original service/application before replacing binaries; numeric, stale or old-format PID records are never adopted as permission to kill another process.

## Postgres, not SQLite

The ERP's finance and stock rules are Postgres functions, and row access is RLS. A SQLite file cannot run them.

Each native assembly verifies pinned runtime inputs and builds the PostgreSQL server/clients from checksum-pinned source rather than repacking an opaque vendor dependency tree:

- Node v22.21.1 linux-x64, SHA-256 `680d3f30b24a7ff24b98db5e96f294c0070f8f9078df658da1bce1b9c9873c88`, complete original Node/third-party license text copied to `bundle/NODE_LICENSE`
- PostgreSQL 16.15 source, SHA-256 `c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed`, built by [`assemble-server.sh`](../../packaging/postgres/assemble-server.sh) with static OpenSSL 3.5.9/zlib 1.3.1 and standard core/contrib including `plpgsql`/`pgcrypto`. `SERVER_PROVENANCE.json` and component `third-party-notices/` preserve exact sources, original full terms and actual compiler/configuration/link evidence. The known source-owned closure excludes unneeded ICU/XML/LDAP/GSSAPI/NLS/vendor integrations and EDB plugins. This does not establish source closure for old EDB/Zonky payloads.

The packed binaries are `bundle/postgres/bin/initdb`, `pg_ctl`, and `postgres`, plus `lib/` and `share/`. Real bundled Auth first migrates its own schema; only then does `prelude-after-auth.sql` prepare ERP roles/storage and application migrations. Native startup requires actual Auth and PostgREST; there is no synthetic `auth` schema or Auth-less prelude fallback.

The native prelude installs authenticated/service-role public-table defaults before ERP migrations, so later command-only and column-level revocations take precedence; anonymous accounts receive no business-table defaults. Migration `20261106110000_native_platform_privileges.sql` repairs explicitly listed legacy privileges on already initialized native clusters without regranting every table or changing RLS. Migration bookkeeping is created outside those defaults. Acceptance requires real ordinary Auth users querying their own memberships and an inaccessible foreign workspace through PostgREST, not only administrator connectivity or successful migration counts.

Windows uses pinned Node v22.21.1 win-x64, SHA-256 `3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf`, plus native source-built PostgreSQL 16.15. Native source builds retain the ordinary upstream `bin/`, `lib/` and `share/extension/` layout. `initdb` on Windows uses `--no-locale`; server options omit `unix_socket_directories`. No macOS/Linux library-path override is forwarded to Windows processes. A recipe/gate implementation is not a claim that an unexercised Windows artifact passed its native checks.

macOS arm64 uses pinned Node v22.21.1 darwin-arm64, SHA-256 `c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af`, plus source-built PostgreSQL 16.15. The launcher confines the Postgres library path to its own `lib/`; dependency inspection must reject Homebrew, unrelated SDK and unresolved build-cache paths. Assembly ad-hoc signs staged Mach-O files before sealing the app. That is not Developer ID signing/notarization and does not mutate the installed app. Actual Darwin source-build evidence does not stand in for Linux/Windows evidence.

Next.js standalone JS/static assets are built on Linux and reused. [`packaging/erp-dependencies.mjs`](../../packaging/erp-dependencies.mjs) rebuilds the CGO-disabled Go raster validator for each platform and removes Sharp/@img/libvips and optional PDF.js Node canvas packages without replacing Next's dependency graph. Browser PDF.js resources keep their original notices; Sharp remains development/test-only. Assembly downloads pinned Node/Auth/Ollama, source-builds PostgreSQL 16.15 and PostgREST v16.5, and reuses matching source-pinned static libpq/zlib instead of an arbitrary host libpq. See [`assemble-clients.sh`](../../packaging/postgres/assemble-clients.sh), generated `postgres/CLIENT_PROVENANCE`, component build/source manifests, `erp/native-dependencies.json` and [NOTICE](../../NOTICE). Source configuration is not proof of any already published artifact.

The standalone build also runs [`collect-notices.mjs`](../../packaging/collect-notices.mjs), copying original full npm/embedded-resource, Go toolchain/module and font license texts into `erp/third-party-notices/`, with hashes/provenance in format-2 `index.json`. npm collection uses actual post-prune server packages, exact emitted client source-map modules, byte-identical opaque PDF worker/resources and unconditional global stylesheet imports—not the whole npm metadata graph. The worker's actual incorporated Emscripten glue receives original full license/copyright texts; Rust/WASM/libc/fallback additions are conditional on actual distributed resource bytes and the pinned `pdfjs-*-provenance.json` evidence. Installed-but-unshipped WASM is not a redistribution blocker, and no missing upstream compiler version is invented. Go modules and embedded notices remain a conservative superset, including other-platform Wails modules. Go source acquisition is build-time only, pinned by `go.mod`/`go.sum`; there is no runtime license fetch. Immutable supplemental source URLs/checksums are in `packaging/licenses/sources.json` and the resource provenance files. `font-metadata.json` preserves original name-table copyright/version/license strings for inspected binary SHA-256 values, including IBM's 2019 binary copyright alongside its family OFL's 2017 notice; uninspected changed font bytes fail collection.

Source packaging requires production browser source maps as exact client-module evidence. `pnpm build` invokes the cross-platform [`build-erp.mjs`](../../packaging/build-erp.mjs) wrapper, enables maps for collection, then moves them from publicly served `.next/static` to `.next/private-source-maps`. This also protects ordinary `pnpm start`, not just installers. Hydration strips any staged `.map` copies. A fresh build is required to regenerate notices from matching emitted maps; do not combine old maps with new JS. Inspect `erp/third-party-notices/index.json` and every `unresolved` entry. `node packaging/collect-notices.mjs audit /absolute/stage/bundle/erp` verifies original license and static-asset hashes. Each assembler additionally collects native materials at build time and runs the complete bundle gate:

```sh
node packaging/collect-notices.mjs runtime /absolute/stage/bundle /absolute/postgrest-build
node packaging/collect-notices.mjs bundle /absolute/stage/bundle
```

The first command reuses already complete, payload-bound component notices or collects exact native source/notices into `auth/third-party-notices/`, `postgres/third-party-notices/` and `postgrest/third-party-notices/`; its PostgREST input is the actual `packaging/postgrest/build.mjs` output, not an arbitrary release executable. The read-only second command binds those materials to the actual native payload and target platform, checks the complete original Node license and incorporated Ollama notice inventory, and rejects public maps. It accepts documented Darwin signing-only changes, not changed code, dependencies or load paths. Actual staged/emitted components determine redistribution obligations; unused barrel-export metadata does not. These are build/release tools, never application-startup downloads. Collection is not publication approval; runtime pruning, main Go/Wails binaries, native startup/recovery, final installers and signing/clean-host checks remain separate gates. Darwin evidence does not prove Linux/Windows artifacts.

Data lives in `BOOMBIGNOSE_DATA` or `~/.local/share/boombignose/pg`, outside installers; uninstall leaves it intact. Paths must be absolute and cannot contain spaces. New clusters use PostgreSQL SCRAM-SHA-256 for local and TCP connections, with separate random admin/Auth/REST passwords in the private `pg.secrets/` sibling directory, never argv/logs. Go uses the maintained pgx client, not a custom trust-only wire protocol. Auth and PostgREST connect through non-superuser login roles; the native migration administrator alone has elevated privileges. PostgreSQL binds only `127.0.0.1`; its Unix socket directory is private. ERP migration filenames stay in `public.erp_schema_migrations`, separate from genuine Auth's migration history. Startup requires `public.organizations`. Existing trust-authenticated clusters are **not automatically rewritten or reset**: the explicit offline `secure-db` procedure below preserves data and backs up the original HBA. Customized HBA/configuration requires owner review instead of silent replacement.

`GET /api/health` returns `{"ok":true}` without a database and without a cloud call: it is liveness, not database/AI acceptance. [`packaging/linux/smoke-bundle.sh`](../../packaging/linux/smoke-bundle.sh) runs on Linux x64 and Darwin arm64 against a native source bundle (default `dist/bundle`, override `BOOMBIGNOSE_SMOKE_BUNDLE`). It retains native dependency/notices and pure-Go raster checks, requires the actual packaged PostgreSQL 16.15 clients, initializes real PostgreSQL/Auth/PostgREST, and performs ordinary signup/signin through the local API proxy. It then signals its owned supervisor and requires every configured stack port, including Ollama, to become bindable.

The smoke honors `BOOMBIGNOSE_ERP_URL`, `BOOMBIGNOSE_API_PORT`, `BOOMBIGNOSE_AUTH_PORT`, `BOOMBIGNOSE_REST_PORT`, `BOOMBIGNOSE_PG_PORT` and `OLLAMA_HOST`, with defaults `http://127.0.0.1:3100`, 54321, 54323, 54324, 54329 and `127.0.0.1:11434`. Accepted HTTP loopback aliases resolve to IPv4 loopback for this native smoke. All six ports must be distinct and unused; choose an unused private Ollama port instead of a desktop/shared 11434. After CLI compilation it gives the stack a temporary private `HOME`: the existing Ollama child environment forwards `HOME` and forces `OLLAMA_NO_CLOUD=1`, but does not forward `OLLAMA_MODELS`. The smoke requires an owned daemon record and empty `/api/tags`, and fails if model manifest/blob files appear during ordinary boot/auth or shutdown. It neither pulls weights nor adopts/stops an existing shared daemon/cache. Temporary data and model state are removed only after owned-process cleanup.

For example, after assembling the matching native source bundle, select unused ports (these are examples, not reserved ports):

```sh
BOOMBIGNOSE_ERP_URL=http://127.0.0.1:33110 \
BOOMBIGNOSE_API_PORT=55521 BOOMBIGNOSE_AUTH_PORT=55523 \
BOOMBIGNOSE_REST_PORT=55524 BOOMBIGNOSE_PG_PORT=55529 \
OLLAMA_HOST=127.0.0.1:11436 sh packaging/linux/smoke-bundle.sh
```

Current-source native headless startup with real PostgreSQL 16.15/Auth/PostgREST and SQL migrations has been observed on Darwin; the revised isolated smoke still requires its own full run. Linux/systemd deployment and Windows runtime are separate native proof gates, not established by Darwin success or by these instructions. Historical release workflow [40520719762](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40520719762) printed health/shutdown results; [40526064339](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40526064339) did so on Windows/macOS, and PR run [40536898121](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40536898121), commit `cc20239`, printed health/signup/signin/shutdown results on Linux/Windows/macOS. These old runs do not validate today's source. Windows uses `packaging/windows/smoke-bundle.ps1`. Writable source-bundle smoke is not read-only DMG/AppImage launch proof, model quality/OCR proof, recovery proof or actual mobile access.

Auth v2.197.0 and PostgREST v16.5 have MIT application-source licenses, not a blanket MIT relicensing of every incorporated library. Auth's linked go-ethereum is LGPL-3.0-or-later; exact source/fork/toolchain and complete module notices are collected with product replacement instructions. Linux/macOS use separately pinned official Auth artifacts with platform-specific payload correspondence, while Windows builds pinned commit `4eee58f296d9698a1c2c0ae14d7a0b379c7622d3` plus the tracked no-reuseport patch and records its actual source/build witness. PostgREST is source-built against the matching PostgreSQL 16.15 static client dependency prefix; its actual realized compiler/package plan, native imports and incorporated source/license/recombination materials must pass the component gate. No absolute Homebrew libpq reference or arbitrary SDK copy is accepted as portability. Auth sets its connection search path to `auth, public`; ERP migrations retain `public`. Original root licenses remain at `auth/AUTH_LICENSE.txt` and `postgrest/POSTGREST_LICENSE.txt`, with full dependency/source materials beside them in each component's `third-party-notices/`.

Auth migrates its own schema before `prelude-after-auth.sql` and ERP migrations. JWT material is private `0600` state, not compiled into the window; an incomplete existing key set fails closed rather than being silently rotated. Local-only onboarding permits normal signup unless explicitly disabled. A configured public origin always disables GoTrue open signup, even if a parent environment requests otherwise. Signup policy is forwarded to ERP for the invitation-only remote workflow. JWT audience/default group are explicitly `authenticated`; site URL, external Auth URL and confirmation redirect allowlist are derived only from the reviewed app origin. Autoconfirm remains a local/invitation provisioning policy, not proof of mailbox ownership.

## Ollama

The platform bundles pack Ollama v0.40.11. The archive checksum is checked before staging. The MIT license is `packaging/ollama/OLLAMA_LICENSE.txt`, SHA-256 `5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226`, and it is copied to `bundle/ollama/OLLAMA_LICENSE.txt`.

Linux uses `ollama-linux-amd64.tar.zst`, SHA-256 `7bedab90dd122661be78798e9f0edf37fccf0cccf2699d2c58ea1a3afdc04b6d`. The binary is `bundle/ollama/bin/ollama`, with CPU and Vulkan runners in `bundle/ollama/lib/ollama`. Windows uses `ollama-windows-amd64.zip`, SHA-256 `bda4a493ba8a7c24d57263cd843cd68cee84f44aed4299eeed532acad7eda12a`. The binary is `bundle/ollama/ollama.exe`. macOS uses the universal `ollama-darwin.tgz`, SHA-256 `aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291`. The binary is `bundle/ollama/ollama`, and the Metal runners stay beside it. `ollama --version` in the assemble script must print `0.40.11`. That check does not pull a model.

`cuda_v12` and `cuda_v13` are omitted from Linux/Windows archives to stay within the release asset limit. CPU and Vulkan runners remain; macOS retains Metal. A machine needing CUDA can install upstream Ollama separately. Model performance depends on hardware and must be measured, not inferred from the installer.

If `bundle/ollama/ollama` or `bundle/ollama/bin/ollama` is missing (`ollama.exe` on Windows), the window looks up `ollama` on `PATH`. If neither exists, startup continues.

Both native GUI and headless `serve` start bundled Ollama only if its configured loopback address is unused. The spawned daemon and explicit pull commands receive `OLLAMA_NO_CLOUD=1`; cloud credentials are omitted. Existing Ollama services are left alone, so their owners must independently configure no-cloud mode. Startup never downloads weights. An Ollama process started by this stack is stopped using its matching private process record; an existing external daemon is never stopped.

Weights are not packed or downloaded on startup. The default chat model is `qwen3.5:9b-q4_k_m` (local GGUF), while OCR separately defaults to `qwen3.5:4b` (both Apache-2.0); `OLLAMA_MODEL` and `OCR_MODEL` are separate selectors, not automatic fallbacks. Chat requires GGUF; separate local OCR may use MLX where supported. Browser installation/removal, ASR installation/removal and desktop update require verified owner/admin plus an explicit OS-enrolled operator UUID. CLI pulls are local OS-owner actions. Platform eligibility is not proof that every workload performs well on every host. To install the chat default:

```sh
boombignose pull-model
```

This runs allowlisted local `ollama pull qwen3.5:9b-q4_k_m`; install OCR separately with `boombignose pull-model qwen3.5:4b`. `models` reads loopback `/api/tags`; `remove-model <name>` deletes an allowlisted model. Unknown names are refused before process start. Pulling contacts the registry; inference stays local, and startup/CI smoke never pulls weights. The application checks model metadata to reject remote/cloud aliases before sending business messages; an externally managed daemon still needs independently configured no-cloud policy. Neither successful installation nor a larger model establishes financial-answer quality. OCR needs human review before posting, especially degraded/rotated inputs; no complete current AI quality acceptance is claimed. See [measured host/task limits](../../README.en.md#local-models).

## What is in which installer

Distributions include a separate CGO-disabled `boombignose` headless CLI as well as the unchanged Go/Wails desktop. Linux tar.gz places it beside `BoomBigNose` and `bundle/`; AppImage contains `usr/bin/boombignose`; Windows installs `boombignose.exe` beside `BoomBigNose.exe`; macOS places it at `BoomBigNose.app/Contents/MacOS/boombignose`, discovering resources under `Contents/Resources/bundle`. No display server, GUI toolkit or WebKit is required by the headless binary. Reproducible source invocation: `CGO_ENABLED=0 go build -trimpath -buildvcs=false -o ../dist/boombignose ./cmd/boombignose` with the pinned Go toolchain and module sums. Packaging signs the macOS CLI before sealing the app; never modify an already signed installed app in place.

Historical v0.2.0 was window-only; v0.2.1 added Node/Next/PostgreSQL; v0.3.0 added the fuller local stack. They are not the current release. Published 1.4.4 has Windows x64 setup, macOS arm64 DMG and Linux amd64 tar.gz/AppImage; no production Linux arm64 distribution is claimed from the separate desktop CI artifact. A checksum validates bytes against a trusted release manifest, not publisher identity by itself. The static GitHub Pages brochure neither hosts the ERP nor proves runtime readiness.

## Headless server installation and private access

These instructions require an architecture-matching **current-source assembled distribution**. Until a newer installer is actually published, use the source packaging pipeline, not the 1.4.4 download as a substitute. Keep the installed desktop and its data untouched while evaluating a parallel profile.

### Desktop startup and source artifacts

Use the assembled platform artifacts, leaving their runtime tree intact:

```sh
# macOS arm64: after copying the current-source assembled app into Applications
open /Applications/BoomBigNose.app
# Its separate headless CLI (not the GUI executable):
"/Applications/BoomBigNose.app/Contents/MacOS/boombignose" check
```

```powershell
# Windows x64: from the installed current-source application directory
Start-Process .\BoomBigNose.exe
.\boombignose.exe check
```

```sh
# Linux amd64: from the extracted current-source tar.gz directory
./BoomBigNose
# Headless, in a separate terminal instead of the GUI (never both on one profile):
./boombignose serve
```

Desktop Linux needs WebKitGTK 4.1; the CGO-disabled headless CLI does not. Source commands/platform build prerequisites are in [desktop CI](../../.github/workflows/boombignose-desktop.yml); the complete runtime/installer assembly is in [release workflow](../../.github/workflows/boombignose-release.yml), [Linux](../../packaging/linux/assemble-bundle.sh), [macOS](../../packaging/macos/assemble-bundle.sh) and [Windows](../../packaging/windows/assemble-bundle.ps1) scripts. Compiling a Go executable alone does not bundle the ERP. From `boombignose/`, `CGO_ENABLED=0 go build -trimpath -buildvcs=false -o ../dist/boombignose ./cmd/boombignose` builds only the CLI.

For a fresh desktop profile, use local signup/login, create the first workspace, then enroll and verify TOTP at `/settings/security` with `LOCAL_TOTP_ENROLL=1` explicitly enabled for that process. It can be unset after enrollment; existing factors still require `/login/mfa`. Default ERP is `http://127.0.0.1:3100`; default API/Auth/REST/PG ports are 54321/54323/54324/54329, Ollama 11434. A new public origin changes signup to invitation-only; finish first-account setup before enabling it. Do not use the public development seed account for real records.

macOS source builds are **ad-hoc signed, not Developer ID signed/notarized**. Retain the source/build recipe and license/source materials. Current source excludes Sharp/libvips; only an artifact actually proven to exclude them avoids their redistribution/source/relinking duties. If any distributed LGPL library remains and replacing it invalidates the seal, rebuild/reassemble and ad-hoc re-sign using the same [`make-dmg.sh`](../../packaging/macos/make-dmg.sh) recipe (including nested Mach-O, main and outer app), then install that separately built copy. Do not alter a running signed installation or claim an unchanged signature, notarization or reproducible binary identity. Any required installation/relinking information for the precise distributed build must accompany that release; third-party notices alone are insufficient.

### Modified native components: LGPL source and installation

The original LGPL terms govern modification/recombination of covered libraries and reverse engineering of a combined work to debug those modifications. Company licenses and product policy do not prohibit those activities. This preserves third-party permissions, without granting new rights to unrelated proprietary `ee/` or `bignose/` code. Operational safety recommendations below are not additional conditions on LGPL rights.

Retain each distributed component's complete `third-party-notices/` directory with its runtime: full original notices, source archives, exact version/hash provenance, build/recombination material and this installation information. For Auth, start with `auth/third-party-notices/index.json` and `evidence/recombination.json`. They identify the exact Auth source commit, locally replaced godotenv fork, go-ethereum source and Go toolchain; use those supplied sources and the recorded upstream-derived command, not an arbitrary current checkout or similarly named package. Extract/modify the desired library, select the modified library directory with Go's recorded local replacement mechanism, and rebuild the combined Auth executable for the original `GOOS`/`GOARCH` using the supplied application and dependency sources. For PostgREST, use its recorded realized package plan, source archives, source-build recipe, retained linkable objects and recombination command when replacing a statically linked LGPL component. Preserve the applicable original notices and your own changes.

**Install a private modified runtime without changing the installed app:**

1. Copy the complete immutable `bundle/` from the matching current-source distribution to a separate, user-controlled absolute directory without spaces. Keep the original tree for rollback. Do not copy credentials, attachments, PostgreSQL data or model weights into an installer/runtime tree.
2. In that private copy, replace only the rebuilt component at its normal relative path: `auth/auth` or `postgrest/postgrest` on macOS/Linux; `auth/auth.exe` or `postgrest/postgrest.exe` on Windows. Keep required native libraries beside it according to its supplied build recipe. Do not replace it with another major version or an unrelated host SDK. Preserve executable permissions.
3. On macOS, ad-hoc sign your rebuilt executable and any changed Mach-O libraries with `codesign --force --sign - /absolute/path/to/your/rebuilt-file`. This uses your own ad-hoc signature, not a publisher key or notarization. The external private runtime is not inside the installed `.app` seal, so this route does not require modifying or re-signing the installed app.
4. Use the **current-source built** `boombignose` CLI, not an older published CLI assumed to have the same commands. Set `BOOMBIGNOSE_BUNDLE` to the resolved absolute private runtime directory and `BOOMBIGNOSE_DATA` to a separate private profile path, choose unused private ports, and run `boombignose serve`. The bundle override selects your modified component; startup does not require a publisher-owned binary hash/signing identity for Auth or PostgREST. The original release's source-attestation hashes are not a claim that your modified binary is unchanged.
5. Test the modified copy on a separate synthetic/restored profile first. To stop it, use `boombignose stop` with that same private profile configuration; do not stop another app/profile or remove its database. Before changing a profile that holds real records, make a verified backup and stop that owned stack. To roll back, stop only the modified stack and select the unchanged retained runtime with the same explicit bundle setting; never reset data to work around a failed binary replacement.

If you instead want a modified desktop `.app`, rebuild/reassemble a **separate copy** from the matching project sources using the platform assembly and [`make-dmg.sh`](../../packaging/macos/make-dmg.sh) signing order, then ad-hoc sign its changed nested Mach-O files and outer application seal. Do not modify a running installed app, claim an unchanged publisher signature or depend on an undisclosed signing key. Windows/Linux external-runtime copies use the same explicit bundle/profile selection and do not require an Apple signing identity. No network service is required merely to authorize the modified runtime.

Redistributing a modified work still requires carrying the applicable original notices and complete source/recombination/installation materials for **your actual modified build** under their original terms. Do not relabel it as an unchanged publisher artifact. A source collector correctly rejecting an original-release identity mismatch is not a prohibition on private modification; preserve and identify the changed sources and build recipe instead of fabricating the original identity.

### Linux headless service

1. Use the current-source Linux amd64 tar.gz (not an AppImage mount/GUI executable), retaining `boombignose` and `bundle/` together. For a published release, verify its matching `SHA256SUMS` before extracting. PostgreSQL must run as a dedicated non-root account. Install under a stable root-owned release directory such as `/opt/boombignose/releases/SOURCE_ID`; a `current` symlink may select the executable, but `BOOMBIGNOSE_BUNDLE` must name the **resolved real release path**, not a symlink. The new package must contain matching `psql`, `pg_dump` and `pg_restore`; do not install random PATH clients to bypass a missing-tool error. Native PostgreSQL major is 16.
2. Create the service account once (skip account creation if it already exists), then create an owned private data parent and operator-controlled environment file:

   ```sh
   getent passwd boombignose >/dev/null || sudo useradd --system --create-home --home-dir /var/lib/boombignose --shell /usr/sbin/nologin boombignose
   sudo install -d -m 0700 -o boombignose -g boombignose /var/lib/boombignose
   sudo install -d -m 0750 -o root -g boombignose /etc/boombignose
   # Write /etc/boombignose/server.env, root-owned and mode0640:
   ```

   ```ini
   BOOMBIGNOSE_BUNDLE=/opt/boombignose/releases/SOURCE_ID/bundle
   BOOMBIGNOSE_DATA=/var/lib/boombignose/pg
   BOOMBIGNOSE_ERP_URL=http://127.0.0.1:33100
   BOOMBIGNOSE_API_PORT=55421
   BOOMBIGNOSE_AUTH_PORT=55423
   BOOMBIGNOSE_REST_PORT=55424
   BOOMBIGNOSE_PG_PORT=55429
   OLLAMA_HOST=127.0.0.1:11435
   OLLAMA_MODEL=qwen3.5:9b-q4_k_m
   OCR_MODEL=qwen3.5:4b
   LOCAL_TOTP_ENROLL=1
   ```

   Replace `SOURCE_ID` with the actual immutable release/source-build directory. Port values are examples. All five ERP/API/Auth/REST/PG ports must be distinct decimal integers `1..65535`; occupied ports fail safely. Choose an unused, distinct Ollama port for an independent daemon. The unit explicitly gives the dedicated nonroot account `HOME=/var/lib/boombignose`, so its owned model state defaults to `/var/lib/boombignose/.ollama`, separate from a desktop user's cache; a port alone does not isolate storage. Do not run a second daemon under that same HOME against the same cache. No service address becomes public. Remove `LOCAL_TOTP_ENROLL` after enrolled factors are verified if you want to close the enrollment form.
3. Save this unit as `/etc/systemd/system/boombignose.service` (root-owned `0644`). Reapplying the same unit/config and `daemon-reload` is repeatable; it does not reset data.

   ```ini
   [Unit]
   Description=BoomBigNose private native ERP
   After=network.target

   [Service]
   Type=simple
   User=boombignose
   Group=boombignose
   Environment=HOME=/var/lib/boombignose
   WorkingDirectory=/opt/boombignose/current
   EnvironmentFile=/etc/boombignose/server.env
   ExecStart=/opt/boombignose/current/boombignose serve
   UMask=0077
   KillMode=control-group
   TimeoutStopSec=60
   Restart=on-failure
   RestartSec=10
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   `sudo systemctl daemon-reload` then `sudo systemctl enable --now boombignose`. Inspect `systemctl status boombignose` and `journalctl -u boombignose` locally; never publish raw logs/environment. `systemctl stop` terminates this unit's cgroup only. Do not use `killall`, process-name scans or stop another desktop's ports.
4. Health: `curl --fail http://127.0.0.1:33100/api/health`; Auth liveness: `curl --fail http://127.0.0.1:55421/auth/v1/health`. The general health endpoint is liveness, not proof of successful accounting, login, OCR, database restore or model performance. Also sign in, open workspace data and exercise the requested action. `boombignose check` validates local endpoint/port policy offline.
5. Before remote access, create the first owner/workspace using local-only onboarding. On a remote headless host, keep the SSH forward loopback-only: `ssh -N -L 33100:127.0.0.1:33100 operator@SERVER`, then open `http://127.0.0.1:33100` on the operator's browser. Finish enrollment/verification at `/settings/security`; do not forward Auth/DB ports. Stop the service, then persist the exact reviewed HTTPS origin (example uses a separate unused Serve port8443):

   ```sh
   sudo -u boombignose env BOOMBIGNOSE_DATA=/var/lib/boombignose/pg \
     /opt/boombignose/current/boombignose configure-public-origin https://erp.example.ts.net:8443
   sudo systemctl start boombignose
   ```

   Only a bare HTTPS origin is accepted: no credentials, slash/path, query or fragment. Config is stored atomically in private owned `pg.secrets/runtime.json`; GUI Launch Services startup reads the same file without inheriting shell environment. An explicit validated `BOOMBIGNOSE_PUBLIC_ORIGIN` overrides the persisted value. `configure-public-origin off` removes the public origin policy on the next restart; it does not remove an external tunnel. Public origin changes need a restart.
6. Configure private mobile transport using the following section. Native login/refresh/logout/user/MFA stays on same-origin `/auth/local/*`; the browser client retains the original Supabase project URL for cookie naming. Public-origin signup is invitation-only even if inherited configuration requests otherwise. Invitees register the matching email, log in as themselves and accept a live invitation; there is no owner-session handoff or automatic role grant. Native autoconfirm is not verification of mailbox ownership.

### Private Tailscale HTTPS without replacing other services

Use an independently authorized tailnet, MagicDNS and HTTPS certificates. Official references: [Serve CLI](https://tailscale.com/kb/1242/tailscale-serve), [HTTPS and public certificate-name disclosure](https://tailscale.com/kb/1153/enabling-https), and [ACL/grant behavior](https://tailscale.com/kb/1018/acls). Enabling HTTPS publishes the certificate hostname to Certificate Transparency; do not put personal/business secrets in machine names. Serve is tailnet-only; Funnel exposes to the public internet and is not the deployment path here.

```sh
tailscale status
tailscale serve status
tailscale funnel status
# Only after checking that HTTPS8443 has no existing mapping/Funnel:
tailscale serve --bg --https=8443 http://127.0.0.1:33100
tailscale serve status
```

Use the installed distribution's actual CLI (on some macOS installs `/Applications/Tailscale.app/Contents/MacOS/Tailscale`) and its required local operator privileges. Do not run `serve reset`, reuse an occupied mapping, enable Funnel, reset someone else's Funnel, or bind private backend services to the LAN. If8443 is in use, choose another unused port and configure exactly that origin, including port, in native `configure-public-origin`; restart the native stack. Do not put ERP under a path prefix. Preserve every unrelated existing mapping.

Restrict tailnet ACLs/grants to authorized users/devices and this host's ERP HTTPS port only; default tailnet policy can allow all peers. Tailnet access does not replace ERP role checks. On an authorized phone, connect Tailscale, open the exact HTTPS origin, sign in normally and complete enrolled MFA. Optional QR pairing only records a connection; it does not supply a browser session or authorize business data. A working host liveness endpoint is not real-phone proof.

To remove **only this example mapping**, use `tailscale serve --https=8443 off`; do not reset global Serve. `boombignose configure-public-origin off` plus restart changes ERP policy but does not remove the mapping; removing Serve does not clear the persisted origin. Unlinking an ERP mobile record does not sign out browser sessions. Removing a tailnet device/ACL blocks that path, not alternate access, pre-existing downloaded data or sessions elsewhere; revoke account sessions/workspace access separately where required.

### Backup, migration and recovery

The ERP backup/restore screen requires a verified signed-in session with enrolled MFA step-up when applicable, active owner/admin role **and** an OS-enrolled machine operator. Mutation requests also require the trusted Origin. After independently checking the intended account's actual UUID, run as the native service account with the exact data path:

```sh
sudo -u boombignose env BOOMBIGNOSE_DATA=/var/lib/boombignose/pg \
  /opt/boombignose/current/boombignose configure-operators USER_UUID
sudo systemctl restart boombignose
# To revoke every machine operator, use the same command with "off" instead.
```

Replace `USER_UUID` with the verified user UUID, not an email/workspace UUID. Up to 16 explicit user UUIDs are supported: `configure-operators UUID [UUID...]`. The command replaces the entire allowlist, so include every intended operator. Policy is in private `pg.secrets/runtime.json`; inherited `BOOMBIGNOSE_OPERATOR_USER_IDS` is ignored. Absent policy denies the operation; `configure-operators off` revokes after restart. Changing origin/operator settings preserves the other policy. This permission affects **all workspaces**, not just the active one.

The browser export is a custom PostgreSQL **database-only/all-workspaces** dump with a SHA-256 sidecar. It includes account/business rows and preserves archive ownership/ACL information, but excludes attachment bytes, native secrets/configuration and models. It uses only the resolved native bundle's matching clients, exact data path/port and private passfile; no PATH/`BOOMBIGNOSE_PG_BIN` fallback. A live wrong-password rejection plus authenticated cluster/HBA checks refuse trust authentication. Dump size is limited to 512 MiB and tool execution to 15 minutes. The server permits one in-process backup/restore operation at a time; this is not a maintenance lock against other users.

Restore in Settings requires both files, `trustedSource=yes` and the exact confirmation `RESTORE ALL WORKSPACES`. `pg_restore --clean --if-exists --exit-on-error --single-transaction` replaces database contents across all workspaces; it does not strip owners/ACLs. A failed transaction rolls database changes back, **not arbitrary external side effects from malicious SQL**. A dump can execute SQL with database-administrator authority and access files/code under the server's OS account. A checksum proves integrity, not authorship, trust or safety. Restore only operator-controlled archives, pause other users, take a full cold backup first, and validate in an isolated recovery profile. Reload and sign in again afterward as needed; attachment/native-secret recovery is separate.

Both native restore paths reject wholly ACL-stripped archives before mutation. Recovery requires administrator credentials able to create a temporary `NOLOGIN SUPERUSER` executor: its clean default ACLs prevent the administrator's existing default grants from widening restored table/column access. Restore retains archive owners/grants; bounded cleanup reassigns residual executor-owned objects to the administrator and removes only the marked recovery role, even when the request is cancelled. A cleanup failure is an error, including after a committed restore; inspect the reported outcome before retrying. A remaining ACL/default-ACL entry is **not** proof that every expected owner/grant is correct, or that an archive is trustworthy. After recovery, verify ordinary login, workspace isolation, restricted columns, ownership and sequence use with real roles; do not rely on a successful administrator restore alone.

**Full cold backup is the recovery baseline.** Stop the owned service and confirm its PostgreSQL process has exited. Archive `/var/lib/boombignose/pg` **and** `/var/lib/boombignose/pg.secrets`, preserving owners/permissions/Windows ACLs. The first contains database files, JWT keys and default private attachments; the second contains role credentials, secure-cluster marker, persistent origin/operator policy and any backup passfile. Include any separately managed file root, the private environment file and the exact app/runtime/release/PG-major identity. Ollama weights/state may live under the service account's separate model directory; either include them explicitly or record the exact model/digest for an approved re-download. Keep signing/rebuild information separately where required. Use a new private timestamped destination, checksum it, encrypt off-device copies and test recovery into a separate profile/unused ports. Dumps, private permissions and SCRAM do not provide at-rest encryption.

The **OS-operator CLI** is separate from the browser boundary: [`backup.go`](../../boombignose/internal/cutover/backup.go) takes only `export --url ... --dir ...` or `restore --url ... --file ...`; it does not implement browser session/MFA/operator-list checks or the browser confirmation fields/size limits. Its recovery export preserves owners/grants, and restore applies them with `--clean --if-exists --exit-on-error --single-transaction`. Unlike native recovery, generic `cutover apply`/`rollback` intentionally omit source owners/grants and adopt the destination database role; do not use those archives as native recovery backups. The CLI accepts `BOOMBIGNOSE_PG_BIN`/PATH tooling, so explicitly select the matching packaged tools. Never infer the browser's preflight guarantees from the CLI. Example run **as the service account**, with its database already running:

```sh
umask 077
export BOOMBIGNOSE_DATA=/var/lib/boombignose/pg
export BOOMBIGNOSE_PG_PORT=55429
export BOOMBIGNOSE_PG_BIN=/opt/boombignose/releases/SOURCE_ID/bundle/postgres/bin
mkdir -p /var/lib/boombignose/backups
/opt/boombignose/current/boombignose backup export \
  --url postgres://boombignose@127.0.0.1:55429/boombignose \
  --dir /var/lib/boombignose/backups
```

The native CLI constructs a private libpq passfile from that profile's credentials; do not put passwords in URLs/argv/logs. For an isolated **initialized and running** recovery profile, select its own data, port and matching runtime; do not point a restore at an unrelated listener:

```sh
export BOOMBIGNOSE_DATA=/var/lib/boombignose-recovery/pg
export BOOMBIGNOSE_PG_PORT=55439
# BOOMBIGNOSE_PG_BIN still names the matching packaged clients.
/opt/boombignose/current/boombignose backup restore \
  --url postgres://boombignose@127.0.0.1:55439/boombignose \
  --file /var/lib/boombignose/backups/boombignose-TIMESTAMP.dump
```

Replace `TIMESTAMP` with the actual exported filename; keep its `.sha256` sidecar alongside it. CLI restore verifies that sidecar, not provenance. Standard browser-native custom archives with their sidecars are also accepted. The administrator-SQL/whole-database risks apply equally. These are source-matched command examples, not evidence that backup/restore or recovery has completed successfully.

**Older CLI exports stripped ACL metadata and are not complete native recovery archives.** CLI restore now rejects archives with no ACL entries before changing the target. Removing `--no-acl` at restore time cannot recreate absent grants. Re-export from the trusted original database with the corrected CLI/browser, or recover the source-matched full cold backup. A checksum cannot recover missing metadata. Do not grant blanket access to `public` tables: some native columns contain network credentials and intentionally have narrower column grants. Do not replay the DDL journal as a grant repair. The ACL-entry check detects stripped archives, not the correctness or trustworthiness of arbitrary archives.

Initialize the isolated target with the matching native release first so all original owner/grantee roles exist; database-only dumps do not include cluster roles or credentials. A missing role, owner assignment or grant error aborts the restore transaction rather than claiming success. Preserve the original source ACLs, not merely row counts. Before cutover, authenticate with a real ordinary account (not the administrator/service role) and exercise its actual table/sequence/function access, workspace RLS isolation, and denial of restricted credential columns. Also test browser login and normal workspace reads. Record failed missing/wrong-password attempts and checksum rejection; a superuser row-count query alone does not prove recovered authorization.

For an existing **owned** trust-authenticated native cluster:

1. Stop its original service/application intentionally; do not stop unrelated services. Take the full cold backup above before changing anything. Never run `initdb`, delete data, or use a database reset as an upgrade.
2. Use the new CLI with the exact existing absolute data directory and matching PostgreSQL16 bundle. Example after a full cold backup, with the original service stopped:

   ```sh
   sudo -u boombignose env BOOMBIGNOSE_DATA=/var/lib/boombignose/pg \
     BOOMBIGNOSE_BUNDLE=/opt/boombignose/releases/SOURCE_ID/bundle \
     /opt/boombignose/current/boombignose secure-db
   ```

   It checks private ownership and that no recorded postmaster is live. Custom HBA rules/includes or a different HBA configuration layout are refused for explicit owner review. This is not a general PostgreSQL major-version upgrade utility.
3. Migration runs PostgreSQL's own offline single-user mode: no listener, passwords only on private stdin, SCRAM produced by PostgreSQL. Original HBA is retained privately as `pg.secrets/pg_hba.legacy.conf`. Default local/loopback trust rules become SCRAM; `postgresql.conf`, existing tables and rows are not replaced. Credentials are kept for repeatable retry, never printed. Start normally afterward to authenticate and apply outstanding migrations.
4. If ownership, major-version compatibility, custom HBA policy or private Windows ACL prerequisites cannot be established, migration stops with data intact. Resolve with the cluster owner; never loosen authentication or expose a temporary trust listener. On Windows, native private state requires a protected owner-only DACL, not just POSIX-style mode bits.

Recovery: leave the failed profile untouched; restore the cold archive into an isolated profile with its credential directory and matching PostgreSQL major. Because the secure-cluster marker deliberately binds to the original absolute data path, a relocated physical recovery needs an explicit owner-reviewed marker update to that recovered path before startup (never edit the original profile). Authenticate and verify rows/attachments, then exercise login and an actual backup/restore before switching the stable release pointer. Never downgrade an already-migrated database merely by swapping binaries; use the tested cold backup for rollback.

For a deliberately relocated physical recovery, after verifying the recovered cold archive and while that recovery PostgreSQL is stopped, run as its owning account: `printf '%s\n' /var/lib/boombignose-recovery/pg > /var/lib/boombignose-recovery/pg.secrets/cluster.path`. Preserve `0600` ownership/mode, configure a local-only recovery origin and unused ports, and never alter the original profile's marker. This is an explicit relocation acknowledgement, not an automatic recovery or database reset.

