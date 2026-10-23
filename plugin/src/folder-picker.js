import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
export function createFolderPicker({platform=process.platform,mode='folder',run=execute,bundle=fileURLToPath(new URL('./FolderPicker.app',import.meta.url))}={}) {
  let active=null;
  return async()=>{
    if(platform!=='darwin')throw Error(`The native ${mode} chooser is currently available on macOS only.`);
    if(active){const existing=active;existing.ready.then(()=>writeFile(existing.focus,'focus')).catch(()=>{});return existing.promise;}
    let ready;const operation={ready:new Promise(resolve=>{ready=resolve;})};active=operation;
    operation.promise=(async()=>{let directory;
      try {
      directory=await mkdtemp(join(tmpdir(),'markdown-folder-choice-'));
      const output=join(directory,'selection.json');
      operation.focus=output+'.focus';ready();
      // Launch the bundled native helper directly: avoid LaunchServices registration
      // and a new app-instance lookup on every click. AppKit activates its panel.
      await run(join(bundle,'Contents/MacOS/folder-picker'),[output,...(mode==='file'?['file']:[])],{maxBuffer:8192,timeout:185000});
      const result=JSON.parse(await readFile(output,'utf8'));
      if(result.timedOut===true)throw Error(`The ${mode} chooser timed out. Click the ${mode} button to try again.`);
      if(result.cancelled===true)return null;
      if(typeof result.path!=='string' || !result.path.startsWith('/'))throw Error(`The ${mode} chooser did not return a valid ${mode}.`);
      return result.path;
      } catch(error){if(error.killed || error.code==='ETIMEDOUT')throw Error(`The ${mode} chooser timed out. Click the ${mode} button to try again.`);throw error;}
      finally {ready();if(active===operation)active=null;if(directory)await rm(directory,{recursive:true,force:true});}
    })();return operation.promise;
  };
}
