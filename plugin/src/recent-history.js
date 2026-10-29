export const recentHistoryKey='markatlas:recent-opened:v2';
const legacyKey='markatlas:recent-projects:v1';
export const recentHistoryLimit=10;
function parse(storage,key){try{const value=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
export function readRecentHistory(storage){
 const entries=parse(storage,recentHistoryKey);
 // Legacy history has no timestamps; retain its existing newest-first order.
 const legacy=parse(storage,legacyKey).filter(root=>typeof root==='string' && root).map((root,index)=>({root,openedAt:-index}));
 const unique=new Map();
 for(const entry of [...entries,...legacy]){
  if(!entry || typeof entry.root!=='string' || !entry.root || !Number.isFinite(entry.openedAt) || entry.path!==undefined)continue;
  const previous=unique.get(entry.root);
  if(!previous || entry.openedAt>previous.openedAt)unique.set(entry.root,{root:entry.root,openedAt:entry.openedAt});
 }
 return [...unique.values()].sort((a,b)=>b.openedAt-a.openedAt).slice(0,recentHistoryLimit);
}
export function rememberRecent(storage,root,now=Date.now()){
 // Read shared storage at the time of the open, never a viewer's stale snapshot.
 const entries=readRecentHistory(storage);
 const openedAt=Math.max(now,(entries[0]?.openedAt||0)+1);
 const next=[{root,openedAt},...entries.filter(value=>value.root!==root)].slice(0,recentHistoryLimit);
 storage.setItem(recentHistoryKey,JSON.stringify(next));storage.removeItem(legacyKey);return next;
}
