import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const dom=new JSDOM('<!doctype html><main></main>',{url:'https://indent.test',runScripts:'outside-only',pretendToBeVisual:true}),{window}=dom;
window.Range.prototype.getClientRects=()=>[];window.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
const result=await build({stdin:{contents:"import {createCodeEditor} from './editor.js';window.editor=createCodeEditor(document.querySelector('main'),{onChange:text=>{window.edited=text;},onSelection(){},onNote(){},onSave(){}});",resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});window.eval(result.outputFiles[0].text);

function enter(){const e=new window.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true,cancelable:true});window.document.querySelector('.cm-content').dispatchEvent(e);assert.equal(e.defaultPrevented,true);}
for(const [text,expected] of [['1. First\n2. Second','1. First\n2. Second\n3. '],['1. First\n\n2. Second','1. First\n\n2. Second\n3. '],['- First\n\n- Second','- First\n\n- Second\n- '],['Paragraph','Paragraph\n']]){
 window.edited=text;window.editor.show({name:'note.md',text,original:text,mode:'edit',live:true});window.editor.focusAt(text.length);enter();assert.equal(window.edited,expected);
 const count=window.edited.split('\n').length;enter();assert.equal(window.edited.split('\n').length,count+1);enter();assert.equal(window.edited.split('\n').length,count+2);window.editor.destroy();
}
dom.window.close();console.log('One Enter adds one newline in tight/loose ordered and unordered lists, empty list exit, and paragraphs');
