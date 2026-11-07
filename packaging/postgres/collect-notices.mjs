#!/usr/bin/env node
// Build-time only. Never executes PostgreSQL, changes its libraries, or infers
// corresponding-source compliance from an SPDX identifier or an upstream URL.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, 'source-closure.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const platforms = new Set(['darwin-arm64', 'linux-x64', 'win32-x64']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (path) => path.split(sep).join('/');
const outside = (root, path) => { const r = relative(root, path); return r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r); };
const safePath = (root, path) => {
  assert(typeof path === 'string' && path && !isAbsolute(path), 'relative notice path required');
  const result = resolve(root, path);
  assert(!outside(root, result) && result !== root, `notice path escapes root: ${path}`);
  return result;
};

// Signing changes the fat slice size, LC_CODE_SIGNATURE and __LINKEDIT size.
// Every other byte before the signature (including all code/data/load commands)
// remains covered. This does not normalize arbitrary install-name changes.
function machOSlices(data) {
  const slices = [];
  if (data.length >= 8 && data.readUInt32BE(0) === 0xcafebabe) {
    const count = data.readUInt32BE(4);
    assert(count > 0 && count <= 8 && 8 + count * 20 <= data.length, 'invalid universal Mach-O');
    for (let i = 0; i < count; i++) {
      const at = 8 + i * 20;
      const offset = data.readUInt32BE(at + 8);
      const size = data.readUInt32BE(at + 12);
      assert(offset >= 8 + count * 20 && size >= 32 && offset + size <= data.length, 'invalid Mach-O slice bounds');
      slices.push({ cpu: data.readUInt32BE(at), subtype: data.readUInt32BE(at + 4), data: data.subarray(offset, offset + size) });
    }
  } else slices.push({ cpu: 0, subtype: 0, data });
  return slices.map(({ cpu, subtype, data: slice }) => {
    assert(slice.length >= 32 && slice.readUInt32LE(0) === 0xfeedfacf, 'only pinned 64-bit Darwin Mach-O payloads are supported');
    const normalized = Buffer.from(slice);
    const count = slice.readUInt32LE(16);
    const commandsEnd = 32 + slice.readUInt32LE(20);
    assert(count <= 1000 && commandsEnd <= slice.length, 'invalid Mach-O load commands');
    let at = 32;
    let end = slice.length;
    let signatureSeen = false;
    for (let i = 0; i < count; i++) {
      assert(at + 8 <= commandsEnd, 'truncated Mach-O command');
      const command = slice.readUInt32LE(at);
      const size = slice.readUInt32LE(at + 4);
      assert(size >= 8 && at + size <= commandsEnd, 'invalid Mach-O command bounds');
      if (command === 0x1d) {
        assert(size === 16 && !signatureSeen, 'invalid Mach-O code signature command');
        signatureSeen = true;
        end = slice.readUInt32LE(at + 8);
        const signatureSize = slice.readUInt32LE(at + 12);
        assert(end >= commandsEnd && end + signatureSize === slice.length, 'invalid Mach-O signature bounds');
        normalized.fill(0, at + 8, at + 16);
      }
      if (command === 0x19) {
        assert(size >= 72, 'invalid Mach-O segment');
        if (slice.subarray(at + 8, at + 24).toString('ascii').replace(/\0+$/, '') === '__LINKEDIT') {
          normalized.fill(0, at + 32, at + 40);
          normalized.fill(0, at + 48, at + 56);
        }
      }
      at += size;
    }
    assert.equal(at, commandsEnd, 'Mach-O command count mismatch');
    return { cpu, subtype, sha256: sha256(normalized.subarray(0, end)) };
  });
}

