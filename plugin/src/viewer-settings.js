export const accentColors={blue:['#2169bd','#8ec5ff'],purple:['#7952b3','#c6a7ff'],pink:['#b43e82','#f5a1cc'],red:['#ba3636','#ffaaa5'],orange:['#a65012','#ffb577'],yellow:['#806600','#f2d46b'],green:['#267349','#86d4a4'],teal:['#087c80','#7bd5d8'],gray:['#626975','#bdc4ce']};
export function applyThemeColor(color,context,root=document.documentElement){
 if(color==='host' || !accentColors[color])return;
 const dark=(context?.theme || root.dataset.theme)==='dark' || (!context?.theme && !root.dataset.theme && root.ownerDocument.defaultView.matchMedia?.('(prefers-color-scheme: dark)').matches);
 const accent=accentColors[color][dark?1:0];root.style.setProperty('--markatlas-accent',accent);root.style.setProperty('--markatlas-accent-soft',`color-mix(in srgb, ${accent} ${dark?22:12}%, ${dark?'#191b1a':'white'})`);
}
import {recentHistoryKey} from './recent-history.js';
export const recentRootsKey='markatlas:recent-projects:v1';
const revisionKey='markatlas:recent-projects-cleared:v1';
export function syncRecentHistory(storage,revision){
 if(!revision || storage.getItem(revisionKey)===revision)return false;
 storage.removeItem(recentRootsKey);storage.removeItem(recentHistoryKey);storage.setItem(revisionKey,revision);return true;
}
