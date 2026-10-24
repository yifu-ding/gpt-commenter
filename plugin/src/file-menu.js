export function createFileMenu({tree,menu,root,onError,onReveal,onSplit,onWebPreview,onNativePreview,onRename,onCreate,onDelete}) {
  let selected=null,opener=null;
  if(onRename){const button=document.createElement('button');button.dataset.action='rename';button.textContent='Rename';menu.append(button);}
  for(const [action,label,handler] of [['new-folder','New folder',onCreate],['new-file','New file',onCreate],['delete','Delete',onDelete]])if(handler){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.dataset.action=action;button.textContent=label;menu.append(button);}
  let cancelRename=null;
  function startRename(target){
    if(!onRename || !root() || target.dataset.deleted==='true')return;cancelRename?.();
    const path=target.dataset.projectPath ?? target.parentElement.dataset.projectFolder;if(!path)return;
    const label=target.querySelector('.file-label') || target,original=[...label.childNodes];
    const input=document.createElement('input');input.className='tree-rename-input';input.setAttribute('aria-label','Rename');input.value=path.split('/').at(-1);
    label.replaceChildren(input);let done=false;
    const cancel=()=>{if(done)return;done=true;label.replaceChildren(...original);cancelRename=null;};cancelRename=cancel;
    for(const name of ['click','dblclick','pointerdown'])input.addEventListener(name,event=>event.stopPropagation());
    input.addEventListener('keydown',async event=>{
      event.stopPropagation();if(!['Enter','Escape'].includes(event.key))return;event.preventDefault();
      const name=input.value;if(event.key==='Escape' || !name.trim() || name===path.split('/').at(-1)){cancel();return;}
      if(input.disabled)return;input.disabled=true;
      try{await onRename(path,name);cancel();}catch(error){input.disabled=false;onError(error);input.focus();}
    });
    input.addEventListener('blur',()=>{if(!input.disabled)cancel();});input.focus();input.select();
  }
  tree.addEventListener('dblclick',event=>{const label=event.target.closest('.file-label');if(!label || event.target.closest('input'))return;const target=label.closest('[data-project-path],summary');if(!target || !tree.contains(target))return;event.preventDefault();event.stopPropagation();startRename(target);});
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
    selected={folder:target.dataset.projectPath===undefined?path:path.split('/').slice(0,-1).join('/'),relative:path,absolute:base?`${base}/${path}`:null};
    buttons[0].disabled=!selected.absolute;
    for(const button of buttons)if(['rename','new-folder','new-file','delete'].includes(button.dataset.action))button.disabled=!selected.absolute;
    for(const button of buttons)if(button.dataset.action==='reveal'){button.hidden=!onReveal;button.disabled=!selected.absolute;}
    for(const button of buttons)if(button.dataset.split){button.hidden=!onSplit || !target.dataset.projectPath;button.disabled=!selected.absolute;}
    for(const button of buttons)if(button.dataset.action==='web-preview')button.hidden=!onWebPreview || !target.dataset.projectPath || !/\.html?$/i.test(path);
    for(const button of buttons)if(button.dataset.action==='native-preview'){button.hidden=!onNativePreview || !target.dataset.projectPath;button.disabled=!selected.absolute;}
    for(const button of buttons)if(button.dataset.action==='web-preview')button.disabled=!selected.absolute;
    if(target.dataset.deleted==='true')for(const button of buttons)if(button.dataset.action || button.dataset.split)button.disabled=true;
    menu.hidden=false;
    const anchor=target.getBoundingClientRect(),rect=menu.getBoundingClientRect();
    const x=event.clientX || anchor.left,y=event.clientY || anchor.bottom;
    menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
    buttons.find(button=>!button.disabled && !button.hidden)?.focus({preventScroll:true});
  });
  for(const button of buttons)button.addEventListener('click',async()=>{
    if(['new-folder','new-file','delete'].includes(button.dataset.action)){const selection=selected,action=button.dataset.action;close(true);try{if(selection){if(action==='delete')await onDelete(selection.relative);else await onCreate(action==='new-folder'?'directory':'file',selection.folder);}}catch(error){onError(error);}return;}
    if(button.dataset.action==='rename'){const target=opener;close();startRename(target);return;}
    if(button.dataset.action==='reveal'){const path=selected?.relative;close(true);try{if(path!==undefined)await onReveal(path);}catch(error){onError(error);}return;}
    if(button.dataset.split){const path=selected?.relative,edge=button.dataset.split;close(true);try{if(path)await onSplit(path,edge);}catch(error){onError(error);}return;}
    if(button.dataset.action==='native-preview'){const path=selected?.relative;close(true);try{if(path)await onNativePreview(path);}catch(error){onError(error);}return;}
    if(button.dataset.action==='web-preview'){const path=selected?.relative;close(true);try{if(path)await onWebPreview(path);}catch(error){onError(error);}return;}
    const text=selected?.[button.dataset.copyPath];if(text===undefined || text===null)return;
    close(true);try{await copy(text);}catch(error){onError(error);}
  });
  menu.addEventListener('keydown',event=>{
    const available=buttons.filter(button=>!button.disabled && !button.hidden),index=available.indexOf(document.activeElement);
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
