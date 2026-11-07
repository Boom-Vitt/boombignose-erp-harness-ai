#!/usr/bin/env node
// Prepare a standalone ERP without changing Next's traced shared dependencies.
// hydrate rebuilds the pure-Go decoder on each actual target host; standalone
// copies the decoder prepared before next build. smoke uses the shipped Node.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, lstatSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { buildImageHelper, copyImageHelper, imageHelperName } from './build-image-helper.mjs';
import { auditNotices, collectNotices, stripPrivateClientMaps } from './collect-notices.mjs';

const [mode, erpArgument, targetArgument] = process.argv.slice(2);
const target = targetArgument ?? `${process.platform}-${process.arch}`;
const targets = {
  'linux-x64': { os: 'linux', cpu: 'x64', libc: 'glibc', machine: 62 },
  'linux-arm64': { os: 'linux', cpu: 'arm64', machine: 183 },
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', machine: 0x0100000c },
  'darwin-x64': { os: 'darwin', cpu: 'x64', machine: 0x01000007 },
  'win32-x64': { os: 'win32', cpu: 'x64', machine: 0x8664 },
  'win32-arm64': { os: 'win32', cpu: 'arm64', machine: 0xaa64 },
};
assert(['standalone', 'hydrate', 'smoke'].includes(mode) && erpArgument && targets[target],
  'usage: erp-dependencies.mjs standalone|hydrate|smoke ERP [OS-ARCH]');
const platform = targets[target];
assert.equal(process.platform, platform.os, 'preparation/smoke must run on the target OS');
assert.equal(process.arch, platform.cpu, 'preparation/smoke must run on the target CPU');
if (mode !== 'standalone' && platform.libc) {
  assert(process.report.getReport().header.glibcVersionRuntime, 'Linux desktop bundles require glibc');
}
const erp = realpathSync(erpArgument);
assert(existsSync(join(erp, 'server.js')), 'standalone server missing');
if (mode !== 'standalone') assert(existsSync(join(erp, '.next', 'static')), 'standalone static assets missing');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = (directory) => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const inside = (parent, path) => {
  const rel = relative(parent, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
const forbidden = (name) => name === 'sharp' || name.startsWith('@img/sharp')
  // PDF.js rendering is browser-only; its optional Node canvas is not needed.
  || name === '@napi-rs/canvas' || name.startsWith('@napi-rs/canvas-');
const matches = (values, value) => !values || (!values.includes(`!${value}`)
  && (values.every((entry) => entry.startsWith('!')) || values.includes(value)));
const compatible = (pkg) => matches(pkg.os, platform.os) && matches(pkg.cpu, platform.cpu)
  && (!platform.libc || matches(pkg.libc, platform.libc));

// Inspect aliases before deleting physical packages, so no dangling aliases to
// excluded scopes survive. Do not follow aliases or overlay shared Next deps.
function excludedPackages(directory, removals = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (existsSync(join(path, 'package.json'))) {
      const pkg = manifest(path);
      if (forbidden(pkg.name ?? '') || !compatible(pkg)) {
        removals.push(path);
        continue;
      }
    }
    if (entry.isDirectory()) excludedPackages(path, removals);
  }
  return removals;
}

function auditLinksAndPackages(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      assert(inside(erp, realpathSync(path)), `symlink escapes standalone bundle: ${path}`);
    } else if (entry.isDirectory()) {
      if (existsSync(join(path, 'package.json'))) {
        const pkg = manifest(path);
        assert(!forbidden(pkg.name ?? ''), `excluded runtime package: ${pkg.name}`);
        assert(compatible(pkg), `foreign runtime package: ${pkg.name}`);
      }
      auditLinksAndPackages(path);
    } else {
      assert(!/(?:libvips|libsharp)/i.test(entry.name), `excluded image library: ${path}`);
    }
  }
}

function auditBinary(path) {
  const fd = openSync(path, 'r');
  const bytes = Buffer.alloc(4096);
  try {
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    assert(size >= 20, `truncated native payload: ${path}`);
    if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      assert.equal(platform.os, 'linux', `foreign ELF payload: ${path}`);
      assert.equal(bytes[5], 1, `unsupported ELF byte order: ${path}`);
      assert.equal(bytes.readUInt16LE(18), platform.machine, `foreign ELF CPU: ${path}`);
    } else if (bytes.readUInt32LE(0) === 0xfeedfacf) {
      assert.equal(platform.os, 'darwin', `foreign Mach-O payload: ${path}`);
      assert.equal(bytes.readUInt32LE(4), platform.machine, `foreign Mach-O CPU: ${path}`);
    } else if (bytes.readUInt32BE(0) === 0xcafebabe) {
      assert.equal(platform.os, 'darwin', `foreign universal Mach-O payload: ${path}`);
      const arches = bytes.readUInt32BE(4);
      assert(arches <= (size - 8) / 20, `invalid universal Mach-O header: ${path}`);
      assert(Array.from({ length: arches }, (_, index) => bytes.readUInt32BE(8 + index * 20))
        .includes(platform.machine), `universal Mach-O missing target CPU: ${path}`);
    } else if (bytes.toString('ascii', 0, 2) === 'MZ') {
      assert.equal(platform.os, 'win32', `foreign PE payload: ${path}`);
      const pe = Buffer.alloc(6);
      assert.equal(readSync(fd, pe, 0, pe.length, bytes.readUInt32LE(0x3c)), pe.length);
      assert.equal(pe.readUInt32LE(0), 0x00004550, `invalid PE header: ${path}`);
      assert.equal(pe.readUInt16LE(4), platform.machine, `foreign PE CPU: ${path}`);
    } else {
      throw new Error(`unrecognized native payload: ${path}`);
    }
  } finally { closeSync(fd); }
}

