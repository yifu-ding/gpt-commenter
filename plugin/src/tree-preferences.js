export const treeSortModes=[['name-asc','Name (A–Z)'],['name-desc','Name (Z–A)'],['modified-desc','Modified (newest first)'],['modified-asc','Modified (oldest first)'],['type','File type']];
export function sortedTreeNodes(nodes,mode='name-asc',foldersFirst=true){
 const name=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'});
 return [...nodes].sort((a,b)=>{if(foldersFirst && a.type!==b.type)return a.type==='directory'?-1:1;let order=0;
  if(mode.startsWith('modified'))order=((a.modified||0)-(b.modified||0))*(mode==='modified-desc'?-1:1);
  else if(mode==='type')order=(a.type==='directory'?'':a.name.split('.').slice(1).pop()||'').localeCompare(b.type==='directory'?'':b.name.split('.').slice(1).pop()||'');
  else order=name(a,b)*(mode==='name-desc'?-1:1);
  return order || name(a,b);
 });
}
export function createTreePreferences(button,menu,onChange){
 let mode='name-asc',foldersFirst=true;try{const saved=JSON.parse(localStorage.getItem('markatlas:tree-sort')||'null');if(treeSortModes.some(([value])=>value===saved?.mode))mode=saved.mode;foldersFirst=saved?.foldersFirst!==false;}catch{}
 const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');};
 function save(){try{localStorage.setItem('markatlas:tree-sort',JSON.stringify({mode,foldersFirst}));}catch{}render();onChange();}
 function render(){menu.replaceChildren();for(const [value,label] of treeSortModes){const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(mode===value));item.textContent=label;item.addEventListener('click',()=>{mode=value;save();close();button.focus();});menu.append(item);}
  const item=document.createElement('button');item.type='button';item.className='sort-folder-option';item.setAttribute('role','menuitemcheckbox');item.setAttribute('aria-checked',String(foldersFirst));item.textContent='Folders first';item.addEventListener('click',()=>{foldersFirst=!foldersFirst;save();close();button.focus();});menu.append(item);
  button.title=`Sort files: ${treeSortModes.find(([value])=>value===mode)[1]}`;
 }
 function toggle(event){event.preventDefault();if(!menu.hidden){close();return;}menu.hidden=false;button.setAttribute('aria-expanded','true');const rect=button.getBoundingClientRect(),box=menu.getBoundingClientRect(),pane=document.getElementById('primary-pane')?.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.left,(pane?.width||window.innerWidth)-box.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+5,(pane?.height||window.innerHeight)-box.height-8))}px`;menu.querySelector('[aria-checked=true]')?.focus();}
 button.addEventListener('click',toggle);button.addEventListener('contextmenu',toggle);document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target) && !button.contains(e.target))close();});window.addEventListener('resize',close);
 menu.addEventListener('keydown',event=>{const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();close();button.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}else if(event.key==='Tab')close();});render();
 return {sort:nodes=>sortedTreeNodes(nodes,mode,foldersFirst)};
}
export function formatGitCount(count){
 return count<1000?String(count):`${(count/1000).toFixed(1).replace(/\.0$/,'')}k`;
}
export function appendGitBadge(node,change){if(!change)return;const badge=document.createElement('span');badge.className='git-change';badge.setAttribute('aria-label',`${change.added} lines added, ${change.removed} lines removed`);badge.title=`${change.added} lines added, ${change.removed} lines removed · `+(change.binary?'Binary or large file changed':change.untracked?'Untracked file':'Changes compared with HEAD');if(change.binary){badge.textContent='M';node.append(badge);return;}for(const [kind,text] of [['added','+'+formatGitCount(change.added)],['removed','-'+formatGitCount(change.removed)]]){const value=document.createElement('span');value.className='git-'+kind;value.textContent=text;badge.append(value);}node.append(badge);}
