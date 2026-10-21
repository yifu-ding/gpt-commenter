import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,access,realpath,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {workspaceAccess} from './src/workspace.js';import {latexService,parsePdfText} from './src/latex.js';
import {moveAnnotations} from './src/annotation-edits.js';import {randomUUID} from 'node:crypto';
const xml='<doc><page width="612" height="792"><flow><block><line><word xMin="10" yMin="20" xMax="40" yMax="30">A&amp;B</word></line></block></flow></page></doc>';
assert.equal(parsePdfText(xml).text,'A&B\n\n');assert.equal(parsePdfText(xml).pages[0].words[0].endOffset,3);
await assert.rejects(async()=>parsePdfText('bad'),/unreadable/);
async function findTool(name){for(const base of [...(process.env.PATH || '').split(':'),'/Library/TeX/texbin','/opt/homebrew/bin','/usr/bin']){const candidate=join(base,name);try{await access(candidate);return candidate;}catch{}}}
const latexmk=await findTool('latexmk');
if(!latexmk || !(await findTool('synctex')) || !(await findTool('pdftotext')) || !(await findTool('pdftoppm')) || !(await findTool('pdftocairo'))){console.log('LaTeX integration skipped: install a TeX toolchain and Poppler to run this test.');process.exit(0);}
const root=await realpath(await mkdtemp(join(tmpdir(),'latex-review-')));
try{
  const main='\\documentclass{article}\n\\begin{document}\n\\input{chapter}\n\\end{document}\n';
  await writeFile(join(root,'main.tex'),main);await writeFile(join(root,'chapter.tex'),'A uniquely selected passage for review.\n');
  const workspace=workspaceAccess(async()=>[]);await workspace.list(root);const service=latexService(workspace);
  let runNumber=0;async function compile(){const out=join(root,`test-build-${++runNumber}`);await mkdir(out);await promisify(execFile)(latexmk,['-norc','-pdf','-synctex=1','-interaction=nonstopmode','-halt-on-error','-no-shell-escape',`-outdir=${out}`,join(root,'main.tex')],{cwd:root,env:{...process.env,PATH:`/Library/TeX/texbin:${process.env.PATH}`}});return service.read(root,`test-build-${runNumber}/main.pdf`);}
  const first=await compile();assert.equal(first.pages.length,1);assert.match(first.text,/uniquely selected/);
  assert.equal((await workspace.list(root)).root.children.some(n=>n.name==='.gpt-commenter-build'),false,'generated output stays out of the project tree');
  const start=first.text.indexOf('uniquely selected'),word=first.pages[0].words.find(w=>w.startOffset<=start&&w.endOffset>start);
  const selection={page:1,x:word.x,y:word.y,startOffset:start,quote:'uniquely selected passage',fingerprint:first.fingerprint};
  const location=await service.locate(root,first.path,selection);assert.equal(location.path,'chapter.tex');assert.equal(location.line,1);
  const syncOnly=await service.locate(root,first.path,{...selection,quote:'not a matching plain-text phrase'});assert.equal(syncOnly.method,'synctex','SyncTeX resolves included sources independently of exact text');
  const image=await service.page(root,first.path,1,first.fingerprint);assert.ok(image.image.startsWith('data:image/png;base64,iVBOR'));
  const vector=await service.page(root,first.path,1,first.fingerprint,'svg');assert.ok(vector.image.startsWith('data:image/svg+xml;base64,'));
  const svg=Buffer.from(vector.image.split(',')[1],'base64').toString();assert.match(svg,/<svg\b/);assert.match(svg,/<path\b/,'PDF glyphs remain vector paths rather than a page-sized bitmap');assert.doesNotMatch(svg,/<image\b/,'text-only test page does not rasterize its glyphs');
  assert.equal((await service.read(root,first.path,first.etag)).notModified,true);
  const standaloneRoot=join(root,'standalone');await mkdir(standaloneRoot);await workspace.list(standaloneRoot);
  await copyFile(join(root,first.path),join(standaloneRoot,'report.pdf'));
  const standalone=await service.read(standaloneRoot,'report.pdf');
  assert.equal(standalone.main,null);assert.match(standalone.text,/uniquely selected/);
  assert.ok((await service.page(standaloneRoot,'report.pdf',1,standalone.fingerprint,'svg')).image.startsWith('data:image/svg+xml'));
  assert.equal((await service.locate(standaloneRoot,'report.pdf',{...selection,fingerprint:standalone.fingerprint})).status,'unavailable');

  // A workspace may contain several independent LaTeX repositories.
  for(const folder of ['reports/intended','reports/unrelated']){
    await mkdir(join(root,folder,'build'),{recursive:true});
    await writeFile(join(root,folder,'main.tex'),main);
    await writeFile(join(root,folder,'chapter.tex'),'A uniquely selected passage for review.\n');
  }
  await copyFile(join(root,first.path),join(root,'reports/intended/build/report.pdf'));
  const nested=await service.read(root,'reports/intended/build/report.pdf');
  assert.equal(nested.main,'reports/intended/main.tex','nested PDF resolves its own project despite other workspace roots');
  const nestedLocation=await service.locate(root,nested.path,{...selection,fingerprint:nested.fingerprint});
  assert.equal(nestedLocation.path,'reports/intended/chapter.tex','text fallback stays within the resolved project');

  const note={id:randomUUID(),kind:'comment',startOffset:start,endOffset:start+selection.quote.length,selectedText:selection.quote};
  await writeFile(join(root,'chapter.tex'),'A short introduction.\n\nA uniquely revised passage for review.\n');

  const second=await compile();assert.notEqual(first.fingerprint,second.fingerprint);assert.match(second.text,/uniquely revised/);
  const moved=moveAnnotations([note],first.text,second.text)[0];assert.equal(moved.anchorStatus,'edited');assert.match(moved.selectedText,/revised/);
  const movedWord=second.pages[0].words.find(w=>w.endOffset>moved.startOffset);const mapped=await service.locate(root,second.path,{page:1,x:movedWord.x,y:movedWord.y,startOffset:moved.startOffset,quote:moved.selectedText,fingerprint:second.fingerprint});assert.equal(mapped.path,'chapter.tex');assert.equal(mapped.line,3);
  await assert.rejects(()=>service.locate(root,second.path,selection),/version changed/);
  await writeFile(join(root,'chapter.tex'),'\\ThisIsAnInvalidCommand\n');await assert.rejects(()=>compile(),/latexmk/);
  assert.equal((await service.read(root,second.path)).fingerprint,second.fingerprint,'failed build preserves the previous good PDF');
  await symlink('/etc/passwd',join(root,'escape.pdf'));await assert.rejects(()=>service.read(root,'escape.pdf'),/outside/);
  await assert.rejects(()=>service.read(root,'../outside.pdf'));
  console.log('Real LaTeX build, included-source SyncTeX, selectable coordinates, page raster, source-change rebuild, annotation relocation, stale version, failed-build preservation, and path boundaries passed');
}finally{await rm(root,{recursive:true,force:true});}
