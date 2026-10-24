import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,lstat} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
const run=promisify(execFile);
const excluded=new Set(['.markatlas','.git','node_modules','.codex','.agents','.aws']);
const safe=path=>path && !isAbsolute(path) && !path.split('/').some(part=>part==='..' || excluded.has(part));
const lines=buffer=>buffer.length?buffer.toString('utf8').split('\n').length-(buffer.at(-1)===10?1:0):0;
export async function gitTreeChanges(root){
 const git=async args=>(await run('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',root,...args],{timeout:3500,maxBuffer:4*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}})).stdout;
 try{
  if((await git(['rev-parse','--is-inside-work-tree'])).trim()!=='true')return null;
  let head=true;try{await git(['rev-parse','--verify','HEAD']);}catch{head=false;}
  const changes=new Map();
  if(head){const stats=await git(['diff','--relative','--numstat','-z','--no-renames','--no-ext-diff','--no-textconv','HEAD','--','.']);for(const row of stats.split('\0')){const match=/^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);if(match && safe(match[3]))changes.set(match[3],{added:Number(match[1])||0,removed:Number(match[2])||0,binary:match[1]==='-'});}}
  await Promise.all([...changes].map(async([path,change])=>{try{await lstat(resolve(root,path));}catch(error){if(error.code==='ENOENT')change.deleted=true;}}));
  const untracked=await git(['ls-files','-z',...(head?[]:['--cached']),'--others','--exclude-standard','--','.']);
  const pending=[...new Set(untracked.split('\0').filter(safe))].slice(0,5000);
  for(let i=0;i<pending.length;i+=16)await Promise.all(pending.slice(i,i+16).map(async path=>{try{
   const target=resolve(root,path),rel=relative(root,target);if(!safe(rel))return;
   const info=await lstat(target);if(!info.isFile() || info.size>5*1024*1024){changes.set(path,{added:0,removed:0,untracked:true,binary:true});return;}
   const data=await readFile(target),binary=data.includes(0);changes.set(path,{added:binary?0:lines(data),removed:0,untracked:true,binary});
  }catch{/* A concurrently removed file is absent from the next refresh. */}}));
  return changes;
 }catch{return null;}
}
export function applyGitTree(root,changes){
 if(!changes)return;
 const existing=new Map();function index(node){existing.set(node.path,node);for(const child of node.children || [])index(child);}index(root);
 // Git decorates the filesystem tree; it must not recreate deleted entries.
 for(const [path,change] of changes){const node=existing.get(path);if(node)node.git=change;}
 function sum(node){if(node.type!=='directory')return node.git || {added:0,removed:0,count:0};const total={added:0,removed:0,count:0};for(const child of node.children){const value=sum(child);total.added+=value.added;total.removed+=value.removed;total.count+=value.count??1;}if(total.count)node.git=total;return total;}sum(root);
 // Keep deletions in Git totals for surviving ancestor folders, without visible rows.
 for(const [path,change] of changes)if(change.deleted && !existing.has(path)){
  let parent=path;
  while(true){parent=parent.includes('/')?parent.slice(0,parent.lastIndexOf('/')):'';const folder=existing.get(parent);
   if(folder?.type==='directory'){folder.git??={added:0,removed:0,count:0};folder.git.added+=change.added;folder.git.removed+=change.removed;folder.git.count++;}
   if(!parent)break;
  }
 }
}
