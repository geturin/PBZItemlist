// SPDX-License-Identifier: GPL-3.0-or-later
// Build real English HTML from the Chinese page templates. No browser execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { MESSAGES } from '../public/js/i18n.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const ORIGIN = 'https://game.kero.zone';
const PAGES = [
  { kind: 'portal', source: 'index.html', output: 'en/index.html', zh: '/', en: '/en/' },
  { kind: 'tool', source: 'phantom-blade-zero/index.html', output: 'phantom-blade-zero/en/index.html', zh: '/phantom-blade-zero/', en: '/phantom-blade-zero/en/' },
];

// Static template keys live here when they are not part of the runtime dictionary.
// Keeping the fallback explicit makes missing translations a build error.
const STATIC_EN = {
  'ui.saveLocationTitle': 'Where is my save?',
  'ui.saveLocationStart': 'Steam: right-click the game → Manage → Browse local files. Open',
  'ui.saveLocationEnd': ', enter the numbered account folder, and choose PBZSaveGame.sav.',
  'ui.collectiblesGuide': 'Collectible guides',
  'portal.title': 'Game Collectible Checkers',
  'portal.description': 'Choose a game to browse its collection checklist and check for missed items.',
  'portal.heading': 'Game Collectible Checkers',
  'portal.pbz': 'Phantom Blade Zero',
  'portal.pbzDescription': 'Save checker · collectible locations',
  'portal.open': 'Open checker →',
  'ui.pageTitle': 'Phantom Blade Zero Collectible Checker · Missing Items and Locations',
  'ui.metaDescription': 'Load your Phantom Blade Zero .sav file to check missing bells, amber, blackstone, and other collectibles. Browse locations and related conditions by map. Your save stays in your browser.',
  'ui.ogTitle': 'Phantom Blade Zero Collectible Checker',
  'ui.ogDescription': 'Check your save for missed collectibles and bells, and find their locations.',
  'ui.skip': 'Skip to collection checklist',
  'ui.brand': 'Phantom Blade Zero',
  'ui.brandSubtitle': 'Collectible Checker',
  'ui.allGames': 'All games',
  'ui.help': 'Help',
  'ui.clear': 'Clear save',
  'ui.heading': 'Phantom Blade Zero Collectible Checker',
  'ui.description': 'Find missed items and bells, with locations and collection conditions by map.',
  'ui.privacy': 'Your save is read in your browser. It is never uploaded or modified.',
  'ui.importLabel': 'Choose or drop a Phantom Blade Zero save file',
  'ui.importTitle': 'Load save',
  'ui.dropDescription': 'Drop a .sav file, or click to choose one',
  'ui.chooseSave': 'Choose save',
  'ui.browse': 'Browse items without loading a save',
  'ui.quests': 'Quest journal',
  'ui.replace': 'Change save',
  'ui.overview': 'Collection progress',
  'ui.noSave': 'No save loaded',
  'ui.saveSlot': 'Save slot',
  'ui.chooseSlotLater': 'Load a save to choose',
  'ui.progress': 'Completion',
  'ui.importForProgress': 'Load a save to check',
  'ui.collected': 'Completed',
  'ui.missing': 'Missing',
  'ui.unknown': 'Unverified',
  'ui.map': 'Map',
  'ui.allMaps': 'All maps',
  'ui.category': 'Category',
  'ui.allCategories': 'All categories',
  'ui.search': 'Search items',
  'ui.searchPlaceholder': 'Name, ID, or clue',
  'ui.pendingOnly': 'Missing / unverified only',
  'ui.export': 'Export CSV',
  'ui.loadingCatalog': 'Loading item checklist…',
  'ui.resetFilters': 'Reset filters',
  'ui.mapTitle': 'Item locations',
  'ui.mapMode': 'Map mode',
  'ui.gameMap': '2D map',
  'ui.worldCoordinates': 'World coordinates',
  'ui.terrain2d': 'Floor plan',
  'ui.heightArea': 'Elevation area',
  'ui.selectMap': 'Choose a map',
  'ui.mapInstructions': 'Collectible and bell locations. Arrow keys pan; plus and minus zoom; Home resets the view; Tab selects a marker.',
  'ui.mapEmptyTitle': 'Choose a map',
  'ui.mapEmptyDescription': 'View item locations and select a marker for details.',
  'ui.zoomIn': 'Zoom in',
  'ui.zoomOut': 'Zoom out',
  'ui.zoomReset': 'Reset map view',
  'ui.items': 'Collectibles',
  'ui.bells': 'Bells',
  'ui.mapHint': 'Select a marker for details',
  'ui.list': 'Item checklist',
  'ui.sort': 'Sort',
  'ui.sortStatus': 'Completion status',
  'ui.sortName': 'Name',
  'ui.sortCategory': 'Category',
  'ui.noResults': 'No matching items',
  'ui.changeFilters': 'Try a different map, category, or search term.',
  'ui.loadMore': 'Show more',
  'ui.itemDetails': 'Item details and collection conditions',
  'ui.selectItem': 'Select an item or map marker to view its details.',
  'ui.locationClues': 'Location and clues',
  'ui.completionConditions': 'Collection status and conditions',
  'ui.nearbyBells': 'Nearby bells',
  'ui.evidence': 'Completion evidence and data notes',
  'ui.analysisNotes': 'Notes for this check',
  'ui.faqTitle': 'Frequently asked questions',
  'ui.faqItemsQuestion': 'Which collectibles can I check?',
  'ui.faqItemsAnswer': 'Bells, amber, blackstone, and other collectibles. Filter by map or category to view locations and related quest conditions.',
  'ui.faqSaveQuestion': 'Do I need to load a save?',
  'ui.faqSaveAnswer': 'No. You can browse the checklist and locations directly. Load a .sav file to check your own missing entries.',
  'ui.faqPrivacyQuestion': 'Will my save be uploaded or modified?',
  'ui.faqPrivacyAnswer': 'No. Your file is read and analyzed in your current browser. The tool does not upload files or modify your original save.',
  'ui.unofficial': 'Unofficial tool · check the actual state in your game',
  'ui.helpShort': 'Help',
  'ui.closeHelp': 'Close help',
  'ui.helpImportTitle': 'Load a .sav file',
  'ui.helpImportDescription': 'Choose or drop your game save. It is analyzed in your browser, never uploaded, and never modified.',
  'ui.helpFilterTitle': 'Choose a save slot and map',
  'ui.helpFilterDescription': 'Choose the slot to check, then filter by map, category, or name. Select “Missing / unverified only” to narrow the results.',
  'ui.helpDetailsTitle': 'View locations and conditions',
  'ui.helpDetailsDescription': 'Select an item or marker to see its location, nearby bells, and collection conditions. “Unverified” means the evidence is insufficient; check your game.',
  'ui.helpSession': 'Load your save again after refreshing. CSV export includes the current filtered results. Basic visitor statistics do not include your save content or search terms.',
  'ui.gotIt': 'Got it',
  'ui.closeQuests': 'Close quest journal',
  'ui.questsDescription': 'View quest progress recorded in your current save.',
  'ui.questSearch': 'Search quests and objectives',
  'ui.questSearchPlaceholder': 'Quest, objective, or ID',
  'ui.questStatus': 'Quest status',
  'ui.allStatuses': 'All statuses',
  'ui.activeOnly': 'Active only',
  'ui.doneOnly': 'Completed only',
  'ui.failedOnly': 'Failure records only',
  'ui.unknownOnly': 'Unverified only',
  'ui.questNote': 'Open a quest to view its objectives and branches.',
  'ui.enableJavaScript': 'Enable JavaScript to read your save and filter items locally in your browser.',
};

