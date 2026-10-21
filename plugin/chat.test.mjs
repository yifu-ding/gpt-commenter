import assert from 'node:assert/strict';
import {createReviewAttachment,requestExplanation,annotationText} from './src/chat.js';
import {explanationStore} from './src/explanations.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const item={id:'one',sourceName:'sample.md',startLine:3,endLine:4,selectedText:'A passage',sourceText:'A **passage**',documentHash:'hash',message:'Clarify this',kind:'comment'};
assert.match(annotationText(item),/Comment: Clarify this/);assert.ok(!annotationText(item).includes('"selectedText"'));
await assert.rejects(()=>createReviewAttachment({}).stage(item),/saved locally/);
const calls=[];
const bridge=createReviewAttachment({message:{async send(params){calls.push(params);return {};}}});
await Promise.all([bridge.stage(item),bridge.stage({...item,id:'two',message:'Another note'})]);
assert.equal(calls.length,2,'each note appends a separate native attachment');
for(const call of calls){assert.deepEqual(call._meta['openai/message'],{target:'active',send:false});assert.equal(call.content.length,1);assert.equal(call.content[0].type,'resource');assert.equal(call.content[0].resource.mimeType,'text/markdown');}
assert.notEqual(calls[0].content[0].resource.uri,calls[1].content[0].resource.uri);
assert.match(calls[0].content[0].resource.text,/Clarify this/);assert.match(calls[1].content[0].resource.text,/Another note/);
const rejected=createReviewAttachment({message:{send:async()=>({isError:true})}});await assert.rejects(()=>rejected.stage(item),/rejected/);assert.equal(rejected.has('one'),false);
await assert.rejects(()=>requestExplanation({}, {},item),/Choose an explanation length/);
assert.equal(annotationText({...item,kind:'explanation'}).startsWith('File explanation\n'),true);
const backgroundCalls=[];
const requestApp={async callServerTool(params){backgroundCalls.push(params);return {structuredContent:{requestId:'11111111-1111-4111-8111-111111111111',model:'gpt-6-luna'}};}};
const result=await requestExplanation(requestApp,{message:{send(){throw Error('Must never open a chat');}}},{...item,kind:'explanation',detail:'short'});
assert.equal(result.route,'background');assert.equal(result.model,'gpt-6-luna');assert.equal(backgroundCalls[0].name,'generate_review_explanation');
await assert.rejects(()=>requestExplanation({async callServerTool(){return {isError:true,content:[{type:'text',text:'Sampling unavailable'}]};}},{},{...item,detail:'short'}),/Sampling unavailable/);
// Assert the actual bridge payload, rather than only its visible preview.
const longSelection='Opening words.\n'+('A long selected paragraph. '.repeat(150))+'ONLY_IN_THE_MIDDLE\n'+('More selected text. '.repeat(150))+'Final words.';
const projectItem={...item,id:'project-long',sourcePath:'/workspace/docs/design.md',documentHash:'0123456789abcdef'.repeat(4),startLine:24,endLine:38,selectedText:longSelection,sourceText:longSelection};
const compactCalls=[];
const compactBridge={message:{async send(params){compactCalls.push(params);return {};}}};
await createReviewAttachment(compactBridge).stage(projectItem);
await requestExplanation(requestApp,compactBridge,{...projectItem,kind:'explanation',detail:'short'});
assert.equal(compactCalls.length,1,'explanations never call the chat bridge');
for(const [index,call] of compactCalls.entries()) {
 const text=index===0 ? call.content[0].resource.text : call.content[0].text;
 assert.match(text,/\/workspace\/docs\/design\.md · lines 24–38/);
 assert.doesNotMatch(text,/sha256:|Annotation:|resolve_review_annotation/);
 assert.match(text,/Opening words\..* … .*Final words\./);
 const quote=text.split('\n').find(line=>line.startsWith('> ')).slice(2);
 assert.ok(Array.from(quote).length<=180,'excerpt has a strict character budget');
 assert.ok(!JSON.stringify(call).includes('ONLY_IN_THE_MIDDLE'),'middle passage is absent from every field sent to the model');
 assert.ok(!JSON.stringify(call).includes(longSelection),'full selection is not hidden in attachment metadata');
 assert.ok(text.length<(index===0 ? 800 : 1400),'large excerpts produce a small complete payload');
 assert.match(text,/preserve existing user edits/);
}
assert.equal(projectItem.selectedText,longSelection,'payload formatting does not change the full local record');
const upload={...projectItem,sourcePath:undefined};
assert.ok(annotationText(upload).includes('ONLY_IN_THE_MIDDLE'),'uploads keep the complete selection');
assert.ok(annotationText({...projectItem,documentHash:undefined}).includes('ONLY_IN_THE_MIDDLE'),'unversioned references conservatively keep the selection');
const unicode=annotationText({...projectItem,selectedText:'Beginning '+('😀中文'.repeat(500))+' Ending'}).split('\n').find(line=>line.startsWith('> ')).slice(2);
assert.ok(Array.from(unicode).length<=180);assert.match(unicode,/^Beginning .* … .* Ending$/);
assert.equal(unicode.isWellFormed(),true,'Unicode excerpt boundaries do not split surrogate pairs');
const uploadCalls=[];await createReviewAttachment({message:{async send(params){uploadCalls.push(params);return {};}}}).stage(upload);
assert.ok(uploadCalls[0].content[0].resource.text.includes('ONLY_IN_THE_MIDDLE'),'full fallback reaches the real outbound attachment');
// Existing callback records from 0.5 remain readable for compatibility.
const base=await mkdtemp(join(tmpdir(),'markdown-reply-'));
try{const a=explanationStore(base),b=explanationStore(base),r=await a.create(item);await b.answer(r.requestId,'An existing response.');assert.equal((await a.read(r.requestId)).answer,'An existing response.');await assert.rejects(()=>b.read('../../private'),/Invalid request ID/);await a.remove(r.requestId);await assert.rejects(()=>b.read(r.requestId),/ENOENT/);}finally{await rm(base,{recursive:true,force:true});}
console.log('Separate native draft attachments and separate conversation checks passed');

