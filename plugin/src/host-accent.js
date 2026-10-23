// MCP Apps exposes semantic host colors, not Codex's private settings file.
export function applyHostAccent(context,root=document.documentElement){
 const variables=context?.styles?.variables;if(!variables)return;
 const valid=value=>typeof value==='string' && value.trim() && !/var\(|url\(|[;{}]/i.test(value) && root.ownerDocument.defaultView.CSS?.supports('color',value);
 for(const [token,property] of [['--color-text-info','--markatlas-accent'],['--color-background-info','--markatlas-accent-soft']]){
  const value=variables[token];if(valid(value))root.style.setProperty(property,value);else root.style.removeProperty(property);
 }
}
