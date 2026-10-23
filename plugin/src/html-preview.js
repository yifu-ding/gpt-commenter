import canvasRuntime from './html-canvas-runtime.js';
import {parse,serialize} from 'parse5';
import {decodeHTML} from 'entities';

// Source locations come from the HTML parser, not a substring search: repeated
// words and entity-encoded text must retain their own original source spans.
export function htmlTextRecords(source){
  const tree=parse(source,{sourceCodeLocationInfo:true}),records=[];let serial=0;
  function visit(node,skip=false){
    skip=skip || ['head','script','style','template','noscript'].includes(node.tagName);
    if(!skip && node.tagName){
      const id=String(++serial);node.atlasId=id;
      node.attrs=(node.attrs||[]).filter(a=>!a.name.startsWith('data-markatlas-'));
      node.attrs.push({name:'data-markatlas-node',value:id});
      if(node.sourceCodeLocation){node.attrs.push({name:'data-markatlas-start',value:String(node.sourceCodeLocation.startOffset)},{name:'data-markatlas-end',value:String(node.sourceCodeLocation.endOffset)});}
    }
    if(!skip && node.nodeName==='#text' && node.sourceCodeLocation){
      const {startOffset,endOffset}=node.sourceCodeLocation,raw=source.slice(startOffset,endOffset),map=[startOffset];let value='';
      for(let i=0;i<raw.length;){
        const entity=/^&(?:#[xX][\da-fA-F]+;?|#\d+;?|[a-zA-Z][\da-zA-Z]*;)/.exec(raw.slice(i));
        const unit=entity?.[0] || raw[i],decoded=entity?decodeHTML(unit):unit;
        for(let j=0;j<decoded.length;j++)map.push(startOffset+i+(j===decoded.length-1?unit.length:0));
        value+=decoded;i+=unit.length;
      }
      records.push({value:node.value,map:value===node.value?map:null,parent:node.parentNode?.atlasId,index:node.parentNode?.childNodes.indexOf(node)});
    }
    for(const child of node.childNodes||[])visit(child,skip);
  }
  visit(tree);return {tree,records};
}
function frameRuntime(records,channel,sourceLength){
  const send=(type,data={})=>parent.postMessage({markatlas:channel,type,...data},'*');
  const mappings=new WeakMap(),originals=new WeakMap(),nodes=[];
  for(const record of records){
    const node=document.querySelector(`[data-markatlas-node="${record.parent}"]`)?.childNodes[record.index];
    if(node?.nodeType===3 && node.data===record.value && record.map){nodes.push(node);mappings.set(node,record.map);originals.set(node,record.value);}
  }
  let offered=null,notes=[],active=null,enabled=true,frame=0,regionMode=false,drag=null;
  const pathFor=node=>{const path=[];while(node && node!==document.body){path.unshift([...node.parentNode.childNodes].indexOf(node));node=node.parentNode;}return path;};
  const nodeAt=path=>path?.reduce((n,i)=>n?.childNodes[i],document.body);
  function rangeFor(note){
    const range=document.createRange(),anchor=note.html?.textAnchor;
    if(anchor){try{range.setStart(nodeAt(anchor.start),anchor.from);range.setEnd(nodeAt(anchor.end),anchor.to);return range.toString()===note.selectedText?range:null;}catch{return null;}}
    let start,end;
    for(const n of nodes){const map=mappings.get(n);if(!n.isConnected || n.data!==originals.get(n))continue;
      const a=map.indexOf(note.startOffset),b=map.lastIndexOf(note.endOffset);if(a>=0)start=[n,a];if(b>=0)end=[n,b];}
    if(!start||!end)return null;try{range.setStart(...start);range.setEnd(...end);return range;}catch{return null;}
  }
  const regionMarks=document.createElement('div');regionMarks.dataset.html2canvasIgnore='true';document.body.append(regionMarks);
  function paint(){
    if(window.Highlight && CSS.highlights){const all=new Highlight(),current=new Highlight();for(const n of notes){if(n.html?.region)continue;const r=rangeFor(n);if(r)(n.id===active?current:all).add(r);}CSS.highlights.set('atlas-notes',all);CSS.highlights.set('atlas-active',current);}
    regionMarks.replaceChildren();
    if(enabled)for(const note of notes){const r=note.html?.region;if(!r || r.viewportWidth && Math.abs(r.viewportWidth-innerWidth)>2)continue;const mark=document.createElement('button');mark.className='atlas-region-note';mark.title='Comment on selected region';mark.setAttribute('aria-label','Comment on selected region');mark.style.cssText=`all:initial;box-sizing:border-box;border-radius:0;cursor:pointer;position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;border:2px solid ${note.id===active?'#3979b8':'#d8a82c'};background:transparent;z-index:2147483643;padding:0`;mark.onclick=()=>send('note',{id:note.id});regionMarks.append(mark);}
  }
  window.addEventListener('resize',paint);
  function sourceSpan(element){const host=element?.closest('[data-markatlas-start]');return {startOffset:host?Number(host.dataset.markatlasStart):0,endOffset:host?Number(host.dataset.markatlasEnd):sourceLength};}
  const button=document.createElement('button');button.textContent='Comment  C';button.hidden=true;button.id='atlas-comment';button.dataset.html2canvasIgnore='true';document.body.append(button);
  button.addEventListener('pointerdown',e=>e.preventDefault());
  function accept(){if(!offered)return;const selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;if(range && window.Highlight && CSS.highlights)CSS.highlights.set('atlas-active',new Highlight(range));send('selection',offered);selection?.removeAllRanges();button.hidden=true;}
  button.addEventListener('click',accept);
  function capture(){
    button.hidden=true;offered=null;if(!enabled||regionMode)return;
    const selection=getSelection();if(!selection?.rangeCount || selection.isCollapsed)return;const r=selection.getRangeAt(0);
    if(button.contains(r.startContainer)||regionMarks.contains(r.startContainer))return;
    const selected=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
    while(n=walker.nextNode())if(n.data && !n.parentElement.closest('script,style,template,noscript,#atlas-comment') && !regionMarks.contains(n) && r.intersectsNode(n)){
      const from=r.startContainer===n?r.startOffset:0,to=r.endContainer===n?r.endOffset:n.length;if(to>from)selected.push({node:n,from,to});}
    if(!selected.length)return;const first=selected[0],last=selected.at(-1),a=mappings.get(first.node),b=mappings.get(last.node);
    const exact=selected.every(x=>mappings.has(x.node)&&x.node.data===originals.get(x.node));
    const rect=r.getBoundingClientRect(),element=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
    offered={...(exact?{startOffset:a[first.from],endOffset:b[last.to]}:sourceSpan(element)),selectedText:selection.toString(),html:{mapping:exact?'exact':'element',textAnchor:{start:pathFor(r.startContainer),from:r.startOffset,end:pathFor(r.endContainer),to:r.endOffset}},rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}};
    if(offered.endOffset<=offered.startOffset)return;
    offered.shortcut=!first.node.parentElement.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])');button.textContent=offered.shortcut?'Comment  C':'Comment';
    button.hidden=false;button.style.left=`${Math.max(8,Math.min(innerWidth-120,rect.left))}px`;button.style.top=`${Math.max(8,rect.top-38)}px`;
  }
  document.addEventListener('selectionchange',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(capture);});
  document.addEventListener('pointerup',()=>{if(!regionMode)requestAnimationFrame(capture);});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){setRegion(false);button.hidden=true;}
    if(e.key.toLowerCase()==='c'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.isComposing&&!e.target.closest('input,textarea,select,[contenteditable]')&&offered?.shortcut){e.preventDefault();accept();}
  },true);
  document.addEventListener('click',e=>{if(e.target===button || !enabled)return;for(const n of notes){if(n.html?.region)continue;const r=rangeFor(n);if(r && [...r.getClientRects()].some(x=>e.clientX>=x.left&&e.clientX<=x.right&&e.clientY>=x.top&&e.clientY<=x.bottom)){send('note',{id:n.id});return;}}if(!e.target.closest('.atlas-region-note') && getSelection()?.isCollapsed)send('dismiss');});
  document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a || a.getAttribute('href').startsWith('#'))return;e.preventDefault();send('link',{url:a.href});});
  const overlay=document.createElement('div');overlay.id='atlas-region-overlay';overlay.dataset.html2canvasIgnore='true';overlay.hidden=true;overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none;background:transparent';document.body.append(overlay);
  const box=document.createElement('div');box.style.cssText='position:absolute;border:2px solid #3979b8;background:#b9d9f533;pointer-events:none';overlay.append(box);
  function setRegion(value){regionMode=!!value;overlay.hidden=!regionMode;button.hidden=true;drag=null;box.hidden=true;send('region-mode',{active:regionMode});}
  overlay.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={x:e.clientX,y:e.clientY,id:e.pointerId};box.hidden=false;box.style.left=e.clientX+'px';box.style.top=e.clientY+'px';box.style.width='0';box.style.height='0';overlay.setPointerCapture?.(e.pointerId);});
  function bounds(e){return {x:Math.max(0,Math.min(drag.x,e.clientX)),y:Math.max(0,Math.min(drag.y,e.clientY)),width:Math.min(innerWidth,Math.abs(drag.x-e.clientX)),height:Math.min(innerHeight,Math.abs(drag.y-e.clientY))};}
  overlay.addEventListener('pointermove',e=>{if(!drag)return;const r=bounds(e);Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});});
  overlay.addEventListener('pointercancel',()=>setRegion(false));
  overlay.addEventListener('pointerup',async e=>{
    if(!drag)return;e.preventDefault();const r=bounds(e),sx=scrollX,sy=scrollY;setRegion(false);if(r.width<6||r.height<6)return;
    const element=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),span=sourceSpan(element);
    const selected=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
    while(n=walker.nextNode()){if(!n.data.trim()||n.parentElement.closest('script,style,#atlas-comment,#atlas-region-overlay')||regionMarks.contains(n))continue;const range=document.createRange();range.selectNodeContents(n);if([...range.getClientRects()].some(b=>b.right>r.x&&b.left<r.x+r.width&&b.bottom>r.y&&b.top<r.y+r.height))selected.push(n.data);}
    try{
      const canvas=await window.htmlToImage.toCanvas(document.documentElement,{width:r.width,height:r.height,pixelRatio:Math.min(2,1600/Math.max(r.width,r.height)),backgroundColor:'#fff',style:{width:document.documentElement.clientWidth+'px',height:document.documentElement.scrollHeight+'px',transform:`translate(${-r.x-sx}px,${-r.y-sy}px)`,transformOrigin:'top left'},filter:el=>!el.hasAttribute?.('data-html2canvas-ignore') && !['SCRIPT','IFRAME'].includes(el.tagName)});
      const screenshot=canvas.toDataURL('image/jpeg',.9);
      send('selection',{...span,selectedText:selected.join(' ').slice(0,45000)||'HTML visual region',html:{mapping:'region',region:{x:r.x+sx,y:r.y+sy,width:r.width,height:r.height,viewportWidth:innerWidth},screenshot},rect:{left:r.x,right:r.x+r.width,top:r.y,bottom:r.y+r.height}});
    }catch(error){send('error',{message:'Could not capture this HTML region: '+error.message});}
  });
  window.addEventListener('message',e=>{if(e.source!==parent||e.data?.markatlas!==channel)return;const data=e.data;
    if(data.type==='notes'){notes=data.notes;active=data.active;enabled=data.enabled;if(!enabled)setRegion(false);paint();}
    if(data.type==='region')setRegion(data.active);
    if(data.type==='locate'){active=data.note.id;paint();const region=data.note.html?.region;if(region)scrollTo({top:Math.max(0,region.y-innerHeight/3),left:region.x});else rangeFor(data.note)?.startContainer.parentElement?.scrollIntoView({block:'center'});}
  });
  send('ready');
}
export function htmlPreviewDocument(source,baseURL,channel){
  const {tree,records}=htmlTextRecords(source);
  let html=serialize(tree);
  const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c');
  const style='<style>#atlas-comment{position:fixed;z-index:2147483647;border:1px solid #ded6e8;border-radius:999px;padding:6px 12px;background:white;color:#514060;font:12px system-ui;cursor:pointer}#atlas-comment[hidden]{display:none}::highlight(atlas-notes){background:transparent;text-decoration:underline #888 2px}::highlight(atlas-active){background:transparent;text-decoration:underline #444 2px}</style>';
  html=html.replace('<head>',`<head>${baseURL?`<base href="${baseURL.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">`:''}${style}`);
  return html.replace('</body>',`<script>${canvasRuntime.replace(/<\/script/gi,'<\\/script')}</script><script>(${frameRuntime.toString()})(${safe(records)},${safe(channel)},${source.length})</script></body>`);
}
