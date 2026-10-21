import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createFolderPicker} from './src/folder-picker.js';
let call;
const answer=result=>async(...args)=>{call=args;await writeFile(args[1].at(-1),JSON.stringify(result));};
const pick=createFolderPicker({platform:'darwin',bundle:'/plugin/FolderPicker.app',run:answer({path:'/Users/person/My project'})});
assert.equal(await pick(),'/Users/person/My project');assert.equal(call[0],'/usr/bin/open');
assert.deepEqual(call[1].slice(0,4),['-W','-n','/plugin/FolderPicker.app','--args']);
assert.equal(await createFolderPicker({platform:'darwin',run:answer({cancelled:true})})(),null);
await assert.rejects(createFolderPicker({platform:'darwin',run:answer({path:'relative'})}),/valid folder/);
await assert.rejects(createFolderPicker({platform:'win32'}),/macOS only/);
let done,started,output,launches=0;const ready=new Promise(r=>started=r);const pending=createFolderPicker({platform:'darwin',run:async(...args)=>{launches++;output=args[1].at(-1);await new Promise(r=>{done=r;started();});await answer({path:'/chosen/project'})(...args);}});
const first=pending();await ready;const second=pending();
for(let attempt=0;attempt<100;attempt++){try{if(await readFile(output+'.focus','utf8')==='focus')break;}catch{}await new Promise(r=>setTimeout(r,2));}
assert.equal(await readFile(output+'.focus','utf8'),'focus','repeated clicks request that the existing chooser come forward');assert.equal(launches,1);done();assert.equal(await first,'/chosen/project');assert.equal(await second,'/chosen/project');
let tries=0;const retry=createFolderPicker({platform:'darwin',run:async(...args)=>{if(++tries===1)throw Object.assign(Error('timeout'),{killed:true});return answer({cancelled:true})(...args);}});
await assert.rejects(retry,/timed out/);assert.equal(await retry(),null,'a failed or timed-out chooser releases its lock');
console.log('Native folder selection, cancellation, refocusing, shared requests, timeout recovery, and command boundaries passed');

const filePicker=createFolderPicker({platform:'darwin',mode:'file',run:async(command,args)=>{assert.equal(args.at(-1),'file');await writeFile(args[args.indexOf('--args')+1],JSON.stringify({path:'/chosen/report.pdf'}));}});
assert.equal(await filePicker(),'/chosen/report.pdf');
