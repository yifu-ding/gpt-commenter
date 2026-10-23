import assert from 'node:assert/strict';
import {buildProject,floatingPosition} from './src/project.js';
const f=(path)=>({name:path.split('/').at(-1),webkitRelativePath:path});
const project=buildProject([f('Example/z.md'),f('Example/docs/a.MARKDOWN'),f('Example/image.png'),f('Example/.git/config'),f('Example/node_modules/library/a.md'),f('Example/../escape.md')]);
assert.equal(project.root.name,'Example');assert.equal(project.files.size,3);assert.equal(project.omitted,3);
assert.equal(project.root.children[0].type,'directory','folders sort before files');
assert.equal(project.root.children[0].children[0].supported,true);assert.equal(project.root.children[1].supported,true,'image files remain available in the project tree');
assert.equal(buildProject([f('A/a.md'),f('A/b.md')],1).omitted,1);
const office=buildProject(['report.docx','.~port.docx','~$report.docx','~$sheet.xlsx','.~notes.txt'].map(name=>f(`Office/${name}`)));
assert.deepEqual([...office.files.keys()],['report.docx','.~notes.txt']);assert.equal(office.omitted,3);

const viewport={width:1200,height:800};
const right=floatingPosition({left:200,right:300,top:250,bottom:270},340,350,viewport,80);
assert.equal(right.left,312);assert.equal(right.top,250,'anchor top follows selected passage');
const left=floatingPosition({left:900,right:1000,top:350,bottom:370},340,350,viewport,80);
assert.equal(left.left,548,'near right edge opens to the left');
const below=floatingPosition({left:100,right:340,top:150,bottom:170},340,300,{width:500,height:700},70);
assert.equal(below.top,182,'narrow viewport opens below passage');
for(const p of [floatingPosition({left:1100,right:1200,top:750,bottom:790},340,500,viewport,80),floatingPosition({left:1,right:5,top:2,bottom:4},340,500,{width:320,height:480},60)]) {
 assert.ok(p.left>=12);assert.ok(p.top>=72);assert.ok(p.maxWidth>=0);assert.ok(p.maxHeight>=0);
}
console.log('Project-tree filtering and selection-anchored panel geometry checks passed');

const large=buildProject([...Array.from({length:10050},(_,i)=>f(`Large/earlier/${i}.txt`)),f('Large/答辩ppt/slides.pptx'),f('Large/相关文献pdf/paper.pdf'),f('Large/答辩ppt/成果概述初稿/两页成果概述.md')]);assert.equal(large.files.size,10053);assert.equal(large.omitted,0);assert.ok(large.files.has('答辩ppt/slides.pptx'));assert.ok(large.files.has('相关文献pdf/paper.pdf'));
