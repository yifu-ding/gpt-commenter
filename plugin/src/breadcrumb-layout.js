// Keep a suffix of whole directory segments; never clip a directory name.
export function firstVisibleDirectory(widths,available,filenameWidth,separatorWidth=10,gap=3){
 for(let start=0;start<=widths.length;start++){
  const remaining=widths.length-start;
  const width=filenameWidth+widths.slice(start).reduce((a,b)=>a+b,0)+remaining*(separatorWidth+2*gap);
  if(width<=available)return start;
 }
 return widths.length;
}
export function fitBreadcrumb(nav){
 const filename=nav.querySelector('#filename'),root=nav.querySelector('#project-toggle'),folders=[...nav.querySelectorAll('[data-breadcrumb-folder]')],finalSeparator=nav.querySelector('#filename-separator');
 if(!filename || !root || filename.hidden){root.hidden=false;return;}
 const directories=[root,...folders],separators=folders.map(button=>button.previousElementSibling);
 nav.classList.remove('filename-wrap');directories.forEach(node=>{node.hidden=false;});separators.forEach(node=>{node.hidden=false;});
 const style=nav.ownerDocument.defaultView.getComputedStyle(nav),gap=parseFloat(style.columnGap)||3;
 const close=nav.querySelector('#close-pane'),closeWidth=close && !close.hidden?close.getBoundingClientRect().width+gap:0;
 const available=(nav.parentElement?.classList.contains('breadcrumb-space')?nav.parentElement.clientWidth:nav.clientWidth)-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0)-closeWidth;
 if(available<=0)return;
 const separatorWidth=finalSeparator.getBoundingClientRect().width||10,filenameWidth=filename.getBoundingClientRect().width;
 const first=firstVisibleDirectory(directories.map(node=>node.getBoundingClientRect().width),available,filenameWidth,separatorWidth,gap);
 directories.forEach((node,index)=>{node.hidden=index<first;});
 separators.forEach((node,index)=>{node.hidden=index+1<=first;});
 finalSeparator.hidden=first===directories.length;
 nav.classList.toggle('filename-wrap',filenameWidth>available);
 nav.title=[root.textContent.replace(/›/g,''),...folders.map(node=>node.textContent),filename.textContent].join(' / ');
}
