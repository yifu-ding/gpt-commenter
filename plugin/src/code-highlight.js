import hljs from './highlighter.js';
import {StateField} from '@codemirror/state';
import {EditorView,Decoration} from '@codemirror/view';
// Fallback for languages without a CodeMirror parser. All token rules come from Highlight.js.
export function fallbackHighlight(name){
 function marks(state){const source=state.doc.toString();if(source.length>200000)return Decoration.none;
  const extension=name.split('.').at(-1).toLowerCase(),aliases={cs:'csharp',kt:'kotlin',m:'objectivec',mm:'objectivec',vue:'xml',svelte:'xml',bat:'dos',cmd:'dos',tf:'hcl',ex:'elixir',exs:'elixir',erl:'erlang',hs:'haskell',clj:'clojure',jl:'julia',ps1:'powershell'};
  const lang=aliases[extension] || extension;let html;try{html=hljs.getLanguage(lang)?hljs.highlight(source,{language:lang,ignoreIllegals:true}).value:hljs.highlightAuto(source).value;}catch{return Decoration.none;}
  const root=document.createElement('div');root.innerHTML=html;let offset=0;const ranges=[];
  function walk(node){const from=offset;if(node.nodeType===3)offset+=node.textContent.length;else{for(const child of node.childNodes)walk(child);if(node.className && offset>from)ranges.push(Decoration.mark({class:node.className}).range(from,offset));}}walk(root);return Decoration.set(ranges,true);
 }
 return StateField.define({create:marks,update:(value,tr)=>tr.docChanged?marks(tr.state):value,provide:field=>EditorView.decorations.from(field)});
}
