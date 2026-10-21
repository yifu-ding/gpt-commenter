import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
const excerpt=text=>Array.from(text).length>180 ? `${Array.from(text).slice(0,88).join('')} … ${Array.from(text).slice(-89).join('')}` : text;
export function reviewStore(base=process.env.PLUGIN_DATA || join(tmpdir(),'gpt-commenter-data')) {
  const dir=join(base,'review-documents');
  const valid=id=>{if(!/^[\da-f-]{36}$/i.test(id))throw Error('Invalid annotation ID.');return id;};
  async function put(name,data){await mkdir(dir,{recursive:true,mode:0o700});const target=join(dir,name),temp=`${target}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,target);}
  async function document(id){const pointer=JSON.parse(await readFile(join(dir,`${valid(id)}.json`),'utf8'));return JSON.parse(await readFile(join(dir,`${pointer.documentId}.document.json`),'utf8'));}
  return {
    async update({identity,sourcePath,sourceName,text,baseText,annotations,checkpointAnnotationId}) {
      const documentId=hash(identity);
      let previous;try{previous=JSON.parse(await readFile(join(dir,`${documentId}.document.json`),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      let checkpointText=previous?.checkpointText ?? baseText;
      const editUnits=previous?.editUnits || [];
      if(checkpointAnnotationId){
        valid(checkpointAnnotationId);
        // One exact replacement represents all edits since the preceding comment.
        // The full checkpoint stays private; model context receives only a summary.
        let from=0,endBefore=checkpointText.length,endAfter=text.length;
        while(from<endBefore && from<endAfter && checkpointText[from]===text[from])from++;
        while(endBefore>from && endAfter>from && checkpointText[endBefore-1]===text[endAfter-1]){endBefore--;endAfter--;}
        editUnits.push({annotationId:checkpointAnnotationId,fromHash:hash(checkpointText),toHash:hash(text),change:{from,to:endBefore,deleted:checkpointText.slice(from,endBefore),insert:text.slice(from,endAfter)},at:new Date().toISOString()});
        checkpointText=text;
      }
      const record={documentId,sourcePath,sourceName,text,baseText,documentHash:hash(text),diskHash:hash(baseText),checkpointText,editUnits:editUnits.slice(-100),annotations,updatedAt:new Date().toISOString()};
      await put(`${documentId}.document.json`,record);
      for(const item of annotations)await put(`${valid(item.id)}.json`,{documentId});
      return {documentId};
    },
    async resolve(id,{fullSelection=false}={}) {
      let d;try{d=await document(id);}catch{throw Error('This annotation is not available. Reopen its viewer to sync the latest draft before making edits.');}
      const note=d.annotations.find(n=>n.id===id);if(!note)return {id,status:'removed',instruction:'The user removed this annotation. Do not apply its old request.'};
      const start=note.startOffset,end=note.endOffset,lines=d.text.split('\n');
      const startLine=d.text.slice(0,start).split('\n').length,endLine=d.text.slice(0,Math.max(start,end-1)).split('\n').length;
      const status=note.anchorStatus || 'current';
      const unit=d.editUnits?.findLast(u=>u.annotationId===id);
      const compactPdf=pdf=>Object.fromEntries(['root','path','main','fingerprint','page','endPage','x','y','region','source'].filter(key=>pdf[key]!==undefined).map(key=>[key,pdf[key]]));
      const original=note.originalSnapshot?.pdf?{...note.originalSnapshot,pdf:compactPdf(note.originalSnapshot.pdf)}:note.originalSnapshot;
      return {id,status,...(note.word?{word:note.word}:{}),...(note.pdf?{pdf:compactPdf(note.pdf)}:{}),...(unit?{editCheckpoint:{fromHash:unit.fromHash,toHash:unit.toHash,changed:unit.fromHash!==unit.toHash}}:{}),sourcePath:d.sourcePath,sourceName:d.sourceName,documentHash:d.documentHash,diskHash:d.diskHash,hasUnsavedEdits:d.text!==d.baseText,updatedAt:d.updatedAt,original,current:{...(fullSelection?{startOffset:start,endOffset:end,selectedText:d.text.slice(start,end)}:{}),startLine,endLine,excerpt:excerpt(d.text.slice(start,end)),context:lines.slice(Math.max(0,startLine-3),endLine+2).join('\n').slice(0,4000)},comment:note.message,detail:note.detail,instruction:status==='deleted'?'The passage was deleted. Do not apply the original request automatically.':note.word?'Word preview text is extracted for review. Do not write it over the binary DOCX. Use DOCX-aware tools only for explicitly requested document edits and preserve formatting.':status==='edited'?'The user changed this passage. Reconcile the original request with the current text and user edits. Never restore an old version wholesale.':'Use the latest location and text. Verify the disk version before editing; unsaved viewer text must also be preserved.'};
    },
    async read(id,startLine,endLine) {
      const d=await document(id);if(!d.annotations.some(n=>n.id===id))throw Error('This annotation was removed.');
      const lines=d.text.split('\n'),text=lines.slice(startLine-1,endLine).join('\n');
      return {sourcePath:d.sourcePath,documentHash:d.documentHash,diskHash:d.diskHash,hasUnsavedEdits:d.text!==d.baseText,startLine,totalLines:lines.length,text:text.slice(0,20000),truncated:text.length>20000};
    }
  };
}
