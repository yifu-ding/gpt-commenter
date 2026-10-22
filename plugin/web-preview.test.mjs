import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {workspaceAccess} from './src/workspace.js';import {webPreviewService} from './src/web-preview.js';import {singleFileService} from './src/single-file.js';
const temp=await mkdtemp(join(tmpdir(),'markatlas-web-'));const root=await realpath(temp);const workspace=workspaceAccess(async()=>[]),service=webPreviewService(workspace);
try{
 await mkdir(join(root,'pages'));await writeFile(join(root,'pages','review.html'),'<script src="../app.js"></script>');await writeFile(join(root,'app.js'),'console.log("ok")');await mkdir(join(root,'.codex'));await writeFile(join(root,'.codex','secret'),'private');await symlink('/etc/passwd',join(root,'escape.txt'));
 await workspace.list(root);const opened=await singleFileService(workspace).open({path:join(root,'pages','review.html')});assert.equal(opened.rootPath,root);assert.equal(opened.singlePath,'pages/review.html');
 const {url}=await service.open(root,'pages/review.html');const response=await fetch(url);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(await response.text(),/script/);assert.equal((await fetch(new URL('../app.js',url))).status,200);
 assert.equal((await fetch(new URL('../.codex/secret',url))).status,404);assert.equal((await fetch(new URL('../escape.txt',url))).status,404);assert.equal((await fetch(new URL('/',url))).status,404);assert.equal((await fetch(url,{method:'POST'})).status,405);assert.equal((await service.open(root,'pages/review.html')).url,url);
 await assert.rejects(()=>service.open(root,'app.js'),/HTML/);
 console.log('HTML server, relative assets, root preservation, access boundaries and server reuse passed');
}finally{await service.close();await rm(root,{recursive:true,force:true});}
