#!/usr/bin/env node
// Build-time only. Copy original texts, never synthesize a license from SPDX.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'boombignose');
const registry = join(root, 'packaging', 'licenses');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (path) => path.split(sep).join('/');
const excluded = (name) => name === 'sharp' || name.startsWith('@img/sharp')
  || name === '@napi-rs/canvas' || name.startsWith('@napi-rs/canvas-');
const legalName = /(?:^|[._-])(?:licen[cs]es?|copying|notices?|copyright|patents|authors|ofl)(?:[._-]|$)/i;
const skipDirectories = new Set(['.git', 'node_modules', 'testdata']);
const pinned = json(join(registry, 'sources.json'));
const supplements = {
  '@react-three/fiber@9.8.2': ['react-three-fiber-9.8.2-LICENSE.txt'],
  'draco3d@1.5.9': ['draco3d-1.5.9-LICENSE.txt', 'draco3d-1.5.9-AUTHORS.txt'],
  'server-only@0.0.1': ['react-markers-LICENSE.txt'],
  'client-only@0.0.1': ['react-markers-LICENSE.txt'],
  'react-remove-scroll-bar@2.3.8': ['react-remove-scroll-bar-LICENSE.txt'],
};

function packageDirectory(name, from) {
  for (let at = from; ; at = dirname(at)) {
    const path = join(at, 'node_modules', name);
    if (existsSync(join(path, 'package.json'))) return realpathSync(path);
    if (dirname(at) === at) return null;
  }
}

