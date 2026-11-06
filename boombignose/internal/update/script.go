package update

// RelaunchScript replaces the complete signed app after its process exits.
// Resources remain inside the application so the code-signature seal survives.
// Paths arrive as arguments; the business-data directory is never named here.
const RelaunchScript = `#!/bin/sh
set -eu
pid=$1
app_src=$2
root=$3
case "$root" in
  ""|/|/System|/System/*|/usr|/usr/*|/bin|/bin/*|/sbin|/sbin/*|/private|/private/*|/Library|/etc|/etc/*|/var|/var/*|/opt) exit 2 ;;
esac
case "$app_src" in
  */BoomBigNose.app) ;;
  *) exit 2 ;;
esac
if ! codesign --verify --deep --strict "$app_src"; then
  exit 1
fi
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
if ! codesign --verify --deep --strict "$root/BoomBigNose.app" ||
   ! test -x "$root/BoomBigNose.app/Contents/MacOS/BoomBigNose" ||
   ! test -x "$root/BoomBigNose.app/Contents/Resources/bundle/node" ||
   ! test -s "$root/BoomBigNose.app/Contents/Resources/bundle/erp/server.js"; then
  restore
  exit 1
fi
if ! open "$root/BoomBigNose.app"; then
  restore
  exit 1
fi
`