const ATTRIBUTE_EN = new Map([
  ['工具菜单', 'Tool menu'],
  ['收集检查工具', 'Collection checker'],
  ['地图视图控制', 'Map view controls'],
  ['网站链接', 'Site links'],
]);

function english(key) {
  const value = MESSAGES.en[key] ?? STATIC_EN[key];
  assert.equal(typeof value, 'string', `Missing English translation: ${key}`);
  assert(value.trim() && !/[\u3400-\u9fff]/u.test(value), `Invalid English translation: ${key}`);
  return value;
}

function parse(html, url) {
  const window = new Window({
    url,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, enableFileSystemHttpRequests: false },
  });
  window.document.write(html);
  return window.document;
}

function meta(document, selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) { node = document.createElement('meta'); document.head.append(node); }
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
}

function alternateLinks(document, page) {
  document.querySelectorAll('link[rel="canonical"],link[rel="alternate"][hreflang]').forEach(node => node.remove());
  const canonical = document.createElement('link');
  canonical.rel = 'canonical'; canonical.href = ORIGIN + page.en; document.head.append(canonical);
  for (const [lang, route] of [['zh-CN', page.zh], ['en', page.en], ['x-default', page.zh]]) {
    const link = document.createElement('link');
    link.rel = 'alternate'; link.hreflang = lang; link.href = ORIGIN + route; document.head.append(link);
  }
}

