#!/usr/bin/env node
// Copy actual product rights/installation material, not an SPDX-only assertion.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (text) => createHash('sha256').update(text).digest('hex');

export function installationInformation() {
  const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
  const guide = readFileSync(join(root, 'docs', 'boombignose', 'BUNDLE.md'), 'utf8').replace(/\r\n/g, '\n');
  const heading = '### Modified native components: LGPL source and installation';
  const start = guide.indexOf(`${heading}\n`);
  assert(start >= 0 && guide.indexOf(`${heading}\n`, start + 1) === -1, 'unique product LGPL installation section missing');
  const remaining = guide.slice(start + heading.length + 1);
  const next = /\n#{1,3} /.exec(remaining);
  const section = guide.slice(start, next ? start + heading.length + 1 + next.index : undefined).trimEnd() + '\n';
  assert(notice.includes('LGPL combined-work rights:') && /reverse\s+engineer/.test(notice)
    && notice.includes('are not restricted'), 'affirmative product LGPL modification/debugging rights missing');
  for (const instruction of ['BOOMBIGNOSE_BUNDLE', 'boombignose serve', 'codesign --force --sign -', 'Windows', 'rollback']) {
    assert(section.includes(instruction), `actual product installation instruction missing: ${instruction}`);
  }
  const text = `Product rights and native component installation information\n\n${notice.trimEnd()}\n\n${section}`;
  const metadata = {
    format: 1,
    scope: 'Actual versioned product terms and installation instructions; no publisher key/notarization or unchanged modified-binary identity is claimed.',
    inputs: [
      { path: 'NOTICE', sha256: digest(notice), bytes: Buffer.byteLength(notice) },
      { path: 'docs/boombignose/BUNDLE.md', section: heading, sha256: digest(section), bytes: Buffer.byteLength(section) },
    ],
    material: { path: 'installation-information.txt', role: 'installation-information', sha256: digest(text), bytes: Buffer.byteLength(text) },
  };
  return { text, metadata };
}

export function collectInstallationInformation(destination) {
  const output = resolve(destination);
  const { text, metadata } = installationInformation();
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'installation-information.txt'), text);
  writeFileSync(join(output, 'installation-information.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'usage: installation-information.mjs OUTPUT_DIRECTORY');
  const metadata = collectInstallationInformation(process.argv[2]);
  console.log(`installation material: ${resolve(process.argv[2], metadata.material.path)} (${metadata.material.sha256})`);
}
