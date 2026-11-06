#!/bin/sh
# Build a disk image of the BoomBigNose window and dist/bundle.
# Runtime assets live under Contents/Resources/bundle, outside the signed
# Contents/MacOS executable directory. Sign nested Mach-Os, then the main
# executable and outer application; verify the completed immutable payload.
# Signing is ad-hoc, not Developer ID or notarization.
#
# The DMG Finder window shows BoomBigNose.app beside an Applications symlink
# and a dark-theme Thai+EN drag hint. Layout needs a read-write image
# (AppleScript + Finder), then conversion to UDZO.
#
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose-desktop.
# codesign --sign - is not a paid Developer ID signature.
# The mounted check looks for files and verifies the signature. The smoke
# copies the application off the image and verifies that immutable copy before
# booting its bundled services. It does not pull a model.
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
# All executable permissions and payload copies must precede final signing.
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
  <key>CFBundleShortVersionString</key><string>1.4.4</string>
  <key>CFBundleVersion</key><string>1.4.4</string>
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
cp -a "$bundle" "$app/Resources/bundle"
chmod 755 \
  "$app/Resources/bundle/node" \
  "$app/Resources/bundle/postgres/bin/initdb" \
  "$app/Resources/bundle/postgres/bin/pg_ctl" \
  "$app/Resources/bundle/postgres/bin/postgres" \
  "$app/Resources/bundle/auth/auth" \
  "$app/Resources/bundle/postgrest/postgrest" \
  "$app/Resources/bundle/ollama/ollama" \
  "$app/Resources/bundle/ollama/llama-server" \
  "$app/Resources/bundle/ollama/llama-quantize"
# DMG mounts can drop +x; ensure llama helpers stay runnable for Local AI.
# Fail closed if any nested runtime cannot be signed. Seal the application last
# and never mutate its contents afterward.
find "$app/Resources/bundle" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' -o -name '*.node' \) |
  while IFS= read -r f; do
    if file -b "$f" | grep -q 'Mach-O'; then
      codesign --force --sign - "$f"
    fi
  done
codesign --force --sign - "$app/MacOS/BoomBigNose"
codesign --force --sign - "$stage/BoomBigNose.app"
codesign --verify --deep --strict "$stage/BoomBigNose.app"

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
inapp=BoomBigNose.app/Contents/Resources/bundle
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
  BoomBigNose.app/Contents/Resources/bundle/node \
  BoomBigNose.app/Contents/Resources/bundle/erp/server.js \
  BoomBigNose.app/Contents/Resources/bundle/postgres/bin/postgres \
  BoomBigNose.app/Contents/Resources/bundle/auth/auth \
  BoomBigNose.app/Contents/Resources/bundle/postgrest/postgrest \
  BoomBigNose.app/Contents/Resources/bundle/ollama/ollama \
  BoomBigNose.app/Contents/Resources/bundle/ollama/OLLAMA_LICENSE.txt
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
codesign --verify --deep --strict "$mount/BoomBigNose.app"
cp -a "$mount/." "$copy/"
codesign --verify --deep --strict "$copy/BoomBigNose.app"
BOOMBIGNOSE_SMOKE_BUNDLE="$copy/$inapp" sh "$root/packaging/linux/smoke-bundle.sh"
echo "wrote $dmg"
