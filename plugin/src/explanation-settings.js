import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
export const defaults={explanationModel:'gpt-6-luna',treePosition:'left',themeColor:'host',showGitChanges:true,outlinePosition:'left'};
export const settingsSchema={type:'object',properties:{
  explanationModel:{type:'string',title:'Explanation model',description:'Model for background Codex conversations; a preference when using host sampling. Model access is required.',enum:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra']}
,
  treePosition:{type:'string',title:'File tree position',description:'Default side for the file tree.',enum:['left','right']},
  themeColor:{type:'string',title:'Theme color',description:'Host follows the host accent. Other colors are MarkAtlas presets.',enum:['host','blue','purple','pink','red','orange','yellow','green','teal','gray']},
  showGitChanges:{type:'boolean',title:'Show git changes',description:'Show added and removed line counts in the file tree.'},
  outlinePosition:{type:'string',title:'Outline position',description:'Default side for Markdown and PDF outlines.',enum:['left','right']}
},required:Object.keys(defaults),additionalProperties:false};
export const settingsLayout=[{kind:'group',title:'Appearance',items:[{kind:'property',property:'treePosition'},{kind:'tool',tool:'markatlas_theme_color',description:'Choose Host or a preset color with a color sample.'},...['showGitChanges','outlinePosition'].map(property=>({kind:'property',property}))]},{kind:'group',title:'History',items:[{kind:'tool',tool:'markatlas_clear_recently_opened',description:'Clear only the file tree recently opened list. Confirmation required; comments and other caches are kept.'}]},{kind:'group',title:'Explanations',items:[{kind:'property',property:'explanationModel'}]}];
// Presentation labels are separate from stored values, preserving existing preferences.
export function presentSettings(preferences){
 const properties={...settingsSchema.properties};delete properties.themeColor;
 const values={...preferences};delete values.themeColor;
 for(const key of ['treePosition','outlinePosition']){
  properties[key]={...properties[key],enum:['Left','Right']};values[key]=preferences[key]==='right'?'Right':'Left';
 }
 return {schema:{...settingsSchema,properties,required:Object.keys(properties)},layout:settingsLayout,values,preferences};
}
export function normalizeSettingLabels(set){return Object.fromEntries(Object.entries(set).map(([key,value])=>[key,['treePosition','outlinePosition'].includes(key) && typeof value==='string'?value.toLowerCase():value]));}
export function explanationSettings(base=process.env.PLUGIN_DATA || join(homedir(),'.config','markatlas')){
  const path=join(base,'explanation-settings.json');let queue=Promise.resolve();
  function validate(values){for(const [key,value] of Object.entries(values))if(!Object.hasOwn(settingsSchema.properties,key) || (settingsSchema.properties[key].type==='boolean'?typeof value!=='boolean':!settingsSchema.properties[key].enum.includes(value)))throw Error(`Invalid explanation setting: ${key}`);return values;}
  async function read(){try{return {...defaults,...validate(JSON.parse(await readFile(path,'utf8')))};}catch(error){if(error.code==='ENOENT')return {...defaults};throw error;}}
  async function historyRevision(){try{return await readFile(join(base,'recent-history-revision'),'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}}
  async function clearRecentHistory(){await mkdir(base,{recursive:true,mode:0o700});const revision=randomUUID(),path=join(base,'recent-history-revision'),temp=`${path}.${revision}.tmp`;await writeFile(temp,revision,{mode:0o600});await rename(temp,path);return revision;}
  return {read,historyRevision,clearRecentHistory,update(set){const work=queue.catch(()=>{}).then(async()=>{if(!Object.keys(set).length)throw Error('Set at least one setting.');validate(set);const values={...await read(),...set};await mkdir(base,{recursive:true,mode:0o700});const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(values),{mode:0o600});await rename(temp,path);return values;});queue=work;return work;}};
}
