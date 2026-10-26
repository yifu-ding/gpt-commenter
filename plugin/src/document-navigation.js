import {markdownBlocks} from './live-markdown.js';
export function createDocumentNavigation(panel,{loadPage,jumpHeading,jumpPage}){
 let observer=null,generation=0,key=null;
 function text(node){return node.value || (node.children || []).map(text).join('');}
 function show({pdf,source,name,visible}){
  panel.hidden=!visible;if(!visible)return;
  const next=pdf || name+'\0'+source;if(key===next)return;key=next;
  const epoch=++generation;observer?.disconnect();panel.replaceChildren();
  function button(label,action,depth=0){const node=document.createElement('button');node.textContent=label;node.style.paddingLeft=`${5+depth*12}px`;node.addEventListener('click',action);panel.append(node);return node;}
  if(pdf){
   function outline(nodes,depth=0){for(const node of nodes || []){if(node.page)button(node.title,()=>jumpPage(node.page),depth);outline(node.children,depth+1);}}outline(pdf.navigation?.outline);
   const queue=[];let running=false;
   async function drain(){if(running)return;running=true;while(queue.length && epoch===generation){const [preview,page]=queue.shift(),image=preview.querySelector('img'),status=preview.querySelector('span');try{const result=await loadPage(pdf,page);if(epoch===generation){image.onload=()=>{image.hidden=false;status.hidden=true;};image.onerror=()=>{image.hidden=true;status.hidden=false;status.textContent='Preview unavailable';};image.src=result.image;}}catch{if(epoch===generation)status.textContent='Preview unavailable';}}running=false;}
   observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);queue.push([entry.target,Number(entry.target.dataset.page)]);}drain();},{root:panel,rootMargin:'180px'});
   for(const page of pdf.pages){const node=button(`Page ${page.number}`,()=>jumpPage(page.number));const preview=document.createElement('span');preview.className='pdf-thumbnail';preview.dataset.page=page.number;preview.style.aspectRatio=`${page.width}/${page.height}`;const image=document.createElement('img');image.alt=`Page ${page.number}`;image.hidden=true;const status=document.createElement('span');status.textContent='Loading…';preview.append(image,status);node.prepend(preview);observer.observe(preview);}
  }else{
   let count=0;function walk(nodes){for(const node of nodes){if(node.type==='heading'){const index=count++;button(text(node),()=>jumpHeading(node.position.start.offset,index),node.depth-1);}if(node.children)walk(node.children);}}walk(markdownBlocks(source));
   if(!count)panel.textContent='No headings in this document.';
  }
 }
 return {show};
}
