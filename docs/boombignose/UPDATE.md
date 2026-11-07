# In-app update

The published installer stays on the previous tag until someone creates `boombignose-vX.Y.Z` and `.github/workflows/boombignose-release.yml` uploads the four installers plus `SHA256SUMS`. This tree's `APP_VERSION`, Go desktop helper, macOS bundle version, and Windows version resource are `1.4.4`. Creating the tag is a separate step after merge. The workflow does not create the tag.

Windows installers are unsigned. The macOS app and its nested native runtimes are ad-hoc signed and checked with `codesign --verify --deep --strict`; runtime resources live under `Contents/Resources/bundle` so signing does not treat JavaScript/SQL as executables. This is not Developer ID signing or notarization, and there is no Authenticode certificate.

## What the operator does

1. Open the BoomBigNose window. A browser tab on the same port cannot replace the program.
2. Sign in as an owner or admin and open Settings. The update card is under the local-model card.
3. Choose ตรวจอัปเดต / Check for updates. The app reads `https://api.github.com/repos/Boom-Vitt/nose-erp/releases/latest` only after that click. It keeps the release-page link and ignores `browser_download_url` values in the JSON.
4. On macOS Apple Silicon, choose ดาวน์โหลดและติดตั้ง / Download and install.
5. The window quits and opens again on the new version. Postgres data in `~/.local/share/boombignose/pg` is not inside the app folder and is not replaced.

On Windows and Linux the same check shows that automatic replace is not in this version and links to the release page. It does not download the installer.

## What the app does on macOS Apple Silicon

1. The desktop process listens on `127.0.0.1` and a random port. It passes that URL and a random token to the bundled ERP process. The browser does not receive the token.
2. The ERP downloads `SHA256SUMS` and `BoomBigNose-macos-arm64.dmg` from `https://github.com/Boom-Vitt/nose-erp/releases/download/boombignose-vX.Y.Z/`. Redirects are limited to GitHub's release hosts. The file is hashed while it is written under `~/.local/share/boombignose/updates` and kept only when the hash matches `SHA256SUMS`.
3. The helper reads that file again, fetches `SHA256SUMS` itself, and refuses the file when the hash differs or the version is not newer than the helper's `AppVersion`.
4. It mounts the image read-only, validates the complete app signature and required `Contents/Resources/bundle` files, copies the app intact to a payload folder, verifies the copied signature, detaches the image, and starts `relaunch.sh` in its own session.
5. The script waits until the desktop process has exited, moves the old app aside, copies the complete signed replacement without moving or rewriting its resources, verifies the installed signature, and opens it. Copy, verification or launch failure restores the previous app. The Postgres data directory is never replaced.

A failed checksum leaves the running app in place. The partial download is removed.

## macOS layout cutover in 1.4.4

Versions through 1.4.3 assumed `Contents/MacOS/bundle`. Their old update helper cannot stage the new Resources layout. Upgrade those installations to 1.4.4 by replacing the app from the verified DMG (preserve `~/.local/share/boombignose/pg` and back it up first). The 1.4.4 helper uses the signed Resources layout for subsequent updates. No legacy runtime-directory alias is installed.
