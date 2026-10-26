import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {workspaceAccess} from './src/workspace.js';
import {gzipSync} from 'node:zlib';
import {latexSourceFiles} from './src/latex.js';
import {patchStore,patchDiff} from './src/patch-store.js';
const root=await realpath(await mkdtemp(join(tmpdir(),'markatlas-patches-')));
try{
 await mkdir(join(root,'chapters'));await writeFile(join(root,'chapters/a.tex'),'First\nSecond\n');await writeFile(join(root,'main.tex'),'\\input{chapters/a}\n');await writeFile(join(root,'main.pdf'),'pdf');
 const workspace=workspaceAccess(async()=>[{uri:new URL('file://'+root).href}]);
 await writeFile(join(root,'main.synctex.gz'),gzipSync('SyncTeX Version:1\nInput:1:./main.tex\nInput:2:./chapters/a.tex\nInput:3:/etc/passwd\n'));
 assert.deepEqual((await latexSourceFiles(workspace,root,'main.pdf','main.tex')).sort(),['chapters/a.tex','main.tex']);
 const store=patchStore(workspace,{sources:(root,path)=>latexSourceFiles(workspace,root,path,'main.tex')});
 const a=await store.create({root,path:'chapters/a.tex',baseText:'First\nSecond\n',proposedText:'First\nBetter\n',context:'Original comment: clarify second line'});
 assert.equal(await readFile(join(root,'chapters/a.tex'),'utf8'),'First\nSecond\n','creating a patch never writes source');
 assert.ok((await readdir(join(root,'chapters/.markatlas/patches'))).includes(a.id+'.patch'));
 const b=await store.create({root,path:'chapters/a.tex',baseText:a.baseText,proposedText:'Other\nSecond\n'});
 assert.equal((await store.list(root,'chapters/a.tex')).patches.length,2);assert.equal((await store.list(root,'main.pdf')).patches.length,2,'PDF aggregates source patches');assert.equal((await store.list(root,'main.tex')).patches.length,0);
 let updated=await store.update({root,path:a.path,id:a.id,expectedRevision:1,comment:{message:'Use clearer wording',quote:'+Better'}});assert.equal(updated.comments[0].quote,'+Better');
 await assert.rejects(store.update({root,path:a.path,id:a.id,expectedRevision:1,proposedText:'stale'}),/Patch changed/);
 updated=await store.update({root,path:a.path,id:a.id,expectedRevision:2,proposedText:'First\nClearer\n'});
 assert.equal(await readFile(join(root,a.path),'utf8'),a.baseText);
 await assert.rejects(store.read(root,'main.tex',a.id));
 await store.apply({root,path:a.path,id:a.id,expectedRevision:3});assert.equal(await readFile(join(root,a.path),'utf8'),'First\nClearer\n');
 await assert.rejects(store.apply({root,path:a.path,id:b.id,expectedRevision:1}),/Source changed/);
 await assert.rejects(store.apply({root,path:a.path,id:a.id,expectedRevision:4}),/already been applied/);
 assert.equal((await store.list(root,a.path)).patches.length,1);
 await assert.rejects(store.create({root,path:a.path,baseText:a.baseText,proposedText:'old'}),/Source changed/);
 await mkdir(join(root,'blocked'));await writeFile(join(root,'blocked/file.md'),'A');await symlink(join(root,'chapters/.markatlas'),join(root,'blocked/.markatlas'));
 await assert.rejects(store.create({root,path:'blocked/file.md',baseText:'A',proposedText:'B'}),/real directory/);
 // A separate MCP process has no viewer registrations (and roots may be offline).
 const disconnected=workspaceAccess(async()=>{throw Error('Host roots unavailable');},null);
 const detachedStore=patchStore(disconnected,{});
 const detached=await detachedStore.create({root,path:'chapters/a.tex',baseText:'First\nClearer\n',proposedText:'Saved while closed\n'});
 assert.equal(await readFile(join(root,detached.path),'utf8'),detached.baseText);
 assert.ok((await readdir(join(root,'chapters/.markatlas/patches'))).includes(detached.id+'.json'));
 const revised=await detachedStore.update({root,path:detached.path,id:detached.id,expectedRevision:1,comment:{message:'Keep this across restarts'}});
 const restarted=patchStore(workspaceAccess(async()=>[],null),{});
 assert.equal((await restarted.read(root,detached.path,detached.id)).comments[0].message,'Keep this across restarts');
 assert.ok((await restarted.list(root,detached.path)).patches.some(p=>p.id===detached.id));
 // Opening the source directory directly, then its enclosing project, finds the same cache.
 const nestedRoot=join(root,'chapters');
 assert.equal((await restarted.read(nestedRoot,'a.tex',detached.id)).path,'a.tex');
 assert.ok((await restarted.list(nestedRoot,'a.tex')).patches.some(p=>p.id===detached.id));
 await assert.rejects(restarted.apply({root,path:detached.path,id:detached.id,expectedRevision:revised.revision}),/Project is no longer available/);
 assert.equal(await readFile(join(root,detached.path),'utf8'),detached.baseText);
 await assert.rejects(restarted.create({root:nestedRoot,path:'../main.tex',baseText:'',proposedText:'escape'}),/outside the project/);
 await symlink(join(root,'main.tex'),join(nestedRoot,'escape.tex'));
 await assert.rejects(restarted.create({root:nestedRoot,path:'escape.tex',baseText:'',proposedText:'escape'}),/outside the project/);
 await assert.rejects(restarted.create({root,path:detached.path,baseText:'stale',proposedText:'stale proposal'}),/Source changed/);
 // Verify the exported artifacts are real unified patches, including EOF and empty-file edges.
 for(const [before,after] of [['a\nb\nc\n','a\nB\nc\n'],['','new\n'],['old\n',''],['a','b'],['a\n','a'],['a','a\n'],['a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n','A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n']]){
  await writeFile(join(root,'sample.txt'),before);const patch=patchDiff('sample.txt',before,after);const result=spawnSync('git',['apply','--no-index','-'],{cwd:root,input:patch,encoding:'utf8'});assert.equal(result.status,0,patch+'\n'+result.stderr);assert.equal(await readFile(join(root,'sample.txt'),'utf8'),after);
 }
 console.log('Patch cache, comments, revisions, PDF grouping, conflict rejection, symlink boundaries and unified patch round-trips passed');
}finally{await rm(root,{recursive:true,force:true});}
