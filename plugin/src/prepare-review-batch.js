// Finalize the whole batch in one viewer/server request; no model resolver round trips.
export async function prepareReviewBatch(entries,{reviews,workspace,latex}) {
  const prepared=[],files=new Map();
  for(const entry of entries){
    const {item,root,path,etag}=entry;
    const live=await reviews.resolve(item.id,{fullSelection:true});
    if(['removed','deleted'].includes(live.status) || item.html?.region && (item.anchorStatus==='edited' || live.status==='edited'))continue;
    if(root && live.hasUnsavedEdits)throw Error(`Save edits in ${path || item.sourceName} before sending.`);
    let next={...item,startLine:live.current.startLine,endLine:live.current.endLine,selectedText:item.html?item.selectedText:live.current.selectedText ?? (root?live.current.excerpt:item.selectedText)};
    if(root && path){
      const key=JSON.stringify([root,path]);
      if(!files.has(key))files.set(key,item.pdf?await latex.read(root,path):await workspace.read(root,path));
      const current=files.get(key);
      if(item.pdf?.region && (item.anchorStatus==='edited' || current.fingerprint!==item.pdf.fingerprint))continue;
      if(etag && current.etag!==etag)throw Error(`${path} changed on disk. Reopen it to refresh the comments before sending.`);
      if(item.pdf){
        if(current.fingerprint!==item.pdf.fingerprint)throw Error(`${path} was rebuilt. Reopen it to refresh the comments before sending.`);
        next.pdf={...item.pdf,main:current.main};
        if(!item.pdf.region)next.pdf.source=await latex.locate(root,path,{...item.pdf,startOffset:live.current.startOffset ?? item.startOffset,quote:live.current.selectedText ?? live.current.excerpt});
      }
    }
    prepared.push({...entry,item:next});
  }
  return prepared;
}
