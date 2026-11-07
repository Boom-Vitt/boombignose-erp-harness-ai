#!/usr/bin/env node
// Build-time acquisition only. Never executes Auth, compiles Go, or changes go.mod/go.sum.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(readFileSync(join(here, 'notice-sources.json'), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const legal = /(?:^|[._-])(?:licen[cs]es?|copying|notices?|copyright|patents|authors|ofl)(?:[._-]|$)/i;
const maxArchive = 128 * 1024 * 1024;
const maxExpanded = 768 * 1024 * 1024;
const safe = (name) => typeof name === 'string' && name.length > 0 && !isAbsolute(name)
  && !name.includes('\\') && !name.split('/').some((part) => part === '..' || part === '.');
const escapeModule = (text) => text.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
// Checkout text may use CRLF; never normalize source archives or module h1 input.
const lfBytes = (bytes) => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));

function command(args) {
  const result = spawnSync('go', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GOTOOLCHAIN: 'local' } });
  assert(!result.error && result.status === 0, `static go ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function signatureNormalizedMachO(bytes) {
  assert(bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf
    && bytes.readUInt32LE(4) === 0x0100000c, 'only little-endian arm64 Mach-O has pinned release payload evidence');
  const output = Buffer.from(bytes);
  const count = bytes.readUInt32LE(16), commandEnd = 32 + bytes.readUInt32LE(20);
  assert(count <= 1024 && commandEnd <= bytes.length, 'invalid Mach-O commands');
  let at = 32, signature, linkedit;
  for (let i = 0; i < count; i++) {
    assert(at + 8 <= commandEnd, 'truncated Mach-O command');
    const cmd = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 4);
    assert(size >= 8 && at + size <= commandEnd, 'invalid Mach-O command size');
    if (cmd === 0x1d) {
      assert(!signature && size === 16, 'invalid/duplicate Mach-O signature command');
      signature = { offset: bytes.readUInt32LE(at + 8), size: bytes.readUInt32LE(at + 12) };
      output.fill(0, at, at + size);
    }
    if (cmd === 0x19 && bytes.subarray(at + 8, at + 24).toString().replace(/\0.*$/s, '') === '__LINKEDIT') {
      assert(!linkedit && size === 72, 'invalid/duplicate Mach-O LINKEDIT segment');
      linkedit = { offset: Number(bytes.readBigUInt64LE(at + 40)), size: Number(bytes.readBigUInt64LE(at + 48)) };
      output.fill(0, at + 32, at + 40);
      output.fill(0, at + 48, at + 56);
    }
    at += size;
  }
  assert(at === commandEnd && signature && linkedit && signature.offset >= linkedit.offset
    && signature.offset + signature.size === bytes.length
    && linkedit.offset + linkedit.size === bytes.length, 'Mach-O signature must be terminal LINKEDIT data');
  output.fill(0, 16, 24);
  return { sha256: sha(output.subarray(0, signature.offset)), bytes: signature.offset };
}

function buildGraph(text) {
  const graph = { modules: [], settings: {} };
  for (const line of text.split('\n')) {
    const fields = line.trim().split('\t');
    if (line.startsWith('\tpath\t')) graph.path = fields[1];
    else if (line.startsWith('\tmod\t')) graph.main = { path: fields[1], version: fields[2], sum: fields[3] || null };
    else if (line.startsWith('\tdep\t')) graph.modules.push({ path: fields[1], version: fields[2], sum: fields[3] || null });
    else if (line.startsWith('\t=>\t')) {
      assert(graph.modules.length, 'replacement without module');
      graph.modules.at(-1).replacement = { path: fields[1], version: fields[2], sum: fields[3] || null };
    } else if (line.startsWith('\tbuild\t')) {
      const setting = fields.slice(1).join('\t');
      const eq = setting.indexOf('=');
      if (eq >= 0) graph.settings[setting.slice(0, eq)] = setting.slice(eq + 1);
    } else if (!line.startsWith('\t') && /: go\S+\s*$/.test(line)) graph.toolchain = line.match(/: (go\S+)\s*$/)[1];
  }
  assert(graph.main?.path === 'github.com/supabase/auth' && graph.modules.length > 0 && graph.modules.length <= 512,
    'input must contain the actual Supabase Auth linked-module build information');
  return graph;
}

// Read central-directory entries directly; extracting untrusted archives is unnecessary.
function zipEntries(bytes) {
  assert(bytes.length <= maxArchive, 'source archive exceeds 128 MiB');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  assert(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, 'invalid/multidisk ZIP');
  const count = bytes.readUInt16LE(end + 10);
  assert(count > 0 && count < 65535, 'ZIP64/empty source archives are not supported');
  let at = bytes.readUInt32LE(end + 16), expanded = 0;
  const entries = [], names = new Set();
  for (let i = 0; i < count; i++) {
    assert(at + 46 <= end && bytes.readUInt32LE(at) === 0x02014b50, 'invalid ZIP directory');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const n = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    const offset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + n).toString('utf8');
    assert(safe(name) && !names.has(name) && !(flags & 1) && [0, 8].includes(method), `unsafe/unsupported ZIP entry: ${name}`);
    names.add(name);
    expanded += size;
    assert(expanded <= maxExpanded && size <= maxArchive, 'expanded source archive exceeds bounds');
    assert(offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50, 'invalid ZIP local header');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    assert(start + packed <= bytes.length, 'truncated ZIP entry');
    entries.push({ name, size, data() {
      const value = method === 0 ? bytes.subarray(start, start + packed)
        : inflateRawSync(bytes.subarray(start, start + packed), { maxOutputLength: Math.max(1, size) });
      assert(value.length === size, `ZIP size mismatch: ${name}`);
      return value;
    } });
    at += 46 + n + extra + comment;
  }
  return entries.filter((entry) => !entry.name.endsWith('/')).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
}

function windowsSourceTree(entries, patchBytes) {
  const canonicalPatch = lfBytes(patchBytes);
  assert(sha(canonicalPatch) === pins.windows.patchSha256, 'tracked Windows portability patch differs from pin after CRLF-to-LF-only normalization');
  const path = 'cmd/serve_cmd.go';
  const entry = entries.find((item) => item.name === `${pins.auth.prefix}${path}`);
  assert(entry, 'Windows portability source missing');
  const original = entry.data().toString('utf8').split('\n');
  const patch = canonicalPatch.toString('utf8').split('\n');
  assert(patch[0] === `--- a/${path}` && patch[1] === `+++ b/${path}`, 'unexpected Windows patch target');
  const output = [];
  let cursor = 0, at = 2;
  while (at < patch.length && patch[at]) {
    const hunk = patch[at++].match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    assert(hunk, 'invalid Windows patch hunk');
    const start = Number(hunk[1]) - 1;
    assert(start >= cursor, 'overlapping Windows patch hunks');
    output.push(...original.slice(cursor, start));
    cursor = start;
    let removed = 0, added = 0;
    while (at < patch.length && !patch[at].startsWith('@@ ') && patch[at] !== '') {
      const line = patch[at++], kind = line[0], text = line.slice(1);
      assert([' ', '+', '-'].includes(kind), 'unsupported Windows patch operation');
      if (kind !== '+') {
        assert(original[cursor++] === text, 'Windows patch does not match exact upstream source');
        removed++;
      }
      if (kind !== '-') { output.push(text); added++; }
    }
    assert(removed === Number(hunk[2]) && added === Number(hunk[4]), 'Windows patch hunk counts differ');
  }
  output.push(...original.slice(cursor));
  const patched = Buffer.from(output.join('\n'));
  const tree = createHash('sha256');
  for (const item of entries) {
    assert(item.name.startsWith(pins.auth.prefix), 'Windows source prefix differs');
    const name = item.name.slice(pins.auth.prefix.length);
    tree.update(`${sha(name === path ? patched : item.data())}  ${name}\n`);
  }
  return { sha256: tree.digest('hex'), files: entries.length };
}

function validateProductMaterials(notice, installation) {
  const rights = notice.split('LGPL combined-work rights:')[1]?.split('\n\n')[0];
  assert(rights && /reverse[\s\S]*engineer/.test(rights) && /not restricted/.test(rights)
    && /recombine/.test(rights), 'product NOTICE lacks actual LGPL modification/reverse-engineering rights');
  for (const marker of ['### Modified native components: LGPL source and installation', 'BOOMBIGNOSE_BUNDLE',
    'BOOMBIGNOSE_DATA', 'auth/auth.exe', 'auth/auth', 'codesign --force --sign -', 'boombignose stop',
    'rollback', 'publisher key', 'third-party-notices/']) {
    assert(installation.includes(marker), `product LGPL installation material missing: ${marker}`);
  }
}

function validateWindowsWitness(witness, graph, binarySha256, entries, patchBytes, recipeBytes) {
  assert(witness.format === 1 && witness.component === graph.main.path && witness.version === pins.auth.version
    && witness.sourceCommit === pins.auth.commit, 'Windows build source identity differs');
  assert(witness.binarySha256 === binarySha256 && witness.toolchain === pins.windows.toolchain
    && graph.toolchain === pins.windows.toolchain, 'Windows binary/toolchain differs from build witness');
  assert(witness.patchSha256 === sha(patchBytes) && witness.recipeSha256 === sha(recipeBytes),
    'Windows build patch/recipe witness differs from tracked material');
  assert(JSON.stringify(buildGraph(witness.buildInfo)) === JSON.stringify(graph), 'Windows embedded build graph differs from witness');
  assert(graph.settings.GOOS === 'windows' && graph.settings.GOARCH === 'amd64'
    && graph.settings.CGO_ENABLED === '0' && graph.settings['-trimpath'] === 'true', 'Windows build target/flags differ');
  const source = windowsSourceTree(entries, patchBytes);
  assert(source.sha256 === witness.sourceTreeSha256 && source.files === witness.sourceFileCount,
    'Windows witness source tree differs from pinned Auth source plus tracked patch');
  return { sha256: binarySha256, sourceCommit: pins.auth.commit, sourceTreeSha256: source.sha256,
    target: 'windows/amd64', method: 'local-build-witness', status: 'pinned-source-build-witness' };
}

async function acquire(url, cachePath) {
  if (cachePath && existsSync(cachePath)) {
    assert(lstatSync(cachePath).isFile() && lstatSync(cachePath).size <= maxArchive, 'invalid cached source archive');
    return { bytes: readFileSync(cachePath), acquisition: 'local-cache', url };
  }
  assert(url.startsWith('https://'), 'source acquisition requires HTTPS');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert(response.ok && response.url.startsWith('https://'), `source acquisition failed: ${response.status} ${url}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert(length <= maxArchive, `source archive exceeds 128 MiB: ${url}`);
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), acquisition: 'https', url };
}

