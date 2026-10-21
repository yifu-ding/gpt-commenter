export function createFileMenu({tree,menu,root,onError}) {
  let selected=null,opener=null;
  const buttons=[...menu.querySelectorAll('button')];
  function close(restoreFocus=false){menu.hidden=true;if(restoreFocus)opener?.focus({preventScroll:true});selected=null;}
  async function copy(text){
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}}catch{/* Embedded hosts may require the clipboard fallback. */}
    const field=document.createElement('textarea'),active=document.activeElement;
    field.value=text;field.readOnly=true;Object.assign(field.style,{position:'fixed',left:'-9999px',top:'0'});document.body.append(field);field.select();
    try{if(!document.execCommand?.('copy'))throw Error('Clipboard access is unavailable in this host.');}finally{field.remove();active?.focus({preventScroll:true});}
  }
  tree.addEventListener('contextmenu',event=>{
    const target=event.target.closest('[data-project-path],summary');if(!target || !tree.contains(target))return;
    const path=target.dataset.projectPath ?? target.parentElement.dataset.projectFolder;if(path===undefined)return;
    event.preventDefault();opener=target;const base=root()?.replace(/[\\/]+$/,'');
    selected={relative:path,absolute:base?`${base}/${path}`:null};
    buttons[0].disabled=!selected.absolute;menu.hidden=false;
    const anchor=target.getBoundingClientRect(),rect=menu.getBoundingClientRect();
    const x=event.clientX || anchor.left,y=event.clientY || anchor.bottom;
    menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
    buttons.find(button=>!button.disabled)?.focus({preventScroll:true});
  });
  for(const button of buttons)button.addEventListener('click',async()=>{
    const text=selected?.[button.dataset.copyPath];if(text===undefined || text===null)return;
    close(true);try{await copy(text);}catch(error){onError(error);}
  });
  menu.addEventListener('keydown',event=>{
    const available=buttons.filter(button=>!button.disabled),index=available.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowDown'?1:-1)+available.length)%available.length;available[next]?.focus();
    }
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
    if(event.key==='Tab')close();
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();});
  window.addEventListener('resize',()=>close());
  document.addEventListener('scroll',event=>{if(!menu.contains(event.target))close();},true);
  return {close};
}
