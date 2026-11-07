import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function exec(cmd,args,cwd) {
  const r=spawnSync(cmd,args,{cwd,encoding:'utf8',maxBuffer:128*1024*1024});
  if(r.status!==0) throw new Error(`${cmd}: ${r.stderr || r.error}`);
  return r.stdout;
}
function walk(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[]);
}
function field(text,key) {
  const m=text.match(new RegExp(`^${key}:\\s*([^\\r\\n]+)`,'im'));
  if(!m) throw new Error(`Missing ${key} metadata`);
  return m[1].trim();
}
export async function emitProvenance(c) {
  const {root,repo,source,prefix,ghc,plan,appSource,ghcSource,ghcArchive,cabalSource,cabalArchive,pkgconfSource,commit,target,version,artifact,commands}=c;
  const rel=p=>path.relative(root,p).split(path.sep).join('/');
  const components=[];
  const material=(p,role)=>({path:rel(p),sha256:hash(p),role});
  const downloads=path.join(root,'downloads/hackage'); fs.mkdirSync(downloads,{recursive:true});
  async function fetchPinned(filename,url,expected) {
    const p=path.join(downloads,filename);
    if(!fs.existsSync(p)) exec('curl',['-fL','--retry','3','--connect-timeout','30','--max-time','180','-o',p,url],root);
    if(hash(p)!==expected) throw new Error(`Source checksum mismatch: ${filename}`);
    return {path:rel(p),filename,url,sha256:expected};
  }
  const bootRoot=path.join(root,'ghc-9.10.3');
  const packageDb=walk(path.join(ghc,'lib')).filter(p=>p.includes('package.conf.d')&&p.endsWith('.conf'));
  const sourceFiles=walk(path.join(bootRoot,'libraries')).filter(p=>/\.cabal(?:\.in)?$/.test(p));
  for(const p of plan['install-plan']) {
    const name=p['pkg-name'],ver=p['pkg-version'];
    let src,license,sourceSubdirectory,cabalFile,noticePaths;
    if(p.type==='pre-existing') {
      const conf=packageDb.find(f=>path.basename(f)===`${p.id}.conf`);
      if(!conf) throw new Error(`Missing installed compiler metadata ${p.id}`);
      license=field(fs.readFileSync(conf,'utf8'),'license');
      src=ghcSource;
      let dir;
      if(name==='rts') dir=path.join(bootRoot,'rts');
      else if(name==='system-cxx-std-lib') dir=path.join(bootRoot,'mk');
      else {
        const f=sourceFiles.find(f=>path.basename(f)===`${name}.cabal`||path.basename(f)===`${name}.cabal.in`);
        if(!f) throw new Error(`Missing compiler package source ${name}`);
        dir=path.dirname(f);
      }
      sourceSubdirectory=path.relative(root,dir).split(path.sep).join('/');
      noticePaths=['ghc-9.10.3/LICENSE'];
    } else if(p.style==='local') {
      src=appSource;sourceSubdirectory=`postgrest-${commit}`;
      license=field(fs.readFileSync(path.join(source,'postgrest.cabal'),'utf8'),'license');
    } else {
      const filename=`${name}-${ver}.tar.gz`;
      const cached=path.join(root,'cabal/packages/hackage.haskell.org',name,ver,filename);
      if(fs.existsSync(cached)&&!fs.existsSync(path.join(downloads,filename))) fs.copyFileSync(cached,path.join(downloads,filename));
      src=await fetchPinned(filename,`https://hackage.haskell.org/package/${name}-${ver}/${filename}`,p['pkg-src-sha256']);
      cabalFile=await fetchPinned(`${name}-${ver}-revision-${p['pkg-revision']}.cabal`,`https://hackage.haskell.org/package/${name}-${ver}/revision/${p['pkg-revision']}.cabal`,p['pkg-cabal-sha256']);
      license=field(fs.readFileSync(path.join(root,cabalFile.path),'utf8'),'license');
      sourceSubdirectory=`${name}-${ver}`;
    }
    const dependencies=[...new Set(p.depends||[])];
    if(name==='ghc-bignum') dependencies.push('native-gmp-6.3.0');
    if(name==='postgresql-libpq') dependencies.push('native-postgresql-16.15');
    if(name==='zlib') dependencies.push('native-zlib-1.3.1');
    if(name==='rts'&&target.startsWith('linux-')) dependencies.push('native-libffi-3.4.6');
    components.push({id:p.id,name,version:ver,kind:p.type==='pre-existing'?'compiler-runtime':p.style==='local'?'application':'haskell',license,source:src,sourceSubdirectory,...(cabalFile?{cabalFile}:{}),...(noticePaths?{noticePaths}:{}),dependencies,buildDependencies:p['exe-depends']||[],flags:p.flags||{},component:p['component-name']||'lib'});
  }
  const native=(id,name,version,license,filename,url,expected)=>{
    const p=path.join(prefix,'sources',filename);
    if(hash(p)!==expected) throw new Error(`Static dependency checksum mismatch: ${filename}`);
    components.push({id,name,version,kind:'native',license,source:{path:rel(p),filename,url,sha256:expected},dependencies:[]});
  };
  native('native-postgresql-16.15','PostgreSQL','16.15','PostgreSQL','postgresql-16.15.tar.bz2','https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2','c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed');
  native('native-zlib-1.3.1','zlib','1.3.1','Zlib','zlib-1.3.1.tar.gz','https://zlib.net/fossils/zlib-1.3.1.tar.gz','9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23');
  const gmp=path.join(bootRoot,'libraries/ghc-bignum/gmp/gmp-tarballs/gmp-6.3.0-nodoc.tar.xz');
  const patch=path.join(bootRoot,'libraries/ghc-bignum/gmp/gmp-tarballs/gmpsrc.patch');
  components.push({id:'native-gmp-6.3.0',name:'GMP',version:'6.3.0',kind:'native',license:'LGPL-3.0-or-later OR GPL-2.0-or-later',source:{path:rel(gmp),filename:path.basename(gmp),sha256:hash(gmp)},dependencies:[],origin:{compilerSource:ghcSource,archiveMember:'ghc-9.10.3/libraries/ghc-bignum/gmp/gmp-tarballs/gmp-6.3.0-nodoc.tar.xz',patch:rel(patch)}});
  if(target.startsWith('linux-')) {
    const ffi=path.join(bootRoot,'libffi-tarballs/libffi-3.4.6.tar.gz');
    components.push({id:'native-libffi-3.4.6',name:'libffi',version:'3.4.6',kind:'native',license:'MIT',source:{path:rel(ffi),filename:path.basename(ffi),sha256:hash(ffi)},dependencies:[],origin:{compilerSource:ghcSource,archiveMember:'ghc-9.10.3/libffi-tarballs/libffi-3.4.6.tar.gz'}});
  }
  const byId=new Map(components.map(p=>[p.id,p]));
  const entry=plan['install-plan'].find(p=>p['pkg-name']==='postgrest'&&p['component-name']==='exe:postgrest');
  const closure=new Set();
  function visit(id){if(closure.has(id))return;const p=byId.get(id);if(!p)throw new Error(`Unresolved dependency ${id}`);closure.add(id);p.dependencies.forEach(visit);}
  visit(entry.id);
  const materials=[material(path.join(root,'realized-plan.json'),'realized-package-plan'),material(path.join(root,'native-link-audit.txt'),'native-link-audit'),material(path.join(root,'compiler-info.txt'),'compiler-settings'),material(path.join(root,'compiler-packages.txt'),'compiler-package-database'),material(path.join(root,'build.log'),'link-command-log'),material(path.join(root,'commands.json'),'build-commands'),material(patch,'source-patch')];
  for(const [filename,role] of [['cabal.project.freeze','realized-package-freeze'],['cabal.project.local','native-link-settings'],['postgrest.cabal','application-package-metadata']]) materials.push(material(path.join(source,filename),role));
  materials.push(material(path.join(prefix,'CLIENT_PROVENANCE'),'native-source-provenance'));
  materials.push(material(path.join(prefix,'STATIC_PREFIX_MANIFEST.sha256'),'native-byte-manifest'));
  exec(process.execPath,[path.join(repo,'packaging/installation-information.mjs'),path.join(root,'materials')],root);
  materials.push(material(path.join(root,'materials/installation-information.txt'),'installation-information'),material(path.join(root,'materials/installation-information.json'),'installation-source-metadata'));
  const recipes=path.join(root,'recipes');fs.mkdirSync(recipes,{recursive:true});
  for(const filename of ['packaging/postgrest/build.mjs','packaging/postgrest/provenance.mjs','packaging/postgrest/relink.mjs','packaging/postgres/assemble-clients.sh','packaging/installation-information.mjs']) {
    const dest=path.join(recipes,path.basename(filename));fs.copyFileSync(path.join(repo,filename),dest);materials.push(material(dest,'build-recipe'));
  }
  // The exact final linker invocation and every non-OS input are bundled with
  // paths rewritten relative to the archive root by the dedicated relink tool.
  const { prepareRelink }=await import('./relink.mjs');
  const relink=prepareRelink({root,source,ghc,prefix,plan,target});
  materials.push(material(relink.archive,'relinkable-objects'),material(relink.instructions,'recombination-instructions'));
  fs.writeFileSync(path.join(root,'source-components.json'),JSON.stringify(components,null,2)+'\n');
  const provenance={format:1,version,target,source:{commit,...appSource},artifact:{path:rel(artifact),sha256:hash(artifact)},toolchain:{ghc:{version:'9.10.3',binary:ghcArchive,source:ghcSource},cabal:{version:'3.18.2.0',binary:cabalArchive,source:cabalSource},pkgconf:{version:'2.3.0',source:pkgconfSource}},staticPrefix:rel(prefix),realizedPlan:rel(path.join(root,'realized-plan.json')),commands,noticeInputs:{components,materials,runtimeClosure:[...closure]}};
  fs.writeFileSync(path.join(root,'build-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
}
