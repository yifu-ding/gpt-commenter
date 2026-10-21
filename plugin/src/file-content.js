import {imageMime,isImage,isDocx,isOfficeTemporary} from './file-types.js';
export const fileLimit=name=>(isImage(name) || isDocx(name) ? 20 : 5)*1024*1024;
function base64(bytes){
  let binary='';
  for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
  return btoa(binary);
}
export function fileContent(name,bytes) {
  if(isOfficeTemporary(name))throw Error('This is an Office temporary lock file, not a document. Open the original file without the .~ or ~$ prefix.');
  if(bytes.length>fileLimit(name))throw Error(`File exceeds the ${fileLimit(name)/1024/1024} MB preview limit.`);
  if(isDocx(name))return {kind:'word',data:base64(bytes)};
  const mimeType=imageMime(name);
  if(mimeType){
    return {kind:'image',mimeType,url:`data:${mimeType};base64,${base64(bytes)}`};
  }
  try {
    if(bytes.includes(0))throw Error('Binary');
    return {kind:'text',text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)};
  } catch {
    return {kind:'text',readOnly:true,text:new TextDecoder().decode(bytes).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'�')};
  }
}
