package update

// RelaunchScript replaces BoomBigNose.app and bundle/ after the desktop
// process has exited, then reopens the app. Paths arrive as arguments.
// The data directory is not named here.
const RelaunchScript = `#!/bin/sh
set -eu
pid=$1
app_src=$2
bundle_src=$3
root=$4
case "$root" in
  ""|/|/System|/System/*|/usr|/usr/*|/bin|/bin/*|/sbin|/sbin/*|/private|/private/*|/Library|/etc|/etc/*|/var|/var/*|/opt) exit 2 ;;
esac
case "$app_src" in
  */BoomBigNose.app) ;;
  *) exit 2 ;;
esac
case "$bundle_src" in
  */bundle) ;;
  *) exit 2 ;;
esac
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then
    exit 1
  fi
  sleep 1
done
backup="$root/.boombignose-previous"
rm -rf "$backup"
mkdir -p "$backup"
if [ -d "$root/BoomBigNose.app" ]; then
  mv "$root/BoomBigNose.app" "$backup/BoomBigNose.app"
fi
if [ -d "$root/bundle" ]; then
  mv "$root/bundle" "$backup/bundle"
fi
restore() {
  rm -rf "$root/BoomBigNose.app" "$root/bundle"
  if [ -d "$backup/BoomBigNose.app" ]; then
    mv "$backup/BoomBigNose.app" "$root/BoomBigNose.app"
  fi
  if [ -d "$backup/bundle" ]; then
    mv "$backup/bundle" "$root/bundle"
  fi
}
if ! ditto "$app_src" "$root/BoomBigNose.app"; then
  restore
  exit 1
fi
if ! ditto "$bundle_src" "$root/bundle"; then
  restore
  exit 1
fi
chmod 755 \
  "$root/BoomBigNose.app/Contents/MacOS/BoomBigNose" \
  "$root/bundle/node" \
  "$root/bundle/postgres/bin/initdb" \
  "$root/bundle/postgres/bin/pg_ctl" \
  "$root/bundle/postgres/bin/postgres" \
  "$root/bundle/auth/auth" \
  "$root/bundle/postgrest/postgrest" \
  "$root/bundle/ollama/ollama" 2>/dev/null || true
open "$root/BoomBigNose.app"
`
