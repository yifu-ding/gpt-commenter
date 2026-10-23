import assert from 'node:assert/strict';
import {defaults,presentSettings,normalizeSettingLabels,settingsSchema} from './src/explanation-settings.js';
const presented=presentSettings({...defaults,treePosition:'right'});
assert.deepEqual(presented.schema.properties.treePosition.enum,['Left','Right']);assert.equal(presented.values.treePosition,'Right');assert.equal(presented.preferences.treePosition,'right');assert.equal(presented.schema.properties.showGitChanges.title,'Show git changes');
assert.ok(presented.layout[0].items.some(item=>item.property==='themeColor'));assert.ok(!presented.layout[0].items.some(item=>item.tool==='markatlas_theme_color'));
for(const color of settingsSchema.properties.themeColor.enum){const label=color[0].toUpperCase()+color.slice(1);assert.ok(presented.schema.properties.themeColor.enum.includes(label));assert.equal(presentSettings({...defaults,themeColor:color}).values.themeColor,label);assert.equal(normalizeSettingLabels({themeColor:label}).themeColor,color);assert.equal(normalizeSettingLabels({themeColor:color}).themeColor,color);}
assert.deepEqual(normalizeSettingLabels({treePosition:'Left',outlinePosition:'Right',themeColor:'Purple'}),{treePosition:'left',outlinePosition:'right',themeColor:'purple'});
console.log('Native theme dropdown, sentence-case labels and backward-compatible preference values passed');
