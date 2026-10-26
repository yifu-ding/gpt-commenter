// Resolve links against the selected project, never against a deeper opened file's folder as a new root.
export function resolveObsidianPath(target,currentPath,paths){
  const [raw,...fragment]=target.split('#');let name;
  try{name=decodeURIComponent(raw);}catch{name=raw;}
  name=name.replace(/\\/g,'/');
  if(/^[a-z][a-z0-9+.-]*:/i.test(name))throw Error('Only project-local links can be opened here.');
  const normalize=value=>{const parts=[];for(const part of value.split('/')){if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part && part!=='.')parts.push(part);}return parts.join('/');};
  const relative=normalize((currentPath?.split('/').slice(0,-1).join('/')||'')+'/'+name);
  const absolute=normalize(name.replace(/^\//,''));
  const candidates=name?[relative,absolute].filter(Boolean).flatMap(p=>[p,p+'.md',p+'.markdown']):[currentPath];
  let path=candidates.find(p=>paths.includes(p));
  if(!path && name){const matches=paths.filter(p=>[name,name+'.md',name+'.markdown'].some(n=>p===n || p.endsWith('/'+n)));if(matches.length===1)path=matches[0];else if(matches.length>1)throw Error(`Ambiguous link: ${target}. Use its project-relative path.`);}
  if(!path)throw Error(`Linked file not found: ${target}`);
  return {path,fragment:fragment.join('#')};
}
export function embeddedSection(text,fragment){
  if(!fragment)return text;
  const lines=text.split('\n');
  if(fragment.startsWith('^')){const id=fragment.slice(1),at=lines.findIndex(line=>new RegExp('(?:^|\\s)\\^'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$').test(line));if(at<0)throw Error('Block not found');let start=at;while(start>0 && lines[start-1].trim())start--;return lines.slice(start,at+1).join('\n');}
  const at=lines.findIndex(line=>line.replace(/^#{1,6}\s+/,'').trim()===fragment && /^#{1,6}\s/.test(line));if(at<0)throw Error('Heading not found');const level=/^#+/.exec(lines[at])[0].length;let end=at+1;while(end<lines.length && !new RegExp('^#{1,'+level+'}\\s').test(lines[end]))end++;return lines.slice(at,end).join('\n');
}
