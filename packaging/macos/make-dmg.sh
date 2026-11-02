#!/bin/sh
# Build an ad-hoc-signed disk image of the BoomBigNose window and dist/bundle.
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose-desktop.
# codesign --sign - is not a paid Developer ID signature. Opening can require Open Anyway.
# The mounted check looks for the files. The smoke copies them off the image
# first: a read-only UDZO mount can drop the executable bit, and the smoke
# boots that copy. It does not pull a model.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/boombignose-desktop
bundle=$root/dist/bundle
test -s "$bin"
test -s "$bundle/node"
test -s "$bundle/erp/server.js"
test -s "$bundle/postgres/bin/postgres"
test -d "$bundle/erp/.next/static"
test -s "$bundle/auth/auth"
test -s "$bundle/postgrest/postgrest"
test -s "$bundle/ollama/ollama"
test -s "$bundle/ollama/OLLAMA_LICENSE.txt"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$bin" "$stage/BoomBigNose"
chmod 755 "$stage/BoomBigNose"
codesign --force --sign - "$stage/BoomBigNose"
icon=$root/packaging/macos/icon.icns
test -s "$icon"
app="$stage/BoomBigNose.app/Contents"
mkdir -p "$app/MacOS" "$app/Resources"
cp "$stage/BoomBigNose" "$app/MacOS/BoomBigNose"
cp "$icon" "$app/Resources/icon.icns"
cp "$icon" "$stage/icon.icns"
cp "$icon" "$stage/.VolumeIcon.icns"
cat > "$app/Info.plist" << 'EOF'
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
  <key>CFBundleShortVersionString</key><string>1.4.1</string>
  <key>CFBundleVersion</key><string>1.4.1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF
codesign --force --sign - "$app/MacOS/BoomBigNose"
codesign --force --sign - "$stage/BoomBigNose.app"
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$stage" || true
fi
cp -a "$bundle" "$stage/bundle"
chmod 755 \
  "$stage/bundle/node" \
  "$stage/bundle/postgres/bin/initdb" \
  "$stage/bundle/postgres/bin/pg_ctl" \
  "$stage/bundle/postgres/bin/postgres" \
  "$stage/bundle/auth/auth" \
  "$stage/bundle/postgrest/postgrest" \
  "$stage/bundle/ollama/ollama"
dmg=$root/dist/BoomBigNose-macos-arm64.dmg
attempt=1
while [ "$attempt" -le 3 ]; do
  if hdiutil create \
    -volname "BoomBigNose" \
    -srcfolder "$stage" \
    -ov \
    -format UDZO \
    "$dmg"
  then
    break
  fi
  echo "hdiutil create failed on attempt $attempt" >&2
  hdiutil detach "/Volumes/BoomBigNose" >/dev/null 2>&1 || true
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
done
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
ls -la "$mount" "$mount/bundle/node" "$mount/bundle/ollama/ollama"
copy=$(mktemp -d)
cleanup_mount() {
  hdiutil detach "$mount" >/dev/null 2>&1 || hdiutil detach -force "$mount" >/dev/null 2>&1 || true
  rm -rf "$stage" "$copy"
}
trap cleanup_mount EXIT
for rel in \
  BoomBigNose \
  icon.icns \
  BoomBigNose.app/Contents/MacOS/BoomBigNose \
  BoomBigNose.app/Contents/Resources/icon.icns \
  bundle/node \
  bundle/erp/server.js \
  bundle/postgres/bin/postgres \
  bundle/auth/auth \
  bundle/postgrest/postgrest \
  bundle/ollama/ollama \
  bundle/ollama/OLLAMA_LICENSE.txt
do
  if [ ! -s "$mount/$rel" ]; then
    echo "mounted image missing $rel" >&2
    find "$mount" -name ollama -o -name 'OLLAMA_LICENSE.txt' -o -name node | head >&2 || true
    exit 1
  fi
done
if [ ! -d "$mount/bundle/erp/.next/static" ]; then
  echo "mounted image missing bundle/erp/.next/static" >&2
  exit 1
fi
if [ -d "$mount/bundle/ollama/lib/ollama/cuda_v12" ] || [ -d "$mount/bundle/ollama/lib/ollama/cuda_v13" ]; then
  echo "cuda runner was packed" >&2
  exit 1
fi
cp -a "$mount/." "$copy/"
chmod 755 \
  "$copy/BoomBigNose" \
  "$copy/BoomBigNose.app/Contents/MacOS/BoomBigNose" \
  "$copy/bundle/node" \
  "$copy/bundle/postgres/bin/initdb" \
  "$copy/bundle/postgres/bin/pg_ctl" \
  "$copy/bundle/postgres/bin/postgres" \
  "$copy/bundle/auth/auth" \
  "$copy/bundle/postgrest/postgrest" \
  "$copy/bundle/ollama/ollama"
BOOMBIGNOSE_SMOKE_BUNDLE="$copy/bundle" sh "$root/packaging/linux/smoke-bundle.sh"
echo "wrote $dmg"
