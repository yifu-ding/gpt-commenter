import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createPdfViewer} from './src/pdf-viewer.js';
const dom=new JSDOM('<article id="pdf"></article>');globalThis.window=dom.window;
window.Range.prototype.getClientRects=()=>[];const container=window.document.getElementById('pdf');let selected,opened;
const data={root:'/project',path:'main.pdf',main:'main.tex',fingerprint:'version',text:'First passage\n\nSecond passage\n',pages:[{number:1,width:600,height:800,startOffset:0,endOffset:14,words:[{text:'First',x:30,y:40,width:25,height:12,startOffset:0,endOffset:5},{text:'passage',x:60,y:40,width:50,height:12,startOffset:6,endOffset:13}]},{number:2,width:600,height:800,startOffset:15,endOffset:30,words:[{text:'Second',x:30,y:40,width:35,height:12,startOffset:15,endOffset:21},{text:'passage',x:70,y:40,width:50,height:12,startOffset:22,endOffset:29}]}]};
const viewer=createPdfViewer(container,{loadPage:async()=>({image:'data:image/png;base64,AA=='}),onSelection:s=>selected=s,onNote:n=>opened=n,onError:e=>{throw e;}});
viewer.show(data);assert.equal(container.querySelectorAll('.pdf-frame').length,2,'all pages belong to one continuous document');
const words=container.querySelectorAll('.pdf-word'),range=window.document.createRange();range.setStart(words[0].firstChild,0);range.setEnd(words[1].firstChild,7);window.getSelection().addRange(range);words[1].dispatchEvent(new window.Event('pointerup',{bubbles:true}));
assert.equal(selected.selectedText,'First passage');assert.equal(selected.pdf.page,1);assert.equal(selected.pdf.rects.length,2);
const note={...selected,id:'test',kind:'comment',message:'Clarify'};viewer.show(data,[note]);assert.equal(container.querySelectorAll('.pdf-highlight').length,2);container.querySelector('.annotation-icon').click();assert.equal(opened.id,'test');
viewer.show(data,[note,{...note,id:'explanation',kind:'explanation',message:''}]);const coexisting=[...container.querySelectorAll('.annotation-icon')];assert.equal(coexisting.length,2);assert.notEqual(coexisting[0].style.left,coexisting[1].style.left,'coexisting note controls do not overlap');coexisting[0].click();assert.equal(opened.id,'test');coexisting[1].click();assert.equal(opened.id,'explanation');
const firstWord=words[0];viewer.show(data,[note]);assert.equal(container.querySelector('.pdf-word'),firstWord,'opening notes does not replace the text layer');
range.setStart(words[1].firstChild,0);range.setEnd(words[2].firstChild,6);window.getSelection().removeAllRanges();window.getSelection().addRange(range);words[2].dispatchEvent(new window.Event('pointerup',{bubbles:true}));assert.equal(selected.pdf.endPage,2,'cross-page selections retain both page numbers');
viewer.setZoom(2);assert.equal(container.querySelector('.pdf-frame').style.width,'200px');viewer.setZoom(99);assert.equal(viewer.zoom(),16);viewer.setZoom(8);assert.equal(viewer.zoom(),8,'zoom beyond 300% is supported');viewer.setZoom(.1);assert.equal(viewer.zoom(),.5);viewer.setZoom(1);assert.equal(viewer.zoom(),1);
const ordinaryScroll=new window.WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true});container.dispatchEvent(ordinaryScroll);assert.equal(viewer.zoom(),1);assert.equal(ordinaryScroll.defaultPrevented,false,'ordinary wheel scrolling stays available');
for(const modifier of ['ctrlKey','metaKey']){const wheel=new window.WheelEvent('wheel',{deltaY:-50,[modifier]:true,bubbles:true,cancelable:true});container.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,true);assert.ok(viewer.zoom()>1,'modified wheel zooms the PDF');viewer.setZoom(1);}
viewer.wheelZoom(new window.WheelEvent('wheel',{deltaY:50,cancelable:true}));assert.ok(viewer.zoom()<1,'the floating control can zoom with an unmodified wheel');
// Model browser layout and scrolling to check a point on a later page, not just scale.
let scrollY=700;window.scrollBy=({top})=>{scrollY+=top;};
container.getBoundingClientRect=()=>({left:20,top:80-scrollY,width:600,bottom:2000-scrollY});
const pageFrames=[...container.querySelectorAll('.pdf-frame')];
pageFrames.forEach((frame,index)=>{frame.getBoundingClientRect=()=>{const width=parseFloat(frame.style.width),height=parseFloat(frame.style.height),left=20+(parseFloat(container.firstChild.style.width)-width)/2-container.scrollLeft,top=80-scrollY+pageFrames.slice(0,index).reduce((sum,f)=>sum+parseFloat(f.style.height)+24,0);return {left,top,width,height,bottom:top+height};};});
viewer.setZoom(1);container.scrollLeft=300;
const position=()=>{const r=pageFrames[1].getBoundingClientRect();return {x:r.left+r.width*.7,y:r.top+r.height*.2};};
const point=position();
for(const deltaY of [-100,100]){pageFrames[1].dispatchEvent(new window.WheelEvent('wheel',{deltaY,ctrlKey:true,clientX:point.x,clientY:point.y,bubbles:true,cancelable:true}));const after=position();assert.ok(Math.abs(after.x-point.x)<.001,'horizontal page point stays under mouse');assert.ok(Math.abs(after.y-point.y)<.001,'vertical page point stays under mouse across preceding pages');}
// Region capture uses PDF coordinates at the current zoom and includes graphics-only areas.
let crop;window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(...args){crop=args;}});
window.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,Y3JvcA==';
const image=pageFrames[0].querySelector('img');Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:600},naturalHeight:{value:800}});
const rect=pageFrames[0].getBoundingClientRect();
viewer.setRegionMode(true);assert.ok(container.classList.contains('pdf-region-mode'));
pageFrames[0].dispatchEvent(new window.MouseEvent('pointerdown',{button:0,clientX:rect.left+30,clientY:rect.top+100,bubbles:true,cancelable:true}));
container.dispatchEvent(new window.MouseEvent('pointermove',{clientX:rect.left+150,clientY:rect.top+200,bubbles:true}));
assert.ok(pageFrames[0].querySelector('.pdf-region-drag'));
container.dispatchEvent(new window.MouseEvent('pointerup',{clientX:rect.left+150,clientY:rect.top+200,bubbles:true,cancelable:true}));
assert.equal(selected.pdf.screenshot,'data:image/jpeg;base64,Y3JvcA==');assert.equal(selected.pdf.page,1);assert.ok(crop);
assert.ok(Math.abs(selected.pdf.region.x-30*600/rect.width)<.001);assert.equal(selected.mappingStatus,'pdf-region');
assert.equal(container.classList.contains('pdf-region-mode'),false);assert.equal(pageFrames[0].querySelector('.pdf-region-drag'),null);
viewer.show(data,[{...selected,id:'region',kind:'comment',message:'Review this diagram'}]);
assert.ok(pageFrames[0].querySelector('.pdf-region-note'),'graphics-only selections retain a visible review marker');
viewer.setRegionMode(true);window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(container.classList.contains('pdf-region-mode'),false);
viewer.destroy();assert.equal(container.childElementCount,0);dom.window.close();delete globalThis.window;
console.log('Continuous PDF pages, native text selection, cross-page anchors, highlights, note reopening, and stable text layers passed');
