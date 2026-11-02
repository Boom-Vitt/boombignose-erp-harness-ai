# BoomBigNose mobile (iOS, Flutter)

Owner override 2026-11-03: an iOS app (Flutter) that links to your own BoomBigNose server by QR and
talks to it **over Tailscale only**. No public tunnel, no cloud relay.

## What you need

- The desktop app (or `pnpm local:serve`) running on a computer, default `http://127.0.0.1:3100`.
- [Tailscale](https://tailscale.com) on **both** the computer and the phone, signed in to the same tailnet,
  with MagicDNS and HTTPS certificates enabled (Tailscale admin console → DNS).
- On the computer, once (the ERP listens on loopback only, so Tailscale fronts it with HTTPS):

  ```sh
  tailscale serve --bg 3100
  ```

  If `tailscale` is not on PATH, use the app's CLI:
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3100`.
  Your address is then `https://<computer>.<tailnet>.ts.net`.

## Pair a phone

1. Sign in on the computer as an **owner or admin**: Settings → **Link mobile**.
2. The address field is filled from `tailscale status` when the CLI is found. Otherwise type
   the `https://…ts.net` address. Loopback addresses are refused.
3. **Generate QR**. Open the iOS app and scan it. The phone lists in the same card; **Revoke** unlinks it.
4. **Open ERP** in the app loads the ERP in a web view, signed in as the user who generated the QR.

## How it works

| Step | Endpoint | Auth |
| --- | --- | --- |
| Issue QR | `POST /api/mobile/pair/start` `{baseUrl?}` | owner/admin session |
| Redeem | `POST /api/mobile/pair/redeem` `{token, deviceName}` → `{deviceToken}` | the one-time token |
| Status | `GET /api/mobile/status` | `Authorization: Bearer <deviceToken>` |
| Web sign-in | `POST /api/mobile/session` → `{path}` (`/auth/confirm?...`) | Bearer device token |
| List / revoke | `GET /api/mobile/devices`, `DELETE /api/mobile/devices/:id` | owner/admin session |

QR content: `bbn-pair://redeem?u=<https base>&t=<one-time token>&o=<org name>&e=<expiry unix secs>`.
Code: `lib/mobile/pairing.ts`, tables `mobile_pairings` / `mobile_devices`
(`supabase/migrations/20261103090000_mobile_devices.sql`), app in `mobile/`.

## Security notes

- The QR carries a 256-bit one-time token, never a password or session. It expires in 5 minutes and is
  consumed by one atomic `UPDATE`, so a second scan fails. Unknown, expired and used tokens get the same error.
- The token is bound to the org and user that generated it. The server stores only SHA-256 hashes of the
  pairing and device tokens; the tables have RLS on with no policies (service role only).
- The device token lives in the iOS Keychain (`flutter_secure_storage`).
- **Revoke** stops the device from getting new sessions and from the status check. A web session already
  opened in the app's web view keeps working until it expires or that user signs out of the ERP.
- Network trust is Tailscale; the device token is still required for every call.
- Anyone who can see the QR within 5 minutes can pair. Do not share a screenshot of it.

## Run on the iOS simulator

Requires Xcode, Flutter and CocoaPods (`brew install cocoapods`).

```sh
cd mobile
flutter pub get
flutter analyze && flutter test
flutter run -d "iPhone 18 Pro"        # or: flutter build ios --simulator --debug --no-codesign
```

The simulator has no camera, so scanning is only testable on a real device (`flutter run` with the phone attached;
sign with your Apple team in Xcode). The simulator shares the Mac's network, so it can reach the server through
the Mac's own tailnet address.

## Not in this MVP

TestFlight / signing, native screens (the app is a web view), Android, push notifications, picking the
paired org for users in several orgs (the web view opens their default org).
