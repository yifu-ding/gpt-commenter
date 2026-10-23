import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport, getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ListRootsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {Script} from 'node:vm';
import {fakeCodex} from './test-fixtures/codex.mjs';
import {resolve, relative, isAbsolute} from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const config = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url), 'utf8')).mcpServers['gpt-commenter'];
// Exercise the distributed launch configuration, rather than bypassing it.
assert.equal(config.type, 'stdio');
assert.ok(
  /^[^/\\$]+$/.test(config.command) ||
    (config.command.startsWith('./') &&
      !relative(root, resolve(root, config.command)).startsWith('..') &&
      !isAbsolute(relative(root, resolve(root, config.command)))),
  'Agent Plugins stdio command must be a bare executable name or a contained ./ path'
);
const expandRoot = value => value.replaceAll('${PLUGIN_ROOT}', root.replace(/\/$/, ''));
const testData = mkdtempSync(join(tmpdir(),'markdown-plugin-test-'));
const transport = new StdioClientTransport({
  env:{...getDefaultEnvironment(),...config.env,PLUGIN_DATA:testData,MARKATLAS_CODEX_PATH:fakeCodex(testData)},
  command: config.command.startsWith('./') ? resolve(root, config.command) : config.command,
  args: config.args.map(expandRoot),
  cwd: expandRoot(config.cwd)
});
const client = new Client({name:'mcp-app-check',version:'0.1.0'},{capabilities:{roots:{listChanged:true}}});
let hostRoots=[{uri:new URL('.',import.meta.url).href,name:'Plugin workspace'}];
client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:hostRoots}));
await client.connect(transport);
try {
  const project=await client.callTool({name:'list_markdown_project',arguments:{}});
  assert.equal(project.structuredContent.rootPath,root.replace(/\/$/,''),'host roots override configured fallback');
  const projectFile=await client.callTool({name:'read_markdown_project_file',arguments:{root:project.structuredContent.rootPath,path:'README.md'}});
  assert.match(projectFile.structuredContent.text,/Markdown/);
  const unchanged=await client.callTool({name:'read_markdown_project_file',arguments:{root:project.structuredContent.rootPath,path:'README.md',ifNoneMatch:projectFile.structuredContent.etag}});
  assert.equal(unchanged.structuredContent.notModified,true);assert.equal(unchanged.structuredContent.text,undefined);
  assert.equal((await client.callTool({name:'read_markdown_project_file',arguments:{root:project.structuredContent.rootPath,path:'../README.md'}})).isError,true);
  const brand=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url),'utf8')).extensions['com.openai'].interface;
  assert.equal(client.getServerVersion().title,brand.displayName);
  const expectedIcon=readFileSync(new URL(brand.composerIcon,import.meta.url),'utf8');
  const checkBranding=entry=>{
    assert.equal(entry.title,brand.displayName);
    assert.equal(Buffer.from((entry.icons || client.getServerVersion().icons)[0].src.split(',')[1],'base64').toString(),expectedIcon);
    assert.equal((entry.icons || client.getServerVersion().icons)[0].theme,undefined,'provide an icon for tabs that do not select a theme');
  };
  checkBranding(client.getServerVersion());
  const {resources}=await client.listResources();checkBranding(resources.find(r=>r.uri==='ui://gpt-commenter/markdown-viewer-v3'));
  const {tools} = await client.listTools();
  assert.ok(!tools.some(tool=>['convert_word_preview','render_word_preview_page'].includes(tool.name)),'Word previews expose no conversion API tools');
  const demo = tools.find(tool => tool.name === 'show_markdown_comment_demo');
  assert.ok(demo, 'model-visible demo tool is registered');
  assert.equal(demo._meta.ui.resourceUri, 'ui://gpt-commenter/markdown-viewer-v3');
  assert.ok(!tools.some(tool=>tool.name==='build_latex_pdf'),'compilation belongs to the model and user toolchain, not the plugin');
  const viewer = tools.find(tool => tool.name === 'open_markdown_viewer');
  assert.ok(viewer, 'host-visible viewer is registered');
  checkBranding(viewer);checkBranding(demo);
  assert.equal(viewer._meta.ui.resourceUri, demo._meta.ui.resourceUri);
  const entrypoints=viewer._meta['openai/ui'].entrypoints;
  assert.equal(entrypoints[0].type,'global');assert.equal(entrypoints[1].type,'thread');
  const extensions=entrypoints.find(entry=>entry.type==='file').extensions;
  for(const extension of ['.pdf','.tex','.md','.js','.png','.svg','.csv'])assert.ok(extensions.includes(extension));
  assert.ok(!extensions.includes('.docx') && !extensions.includes('.xlsx'),'Office files use the host native viewer');
  const opened = await client.callTool({name: viewer.name, arguments: {
    file: {name: 'sample.md', resourceUri: 'file:///sample.md'}
  }});
  assert.equal(opened.structuredContent.status, 'ready');
  const result = await client.callTool({name: demo.name, arguments: {}});
  assert.equal(result.structuredContent.status, 'ready');
  const resource = await client.readResource({uri: demo._meta.ui.resourceUri});
  assert.match(resource.contents[0].mimeType, /mcp-app/);
  assert.match(resource.contents[0].text, /MarkAtlas/);
  assert.match(resource.contents[0].text, /Comment/);
  const html = resource.contents[0].text;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'serve one complete viewer script');
  const bundle = readFileSync(new URL('./dist/viewer.js', import.meta.url), 'utf8');
  assert.ok(scripts[0][1] === bundle, 'embedding must preserve bundled JavaScript literally');
  new Script(scripts[0][1], {filename: 'served-viewer.js'});

  assert.equal(resource.contents[0]._meta['openai/ui'].preferredDisplayMode, 'inline');
  assert.deepEqual(client.getServerCapabilities().experimental['openai/settings'],{readTool:'markatlas_settings_read',updateTool:'markatlas_settings_update'});
  assert.equal((await client.callTool({name:'markatlas_settings_read',arguments:{}})).structuredContent.values.explanationModel,'gpt-6-luna');
  assert.equal((await client.callTool({name:'markatlas_settings_update',arguments:{set:{explanationModel:'gpt-6.1-sol'}}})).structuredContent.values.explanationModel,'gpt-6.1-sol');
  const settings=await client.callTool({name:'markatlas_settings_read',arguments:{}});
  assert.equal(settings.structuredContent.values.treePosition,'Left');
  assert.equal(settings.structuredContent.values.showGitChanges,true);
  assert.ok(settings.structuredContent.layout.some(group=>group.items.some(item=>item.tool==='markatlas_clear_recently_opened')));
  assert.equal(settings.structuredContent.values.themeColor,'Host');
  assert.ok(settings.structuredContent.layout[0].items.some(item=>item.property==='themeColor'));
  assert.ok(!tools.some(tool=>tool.name==='markatlas_theme_color'));
  const savedSettings=await client.callTool({name:'markatlas_settings_update',arguments:{set:{treePosition:'Right',outlinePosition:'Right',showGitChanges:false,themeColor:'Purple'}}});
  assert.equal(savedSettings.structuredContent.values.showGitChanges,false);
  assert.equal((await client.callTool({name:'markatlas_settings_update',arguments:{set:{showGitChanges:'false'}}})).isError,true);
  const prompt=await client.callTool({name:'markatlas_clear_recently_opened',arguments:{}});
  assert.equal(prompt.structuredContent.status,'confirmation_required');
  assert.equal((await client.callTool({name:'markatlas_settings_read',arguments:{}})).structuredContent.recentHistoryRevision,'');
  const clearResource=await client.readResource({uri:'ui://gpt-commenter/clear-recent-history'});
  assert.match(clearResource.contents[0].text,/alertdialog/);assert.ok(!clearResource.contents[0].text.includes('/* SCRIPT */'));
  assert.equal((await client.callTool({name:'markatlas_confirm_clear_recently_opened',arguments:{confirmed:false}})).isError,true);
  const cleared=await client.callTool({name:'markatlas_confirm_clear_recently_opened',arguments:{confirmed:true}});
  assert.ok(cleared.structuredContent.recentHistoryRevision);
  const afterClear=await client.callTool({name:'markatlas_settings_read',arguments:{}});
  assert.deepEqual(afterClear.structuredContent.values,savedSettings.structuredContent.values);
  assert.equal(afterClear.structuredContent.recentHistoryRevision,cleared.structuredContent.recentHistoryRevision);
  const unsupported=await client.callTool({name:'generate_review_explanation',arguments:{annotation:{id:'test',selectedText:'Hello',sourceName:'a.md',startLine:1,endLine:1,detail:'short'}}});
  assert.equal(unsupported.isError,undefined,JSON.stringify(unsupported));assert.equal(unsupported.structuredContent.answer,'Background explanation from a fresh conversation.');
  const backgroundReply=await client.callTool({name:'read_markdown_explanation',arguments:{requestId:unsupported.structuredContent.requestId}});assert.equal(backgroundReply.structuredContent.status,'answered');
  const created = await client.callTool({name:'create_markdown_explanation',arguments:{annotation:{id:'note-1',selectedText:'hello',sourceName:'sample.md',startLine:1,endLine:1}}});
  const requestId = created.structuredContent.requestId;
  assert.equal((await client.callTool({name:'read_markdown_explanation',arguments:{requestId}})).structuredContent.status,'pending');
  const answer = await client.callTool({name:'answer_markdown_explanation',arguments:{requestId,answer:'This passage says hello.'}});
  assert.equal(answer.structuredContent.status,'answered');
  const reply = await client.callTool({name:'read_markdown_explanation',arguments:{requestId}});
  assert.equal(reply.structuredContent.answer,'This passage says hello.');
  assert.equal((await client.callTool({name:'answer_markdown_explanation',arguments:{requestId,answer:'duplicate'}})).isError,true);
  await client.callTool({name:'remove_markdown_explanation',arguments:{requestId}});
  assert.equal((await client.callTool({name:'read_markdown_explanation',arguments:{requestId}})).isError,true);
  hostRoots=[];
  assert.equal((await client.callTool({name:'list_markdown_project',arguments:{}})).isError,true);
  const manual=await client.callTool({name:'list_markdown_project',arguments:{folderPath:root}});
  assert.equal(manual.structuredContent.rootPath,root.replace(/\/$/,''));
  const manualRead=await client.callTool({name:'read_markdown_project_file',arguments:{root:manual.structuredContent.rootPath,path:'README.md'}});
  assert.match(manualRead.structuredContent.text,/Markdown/);
  writeFileSync(join(testData,'review.js'),'const value = 1;\n');
  const codeRoot=(await client.callTool({name:'list_markdown_project',arguments:{folderPath:testData}})).structuredContent.rootPath;
  const codeRead=await client.callTool({name:'read_markdown_project_file',arguments:{root:codeRoot,path:'review.js'}});
  const singleCode=await client.callTool({name:'open_review_single_file',arguments:{path:join(codeRoot,'review.js')}});
  assert.equal(singleCode.isError,undefined);assert.equal(singleCode.structuredContent.singleFile,undefined);assert.ok(singleCode.structuredContent.root.children.some(node=>node.name==='review.js'));assert.equal(singleCode.structuredContent.singlePath,'review.js');
  const hostFile=await client.callTool({name:'open_markdown_viewer',arguments:{file:{name:'review.js',resourceUri:'resource://opaque'}},_meta:{'openai/resource':{path:join(codeRoot,'review.js')}}});
  assert.equal(hostFile.isError,undefined,JSON.stringify(hostFile));assert.equal(hostFile.structuredContent.sourcePath,join(codeRoot,'review.js'));assert.equal(hostFile.structuredContent.rootPath,codeRoot);
  const singleImport=await client.callTool({name:'open_review_single_file',arguments:{name:'single.md',data:Buffer.from('# Single file').toString('base64'),resourceKey:'resource://single-test'}});
  assert.equal(singleImport.isError,undefined);assert.equal(singleImport.structuredContent.imported,true);
  const importedText=await client.callTool({name:'read_markdown_project_file',arguments:{root:singleImport.structuredContent.rootPath,path:singleImport.structuredContent.singlePath}});
  assert.equal(importedText.structuredContent.text,'# Single file');
  const codeSave=await client.callTool({name:'save_review_project_file',arguments:{root:codeRoot,path:'review.js',text:'const value = 2;\n',expectedEtag:codeRead.structuredContent.etag}});
  assert.equal(codeSave.structuredContent.text,'const value = 2;\n');
  assert.equal((await client.callTool({name:'save_review_project_file',arguments:{root:codeRoot,path:'review.js',text:'stale',expectedEtag:codeRead.structuredContent.etag}})).isError,true);
  const liveId='7ecc0315-cd14-4848-b24f-83f7406613f3';
  const liveDocument={identity:'test:review.js',sourceName:'review.js',sourcePath:join(codeRoot,'review.js'),baseText:'const value = 2;\n',text:'// new line\nconst value = 2;\n',annotations:[{id:liveId,startOffset:12,endOffset:17,message:'Review this',originalSnapshot:{documentHash:'original',selectedText:'const'}}]};
  assert.equal((await client.callTool({name:'update_review_document',arguments:liveDocument})).isError,undefined);
  const liveResult=JSON.parse((await client.callTool({name:'resolve_review_annotation',arguments:{id:liveId}})).content[0].text);
  assert.equal(liveResult.current.startLine,2);assert.equal(liveResult.hasUnsavedEdits,true);
  const batchEntry={root:codeRoot,path:'review.js',etag:codeSave.structuredContent.etag,item:{id:liveId,sourceName:'review.js',selectedText:'old quote',message:'Review this'}};
  assert.equal((await client.callTool({name:'prepare_review_batch',arguments:{entries:[batchEntry]}})).isError,undefined,'comments may be sent with unsaved draft context');
  const savedDocument={...liveDocument,baseText:liveDocument.text};
  const savedBatchFile=await client.callTool({name:'save_review_project_file',arguments:{root:codeRoot,path:'review.js',text:liveDocument.text,expectedEtag:codeSave.structuredContent.etag}});
  await client.callTool({name:'update_review_document',arguments:savedDocument});
  const batchResult=await client.callTool({name:'prepare_review_batch',arguments:{entries:[{...batchEntry,etag:savedBatchFile.structuredContent.etag}]}});
  assert.equal(batchResult.isError,undefined);assert.equal(batchResult.structuredContent.entries[0].item.startLine,2);assert.equal(batchResult.structuredContent.entries[0].item.selectedText,'const');
  assert.equal((await client.callTool({name:'prepare_review_batch',arguments:{entries:[batchEntry]}})).isError,undefined,'disk changes refresh context without blocking Send');
  const liveRead=JSON.parse((await client.callTool({name:'read_review_working_copy',arguments:{id:liveId,startLine:2,endLine:2}})).content[0].text);assert.equal(liveRead.text,'const value = 2;');
  console.log('MCP viewer entrypoints, tool results, and UI resource checks passed (desktop rendering not tested)');
} finally {
  await client.close();
  rmSync(testData,{recursive:true,force:true});
}
