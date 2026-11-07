# ERP platform port notes

2026-11-08. Scope is `boombignose/internal/erpplatform` in this worker's worktree. Source production runtime remains Next.js. No files outside this package were changed.

## Current snapshot and acceptance

Implemented 68 operation keys from the settings, authentication, forbidden and API source files. `registry_test.go::TestOperationCoverageAgainstSource` discovers the scoped server actions, page loaders, direct route exports and aliased HTTP methods, checks registry coverage, and checks other Go packages for duplicate literal keys. `app/warehouse/page.tsx::load` is deliberately reused from `internal/erpmetrics/service.go`, whose `organizationPage` already ports `components/warehouse/data.ts`; duplicating it would violate ownership. `app/warehouse/error.tsx` is client error UI and has no server operation. Type declarations, React client components, `dynamic` and `runtime` exports are not request handlers.

Implementation is source code plus in-memory tests, not a production runtime cutover. Missing trusted transport/native/authentication adapters and incompatible existing database grants are deployment blockers documented below. No database, model, server, npm/Next process, native helper, outbound delivery or dependency installer was run. No credentials or production records were read.

## Operation keys

- `app/(app)/settings/accounting/page.tsx::load`
- `app/(app)/settings/actions.ts::updateOrgSettings`
- `app/(app)/settings/chart/actions.ts::installThaiSmeChart`
- `app/(app)/settings/chart/page.tsx::load`
- `app/(app)/settings/connections/page.tsx::load`
- `app/(app)/settings/finance/page.tsx::load`
- `app/(app)/settings/lead-forms/actions.ts::createLeadForm`
- `app/(app)/settings/lead-forms/actions.ts::disableLeadForm`
- `app/(app)/settings/lead-forms/page.tsx::load`
- `app/(app)/settings/local-actions.ts::checkForUpdate`
- `app/(app)/settings/local-actions.ts::readLocalLog`
- `app/(app)/settings/org-actions.ts::acceptInvitation`
- `app/(app)/settings/org-actions.ts::inviteMember`
- `app/(app)/settings/org-actions.ts::revokeInvitation`
- `app/(app)/settings/page.tsx::load`
- `app/(app)/settings/purchasing/page.tsx::load`
- `app/(app)/settings/security/page.tsx::load`
- `app/api/assistant/chat/route.ts::POST`
- `app/api/assistant/mcp/route.ts::GET`
- `app/api/attachments/[id]/route.ts::GET`
- `app/api/cron/followups/route.ts::GET`
- `app/api/cron/followups/route.ts::POST`
- `app/api/cron/outbox/route.ts::POST`
- `app/api/cron/replenishment/route.ts::GET`
- `app/api/cron/replenishment/route.ts::POST`
- `app/api/cron/subscriptions/route.ts::GET`
- `app/api/cron/subscriptions/route.ts::POST`
- `app/api/desktop-update/route.ts::POST`
- `app/api/desktop-window/route.ts::GET`
- `app/api/desktop-window/route.ts::POST`
- `app/api/health/route.ts::GET`
- `app/api/local-asr/install/route.ts::DELETE`
- `app/api/local-asr/install/route.ts::POST`
- `app/api/local-asr/transcribe/route.ts::POST`
- `app/api/local-backup/restore/route.ts::GET`
- `app/api/local-backup/restore/route.ts::POST`
- `app/api/local-backup/route.ts::GET`
- `app/api/local-backup/route.ts::POST`
- `app/api/local-models/image/route.ts::POST`
- `app/api/local-models/pull/route.ts::POST`
- `app/api/local-models/route.ts::DELETE`
- `app/api/local-models/route.ts::GET`
- `app/api/local-models/speech/route.ts::POST`
- `app/api/local-models/vision/route.ts::POST`
- `app/api/mobile/devices/[id]/route.ts::DELETE`
- `app/api/mobile/devices/route.ts::GET`
- `app/api/mobile/pair/redeem/route.ts::POST`
- `app/api/mobile/pair/start/route.ts::POST`
- `app/api/mobile/status/route.ts::GET`
- `app/api/network/devices/[id]/revoke/route.ts::POST`
- `app/api/network/devices/route.ts::POST`
- `app/api/network/policy/route.ts::POST`
- `app/api/network/route.ts::GET`
- `app/api/network/telemetry/route.ts::POST`
- `app/api/ocr/page/route.ts::POST`
- `app/api/webhooks/n8n/followup/route.ts::GET`
- `app/api/webhooks/n8n/followup/route.ts::POST`
- `app/api/webhooks/n8n/invoice-overdue/route.ts::GET`
- `app/api/webhooks/n8n/invoice-overdue/route.ts::POST`
- `app/api/webhooks/n8n/project-deadline/route.ts::GET`
- `app/api/webhooks/n8n/project-deadline/route.ts::POST`
- `app/auth/confirm/route.ts::GET`
- `app/auth/local/[...path]/route.ts::DELETE`
- `app/auth/local/[...path]/route.ts::GET`
- `app/auth/local/[...path]/route.ts::POST`
- `app/auth/signout/route.ts::POST`
- `app/forbidden.tsx::load`
- `app/login/actions.ts::saveLoginLocale`

