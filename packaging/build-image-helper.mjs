#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'boombignose');
export const imageHelperName = process.platform === 'win32' ? 'boombignose-image.exe' : 'boombignose-image';

function clearHelpers(directory) {
  mkdirSync(directory, { recursive: true });
  for (const name of ['boombignose-image', 'boombignose-image.exe']) {
    rmSync(join(directory, name), { force: true });
  }
}

export function copyImageHelper(erpRoot) {
  const destination = join(resolve(erpRoot), 'boombignose', 'bin');
  clearHelpers(destination);
  cpSync(join(source, 'bin', imageHelperName), join(destination, imageHelperName));
  return join(destination, imageHelperName);
}

export function buildImageHelper(erpRoot) {
  const toolchain = /^toolchain (go\d+\.\d+\.\d+)$/m.exec(readFileSync(join(source, 'go.mod'), 'utf8'))?.[1];
  assert(toolchain, 'boombignose/go.mod must pin an exact Go toolchain');
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  assert(arch && ['linux', 'darwin', 'win32'].includes(process.platform), 'unsupported raster helper build host');
  const directory = join(source, 'bin');
  clearHelpers(directory);
  const result = spawnSync('go', ['build', '-mod=readonly', '-trimpath', '-buildvcs=false',
    '-o', join(directory, imageHelperName), './cmd/boombignose-image'], {
    cwd: source, stdio: 'inherit', shell: false,
    env: { ...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: toolchain, GOENV: 'off', GOWORK: 'off',
      GOFLAGS: '', GOOS: process.platform === 'win32' ? 'windows' : process.platform, GOARCH: arch },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'pinned pure-Go raster helper build failed');
  return erpRoot ? copyImageHelper(erpRoot) : join(directory, imageHelperName);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'usage: build-image-helper.mjs');
  buildImageHelper();
}
