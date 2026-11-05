#!/bin/sh
# Build a disk image of the BoomBigNose window and dist/bundle.
# bundle/ lives at BoomBigNose.app/Contents/MacOS/bundle beside the executable
# because the window reads Dir(exe)/bundle. Nested Mach-Os under bundle/ are
# ad-hoc signed. The main BoomBigNose binary and the .app are left unsigned:
# codesign of a main executable under Contents/MacOS seals that directory, and
# unsigned .sql/JS under MacOS/bundle then fails CI ("code object is not signed
# at all" / "sealed resource is missing or invalid"). Signing the binary before
# copying bundle/ also breaks once bundle/ appears. A broken app seal +
# quarantine is Gatekeeper "damaged"; leaving the app unsigned surfaces Open
# Anyway instead. Developer ID + notarize, or moving bundle/ to
# Contents/Resources, is future work.
#
# The DMG Finder window mirrors famous Mac apps: BoomBigNose.app on the left,
# an Applications folder symlink on the right, and a dark-theme background with
# a Thai+EN drag hint. Layout needs a read-write image (AppleScript + Finder),
# then convert to UDZO. Do not reintroduce codesign of the main binary or .app
# (see #149/#150: strip linker signature; sign nested Mach-Os only).
#
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose-desktop.
# codesign --sign - is not a paid Developer ID signature.
# The mounted check looks for the files. The smoke copies them off the image
# first: a read-only UDZO mount can drop the executable bit, and the smoke
# boots that copy. It does not pull a model.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/boombignose-desktop
bundle=$root/dist/bundle
bg=$root/packaging/macos/dmg-background.png
test -s "$bin"
test -s "$bundle/node"
test -s "$bundle/erp/server.js"
test -s "$bundle/postgres/bin/postgres"
test -d "$bundle/erp/.next/static"
test -s "$bundle/auth/auth"
test -s "$bundle/postgrest/postgrest"
test -s "$bundle/ollama/ollama"
test -s "$bundle/ollama/OLLAMA_LICENSE.txt"
test -s "$bg"
stage=$(mktemp -d)
rw_dmg=
final_mount=
trap 'rm -rf "$stage"' EXIT
icon=$root/packaging/macos/icon.icns
test -s "$icon"
app="$stage/BoomBigNose.app/Contents"
mkdir -p "$app/MacOS" "$app/Resources" "$stage/.background"
cp "$bin" "$app/MacOS/BoomBigNose"
chmod 755 "$app/MacOS/BoomBigNose"
# Go/macOS may emit a linker-signed ad-hoc signature. That seal breaks once
# MacOS/bundle appears beside the binary; strip it so Gatekeeper sees unsigned
# (Open Anyway) instead of a damaged sealed resource.
codesign --remove-signature "$app/MacOS/BoomBigNose" 2>/dev/null || true
cp "$icon" "$app/Resources/icon.icns"
cp "$icon" "$stage/icon.icns"
cp "$icon" "$stage/.VolumeIcon.icns"
cp "$bg" "$stage/.background/background.png"
# Famous-app installer affordance: drag the .app onto Applications.
ln -s /Applications "$stage/Applications"
cat > "$app/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>BoomBigNose</string>
  <key>CFBundleDisplayName</key><string>BoomBigNose</string>
  <key>CFBundleExecutable</key><string>BoomBigNose</string>
  <key>CFBundleIdentifier</key><string>ai.boombignose.harness</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.4.2</string>
  <key>CFBundleVersion</key><string>1.4.2</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$stage" || true
  SetFile -a V "$stage/icon.icns" || true
  SetFile -a V "$stage/.background" || true
fi
cp -a "$bundle" "$app/MacOS/bundle"
chmod 755 \
  "$app/MacOS/bundle/node" \
  "$app/MacOS/bundle/postgres/bin/initdb" \
  "$app/MacOS/bundle/postgres/bin/pg_ctl" \
  "$app/MacOS/bundle/postgres/bin/postgres" \
  "$app/MacOS/bundle/auth/auth" \
  "$app/MacOS/bundle/postgrest/postgrest" \
  "$app/MacOS/bundle/ollama/ollama" \
  "$app/MacOS/bundle/ollama/llama-server" \
  "$app/MacOS/bundle/ollama/llama-quantize"
