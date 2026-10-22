import {htmlPreviewDocument} from './html-preview.js';
import {createFileSearch} from './file-search.js';
import {resolveObsidianPath,embeddedSection} from './obsidian-links.js';
import {createFileMenu} from './file-menu.js';
import {createPdfViewer,PDF_MIN_ZOOM,PDF_MAX_ZOOM} from './pdf-viewer.js';
import {createEditHistory} from './edit-history.js';
import {ChangeSet} from '@codemirror/state';
import {moveAnnotations} from './annotation-edits.js';
import {createCodeEditor} from './editor.js';
import {isMarkdown,isImage,isPdf,isLatex} from './file-types.js';
import {fileContent,fileLimit} from './file-content.js';
import {renderWordPreview,createWordViewer} from './word-viewer.js';
import {App} from '@modelcontextprotocol/ext-apps';
import {OpenAIExtensions, OpenAIFileEntrypointInputSchema} from '@openai/mcp-extensions/app';
import {normalize, renderMarkdown} from './markdown.js';
import {requestExplanation} from './chat.js';
import {sendReviewBatch} from './review-batch.js';
import {floatingPosition} from './project.js';
import {createFileRefresh} from './refresh.js';
const appIcon = document.getElementById('app-icon').content.querySelector('svg');
const app = new App({name:document.title,title:document.title,version:'0.16.2',icons:appIcon ? [{
  src:`data:image/svg+xml;base64,${btoa(appIcon.outerHTML)}`,mimeType:'image/svg+xml',sizes:['any']
}] : []});
const extensions = new OpenAIExtensions(app);

const $ = id => document.getElementById(id);
const toolbarPaths={
  files:'<path d="M3 7h6l2-3h10v16H3z"/><path d="M3 10h18"/>',
  comments:'<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V5a2 2 0 0 1 2-2h8a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 12h7"/>',
  find:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  preview:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  source:'<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-15-2 16"/>',
  edit:'<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/>',
  wide:'<path d="M3 4v16M21 4v16M4 12h16m-12-4-4 4 4 4m8-8 4 4-4 4"/>',
  readable:'<path d="M6 4v16M18 4v16M9 7h6M9 11h6M9 15h6"/>'
};
function toolbarIcon(id,label,icon){const button=$(id);button.innerHTML=`<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${toolbarPaths[icon]}</svg>`;button.title=label;button.setAttribute('aria-label',label);}
for(const [id,label,icon] of [['comments-toggle','Comments','comments'],['file-find','Find in file','find'],['tree-toggle','Files','files'],['mode-cycle','Preview','preview']])toolbarIcon(id,label,icon);