// Zero Node native addons is valid. Any surviving addon/library must still be
// target-native; the separately audited Go executable is always required.
function auditNative(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) auditNative(path);
    else if (entry.isFile() && /\.(?:node|dylib|dll)$|\.so(?:\.|$)/.test(entry.name)) auditBinary(path);
  }
}

const helper = join(erp, 'boombignose', 'bin', imageHelperName);
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
if (mode !== 'smoke') {
  if (mode === 'hydrate') buildImageHelper(erp);
  else copyImageHelper(erp);
  const removals = excludedPackages(join(erp, 'node_modules'));
  // Remove aliases first while they still resolve, then deepest physical paths.
  removals.sort((a, b) => Number(lstatSync(b).isSymbolicLink()) - Number(lstatSync(a).isSymbolicLink()) || b.length - a.length);
  for (const path of removals) rmSync(path, { recursive: true, force: true });
  for (const entry of readdirSync(erp)) {
    if (entry === '.env' || entry.startsWith('.env.')) rmSync(join(erp, entry), { force: true });
  }
  auditLinksAndPackages(erp);
  auditNative(join(erp, 'node_modules'));
  auditBinary(helper);
  if (mode === 'standalone') collectNotices(erp);
  else stripPrivateClientMaps(erp);
  writeFileSync(join(erp, 'native-dependencies.json'), `${JSON.stringify({
    target, lockfileSha256: digest(join(root, 'pnpm-lock.yaml')),
    rasterHelper: { path: relative(erp, helper).split(sep).join('/'), buildSha256: digest(helper),
      hashStage: 'before-platform-signing', cgo: false },
    excluded: ['sharp', '@img/sharp*', '@napi-rs/canvas*'],
  }, null, 2)}\n`);
  console.log(`prepared pure-Go ${target} raster runtime; excluded Sharp/libvips and optional Node canvas`);
} else {
  const shippedNode = join(dirname(erp), platform.os === 'win32' ? 'node.exe' : 'node');
  assert.equal(realpathSync(process.execPath), realpathSync(shippedNode), 'smoke must use the shipped Node');
  const provenance = JSON.parse(readFileSync(join(erp, 'native-dependencies.json'), 'utf8'));
  assert.equal(provenance.target, target);
  if (platform.os !== 'darwin') assert.equal(provenance.rasterHelper.buildSha256, digest(helper));
  auditLinksAndPackages(erp);
  auditNative(join(erp, 'node_modules'));
  auditBinary(helper);
  const foreignHelper = join(erp, 'boombignose', 'bin', imageHelperName.endsWith('.exe') ? 'boombignose-image' : 'boombignose-image.exe');
  assert(!existsSync(foreignHelper), 'stale foreign raster helper remains');
  const application = createRequire(join(erp, 'server.js'));
  assert(inside(erp, realpathSync(application.resolve('next'))), 'Next resolved outside the shipped bundle');
  auditNotices(erp);

  // Construct a valid PNG without Sharp. The corrupt case retains its valid
  // IHDR and chunk CRCs, but invalidates compressed pixel data: header-only
  // inspection cannot pass this smoke.
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const pixels = deflateSync(Buffer.from([0, 17, 99, 203, 17, 99, 203, 0, 17, 99, 203, 17, 99, 203]));
  const png = (data) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
  function decode(bytes) {
    const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length));
    const result = spawnSync(helper, [], { input: Buffer.concat([length, bytes]), shell: false,
      env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      timeout: 5000, maxBuffer: 4096, windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'raster helper did not complete its protocol');
    return JSON.parse(result.stdout.toString('utf8'));
  }
  assert.deepEqual(decode(png(pixels)), { ok: true, mime: 'image/png', width: 2, height: 2 });
  const corrupt = Buffer.from(pixels); corrupt[0] = 0;
  const rejected = decode(png(corrupt));
  assert.equal(rejected.ok, false, 'corrupt image pixels were accepted');
  assert.equal(typeof rejected.code, 'string');
  console.log(`pure-Go image decode and corrupt-pixel rejection: ${target}`);
}