function structuredData(document, page, title, description) {
  document.querySelectorAll('script[type="application/ld+json"]').forEach(node => node.remove());
  const url = ORIGIN + page.en;
  let graph;
  if (page.kind === 'portal') {
    graph = [
      { '@type': 'WebSite', '@id': url + '#website', name: title, description, url, inLanguage: 'en' },
      { '@type': 'CollectionPage', name: title, description, url, inLanguage: 'en',
        mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1,
          item: { '@type': 'WebApplication', name: english('ui.heading'), url: ORIGIN + PAGES[1].en, applicationCategory: 'GameApplication' } }] } },
    ];
  } else {
    const questions = [...document.querySelectorAll('#help details')].map(detail => ({
      '@type': 'Question', name: detail.querySelector('summary')?.textContent.trim(),
      acceptedAnswer: { '@type': 'Answer', text: detail.querySelector('p')?.textContent.trim() },
    }));
    assert(questions.length && questions.every(item => item.name && item.acceptedAnswer.text), 'English FAQ content missing');
    graph = [
      { '@type': 'WebApplication', '@id': url + '#application', name: english('ui.heading'), description, url,
        applicationCategory: 'GameApplication', operatingSystem: 'Web browser', inLanguage: 'en', isAccessibleForFree: true },
      { '@type': 'FAQPage', '@id': url + '#faq', url: url + '#help', inLanguage: 'en', mainEntity: questions },
    ];
  }
  const script = document.createElement('script'); script.type = 'application/ld+json';
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c');
  document.head.append(script);
}

function validateChineseInput(document, page) {
  assert(/^zh(?:-|$)/i.test(document.documentElement.lang), `Chinese template lang: ${page.source}`);
  assert.equal(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), ORIGIN + page.zh, `Chinese canonical: ${page.source}`);
  for (const [lang, route] of [['zh-CN', page.zh], ['en', page.en], ['x-default', page.zh]]) {
    assert.equal(document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)?.getAttribute('href'), ORIGIN + route, `Chinese alternate ${lang}: ${page.source}`);
  }
}

