import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readRecentHistory,rememberRecent,recentHistoryKey} from './recent-history.js';
export const defaults={explanationModel:'gpt-6-luna',treePosition:'left',themeColor:'host',showGitChanges:true,outlinePosition:'left'};
export const settingsSchema={type:'object',properties:{
  explanationModel:{type:'string',title:'Explanation model',description:'Model for background Codex conversations; a preference when using host sampling. Model access is required.',enum:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra']}
,
  treePosition:{type:'string',title:'File tree position',description:'Default side for the file tree.',enum:['left','right']},
  themeColor:{type:'string',title:'Theme color',description:'Host follows the host accent. Other colors are MarkAtlas presets.',enum:['host','blue','purple','pink','red','orange','yellow','green','teal','gray']},
  showGitChanges:{type:'boolean',title:'Show git changes',description:'Show added and removed line counts in the file tree.'},
  outlinePosition:{type:'string',title:'Outline position',description:'Default side for Markdown and PDF outlines.',enum:['left','right']}
},required:Object.keys(defaults),additionalProperties:false};
export const settingsLayout=[{kind:'group',title:'Appearance',items:[{kind:'property',property:'treePosition'},{kind:'property',property:'themeColor'},...['showGitChanges','outlinePosition'].map(property=>({kind:'property',property}))]},{kind:'group',title:'History',items:[{kind:'tool',tool:'markatlas_clear_recently_opened',description:'Clear only the file tree recently opened list. Confirmation required; comments and other caches are kept.'}]},{kind:'group',title:'Explanations',items:[{kind:'property',property:'explanationModel'}]}];
// Presentation labels are separate from stored values, preserving existing preferences.
export function presentSettings(preferences){
 const properties={...settingsSchema.properties};
 const values={...preferences};
 for(const key of ['treePosition','outlinePosition','themeColor']){
  const title=value=>value[0].toUpperCase()+value.slice(1);
  properties[key]={...properties[key],enum:properties[key].enum.map(title)};values[key]=title(preferences[key]);
 }
 return {schema:{...settingsSchema,properties,required:Object.keys(properties)},layout:settingsLayout,values,preferences};
}
export function normalizeSettingLabels(set){return Object.fromEntries(Object.entries(set).map(([key,value])=>[key,['treePosition','outlinePosition','themeColor'].includes(key) && typeof value==='string'?value.toLowerCase():value]));}
export function explanationSettings(base=process.env.PLUGIN_DATA || join(homedir(),'.config','markatlas')){
  const path=join(base,'explanation-settings.json');let queue=Promise.resolve();
  function validate(values){for(const [key,value] of Object.entries(values))if(!Object.hasOwn(settingsSchema.properties,key) || (settingsSchema.properties[key].type==='boolean'?typeof value!=='boolean':!settingsSchema.properties[key].enum.includes(value)))throw Error(`Invalid explanation setting: ${key}`);return values;}
  async function read(){try{return {...defaults,...validate(JSON.parse(await readFile(path,'utf8')))};}catch(error){if(error.code==='ENOENT')return {...defaults};throw error;}}
  async function historyRevision(){try{return await readFile(join(base,'recent-history-revision'),'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}}
  async function clearRecentHistory(){await mkdir(base,{recursive:true,mode:0o700});const revision=randomUUID(),path=join(base,'recent-history-revision'),temp=`${path}.${revision}.tmp`;await writeFile(temp,revision,{mode:0o600});await rename(temp,path);return revision;}
  // Browser storage can be scoped to an individual embedded viewer. Keep the
  // workspace list in plugin data so new viewers and server restarts share it.
  async function recentWorkspaces(){
    let saved;try{saved=JSON.parse(await readFile(join(base,'recent-workspaces.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!saved || saved.revision!==await historyRevision())return [];
    return readRecentHistory({getItem:key=>key===recentHistoryKey?JSON.stringify(saved.entries):null});
  }
  function rememberWorkspace(root){
    const work=queue.catch(()=>{}).then(async()=>{
      const revision=await historyRevision(),values=new Map([[recentHistoryKey,JSON.stringify(await recentWorkspaces())]]);
      const entries=rememberRecent({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},root);
      await mkdir(base,{recursive:true,mode:0o700});
      const target=join(base,'recent-workspaces.json'),temp=`${target}.${randomUUID()}.tmp`;
      await writeFile(temp,JSON.stringify({revision,entries}),{mode:0o600});await rename(temp,target);
      return entries;
    });queue=work;return work;
  }
  return {read,historyRevision,clearRecentHistory,recentWorkspaces,rememberWorkspace,update(set){const work=queue.catch(()=>{}).then(async()=>{if(!Object.keys(set).length)throw Error('Set at least one setting.');validate(set);const values={...await read(),...set};await mkdir(base,{recursive:true,mode:0o700});const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(values),{mode:0o600});await rename(temp,path);return values;});queue=work;return work;}};
}
