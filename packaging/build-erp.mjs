#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImageHelper } from './build-image-helper.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// This directory contains only generated provenance from the previous build.
rmSync(join(root, '.next', 'private-source-maps'), { recursive: true, force: true });
buildImageHelper();
run(require.resolve('next/dist/bin/next'), ['build', ...process.argv.slice(2)], { ...process.env, BBN_PRIVATE_SOURCE_MAPS: '1' });
run(join(root, 'packaging', 'erp-dependencies.mjs'), ['standalone', join(root, '.next', 'standalone')]);

// Next serves .next/static in `pnpm start` too. Retain provenance outside that
// public tree after notice collection, not merely outside assembled installers.
const assets = join(root, '.next', 'static');
const entries = readdirSync(assets, { recursive: true });
assert(entries.length <= 500000, 'static build tree exceeded bounded size');
for (const entry of entries.filter((name) => name.endsWith('.map'))) {
  const destination = join(root, '.next', 'private-source-maps', entry);
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(join(assets, entry), destination);
}
