# Mobile security handoff

## Current contract

The companion pairs a private Tailscale server/device for **connection/status only**. It opens normal `/login`; each phone user supplies their own account credentials and enrolled MFA. The former issuer-account magic-link `/api/mobile/session` endpoint is removed, with no compatibility shim. Historical pairing/device tables and rows remain.

Unlinking pairing **does not sign out independent ERP browser sessions**, including old-release sessions. Sign out inside ERP or use normal account/session controls separately. No broader revocation guarantee is made.

The native browser Auth relay is `/auth/local/<operation>`, fixed to the internal runtime Auth upstream and allowlisted Auth-only operations. It does not expose REST/admin/DB. Existing native session-cookie names are preserved. Shared JSON verified-context helper is `getVerifiedApiContext(request, {roles?, mutation?})` from `lib/auth.ts`; assurance lookup failures fail closed, and role-denied pages render `app/forbidden.tsx`.

Private Serve discovery verifies Running/online state, HTTPS 443, exact root backend mapping and no Funnel, rather than trusting MagicDNS alone. QR issuance additionally requires the detected origin to be explicitly configured. Account/tailnet setup, ACL/OS consent and Serve configuration stay under user control.

Remote native open signup is disabled. A targeted live invitation can register only its intended new recipient with that recipient's chosen password; it does not log anyone in or grant membership. Normal login and the atomic recipient-acceptance command remain required. Local-only fresh-owner signup and hosted Supabase confirmation remain available under their existing policies.

## Evidence boundaries

Behavioral tests cover Auth relay isolation/header/origin/body bounds, native browser/server cookie continuity at relocated ports, MFA failures, workspace isolation, targeted invitation signup, one-use/expiry/revocation pairing, Serve mapping and Dart navigation/status. No test/build/lint/formatter was run by the Auth/mobile implementation worker; the integration owner must execute applicable checks and record actual results.

Physical iOS device reachability, signing/TestFlight/App Store availability and tailnet ACL acceptance require actual authorized devices/accounts. Do not infer these from source tests, MagicDNS or a running desktop Tailscale process. Android packaging, push notifications and non-WebView native business modules are not claimed by this implementation. See `docs/mobile/README.md` for the supported flow.
