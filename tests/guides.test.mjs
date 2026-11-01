// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { localizeCatalog } from '../public/js/i18n.js';
import { GUIDE_PAGES } from '../public/js/guide-routes.js';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['scripts/build_guides.mjs', '--check'], { cwd: root, stdio: 'pipe' });
const publicRoot = path.join(root, 'public');
const readJSON = async file => JSON.parse(await fs.readFile(path.join(publicRoot, file), 'utf8'));
const manifest = await readJSON('data/guide-pages.json'), catalog = await readJSON('data/catalog.json'), overlay = await readJSON('data/catalog.en.json');
const maps = catalog.maps.filter(map => map.image && catalog.records.some(record => record.mapId === map.id && !record.aggregationParent));
const mapIds = new Set(maps.map(map => map.id));
const records = catalog.records.filter(record => mapIds.has(record.mapId) && !record.aggregationParent);
const categories = catalog.categories.filter(category => records.some(record => record.category === category.id));
const pagesByPath = new Map(manifest.pages.map(page => [page.path, page]));
assert.equal(pagesByPath.size, manifest.pages.length);
assert.equal(manifest.pages.length, (maps.length + categories.length + 1) * 2);
assert.deepEqual(Object.keys(GUIDE_PAGES).sort(), [...pagesByPath.keys()].sort(), 'Analytics routes contain only the fixed generated pages');
assert.equal(maps.length, 11); assert.equal(categories.length, 13); assert.equal(records.length, 660);
assert(!manifest.pages.some(page => ['XueSeSenLin', 'HuanShuShi', 'DuanHunShan'].includes(page.mapId)), 'Unknown extras and empty maps do not get thin guide pages');
const titles = new Set(), descriptions = new Set(); let checkedRows = 0, checkedPreviews = 0;
for (const page of manifest.pages) {
  const source = await fs.readFile(path.join(publicRoot, page.path, 'index.html'), 'utf8');
  assert(!/[A-Z]:[\\/]|pbz_analysis|SteamID|SaveGuidString|ExecuteNodeGuid|MobDomainName|FlowAssetName|\.sav["<]/.test(source), 'Guides must not publish private paths, player data or raw match internals');
  const dom = new Window({ url: 'https://game.kero.zone' + page.path, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  dom.document.write(source); const d = dom.document;
  assert.equal(d.documentElement.lang, page.language); assert.equal(d.title, page.title); assert.equal(GUIDE_PAGES[page.path], page.title);
  assert(!titles.has(d.title), 'Each guide needs a distinct, meaningful title'); titles.add(d.title);
  const description = d.querySelector('meta[name="description"]')?.content;
  assert(description?.length > 35 && !descriptions.has(description)); descriptions.add(description);
  assert.equal(d.querySelectorAll('h1').length, 1);
  assert(!d.querySelector('.scope'), 'Player-facing intro is not a technical warning block');
  assert(d.querySelector('.data-note') && !d.querySelector('.data-note').open, 'Concise data notes stay collapsed near the footer');
  assert.equal(d.querySelector('link[rel="canonical"]').href, 'https://game.kero.zone' + page.path);
  const alternate = pagesByPath.get(page.alternatePath); assert(alternate); assert.equal(alternate.alternatePath, page.path);
  assert.equal(d.querySelector('#language-switch').getAttribute('href'), page.alternatePath);
  for (const language of ['zh-CN', 'en']) {
    const expected = language === page.language ? page.path : page.alternatePath;
    assert.equal(d.querySelector(`link[hreflang="${language}"]`).href, 'https://game.kero.zone' + expected);
  }
  assert.equal(d.querySelector('link[hreflang="x-default"]').href, 'https://game.kero.zone' + (page.language === 'en' ? page.alternatePath : page.path));
  const ids = [...d.querySelectorAll('[id]')].map(node => node.id); assert.equal(ids.length, new Set(ids).size);
  assert([...d.querySelectorAll('script')].every(node => node.type === 'application/ld+json' || node.getAttribute('src')?.startsWith('/js/analytics.js')), 'Content is fully static; no data-rendering script or inline handler');
  assert(!d.querySelector('[onclick],[onload],canvas'));
  const localized = localizeCatalog(catalog, overlay, page.language);
  const expectedRows = records.filter(record => page.kind === 'hub' ? false : page.kind === 'map' ? record.mapId === page.mapId : record.category === page.category);
  const rows = [...d.querySelectorAll('tr[data-record-id]')];
  assert.deepEqual(rows.map(row => row.dataset.recordId).sort(), expectedRows.map(record => record.id).sort(), 'Every eligible location appears exactly once in static HTML');
  const graph = JSON.parse(d.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
  const collection = graph.find(entry => entry['@type'] === 'CollectionPage'), breadcrumb = graph.find(entry => entry['@type'] === 'BreadcrumbList');
  assert(collection && breadcrumb); assert.equal(collection.url, 'https://game.kero.zone' + page.path);
  assert.equal(collection.name, d.querySelector('h1').textContent); assert.equal(collection.description, description);
  assert.equal(collection.mainEntity.numberOfItems, page.kind === 'hub' ? maps.length : rows.length);
  assert.equal(collection.mainEntity.itemListElement.length, collection.mainEntity.numberOfItems);
  const crumbs = [...d.querySelectorAll('.breadcrumbs li')].map(node => node.textContent);
  assert.deepEqual(breadcrumb.itemListElement.map(entry => entry.name), crumbs, 'Structured breadcrumbs match visible navigation');
  for (const row of rows) {
    const record = localized.records.find(record => record.id === row.dataset.recordId);
    assert(row.querySelector('th').textContent.includes(record.name), 'Names use the same official overlay as the checker');
    const link = row.querySelector('td:last-child a'), url = new URL(link.href);
    assert.equal(url.pathname, page.language === 'en' ? '/phantom-blade-zero/en/' : '/phantom-blade-zero/');
    assert.equal(url.searchParams.get('map'), record.mapId); assert.equal(url.searchParams.get('category'), record.category); assert.equal(url.searchParams.get('item'), record.id);
    assert.equal(url.hash, '#workspace', 'Deep links land at the map and checklist');
    assert.equal([...url.searchParams.keys()].length, 3);
    if (record.id === 'XiGu:blackStone:001') {
      const name = page.language === 'en' ? overlay.bells.Bell_NLES_019 : '恶弓手营地';
      assert(row.cells[1].textContent.includes(name) && row.cells[1].textContent.includes('12 m'), 'A known shard is referenced to the nearest same-map bell using source XYZ');
    }
  }
  for (const node of d.querySelectorAll('a[href],link[rel="stylesheet"],img[src]')) {
    const url = new URL(node.getAttribute('href') ?? node.getAttribute('src'), dom.location.href);
    if (url.origin !== 'https://game.kero.zone') continue;
    if (url.hash && url.pathname === page.path) assert(d.getElementById(decodeURIComponent(url.hash.slice(1))), `Broken guide section ${url.hash}`);
    const target = path.join(publicRoot, url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
    await fs.access(target);
  }
  for (const image of d.querySelectorAll('.guide-preview img')) {
    assert.equal(image.loading, 'lazy'); assert(image.alt.trim()); assert(Number(image.width) > 0 && Number(image.height) > 0); checkedPreviews++;
  }
  if (page.kind === 'map') assert.equal(d.querySelectorAll('.guide-preview').length, 1);
  if (page.kind === 'category') assert.equal(d.querySelectorAll('.guide-preview').length, new Set(expectedRows.map(record => record.mapId)).size);
  assert(d.querySelector('a[href^="/phantom-blade-zero/"]'));
  assert(!/BPF_|_UAID_|\b[0-9A-F]{32}\b/.test(d.body.textContent), 'Raw event matching identifiers are not player instructions');
  checkedRows += rows.length;
  await dom.happyDOM.close();
}
const zhHub = await fs.readFile(path.join(publicRoot, '/phantom-blade-zero/collectibles/index.html'), 'utf8');
for (const page of manifest.pages.filter(page => page.language === 'zh-CN' && page.kind !== 'hub')) assert(zhHub.includes(page.path), 'Every guide is linked from its crawlable hub');
assert.equal(checkedRows, records.length * 4, 'Each location is visible in one map and one category in both languages');
console.log(`PASS guides: ${manifest.pages.length} static pages, ${checkedRows} visible item rows, ${checkedPreviews} lazy map previews; canonical/language pairs, exact counts, structured data, deep filters, privacy and reproducibility`);
