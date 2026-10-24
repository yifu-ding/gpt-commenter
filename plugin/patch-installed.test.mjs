import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const plugin=resolve(process.argv[2]||'.');
const fixture=await realpath(await mkdtemp(join(tmpdir(),'markatlas-installed-patch-')));
const root=join(fixture,'project');await mkdir(join(root,'nested'),{recursive:true});
const path='nested/CLAUDE.md',baseText='视觉Transformer\n',proposedText='视觉 Transformer\n';
await writeFile(join(root,path),baseText);
let client;
async function connect(){const c=new Client({name:'patch-install-check',version:'1.0.0'},{capabilities:{}});await c.connect(new StdioClientTransport({command:join(plugin,'node_modules/node/bin/node'),args:[join(plugin,'dist/server.js')],cwd:plugin,env:{PATH:process.env.PATH,HOME:process.env.HOME,PLUGIN_DATA:join(fixture,'data')}}));return c;}
async function call(name,args){const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);}
try{
 client=await connect();
 const patch=await call('create_review_patch',{root,path,baseText,proposedText});
 assert.equal(await readFile(join(root,path),'utf8'),baseText);
 const disk=JSON.parse(await readFile(join(root,'nested/.markatlas/patches',patch.id+'.json'),'utf8'));assert.equal(disk.proposedText,proposedText);
 await client.close();client=await connect();
 const loaded=await call('read_review_patch',{root:join(root,'nested'),path:'CLAUDE.md',id:patch.id});assert.equal(loaded.proposedText,proposedText);
 await call('update_review_patch',{root,path,id:patch.id,expectedRevision:1,comment:{message:'Persist after restart'}});
 const list=await call('list_review_patches',{root,path});assert.ok(list.patches.some(p=>p.id===patch.id));
 const rejected=await client.callTool({name:'apply_review_patch',arguments:{root,path,id:patch.id,expectedRevision:2}});assert.equal(rejected.isError,true);
 assert.equal(await readFile(join(root,path),'utf8'),baseText);
 console.log('Installed MCP server: disconnected create, disk persistence, restart, nested root recovery, update/list, and apply access checks passed.');
}finally{await client?.close();await rm(fixture,{recursive:true,force:true});}
