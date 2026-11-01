# BoomBigNose Local Supabase Stack & ERP Runtime

`scripts/local/stack.mjs` (backed by `lib/local/stack.mjs`) manages the local Supabase stack (`project_id = "boombignose-erp"`, API port `54421`, DB port `54422`) and serves the production ERP runtime for BoomBigNose on `127.0.0.1`. Cloud Supabase is never touched.

## Commands & Package Scripts

- `node scripts/local/stack.mjs doctor`
  Prints JSON `{ "docker": "running"|"stopped"|"missing", "cli": "<version>|null", "stack": "running"|"stopped", "exposed": true|false }` to stdout. Never prints secrets or keys. Parses CLI output from stdout only (ignoring stderr update notices). Reports `exposed: true` when any `boombignose-erp` container port is bound to `0.0.0.0`.
- `pnpm local:up` (`node scripts/local/stack.mjs up`)
  Exits `3` with a clear message if Docker is not running. Starts the `boombignose-erp` stack only if it is not already running, excluding unused services (`EXCLUDED_SERVICES`: `studio`, `imgproxy`, `vector`, `logflare`, `edge-runtime`, `supavisor`, `realtime`, `storage-api`), then runs `supabase migration up --local`.
- `pnpm local:status` (`node scripts/local/stack.mjs status`)
  Prints the stack health JSON (no secrets) and exits `0` when running or `1` when stopped.
- `pnpm local:migrate` (`node scripts/local/stack.mjs migrate`)
  Applies pending local migrations via `supabase migration up --local`.
- `pnpm local:stop` (`node scripts/local/stack.mjs stop`)
  Runs plain `supabase stop` for `boombignose-erp` with data preserved.
- `pnpm local:serve --port <N> [--cache-dir <D>]` (`node scripts/local/stack.mjs serve --port <N> [--cache-dir <D>]`)
  Builds the committed `HEAD` in an isolated cache directory and runs `next start -H 127.0.0.1 -p <N>`. Prints `ready http://127.0.0.1:<N>` once `GET /login` responds, forwards `SIGTERM`/`SIGINT` to the server, and exits automatically if its parent process dies.

## Data-Safety Rules

