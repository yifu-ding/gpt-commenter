// A pane writes only documents it touched, preserving the other pane's queue and drafts.
export function mergeProjectState(previous,incoming){
 if(!Array.isArray(incoming.changedIdentities))return {entries:incoming.entries,drafts:incoming.drafts};
 const changed=new Set(incoming.changedIdentities),removed=new Set(incoming.removedIds || []);
 const entries=new Map((previous.entries || []).filter(([id,entry])=>!removed.has(id) && !changed.has(entry.identity)));
 for(const [id,entry] of incoming.entries)if(changed.has(entry.identity) && !removed.has(id))entries.set(id,entry);
 const drafts={...previous.drafts};for(const identity of changed)if(incoming.drafts[identity])drafts[identity]=incoming.drafts[identity];
 for(const identity of Object.keys(drafts))drafts[identity]={...drafts[identity],items:(drafts[identity].items || []).filter(note=>!removed.has(note.id))};
 return {entries:[...entries],drafts};
}
