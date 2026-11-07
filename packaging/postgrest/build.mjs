#!/usr/bin/env node
// Native source build only. Run: node packaging/postgrest/build.mjs OWNED_BUILD_ROOT
// All downloads, package databases, tool installs and artifacts stay in that root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || root === process.cwd()) throw new Error('Supply a dedicated build root');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = `${process.platform}-${process.arch}`;
const platforms = {
  'darwin-arm64': ['aarch64-apple-darwin', '9f50ddd87be5cb994c719402778d6c7fdd341934fd4fbc0fcc3ecb40d49f860c', 'aarch64-apple-darwin', 'd91f76cf9539d927205858c42d0c1fe3868dea89f54a5dd6151f9c3fdd56f21f'],
  'linux-x64': ['x86_64-deb12-linux', '1ac63f04eac0ad551d45cbde38f27e0e3f43ceefd98833fae1fa3f2dbd042367', 'x86_64-linux-unknown', 'b4f4c83135da77cfc18ccd6056398ca714a2dad86d5f635621ffdda8f9afe587'],
  'win32-x64': ['x86_64-unknown-mingw32', 'ad17bdbee5f195d50024da1447f458071d9d8a34f90d76907c873abaf95d893f', 'x86_64-mingw64', '7430982fd2aedef41539155d819e7e24349c664206ecf8c6e53c1c31acdbe630'],
};
if (!platforms[target]) throw new Error(`Unsupported native build host ${target}`);
const [ghcPlatform, ghcSha, cabalPlatform, cabalSha] = platforms[target];
const suffix = process.platform === 'win32' ? '.exe' : '';
const commit = '798523c910c09dc56d92ba2c42bcb78e5f59ecb3';
const source = path.join(root, `postgrest-${commit}`);
const prefix = path.join(root, 'static-prefix');
const bin = path.join(root, 'tool-bin');
const ghc = path.join(root, 'ghc');
fs.mkdirSync(path.join(root, 'downloads'), { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(root,'ghc-tmp'),{recursive:true});
const env = { ...process.env, PATH: [bin, path.join(ghc, 'bin'), path.join(root, 'pkgconf/bin'), path.join(prefix, 'bin'), ...(process.platform === 'win32' ? [process.env.PATH] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(path.delimiter), CABAL_DIR: path.join(root, 'cabal'), PKG_CONFIG_LIBDIR: path.join(prefix, 'lib/pkgconfig'), PKG_CONFIG_PATH: '', MACOSX_DEPLOYMENT_TARGET: '12.0' };
env.TMPDIR = path.join(root,'ghc-tmp');
// The Hackage libpq configure links -lpq alone; the pinned static libpq needs its
// companion static libraries too (nothing else is changed in the hermetic env).
if (process.platform === 'linux') env.ac_cv_POSTGRESQL_LIBS = '-lpq -lpgcommon -lpgport -lssl -lcrypto -lz -lpthread -ldl';
for (const k of ['CPPFLAGS','CFLAGS','CXXFLAGS','LDFLAGS','LIBS','CPATH','LIBRARY_PATH','LD_LIBRARY_PATH','DYLD_LIBRARY_PATH','GHC_PACKAGE_PATH','GHC_ENVIRONMENT']) delete env[k];
const commandsFile = path.join(root,'commands.json');
const commands = fs.existsSync(commandsFile) ? JSON.parse(fs.readFileSync(commandsFile,'utf8')) : [];
function run(cmd, args = [], cwd = root, capture = false) {
  if (process.platform === 'win32' && cmd === 'sh') {
    // Native Node supplies Windows separators; sh's dirname/configure expect
    // forward-slash paths even when the drive-qualified path is unchanged.
    args = args.map((value) => value.replaceAll('\\', '/'));
  }
  commands.push({ cmd, args, cwd: path.relative(root, cwd) || '.', env: { PATH: env.PATH, CABAL_DIR: env.CABAL_DIR, PKG_CONFIG_LIBDIR: env.PKG_CONFIG_LIBDIR } });
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: capture ? ['ignore','pipe','pipe'] : 'inherit', maxBuffer: 128 * 1024 * 1024 });
  fs.writeFileSync(path.join(root, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  if (capture && cmd === 'cabal' && args[0] === 'build' && !args.includes('--dry-run')) fs.appendFileSync(path.join(root,'build.log'),(r.stdout || '') + '\n' + (r.stderr || '') + '\n');
  if (r.status !== 0 && cmd === 'cabal') {
    // Make configure failures diagnosable in CI: print the tail of each config.log.
    const walk = (d, depth = 0) => depth > 8 ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), depth + 1) : e.name === 'config.log' ? [path.join(d, e.name)] : []);
    for (const log of walk(cwd).slice(-3)) console.error(`--- ${log}\n${fs.readFileSync(log, 'utf8').split('\n').slice(-60).join('\n')}`);
  }
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr || r.error || ''}`);
  return r.stdout;
}
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function acquire(filename, url, expected) {
  const dest = path.join(root, 'downloads', filename);
  if (!fs.existsSync(dest)) run('curl', ['-fL','--retry','3','--connect-timeout','30','--max-time','600','-o',dest,url]);
  if (sha(dest) !== expected) throw new Error(`Checksum mismatch: ${filename}`);
  return { path: path.relative(root,dest), filename, url, sha256: expected };
}
const appSource = await acquire('postgrest-16.5.tar.gz', `https://codeload.github.com/PostgREST/postgrest/tar.gz/${commit}`, '431d2465018f9c06e21bab81fd6709a9a3978a55cd2b28d67da4ae1775c7c302');
if (!fs.existsSync(source)) run('tar', ['-xzf',path.join(root,appSource.path),'-C',root]);
const ghcArchive = await acquire(`ghc-9.10.3-${ghcPlatform}.tar.xz`, `https://downloads.haskell.org/~ghc/9.10.3/ghc-9.10.3-${ghcPlatform}.tar.xz`, ghcSha);
const ghcSource = await acquire('ghc-9.10.3-src.tar.xz', 'https://downloads.haskell.org/~ghc/9.10.3/ghc-9.10.3-src.tar.xz', 'd266864b9e0b7b741abe8c9d6a790d7c01c21cf43a1419839119255878ebc59a');
if (!fs.existsSync(path.join(root,'ghc-9.10.3'))) run('tar',['-xJf',path.join(root,ghcSource.path),'-C',root]);
const cabalExt = process.platform === 'win32' ? 'zip' : 'tar.xz';
const cabalArchive = await acquire(`cabal-install-3.18.2.0-${cabalPlatform}.${cabalExt}`, `https://downloads.haskell.org/~cabal/cabal-install-3.18.2.0/cabal-install-3.18.2.0-${cabalPlatform}.${cabalExt}`, cabalSha);
const cabalSource = await acquire('cabal-3.18.2.0-src.tar.gz', 'https://downloads.haskell.org/~cabal/cabal-install-3.18.2.0/cabal-3.18.2.0-src.tar.gz', '503121b06587065c0d22e9d61df7ce4c59230991fe0cdfbfb634ce080cce329a');
if (!fs.existsSync(path.join(bin,`cabal${suffix}`))) run(process.platform === 'win32' ? 'unzip' : 'tar', process.platform === 'win32' ? [path.join(root,cabalArchive.path),'-d',bin] : ['-xJf',path.join(root,cabalArchive.path),'-C',bin]);
if (!fs.existsSync(path.join(ghc,'bin',`ghc${suffix}`))) {
  if (process.platform === 'win32') {
    fs.mkdirSync(ghc,{recursive:true});
    run('tar',['-xJf',path.join(root,ghcArchive.path),'-C',ghc,'--strip-components=1']);
  } else {
    const bindist = path.join(root,'ghc-bindist');
    fs.mkdirSync(bindist,{recursive:true});
    if (!fs.existsSync(path.join(bindist,'configure'))) run('tar',['-xJf',path.join(root,ghcArchive.path),'-C',bindist,'--strip-components=1']);
    run('./configure',[`--prefix=${ghc}`],bindist);
    run('make',['install'],bindist);
  }
}
const pkgconfSource = await acquire('pkgconf-2.3.0.tar.xz', 'https://distfiles.dereferenced.org/pkgconf/pkgconf-2.3.0.tar.xz', '3a9080ac51d03615e7c1910a0a2a8df08424892b5f13b0628a204d3fcce0ea8b');
if (!fs.existsSync(path.join(root,'pkgconf/bin',`pkgconf${suffix}`))) {
  if (!fs.existsSync(path.join(root,'pkgconf-2.3.0'))) run('tar',['-xJf',path.join(root,pkgconfSource.path),'-C',root]);
  run('sh',['./configure',`--prefix=${path.join(root,'pkgconf')}`,'--disable-shared'],path.join(root,'pkgconf-2.3.0'));
  run('make',['-j2'],path.join(root,'pkgconf-2.3.0'));
  run('make',['install'],path.join(root,'pkgconf-2.3.0'));
}
if (!fs.existsSync(path.join(bin,`pkg-config${suffix}`))) fs.copyFileSync(path.join(root,'pkgconf/bin',`pkgconf${suffix}`),path.join(bin,`pkg-config${suffix}`));
const clientRecord = path.join(prefix,'CLIENT_PROVENANCE');
const clientRecipe=path.join(repo,'packaging/postgres/assemble-clients.sh');
const record=fs.existsSync(clientRecord)?fs.readFileSync(clientRecord,'utf8'):'';
if (!record.includes('postgres_clients_sha256=c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed') || !record.includes(`postgres_clients_recipe_sha256=${sha(clientRecipe)}`)) run('sh',[clientRecipe,path.join(root,'clients'),prefix]);
const staticManifest=path.join(prefix,'STATIC_PREFIX_MANIFEST.sha256');
if(!fs.readFileSync(clientRecord,'utf8').includes(`static_prefix_manifest_sha256=${sha(staticManifest)}`)) throw new Error('Static prefix manifest differs from actual client build');
for(const line of fs.readFileSync(staticManifest,'utf8').trim().split('\n')) {
  const m=/^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
  if(!m||path.isAbsolute(m[2])||m[2].split(/[\\/]/).includes('..')||sha(path.join(prefix,m[2]))!==m[1])throw new Error(`Static build input changed: ${line}`);
}
// On Linux the official GHC bindist expects system GMP/libffi. Supply static
// builds from its checksum-pinned corresponding sources instead. macOS uses
// Apple's OS libffi and GMP already embedded in the official ghc-bignum archive.
if (process.platform === 'linux') {
  const native = path.join(root,'native-runtime');
  fs.mkdirSync(native,{recursive:true});
  for (const dep of [
    { name:'gmp-6.3.0', archive:'libraries/ghc-bignum/gmp/gmp-tarballs/gmp-6.3.0-nodoc.tar.xz', sha:'5312838fe855512acfea6ea24197b8620643a823fe309dc6faceb3eee214f4f0', lib:'libgmp.a', flags:['--with-pic'] },
    { name:'libffi-3.4.6', archive:'libffi-tarballs/libffi-3.4.6.tar.gz', sha:'b0dea9df23c863a7a50e825440f3ebffabd65df1497108e5d437747843895a4e', lib:'libffi.a', flags:[] },
  ]) {
    const archive=path.join(root,'ghc-9.10.3',dep.archive);
    if(sha(archive)!==dep.sha)throw new Error(`Bundled native source mismatch: ${dep.name}`);
    if(fs.existsSync(path.join(prefix,'lib',dep.lib)))continue;
    run('tar',['-xf',archive,'-C',native]);
    const dir=path.join(native,dep.name);
    // GMP 6.3.0's configure probes use pre-C23 syntax; GCC 14+/15 reject them as
    // "no working compiler". Pin the language dialect for these pinned old sources.
    run('sh',['./configure',`--prefix=${prefix}`,`--libdir=${path.join(prefix,'lib')}`,'--disable-shared','--enable-static',...dep.flags,'CC=cc -std=gnu17'],dir);
    run('make',['-j2'],dir);
    run('make',['install'],dir);
  }
}
fs.mkdirSync(env.CABAL_DIR,{recursive:true});
const config = path.join(env.CABAL_DIR,'config');
if (!fs.existsSync(config)) fs.writeFileSync(config, `repository hackage.haskell.org\n  url: https://hackage.haskell.org/\n  secure: True\nremote-repo-cache: ${path.join(env.CABAL_DIR,'packages').replaceAll('\\', '/')}\nstore-dir: ${path.join(env.CABAL_DIR,'store').replaceAll('\\', '/')}\n`);
if (!fs.existsSync(path.join(env.CABAL_DIR,'packages/hackage.haskell.org/01-index.tar'))) run('cabal',['update'],source);
// Preserve the upstream index-state; the generated freeze captures every solved
// package/flag. Only the executable is built, never test suites or the ERP app.
const local = `tests: False\nbenchmarks: False\nshared: False\nexecutable-dynamic: False\nextra-include-dirs: ${path.join(prefix,'include').replaceAll('\\', '/')}\nextra-lib-dirs: ${path.join(prefix,'lib').replaceAll('\\', '/')}\npackage zlib\n  flags: -pkg-config\n`;
fs.writeFileSync(path.join(source,'cabal.project.local'), local);
run('cabal',['build','exe:postgrest','--dry-run','--jobs=2'],source);
run('cabal',['freeze'],source);
const planPath = path.join(source,'dist-newstyle/cache/plan.json');
let plan = JSON.parse(fs.readFileSync(planPath));
fs.copyFileSync(planPath,path.join(root,'realized-plan.json'));
run('cabal',['build','exe:postgrest','--jobs=2','--verbose=2','--ghc-options=-v -j2 -keep-tmp-files -fno-use-rpaths'],source,true);
plan = JSON.parse(fs.readFileSync(planPath));
fs.copyFileSync(planPath,path.join(root,'realized-plan.json'));
const binary = run('cabal',['list-bin','exe:postgrest'],source,true).trim();
fs.mkdirSync(path.join(root,'artifact'),{recursive:true});
const artifact = path.join(root,'artifact',`postgrest${suffix}`);
fs.copyFileSync(binary,artifact); fs.chmodSync(artifact,0o755);
const version = run(artifact,['--version'],root,true).trim();
if (!/^PostgREST 16\.5(?:\s|$)/i.test(version)) throw new Error(`Unexpected version: ${version}`);
let audit;
if (process.platform === 'darwin') {
  const deps = run('otool',['-L',artifact],root,true);
  const loads = run('otool',['-l',artifact],root,true);
  for (const line of deps.split('\n').slice(1).filter(x=>x.trim())) if (!/^\s+\/(usr\/lib|System\/Library)\//.test(line)) throw new Error(`Non-OS dependency: ${line}`);
  if (/cmd LC_RPATH/.test(loads)) throw new Error('Unexpected executable rpath');
  audit = deps + '\n' + loads;
} else if (process.platform === 'linux') {
  audit = run('readelf',['-d',artifact],root,true);
  if (/\((?:RPATH|RUNPATH)\)/.test(audit)) throw new Error('Unexpected executable rpath');
  for (const m of audit.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)) if (!/^(libc|libm|libpthread|libdl|librt)\.so\./.test(m[1])) throw new Error(`Non-OS dependency: ${m[1]}`);
} else {
  audit = run('objdump',['-p',artifact],root,true);
  for (const m of audit.matchAll(/DLL Name:\s*(\S+)/g)) if (!/^(kernel32|advapi32|bcrypt|crypt32|secur32|shell32|user32|ws2_32|wldap32|winmm|iphlpapi|msvcrt|ucrtbase|ntdll|api-ms-win-[\w-]+)\.dll$/i.test(m[1])) throw new Error(`Non-OS dependency: ${m[1]}`);
}
fs.writeFileSync(path.join(root,'native-link-audit.txt'),audit);
fs.writeFileSync(path.join(root,'compiler-info.txt'),run('ghc',['--info'],root,true));
fs.writeFileSync(path.join(root,'compiler-packages.txt'),run('ghc-pkg',['dump'],root,true));
// Source/notice closure and relocatable relinking material are emitted by the
// adjacent provenance module from this exact realized plan, not a resolver name.
const { emitProvenance } = await import('./provenance.mjs');
await emitProvenance({root,repo,source,prefix,ghc,plan,planPath,appSource,ghcSource,ghcArchive,cabalSource,cabalArchive,pkgconfSource,commit,target,version,artifact,commands});
console.log(`Portable PostgREST artifact: ${artifact}`);
