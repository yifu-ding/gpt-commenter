// Group adjacent typing/deletion into short bursts, with explicit intent boundaries.
export function createEditHistory({now=()=>Date.now(),gap=2000,maxDuration=5000}={}) {
  const undo=[],redo=[];let group=null;
  function boundary(){group=null;}
  function change(before,after){
    let from=0,a=before.length,b=after.length;
    while(from<a && from<b && before[from]===after[from])from++;
    while(a>from && b>from && before[a-1]===after[b-1]){a--;b--;}
    const inserted=after.slice(from,b),deleted=before.slice(from,a);
    return {from,end:a,next:b,kind:!deleted && !inserted.includes('\n')?'insert':!inserted && !deleted.includes('\n')?'delete':'replace'};
  }
  return {
    boundary,
    clear(){undo.length=redo.length=0;boundary();},
    record(before,after,caret){
      const edit=change(before,after),time=now();
      const adjacent=group && edit.kind===group.kind && (edit.kind==='insert' ? edit.from===group.next : edit.kind==='delete' && (edit.end===group.from || edit.from===group.from));
      if(!adjacent || time-group.last>gap || time-group.started>maxDuration){undo.push({text:before,caret});if(undo.length>100)undo.shift();group={started:time};}
      group={...group,...edit,last:time};redo.length=0;
    },
    restore(current,caret,isRedo=false){
      boundary();const from=isRedo?redo:undo,to=isRedo?undo:redo;
      const previous=from.pop();if(!previous)return null;to.push({text:current,caret});return previous;
    }
  };
}
