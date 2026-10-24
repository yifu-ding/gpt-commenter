import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'MarkAtlas history confirmation',version:'1.0.0'}),confirm=document.getElementById('confirm'),cancel=document.getElementById('cancel'),status=document.getElementById('status');
let cancelled=false;
cancel.onclick=()=>{cancelled=true;confirm.disabled=true;cancel.disabled=true;status.textContent='Cancelled. Recently opened was not changed.';};
confirm.onclick=async()=>{confirm.disabled=true;cancel.disabled=true;try{const result=await app.callServerTool({name:'markatlas_confirm_clear_recently_opened',arguments:{confirmed:true}});if(result.isError)throw Error(result.content?.find(item=>item.type==='text')?.text || 'Unable to clear history.');status.textContent='Recently opened cleared. Open viewers will update automatically; closed viewers update when reopened.';}catch(error){status.textContent=error.message;confirm.disabled=false;cancel.disabled=false;}};
app.connect().then(()=>{if(!cancelled)confirm.disabled=false;cancel.focus();}).catch(error=>{status.textContent=error.message;});