## Settings and authentication behavior

`settings.go`, `loaders.go`, `security.go`, `http.go`, `logs.go` and `service.go` were checked against `app/(app)/settings/**`, `app/auth/**`, `app/login/actions.ts`, `app/forbidden.tsx`, `lib/auth.ts`, `lib/auth/totp.ts`, `lib/supabase/{native-auth-proxy,trusted-origin,redirect,auth-cookies,workspace-session}.ts`, `lib/lead-forms/input.ts`, `lib/install/{logs,log-names}.ts`, `lib/release/{version,update-check,update-plan}.ts`, and `ee/accounting/settings-page.tsx`.

Settings preserve workspace capability checks, exact nonnegative rounded satang through `internal/money.Satang` and rational arithmetic, tenant-scoped upsert/name update, optional burn clearing, invitation token refresh/expiry/revocation, lead owner membership validation, secure random lead tokens, idempotent disabling, audit writes, redirects and refresh paths. Missing audit entity IDs are null, matching the UUID schema. Team names use the existing scoped `record_activity_assignees` RPC because `erpcore/query.go` deliberately limits direct profiles reads to self. Soft settings queries use separate transactions so one failed PostgreSQL query cannot abort later optional reads. Pro/community accounting behavior and Thai/English security/forbidden messages are retained.

Auth proxy retains the fixed loopback upstream, anonymous key, endpoint/query allowlist, no cookie forwarding, no redirect following, strict bearer shape, forbidden service credential comparison, 32 KiB request / 256 KiB ordinary response / 1 MiB enrollment response limits, fifteen-second deadline and safe failure messages. Origin trust comes only from configured origins, canonicalized for hostname/default ports; empty Origin never falls back to Referer. URL return validation rejects external/auth destinations, percent-dot traversal, invalid UTF-8 and decoded controls/backslashes. Signout preserves provider cookie changes and expires every auth chunk, verifier and active workspace cookie. Start logs stay inside OpenRoot confinement with a three-file allowlist, 64 KiB tail cap and secret redaction. Release checks use only a fixed public release API and canonical release links through an injected HTTP transport.

## Unrepresentable source flows and shared contract gaps

