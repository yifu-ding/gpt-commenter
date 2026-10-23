import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export async function revealInFinder(workspace,root,path,{platform=process.platform,run=execute}={}){
 if(platform!=='darwin')throw Error('Reveal in Finder is available on macOS only.');
 const target=await workspace.resolve(root,path);
 await run('/usr/bin/open',['-R',target],{timeout:10000,maxBuffer:8192});
 return {revealed:true};
}
