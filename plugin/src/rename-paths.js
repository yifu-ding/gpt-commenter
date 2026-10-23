export function renamePaths(root,from,to){
 const path=value=>typeof value==='string' && (value===from || value.startsWith(from+'/'))?to+value.slice(from.length):value;
 const absolute=value=>typeof value==='string' && (value===root+'/'+from || value.startsWith(root+'/'+from+'/'))?root+'/'+to+value.slice((root+'/'+from).length):value;
 const identity=value=>{if(typeof value!=='string')return value;for(const prefix of ['project:','pdf:','latex:'])if(value.startsWith(prefix))return prefix+absolute(value.slice(prefix.length));return value;};
 const rewrite=value=>{if(Array.isArray(value))return value.map(rewrite);if(!value || typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([key,item])=>[identity(key),key==='identity'?identity(item):['storage','working'].includes(key)?storage(item):key==='sourcePath'?absolute(item):['path','sourceName','singlePath','main'].includes(key)?path(item):rewrite(item)]));};
  const storage=value=>{if(typeof value!=='string')return value;for(const prefix of ['project:','pdf:','latex:']){const fromKey=prefix+root+'/'+from,index=value.indexOf(fromKey);if(index>=0 && ['', '/', ':'].includes(value.charAt(index+fromKey.length)))return value.slice(0,index)+prefix+root+'/'+to+value.slice(index+fromKey.length);}return value;};
 return {path,absolute,identity,rewrite,storage};
}
