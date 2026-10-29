import assert from 'node:assert/strict';
import {readRecentHistory,rememberRecent,recentHistoryKey} from './src/recent-history.js';
const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
storage.setItem('markatlas:recent-projects:v1',JSON.stringify(['/latest','/older']));
assert.deepEqual(readRecentHistory(storage).map(x=>x.root),['/latest','/older']);
rememberRecent(storage,'/project',100);
assert.equal(storage.getItem('markatlas:recent-projects:v1'),null);
// Two viewers initialized earlier must preserve one another's later workspace opens.
const staleViewer=readRecentHistory(storage);
rememberRecent(storage,'/other',200);
rememberRecent(storage,'/project',300);
assert.equal(staleViewer.length,3);
assert.deepEqual(readRecentHistory(storage).slice(0,2).map(x=>x.root),['/project','/other']);
assert.equal(readRecentHistory(storage).filter(x=>x.root==='/project').length,1);
for(let i=0;i<15;i++)rememberRecent(storage,`/project-${i}`,400+i);
assert.equal(readRecentHistory(storage).length,10);
assert.deepEqual(readRecentHistory(storage).map(x=>x.root),Array.from({length:10},(_,i)=>`/project-${14-i}`));
// Existing file-level entries are not workspaces and must disappear from the list.
storage.setItem(recentHistoryKey,JSON.stringify([{root:'/folder',path:'opened.md',openedAt:30},{root:'/folder',openedAt:20},{root:'/other',path:'report.pdf',openedAt:40}]));
assert.deepEqual(readRecentHistory(storage).map(x=>x.root),['/folder']);
rememberRecent(storage,'/new',50);
assert.deepEqual(JSON.parse(storage.getItem(recentHistoryKey)).map(x=>x.root),['/new','/folder']);
assert.ok(JSON.parse(storage.getItem(recentHistoryKey)).every(x=>!('path' in x)));
// Unordered persisted workspaces are sorted before applying the limit.
storage.setItem(recentHistoryKey,JSON.stringify(Array.from({length:20},(_,i)=>({root:`/p${i}`,openedAt:i}))));
assert.equal(readRecentHistory(storage)[0].root,'/p19');assert.equal(readRecentHistory(storage).at(-1).root,'/p10');
storage.setItem(recentHistoryKey,'{}');assert.deepEqual(readRecentHistory(storage),[]);
console.log('Recent workspaces: migration, shared-storage merge, file exclusion, repeat opens, newest-first sorting and oldest truncation passed');
