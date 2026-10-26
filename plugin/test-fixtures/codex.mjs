import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function fakeCodex(folder){
  const command=join(folder,'fake-codex.mjs');
  writeFileSync(command,`#!${process.execPath}
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const args=process.argv.slice(2),prompt=readFileSync(0,'utf8');
const image=args.includes('--image')?args[args.indexOf('--image')+1]:null;
writeFileSync(${JSON.stringify(join(folder,'trace.json'))},JSON.stringify({args,prompt,cwd:process.cwd(),imageExists:image?existsSync(image):false}));
if(prompt.includes('TEST_FAILURE')){process.stderr.write('ERROR: Model access denied');process.exit(1);}
if(prompt.includes('TEST_LIMIT')){console.log(JSON.stringify({type:'error',message:'You are out of Codex usage. Limit resets on October 24 at 09:00.'}));process.exit(1);}
if(prompt.includes('TEST_TIMEOUT'))await new Promise(resolve=>setTimeout(resolve,60000));
writeFileSync(args[args.indexOf('--output-last-message')+1],prompt.includes('TEST_EMPTY')?'':'Background explanation from a fresh conversation.');
`,{mode:0o700});
  return command;
}
