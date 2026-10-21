// One active document, one in-flight read. Drafts postpone applying disk changes.
export function createFileRefresh({apply,isBusy,onError=()=>{},schedule=cb=>setTimeout(cb,2000),cancel=clearTimeout}) {
  let active=null,timer=null;
  function stop() {
    if(timer!==null)cancel(timer);timer=null;
    const previous=active;active=null;previous?.dispose?.();
  }
  function later(state) {
    if(state!==active)return;
    if(timer!==null)cancel(timer);
    timer=schedule(()=>{timer=null;check();});
  }
  async function check() {
    const state=active;if(!state || state.running)return;
    state.running=true;
    try {
      const result=await state.read(state.etag);
      if(state!==active)return;
      if(!result.notModified) {
        if(typeof result.text!=='string')throw Error('Updated file has no readable text.');
        state.etag=result.etag;
        state.pending=result.text===state.text ? null : result.text;
      }
      if(state.pending!==null && !isBusy()) {
        const text=state.pending;
        await apply(text,{etag:state.etag});
        if(state!==active)return;
        state.text=text;state.pending=null;
      }
      state.error=null;
    }catch(error){if(state===active && state.error!==error.message){state.error=error.message;onError(error);}}
    finally{state.running=false;later(state);}
  }
  function watch({read,text,etag,dispose}) {
    stop();active={read,text,etag,dispose,pending:null,running:false};later(active);
  }
  function setText(text,etag) {if(active && typeof text==='string'){active.text=text;active.pending=null;if(etag!==undefined)active.etag=etag;}}
  return {watch,stop,check,setText};
}
