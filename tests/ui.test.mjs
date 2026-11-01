import { Window } from 'happy-dom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { analyzeSlot } from '../public/js/completion.js';
import { decodeSave } from '../public/js/save-codec.js';
import { localizeCatalog } from '../public/js/i18n.js';
import { makeSyntheticSave, syntheticGameplay } from './fixtures/pbzs.mjs';
import { terrainFixture } from './fixtures/terrain.mjs';
import { gzipSync } from 'node:zlib';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot=path.join(root,'public');
const catalog=JSON.parse(await fs.readFile(path.join(publicRoot,'data/catalog.json'),'utf8'));
const language=process.env.PBZ_TEST_LANGUAGE||process.argv[2]||'zh';
assert(['zh','en'].includes(language),'PBZ_TEST_LANGUAGE must be zh or en');
const route=language==='en'?'/phantom-blade-zero/en/':'/phantom-blade-zero/';
const overlay=JSON.parse(await fs.readFile(path.join(publicRoot,'data/catalog.en.json'),'utf8'));
const displayedCatalog=localizeCatalog(catalog,overlay,language);
const terrain=terrainFixture(catalog);
const checks=[];
const network=[];
const window=new Window({url:'http://127.0.0.1:8767'+route,settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
for(const key of ['window','document','HTMLElement','SVGElement','Event','CustomEvent','Option','Node','File','FileReader','DataTransfer','ResizeObserver','MutationObserver','requestAnimationFrame','cancelAnimationFrame','matchMedia']){
  const value=key==='window'?window:window[key];
  Object.defineProperty(globalThis,key,{value:typeof value==='function'&&['requestAnimationFrame','cancelAnimationFrame','matchMedia'].includes(key)?value.bind(window):value,configurable:true,writable:true});
}
let exported;
const drawing={fills:[],webglAttempts:0};
class TestPath2D {
  constructor(){this.commands=[];}
  moveTo(x,y){this.commands.push(['move',x,y]);}
  lineTo(x,y){this.commands.push(['line',x,y]);}
  closePath(){this.commands.push(['close']);}
}
Object.defineProperty(window,'Path2D',{value:TestPath2D,configurable:true});
Object.defineProperty(globalThis,'Path2D',{value:TestPath2D,configurable:true});
Object.defineProperty(window.HTMLCanvasElement.prototype,'getContext',{configurable:true,value(type){
  if(type==='webgl2'){drawing.webglAttempts++;return null;}
  if(type!=='2d')return null;
  return {save(){},restore(){},setTransform(){},clearRect(){},stroke(){},fill(shape){drawing.fills.push(shape.commands.map(command=>[...command]));}};
}});
globalThis.Option=function(text='',value='',defaultSelected=false,selected=false){const option=document.createElement('option');option.textContent=text;option.value=value;option.defaultSelected=defaultSelected;option.selected=selected;return option;};
URL.createObjectURL=blob=>{exported=blob;return 'blob:local-csv-test';};URL.revokeObjectURL=()=>{};
window.HTMLAnchorElement.prototype.click=function(){};
globalThis.fetch=async(input,options={})=>{
  const url=String(input);network.push({url,method:options.method||'GET',hasBody:!!options.body});
  assert.equal(options.method||'GET','GET');assert(!options.body,'No save bytes may be sent via fetch');
  const pathname=new URL(url,'http://127.0.0.1:8767').pathname;
  const resource=['catalog.json','catalog.en.json'].find(name=>pathname.endsWith('/data/'+name));
  if(resource)return new Response(await fs.readFile(path.join(publicRoot,'data',resource)),{headers:{'Content-Type':'application/json'}});
  if(pathname.endsWith('/data/terrain/manifest.json'))return new Response(JSON.stringify(terrain.manifest),{headers:{'Content-Type':'application/json'}});
  if(pathname.endsWith('/data/terrain/ui-test-world.json.gz'))return new Response(gzipSync(JSON.stringify(terrain.geometry)),{headers:{'Content-Type':'application/gzip'}});
  throw new Error('Unexpected resource request '+url);
};
const html=(await fs.readFile(path.join(publicRoot,route,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
window.document.write(html);
await import(pathToFileURL(path.join(publicRoot,'js/app.js')));
const $=id=>window.document.getElementById(id);
async function waitFor(predicate,label){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+label+'; '+$('notice')?.textContent);}
function change(id,value){const n=$(id);if(n.type==='checkbox')n.checked=value;else n.value=value;n.dispatchEvent(new window.Event('change',{bubbles:true}));}
function pass(label,condition){assert(condition,label);checks.push(label);}
// Exercise the production controller with a controlled module-load boundary.
// No browser process or WebGL renderer is initialized for these race cases.
const controllerSource=await fs.readFile(path.join(publicRoot,'js/app.js'),'utf8');
const controllerStart=controllerSource.indexOf('function showTerrain3D(');
const controllerEnd=controllerSource.indexOf('function renderMap(',controllerStart);
assert(controllerStart>=0&&controllerEnd>controllerStart,'Terrain controller is available for the controlled regression');
const controlledControllerSource=controllerSource.slice(controllerStart,controllerEnd).replace(/import\('\.\/terrain-view\.js[^']*'\)/,'loadRenderer()');
function terrainController(testState,loadRenderer,renderMap=()=>{},selectNode={value:'3d'}){
  return new Function('state','$','L','setNotice','renderMap','filteredRecords','selectRecord','loadRenderer',controlledControllerSource+';return showTerrain3D;')(
    testState,()=>selectNode,(zh,en)=>en,()=>{},renderMap,()=>[],()=>{},loadRenderer);
}
{
  let reject;
  const pending=new Promise((resolve,fail)=>{reject=fail;});
  const testState={mapMode:'3d',terrain3d:null},selectNode={value:'3d'};let redraws=0;
  terrainController(testState,()=>pending,()=>redraws++,selectNode)({},[],'test-map');
  testState.mapMode='game';selectNode.value='game';
  reject(new Error('Controlled renderer module failure'));await testState.terrain3dPromise;
  pass('late 3D loading failure preserves a newer map mode',testState.mapMode==='game'&&selectNode.value==='game'&&redraws===0);
}
{
  const testState={mapMode:'3d',terrain3d:null};let redraws=0;
  terrainController(testState,()=>Promise.reject(new Error('Controlled renderer module failure')),()=>redraws++)({},[],'test-map');
  await testState.terrain3dPromise;
  pass('active 3D loading failure still falls back safely',testState.mapMode==='terrain'&&redraws===1);
}
{
  const selections=[];
  const renderer={available:true,setData(){},setBand(){},setHeightRange(){},select:key=>selections.push(key),resize(){}};
  const testState={mapMode:'3d',terrain3d:renderer,terrain3dPromise:Promise.resolve(),selected:'selected-item'};
  const show=terrainController(testState,()=>Promise.resolve());
  const context={geometry:{},heightRange:[0,100]};
  show(context,[],'test-map');testState.selected=null;show(context,[],'test-map');
  pass('clearing a selection also clears the 3D highlight',selections.length===2&&selections[0]==='selected-item'&&selections[1]===null);
}
await waitFor(()=>$('category-select').options.length>=14,'catalog boot');
pass('13 collection categories', $('category-select').options.length===14);
pass('blank state has no invented missing counts',$('stat-missing').textContent==='—');
pass('no private walkthrough section',!window.document.body.textContent.includes('从栈道入口前往栈道眺望台'));
pass('no public guide route section',!window.document.body.textContent.includes('独立参考'));
pass('tool uses the requested language',document.documentElement.lang===(language==='en'?'en':'zh-CN'));
pass('no obsolete poetic branding',!document.body.textContent.includes('影境拾遗')&&!document.body.textContent.includes('江湖自此展开'));
pass('technical detail and warnings start collapsed',!$('detail-panel').open&&!$('evidence-disclosure').open&&!$('analysis-warnings').closest('details').open);
pass('Chinese text has no replacement-question-mark corruption',!document.body.textContent.includes('???'));
pass('2D terrain is the default map mode',$('map-view-select').value==='terrain');
pass('terrain is not downloaded before choosing a map',!network.some(request=>request.url.includes('/data/terrain/')));
change('map-select','ZhengDaoDaYing');change('category-select','blackStone');
pass('preload position browsing shows four blackstones',$('visible-count').textContent.includes('4'));
await waitFor(()=>$('map-stage').dataset.terrain==='ready','lazy compressed terrain draw');
pass('terrain backdrop is present in the SVG',$('map-world').querySelector('foreignObject canvas'));
pass('2D terrain draws source triangles',drawing.fills.some(commands=>commands.filter(command=>command[0]==='close').length===2));
pass('terrain manifest and gzip are loaded lazily once',network.filter(request=>request.url.includes('/data/terrain/manifest.json')).length===1&&network.filter(request=>request.url.includes('/data/terrain/ui-test-world.json.gz')).length===1);
const campPoint=catalog.records.find(r=>r.mapId==='ZhengDaoDaYing'&&r.category==='blackStone'&&r.mapPosition);
const markerFor=id=>[...$('map-world').querySelectorAll('.map-marker')].find(n=>n.dataset.key.includes(`|${id}|`));
const beforeHeight=$('map-world').querySelectorAll('.map-marker').length;
const terrainButton=[...$('record-list').querySelectorAll('.record-button')].find(button=>button.dataset.key.includes(`|${campPoint.id}|`));
assert(terrainButton);terrainButton.click();change('map-height-focus',true);
const expectedHeight=catalog.records.filter(record=>record.mapId==='ZhengDaoDaYing'&&record.category==='blackStone'&&Math.abs(record.location.Z-campPoint.location.Z)<=800).length;
pass('height focus reduces markers using actual item Z',$('map-world').querySelectorAll('.map-marker').length===expectedHeight&&expectedHeight<beforeHeight);
pass('height filtering preserves the collection checklist',Number($('visible-count').textContent)===4);
pass('height filtering clips the terrain surface too',drawing.fills.at(-1).filter(command=>command[0]==='close').length===1);
change('map-height-focus',false);change('map-height-band','z1');
pass('an empty marker height area still displays its real surface',$('map-world').querySelectorAll('.map-marker,.bell-map-marker').length===0&&Boolean($('map-world').querySelector('foreignObject canvas'))&&drawing.fills.at(-1).filter(command=>command[0]==='close').length===1);
change('map-height-focus',true);
pass('height focus returns from a manually selected area to the selected item area',$('map-height-band').value==='z0');
pass('height focus after an area change keeps the selected marker visible',Boolean(markerFor(campPoint.id))&&$('map-world').querySelectorAll('.map-marker').length===expectedHeight);
pass('height focus after an area change retains its source surface',$('map-stage').dataset.terrain==='ready'&&drawing.fills.at(-1).filter(command=>command[0]==='close').length===1);
change('map-height-focus',false);
change('map-height-band','z0');change('map-view-select','3d');
await waitFor(()=>$('map-view-select').value==='terrain'&&drawing.webglAttempts>0,'WebGL unavailable fallback');
pass('unavailable WebGL returns to 2D without a GPU renderer',$('map-3d').classList.contains('hidden')&&!$('coordinate-map').classList.contains('hidden')&&Boolean($('map-world').querySelector('foreignObject canvas')));
change('map-view-select','game');
pass('game UV remains an explicit supported mode',$('coordinate-map').dataset.projection==='game');
const gameTransform=markerFor(campPoint.id).getAttribute('transform');
const [screenX,screenY]=gameTransform.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
pass('marker uses game UV and its top-left origin',Math.abs(screenX-(142.5+475*campPoint.mapPosition.X))<1e-8&&Math.abs(screenY-(57.5+475*campPoint.mapPosition.Y))<1e-8);
change('category-select','all');
pass('category filtering preserves game map placement',markerFor(campPoint.id).getAttribute('transform')===gameTransform);
change('category-select','bell');
const campBells=catalog.bells.filter(b=>b.mapId==='ZhengDaoDaYing'&&b.mapPosition);
pass('bell references do not duplicate collectible bell markers',$('map-world').querySelectorAll('.bell-map-marker,.map-marker').length===new Set(campBells.map(b=>b.id.toLowerCase())).size);
change('category-select','blackStone');change('map-view-select','world');
pass('world mode uses a separate coordinate system',$('coordinate-map').dataset.projection==='world'&&markerFor(campPoint.id).getAttribute('transform')!==gameTransform);
change('map-view-select','game');
pass('returning to game mode restores placement',markerFor(campPoint.id).getAttribute('transform')===gameTransform);
change('map-select','XueSeSenLin');change('category-select','all');
pass('maps without projection report a world-coordinate fallback',$('coordinate-map').dataset.projection==='world'&&$('map-projection-note').textContent.trim().length>0);
change('map-select','FuJiZhiLin');
pass('partial calibration reports omitted points',$('coordinate-map').dataset.projection==='game'&&$('map-projection-note').textContent.trim().length>0);
change('map-select','ZhengDaoDaYing');change('category-select','blackStone');
const initialView=$('map-world').getAttribute('transform');
$('coordinate-map').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
pass('keyboard pans the coordinate map',$('map-world').getAttribute('transform')!==initialView);
$('coordinate-map').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
pass('Home resets the coordinate map',$('map-world').getAttribute('transform')===initialView);
const sample=catalog.records.find(record=>record.category==='blackStone'&&record.mapId==='ZhengDaoDaYing');
change('map-select','all');change('category-select','all');
$('search-input').value=sample.name;$('search-input').dispatchEvent(new window.Event('input',{bubbles:true}));
await waitFor(()=>[...$('record-list').querySelectorAll('.record-button')].some(button=>button.dataset.key.includes(`|${sample.id}|`)),'debounced Chinese name search');
pass('Chinese names remain searchable in both languages',[...$('record-list').querySelectorAll('.record-button')].some(button=>button.dataset.key.includes(`|${sample.id}|`)));
$('reset-filters').click();
{
  const bytes=process.env.PBZ_TEST_SAVE?await fs.readFile(process.env.PBZ_TEST_SAVE):await makeSyntheticSave([
    {name:'AutoSave0',data:syntheticGameplay(catalog)},
    {name:'AutoSave1',data:syntheticGameplay(catalog,{latest:true})},
  ]);
  const decoded=await decodeSave(bytes);
  const latest=decoded.slots.find(s=>s.name===decoded.latestSlotName);
  const expected=analyzeSlot(latest,displayedCatalog);
  const file=new window.File([bytes],'PBZSaveGame.sav');
  Object.defineProperty($('file-input'),'files',{value:[file],configurable:true});
  $('file-input').dispatchEvent(new window.Event('change',{bubbles:true}));
  await waitFor(()=>!$('slot-select').disabled&&$('slot-select').options.length===decoded.slots.length,'actual encrypted save import');
  pass('all gameplay slots selectable',$('slot-select').options.length===decoded.slots.length);
  pass('latest save selected automatically',$('slot-select').value===decoded.latestSlotName);
  $('reset-filters').click();
  pass('analyzed total matches pure rules',$('stat-done').textContent.replaceAll(',','')===String(expected.summary.done));
  for(const status of ['done','missing','unknown'])pass(`${status} count matches the selected save`,Number($(`stat-${status}`).textContent.replaceAll(',',''))===expected.summary[status]);
  if(!process.env.PBZ_TEST_SAVE)pass('synthetic import exercises all three completion states',['done','missing','unknown'].every(status=>expected.summary[status]>0));
  pass('import does not expand technical warning text',!$('analysis-warnings').closest('details').open);
  change('map-select','ZhengDaoDaYing');change('category-select','blackStone');change('pending-only',true);
  const pending=expected.records.filter(r=>r.mapId==='ZhengDaoDaYing'&&r.category==='blackStone'&&r.status!=='done');
  pass('pending filter matches analyzed collection points',Number($('visible-count').textContent.replaceAll(',',''))===pending.length);
  const detailRecord=expected.records.find(r=>r.category==='blackStone'&&r.location&&r.nearestBells?.length);
  assert(detailRecord,'Catalog contains a located point with bell references');
  change('pending-only',false);change('map-select',detailRecord.mapId);change('category-select',detailRecord.category);
  const matchingButton=[...$('record-list').querySelectorAll('button')].find(b=>b.querySelector('strong')?.textContent===detailRecord.name);
  assert(matchingButton,'Located collection point is present in its map/category');matchingButton.click();
  pass('selecting an item opens its collapsible details',$('detail-panel').open);
  pass('evidence remains optional after selection',!$('evidence-disclosure').open);
  pass('source coordinates appear in the detail panel',Object.values(detailRecord.location).every(v=>$('detail-coordinates').textContent.includes(Math.round(v).toLocaleString())));
  pass('nearby bells match analysis',detailRecord.nearestBells.every(b=>$('detail-bells').textContent.includes(b.name)));
  $('export-button').click();await waitFor(()=>!!exported,'CSV export');
  const csv=await exported.text();
  pass('CSV includes selected source point and coordinates',csv.includes(detailRecord.id)&&Object.values(detailRecord.location).every(v=>csv.includes(String(v))));
  pass('CSV keeps raw coordinate column names',/\bX\b/.test(csv.split(/\r?\n/)[0])&&/\bY\b/.test(csv.split(/\r?\n/)[0])&&/\bZ\b/.test(csv.split(/\r?\n/)[0]));
  change('map-select','ZhengDaoDaYing');change('category-select','bell');change('pending-only',true);
  const pendingBells=expected.records.filter(r=>r.mapId==='ZhengDaoDaYing'&&r.category==='bell'&&r.status!=='done');
  pass('pending bells match analysis',Number($('visible-count').textContent.replaceAll(',',''))===pendingBells.length);
  const other=decoded.slots.find(s=>s.name!==decoded.latestSlotName)||latest;change('slot-select',other.name);
  await waitFor(()=>!$('slot-select').disabled,'manual slot recomputation');
  $('reset-filters').click();
  pass('switching slot recomputes completion',Number($('stat-done').textContent.replaceAll(',',''))===analyzeSlot(other,catalog).summary.done);
  if($('quests-button')){
    change('slot-select',decoded.latestSlotName);await waitFor(()=>!$('slot-select').disabled,'latest slot recomputation');$('quests-button').click();
    pass('task records dialog opens', $('quests-dialog').open);
    pass('task records rendered from save', $('quest-list').querySelectorAll('.quest-entry').length===expected.quests.length);
    for(const status of ['active','done','failed','unknown']){
      change('quest-status-filter',status);
      const matching=expected.quests.filter(quest=>quest.status===status);
      pass(`quest ${status} filtering matches saved status`,$('quest-list').querySelectorAll('.quest-entry').length===matching.length&&[...$('quest-list').querySelectorAll('.quest-entry')].every(entry=>entry.classList.contains(status)));
    }
    change('quest-status-filter','all');
    $('close-quests').click();pass('quest dialog closes',$('quests-dialog').open===false);
  }
  $('clear-button').click();
  pass('clearing removes personal file label',$('file-name').textContent==='');
  pass('clearing returns to neutral counts',$('stat-missing').textContent==='—');
  pass('clearing collapses personal item details',!$('detail-panel').open);
  const invalid=new window.File([new Uint8Array([1,2,3,4])],'invalid.sav');
  Object.defineProperty($('file-input'),'files',{value:[invalid],configurable:true});$('file-input').dispatchEvent(new window.Event('change',{bubbles:true}));
  await waitFor(()=>$('notice').classList.contains('error'),'invalid file error');
  pass('bad save reports an error without analysis',$('stat-missing').textContent==='—');
}
pass('network calls use GET and carry no save content',network.every(n=>n.method==='GET'&&!n.hasBody));
const output={passed:checks.length,language,fixture:process.env.PBZ_TEST_SAVE?'private':'synthetic',checks,verification:'Happy DOM emulation, not a real browser render',network};
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});await fs.writeFile(path.join(root,`artifacts/ui-test-results.${language}.json`),JSON.stringify(output,null,2));
console.log(JSON.stringify({passed:checks.length,checks},null,2));
await window.happyDOM.close();
