import {renamePaths} from './rename-paths.js';
import {mergeProjectState} from './project-state.js';
import {mkdir,writeFile,readFile,rename,lstat,realpath,readdir} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
const excerpt=text=>Array.from(text).length>180 ? `${Array.from(text).slice(0,88).join('')} … ${Array.from(text).slice(-89).join('')}` : text;
export function reviewStore(base=process.env.PLUGIN_DATA || join(tmpdir(),'gpt-commenter-data')) {
  const dir=join(base,'review-documents'),projectWrites=new Map();
  const valid=id=>{if(!/^[\da-f-]{36}$/i.test(id))throw Error('Invalid annotation ID.');return id;};
  async function projectDir(root){const actual=await realpath(root),target=join(actual,'.markatlas');try{if((await lstat(target)).isSymbolicLink())throw Error('Project metadata must not be a symbolic link.');}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(target,{recursive:true,mode:0o700});return target;}
  async function put(name,data,directory=dir){await mkdir(directory,{recursive:true,mode:0o700});const target=join(directory,name),temp=`${target}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,target);}
  async function document(id){const pointer=JSON.parse(await readFile(join(dir,`${valid(id)}.json`),'utf8'));return JSON.parse(await readFile(join(pointer.directory || dir,`${pointer.documentId}.document.json`),'utf8'));}
  return {
    async renamed(root,from,to){
      const directory=await projectDir(root);await projectWrites.get(directory);
      const {rewrite,identity}=renamePaths(root,from,to);
      for(const name of await readdir(directory)){
        if(name!=='project.json' && !/^[a-f0-9]{64}\.document\.json$/.test(name))continue;
        const old=JSON.parse(await readFile(join(directory,name),'utf8')),data=rewrite(old);
        if(name==='project.json'){await put(name,data,directory);continue;}
        if(data.sourcePath===old.sourcePath)continue;
        const prefix=['project:','pdf:','latex:'].find(prefix=>hash(prefix+old.sourcePath)===old.documentId) || (old.annotations?.some(n=>n.pdf)?'pdf:':'project:');
        data.documentId=hash(identity(prefix+old.sourcePath));await put(data.documentId+'.document.json',data,directory);
        for(const note of data.annotations || [])await put(`${valid(note.id)}.json`,{documentId:data.documentId,directory});
        // Keep the old record consistent too, so rebuilding pointers cannot restore stale paths.
        await put(name,data,directory);
      }
    },
    async project(root,state){const directory=await projectDir(root);if(state!==undefined){const previousWork=projectWrites.get(directory)||Promise.resolve();const work=previousWork.catch(()=>{}).then(async()=>{let previous={entries:[],drafts:{}};try{previous=JSON.parse(await readFile(join(directory,'project.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}await put('project.json',mergeProjectState(previous,state),directory);return {saved:true};});projectWrites.set(directory,work);try{return await work;}finally{if(projectWrites.get(directory)===work)projectWrites.delete(directory);}}try{for(const name of await readdir(directory)){if(!/^[a-f0-9]{64}\.document\.json$/.test(name))continue;const record=JSON.parse(await readFile(join(directory,name),'utf8'));for(const note of record.annotations || [])await put(`${valid(note.id)}.json`,{documentId:record.documentId,directory});}return JSON.parse(await readFile(join(directory,"project.json"),"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;return {entries:[],drafts:{}};}},
    async nestedProject(root,path){
      const actual=await realpath(root),target=await realpath(join(actual,path));
      const rel=relative(actual,target);
      if(rel==='..' || rel.startsWith('../') || isAbsolute(rel))throw Error('File is outside the project.');
      let state=await this.project(actual);
      const folders=[];for(let folder=dirname(target);folder!==actual;folder=dirname(folder))folders.unshift(folder);
      for(const folder of folders){
        const directory=join(folder,'.markatlas');
        try{if((await lstat(directory)).isSymbolicLink())throw Error('Project metadata must not be a symbolic link.');}
        catch(error){if(error.code==='ENOENT')continue;throw error;}
        const prefix=relative(actual,folder).split('\\').join('/');
        const rebase=value=>{
          if(Array.isArray(value))return value.map(rebase);
          if(!value || typeof value!=='object')return value;
          const next=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rebase(item)]));
          if(value.root===folder){next.root=actual;for(const key of ['path','main'])if(typeof value[key]==='string' && !isAbsolute(value[key]))next[key]=prefix+'/'+value[key];}
          if(value.projectRoot===folder)next.projectRoot=actual;
          return next;
        };
        const child=rebase(await this.project(folder));
        state=mergeProjectState(state,{...child,changedIdentities:[...new Set([...Object.keys(child.drafts || {}),...(child.entries || []).map(([,entry])=>entry.identity)])]});
      }
      return state;
    },
    async update({root,identity,sourcePath,sourceName,text,baseText,annotations,checkpointAnnotationId}) {
      const documentId=hash(identity),directory=root?await projectDir(root):dir;
      let previous;try{previous=JSON.parse(await readFile(join(directory,`${documentId}.document.json`),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
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
      await put(`${documentId}.document.json`,record,directory);
      for(const item of annotations)await put(`${valid(item.id)}.json`,{documentId,directory});
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
      return {id,status,...(note.word?{word:note.word}:{}),...(note.html?{html:{...note.html,screenshot:undefined}}:{}),...(note.pdf?{pdf:compactPdf(note.pdf)}:{}),...(unit?{editCheckpoint:{fromHash:unit.fromHash,toHash:unit.toHash,changed:unit.fromHash!==unit.toHash}}:{}),sourcePath:d.sourcePath,sourceName:d.sourceName,documentHash:d.documentHash,diskHash:d.diskHash,hasUnsavedEdits:d.text!==d.baseText,updatedAt:d.updatedAt,original,current:{...(fullSelection?{startOffset:start,endOffset:end,selectedText:d.text.slice(start,end)}:{}),startLine,endLine,excerpt:excerpt(d.text.slice(start,end)),context:lines.slice(Math.max(0,startLine-3),endLine+2).join('\n').slice(0,4000)},comment:note.message,detail:note.detail,instruction:status==='deleted'?'The passage was deleted. Do not apply the original request automatically.':note.word?'Word preview text is extracted for review. Do not write it over the binary DOCX. Use DOCX-aware tools only for explicitly requested document edits and preserve formatting.':status==='edited'?'The user changed this passage. Reconcile the original request with the current text and user edits. Never restore an old version wholesale.':'Use the latest location and text. Verify the disk version before editing; unsaved viewer text must also be preserved.'};
    },
    async read(id,startLine,endLine) {
      const d=await document(id);if(!d.annotations.some(n=>n.id===id))throw Error('This annotation was removed.');
      const lines=d.text.split('\n'),text=lines.slice(startLine-1,endLine).join('\n');
      return {sourcePath:d.sourcePath,documentHash:d.documentHash,diskHash:d.diskHash,hasUnsavedEdits:d.text!==d.baseText,startLine,totalLines:lines.length,text:text.slice(0,20000),truncated:text.length>20000};
    }
  };
}