function nativeFiles(root) {
  const files = [];
  const walk = (directory, depth = 0) => {
    assert(depth <= 10 && files.length <= 2000, 'native payload inventory exceeded bounds');
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        assert(!outside(root, realpathSync(path)), `native symlink escapes PostgreSQL root: ${path}`);
        assert(statSync(path).isFile(), `unexpected native member: ${path}`);
        files.push(path);
      } else throw new Error(`unexpected native member: ${path}`);
    }
  };
  walk(join(root, 'bin'));
  walk(join(root, 'lib'));
  return files;
}

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${binary} failed: ${result.stderr}`);
  return result.stdout;
}

function fileProof(root, path, platform) {
  assert(statSync(path).size <= 64 * 1024 * 1024, `oversized native file: ${path}`);
  const bytes = readFileSync(path);
  const proof = { path: slash(relative(root, path)), sha256: sha256(bytes), bytes: bytes.length };
  if (bytes.length >= 4 && (bytes.readUInt32LE(0) === 0xfeedfacf || bytes.readUInt32BE(0) === 0xcafebabe)) {
    proof.nativeFormat = 'macho';
    proof.machOSlices = machOSlices(bytes);
  } else if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x7f454c46) proof.nativeFormat = 'elf';
  else if (bytes.length >= 2 && bytes.readUInt16LE(0) === 0x5a4d) proof.nativeFormat = 'pe';
  const expectedFormat = platform === 'darwin-arm64' ? 'macho' : platform === 'linux-x64' ? 'elf' : 'pe';
  if (proof.nativeFormat) assert.equal(proof.nativeFormat, expectedFormat, `native format does not match ${platform}: ${path}`);
  return proof;
}

function sameNativeProof(expected, actual) {
  return expected && ((expected.sha256 === actual.sha256 && expected.bytes === actual.bytes)
    || (Array.isArray(expected.machOSlices) && Array.isArray(actual.machOSlices)
      && JSON.stringify(expected.machOSlices) === JSON.stringify(actual.machOSlices)));
}

function clientProvenance(bytes) {
  return Object.fromEntries(bytes.toString('utf8').trim().split(/\r?\n/).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

function clientProofIssues(proof, platform, recipe) {
  const issues = [];
  if (proof.platform !== platform || proof.postgres_clients !== '16.15'
    || proof.postgres_clients_sha256 !== registry.sources.find((source) => source.component === 'postgresql').sha256
    || proof.zlib !== '1.3.1' || proof.zlib_sha256 !== registry.sources.find((source) => source.component === 'zlib').sha256) {
    issues.push('Overlaid clients do not carry the exact PostgreSQL/zlib source contract.');
  }
  if (proof.postgres_clients_recipe_sha256 !== sha256(recipe)) issues.push('Overlaid client recipe bytes do not match CLIENT_PROVENANCE.');
  return issues;
}

const clientName = (path) => /^bin\/(psql|pg_dump|pg_restore)(?:\.exe)?$/.exec(path)?.[1];

function assertLinkMembers(root, links, members) {
  for (const link of links) {
    assert(members.has(link.path), `link evidence references an uncollected native member: ${link.path}`);
    if (link.kind !== 'source-owned-postgresql') continue;
    const target = link.target ?? slash(relative(root, realpathSync(resolve(dirname(safePath(root, link.path)), link.dependency.slice('@loader_path/'.length)))));
    assert(members.has(target), `source-owned dependency lacks native payload evidence: ${target}`);
  }
}

function originalText(path) {
  // Git may check text out with CRLF. Only that documented byte transformation
  // is reversed; pinned original hashes still reject every other alteration.
  return Buffer.from(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
}

function elfDependencies(root, paths) {
  const records = [];
  const operatingSystem = /^(?:lib(?:c|m|pthread|dl|rt|resolv|util)\.so\.\d+|ld-linux-x86-64\.so\.2)$/;
  const owned = /^lib(?:pq|ecpg|ecpg_compat|pgtypes)\.so(?:\.\d+)*$/;
  for (const path of [...new Set(paths.map((path) => realpathSync(path)))]) {
    const bytes = readFileSync(path);
    if (bytes.length < 20 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) continue;
    assert(bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === 62, `expected native x86-64 ELF: ${path}`);
    const dynamic = command('readelf', ['--wide', '--dynamic', path]);
    const entries = [...dynamic.matchAll(/\((NEEDED|RPATH|RUNPATH)\).*?\[([^\]]*)\]/g)];
    const search = [];
    for (const [, tag, value] of entries) {
      if (tag === 'NEEDED') continue;
      assert.equal(tag, 'RUNPATH', `legacy ELF RPATH is not permitted: ${path}`);
      for (const entry of value.split(':')) {
        assert(entry === '$ORIGIN' || entry === '$ORIGIN/../lib', `unowned ELF search path: ${entry}`);
        const directory = resolve(dirname(path), entry.slice('$ORIGIN'.length).replace(/^\//, ''));
        assert(!outside(root, directory) && (!existsSync(directory) || !outside(root, realpathSync(directory))), `ELF search path escapes runtime: ${entry}`);
        search.push(directory);
      }
      records.push({ path: slash(relative(root, path)), searchPath: value, kind: 'source-owned-runpath' });
    }
    for (const [, tag, dependency] of entries) {
      if (tag !== 'NEEDED') continue;
      if (operatingSystem.test(dependency)) records.push({ path: slash(relative(root, path)), dependency, kind: 'os-runtime' });
      else {
        assert(owned.test(dependency), `unattributed ELF dependency: ${dependency}`);
        const target = search.map((directory) => join(directory, dependency)).find((candidate) => existsSync(candidate));
        assert(target && !outside(root, realpathSync(target)), `unresolved source-owned ELF dependency: ${dependency}`);
        records.push({ path: slash(relative(root, path)), dependency, target: slash(relative(root, realpathSync(target))), kind: 'source-owned-postgresql' });
      }
    }
  }
  return records;
}

function peDependencies(root, paths) {
  const records = [];
  const operatingSystem = new Set(['kernel32.dll', 'kernelbase.dll', 'advapi32.dll', 'bcrypt.dll', 'crypt32.dll', 'secur32.dll', 'shell32.dll', 'shfolder.dll', 'user32.dll', 'gdi32.dll', 'ws2_32.dll', 'wsock32.dll', 'winmm.dll', 'netapi32.dll', 'psapi.dll', 'msvcrt.dll', 'ucrtbase.dll', 'ntdll.dll']);
  for (const path of [...new Set(paths.map((path) => realpathSync(path)))]) {
    const bytes = readFileSync(path);
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) continue;
    const header = bytes.readUInt32LE(0x3c);
    assert(header + 24 <= bytes.length && bytes.readUInt32LE(header) === 0x4550 && bytes.readUInt16LE(header + 4) === 0x8664, `expected native x86-64 PE: ${path}`);
    const imports = [...command('objdump', ['-p', path]).matchAll(/DLL Name:\s*([^\r\n]+)/g)].map((match) => match[1].trim().toLowerCase());
    for (const dependency of imports) {
      if (operatingSystem.has(dependency) || /^api-ms-win-[a-z0-9-]+\.dll$/.test(dependency)) records.push({ path: slash(relative(root, path)), dependency, kind: 'os-runtime' });
      else {
        assert(/^lib(?:pq|ecpg|ecpg_compat|pgtypes)\.dll$/.test(dependency) || dependency === 'postgres.exe', `unattributed PE dependency: ${dependency}`);
        const target = [join(dirname(path), dependency), join(root, 'bin', dependency)].find((candidate) => existsSync(candidate));
        assert(target && !outside(root, realpathSync(target)), `unresolved source-owned PE dependency: ${dependency}`);
        records.push({ path: slash(relative(root, path)), dependency, target: slash(relative(root, realpathSync(target))), kind: 'source-owned-postgresql' });
      }
    }
  }
  return records;
}

function dependencies(root, paths, platform, relocate = false) {
  assert(platforms.has(platform), `unsupported PostgreSQL artifact platform: ${platform}`);
  const server = fileProof(root, join(root, 'bin', platform === 'win32-x64' ? 'postgres.exe' : 'postgres'), platform);
  assert(server.nativeFormat, 'PostgreSQL server must be an actual native binary');
  if (platform === 'linux-x64') return elfDependencies(root, paths);
  if (platform === 'win32-x64') return peDependencies(root, paths);
  return darwinDependencies(root, paths, relocate);
}

function darwinDependencies(root, paths, relocate = false) {
  const records = [];
  for (const path of [...new Set(paths.map((path) => realpathSync(path)))]) {
    const bytes = readFileSync(path);
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) continue;
    const library = bytes.readUInt32LE(12) === 6;
    const lines = command('otool', ['-L', path]).trim().split('\n').slice(1);
    if (relocate && library) command('install_name_tool', ['-id', `@rpath/${path.split(sep).at(-1)}`, path]);
    for (const [index, line] of lines.entries()) {
      const name = line.trim().replace(/ \(compatibility version .*$/, '');
      if (library && index === 0) continue;
      let dependency = name;
      const canonical = isAbsolute(name) && existsSync(name) ? realpathSync(name) : name;
      if (isAbsolute(canonical) && !outside(root, canonical)) {
        dependency = `@loader_path/${slash(relative(dirname(path), canonical))}`;
        if (relocate) command('install_name_tool', ['-change', name, dependency, path]);
      }
      if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')) {
        records.push({ path: slash(relative(root, path)), dependency, kind: 'os-runtime' });
      } else {
        assert(dependency.startsWith('@loader_path/'), `nonportable/external PostgreSQL dependency: ${name}`);
        const target = resolve(dirname(path), dependency.slice('@loader_path/'.length));
        assert(!outside(root, realpathSync(target)), `PostgreSQL dependency escapes runtime: ${name}`);
        assert(/^lib(?:pq|ecpg|ecpg_compat|pgtypes)(?:\.\d+)*\.dylib$/.test(target.split(sep).at(-1)), `unexpected shared PostgreSQL dependency: ${name}`);
        records.push({ path: slash(relative(root, path)), dependency, kind: 'source-owned-postgresql' });
      }
    }
    // install_name_tool invalidates arm64 ad-hoc signatures. Sign only this
    // newly built artifact before recording its immutable code/data evidence.
    if (relocate) command('codesign', ['--force', '--sign', '-', path]);
  }
  return records;
}

// Finalize only the new source-owned build, never an existing runtime stage.
export function recordPostgresServerBuild(destination, platform) {
  const root = realpathSync(resolve(destination));
  assert(platforms.has(platform), `unsupported source-owned build platform: ${platform}`);
  assert(!existsSync(join(root, 'SERVER_PROVENANCE.json')), 'server build provenance already exists');
  const paths = nativeFiles(root);
  dependencies(root, paths, platform, true);
  const links = dependencies(root, paths, platform);
  const recipe = readFileSync(join(root, 'build-provenance', 'assemble-server.sh'));
  assert.equal(sha256(recipe), sha256(readFileSync(join(here, 'assemble-server.sh'))), 'server build recipe changed during build');
  writeFileSync(join(root, 'build-provenance', 'collect-notices.mjs'), readFileSync(fileURLToPath(import.meta.url)));
  for (const source of registry.sources) {
    const bytes = readFileSync(join(root, 'source-archives', source.file));
    assert.equal(sha256(bytes), source.sha256, `server source mismatch: ${source.file}`);
    assert.equal(bytes.length, source.bytes, `server source size mismatch: ${source.file}`);
  }
  const extension = platform === 'darwin-arm64' ? '.dylib' : platform === 'win32-x64' ? '.dll' : '.so';
  for (const name of ['pgcrypto', 'plpgsql']) assert(paths.some((path) => path.endsWith(`${sep}${name}${extension}`)), `required extension absent: ${name}`);
  const proof = { format: 1, platform, postgres: '16.15', sources: registry.sources, recipeSha256: sha256(recipe), compiler: command(platform === 'win32-x64' ? 'gcc' : 'cc', ['--version']), operatingSystem: command('uname', ['-a']), config: 'build-provenance/postgresql-config.log', linkage: 'OpenSSL and zlib are static; only source-owned PostgreSQL libraries and OS runtime may be dynamic.', files: paths.map((path) => fileProof(root, path, platform)), dependencies: links };
  writeFileSync(join(root, 'SERVER_PROVENANCE.json'), `${JSON.stringify(proof, null, 2)}\n`);
  writeFileSync(join(root, 'build-provenance', 'dynamic-dependencies.json'), `${JSON.stringify(links, null, 2)}\n`);
  return proof;
}

export async function collectPostgresNotices(binaryOrRoot, destination) {
  const supplied = realpathSync(resolve(binaryOrRoot));
  const root = statSync(supplied).isDirectory() ? supplied : dirname(dirname(supplied));
  const output = resolve(destination);
  assert(outside(root, output), 'PostgreSQL notice destination must be outside the read-only runtime root');
  assert(outside(here, output), 'PostgreSQL notice destination must not overwrite collector source');
  mkdirSync(output, { recursive: true });
  assert(!readdirSync(output).length, 'PostgreSQL notice destination must be empty');
  const files = [];
  const unresolved = [...registry.unresolved];
  const sourceRequirements = structuredClone(registry.sourceRequirements);
  const put = (path, bytes) => {
    const target = safePath(output, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
    return path;
  };
  put('source-closure.json', readFileSync(registryPath));
  for (const asset of registry.assets) {
    const path = safePath(here, asset.path);
    const bytes = originalText(path);
    assert.equal(bytes.length, asset.bytes, `original asset size mismatch: ${asset.path}`);
    assert.equal(sha256(bytes), asset.sha256, `original asset changed: ${asset.path}`);
    put(asset.path, bytes);
  }
  const build = JSON.parse(readFileSync(join(root, 'SERVER_PROVENANCE.json'), 'utf8'));
  assert.equal(build.format, 1, 'unsupported source-owned server provenance');
  assert(platforms.has(build.platform), `unsupported source-owned artifact platform: ${build.platform}`);
  assert.equal(build.postgres, '16.15', 'server version mismatch');
  assert.deepEqual(build.sources, registry.sources, 'server source pins changed');
  assert.equal(build.recipeSha256, sha256(readFileSync(join(root, 'build-provenance', 'assemble-server.sh'))), 'server build recipe provenance changed');
  put('SERVER_PROVENANCE.json', readFileSync(join(root, 'SERVER_PROVENANCE.json')));
  for (const name of readdirSync(join(root, 'build-provenance')).sort()) {
    const path = join(root, 'build-provenance', name);
    assert(statSync(path).isFile() && statSync(path).size <= 8 * 1024 * 1024, 'invalid server build evidence');
    put(`build-provenance/${name}`, readFileSync(path));
  }
  let clientProof;
  if (existsSync(join(root, 'CLIENT_PROVENANCE'))) {
    const bytes = readFileSync(join(root, 'CLIENT_PROVENANCE'));
    clientProof = clientProvenance(bytes);
    put('clients/CLIENT_PROVENANCE', bytes);
    put('clients/assemble-clients.sh', readFileSync(join(here, 'assemble-clients.sh')));
    for (const name of ['POSTGRESQL_CLIENT_LICENSE.txt', 'ZLIB_LICENSE.txt']) put(`clients/${name}`, readFileSync(join(root, name)));
    for (const reason of clientProofIssues(clientProof, build.platform, readFileSync(join(here, 'assemble-clients.sh')))) unresolved.push({ component: 'PostgreSQL clients', reason });
  }
  const expected = new Map(build.files.map((file) => [file.path, file]));
  const payload = [];
  for (const path of nativeFiles(root)) {
    const actual = fileProof(root, path, build.platform);
    const original = expected.get(actual.path);
    const tool = clientProof && clientName(actual.path);
    const overlaidClient = Boolean(tool);
    if (overlaidClient) {
      if (clientProof[`postgres_clients_${tool}_sha256`] !== actual.sha256) unresolved.push({ component: actual.path, reason: 'Overlaid client bytes do not match their source-build attestation; collect before subsequent artifact signing.' });
    }
    if (!overlaidClient && !sameNativeProof(original, actual)) unresolved.push({ component: actual.path, reason: 'Native payload does not match the source-owned build manifest.' });
    expected.delete(actual.path);
    payload.push(actual);
  }
  for (const file of expected.values()) unresolved.push({ component: file.path, reason: 'Source-owned native payload member is missing.' });
  const links = dependencies(root, nativeFiles(root), build.platform);
  assertLinkMembers(root, links, new Set(payload.map((member) => member.path)));
  put('dynamic-dependencies.json', Buffer.from(`${JSON.stringify(links, null, 2)}\n`));
  put('payload.json', Buffer.from(`${JSON.stringify(payload, null, 2)}\n`));
  for (const source of registry.sources) {
    const bytes = readFileSync(join(root, 'source-archives', source.file));
    assert.equal(sha256(bytes), source.sha256, `source-owned archive changed: ${source.file}`);
    assert.equal(bytes.length, source.bytes, `source-owned archive size changed: ${source.file}`);
    put(`corresponding-source/${source.file}`, bytes);
  }
  const components = registry.sources.map((source) => ({ component: source.component, version: source.version, notices: registry.assets.filter((asset) => asset.component === source.component).map((asset) => asset.path), sources: [source], provenance: 'SERVER_PROVENANCE.json', status: 'source-owned' }));
  const index = { format: 1, platform: build.platform, files: files.sort((a, b) => a.path.localeCompare(b.path, 'en')), components, unresolved, sourceRequirements };
  writeFileSync(join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

export function auditPostgresNotices(destination, runtimeRoot) {
  const output = realpathSync(resolve(destination));
  const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8'));
  assert.equal(index.format, 1, 'unsupported PostgreSQL notice manifest');
  assert(Array.isArray(index.files) && index.files.length && Array.isArray(index.components) && index.components.length, 'empty PostgreSQL notice manifest');
  assert(Array.isArray(index.unresolved) && Array.isArray(index.sourceRequirements), 'missing PostgreSQL closure status');
  const seen = new Set();
  for (const file of index.files) {
    assert(!seen.has(file.path), `duplicate PostgreSQL notice path: ${file.path}`);
    seen.add(file.path);
    const path = safePath(output, file.path);
    assert(!lstatSync(path).isSymbolicLink() && !outside(output, realpathSync(path)), 'notice output must be a physical file inside destination');
    const bytes = readFileSync(path);
    assert.equal(bytes.length, file.bytes, `notice byte size changed: ${file.path}`);
    assert.equal(sha256(bytes), file.sha256, `notice hash changed: ${file.path}`);
  }
  // Re-read the checked-in baseline, not merely caller-editable status arrays.
  const proof = JSON.parse(readFileSync(safePath(output, 'source-closure.json'), 'utf8'));
  assert.equal(sha256(readFileSync(safePath(output, 'source-closure.json'))), sha256(readFileSync(registryPath)), 'PostgreSQL closure baseline changed');
  for (const asset of proof.assets) {
    assert(seen.has(asset.path), `required original asset omitted: ${asset.path}`);
    assert.equal(sha256(readFileSync(safePath(output, asset.path))), asset.sha256, `pinned original asset changed: ${asset.path}`);
  }
  for (const source of proof.sources) {
    const path = `corresponding-source/${source.file}`;
    assert(seen.has(path), `required original source omitted: ${source.file}`);
    assert.equal(sha256(readFileSync(safePath(output, path))), source.sha256, `pinned original source changed: ${source.file}`);
  }
  for (const path of ['SERVER_PROVENANCE.json', 'payload.json', 'dynamic-dependencies.json', 'build-provenance/assemble-server.sh', 'build-provenance/collect-notices.mjs', 'build-provenance/postgresql-config.log', 'build-provenance/openssl-configdata.pm']) assert(seen.has(path), `required source/build evidence omitted: ${path}`);
  const build = JSON.parse(readFileSync(safePath(output, 'SERVER_PROVENANCE.json'), 'utf8'));
  assert(platforms.has(build.platform), 'unsupported audited source-owned platform');
  assert.equal(index.platform, build.platform, 'notice/build platform mismatch');
  assert.deepEqual(build.sources, proof.sources, 'source-owned build pins changed');
  assert.equal(build.recipeSha256, sha256(readFileSync(safePath(output, 'build-provenance/assemble-server.sh'))), 'source-owned build recipe changed');
  const payload = JSON.parse(readFileSync(safePath(output, 'payload.json'), 'utf8'));
  assert(Array.isArray(payload) && payload.length, 'native payload evidence is empty');
  const collected = new Map();
  const expected = new Map(build.files.map((member) => [member.path, member]));
  assert.equal(expected.size, build.files.length, 'duplicate source-build native member');
  let clients;
  if (seen.has('clients/CLIENT_PROVENANCE')) {
    assert(seen.has('clients/assemble-clients.sh'), 'overlaid client recipe evidence is missing');
    clients = clientProvenance(readFileSync(safePath(output, 'clients/CLIENT_PROVENANCE')));
    assert.deepEqual(clientProofIssues(clients, build.platform, readFileSync(safePath(output, 'clients/assemble-clients.sh'))), [], 'overlaid client source/recipe proof is invalid');
  }
  for (const member of payload) {
    assert(typeof member.path === 'string' && /^(bin|lib)\//.test(member.path), 'invalid collected native path');
    safePath(output, member.path);
    assert(!collected.has(member.path), `duplicate collected native member: ${member.path}`);
    const tool = clients && clientName(member.path);
    if (tool) assert.equal(member.sha256, clients[`postgres_clients_${tool}_sha256`], `collected client does not match source-build SHA: ${member.path}`);
    else assert(sameNativeProof(expected.get(member.path), member), `collected native member lacks source-owned build evidence: ${member.path}`);
    expected.delete(member.path);
    collected.set(member.path, member);
  }
  assert.equal(expected.size, 0, `source-built native members omitted from collection: ${[...expected.keys()].join(', ')}`);
  const links = JSON.parse(readFileSync(safePath(output, 'dynamic-dependencies.json'), 'utf8'));
  for (const link of links) assert(collected.has(link.path), `collected link owner is absent: ${link.path}`);
  if (runtimeRoot !== undefined) {
    const runtime = realpathSync(resolve(runtimeRoot));
    assert(statSync(runtime).isDirectory(), 'runtimeRoot must be the actual PostgreSQL directory');
    const remaining = new Map(collected);
    const paths = nativeFiles(runtime);
    for (const path of paths) {
      const actual = fileProof(runtime, path, build.platform);
      assert(sameNativeProof(remaining.get(actual.path), actual), `actual PostgreSQL native member differs from collection: ${actual.path}`);
      const tool = clients && clientName(actual.path);
      // The collected pre-signing bytes must be the exact builder output.
      // The preceding full-slice proof then allows only Darwin signing changes.
      if (tool) assert.equal(remaining.get(actual.path).sha256, clients[`postgres_clients_${tool}_sha256`], `actual client lacks an exact source-build SHA anchor: ${actual.path}`);
      remaining.delete(actual.path);
    }
    assert.equal(remaining.size, 0, `collected PostgreSQL native members missing from runtime: ${[...remaining.keys()].join(', ')}`);
    if (clients) assert.equal(sha256(readFileSync(join(runtime, 'CLIENT_PROVENANCE'))), sha256(readFileSync(safePath(output, 'clients/CLIENT_PROVENANCE'))), 'actual client provenance differs from collection');
    const actualLinks = dependencies(runtime, paths, build.platform);
    assertLinkMembers(runtime, actualLinks, new Set(collected.keys()));
    // Freshly validated load edges may include materialized symlink aliases.
    // Their inspection count can change, but all code/imports remain proven.
  }
  assert.equal(proof.unresolved.length, 0, 'source-owned PostgreSQL baseline has unresolved source/notice duties');
  assert.equal(index.unresolved.length, 0, `PostgreSQL notice closure unresolved: ${JSON.stringify(index.unresolved)}`);
  assert(index.sourceRequirements.every((entry) => entry.status === 'satisfied') && proof.sourceRequirements.every((entry) => entry.status === 'satisfied'), 'PostgreSQL corresponding-source/replacement obligations unresolved');
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, input, destination, ...extra] = process.argv.slice(2);
    assert(!extra.length, 'usage: collect-notices.mjs collect INPUT DEST | audit DEST [RUNTIME_ROOT]');
    if (command === 'collect' && input && destination) {
      const result = await collectPostgresNotices(input, destination);
      console.log(JSON.stringify({ files: result.files.length, components: result.components.length, unresolved: result.unresolved.length, sourceRequirements: result.sourceRequirements }));
    } else if (command === 'audit' && input) {
      const result = auditPostgresNotices(input, destination);
      console.log(`PostgreSQL notices verified: ${result.files.length} files`);
    } else throw new Error('usage: collect-notices.mjs collect INPUT DEST | audit DEST [RUNTIME_ROOT]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
