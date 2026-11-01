// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Window } from 'happy-dom';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),publicRoot=path.join(root,'public');
try{
  execFileSync(process.execPath,['scripts/build_pages.mjs','--check'],{cwd:root,stdio:'pipe'});
}catch(error){
  const detail=String(error.stderr??error.message);
  const stale=detail.match(/Generated file is stale: ([^\r\n]+)/)?.[1];
  throw new Error(stale?`Generated page is stale: ${stale}. Run node scripts/build_pages.mjs.`:detail.slice(0,600));
}
const pages=[
  {route:'/',language:'zh-CN',alternate:'/en/',tool:false},
  {route:'/en/',language:'en',alternate:'/',tool:false},
  {route:'/phantom-blade-zero/',language:'zh-CN',alternate:'/phantom-blade-zero/en/',tool:true},
  {route:'/phantom-blade-zero/en/',language:'en',alternate:'/phantom-blade-zero/',tool:true},
];
for(const page of pages){
  const html=await fs.readFile(path.join(publicRoot,page.route,'index.html'),'utf8');
  const window=new Window({url:'https://game.kero.zone'+page.route,settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  window.document.write(html);const d=window.document;
  assert.equal(d.documentElement.lang,page.language);
  assert.equal(d.querySelector('link[rel=canonical]').href,'https://game.kero.zone'+page.route);
  assert.equal(d.querySelector('#language-switch').getAttribute('href'),page.alternate);
  const zh=page.language==='en'?page.alternate:page.route,en=page.language==='en'?page.route:page.alternate;
  for(const [language,route] of [['zh-CN',zh],['en',en],['x-default',zh]])assert.equal(d.querySelector(`link[hreflang="${language}"]`).href,'https://game.kero.zone'+route);
  assert.equal(d.querySelector('meta[property="og:url"]').content,'https://game.kero.zone'+page.route);
  assert(d.title.trim()&&d.querySelector('meta[name=description]').content.trim(),'Every route needs an indexable title and description');
  assert(d.querySelector('meta[name="twitter:card"]')&&d.querySelector('meta[property="og:image"]'));
  for(const node of d.querySelectorAll('script[src],link[rel=stylesheet],link[rel=icon]')){
    const url=new URL(node.getAttribute('src')||node.getAttribute('href'),window.location.href);
    assert.equal(url.origin,'https://game.kero.zone');await fs.access(path.join(publicRoot,url.pathname));
  }
  assert(!d.body.textContent.includes('影境拾遗'));
  const ids=[...d.querySelectorAll('[id]')].map(node=>node.id);assert.equal(new Set(ids).size,ids.length,'IDs must remain unique');
  const scripts=[...d.querySelectorAll('script:not([src])')];assert(scripts.every(node=>node.type==='application/ld+json'),'CSP pages must not require inline executable scripts');
  for(const script of scripts){
    const graph=JSON.parse(script.textContent)['@graph'];assert(Array.isArray(graph));
    if(page.tool){
      const app=graph.find(item=>item['@type']==='WebApplication'),faq=graph.find(item=>item['@type']==='FAQPage');
      assert.equal(app.url,window.location.href);assert.equal(faq.mainEntity.length,d.querySelectorAll('#help details').length);
      for(const [index,item] of [...d.querySelectorAll('#help details')].entries()){
        assert.equal(faq.mainEntity[index].name,item.querySelector('summary').textContent.trim());
        assert.equal(faq.mainEntity[index].acceptedAnswer.text,item.querySelector('p').textContent.trim());
      }
    }
  }
  if(page.tool){
    assert(d.querySelector('#coordinate-map')&&d.querySelector('#file-input'));
    assert.deepEqual([...d.querySelector('#map-view-select').options].map(option=>option.value),['game','terrain','3d','world']);
    assert.equal(d.querySelector('#map-view-select').value,'game','The native 2D map is the lightweight default');
    for(const id of ['map-3d','map-surface-controls','map-height-band','map-height-focus'])assert(d.getElementById(id),`Missing terrain control: ${id}`);
    assert(d.querySelector('#map-3d').classList.contains('hidden'),'3D initializes only on demand');
    assert.equal(d.querySelector('#detail-panel').tagName,'DETAILS');assert(!d.querySelector('#detail-panel').open);
    assert(!d.querySelector('#analysis-warnings').closest('details').open);
  }else{
    assert.equal(d.querySelectorAll('.game-card').length,1,'The portal has one game entry');
    assert.equal(d.querySelector('.game-card').getAttribute('href'),page.language==='en'?'/phantom-blade-zero/en/':'/phantom-blade-zero/');
    assert(!d.querySelector('#workspace')&&!d.querySelector('footer'),'The portal stays minimal');
  }
  await window.happyDOM.close();
}
const sitemap=await fs.readFile(path.join(publicRoot,'sitemap.xml'),'utf8');for(const page of pages)assert(sitemap.includes(`<loc>https://game.kero.zone${page.route}</loc>`));
console.log('PASS static routes: reproducible generation, bilingual links, canonical/hreflang, SEO, FAQ schema, assets, minimal portal, collapsed details');