# DMG mounts can drop +x; ensure llama helpers stay runnable for Local AI.
# Ad-hoc sign nested Mach-Os only. Do NOT codesign BoomBigNose or the .app:
# a main-executable signature under Contents/MacOS seals MacOS/*, and
# MacOS/bundle contains unsigned .sql/JS that break that seal in CI.
find "$app/MacOS/bundle" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' -o -name '*.node' \) |
  while IFS= read -r f; do
    if file -b "$f" | grep -q 'Mach-O'; then
      codesign --force --sign - "$f" || true
    fi
  done

dmg=$root/dist/BoomBigNose-macos-arm64.dmg
mkdir -p "$root/dist"
rw_dmg=$root/dist/BoomBigNose-macos-arm64.rw.dmg
rm -f "$rw_dmg" "$dmg"
# Clear stale mounts so the volume name stays "BoomBigNose" for Finder layout.
for stale in /Volumes/BoomBigNose*; do
  if [ -d "$stale" ]; then
    hdiutil detach "$stale" >/dev/null 2>&1 || hdiutil detach -force "$stale" >/dev/null 2>&1 || true
  fi
done

# Read-write image so Finder can set icon positions + background; then UDZO.
attempt=1
while [ "$attempt" -le 3 ]; do
  if hdiutil create \
    -volname "BoomBigNose" \
    -srcfolder "$stage" \
    -ov \
    -format UDRW \
    -fs HFS+ \
    "$rw_dmg"
  then
    break
  fi
  echo "hdiutil create (UDRW) failed on attempt $attempt" >&2
  hdiutil detach "/Volumes/BoomBigNose" >/dev/null 2>&1 || true
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
done

# Grow a little so Finder metadata writes do not fill the volume.
hdiutil resize -size "$(du -sm "$rw_dmg" | awk '{print $1 + 50}')m" "$rw_dmg" 2>/dev/null || true

attempt=1
attach_status=1
attach=""
while [ "$attempt" -le 3 ]; do
  set +e
  attach=$(hdiutil attach -nobrowse -owners on "$rw_dmg" 2>&1)
  attach_status=$?
  set -e
  printf '%s\n' "$attach"
  if [ "$attach_status" -eq 0 ]; then
    break
  fi
  echo "hdiutil attach (RW) failed on attempt $attempt" >&2
  hdiutil detach "/Volumes/BoomBigNose" >/dev/null 2>&1 || true
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
done
rw_mount=$(printf '%s\n' "$attach" | sed -n 's/^.*\(\/Volumes\/.*\)$/\1/p' | head -1 | sed 's/[[:space:]]*$//')
if [ -z "$rw_mount" ] || [ ! -d "$rw_mount" ]; then
  echo "RW dmg did not mount" >&2
  exit 1
fi
echo "mounted RW $rw_mount"

# Volume icon attribute on the mounted root (custom icon bit).
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$rw_mount" || true
  SetFile -a V "$rw_mount/icon.icns" 2>/dev/null || true
  SetFile -a V "$rw_mount/.background" 2>/dev/null || true
fi

# Finder window: app left, Applications right, background drag hint.
# Soft-fail: a headless runner without Finder still yields a usable DMG
# (Applications symlink remains even if icon positions stay default).
vol_name=$(basename "$rw_mount")
if command -v osascript >/dev/null 2>&1; then
  set +e
  VOL_NAME="$vol_name" osascript << 'APPLESCRIPT'
set volName to system attribute "VOL_NAME"
tell application "Finder"
  tell disk volName
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {120, 120, 760, 520}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    try
      set background picture of viewOptions to file ".background:background.png"
    end try
    try
      set position of item "BoomBigNose.app" of container window to {160, 220}
    end try
    try
      set position of item "Applications" of container window to {480, 220}
    end try
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
  as_status=$?
  set -e
  if [ "$as_status" -ne 0 ]; then
    echo "Finder DMG layout AppleScript failed (continuing; Applications symlink still present)" >&2
  fi
  # Flush .DS_Store before detach.
  sync || true
  sleep 1
fi

hdiutil detach "$rw_mount" >/dev/null 2>&1 || hdiutil detach -force "$rw_mount" >/dev/null 2>&1 || true

