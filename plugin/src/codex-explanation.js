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

export function codexFailure(error,stdout='',stderr=''){
  const messages=[];
  for(const line of stdout.split('\n')){try{const event=JSON.parse(line);const message=event.type==='error'?event.message:event.type==='turn.failed'?event.error?.message:null;if(typeof message==='string' && !messages.includes(message))messages.push(message);}catch{}}
  if(messages.length)return messages.join('\n');
  const detail=stderr.replace(/\x1b\[[0-9;]*m/g,'').trim();
  if(detail){const lines=detail.split('\n'),at=lines.findLastIndex(line=>/^(?:error:|ERROR\b)/i.test(line.trim()));return (at>=0?lines.slice(at).join('\n'):detail);}
  if(error.killed)return 'The background explanation timed out. Try a shorter selection.';
  return error.message || `Codex exited with code ${error.code ?? 'unknown'}.`;
}

// Each invocation creates a fresh ephemeral conversation. No desktop chat or tab
// is opened, and no project directory is used as the working directory.
export async function codexExplanation({prompt,image,model,signal},{run=execFile,command=codexCommand,timeout=180000}={}){
  const executable=await command(),folder=await mkdtemp(join(tmpdir(),'markatlas-explain-'));
  try{
    const output=join(folder,'answer.md');
    const args=['exec','--ephemeral','--ignore-user-config','--sandbox','read-only','--skip-git-repo-check',
      '--color','never','--json','--model',model,'--output-last-message',output];
    if(image){const path=join(folder,image.mimeType==='image/png'?'selection.png':'selection.jpg');await writeFile(path,Buffer.from(image.data,'base64'),{mode:0o600});args.push('--image',path);}
    args.push('-');
    await new Promise((resolve,reject)=>{
      const child=run(executable,args,{cwd:folder,signal,timeout,killSignal:'SIGKILL',maxBuffer:1024*1024,windowsHide:true},(error,stdout,stderr)=>{
        if(!error)return resolve();
        if(error.name==='AbortError')return reject(error);
        reject(Error(codexFailure(error,stdout,stderr)));
      });
      child.stdin.on('error',()=>{});child.stdin.end(prompt);
    });
    const answer=(await readFile(output,'utf8')).trim();
    if(!answer)throw Error('The background conversation returned no explanation.');
    return {answer,model};
  }finally{await rm(folder,{recursive:true,force:true});}
}
