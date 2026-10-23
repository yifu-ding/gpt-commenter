import {App} from '@modelcontextprotocol/ext-apps';
import {accentColors} from './viewer-settings.js';
import {applyHostAccent} from './host-accent.js';
const app=new App({name:'MarkAtlas theme color',version:'1.0.0'}),list=document.getElementById('colors'),status=document.getElementById('status');
let selected='host',busy=false,context={};
function render(){
 const theme=context.theme || 'light';document.documentElement.dataset.theme=theme;applyHostAccent(context);
 list.replaceChildren();
 for(const color of ['host',...Object.keys(accentColors)]){
  const label=color[0].toUpperCase()+color.slice(1),button=document.createElement('button'),dot=document.createElement('span'),name=document.createElement('span'),check=document.createElement('span');
  button.type='button';button.dataset.color=color;button.setAttribute('role','radio');button.setAttribute('aria-checked',String(color===selected));button.tabIndex=color===selected?0:-1;button.disabled=busy;
  dot.className='swatch';dot.setAttribute('aria-hidden','true');dot.style.setProperty('--sample',color==='host'?'var(--markatlas-accent, #1687d9)':accentColors[color][theme==='dark'?1:0]);name.textContent=label;check.className='check';check.setAttribute('aria-hidden','true');check.textContent=color===selected?'✓':'';button.append(dot,name,check);
  button.onclick=async()=>{if(busy)return;busy=true;for(const item of list.children)item.disabled=true;status.textContent='Saving…';try{const result=await app.callServerTool({name:'markatlas_settings_update',arguments:{set:{themeColor:color}}});if(result.isError)throw Error(result.content?.find(item=>item.type==='text')?.text || 'Could not save color.');selected=color;status.textContent=label+' selected.';}catch(error){status.textContent=error.message;}finally{busy=false;render();list.querySelector(`[data-color="${selected}"]`).focus();}};
  button.onkeydown=event=>{const keys=['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();const buttons=[...list.children],i=buttons.indexOf(button),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+buttons.length)%buttons.length;buttons[next].focus();};list.append(button);
 }
}
app.onhostcontextchanged=value=>{context={...context,...value};render();};
app.connect().then(async()=>{context=app.getHostContext() || {};const result=await app.callServerTool({name:'markatlas_settings_read',arguments:{}});if(result.isError)throw Error('Could not load color settings.');selected=result.structuredContent?.preferences?.themeColor || 'host';status.textContent='Host follows the host accent.';render();}).catch(error=>{status.textContent=error.message;});
