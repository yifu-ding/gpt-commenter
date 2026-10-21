import {randomUUID} from 'node:crypto';
import {isSupportedText,isOfficeTemporary} from './file-types.js';
import {fileContent,fileLimit} from './file-content.js';
import {readdir,realpath,readFile,stat,open,rename,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,basename,dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildProject} from './project.js';
const fileVersion=info=>[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
const ignored=new Set(['.git','node_modules','.codex','.agents','.aws']);
export function workspaceAccess(getRoots,fallback=process.env.GPT_COMMENTER_PROJECT_ROOT) {
  let allowed=[];
  const connected=new Set(),singleFiles=new Map();
  async function roots() {
    let advertised=[];
    try{advertised=await getRoots();}catch{}
    const paths=advertised.filter(x=>x.uri?.startsWith('file:')).map(x=>fileURLToPath(x.uri));
    if(!paths.length && fallback)paths.push(fallback);
    allowed=await Promise.all(paths.map(p=>realpath(p)));
    return allowed;
  }
  async function inside(root,path) {
    const folderAccess=allowed.includes(root) || connected.has(root);
    if(!folderAccess && !singleFiles.has(root))throw Error('Project is no longer available. Refresh the file tree.');
    const target=await realpath(resolve(root,path)),rel=relative(root,target);
    if(rel.startsWith('..') || isAbsolute(rel) || rel.split('/').some(p=>ignored.has(p)))throw Error('File is outside the project.');
    if(!folderAccess && !singleFiles.get(root)?.has(target))throw Error('Only the selected file is connected. Open its folder to access other files.');
    return target;
  }
  return {
    async connectFile(filePath){
      if(!isAbsolute(filePath))throw Error('Choose a local file.');
      const target=await realpath(filePath),info=await stat(target);
      if(!info.isFile())throw Error('Choose a file, not a folder.');
      await roots();
      const folders=[...allowed,...connected].filter(folder=>{const rel=relative(folder,target);return !rel.startsWith('..') && !isAbsolute(rel);}).sort((a,b)=>b.length-a.length);
      const root=folders[0] || dirname(target),path=relative(root,target);
      if(!singleFiles.has(root))singleFiles.set(root,new Set());singleFiles.get(root).add(target);
      return {singleFile:true,singlePath:path,rootPath:root,root:{name:basename(root),type:'directory',path:'',children:[{type:'file',name:basename(target),path,supported:true}]}};
    },
    async sourceDiscoveryAllowed(root){await roots();return allowed.includes(root) || connected.has(root);},
    async resolve(root,path){await roots();return inside(root,path);},
    async nativeOfficePath(root,path){
      await roots();const target=await inside(root,path);
      if(!/\.(docx|xlsx)$/i.test(target) || !(await stat(target)).isFile())throw Error('Choose a Word (.docx) or Excel (.xlsx) file.');
      return {path:target};
    },
    async list(folderPath) {
      let root;
      if(folderPath !== undefined) {
        const input=folderPath.trim().replace(/^~(?=\/|$)/,homedir());
        if(!isAbsolute(input))throw Error('Enter an absolute folder path, such as /Users/you/project.');
        root=await realpath(input);
        if(!(await stat(root)).isDirectory())throw Error('Choose a folder, not a file.');
      } else [root]=await roots();
      if(!root)throw Error('No workspace folder was shared by the app. Use Open folder to connect a local folder.');
      const files=[];let omitted=0,visited=0;
      async function walk(dir,prefix='',depth=0) {
        if(depth>20){omitted++;return;}
        const entries=await readdir(dir,{withFileTypes:true});
        for(const entry of entries) {
          if(++visited>10000){omitted++;break;}
          if(entry.isSymbolicLink() || ignored.has(entry.name) || isOfficeTemporary(entry.name) || entry.name==='.gpt-commenter-build'){omitted++;continue;}
          const path=prefix?`${prefix}/${entry.name}`:entry.name;
          if(entry.isDirectory())await walk(resolve(dir,entry.name),path,depth+1);
          else if(entry.isFile())files.push({name:entry.name,webkitRelativePath:`${basename(root)}/${path}`});
        }
      }
      await walk(root);const tree=buildProject(files);tree.root.name=basename(root);
      if(folderPath!==undefined)connected.add(root);
      return {root:tree.root,rootPath:root,omitted:omitted+tree.omitted};
    },
    async read(root,path,ifNoneMatch) {
      await roots();
      const target=await inside(root,path),info=await stat(target);
      if(!info.isFile() || info.size>fileLimit(path))throw Error('File exceeds the preview limit (5 MB for text, 20 MB for images and Word documents).');
      const etag=fileVersion(info);
      if(ifNoneMatch===etag)return {name:path,etag,notModified:true};
      return {name:path,...fileContent(path,await readFile(target)),etag};
    },
    async save(root,path,text,expectedEtag) {
      await roots();
      if(!isSupportedText(path))throw Error('This file type is not supported as text.');
      if(typeof text!=='string' || Buffer.byteLength(text)>5*1024*1024 || text.includes('\0'))throw Error('Text files must be smaller than 5 MB and contain valid text.');
      const target=await inside(root,path),before=await stat(target);
      if(!before.isFile() || before.size>5*1024*1024 || fileVersion(before)!==expectedEtag)throw Error('The file changed on disk. Save was stopped; your edits are still in the editor.');
      const bytes=await readFile(target);if(bytes.includes(0))throw Error('Binary files cannot be edited.');
      const original=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      const output=original.includes('\r\n') ? text.replace(/\r?\n/g,'\r\n') : text;
      if(Buffer.byteLength(output)>5*1024*1024)throw Error('Text files must be smaller than 5 MB.');
      const temporary=join(dirname(target),`.markdown-review-${randomUUID()}.tmp`);
      let handle;
      try {
        handle=await open(temporary,'wx',before.mode & 0o777);await handle.writeFile(output,'utf8');await handle.chmod(before.mode & 0o777);await handle.sync();await handle.close();handle=null;
        if(await inside(root,path)!==target || fileVersion(await stat(target))!==expectedEtag)throw Error('The file changed on disk. Save was stopped; your edits are still in the editor.');
        await rename(temporary,target);
      } finally {await handle?.close();await unlink(temporary).catch(()=>{});}
      return this.read(root,path);
    }
  };
}
