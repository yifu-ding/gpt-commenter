// File-local search. CSS Highlights preserve the renderer's source maps and annotations.
export function createFileSearch({document:doc,container,panel,input,count,previous,next,close,getSource,sourceMode,selectSource}){
  let matches=[],index=-1;
  const win=doc.defaultView;
  function clear(){win.CSS?.highlights?.delete('markatlas-find');win.CSS?.highlights?.delete('markatlas-find-active');}
  function update(move=true){
    clear();matches=[];index=-1;
    const query=input.value.toLocaleLowerCase();
    if(!query){count.textContent='0 / 0';return;}
    if(sourceMode()){
      const text=getSource().toLocaleLowerCase();let at=0;
      while((at=text.indexOf(query,at))!==-1){matches.push({from:at,to:at+query.length});at+=Math.max(1,query.length);}
    }else{
      const walker=doc.createTreeWalker(container,4),nodes=[];let text='',node;
      while(node=walker.nextNode()){
        if(node.parentElement.closest('script,style,.katex-mathml,.annotation-icon,[hidden]'))continue;
        const range=doc.createRange();range.selectNodeContents(node);if(!range.getClientRects().length)continue;
        nodes.push({node,start:text.length,end:text.length+node.length});text+=node.textContent;
      }
      let at=0;const lower=text.toLocaleLowerCase();
      while((at=lower.indexOf(query,at))!==-1){
        const first=nodes.find(n=>n.end>at),last=nodes.find(n=>n.end>=at+query.length);
        if(first&&last){const range=doc.createRange();range.setStart(first.node,at-first.start);range.setEnd(last.node,at+query.length-last.start);matches.push(range);}
        at+=Math.max(1,query.length);
      }
      if(win.Highlight&&win.CSS?.highlights)win.CSS.highlights.set('markatlas-find',new win.Highlight(...matches));
    }
    if(move)go(1);else count.textContent=`${matches.length?'1':'0'} / ${matches.length}`;
  }
  function go(step){
    if(!matches.length){count.textContent='0 / 0';return;}
    index=(index+step+matches.length)%matches.length;const match=matches[index];count.textContent=`${index+1} / ${matches.length}`;
    if(sourceMode())selectSource(match.from,match.to);
    else{
      if(win.Highlight&&win.CSS?.highlights)win.CSS.highlights.set('markatlas-find-active',new win.Highlight(match));
      else{const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(match);}
      match.startContainer.parentElement.scrollIntoView({block:'center',behavior:'instant'});
    }
  }
  function open(query){panel.hidden=false;input.value=typeof query==='string'?query:'';input.focus({preventScroll:true});input.select();update();}
  function hide(){panel.hidden=true;clear();}
  input.addEventListener('input',()=>update());input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go(e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide();}});
  previous.addEventListener('click',()=>go(-1));next.addEventListener('click',()=>go(1));close.addEventListener('click',hide);
  doc.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'){e.preventDefault();e.stopImmediatePropagation();open();}},true);
  return {open,hide,refresh(){if(!panel.hidden)update(false);}};
}
