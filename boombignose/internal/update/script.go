package update

// RelaunchScript replaces BoomBigNose.app after the desktop process has
// exited, puts the new bundle/ beside the app executable
// (BoomBigNose.app/Contents/MacOS/bundle, where the desktop reads it), then
// reopens the app. Paths arrive as arguments. The data directory is not named here.
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
dest="$root/BoomBigNose.app/Contents/MacOS/bundle"
if [ -d "$root/BoomBigNose.app" ]; then
  mv "$root/BoomBigNose.app" "$backup/BoomBigNose.app"
fi
restore() {
  rm -rf "$root/BoomBigNose.app"
  if [ -d "$backup/BoomBigNose.app" ]; then
    mv "$backup/BoomBigNose.app" "$root/BoomBigNose.app"
  fi
}
if ! ditto "$app_src" "$root/BoomBigNose.app"; then
  restore
  exit 1
fi
rm -rf "$dest"
if ! ditto "$bundle_src" "$dest"; then
  restore
  exit 1
fi
chmod 755 \
  "$root/BoomBigNose.app/Contents/MacOS/BoomBigNose" \
  "$dest/node" \
  "$dest/postgres/bin/initdb" \
  "$dest/postgres/bin/pg_ctl" \
  "$dest/postgres/bin/postgres" \
  "$dest/auth/auth" \
  "$dest/postgrest/postgrest" \
  "$dest/ollama/ollama" 2>/dev/null || true
open "$root/BoomBigNose.app"
`
