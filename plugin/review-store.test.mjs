import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {randomUUID} from 'node:crypto';import {reviewStore} from './src/review-store.js';
const base=await mkdtemp(join(tmpdir(),'review-ledger-'));const id=randomUUID();
try {
 const store=reviewStore(base);const data={identity:'file:test',sourceName:'test.js',sourcePath:'/project/test.js',baseText:'old\npassage',text:'intro\nnew passage',annotations:[{id,startOffset:6,endOffset:17,message:'Clarify',anchorStatus:'edited',originalSnapshot:{selectedText:'old passage',documentHash:'old-version'}}]};
 await store.update(data);let resolved=await reviewStore(base).resolve(id);assert.equal(resolved.hasUnsavedEdits,true);assert.equal(resolved.status,'edited');assert.equal(resolved.current.startLine,2);assert.equal(resolved.current.excerpt,'new passage');assert.equal(resolved.original.documentHash,'old-version');assert.notEqual(resolved.diskHash,resolved.documentHash);
 assert.equal((await store.read(id,2,2)).text,'new passage');
 await store.update({...data,annotations:[{...data.annotations[0],anchorStatus:'deleted',endOffset:6}]});assert.equal((await store.resolve(id)).status,'deleted');
 await store.update({...data,checkpointAnnotationId:id});
 let checkpoint=(await store.resolve(id)).editCheckpoint;assert.equal(checkpoint.changed,true);
 // Autosaves change the disk baseline without erasing the preceding comment boundary.
 await store.update({...data,text:'intro\nlatest passage',baseText:'intro\nlatest passage'});
 await store.update({...data,text:'intro\nlatest passage',baseText:'intro\nlatest passage',checkpointAnnotationId:id});
 checkpoint=(await reviewStore(base).resolve(id)).editCheckpoint;assert.equal(checkpoint.changed,true);
 await store.update({...data,text:'intro\nlatest passage',checkpointAnnotationId:id});assert.equal((await store.resolve(id)).editCheckpoint.changed,false);
 await store.update({...data,annotations:[]});assert.equal((await store.resolve(id)).status,'removed');await assert.rejects(()=>store.read(id,1,2),/removed/);
 await assert.rejects(()=>store.resolve('../bad'),/not available/);
 // A parent workspace imports nested queues with paths rebased to the parent.
 const root=await realpath(base),child=join(root,'thesis'),deep=join(child,'chapters');await mkdir(deep,{recursive:true});await writeFile(join(deep,'main.pdf'),'fixture');
 const nestedId=randomUUID(),identity='latex:'+join(deep,'main.tex');
 const note={id:nestedId,kind:'comment',message:'Nested PDF note',startOffset:0,endOffset:4,updatedAt:'2026-10-23T13:00:00Z',projectRoot:deep,pdf:{root:deep,path:'main.pdf',main:'main.tex',page:1}};
 const nested={entries:[[nestedId,{identity,root:deep,path:'main.pdf',item:note}]],drafts:{[identity]:{text:'text',base:'text',items:[note]}}};
 await store.project(deep,nested);
 await store.project(child,{entries:[],drafts:{}});
 const loaded=await store.nestedProject(root,'thesis/chapters/main.pdf');
 assert.equal(loaded.entries.length,1);assert.equal(loaded.entries[0][1].root,root);assert.equal(loaded.entries[0][1].path,'thesis/chapters/main.pdf');
 assert.equal(loaded.drafts[identity].items[0].pdf.main,'thesis/chapters/main.tex');assert.equal(loaded.drafts[identity].items[0].pdf.root,root);
 assert.equal((await store.project(deep)).entries[0][1].path,'main.pdf','reading parent does not rewrite child metadata');
 await store.project(root,{...loaded,changedIdentities:[identity]});
 assert.equal((await store.nestedProject(root,'thesis/chapters/main.pdf')).entries.length,1,'same annotation is deduplicated');
 await store.project(root,{entries:[],drafts:{},changedIdentities:[],removedIds:[nestedId]});
 assert.equal((await store.nestedProject(root,'thesis/chapters/main.pdf')).entries.length,0,'removed notes stay hidden when importing child');
 await assert.rejects(()=>store.nestedProject(child,'../review-documents'),/outside/);
 const link=join(root,'linked');await mkdir(link);await writeFile(join(link,'file.md'),'text');await symlink(join(deep,'.markatlas'),join(link,'.markatlas'));
 await assert.rejects(()=>store.nestedProject(root,'linked/file.md'),/symbolic/);
 console.log('Persistent latest-annotation resolution, working-copy reads, deletion, and removal checks passed');
}finally{await rm(base,{recursive:true,force:true});}
