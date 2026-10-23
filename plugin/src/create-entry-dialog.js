export function createEntryDialog(create){
 const overlay=document.createElement('div');overlay.id='create-entry-dialog';overlay.hidden=true;
 overlay.innerHTML='<form role="dialog" aria-modal="true" aria-labelledby="create-entry-title"><h2 id="create-entry-title"></h2><p id="create-entry-location"></p><label for="create-entry-name">Name</label><input id="create-entry-name" autocomplete="off" required><p id="create-entry-help"></p><p id="create-entry-error" role="alert"></p><div class="create-entry-actions"><button type="button" id="create-entry-cancel">Cancel</button><button type="submit" id="create-entry-submit">Create</button></div></form>';
 document.body.append(overlay);
 const form=overlay.querySelector('form'),input=overlay.querySelector('input'),cancel=overlay.querySelector('#create-entry-cancel'),submit=overlay.querySelector('#create-entry-submit'),error=overlay.querySelector('#create-entry-error');let context=null,opener=null,busy=false;
 function close(){if(busy)return;overlay.hidden=true;opener?.focus();}
 cancel.addEventListener('click',close);
 overlay.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const fields=[input,cancel,submit].filter(node=>!node.disabled),index=fields.indexOf(document.activeElement);event.preventDefault();fields[(index+(event.shiftKey?-1:1)+fields.length)%fields.length]?.focus();}});
 form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;error.textContent='';if(!input.value.trim() || /[\\/\0]/.test(input.value) || ['.','..'].includes(input.value)){error.textContent='Enter a name without path separators.';input.focus();return;}
 busy=true;input.disabled=cancel.disabled=submit.disabled=true;
 try{await create({...context,name:input.value});busy=false;close();}
 catch(failure){error.textContent=failure.message;}
 finally{busy=false;input.disabled=cancel.disabled=submit.disabled=false;if(!overlay.hidden)input.focus();}
 });
 return {open(value){if(busy)return;context=value;opener=document.activeElement;input.value='';error.textContent='';overlay.querySelector('h2').textContent=value.kind==='directory'?'New folder':'New file';overlay.querySelector('#create-entry-location').textContent='Location: '+value.root+(value.folder?'/'+value.folder:'');overlay.querySelector('#create-entry-help').textContent=value.kind==='directory'?'Enter the folder name.':'Enter the full file name, including its extension (for example notes.md or script.py). An empty file is created; no extension is added automatically.';overlay.hidden=false;input.focus();}};
}
