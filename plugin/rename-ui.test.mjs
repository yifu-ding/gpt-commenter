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
source+=`\nwindow.testUI={applyWorkingText,flushPane,renameTreeEntry,saveCode,renderProjectTree,renderRecentRoots,openProjectFile,splitView,locateReviewEntry,get:()=>({mode,codeMode,fileName}),seed(entry){batchEntries.set(entry.item.id,entry);renderBatch();}};`;
const bundle=await build({stdin:{contents:source,resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});window.eval(bundle.outputFiles[0].text);
const $=id=>window.document.getElementById(id);const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),'UI settled');};

await until(()=>$('project-tree').querySelector('[data-project-path]'));
const originalAPI=window.api;
window.api=async(name,args)=>{
 if(name==='rename_review_project_file'){
  const parent=args.path.includes('/')?args.path.slice(0,args.path.lastIndexOf('/')+1):'',to=parent+args.name;
  for(const path of Object.keys(window.files))if(path===args.path || path.startsWith(args.path+'/')){window.files[to+path.slice(args.path.length)]=window.files[path];delete window.files[path];}
  return {path:to};
 }
 if(name==='list_markdown_project'){
  const root={type:'directory',name:'demo',path:'',children:[]};
  for(const path of Object.keys(window.files)){let parent=root,prefix='';const parts=path.split('/');for(const name of parts.slice(0,-1)){prefix+=(prefix?'/':'')+name;let folder=parent.children.find(n=>n.path===prefix);if(!folder){folder={type:'directory',name,path:prefix,children:[]};parent.children.push(folder);}parent=folder;}parent.children.push({type:'file',name:parts.at(-1),path,supported:true});}
  return {rootPath:'/demo',root};
 }
 if(name==='read_markdown_project_file')assert.ok(Object.hasOwn(window.files,args.path),'Never read the obsolete path '+args.path);
 return originalAPI(name,args);
};
await window.testUI.openProjectFile('folder/beta.md');
window.testUI.applyWorkingText('# Beta edited');await window.testUI.renameTreeEntry('folder','notes');
assert.equal(window.testUI.get().fileName,'notes/beta.md');assert.equal(window.files['notes/beta.md'],'# Beta edited');
assert.ok($('project-tree').querySelector('[data-project-path="notes/beta.md"]'));
window.testUI.applyWorkingText('# Edit after rename');await window.testUI.saveCode();assert.equal(window.files['notes/beta.md'],'# Edit after rename');assert.equal(window.files['folder/beta.md'],undefined);
await window.testUI.renameTreeEntry('notes/beta.md','new.md');assert.equal(window.testUI.get().fileName,'notes/new.md');
$('project-search-toggle').click();assert.ok($('project-search-overlay').classList.contains('search-empty'));assert.equal($('project-search-results').children.length,0);
$('project-search-query').value='edited';$('project-search-query').dispatchEvent(new window.Event('input'));await until(()=>!$('project-search-overlay').classList.contains('search-empty'));
console.log('Rename viewer: open folder descendants, unsaved edits, continued saving and search compact state passed');window.close();
