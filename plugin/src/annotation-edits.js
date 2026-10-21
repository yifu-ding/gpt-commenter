import {ChangeSet} from '@codemirror/state';
import {diff} from '@codemirror/merge';
import {sourceSelection} from './markdown.js';
export function textChanges(before,after){return ChangeSet.of(diff(before,after).map(c=>({from:c.fromA,to:c.toA,insert:after.slice(c.fromB,c.toB)})),before.length);}
export function moveAnnotations(items,before,after,changes=textChanges(before,after)) {
  const edits=[];changes.iterChanges((from,to,fromB,toB)=>edits.push({from,to,fromB,toB}));
  return items.map(item=>{
    const originalSnapshot=item.originalSnapshot || {documentHash:item.documentHash,startLine:item.startLine,endLine:item.endLine,startOffset:item.startOffset,endOffset:item.endOffset,selectedText:item.selectedText};
    let start=changes.mapPos(item.startOffset,1),end=changes.mapPos(item.endOffset,1);
    const covered=edits.find(e=>e.from<=item.startOffset && e.to>=item.endOffset && e.to>e.from);
    const touched=edits.some(e=>e.from<item.endOffset && e.to>item.startOffset || e.from===e.to && e.from>item.startOffset && e.from<=item.endOffset);
    if(covered){start=covered.fromB;end=covered.toB;}
    if(item.anchorStatus==='deleted') {
      const restored=edits.find(e=>e.from===item.startOffset && e.to===item.endOffset && after.slice(e.fromB,e.toB)===originalSnapshot.selectedText);
      if(restored){start=restored.fromB;end=restored.toB;}
    }
    const deleted=end<=start;
    return {...item,...sourceSelection(after,start,Math.max(start,end)),originalSnapshot,sourceText:after.slice(start,Math.max(start,end)),anchorStatus:deleted?'deleted':touched?'edited':item.anchorStatus==='deleted'?'current':item.anchorStatus || 'current',updatedAt:new Date().toISOString()};
  });
}
