// Only the direct, token-bound companion pane can call the host bridge.
export function createPaneBridge(target,token,handlers={}){
 let serial=0;const pending=new Map();
 function post(data){target()?.postMessage({markatlasPane:token,...data},'*');}
 async function receive(event){const data=event.data;if(event.source!==target() || data?.markatlasPane!==token)return;
  if(data.reply){const request=pending.get(data.reply);if(!request)return;pending.delete(data.reply);clearTimeout(request.timer);data.error?request.reject(Error(data.error)):request.resolve(data.value);return;}
  if(!data.id || !Object.hasOwn(handlers,data.method))return;
  try{post({reply:data.id,value:await handlers[data.method](data.value)});}catch(error){post({reply:data.id,error:error.message});}
 }
 window.addEventListener('message',receive);
 return {handle(name,fn){handlers[name]=fn;},call(method,value){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('The other pane did not respond. Your file remains open.'));},60000);pending.set(id,{resolve,reject,timer});post({id,method,value});});},destroy(){window.removeEventListener('message',receive);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Pane closed.'));}pending.clear();}};
}
export const paneConfig=window.__markatlasPane || null;
export const paneBridge=paneConfig?createPaneBridge(()=>window.parent,paneConfig.token):null;
export class PaneApp {
 constructor(){this.context={};}
 addEventListener(){}
 async connect(){this.context=await paneBridge.call('context');}
 getHostContext(){return this.context;}
 callServerTool(params){return paneBridge.call('tool',params);}
 requestDisplayMode(params){return paneBridge.call('display',params);}
}
export class PaneExtensions {
 constructor(){this.message={send:params=>paneBridge.call('send',params)};this.resources={read:params=>paneBridge.call('resource',params)};this.files={open:path=>paneBridge.call('file',path)};}
}
