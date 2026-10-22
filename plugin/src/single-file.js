import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
export function singleFileService(workspace,base=process.env.PLUGIN_DATA || join(tmpdir(),'gpt-commenter-data')){
  return {
    async open({path,name,data,resourceKey}){
      if(path){
        const file=await workspace.connectFile(path);
        const target=await workspace.resolve(file.rootPath,file.singlePath);
        return {...await workspace.list(file.rootPath),singlePath:file.singlePath,sourcePath:target};
      }
      if(!name || basename(name)!==name || name==='.' || name==='..' || /[\\/\0]/.test(name))throw Error('Invalid file name.');
      if(typeof data!=='string' || data.length>70*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('Invalid file data.');
      const bytes=Buffer.from(data,'base64');if(bytes.length>50*1024*1024)throw Error('Choose a file smaller than 50 MB.');
      const id=createHash('sha256').update(resourceKey || bytes).update(name).digest('hex');
      const dir=join(base,'single-files',id),target=join(dir,name);await mkdir(dir,{recursive:true,mode:0o700});
      let same=false;try{same=bytes.equals(await readFile(target));}catch{}
      if(!same){const temporary=join(dir,`.${randomUUID()}.tmp`);await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,target);}
      return {...await workspace.connectFile(target),imported:true};
    }
  };
}
