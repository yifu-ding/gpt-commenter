import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {htmlTextRecords,htmlPreviewDocument} from './src/html-preview.js';
const source='<!doctype html><html><head><title>Example</title><link rel="stylesheet" href="style.css"></head><body><p>same &amp; <strong>bold</strong></p><p>same</p><button onclick="this.textContent=\'Works\'">Try</button><script>window.pageScriptRan=true;</script></body></html>';
const {records}=htmlTextRecords(source);
assert.equal(records[0].value,'same & ');
assert.equal(source.slice(records[0].map[5],records[0].map[6]),'&amp;');
assert.equal(source.slice(records[2].map[0],records[2].map[4]),'same');
assert.notEqual(records[0].map[0],records[2].map[0]);
const messages=[];
const dom=new JSDOM(htmlPreviewDocument(source,'http://127.0.0.1:1234/token/pages/demo.html','test-channel'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.postMessage=data=>messages.push(data);w.Highlight=class extends Set{constructor(...ranges){super(ranges);}};w.CSS={highlights:new Map()};w.Range.prototype.getBoundingClientRect=()=>({left:20,right:120,top:100,bottom:120});}});
const {window:w}=dom,d=w.document;
assert.equal(w.pageScriptRan,true,'original page scripts still run');
assert.equal(d.querySelector('link').href,'http://127.0.0.1:1234/token/pages/style.css');
const paragraphs=d.querySelectorAll('p');
function select(a,from,b,to){const range=d.createRange();range.setStart(a,from);range.setEnd(b,to);w.getSelection().removeAllRanges();w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));}
select(paragraphs[1].firstChild,0,paragraphs[1].firstChild,4);
await new Promise(r=>setTimeout(r,30));assert.equal(d.querySelector('#atlas-comment').hidden,false);
d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'c',bubbles:true,cancelable:true}));
let note=messages.findLast(m=>m.type==='selection');assert.equal(note.startOffset,source.indexOf('<p>same</p>')+3);assert.equal(note.selectedText,'same');
select(paragraphs[0].firstChild,0,paragraphs[0].querySelector('strong').firstChild,4);
await new Promise(r=>setTimeout(r,30));d.querySelector('#atlas-comment').click();
note=messages.findLast(m=>m.type==='selection');assert.equal(note.selectedText,'same & bold');assert.equal(source.slice(note.startOffset,note.endOffset),'same &amp; <strong>bold');
paragraphs[1].firstChild.data='changed';select(paragraphs[1].firstChild,0,paragraphs[1].firstChild,4);await new Promise(r=>setTimeout(r,30));assert.equal(d.querySelector('#atlas-comment').hidden,false);d.querySelector('#atlas-comment').click();note=messages.findLast(m=>m.type==='selection');assert.equal(note.html.mapping,'element');assert.equal(note.selectedText,'chan');
// Original selections survive unrelated dynamic nodes.
const extra=d.createElement('p');extra.textContent='Dynamic content';d.body.prepend(extra);
select(paragraphs[0],0,paragraphs[0],1);await new Promise(r=>setTimeout(r,30));d.querySelector('#atlas-comment').click();note=messages.findLast(m=>m.type==='selection');assert.equal(note.html.mapping,'exact');
// Closing a composer repaints saved notes, removing only the unsaved selection.
assert.equal(w.CSS.highlights.get('atlas-pending').size,1);
const saved={id:'saved-note',startOffset:source.indexOf('bold'),endOffset:source.indexOf('bold')+4,selectedText:'bold'};
w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{markatlas:'test-channel',type:'notes',notes:[saved],active:null,enabled:true}}));
assert.equal(w.CSS.highlights.has('atlas-pending'),false);assert.equal(w.CSS.highlights.get('atlas-active').size,0);
assert.equal(w.CSS.highlights.get('atlas-notes').size,1,'saved comments remain highlighted');
// Region interaction captures the requested rectangle and associates its image.
w.htmlToImage.toCanvas=async (element,options)=>{assert.equal(options.width,100);assert.equal(options.height,80);return {toDataURL:()=> 'data:image/jpeg;base64,YQ=='};};
d.elementFromPoint=()=>paragraphs[0];w.Range.prototype.getClientRects=()=>[];
w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{markatlas:'test-channel',type:'region',active:true}}));
const overlay=d.querySelector('#atlas-region-overlay');assert.equal(overlay.hidden,false);
for(const [type,x,y] of [['pointerdown',20,30],['pointermove',120,110],['pointerup',120,110]])overlay.dispatchEvent(new w.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true}));
await new Promise(r=>setTimeout(r,30));note=messages.findLast(m=>m.type==='selection');assert.equal(note.html.mapping,'region');assert.equal(note.html.region.width,100);assert.equal(note.html.screenshot,'data:image/jpeg;base64,YQ==');assert.equal(overlay.hidden,true);
w.getSelection().removeAllRanges();d.body.click();assert.equal(messages.at(-1).type,'dismiss','blank clicks dismiss the parent composer');
dom.window.close();console.log('HTML scripts, relative resources, repeated text, entities, cross-element selections, C, and stale-text guards passed');
