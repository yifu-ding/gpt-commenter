import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {accentColors,applyThemeColor,syncRecentHistory,recentRootsKey} from './src/viewer-settings.js';
import {recentHistoryKey} from './src/recent-history.js';
import {explanationSettings,defaults,settingsSchema,settingsLayout,presentSettings} from './src/explanation-settings.js';
import {OpenAISettingsReadResultSchema} from '@openai/mcp-extensions';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
OpenAISettingsReadResultSchema.parse(presentSettings(defaults));
assert.deepEqual(settingsSchema.properties.themeColor.enum,['host',...Object.keys(accentColors)]);
const base=await mkdtemp(join(tmpdir(),'markatlas-preferences-test-'));
try{
 await writeFile(join(base,'explanation-settings.json'),JSON.stringify({explanationModel:'gpt-6-astra'}));
 const store=explanationSettings(base);assert.deepEqual(await store.read(),{...defaults,explanationModel:'gpt-6-astra'});
 await store.update({showGitChanges:false,themeColor:'teal'});assert.equal((await explanationSettings(base).read()).showGitChanges,false);
 await assert.rejects(store.update({showGitChanges:'false'}));await assert.rejects(store.update({themeColor:'unknown'}));
 const before=await store.read();const revision=await store.clearRecentHistory();assert.ok(revision);assert.deepEqual(await store.read(),before);assert.equal(await explanationSettings(base).historyRevision(),revision);
}finally{await rm(base,{recursive:true,force:true});}
const source=readFileSync(new URL('./src/clear-history.js',import.meta.url),'utf8').replace("import {App} from '@modelcontextprotocol/ext-apps';",`class App {async connect(){} async callServerTool(args){window.calls.push(args);return {};}}`);
const bundle=await build({stdin:{contents:source,resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});
for(const action of ['cancel','confirm']){
 const dom=new JSDOM(readFileSync(new URL('./src/clear-history.html',import.meta.url),'utf8'),{runScripts:'outside-only',url:'https://settings.test'}),w=dom.window;w.calls=[];w.eval(bundle.outputFiles[0].text);await new Promise(r=>setTimeout(r,0));
 assert.equal(w.calls.length,0,'opening the confirmation does not clear history');w.document.getElementById(action).click();await new Promise(r=>setTimeout(r,0));
 assert.equal(w.calls.length,action==='cancel'?0:1);if(action==='confirm')assert.equal(w.calls[0].arguments.confirmed,true);
 const storage=w.localStorage;storage.setItem(recentRootsKey,'["old"]');storage.setItem(recentHistoryKey,'[{"root":"/old","openedAt":1}]');storage.setItem('comments','keep');assert.equal(syncRecentHistory(storage,'1'),true);assert.equal(storage.getItem(recentHistoryKey),null);assert.equal(storage.getItem('comments'),'keep');storage.setItem(recentRootsKey,'["new"]');assert.equal(syncRecentHistory(storage,'1'),false);
 for(const color of Object.keys(accentColors))for(const theme of ['light','dark']){applyThemeColor(color,{theme},w.document.documentElement);assert.equal(w.document.documentElement.style.getPropertyValue('--markatlas-accent'),accentColors[color][theme==='dark'?1:0]);}
 dom.window.close();
}
console.log('Native settings schema, migration, persistence, all palette colors, confirmation/cancellation and history isolation passed');
