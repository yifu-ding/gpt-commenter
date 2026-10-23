import {parseDocument,isMap,isSeq,isScalar} from 'yaml';

// Render frontmatter as data, never HTML. Keep source ranges for annotation mapping.
export function renderProperties(parent,yaml,sourceStart,writeText){
 const doc=parent.ownerDocument,parsed=parseDocument(yaml,{uniqueKeys:true});
 if(parsed.errors.length || !isMap(parsed.contents))return false;
 try{parsed.toJS({maxAliasCount:50});}catch{return false;}
 const section=doc.createElement('details');section.className='metadata metadata-properties';section.open=true;
 const summary=doc.createElement('summary');summary.textContent='Properties';section.append(summary);
 const rows=doc.createElement('dl');section.append(rows);
 const paths={title:'M4 6h16M4 12h16M4 18h10',aliases:'M4 18v-5a5 5 0 0 1 5-5h10m-5-5 5 5-5 5',tags:'m3 3 8 0 10 10-8 8L3 11Z M7 7h.01',cssclasses:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',date:'M5 5h14v16H5ZM8 2v6M16 2v6M5 10h14'};
 for(const pair of parsed.contents.items){
  if(!isScalar(pair.key))return false;
  const key=String(pair.key.value),term=doc.createElement('dt'),value=doc.createElement('dd');
  const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.6');icon.setAttribute('aria-hidden','true');
  const path=doc.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',paths[key] || (/^(created|updated|date|modified)$/i.test(key)?paths.date:paths.title));icon.append(path);
  const label=doc.createElement('span');label.textContent=key;term.append(icon,label);rows.append(term,value);
  function render(item,chip=false){
   const el=doc.createElement('span');el.className=key==='tags'?'metadata-tag':chip?'metadata-chip':'metadata-value';
   let display;if(isScalar(item))display=item.value===null?'—':String(item.value);else if(item==null)display='—';else display=String(item.toString());
   if(item?.range)writeText(el,display,sourceStart+item.range[0],sourceStart+item.range[1]);else el.textContent=display;
   value.append(el);
  }
  if(isSeq(pair.value)){for(const item of pair.value.items)render(item,true);if(!pair.value.items.length)render(null);}else render(pair.value);
 }
 parent.append(section);return true;
}
