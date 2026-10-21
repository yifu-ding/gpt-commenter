import {EditorView,basicSetup} from 'codemirror';
import {EditorState,StateEffect,StateField} from '@codemirror/state';
import {Decoration,WidgetType,keymap} from '@codemirror/view';
import {MergeView} from '@codemirror/merge';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {cpp} from '@codemirror/lang-cpp';
import {rust} from '@codemirror/lang-rust';
import {sql} from '@codemirror/lang-sql';
import {markdown} from '@codemirror/lang-markdown';
import {java} from '@codemirror/lang-java';
import {StreamLanguage,HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {stex} from '@codemirror/legacy-modes/mode/stex';
import {tags} from '@lezer/highlight';
import {sourceSelection} from './markdown.js';
const notesEffect=StateEffect.define();
const latexLanguage=StreamLanguage.define(stex);
const latexColors=syntaxHighlighting(HighlightStyle.define([
  {tag:[tags.tagName,tags.keyword],color:'light-dark(#7c3aed, #c4b5fd)'},
  {tag:[tags.atom,tags.string],color:'light-dark(#0369a1, #7dd3fc)'},
  {tag:[tags.number,tags.special(tags.variableName)],color:'light-dark(#b45309, #fbbf24)'},
  {tag:tags.bracket,color:'light-dark(#64748b, #cbd5e1)'},
  {tag:tags.comment,color:'light-dark(#4d7c0f, #a3c46b)',fontStyle:'italic'},
  {tag:tags.invalid,color:'light-dark(#b91c1c, #fca5a5)'}
]));
class NoteIcon extends WidgetType {
  constructor(note,onNote){super();this.note=note;this.onNote=onNote;}
  eq(other){return this.note===other.note;}
  toDOM(view){const button=view.dom.ownerDocument.createElement('button');button.className='annotation-icon';button.textContent=this.note.kind==='explanation'?'?':'▤';button.setAttribute('aria-label',`Review note on lines ${this.note.startLine}–${this.note.endLine}`);button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();this.onNote(this.note,button.getBoundingClientRect());});return button;}
  ignoreEvent(){return true;}
}
function language(name){
  if(/\.(tex|ltx|latex|sty|cls|dtx|ins)$/i.test(name))return [latexLanguage,latexColors];
  if(/\.(md|markdown)$/i.test(name))return markdown();
  if(/\.[cm]?[jt]sx?$/i.test(name))return javascript({typescript:/\.[cm]?tsx?$/i.test(name),jsx:/\.[jt]sx$/i.test(name)});
  if(/\.py$/i.test(name))return python();if(/\.json$/i.test(name))return json();
  if(/\.html?$/i.test(name))return html();if(/\.s?css$/i.test(name))return css();
  if(/\.(c|h|cc|cpp|hpp)$/i.test(name))return cpp();if(/\.rs$/i.test(name))return rust();
  if(/\.sql$/i.test(name))return sql();if(/\.java$/i.test(name))return java();return [];
}
const theme=EditorView.theme({
  '&':{backgroundColor:'var(--bg)',color:'var(--fg)',fontSize:'calc(13px * var(--text-scale, 1))'},
  '.cm-content':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'1.7',padding:'12px 0'},
  '.cm-gutters':{backgroundColor:'var(--bg)',color:'var(--muted)',border:'none'},
  '.cm-activeLine':{backgroundColor:'color-mix(in srgb, var(--accent) 5%, transparent)'},
  '.cm-activeLineGutter':{backgroundColor:'var(--surface)'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--selection) !important'},
  '.cm-content ::selection':{backgroundColor:'var(--selection)'},
  '.cm-review-note.pending-selection':{backgroundColor:'var(--selection)'},
  '.cm-cursor':{borderLeftColor:'var(--fg)'},
  '.cm-review-note':{backgroundColor:'var(--highlight)',borderRadius:'2px'},
  '&.cm-focused':{outline:'none'},'.cm-scroller':{overflow:'auto'}
});
export function createCodeEditor(container,{onChange,onSelection,onNote,onSave}) {
  let current=null,key='',lastOriginal='';
  function destroy(){current?.destroy();current=null;key='';container.replaceChildren();}
  function marks(items){const ranges=[];for(const item of items){if(item.pdf?.region || item.startOffset<0 || item.endOffset<=item.startOffset || item.endOffset>current.state.doc.length)continue;ranges.push(Decoration.mark({class:item.temporary?'cm-review-note pending-selection':'cm-review-note',inclusiveEnd:true}).range(item.startOffset,item.endOffset));if(!item.temporary)ranges.push(Decoration.widget({widget:new NoteIcon(item,onNote),side:1}).range(item.endOffset));}return Decoration.set(ranges,true);}
  const notes=StateField.define({create:()=>Decoration.none,update(value,tr){for(const effect of tr.effects)if(effect.is(notesEffect))return marks(effect.value);return value.map(tr.changes);},provide:field=>EditorView.decorations.from(field)});
  function extensions(name,readOnly,review){return [basicSetup,theme,language(name),EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),keymap.of([{key:'Mod-s',run:()=>{onSave();return true;}}]),...(review?[notes]:[])];}
  return {
    show({name,text,original,mode,items=[]}) {
      const nextKey=`${name}:${mode}`;
      const same=current && key===nextKey && (mode==='changes' ? lastOriginal===original && current.b.state.doc.toString()===text : current.state.doc.toString()===text);
      if(!same){destroy();key=nextKey;lastOriginal=original;
        if(mode==='changes') {
          current=new MergeView({parent:container,a:{doc:original,extensions:extensions(name,true,false)},b:{doc:text,extensions:extensions(name,true,false)},highlightChanges:true,gutter:true,collapseUnchanged:{margin:3,minSize:8}});
        } else {
          current=new EditorView({parent:container,doc:text,extensions:[...extensions(name,mode!=='edit',true),EditorView.contentAttributes.of({'aria-label':mode==='edit' ? (/\.(md|markdown)$/i.test(name)?'Markdown source editor':'Code editor') : 'Source review'}),EditorView.updateListener.of(update=>{if(update.docChanged){const updated=onChange(update.state.doc.toString(),update.changes,update.startState.selection.main.head);if(updated)queueMicrotask(()=>{if(current===update.view && current.state.doc===update.state.doc)current.dispatch({effects:notesEffect.of(updated.filter(item=>item.anchorStatus!=='deleted'))});});}}),EditorView.domEventHandlers({pointerup:(e,view)=>{if(e.target.closest?.('.annotation-icon'))return false;if(mode!=='changes')queueMicrotask(()=>capture(view));return false;},keyup:(_e,view)=>{if(mode!=='changes')capture(view);return false;}})]});
        }
      }
      if(mode!=='changes')current.dispatch({effects:notesEffect.of(items)});
    },
    destroy,
    measure(){if(current instanceof EditorView)current.requestMeasure();else if(current){current.a.requestMeasure();current.b.requestMeasure();}},
    selectSpan(from,to){if(current instanceof EditorView){current.focus();current.dispatch({selection:{anchor:from,head:to}});}},
    focusLine(line){if(current instanceof EditorView){const position=current.state.doc.line(Math.max(1,Math.min(line,current.state.doc.lines))).from;current.dispatch({selection:{anchor:position},effects:EditorView.scrollIntoView(position,{y:'center'})});current.focus();}},
    caret(){return current instanceof EditorView ? current.state.selection.main.head : 0;},
    focusAt(position){if(current instanceof EditorView){current.dispatch({selection:{anchor:Math.min(position,current.state.doc.length)}});current.focus();}},
    focus(){if(current instanceof EditorView){const selection=current.state.selection;current.focus();current.dispatch({selection});}}
  };
  function capture(view){const selection=view.state.selection.main;if(selection.empty)return;const text=view.state.doc.toString();onSelection({...sourceSelection(text,selection.from,selection.to),mappingStatus:'exact'},view.coordsAtPos(selection.to));}
}
