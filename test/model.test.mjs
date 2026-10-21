import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../public/model.js', import.meta.url), 'utf8');
const model = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const {makeSelection, buildPayload} = model;
{
  assert.deepEqual(makeSelection('# Title\nAlpha\nBeta', 8, 18), {
    selectedText: 'Alpha\nBeta', startOffset: 8, endOffset: 18, startLine: 2, endLine: 3
  });
  assert.equal(makeSelection('abc', 1, 1), null);
}
{
  const payload = buildPayload({name:'notes.md',hash:'abc'}, [
    {id:'one',selectedText:'A',startLine:2,endLine:2,kind:'comment',comment:'Check this'},
    {id:'two',selectedText:'B',startLine:4,endLine:4,kind:'explanation',detail:'long'}
  ]);
  assert.deepEqual(payload.items.map(x => x.id), ['one','two']);
  assert.equal(payload.items[0].mappingStatus, 'exact');
  assert.equal(payload.items[0].comment, 'Check this');
  assert.equal(payload.items[1].detail, 'long');
  assert.equal(payload.document.documentHash, 'abc');
}
console.log("model checks passed");
