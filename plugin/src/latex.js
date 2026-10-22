import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join,dirname,basename,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const execute=promisify(execFile),hash=s=>createHash('sha256').update(s).digest('hex');
const hidden=new Set(['.git','node_modules','.codex','.agents','.aws','.gpt-commenter-build']);
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,e)=>e[0]==='#'?String.fromCodePoint(e[1]?.toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[e]);
const attrs=s=>Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
export function parsePdfText(xml){
  let text='';const pages=[];
  for(const match of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)){
    const a=attrs(match[1]),page={number:pages.length+1,width:Number(a.width),height:Number(a.height),startOffset:text.length,words:[]};
    for(const line of match[2].matchAll(/<line\b[^>]*>([\s\S]*?)<\/line>/g)){
      const words=[...line[1].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)];
      for(let index=0;index<words.length;index++){
        const w=words[index],b=attrs(w[1]),value=decode(w[2]);
        page.words.push({text:value,startOffset:text.length,endOffset:text.length+value.length,x:Number(b.xMin),y:Number(b.yMin),width:Number(b.xMax)-Number(b.xMin),height:Number(b.yMax)-Number(b.yMin)});
        text+=value+(index===words.length-1?'\n':' ');
      }
    }
    page.endOffset=text.length;pages.push(page);text+='\n';
  }
  if(!pages.length || pages.some(p=>!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0)||text.length>5*1024*1024 || pages.length>300)throw Error('PDF is unreadable or exceeds the 300-page / 5 MB extracted-text limit.');
  return {text,pages};
}
async function executable(name){
  if(['pdftotext','pdftocairo','pdftoppm'].includes(name)){
    const bundled=fileURLToPath(new URL(`../runtime/pdf/bin/${name}`,import.meta.url));
    try{if((await stat(bundled)).isFile())return bundled;}catch{}
  }
  for(const path of [fileURLToPath(new URL('../runtime/tex/bin/universal-darwin/',import.meta.url)),...(process.env.PATH || '').split(':'),'/Library/TeX/texbin','/opt/homebrew/bin','/usr/local/bin','/usr/bin']){
    const candidate=join(path,name);try{if((await stat(candidate)).isFile())return candidate;}catch{}
  }
  throw Error(`${name} is not installed. PDF display requires Poppler (pdftotext, pdftocairo and pdftoppm); precise source mapping uses the user's installed SyncTeX.`);
}
async function run(name,args,options={}){
  try{
    const command=await executable(name),bundled=command===fileURLToPath(new URL(`../runtime/pdf/bin/${name}`,import.meta.url));
    const pdfRoot=fileURLToPath(new URL('../runtime/pdf/',import.meta.url));
    return await execute(command,args,{timeout:120000,maxBuffer:24*1024*1024,env:{...process.env,PATH:fileURLToPath(new URL('../runtime/tex/bin/universal-darwin/',import.meta.url))+':'+(process.env.PATH || '')},...(bundled?{
      cwd:pdfRoot,env:{...process.env,FONTCONFIG_FILE:join(pdfRoot,'fonts.conf'),XDG_CACHE_HOME:join(process.env.PLUGIN_DATA || tmpdir(),'markatlas-pdf-cache')}
    }:{}),...options});
  }
  catch(error){throw Error(`${name}: ${(error.stderr || error.stdout || error.message).toString().slice(-8000)}`);}
}
export function latexService(workspace){
  const cache=new Map();
  async function files(root){
    const result=[];let visited=0;
    async function walk(path,depth=0){if(depth>15)return;for(const e of await readdir(path,{withFileTypes:true})){if(++visited>10000)throw Error('Project is too large to locate its LaTeX root.');if(e.isSymbolicLink()||hidden.has(e.name))continue;const p=join(path,e.name);if(e.isDirectory())await walk(p,depth+1);else if(/\.(tex|sty|cls|bib)$/i.test(e.name))result.push(p);}}
    await walk(root);return result;
  }
  async function mainFor(root,path){
    const target=await workspace.resolve(root,path);
    // Build output often lives below its source project. Search its ancestors
    // first so unrelated projects elsewhere in the workspace cannot interfere.
    for(let directory=dirname(target);;directory=dirname(directory)){
      const nearby=[];
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(!entry.isFile() || !/\.tex$/i.test(entry.name))continue;
        const candidate=join(directory,entry.name);
        if((await stat(candidate)).size>5*1024*1024)continue;
        if(/\\documentclass\b/.test(await readFile(candidate,'utf8')))nearby.push(candidate);
      }
      if(nearby.includes(target))return target;
      const named=nearby.find(p=>basename(p,'.tex')===basename(target,'.pdf')) || nearby.find(p=>basename(p)==='main.tex');
      if(named)return named;
      if(nearby.length===1)return nearby[0];
      if(nearby.length>1)throw Error('Multiple LaTeX main documents were found beside this PDF. Use a PDF whose name matches its main .tex document.');
      if(directory===resolve(root))break;
    }
    const candidates=[];
    for(const p of await files(root)){if(!/\.tex$/i.test(p))continue;const data=await readFile(p,'utf8');if(data.length<5*1024*1024 && /\\documentclass\b/.test(data))candidates.push(p);}
    if(candidates.includes(target))return target;
    const local=candidates.filter(p=>dirname(p)===dirname(target));
    const named=local.find(p=>basename(p,'.tex')===basename(target,'.pdf')) || local.find(p=>basename(p)==='main.tex');
    if(named)return named;if(local.length===1)return local[0];if(candidates.length===1)return candidates[0];
    throw Error('No unique LaTeX root was found. Open the folder containing the intended main .tex document and its compiled PDF.');
  }
  async function read(root,path,ifNoneMatch){
    const target=await workspace.resolve(root,path),info=await stat(target);
    if(!/\.pdf$/i.test(path)||info.size>50*1024*1024)throw Error('Choose a PDF smaller than 50 MB.');
    const etag=`${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if(ifNoneMatch===etag)return {notModified:true,etag};
    const discover=!workspace.sourceDiscoveryAllowed || await workspace.sourceDiscoveryAllowed(root);
    const key=`${root}:${path}:${target}:${etag}:${discover}`;if(cache.has(key))return cache.get(key);
    let main=null;
    try{if(discover)main=await mainFor(root,path);}catch{/* Source discovery is optional for PDF review. */}
    const bytes=await readFile(target);
    const {stdout}=await run('pdftotext',['-bbox-layout','-enc','UTF-8',target,'-']);
    const after=await stat(target);if(`${after.size}:${after.mtimeMs}:${after.ctimeMs}`!==etag)throw Error('PDF is changing. Waiting for the external build to finish.');
    const parsed=parsePdfText(stdout);
    const result={...parsed,path,root,sourcePath:target,main:main?relative(root,main):null,fingerprint:hash(bytes),etag};
    if(cache.size>8)cache.clear();cache.set(key,result);return result;
  }
  async function page(root,path,number,fingerprint,format='png'){
    const data=await read(root,path);if(fingerprint && data.fingerprint!==fingerprint)throw Error('PDF changed. Refresh the preview before selecting text.');
    if(!Number.isInteger(number)||number<1||number>data.pages.length)throw Error('Invalid PDF page.');
    const target=await workspace.resolve(root,path);
    if(!['svg','png'].includes(format))throw Error('Unsupported PDF page format.');
    const {stdout}=format==='svg'
      ? await run('pdftocairo',['-svg','-f',String(number),'-l',String(number),target,'-'],{encoding:'buffer'})
      : await run('pdftoppm',['-f',String(number),'-l',String(number),'-singlefile','-scale-to','1600','-png',target],{encoding:'buffer'});
    const latest=await read(root,path);if(latest.fingerprint!==data.fingerprint)throw Error('PDF changed while rendering. Refresh the preview.');
    return {image:`data:image/${format==='svg'?'svg+xml':'png'};base64,${stdout.toString('base64')}`,fingerprint:data.fingerprint};
  }
  async function locate(root,path,selection){
    const pdf=await read(root,path);
    if(selection.fingerprint && selection.fingerprint!==pdf.fingerprint)throw Error('The PDF version changed. Re-select this passage in the refreshed PDF.');
    const page=pdf.pages[selection.page-1];if(!page)throw Error('Invalid PDF page.');
    if(!pdf.main)return {status:'unavailable',main:null,instruction:'No matching LaTeX source is available. Review this PDF using its page, quoted passage, and coordinates.'};
    const main=await workspace.resolve(root,pdf.main);
    let position=selection.y;
    const word=page.words.find(w=>w.startOffset<=selection.startOffset && w.endOffset>selection.startOffset);const x=word?.x ?? selection.x,y=word?.y ?? position;
    let guess;
    try{
      const {stdout}=await run('synctex',['edit','-o',`${selection.page}:${x}:${y}:${await workspace.resolve(root,path)}`],{cwd:dirname(main)});
      const input=stdout.match(/^Input:(.+)$/m)?.[1],line=Number(stdout.match(/^Line:(\d+)/m)?.[1]);
      if(input&&line){const absolute=resolve(dirname(main),input);const safe=await workspace.resolve(root,relative(root,absolute));guess={path:relative(root,safe),line,method:'synctex'};}
    }catch{}
    // Quote matching refines coarse SyncTeX lines, and works with older PDFs lacking SyncTeX.
    const quote=selection.quote.replace(/\s+/g,' ').trim();
    const candidates=guess?[await workspace.resolve(root,guess.path)]:[main,...(await files(dirname(main))).filter(p=>/\.tex$/.test(p)&&p!==main)];
    const matches=[];
    for(const file of candidates){
      const raw=await readFile(file,'utf8'),normalized=raw.replace(/\s+/g,' ');let at=normalized.indexOf(quote);
      if(quote.length>=8 && at>=0 && normalized.indexOf(quote,at+1)<0){
        const boundaries=[];for(const m of raw.matchAll(/\s+|\S/g)){if(/^\s/.test(m[0]))boundaries.push(m.index);else for(let n=0;n<m[0].length;n++)boundaries.push(m.index+n);}boundaries.push(raw.length);
        const offset=boundaries[at],end=boundaries[at+quote.length];
        const line=raw.slice(0,offset).split('\n').length,endLine=raw.slice(0,Math.max(offset,end-1)).split('\n').length;matches.push({path:relative(root,file),line,endLine,method:'text-match',raw});
      }
    }
    const found=matches.length===1?matches[0]:guess;
    if(!found)return {status:'unresolved',main:relative(root,main),instruction:'Source location is uncertain. Build with SyncTeX, or locate the quoted passage manually before editing.'};
    const raw=found.raw ?? await readFile(await workspace.resolve(root,found.path),'utf8');
    return {status:'located',main:relative(root,main),path:found.path,sourcePath:join(root,found.path),line:found.line,endLine:found.endLine || found.line,method:found.method,sourceHash:hash(raw),context:raw.split('\n').slice(Math.max(0,found.line-4),found.line+5).join('\n').slice(0,4000)};
  }
  return {read,page,locate};
}