- Every Supabase CLI invocation passes `--workdir <erp dir>` and first verifies `<erp dir>/supabase/config.toml` has `project_id = "boombignose-erp"`. Calling the CLI in a directory without that config would auto-create and start a separate project on ports `54321+`.
- The manager never runs `supabase db reset`, `supabase stop --no-backup`, or `supabase stop --all`.
- Other Docker stacks on the machine (such as the owner's QA lane `erp-e9b1776c30-6`) are never stopped or modified.

## Build Cache & Desktop App Lifecycle

- Default cache directory: `~/.bignose/erp` (or `$BIGNOSE_HOME/erp`, overridable via `--cache-dir`).
- For each commit SHA (`git rev-parse HEAD`, then archived by that SHA), `serve` exports a clean tree from `git archive` (with no `.env*` files so nothing from `.env.local` is ever inlined), runs `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts`, and runs `next build` with no `NEXT_PUBLIC_*` variables in the build environment.
- Only the current build and the `last-good` build are retained on disk; older commit builds are pruned. Pruning only touches `<sha>`, `<sha>.tmp` and `<sha>.tar` entries, so other files in a mistyped `--cache-dir` are never deleted. A `.build.lock` file serializes concurrent builds.
- The first launch after a new commit requires network access because `next/font/google` fetches Google Fonts at build time. When a rebuild fails (for example while offline), `serve` logs a notice and falls back to the `last-good` build.
- BoomBigNose desktop serves the ERP on port `3100`, matching `site_url = "http://127.0.0.1:3100"` in `supabase/config.toml`.
- Port `3100` is also the BBN worktree `portBase`, so a worktree's `.env.worktree` can be assigned `PORT=3100`. If port `3100` (or any requested `--port`) is already in use, `serve` exits immediately with a clear busy-port message.
- Before running the acceptance HTML checks on ports `3988` and `3989`, ensure both ports are free so a leftover server cannot answer in place of the fresh build.

## Runtime Public Env & Desktop Runtime Limits

- `app/layout.tsx` mounts `<PublicEnvScript />` from `lib/supabase/public-env/`, which calls `await connection()` (`next/server`) at request time and renders `<script id="erp-public-env" type="application/json">` containing `{ "url", "anonKey" }` with `<` escaped as `\u003c`.
- `lib/supabase/client.ts` reads the runtime script tag first and falls back to the build-time `process.env.NEXT_PUBLIC_*` values (literal references, so Next.js inlines them), allowing a single cached build to run against any local Supabase stack. Web/Hostinger deployments continue to work as before.
- Because `<PublicEnvScript />` awaits `connection()` in the root layout, every route renders dynamically at request time, web builds included.
- `serve` starts `next start` with a strict allowlist environment:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` read at runtime from `supabase status -o env` (never persisted to disk or printed; non-local hosts outside `127.0.0.1`/`localhost`/`::1` are refused),
  - `NEXT_PUBLIC_APP_URL=http://127.0.0.1:<port>`,
  - `PATH`, `HOME`, `TMPDIR`, `LANG`, and `NODE_ENV=production`,
  - `OLLAMA_HOST` when it is loopback, and `OLLAMA_MODEL` when it is set.
- The allowlist drops cloud model keys, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, and `N8N_*`, so a parent process that has a cloud model key does not hand it to `next start`. A remote `OLLAMA_HOST` is dropped:
  - Cron routes (subscription renewals, follow-ups, outbox processing) do not run.
  - Quote and invoice email delivery via Resend is disabled.
  - Client portal links use `NEXT_PUBLIC_APP_URL` and therefore point at `http://127.0.0.1:<port>`.

## Local AI models

The desktop starts bundled Ollama on loopback and does not pull a model while it boots. The install screen is the ERP Settings page, `/settings#local-models`. It talks to `127.0.0.1:11434` and refuses any other host. An owner or admin can install or remove a model. The weights download only after that click, with progress and the daemon's error, and they are not stored in git.

| Modality | Where it runs in Ollama 0.40.11 | What the screen does |
|---|---|---|
| Text | Linux, Windows, macOS | Install `qwen3:4b`. Deal summaries, follow-up drafts, meeting notes, and the month-end note call it. |
| Vision | Linux, Windows, macOS | Install `qwen2.5vl:3b`, then read one JPEG, PNG, or WebP on this page. The text is not saved as an accounting entry. |
| Image generation | macOS only | Install `x/flux2-klein:4b` and draw from a short prompt. Other operating systems show “not available in this build” and do not download the weights. |
| Speech | Apple Silicon only | Install `phonon` and speak one short English sentence in the built-in voice. It is not Thai and it is not a clone of the operator's voice. |
| Video, speech-to-text, voice clone | Not in this Ollama build | The screen says not available. There is no ComfyUI, Whisper, or sample-upload control. |

`boombignose models`, `boombignose pull-model [name]`, and `boombignose remove-model <name>` use the same allowlist. Startup still cannot run `ollama pull`.

## LAN Exposure & Owner-Applied Mitigation

By default, the Supabase CLI binds local container ports (`54421` API, `54422` Postgres DB) to `0.0.0.0` using the default Postgres password (`postgres`) and the CLI's well-known local JWT secret. On an untrusted LAN, another machine could reach those ports (`doctor` surfaces this as `"exposed": true`).

Mitigation is owner-applied and is never changed automatically by `stack.mjs`:
1. In Docker Desktop -> Settings -> Docker Engine, set `"ip": "127.0.0.1"` so published container ports bind only to loopback by default, then restart Docker Desktop and the local stack; or
2. Enable the macOS Application Firewall (System Settings -> Network -> Firewall) to block incoming LAN connections to Docker/container ports.
