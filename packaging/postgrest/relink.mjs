import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
function run(cmd,args,cwd) {
  const p=spawnSync(cmd,args,{cwd,encoding:'utf8',maxBuffer:128*1024*1024});
  if(p.status!==0) throw new Error(`${cmd}: ${p.stderr || p.error}`);
  return p.stdout;
}
function words(s) {
  const out=[];let word='',quote=null,started=false;
  for(let i=0;i<s.length;i++) {
    const c=s[i];
    if(quote) {if(c===quote)quote=null;else if(c==='\\'&&quote==='"'&&i+1<s.length)word+=s[++i];else word+=c;started=true;}
    else if(c==='"'||c==="'"){quote=c;started=true;}
    else if(c==='\\'&&i+1<s.length){word+=s[++i];started=true;}
    else if(/\s/.test(c)){if(started){out.push(word);word='';started=false;}}
    else {word+=c;started=true;}
  }
  if(quote)throw new Error('Unterminated linker command quote');
  if(started)out.push(word);return out;
}
export function prepareRelink({root,source,target}) {
  const stage=path.join(root,'relink-materials');
  fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
  const aliases=[root,fs.realpathSync(root)].sort((a,b)=>b.length-a.length);
  const log=fs.readFileSync(path.join(root,'build.log'),'utf8');
  const candidates=log.split('\n').filter(l=>l.includes('-o')&&l.includes('postgrest')).map(l=>{
    try{return words(l.trim());}catch{return [];}
  }).filter(a=>a.length>2&&/(?:^|[-/\\])(?:gcc|clang|cc)(?:\.exe)?$/.test(a[0])&&a.includes('-o')&&!a.includes('-E')&&!a.includes('-c')&&/(?:^|[/\\])postgrest(?:\.exe)?$/.test(a[a.indexOf('-o')+1]));
  if(!candidates.length)throw new Error('No actual native linker invocation in GHC verbose log');
  const command=candidates.at(-1);
  let args=command.slice(1);
  function expand(a) {return a.flatMap(x=>x.startsWith('@')?expand(words(fs.readFileSync(path.resolve(source,x.slice(1)),'utf8'))):[x]);}
  args=expand(args);
  const outputIndex=args.indexOf('-o')+1;
  if(!outputIndex)throw new Error('Missing linker output');
  let sdk='';if(target.startsWith('darwin-'))sdk=run('xcrun',['--show-sdk-path'],root).trim();
  const sdkRoots=new Set([sdk,...args.flatMap(a=>a.match(/\/(?:Library\/Developer|Applications\/Xcode[^/]*)\/[^,]*\/SDKs\/MacOSX[^/]*\.sdk/g)||[])].filter(Boolean));
  function relative(p) {
    const absolute=path.resolve(source,p);
    for(const base of aliases)if(absolute===base||absolute.startsWith(base+path.sep))return path.relative(base,absolute);
    return null;
  }
  const inputs=new Set();
  function copy(p) {
    const r=relative(p);if(r===null)throw new Error(`Non-owned relink input: ${p}`);
    const from=path.resolve(source,p),to=path.join(stage,r);
    if(!fs.existsSync(from)||!fs.statSync(from).isFile())throw new Error(`Missing native relink input: ${from}`);
    fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);inputs.add(r);return r;
  }
  const libdirs=args.filter(x=>x.startsWith('-L')).map(x=>path.resolve(source,x.slice(2)));
  for(const a of args) {
    if(a.startsWith('-l')) {
      const name=a.slice(2);
      const f=libdirs.map(d=>path.join(d,`lib${name}.a`)).find(p=>fs.existsSync(p)&&relative(p)!==null);
      if(f)copy(f);
      else if(/^HS|^(?:pq|z|gmp)$/.test(name))throw new Error(`Missing pinned static linker library ${name}`);
    } else if(/\.(?:o|a)$/.test(a)&&a!==args[outputIndex])copy(a);
  }
  function rewrite(a) {
    let result=a;
    for(const base of aliases)result=result.split(base).join('@ROOT@');
    for(const sdkRoot of sdkRoots)result=result.split(sdkRoot).join('@SDK@');
    if(/\/(?:opt\/homebrew|usr\/local)\//.test(result))throw new Error(`Foreign native linker input ${a}`);
    return result;
  }
  const rewritten=args.map(rewrite);rewritten[outputIndex]='@OUTPUT@';
  // GHC may supply an ld file list rather than individual object arguments.
  for(let i=0;i<args.length;i++) {
    const a=args[i];
    const filename=a.startsWith('-Wl,-filelist,')?a.slice('-Wl,-filelist,'.length):a==='-filelist'?args[i+1]:null;
    if(!filename)continue;
    const r=copy(filename),p=path.join(stage,r);
    const lines=fs.readFileSync(p,'utf8').split('\n').filter(Boolean);
    for(const file of lines)copy(file);
    fs.writeFileSync(p,lines.map(rewrite).join('\n')+'\n');
  }
  fs.writeFileSync(path.join(stage,'link-command.json'),JSON.stringify({format:1,target,compiler:command[0],args:rewritten,sourceDirectory:path.relative(root,source),inputs:[...inputs]},null,2)+'\n');
  fs.copyFileSync(fileURLToPath(import.meta.url),path.join(stage,'relink.mjs'));
  const gmp=path.join(root,'ghc-9.10.3/libraries/ghc-bignum/gmp/gmp-tarballs');
  fs.copyFileSync(path.join(gmp,'gmp-6.3.0-nodoc.tar.xz'),path.join(stage,'gmp-6.3.0-nodoc.tar.xz'));
  fs.copyFileSync(path.join(gmp,'gmpsrc.patch'),path.join(stage,'gmpsrc.patch'));
  const instructions=path.join(root,'RECOMBINATION.txt');
  fs.writeFileSync(instructions,`PostgREST 16.5 native relinking materials

This archive preserves the actual final native compiler/link invocation and
every non-OS object/static archive it uses. No ERP installation or active
runtime was modified. Original full application/dependency source archives,
the exact Cabal plan, revised Cabal files and build recipes accompany it.
GMP 6.3.0 is incorporated statically by the official GHC 9.10.3 ghc-bignum
archive. You may modify GMP and recombine this program for your own use.

On a matching ${target} host with its native C toolchain and Node.js:
1. Extract postgrest-relink.tar.gz into a writable directory.
2. Extract gmp-6.3.0-nodoc.tar.xz. In its gmp-6.3.0 directory run
   ./configure --disable-shared --enable-static --with-pic
   then make -j2. Make your changes before compiling. This is the exact
   source shipped by the official compiler; its no-documentation patch
   gmpsrc.patch is ALREADY APPLIED in the tarball. Do not apply it again.
3. From the relinking directory run:
   node relink.mjs /absolute/path/to/gmp-6.3.0/.libs/libgmp.a ./postgrest-modified
   The replacement GMP archive is force-loaded BEFORE the original libraries,
   so the lazy static archive resolver does not extract the original GMP
   members embedded in ghc-bignum. The original Haskell wrapper remains.
4. Execute ./postgrest-modified --version. On macOS re-sign after relinking
   as required by your installation; ad-hoc local signing is sufficient for
   local use: codesign --force --sign - ./postgrest-modified
   Use the separately supplied installation information for replacing the
   product binary. No signature/encryption secret is needed for local use.

The relink runner resolves the native Apple SDK via xcrun on macOS, never
a copied vendor SDK. All owned QA/build paths are relative archive inputs.
The exact original command is retained as structured link-command.json.
`);
  fs.copyFileSync(instructions,path.join(stage,'RECOMBINATION.txt'));
  const archive=path.join(root,'postgrest-relink.tar.gz');
  run('tar',['-czf',archive,'-C',stage,'.'],root);
  return {archive,instructions};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.dirname(fileURLToPath(import.meta.url));
  const p=JSON.parse(fs.readFileSync(path.join(root,'link-command.json'),'utf8'));
  const replacement=path.resolve(process.argv[2]||'');
  if(!process.argv[2]||!fs.statSync(replacement).isFile())throw new Error('Usage: node relink.mjs MODIFIED_LIBGMP_A [OUTPUT]');
  const output=path.resolve(process.argv[3]||path.join(root,'postgrest-modified'));
  const darwin=p.target.startsWith('darwin-');
  const sdk=darwin?run('xcrun',['--show-sdk-path'],root).trim():'';
  const compiler=darwin?run('xcrun',['--find','clang'],root).trim():path.basename(p.compiler);
  const args=p.args.map(x=>x.split('@ROOT@').join(root).split('@SDK@').join(sdk).split('@OUTPUT@').join(output));
  // Rewrite staged file-list contents at execution, without requiring the
  // original build root or a compiler package database to exist.
  for(const a of args)if(a.startsWith('-Wl,-filelist,')) {
    const f=a.slice('-Wl,-filelist,'.length);fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('@ROOT@').join(root));
  }
  const force=darwin?['-isysroot',sdk,'-mmacosx-version-min=12.0',`-Wl,-force_load,${replacement}`]:['-Wl,--whole-archive',replacement,'-Wl,--no-whole-archive'];
  run(compiler,[...force,...args],path.join(root,p.sourceDirectory));
  console.log(output);
}
