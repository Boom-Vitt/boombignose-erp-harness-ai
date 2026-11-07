#!/bin/sh
# Add pinned Node and portable Postgres to an existing standalone server.
# The Next.js server is built once on Linux and downloaded into dist/bundle/erp.
# Rebuild the pure-Go raster helper for this host and remove build-only image
# addons; preserve the standalone server, shared dependencies and static assets.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

NODE_VERSION=22.21.1
NODE_SHA=c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz"

dist=$root/dist/bundle
test -s "$dist/erp/server.js"
rm -f "$dist/node"
rm -rf "$dist/postgres"
mkdir -p "$dist"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/node.tar.gz" "$NODE_URL"
echo "$NODE_SHA  $tmp/node.tar.gz" | shasum -a 256 -c -
tar -xzf "$tmp/node.tar.gz" -C "$tmp"
node_dir=$tmp/node-v${NODE_VERSION}-darwin-arm64
cp "$node_dir/bin/node" "$dist/node"
chmod 755 "$dist/node"
cp "$node_dir/LICENSE" "$dist/NODE_LICENSE"
export PATH="$node_dir/bin:$PATH"

sh packaging/postgres/assemble-server.sh "$dist/postgres"
cp packaging/postgres/prelude-after-auth.sql "$dist/postgres/prelude-after-auth.sql"
mkdir -p "$dist/postgres/migrations"
cp supabase/migrations/*.sql "$dist/postgres/migrations/"
postgrest_build=$root/dist/postgrest-build
rm -rf "$postgrest_build"
node packaging/postgrest/build.mjs "$postgrest_build"
cp -a "$postgrest_build/clients/." "$dist/postgres/"
cp packaging/postgres/assemble-clients.sh "$dist/postgres/build-provenance/assemble-clients.sh"

AUTH_SHA=3fb7998e7061e2c14f3f9555b1d94d447358c965395728e0d81eac82e0e5868b
AUTH_URL="https://github.com/supabase/auth/releases/download/v2.197.0/auth-v2.197.0-darwin-arm64.tar.gz"

cat > "$dist/PROVENANCE" << EOF
platform=darwin-arm64
node=v${NODE_VERSION}
node_url=${NODE_URL}
node_sha256=${NODE_SHA}
node_license=MIT core and bundled third-party terms (NODE_LICENSE)
postgres=16.15
postgres_provenance=postgres/SERVER_PROVENANCE.json
openssl=3.5.9
postgres_license=postgres/POSTGRESQL_LICENSE.txt and postgres/third-party-notices/index.json
erp=linux-built Next.js standalone server.js
auth=v2.197.0
auth_url=${AUTH_URL}
auth_sha256=${AUTH_SHA}
auth_license=auth/AUTH_LICENSE.txt and auth/third-party-notices/index.json
postgrest=v16.5 (source build)
postgrest_source_commit=798523c910c09dc56d92ba2c42bcb78e5f59ecb3
postgrest_provenance=postgrest/third-party-notices/index.json
postgrest_license=postgrest/POSTGREST_LICENSE.txt and postgrest/third-party-notices/index.json
ollama=v0.40.11
ollama_url=https://github.com/ollama/ollama/releases/download/v0.40.11/ollama-darwin.tgz
ollama_sha256=aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291
ollama_license=MIT (ollama/OLLAMA_LICENSE.txt)
ollama_omitted=none
ollama_note=The universal darwin archive is packed in full, including Metal runners. The model is not packed.
EOF

curl -fsSL -o "$tmp/auth.tgz" "$AUTH_URL"
echo "$AUTH_SHA  $tmp/auth.tgz" | shasum -a 256 -c -
rm -rf "$dist/auth" "$dist/postgrest"
mkdir -p "$dist/auth"
tar -xzf "$tmp/auth.tgz" -C "$dist/auth"
chmod 755 "$dist/auth/auth"
cp packaging/auth/AUTH_LICENSE.txt "$dist/auth/AUTH_LICENSE.txt"
test -d "$dist/auth/migrations"
mkdir -p "$dist/postgrest"
cp "$postgrest_build/artifact/postgrest" "$dist/postgrest/postgrest"
chmod 755 "$dist/postgrest/postgrest"
cp packaging/postgrest/POSTGREST_LICENSE.txt "$dist/postgrest/POSTGREST_LICENSE.txt"

OLLAMA_VERSION=0.40.11
OLLAMA_SHA=aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291
OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin.tgz"
OLLAMA_LICENSE_SHA=5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226
echo "$OLLAMA_LICENSE_SHA  packaging/ollama/OLLAMA_LICENSE.txt" | shasum -a 256 -c -
curl -fsSL -o "$tmp/ollama.tgz" "$OLLAMA_URL"
echo "$OLLAMA_SHA  $tmp/ollama.tgz" | shasum -a 256 -c -
mkdir -p "$tmp/ollama-src"
tar -xzf "$tmp/ollama.tgz" -C "$tmp/ollama-src"
rm -rf "$dist/ollama"
stage_out=$(python3 packaging/ollama/stage.py "$tmp/ollama-src" "$dist/ollama" packaging/ollama/OLLAMA_LICENSE.txt)
printf '%s\n' "$stage_out"
printf '%s\n' "$stage_out" | grep -Fx 'omitted=none'
test -s "$dist/ollama/ollama"
"$dist/node" packaging/erp-dependencies.mjs hydrate "$dist/erp" darwin-arm64
"$dist/node" packaging/collect-notices.mjs runtime "$dist" "$postgrest_build"
"$dist/node" packaging/collect-notices.mjs bundle "$dist"
# Prove the shipped pure-Go helper actually decodes and rejects corrupt pixels.
"$dist/node" packaging/erp-dependencies.mjs smoke "$dist/erp" darwin-arm64

# curl marks the download with quarantine. Clear it and ad-hoc sign the
# binaries the smoke executes. This is not a Developer ID signature.
xattr -cr "$dist" || true
codesign --force --sign - \
  "$dist/node" \
  "$dist/erp/boombignose/bin/boombignose-image" \
  "$dist/postgres/bin/initdb" \
  "$dist/postgres/bin/pg_ctl" \
  "$dist/postgres/bin/postgres" \
  "$dist/postgres/bin/psql" \
  "$dist/postgres/bin/pg_dump" \
  "$dist/postgres/bin/pg_restore" \
  "$dist/auth/auth" \
  "$dist/postgrest/postgrest" \
  "$dist/ollama/ollama"
find "$dist/ollama" "$dist/erp/node_modules" "$dist/postgres/bin" "$dist/postgres/lib" -type f \( -name '*.dylib' -o -name '*.so' -o -name '*.node' -o -perm -111 \) -print | while IFS= read -r lib; do
  if file "$lib" | grep -q 'Mach-O'; then
    codesign --force --sign - "$lib"
  fi
done
# --version may warn that no daemon is listening. It must not pull a model.
"$dist/ollama/ollama" --version | grep -F "0.40.11"
test -x "$dist/node"
test -x "$dist/postgres/bin/postgres"
test -s "$dist/postgres/prelude-after-auth.sql"
test -d "$dist/postgres/share/extension"
"$dist/node" packaging/collect-notices.mjs bundle "$dist"
echo "wrote $dist"
