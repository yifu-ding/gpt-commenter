// Refresh disk context without discarding the user's original review request.
export async function prepareReviewBatch(entries,{reviews,workspace,latex}) {
  const prepared=[],files=new Map();
  for(const entry of entries){
    const {item,root,path,etag}=entry;
    let live;try{live=await reviews.resolve(item.id,{fullSelection:true});}catch{live={status:'edited',current:{}};}
    live.current ||= {};
    if(live.status==='removed')continue;
    let next={...item,...(live.status==='current' && !live.hasUnsavedEdits?{startLine:live.current.startLine ?? item.startLine,endLine:live.current.endLine ?? item.endLine,selectedText:item.html?item.selectedText:live.current.selectedText ?? live.current.excerpt ?? item.selectedText}:{})};
    if(root && path){
      const key=JSON.stringify([root,path]);
      if(!files.has(key))files.set(key,item.pdf?await latex.read(root,path):await workspace.read(root,path));
      const current=files.get(key);
      const changed=!!etag && etag!==current.etag || live.hasUnsavedEdits || ['edited','deleted'].includes(live.status);
      if(changed){
        const quote=item.originalSnapshot?.selectedText || item.selectedText || live.original?.selectedText || live.current.selectedText || '';
        const start=quote?(current.text || '').indexOf(quote):-1;
        const unique=start>=0 && (current.text || '').indexOf(quote,start+1)<0;
        const lines=(current.text || '').split('\n');
        next={...next,selectedText:quote,diskContext:{changed:true,matched:unique,context:unique?current.text.slice(Math.max(0,start-500),start+quote.length+500):lines.slice(Math.max(0,(item.startLine || 1)-4),(item.endLine || item.startLine || 1)+3).join('\n').slice(0,4000)}};
        if(unique){next.startLine=current.text.slice(0,start).split('\n').length;next.endLine=next.startLine+quote.split('\n').length-1;}
      }
      if(item.pdf){next.pdf={...item.pdf,main:current.main};if(current.fingerprint===item.pdf.fingerprint && !item.pdf.region && live.status==='current' && (live.current.selectedText || live.current.excerpt))next.pdf.source=await latex.locate(root,path,{...item.pdf,startOffset:live.current.startOffset ?? item.startOffset,quote:live.current.selectedText ?? live.current.excerpt});else if(current.fingerprint!==item.pdf.fingerprint){next.pdf.source=undefined;next.diskContext={changed:true,matched:false,context:'PDF changed. The quote and screenshot refer to the reviewed version; verify the current PDF before editing.'};}}
      prepared.push({...entry,etag:current.etag,item:next});
    }else prepared.push({...entry,item:next});
  }
  return prepared;
}
