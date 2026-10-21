import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexExplanation} from './src/codex-explanation.js';
import {fakeCodex} from './test-fixtures/codex.mjs';
const folder=await mkdtemp(join(tmpdir(),'markatlas-background-test-'));
try{
  const command=async()=>fakeCodex(folder),options={command};
  const result=await codexExplanation({prompt:'Explain this selection. $(do not execute)',model:'gpt-6-luna',image:{mimeType:'image/png',data:'Y3JvcA=='}},options);
  assert.equal(result.answer,'Background explanation from a fresh conversation.');
  const trace=JSON.parse(await readFile(join(folder,'trace.json'),'utf8'));
  assert.equal(trace.prompt,'Explain this selection. $(do not execute)');assert.equal(trace.args.at(-1),'-');
  assert.ok(trace.args.includes('--ephemeral'));assert.ok(trace.args.includes('--ignore-user-config'));
  assert.equal(trace.args[trace.args.indexOf('--sandbox')+1],'read-only');assert.equal(trace.args[trace.args.indexOf('--model')+1],'gpt-6-luna');
  assert.equal(trace.imageExists,true);await assert.rejects(()=>access(trace.cwd),/ENOENT/);
  await assert.rejects(()=>codexExplanation({prompt:'TEST_FAILURE',model:'gpt-6-luna'},options),/conversation failed/);
  await assert.rejects(()=>codexExplanation({prompt:'TEST_EMPTY',model:'gpt-6-luna'},options),/no explanation/);
  await assert.rejects(()=>codexExplanation({prompt:'TEST_TIMEOUT',model:'gpt-6-luna'},{...options,timeout:100}),/timed out/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>codexExplanation({prompt:'Cancelled',model:'gpt-6-luna',signal:controller.signal},options),error=>error.name==='AbortError');
}finally{await rm(folder,{recursive:true,force:true});}
console.log('Background Codex conversation, image, cleanup, failure, timeout, and cancellation checks passed');
