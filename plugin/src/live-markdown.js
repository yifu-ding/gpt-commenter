import {applyTableColumns} from './table-layout.js';
import {frontmatter} from 'micromark-extension-frontmatter';
import {frontmatterFromMarkdown} from 'mdast-util-frontmatter';
import {StateField,StateEffect} from '@codemirror/state';
import {EditorView,Decoration,WidgetType} from '@codemirror/view';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfm} from 'micromark-extension-gfm';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {renderMarkdown} from './markdown.js';
export const revealBlock=StateEffect.define(),liveNotes=StateEffect.define();
export function markdownBlocks(text){return fromMarkdown(text,{extensions:[gfm(),frontmatter(['yaml','toml'])],mdastExtensions:[gfmFromMarkdown(),frontmatterFromMarkdown(['yaml','toml'])]}).children;}
// Table rows and list lines are independent widgets, so editing one never reveals its siblings.
export function markdownPreviewUnits(doc){
 const text=doc.toString(),units=[];
 for(const node of markdownBlocks(text)){
  const from=node.position.start.offset,to=node.position.end.offset;
  if(node.type==='table'){
   const cellText=node=>node.value??(node.children||[]).map(cellText).join('');const cells=node.children.map(row=>row.children.map(cellText));
   const first=doc.lineAt(from),separator=doc.line(first.number+1),prefix=first.text+'\n'+separator.text+'\n';
   units.push({from:first.from,to:first.to,text:first.text+'\n'+separator.text,renderFrom:first.from,kind:'table',cells});
   units.push({from:separator.from,to:separator.to,text:'',renderFrom:separator.from,kind:'separator'});
   for(let i=separator.number+1;i<=doc.lineAt(to).number;i++){const line=doc.line(i);units.push({from:line.from,to:line.to,text:prefix+line.text,renderFrom:line.from-prefix.length,kind:'table-row',cells,stripe:(i-separator.number)%2===0?'even':'odd'});}
  }else if(node.type==='list'){
   const depths=new Map(),codes=new Map();
   function listDepth(list,depth){for(const item of list.children){for(let i=item.position.start.line;i<=item.position.end.line;i++)depths.set(i,depth);for(const child of item.children||[]){if(child.type==='list')listDepth(child,depth+1);if(child.type==='code')codes.set(child.position.start.line,{node:child,depth});}}}
   listDepth(node,0);
   for(let i=doc.lineAt(from).number;i<=doc.lineAt(to).number;i++){const code=codes.get(i);if(code){
    const first=doc.line(i),last=doc.line(code.node.position.end.line),indent=first.text.match(/^\s*/)[0];let rendered='',sourceOffsets=[];
    for(let row=i;row<=last.number;row++){const line=doc.line(row),skip=line.text.startsWith(indent)?indent.length:0;for(let offset=skip;offset<line.text.length;offset++){sourceOffsets.push(line.from+offset);rendered+=line.text[offset];}if(row<last.number){sourceOffsets.push(line.to);rendered+='\n';}}
    sourceOffsets.push(last.to);units.push({from:first.from,to:last.to,text:rendered,renderFrom:first.from,sourceOffsets,depth:code.depth,kind:'list-code'});i=last.number;continue;
   }const line=doc.line(i);if(!line.text.trim())continue;const indent=line.text.match(/^\s*/)[0].length;units.push({from:line.from,to:line.to,text:line.text.slice(indent),renderFrom:line.from+indent,depth:depths.get(i)||0,kind:'list'});}
  }else units.push({from,to,text:text.slice(from,to),renderFrom:from,kind:node.type,headingLevel:node.depth});
 }return units;
}
export function liveMarkdown(options={}){
 class Preview extends WidgetType {
  constructor(unit,notes){super();this.unit=unit;this.notes=notes;}
  eq(other){return JSON.stringify(other.unit)===JSON.stringify(this.unit) && JSON.stringify(other.notes)===JSON.stringify(this.notes);}
  get estimatedHeight(){return this.unit.kind==='separator'?0:-1;}
  toDOM(view){
   const unit=this.unit,node=document.createElement('div');node.className='cm-markdown-preview';node.dataset.sourceFrom=unit.from;node.dataset.sourceTo=unit.to;
   if(unit.kind==='separator'){node.style.display='none';return node;}
   if(unit.kind==='list' || unit.kind==='list-code'){node.classList.add('cm-markdown-list-line');node.style.paddingLeft=`calc(4px + ${unit.depth*2+(unit.kind==='list-code'?1.5:0)}em)`;}
   const sourceOffset=offset=>unit.sourceOffsets?.[offset]??unit.renderFrom+offset;
   const renderedOffset=offset=>{if(!unit.sourceOffsets)return offset-unit.renderFrom;const index=unit.sourceOffsets.findIndex(value=>value>=offset);return index<0?unit.text.length:index;};
   const mapping=renderMarkdown(node,unit.text,'rendered',this.notes.map(note=>({...note,startOffset:Math.max(0,renderedOffset(note.startOffset)),endOffset:Math.min(unit.text.length,renderedOffset(note.endOffset))})),{...options,toggleTask:options.toggleTask?(offset,state,expected)=>options.toggleTask(offset+unit.renderFrom,state,expected):undefined});
   if(unit.kind==='table-row')node.querySelector('thead')?.remove();
   if(unit.kind.startsWith('table')){
    node.classList.add('cm-markdown-table-row');node.dataset.rowStripe=unit.stripe||'header';
    applyTableColumns(node.querySelector('table'),unit.cells);

   }
   if(unit.kind==='list' || unit.kind==='list-code')for(let level=0;level<unit.depth;level++){const guide=document.createElement('span');guide.className='cm-list-indent-guide';guide.setAttribute('aria-hidden','true');guide.style.left=`calc(4px + ${level*2+.5}em)`;node.append(guide);}
   node.addEventListener('mousedown',event=>{
    if(event.button!==0 || event.target.closest('a,button,input,summary,[data-annotation]') || view.composing)return;
    let anchor=unit.from;const doc=node.ownerDocument,point=doc.caretPositionFromPoint?.(event.clientX,event.clientY);let range=doc.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(point){range=doc.createRange();range.setStart(point.offsetNode,point.offset);range.collapse(true);}
    if(range && node.contains(range.startContainer)){const span=mapping.resolve(range);if(span)anchor=Math.max(unit.from,Math.min(unit.to,sourceOffset(span.startOffset)));}
    event.preventDefault();view.dispatch({selection:{anchor},effects:revealBlock.of(anchor)});view.focus();
   });return node;
  }
  ignoreEvent(){return true;}
 }
 function decorations(state,active,notes,units){
  const ranges=[],selection=state.selection.main,first=state.doc.lineAt(selection.from),last=state.doc.lineAt(selection.to);
  const add=unit=>{if(unit.to>unit.from)ranges.push(Decoration.replace({widget:new Preview(unit,notes.filter(note=>note.startOffset<unit.to && note.endOffset>unit.from)),block:true}).range(unit.from,unit.to));};
  for(const unit of units){
   if(!active || first.from>unit.to || last.to<unit.from){add(unit);continue;}
   if(unit.kind==='yaml' || unit.kind==='toml' || unit.kind==='list-code')continue;
   if(unit.kind==='heading')for(let number=first.number;number<=last.number;number++){const line=state.doc.line(number);if(line.from>=unit.from && line.from<=unit.to)ranges.push(Decoration.line({attributes:{'data-live-heading':String(unit.headingLevel)}}).range(line.from));}
   // Leave only the caret/selection lines as real CodeMirror text. Preserve previews around them.
   if(unit.from<first.from){const to=first.from-1;add({...unit,to,text:state.sliceDoc(unit.from,to)});}
   if(unit.to>last.to){const from=last.to+1;add({...unit,from,renderFrom:from,text:state.sliceDoc(from,unit.to)});}
  }for(let number=1;number<=state.doc.lines;number++){const line=state.doc.line(number);if(!line.text.trim() && !(active && selection.from<=line.to && selection.to>=line.from))ranges.push(Decoration.line({class:'cm-markdown-gap'}).range(line.from));}return Decoration.set(ranges,true);
 }
 const field=StateField.define({
  create:state=>{const units=markdownPreviewUnits(state.doc);return {active:false,units,notes:[],marks:decorations(state,false,[],units)};},
  update(value,tr){let active=value.active,notes=value.notes;for(const effect of tr.effects){if(effect.is(revealBlock))active=true;if(effect.is(liveNotes))notes=effect.value;}
   if(tr.docChanged)active=true;
   const units=tr.docChanged?markdownPreviewUnits(tr.state.doc):value.units;
   if(tr.docChanged || tr.selection || active!==value.active || notes!==value.notes)return {active,units,notes,marks:decorations(tr.state,active,notes,units)};return value;
  },provide:field=>EditorView.decorations.from(field,value=>value.marks)
 });
 return [field,EditorView.lineWrapping,EditorView.domEventHandlers({mousedown(event,view){if(!event.target.closest('.cm-markdown-preview'))view.dispatch({effects:revealBlock.of(view.state.selection.main.head)});return false;},keydown(event,view){if(!event.isComposing && !view.state.field(field).active)view.dispatch({effects:revealBlock.of(view.state.selection.main.head)});return false;}}),EditorView.theme({'.cm-gutters':{display:'none'},'.cm-content':{fontFamily:'system-ui,sans-serif',fontSize:'calc(14px * var(--text-scale,1))',lineHeight:'1.65'},'.cm-line':{minHeight:'1.65em'},'.cm-markdown-preview':{padding:'0 4px'},'.cm-markdown-preview > :first-child':{marginTop:'0'},'.cm-markdown-preview > :last-child':{marginBottom:'0'},'.cm-markdown-table-row table':{display:'table !important',tableLayout:'fixed !important',margin:'0 !important'},'.cm-markdown-table-row th,.cm-markdown-table-row td':{width:'auto !important'},'.cm-markdown-preview ul,.cm-markdown-preview ol,.cm-markdown-preview p':{marginBlock:'0 !important'}})];
}
