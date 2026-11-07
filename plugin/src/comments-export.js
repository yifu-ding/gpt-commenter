import {readFile,writeFile} from 'node:fs/promises';
import {relativeReviewPath} from './review-prompts.js';

export async function exportReviewComments({root,data,version},{workspace,reviews,exportComments}) {
  if(root && !await workspace.sourceDiscoveryAllowed(root))throw Error('Project is no longer available. Refresh the file tree.');
  const contents=version==='last'?await reviews.lastComments(root):root?await reviews.projectJson(root):data;
  if(contents===null)throw Error('No previous comments are available.');
  return exportComments({data:contents});
}

function selectionPosition(item) {
  let position=`L${item.startLine}${item.endLine===item.startLine?'':`-L${item.endLine}`}`;
  if(Number.isInteger(item.startColumn) && Number.isInteger(item.endColumn)) {
    position=`L${item.startLine}:C${item.startColumn}-L${item.endLine}:C${item.endColumn}`;
  } else if(Number.isInteger(item.startOffset) && Number.isInteger(item.endOffset)) {
    // Legacy character offsets are zero-based and end-exclusive.
    position+=`@${item.startOffset}-${item.endOffset}`;
  }
  if(item.pdf) {
    const pdf=item.pdf;
    position=`P${pdf.page}${pdf.endPage && pdf.endPage!==pdf.page?`-P${pdf.endPage}`:''}`;
    if(pdf.region)position+=` ${JSON.stringify(pdf.region)}`;
    else if(Number.isInteger(item.startOffset) && Number.isInteger(item.endOffset))position+=`@${item.startOffset}-${item.endOffset}`;
  } else if(item.html?.region)position+=` ${JSON.stringify(item.html.region)}`;
  return position;
}

export function compactComments(record) {
  const entries=Array.isArray(record)?record:record.entries || [];
  const files=Object.create(null);
  for(const [,entry] of entries) {
    const item=entry.item;
    if(!item || (item.kind && item.kind!=='comment') || typeof item.message!=='string' || !item.message.trim())continue;
    const root=entry.root || item.projectRoot || item.pdf?.root;
    const path=relativeReviewPath(entry.path || item.pdf?.path || item.sourcePath,root) || item.sourceName;
    if(!path)continue;
    (files[path] ||= []).push([selectionPosition(item),item.message]);
  }
  return files;
}

// Export only file names, selection positions and original comments.
export function createCommentsExporter({choose,read=readFile,write=writeFile}) {
  let active=null;
  return async({source,data})=>{
    if(active)return active;
    active=(async()=>{
      const contents=source?await read(source):data;
      if(contents===undefined)throw Error('No saved comments are available to export.');
      const compact=JSON.stringify(compactComments(JSON.parse(contents.toString())));
      const path=await choose();
      if(!path)return {cancelled:true};
      await write(path,compact,'utf8');
      return {saved:true};
    })();
    try{return await active;}finally{active=null;}
  };
}
