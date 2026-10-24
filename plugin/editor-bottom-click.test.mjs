import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const dom=new JSDOM('<!doctype html><main><article></article></main>',{url:'https://indent.test',runScripts:'outside-only',pretendToBeVisual:true}),{window}=dom;
window.Range.prototype.getClientRects=()=>[];window.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
const result=await build({stdin:{contents:"import {EditorView} from '@codemirror/view';window.EditorView=EditorView;import {createCodeEditor} from './editor.js';window.editor=createCodeEditor(document.querySelector('article'),{onChange:text=>{window.edited=text;},onSelection(){},onNote(){},onSave(){}});",resolveDir:new URL('./src',import.meta.url).pathname},bundle:true,format:'iife',write:false});window.eval(result.outputFiles[0].text);

const click=node=>{const e=new window.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientY:10000});node.dispatchEvent(e);return e;};
for(const text of ['First\nLast','First\nLast\n','']){
 window.editor.show({name:'note.md',text,original:text,mode:'edit',live:true});
 const view=window.EditorView.findFromDOM(window.document.querySelector('.cm-editor'));
 for(const target of [window.document.querySelector('main'),window.document.querySelector('article'),view.dom,view.scrollDOM,view.contentDOM]){
  window.editor.selectSpan(0,0);view.contentDOM.blur();assert.equal(click(target).defaultPrevented,true);assert.equal(view.state.selection.main.head,text.length);assert.equal(view.hasFocus,true);
 }
 view.dispatch(view.state.replaceSelection('typed'));assert.equal(view.state.doc.toString(),text+'typed');
 window.editor.destroy();
}
window.editor.show({name:'note.md',text:'Read only',original:'Read only',mode:'review',live:true});assert.equal(click(window.document.querySelector('main')).defaultPrevented,false);
window.editor.destroy();dom.window.close();console.log('Markdown bottom blank click focuses EOF, preserves trailing blank lines, permits typing, and excludes read-only mode');
