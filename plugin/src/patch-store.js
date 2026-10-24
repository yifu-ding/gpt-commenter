import {mkdir,readFile,writeFile,rename,lstat,readdir,realpath,stat} from 'node:fs/promises';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileContent} from './file-content.js';
import {Text} from '@codemirror/state';
import {Chunk} from '@codemirror/merge';

// Keep exact before/after text for conflict detection; the unified diff is a review artifact.
export function patchDiff(path,before,after){
 const a=Text.of(before.split('\n')),b=Text.of(after.split('\n')),lines=[`--- a/${path}`,`+++ b/${path}`];
 const countA=before? a.lines-(before.endsWith('\n')?1:0):0,countB=after? b.lines-(after.endsWith('\n')?1:0):0;
 const chunks=Chunk.build(a,b,{timeout:1000}),groups=[];
 for(const c of chunks){const fromA=Math.max(0,a.lineAt(c.fromA).number-1-3),fromB=Math.max(0,b.lineAt(c.fromB).number-1-3),toA=Math.min(countA,a.lineAt(Math.min(c.toA,a.length)).number+3),toB=Math.min(countB,b.lineAt(Math.min(c.toB,b.length)).number+3);const last=groups.at(-1);if(last && fromA<=last.toA){last.toA=toA;last.toB=toB;last.chunks.push(c);}else groups.push({fromA,fromB,toA,toB,chunks:[c]});}
 const rows=(doc,from,to,prefix)=>{for(let n=from;n<to;n++){lines.push(prefix+doc.line(n+1).text);if(n===doc.lines-1 && !(doc.length && doc.sliceString(doc.length-1)==='\n'))lines.push('\\ No newline at end of file');}};
 for(const g of groups){lines.push(`@@ -${g.toA>g.fromA?g.fromA+1:g.fromA},${g.toA-g.fromA} +${g.toB>g.fromB?g.fromB+1:g.fromB},${g.toB-g.fromB} @@`);let cursor=g.fromA;for(const c of g.chunks){const startA=a.lineAt(c.fromA).number-1,startB=b.lineAt(c.fromB).number-1,endA=c.toA> a.length?a.lines:a.lineAt(c.toA).number-1,endB=c.toB>b.length?b.lines:b.lineAt(c.toB).number-1;rows(a,cursor,Math.min(startA,countA),' ');rows(a,startA,Math.min(endA,countA),'-');rows(b,startB,Math.min(endB,countB),'+');cursor=Math.min(endA,countA);}rows(a,cursor,g.toA,' ');}
 return lines.join('\n')+'\n';
}
export function patchStore(workspace,latex){
 const writes=new Map();
 const valid=id=>{if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid patch ID.');return id;};
 const text=value=>{if(typeof value!=='string' || Buffer.byteLength(value)>5*1024*1024 || value.includes('\0'))throw Error('Patch content must be UTF-8 text smaller than 5 MB.');return value;};
 // Patch artifacts outlive the viewer/MCP process. Resolve the explicit location
 // without granting ordinary workspace access; applying still uses workspace.save.
 async function sourcePath(root,path){
  if(!isAbsolute(root) || isAbsolute(path) || path.split(/[\\/]/).includes('..'))throw Error('File is outside the project.');
  const canonical=await realpath(root),source=await realpath(resolve(canonical,path)),rel=relative(canonical,source);
  if(!rel || rel==='..' || rel.startsWith('../') || isAbsolute(rel) || rel.split('/').some(p=>['.markatlas','.git','node_modules','.codex','.agents','.aws'].includes(p)))throw Error('File is outside the project.');
  if(!(await stat(source)).isFile())throw Error('Choose a source file.');
  return source;
 }
 async function directory(root,path,create=false){const source=await sourcePath(root,path);let folder=dirname(source);for(const part of ['.markatlas','patches']){folder=join(folder,part);try{const info=await lstat(folder);if(info.isSymbolicLink() || !info.isDirectory())throw Error('Patch cache must be a real directory.');}catch(e){if(e.code!=='ENOENT')throw e;if(!create)return null;await mkdir(folder,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const info=await lstat(folder);if(info.isSymbolicLink() || !info.isDirectory())throw Error('Patch cache must be a real directory.');}}return folder;}
 async function put(folder,name,value){const target=join(folder,name),tmp=target+'.'+randomUUID()+'.tmp';await writeFile(tmp,value,{flag:'wx',mode:0o600});await rename(tmp,target);}
 async function get(root,path,id){valid(id);const source=await sourcePath(root,path);for(const folder of [await directory(root,path)].filter(Boolean)){const file=join(folder,id+'.json');let info;try{info=await lstat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(info.isSymbolicLink() || !info.isFile())throw Error('Invalid patch record.');const record=JSON.parse(await readFile(file,'utf8'));if(record.sourcePath!==source)throw Error('Patch belongs to another file.');return {...record,path:relative(await realpath(root),source),root:await realpath(root)};}throw Error('Patch not found.');}
 async function save(record){const folder=await directory(record.root,record.path,true);record.diff=patchDiff(record.path,record.baseText,record.proposedText);record.updatedAt=new Date().toISOString();await put(folder,record.id+'.patch',record.diff);await put(folder,record.id+'.json',JSON.stringify(record,null,2));return record;}
 async function locked(root,path,fn){const key=await sourcePath(root,path),previous=writes.get(key)||Promise.resolve(),work=previous.catch(()=>{}).then(fn);writes.set(key,work);try{return await work;}finally{if(writes.get(key)===work)writes.delete(key);}}
 function editable(record,revision){if(record.status!=='pending')throw Error('This patch has already been applied.');if(record.revision!==revision)throw Error('Patch changed. Reopen it before saving or applying.');}
 return {
  read:get,
  async list(root,path){const paths=/\.pdf$/i.test(path)?await latex.sources(root,path):[path],records=[],seen=new Set();for(const source of paths){const target=await sourcePath(root,source);for(const folder of [await directory(root,source)].filter(Boolean)){for(const name of await readdir(folder)){if(!/^[a-f0-9-]{36}\.json$/i.test(name))continue;const info=await lstat(join(folder,name));if(info.isSymbolicLink() || !info.isFile())continue;const raw=JSON.parse(await readFile(join(folder,name),'utf8'));if(raw.sourcePath!==target || seen.has(raw.id))continue;seen.add(raw.id);if(raw.status!=='pending')continue;records.push({id:raw.id,path:source,title:raw.title,revision:raw.revision,updatedAt:raw.updatedAt});}}}return {patches:records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};},
  async create({root,path,baseText,proposedText,title='Proposed changes',context=''}){return locked(root,path,async()=>{text(baseText);text(proposedText);const source=await sourcePath(root,path);if((await stat(source)).size>5*1024*1024)throw Error('Patch source must be smaller than 5 MB.');const snapshot=fileContent(path,await readFile(source));if(snapshot.readOnly || typeof snapshot.text!=='string' || /\.(pdf|docx|xlsx)$/i.test(path))throw Error('Patches require an editable text source.');if(snapshot.text!==baseText)throw Error('Source changed. Read it again before proposing a patch.');if(baseText===proposedText)throw Error('Patch has no changes.');return save({id:randomUUID(),root,path,sourcePath:await sourcePath(root,path),title,context,baseText,proposedText,comments:[],revision:1,status:'pending',createdAt:new Date().toISOString()});});},
  async update({root,path,id,expectedRevision,proposedText,comment}){return locked(root,path,async()=>{const record=await get(root,path,id);editable(record,expectedRevision);if(proposedText!==undefined)record.proposedText=text(proposedText);if(comment?.message?.trim())record.comments.push({id:randomUUID(),message:comment.message,quote:comment.quote||'',revision:record.revision,at:new Date().toISOString()});record.revision++;return save(record);});},
  async apply({root,path,id,expectedRevision}){return locked(root,path,async()=>{const record=await get(root,path,id);editable(record,expectedRevision);const snapshot=await workspace.read(root,path);if(snapshot.text!==record.baseText)throw Error('Source changed since this patch was created. Review and regenerate the patch before applying.');await workspace.save(root,path,record.proposedText,snapshot.etag);record.status='applied';record.appliedAt=new Date().toISOString();record.revision++;return save(record);});}
 };
}
