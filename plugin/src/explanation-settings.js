import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
export const defaults={explanationModel:'gpt-6-luna'};
export const settingsSchema={type:'object',properties:{
  explanationModel:{type:'string',title:'Explanation model',description:'Model for background Codex conversations; a preference when using host sampling. Model access is required.',enum:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra']}
},required:Object.keys(defaults),additionalProperties:false};
export function explanationSettings(base=process.env.PLUGIN_DATA || join(homedir(),'.config','markatlas')){
  const path=join(base,'explanation-settings.json');let queue=Promise.resolve();
  function validate(values){for(const [key,value] of Object.entries(values))if(!settingsSchema.properties[key]?.enum.includes(value))throw Error(`Invalid explanation setting: ${key}`);return values;}
  async function read(){try{return {...defaults,...validate(JSON.parse(await readFile(path,'utf8')))};}catch(error){if(error.code==='ENOENT')return {...defaults};throw error;}}
  return {read,update(set){const work=queue.catch(()=>{}).then(async()=>{if(!Object.keys(set).length)throw Error('Set at least one setting.');validate(set);const values={...await read(),...set};await mkdir(base,{recursive:true,mode:0o700});const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(values),{mode:0o600});await rename(temp,path);return values;});queue=work;return work;}};
}
