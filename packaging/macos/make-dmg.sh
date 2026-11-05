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
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose-desktop.
# codesign --sign - is not a paid Developer ID signature.
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
icon=$root/packaging/macos/icon.icns
test -s "$icon"
app="$stage/BoomBigNose.app/Contents"
mkdir -p "$app/MacOS" "$app/Resources"
cp "$bin" "$app/MacOS/BoomBigNose"
chmod 755 "$app/MacOS/BoomBigNose"
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
  <key>CFBundleShortVersionString</key><string>1.4.2</string>
  <key>CFBundleVersion</key><string>1.4.2</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$stage" || true
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
inapp=BoomBigNose.app/Contents/MacOS/bundle
ls -la "$mount" "$mount/$inapp/node" "$mount/$inapp/ollama/ollama"
copy=$(mktemp -d)
cleanup_mount() {
  hdiutil detach "$mount" >/dev/null 2>&1 || hdiutil detach -force "$mount" >/dev/null 2>&1 || true
  rm -rf "$stage" "$copy"
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
