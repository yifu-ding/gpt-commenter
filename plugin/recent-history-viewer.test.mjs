import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {explanationSettings,presentSettings} from './src/explanation-settings.js';
const base=await mkdtemp(join(tmpdir(),'workspace-viewer-test-')),preferences=explanationSettings(base);
const windows=[];
let chosen='/first';
const api=async(name,args)=>{
 if(name==='markatlas_settings_read')return {...presentSettings(await preferences.read()),recentHistoryRevision:await preferences.historyRevision(),recentWorkspaces:await preferences.recentWorkspaces()};
 if(name==='remember_review_workspace')return {recentWorkspaces:await preferences.rememberWorkspace(args.root)};
 if(name==='choose_markdown_project_folder')return {rootPath:chosen,root:{name:chosen.slice(1),children:[]}};
 if(name==='list_markdown_project')throw Error('No workspace folder was shared by the app.');
 if(name==='review_project_state')return {entries:[],drafts:{},saved:true};
 if(name==='list_review_patches')return {patches:[]};
 throw Error('Unknown tool '+name);
};
let source=readFileSync(new URL('./src/viewer.js',import.meta.url),'utf8')
.replace("import {App} from '@modelcontextprotocol/ext-apps';",`class App {constructor(){this.listeners={};}addEventListener(name,fn){this.listeners[name]=fn;}async connect(){}getHostContext(){return {theme:'light'};}async callServerTool({name,arguments:args}){return {structuredContent:await window.api(name,args)};}}`)
.replace("import {OpenAIExtensions, OpenAIFileEntrypointInputSchema} from '@openai/mcp-extensions/app';",`class OpenAIExtensions {}const OpenAIFileEntrypointInputSchema={safeParse:()=>({success:false})};`);
source+='\nwindow.historyTest={refreshViewerSettings,rememberRoot};';
const bundle=await build({stdin:{contents:source,resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});
const until=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Timed out');};
async function viewer(){
 const dom=new JSDOM(readFileSync(new URL('./src/viewer.html',import.meta.url),'utf8'),{url:'https://history.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;windows.push(w);
 w.api=api;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.setImmediate=setImmediate;w.clearImmediate=clearImmediate;w.scrollTo=()=>{};
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
 w.Range.prototype.getClientRects=()=>[];w.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
 w.eval(bundle.outputFiles[0].text);await w.historyTest.refreshViewerSettings();return w;
}
try{
 const first=await viewer();first.document.getElementById('open-folder').click();
 await until(()=>first.document.getElementById('open-folder').getAttribute('aria-busy')===null);
 assert.deepEqual((await preferences.recentWorkspaces()).map(entry=>entry.root),['/first']);
 chosen='/latest';first.document.getElementById('open-folder').click();await until(()=>first.document.getElementById('open-folder').getAttribute('aria-busy')===null);
 const second=await viewer(),list=second.document.getElementById('recent-projects');
 assert.equal(list.hidden,false,'fresh viewer displays history from plugin data');
 assert.deepEqual([...list.querySelectorAll('button')].map(button=>button.title),['/latest','/first']);
 // Opening an older workspace again moves it to the top across fresh viewers.
 await second.historyTest.rememberRoot('/first');const third=await viewer();
 assert.deepEqual([...third.document.querySelectorAll('#recent-projects button')].map(button=>button.title),['/first','/latest']);
 // Browser storage failure must not block saving or reading durable history.
 Object.defineProperty(third,'localStorage',{get(){throw Error('Storage denied');}});
 await third.historyTest.rememberRoot('/storage-unavailable');const fourth=await viewer();
 assert.equal(fourth.document.querySelector('#recent-projects button').title,'/storage-unavailable');
 await preferences.clearRecentHistory();await fourth.historyTest.refreshViewerSettings();
 assert.equal(fourth.document.getElementById('recent-projects').hidden,true);
 console.log('Fresh viewers restore persisted workspace order; repeat opens, unavailable browser storage and clear history passed');
}finally{for(const window of windows)window.close();await rm(base,{recursive:true,force:true});}
