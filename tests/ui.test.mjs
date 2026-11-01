import { Window } from 'happy-dom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { analyzeSlot } from '../public/js/completion.js';
import { decodeSave } from '../public/js/save-codec.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot=path.join(root,'public');
const checks=[];
const network=[];
const window=new Window({url:'http://127.0.0.1:8767/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
for(const key of ['window','document','HTMLElement','SVGElement','Event','CustomEvent','Option','Node','File','FileReader','DataTransfer','ResizeObserver','MutationObserver','requestAnimationFrame','cancelAnimationFrame','matchMedia']){
  const value=key==='window'?window:window[key];
  Object.defineProperty(globalThis,key,{value:typeof value==='function'&&['requestAnimationFrame','cancelAnimationFrame','matchMedia'].includes(key)?value.bind(window):value,configurable:true,writable:true});
}
let exported;
globalThis.Option=function(text='',value='',defaultSelected=false,selected=false){const option=document.createElement('option');option.textContent=text;option.value=value;option.defaultSelected=defaultSelected;option.selected=selected;return option;};
URL.createObjectURL=blob=>{exported=blob;return 'blob:local-csv-test';};URL.revokeObjectURL=()=>{};
window.HTMLAnchorElement.prototype.click=function(){};
globalThis.fetch=async(input,options={})=>{
  const url=String(input);network.push({url,method:options.method||'GET',hasBody:!!options.body});
  assert.equal(options.method||'GET','GET');assert(!options.body,'No save bytes may be sent via fetch');
  if(!url.endsWith('/data/catalog.json'))throw new Error('Unexpected resource request '+url);
  return new Response(await fs.readFile(path.join(publicRoot,'data/catalog.json')),{headers:{'Content-Type':'application/json'}});
};
const html=(await fs.readFile(path.join(publicRoot,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
window.document.write(html);
await import(pathToFileURL(path.join(publicRoot,'js/app.js')));
const $=id=>window.document.getElementById(id);
async function waitFor(predicate,label){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+label+'; '+$('notice')?.textContent);}
function change(id,value){const n=$(id);if(n.type==='checkbox')n.checked=value;else n.value=value;n.dispatchEvent(new window.Event('change',{bubbles:true}));}
function pass(label,condition){assert(condition,label);checks.push(label);}
await waitFor(()=>$('category-select').options.length>=14,'catalog boot');
pass('13 collection categories', $('category-select').options.length===14);
pass('blank state has no invented missing counts',$('stat-missing').textContent==='—');
pass('no private walkthrough section',!window.document.body.textContent.includes('从栈道入口前往栈道眺望台'));
pass('no public guide route section',!window.document.body.textContent.includes('独立参考'));
change('map-select','ZhengDaoDaYing');change('category-select','blackStone');
pass('preload position browsing shows four blackstones',$('visible-count').textContent.includes('4'));
if(process.env.PBZ_TEST_SAVE){
  const bytes=await fs.readFile(process.env.PBZ_TEST_SAVE);
  const decoded=await decodeSave(bytes);
  const latest=decoded.slots.find(s=>s.name===decoded.latestSlotName);
  const catalog=JSON.parse(await fs.readFile(path.join(publicRoot,'data/catalog.json'),'utf8'));
  const expected=analyzeSlot(latest,catalog);
  const file=new window.File([bytes],'PBZSaveGame.sav');
  Object.defineProperty($('file-input'),'files',{value:[file],configurable:true});
  $('file-input').dispatchEvent(new window.Event('change',{bubbles:true}));
  await waitFor(()=>!$('slot-select').disabled&&$('slot-select').options.length===decoded.slots.length,'actual encrypted save import');
  pass('all gameplay slots selectable',$('slot-select').options.length===decoded.slots.length);
  $('reset-filters').click();
  pass('analyzed total matches pure rules',$('stat-done').textContent.replaceAll(',','')===String(expected.summary.done));
  change('map-select','ZhengDaoDaYing');change('category-select','blackStone');change('pending-only',true);
  const pending=expected.records.filter(r=>r.mapId==='ZhengDaoDaYing'&&r.category==='blackStone'&&r.status!=='done');
  pass('pending filter matches analyzed collection points',Number($('visible-count').textContent.replaceAll(',',''))===pending.length);
  const detailRecord=expected.records.find(r=>r.category==='blackStone'&&r.location&&r.nearestBells?.length);
  assert(detailRecord,'Catalog contains a located point with bell references');
  change('pending-only',false);change('map-select',detailRecord.mapId);change('category-select',detailRecord.category);
  const matchingButton=[...$('record-list').querySelectorAll('button')].find(b=>b.querySelector('strong')?.textContent===detailRecord.name);
  assert(matchingButton,'Located collection point is present in its map/category');matchingButton.click();
  pass('source coordinates appear in the detail panel',Object.values(detailRecord.location).every(v=>$('detail-coordinates').textContent.includes(Math.round(v).toLocaleString())));
  pass('nearby bells match analysis',detailRecord.nearestBells.every(b=>$('detail-bells').textContent.includes(b.name)));
  $('export-button').click();await waitFor(()=>!!exported,'CSV export');
  const csv=await exported.text();
  pass('CSV includes selected source point and coordinates',csv.includes(detailRecord.id)&&Object.values(detailRecord.location).every(v=>csv.includes(String(v))));
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
    pass('task records rendered from save', $('quest-counts').querySelector('.quest-result-count').textContent===`${expected.quests.length} / ${expected.quests.length} 项任务`);
  }
  $('clear-button').click();
  pass('clearing removes personal file label',$('file-name').textContent==='');
  pass('clearing returns to neutral counts',$('stat-missing').textContent==='—');
  const invalid=new window.File([new Uint8Array([1,2,3,4])],'invalid.sav');
  Object.defineProperty($('file-input'),'files',{value:[invalid],configurable:true});$('file-input').dispatchEvent(new window.Event('change',{bubbles:true}));
  await waitFor(()=>$('notice').classList.contains('error'),'invalid file error');
  pass('bad save reports an error without analysis',$('stat-missing').textContent==='—');
}
pass('network calls use GET and carry no save content',network.every(n=>n.method==='GET'&&!n.hasBody));
const output={passed:checks.length,checks,verification:'Happy DOM emulation, not a real browser render',network};
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});await fs.writeFile(path.join(root,'artifacts/ui-test-results.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({passed:checks.length,checks},null,2));
await window.happyDOM.close();
