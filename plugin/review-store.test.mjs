import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
 console.log('Persistent latest-annotation resolution, working-copy reads, deletion, and removal checks passed');
}finally{await rm(base,{recursive:true,force:true});}