- `erpwire.Actor` requires workspace membership before any Store transaction. TS `acceptInvitation` and `saveLoginLocale` can operate for a verified signed-in subject with no workspace. Those initial pre-workspace branches cannot be represented by the present Store/Actor contract without inventing membership or bypassing RLS. Their operation keys and existing-workspace branches are implemented; initial invitation acceptance and pre-onboarding locale persistence remain deliberately unported until the shared owner provides a subject-bound least-privilege authentication transaction contract. The zero Actor follows the signed-out redirect/false branch; the router must distinguish a verified pre-workspace subject and must not fabricate an Actor to bypass this gap. `WorkspaceSession.ActivateWorkspace` must set the HTTP-only active_org cookie with the source lifetime, SameSite, Secure policy and path after verifying membership.
- `SessionAuth` is a trusted provider interface for OTP/PKCE/cookies and live user lookup. `SecurityOptions.AuthTransport` must use an ordinary loopback HTTP transport and must not rewrite the fixed target or forward privileged credentials. Native auth intentionally exists before workspace membership; it is not a generic database proxy. `WithRequest` may only be called by the trusted HTTP adapter for the login-locale action.
- `Response.Cookies` must become repeated Set-Cookie headers. `ActionResponse.Refresh` must retain source layout invalidation semantics for acceptInvitation's root path. The current shared action response has only string paths; the HTTP/UI adapter must treat that operation's `/` refresh as layout invalidation, as the TS action does.
- The package writes no migrations and provisions no identities. Source-defined browser actions use Store.Write only with bound actors; ordinary AI and API database identities remain read-only. An administrator must review any separate human action/native operator capability, enforce grants/RLS, and test allowed and denied operations under the exact deployment identities. Fake Store tests do not establish live enforcement.
- Fixed source errors and approved `BusinessMessage()` errors are returned. Raw PostgreSQL/provider errors are not exposed because `erpcore.DatabaseError` deliberately hides them. Exact raw database error.message parity is unavailable through the shared contract; preserving that leak would contradict the existing safe error surface.

## Mobile/network boundaries and gaps

`erpwire.Actor` requires a verified workspace user, live membership and MFA. Its `Store` has no pre-workspace pairing/device credential lookup identity. `CredentialResolver` is a package-local trusted authentication contract taking purpose plus token hash and returning an actor. It must not deserialize client claims, reuse the browser actor, invent membership, bypass RLS, or use a service role. Handlers then re-read token hashes through org-scoped Store transactions and restrict the resulting authority to the specific connection/ingest operation. Missing credential resolution fails closed. A runtime adapter is required, and source behavior for a long-lived device after its original user loses membership cannot be represented by the current immutable workspace Actor contract. Do not enable these device endpoints by weakening Actor validation.

The inspected `supabase/migrations/20261103090000_mobile_devices.sql` explicitly revokes all mobile table privileges from `authenticated` and provides no authenticated RLS policies. `supabase/migrations/20261106090000_network_visibility.sql` excludes `token_hash` from authenticated SELECT and grants `ingest_network_report` only to `service_role`. Consequently a production deployment cannot run the mobile or telemetry flows with the current safe authenticated Store. A human administrator must provision and verify narrowly scoped credential authentication and ingest authority with database grants/RLS. This worker did not alter those migrations or execute a database operation. The Go handlers never select service_role.

The shared module has no QR encoding dependency. `PairQREncoder` must supply the actual PNG data URL. `TailscaleDiscovery` supplies read-only status/Serve JSON and must enforce the TS discovery limits (three seconds and 512 KiB per subprocess) if implemented through the CLI. No Tailscale commands, models, servers, databases or network services were started in this task. These injected adapters and database privilege integration remain unverified, not implemented by a generic operation proxy.

## Automation boundaries and gaps

