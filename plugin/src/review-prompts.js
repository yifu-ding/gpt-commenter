export function reviewExcerpt(text='') {
  const chars=Array.from(text.replace(/\s+/gu,' ').trim());
  return chars.length>180?`${chars.slice(0,88).join('').trimEnd()} … ${chars.slice(-89).join('').trimStart()}`:chars.join('');
}
export function relativeReviewPath(path,root) {
  const base=(root || '').replace(/\/$/,'');
  return base && path?.startsWith(`${base}/`)?path.slice(base.length+1):path;
}
const wordLimits={short:150,medium:400,long:900};
export function selectionPrompt(item,{fullSelection=false,wordLimit=false}={}) {
  const p=item.pdf,root=p?.root || item.projectRoot,explain=item.kind==='explanation';
  const file=p?.path || relativeReviewPath(item.sourcePath,root) || item.sourceName;
  const title=p?.main?'LaTeX PDF':p?.region?'PDF screenshot':p?'PDF':item.word?'Word':'File';
  const lines=[`${title} ${explain?'explanation':'review'}`];
  if(root)lines.push(`Project: ${root}`);
  lines.push(p?`${file} · PDF page ${p.page}${p.endPage && p.endPage!==p.page?`–${p.endPage}`:''}`:`${item.word?'Word':'File'}: ${file}${item.word?' · selected passage':` · lines ${item.startLine}–${item.endLine}`}`);
  if(p?.source?.status==='located')lines.push(`LaTeX: ${relativeReviewPath(p.source.sourcePath || p.source.path,root)} · lines ${p.source.line}–${p.source.endLine}`);
  else if(p?.main)lines.push(`LaTeX: ${relativeReviewPath(p.main,root)} · locate the quoted passage.`);
  if(p?.region)lines.push(`Region in PDF points: ${JSON.stringify(p.region)}`);
  if(item.html)lines.push('HTML rendered selection. Verify the visible content against the HTML source before editing.');
  if(item.html?.region)lines.push(`Region in CSS pixels: ${JSON.stringify(item.html.region)}`);
  if(p?.screenshot || item.html?.screenshot)lines.push('Screenshot: attached for this selection.');
  if(explain && item.detail)lines.push(`Detail: ${item.detail}${wordLimit?` (about ${wordLimits[item.detail]} words)`:''}`);
  // A background explanation has no file-reading tools, so it needs the full selection.
  const referenced=!!item.sourcePath && !item.hasUnsavedEdits && /^[a-f0-9]{64}$/i.test(item.documentHash || '');
  const quote=fullSelection?item.selectedText || '':p || referenced?reviewExcerpt(item.selectedText):item.selectedText || '';
  if(quote)lines.push('',fullSelection?`<selection>\n${quote}\n</selection>`:quote.split('\n').map(line=>`> ${line}`).join('\n'));
  if(explain && item.explanationPrompt?.trim())lines.push('',`User explanation instructions: ${item.explanationPrompt.trim()}`);
  if(explain)lines.push('','Explain the selected passage or screenshot in context. Do not edit files.');
  else {
    lines.push('',`Comment: ${item.message}`,'');
    lines.push(p?.main?'Edit the .tex source and recompile if applicable.':p?'No matching editable source. Use appropriate PDF tools if changes are requested.':item.word?'Apply the comment using DOCX-aware tools and preserve formatting.':'Apply the comment to the referenced file and preserve existing user edits.');
  }
  return lines.join('\n');
}
