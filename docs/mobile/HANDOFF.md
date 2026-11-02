# Mobile HANDOFF (2026-11-03)

Done in PR1: `mobile/` Flutter iOS app (scan QR → Keychain device token → web view), pairing API, Settings "Link mobile", tests, docs.

Open:
- **TestFlight**: Apple team, bundle id `org.boombignose.bbnMobile`, signing, App Store Connect record, app icon.
- **Native modules** beyond the web view (lists, receipts scan, offline).
- **Android**: `flutter create --platforms android .` inside `mobile/`; needs Android SDK (missing on this Mac).
- **Push notifications**: APNs key + a device-token column on `mobile_devices`.
- **Revoke ends web sessions**: today revoke only blocks new sessions. Sign the user out server-side if that matters.
- **Multi-org**: `/auth/confirm` lands on the user's default org; pass the paired org through to the active-org cookie.
- **CI**: no workflow builds `mobile/` (no macOS runner configured). Add a `paths: mobile/**` macOS job running `flutter analyze && flutter test`.
- **Physical device test over a real tailnet** was not done in this PR.
