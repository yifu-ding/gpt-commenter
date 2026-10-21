import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateExplanation} from './src/background-explanation.js';
import {explanationSettings} from './src/explanation-settings.js';
const base=await mkdtemp(join(tmpdir(),'markatlas-settings-'));
try{
 const store=explanationSettings(base);
 assert.deepEqual(await store.read(),{explanationModel:'gpt-6-luna'});
 await store.update({explanationModel:'gpt-6.1-sol'});
 assert.equal((await explanationSettings(base).read()).explanationModel,'gpt-6.1-sol');
 await assert.rejects(()=>store.update({explanationModel:'invalid'}));
 await assert.rejects(()=>store.update({unknown:true}));
 const item={id:'note',detail:'short',sourceName:'a.md',startLine:1,endLine:2,selectedText:'Explain this actual text.'};
 let backgroundInput;
 const fallback=await generateExplanation({getClientCapabilities:()=>({})},{explanationModel:'gpt-6-luna'},item,{background:async input=>{backgroundInput=input;return {answer:'Hidden conversation reply',model:input.model};}});
 assert.equal(fallback.answer,'Hidden conversation reply');assert.match(backgroundInput.prompt,/Explain this actual text/);assert.equal(backgroundInput.model,'gpt-6-luna');
 let sent;const client={getClientCapabilities:()=>({sampling:{}}),async createMessage(params){sent=params;return {role:'assistant',model:'gpt-6-luna',content:{type:'text',text:'An explanation.'}};}};
 const result=await generateExplanation(client,{explanationModel:'gpt-6-luna'},item);
 assert.equal(result.answer,'An explanation.');assert.equal(result.model,'gpt-6-luna');
 assert.deepEqual(sent.modelPreferences.hints,[{name:'gpt-6-luna'}]);assert.equal(sent.includeContext,'none');assert.match(sent.messages[0].content.text,/Explain this actual text/);assert.equal(sent.tools,undefined);
 await generateExplanation(client,{explanationModel:'gpt-6-astra'},{...item,pdf:{page:2,screenshot:'data:image/jpeg;base64,Y3JvcA=='}});
 assert.equal(sent.modelPreferences.hints[0].name,'gpt-6-astra');assert.equal(sent.messages[1].content.type,'image');
 const longSelection='Start '+('Context '.repeat(300))+'END_MUST_REACH_MODEL';
 await generateExplanation(client,{explanationModel:'gpt-6-luna'},{...item,sourceName:'docs/a.md',sourcePath:'/project/docs/a.md',projectRoot:'/project',documentHash:'a'.repeat(64),selectedText:longSelection});
 assert.match(sent.messages[0].content.text,/Project: \/project\nFile: docs\/a.md/);assert.match(sent.messages[0].content.text,/Detail: short \(about 150 words\)/);
 assert.ok(sent.messages[0].content.text.includes(longSelection),'tool-free explanation receives all selected context');
 assert.doesNotMatch(sent.messages[0].content.text,/sha256|Annotation:|resolve_review_annotation|Comment:/);
 await generateExplanation(client,{explanationModel:'gpt-6-luna'},{...item,pdf:{page:1,screenshot:'data:image/png;base64,Y3JvcA=='}});
 assert.equal(sent.messages[1].content.mimeType,'image/png');assert.match(sent.messages[0].content.text,/Screenshot: attached/);
 await assert.rejects(()=>generateExplanation(client,{}, {...item,selectedText:'x'.repeat(50001)}),/smaller passage/);
}finally{await rm(base,{recursive:true,force:true});}
console.log('Background sampling, unsupported host, image, and persisted settings checks passed');

// Exercise sampling over a real MCP stdio connection, including the reply store.
const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport,getDefaultEnvironment}=await import('@modelcontextprotocol/sdk/client/stdio.js');
const {CreateMessageRequestSchema}=await import('@modelcontextprotocol/sdk/types.js');
const {fileURLToPath}=await import('node:url');
const root=fileURLToPath(new URL('.',import.meta.url));
const data=await mkdtemp(join(tmpdir(),'markatlas-sampling-'));
const transport=new StdioClientTransport({command:join(root,'node_modules/node/bin/node'),args:[join(root,'dist/server.js')],cwd:root,env:{...getDefaultEnvironment(),PLUGIN_DATA:data}});
const host=new Client({name:'sampling-test',version:'1'},{capabilities:{sampling:{}}});
let samplingCalls=[];
host.setRequestHandler(CreateMessageRequestSchema,async request=>{samplingCalls.push(request.params);return {role:'assistant',model:request.params.modelPreferences.hints[0].name,content:{type:'text',text:'The background explanation.'}};});
try{
 await host.connect(transport);
 const annotation={id:'test',sourceName:'sample.md',selectedText:'This is a passage.',startLine:2,endLine:3,detail:'medium'};
 const generated=await host.callTool({name:'generate_review_explanation',arguments:{annotation}});
 assert.equal(generated.isError,undefined,JSON.stringify(generated));
 assert.equal(generated.structuredContent.answer,'The background explanation.');
 assert.equal(generated.structuredContent.model,'gpt-6-luna');
 const stored=await host.callTool({name:'read_markdown_explanation',arguments:{requestId:generated.structuredContent.requestId}});
 assert.equal(stored.structuredContent.status,'answered');assert.equal(stored.structuredContent.answer,'The background explanation.');
 await host.callTool({name:'markatlas_settings_update',arguments:{set:{explanationModel:'gpt-6.1-sol'}}});
 const next=await host.callTool({name:'generate_review_explanation',arguments:{annotation}});
 assert.equal(next.structuredContent.model,'gpt-6.1-sol');
 assert.equal(samplingCalls.length,2);assert.equal(samplingCalls[1].modelPreferences.hints[0].name,'gpt-6.1-sol');
}finally{await host.close();await rm(data,{recursive:true,force:true});}
console.log('Real MCP background request, settings, and stored reply checks passed');
