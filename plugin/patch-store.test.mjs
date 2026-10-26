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
 // Verify the exported artifacts are real unified patches, including EOF and empty-file edges.
 for(const [before,after] of [['a\nb\nc\n','a\nB\nc\n'],['','new\n'],['old\n',''],['a','b'],['a\n','a'],['a','a\n'],['a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n','A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n']]){
  await writeFile(join(root,'sample.txt'),before);const patch=patchDiff('sample.txt',before,after);const result=spawnSync('git',['apply','--no-index','-'],{cwd:root,input:patch,encoding:'utf8'});assert.equal(result.status,0,patch+'\n'+result.stderr);assert.equal(await readFile(join(root,'sample.txt'),'utf8'),after);
 }
 console.log('Patch cache, comments, revisions, PDF grouping, conflict rejection, symlink boundaries and unified patch round-trips passed');
}finally{await rm(root,{recursive:true,force:true});}
