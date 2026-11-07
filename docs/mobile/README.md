# Private mobile access

The Flutter companion links to your own BoomBigNose ERP over **private Tailscale Serve HTTPS only**. It does not use a public tunnel, Funnel, cloud inference, or a second desktop shell. The ERP, Auth API and database continue to run behind the existing native Go/Wails supervisor; only the ERP front door is mapped by Serve.

## Prerequisites and explicit setup

1. Keep the computer's ERP running. Find its **actual loopback ERP origin/port**, rather than assuming the default 3100. API/Auth/REST/database ports must not be exposed.
2. Install/sign in to Tailscale on the computer and phone yourself, approve the desired devices/ACLs, and enable MagicDNS/HTTPS certificates in your tailnet. The ERP never installs Tailscale, enrolls an account, resets an existing configuration or enables Funnel automatically.
3. Configure private Serve to proxy the actual ERP backend, for example `tailscale serve --bg http://127.0.0.1:3100` when that really is this ERP's backend. Do not enable Funnel. If needed, the macOS app CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.
4. Set the native runtime's explicit public origin to the resulting **bare** `https://<computer>.<tailnet>.ts.net` origin using the native server configuration described in the desktop runbook. Restart the owned ERP instance after configuration changes. Its child environment must include `NEXT_PUBLIC_APP_URL=<public origin>` and `BOOMBIGNOSE_LOCAL_ORIGIN=<actual loopback ERP origin>`. These are trust boundaries, not arbitrary forwarded-host values.

Discovery is read-only. It requires Tailscale Running/online, an HTTPS listener on 443, a root Serve Web handler mapped to this ERP's exact loopback backend and no enabled Funnel mapping. A MagicDNS name alone is **not** readiness. The optional address entered in Settings must match both this verified mapping and a configured trusted app origin. Missing CLI/mapping/configuration is reported, not silently accepted as a working connection. Discovery does not prove phone-side reachability: test from the actual authorized phone/tailnet.

## Pair and sign in

1. Sign in on the computer as an **owner/admin** and complete any enrolled authenticator challenge. Open Settings → Link mobile.
2. Generate the five-minute, one-use QR. The QR carries a connection-pairing token and workspace label, **never an ERP login session**. Keep it private.
3. Scan with the companion. It stores a hashed-server-side, connection/status-only device credential in platform secure storage.
4. **Open ERP** opens `/login` on the paired HTTPS origin. Sign in as the phone user's **own** account, with that user's password and enrolled MFA. The QR issuer's identity is never delegated. The WebView permits navigation only within the exact paired HTTPS origin; external links, other tailnet hosts, HTTP and executable schemes are refused.
5. Use the normal workspace switcher/recipient invitation acceptance; pairing does not select or grant workspace membership.

For native remote deployments, open public signup is disabled. An owner/admin creates a normal workspace invitation targeted at the intended email and privately sends its original link. New recipients follow that link → Sign up, choose their own password, then sign in normally and accept the invitation. Registration validates the live pending token, matching email and expiry server-side; it creates only that new user, not a session or membership, and never changes an existing password. Revoked/expired/wrong-email invitations fail. Local-only fresh installations retain normal signup; hosted Supabase retains its configured ordinary signup/confirmation flow. Invitation destinations survive login, signup, email confirmation and MFA navigation.

## Unlink is not browser sign-out

**Unlink** revokes only connection/status pairing access. It does **not** sign out independent ERP browser/WebView sessions, including sessions previously created by older releases. Sign out inside each ERP browser, or use the normal account/session controls as appropriate. Do not treat unlinking a lost phone as revocation of all user login sessions.

Historical `mobile_pairings` and `mobile_devices` tables/rows are retained. Old device tokens now authorize only status. The former `/api/mobile/session` issuer-account magic-link minting endpoint has been removed; upgrade the companion rather than relying on an authentication shim.

## API boundary

| Operation | Endpoint | Authorization |
| --- | --- | --- |
| Issue QR | `POST /api/mobile/pair/start` `{baseUrl?}` | verified owner/admin session, MFA, exact trusted Origin |
| Redeem connection QR | `POST /api/mobile/pair/redeem` `{token,deviceName}` | one-use five-minute token; bounded JSON; browser Origin if present must be trusted |
| Connection status | `GET /api/mobile/status` | device bearer token; returns no account session or ERP records |
| List | `GET /api/mobile/devices` | verified owner/admin session, MFA, trusted Origin/Referer |
| Unlink | `DELETE /api/mobile/devices/:id` | verified owner/admin session, MFA, exact trusted Origin; org-scoped |

Sensitive responses use `Cache-Control: no-store`. Unknown/expired/used pairing codes fail, concurrent consumption is a conditional update, and only token hashes are stored. Possession of a QR during its validity can pair a connection; it cannot log in as its issuer.

## Native browser Auth and HTTPS

Native browser Auth uses `/auth/local/<operation>` on the ERP's current origin. A fixed loopback upstream serves only the required password/refresh, user lookup, logout and MFA-factor operations. There is no REST/admin/storage/DB proxy, arbitrary upstream, redirect relay, service-key forwarding or permissive CORS. Requests and responses are bounded; unsafe headers/internal error details are not returned. Server Supabase clients continue to use the runtime internal API URL.

The browser retains the original Supabase project identity solely for the existing cookie/storage key (`sb-127-auth-token` for the normal native 127.0.0.1 API), so upgrades do not rename sessions. Its actual native Auth requests are rewritten to HTTPS same-origin, never to the phone's loopback. Hosted Supabase browser operation remains direct and unchanged. Assurance lookup errors/unknown levels fail closed; role denial renders the shared designed 403 screen rather than a generic crash.

## Development and evidence

```sh
cd mobile
flutter pub get
flutter test
flutter run
```

Camera/Keychain/WebView require the appropriate iOS/macOS tooling and device permission. Flutter parsing/navigation/status tests and ERP Auth/origin/pairing tests are in source; check the integration report for which were actually executed. Source coverage is not a claim of TestFlight availability, signed-device installation, physical-phone reachability or completed tailnet consent.
