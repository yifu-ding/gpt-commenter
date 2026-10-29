import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {weightPdfGlyphs} from './src/pdf-ink.js';

const {window} = new JSDOM('');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><g id="glyph-0-0"><path d="M0 0h1v1z"/></g></defs><g fill="rgb(0%, 0%, 0%)"><use xlink:href="#glyph-0-0" x="5" y="8"/></g><path fill="red" d="M2 2h2v2z"/></svg>';
const original = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const result = weightPdfGlyphs(original, window);
const parsed = new window.DOMParser().parseFromString(decodeURIComponent(result.split(',')[1]), 'image/svg+xml');
const glyph = parsed.querySelector('use');
assert.equal(glyph.getAttribute('stroke'), 'rgb(0%, 0%, 0%)');
assert.equal(glyph.getAttribute('stroke-width'), '0.25');
assert.equal(parsed.querySelector('path[fill="red"]').getAttribute('stroke'), null);
assert.equal(weightPdfGlyphs('data:image/png;base64,AA==', window), 'data:image/png;base64,AA==');
console.log('PDF vector glyph weight and non-text preservation passed');