export async function collectAuthNotices(binaryOrRoot, destination) {
  let binary = resolve(binaryOrRoot);
  if (lstatSync(binary).isDirectory()) binary = join(binary, existsSync(join(binary, 'auth.exe')) ? 'auth.exe' : 'auth');
  assert(lstatSync(binary).isFile(), 'Auth binary missing');
  const dest = resolve(destination);
  assert(dest !== dirname(binary) && !binary.startsWith(`${dest}${sep}`), 'destination must not contain the input binary');
  assert(!existsSync(dest) || readdirSync(dest).length === 0, 'notice destination must be absent or empty');
  const info = command(['version', '-m', binary]);
  const graph = buildGraph(info);
  const cache = command(['env', 'GOMODCACHE']).trim();
  mkdirSync(dest, { recursive: true });
  const manifest = { format: 1, files: [], components: [], unresolved: [], sourceRequirements: [],
    binary: { sha256: sha(readFileSync(binary)), bytes: lstatSync(binary).size },
    graph, provenance: pins, scope: 'Conservative linked Go module inventory, including full module sources; not a whole-binary MIT certification.' };
  manifest.platform = { GOOS: graph.settings.GOOS, GOARCH: graph.settings.GOARCH };
  let outputBytes = 0;
  function put(path, bytes) {
    assert(safe(path), `unsafe output path: ${path}`);
    assert(!manifest.files.some((file) => file.path === path), `duplicate output path: ${path}`);
    outputBytes += bytes.length;
    assert(outputBytes <= 1024 * 1024 * 1024, 'Auth legal/source output exceeds 1 GiB');
    mkdirSync(dirname(join(dest, path)), { recursive: true });
    writeFileSync(join(dest, path), bytes);
    manifest.files.push({ path, sha256: sha(bytes), bytes: bytes.length });
    return path;
  }
  function notices(entries, prefix, target, skip = new Set()) {
    const found = [];
    for (const entry of entries) {
      assert(entry.name.startsWith(prefix), 'source archive prefix mismatch');
      const name = entry.name.slice(prefix.length);
      if (!skip.has(name) && name.split('/').some((part) => legal.test(part))) found.push(put(`${target}/${name}`, entry.data()));
    }
    return found;
  }
  put('evidence/go-version-m.txt', Buffer.from(info));
  put('evidence/notice-sources.json', readFileSync(join(here, 'notice-sources.json')));
  const productEvidence = [];
  try {
    const root = resolve(here, '../..');
    const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
    const bundle = readFileSync(join(root, 'docs/boombignose/BUNDLE.md'), 'utf8');
    const heading = '### Modified native components: LGPL source and installation';
    const start = bundle.indexOf(heading);
    assert(start >= 0 && (start === 0 || bundle[start - 1] === '\n')
      && /^\r?\n/.test(bundle.slice(start + heading.length)), 'product LGPL installation section absent');
    const bodyStart = bundle.indexOf('\n', start) + 1;
    const remainder = bundle.slice(bodyStart);
    const next = remainder.search(/^#{1,3} /m);
    const installation = bundle.slice(start, next < 0 ? bundle.length : bodyStart + next);
    validateProductMaterials(notice, installation);
    productEvidence.push(put('evidence/product-NOTICE.txt', Buffer.from(notice)),
      put('evidence/product-LGPL-installation.txt', Buffer.from(installation)));
    put('evidence/product-materials.json', Buffer.from(`${JSON.stringify({
      notice: { source: 'NOTICE', sha256: sha(Buffer.from(notice)) },
      installation: { source: 'docs/boombignose/BUNDLE.md', sourceSha256: sha(Buffer.from(bundle)),
        heading, sectionSha256: sha(Buffer.from(installation)) }
    }, null, 2)}\n`));
  } catch (error) {
    manifest.unresolved.push({ component: 'Auth LGPL product installation and rights', reason: error.message });
  }
  const originalRootLicense = readFileSync(join(here, 'AUTH_LICENSE.txt'));
  const rootNotice = 'external:packaging/auth/AUTH_LICENSE.txt';
  manifest.externalNotices = [{ path: 'packaging/auth/AUTH_LICENSE.txt', sha256: sha(originalRootLicense),
    bytes: originalRootLicense.length, distributionRequirement: 'Integration must carry its existing AUTH_LICENSE.txt beside the complete native notices.' }];
  let rootEntries;
  for (const [kind, pin] of [['auth', pins.auth], ['toolchain', pins.toolchain]]) {
    const record = { component: kind === 'auth' ? graph.main.path : 'Go toolchain and standard library', version: pin.version,
      source: null, notices: kind === 'auth' ? [rootNotice] : [] };
    manifest.components.push(record);
    try {
      if (kind === 'toolchain') assert(graph.toolchain === pin.version, `exact toolchain ${graph.toolchain} is not pinned; refusing a nearby-version license`);
      const acquired = await acquire(pin.url);
      assert(sha(acquired.bytes) === pin.sha256, `${kind} source SHA256 mismatch`);
      const entries = zipEntries(acquired.bytes);
      record.source = put(`sources/${kind}-${pin.version}.zip`, acquired.bytes);
      record.sourceSha256 = pin.sha256;
      record.provenance = { ...pin, acquisition: acquired.acquisition };
      if (kind === 'auth') {
        rootEntries = entries;
        const license = entries.find((entry) => entry.name === `${pin.prefix}LICENSE`);
        assert(license && lfBytes(license.data()).equals(lfBytes(originalRootLicense)),
          'original AUTH_LICENSE text does not match pinned source (CRLF-to-LF-only comparison)');
      }
      record.notices.push(...notices(entries, pin.prefix, `notices/${kind}`, kind === 'auth' ? new Set(['LICENSE']) : new Set()));
      assert(record.notices.length, `${kind} has no original notices`);
    } catch (error) { manifest.unresolved.push({ component: record.component, reason: error.message }); }
  }
  const versionSetting = graph.settings['-ldflags'] ?? '';
  if (!versionSetting.includes(`github.com/supabase/auth/internal/utilities.Version=${pins.auth.version}`)) {
    manifest.unresolved.push({ component: graph.main.path, reason: 'Binary lacks the pinned Auth version ldflag; acquired Auth source is candidate evidence only.' });
  }
  try {
    const target = `${graph.settings.GOOS}/${graph.settings.GOARCH}`;
    if (target === 'darwin/arm64') {
      const payload = signatureNormalizedMachO(readFileSync(binary));
      assert(payload.sha256 === pins.officialDarwinArm64.signatureNormalizedSha256
        && payload.bytes === pins.officialDarwinArm64.signatureNormalizedBytes, 'compiled payload differs from pinned official Darwin Auth release');
      manifest.binary.releaseCorrespondence = { ...payload, target, sourceCommit: pins.auth.commit, method: 'signature-normalized-MachO',
        normalization: pins.officialDarwinArm64.normalization, status: 'official-release-payload-identical' };
    } else if (graph.settings.GOOS === 'linux') {
      const release = pins.officialLinux[graph.settings.GOARCH];
      assert(release && manifest.binary.sha256 === release.binarySha256, 'Linux binary differs from its exact pinned official archive member');
      manifest.binary.releaseCorrespondence = { sha256: manifest.binary.sha256, target, sourceCommit: pins.auth.commit,
        method: 'full-byte-identity', archive: release.url, archiveSha256: release.archiveSha256, status: 'official-release-payload-identical' };
    } else if (target === 'windows/amd64') {
      assert(rootEntries, 'pinned Auth source unavailable for Windows source witness');
      const witnessBytes = readFileSync(join(dirname(binary), pins.windows.witness));
      const patchBytes = readFileSync(join(here, pins.windows.patch));
      const recipeBytes = readFileSync(join(here, 'build-windows.sh'));
      manifest.binary.releaseCorrespondence = validateWindowsWitness(JSON.parse(witnessBytes), graph,
        manifest.binary.sha256, rootEntries, patchBytes, recipeBytes);
      put('evidence/windows-build-provenance.json', witnessBytes);
      put('evidence/windows-no-reuseport.patch', patchBytes);
      put('evidence/build-windows.sh', recipeBytes);
    } else throw new Error(`no exact source correspondence for Auth target ${target}`);
  } catch (error) {
    manifest.unresolved.push({ component: graph.main.path,
      reason: `${error.message}; main/fork source is candidate evidence only until an exact release/build transformation chain is provided.` });
  }
  for (const module of graph.modules) {
    const record = { component: module.path, version: module.version, goSum: module.sum, replacement: module.replacement ?? null, notices: [], source: null };
    manifest.components.push(record);
    try {
      if (module.replacement?.path === './internal/forks/godotenv' && module.path === 'github.com/joho/godotenv') {
        assert(rootEntries, 'pinned Auth source unavailable for local fork');
        record.notices = manifest.files.filter((file) => file.path.startsWith('notices/auth/internal/forks/godotenv/')).map((file) => file.path);
        assert(record.notices.length, 'original local fork notice absent');
        record.source = `sources/auth-${pins.auth.version}.zip`;
        record.sourceSubdirectory = 'internal/forks/godotenv';
        record.sourceSha256 = pins.auth.sha256;
        record.provenanceStatus = manifest.binary.releaseCorrespondence?.status ?? 'candidate-only';
        continue;
      }
      const effective = module.replacement ?? module;
      assert(effective.sum?.startsWith('h1:') && effective.version !== '(devel)', 'module has no exact version/checksum; cannot substitute upstream or nearby source');
      const escaped = escapeModule(effective.path), version = escapeModule(effective.version);
      const url = `https://proxy.golang.org/${escaped}/@v/${version}.zip`;
      const acquired = await acquire(url, join(cache, 'cache/download', escaped, '@v', `${version}.zip`));
      const entries = zipEntries(acquired.bytes);
      const prefix = `${effective.path}@${effective.version}/`;
      const hash = createHash('sha256');
      for (const entry of entries) {
        assert(entry.name.startsWith(prefix) && !entry.name.includes('\n'), 'invalid Go module archive prefix/name');
        hash.update(`${sha(entry.data())}  ${entry.name}\n`);
      }
      assert(`h1:${hash.digest('base64')}` === effective.sum, `source contents do not match binary Go h1 checksum for ${effective.path}`);
      const target = `modules/${escapeModule(module.path).replaceAll('/', '+')}@${version}`;
      record.source = put(`sources/${target.slice(8)}.zip`, acquired.bytes);
      record.sourceSha256 = sha(acquired.bytes);
      record.provenance = { url, acquisition: acquired.acquisition, verifiedGoSum: effective.sum };
      record.notices = notices(entries, prefix, `notices/${target}`);
      assert(record.notices.length, 'no original license/copyright notice in exact module archive; SPDX and source URL are insufficient');
      const terms = record.notices.map((path) => readFileSync(join(dest, path), 'utf8')).join('\n');
      if (/GNU (?:LESSER |GENERAL )?GENERAL PUBLIC LICENSE|GNU LESSER GENERAL PUBLIC LICENSE|Mozilla Public License|Eclipse Public License/i.test(terms)) {
        const requirement = module.path === 'github.com/ethereum/go-ethereum'
          ? 'LGPL-3.0-or-later sections 4(d)(0) and 4(e): distribute the supplied exact library/application/fork/toolchain sources, original terms, recombination recipe, product modification/reverse-engineering rights and product installation/replacement information together with this platform binary.'
          : 'Distribute the exact MPL-covered module source archive with the binary under the original terms; source URL/SPDX alone is insufficient.';
        const status = module.path !== 'github.com/ethereum/go-ethereum' || (productEvidence.length === 2
          && manifest.binary.releaseCorrespondence && rootEntries
          && manifest.files.some((file) => file.path === 'sources/toolchain-go1.27.0.zip')) ? 'satisfied' : 'unresolved';
        manifest.sourceRequirements.push({ component: module.path, version: effective.version, source: record.source,
          status, requirement, evidence: [record.source, ...record.notices,
            'sources/auth-v2.197.0.zip', 'sources/toolchain-go1.27.0.zip', 'evidence/recombination.json',
            ...(module.path === 'github.com/ethereum/go-ethereum' ? productEvidence : []),
            ...(graph.settings.GOOS === 'windows' ? ['evidence/windows-build-provenance.json', 'evidence/windows-no-reuseport.patch', 'evidence/build-windows.sh'] : [])] });
        if (status === 'unresolved') manifest.unresolved.push({ component: module.path, reason: requirement });
      }
    } catch (error) { manifest.unresolved.push({ component: module.path, reason: error.message }); }
  }
  if (graph.modules.some((module) => module.path === 'github.com/ethereum/go-ethereum')
      && !manifest.sourceRequirements.some((requirement) => requirement.component === 'github.com/ethereum/go-ethereum')) {
    const requirement = 'Linked LGPL library source/terms acquisition failed; exact source and LGPL combined-work/relinking requirements remain open.';
    manifest.sourceRequirements.push({ component: 'github.com/ethereum/go-ethereum', status: 'unresolved',
      requirement, evidence: [] });
    manifest.unresolved.push({ component: 'github.com/ethereum/go-ethereum', reason: requirement });
  }
  put('evidence/combined-work-notice.txt', Buffer.from(
    'This Supabase Auth binary uses the go-ethereum library, which and whose use are covered by the GNU Lesser General Public License, version 3 or later. Original copyright notices and the complete GNU GPL and LGPL texts accompany the exact go-ethereum source archive and extracted notices. This is not a whole-binary MIT license statement.\n'));
  put('evidence/recombination.json', Buffer.from(`${JSON.stringify({
    format: 1, platform: { GOOS: graph.settings.GOOS, GOARCH: graph.settings.GOARCH, CGO_ENABLED: graph.settings.CGO_ENABLED },
    sourceCommit: pins.auth.commit, sourceArchive: 'sources/auth-v2.197.0.zip',
    libraryArchive: 'sources/github.com+ethereum+go-ethereum@v1.17.0.zip',
    toolchainArchive: 'sources/toolchain-go1.27.0.zip', toolchainVersion: graph.toolchain,
    originalBuildRecipe: graph.settings.GOOS === 'windows' ? 'evidence/build-windows.sh plus the tracked portability patch'
      : `${pins.auth.prefix}Makefile (BUILD_CMD and auth-${graph.settings.GOOS === 'darwin' ? 'darwin-arm64' : `${graph.settings.GOARCH}-strip`} target)`,
    commandsInExtractedAuthSource: [
      'go version # use the supplied go1.27.0 source/toolchain, not the collector host Go version',
      ...(graph.settings.GOOS === 'windows' ? ['patch -p1 < /absolute/path/to/evidence/windows-no-reuseport.patch'] : []),
      'go mod edit -replace github.com/ethereum/go-ethereum=/absolute/path/to/your/modified/go-ethereum',
      `CGO_ENABLED=0 GOOS=${graph.settings.GOOS} GOARCH=${graph.settings.GOARCH} GOTOOLCHAIN=local go build -buildvcs=false ${graph.settings.GOOS === 'windows' ? '-trimpath ' : ''}-ldflags "-X github.com/supabase/auth/internal/utilities.Version=v2.197.0${graph.settings.GOOS === 'linux' ? ' -s' : ''}" -o rebuilt-auth${graph.settings.GOOS === 'windows' ? '.exe' : ''} .`,
      ...(graph.settings.GOOS === 'darwin' ? ['codesign --force --sign - rebuilt-auth'] : [])
    ],
    dependencySources: 'All linked versioned module ZIPs are included and verified against the actual binary h1 sums. The Auth source archive includes its original go.mod/go.sum and the locally replaced internal/forks/godotenv. A source user may extract/modify these sources and supply local Go module replacements; do not substitute upstream godotenv for the bundled fork.',
    acquisition: 'The commands are provided as source-recombination instructions derived from the original Makefile, not executed by this collector. Standard Go metadata/dependency acquisition, if needed by the rebuilder, is build-time only and must respect original go.sum.',
    productMaterials: productEvidence,
    deliveryStatus: 'Distribute the complete source/notice tree and the copied product rights/installation materials with this platform binary. The external private-runtime route needs no publisher key or changed installed application. Recombination commands are recorded source instructions, not a claim that a modified build or runtime was exercised.'
  }, null, 2)}\n`));
  manifest.files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  writeFileSync(join(dest, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function auditAuthNotices(destination, binaryOrRoot) {
  const dest = resolve(destination);
  const manifest = JSON.parse(readFileSync(join(dest, 'index.json'), 'utf8'));
  assert(manifest.format === 1 && Array.isArray(manifest.files) && Array.isArray(manifest.components)
    && Array.isArray(manifest.unresolved) && Array.isArray(manifest.sourceRequirements), 'invalid Auth manifest');
  const seen = new Set();
  for (const file of manifest.files) {
    assert(safe(file.path) && !seen.has(file.path), 'unsafe/duplicate Auth notice path');
    seen.add(file.path);
    const path = join(dest, file.path);
    assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `invalid Auth notice file: ${file.path}`);
    const bytes = readFileSync(path);
    assert(bytes.length === file.bytes && sha(bytes) === file.sha256, `Auth notice hash/size mismatch: ${file.path}`);
  }
  const graph = buildGraph(readFileSync(join(dest, 'evidence/go-version-m.txt'), 'utf8'));
  assert(manifest.components.length === graph.modules.length + 2, 'Auth linked component inventory incomplete');
  for (const module of graph.modules) {
    const record = manifest.components.find((component) => component.component === module.path);
    assert(record?.version === module.version && record.goSum === module.sum, `Auth linked module identity mismatch: ${module.path}`);
  }
  if (graph.modules.some((module) => module.path === 'github.com/ethereum/go-ethereum')) {
    assert(manifest.sourceRequirements.some((item) => item.component === 'github.com/ethereum/go-ethereum'),
      'linked LGPL library source/relinking duty missing from Auth manifest');
  }
  const external = manifest.externalNotices?.find((notice) => notice.path === 'packaging/auth/AUTH_LICENSE.txt');
  const original = readFileSync(join(here, 'AUTH_LICENSE.txt'));
  assert(external?.sha256 === sha(original) && external.bytes === original.length, 'existing root AUTH_LICENSE provenance missing/changed');
  for (const component of manifest.components) {
    assert(component.source && seen.has(component.source) && component.notices.length > 0
      && component.notices.every((path) => seen.has(path) || path === 'external:packaging/auth/AUTH_LICENSE.txt'), `Auth original source/notice incomplete: ${component.component}`);
  }
  assert.equal(manifest.unresolved.length, 0, `Auth attribution/source unresolved: ${manifest.unresolved.map((item) => `${item.component}: ${item.reason}`).join('; ')}`);
  assert(manifest.sourceRequirements.every((item) => item.status === 'satisfied' && item.evidence.length > 0
    && item.evidence.every((path) => seen.has(path))),
    `Auth source/relinking requirements unresolved: ${manifest.sourceRequirements.filter((item) => item.status !== 'satisfied').map((item) => `${item.component}: ${item.requirement}`).join('; ')}`);
  validateProductMaterials(readFileSync(join(dest, 'evidence/product-NOTICE.txt'), 'utf8'),
    readFileSync(join(dest, 'evidence/product-LGPL-installation.txt'), 'utf8'));
  const correspondence = manifest.binary.releaseCorrespondence;
  const target = `${graph.settings.GOOS}/${graph.settings.GOARCH}`;
  assert(correspondence?.target === target && correspondence.sourceCommit === pins.auth.commit, 'Auth target/source correspondence absent');
  let actualBytes;
  if (binaryOrRoot !== undefined) {
    let actual = resolve(binaryOrRoot);
    if (lstatSync(actual).isDirectory()) actual = join(actual, graph.settings.GOOS === 'windows' ? 'auth.exe' : 'auth');
    assert(lstatSync(actual).isFile(), 'staged Auth binary missing or not a regular file');
    actualBytes = readFileSync(actual);
  }
  if (target === 'darwin/arm64') {
    assert(correspondence.sha256 === pins.officialDarwinArm64.signatureNormalizedSha256
      && correspondence.bytes === pins.officialDarwinArm64.signatureNormalizedBytes, 'Auth Darwin payload correspondence differs');
    if (actualBytes) {
      const actual = signatureNormalizedMachO(actualBytes);
      assert(actual.sha256 === correspondence.sha256 && actual.bytes === correspondence.bytes,
        'staged Auth Darwin payload differs from collected source correspondence');
    }
  } else if (graph.settings.GOOS === 'linux') {
    assert(correspondence.method === 'full-byte-identity'
      && manifest.binary.sha256 === pins.officialLinux[graph.settings.GOARCH]?.binarySha256,
    'Auth Linux full-byte correspondence differs');
    if (actualBytes) assert(sha(actualBytes) === manifest.binary.sha256,
      'staged Auth Linux bytes differ from collected source correspondence');
  } else if (target === 'windows/amd64') {
    if (actualBytes) assert(sha(actualBytes) === manifest.binary.sha256,
      'staged Auth Windows bytes differ from collected build witness');
    validateWindowsWitness(JSON.parse(readFileSync(join(dest, 'evidence/windows-build-provenance.json'), 'utf8')), graph,
      manifest.binary.sha256, zipEntries(readFileSync(join(dest, 'sources/auth-v2.197.0.zip'))),
      readFileSync(join(dest, 'evidence/windows-no-reuseport.patch')), readFileSync(join(dest, 'evidence/build-windows.sh')));
  } else throw new Error(`Auth target has no exact source proof: ${target}`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, input, destination] = process.argv.slice(2);
    if (mode === 'collect' && input && destination) {
      const manifest = await collectAuthNotices(input, destination);
      console.log(JSON.stringify({ files: manifest.files.length, components: manifest.components.length,
        unresolved: manifest.unresolved, sourceRequirements: manifest.sourceRequirements }));
    } else if (mode === 'audit' && input && !destination) {
      const manifest = auditAuthNotices(input);
      console.log(`Auth notices audited: ${manifest.components.length} components`);
    } else throw new Error('usage: collect-notices.mjs collect BINARY_OR_ROOT DEST | audit DEST');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
