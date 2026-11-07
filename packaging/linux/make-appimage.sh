#!/bin/sh
# Wrap the Linux desktop binary in an AppImage.
# The image still needs the system WebKitGTK 4.1 libraries.
# When dist/bundle exists, it is copied next to the binary so the window
# finds bundle/node. The Postgres data directory stays in the home directory.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/boombignose-desktop
test -s "$bin"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
app=$stage/BoomBigNose.AppDir
mkdir -p "$app/usr/bin"
cp "$bin" "$app/usr/bin/BoomBigNose"
chmod 755 "$app/usr/bin/BoomBigNose"
test -s "$root/dist/boombignose"
cp "$root/dist/boombignose" "$app/usr/bin/boombignose"
chmod 755 "$app/usr/bin/boombignose"
if [ -d "$root/dist/bundle" ]; then
  cp -a "$root/dist/bundle" "$app/usr/bin/bundle"
fi
cat > "$app/AppRun" << 'EOF'
#!/bin/sh
HERE=$(dirname "$(readlink -f "$0")")
exec "$HERE/usr/bin/BoomBigNose"
EOF
chmod 755 "$app/AppRun"
cat > "$app/boombignose.desktop" << 'EOF'
[Desktop Entry]
Name=BoomBigNose
Exec=BoomBigNose
Icon=boombignose
Type=Application
Categories=Office;
EOF
cp "$root/packaging/linux/boombignose.png" "$app/boombignose.png"
tool=$stage/appimagetool
curl -fsSL -o "$tool" -L https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
chmod 755 "$tool"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$tool" "$app" "$root/dist/BoomBigNose-linux-amd64.AppImage"
test -s "$root/dist/BoomBigNose-linux-amd64.AppImage"
echo "wrote $root/dist/BoomBigNose-linux-amd64.AppImage"
