import {isSupportedFile,isOfficeTemporary} from './file-types.js';
const ignored = new Set(['.git','node_modules','.DS_Store']);
export function buildProject(files,limit=Infinity) {
  const root={name:'Project',type:'directory',path:'',children:[]};
  const directories=new Map([['',root]]), entries=new Map();
  let omitted=0;
  for(const file of files) {
    const path=file.webkitRelativePath || file.name;
    const parts=path.split('/');
    if(parts.some(part=>!part || part==='.' || part==='..' || ignored.has(part)) || isOfficeTemporary(parts.at(-1))) {omitted++;continue;}
    if(entries.size>=limit){omitted++;continue;}
    const folder=parts.length>1 ? parts[0] : 'Project';
    if(root.name==='Project')root.name=folder;
    const relative=parts.length>1 ? parts.slice(1) : parts;
    let parent=root, prefix='';
    for(const name of relative.slice(0,-1)) {
      prefix=prefix ? `${prefix}/${name}` : name;
      if(!directories.has(prefix)){const node={name,path:prefix,type:'directory',children:[]};directories.set(prefix,node);parent.children.push(node);}
      parent=directories.get(prefix);
    }
    const relativePath=relative.join('/');
    if(entries.has(relativePath))continue;
    const node={name:relative.at(-1),path:relativePath,type:'file',modified:file.lastModified||0,supported:isSupportedFile(relativePath)};
    parent.children.push(node);entries.set(relativePath,file);
  }
  function sort(node){node.children.sort((a,b)=>(a.type===b.type?0:a.type==='directory'?-1:1)||a.name.localeCompare(b.name));for(const child of node.children)if(child.type==='directory')sort(child);}
  sort(root);
  return {root,files:entries,omitted};
}

// All coordinates are in the viewport, matching DOM Range client rectangles.
export function floatingPosition(anchor,width,height,viewport,headerBottom=0) {
  const gap=12, leftLimit=12, topLimit=Math.max(12,headerBottom+12);
  const maxWidth=Math.max(0,viewport.width-24), panelWidth=Math.min(width,maxWidth);
  const maxHeight=Math.max(0,viewport.height-topLimit-12), panelHeight=Math.min(height,maxHeight);
  let left=anchor.right+gap, top=anchor.top;
  if(left+panelWidth>viewport.width-gap) {
    const before=anchor.left-panelWidth-gap;
    if(before>=leftLimit)left=before;
    else {left=anchor.left;top=anchor.bottom+gap;}
  }
  left=Math.max(leftLimit,Math.min(left,viewport.width-panelWidth-gap));
  top=Math.max(topLimit,Math.min(top,viewport.height-panelHeight-gap));
  return {left,top,maxWidth,maxHeight};
}
