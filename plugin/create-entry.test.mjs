import {trashProjectEntry} from './src/trash.js';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile,stat,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {JSDOM} from 'jsdom';
import {workspaceAccess} from './src/workspace.js';
import {createEntryDialog} from './src/create-entry-dialog.js';
const root=await realpath(await mkdtemp(join(tmpdir(),'markatlas-create-'))),outside=await realpath(await mkdtemp(join(tmpdir(),'markatlas-outside-')));
try{
 const access=workspaceAccess(async()=>[],root);await access.list();
 assert.equal((await access.create(root,'','notes','directory')).path,'notes');assert.ok((await stat(join(root,'notes'))).isDirectory());
 for(const name of ['draft.md','script.py','data.json','无后缀','report.pdf']){assert.equal((await access.create(root,'notes',name,'file')).path,'notes/'+name);assert.equal(await readFile(join(root,'notes',name),'utf8'),'');}
 await writeFile(join(root,'notes/draft.md'),'keep');await assert.rejects(access.create(root,'notes','draft.md','file'),/already exists/);assert.equal(await readFile(join(root,'notes/draft.md'),'utf8'),'keep');
 await assert.rejects(access.create(root,'','notes','directory'),/already exists/);
 for(const name of ['',' ','..','../escape','.git','a/b','a\\b'])await assert.rejects(access.create(root,'',name,'file'));
 await assert.rejects(access.create(root,'../','outside','file'));await symlink(outside,join(root,'external'));await assert.rejects(access.create(root,'external','escape','file'));
 await symlink(join(root,'notes/draft.md'),join(root,'linked.md'));await assert.rejects(access.create(root,'','linked.md','file'));assert.equal(await readFile(join(root,'notes/draft.md'),'utf8'),'keep');
 const trashCalls=[],run=async(...args)=>trashCalls.push(args);
 await trashProjectEntry(access,root,'notes/draft.md',{platform:'darwin',run});
 await trashProjectEntry(access,root,'notes',{platform:'darwin',run});
 assert.equal(trashCalls[0][1].at(-1),join(root,'notes/draft.md'));assert.equal(trashCalls[1][1].at(-1),join(root,'notes'));
 for(const path of ['.','..','../escape','linked.md','external','.git'])await assert.rejects(trashProjectEntry(access,root,path,{platform:'darwin',run}));
 assert.equal(trashCalls.length,2,'invalid paths never reach Finder');
 await assert.rejects(trashProjectEntry(access,root,'notes',{platform:'darwin',run:async()=>{throw Error('Finder refused');}}),/Finder refused/);
 assert.equal(await readFile(join(root,'notes/draft.md'),'utf8'),'keep','failed trash operation preserves files');
 const single=workspaceAccess(async()=>[]);await single.connectFile(join(root,'notes/draft.md'));await assert.rejects(single.create(join(root,'notes'),'','blocked','file'),/Open a project folder/);
 const dom=new JSDOM('<button id="opener">New</button>',{url:'https://create.test'});globalThis.document=dom.window.document;const calls=[];
 const dialog=createEntryDialog(async value=>{calls.push(value);if(value.name==='exists.md')throw Error('already exists');});
 const $=id=>document.getElementById(id),submit=()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})),flush=()=>new Promise(r=>setTimeout(r,0));
 assert.equal($('create-entry-help'),null);dialog.open({root,folder:'notes',kind:'file'});$('create-entry-cancel').click();assert.equal(calls.length,0);
 dialog.open({root,folder:'notes',kind:'file'});$('create-entry-name').value='exists.md';submit();await flush();assert.equal($('create-entry-dialog').hidden,false);assert.match($('create-entry-error').textContent,/already exists/);
 $('create-entry-name').value='code.py';submit();await flush();assert.equal(calls.at(-1).name,'code.py');assert.equal(calls.at(-1).folder,'notes');assert.equal($('create-entry-dialog').hidden,true);
 dialog.open({root,folder:'',kind:'directory'});$('create-entry-name').value='新文件夹';submit();await flush();assert.equal(calls.at(-1).kind,'directory');
 dom.window.close();console.log('Create file/folder, exact suffixes, exclusive creation, path boundaries, single-file access, cancellation and retry passed');
}finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