attempt=1
while [ "$attempt" -le 3 ]; do
  if hdiutil convert "$rw_dmg" -format UDZO -imagekey zlib-level=9 -o "$dmg"; then
    break
  fi
  echo "hdiutil convert (UDZO) failed on attempt $attempt" >&2
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
done
rm -f "$rw_dmg"

attempt=1
attach_status=1
attach=""
while [ "$attempt" -le 3 ]; do
  set +e
  attach=$(hdiutil attach -nobrowse -readonly "$dmg" 2>&1)
  attach_status=$?
  set -e
  printf '%s\n' "$attach"
  if [ "$attach_status" -eq 0 ]; then
    break
  fi
  echo "hdiutil attach failed on attempt $attempt" >&2
  hdiutil detach "/Volumes/BoomBigNose" >/dev/null 2>&1 || true
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
done
mount=$(printf '%s\n' "$attach" | sed -n 's/^.*\(\/Volumes\/.*\)$/\1/p' | head -1 | sed 's/[[:space:]]*$//')
if [ -z "$mount" ] || [ ! -d "$mount" ]; then
  echo "dmg did not mount" >&2
  exit 1
fi
echo "mounted $mount"
final_mount=$mount
inapp=BoomBigNose.app/Contents/MacOS/bundle
ls -la "$mount" "$mount/$inapp/node" "$mount/$inapp/ollama/ollama"
if [ ! -L "$mount/Applications" ]; then
  echo "mounted image missing Applications symlink" >&2
  exit 1
fi
apps_target=$(readlink "$mount/Applications" || true)
case "$apps_target" in
  /Applications|/Applications/) ;;
  *)
    echo "Applications symlink target is '$apps_target', expected /Applications" >&2
    exit 1
    ;;
esac
if [ ! -s "$mount/.background/background.png" ]; then
  echo "mounted image missing .background/background.png" >&2
  exit 1
fi
copy=$(mktemp -d)
cleanup_mount() {
  if [ -n "${final_mount:-}" ]; then
    hdiutil detach "$final_mount" >/dev/null 2>&1 || hdiutil detach -force "$final_mount" >/dev/null 2>&1 || true
  fi
  rm -rf "$stage" "$copy"
  rm -f "$rw_dmg"
}
trap cleanup_mount EXIT
for rel in \
  icon.icns \
  BoomBigNose.app/Contents/MacOS/BoomBigNose \
  BoomBigNose.app/Contents/Resources/icon.icns \
  BoomBigNose.app/Contents/MacOS/bundle/node \
  BoomBigNose.app/Contents/MacOS/bundle/erp/server.js \
  BoomBigNose.app/Contents/MacOS/bundle/postgres/bin/postgres \
  BoomBigNose.app/Contents/MacOS/bundle/auth/auth \
  BoomBigNose.app/Contents/MacOS/bundle/postgrest/postgrest \
  BoomBigNose.app/Contents/MacOS/bundle/ollama/ollama \
  BoomBigNose.app/Contents/MacOS/bundle/ollama/OLLAMA_LICENSE.txt
do
  if [ ! -s "$mount/$rel" ]; then
    echo "mounted image missing $rel" >&2
    find "$mount" -name ollama -o -name 'OLLAMA_LICENSE.txt' -o -name node | head >&2 || true
    exit 1
  fi
done
if [ ! -d "$mount/$inapp/erp/.next/static" ]; then
  echo "mounted image missing $inapp/erp/.next/static" >&2
  exit 1
fi
if [ -d "$mount/$inapp/ollama/lib/ollama/cuda_v12" ] || [ -d "$mount/$inapp/ollama/lib/ollama/cuda_v13" ]; then
  echo "cuda runner was packed" >&2
  exit 1
fi
cp -a "$mount/." "$copy/"
chmod 755 \
  "$copy/BoomBigNose.app/Contents/MacOS/BoomBigNose" \
  "$copy/$inapp/node" \
  "$copy/$inapp/postgres/bin/initdb" \
  "$copy/$inapp/postgres/bin/pg_ctl" \
  "$copy/$inapp/postgres/bin/postgres" \
  "$copy/$inapp/auth/auth" \
  "$copy/$inapp/postgrest/postgrest" \
  "$copy/$inapp/ollama/ollama"
BOOMBIGNOSE_SMOKE_BUNDLE="$copy/$inapp" sh "$root/packaging/linux/smoke-bundle.sh"
echo "wrote $dmg"
