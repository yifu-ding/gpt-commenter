import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm, access, realpath, copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ListRootsRequestSchema} from '@modelcontextprotocol/sdk/types.js';

const root = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8')).mcpServers['gpt-commenter'];
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'markatlas-package-check-')));
const expand = value => value.replaceAll('${PLUGIN_ROOT}', root);
await access(resolve(root, config.command), constants.X_OK);
const runtime=JSON.parse(execFileSync(resolve(root,config.command),['-p','JSON.stringify({platform:process.platform,arch:process.arch})'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}));
assert.deepEqual(runtime,{platform:'darwin',arch:'arm64'});
const metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
assert.deepEqual(metadata.os,['darwin']);assert.deepEqual(metadata.cpu,['arm64']);
assert.equal(metadata.version,JSON.parse(await readFile(join(root,'plugin.json'),'utf8')).version);
await access(join(root, 'dist/FolderPicker.app/Contents/MacOS/folder-picker'), constants.X_OK);
const transport = new StdioClientTransport({
  command: resolve(root, config.command), args: config.args.map(expand), cwd: expand(config.cwd),
  // Exclude development paths so an unbundled dependency cannot pass silently.
  env: {PATH: '/usr/bin:/bin', HOME: fixture, PLUGIN_DATA: fixture},
});
const client = new Client({name: 'desktop-package-check', version: '1.0.0'}, {capabilities: {roots: {listChanged: true}}});
client.setRequestHandler(ListRootsRequestSchema, async () => ({roots: [{uri: pathToFileURL(fixture).href, name: 'Clean fixture'}]}));
try {
  await writeFile(join(fixture, 'README.md'), '# Clean package fixture\n');
  await client.connect(transport);
  const {tools} = await client.listTools();
  assert(tools.some(tool => tool.name === 'show_markdown_comment_demo'));
  const opened = await client.callTool({name: 'show_markdown_comment_demo', arguments: {}});
  assert.equal(opened.structuredContent.status, 'ready');
  const viewer = await client.readResource({uri: 'ui://gpt-commenter/markdown-viewer-v3'});
  assert.match(viewer.contents[0].text, /MarkAtlas/);
  assert(!viewer.contents[0].text.includes('/* VIEWER_SCRIPT */'));
  const project = await client.callTool({name: 'list_markdown_project', arguments: {}});
  assert.equal(project.structuredContent.rootPath, fixture);
  const file = await client.callTool({name: 'read_markdown_project_file', arguments: {root: fixture, path: 'README.md'}});
  assert.match(file.structuredContent.text, /Clean package fixture/);
  const saved = await client.callTool({name: 'save_review_project_file', arguments: {
    root: fixture, path: 'README.md', text: '# Saved through packaged MCP\n', expectedEtag: file.structuredContent.etag,
  }});
  assert(!saved.isError);
  assert.match(await readFile(join(fixture, 'README.md'), 'utf8'), /Saved through packaged MCP/);
  for(const name of ['pipeline.py','settings.custom']){
    await writeFile(join(fixture,name),'# Packaged text fixture\n');
    const opened=await client.callTool({name:'read_markdown_project_file',arguments:{root:fixture,path:name}});
    assert(!opened.isError,JSON.stringify(opened));assert.equal(opened.structuredContent.kind,'text');
    const updated=await client.callTool({name:'save_review_project_file',arguments:{root:fixture,path:name,text:'# Updated through packaged MCP\n',expectedEtag:opened.structuredContent.etag}});
    assert(!updated.isError,JSON.stringify(updated));assert.match(await readFile(join(fixture,name),'utf8'),/Updated through packaged MCP/);
  }
  const missing=await client.callTool({name:'read_markdown_project_file',arguments:{root:fixture,path:'missing.py'}});
  assert.equal(missing.isError,true);assert.match(missing.content[0].text,/moved or deleted/);
  const denied = await client.callTool({name: 'read_markdown_project_file', arguments: {root: fixture, path: '../outside.md'}});
  assert.equal(denied.isError, true);
  await copyFile(join(root,'review-fixtures/review.pdf'), join(fixture,'review.pdf'));
  const pdf = await client.callTool({name:'read_latex_pdf',arguments:{root:fixture,path:'review.pdf'}});
  assert(!pdf.isError, JSON.stringify(pdf));
  assert.match(pdf.structuredContent.text,/Local review fixture/);
  for(const format of ['svg','png']) {
    const page=await client.callTool({name:'render_latex_pdf_page',arguments:{root:fixture,path:'review.pdf',page:1,format}});
    assert(!page.isError,JSON.stringify(page));
    assert.match(page.structuredContent.image,new RegExp(`^data:image/${format==='svg'?'svg\\+xml':'png'};base64,`));
  }
  const settings=await client.callTool({name:'markatlas_settings_read',arguments:{}});
  assert.equal(typeof settings.structuredContent.values.explanationModel,'string');
  for(const tool of tools) for(const hint of ['readOnlyHint','destructiveHint','openWorldHint']) {
    assert.equal(typeof tool.annotations?.[hint],'boolean',`${tool.name}: missing ${hint}`);
  }
  console.log('Extracted ZIP passed: bundled runtime, MCP discovery, viewer resource, file read/save, and traversal rejection.');
  console.log('Bundled PDF extraction, SVG and PNG rendering, settings, and MCP annotations passed.');
} finally {
  await client.close();
  await rm(fixture, {recursive: true, force: true});
}
