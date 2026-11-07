#!/usr/bin/env node
// Build-time only: original source archives and original legal texts, never SPDX substitutes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const slash = (path) => path.split(sep).join('/');
const legalName = /(?:^|[\/._-])(?:licen[cs]es?|copying|notices?|copyright|patents|authors|legal)(?:[\/._-]|$)/i;
const limits = { archive: 512 * 1024 * 1024, total: 4 * 1024 * 1024 * 1024, text: 8 * 1024 * 1024, entries: 200000, components: 1000 };
const digest = /^[a-f0-9]{64}$/;
// The compiler already emits LC_CODE_SIGNATURE. Re-signing may resize only
// that terminal blob and __LINKEDIT. Preserve command counts, install names,
// rpaths, all other load commands, and every byte of executable code/data.
function binaryIdentity(bytes) {
  const identity = { sha256: sha(bytes), bytes: bytes.length };
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) return identity;
  assert.equal(bytes.readUInt32LE(4), 0x0100000c, 'only arm64 Darwin signing normalization is supported');
  const normalized = Buffer.from(bytes);
  const count = bytes.readUInt32LE(16), commandEnd = 32 + bytes.readUInt32LE(20);
  assert(count <= 1024 && commandEnd <= bytes.length, 'invalid Mach-O load commands');
  let at = 32, signature, linkedit;
  for (let i = 0; i < count; i++) {
    assert(at + 8 <= commandEnd, 'truncated Mach-O load command');
    const cmd = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 4);
    assert(size >= 8 && at + size <= commandEnd, 'invalid Mach-O load command size');
    if (cmd === 0x1d) {
      assert(!signature && size === 16, 'invalid/duplicate Mach-O signature command');
      signature = { offset: bytes.readUInt32LE(at + 8), bytes: bytes.readUInt32LE(at + 12) };
      normalized.fill(0, at + 8, at + 16);
    }
    if (cmd === 0x19 && bytes.subarray(at + 8, at + 24).toString('ascii').replace(/\0.*$/s, '') === '__LINKEDIT') {
      assert(!linkedit && size === 72, 'invalid/duplicate Mach-O LINKEDIT segment');
      linkedit = { offset: Number(bytes.readBigUInt64LE(at + 40)), bytes: Number(bytes.readBigUInt64LE(at + 48)) };
      normalized.fill(0, at + 32, at + 40);
      normalized.fill(0, at + 48, at + 56);
    }
    at += size;
  }
  assert(at === commandEnd && signature && linkedit && signature.offset >= commandEnd && signature.offset >= linkedit.offset
    && signature.offset + signature.bytes === bytes.length && linkedit.offset + linkedit.bytes === bytes.length,
  'Mach-O signature must be terminal LINKEDIT data');
  return { ...identity, signingNormalization: {
    method: 'arm64-MachO-terminal-signature-v1',
    description: 'Exclude terminal LC_CODE_SIGNATURE blob; zero its dataoff/datasize and __LINKEDIT vmsize/filesize only. All other bytes, including load paths and command counts, remain covered.',
    sha256: sha(normalized.subarray(0, signature.offset)), bytes: signature.offset,
  } };
}
function sourceDuties(license) {
  if (!/(?:^|[^A-Za-z])(?:A?GPL|LGPL|MPL|EPL|CDDL)(?:[^A-Za-z]|$)/i.test(license)) return [];
  return /(?:MPL|EPL|CDDL)/i.test(license) && !/(?:A?GPL|LGPL)/i.test(license)
    ? ['build-recipe'] : ['build-recipe', 'recombination-instructions', 'installation-information', 'relinkable-objects'];
}
function validateRealizedPlan(inputs, plan) {
  assert(Array.isArray(plan['install-plan']) && plan['compiler-id'], 'realized package material is not an actual Cabal plan');
  const packages = new Map(plan['install-plan'].map((item) => [item.id, item]));
  const components = new Map(inputs.components.map((item) => [item.id, item]));
  const executables = plan['install-plan'].filter((item) => item['pkg-name'] === 'postgrest' && item['component-name'] === 'exe:postgrest');
  assert.equal(executables.length, 1, 'realized plan must identify one actual PostgREST executable');
  const reachable = new Set();
  function visit(id) {
    if (reachable.has(id)) return;
    const pkg = packages.get(id);
    const component = components.get(id);
    assert(pkg && component && inputs.runtimeClosure.includes(id), `realized executable dependency has no source closure: ${id}`);
    reachable.add(id);
    assert.equal(component.name, pkg['pkg-name'], `realized package name mismatch: ${id}`);
    assert.equal(component.version, pkg['pkg-version'], `realized package version mismatch: ${id}`);
    if (pkg['pkg-src-sha256']) assert.equal(component.source.sha256, pkg['pkg-src-sha256'], `source archive is not the realized package: ${id}`);
    if (pkg['pkg-cabal-sha256']) assert.equal(component.cabalFile?.sha256, pkg['pkg-cabal-sha256'], `revised Cabal file is not the realized package: ${id}`);
    for (const dependency of pkg.depends ?? []) {
      assert(component.dependencies.includes(dependency), `realized dependency edge missing: ${id}/${dependency}`);
      visit(dependency);
    }
  }
  visit(executables[0].id);
}

