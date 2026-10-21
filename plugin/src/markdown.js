import {fromMarkdown} from 'mdast-util-from-markdown';
import {decodeString} from 'micromark-util-decode-string';
import {gfmTable} from 'micromark-extension-gfm-table';
import {gfmTableFromMarkdown} from 'mdast-util-gfm-table';

export function normalize(text) { return text.replace(/\r\n?/g, '\n'); }
export function sourceSelection(source, start, end, selectedText = source.slice(start, end)) {
  return {startOffset: start, endOffset: end, selectedText,
    startLine: source.slice(0, start).split('\n').length,
    endLine: source.slice(0, Math.max(start, end - 1)).split('\n').length};
}

// Keep a map for every displayed text boundary, including Markdown escapes/entities.
function boundaries(raw, value, start) {
  const map = [start];
  let decoded = '';
  for (let i = 0; i < raw.length;) {
    const match = /^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]+);)/.exec(raw.slice(i));
    const unit = match ? match[0] : raw[i];
    const text = match ? decodeString(unit) : unit;
    for (let j = 0; j < text.length; j++) map.push(start + i + (j === text.length - 1 ? unit.length : 0));
    decoded += text;
    i += unit.length;
  }
  return decoded === value ? map : null;
}

export function renderMarkdown(container, source, mode, items = []) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const mappings = new WeakMap(),mappedNodes=[];
  const markers = new Set();
  function text(parent, value, start, end, map = null) {
    const exact = map || (source.slice(start, end) === value ? Array.from({length: value.length + 1}, (_, i) => start + i) : null);
    const cuts = new Set([0, value.length]);
    if (exact) for (const item of items) {
      for (const offset of [item.startOffset, item.endOffset]) {
        const index = exact.indexOf(offset);
        if (index >= 0) cuts.add(index);
      }
    }
    const points = [...cuts].sort((a,b) => a-b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i+1];
      const lo = exact ? exact[a] : start, hi = exact ? exact[b] : end;
      const active = items.filter(item => item.startOffset < hi && item.endOffset > lo);
      const node = doc.createTextNode(value.slice(a,b));
      mappedNodes.push(node);mappings.set(node, {start: lo, end: hi, boundaries: exact?.slice(a,b+1)});
      let target = parent;
      if (active.length) {
        target = doc.createElement('mark');
        target.dataset.annotation = active[0].id;
        if (active.some(item => item.temporary)) target.classList.add('pending-selection');
        parent.append(target);
      }
      target.append(node);
      for (const item of active) if (!item.temporary && item.endOffset <= hi && !markers.has(item.id)) {
        const icon = doc.createElement('button');
        icon.className = 'annotation-icon';icon.contentEditable='false';
        icon.dataset.itemId = item.id;
        icon.setAttribute('aria-label', `${item.kind === 'comment' ? 'Comment' : 'Explanation'} on lines ${item.startLine}–${item.endLine}`);
        icon.title = item.kind === 'comment' ? item.message : 'Explanation request';
        icon.textContent = item.kind === 'comment' ? '▤' : '?';
        parent.append(icon);
        markers.add(item.id);
      }
    }
  }
  function visit(node, parent) {
    const start = node.position?.start.offset ?? 0, end = node.position?.end.offset ?? start;
    if (node.type === 'table') {
      const table=doc.createElement('table'),head=doc.createElement('thead'),body=doc.createElement('tbody');
      table.append(head,body);parent.append(table);
      node.children.forEach((row,index)=>{
        const tr=doc.createElement('tr');(index===0 ? head : body).append(tr);
        row.children.forEach((cell,column)=>{
          const td=doc.createElement(index===0 ? 'th' : 'td');
          if(index===0)td.scope='col';
          if(node.align[column])td.style.textAlign=node.align[column];
          tr.append(td);for(const child of cell.children)visit(child,td);
        });
      });
      return;
    }
    if (node.type === 'text') {text(parent, node.value, start, end, boundaries(source.slice(start,end), node.value, start)); return;}
    if (node.type === 'inlineCode' || node.type === 'code') {
      const code = doc.createElement('code');
      const wrap = node.type === 'code' ? doc.createElement('pre') : code;
      if (wrap !== code) wrap.append(code);
      parent.append(wrap);
      const raw = source.slice(start,end);
      let offset = -1;
      if (node.type === 'code') {
        const fence = /^(?: {0,3})(?:`{3,}|~{3,})[^\n]*\n/.exec(raw);
        if (fence && raw.slice(fence[0].length).startsWith(node.value)) offset = start + fence[0].length;
      } else if (/^`+/.test(raw)) {
        const ticks = /^`+/.exec(raw)[0].length;
        if (raw.slice(ticks, raw.length-ticks) === node.value) offset = start + ticks;
      }
      text(code, node.value, offset >= 0 ? offset : start, offset >= 0 ? offset + node.value.length : end);
      return;
    }
    if (node.type === 'html') {text(parent, source.slice(start,end), start,end); return;}
    if (node.type === 'image') {text(parent, node.alt || '[Image]', start,end); return;}
    if (node.type === 'break') {parent.append(doc.createElement('br')); return;}
    if (node.type === 'thematicBreak') {parent.append(doc.createElement('hr')); return;}
    if (node.type === 'definition') return;
    const tags = {root: null, paragraph:'p', heading:`h${node.depth}`, emphasis:'em', strong:'strong', blockquote:'blockquote', list:node.ordered?'ol':'ul', listItem:'li', link:'a', linkReference:'span'};
    const tag = tags[node.type] || (node.type === 'root' ? null : 'span');
    const target = tag ? doc.createElement(tag) : parent;
    if (tag) parent.append(target);
    if (node.type === 'list' && node.ordered && node.start) target.start = node.start;
    if (node.type === 'link' && /^(https?:|mailto:|#)/i.test(node.url)) {
      target.href = node.url; target.rel = 'noopener noreferrer'; target.target = '_blank';
    }
    for (const child of node.children || []) visit(child, target);
  }
  if (mode === 'source') {
    const pre = doc.createElement('pre'); pre.className = 'source'; container.append(pre);
    text(pre, source, 0, source.length);
  } else visit(fromMarkdown(source,{extensions:[gfmTable()],mdastExtensions:[gfmTableFromMarkdown()]}), container);
  function endpoint(node, offset, end) {
      if (node.nodeType === 3) {
        const m = mappings.get(node);
        return m ? {offset: m.boundaries ? m.boundaries[offset] : end ? m.end : m.start, exact: !!m.boundaries} : null;
      }
      const walker = doc.createTreeWalker(node, 4);
      const nodes = [];
      while (walker.nextNode()) if (mappings.has(walker.currentNode)) nodes.push(walker.currentNode);
      const child = end ? node.childNodes[offset - 1] : node.childNodes[offset];
      const contained = child && nodes.filter(n => child === n || child.contains?.(n));
      const chosen = contained?.length ? (end ? contained.at(-1) : contained[0]) : (end ? nodes.at(-1) : nodes[0]);
      return chosen ? endpoint(chosen, end ? chosen.length : 0, end) : null;
    }
  function resolve(range){
    const a = endpoint(range.startContainer, range.startOffset, false);
    const b = endpoint(range.endContainer, range.endOffset, true);
    if(!a || !b)return null;
    return {startOffset:a.offset,endOffset:b.offset,mappingStatus:a.exact && b.exact ? 'exact' : 'source-span'};
  }
  function pointAt(offset){
    let found=null,distance=Infinity,index=0;
    for(const node of mappedNodes){const m=mappings.get(node);if(!m.boundaries)continue;for(let i=0;i<m.boundaries.length;i++){const d=Math.abs(m.boundaries[i]-offset);if(d<distance){found=node;distance=d;index=i;}}}
    return found?{node:found,index}:null;
  }
  return {resolve,selectSpan(from,to){
    const a=pointAt(from),b=pointAt(to);if(!a || !b)return;
    const range=doc.createRange();range.setStart(a.node,a.index);range.setEnd(b.node,b.index);
    const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
  },selection(range,selectedText){
    const span=resolve(range);
    if(!span || span.startOffset>=span.endOffset || !selectedText.trim())return null;
    return {...sourceSelection(source,span.startOffset,span.endOffset,selectedText),mappingStatus:span.mappingStatus};
  },appendCaret(offset){
    const p=doc.createElement('p'),node=doc.createTextNode('');p.append(node,doc.createElement('br'));container.append(p);mappings.set(node,{start:offset,end:offset,boundaries:[offset]});mappedNodes.push(node);
  },focusAt(offset){
    let found=null,distance=Infinity,index=0;
    for(const node of mappedNodes){const m=mappings.get(node);if(!m.boundaries)continue;for(let i=0;i<m.boundaries.length;i++){const d=Math.abs(m.boundaries[i]-offset);if(d<distance){found=node;distance=d;index=i;}}}
    if(found){const range=doc.createRange();range.setStart(found,index);range.collapse(true);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);}
  }};
}
