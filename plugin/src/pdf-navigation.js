import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
export async function pdfNavigation(bytes){
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
 const pdf=await task.promise;
 async function destination(dest){try{if(typeof dest==='string')dest=await pdf.getDestination(dest);if(!Array.isArray(dest))return null;return typeof dest[0]==='number'?dest[0]+1:1+await pdf.getPageIndex(dest[0]);}catch{return null;}}
 try{
  const links={};
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),viewport=page.getViewport({scale:1});links[number]=[];
   for(const annotation of await page.getAnnotations({intent:'display'})){
    if(annotation.subtype!=='Link' || !annotation.rect)continue;
    const targetPage=await destination(annotation.dest),url=/^(https?:|mailto:)/i.test(annotation.url || '')?annotation.url:null;
    if(!targetPage && !url)continue;
    const [x1,y1]=viewport.convertToViewportPoint(annotation.rect[0],annotation.rect[1]),[x2,y2]=viewport.convertToViewportPoint(annotation.rect[2],annotation.rect[3]);
    links[number].push({page:targetPage,url,x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)});
   }
  }
  async function outline(nodes){return Promise.all((nodes || []).map(async node=>({title:node.title,page:await destination(node.dest),children:await outline(node.items)})));}
  return {links,outline:await outline(await pdf.getOutline())};
 }finally{await task.destroy();}
}