function inside(root, path) {
  assert(typeof path === 'string' && path && !isAbsolute(path), `expected relative evidence path: ${path}`);
  const result = resolve(root, path);
  assert(result.startsWith(`${resolve(root)}${sep}`), `evidence path escapes root: ${path}`);
  return result;
}
function sourcePath(root, path) {
  const result = inside(root, path);
  assert(realpathSync(result).startsWith(`${realpathSync(root)}${sep}`), `source symlink escapes build root: ${path}`);
  return result;
}
function checked(path, expected, maximum = limits.archive) {
  assert(digest.test(expected), `missing exact SHA256: ${path}`);
  assert(statSync(path).isFile() && statSync(path).size > 0 && statSync(path).size <= maximum, `empty/oversized source: ${path}`);
  const bytes = readFileSync(path);
  assert.equal(sha(bytes), expected, `source checksum mismatch: ${path}`);
  return bytes;
}
async function acquire(source, root, cache) {
  assert(source && digest.test(source.sha256), 'source requires exact SHA256, not a version or URL alone');
  if (source.path && existsSync(inside(root, source.path))) return sourcePath(root, source.path);
  assert(typeof source.url === 'string' && new URL(source.url).protocol === 'https:', 'missing HTTPS original source acquisition URL');
  const output = join(cache, source.sha256);
  if (existsSync(output)) { checked(output, source.sha256); return output; }
  const response = await fetch(source.url, { signal: AbortSignal.timeout(180000), redirect: 'follow' });
  assert(response.ok, `source fetch failed (${response.status}): ${source.url}`);
  assert(new URL(response.url).protocol === 'https:', 'source download redirected away from HTTPS');
  const declared = Number(response.headers.get('content-length'));
  assert(!declared || declared <= limits.archive, `source download is too large: ${source.url}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limits.archive) throw new Error(`source exceeded bounded download: ${source.url}`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert(bytes.length > 0 && sha(bytes) === source.sha256, `download checksum mismatch: ${source.url}`);
  writeFileSync(output, bytes, { flag: 'wx' });
  return output;
}
function tar(archive, args, maximum) {
  const result = spawnSync('tar', [...args, archive], { encoding: null, maxBuffer: maximum, timeout: 120000 });
  assert(!result.error && result.status === 0, `cannot read original source archive: ${archive}: ${result.error?.message ?? result.stderr?.toString()}`);
  return result.stdout;
}
function archiveEntries(archive) {
  const entries = tar(archive, ['-tf'], 32 * 1024 * 1024).toString('utf8').split('\n').filter(Boolean);
  assert(entries.length > 0 && entries.length <= limits.entries, 'source archive entry bound exceeded');
  for (const path of entries) {
    assert(!path.includes('\\') && !path.startsWith('/') && !path.split('/').includes('..') && !/[\r\0]/.test(path), `unsafe archive member: ${path}`);
  }
  return [...new Set(entries)];
}
function archiveRead(archive, path, allowEmpty = false) {
  const result = spawnSync('tar', ['-xOf', archive, '--', path], { encoding: null, maxBuffer: limits.text, timeout: 120000 });
  assert(!result.error && result.status === 0 && (allowEmpty || result.stdout.length > 0), `cannot read source member ${path}: ${result.error?.message ?? result.stderr?.toString()}`);
  return result.stdout;
}
function cabalFields(bytes) {
  const fields = {};
  let field;
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (/^\s*--/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line);
    if (match) { field = match[1].toLowerCase(); fields[field] = match[2]; }
    else if (/^\s+\S/.test(line) && field) fields[field] += ` ${line.trim()}`;
    else if (!/^\s*(?:--.*)?$/.test(line)) field = undefined;
  }
  return fields;
}
function walk(root, at = root) {
  return readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap((entry) => {
    const path = join(at, entry.name);
    assert(!entry.isSymbolicLink(), `notice output must not contain symlinks: ${path}`);
    return entry.isDirectory() ? walk(root, path) : [slash(relative(root, path))];
  });
}

// The builder records noticeInputs in build-provenance.json after resolving the actual
// executable graph. Each source is pinned; boot libraries can share the GHC archive
// with an exact sourceSubdirectory. Materials carry their own hash and role.
export async function collectPostgrestNotices(buildRoot, destination) {
  const root = resolve(buildRoot);
  const dest = resolve(destination);
  assert(root !== dest && !root.startsWith(`${dest}${sep}`) && !dest.startsWith(`${root}${sep}`), 'notice output must be separate from build/source inputs');
  mkdirSync(dest, { recursive: true });
  assert(readdirSync(dest).length === 0, 'refusing to overwrite an existing notice output');
  const provenancePath = join(root, 'build-provenance.json');
  const provenance = json(provenancePath);
  const inputs = provenance.noticeInputs;
  assert(inputs && Array.isArray(inputs.components) && inputs.components.length > 0 && inputs.components.length <= limits.components,
    'builder has not supplied its realized, source-pinned noticeInputs.components');
  assert(Array.isArray(inputs.runtimeClosure) && inputs.runtimeClosure.length > 0, 'missing realized linked package closure');
  assert(Array.isArray(inputs.materials), 'missing realized build/recombination materials');
  const cache = join(root, 'notice-source-cache');
  mkdirSync(cache, { recursive: true });
  const manifest = { format: 1, files: [], components: [], unresolved: [], sourceRequirements: [] };
  let total = 0;
  const written = new Map();
  function put(path, bytes) {
    const target = inside(dest, path);
    if (written.has(path)) { assert.equal(written.get(path), sha(bytes), `conflicting output: ${path}`); return path; }
    total += bytes.length;
    assert(bytes.length > 0 && total <= limits.total, 'notice/source output exceeded 4 GiB bound');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
    const record = { path: slash(path), sha256: sha(bytes), bytes: bytes.length };
    written.set(path, record.sha256);
    manifest.files.push(record);
    return record.path;
  }
  const proof = put('provenance/build-provenance.json', readFileSync(provenancePath));
  const materials = [];
  for (const item of inputs.materials) {
    assert(typeof item.role === 'string' && item.role, 'build material requires a role');
    const bytes = checked(sourcePath(root, item.path), item.sha256);
    materials.push({ ...item, path: put(`materials/${item.sha256}/${basename(item.path)}`, bytes) });
  }
  assert(materials.some((item) => item.role === 'realized-package-plan'), 'missing exact realized package plan material');
  const realizedPlans = inputs.materials.filter((item) => item.role === 'realized-package-plan');
  assert.equal(realizedPlans.length, 1, 'expected one exact realized Cabal package plan');
  validateRealizedPlan(inputs, json(sourcePath(root, realizedPlans[0].path)));
  const artifact = provenance.artifact;
  assert(artifact?.path && digest.test(artifact.sha256), 'missing exact built executable identity');
  manifest.binary = binaryIdentity(checked(sourcePath(root, artifact.path), artifact.sha256));
  assert(materials.some((item) => item.role === 'native-link-audit'), 'missing native link audit evidence');
  const ids = new Set(inputs.components.map((component) => component.id));
  assert(ids.size === inputs.components.length && [...ids].every((id) => typeof id === 'string' && id), 'duplicate/missing source component identifiers');
  for (const id of inputs.runtimeClosure) assert(ids.has(id), `linked component has no exact source: ${id}`);
  const sources = new Map();
  for (const component of [...inputs.components].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    assert(component.name && component.version && component.kind && component.license, `incomplete component identity: ${component.id}`);
    assert(Array.isArray(component.dependencies), `missing realized dependency edges: ${component.id}`);
    for (const id of component.dependencies) assert(ids.has(id), `source closure misses dependency ${id} of ${component.id}`);
    const source = component.source;
    let archive = sources.get(source?.sha256);
    if (!archive) {
      archive = await acquire(source, root, cache);
      const bytes = checked(archive, source.sha256);
      const filename = source.filename ?? (source.path ? basename(source.path) : basename(new URL(source.url).pathname));
      assert(/\.(?:tar\.(?:gz|xz|bz2)|tgz|tar)$/.test(filename), `source must be an original full tar archive: ${component.id}`);
      assert.equal(filename, basename(filename), `source archive filename is not a basename: ${component.id}`);
      const target = put(`sources/original/${source.sha256}/${filename}`, bytes);
      archive = { path: archive, output: target, entries: archiveEntries(archive) };
      sources.set(source.sha256, archive);
    }
    const prefix = component.sourceSubdirectory ?? '';
    assert(!prefix.startsWith('/') && !prefix.split('/').includes('..') && !prefix.includes('\\'), `invalid source subdirectory: ${component.id}`);
    const entries = archive.entries.filter((path) => !path.endsWith('/') && (!prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`)));
    assert(entries.length > 0, `source subdirectory missing for ${component.id}`);
    const inherited = component.noticePaths ?? [];
    assert(Array.isArray(inherited) && inherited.every((path) => archive.entries.includes(path) && !path.endsWith('/')), `inherited original notice absent: ${component.id}`);
    let fields;
    let revisedCabal;
    if (component.cabalFile) {
      const path = await acquire(component.cabalFile, root, cache);
      const bytes = checked(path, component.cabalFile.sha256, limits.text);
      fields = cabalFields(bytes);
      revisedCabal = put(`metadata/cabal/${component.cabalFile.sha256}/${component.name}.cabal`, bytes);
    } else if (component.kind === 'haskell' || component.kind === 'application') {
      const cabals = entries.filter((path) => basename(path) === `${component.name}.cabal`);
      assert(cabals.length === 1, `ambiguous/missing exact cabal metadata: ${component.id}`);
      fields = cabalFields(archiveRead(archive.path, cabals[0]));
    }
    if (fields) {
      assert.equal(fields.name?.toLowerCase(), component.name.toLowerCase(), `source package name mismatch: ${component.id}`);
      assert.equal(fields.version, component.version, `source package version mismatch: ${component.id}`);
      assert.equal(fields.license, component.license, `source license metadata mismatch: ${component.id}`);
    }
    const declared = new Set((fields?.['license-files'] ?? fields?.['license-file'] ?? '').match(/(?:"[^"]+"|[^\s,]+)/g)?.map((path) => path.replace(/^"|"$/g, '')) ?? []);
    for (const name of declared) assert(entries.some((path) => path === name || path.endsWith(`/${name}`)), `declared original license missing: ${component.id}/${name}`);
    const candidates = [...new Set([...entries.filter((path) => legalName.test(path) || [...declared].some((name) => path === name || path.endsWith(`/${name}`))), ...inherited])];
    const notices = [];
    const originalLicensePaths = [];
    for (const path of candidates.sort()) {
      const bytes = archiveRead(archive.path, path, true);
      if (bytes.length === 0) {
        assert(![...declared].some((name) => path === name || path.endsWith(`/${name}`)) && !inherited.includes(path), `declared/inherited original legal text is empty: ${component.id}/${path}`);
        continue; // Empty upstream test fixtures are not license evidence.
      }
      originalLicensePaths.push(path);
      assert(bytes.length <= limits.text, `oversized legal text: ${component.id}/${path}`);
      // PostgREST's existing tracked original license is the single application text.
      if (component.kind === 'application' && component.name.toLowerCase() === 'postgrest' && basename(path) === 'LICENSE') {
        const tracked = readFileSync(join(here, 'POSTGREST_LICENSE.txt'));
        assert.equal(sha(bytes), sha(tracked), 'tracked PostgREST license differs from exact upstream source');
        notices.push(put('notices/postgrest/POSTGREST_LICENSE.txt', tracked));
      } else notices.push(put(`notices/${encodeURIComponent(component.id)}/${path}`, bytes));
    }
    const hasLicense = originalLicensePaths.some((path) => /(?:^|[\/._-])(?:licen[cs]es?|copying|copyright)(?:[\/._-]|$)/i.test(path)
      || [...declared].some((name) => path === name || path.endsWith(`/${name}`)));
    if (!hasLicense) manifest.unresolved.push({ component: component.id, reason: 'Exact original archive contains no original full copyright/license text; AUTHORS or metadata alone is insufficient.' });
    const record = { ...component, source: { ...source, path: archive.output }, notices, ...(revisedCabal ? { cabalFile: { ...component.cabalFile, path: revisedCabal } } : {}) };
    manifest.components.push(record);
    manifest.sourceRequirements.push({ component: component.id, requirement: 'Exact original corresponding source archive, including original copyright/license texts', status: hasLicense ? 'satisfied' : 'unresolved', evidence: [archive.output, ...notices] });
  }
  // Static LGPL/GPL recombination is not discharged by an SPDX string or web URL.
  for (const component of manifest.components) {
    for (const role of sourceDuties(component.license)) {
      const evidence = materials.filter((item) => item.role === role).map((item) => item.path);
      const requirement = { component: component.id, requirement: role, status: evidence.length ? 'satisfied' : 'unresolved', evidence };
      manifest.sourceRequirements.push(requirement);
      if (!evidence.length) manifest.unresolved.push({ component: component.id, reason: `Missing actual ${role}; source URLs alone do not discharge static-link/source duties.` });
    }
  }
  manifest.provenance = { build: proof, artifact: { ...artifact }, runtimeClosure: inputs.runtimeClosure, materials };
  manifest.files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  writeFileSync(join(dest, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  assert.equal(manifest.unresolved.length, 0, `PostgREST source/notices unresolved; see ${join(dest, 'index.json')}`);
  return manifest;
}

export function auditPostgrestNotices(destination, actualBinary) {
  const dest = resolve(destination);
  const manifest = json(join(dest, 'index.json'));
  assert.equal(manifest.format, 1, 'unsupported PostgREST notice manifest');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.components?.length > 0, 'empty PostgREST notice closure');
  assert(Array.isArray(manifest.unresolved) && manifest.unresolved.length === 0, 'PostgREST notice/source duties are unresolved');
  assert(manifest.sourceRequirements?.length > 0 && manifest.sourceRequirements.every((item) => item.status === 'satisfied' && item.evidence?.length > 0), 'unmet PostgREST source requirement');
  const files = new Map();
  for (const file of manifest.files) {
    assert(!files.has(file.path), `duplicate notice file: ${file.path}`);
    const bytes = checked(sourcePath(dest, file.path), file.sha256, limits.archive);
    assert.equal(bytes.length, file.bytes, `notice/source byte length mismatch: ${file.path}`);
    files.set(file.path, file);
  }
  assert.deepEqual(walk(dest).filter((path) => path !== 'index.json').sort(), [...files.keys()].sort(), 'unindexed or missing notice/source material');
  const proof = json(inside(dest, manifest.provenance.build));
  assert.deepEqual(manifest.provenance.artifact, proof.artifact, 'notice artifact identity differs from build provenance');
  assert.deepEqual(manifest.provenance.runtimeClosure, proof.noticeInputs.runtimeClosure, 'notice graph differs from actual build');
  assert.equal(manifest.provenance.materials.length, proof.noticeInputs.materials.length, 'build material count differs from actual provenance');
  for (const material of manifest.provenance.materials) {
    assert(files.get(material.path)?.sha256 === material.sha256, `build material is absent or changed: ${material.path}`);
    assert(proof.noticeInputs.materials.some((item) => item.sha256 === material.sha256 && item.role === material.role), `build material role differs from actual provenance: ${material.path}`);
  }
  for (const role of ['realized-package-plan', 'native-link-audit']) assert(manifest.provenance.materials.some((item) => item.role === role), `required build evidence absent: ${role}`);
  const realizedPlans = manifest.provenance.materials.filter((item) => item.role === 'realized-package-plan');
  assert.equal(realizedPlans.length, 1, 'missing exact realized Cabal plan');
  validateRealizedPlan({ components: manifest.components, runtimeClosure: manifest.provenance.runtimeClosure }, json(inside(dest, realizedPlans[0].path)));
  const ids = new Set(manifest.components.map((component) => component.id));
  assert.equal(ids.size, manifest.components.length, 'duplicate component identity');
  assert.equal(manifest.components.length, proof.noticeInputs.components.length, 'source component count differs from actual build');
  for (const id of manifest.provenance.runtimeClosure) assert(ids.has(id), `missing linked source component: ${id}`);
  for (const component of manifest.components) {
    const original = proof.noticeInputs.components.find((item) => item.id === component.id);
    assert(original, `component absent from realized build: ${component.id}`);
    for (const key of ['name', 'version', 'kind', 'license', 'dependencies', 'sourceSubdirectory', 'noticePaths']) assert.deepEqual(component[key], original[key], `component ${key} differs from realized build: ${component.id}`);
    assert.equal(component.source.sha256, original.source.sha256, `source pin differs from realized build: ${component.id}`);
    assert(files.has(component.source.path) && files.get(component.source.path).sha256 === component.source.sha256, `missing exact original source: ${component.id}`);
    assert(component.notices?.length > 0 && component.notices.every((path) => files.has(path)), `missing original texts: ${component.id}`);
    for (const dependency of component.dependencies) assert(ids.has(dependency), `missing dependency source: ${dependency}`);
    if (component.cabalFile) assert(files.get(component.cabalFile.path)?.sha256 === component.cabalFile.sha256, `missing exact revised cabal: ${component.id}`);
    assert(manifest.sourceRequirements.some((item) => item.component === component.id && item.evidence.includes(component.source.path)), `missing exact source requirement: ${component.id}`);
    for (const role of sourceDuties(component.license)) {
      const evidence = manifest.provenance.materials.filter((item) => item.role === role).map((item) => item.path);
      assert(evidence.length > 0 && manifest.sourceRequirements.some((item) => item.component === component.id && item.requirement === role && evidence.every((path) => item.evidence.includes(path))), `missing copyleft evidence: ${component.id}/${role}`);
    }
  }
  for (const requirement of manifest.sourceRequirements) for (const path of requirement.evidence) assert(files.has(path), `source duty evidence absent: ${path}`);
  assert.equal(manifest.binary?.sha256, proof.artifact.sha256, 'binary identity is not tied to the built source artifact');
  if (actualBinary !== undefined) {
    const bytes = readFileSync(resolve(actualBinary));
    const identity = binaryIdentity(bytes);
    if (identity.sha256 !== proof.artifact.sha256) {
      const expected = manifest.binary.signingNormalization;
      const actual = identity.signingNormalization;
      assert(expected && actual && expected.method === actual.method && expected.sha256 === actual.sha256 && expected.bytes === actual.bytes,
        'actual staged PostgREST differs from the source-built artifact beyond documented signing metadata');
    } else assert.equal(identity.bytes, manifest.binary.bytes, 'actual PostgREST byte length differs');
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, input, destination, ...extra] = process.argv.slice(2);
    assert(extra.length === 0, 'usage: collect-notices.mjs collect BUILD_ROOT DEST | audit DEST');
    const result = command === 'collect' && input && destination ? await collectPostgrestNotices(input, destination)
      : command === 'audit' && input && !destination ? auditPostgrestNotices(input) : assert.fail('usage: collect-notices.mjs collect BUILD_ROOT DEST | audit DEST');
    console.log(JSON.stringify({ components: result.components.length, files: result.files.length, unresolved: result.unresolved.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
