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
let source = '', fileName = '', sourcePath = null, documentHash = '', identity = '', revision = 0, incomingRevision = 0;
let diskSource='',diskHash='',hashWork=null,syncTimer=null,syncQueue=Promise.resolve(),renderedCaret=null;
let codeMode='edit',currentEtag=null,saving=false,codeFile=false;
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
  onSelection(selection,anchor){if(commenting){open(selection,null,anchor);ignoreOutsideClick=true;}},
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
function beginFileChange(){wordViewer.destroy();clearTimeout(pdfPoll);pdfDocument=null;pdfViewer.destroy();clearTimeout(saveTimer);if(syncTimer!==null){clearTimeout(syncTimer);syncTimer=null;syncAnnotations().catch(()=>{});}fileRefresh.stop();++revision;}
const storageKey = () => `markdown-review:v1:${identity}:${documentHash}`;
const workingKey=()=>`markdown-review:working:${identity}:${diskHash}`;
async function hashText(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');}
const removedNotesKey='markatlas:removed-annotations:v1';
let removedNoteIds=new Set();
try{removedNoteIds=new Set(JSON.parse(localStorage.getItem(removedNotesKey) || '[]'));}catch{}
const batchKey='markatlas:review-batch:v1';
let batchEntries=new Map(),batchSending=false,composerUnavailable=false;
try{batchEntries=new Map(JSON.parse(localStorage.getItem(batchKey) || '[]').filter(([id])=>!removedNoteIds.has(id)));}catch{}
function saveBatchQueue(){try{localStorage.setItem(batchKey,JSON.stringify([...batchEntries]));}catch{updateStatus('Review queue is kept for this session only.');}}
function updateBatchDraft(){
  if(!identity || (filePreview && filePreview.kind!=='word'))return;
  const invalid=items.filter(item=>item.anchorStatus==='deleted' || (item.pdf?.region && item.anchorStatus==='edited'));
  if(invalid.length)pruneReviewNotes(invalid.map(item=>item.id));
  const ids=new Set(items.map(item=>item.id));
  for(const [id,entry] of batchEntries)if(entry.identity===identity && !ids.has(id))batchEntries.delete(id);
  for(const item of items){
    if(item.kind!=='comment' || item.batchSentVersion){batchEntries.delete(item.id);continue;}
    batchEntries.set(item.id,{identity,root:item.pdf?.root || (sourcePath && activeProjectPath?project?.rootPath:null) || null,path:item.pdf?.path || activeProjectPath || null,etag:currentEtag,item:{...item},storage:storageKey(),working:workingKey()});
  }
  saveBatchQueue();renderBatch();
}
function renderBatch(){
  const entries=[...batchEntries.values()];$('review-batch').hidden=!commenting || !entries.length;
  const fileCount=new Set(entries.map(entry=>JSON.stringify([entry.root || entry.item.pdf?.root || '',entry.path || entry.item.sourcePath || entry.item.sourceName]))).size;
  $('review-count').textContent=`${fileCount} ${fileCount===1?'File':'Files'}, ${entries.length} ${entries.length===1?'Annotation':'Annotations'}`;
  $('review-cancel-all').disabled=batchSending || !entries.length;
  $('review-send').disabled=batchSending || !entries.length;$('review-send').textContent=batchSending?'Sending…':'Send';
  $('review-send-new').hidden=!composerUnavailable;
  $('review-send-new').disabled=batchSending || !entries.length;
  const list=$('review-list');list.replaceChildren();
  for(const entry of entries){
    const row=document.createElement('div');row.className='review-row';
    const location=document.createElement('p');location.className='review-location';location.textContent=`${entry.path || entry.item.sourceName} · ${entry.item.pdf?`Page ${entry.item.pdf.page}`:`Lines ${entry.item.startLine}–${entry.item.endLine}`}`;
    const quote=document.createElement('p');quote.className='review-excerpt';quote.textContent=entry.item.selectedText;
    const comment=document.createElement('p');comment.textContent=entry.item.message;
    const remove=document.createElement('button');remove.className='review-remove';remove.textContent='×';remove.setAttribute('aria-label','Delete comment');remove.disabled=batchSending;
    remove.addEventListener('click',()=>removeReviewNotes([entry.item.id]));
    row.append(location,quote,comment,remove);
    if(entry.item.pdf?.screenshot){const image=document.createElement('img');image.src=entry.item.pdf.screenshot;image.alt='Screenshot for this comment';row.append(image);}
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
function removeReviewNotes(ids){pruneReviewNotes(ids);persist();syncAnnotations().catch(()=>{});close();}
$('review-cancel-all').addEventListener('click',()=>{
  if(batchSending)return;
  removeReviewNotes([...batchEntries.keys()]);
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
    const entries=[...batchEntries.values()];
    if(!entries.length){updateStatus('No comments remain to send.');return;}
    const result=await serverData('prepare_review_batch',{entries:entries.map(entry=>({...entry,item:{...entry.item,pdf:entry.item.pdf?{...entry.item.pdf,screenshot:undefined}:undefined}}))});
    const prepared=result.entries.map(entry=>({...entry,item:{...entry.item,pdf:entry.item.pdf?{...entry.item.pdf,screenshot:batchEntries.get(entry.item.id)?.item.pdf?.screenshot}:undefined}}));
    const validIds=new Set(prepared.map(entry=>entry.item.id));
    const obsolete=entries.filter(entry=>!validIds.has(entry.item.id));
    if(obsolete.length)removeReviewNotes(obsolete.map(entry=>entry.item.id));
    if(!prepared.length){updateStatus('Obsolete comments removed. No comments remain to send.');return;}
    await sendReviewBatch(extensions,prepared,target);
    composerUnavailable=false;
    removeReviewNotes(entries.map(entry=>entry.item.id));updateStatus(target==='new'?'Review sent with separate attachments to a new chat.':'Review sent with separate attachments to the current conversation.');
  }catch(error){composerUnavailable=error.code==='COMPOSER_UNAVAILABLE';$('review-error').textContent=error.message;}
  finally{batchSending=false;main.inert=false;header.inert=false;$('project-drawer').inert=false;$('composer').inert=false;renderBatch();}
}
$('review-send').addEventListener('click',()=>sendQueuedReview());
$('review-send-new').addEventListener('click',()=>sendQueuedReview('new'));
renderBatch();
function persist() {
  if(filePreview && filePreview.kind!=='word')return true;
  updateBatchDraft();
  try {localStorage.setItem(storageKey(),JSON.stringify(items));localStorage.setItem(workingKey(),JSON.stringify({text:source,items}));return true;}
  catch {return false;}
}
function syncAnnotations(checkpointAnnotationId){
  if(!identity || (filePreview && filePreview.kind!=='word'))return Promise.resolve();
  const data={identity,...(checkpointAnnotationId?{checkpointAnnotationId}:{}),sourceName:fileName,...(sourcePath?{sourcePath}:{}),text:source,baseText:diskSource,annotations:items.map(item=>({...item,...(item.pdf?{pdf:{...item.pdf,screenshot:undefined}}:{}),sourceText:undefined,selectedText:undefined,originalSnapshot:item.originalSnapshot ? {...item.originalSnapshot,selectedText:Array.from(item.originalSnapshot.selectedText || '').slice(0,180).join('')} : undefined}))};
  syncQueue=syncQueue.catch(()=>{}).then(()=>serverData('update_review_document',data));return syncQueue;
}
function applyWorkingText(text,changes,record=true,caret){
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
  onSelection(selection,anchor){if(commenting && !filePreview && codeMode!=='changes'){open(selection,null,anchor);ignoreOutsideClick=true;}},
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
  $('pdf-screenshot').hidden=!pdfDocument;
  $('code-edit').hidden=!fileName || !!pdfDocument || !!filePreview;
  $('code-edit').textContent='Edit';
  $('code-edit').setAttribute('aria-pressed',String(codeMode==='edit'));
  $('code-edit').setAttribute('aria-label','Edit');

  $('view-toggle').hidden=!!filePreview || (!!pdfDocument && !pdfDocument.main) || (codeFile && !pdfDocument && !(isLatex(fileName) && linkedPdf?.root===project?.rootPath));$('diff-labels').hidden=codeMode!=='changes';
  $('comment').disabled=!fileName || !!(filePreview && filePreview.kind!=='word') || codeMode==='changes';
}
function render() {
  const active=items.filter(item=>item.anchorStatus!=='deleted' && (item.pdf?.region || item.endOffset>item.startOffset));
  const visible = pending ? [...active,{...pending,id:'pending-selection',temporary:true}] : active;
  updateEditorControls();
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
  mapping = renderMarkdown($('document'),source,mode,visible);
  $('document').contentEditable=codeMode==='edit'?'true':'false';
  if(codeMode==='edit' && (!source || /\n\n$/.test(source)))mapping.appendCaret(source.length);
  $('view-toggle').textContent = mode === 'source' ? 'Preview' : 'View source';
}
async function canLeaveFile(){
  await saveCode();
  return !project?.rootPath || !activeProjectPath || source===diskSource;
}
async function saveCode(){
  clearTimeout(saveTimer);
  if(saveWork)return saveWork;
  if(pdfDocument || filePreview || source===diskSource || !project?.rootPath || !activeProjectPath || !currentEtag)return;
  const generation=revision,projectRoot=project.rootPath,path=activeProjectPath;
  saving=true;$('code-error').hidden=true;
  saveWork=(async()=>{
    try {
      // Serialize writes and include edits made while a previous write was in flight.
      while(generation===revision && source!==diskSource){
        const text=source,expectedEtag=currentEtag;
        const snapshot=await serverData('save_review_project_file',{root:projectRoot,path,text,expectedEtag});
        if(generation!==revision)return;
        const savedText=normalize(snapshot.text),savedHash=await hashText(savedText);
        if(generation!==revision)return;
        currentEtag=snapshot.etag;diskSource=savedText;diskHash=savedHash;
        persist();syncAnnotations().catch(()=>{});fileRefresh.setText(diskSource,snapshot.etag);
      }
    } catch(error){if(generation===revision){$('code-error').textContent=`Autosave failed: ${error.message} Your draft is kept locally. Edit again to retry.`;$('code-error').hidden=false;}}
    finally{saving=false;saveWork=null;updateEditorControls();}
  })();
  return saveWork;
}
function focusEditingDocument(){if(pdfDocument || codeMode!=='edit')return;if(codeFile || mode==='source')codeEditor.focus();else{$('document').focus();if(renderedCaret!==null)mapping?.focusAt(renderedCaret);}}
$('code-edit').addEventListener('click',()=>{editHistory.boundary();close();codeMode=codeMode==='edit'?'review':'edit';render();focusEditingDocument();});
window.addEventListener('beforeunload',e=>{if(project?.rootPath && activeProjectPath && source!==diskSource){e.preventDefault();e.returnValue='';}});
function close() {
  stopReply();
  $('composer').hidden = true; pending = null; editingId = null;
  selectionAnchor = null;document.body.classList.remove('composing');render();
  queueMicrotask(()=>fileRefresh.check());
}
function setDetail(value) {
  detail = value;
  for (const length of ['short','medium','long']) $(`detail-${length}`).setAttribute('aria-checked',String(length === detail));
}
function sameSelection(a,b){
  return a && b && a.startOffset===b.startOffset && a.endOffset===b.endOffset && a.selectedText===b.selectedText
    && a.pdf?.page===b.pdf?.page && JSON.stringify(a.pdf?.region)===JSON.stringify(b.pdf?.region);
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
  pending = Object.fromEntries(['startOffset','endOffset','startLine','endLine','selectedText','mappingStatus','pdf','word'].map(key => [key,selection[key]]));
  editingId = item?.id || null;
  $('screenshot-preview').hidden=!selection.pdf?.screenshot;
  if(selection.pdf?.screenshot)$('screenshot-preview').src=selection.pdf.screenshot;else $('screenshot-preview').removeAttribute('src');
  $('quote').textContent = selection.selectedText;
  $('location').textContent = selection.word?`${fileName} · Word selection`:selection.pdf?`${fileName} · PDF page ${selection.pdf.page}`:`${fileName} · lines ${selection.startLine}–${selection.endLine}`;
  $('mapping').hidden = selection.mappingStatus !== 'source-span';
  commentDraft=item?.kind==='comment'?item.message || '':draft;
  $('message').value = commentDraft;
  $('feedback').textContent = '';
  $('delete').hidden = !item;
  setDetail(null); setKind(item?.kind || 'comment',false);
  $('composer').hidden = false;document.body.classList.add('composing');
  render();
  const keepSelection=codeMode==='edit' && !item && !pdfDocument;
  if(keepSelection){if(mapping)$('document').focus({preventScroll:true});else codeEditor.selectSpan(pending.startOffset,pending.endOffset);}
  if(mapping)mapping.selectSpan(pending.startOffset,pending.endOffset);resizeMessage();positionComposer();
  if(keepSelection)return;
  if (kind === 'comment') $('message').focus({preventScroll:true}); else $('kind-explanation').focus({preventScroll:true});
}
function updateStatus(extra = '') {
  $('status').textContent = `${fileName} · ${items.length} saved · ${extra || (commenting ? 'Select text to annotate.' : 'Enable Request edits to annotate selections.')}`;
}
async function displayFile(name,text,fileIdentity = name,keepWatch = false,fileSourcePath = null,preview = null) {
  if(!keepWatch)fileRefresh.stop();
  const current = ++revision,previousText=source,previousItems=items;
  close();if(filePreview?.kind==='word' && preview?.kind!=='word')wordViewer.destroy();filePreview=preview;source = '';items = [];documentHash = '';$('comment').disabled = true;
  $('status').textContent = `Opening ${name}…`;
  const normalized = normalize(text);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  if (current !== revision) return false;
  source = normalized;diskSource=normalized;diskHash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');codeFile=!!preview || !isMarkdown(name);if(!keepWatch)codeMode=preview?'review':'edit';editHistory.clear();renderedCaret=null;fileName = name;identity = fileIdentity;
  $('code-error').hidden=true;
  if(!keepWatch)sourcePath=fileSourcePath;
  documentHash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
  if(!preview || preview.kind==='word')try {
    const working=!keepWatch && JSON.parse(localStorage.getItem(workingKey()) || 'null');
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
  if (!commenting) close();renderBatch();updateStatus();
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
for (const length of ['short','medium','long']) $(`detail-${length}`).addEventListener('click',() => {setDetail(length);submitNote();});
$('length-options').addEventListener('keydown',e => {
  const lengths = ['short','medium','long'];
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
  e.preventDefault();const step = ['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1;
  const focused=lengths.indexOf(e.target.id?.replace('detail-',''));
  const next=lengths[(Math.max(0,focused) + step + 3) % 3];$(`detail-${next}`).focus();
});

document.addEventListener('pointerdown',()=>{ignoreOutsideClick=false;});
document.addEventListener('click',e=>{
  if(!$('composer').hidden && !$('composer').contains(e.target) && !e.target.closest?.('.annotation-icon') && !ignoreOutsideClick)close();
  ignoreOutsideClick=false;
});
document.addEventListener('keydown',e => {if (e.key === 'Escape' && !$('composer').hidden) close();});
function resizeMessage() {
  const field=$('message');field.style.height='auto';field.style.height=`${Math.max(36,Math.min(180,field.scrollHeight))}px`;positionComposer();
}
$('message').addEventListener('focus',()=>editHistory.boundary());
$('message').addEventListener('input',resizeMessage);
$('message').addEventListener('keydown',e => {
  if(e.key!=='Enter' || e.isComposing)return;
  e.preventDefault();
  if(e.metaKey || e.ctrlKey) {
    const field=$('message'),start=field.selectionStart,end=field.selectionEnd;
    field.setRangeText('\n',start,end,'end');resizeMessage();
  } else submitNote();
});
function capture(event) {
  if (pdfDocument || codeFile || mode==='source' || codeMode==='changes' || !commenting || !source || event.target.closest?.('.annotation-icon')) return;
  const selected = window.getSelection();
  if (!selected?.rangeCount || selected.isCollapsed) return;
  const range = selected.getRangeAt(0);
  if (!$('document').contains(range.startContainer) || !$('document').contains(range.endContainer)) return;
  const fragment = range.cloneContents();fragment.querySelectorAll('.annotation-icon').forEach(node => node.remove());
  const selection = mapping.selection(range,fragment.textContent);
  if(selection){const rects=range.getClientRects?.();const rect=rects?.length ? rects[rects.length-1] : range.getBoundingClientRect?.();open(selection,null,rect);if(event.type==='pointerup')ignoreOutsideClick=true;}
}
$('document').addEventListener('pointerup',capture);$('document').addEventListener('keyup',capture);
$('document').addEventListener('click',e => {
  const icon = e.target.closest('[data-item-id]');if(!icon)return;
  const item = items.find(x=>x.id === icon.dataset.itemId);if(item)open(item,item,icon.getBoundingClientRect());
});
async function submitNote() {
  editHistory.boundary();
  if(hashWork)await hashWork;if (!pending) return;
  if(kind==='explanation' && !['short','medium','long'].includes(detail))return;
  const message = kind === 'comment' ? $('message').value.trim() : '';
  if (kind === 'comment' && !message) {$('feedback').textContent = 'Write a comment first.';$('message').focus();return;}
  const selectedPending=pending,selectedRevision=revision,selectedKind=kind,selectedEditingId=editingId,selectedDetail=detail;
  if(kind==='explanation' && pending.pdf && !pending.pdf.region){try{pending.pdf.source=await serverData('locate_latex_pdf_selection',{root:pending.pdf.root,path:pending.pdf.path,selection:{...pending.pdf,startOffset:pending.startOffset,quote:pending.selectedText}});}catch(error){$('feedback').textContent=error.message;return;}}
  if(pending!==selectedPending || selectedRevision!==revision || kind!==selectedKind || editingId!==selectedEditingId || detail!==selectedDetail)return;
  const previous = items.find(x=>x.id === editingId && x.kind===kind);
  const item = {...pending,batchSentVersion:undefined,originalSnapshot:previous?.originalSnapshot || {...(pending.pdf?{pdf:{...pending.pdf,screenshot:undefined}}:{}),documentHash,startLine:pending.startLine,endLine:pending.endLine,startOffset:pending.startOffset,endOffset:pending.endOffset,selectedText:pending.selectedText},id:previous?.id || crypto.randomUUID(),kind,message,hasUnsavedEdits:source!==diskSource,...(kind === 'explanation' ? {detail} : {}),sourceName:fileName,...(sourcePath ? {sourcePath} : {}),...(sourcePath && project?.rootPath?{projectRoot:project.rootPath}:{}),documentHash,sourceText:source.slice(pending.startOffset,pending.endOffset),updatedAt:new Date().toISOString()};
  if(previous)items = items.map(x=>x.id === previous.id ? item : x);else items.push(item);
  if(kind==='explanation'){delete item.explanationRequestId;delete item.explanationAnswer;delete item.explanationError;item.explanationStatus='starting';}
  const saved = persist();const current = revision;
  if(kind==='explanation')open(item,item,selectionAnchor);else close();
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
  onSelection(selection,anchor){if(!commenting && !selection.pdf?.region)return;open(selection,null,anchor);ignoreOutsideClick=true;},
  onRegionMode:active=>$('pdf-screenshot').setAttribute('aria-pressed',String(active)),
  onNote:(item,anchor)=>open(item,item,anchor),onError:showPdfError,
  onPage:(number,total)=>{$('pdf-page-float').textContent=`${number}/${total}`;},
  onZoom:updateDocumentZoom
});
$('pdf-screenshot').addEventListener('click',()=>{close();pdfViewer.setRegionMode($('pdf-screenshot').getAttribute('aria-pressed')!=='true');});
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
  const rect=rects.filter(r=>r.width || r.height).at(-1) || selectionAnchor;
  if(!rect)return;
  const panel=$('composer');
  const position=floatingPosition(rect,Math.min(300,window.innerWidth-24),panel.getBoundingClientRect().height || 360,{width:window.innerWidth,height:window.innerHeight},document.querySelector('header').getBoundingClientRect().bottom);
  Object.assign(panel.style,{left:`${position.left}px`,top:`${position.top}px`,maxWidth:`${position.maxWidth}px`,maxHeight:`${position.maxHeight}px`});
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
try{const stored=Number(localStorage.getItem('markdown-review:tree-width'));if(stored>=120 && stored<=640)preferredTreeWidth=stored;}catch{}
function treeWidthBounds(){const max=Math.max(120,Math.min(640,window.innerWidth-(window.innerWidth>=700?320:48)));return {min:Math.min(180,max),max};}
function applyTreeWidth(value){
  const {min,max}=treeWidthBounds(),width=Math.round(Math.max(min,Math.min(max,value)));
  document.documentElement.style.setProperty('--tree-width',`${width}px`);
  const handle=$('tree-resize');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',width);return width;
}
function rememberTreeWidth(){try{localStorage.setItem('markdown-review:tree-width',preferredTreeWidth);}catch{}}
$('tree-resize').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;event.preventDefault();
  treeDrag={id:event.pointerId,x:event.clientX,width:applyTreeWidth(preferredTreeWidth)};
  $('tree-resize').setPointerCapture?.(event.pointerId);document.body.classList.add('resizing-tree');
});
window.addEventListener('pointermove',event=>{
  if(!treeDrag || event.pointerId!==treeDrag.id)return;
  preferredTreeWidth=applyTreeWidth(treeDrag.width+treeDrag.x-event.clientX);positionComposer();
});
function finishTreeDrag(event){if(!treeDrag || event.pointerId!==treeDrag.id)return;treeDrag=null;document.body.classList.remove('resizing-tree');rememberTreeWidth();}
window.addEventListener('pointerup',finishTreeDrag);window.addEventListener('pointercancel',finishTreeDrag);
$('tree-resize').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  const {min,max}=treeWidthBounds(),width=applyTreeWidth(preferredTreeWidth);
  preferredTreeWidth=applyTreeWidth(event.key==='Home'?min:event.key==='End'?max:width+(event.key==='ArrowLeft'?16:-16));rememberTreeWidth();positionComposer();
});
function setProjectOpen(value) {
  if(!value)$('file-context-menu').hidden=true;
  $('tree-toggle').setAttribute('aria-expanded',String(value));$('tree-toggle').setAttribute('aria-label',value ? 'Hide file tree' : 'Show file tree');$('tree-toggle').title=value ? 'Hide file tree' : 'Show file tree';
  $('tree-resize').hidden=!value;$('project-drawer').hidden=!value;$('project-toggle').setAttribute('aria-expanded',String(value));
  document.body.classList.toggle('project-open',value);positionDrawer();
}
function positionDrawer() {
  applyTreeWidth(preferredTreeWidth);
  document.documentElement.style.setProperty('--project-top',`${document.querySelector('header').getBoundingClientRect().bottom}px`);
}
const fileMenu=createFileMenu({tree:$('project-tree'),menu:$('file-context-menu'),root:()=>project?.rootPath,
  onError:error=>{$('project-status').hidden=false;$('project-status').textContent=`Cannot copy path: ${error.message}`;}});
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
        button.title=node.supported ? node.path : `${node.path} · Unsupported file type`;
        if(node.path===activeProjectPath)button.setAttribute('aria-current','page');
        const symbol=document.createElement('span');symbol.className='file-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent=isImage(node.name)?'IMG':isMarkdown(node.name)?'M↓':node.name.split('.').at(-1).slice(0,3).toUpperCase();
        const name=document.createElement('span');name.className='file-label';name.textContent=node.name;button.append(symbol,name);row.append(button);
      }
    }
  }
  const query=$('project-filter').value.trim().toLowerCase();
  function filtered(nodes){return nodes.flatMap(node=>{if(node.type==='directory'){const children=filtered(node.children);return children.length ? [{...node,children}] : [];}return node.path.toLowerCase().includes(query) ? [node] : [];});}
  children(query ? filtered(project.root.children) : project.root.children,container);
  if(query)container.querySelectorAll('details').forEach(node=>node.open=true);
}
$('project-toggle').addEventListener('click',()=>{if(project)browseFolder('');else{setOpenMenu($('open-menu').hidden,$('project-toggle'));if(!$('open-menu').hidden)$('open-file-action').focus();}});
$('tree-toggle').addEventListener('click',()=>{const opening=$('project-drawer').hidden;setProjectOpen(opening);if(opening)loadWorkspace();});
$('project-filter').addEventListener('input',renderProjectTree);
$('project-tree').addEventListener('click',event=>{const button=event.target.closest('[data-project-path]');if(button)openProjectFile(button.dataset.projectPath);});
async function openProjectFile(path,sourceLine){
  if(!project)return;
  if(!(await canLeaveFile()))return;
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
    activeProjectPath=path;currentEtag=snapshot.etag;scheduleSave();updateEditorControls();renderBreadcrumb();if(Number.isInteger(sourceLine))codeEditor.focusLine(sourceLine);
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
  renderBreadcrumb();renderProjectTree();
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
  if(['light','dark'].includes(context?.theme))document.documentElement.dataset.theme = context.theme;

}
app.onhostcontextchanged = context=>{applyHostContext(context);loadWorkspace();};
setProjectOpen(true);
app.connect().then(()=>{applyHostContext(app.getHostContext());loadWorkspace();}).catch(error=>{$('status').textContent = `Host connection unavailable: ${error.message}. You can still open a local file.`;});