1. **Service-role-only existing SQL cannot be called under the required identity.** `supabase/migrations/20261014120000_atomic_reliable_automation.sql` grants `accept_integration_event`, `claim_outbound_events`, and `finish_outbound_event` exclusively to `service_role`, rejects other roles inside the functions, and makes outbox claims global. The `finish_outbound_event` replacement in `20261014122000_finance_evidence_and_issue.sql` retains the same restriction. `automation.go` never acquires service role. A human administrator must supply tenant-authorized command replacements with row-scoped leases/receipts and least-privilege grants before these operations can succeed on that schema. Foreign-tenant claims are rejected transactionally before a send; unsupported commands fail closed. No function/grant/RLS change has been applied.
2. **No scheduler/integration identity exists in `erpwire.Actor`.** The original TypeScript cron/webhook handlers bypass RLS with an administrator. The port injects `AutomationAuthority`, which must enumerate configured workspaces and resolve a live least-privilege, membership/MFA-bound actor for each. It validates every supplied actor and refuses mismatched webhook organizations. It never makes an Actor from the secret, `orgId`, role JSON or a decoded JWT. Without this authority, scheduled scans and event receipt return the source failure response. Global creation-order scheduling among workspaces requires a trusted scheduler policy; this implementation visits configured actors in their supplied order and caps outbox sends at ten across the scan.
3. **Read RPC registration and command tenant scope need host-owner integration.** `erpcore/store.go` currently has a fixed `ReadRPC` allowlist that omits `replenishment_plan`. `WriteTx.Command` instead resolves function signatures from the live schema, and `erpcore/query.go` validates `p_org_id`/`org_id` only when the function declares it. Existing outbox SQL signatures do not declare either, so the required authenticated replacements must enforce tenant scope internally or expose an org parameter with coordinated integration. Blindly relaxing grants on the global source commands would expose cross-workspace claims. The package cannot edit `erpcore` under its ownership boundary.
4. **Trusted HTTP metadata is not in `erpwire.Operation`.** API route operations use the package's `Request`/`Response`. Only a trusted HTTP adapter may construct the request from actual headers, bytes and path params. A generic application dispatcher must not let a browser forge a serialized `Request` and its Origin. Authentication, origin/rate/body checks at the real transport and per-transaction reauthentication remain mandatory.
5. **Native and assistant adapters must be injected.** `AssistantChat` matches the existing `localai.Service.Chat` interface and retains that implementation's evidence/quote/source checks without constructing a model provider. `RasterValidator` must perform the source's isolated full raster validation. `McpProbe` must perform the real initialize/tools-list handshake with authorized read-only tools. `AttachmentReader` must preserve all immutable UUID object, owner/mode/link/inode/mtime/size and safe-ancestor checks described on the interface and in `native-attachments.ts`. The domain handler itself reauthorizes metadata and the parent on every delivery and never exposes arbitrary file paths. Production adapters are outside this package's ownership and were not invoked or tested.
6. **Safe database errors.** Arbitrary database errors are not returned to clients/audit payloads. Source fixed validation text and approved `BusinessMessage()` values are retained; unavailable internal details use the source fallback text. The existing `erpcore.DatabaseError` deliberately hides raw provider messages. Actual grants/RLS, live auth adapters, native filesystem safety and cross-workspace scheduler provisioning remain administrator/host integration checks, not proven by fake Store tests.

FAIR status: stable source operation identifiers and source provenance are recorded; reads and commands carry actor/org scope; payloads and messages use documented JSON/UTF-8 and HTTP headers; reusable typed boundary interfaces describe native and authority obligations. Database-enforced least privilege/RLS for the new command identities is unknown until a human administrator provisions and verifies it. API/model adapters must never receive owner/admin/service-role database credentials.

## Native boundaries and gaps

