// Move the original controls (and their handlers) into a compact overflow menu.
export function createTreeToolbar(toolbar){
 const actions=[...toolbar.querySelectorAll(':scope > button')],more=document.createElement('button'),menu=document.createElement('div');
 more.id='tree-tools-more';more.className='folder-button';more.type='button';more.textContent='>>';more.title='More file actions';more.setAttribute('aria-label','More file actions');more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','tree-tools-overflow');more.hidden=true;
 menu.id='tree-tools-overflow';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','More file actions');toolbar.append(more);document.body.append(menu);
 let count=actions.length;
 function close(focus=false){menu.hidden=true;more.setAttribute('aria-expanded','false');if(focus && !more.hidden)more.focus();}
 function label(button){let text=button.querySelector('.tree-overflow-label');if(!text){text=document.createElement('span');text.className='tree-overflow-label';button.append(text);}const value=button.getAttribute('aria-label') || button.title;if(text.textContent!==value)text.textContent=value;}
 function update(){
  const width=toolbar.getBoundingClientRect().width;if(!width)return;
  const slots=Math.max(1,Math.floor((width+4)/33)),next=slots>=actions.length?actions.length:Math.max(0,slots-1);
  if(next!==count){close();count=next;}
  actions.forEach((button,index)=>{
   label(button);const parent=index<count?toolbar:menu;
   if(parent===menu)menu.append(button);else if(button.parentElement!==toolbar)toolbar.insertBefore(button,more);
   if(parent===menu)button.setAttribute('role','menuitem');else button.removeAttribute('role');
  });
  more.hidden=count===actions.length;
 }
 function open(){update();if(more.hidden)return;menu.hidden=false;more.setAttribute('aria-expanded','true');
  const rect=more.getBoundingClientRect(),box=menu.getBoundingClientRect(),pane=document.getElementById('primary-pane')?.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(rect.right-box.width,(pane?.width || window.innerWidth)-box.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(rect.bottom+5,(pane?.height || window.innerHeight)-box.height-8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
 }
 more.addEventListener('click',()=>menu.hidden?open():close());
 more.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
 menu.addEventListener('click',event=>{if(event.target.closest('button'))close(menu.contains(document.activeElement));});
 menu.addEventListener('keydown',event=>{
  const buttons=[...menu.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
  else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
  else if(event.key==='Tab')close(true);
 });
 document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target) && !more.contains(event.target))close();});
 window.addEventListener('resize',()=>{close();update();});
 const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update);resize?.observe(toolbar);
 // Hidden-file toggles replace their SVG; restore the menu label after that update.
 const changes=new MutationObserver(()=>{actions.forEach(label);});for(const action of actions)changes.observe(action,{childList:true,attributes:true,attributeFilter:['aria-label']});
 update();return {update,close};
}
