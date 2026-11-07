import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentsExporter,exportReviewComments,compactComments} from './src/comments-export.js';
import {reviewStore} from './src/review-store.js';
const directory=await mkdtemp(join(tmpdir(),'comments-export-test-'));
try{
  const path=join(directory,'comments.json'),source=join(directory,'project.json');
  const item={id:'comment-1',kind:'comment',sourceName:'README.md',sourcePath:'/project/README.md',startLine:9,endLine:9,startOffset:30,endOffset:40,selectedText:'，提交 bug/issue',message:'aaa',pdf:{page:2,screenshot:'data:image/png;base64,AA=='},extra:{keep:true}};
  const entry={root:'/project',path:'README.md',identity:'project:/project/README.md',item};
  const data=JSON.stringify({entries:[[item.id,entry]],drafts:{},removedIds:[]},null,2)+'\n';
  await writeFile(source,data);
  const save=createCommentsExporter({choose:async()=>path});
  assert.deepEqual(await save({source}),{saved:true});
  const compact=JSON.stringify({'README.md':[['P2@30-40','aaa']]});
  assert.equal(await readFile(path,'utf8'),compact);
  const projectRoot=join(directory,'workspace');await mkdir(projectRoot);
  const store=reviewStore(directory);
  await store.project(projectRoot,{entries:[[item.id,entry]],drafts:{},removedIds:[],changedIdentities:[entry.identity]});
  const projectJson=await store.projectJson(projectRoot);
  assert.deepEqual(JSON.parse(projectJson).entries[0][1],entry,'read project metadata through the review store');
  await save({data:projectJson});
  assert.equal(await readFile(path,'utf8'),compact);
  const standalone=JSON.stringify([[item.id,entry]]);
  await save({data:standalone});assert.equal(await readFile(path,'utf8'),compact);
  const access={sourceDiscoveryAllowed:async root=>root===projectRoot};
  let exported;
  const handler={workspace:access,reviews:store,exportComments:async args=>{exported=args.data;return {saved:true};}};
  assert.deepEqual(await exportReviewComments({root:projectRoot},handler),{saved:true});
  assert.deepEqual(exported,projectJson,'workspace export reads the saved JSON through the review store');
  await assert.rejects(()=>exportReviewComments({root:'/outside'},handler),/no longer available/);
  exported=null;
  assert.deepEqual(await exportReviewComments({data:standalone},handler),{saved:true});
  assert.equal(exported,standalone,'standalone files export their queued comments');
  const snapshot=JSON.parse(await store.lastComments(projectRoot,data));
  await store.project(projectRoot,{entries:[],drafts:{},removedIds:[item.id],changedIdentities:[entry.identity]});
  const reopened=reviewStore(directory);
  assert.deepEqual(JSON.parse(await reopened.lastComments(projectRoot)).entries,JSON.parse(data).entries,'snapshot survives queue clearing and restart');
  await exportReviewComments({root:projectRoot,version:'last'},handler);
  assert.equal(JSON.parse(exported).id,snapshot.id);
  await store.lastComments(projectRoot,JSON.stringify({entries:[]}));
  assert.deepEqual(JSON.parse(await readFile(join(projectRoot,'.markatlas',`comments-${snapshot.id}.json`))).entries,JSON.parse(data).entries,'new sends retain older recovery JSON');
  assert.equal(await reopened.lastComments(),null);
  await store.lastComments(undefined,JSON.stringify({entries:[[item.id,entry]]}));
  assert.equal(JSON.parse(await reopened.lastComments()).entries.length,1,'standalone snapshots are stored on disk too');
  const note=(message,extra={})=>({root:'/project',path:'src/app.ts',item:{kind:'comment',startLine:10,endLine:15,message,...extra}});
  assert.deepEqual(JSON.parse(JSON.stringify(compactComments({entries:[
    ['1',note('  original comment  ')],['2',note('second',{startLine:32,endLine:32})],
    ['3',note('   ')],['4',note('explain',{kind:'explanation'})],
    ['5',{...note('columns',{startLine:10,endLine:10,startColumn:5,endColumn:20}),path:'/project/src/other.ts'}],
    ['6',{...note('safe key'),path:'__proto__'}]
  ]}))),{'src/app.ts':[['L10-L15','  original comment  '],['L32','second']],'src/other.ts':[['L10:C5-L10:C20','columns']],['__proto__']:[['L10-L15','safe key']]});
  assert.equal(JSON.stringify(compactComments({entries:[]})),'{}');
  assert.deepEqual(compactComments({entries:[['pdf',{...entry,item:{...item,pdf:{page:2,region:{x:1,y:2,width:3,height:4}}}}]]})['README.md'],[['P2 {"x":1,"y":2,"width":3,"height":4}','aaa']]);
  const cancel=createCommentsExporter({choose:async()=>null,write:()=>assert.fail('cancel must not write')});
  assert.deepEqual(await cancel({source}),{cancelled:true});
  await assert.rejects(()=>save({data:'invalid JSON'}),SyntaxError);
  let fail=true;
  const retry=createCommentsExporter({choose:async()=>path,write:async()=>{if(fail)throw Error('Disk full');}});
  await assert.rejects(()=>retry({data}),/Disk full/);fail=false;
  assert.deepEqual(await retry({data}),{saved:true},'errors release the export lock');
}finally{await rm(directory,{recursive:true,force:true});}
console.log('Compact grouped JSON, precise positions, original comments, standalone queue, cancellation and write failure recovery passed');
