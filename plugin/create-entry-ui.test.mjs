import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM(readFileSync(new URL('./src/viewer.html',import.meta.url),'utf8'),{url:'https://native-ui.test',runScripts:'outside-only',pretendToBeVisual:true});
const {window}=dom;window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;window.setImmediate=setImmediate;window.clearImmediate=clearImmediate;window.scrollTo=()=>{};
Object.defineProperty(window.crypto,'subtle',{value:webcrypto.subtle});
window.Range.prototype.getClientRects=()=>[];window.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});window.HTMLElement.prototype.scrollIntoView=()=>{};
window.files={'alpha.md':'# Alpha\n\nSearch target alpha.\n\n- [ ] Preview task','folder/beta.md':'# Beta\n\nSearch target beta.'};
window.root='/demo';window.paneCalls=[];window.folderPickCalls=0;
window.api=async(name,args)=>{
 if(name==='choose_markdown_project_folder'){window.folderPickCalls++;return {cancelled:true};}
 if(name==='list_markdown_project')return {rootPath:'/demo',root:{type:'directory',name:'demo',path:'',children:[{type:'file',name:'alpha.md',path:'alpha.md',supported:true},{type:'directory',name:'folder',path:'folder',children:[{type:'file',name:'beta.md',path:'folder/beta.md',supported:true}]}]}};
 if(name==='read_markdown_project_file')return {name:args.path,text:window.files[args.path],etag:'1'};
 if(name==='save_review_project_file'){window.files[args.path]=args.text;return {text:args.text,etag:'2'};}
 if(name==='review_project_state' && args.state){if(window.failProjectSave)throw Error('Disk unavailable');window.savedProjectState=args.state;if(window.onProjectSave){const callback=window.onProjectSave;window.onProjectSave=null;callback();}}
 if(name==='review_project_state')return {entries:[],drafts:{},saved:true};
 if(name==='update_review_document')return {documentId:'test'};
 if(name==='read_markatlas_pane'){window.paneConfig=args;return {html:'<p>Companion stub</p>'};}
 throw Error('Unexpected tool '+name);
};
let source=readFileSync(new URL('./src/viewer.js',import.meta.url),'utf8').replace("import {App} from '@modelcontextprotocol/ext-apps';",`class App {addEventListener(){} async connect(){} getHostContext(){return {theme:'light'};}async callServerTool({name,arguments:args}){return {structuredContent:await window.api(name,args)};}}`).replace("import {OpenAIExtensions, OpenAIFileEntrypointInputSchema} from '@openai/mcp-extensions/app';",`class OpenAIExtensions {} const OpenAIFileEntrypointInputSchema={safeParse:()=>({success:false})};`);
window.localStorage.setItem('markatlas:recent-projects:v1',JSON.stringify(['/previous']));
source+=`\nwindow.testUI={open,close,render,setNotes(value){items=value;render();},applyWorkingText,flushPane,renderProjectTree,renderRecentRoots,openProjectFile,splitView,locateReviewEntry,get:()=>({mode,codeMode,fileName}),seed(entry){batchEntries.set(entry.item.id,entry);renderBatch();}};`;
const bundle=await build({stdin:{contents:source,resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});window.eval(bundle.outputFiles[0].text);
const $=id=>window.document.getElementById(id);const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),'UI settled');};

await until(()=>$('project-tree').querySelector('[data-project-path]'));
const original=window.api;window.created=[];
window.api=async(name,args)=>{if(name==='create_review_project_entry'){window.created.push(args);const path=(args.folder?args.folder+'/':'')+args.name;if(args.kind==='file')window.files[path]='';return {path,kind:args.kind};}return original(name,args);};
assert.equal($('open-single-file').getAttribute('aria-label'),'New file');
$('project-tree').querySelector('summary').click();$('open-single-file').click();
assert.equal($('create-entry-dialog').hidden,false);assert.match($('create-entry-location').textContent,/demo\/folder/);
$('create-entry-name').value='new.py';$('create-entry-submit').click();await until(()=>$('create-entry-dialog').hidden);
assert.equal(window.created[0].name,'new.py');assert.equal(window.created[0].folder,'folder');assert.equal(window.created[0].kind,'file');assert.equal($('filename').textContent,'new.py');
$('new-folder').click();$('create-entry-name').value='child';$('create-entry-submit').click();await until(()=>$('create-entry-dialog').hidden);assert.equal(window.created[1].kind,'directory');
const button=$('project-tree').querySelector('[data-project-path]');button.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,detail:2}));assert.equal($('project-tree').querySelector('input'),null);
button.querySelector('.file-label').dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true,detail:2}));assert.ok($('project-tree').querySelector('input'));
dom.window.close();console.log('New file/folder toolbar actions, selected destination, extension preservation and name-only double-click passed');
