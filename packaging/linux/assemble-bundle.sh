#!/bin/sh
# Build dist/bundle for Linux amd64 with pinned Node and source-owned PostgreSQL
# 16.15/OpenSSL 3.5.9 and PostgREST 16.5. The source recipes reject non-OS
# dependencies outside the bundle; full original notices/sources are collected.
# Windows and macOS reuse the traced ERP and rebuild their Go raster helper.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

NODE_VERSION=22.21.1
NODE_SHA=680d3f30b24a7ff24b98db5e96f294c0070f8f9078df658da1bce1b9c9873c88
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"

dist=$root/dist/bundle
rm -rf "$dist"
mkdir -p "$dist"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/node.tar.xz" "$NODE_URL"
echo "$NODE_SHA  $tmp/node.tar.xz" | sha256sum -c -
tar -xJf "$tmp/node.tar.xz" -C "$tmp"
node_dir=$tmp/node-v${NODE_VERSION}-linux-x64
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

AUTH_SHA=b5c2991d1df760c9b099c1c2395a94bd1c2f83ed58901934921997179dc9f7ea
AUTH_URL="https://github.com/supabase/auth/releases/download/v2.197.0/auth-v2.197.0-amd64.tar.xz"

cat > "$dist/PROVENANCE" << EOF
platform=linux-amd64
node=v${NODE_VERSION}
node_url=${NODE_URL}
node_sha256=${NODE_SHA}
node_license=MIT core and bundled third-party terms (NODE_LICENSE)
postgres=16.15
postgres_provenance=postgres/SERVER_PROVENANCE.json
openssl=3.5.9
postgres_license=postgres/POSTGRESQL_LICENSE.txt and postgres/third-party-notices/index.json
auth=v2.197.0
auth_url=${AUTH_URL}
auth_sha256=${AUTH_SHA}
auth_license=auth/AUTH_LICENSE.txt and auth/third-party-notices/index.json
postgrest=v16.5 (source build)
postgrest_source_commit=798523c910c09dc56d92ba2c42bcb78e5f59ecb3
postgrest_provenance=postgrest/third-party-notices/index.json
postgrest_license=postgrest/POSTGREST_LICENSE.txt and postgrest/third-party-notices/index.json
ollama=v0.40.11
ollama_url=https://github.com/ollama/ollama/releases/download/v0.40.11/ollama-linux-amd64.tar.zst
ollama_sha256=7bedab90dd122661be78798e9f0edf37fccf0cccf2699d2c58ea1a3afdc04b6d
ollama_license=MIT (ollama/OLLAMA_LICENSE.txt)
ollama_omitted=cuda_v12,cuda_v13
ollama_note=CUDA runners are omitted so the installer stays under the 2 GiB GitHub asset limit. CPU and Vulkan runners stay. The model is not packed.
EOF

curl -fsSL -o "$tmp/auth.txz" "$AUTH_URL"
echo "$AUTH_SHA  $tmp/auth.txz" | sha256sum -c -
mkdir -p "$dist/auth"
tar -xJf "$tmp/auth.txz" -C "$dist/auth"
chmod 755 "$dist/auth/auth"
cp packaging/auth/AUTH_LICENSE.txt "$dist/auth/AUTH_LICENSE.txt"
test -d "$dist/auth/migrations"
mkdir -p "$dist/postgrest"
cp "$postgrest_build/artifact/postgrest" "$dist/postgrest/postgrest"
chmod 755 "$dist/postgrest/postgrest"
cp packaging/postgrest/POSTGREST_LICENSE.txt "$dist/postgrest/POSTGREST_LICENSE.txt"

OLLAMA_VERSION=0.40.11
OLLAMA_SHA=7bedab90dd122661be78798e9f0edf37fccf0cccf2699d2c58ea1a3afdc04b6d
OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tar.zst"
OLLAMA_LICENSE_SHA=5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226
command -v zstd >/dev/null
echo "$OLLAMA_LICENSE_SHA  packaging/ollama/OLLAMA_LICENSE.txt" | sha256sum -c -
curl -fsSL -o "$tmp/ollama.tar.zst" "$OLLAMA_URL"
echo "$OLLAMA_SHA  $tmp/ollama.tar.zst" | sha256sum -c -
mkdir -p "$tmp/ollama-src"
tar --zstd -xf "$tmp/ollama.tar.zst" -C "$tmp/ollama-src"
rm -rf "$dist/ollama"
stage_out=$(python3 packaging/ollama/stage.py "$tmp/ollama-src" "$dist/ollama" packaging/ollama/OLLAMA_LICENSE.txt)
printf '%s\n' "$stage_out"
printf '%s\n' "$stage_out" | grep -Fx 'omitted=cuda_v12,cuda_v13'
test ! -d "$dist/ollama/lib/ollama/cuda_v12"
test ! -d "$dist/ollama/lib/ollama/cuda_v13"
ollama_bin=$(printf '%s\n' "$stage_out" | sed -n 's/^binary=//p')
test -x "$ollama_bin"
# --version may warn that no daemon is listening. It must not pull a model.
"$ollama_bin" --version | grep -F "$OLLAMA_VERSION"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-local-anon-not-a-secret}"
export BBN_EDITION="${BBN_EDITION:-community}"
unset LD_LIBRARY_PATH
hash -r
node -v
corepack pnpm@10.33.4 install --frozen-lockfile --ignore-scripts
corepack pnpm@10.33.4 build
rm -rf "$dist/erp"
mkdir -p "$dist/erp"
cp -a .next/standalone/. "$dist/erp/"
mkdir -p "$dist/erp/.next"
if [ ! -d .next/static ]; then
  echo "next build did not produce .next/static" >&2
  exit 1
fi
cp -a .next/static "$dist/erp/.next/static"
if [ -d public ]; then
  cp -a public "$dist/erp/public"
fi
if [ ! -s "$dist/erp/server.js" ]; then
  find "$dist/erp" -name server.js -print >&2
  echo "standalone server.js was not at the bundle root" >&2
  exit 1
fi
"$dist/node" packaging/erp-dependencies.mjs hydrate "$dist/erp" linux-x64
"$dist/node" packaging/collect-notices.mjs runtime "$dist" "$postgrest_build"
"$dist/node" packaging/collect-notices.mjs bundle "$dist"
test -x "$dist/node"
test -x "$dist/postgres/bin/postgres"
test -s "$dist/postgres/prelude-after-auth.sql"
echo "wrote $dist"