export function collectNotices(erpRoot) {
  const erp = resolve(erpRoot);
  assert(existsSync(join(erp, 'server.js')), 'collect against the actual post-prune standalone ERP, not an empty directory');
  const destination = join(erp, 'third-party-notices');
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination);
  const files = [];
  const packages = [];
  const unresolved = [];
  const clientMaps = [];
  const clientAssets = [];
  let inspected = 0;
  let totalBytes = 0;
  function copy(source, target, provenance) {
    const size = statSync(source).size;
    assert(size > 0 && size <= 4 * 1024 * 1024, `invalid/oversized notice: ${source}`);
    totalBytes += size;
    assert(totalBytes <= 64 * 1024 * 1024, 'notice output exceeded 64 MiB');
    const bytes = readFileSync(source);
    const output = join(destination, target);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes);
    files.push({ path: slash(target), sha256: hash(bytes), ...provenance });
    return slash(target);
  }
  function scan(directory, target, provenance, depth = 0, legalDirectory = false) {
    const outputRelative = relative(directory, destination);
    assert(outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative),
      `notice source traversal would include its own generated destination: ${directory}`);
    const inputRelative = relative(destination, directory);
    assert(inputRelative === '..' || inputRelative.startsWith(`..${sep}`) || isAbsolute(inputRelative),
      `notice source is inside its own generated destination: ${directory}`);
    assert(depth <= 40, `notice traversal depth exceeded: ${directory}`);
    const found = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      assert(++inspected <= 500000, 'notice traversal exceeded 500000 entries');
      const source = join(directory, entry.name);
      if (entry.isDirectory() && !skipDirectories.has(entry.name)) {
        found.push(...scan(source, join(target, entry.name), provenance, depth + 1, legalDirectory || legalName.test(entry.name)));
      } else if (entry.isFile() && (legalDirectory || legalName.test(entry.name))) {
        found.push(copy(source, join(target, entry.name), provenance));
      }
    }
    return found;
  }
  for (const source of pinned) {
    assert.equal(hash(readFileSync(join(registry, source.file))), source.sha256, `pinned notice changed: ${source.file}`);
    copy(join(registry, source.file), join('upstream', source.file), { source: source.url });
  }
  for (const name of ['LICENSE', 'NOTICE']) copy(join(root, name), join('project', name), { source: name });
  const fontMetadata = json(join(registry, 'font-metadata.json'));
  const fontAssets = [];
  const pdfResources = [];
  const pdfRuntimeFamilies = [];
  const pdfDirectory = packageDirectory('pdfjs-dist', root);
  const pdfIdentity = pdfDirectory && json(join(pdfDirectory, 'package.json'));
  const pdfOriginals = [];
  const pdfByHash = new Map();
  if (pdfDirectory) {
    const paths = ['build/pdf.worker.min.mjs'];
    for (const directory of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
      for (const entry of readdirSync(join(pdfDirectory, directory), { withFileTypes: true })) {
        if (entry.isFile() && !legalName.test(entry.name)) paths.push(`${directory}/${entry.name}`);
      }
    }
    assert(paths.length <= 5000, 'PDF resource inventory exceeded bounded size');
    let bytes = 0;
    for (const path of paths.sort()) {
      const data = readFileSync(join(pdfDirectory, path));
      bytes += data.length;
      assert(data.length <= 16 * 1024 * 1024 && bytes <= 64 * 1024 * 1024, 'PDF resource bytes exceeded bounded size');
      const original = { path, sha256: hash(data) };
      pdfOriginals.push(original);
      pdfByHash.set(original.sha256, original);
    }
  }
  function pdfResource(asset, evidence) {
    const original = pdfByHash.get(asset.sha256);
    if (!original) return false;
    const owner = `${pdfIdentity.name}@${pdfIdentity.version}`;
    visit(pdfDirectory, { ...evidence, owner, sourcePath: original.path });
    pdfResources.push({ ...asset, kind: evidence.kind, owner, sourcePath: original.path });
    return true;
  }
  copy(join(registry, 'font-metadata.json'), 'upstream/font-metadata.json', { source: fontMetadata.provenance });
  const seen = new Map();
  function visit(directory, evidence) {
    const source = realpathSync(directory);
    assert(source.startsWith(`${realpathSync(join(root, 'node_modules'))}${sep}`),
      `npm notice source must be an installed dependency, never the project/generated tree: ${source}`);
    if (seen.has(source)) { seen.get(source).evidence.push(evidence); return; }
    assert(seen.size < 2000, 'artifact package set exceeded 2000 packages');
    const pkg = json(join(source, 'package.json'));
    assert(pkg.name, `package identity missing: ${source}`);
    const id = `${pkg.name}@${pkg.version ?? 'embedded'}`;
    assert(!excluded(pkg.name), `excluded runtime package survived into artifact proof: ${id}`);
    const sourcePath = slash(relative(root, source));
    const target = join('npm', `${pkg.name.replaceAll('/', '+')}@${pkg.version ?? 'embedded'}-${hash(sourcePath).slice(0, 8)}`);
    const licenses = scan(source, target, { package: id, source: sourcePath });
    for (const name of supplements[id] ?? []) licenses.push(`upstream/${name}`);
    if (id === 'react-remove-scroll-bar@2.3.8') {
      const proofPath = join(registry, 'react-remove-scroll-bar-provenance.json');
      const proof = json(proofPath);
      assert.equal(proof.package, id, 'scrollbar code/license proof identity mismatch');
      for (const file of proof.files) {
        const path = resolve(source, file.path);
        assert(path.startsWith(`${source}${sep}`), 'scrollbar proof path escapes package');
        assert.equal(hash(readFileSync(path)), file.sha256, `scrollbar exact licensed-code proof changed: ${file.path}`);
      }
      licenses.push(copy(proofPath, 'upstream/react-remove-scroll-bar-provenance.json', { package: id, source: proof.sourceChain.compare }));
    }
    if (pkg.name === 'next') {
      const proofPath = join(registry, 'next-polyfill-provenance.json');
      const proof = json(proofPath);
      assert.equal(proof.owner, id, 'embedded polyfill owner mismatch');
      assert.equal(hash(readFileSync(join(source, proof.installedAsset.path))), proof.installedAsset.sha256, 'embedded Next polyfill source changed; review exact transitive notices');
      licenses.push(copy(proofPath, 'upstream/next-polyfill-provenance.json', { package: id, source: proof.sourcePackage.url }));
      licenses.push('upstream/core-js-3.38.1-LICENSE.txt', 'upstream/whatwg-fetch-3.0.0-LICENSE.txt');
      const assignment = join(root, 'node_modules', '.pnpm', 'object-assign@4.1.1', 'node_modules', 'object-assign');
      assert.equal(json(join(assignment, 'package.json')).version, '4.1.1', 'embedded assignment version mismatch');
      visit(assignment, { kind: 'embedded-next-polyfill', owner: id, source: proof.sourceImports, assetSha256: proof.installedAsset.sha256 });
    }
    // next-env is published from the same versioned Next.js source tree.
    if (pkg.name === '@next/env' && licenses.length === 0) {
      const next = packageDirectory('next', root);
      assert(next && json(join(next, 'package.json')).version === pkg.version, 'next-env/Next version mismatch');
      licenses.push(copy(join(next, 'license.md'), join(target, 'NEXT_LICENSE.md'), { package: id, source: `next@${pkg.version}/license.md (same source project)` }));
    }
    if (licenses.length === 0) unresolved.push({ package: id, reason: 'No original full license/copyright text in artifact package or verified supplement. SPDX alone is insufficient.' });
    const record = { package: id, declaredLicense: pkg.license ?? null, notices: licenses, evidence: [evidence] };
    seen.set(source, record);
    packages.push(record);
    if (pkg.name === 'pdfjs-dist' && evidence.kind === 'server-package') {
      assert.equal(id, `${pdfIdentity.name}@${pdfIdentity.version}`, 'staged PDF source version mismatch');
      for (const original of pdfOriginals) {
        const path = join(erp, evidence.path, original.path);
        if (!existsSync(path)) continue; // Trace closure need not carry unused resources.
        const asset = { path: slash(relative(erp, path)), sha256: hash(readFileSync(path)) };
        assert.equal(asset.sha256, original.sha256, `staged PDF resource differs from original: ${asset.path}`);
        assert(pdfResource(asset, { kind: 'server-resource' }), 'staged PDF resource ownership missing');
      }
    }
  }
  function stagedPackages(directory, depth = 0) {
    assert(depth <= 40, 'staged package traversal depth exceeded');
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      assert(++inspected <= 500000, 'notice traversal exceeded 500000 entries');
      if (!entry.isDirectory()) continue; // Physical packages, not pnpm aliases.
      const path = join(directory, entry.name);
      const metadata = join(path, 'package.json');
      if (existsSync(metadata)) {
        const pkg = json(metadata);
        // Resolve the exact pnpm physical path first, never an arbitrary version.
        const original = join(root, relative(erp, path));
        assert(existsSync(join(original, 'package.json')), `original staged package unavailable: ${relative(erp, path)}`);
        const sourcePackage = json(join(original, 'package.json'));
        assert.equal(sourcePackage.name, pkg.name, 'staged/source npm name mismatch');
        assert.equal(sourcePackage.version, pkg.version, 'staged/source npm version mismatch');
        visit(original, { kind: 'server-package', path: slash(relative(erp, path)), packageJsonSha256: hash(readFileSync(metadata)) });
        // Nested compiled dependencies' originals are included by scan().
        if (existsSync(join(path, 'node_modules'))) stagedPackages(join(path, 'node_modules'), depth + 1);
      } else stagedPackages(path, depth + 1);
    }
  }
  stagedPackages(join(erp, 'node_modules'));
  const cssSource = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
  for (const match of cssSource.matchAll(/@import\s+["']([^."'\/][^"']*)["']/g)) {
    const specifier = match[1];
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    const directory = packageDirectory(name, root);
    assert(directory, `compiled stylesheet package missing: ${specifier}`);
    visit(directory, { kind: 'compiled-global-style-import', source: 'app/globals.css', specifier, sourceSha256: hash(cssSource) });
  }
  const staticRoot = join(root, '.next', 'static');
  let mapBytes = 0;
  function mapSources(map, evidence) {
    for (const section of map.sections ?? []) mapSources(section.map, evidence);
    for (const name of map.sources ?? []) {
      const decoded = decodeURIComponent(name);
      const start = decoded.indexOf('node_modules/');
      if (start < 0) continue;
      const sourcePath = decoded.slice(start).split('?')[0].replace(/ \[.*$/, '');
      const source = resolve(root, sourcePath);
      assert(source.startsWith(`${join(root, 'node_modules')}${sep}`), 'client source map escapes installed dependencies');
      // Published upstream maps can retain monorepo-relative paths such as
      // node_modules/shared or node_modules/src. Their outer pnpm store entry,
      // not an ancestor search reaching this project's package.json, owns them.
      const owners = [...sourcePath.matchAll(/(?=(?:^|\/)node_modules\/\.pnpm\/([^/]+)\/node_modules\/)/g)];
      const npmRoot = join(root, 'node_modules');
      const store = owners[0]?.[1];
      let directory;
      if (store) {
        const separator = store.indexOf('@', 1);
        assert(separator > 0, `unrecognized pnpm package identity: ${store}`);
        const packageName = store.slice(0, separator).replace('+', '/');
        directory = join(npmRoot, '.pnpm', store, 'node_modules', packageName);
      } else {
        const segments = sourcePath.split('/');
        const packageName = segments[1]?.startsWith('@') ? segments.slice(1, 3).join('/') : segments[1];
        assert(packageName && packageName !== '.pnpm', `client source has no installed package owner: ${name}`);
        directory = join(npmRoot, packageName);
      }
      // Subpath package.json files (zod/v4, Babel helpers/esm, resolver/zod)
      // describe module formats/exports, not separately licensed npm packages.
      assert(existsSync(join(directory, 'package.json')), `upstream map owner is not installed: ${name}`);
      visit(directory, { kind: 'client-module', map: evidence, source: name });
      // Also retain exact embedded dependency owners named by nested upstream
      // pnpm maps (e.g. Supabase's compiled tslib), not just the outer package.
      for (const owner of owners.slice(1)) {
        const store = owner[1];
        const separator = store.indexOf('@', 1);
        assert(separator > 0, `unrecognized nested pnpm identity: ${store}`);
        const packageName = store.slice(0, separator).replace('+', '/');
        const dependency = join(npmRoot, '.pnpm', store, 'node_modules', packageName);
        assert(existsSync(join(dependency, 'package.json')), `embedded upstream map dependency unavailable: ${store}`);
        visit(dependency, { kind: 'embedded-client-module', map: evidence, source: name });
      }
    }
  }
  const mapReferences = new Map();
  const pendingMaps = [];
  function staticAssets(directory, mapRoot = staticRoot, mapsOnly = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      assert(++inspected <= 500000, 'notice traversal exceeded 500000 entries');
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { staticAssets(path, mapRoot, mapsOnly); continue; }
      if (!entry.isFile()) continue;
      const assetPath = slash(relative(mapRoot, path));
      if (entry.name.endsWith('.js.map')) pendingMaps.push({ path, assetPath, mapRoot });
      if (mapsOnly || entry.name.endsWith('.map')) continue;
      const bytes = readFileSync(path);
      const asset = { path: assetPath, sha256: hash(bytes) };
      clientAssets.push(asset);
      const pdf = pdfResource(asset, { kind: 'emitted-resource' });
      if (/pdf\.worker.*\.mjs$/.test(entry.name)) assert(pdf, `opaque PDF worker has no byte-identical original package owner: ${assetPath}`);
      if (/\.(?:m?js)$/.test(entry.name)) {
        const reference = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/.exec(bytes.toString('utf8'))?.[1];
        if (reference && !/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
          const mapPath = resolve(dirname(path), decodeURIComponent(reference.split(/[?#]/)[0]));
          const relativeMap = relative(staticRoot, mapPath);
          assert(relativeMap && !isAbsolute(relativeMap) && relativeMap !== '..' && !relativeMap.startsWith(`..${sep}`), 'emitted source map reference escapes static assets');
          const key = slash(relativeMap);
          if (!mapReferences.has(key)) mapReferences.set(key, []);
          mapReferences.get(key).push(asset);
        }
      }
      if (/\.(?:woff2?|ttf|otf)$/.test(entry.name)) {
        const original = fontMetadata.fonts.find((font) => font.sha256 === asset.sha256);
        assert(original, `exact font copyright metadata missing for ${assetPath} (${asset.sha256}); inspect its original name table before updating packaging/licenses/font-metadata.json`);
        fontAssets.push({ ...asset, names: original.names, notice: 'upstream/font-metadata.json' });
      }
    }
  }
  staticAssets(staticRoot);
  const privateMaps = join(root, '.next', 'private-source-maps');
  if (pendingMaps.length === 0 && existsSync(privateMaps)) staticAssets(privateMaps, privateMaps, true);
  assert(pendingMaps.length > 0 && pendingMaps.length <= 4000, 'exact client-module proof requires private production browser source maps');
  for (const { path, assetPath, mapRoot } of pendingMaps) {
    const size = statSync(path).size;
    mapBytes += size;
    assert(size <= 64 * 1024 * 1024 && mapBytes <= 512 * 1024 * 1024, 'client source map proof exceeded bounded size');
    const bytes = readFileSync(path);
    const map = JSON.parse(bytes.toString('utf8'));
    let emitted = mapReferences.get(assetPath);
    let pairing = 'emitted-sourceMappingURL';
    // Next's untransformed nomodule polyfill has no directive. A single
    // original source byte-identical to an emitted asset is also exact proof.
    if (!emitted?.length && map.sources?.length === 1 && typeof map.sourcesContent?.[0] === 'string') {
      const originalSha256 = hash(map.sourcesContent[0]);
      emitted = clientAssets.filter((asset) => /\.m?js$/.test(asset.path) && asset.sha256 === originalSha256);
      pairing = 'byte-identical-single-original-source';
    }
    // Turbopack's final JS/map basenames can differ. Neither basename guessing
    // nor silently discarding an unpaired map is acceptable closure evidence.
    assert(emitted?.length > 0, `source map has no exact emitted-client pairing evidence: ${assetPath}`);
    clientMaps.push({ path: assetPath, sha256: hash(bytes), proofDirectory: slash(relative(root, mapRoot)), pairing, emitted });
    mapSources(map, assetPath);
  }
  if (pdfResources.length > 0) {
    const owner = `${pdfIdentity.name}@${pdfIdentity.version}`;
    const record = seen.get(realpathSync(pdfDirectory));
    const codecs = json(join(registry, 'pdfjs-codec-provenance.json'));
    assert.equal(codecs.owner, owner, 'PDF runtime provenance requires review for this exact package');
    const active = new Map();
    for (const family of codecs.families.filter((family) => family.asset)) {
      const emitted = pdfResources.filter((resource) => resource.sourcePath === family.asset);
      if (emitted.length === 0) continue;
      const original = codecs.installedAssets.find((asset) => asset.path === family.asset);
      assert(original && emitted.every((asset) => asset.sha256 === original.sha256), `PDF codec runtime changed: ${family.asset}`);
      active.set(family.id, { family, resources: emitted.map((asset) => asset.path) });
    }
    const workers = pdfResources.filter((resource) => resource.sourcePath === 'build/pdf.worker.min.mjs');
    if (workers.length > 0) {
      const worker = readFileSync(join(pdfDirectory, 'build/pdf.worker.min.mjs'), 'utf8');
      const mapPath = 'build/pdf.worker.mjs.map';
      assert(statSync(join(pdfDirectory, mapPath)).size <= 16 * 1024 * 1024, 'bounded original PDF worker map required');
      const map = json(join(pdfDirectory, mapPath));
      const sourceContentHashes = new Set(map.sourcesContent.filter((source) => typeof source === 'string').map(hash));
      for (const glue of codecs.embeddedGeneratedGlue) {
        const marker = `${glue.family.split('-')[0]}.wasm`;
        assert(worker.includes(marker), `PDF worker decoder correspondence missing: ${marker}`);
        assert(glue.installedSourceMaps.includes(mapPath) && sourceContentHashes.has(glue.sourceMapContentSha256),
          `original PDF worker generated glue changed: ${glue.family}`);
        const family = codecs.families.find((family) => family.id === glue.family);
        assert(family, 'PDF worker runtime notice family missing');
        active.set(family.id, { family, resources: workers.map((asset) => asset.path), sourceContentSha256: glue.sourceMapContentSha256 });
      }
    }
    const required = new Set();
    for (const { family, resources, sourceContentSha256 } of active.values()) {
      for (const file of family.notices) required.add(file);
      pdfRuntimeFamilies.push({ id: family.id, resources, sourceContentSha256, notices: family.notices.map((file) => `upstream/${file}`) });
    }
    if (active.size > 0) {
      record.notices.push(copy(join(registry, 'pdfjs-codec-provenance.json'), 'upstream/pdfjs-codec-provenance.json', { package: owner, source: 'Original immutable codec/glue copyright evidence and actual resource guards' }));
      for (const file of [...required].sort()) {
        const notice = codecs.noticeAssets.find((notice) => notice.file === file);
        assert(notice && hash(readFileSync(join(registry, file))) === notice.sha256 && statSync(join(registry, file)).size === notice.size, `original PDF runtime notice changed: ${file}`);
        record.notices.push(copy(join(registry, file), `upstream/${file}`, { package: owner, source: 'packaging/licenses/pdfjs-codec-provenance.json' }));
      }
    }
    const qcmsResources = pdfResources.filter((asset) => asset.sourcePath === 'wasm/qcms_bg.wasm');
    if (qcmsResources.length > 0) {
      const proof = json(join(registry, 'pdfjs-qcms-provenance.json'));
      assert.equal(proof.owner, owner, 'QCMS Rust runtime owner mismatch');
      assert(qcmsResources.every((asset) => asset.sha256 === proof.installedAsset.sha256), 'QCMS Rust runtime bytes changed');
      record.notices.push(copy(join(registry, 'pdfjs-qcms-provenance.json'), 'upstream/pdfjs-qcms-provenance.json', { package: owner, source: proof.rustSource.url }));
      const notices = [];
      for (const notice of proof.notices) {
        const path = join(registry, notice.file);
        assert(hash(readFileSync(path)) === notice.sha256 && statSync(path).size === notice.bytes, `original QCMS runtime notice changed: ${notice.file}`);
        notices.push(copy(path, `upstream/${notice.file}`, { package: owner, source: notice.source.url }));
      }
      record.notices.push(...notices);
      pdfRuntimeFamilies.push({ id: 'qcms-rust', resources: qcmsResources.map((asset) => asset.path), notices });
    }
    for (const resource of pdfResources.filter((asset) => asset.sourcePath.startsWith('wasm/'))) {
      assert(pdfRuntimeFamilies.some((family) => family.resources.includes(resource.path)), `unreviewed emitted PDF compiler runtime: ${resource.sourcePath}`);
    }
  }
  // All pinned modules, including other-platform Wails dependencies, are a
  // conservative notice superset. Downloads happen only during source builds.
  const toolchain = /^toolchain (go\d+\.\d+\.\d+)$/m.exec(readFileSync(join(native, 'go.mod'), 'utf8'))?.[1];
  assert(toolchain, 'exact Go toolchain pin missing');
  function go(args) {
    const result = spawnSync('go', args, { cwd: native, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GOTOOLCHAIN: toolchain, GOENV: 'off', GOWORK: 'off', GOFLAGS: '' }, shell: false });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `notice source preparation failed: go ${args.join(' ')}\n${result.stderr}`);
    return result.stdout.trim();
  }
  // Source acquisition must never add sums to the checkout's go.sum.
  const scratch = mkdtempSync(join(tmpdir(), 'bbn-notice-modules-'));
  const modfile = join(scratch, 'go.mod');
  let modules;
  try {
    writeFileSync(modfile, readFileSync(join(native, 'go.mod')));
    writeFileSync(join(scratch, 'go.sum'), readFileSync(join(native, 'go.sum')));
    go(['mod', 'download', '-modfile', modfile, 'all']);
    const moduleStream = go(['list', '-modfile', modfile, '-m', '-json', 'all']);
    modules = JSON.parse(`[${moduleStream.replace(/}\s*\n\s*{/g, '},{')}]`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const goModules = [];
  for (const module of modules.filter((entry) => !entry.Main).sort((a, b) => a.Path.localeCompare(b.Path, 'en'))) {
    assert(!module.Replace, `unreviewed Go module replacement: ${module.Path}`);
    assert(module.Dir, `Go module source unavailable: ${module.Path}@${module.Version}`);
    const id = `${module.Path}@${module.Version}`;
    const notices = scan(module.Dir, join('go', id.replaceAll('/', '+')), { package: id, source: `Go module cache; ${module.Sum ?? 'see go.sum'}` });
    if (notices.length === 0) unresolved.push({ package: id, reason: 'No original full license/copyright text in downloaded Go module' });
    goModules.push({ package: id, sum: module.Sum ?? null, notices });
  }
  const goroot = go(['env', 'GOROOT']);
  const toolchainLicense = existsSync(join(goroot, 'LICENSE')) ? join(goroot, 'LICENSE')
    : goroot.endsWith(`${sep}libexec`) ? join(dirname(goroot), 'LICENSE') : null;
  assert(toolchainLicense && existsSync(toolchainLicense), `pinned Go toolchain original LICENSE unavailable: ${goroot}`);
  copy(toolchainLicense, 'go-toolchain/LICENSE', { source: `${toolchain} installed toolchain LICENSE${dirname(toolchainLicense) === goroot ? '' : ' (Homebrew prefix; GOROOT=libexec)'}` });
  copy(join(goroot, 'PATENTS'), 'go-toolchain/PATENTS', { source: `${toolchain}/PATENTS` });
  scan(join(goroot, 'src'), 'go-toolchain/src', { source: `${toolchain}/src bundled original notices` });
  // Preserve source headers too: e.g. MediaPipe npm omits LICENSE but contains
  // original copyright headers. Headers do not clear a missing-full-text issue.
  const mediaPipe = [...seen.keys()].find((directory) => json(join(directory, 'package.json')).name === '@mediapipe/tasks-vision');
  if (mediaPipe) copy(join(mediaPipe, 'vision.d.ts'), 'npm/@mediapipe+tasks-vision/copyright-headers.d.ts', { source: '@mediapipe/tasks-vision original declarations and copyright headers' });
  const index = {
    format: 2, scope: 'Actual post-prune server packages, emitted client source-map modules and byte-identical opaque PDF resources; Go modules and embedded notice texts are conservative supersets. Not a legal certification.',
    lockfileSha256: hash(readFileSync(join(root, 'pnpm-lock.yaml'))), goModSha256: hash(readFileSync(join(native, 'go.mod'))),
    goSumSha256: hash(readFileSync(join(native, 'go.sum'))), toolchain,
    fontSources: pinned.filter((source) => source.file.endsWith('-OFL.txt')),
    fontBoundary: 'Actual emitted font bytes must match inspected original name-table metadata by SHA-256. Full family OFL texts and original binary copyright/version/license strings accompany them.',
    packages: packages.sort((a, b) => a.package.localeCompare(b.package, 'en')), goModules, clientMaps, clientAssets, fontAssets, pdfResources, pdfRuntimeFamilies,
    files: files.sort((a, b) => a.path.localeCompare(b.path, 'en')),
    unresolved: unresolved.sort((a, b) => a.package.localeCompare(b.package, 'en')),
  };
  writeFileSync(join(destination, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`copied ${files.length} notice/provenance files to ${destination}; unresolved=${unresolved.length}`);
  for (const issue of unresolved) console.error(`UNRESOLVED NOTICE: ${issue.package}: ${issue.reason}`);
  return index;
}

export function auditNotices(erpRoot, requireComplete = false) {
  const directory = join(resolve(erpRoot), 'third-party-notices');
  const index = json(join(directory, 'index.json'));
  assert.equal(index.format, 2, 'unsupported notice inventory; regenerate exact resource ownership proof');
  assert(index.files.length > 0 && index.packages.length > 0 && index.goModules.length > 0, 'incomplete notice inventory');
  for (const file of index.files) {
    const path = resolve(directory, file.path);
    const rel = relative(directory, path);
    assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'notice path escapes inventory');
    assert.equal(hash(readFileSync(path)), file.sha256, `notice missing or changed: ${file.path}`);
  }
  if (requireComplete) {
    assert(index.clientMaps?.length > 0 && index.clientAssets?.length > 0, 'client artifact evidence missing');
    assert(Array.isArray(index.pdfResources), 'opaque PDF resource ownership proof missing');
    assert(Array.isArray(index.pdfRuntimeFamilies), 'conditional PDF compiler-runtime proof missing');
    for (const family of index.pdfRuntimeFamilies) {
      assert(family.resources.every((path) => index.pdfResources.some((asset) => asset.path === path)), 'PDF runtime proof claims an absent resource');
      assert(family.notices.length > 0 && family.notices.every((path) => index.files.some((file) => file.path === path)), 'original PDF compiler-runtime texts missing');
    }
    for (const asset of index.pdfResources) {
      const base = asset.kind === 'emitted-resource' ? resolve(erpRoot, '.next', 'static') : resolve(erpRoot);
      const path = resolve(base, asset.path);
      assert(path.startsWith(`${base}${sep}`), 'PDF resource path escapes stage');
      assert.equal(hash(readFileSync(path)), asset.sha256, `licensed PDF resource changed: ${asset.path}`);
      assert(index.packages.some((pkg) => pkg.package === asset.owner), `PDF resource has no original full package notices: ${asset.path}`);
    }
    for (const asset of index.clientAssets.filter((file) => /pdf\.worker.*\.mjs$/.test(file.path))) {
      assert(index.pdfResources.some((file) => file.kind === 'emitted-resource' && file.path === asset.path && file.sha256 === asset.sha256), 'opaque PDF worker ownership omitted');
      for (const family of ['openjpeg-glue', 'jbig2-glue']) {
        assert(index.pdfRuntimeFamilies.some((entry) => entry.id === family && entry.resources.includes(asset.path)), `opaque PDF worker runtime notices omitted: ${family}`);
      }
    }
    for (const asset of index.clientAssets) {
      const path = resolve(erpRoot, '.next', 'static', asset.path);
      const base = resolve(erpRoot, '.next', 'static');
      assert(path.startsWith(`${base}${sep}`), 'client asset path escapes stage');
      assert.equal(hash(readFileSync(path)), asset.sha256, `staged client asset changed: ${asset.path}`);
    }
  }
  if (requireComplete) assert.equal(index.unresolved.length, 0, `redistribution blocked: ${index.unresolved.map((issue) => issue.package).join(', ')}; inspect third-party-notices/index.json`);
  return index;
}

export function stripPrivateClientMaps(erpRoot) {
  const erp = resolve(erpRoot);
  auditNotices(erp);
  const directory = join(erp, '.next', 'static');
  const entries = readdirSync(directory, { recursive: true });
  assert(entries.length <= 500000, 'staged static tree exceeded bounded size');
  // Remove every publicly reachable source map, including CSS/raw worker maps.
  // Original source-build maps in the checkout are never changed.
  for (const path of entries.filter((entry) => entry.endsWith('.map'))) {
    rmSync(join(directory, path), { force: true });
  }
}

export function auditOllamaNotices(runtimeRoot) {
  const directory = realpathSync(resolve(runtimeRoot));
  const inventory = json(join(directory, 'RUNTIME_NOTICES.json'));
  assert.equal(inventory.format, 1, 'unsupported incorporated Ollama notice inventory');
  assert(Array.isArray(inventory.files) && inventory.files.length > 0 && inventory.files.length <= 10000
    && Array.isArray(inventory.required) && inventory.required.length > 0, 'empty incorporated Ollama notice inventory');
  const seen = new Set();
  let total = 0;
  for (const file of inventory.files) {
    const path = resolve(directory, file.path);
    const rel = relative(directory, path);
    assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'Ollama notice path escapes runtime');
    assert(!seen.has(file.path) && realpathSync(path).startsWith(`${directory}${sep}`), 'duplicate/escaping original Ollama notice');
    seen.add(file.path);
    const size = statSync(path).size;
    total += size;
    assert(size > 0 && size <= 4 * 1024 * 1024 && total <= 16 * 1024 * 1024, 'invalid original Ollama notice size');
    assert.equal(size, file.bytes, `original Ollama notice size changed: ${file.path}`);
    assert.equal(hash(readFileSync(path)), file.sha256, `original Ollama notice changed: ${file.path}`);
  }
  for (const path of inventory.required) assert(seen.has(path), `incorporated Ollama full notice missing: ${path}`);
  return inventory;
}

async function runtimeNoticeCollectors() {
  const [auth, postgres, postgrest] = await Promise.all([
    import('./auth/collect-notices.mjs'),
    import('./postgres/collect-notices.mjs'),
    import('./postgrest/collect-notices.mjs'),
  ]);
  return { auth, postgres, postgrest };
}

export async function collectRuntimeNotices(bundleRoot, postgrestBuildRoot) {
  const bundle = realpathSync(resolve(bundleRoot));
  const collectors = await runtimeNoticeCollectors();
  const target = json(join(bundle, 'erp', 'native-dependencies.json')).target;
  const apiBinary = join(bundle, 'postgrest', target.startsWith('win32-') ? 'postgrest.exe' : 'postgrest');
  const scratch = mkdtempSync(join(tmpdir(), 'bbn-runtime-notices-'));
  const components = [
    { name: 'auth', input: join(bundle, 'auth'), actual: join(bundle, 'auth'), collect: collectors.auth.collectAuthNotices, audit: collectors.auth.auditAuthNotices },
    { name: 'postgres', input: join(bundle, 'postgres'), actual: join(bundle, 'postgres'), collect: collectors.postgres.collectPostgresNotices, audit: collectors.postgres.auditPostgresNotices },
    { name: 'postgrest', input: postgrestBuildRoot && realpathSync(resolve(postgrestBuildRoot)), actual: apiBinary, collect: collectors.postgrest.collectPostgrestNotices, audit: collectors.postgrest.auditPostgrestNotices },
  ];
  try {
    for (const component of components) {
      const parent = realpathSync(join(bundle, component.name));
      assert(parent.startsWith(`${bundle}${sep}`), 'component notice destination escapes owned runtime bundle');
      const destination = join(parent, 'third-party-notices');
      if (existsSync(join(destination, 'index.json'))) {
        component.audit(destination, component.actual);
        continue; // Reuse already complete source-built component materials.
      }
      assert(component.input, `realized ${component.name} build root required to collect actual source/recombination material`);
      const generated = join(scratch, component.name);
      await component.collect(component.input, generated);
      component.audit(generated, component.actual);
      assert(!existsSync(destination), `unmanaged/partial component notice directory requires review: ${destination}`);
      const staged = join(parent, `.third-party-notices-${scratch.split(sep).at(-1)}`);
      try {
        cpSync(generated, staged, { recursive: true, verbatimSymlinks: true });
        renameSync(staged, destination);
      } finally {
        rmSync(staged, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`prepared complete native component source/notices in ${bundle}`);
}

export async function auditBundleNotices(bundleRoot) {
  const bundle = realpathSync(resolve(bundleRoot));
  const index = auditNotices(join(bundle, 'erp'), true);
  assert(!readdirSync(join(bundle, 'erp', '.next', 'static'), { recursive: true }).some((path) => path.endsWith('.map')),
    'private source map survived in public static assets');
  for (const path of ['NODE_LICENSE', 'auth/AUTH_LICENSE.txt', 'postgrest/POSTGREST_LICENSE.txt', 'ollama/OLLAMA_LICENSE.txt',
    'postgres/POSTGRESQL_LICENSE.txt', 'postgres/POSTGRESQL_CLIENT_LICENSE.txt', 'postgres/ZLIB_LICENSE.txt']) {
    assert(statSync(join(bundle, path)).size > 0, `existing runtime license missing: ${path}`);
  }
  const nodeSource = json(join(root, 'packaging', 'node', 'notice-source.json'));
  const nodeText = readFileSync(join(bundle, 'NODE_LICENSE'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(Buffer.byteLength(nodeText), nodeSource.licenseBytes, 'full original Node license size mismatch');
  assert.equal(hash(nodeText), nodeSource.licenseSha256, 'Node original full third-party notice text changed');
  const nativeProof = json(join(bundle, 'erp', 'native-dependencies.json'));
  const suffix = nativeProof.target.startsWith('win32-') ? '.exe' : '';
  for (const path of [`node${suffix}`, `auth/auth${suffix}`, `postgrest/postgrest${suffix}`,
    `postgres/bin/postgres${suffix}`, `postgres/bin/initdb${suffix}`, `postgres/bin/pg_ctl${suffix}`,
    `postgres/bin/psql${suffix}`, `postgres/bin/pg_dump${suffix}`, `postgres/bin/pg_restore${suffix}`,
    nativeProof.target.startsWith('linux-') ? 'ollama/bin/ollama' : `ollama/ollama${suffix}`]) {
    assert(statSync(join(bundle, path)).isFile() && statSync(join(bundle, path)).size > 0, `licensed runtime payload missing: ${path}`);
  }
  assert(statSync(join(bundle, 'erp', nativeProof.rasterHelper.path)).size > 0, 'licensed raster helper missing');
  for (const component of ['auth', 'postgres', 'postgrest']) {
    const notices = realpathSync(join(bundle, component, 'third-party-notices'));
    assert(notices.startsWith(`${bundle}${sep}`), 'component notices escape the actual runtime bundle');
  }
  const collectors = await runtimeNoticeCollectors();
  const auth = collectors.auth.auditAuthNotices(join(bundle, 'auth', 'third-party-notices'), join(bundle, 'auth'));
  const postgres = collectors.postgres.auditPostgresNotices(join(bundle, 'postgres', 'third-party-notices'), join(bundle, 'postgres'));
  const postgrest = collectors.postgrest.auditPostgrestNotices(join(bundle, 'postgrest', 'third-party-notices'), join(bundle, 'postgrest', `postgrest${suffix}`));
  const ollama = auditOllamaNotices(join(bundle, 'ollama'));
  const [platform, architecture] = nativeProof.target.split('-');
  assert.equal(auth.platform.GOOS, platform === 'win32' ? 'windows' : platform, 'Auth notices belong to another OS');
  assert.equal(auth.platform.GOARCH, architecture === 'x64' ? 'amd64' : architecture, 'Auth notices belong to another architecture');
  assert.equal(postgres.platform, nativeProof.target, 'PostgreSQL notices belong to another platform');
  assert.equal(json(join(bundle, 'postgrest', 'third-party-notices', postgrest.provenance.build)).target, nativeProof.target, 'PostgREST source proof belongs to another platform');
  assert.equal(hash(readFileSync(join(bundle, 'auth', 'AUTH_LICENSE.txt'))), auth.externalNotices.find((notice) => notice.path === 'packaging/auth/AUTH_LICENSE.txt').sha256, 'actual Auth root license changed');
  assert.equal(hash(readFileSync(join(bundle, 'postgrest', 'POSTGREST_LICENSE.txt')).toString('utf8').replace(/\r\n/g, '\n')),
    hash(readFileSync(join(root, 'packaging', 'postgrest', 'POSTGREST_LICENSE.txt')).toString('utf8').replace(/\r\n/g, '\n')), 'actual PostgREST root license changed');
  console.log(`native component proof: Auth ${auth.files.length}, PostgreSQL ${postgres.files.length}, PostgREST ${postgrest.files.length}, Ollama ${ollama.files.length} original notice/source files; component source requirements satisfied`);
  console.log(`notice stage proof: ${bundle}/erp/third-party-notices/index.json (${index.files.length} notice/provenance files)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, destination, postgrestBuildRoot, ...extra] = process.argv.slice(2);
  assert(['collect', 'audit', 'bundle', 'runtime'].includes(mode) && destination && extra.length === 0
    && (mode === 'runtime' || !postgrestBuildRoot), 'usage: collect-notices.mjs collect|audit ERP | bundle BUNDLE | runtime BUNDLE POSTGREST_BUILD_ROOT');
  if (mode === 'collect') collectNotices(destination);
  else if (mode === 'audit') { auditNotices(destination, true); console.log('notice stage proof passed'); }
  else if (mode === 'runtime') await collectRuntimeNotices(destination, postgrestBuildRoot);
  else await auditBundleNotices(destination);
}
