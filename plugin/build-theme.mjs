import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import postcss from 'postcss';
import {transform} from 'esbuild';
import safeParser from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
const root=':where(#document.markdown-rendered, #explanation-answer.markdown-rendered)';
const sources=['blue-topaz.css','notation-purple.css'];
let output=`
:where(#document,#explanation-answer).markdown-rendered table{border-collapse:collapse;margin:1em 0;max-width:100%;font-variant-numeric:tabular-nums}
:where(#document,#explanation-answer).markdown-rendered :is(th,td){border:1px solid var(--edge);padding:8px 14px}
:where(#document,#explanation-answer).markdown-rendered th{font-weight:650;background:var(--surface)}
:where(#document,#explanation-answer).markdown-rendered .task-list-item-checkbox:checked::after{content:'';position:absolute;display:block;mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='m5 12 4 4L19 6l2 2L9 20l-6-6z'/%3E%3C/svg%3E") center/65% no-repeat}
`;
for(const name of sources){
 const source=readFileSync(new URL(`assets/obsidian/${name}`,import.meta.url),'utf8');
 // Obsidian-only decorative assets include malformed SVG URLs in this theme.
 // Keep originals intact; omit those declarations from the browser adaptation.
 const cleaned=name==='notation-purple.css'?source:source.replace(/^.*(?:url\(|@import|^[ \t]*content\s*:).*$/gm,'').replace(/and\(/g,'and (');
 const css=name==='notation-purple.css'?postcss.parse(cleaned):safeParser(cleaned);
 css.walkAtRules('import',r=>r.remove());
 css.walk(node=>{node.raws={};});
 css.walkComments(node=>{if(!/MIT License|Copyright|Partial style|sourced or adapted/.test(node.text))node.remove();});
 css.walkRules(rule=>{
   if(!rule.selector?.trim()){rule.remove();return;}
   if(rule.parent?.type==='atrule' && /keyframes$/i.test(rule.parent.name))return;
   rule.selector=rule.selector.replace(/(?:body|html|:root)\s+(?::is\(\.markdown-rendered,\s*\.markdown-source-view\)|\.markdown-rendered|\.markdown-preview-view)/g,'.markdown-rendered');
   try{rule.selector=selectorParser(selectors=>selectors.each(selector=>{
     let anchored=false;
     selector.walk(node=>{
       if((node.type==='tag' && ['body','html'].includes(node.value)) || (node.type==='pseudo' && node.value===':root')){node.replaceWith(selectorParser.pseudo({value:root}));anchored=true;}
     });
     // Obsidian root classes must apply to the preview itself, not the host body.
     const first=selector.nodes[0];
     if(!anchored && first?.type==='class' && ['theme-light','theme-dark','markdown-rendered','markdown-preview-view','markdown-reading-view'].includes(first.value)){first.spaces.before='';selector.prepend(selectorParser.pseudo({value:root}));anchored=true;}
     if(!anchored){selector.prepend(selectorParser.combinator({value:' '}));selector.prepend(selectorParser.pseudo({value:root}));}
   })).processSync(rule.selector);}catch{rule.remove();}
 });
 const rules=await Promise.all(css.nodes.map(async node=>{const result=await transform(node.toString(),{loader:'css',minify:true,logLevel:'silent'});return result.warnings.length?'':result.code;}));
 output+=`/* ${name}: copied from the user's active Obsidian configuration */\n`+rules.join('\n');
}
let katex=readFileSync(new URL('node_modules/katex/dist/katex.min.css',import.meta.url),'utf8');
katex=katex.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)|,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g,'');
katex=katex.replace(/url\((fonts\/[^)]+)\)/g,(_,name)=>`url(data:font/${name.endsWith('.woff2')?'woff2':name.endsWith('.woff')?'woff':'ttf'};base64,${readFileSync(new URL(`node_modules/katex/dist/${name}`,import.meta.url)).toString('base64')})`);
output+=katex+readFileSync(new URL('node_modules/highlight.js/styles/github.css',import.meta.url),'utf8');
output+=`\n#document.markdown-rendered{--font-text:system-ui,sans-serif;--font-monospace:ui-monospace,monospace;--text-normal:var(--fg);--background-primary:var(--bg);--text-muted:var(--muted);--interactive-accent:#6158df;--text-accent:var(--notation-purple);--text-faint:var(--muted);--checkbox-size:16px;--checkbox-border-color:#9aa0a6;--tag-size:0.9em;font-size:calc(14px * var(--text-scale,1));line-height:1.5;color:var(--fg);background:var(--bg)}
#document.markdown-rendered p{margin-block:.6em}#document.markdown-rendered :is(ul,ol){margin-block:.5em}#document.markdown-rendered li>p{margin-block:.2em}#document.markdown-rendered img{max-width:100%;height:auto}#document.markdown-rendered .callout{margin:1em 0}#document.markdown-rendered .callout-title{font-weight:650;cursor:pointer}#document.markdown-rendered .task-list-item{list-style:none;margin:.15em 0;padding-left:0}#document.markdown-rendered .task-list-item>p{display:inline;margin:0}#document.markdown-rendered .task-list-item-checkbox{vertical-align:middle;flex-shrink:0;cursor:pointer;opacity:1}#document.markdown-rendered .task-list-item-checkbox{margin-right:8px}#document.markdown-rendered mark:not([data-annotation]){background:#eee5ff;color:inherit}#document.markdown-rendered .image-embed.internal-embed{border:0;padding:0;display:inline-block;max-width:100%}#document.markdown-rendered .internal-embed{border:1px solid var(--edge);border-radius:8px;padding:12px;display:block}#document.markdown-rendered .katex-display{overflow:auto}#document.markdown-rendered .mermaid svg{max-width:100%;height:auto}#document.markdown-rendered .metadata{font:12px ui-monospace,monospace;white-space:pre-wrap;color:var(--muted)}
`;
for(const [state,symbol] of Object.entries({'+':'+',B:'✦',a:'◷',n:'▤',R:'↻',t:'◴',L:'♥'}))output+=`
#document.markdown-rendered input.task-list-item-checkbox[data-task="${state}"]{border:0;border-radius:0;background:transparent}#document.markdown-rendered input.task-list-item-checkbox[data-task="${state}"]::after{content:"${symbol}";display:block;position:absolute;inset:0;line-height:16px;text-align:center;color:var(--notation-purple);font:700 16px/16px system-ui;mask:none;background:transparent}`;
mkdirSync(new URL('dist/',import.meta.url),{recursive:true});writeFileSync(new URL('dist/obsidian.css',import.meta.url),output);

