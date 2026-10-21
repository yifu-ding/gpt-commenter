import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
export function explanationStore(base = process.env.PLUGIN_DATA || join(tmpdir(),'gpt-commenter-data')) {
  const folder=join(base,'explanation-requests');
  function path(id) {if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new Error('Invalid request ID');return join(folder,`${id}.json`);}
  async function save(record) {
    await mkdir(folder,{recursive:true,mode:0o700});
    const target=path(record.requestId), temp=`${target}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(record),{mode:0o600}); await rename(temp,target);
  }
  async function read(id) {
    const record=JSON.parse(await readFile(path(id),'utf8'));
    if (Date.now()-record.createdAt>24*60*60*1000) throw new Error('Explanation request expired');
    return record;
  }
  return {async remove(id) {await rm(path(id),{force:true});},async create(annotation) {const record={requestId:randomUUID(),annotationId:annotation.id,createdAt:Date.now(),status:'pending'};await save(record);return record;},read,
    async answer(id,answer) {const record=await read(id);if (record.status !== 'pending') throw new Error('This request already has an answer');const next={...record,status:'answered',answer};await save(next);return next;}};
}