const pdfText=annotationText({...item,selectedText:'long selected passage '.repeat(100),pdf:{root:'/project',path:'build/main.pdf',main:'main.tex',page:2,endPage:3,fingerprint:'abc',source:{status:'located',sourcePath:'/project/chapter.tex',line:20,endLine:22,method:'synctex'}}});
assert.match(pdfText,/PDF page 2–3/);assert.match(pdfText,/chapter.tex · lines 20–22/);assert.match(pdfText,/Project: \/project\nbuild\/main\.pdf/);assert.match(pdfText,/Edit the \.tex source and recompile if applicable\./);assert.doesNotMatch(pdfText,/PDF version:|Annotation:|resolve_review_annotation|synctex|verify before editing/);assert.ok(!pdfText.includes('build_latex_pdf'));assert.ok(pdfText.length<1700,'PDF attachments remain compact for large selections');

const standalonePdf=annotationText({...item,pdf:{root:'/project',path:'report.pdf',main:null,page:1,fingerprint:'abc'}});
assert.match(standalonePdf,/PDF review/);assert.match(standalonePdf,/No matching editable source/);assert.doesNotMatch(standalonePdf,/Edit the \.tex|build command/);

const regionItem={...item,pdf:{page:1,path:'main.pdf',fingerprint:'abc',region:{x:10,y:20,width:100,height:80},screenshot:'data:image/jpeg;base64,Y3JvcA=='}};
assert.match(annotationText(regionItem),/PDF screenshot review/);assert.match(annotationText(regionItem),/Region in PDF points/);
let regionMessage;await createReviewAttachment({message:{async send(message){regionMessage=message;return {};}}}).stage(regionItem);
assert.equal(regionMessage.content[1].type,'image');assert.equal(regionMessage.content[1].data,'Y3JvcA==');

const latexItem={...item,sourcePath:'/project/build/report.pdf',pdf:{root:'/project',path:'build/report.pdf',main:'main.tex',page:1,fingerprint:'abc',source:{status:'located',sourcePath:'/project/chapters/results.tex',line:21,endLine:21,method:'text-match'}}};
assert.equal(annotationText(latexItem),`LaTeX PDF review
Project: /project
build/report.pdf · PDF page 1
LaTeX: chapters/results.tex · lines 21–21

> A passage

Comment: Clarify this

Edit the .tex source and recompile if applicable.`);
assert.match(annotationText({...latexItem,pdf:{...latexItem.pdf,source:{status:'unresolved'}}}),/LaTeX: main.tex · locate the quoted passage/);
const latexExplanation=annotationText({...latexItem,kind:'explanation',detail:'short'});
assert.match(latexExplanation,/Detail: short/);
assert.doesNotMatch(latexExplanation,/Comment:|recompile|resolve_review_annotation/);
assert.match(annotationText({...latexItem,pdf:{...latexItem.pdf,root:'/project/'}}),/LaTeX: chapters\/results.tex/);
assert.match(annotationText({...latexItem,pdf:{...latexItem.pdf,source:{...latexItem.pdf.source,sourcePath:'/project-other/results.tex'}}}),/LaTeX: \/project-other\/results.tex/,'paths outside the project must remain absolute');

for(const format of [{},{word:{fingerprint:'private-hash'}},{pdf:{root:'/workspace',path:'report.pdf',page:2,fingerprint:'private-hash'}}]){
 const text=annotationText({...projectItem,projectRoot:'/workspace',...format});
 assert.match(text,/Project: \/workspace/);assert.doesNotMatch(text,/sha256:|Version:|Annotation:|resolve_review_annotation|private-hash/);
 assert.match(text,/Comment: Clarify this/);
}
