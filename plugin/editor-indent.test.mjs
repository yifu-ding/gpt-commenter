import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const dom=new JSDOM('<!doctype html><main></main>',{url:'https://indent.test',runScripts:'outside-only',pretendToBeVisual:true}),{window}=dom;
window.Range.prototype.getClientRects=()=>[];window.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
const result=await build({stdin:{contents:"import {createCodeEditor} from './editor.js';window.editor=createCodeEditor(document.querySelector('main'),{onChange:text=>{window.edited=text;},onSelection(){},onNote(){},onSave(){}});",resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});window.eval(result.outputFiles[0].text);
function tab(shiftKey=false){const event=new window.KeyboardEvent('keydown',{key:'Tab',code:'Tab',keyCode:9,bubbles:true,cancelable:true,shiftKey});window.document.querySelector('.cm-content').dispatchEvent(event);return event;}
for(const [name,live] of [['note.md',true],['note.md',false],['code.py',false],['data.json',false]]){
 window.edited='one\ntwo\nthree';window.editor.show({name,text:window.edited,original:window.edited,mode:'edit',live});window.editor.selectSpan(0,7);
 assert.equal(tab().defaultPrevented,true);assert.equal(window.edited,'    one\n    two\nthree');tab();assert.equal(window.edited,'        one\n        two\nthree');tab(true);assert.equal(window.edited,'    one\n    two\nthree');
 window.editor.focusAt(window.edited.length);tab();assert.ok(window.edited.endsWith('three    '));window.editor.destroy();
}
window.editor.show({name:'read-only.md',text:'one',original:'one',mode:'review'});window.edited='one';tab();assert.equal(window.edited,'one');window.editor.destroy();dom.window.close();console.log('Tab: four spaces, multi-line repeated indentation, Shift-Tab, Markdown Edit/Source and code, read-only guard passed');
