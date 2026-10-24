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
window.preferences={treePosition:'right',outlinePosition:'right',themeColor:'purple',showGitChanges:false};window.historyRevision='';
window.api=async(name,args)=>{
 if(name==='markatlas_settings_read')return {values:window.preferences,recentHistoryRevision:window.historyRevision};
 if(name==='choose_markdown_project_folder'){window.folderPickCalls++;return {cancelled:true};}
 if(name==='list_markdown_project')return {git:true,rootPath:'/demo',root:{type:'directory',name:'demo',path:'',children:[{type:'file',name:'alpha.md',path:'alpha.md',supported:true,git:{added:8,removed:2}},{type:'directory',name:'folder',path:'folder',children:[{type:'file',name:'beta.md',path:'folder/beta.md',supported:true}]}]}};
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
source+=`\nwindow.testUI={refreshViewerSettings,loadWorkspace,open,close,render,setNotes(value){items=value;render();},applyWorkingText,flushPane,renderProjectTree,renderRecentRoots,openProjectFile,splitView,locateReviewEntry,get:()=>({mode,codeMode,fileName}),seed(entry){batchEntries.set(entry.item.id,entry);renderBatch();}};`;
const bundle=await build({stdin:{contents:source,resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});window.eval(bundle.outputFiles[0].text);
const $=id=>window.document.getElementById(id);const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),'UI settled');};

await until(()=>$('project-tree').querySelector('[data-project-path]'));
assert.equal(window.document.body.dataset.treeSide,'right');assert.equal(window.document.body.dataset.outlineSide,'right');
assert.equal($('project-tree').querySelector('.git-change'),null);assert.equal($('git-summary').hidden,true);
assert.equal(window.document.documentElement.style.getPropertyValue('--markatlas-accent'),'#7952b3');
window.preferences={...window.preferences,treePosition:'left',outlinePosition:'left',themeColor:'host',showGitChanges:true};
await window.testUI.refreshViewerSettings();
assert.equal(window.document.body.dataset.treeSide,'left');assert.equal(window.document.body.dataset.outlineSide,'left');
assert.match($('project-tree').querySelector('.git-change').textContent,/\+8-2/);assert.equal($('git-summary').hidden,false);
assert.equal(window.document.documentElement.style.getPropertyValue('--markatlas-accent'),'');
window.localStorage.setItem('comment-fixture','keep comments');window.localStorage.setItem('draft-fixture','keep drafts');
window.historyRevision='clear-1';await window.testUI.refreshViewerSettings();
assert.equal(window.localStorage.getItem('markatlas:recent-projects:v1'),null);
await window.testUI.loadWorkspace();assert.equal(window.localStorage.getItem('markatlas:recent-projects:v1'),null,'focus refresh must not recreate cleared history');
assert.equal(window.localStorage.getItem('comment-fixture'),'keep comments');assert.equal(window.localStorage.getItem('draft-fixture'),'keep drafts');
window.localStorage.setItem('markatlas:recent-projects:v1','["/new-project"]');await window.testUI.refreshViewerSettings();
assert.equal(window.localStorage.getItem('markatlas:recent-projects:v1'),'["/new-project"]','same revision must not erase new history');
dom.window.close();console.log('Settings positions, live refresh, theme reset, Git badges and history-only clearing passed');
