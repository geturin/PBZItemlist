// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { localizeCatalog } from '../public/js/i18n.js';
import { analyzeSlot } from '../public/js/completion.js';
import { syntheticGameplay } from './fixtures/pbzs.mjs';

const catalog=JSON.parse(await fs.readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const overlay=JSON.parse(await fs.readFile(new URL('../public/data/catalog.en.json',import.meta.url),'utf8'));
const before=JSON.stringify(catalog);
const english=localizeCatalog(catalog,overlay,'en');
const terrainManifest=JSON.parse(await fs.readFile(new URL('../public/data/terrain/manifest.json',import.meta.url),'utf8'));
assert.equal(terrainManifest.format,1);
assert(terrainManifest.maps.ZhengDaoDaYing&&terrainManifest.worlds[terrainManifest.maps.ZhengDaoDaYing.world],'Both UI languages share the same world geometry mapping');

// Regression samples taken from the game's English names, not literal machine translations.
assert.equal(english.maps.find(map=>map.id==='XiGu').name,'Weeping Creek Valley');
assert.equal(english.bells.find(bell=>bell.id==='Bell_NLES_001').name,'The Beginning');
assert.equal(english.records.find(record=>record.id==='XiGu:weapon:002').name,'JAGGED STEEL');
for(const table of ['maps','categories','bells','records']){
  assert.equal(english[table].length,catalog[table].length);
  for(const entry of catalog[table]){
    assert(typeof overlay[table]?.[entry.id]==='string'&&overlay[table][entry.id].trim(),`Missing English name: ${table}/${entry.id}`);
    const translated=english[table].find(other=>other.id===entry.id);
    assert.equal(translated.nameZh,entry.name,'Chinese search text must remain available');
  }
}
assert.equal(JSON.stringify(catalog),before,'Applying an overlay must not mutate the base catalog');

const textFields=new Set(['name','nameZh','label','labelZh','limitations','limitationsZh']);
function nonText(value){
  if(Array.isArray(value))return value.map(nonText);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!textFields.has(key)).map(([key,item])=>[key,nonText(item)]));
  return value;
}
assert.deepEqual(nonText(english),nonText(catalog),'Translation must preserve all IDs, geometry, source references and completion rules');

const data=syntheticGameplay(catalog,{latest:true});
function outcomes(result){
  return {summary:result.summary,records:result.records.map(record=>({id:record.id,status:record.status,mapId:record.mapId,category:record.category,location:record.location,mapPosition:record.mapPosition,conditions:record.conditions.map(condition=>({id:condition.id,status:condition.status})),nearestBells:record.nearestBells.map(bell=>({id:bell.id,distance:bell.distance,active:bell.active}))})),quests:result.quests.map(quest=>({id:quest.id,status:quest.status,branches:quest.branches.map(branch=>({id:branch.id,status:branch.status}))}))};
}
assert.deepEqual(outcomes(analyzeSlot({data},english)),outcomes(analyzeSlot({data},catalog)),'English names must not change save analysis or nearby-bell distances');

const partial=structuredClone(overlay),sample=catalog.records[0];delete partial.records[sample.id];
assert.equal(localizeCatalog(catalog,partial,'en').records[0].name,sample.name,'A missing translation must keep the original name');
assert.equal(localizeCatalog(catalog,overlay,'zh'),catalog,'Chinese mode uses the source catalog');
console.log('PASS i18n: official name samples, full name coverage, original Chinese search text, unchanged IDs/geometry/rules/analysis, fallback');