let source = '', fileName = '', sourcePath = null, documentHash = '', identity = '', revision = 0, incomingRevision = 0;
let displayWork=null;
let diskSource='',diskHash='',hashWork=null,syncTimer=null,syncQueue=Promise.resolve(),renderedCaret=null;
let codeMode='review',currentEtag=null,saving=false,codeFile=false;
let saveTimer=null,saveWork=null,pdfDocument=null,pdfPoll=null,pdfPollBusy=false;
let filePreview=null;
let textScale=1;
try{const saved=Number(localStorage.getItem('markdown-review:text-scale'));if(saved>=.75 && saved<=2)textScale=saved;}catch{}
const editHistory=createEditHistory();
let linkedPdf=null;
let connectedFolder = null, breadcrumbFolder = null;
let project = null, activeProjectPath = null, selectionAnchor = null, ignoreOutsideClick = false;
let mode = 'rendered', commenting = true, mapping, items = [], pending = null, kind = 'comment', editingId = null, detail = null;
let commentDraft='';
let replyTimer=null,replyGeneration=0;
function stopReply(){clearTimeout(replyTimer);replyTimer=null;++replyGeneration;}
function showExplanation(item) {
  stopReply();
  const visible=kind==='explanation' && !!(item?.explanationRequestId || item?.explanationStatus);
  $('explanation-box').hidden=!visible;
  renderMarkdown($('explanation-answer'),visible ? normalize(item.explanationAnswer || '') : '','rendered');
  $('explanation-status').textContent=visible ? item.explanationError || (item.explanationAnswer ? `Explanation${item.explanationModel ? ' · '+item.explanationModel : ''}` : 'Waiting for the model’s response. This may take a few seconds…') : '';
  if(!visible || !item.explanationRequestId || item.explanationAnswer || item.explanationError)return;
  const generation=replyGeneration,current=revision,id=item.id,requestId=item.explanationRequestId,started=Date.now();
  async function poll(){
    const active=()=>generation===replyGeneration && current===revision && editingId===id && !$('composer').hidden;
    if(!active())return;
    try {
      const reply=await serverData('read_markdown_explanation',{requestId});
      if(!active())return;
      const note=items.find(note=>note.id===id && note.explanationRequestId===requestId);
      if(!note)return;
      if(reply.status==='answered' && typeof reply.answer==='string'){
        note.explanationAnswer=reply.answer;note.explanationStatus='answered';persist();
        renderMarkdown($('explanation-answer'),normalize(reply.answer),'rendered');$('explanation-status').textContent=`Explanation${note.explanationModel ? ' · '+note.explanationModel : ''}`;positionComposer();return;
      }
      if(Date.now()-started>=5*60*1000){$('explanation-status').textContent='No reply yet. Reopen this note to check again.';return;}
      replyTimer=setTimeout(poll,1000);
    } catch(error){if(active()){$('explanation-status').textContent=`Cannot receive the explanation: ${error.message} Reopen this note to retry.`;}}
  }
  // Defer until open() has made the composer visible.
  replyTimer=setTimeout(poll,0);
}
const wordViewer=createWordViewer($('document'),{
  onSelection(selection,anchor){if(commenting){offerSelection(selection,anchor);}},
  onNote(item,anchor){open(item,item,anchor);},onDismiss:()=>close(),
  onZoom:updateDocumentZoom,onPage:(number,total)=>{$('pdf-page-float').textContent=`${number}/${total}`;}
});
const fileRefresh=createFileRefresh({
  isBusy:()=>batchSending || !$('composer').hidden || source!==diskSource || saving,
  async apply(text,metadata) {
    const scroll=window.scrollY,generation=incomingRevision;
    let preview=filePreview?.kind==='image' ? {...filePreview,url:text} : filePreview;
    if(preview?.kind==='word')preview={...preview,data:text,...await renderWordPreview(text)};
    if(generation!==incomingRevision)return;
    if(await displayFile(fileName,preview?.kind==='word' ? preview.text : preview?.kind==='image' ? '' : text,identity,true,sourcePath,preview)) {
      if(metadata?.etag)currentEtag=metadata.etag;fileRefresh.setText(text,metadata?.etag);
      window.scrollTo({top:scroll});
      updateStatus('File refreshed. Annotations for the previous version remain in its saved draft.');
    }
  },
  onError:error=>updateStatus(`Cannot refresh file: ${error.message}. Retrying automatically.`)
});
function beginFileChange(){hideSelectionAction();wordViewer.destroy();clearTimeout(pdfPoll);pdfDocument=null;pdfViewer.destroy();clearTimeout(saveTimer);if(syncTimer!==null){clearTimeout(syncTimer);syncTimer=null;syncAnnotations().catch(()=>{});}fileRefresh.stop();++revision;}
const storageKey = () => `markdown-review:v1:${identity}:${documentHash}`;
const workingKey=()=>`markdown-review:working:${identity}:${diskHash}`;
async function hashText(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');}
const removedNotesKey='markatlas:removed-annotations:v1';
let removedNoteIds=new Set();
try{removedNoteIds=new Set(JSON.parse(localStorage.getItem(removedNotesKey) || '[]'));}catch{}
const batchKey='markatlas:review-batch:v1';
let batchEntries=new Map(),batchSending=false,composerUnavailable=false;
try{batchEntries=new Map(JSON.parse(localStorage.getItem(batchKey) || '[]').filter(([id])=>!removedNoteIds.has(id)));}catch{}
const queuePrefix='markatlas:review-project:v2:';
const normalizedRoot=root=>root?.replace(/[\\/]+$/,'') || '';
const entryRoot=entry=>normalizedRoot(entry.root || entry.item?.projectRoot || entry.item?.pdf?.root);
try{for(const key of Object.keys(localStorage).filter(key=>key.startsWith(queuePrefix)))for(const [id,entry] of JSON.parse(localStorage.getItem(key)||'[]'))if(!removedNoteIds.has(id))batchEntries.set(id,entry);}catch{}
function currentBatchEntries(){const root=normalizedRoot(fileName && !sourcePath ? null : project?.rootPath);return [...batchEntries.values()].filter(entry=>entryRoot(entry)===root);}
function saveBatchQueue(){try{
  // Migrate the legacy queue once without discarding any project's notes.
  if(localStorage.getItem(batchKey)!==null){
    const groups=new Map();for(const pair of batchEntries){const key=queuePrefix+encodeURIComponent(entryRoot(pair[1]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(pair);}
    for(const [key,entries] of groups)localStorage.setItem(key,JSON.stringify(entries));
    localStorage.removeItem(batchKey);
  }
  const root=normalizedRoot(fileName && !sourcePath ? null : project?.rootPath);
  localStorage.setItem(queuePrefix+encodeURIComponent(root),JSON.stringify([...batchEntries].filter(([,entry])=>entryRoot(entry)===root)));
}catch{updateStatus('Review queue is kept for this session only.');}}

function updateBatchDraft(){
  if(!identity || (filePreview && filePreview.kind!=='word'))return;
  const invalid=items.filter(item=>item.anchorStatus==='deleted' || ((item.pdf?.region || item.html?.region) && item.anchorStatus==='edited'));
  if(invalid.length)pruneReviewNotes(invalid.map(item=>item.id));
  const rootPrefix=project?.rootPath?.replace(/[\\/]+$/,'');
  const currentPath=sourcePath && rootPrefix && sourcePath.startsWith(rootPrefix+'/') ? sourcePath.slice(rootPrefix.length+1) : (!sourcePath && identity.startsWith('project:')?fileName:null);
  const ids=new Set(items.map(item=>item.id));
  for(const [id,entry] of batchEntries)if(entry.identity===identity && !ids.has(id))batchEntries.delete(id);
  for(const item of items){
    if(item.kind!=='comment' || item.batchSentVersion){batchEntries.delete(item.id);continue;}
    batchEntries.set(item.id,{identity,root:item.pdf?.root || (sourcePath && currentPath?project?.rootPath:null) || null,path:item.pdf?.path || currentPath || null,etag:currentEtag,item:{...item},storage:storageKey(),working:workingKey()});
  }
  saveBatchQueue();renderBatch();
}
function renderBatch(){
  const entries=currentBatchEntries();$('review-batch').hidden=!document.body.classList.contains('comments-open') && (!commenting || !entries.length);$('comments-empty').hidden=!!entries.length;
  const fileCount=new Set(entries.map(entry=>JSON.stringify([entry.root || entry.item.pdf?.root || '',entry.path || entry.item.sourcePath || entry.item.sourceName]))).size;
  $('review-count').textContent=`${fileCount} ${fileCount===1?'File':'Files'}, ${entries.length} ${entries.length===1?'Annotation':'Annotations'}`;
  $('review-cancel-all').disabled=batchSending || !entries.length;
  $('review-send').disabled=batchSending || !entries.length;$('review-send').textContent=batchSending?'Sending…':'Send';
  $('review-send-new').hidden=!composerUnavailable;
  $('review-send-new').disabled=batchSending || !entries.length;
  const list=$('review-list');list.replaceChildren();
  for(const entry of entries){
    const row=document.createElement('div');row.className='review-row';row.dataset.noteId=entry.item.id;row.classList.toggle('active',editingId===entry.item.id);
    const location=document.createElement('p');location.className='review-location';location.textContent=`${entry.path || entry.item.sourceName} · ${entry.item.pdf?`Page ${entry.item.pdf.page}`:`Lines ${entry.item.startLine}–${entry.item.endLine}`}`;
    const quote=document.createElement('p');quote.className='review-excerpt';quote.textContent=entry.item.selectedText;
    const comment=document.createElement('p');comment.textContent=entry.item.message;
    const remove=document.createElement('button');remove.className='review-remove';remove.innerHTML='<svg width=14 height=14 viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.6 aria-hidden=true><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';remove.setAttribute('aria-label','Delete comment');remove.disabled=batchSending;
    remove.addEventListener('click',event=>{event.stopPropagation();removeReviewNotes([entry.item.id]);});
    row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`Go to annotation in ${entry.path || entry.item.sourceName}`);
    const locate=async()=>{if(entry.identity!==identity){if(entry.root!==project?.rootPath){const tree=await serverData('list_markdown_project',{folderPath:entry.root});if(!await acceptWorkspace(tree,{allowDefault:false}))return;connectedFolder=tree.rootPath;}await openProjectFile(entry.path);}if(entry.identity===identity){$('review-batch').classList.add('preview-dismissed');open(items.find(n=>n.id===entry.item.id)||entry.item,items.find(n=>n.id===entry.item.id)||entry.item);}};
    row.addEventListener('click',event=>{event.stopPropagation();locate().catch(error=>{$('review-error').textContent=error.message;});});row.addEventListener('keydown',event=>{if(event.target===row && ['Enter',' '].includes(event.key)){event.preventDefault();row.click();}});
    row.append(location,quote,comment,remove);
    if(entry.item.pdf?.screenshot || entry.item.html?.screenshot){const image=document.createElement('img');image.src=entry.item.pdf?.screenshot || entry.item.html.screenshot;image.alt='Screenshot for this comment';row.append(image);}
    list.append(row);
  }
}
function pruneReviewNotes(ids){
  for(const id of ids){removedNoteIds.add(id);batchEntries.delete(id);}
  try{
    // Purge every cached version, not only the last draft key of an open file.
    for(const key of Object.keys(localStorage)){
      const working=key.startsWith('markdown-review:working:');
      if(!working && !key.startsWith('markdown-review:v1:'))continue;
      try{const data=JSON.parse(localStorage.getItem(key));const notes=working?data?.items:data;if(!Array.isArray(notes))continue;
        const retained=notes.filter(note=>!removedNoteIds.has(note.id) && !note.batchSentVersion);
        if(retained.length!==notes.length)localStorage.setItem(key,JSON.stringify(working?{...data,items:retained}:retained));
      }catch{}
    }
    localStorage.setItem(removedNotesKey,JSON.stringify([...removedNoteIds]));
  }catch{updateStatus('Annotation removal is kept for this session only.');}
  items=items.filter(note=>!removedNoteIds.has(note.id) && !note.batchSentVersion);
  saveBatchQueue();
}
function removeReviewNotes(ids){pruneReviewNotes(ids);persist();syncAnnotations().catch(()=>{});close(true);}
$('review-cancel-all').addEventListener('click',()=>{
  if(batchSending)return;
  removeReviewNotes(currentBatchEntries().map(entry=>entry.item.id));
  $('review-count').setAttribute('aria-expanded','false');$('review-batch').classList.remove('expanded');$('review-error').textContent='';renderBatch();
});
$('review-count').addEventListener('click',()=>{const open=$('review-count').getAttribute('aria-expanded')!=='true';$('review-count').setAttribute('aria-expanded',String(open));$('review-batch').classList.toggle('expanded',open);$('review-batch').classList.toggle('preview-dismissed',!open);});
$('review-batch').addEventListener('pointerleave',()=>$('review-batch').classList.remove('preview-dismissed'));
async function sendQueuedReview(target='active'){
  if(batchSending)return;
  batchSending=true;$('review-error').textContent='';renderBatch();
  const main=document.querySelector('main'),header=document.querySelector('header');main.inert=true;header.inert=true;$('project-drawer').inert=true;$('composer').inert=true;
  try{
    await saveCode();if(hashWork)await hashWork;
    if(!pdfDocument && !filePreview && project?.rootPath && source!==diskSource)throw Error('Finish saving the current file before sending.');
    await syncAnnotations();updateBatchDraft();
    const entries=currentBatchEntries();
    if(!entries.length){updateStatus('No comments remain to send.');return;}
    const result=await serverData('prepare_review_batch',{entries:entries.map(entry=>({...entry,item:{...entry.item,html:entry.item.html?{...entry.item.html,screenshot:undefined}:undefined,pdf:entry.item.pdf?{...entry.item.pdf,screenshot:undefined}:undefined}}))});
    const prepared=result.entries.map(entry=>({...entry,item:{...entry.item,html:entry.item.html?{...entry.item.html,screenshot:batchEntries.get(entry.item.id)?.item.html?.screenshot}:undefined,pdf:entry.item.pdf?{...entry.item.pdf,screenshot:batchEntries.get(entry.item.id)?.item.pdf?.screenshot}:undefined}}));
    const validIds=new Set(prepared.map(entry=>entry.item.id));
    const obsolete=entries.filter(entry=>!validIds.has(entry.item.id));
    if(obsolete.length)removeReviewNotes(obsolete.map(entry=>entry.item.id));
    if(!prepared.length){updateStatus('Obsolete comments removed. No comments remain to send.');return;}
    await sendReviewBatch(extensions,prepared,target,project?.rootPath);
    composerUnavailable=false;
    removeReviewNotes(entries.map(entry=>entry.item.id));updateStatus(target==='new'?'Review sent with separate attachments to a new chat.':'Review sent with separate attachments to the current conversation.');
  }catch(error){composerUnavailable=error.code==='COMPOSER_UNAVAILABLE';$('review-error').textContent=error.message;}
  finally{batchSending=false;main.inert=false;header.inert=false;$('project-drawer').inert=false;$('composer').inert=false;renderBatch();}
}
$('review-send').addEventListener('click',()=>sendQueuedReview());
$('review-send-new').addEventListener('click',()=>sendQueuedReview('new'));
renderBatch();
const recoveryKey=()=>`markatlas:unsaved:${identity}`;
let saveConflict=false,conflictBase=null;
function persist() {
  if(filePreview && filePreview.kind!=='word')return true;
  updateBatchDraft();
  try {if(source!==diskSource)localStorage.setItem(recoveryKey(),JSON.stringify({text:source,base:saveConflict ? conflictBase ?? diskSource : diskSource,items}));else localStorage.removeItem(recoveryKey());localStorage.setItem(storageKey(),JSON.stringify(items));localStorage.setItem(workingKey(),JSON.stringify({text:source,items}));return true;}
  catch {return false;}
}
function syncAnnotations(checkpointAnnotationId){
  if(!identity || (filePreview && filePreview.kind!=='word'))return Promise.resolve();
  const data={identity,...(checkpointAnnotationId?{checkpointAnnotationId}:{}),sourceName:fileName,...(sourcePath?{sourcePath}:{}),text:source,baseText:diskSource,annotations:items.map(item=>({...item,...(item.html?{html:{...item.html,screenshot:undefined}}:{}),...(item.pdf?{pdf:{...item.pdf,screenshot:undefined}}:{}),sourceText:undefined,selectedText:undefined,originalSnapshot:item.originalSnapshot ? {...item.originalSnapshot,selectedText:Array.from(item.originalSnapshot.selectedText || '').slice(0,180).join('')} : undefined}))};
  syncQueue=syncQueue.catch(()=>{}).then(()=>serverData('update_review_document',data));return syncQueue;
}
function applyWorkingText(text,changes,record=true,caret){
  hideSelectionAction();window.CSS?.highlights?.delete("markatlas-selection");
  if(filePreview)return;
  if(text===source)return;
  if(record)editHistory.record(source,text,caret ?? (codeFile || mode==='source' ? codeEditor.caret() : renderedCaret ?? 0));
  if(!$('composer').hidden){$('composer').hidden=true;editingId=null;selectionAnchor=null;document.body.classList.remove('composing');}

  const generation=revision;const before=source;items=moveAnnotations(items,before,text,changes);source=text;pending=null;persist();
  const work=hashText(text).then(hash=>{if(generation!==revision || source!==text)return;documentHash=hash;items=items.map(item=>({...item,documentHash:hash}));persist();}).finally(()=>{if(hashWork===work)hashWork=null;});hashWork=work;
  clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncAnnotations().catch(()=>{if(items.some(x=>x.liveReference)){$('code-error').hidden=false;$('code-error').textContent='Live annotation sync failed. Reopen this viewer before acting on old chat attachments.';}}),200);
  scheduleSave();updateEditorControls();
}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveCode(),500);}
const codeEditor=createCodeEditor($('document'),{
  onChange(text,changes,caret){applyWorkingText(text,changes,true,caret);return items;},
  onSelection(selection,anchor){if(commenting && !filePreview && codeMode!=='changes'){offerSelection(selection,anchor);}},
  onNote(item,anchor){open(item,item,anchor);},onSave:()=>saveCode()
});
function updateEditorControls(){
  const word=filePreview?.kind==='word',paged=!!pdfDocument || word;
  const textDocument=!!fileName && !pdfDocument && !filePreview;
  $('font-tools').hidden=!textDocument;$('document').classList.toggle('text-document',textDocument);
  $('pdf-tools').hidden=!paged;$('pdf-page-float').hidden=!paged;$('document').classList.toggle('pdf-document',!!pdfDocument);$('document').classList.toggle('word-document',word);
  $('pdf-zoom-level').setAttribute('aria-label',word?'Fit Word to width':'Fit PDF to width');
  $('pdf-page-float').setAttribute('aria-label',word?'Current Word page':'Current PDF page');
  if(word)updateDocumentZoom(wordViewer.zoom());
  $('pdf-screenshot').hidden=!pdfDocument && !isHtmlPreview();
  $('pdf-screenshot').title=isHtmlPreview()?'Select HTML region':'Screenshot comment';
  $('pdf-screenshot').setAttribute('aria-label',isHtmlPreview()?'Select HTML region':'Screenshot comment');
  $('mode-cycle').hidden=!fileName || !!filePreview || (!!pdfDocument && !pdfDocument.main);
  const modeLabel=isMarkdown(fileName)?(mode==='source'?'Source':codeMode==='edit'?'Edit':'Preview'):/\.html?$/i.test(fileName)?(mode==='source'?'Source':'Preview'):'Source';
  toolbarIcon('mode-cycle',modeLabel,modeLabel.toLowerCase());
  $('mode-cycle').disabled=!isMarkdown(fileName) && !/\.html?$/i.test(fileName) && !pdfDocument;
  $('code-edit').hidden=!fileName || !!pdfDocument || !!filePreview;
  $('code-edit').textContent='Edit';
  $('code-edit').setAttribute('aria-pressed',String(codeMode==='edit'));
  $('code-edit').setAttribute('aria-label','Edit');

  $('view-toggle').hidden=!!filePreview || (!!pdfDocument && !pdfDocument.main) || (codeFile && !pdfDocument && !(isLatex(fileName) && linkedPdf?.root===project?.rootPath));$('diff-labels').hidden=codeMode!=='changes';
  $('comment').disabled=!fileName || !!(filePreview && filePreview.kind!=='word') || codeMode==='changes';
}
function markdownOptions(currentPath){
  const selected=project;
  function paths(nodes){return nodes.flatMap(n=>n.type==='directory'?paths(n.children):[n.path]);}
  const names=selected?paths(selected.root.children):[];
  return {
    searchTag:tag=>fileSearch.open(tag),
    toggleTask(offset,state,expected){if(source[offset]!==expected)return;preserveViewport(()=>{applyWorkingText(source.slice(0,offset)+state+source.slice(offset+1),ChangeSet.of({from:offset,to:offset+1,insert:state},source.length),true,offset);render();});},
    async openLink(target){try{const {path,fragment}=resolveObsidianPath(target,currentPath,names);await openProjectFile(path);if(fragment)[...$('document').querySelectorAll('[id]')].find(n=>n.id===fragment.replace(/^\^/,''))?.scrollIntoView();}catch(error){$('status').textContent=error.message;}},
    async resolveEmbed(target){
      if(!selected?.rootPath)return null;
      const {path,fragment}=resolveObsidianPath(target,currentPath,names);
      const snapshot=await serverData('read_markdown_project_file',{root:selected.rootPath,path});
      if(snapshot.kind==='text'){
        if(!isMarkdown(path))return {kind:'text',text:'```\n'+snapshot.text+'\n```'};
        return {...snapshot,text:embeddedSection(snapshot.text,fragment),...markdownOptions(path)};
      }
      return snapshot;
    }
  };
}
let htmlFrameState=null;
function isHtmlPreview(){return /\.html?$/i.test(fileName) && mode==='rendered' && codeMode!=='edit' && !filePreview;}
function frameNotes(){
  htmlFrameState?.frame.contentWindow?.postMessage({markatlas:htmlFrameState.channel,type:'notes',notes:items.map(n=>({id:n.id,startOffset:n.startOffset,endOffset:n.endOffset,selectedText:n.selectedText,html:n.html?{...n.html,screenshot:undefined}:undefined})),active:editingId,enabled:commenting},'*');
}
function renderHtmlPreview(){
  if(htmlFrameState?.source===source && htmlFrameState.identity===identity && htmlFrameState.frame.isConnected){frameNotes();return;}
  codeEditor.destroy();mapping=null;$('document').contentEditable='false';$('document').classList.remove('markdown-rendered');
  const frame=document.createElement('iframe');frame.id='html-frame';frame.title='HTML web preview';
  // Untrusted file scripts run in an opaque origin, without access to plugin APIs or storage.
  frame.setAttribute('sandbox','allow-scripts');
  const state={frame,channel:crypto.randomUUID(),source,identity,baseURL:null};htmlFrameState=state;
  $('document').replaceChildren(frame);
  const load=async()=>{
    if(project?.rootPath && sourcePath){
      try{const result=await serverData('open_html_web_preview',{root:project.rootPath,path:fileName,launchBrowser:false});state.baseURL=result.url;}catch(error){$('status').textContent=`HTML opened without relative assets: ${error.message}`;}
    }
    if(htmlFrameState===state)frame.srcdoc=htmlPreviewDocument(state.source,state.baseURL,state.channel);
  };load();
}
window.addEventListener('message',event=>{
  const state=htmlFrameState,data=event.data;
  if(!state || event.source!==state.frame.contentWindow || data?.markatlas!==state.channel || !isHtmlPreview())return;
  if(data.type==='ready'){frameNotes();return;}
  if(data.type==='dismiss'){close();return;}
  if(data.type==='region-mode'){$('pdf-screenshot').setAttribute('aria-pressed',String(!!data.active));return;}
  if(data.type==='error'){$('code-error').hidden=false;$('code-error').textContent=String(data.message).slice(0,500);return;}
  if(data.type==='selection'){
    if(!commenting || !Number.isInteger(data.startOffset)||!Number.isInteger(data.endOffset)||data.startOffset<0||data.endOffset>source.length||data.endOffset<=data.startOffset||typeof data.selectedText!=='string')return;
    const box=state.frame.getBoundingClientRect(),rect=data.rect||{};
    const anchor={left:box.left+(Number(rect.left)||0),right:box.left+(Number(rect.right)||0),top:box.top+(Number(rect.top)||0),bottom:box.top+(Number(rect.bottom)||0)};
    if(data.html?.screenshot && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.html.screenshot) || data.html.screenshot.length>8*1024*1024))return;
    if(data.html?.region && !['x','y','width','height'].every(k=>Number.isFinite(data.html.region[k]) && data.html.region[k]>=0))return;
    open({html:data.html,startOffset:data.startOffset,endOffset:data.endOffset,selectedText:data.selectedText,startLine:source.slice(0,data.startOffset).split('\n').length,endLine:source.slice(0,data.endOffset).split('\n').length,mappingStatus:'source-span'},null,anchor);
  }
  if(data.type==='note'){const note=items.find(n=>n.id===data.id);if(note)open(note,note);}
  if(data.type==='link'){
    try{const base=new URL(state.baseURL),url=new URL(data.url),prefix=base.pathname.split('/').slice(0,2).join('/')+'/';
      if(url.origin===base.origin && url.pathname.startsWith(prefix))openProjectFile(decodeURIComponent(url.pathname.slice(prefix.length)));
      else $('status').textContent='External link: open it separately to keep this review available.';
    }catch{}
  }
});
function render() {
  const active=items.filter(item=>item.anchorStatus!=='deleted' && (item.pdf?.region || item.endOffset>item.startOffset));
  const visible = pending ? [...active,{...pending,id:'pending-selection',temporary:true}] : active;
  updateEditorControls();
  if(isHtmlPreview()){renderHtmlPreview();return;}
  htmlFrameState=null;
  if(!fileName){
    codeEditor.destroy();mapping=null;$('document').contentEditable='false';
    const prompt=document.createElement('p');prompt.className='empty';prompt.textContent='Open a file to read, understand, comment, and edit with AI assistant';
    $('document').replaceChildren(prompt);setProjectOpen(true);return;
  }
  if(filePreview?.kind==='word'){
    if($('document').querySelector('.cm-editor'))codeEditor.destroy();mapping=null;$('document').contentEditable='false';
    wordViewer.show(filePreview,visible);return;
  }
  if(filePreview?.kind==='image'){
    codeEditor.destroy();mapping=null;$('document').contentEditable='false';
    const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');
    figure.className='image-preview';image.src=filePreview.url;image.alt=fileName;image.draggable=false;caption.textContent=fileName;
    image.addEventListener('error',()=>{caption.textContent=`Cannot display ${fileName}. The image may be damaged or its format unavailable in this browser.`;});
    figure.append(image,caption);$('document').append(figure);return;
  }
  if(pdfDocument){if($('document').querySelector('.cm-editor'))codeEditor.destroy();mapping=null;$('document').contentEditable='false';$('view-toggle').textContent='View source';pdfViewer.show(pdfDocument,visible);return;}
  const editorMode=codeFile || mode==='source' || codeMode==='changes';
  if($('document').contentEditable!=='false')$('document').contentEditable='false';
  if(editorMode){mapping=null;codeEditor.show({name:fileName,text:source,original:diskSource,mode:codeMode,items:visible});$('view-toggle').textContent=isLatex(fileName) && linkedPdf?.root===project?.rootPath?'View PDF':mode==='source'?'Preview':'View source';return;}
  codeEditor.destroy();
  mapping = renderMarkdown($('document'),source,mode,visible,markdownOptions(fileName));
  $('document').contentEditable=codeMode==='edit'?'true':'false';
  if(codeMode==='edit' && (!source || /\n\n$/.test(source)))mapping.appendCaret(source.length);
  $('view-toggle').textContent = mode === 'source' ? 'Preview' : 'View source';
  fileSearch?.refresh();
}
async function canLeaveFile(){
  if(displayWork)await displayWork;
  await saveCode();
  return !project?.rootPath || !activeProjectPath || source===diskSource || persist();
}
async function saveCode(){
  clearTimeout(saveTimer);
  if(displayWork || saveConflict)return;
  if(saveWork)return saveWork;
  if(pdfDocument || filePreview || source===diskSource || !project?.rootPath || !activeProjectPath || !currentEtag)return;
  const generation=revision,projectRoot=project.rootPath,path=activeProjectPath;
  saving=true;$('reload-disk').hidden=true;$('code-error').hidden=true;
  saveWork=(async()=>{
    try {
      // Serialize writes and include edits made while a previous write was in flight.
      while(generation===revision && source!==diskSource){
        const text=source,expectedEtag=currentEtag;
        let snapshot;
        try{snapshot=await serverData('save_review_project_file',{root:projectRoot,path,text,expectedEtag});}
        catch(error){
          const latest=await serverData('read_markdown_project_file',{root:projectRoot,path});
          if(generation!==revision)return;
          if(!latest.readOnly && normalize(latest.text)===text)snapshot=latest;
          else if(!latest.readOnly && normalize(latest.text)===diskSource)snapshot=await serverData('save_review_project_file',{root:projectRoot,path,text,expectedEtag:latest.etag});
          else {saveConflict=true;conflictBase=diskSource;throw error;}
        }
        if(generation!==revision)return;
        const savedText=normalize(snapshot.text),savedHash=await hashText(savedText);
        if(generation!==revision)return;
        saveConflict=false;conflictBase=null;currentEtag=snapshot.etag;diskSource=savedText;diskHash=savedHash;
        persist();syncAnnotations().catch(()=>{});fileRefresh.setText(diskSource,snapshot.etag);
      }
    } catch(error){if(generation===revision){$('code-error').textContent=`Autosave failed: ${error.message} Your draft is kept locally; you can switch files and return to it. Use Reload from disk to discard this draft, or copy your edits before resolving the disk change.`;$('code-error').hidden=false;$('reload-disk').hidden=false;}}
    finally{saving=false;saveWork=null;updateEditorControls();}
  })();
  return saveWork;
}
function focusEditingDocument(){if(pdfDocument || codeMode!=='edit')return;if(codeFile || mode==='source')codeEditor.focus();else{$('document').focus({preventScroll:true});if(renderedCaret!==null)mapping?.focusAt(renderedCaret);}}
function preserveViewport(action){
  const x=window.scrollX,y=window.scrollY,scrollers=[...document.querySelectorAll('main,#document,.cm-scroller')].map(el=>({el,x:el.scrollLeft,y:el.scrollTop}));
  action();const restore=()=>{for(const p of scrollers)if(p.el.isConnected){p.el.scrollLeft=p.x;p.el.scrollTop=p.y;}window.scrollTo(x,y);};restore();requestAnimationFrame(restore);
}
function viewportCaret(){
  if(codeFile||mode==='source')return codeEditor.caret();
  const walker=document.createTreeWalker($('document'),4);let node,best=null,distance=Infinity;
  while(node=walker.nextNode()){const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();if(!rect.height||rect.bottom<70||rect.top>window.innerHeight)continue;const span=mapping?.resolve(range);if(!span)continue;const d=Math.abs((rect.top+rect.bottom)/2-window.innerHeight/2);if(d<distance){best=span.startOffset;distance=d;}}
  return best??renderedCaret;
}
$('code-edit').addEventListener('click',()=>{const caret=viewportCaret(),editorState=codeEditor.capture();preserveViewport(()=>{editHistory.boundary();close(false);codeMode=codeMode==='edit'?'review':'edit';renderedCaret=caret;if(codeFile||mode==='source'){render();}else{$('document').contentEditable=codeMode==='edit'?'true':'false';updateEditorControls();}if(editorState)codeEditor.restore(editorState);});});
const fileSearch=createFileSearch({document,container:$('document'),panel:$('file-search'),input:$('file-search-query'),count:$('file-search-count'),previous:$('file-search-prev'),next:$('file-search-next'),close:$('file-search-close'),getSource:()=>source,sourceMode:()=>codeFile||mode==='source',selectSource:(from,to)=>codeEditor.findSpan(from,to)});
$('reload-disk').addEventListener('click',async()=>{if(!window.confirm('Discard this local draft and reload the disk version?'))return;const snapshot=await serverData('read_markdown_project_file',{root:project.rootPath,path:activeProjectPath});localStorage.removeItem(recoveryKey());localStorage.removeItem(workingKey());await displaySnapshot(activeProjectPath,snapshot,identity,sourcePath);currentEtag=snapshot.etag;fileRefresh.setText(diskSource,currentEtag);});
$('file-find').addEventListener('click',()=>{$('file-search').hidden?fileSearch.open():fileSearch.hide();});

