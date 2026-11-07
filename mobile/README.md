# BoomBigNose mobile companion

Flutter iOS companion for private Tailscale ERP access. Scan a one-use connection QR, retain its status-only credential in platform secure storage, and open the paired HTTPS ERP origin in a navigation-limited WebView.

Pairing **never signs in as the QR issuer**. Open ERP uses the phone user's own ordinary login and enrolled MFA. Unlinking pairing does not sign out independent ERP browser sessions; sign out inside ERP separately.

Setup, trust boundaries, invite-only remote registration, API contracts and evidence limits: [private mobile guide](../docs/mobile/README.md). Source handoff: [security handoff](../docs/mobile/HANDOFF.md).

```sh
flutter pub get
flutter test
flutter run
```

An iOS toolchain, camera permission and authorized Tailscale connectivity are required. No TestFlight signing, physical-device reachability or Android packaging is implied by source availability.
