import {execFile} from 'node:child_process';
import {access,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,delimiter} from 'node:path';
import {tmpdir} from 'node:os';

async function codexCommand(){
  const candidates=process.env.MARKATLAS_CODEX_PATH?[process.env.MARKATLAS_CODEX_PATH]:[
    ...(process.env.PATH || '').split(delimiter).filter(Boolean).map(folder=>join(folder,'codex')),
    '/opt/homebrew/bin/codex','/usr/local/bin/codex'];
  for(const command of candidates){try{await access(command,constants.X_OK);return command;}catch{}}
  throw Error('Background explanations need the Codex CLI. Install it and sign in, or set MARKATLAS_CODEX_PATH to its executable.');
}

// Each invocation creates a fresh ephemeral conversation. No desktop chat or tab
// is opened, and no project directory is used as the working directory.
export async function codexExplanation({prompt,image,model,signal},{run=execFile,command=codexCommand,timeout=180000}={}){
  const executable=await command(),folder=await mkdtemp(join(tmpdir(),'markatlas-explain-'));
  try{
    const output=join(folder,'answer.md');
    const args=['exec','--ephemeral','--ignore-user-config','--sandbox','read-only','--skip-git-repo-check',
      '--color','never','--model',model,'--output-last-message',output];
    if(image){const path=join(folder,image.mimeType==='image/png'?'selection.png':'selection.jpg');await writeFile(path,Buffer.from(image.data,'base64'),{mode:0o600});args.push('--image',path);}
    args.push('-');
    await new Promise((resolve,reject)=>{
      const child=run(executable,args,{cwd:folder,signal,timeout,killSignal:'SIGKILL',maxBuffer:1024*1024,windowsHide:true},error=>{
        if(!error)return resolve();
        if(error.name==='AbortError')return reject(error);
        reject(Error(error.killed?'The background explanation timed out. Try a shorter selection.':'The background Codex conversation failed. Check Codex CLI sign-in and access to the selected explanation model.'));
      });
      child.stdin.on('error',()=>{});child.stdin.end(prompt);
    });
    const answer=(await readFile(output,'utf8')).trim();
    if(!answer)throw Error('The background conversation returned no explanation.');
    return {answer,model};
  }finally{await rm(folder,{recursive:true,force:true});}
}