window.addEventListener('beforeunload',e=>{if(project?.rootPath && activeProjectPath && source!==diskSource){e.preventDefault();e.returnValue='';}});
function close(renderDocument=false) {
  hideSelectionAction();window.CSS?.highlights?.delete("markatlas-selection");
  stopReply();
  $('composer').hidden = true; pending = null; editingId = null;
  // Repaint only persisted HTML notes; discard the temporary selected range.
  frameNotes();
  selectionAnchor = null;document.body.classList.remove('composing');if(renderDocument)render();
  queueMicrotask(()=>fileRefresh.check());
}
function setDetail(value) {
  detail = value;
  for (const length of ['short','medium','long']) $(`detail-${length}`).setAttribute('aria-checked',String(length === detail));
}
function sameSelection(a,b){
  return a && b && a.startOffset===b.startOffset && a.endOffset===b.endOffset && a.selectedText===b.selectedText
    && a.pdf?.page===b.pdf?.page && JSON.stringify(a.pdf?.region)===JSON.stringify(b.pdf?.region) && JSON.stringify(a.html?.region)===JSON.stringify(b.html?.region);
}
function setKind(value,selectNote=true) {
  if(selectNote && value!==kind){
    if(kind==='comment')commentDraft=$('message').value;
    const counterpart=items.find(item=>item.kind===value && sameSelection(item,pending));
    editingId=counterpart?.id || null;
    if(value==='comment')$('message').value=counterpart?.message ?? commentDraft;
    $('delete').hidden=!counterpart;
  }
  if(value === 'explanation')setDetail(null);
  kind = value;
  $('kind-comment').setAttribute('aria-pressed',String(kind === 'comment'));
  $('kind-explanation').setAttribute('aria-pressed',String(kind === 'explanation'));
  $('comment-input').hidden = kind !== 'comment';
  $('explanation-options').hidden = kind !== 'explanation';
  showExplanation(items.find(item=>item.id===editingId));
  positionComposer();
}
function open(selection,item = null,anchor = null) {
  if(filePreview && filePreview.kind!=='word')return;
  editHistory.boundary();
  const draft=sameSelection(pending,selection)?commentDraft:'';
  selectionAnchor = anchor;
  pending = Object.fromEntries(['startOffset','endOffset','startLine','endLine','selectedText','mappingStatus','pdf','word','html'].map(key => [key,selection[key]]));
  editingId = item?.id || null;
  const shot=selection.pdf?.screenshot || selection.html?.screenshot;
  $('screenshot-preview').hidden=!shot;
  if(shot)$('screenshot-preview').src=shot;else $('screenshot-preview').removeAttribute('src');
  $('quote').textContent = selection.selectedText;
  $('location').textContent = selection.word?`${fileName} · Word selection`:selection.pdf?`${fileName} · PDF page ${selection.pdf.page}`:`${fileName} · lines ${selection.startLine}–${selection.endLine}`;
  $('mapping').hidden = selection.mappingStatus !== 'source-span';
  commentDraft=item?.kind==='comment'?item.message || '':draft;
  $('message').value = commentDraft;
  $('explanation-prompt').value=item?.explanationPrompt || '';
  $('feedback').textContent = '';
  $('delete').hidden = !item;
  setDetail(null); setKind(item?.kind || 'comment',false);
  $('composer').hidden = false;document.body.classList.add('composing');
  hideSelectionAction();
  const keepSelection=codeMode==='edit' && !item && !pdfDocument;
  for(const mark of $('document').querySelectorAll('[data-annotation]'))mark.classList.toggle('annotation-active',mark.dataset.annotation===item?.id);
  if(item){for(const row of $('review-list').querySelectorAll('.review-row'))row.classList.toggle('active',row.dataset.noteId===item.id);if(document.body.classList.contains('comments-open'))$('review-list').querySelector('.active')?.scrollIntoView?.({block:'nearest'});}
  if(isHtmlPreview() && item){frameNotes();htmlFrameState?.frame.contentWindow?.postMessage({markatlas:htmlFrameState.channel,type:'locate',note:item},'*');}
  if(mapping && item)mapping.selectSpan(pending.startOffset,pending.endOffset,true);else if(item && !pdfDocument && !filePreview && !isHtmlPreview())codeEditor.findSpan(pending.startOffset,pending.endOffset);resizeMessage();positionComposer();
  const nativeSelection=window.getSelection();if(window.Highlight && window.CSS?.highlights && nativeSelection?.rangeCount && $('document').contains(nativeSelection.anchorNode))window.CSS.highlights.set('markatlas-selection',new Highlight(nativeSelection.getRangeAt(0).cloneRange()));
  if(keepSelection && !item)return;
  if (kind === 'comment') $('message').focus({preventScroll:true}); else $('kind-explanation').focus({preventScroll:true});
}
function updateStatus(extra = '') {
  $('status').textContent = `${fileName} · ${items.length} saved · ${extra || (commenting ? 'Select text to annotate.' : 'Enable Request edits to annotate selections.')}`;
}
async function displayFile(...args){
  const work=displayFileContent(...args);displayWork=work;
  try{return await work;}finally{if(displayWork===work)displayWork=null;}
}
async function displayFileContent(name,text,fileIdentity = name,keepWatch = false,fileSourcePath = null,preview = null) {
  if(!keepWatch)fileRefresh.stop();
  const current = ++revision,previousText=source,previousItems=items;
  close();if(filePreview?.kind==='word' && preview?.kind!=='word')wordViewer.destroy();filePreview=preview;source = '';items = [];documentHash = '';$('comment').disabled = true;
  $('status').textContent = `Opening ${name}…`;
  const normalized = normalize(text);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  if (current !== revision) return false;
  source = normalized;diskSource=normalized;diskHash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');codeFile=!!preview || !isMarkdown(name);if(!keepWatch){const previewable=isMarkdown(name)||/\.html?$/i.test(name)||preview;codeMode=previewable?'review':'edit';mode=previewable?'rendered':'source';}editHistory.clear();renderedCaret=null;fileName = name;identity = fileIdentity;
  $('code-error').hidden=true;$('reload-disk').hidden=true;saveConflict=false;
  if(!keepWatch)sourcePath=fileSourcePath;
  documentHash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
  if(!preview || preview.kind==='word')try {
    const recovery=!keepWatch && JSON.parse(localStorage.getItem(recoveryKey()) || 'null');
    const working=recovery || (!keepWatch && JSON.parse(localStorage.getItem(workingKey()) || 'null'));
    if(recovery && recovery.base!==diskSource && recovery.text!==diskSource){saveConflict=true;conflictBase=recovery.base;}
    if(working && typeof working.text==='string' && Array.isArray(working.items)){
      const restoredHash=await hashText(working.text);if(current!==revision)return false;source=working.text;documentHash=restoredHash;items=working.items;
    } else if(keepWatch)items=moveAnnotations(previousItems,previousText,source);
    else items=JSON.parse(localStorage.getItem(storageKey()) || '[]');
    if(!Array.isArray(items))items=[];
    items=items.filter(x=>!removedNoteIds.has(x.id) && !x.batchSentVersion && typeof x.id==='string' && ['comment','explanation'].includes(x.kind) && Number.isInteger(x.startOffset) && Number.isInteger(x.endOffset) && x.startOffset>=0 && (x.pdf?.region || x.endOffset<=source.length) && x.startOffset<=x.endOffset);
    items=items.map(item=>({...item,documentHash}));
  } catch {items=[];}
  hashWork=null;updateBatchDraft();syncAnnotations().catch(()=>{});
  renderBreadcrumb();render();updateStatus(preview?.kind==='word' ? 'Word preview (read-only).' : preview?.kind==='image' ? 'Image preview.' : preview?.readOnly ? 'Read-only text preview. This file contains binary data or a non-UTF-8 encoding.' : '');
  if(saveConflict){$('reload-disk').hidden=false;$('code-error').textContent='Recovered your unsaved draft. The disk file has different content; automatic saving is paused. Copy your edits or use Reload from disk to discard the draft.';$('code-error').hidden=false;}
  if(preview?.readOnly){$('code-error').textContent='Read-only text preview: binary data or an unsupported text encoding. Some characters may be unreadable.';$('code-error').hidden=false;}
  return true;
}
async function displaySnapshot(name,snapshot,fileIdentity=name,fileSourcePath=null){
  const generation=incomingRevision;
  if(snapshot.kind==='word'){
    $('code-error').textContent='Rendering Word document…';$('code-error').hidden=false;
    snapshot={...snapshot,...await renderWordPreview(snapshot.data)};
    if(generation!==incomingRevision)return false;
  }
  return displayFile(name,snapshot.text || '',fileIdentity,false,fileSourcePath,['image','word'].includes(snapshot.kind) || snapshot.readOnly ? snapshot : null);
}
async function localSnapshot(file){
  if(file.size>fileLimit(file.name))throw Error('File exceeds the preview size limit.');
  return fileContent(file.name,new Uint8Array(await file.arrayBuffer()));
}
$('comment').addEventListener('click',() => {
  commenting = !commenting;
  $('comment').setAttribute('aria-pressed',String(commenting));
  if (!commenting) close();renderBatch();frameNotes();updateStatus();
});
let compositionAnchor=null;
function renderedSpan(range){
  if(!mapping)return null;
  const selected=window.getSelection();
  const actual=range || (selected?.rangeCount ? selected.getRangeAt(0) : null);
  if(!actual || !$('document').contains(actual.startContainer) || !$('document').contains(actual.endContainer))return null;
  const span=mapping.resolve(actual);
  if(actual.collapsed && renderedCaret!==null && span)span.startOffset=span.endOffset=renderedCaret;
  return span;
}
function renderedReplace(span,text,record=true){
  if(!span || span.mappingStatus!=='exact'){$('code-error').hidden=false;$('code-error').textContent='Edit this passage in source mode to preserve its Markdown formatting.';render();return;}
  const updated=source.slice(0,span.startOffset)+text+source.slice(span.endOffset);
  applyWorkingText(updated,ChangeSet.of({from:span.startOffset,to:span.endOffset,insert:text},source.length),record,span.startOffset);renderedCaret=span.startOffset+text.length;render();$('document').focus();mapping?.focusAt(renderedCaret);
}
$('document').addEventListener('pointerdown',()=>{renderedCaret=null;editHistory.boundary();});
function restoreHistory(redo=false){
  const previous=editHistory.restore(source,codeFile || mode==='source'?codeEditor.caret():renderedCaret ?? 0,redo);if(!previous)return;
  applyWorkingText(previous.text,undefined,false);renderedCaret=previous.caret;
  render();if(codeFile || mode==='source')codeEditor.focusAt(previous.caret);else{$('document').focus();mapping?.focusAt(previous.caret);}
}
$('document').addEventListener('keydown',e=>{
  if(/^(Arrow|Home|End|Page)/.test(e.key)){renderedCaret=null;editHistory.boundary();}
  if(pdfDocument || codeMode!=='edit' || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey))return;
  if(e.key.toLowerCase()==='z' || (!e.metaKey && e.key.toLowerCase()==='y')){
    e.preventDefault();e.stopPropagation();restoreHistory(e.shiftKey || e.key.toLowerCase()==='y');
  }
},{capture:true});
$('document').addEventListener('compositionstart',()=>{if(!pdfDocument && !codeFile && mode==='rendered' && codeMode==='edit')compositionAnchor=renderedSpan();});
$('document').addEventListener('compositionend',e=>{if(compositionAnchor){const span=compositionAnchor;compositionAnchor=null;if(!e.data){render();mapping?.focusAt(span.startOffset);return;}renderedReplace(span,e.data);}});
$('document').addEventListener('beforeinput',e=>{
  if(pdfDocument || codeFile || mode!=='rendered' || codeMode!=='edit')return;
  if(e.isComposing || compositionAnchor)return;
  e.preventDefault();
  if(['historyUndo','historyRedo'].includes(e.inputType)){
    restoreHistory(e.inputType==='historyRedo');return;
  }
  const targets=e.getTargetRanges?.();let span=renderedSpan(targets?.[0]);if(!span)return;
  let text=e.data || '';
  if(e.inputType==='insertParagraph' || e.inputType==='insertLineBreak')text=e.inputType==='insertLineBreak'?'\n':'\n\n';
  else if(e.inputType.startsWith('delete')){
    text='';
    if(span.startOffset===span.endOffset){if(e.inputType.includes('Backward'))span.startOffset-=Array.from(source.slice(0,span.startOffset)).at(-1)?.length || 0;else span.endOffset+=Array.from(source.slice(span.endOffset))[0]?.length || 0;}
  } else if(!['insertText','insertReplacementText'].includes(e.inputType)){$('code-error').hidden=false;$('code-error').textContent='Use source mode for this formatting change.';return;}
  renderedReplace(span,text);
});
$('document').addEventListener('paste',e=>{if(!pdfDocument && !codeFile && mode==='rendered' && codeMode==='edit'){e.preventDefault();renderedReplace(renderedSpan(),e.clipboardData.getData('text/plain'));}});
$('document').addEventListener('cut',e=>{if(!pdfDocument && !codeFile && mode==='rendered' && codeMode==='edit'){const selection=window.getSelection();e.preventDefault();e.clipboardData.setData('text/plain',selection?.toString() || '');renderedReplace(renderedSpan(),'');}});
$('document').addEventListener('drop',e=>{if(!pdfDocument && !codeFile && mode==='rendered' && codeMode==='edit')e.preventDefault();});
$('view-toggle').addEventListener('click',() => {if(pdfDocument){openPdfSource();return;}if(isLatex(fileName) && linkedPdf?.root===project?.rootPath){openProjectFile(linkedPdf.path);return;}editHistory.boundary();close();mode = mode === 'source' ? 'rendered' : 'source';render();focusEditingDocument();});
for (const value of ['comment','explanation']) $(`kind-${value}`).addEventListener('click',() => {
  setKind(value);if (value === 'comment') $('message').focus({preventScroll:true});else $('kind-explanation').focus({preventScroll:true});
});
for (const length of ['short','medium','long']) $(`detail-${length}`).addEventListener('click',() => {setDetail(length);});
$('explanation-prompt').addEventListener('keydown',event=>{
  if(event.key!=='Enter' || !(event.metaKey||event.ctrlKey) || event.isComposing || event.keyCode===229)return;
  event.preventDefault();event.stopPropagation();submitNote();
});
$('length-options').addEventListener('keydown',e => {
  const lengths = ['short','medium','long'];
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
  e.preventDefault();const step = ['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1;
  const focused=lengths.indexOf(e.target.id?.replace('detail-',''));
  const next=lengths[(Math.max(0,focused) + step + 3) % 3];$(`detail-${next}`).focus();
});

document.addEventListener('pointerdown',()=>{ignoreOutsideClick=false;});
document.addEventListener('click',e=>{
  if(!$('composer').hidden && !$('composer').contains(e.target) && !e.target.closest?.('.annotation-icon,[data-annotation],#selection-action') && !ignoreOutsideClick)close();
  ignoreOutsideClick=false;
});
document.addEventListener('keydown',e => {if (e.key === 'Escape' && !$('composer').hidden) close();});
function resizeMessage() {
  const field=$('message');field.style.height='auto';field.style.height=`${Math.max(36,Math.min(180,field.scrollHeight))}px`;positionComposer();
}
$('message').addEventListener('focus',()=>editHistory.boundary());
$('message').addEventListener('input',resizeMessage);
$('message').addEventListener('keydown',e => {
  if(e.key!=='Enter' || !(e.metaKey||e.ctrlKey) || e.isComposing || e.keyCode===229)return;
  e.preventDefault();submitNote();
});
let offeredSelection=null;
function canCommentShortcut(){return !!pdfDocument || filePreview?.kind==='word' || codeMode!=='edit' && mode!=='source' && (!codeFile || isHtmlPreview());}
function hideSelectionAction(){ $('selection-action').hidden=true;offeredSelection=null; }
function offerSelection(selection,anchor){
  if(!commenting)return;
  offeredSelection={selection,anchor,revision};
  const button=$('selection-action');button.hidden=false;button.querySelector('kbd').hidden=!canCommentShortcut();button.title=canCommentShortcut()?'Comment (C)':'Comment';
  const rect=anchor || {left:24,top:100};button.style.left=`${Math.max(8,Math.min(window.innerWidth-120,rect.left))}px`;button.style.top=`${Math.max(48,rect.top-38)}px`;
}
function acceptSelection(){const offered=offeredSelection;if(!offered || offered.revision!==revision)return;open(offered.selection,null,offered.anchor);$('message').focus({preventScroll:true});}
$('selection-action').addEventListener('pointerdown',event=>event.preventDefault());
$('selection-action').addEventListener('click',event=>{event.stopPropagation();acceptSelection();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){hideSelectionAction();return;}
  const editing=event.target.closest?.('input,textarea,select,[contenteditable=true],.cm-content');
  const shortcut=canCommentShortcut() && event.key.toLowerCase()==='c' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey;
  if(shortcut && offeredSelection && !event.isComposing){event.preventDefault();event.stopImmediatePropagation();acceptSelection();}
},true);
let selectionFrame=0;document.addEventListener('selectionchange',()=>{if(selectionFrame)return;selectionFrame=requestAnimationFrame(()=>{selectionFrame=0;const selection=window.getSelection();if(selection?.isCollapsed){if(!$('selection-action').matches(':hover'))hideSelectionAction();return;}if($('composer').hidden && selection?.anchorNode && $('document').contains(selection.anchorNode))capture({target:selection.anchorNode.parentElement,type:'selectionchange'});});});
window.addEventListener('scroll',hideSelectionAction,{passive:true});
$('comments-toggle').addEventListener('click',()=>{const opened=document.body.classList.toggle('comments-open');$('comments-toggle').setAttribute('aria-expanded',String(opened));renderBatch();positionDrawer();requestAnimationFrame(positionComposer);});
$('inline-mode').addEventListener('click',async()=>{try{const mode=app.getHostContext()?.displayMode==='inline'?'fullscreen':'inline';await app.requestDisplayMode({mode});}catch(error){$('project-status').hidden=false;$('project-status').textContent=`This host cannot change the display mode: ${error.message}`;}});

