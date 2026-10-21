import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {workspaceAccess} from './src/workspace.js';import {singleFileService} from './src/single-file.js';import {latexService} from './src/latex.js';
import {reviewStore} from './src/review-store.js';import {prepareReviewBatch} from './src/prepare-review-batch.js';
function pdf(text='Hello PDF'){
 const stream=`BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n',offsets=[0];for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(data);data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(data);
}
const temp=await mkdtemp(join(tmpdir(),'markatlas-single-'));
try{
 const root=await realpath(temp),folder=join(root,'reports');await mkdir(folder);const path=join(folder,'my report.pdf');await writeFile(path,pdf());await writeFile(join(folder,'main.tex'),'\\documentclass{article}\n\\begin{document}Hello PDF\\end{document}');
 const workspace=workspaceAccess(async()=>[]),files=singleFileService(workspace,join(root,'data')),latex=latexService(workspace);
 const tree=await files.open({path});assert.equal(tree.singleFile,undefined);assert.equal(tree.singlePath,'my report.pdf');assert.equal(tree.root.children.length,2);assert.ok(tree.root.children.some(node=>node.name==='my report.pdf'));
 assert.equal(await workspace.resolve(tree.rootPath,tree.singlePath),path);
 assert.equal(await workspace.resolve(tree.rootPath,'main.tex'),join(folder,'main.tex'));
 await assert.rejects(()=>files.open({path:folder}),/not a folder/);
 const data=await latex.read(tree.rootPath,tree.singlePath);assert.equal(data.main,'main.tex');assert.match(data.text,/Hello PDF/);assert.equal(data.pages.length,1);
 assert.match((await latex.page(tree.rootPath,tree.singlePath,1,data.fingerprint,'svg')).image,/^data:image\/svg\+xml;base64/);
 const reviews=reviewStore(join(root,'review-data')),id='11111111-1111-4111-8111-111111111111';const start=data.text.indexOf('Hello'),end=start+9;
 const item={id,kind:'comment',message:'Clarify this',startOffset:start,endOffset:end,selectedText:'Hello PDF',sourceName:tree.singlePath,pdf:{root:tree.rootPath,path:tree.singlePath,page:1,fingerprint:data.fingerprint,main:null,x:72,y:72}};
 await reviews.update({identity:'one-file',sourceName:tree.singlePath,sourcePath:path,text:data.text,baseText:data.text,annotations:[item]});
 const batch=await prepareReviewBatch([{root:tree.rootPath,path:tree.singlePath,etag:data.etag,item}],{reviews,workspace,latex});assert.equal(batch.length,1);assert.equal(batch[0].item.pdf.main,'main.tex');
 const imported=await files.open({name:'attached.pdf',data:pdf().toString('base64'),resourceKey:'resource://one'});assert.equal(imported.imported,true);const before=await latex.read(imported.rootPath,imported.singlePath);
 const same=await files.open({name:'attached.pdf',data:pdf().toString('base64'),resourceKey:'resource://one'});assert.equal((await latex.read(same.rootPath,same.singlePath)).etag,before.etag,'unchanged resources preserve disk versions');
 await files.open({name:'attached.pdf',data:pdf('Updated PDF content').toString('base64'),resourceKey:'resource://one'});const after=await latex.read(imported.rootPath,imported.singlePath);assert.notEqual(after.fingerprint,before.fingerprint);assert.match(after.text,/Updated PDF content/);
 await assert.rejects(()=>files.open({name:'../escape.pdf',data:''}),/Invalid file name/);await assert.rejects(()=>files.open({name:'file.pdf',data:'!bad'}),/Invalid file data/);
 const textPath=join(folder,'single.md');await writeFile(textPath,'# Original');const textTree=await files.open({path:textPath});const snapshot=await workspace.read(textTree.rootPath,textTree.singlePath);await workspace.save(textTree.rootPath,textTree.singlePath,'# Edited',snapshot.etag);assert.equal(await readFile(textPath,'utf8'),'# Edited');
 const known=workspaceAccess(async()=>[{uri:pathToFileURL(folder).href}]);const knownTree=await singleFileService(known).open({path});assert.equal(knownTree.root.children.length,3);assert.equal((await latexService(known).read(knownTree.rootPath,knownTree.singlePath)).main,'main.tex','existing source-project access enables mapping');
 console.log('Single PDF display, SVG, review finalization, resource refresh, isolated access, text saves, and known LaTeX source checks passed');
}finally{await rm(temp,{recursive:true,force:true});}
