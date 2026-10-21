import {makeSelection, sha256, buildPayload} from './model.js';
const $ = id => document.getElementById(id);
let current = null;
let pending = null;
let items = [];
const storageKey = 'gpt-commenter-markdown-v1';
const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');

function save() {
  localStorage.setItem(storageKey, JSON.stringify({document: current, items}));
}
function render() {
  $('document-info').textContent = current ? `${current.name} · SHA-256 ${current.hash.slice(0, 12)}…` : '';
  $('editor').disabled = !current;
  $('capture').disabled = !current;
  $('queue-empty').hidden = items.length > 0;
  $('queue').replaceChildren();
  for (const [index, item] of items.entries()) {
    const li = document.createElement('li'); li.className = 'item';
    const title = document.createElement('strong'); title.textContent = `${item.kind === 'comment' ? 'Comment' : 'Explanation'} · lines ${item.startLine}–${item.endLine}`;
    const quote = document.createElement('p'); quote.textContent = item.selectedText;
    const request = document.createElement('p'); request.textContent = item.kind === 'comment' ? item.comment : `Detail: ${item.detail}`;
    const controls = document.createElement('div'); controls.className = 'row';
    for (const [label, action, disabled] of [
      ['Edit', () => edit(index), false],
      ['↑', () => move(index, -1), index === 0],
      ['↓', () => move(index, 1), index === items.length - 1],
      ['Remove', () => { items.splice(index, 1); save(); render(); }, false]
    ]) {
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label; button.disabled = disabled; button.onclick = action; controls.append(button);
    }
    li.append(title, quote, request, controls); $('queue').append(li);
  }
  const payload = current && items.length ? JSON.stringify(buildPayload(current, items), null, 2) : '';
  $('payload').value = payload;
  $('copy').disabled = !payload;
}
function move(index, delta) {
  const [item] = items.splice(index, 1); items.splice(index + delta, 0, item); save(); render();
}
function edit(index) {
  const item = items[index];
  const result = prompt(item.kind === 'comment' ? 'Edit comment' : 'Detail: short, medium, or long', item.kind === 'comment' ? item.comment : item.detail);
  if (result === null) return;
  const value = result.trim();
  if (!value || (item.kind === 'explanation' && !['short', 'medium', 'long'].includes(value))) return;
  if (item.kind === 'comment') item.comment = value; else item.detail = value;
  save(); render();
}
function capture() {
  if (!current) return;
  pending = makeSelection($('editor').value, $('editor').selectionStart, $('editor').selectionEnd);
  if (!pending) { $('selection-info').textContent = 'Select some text first.'; return; }
  $('selection-info').textContent = '';
  $('quote').textContent = pending.selectedText;
  $('location').textContent = `${current.name}, lines ${pending.startLine}–${pending.endLine}`;
  $('compose').hidden = false;
  $('comment').focus();
}
function setKind() {
  const explanation = document.querySelector('input[name=kind]:checked').value === 'explanation';
  $('comment-label').hidden = explanation;
  $('detail-label').hidden = !explanation;
}
$('file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  const text = await file.text();
  const hash = await sha256(text);
  current = {name: file.name, hash};
  $('editor').value = text;
  const previous = JSON.parse(localStorage.getItem(storageKey) || '{}');
  items = previous.document?.hash === hash && previous.document?.name === file.name ? previous.items || [] : [];
  $('compose').hidden = true;
  $('status').textContent = items.length ? 'Restored saved draft.' : '';
  save(); render();
};
$('capture').onclick = capture;
$('editor').onkeydown = event => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); capture(); } };
document.querySelectorAll('input[name=kind]').forEach(input => input.onchange = setKind);
$('cancel').onclick = () => { pending = null; $('compose').hidden = true; };
$('add').onclick = () => {
  if (!pending || !current) return;
  const kind = document.querySelector('input[name=kind]:checked').value;
  const comment = $('comment').value.trim();
  if (kind === 'comment' && !comment) { $('comment').focus(); return; }
  items.push({id: crypto.randomUUID(), ...pending, kind, comment, detail: $('detail').value});
  pending = null; $('comment').value = ''; $('compose').hidden = true;
  save(); render();
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('payload').value); $('status').textContent = 'Copied. Paste into your Codex chat.'; }
  catch { $('payload').focus(); $('payload').select(); $('status').textContent = 'Copy the selected payload manually.'; }
};
if (saved.document && saved.items?.length) $('status').textContent = `Draft saved for ${saved.document.name}. Reopen that file to restore it.`;
render();