function capture(event) {
  if (pdfDocument || codeFile || mode==='source' || codeMode==='changes' || !commenting || !source || event.target.closest?.('.annotation-icon')) return;
  const selected = window.getSelection();
  if (!selected?.rangeCount || selected.isCollapsed) return;
  const range = selected.getRangeAt(0);
  if (!$('document').contains(range.startContainer) || !$('document').contains(range.endContainer)) return;
  const fragment = range.cloneContents();fragment.querySelectorAll('.annotation-icon').forEach(node => node.remove());
  const selection = mapping.selection(range,fragment.textContent);
  if(selection){const rects=range.getClientRects?.();const rect=rects?.length ? rects[rects.length-1] : range.getBoundingClientRect?.();offerSelection(selection,rect);}
}
$('document').addEventListener('pointerup',capture);$('document').addEventListener('keyup',capture);
$('document').addEventListener('click',e => {
  const icon = e.target.closest('[data-item-id],[data-annotation]');if(!icon || (!window.getSelection()?.isCollapsed && !icon.dataset.itemId))return;
  const item = items.find(x=>x.id === (icon.dataset.itemId || icon.dataset.annotation));if(item)open(item,item,icon.getBoundingClientRect());
});
async function submitNote() {
  editHistory.boundary();
  if(hashWork)await hashWork;if (!pending) return;
  if(kind==='explanation' && !['short','medium','long'].includes(detail)){$('feedback').textContent='Choose how much detail first.';return;}
  const message = kind === 'comment' ? $('message').value.trim() : '';
  if (kind === 'comment' && !message) {$('feedback').textContent = 'Write a comment first.';$('message').focus();return;}
  const selectedPending=pending,selectedRevision=revision,selectedKind=kind,selectedEditingId=editingId,selectedDetail=detail;
  if(kind==='explanation' && pending.pdf && !pending.pdf.region){try{pending.pdf.source=await serverData('locate_latex_pdf_selection',{root:pending.pdf.root,path:pending.pdf.path,selection:{...pending.pdf,startOffset:pending.startOffset,quote:pending.selectedText}});}catch(error){$('feedback').textContent=error.message;return;}}
  if(pending!==selectedPending || selectedRevision!==revision || kind!==selectedKind || editingId!==selectedEditingId || detail!==selectedDetail)return;
  const previous = items.find(x=>x.id === editingId && x.kind===kind);
  const item = {...pending,batchSentVersion:undefined,originalSnapshot:previous?.originalSnapshot || {...(pending.pdf?{pdf:{...pending.pdf,screenshot:undefined}}:{}),documentHash,startLine:pending.startLine,endLine:pending.endLine,startOffset:pending.startOffset,endOffset:pending.endOffset,selectedText:pending.selectedText},id:previous?.id || crypto.randomUUID(),kind,message,hasUnsavedEdits:source!==diskSource,...(kind === 'explanation' ? {detail,explanationPrompt:$('explanation-prompt').value.trim()} : {}),sourceName:fileName,...(sourcePath ? {sourcePath} : {}),...(sourcePath && project?.rootPath?{projectRoot:project.rootPath}:{}),documentHash,sourceText:source.slice(pending.startOffset,pending.endOffset),updatedAt:new Date().toISOString()};
  if(previous)items = items.map(x=>x.id === previous.id ? item : x);else items.push(item);
  if(kind==='explanation'){delete item.explanationRequestId;delete item.explanationAnswer;delete item.explanationError;item.explanationStatus='starting';}
  const saved = persist();const current = revision;
  if(kind==='explanation'){render();open(item,item,selectionAnchor);}else close(true);
  updateStatus(saved ? (kind === 'explanation' ? 'Generating explanation…' : 'Comment queued for review.') : 'Saved for this session only.');
  try {
    try{await syncAnnotations(item.id);item.liveReference=true;if(current===revision)persist();}catch{}
    if(item.kind === 'comment') {
      if(current===revision)updateStatus('Comment queued for review.');
    } else {
      await requestExplanation(app,extensions,item,undefined,(requestId,result)=>{
        if(current!==revision)return;
        const note=items.find(note=>note.id===item.id && note.updatedAt===item.updatedAt);
        if(!note)return;
        note.explanationRequestId=requestId;note.explanationModel=result?.model;note.explanationStatus=result?.status || 'pending';
        if(result?.answer)note.explanationAnswer=result.answer;persist();
        if(editingId===item.id && !$('composer').hidden)showExplanation(note);
      });
      if(current === revision)updateStatus('Explanation ready.');
    }
  } catch(error) {if(current === revision){
    if(item.kind==='explanation'){
      const note=items.find(note=>note.id===item.id && note.updatedAt===item.updatedAt);
      if(note){note.explanationError=error.message;note.explanationStatus='error';persist();if(editingId===item.id && !$('composer').hidden)showExplanation(note);}
    }
    updateStatus(error.message);
  }}
}
$('delete').addEventListener('click',async () => {
  const removed = items.find(x=>x.id === editingId);if(!removed)return;
  removeReviewNotes([removed.id]);updateStatus('Note deleted.');
  if(removed.explanationRequestId)serverData('remove_markdown_explanation',{requestId:removed.explanationRequestId}).catch(()=>{});
});
function base64Bytes(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
async function importSingleFile(name,bytes,resourceKey){return serverData('open_review_single_file',{name,data:base64Bytes(bytes),...(resourceKey?{resourceKey}:{})});}
async function resourceBytes(uri){
  if(!extensions.resources)throw Error('This host cannot read this file resource. Use Open file to select a local copy.');
  const resource=await extensions.resources.read({uri}),content=resource.contents?.[0];
  if(typeof content?.blob==='string')return Uint8Array.from(atob(content.blob),c=>c.charCodeAt(0));
  if(typeof content?.text==='string')return new TextEncoder().encode(content.text);
  throw Error('Unsupported file representation.');
}
async function openSingleWorkspace(tree,resourceUri){
  if(project?.rootPath && !project.singleFile && tree.sourcePath?.startsWith(project.rootPath.replace(/\/$/,'')+'/')){
    await openProjectFile(tree.sourcePath.slice(project.rootPath.replace(/\/$/,'').length+1));return true;
  }
  ++workspaceRequest;
  if(!await acceptWorkspace({...tree,...(resourceUri?{resourceUri}:{})},{allowDefault:false}))return;
  connectedFolder=tree.singleFile?null:tree.rootPath;await openProjectFile(tree.singlePath);return true;
}
// File entrypoints carry the original local path on the server tool call,
// even when their resource URI is opaque to the browser.
app.addEventListener('toolresult',async result=>{
  const tree=result.structuredContent;
  if(tree?.root && tree.singlePath){++incomingRevision;await openSingleWorkspace(tree);}
});
$('picker').addEventListener('change',async () => {
  const file=$('picker').files?.[0];if(!file || !(await canLeaveFile()))return;
  const request=++incomingRevision;
  try{
    if(file.size>(isPdf(file.name)?50*1024*1024:fileLimit(file.name)))throw Error('File exceeds the preview size limit.');
    const tree=await importSingleFile(file.name,new Uint8Array(await file.arrayBuffer()));
    if(request===incomingRevision)await openSingleWorkspace(tree);
  }catch(error){
    if(!isPdf(file.name) && /Unknown tool|not found|unsupported/i.test(error.message)){activeProjectPath=null;await displaySnapshot(file.name,await localSnapshot(file));renderProjectTree();}
    else showPdfError(error);
  }finally{$('picker').value='';}
});
app.addEventListener('toolinput',async ({arguments:args}) => {
  const input = OpenAIFileEntrypointInputSchema.safeParse(args);if(!input.success){loadWorkspace();return;}
  const inputGeneration=++incomingRevision;
  if(!(await canLeaveFile()) || inputGeneration!==incomingRevision)return;
  if(/\.(docx|xlsx)$/i.test(input.data.file.name) && extensions.files?.open){
    try{
      const uri=new URL(input.data.file.resourceUri);
      if(uri.protocol!=='file:' || (uri.hostname && uri.hostname!=='localhost'))throw Error('Open the folder containing this file, then select it in the file tree.');
      await extensions.files.open(decodeURIComponent(uri.pathname));
    }catch(error){$('project-status').hidden=false;$('project-status').textContent=error.message;}
    return;
  }
  const uri=input.data.file.resourceUri;
  if(isPdf(input.data.file.name)){
    const current=++incomingRevision;
    try{
      const local=new URL(uri);
      const tree=local.protocol==='file:' && (!local.hostname || local.hostname==='localhost')
        ? await serverData('open_review_single_file',{path:decodeURIComponent(local.pathname)})
        : await importSingleFile(input.data.file.name,await resourceBytes(uri),uri);
      if(current===incomingRevision)await openSingleWorkspace(tree,local.protocol==='file:'?null:uri);
    }catch(error){showPdfError(error);}
    return;
  }
  // Open local text files with their containing folder, just like local PDFs.
  try{
    const local=new URL(uri);
    if(local.protocol==='file:' && (!local.hostname || local.hostname==='localhost')){
      const tree=await serverData('open_review_single_file',{path:decodeURIComponent(local.pathname)});
      await openSingleWorkspace(tree);return;
    }
  }catch{/* Older hosts may expose only resource reads for text inputs. */}
  await loadWorkspace();beginFileChange();const current = ++incomingRevision;
  try {
    if(!extensions.resources)throw new Error('This host does not expose file resources. Use Open file.');
    const resource = await extensions.resources.read({uri:input.data.file.resourceUri});if(current !== incomingRevision)return;
    const content = resource.contents?.[0];
    const bytes=typeof content?.text==='string' ? new TextEncoder().encode(content.text) : typeof content?.blob==='string' ? Uint8Array.from(atob(content.blob),c=>c.charCodeAt(0)) : null;
    if(bytes === null)throw new Error('Unsupported file representation.');
    try{const tree=await importSingleFile(input.data.file.name,bytes,uri);if(current===incomingRevision)await openSingleWorkspace(tree,uri);return;}catch(error){if(!/Unknown tool|not found|unsupported|unavailable/i.test(error.message))throw error;}
    activeProjectPath=null;
    await displaySnapshot(input.data.file.name,fileContent(input.data.file.name,bytes),input.data.file.resourceUri);
    if(current!==incomingRevision)return;
    if(!filePreview)watchResource(input.data.file.resourceUri,source);renderProjectTree();
  } catch(error){if(current === incomingRevision){$('status').textContent = `Cannot open file: ${error.message}`;showPdfError(error);}}
});
const pdfViewer=createPdfViewer($('document'),{
  loadPage:(data,page)=>serverData('render_latex_pdf_page',{root:data.root,path:data.path,page,fingerprint:data.fingerprint,format:'svg'}),
  onSelection(selection,anchor){if(!commenting && !selection.pdf?.region)return;offerSelection(selection,anchor);},
  onRegionMode:active=>$('pdf-screenshot').setAttribute('aria-pressed',String(active)),
  onNote:(item,anchor)=>open(item,item,anchor),onError:showPdfError,
  onPage:(number,total)=>{$('pdf-page-float').textContent=`${number}/${total}`;},
  onZoom:updateDocumentZoom
});
$('pdf-screenshot').addEventListener('click',()=>{
  close();const active=$('pdf-screenshot').getAttribute('aria-pressed')!=='true';
  if(isHtmlPreview()){if(!commenting)$('comment').click();htmlFrameState?.frame.contentWindow?.postMessage({markatlas:htmlFrameState.channel,type:'region',active},'*');}
  else pdfViewer.setRegionMode(active);
});
function updateDocumentZoom(value){$('pdf-zoom-level').textContent=`${Math.round(value*100)}%`;$('pdf-zoom-out').disabled=value<=PDF_MIN_ZOOM;$('pdf-zoom-in').disabled=value>=PDF_MAX_ZOOM;}
const activePageViewer=()=>filePreview?.kind==='word'?wordViewer:pdfViewer;
function setTextScale(value){
  textScale=Math.max(.75,Math.min(2,Math.round(value*100)/100));
  document.documentElement.style.setProperty('--text-scale',String(textScale));
  $('font-level').textContent=`${Math.round(textScale*100)}%`;
  $('font-smaller').disabled=textScale<=.75;$('font-larger').disabled=textScale>=2;
  try{localStorage.setItem('markdown-review:text-scale',String(textScale));}catch{}
  codeEditor.measure();requestAnimationFrame(positionComposer);
}
$('font-smaller').addEventListener('click',()=>setTextScale(textScale-.1));
$('font-larger').addEventListener('click',()=>setTextScale(textScale+.1));
$('font-level').addEventListener('click',()=>setTextScale(1));
setTextScale(textScale);
$('pdf-zoom-in').addEventListener('click',()=>{const viewer=activePageViewer();viewer.setZoom(viewer.zoom()+.25);});
$('pdf-zoom-out').addEventListener('click',()=>{const viewer=activePageViewer();viewer.setZoom(viewer.zoom()-.25);});
$('pdf-zoom-level').addEventListener('click',()=>activePageViewer().setZoom(1));
$('pdf-tools').addEventListener('wheel',event=>activePageViewer().wheelZoom(event),{passive:false});
$('pdf-page-float').addEventListener('click',()=>{const viewer=activePageViewer();viewer.goToPage(viewer.currentPage());});
async function openPdfSource(){
  if(!pdfDocument?.main)return;
  const data=pdfDocument,selection=pending,generation=incomingRevision;let target=data.main,line;
  if(selection?.pdf){try{const location=await serverData('locate_latex_pdf_selection',{root:data.root,path:data.path,selection:{...selection.pdf,startOffset:selection.startOffset,quote:selection.selectedText}});if(location.status==='located'){target=location.path;line=location.line;}}catch(error){showPdfError(error);return;}}
  if(generation===incomingRevision && pdfDocument===data)await openProjectFile(target,line);
}
function showPdfError(error){$('code-error').textContent=error.message;$('code-error').hidden=false;}
async function displayPdf(data,refresh=false){
  const generation=incomingRevision,scroll=refresh?window.scrollY:0;pdfDocument=null;
  const shown=await displayFile(data.path,data.text,data.main?`latex:${data.root}/${data.main}`:`pdf:${data.root}/${data.path}`,refresh,data.sourcePath);
  if(!shown || generation!==incomingRevision)return;
  pdfDocument=data;linkedPdf=data.main?{root:data.root,path:data.path,main:data.main}:null;sourcePath=data.sourcePath;activeProjectPath=data.path;currentEtag=data.etag;codeFile=false;fileRefresh.stop();
  if(!refresh)pdfViewer.destroy();
  // Recompute page geometry from tracked text offsets; never keep coordinates from an old build.
  items=items.map(item=>{const page=data.pages.find(p=>item.startOffset>=p.startOffset && item.startOffset<p.endOffset);if(item.pdf?.region)return {...item,anchorStatus:item.pdf.fingerprint===data.fingerprint?item.anchorStatus:'edited'};if(!item.pdf || !page)return item;const words=page.words.filter(w=>w.endOffset>item.startOffset&&w.startOffset<item.endOffset);return {...item,pdf:{...item.pdf,path:data.path,fingerprint:data.fingerprint,page:page.number,x:words[0]?.x || 0,y:words[0]?.y || 0,rects:words.map(w=>({x:w.x,y:w.y,width:w.width,height:w.height})),source:undefined}};});
  persist();syncAnnotations().catch(()=>{});render();renderBreadcrumb();renderProjectTree();$('project-status').hidden=true;
  window.scrollTo({top:scroll});
  schedulePdfPoll();
}
function schedulePdfPoll(){clearTimeout(pdfPoll);if(pdfDocument)pdfPoll=setTimeout(checkPdf,3000);}
async function checkPdf(){
  const data=pdfDocument;if(!data || pdfPollBusy)return;pdfPollBusy=true;
  try{
    if(!batchSending && $('composer').hidden){
      if(project?.singleFile && project.resourceUri)await importSingleFile(data.path.split('/').at(-1),await resourceBytes(project.resourceUri),project.resourceUri);
      const result=await serverData('read_latex_pdf',{root:data.root,path:data.path,ifNoneMatch:data.etag});
      if(data===pdfDocument && !result.notModified)await displayPdf(result,true);
    }
  }catch(error){if(data===pdfDocument)showPdfError(error);}finally{pdfPollBusy=false;schedulePdfPoll();}
}
function positionComposer() {
  if($('composer').hidden)return;
  const rects=[...$('document').querySelectorAll('.pending-selection')].flatMap(node=>[...node.getClientRects()]);
  const rect=rects.filter(r=>r.width || r.height).at(-1) || selectionAnchor || {left:window.innerWidth/2,right:window.innerWidth/2,top:100,bottom:100};
  const panel=$('composer');
  const bounds=document.querySelector('main').getBoundingClientRect();
  const left=Math.max(0,bounds.left),right=bounds.width?Math.min(window.innerWidth,bounds.right):window.innerWidth;
  const anchor={...rect,left:rect.left-left,right:rect.right-left,top:rect.top,bottom:rect.bottom};
  const position=floatingPosition(anchor,Math.min(300,right-left-24),panel.getBoundingClientRect().height || 360,{width:right-left,height:window.innerHeight},document.querySelector('header').getBoundingClientRect().bottom);
  Object.assign(panel.style,{left:`${position.left+left}px`,top:`${position.top}px`,maxWidth:`${position.maxWidth}px`,maxHeight:`${position.maxHeight}px`});
}
function renderBreadcrumb() {
  $('project-label').textContent=project?.root.name || 'Add files or folders';
  $('project-root-arrow').hidden=!!fileName;
  const folders=$('path-folders');folders.replaceChildren();
  const parts=(sourcePath && project ? fileName : '').split('/').filter(Boolean);
  let path='';
  for(const name of parts.slice(0,-1)) {
    path=path ? `${path}/${name}` : name;
    const separator=document.createElement('span');separator.className='path-separator';separator.textContent='›';separator.setAttribute('aria-hidden','true');
    const button=document.createElement('button');button.type='button';button.dataset.breadcrumbFolder=path;button.textContent=name;button.setAttribute('aria-label',`Browse ${name}`);button.setAttribute('aria-controls','project-drawer');
    folders.append(separator,button);
  }
  $('filename').textContent=fileName.split('/').at(-1) || '';
  $('filename').hidden=!fileName;$('filename-separator').hidden=!fileName;
}
async function browseFolder(path='') {
  breadcrumbFolder=path;$('project-filter').value='';setProjectOpen(true);
  await loadWorkspace();
  for(const node of $('project-tree').querySelectorAll('details')) {
    const folder=node.dataset.projectFolder;
    if(folder===path || path.startsWith(`${folder}/`))node.open=true;
    const title=node.querySelector('summary');
    if(folder===path){title.dataset.breadcrumbActive='true';title.scrollIntoView?.({block:'nearest'});title.focus();}
  }
}
let breadcrumbDrag=null,suppressBreadcrumbClick=false;
const breadcrumb=document.querySelector('.breadcrumb');
breadcrumb.addEventListener('pointerdown',event=>{if(event.button!==0 || event.pointerType==='touch')return;suppressBreadcrumbClick=false;breadcrumbDrag={id:event.pointerId,x:event.clientX,scroll:breadcrumb.scrollLeft,moved:false};});
window.addEventListener('pointermove',event=>{if(!breadcrumbDrag || event.pointerId!==breadcrumbDrag.id)return;const delta=breadcrumbDrag.x-event.clientX;if(!breadcrumbDrag.moved && Math.abs(delta)<4)return;breadcrumbDrag.moved=true;breadcrumb.classList.add('dragging');breadcrumb.setPointerCapture?.(event.pointerId);breadcrumb.scrollLeft=breadcrumbDrag.scroll+delta;event.preventDefault();});
function finishBreadcrumbDrag(event){if(!breadcrumbDrag || event.pointerId!==breadcrumbDrag.id)return;suppressBreadcrumbClick=breadcrumbDrag.moved;breadcrumbDrag=null;breadcrumb.classList.remove('dragging');}
window.addEventListener('pointerup',finishBreadcrumbDrag);window.addEventListener('pointercancel',finishBreadcrumbDrag);
breadcrumb.addEventListener('click',event=>{if(suppressBreadcrumbClick){suppressBreadcrumbClick=false;event.preventDefault();event.stopPropagation();}},{capture:true});
$('path-folders').addEventListener('click',e=>{const button=e.target.closest('[data-breadcrumb-folder]');if(button)browseFolder(button.dataset.breadcrumbFolder);});
let preferredTreeWidth=280,treeDrag=null;
let treeSide=localStorage.getItem('markatlas:tree-side')==='right'?'right':'left';
let fullWidth=localStorage.getItem('markatlas:full-width')==='true';
function updateLayout(){
  const tree=document.body.classList.contains('project-open')?parseFloat(document.documentElement.style.getPropertyValue('--tree-width'))||280:0;
  const comments=document.body.classList.contains('comments-open')?Math.min(320,Math.round(window.innerWidth*.3)):0;
  document.body.dataset.treeSide=treeSide;document.body.classList.toggle('full-width',fullWidth);
  document.documentElement.style.setProperty('--left-space',`${treeSide==='left'?tree:0}px`);
  document.documentElement.style.setProperty('--right-space',`${comments+(treeSide==='right'?tree:0)}px`);
  document.documentElement.style.setProperty('--comments-space',`${comments}px`);
  toolbarIcon('width-mode',fullWidth?'Full Width':'Readable',fullWidth?'wide':'readable');
  const toolbar=document.querySelector('.toolbar'),toggle=$('tree-toggle');
  if(treeSide==='left'){if(toolbar.firstElementChild!==toggle)toolbar.prepend(toggle);}else if(toolbar.lastElementChild!==toggle)toolbar.append(toggle);
}
$('width-mode').addEventListener('click',()=>{fullWidth=!fullWidth;localStorage.setItem('markatlas:full-width',String(fullWidth));updateLayout();requestAnimationFrame(positionComposer);});
$('mode-cycle').addEventListener('click',()=>{if(pdfDocument){openPdfSource();return;}preserveViewport(()=>{
  close();editHistory.boundary();
  if(isMarkdown(fileName)){
    if(mode==='source'){mode='rendered';codeMode='edit';}
    else if(codeMode==='edit'){mode='rendered';codeMode='review';}
    else {mode='source';codeMode='edit';}
  }else if(/\.html?$/i.test(fileName)){
    mode=mode==='source'?'rendered':'source';codeMode=mode==='source'?'edit':'review';
  }else return;
  render();
});});
$('tree-toggle').addEventListener('contextmenu',event=>{
  event.preventDefault();const menu=$('tree-position-menu');menu.hidden=false;
  menu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-190))}px`;
  menu.style.top=`${Math.min(event.clientY,window.innerHeight-100)}px`;
  menu.querySelector(`[data-side=${treeSide}]`).focus();
});
for(const button of $('tree-position-menu').querySelectorAll('button'))button.addEventListener('click',()=>{
  treeSide=button.dataset.side;localStorage.setItem('markatlas:tree-side',treeSide);$('tree-position-menu').hidden=true;setProjectOpen(true);requestAnimationFrame(positionComposer);
});
document.addEventListener('pointerdown',event=>{if(!$('tree-position-menu').contains(event.target))$('tree-position-menu').hidden=true;});
$('tree-position-menu').addEventListener('keydown',event=>{if(event.key==='Escape'){$('tree-position-menu').hidden=true;$('tree-toggle').focus();}});

try{const stored=Number(localStorage.getItem('markdown-review:tree-width'));if(stored>=120 && stored<=640)preferredTreeWidth=stored;}catch{}
function treeWidthBounds(){const comments=document.body.classList.contains('comments-open')?Math.min(320,Math.round(window.innerWidth*.3)):0;const max=Math.max(80,Math.min(640,window.innerWidth-comments-160));return {min:Math.min(180,max),max};}
function applyTreeWidth(value){
  const {min,max}=treeWidthBounds(),width=Math.round(Math.max(min,Math.min(max,value)));
  document.documentElement.style.setProperty('--tree-width',`${width}px`);
  const handle=$('tree-resize');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',width);if(typeof treeSide!=='undefined')updateLayout();return width;
}
function rememberTreeWidth(){try{localStorage.setItem('markdown-review:tree-width',preferredTreeWidth);}catch{}}
$('tree-resize').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;event.preventDefault();
  treeDrag={id:event.pointerId,x:event.clientX,width:applyTreeWidth(preferredTreeWidth)};
  $('tree-resize').setPointerCapture?.(event.pointerId);document.body.classList.add('resizing-tree');
});
window.addEventListener('pointermove',event=>{
  if(!treeDrag || event.pointerId!==treeDrag.id)return;
  preferredTreeWidth=applyTreeWidth(treeDrag.width+(treeSide==='left'?event.clientX-treeDrag.x:treeDrag.x-event.clientX));positionComposer();
});
function finishTreeDrag(event){if(!treeDrag || event.pointerId!==treeDrag.id)return;treeDrag=null;document.body.classList.remove('resizing-tree');rememberTreeWidth();}
window.addEventListener('pointerup',finishTreeDrag);window.addEventListener('pointercancel',finishTreeDrag);
$('tree-resize').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  const {min,max}=treeWidthBounds(),width=applyTreeWidth(preferredTreeWidth);
  preferredTreeWidth=applyTreeWidth(event.key==='Home'?min:event.key==='End'?max:width+(event.key==='ArrowLeft'?-1:1)*(treeSide==='left'?16:-16));rememberTreeWidth();positionComposer();
});
function setProjectOpen(value) {
  if(!value)$('file-context-menu').hidden=true;
  $('tree-toggle').setAttribute('aria-expanded',String(value));$('tree-toggle').setAttribute('aria-label',value ? 'Hide file tree' : 'Show file tree');$('tree-toggle').title=value ? 'Hide file tree' : 'Show file tree';
  $('tree-resize').hidden=!value;$('project-drawer').hidden=!value;$('project-toggle').setAttribute('aria-expanded',String(value));
  document.body.classList.toggle('project-open',value);positionDrawer();
}
function positionDrawer() {
  applyTreeWidth(preferredTreeWidth);updateLayout();
  document.documentElement.style.setProperty('--project-top',`${document.querySelector('header').getBoundingClientRect().bottom}px`);
}
const fileMenu=createFileMenu({tree:$('project-tree'),menu:$('file-context-menu'),root:()=>project?.rootPath,
  onWebPreview:async path=>{await openProjectFile(path);mode='rendered';codeMode='review';render();},
  onError:error=>{$('project-status').hidden=false;$('project-status').textContent=error.message;}});
let showHiddenFiles=localStorage.getItem('markatlas:show-hidden-files')!=='false';
function updateHiddenFilesToggle(){
  toolbarIcon('hidden-files-toggle',showHiddenFiles?'Hidden files visible — click to hide':'Hidden files hidden — click to show','preview');
  $('hidden-files-toggle').setAttribute('aria-label','Show hidden files');
  $('hidden-files-toggle').setAttribute('aria-pressed',String(showHiddenFiles));
  if(!showHiddenFiles)$('hidden-files-toggle').querySelector('svg').insertAdjacentHTML('beforeend','<path d="M3 3 21 21"/>');
}
updateHiddenFilesToggle();
$('hidden-files-toggle').addEventListener('click',()=>{showHiddenFiles=!showHiddenFiles;localStorage.setItem('markatlas:show-hidden-files',String(showHiddenFiles));updateHiddenFilesToggle();renderProjectTree();});
function renderProjectTree() {
  fileMenu.close();
  const container=$('project-tree');
  const expanded=new Set([...container.querySelectorAll('details[open]')].map(node=>node.dataset.projectFolder));
  container.replaceChildren();if(!project)return;
  function children(nodes,parent) {
    const list=document.createElement('ul');parent.append(list);
    for(const node of nodes) {
      const row=document.createElement('li');list.append(row);
      if(node.type==='directory') {
        const folder=document.createElement('details'),title=document.createElement('summary');folder.dataset.projectFolder=node.path;folder.open=expanded.has(node.path) || node.path===breadcrumbFolder || !!breadcrumbFolder?.startsWith(`${node.path}/`) || !!activeProjectPath?.startsWith(`${node.path}/`);title.textContent=node.name;if(node.path===breadcrumbFolder)title.dataset.breadcrumbActive='true';folder.append(title);row.append(folder);children(node.children,folder);
      } else {
        const button=document.createElement('button');button.type='button';button.dataset.projectPath=node.path;button.disabled=!node.supported;
        button.draggable=!!project.rootPath && !project.singleFile;
        button.title=node.supported ? node.path : `${node.path} · Unsupported file type`;
        if(node.path===activeProjectPath)button.setAttribute('aria-current','page');
        const symbol=document.createElement('span');symbol.className='file-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent=isImage(node.name)?'IMG':isMarkdown(node.name)?'M↓':node.name.split('.').at(-1).slice(0,3).toUpperCase();
        const name=document.createElement('span');name.className='file-label';name.textContent=node.name;button.append(symbol,name);row.append(button);
      }
    }
  }
  const query=$('project-filter').value.trim().toLowerCase();
  function filtered(nodes){return nodes.flatMap(node=>{if(!showHiddenFiles && node.name.startsWith('.'))return [];if(node.type==='directory'){const children=filtered(node.children);return !query || children.length ? [{...node,children}] : [];}return node.path.toLowerCase().includes(query) ? [node] : [];});}
  children(filtered(project.root.children),container);
  if(query)container.querySelectorAll('details').forEach(node=>node.open=true);
}
$('project-toggle').addEventListener('click',()=>{if(project)browseFolder('');else{setOpenMenu($('open-menu').hidden,$('project-toggle'));if(!$('open-menu').hidden)$('open-file-action').focus();}});
$('tree-toggle').addEventListener('click',()=>{const opening=$('project-drawer').hidden;setProjectOpen(opening);if(opening)loadWorkspace();});
$('project-filter').addEventListener('input',renderProjectTree);
$('project-tree').addEventListener('click',event=>{const button=event.target.closest('[data-project-path]');if(button && event.detail<2)openProjectFile(button.dataset.projectPath);});
let draggedProjectFile=null,movingProjectFile=false;
const clearDropTarget=()=>document.querySelectorAll('[data-file-drop]').forEach(el=>el.removeAttribute('data-file-drop'));
$('project-tree').addEventListener('dragstart',event=>{
  const file=event.target.closest('[data-project-path]');
  if(!file || !project?.rootPath || project.singleFile || movingProjectFile){event.preventDefault();return;}
  draggedProjectFile={root:project.rootPath,path:file.dataset.projectPath};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',file.dataset.projectPath);
});
document.addEventListener('dragend',()=>{draggedProjectFile=null;clearDropTarget();});
function dropFolder(event){
  if(event.currentTarget===$('project-toggle'))return {element:$('project-toggle'),path:''};
  const folder=event.target.closest('summary')?.parentElement;
  if(folder?.dataset.projectFolder!==undefined)return {element:folder.querySelector('summary'),path:folder.dataset.projectFolder};
  if(event.target===$('project-tree') || event.target===$('project-drawer'))return {element:$('project-tree'),path:''};
  return null;
}
async function moveTreeFile(path,folder){
  if(movingProjectFile || !project?.rootPath)return;
  const selected=project,root=project.rootPath;movingProjectFile=true;
  try{
    await saveCode();if(source!==diskSource)throw Error('Save or resolve the current draft before moving a file.');
    await syncAnnotations();
    const result=await serverData('move_review_project_file',{root,path,folder});
    if(result.path===path)return;
    const oldAbsolute=root+'/'+path,newAbsolute=root+'/'+result.path;
    const rewrite=value=>{
      if(Array.isArray(value))return value.map(rewrite);
      if(!value || typeof value!=='object')return value;
      const next={...value};
      for(const key of Object.keys(next))if(typeof next[key]==='object')next[key]=rewrite(next[key]);
      if(next.sourcePath===oldAbsolute)next.sourcePath=newAbsolute;
      if(next.sourceName===path)next.sourceName=result.path;
      if(next.root===root && next.path===path)next.path=result.path;
      if(next.pdf?.root===root && next.pdf.path===path)next.pdf.path=result.path;
      return next;
    };
    const identities=['project:','pdf:'].map(prefix=>[prefix+oldAbsolute,prefix+newAbsolute]);
    const replaceKey=key=>typeof key!=='string'?key:identities.reduce((out,[from,to])=>out.replace(from,to),key);
    for(const key of Object.keys(localStorage))if(identities.some(([id])=>key.includes(id))){
      try{const nextKey=replaceKey(key),data=rewrite(JSON.parse(localStorage.getItem(key)));localStorage.setItem(nextKey,JSON.stringify(data));if(nextKey!==key)localStorage.removeItem(key);}catch{updateStatus('File moved; some local draft metadata could not be updated.');}
    }
    for(const [id,entry] of batchEntries)if(entry.root===root && entry.path===path)batchEntries.set(id,{...rewrite(entry),identity:replaceKey(entry.identity),storage:replaceKey(entry.storage),working:replaceKey(entry.working),etag:null});
    saveBatchQueue();
    for(const entry of fileHistory)if(entry.root===root && entry.path===path)entry.path=result.path;
    if(project!==selected)return;
    beginFileChange();activeProjectPath=null;
    const tree=await serverData('list_markdown_project',{folderPath:root});await acceptWorkspace(tree,{allowDefault:false});
    await openProjectFile(result.path);await syncAnnotations();setProjectOpen(true);
    updateStatus('Moved to '+result.path);
  }catch(error){$('project-status').hidden=false;$('project-status').textContent='Cannot move file: '+error.message;}
  finally{movingProjectFile=false;draggedProjectFile=null;clearDropTarget();}
}
for(const target of [$('project-drawer'),$('project-toggle')]){
  target.addEventListener('dragover',event=>{const folder=dropFolder(event);if(!draggedProjectFile || draggedProjectFile.root!==project?.rootPath || !folder)return;event.preventDefault();event.dataTransfer.dropEffect='move';clearDropTarget();folder.element.dataset.fileDrop='true';});
  target.addEventListener('dragleave',event=>{if(!target.contains(event.relatedTarget))clearDropTarget();});
  target.addEventListener('drop',event=>{const folder=dropFolder(event),file=draggedProjectFile;if(!file || !folder || file.root!==project?.rootPath)return;event.preventDefault();event.stopPropagation();clearDropTarget();moveTreeFile(file.path,folder.path);});
}
let fileHistory=[],historyIndex=-1,historyMoving=false;
function updateFileHistory(){ $('file-back').disabled=historyIndex<=0;$('file-forward').disabled=historyIndex>=fileHistory.length-1;}
async function moveFileHistory(step){const next=historyIndex+step;if(next<0||next>=fileHistory.length||historyMoving)return;const target=fileHistory[next];historyMoving=true;try{await openProjectFile(target.path);if(activeProjectPath===target.path){historyIndex=next;window.scrollTo(0,target.scroll);}}finally{historyMoving=false;updateFileHistory();}}
$('file-back').addEventListener('click',()=>moveFileHistory(-1));$('file-forward').addEventListener('click',()=>moveFileHistory(1));
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&['[',']'].includes(event.key)&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();moveFileHistory(event.key==='['?-1:1);}},true);
async function openProjectFile(path,sourceLine){
  if(!project)return;
  if(path===activeProjectPath && !sourceLine)return;
  if(!(await canLeaveFile()))return;
  if(fileHistory[historyIndex])fileHistory[historyIndex].scroll=window.scrollY;
  const selectedProject=project,file=selectedProject.files?.get(path);if(!file && !selectedProject.rootPath)return;
  if(/\.(docx|xlsx)$/i.test(path)){
    try{
      if(!extensions.files?.open)throw Error('The built-in Word and Excel viewers are available inside the app. This browser preview cannot open them.');
      if(!selectedProject.rootPath)throw Error('Open the folder containing this file first.');
      const target=await serverData('resolve_native_office_file',{root:selectedProject.rootPath,path});
      if(selectedProject!==project)return;
      await extensions.files.open(target.path);
      $('project-status').hidden=true;$('project-status').textContent='';
    }catch(error){$('project-status').hidden=false;$('project-status').textContent=`Cannot open ${path}: ${error.message}`;}
    return;
  }
  beginFileChange();const current=++incomingRevision;$('project-status').textContent=`Opening ${path}…`;
  try {
    if(isPdf(path)){
      if(!selectedProject.rootPath)throw Error('Open the folder containing this PDF to review it.');
      const result=await serverData('read_latex_pdf',{root:selectedProject.rootPath,path});
      if(current===incomingRevision && selectedProject===project){
        setProjectOpen(false);pdfViewer.setZoom(1);await displayPdf(result);
      }
      return;
    }
    const snapshot=selectedProject.rootPath ? await serverData('read_markdown_project_file',{root:selectedProject.rootPath,path}) : await localSnapshot(file);
    if(current!==incomingRevision || selectedProject!==project)return;
    await displaySnapshot(path,snapshot,`project:${selectedProject.rootPath || selectedProject.root.name}/${path}`,selectedProject.rootPath ? `${selectedProject.rootPath.replace(/[\\/]+$/,'')}/${path}` : null);
    if(current!==incomingRevision || selectedProject!==project)return;
    activeProjectPath=path;currentEtag=snapshot.etag;updateBatchDraft();
    if(!historyMoving){if(fileHistory[historyIndex]?.root!==selectedProject.rootPath){fileHistory=[];historyIndex=-1;}fileHistory.splice(historyIndex+1);fileHistory.push({root:selectedProject.rootPath,path,scroll:0});historyIndex=fileHistory.length-1;}updateFileHistory();scheduleSave();updateEditorControls();renderBreadcrumb();if(Number.isInteger(sourceLine))codeEditor.focusLine(sourceLine);
    if(selectedProject.rootPath && !snapshot.readOnly)fileRefresh.watch({text:snapshot.kind==='word' ? snapshot.data : snapshot.kind==='image' ? snapshot.url : source,etag:snapshot.etag,async read(etag){
      if(selectedProject.singleFile && selectedProject.resourceUri)await importSingleFile(path.split('/').at(-1),await resourceBytes(selectedProject.resourceUri),selectedProject.resourceUri);
      const result=await serverData('read_markdown_project_file',{root:selectedProject.rootPath,path,...(etag?{ifNoneMatch:etag}:{})});
      if(result.notModified)return result;
      if(result.readOnly)throw Error('File is no longer UTF-8 text. Reopen it for a read-only preview.');
      return {...result,text:result.kind==='word' ? result.data : result.kind==='image' ? result.url : normalize(result.text)};
    }});
    renderProjectTree();
    $('project-status').hidden=true;$('project-status').textContent='';

  } catch(error){if(current===incomingRevision){$('project-status').hidden=false;$('project-status').textContent=`Cannot open ${path}: ${error.message}`;showPdfError(error);}}
}
window.addEventListener('resize',()=>{positionDrawer();positionComposer();});
window.addEventListener('scroll',positionComposer,{capture:true});
if(typeof ResizeObserver!=='undefined')new ResizeObserver(positionComposer).observe($('composer'));

async function serverData(name,args={}) {
  const result=await app.callServerTool({name,arguments:args});
  if(result.isError)throw Error(result.content?.find(c=>c.type==='text')?.text || 'Project access unavailable.');
  if(!result.structuredContent)throw Error('Project data is unavailable.');
  return result.structuredContent;
}
let workspaceRequest=0;
function clearWorkspaceDocument() {
  ++incomingRevision;beginFileChange();close();filePreview=null;source='';diskSource='';diskHash='';codeFile=false;codeMode='edit';currentEtag=null;fileName='';sourcePath=null;identity='';documentHash='';items=[];activeProjectPath=null;
  $('filename').textContent='MarkAtlas';$('comment').disabled=true;render();
  $('status').textContent='';
}
async function acceptWorkspace(tree,{selectDefault=false,allowDefault=true}={}) {
  const initial=!project;
  const changed=project && (project.rootPath!==tree.rootPath || !!project.singleFile!==!!tree.singleFile || (tree.singleFile && project.singlePath!==tree.singlePath));
  if(changed && !(await canLeaveFile()))return false;
  if(changed){linkedPdf=null;currentEtag=null;clearWorkspaceDocument();breadcrumbFolder=null;$('project-filter').value='';$('project-tree').replaceChildren();}
  if(project && !changed)Object.assign(project,tree);else project=tree;
  $('project-status').hidden=true;$('project-status').textContent='';
  renderBreadcrumb();renderProjectTree();renderBatch();
  // Only choose a default when connecting a folder, never on focus/tree refresh.
  if(allowDefault && (selectDefault || ((initial || changed) && !fileName))){
    const names=['readme.md','readme.markdown','readme','readme.txt','readme.rst'];
    const readme=tree.root.children.filter(node=>node.type==='file' && names.includes(node.name.toLowerCase()))
      .sort((a,b)=>names.indexOf(a.name.toLowerCase())-names.indexOf(b.name.toLowerCase()) || a.name.localeCompare(b.name))[0];
    if(readme)await openProjectFile(readme.path);
  }
  return true;
}
let choosingFolder=false;
async function openFolderDialog(){
  if(choosingFolder){serverData('choose_markdown_project_folder').catch(()=>{});return;}
  if(!(await canLeaveFile()))return;choosingFolder=true;
  const request=++workspaceRequest;$('open-folder').setAttribute('aria-busy','true');
  $('project-status').hidden=false;$('project-status').textContent='Choose a folder in the macOS dialog. Click the folder button again to bring it forward.';setProjectOpen(true);
  try {
    const tree=await serverData('choose_markdown_project_folder');
    if(request!==workspaceRequest)return;
    if(tree.cancelled){$('project-status').hidden=true;$('project-status').textContent='';return;}
    if(await acceptWorkspace(tree,{selectDefault:true}))connectedFolder=tree.rootPath;
    setProjectOpen(true);
  } catch(error){$('project-status').hidden=false;$('project-status').textContent=error.message;setProjectOpen(true);}
  finally {choosingFolder=false;$('open-folder').removeAttribute('aria-busy');}
}
$('open-folder').addEventListener('click',openFolderDialog);
function setOpenMenu(open,anchor=$('project-toggle')){
  $('open-menu').hidden=!open;
  if(open){const rect=anchor.getBoundingClientRect();Object.assign($('open-menu').style,{position:'fixed',left:`${Math.max(8,Math.min(rect.left,window.innerWidth-172))}px`,top:`${rect.bottom+7}px`,right:'auto'});}
}
let choosingFile=false;
async function openFileDialog(){
  setOpenMenu(false);if(choosingFile){serverData('choose_review_file').catch(()=>{});return;}
  if(!await canLeaveFile())return;choosingFile=true;
  try{const tree=await serverData('choose_review_file');if(!tree.cancelled)await openSingleWorkspace(tree);}
  catch(error){if(/macOS only|Unknown tool|not found|unsupported/i.test(error.message))$('picker').click();else showPdfError(error);}
  finally{choosingFile=false;}
}
$('open-file-action').addEventListener('click',openFileDialog);
$('open-single-file').addEventListener('click',openFileDialog);
$('open-folder-action').addEventListener('click',()=>{setOpenMenu(false);openFolderDialog();});
document.addEventListener('click',e=>{if(!e.target.closest?.('.open-control') && !e.target.closest?.('#project-toggle'))setOpenMenu(false);});
$('open-menu').addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();setOpenMenu(false);$('project-toggle').focus();}
  if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();(document.activeElement===$('open-file-action') ? $('open-folder-action') : $('open-file-action')).focus();}
});
async function loadWorkspace() {
  if(choosingFolder || project?.singleFile)return;

  const request=++workspaceRequest;
  $('project-status').textContent='Reading current workspace…';
  try {
    const tree=await serverData('list_markdown_project',connectedFolder ? {folderPath:connectedFolder} : {});
    if(request!==workspaceRequest)return;
    await acceptWorkspace(tree);
  } catch(error) {
    if(request!==workspaceRequest)return;
    if(!(await canLeaveFile()))return;
    if(project)clearWorkspaceDocument();project=null;$('project-tree').replaceChildren();
    renderBreadcrumb();
    $('project-status').hidden=false;$('project-status').textContent=error.message;
  }
}
function resourceText(resource) {
  const content=resource.contents?.[0];
  if(typeof content?.text==='string')return normalize(content.text);
  if(typeof content?.blob==='string')return normalize(new TextDecoder().decode(Uint8Array.from(atob(content.blob),c=>c.charCodeAt(0))));
  throw Error('Unsupported file representation.');
}
function watchResource(uri,text) {
  const api=extensions.resources;if(!api)return;
  const dispose=api.addUpdateHandler?.(({params})=>{if(params.uri===uri)fileRefresh.check();});
  api.subscribe?.({uri}).catch(()=>{});
  fileRefresh.watch({text,async read(){return {text:resourceText(await api.read({uri}))};},dispose(){
    dispose?.();api.unsubscribe?.({uri}).catch(()=>{});
  }});
}
window.addEventListener('focus',()=>{loadWorkspace();fileRefresh.check();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadWorkspace();fileRefresh.check();}});
window.addEventListener('pagehide',()=>{clearTimeout(pdfPoll);persist();saveCode();if(syncTimer!==null){clearTimeout(syncTimer);syncTimer=null;syncAnnotations().catch(()=>{});}fileRefresh.stop();});
function applyHostContext(context) {
  $('inline-mode').textContent=context?.displayMode==='inline'?'Expand view':'Inline view';
  if(['light','dark'].includes(context?.theme)){document.documentElement.dataset.theme=context.theme;document.querySelectorAll('.markdown-rendered').forEach(el=>{el.classList.toggle('theme-dark',context.theme==='dark');el.classList.toggle('theme-light',context.theme==='light');});}

}
app.onhostcontextchanged = context=>{applyHostContext(context);loadWorkspace();};
setProjectOpen(true);
app.connect().then(()=>{applyHostContext(app.getHostContext());loadWorkspace();}).catch(error=>{$('status').textContent = `Host connection unavailable: ${error.message}. You can still open a local file.`;});