- `erpwire.Operation` has no HTTP streaming request/response contract. `Request` is a trusted transport envelope; its original bytes and headers must come from the router, never a browser operation argument. `Response.Body` may be `io.ReadCloser` for NDJSON, database dump, or desktop update streams. A router must copy these streams directly and always close them on completion, disconnect, and cancellation. OCR's 15-second upload timeout must be enforced while collecting the bounded raw request before creating this envelope.
- The shared catalog exports only known IDs and host allowlisting, not Thai/English display metadata. `nativeCatalogJSON` is a dated package-local copy of `internal/bundle/ollama_models.json`; a future exported catalog DTO would remove this copy. Host decisions still call canonical `bundle.KnownModel` and `bundle.PullAllowed`.
- Models are injected as typed `ModelRuntime` methods, with no provider construction or endpoint selection in the operation. The trusted adapter must bind an approved installed checkpoint and retain bounded error handling, cancellation, no redirects, no cloud fallback, and checkpoint capability/provenance verification. Image uses the existing fixed 512x512/4-step model configuration; Speech uses Phonon's default English WAV voice. Pull adapters own the 45-minute upstream deadline while browser streams remain open. Runtime integration is pending and no model was executed.
- OCR reuses `localai.OCRPage`/`PageMetadata` through `OCRRuntime`. `localai.Provider.RecognizePage` already satisfies this interface, but no provider was created here. Actual raster decoding also uses the installed `raster.Validate` implementation before model invocation.
- ASR installation and execution are explicit trusted `ASRRuntime` methods. They must retain the b5454 pinned archive allowlist and SHA-256 values, 20 MB archive/90 MB model bounds, path/link rejection, native private staging, bounded stdout/stderr, no shell, 120-second cancellation, and cleanup from the cited TS source. No concrete ASR adapter exists in the allowed shared contracts, so host integration remains pending. Source handlers and validation are implemented; no local model installer or process was executed.
- The native OS backup boundary is `NativeBackupHost`/`NativeBackupSession`, with no database login or service-role capability exposed to an API caller. The trusted human-admin implementation must resolve only bundled PostgreSQL tools, private passfiles and exact native cluster identity; verify live wrong-password rejection, SCRAM and data/port identity; create a marked fresh NOLOGIN recovery role; restore with clean/if-exists/exit-on-error/single-transaction semantics; and drop only its own marked recovery role under an independent deadline. This cannot be implemented with `erpwire.Store`, whose actor/RLS context intentionally excludes all-workspace native administration. No native-administrator adapter is implemented here, and an ordinary API identity must remain database read-only. Administrator provisioning and review are required before enabling this separate native operator capability.
- The `DesktopRuntime` interface owns private stage paths and authenticated loopback helper credentials. Its `Download` method must enforce `NativeDownloadAllowed` for the initial URL and every redirect, a maximum of five hops, and non-success rejection. Stage consumes all reader bytes, writes only a private partial file, commits atomically, and never accepts a user path. Fullscreen helpers retain the three-second bound and `desktop:false` fallback. Apply uses only the verified macOS installer and a trusted configured helper; no helper token enters browser data.

Validation observed locally with `go test ./internal/erpplatform/...`, including exact authorization messages, real PNG decode/MIME rejection, speech byte boundaries, OCR metadata/size/busy states, sanitized streamed model events, Thai catalog metadata, OCR exact satang boundaries, backup export lifecycle, restore invalid/verified/uncertain/cleanup transitions, canonical release/checksum rejection, and update checksum verification before commit/apply. No database, native helper, model process, server or network integration was started.

## Workflow, validation and remaining work

The BBN phases were scaled to this worker's existing isolated worktree. Pstack's figure-it-out workflow framed the source inventory, established typed boundaries, sequenced implementation and tests, recorded contract gaps, and added independent source reviews before handoff. Ponytail full reused erpwire, existing billing, raster and localai contracts, with no new dependency. The supplied Graft map and relevant checked-in `graft/lib` source maps were verified against source. No existing `graphify-out/graph.json`, project instruction/memory bundle or installed boombignose-mode skill was found in this worktree/catalog lookup; no graph/memory files were created outside the exclusive package. This file is the durable package checkpoint within the authorized boundary.

Independent read-only reviews found and prompted corrections to nullable audit UUIDs, team profile RPC use, independent soft transactions, URL origin normalization, input/redirect/cookie parity, outbox batch concurrency, model-list deadlines and OCR error codes. Regression tests exercise these real operation paths, including concurrent sends and all acknowledgements despite one failed acknowledgement.

Observed final checks on 2026-11-08 from `boombignose`: `gofmt -l ./internal/erpplatform` PASS with no listed files; `go vet ./internal/erpplatform/...` PASS; `go test ./internal/erpplatform/...` PASS; `go build ./internal/erpplatform/...` PASS. `go test -race ./internal/erpplatform/...` also passed after the concurrent outbox change. Independent reviewers re-read the corrections and reported no remaining blocking findings in their reviewed scopes. `registry_test.go` verifies all 68 operation keys and reused warehouse ownership against the current source files.

Production auth, stream transport, native host adapters and database grants/RLS remain unverified and require the owning integrator/human administrator. The next integration work is to supply the typed adapters, resolve the documented pre-workspace authority and command-grant gaps, wire the trusted native router, and run administrator-approved real-identity acceptance tests. No publication, push or merge is part of this worker task.
