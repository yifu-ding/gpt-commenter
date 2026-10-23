import assert from 'node:assert/strict';
import {applyHostAccent} from './src/host-accent.js';
const properties=new Map(),root={style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)},ownerDocument:{defaultView:{CSS:{supports:(_k,v)=>/^#[a-f0-9]{6}$/i.test(v)}}}};
applyHostAccent({styles:{variables:{'--color-text-info':'#e95198','--color-background-info':'#fceef5'}}},root);assert.equal(properties.get('--markatlas-accent'),'#e95198');assert.equal(properties.get('--markatlas-accent-soft'),'#fceef5');
applyHostAccent({theme:'dark'},root);assert.equal(properties.get('--markatlas-accent'),'#e95198');
applyHostAccent({styles:{variables:{'--color-text-info':'url(x)'}}},root);assert.equal(properties.size,0);
console.log('Host semantic colors, partial updates and invalid-color fallback passed');
