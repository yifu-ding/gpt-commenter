import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Called only for a user-requested HTML preview URL returned by our loopback server.
export async function launchPreviewBrowser(url,{platform=process.platform,execute=run}={}){
  const parsed=new URL(url);
  if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!parsed.port)throw Error('Invalid preview URL.');
  if(platform!=='darwin')return false;
  // The desktop browser route bypasses the system HTTP browser preference.
  const deepLink=`codex://browser?url=${encodeURIComponent(parsed.href)}`;
  await execute('/usr/bin/open',['-b','com.openai.codex',deepLink],{timeout:10000});return true;
}
