// Missing notes in an older pane are not deletions; only explicit tombstones delete.
export function mergeNotes(previous,incoming,removedIds=[]){
 const removed=new Set(removedIds),notes=new Map();
 for(const note of [...previous,...incoming]){
  if(removed.has(note.id))continue;
  const old=notes.get(note.id);
  if(!old || (note.updatedAt || '')>=(old.updatedAt || ''))notes.set(note.id,note);
 }
 return [...notes.values()];
}
export function mergeProjectState(previous,incoming){
 const removedIds=[...new Set([...(previous.removedIds || []),...(incoming.removedIds || [])])],removed=new Set(removedIds);
 const changed=new Set(incoming.changedIdentities || Object.keys(incoming.drafts));
 const entries=new Map((previous.entries || []).filter(([id])=>!removed.has(id)));
 for(const [id,entry] of incoming.entries)if(changed.has(entry.identity) && !removed.has(id)){
  const old=entries.get(id);
  if(!old || (entry.item?.updatedAt || '')>=(old.item?.updatedAt || ''))entries.set(id,entry);
 }
 const drafts={...previous.drafts};
 for(const identity of changed){
  const next=incoming.drafts[identity];if(!next)continue;
  // Offsets from a different text version must be remapped by the viewer.
  const old=drafts[identity];
  drafts[identity]={...next,items:old?.text===next.text?mergeNotes(old.items || [],next.items || [],removedIds):(next.items || []).filter(n=>!removed.has(n.id))};
 }
 for(const identity of Object.keys(drafts))drafts[identity]={...drafts[identity],items:(drafts[identity].items || []).filter(note=>!removed.has(note.id))};
 return {entries:[...entries],drafts,removedIds};
}