function validateEnglish(document, page) {
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), ORIGIN + page.en);
  for (const [lang, route] of [['zh-CN', page.zh], ['en', page.en], ['x-default', page.zh]]) {
    assert.equal(document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)?.getAttribute('href'), ORIGIN + route);
  }
  assert.equal(document.querySelector('#language-switch')?.getAttribute('href'), page.zh);
  assert.equal(document.querySelector('meta[property="og:url"]')?.content, ORIGIN + page.en);
  assert(document.title && document.querySelector('meta[name="description"]')?.content);
  for (const node of document.querySelectorAll('script[src],link[rel="stylesheet"]')) {
    assert((node.getAttribute('src') ?? node.getAttribute('href')).startsWith('/'), 'Asset must use a root-absolute URL');
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const data = JSON.parse(script.textContent);
    assert(!/[\u3400-\u9fff]/u.test(JSON.stringify(data)), 'Untranslated JSON-LD');
  }
  const walk = node => {
    if (node.nodeType === 3 && /[\u3400-\u9fff]/u.test(node.textContent)) {
      assert(node.parentElement?.closest('#language-switch,script,style'), `Untranslated visible text: ${node.textContent.trim().slice(0,80)}`);
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(document.body);
  for (const node of document.querySelectorAll('[aria-label],[placeholder],[title],meta[content]')) {
    for (const attribute of ['aria-label', 'placeholder', 'title', 'content']) {
      const text = node.getAttribute(attribute);
      assert(!text || !/[\u3400-\u9fff]/u.test(text), `Untranslated ${attribute}: ${text}`);
    }
  }
}

export function buildEnglishPage(source, page) {
  const document = parse(source, ORIGIN + page.zh);
  validateChineseInput(document, page);
  let translated = 0;
  for (const [attribute, target] of [['data-i18n', null], ['data-i18n-aria-label', 'aria-label'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-content', 'content']]) {
    for (const node of document.querySelectorAll(`[${attribute}]`)) {
      const value = english(node.getAttribute(attribute));
      if (target) node.setAttribute(target, value); else node.textContent = value;
      translated++;
    }
  }
  document.documentElement.lang = 'en';
  for (const node of document.querySelectorAll('[aria-label]')) {
    const translation = ATTRIBUTE_EN.get(node.getAttribute('aria-label'));
    if (translation) node.setAttribute('aria-label', translation);
  }
  const title = english(page.kind === 'portal' ? 'portal.title' : 'ui.pageTitle');
  const description = english(page.kind === 'portal' ? 'portal.description' : 'ui.metaDescription');
  document.title = title;
  const ogTitle = page.kind === 'portal' ? title : english('ui.ogTitle');
  const ogDescription = page.kind === 'portal' ? description : english('ui.ogDescription');
  for (const [name, content] of [['description', description], ['twitter:title', ogTitle], ['twitter:description', ogDescription]]) meta(document, `meta[name="${name}"]`, { name, content });
  for (const [property, content] of [['og:title', ogTitle], ['og:description', ogDescription], ['og:url', ORIGIN + page.en], ['og:locale', 'en_US'], ['og:locale:alternate', 'zh_CN'], ['og:site_name', english('portal.title')], ['og:image:alt', ogTitle]]) meta(document, `meta[property="${property}"]`, { property, content });
  alternateLinks(document, page);

  // Resolve assets against the source route before moving its copy deeper.
  for (const node of document.querySelectorAll('script[src],link[rel="stylesheet"],link[rel="icon"],img[src]')) {
    const attribute = node.hasAttribute('src') ? 'src' : 'href';
    const value = node.getAttribute(attribute);
    if (!value || /^(?:data:|blob:)/i.test(value)) continue;
    const url = new URL(value, ORIGIN + page.zh);
    assert.equal(url.origin, ORIGIN, 'Unexpected external page asset');
    node.setAttribute(attribute, url.pathname + url.search + url.hash);
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    if (anchor.id === 'language-switch') continue;
    const value = anchor.getAttribute('href');
    if (!value || value.startsWith('#')) continue;
    const url = new URL(value, ORIGIN + page.zh);
    if (url.origin !== ORIGIN) continue;
    const target = PAGES.find(candidate => candidate.zh === url.pathname || candidate.source === url.pathname.replace(/^\//, ''));
    if (target) anchor.setAttribute('href', target.en + url.search + url.hash);
    else if (page.kind === 'tool' && url.pathname.startsWith('/phantom-blade-zero/collectibles/')) anchor.setAttribute('href', '/phantom-blade-zero/en/' + url.pathname.slice('/phantom-blade-zero/'.length) + url.search + url.hash);
  }
  const languageSwitch = document.querySelector('#language-switch');
  assert(languageSwitch, `Missing language switch: ${page.source}`);
  languageSwitch.textContent = '中文'; languageSwitch.setAttribute('href', page.zh);
  languageSwitch.setAttribute('lang', 'zh-CN'); languageSwitch.setAttribute('hreflang', 'zh-CN');
  languageSwitch.setAttribute('aria-label', 'Switch to Chinese');
  structuredData(document, page, title, description);
  validateEnglish(document, page);
  const html = '<!doctype html>\n<!-- SPDX-License-Identifier: GPL-3.0-or-later -->\n' + document.documentElement.outerHTML + '\n';
  // Validate a fresh parse too, so serialized head metadata and HTML are checked.
  validateEnglish(parse(html, ORIGIN + page.en), page);
  return { html, translated };
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function buildSitemap(guidePages = []) {
  const entries = PAGES.flatMap(page => [page.zh, page.en].map(route => {
    const alternates = [['zh-CN', page.zh], ['en', page.en], ['x-default', page.zh]]
      .map(([lang, target]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${xmlEscape(ORIGIN + target)}"/>`).join('\n');
    return `  <url>\n    <loc>${xmlEscape(ORIGIN + route)}</loc>\n${alternates}\n  </url>`;
  }));
  for (const page of guidePages) {
    const zh = page.language === 'zh-CN' ? page.path : page.alternatePath;
    const en = page.language === 'en' ? page.path : page.alternatePath;
    const alternates = [['zh-CN', zh], ['en', en], ['x-default', zh]]
      .map(([lang, target]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${xmlEscape(ORIGIN + target)}"/>`).join('\n');
    entries.push(`  <url>\n    <loc>${xmlEscape(ORIGIN + page.path)}</loc>\n${alternates}\n  </url>`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + entries.join('\n') + '\n</urlset>\n';
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === '--check'), 'Usage: node scripts/build_pages.mjs [--check]');
  const check = args.includes('--check');
  const inputs = await Promise.all(PAGES.map(page => fs.readFile(path.join(PUBLIC, page.source), 'utf8')));
  const guidePages = JSON.parse(await fs.readFile(path.join(PUBLIC, 'data/guide-pages.json'), 'utf8')).pages;
  const results = inputs.map((source, index) => ({ ...PAGES[index], ...buildEnglishPage(source, PAGES[index]) }));
  const outputs = results.map(result => [result.output, result.html]);
  outputs.push(['robots.txt', `User-agent: *\nAllow: /\nDisallow: /stats/\nDisallow: /data/map-images-hi/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`], ['sitemap.xml', buildSitemap(guidePages)]);
  for (const [relative, content] of outputs) {
    const target = path.join(PUBLIC, relative);
    if (check) assert.equal(await fs.readFile(target, 'utf8'), content, `Generated file is stale: ${relative}`);
    else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8'); }
  }
  console.log(JSON.stringify({ mode: check ? 'check' : 'build', pages: results.map(result => ({ source: result.source, output: result.output, translated: result.translated })), sitemapUrls: 4 + guidePages.length, outputs: outputs.map(([relative]) => relative) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
