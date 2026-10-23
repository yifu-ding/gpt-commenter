import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM(readFileSync(new URL('./src/viewer.html',import.meta.url),'utf8'),{url:'https://viewer.test',runScripts:'outside-only'});
const {window}=dom;
Object.defineProperty(window.crypto,'subtle',{value:webcrypto.subtle});
window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;window.scrollTo=()=>{};
window.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),1);window.cancelAnimationFrame=clearTimeout;
window.Range.prototype.getClientRects=()=>[];
window.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
window.root='/initial';window.names=['README.MD','README.txt','other.md'];window.reads=[];
const source=readFileSync(new URL('./src/viewer.js',import.meta.url),'utf8')
.replace("import {App} from '@modelcontextprotocol/ext-apps';",`class App {
 constructor(){window.app=this;} addEventListener(){} async connect(){} getHostContext(){return {};}
 async callServerTool({name,arguments:a}){if(name==='review_project_state')return {structuredContent:{entries:[],drafts:{},saved:true}};
  let data;
  if(name==='choose_markdown_project_folder' || name==='list_markdown_project'){
   data={rootPath:window.root,root:{name:'Project',children:[{type:'directory',name:'docs',path:'docs',children:[{type:'file',name:'README.md',path:'docs/README.md'}]},...window.names.map(name=>({type:'file',name,path:name,supported:true}))]}};
  }else if(name==='read_markdown_project_file'){
   window.reads.push(a);data={name:a.path,text:'# '+a.path,etag:'1'};
  }else if(name==='update_review_document')data={documentId:'test'};
  else throw Error('Unexpected tool '+name);
  return {structuredContent:data};
 }
}`)
.replace("import {OpenAIExtensions, OpenAIFileEntrypointInputSchema} from '@openai/mcp-extensions/app';",'class OpenAIExtensions {} const OpenAIFileEntrypointInputSchema={safeParse:()=>({success:false})};');
const bundle=await build({stdin:{contents:source,resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false,platform:'browser'});
const $=id=>window.document.getElementById(id);
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.ok(predicate(),'UI operation completed');}
try{
 window.eval(bundle.outputFiles[0].text);
 await until(()=>$('filename').textContent==='README.MD');
 assert.equal(window.reads.length,1,'opening a workspace reads only its root README');
 assert.match($('document').textContent,/README\.MD/);assert.equal($('document').querySelector('.cm-content').getAttribute('contenteditable'),'true');
 assert.equal($('project-drawer').hidden,false);
 $('project-tree').querySelector('[data-project-path="other.md"]').click();await until(()=>$('filename').textContent==='other.md');
 window.dispatchEvent(new window.Event('focus'));await new Promise(r=>setTimeout(r,30));
 assert.equal($('filename').textContent,'other.md','tree refresh preserves the chosen document');
 window.root='/chosen';window.names=['README.txt','README.md','other.md'];$('open-folder').click();
 await until(()=>$('filename').textContent==='README.md');
 assert.equal(window.reads.at(-1).root,'/chosen');
 assert.equal($('project-drawer').hidden,false);
 window.root='/plain';window.names=['readme'];$('open-folder').click();await until(()=>$('filename').textContent==='readme');
 window.root='/empty';window.names=['other.md'];const count=window.reads.length;$('open-folder').click();
 await until(()=>$('filename').textContent==='');await new Promise(r=>setTimeout(r,20));
 assert.equal(window.reads.length,count,'no README means no automatic file read, including nested READMEs');
 assert.match($('document').textContent,/Open a file to read/);
 console.log('Default workspace README, case variants, precedence, missing README, and refresh preservation passed');
}finally{window.dispatchEvent(new window.Event('pagehide'));dom.window.close();}
