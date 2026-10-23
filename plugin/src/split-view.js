import {createPaneBridge} from './pane-bridge.js';
export const PANE_DRAG='application/x-markatlas-pane';
export const FILE_DRAG='application/x-markatlas-file';
export function createSplitView({readHtml,host,getCurrent,openPrimary,flushPrimary,onResize,onError}){
 const primary=document.getElementById('primary-pane');
 let active='primary';let frame=null,bridge=null,secondary=null,direction='right',ratio=.5,busy=false;
 const panel=document.createElement('section');panel.id='secondary-pane';panel.hidden=true;panel.setAttribute('aria-label','Second file');
 const bar=document.createElement('div');bar.className='pane-bar';const label=document.createElement('span');label.draggable=true;label.className='pane-label';label.title='Drag to move this file';
 const close=document.createElement('button');close.textContent='×';close.title='Close second file';close.setAttribute('aria-label','Close second file');bar.append(label,close);panel.append(bar);
 const divider=document.createElement('div');divider.id='pane-divider';divider.hidden=true;divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-label','Resize file panes');
 const zones=document.createElement('div');zones.id='pane-drop-zones';zones.hidden=true;
 for(const edge of ['left','right','top','bottom']){const zone=document.createElement('div');zone.dataset.paneEdge=edge;zone.textContent=`Open on ${edge}`;zones.append(zone);}
 document.body.append(panel,divider,zones);
 for(const name of ['pointerdown','focusin'])primary.addEventListener(name,event=>{if(!event.target.closest?.('#comments-toggle'))active='primary';},true);
 function layout(){const vertical=direction==='bottom';document.body.classList.toggle('split-open',!!frame);document.body.dataset.splitDirection=direction;
  document.documentElement.style.setProperty('--pane-ratio',`${ratio*100}%`);divider.setAttribute('aria-orientation',vertical?'horizontal':'vertical');divider.setAttribute('aria-valuenow',String(Math.round(ratio*100)));divider.setAttribute('aria-valuemin','20');divider.setAttribute('aria-valuemax','80');onResize();}
 function title(value){secondary=value;label.textContent=value.path?.split('/').at(-1)||'Second file';label.title=value.path||'Drag to move this file';}
 async function mount(root,path){
  if(bridge){await bridge.call('open',{root,path});title({root,path});return;}
  const token=crypto.randomUUID();let loaded;const ready=new Promise(resolve=>{loaded=resolve;});const data=await readHtml({root,path,token});
  frame=document.createElement('iframe');frame.title='Second file viewer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads');
  bridge=createPaneBridge(()=>frame?.contentWindow,token,{...host,focus:()=>{active='secondary';},ready:()=>loaded(),location:value=>{title(value);},drag:()=>{zones.hidden=false;},dragend:()=>{zones.hidden=true;}});
  active='secondary';frame.srcdoc=data.html;panel.append(frame);panel.hidden=false;divider.hidden=false;title({root,path});layout();let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The second file is still loading. Please retry.')),60000);})]);}finally{clearTimeout(timer);}
 }
 async function open(root,path,edge='right'){
  if(busy)return;busy=true;
  try{const original=getCurrent();if(!original.path){await openPrimary(root,path);return;}
   await flushPrimary();direction=['top','bottom'].includes(edge)?'bottom':'right';
   await mount(root,path);if(['left','top'].includes(edge))await swap();layout();
  }catch(error){onError(error);}finally{busy=false;zones.hidden=true;}
 }
 async function swap(){if(!bridge || !secondary)return;const first=getCurrent(),second={...secondary};await flushPrimary();await bridge.call('flush');await openPrimary(second.root,second.path);await bridge.call('open',first);title(first);}
 async function move(which,edge){if(!bridge || busy)return;busy=true;try{direction=['top','bottom'].includes(edge)?'bottom':'right';const putFirst=['left','top'].includes(edge);if(which==='primary'?!putFirst:putFirst)await swap();layout();}catch(error){onError(error);}finally{busy=false;}}
 async function closePane(which='secondary'){if(busy || !bridge)return;busy=true;try{if(which==='primary')await flushPrimary();await bridge.call('flush');if(which==='primary' && secondary)await openPrimary(secondary.root,secondary.path);bridge.destroy();bridge=null;frame.remove();frame=null;secondary=null;active='primary';panel.hidden=divider.hidden=true;layout();}catch(error){onError(error);}finally{busy=false;}}
 close.addEventListener('click',()=>closePane());
 window.addEventListener('blur',()=>{if(frame && document.activeElement===frame)active='secondary';else if(primary.contains(document.activeElement))active='primary';});
 let drag=null;
 divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag=event.pointerId;divider.setPointerCapture(event.pointerId);document.body.classList.add('resizing-panes');});
 divider.addEventListener('pointermove',event=>{if(drag!==event.pointerId)return;ratio=Math.max(.2,Math.min(.8,direction==='bottom'?event.clientY/window.innerHeight:event.clientX/window.innerWidth));layout();});
 const stop=()=>{drag=null;document.body.classList.remove('resizing-panes');};divider.addEventListener('pointerup',stop);divider.addEventListener('pointercancel',stop);
 divider.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();ratio=event.key==='Home'?.5:Math.max(.2,Math.min(.8,ratio+(['ArrowRight','ArrowDown'].includes(event.key)?.05:-.05)));layout();});
 // Pointer capture keeps pane rearrangement reliable across iframe boundaries.
 function panePointer(node,which){let start=null;node.addEventListener('pointerdown',event=>{if(event.button!==0 || !frame)return;event.preventDefault();start={id:event.pointerId,x:event.clientX,y:event.clientY,active:false};node.setPointerCapture(event.pointerId);});
  const edgeAt=event=>event.clientX<window.innerWidth/3?'left':event.clientX>window.innerWidth*2/3?'right':event.clientY<window.innerHeight/3?'top':event.clientY>window.innerHeight*2/3?'bottom':null;
  node.addEventListener('pointermove',event=>{if(!start || start.id!==event.pointerId)return;if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>6)start.active=true;if(start.active){zones.hidden=false;for(const zone of zones.children)zone.classList.toggle('active',zone.dataset.paneEdge===edgeAt(event));}});
  node.addEventListener('pointerup',event=>{if(!start)return;const active=start.active;start=null;zones.hidden=true;if(active && edgeAt(event))move(which,edgeAt(event));});node.addEventListener('pointercancel',()=>{start=null;zones.hidden=true;});
 }
 panePointer(label,'secondary');panePointer(document.getElementById('filename'),'primary');
 label.addEventListener('dragstart',event=>{event.dataTransfer.setData(PANE_DRAG,'secondary');event.dataTransfer.effectAllowed='move';zones.hidden=false;});
 document.addEventListener('dragstart',event=>{if(event.target.id==='filename'){event.dataTransfer.setData(PANE_DRAG,'primary');event.dataTransfer.effectAllowed='move';zones.hidden=false;}});
 document.addEventListener('dragover',event=>{const types=[...(event.dataTransfer?.types||[])];if(!types.includes(PANE_DRAG) && !types.includes(FILE_DRAG))return;if(event.target.closest('#project-drawer'))return;event.preventDefault();zones.hidden=false;});
 zones.addEventListener('dragover',event=>{event.preventDefault();for(const node of zones.children)node.classList.toggle('active',node===event.target);});
 zones.addEventListener('drop',event=>{event.preventDefault();const edge=event.target.dataset.paneEdge;zones.hidden=true;if(!edge)return;const which=event.dataTransfer.getData(PANE_DRAG);if(which){move(which,edge);return;}try{const file=JSON.parse(event.dataTransfer.getData(FILE_DRAG));if(file.root && file.path)open(file.root,file.path,edge);}catch{}});
 document.addEventListener('dragend',()=>{zones.hidden=true;});window.addEventListener('blur',()=>{zones.hidden=true;});
 return {open,close:closePane,activePane:()=>active,call:(method,value)=>bridge?.call(method,value),notify(method,value){bridge?.call(method,value).catch(()=>{});},isOpen:()=>!!frame};
}
