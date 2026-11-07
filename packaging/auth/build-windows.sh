#!/bin/sh
# Upstream Auth v2.197.0 publishes Linux and macOS archives and does not
# publish a Windows archive. Build the pinned commit for windows/amd64.
# The harness module stays on its own Go version; Auth uses exactly Go 1.27.0.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
expected=4eee58f296d9698a1c2c0ae14d7a0b379c7622d3
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -c core.autocrlf=false clone --depth 1 --branch v2.197.0 https://github.com/supabase/auth.git "$tmp/auth"
got=$(git -C "$tmp/auth" rev-parse HEAD)
if [ "$got" != "$expected" ]; then
  echo "auth commit is $got, expected $expected" >&2
  exit 1
fi
# Refuse any unrecorded tracked or untracked source change before applying the
# sole portability patch. Build metadata below binds the resulting source tree.
test -z "$(git -C "$tmp/auth" status --porcelain)"
# The pinned server sets SO_REUSEPORT. That constant does not exist for
# GOOS=windows. Drop it after the commit check. One loopback listener does
# not need the option. Linux and macOS keep the upstream archive.
patch -p1 --directory "$tmp/auth" --input "$root/packaging/auth/windows-no-reuseport.patch"
out=$root/dist/auth-windows
rm -rf "$out"
mkdir -p "$out"
(
  cd "$tmp/auth"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 GOAMD64=v1 GOFLAGS= GOEXPERIMENT= GOTOOLCHAIN=go1.27.0 \
    go build -mod=readonly -trimpath -buildvcs=false \
    -ldflags "-X github.com/supabase/auth/internal/utilities.Version=v2.197.0" -o "$out/auth.exe" .
  cp -a migrations "$out/migrations"
)
# The witness travels beside auth.exe; the collector checks its source-tree,
# patch, recipe, binary and embedded module/toolchain identities without a build.
node --input-type=module - "$tmp/auth" "$out" "$root" "$expected" <<'NODE'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [source, out, root, commit] = process.argv.slice(2);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert(!result.error && result.status === 0, result.error?.message ?? result.stderr);
  return result.stdout;
};
const paths = run('git', ['-C', source, 'ls-files', '-z']).split('\0').filter(Boolean).sort();
const tree = createHash('sha256');
for (const path of paths) tree.update(`${sha(readFileSync(join(source, path)))}  ${path}\n`);
const buildInfo = run('go', ['version', '-m', join(out, 'auth.exe')], { env: { ...process.env, GOTOOLCHAIN: 'local' } });
const witness = {
  format: 1, component: 'github.com/supabase/auth', version: 'v2.197.0', sourceCommit: commit,
  sourceTreeSha256: tree.digest('hex'), sourceFileCount: paths.length,
  patchSha256: sha(readFileSync(join(root, 'packaging/auth/windows-no-reuseport.patch'))),
  recipeSha256: sha(readFileSync(join(root, 'packaging/auth/build-windows.sh'))),
  toolchain: 'go1.27.0', target: { GOOS: 'windows', GOARCH: 'amd64', GOAMD64: 'v1', CGO_ENABLED: '0' },
  flags: ['-mod=readonly', '-trimpath', '-buildvcs=false', '-ldflags', '-X github.com/supabase/auth/internal/utilities.Version=v2.197.0'],
  binarySha256: sha(readFileSync(join(out, 'auth.exe'))), buildInfo
};
assert(buildInfo.split('\n')[0].endsWith(': go1.27.0'), 'Windows Auth compiler differs from exact toolchain pin');
writeFileSync(join(out, 'build-provenance.json'), `${JSON.stringify(witness, null, 2)}\n`);
NODE
node "$root/packaging/auth/collect-notices.mjs" collect "$out/auth.exe" "$out/third-party-notices"
node "$root/packaging/auth/collect-notices.mjs" audit "$out/third-party-notices"
test -s "$out/auth.exe"
test -s "$out/migrations/00_init_auth_schema.up.sql"
echo "built $out/auth.exe from $expected"
