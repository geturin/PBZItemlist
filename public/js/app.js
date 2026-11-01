// SPDX-License-Identifier: GPL-3.0-or-later
// Save data lives in this page's memory only. No upload, storage, or telemetry.
import { decodeSave } from './save-codec.js?v=2.0.0';
import { analyzeSlot } from './completion.js?v=2.0.0';
import { createMapView } from './map-view.js?v=2.0.0';
import { normalizeLanguage, localizeCatalog, t } from './i18n.js?v=2.0.0';
import { loadTerrainForMap, terrainBand, terrainFocusBounds } from './terrain-data.js?v=2.0.0';
import { drawTerrain2D } from './terrain-2d.js?v=2.0.0';

const LANGUAGE = normalizeLanguage(document.documentElement.lang);
const LOCALE = LANGUAGE === 'en' ? 'en-US' : 'zh-CN';
const L = (zh, en) => LANGUAGE === 'en' ? en : zh;
const T = (key, params = {}) => t(key, params, LANGUAGE);
const number = value => Number(value).toLocaleString(LOCALE);

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const PAGE_SIZE = 100;
const STATUS = { done: T('status.done'), missing: T('status.missing'), unknown: T('status.unknown'), browse: T('status.browse') };
const COLORS = { done: '#99b88b', missing: '#d99d7f', unknown: '#d5bf80', browse: '#c9af79' };
const CATEGORY_SYMBOLS = { bell: '铃', amber: '琥', hupo: '琥', blackStone: '石', blackstone: '石', heishi: '石', memoryFlower: '花', flower: '花', weapon: '刃', mainWeapon: '刃', shaqiWeapon: '武', shaqi: '武', phantomEdge: '武', accessory: '饰', medicine: '药', rongShu: '榕', longZhu: '柱', scarecrow: '试', challenge: '试', key: '钥', book: '书', quest: '闻', treasure: '藏', material: '材', primary: '物' };
const CATEGORY_NAMES = { bell: '铃铛', amber: '杀气琥珀', hupo: '杀气琥珀', blackStone: '黑石', blackstone: '黑石', heishi: '黑石', memoryFlower: '记忆之花', flower: '记忆之花', weapon: '主武器', mainWeapon: '主武器', shaqiWeapon: '影之武装', shaqi: '影之武装', phantomEdge: '影之武装', accessory: '饰品', medicine: '药瓶', rongShu: '榕树挑战', longZhu: '龙柱挑战', scarecrow: '稻草人挑战', challenge: '挑战', key: '钥匙与机关', book: '书籍', quest: '异闻与任务', treasure: '宝藏', material: '材料', primary: '剧情物品' };
const state = { catalog: null, catalogPromise: null, baseRecords: [], records: [], maps: [], categories: [], decoded: null, slot: null, analysis: null, file: null, map: 'all', category: 'all', query: '', pendingOnly: false, sort: 'status', selected: null, pageSize: PAGE_SIZE, busy: false, loadToken: 0, zoom: 1, panX: 0, panY: 0, mapItems: [], mapMode: 'game', warnings: [], drag: null, lastMapScope: null, questQuery: '', questStatus: 'all', questExpanded: new Set() };
state.mapMode = 'terrain';
Object.assign(state, { terrainMapId: null, terrainStatus: '', terrainData: null, terrainBandId: null,
  terrainLoadId: 0, terrainSelectedKey: null, terrainHeightFocus: false, terrain3d: null, terrain3dPromise: null, terrain3dSignature: '' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function human(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => human(entry)).filter(Boolean).join(L('；', '; '));
  return human(value.label ?? value.name ?? value.name_zh ?? value.description ?? value.detail ?? value.text ?? value.reason ?? value.id, fallback);
}
function objectList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) => typeof item === 'object' && item !== null ? { id, ...item } : { id, name: item });
  return [];
}
function itemId(item) { return String(item.id ?? item.ID ?? item.row ?? item.key ?? ''); }
function itemMap(item) { return String(item.mapId ?? item.mapID ?? item.map_id ?? item.map ?? item.mapName ?? 'unmapped'); }
function itemCategory(item) { return String(item.category ?? item.categoryId ?? item.type ?? 'other'); }
function named(item, fallback = '') { return human(item.name ?? item.title ?? item.name_zh ?? item.nameZh ?? item.title_zh, fallback); }
function position(item) {
  const p = item.location ?? item.position ?? item.coordinates ?? item.worldPosition ?? item.mapPosition;
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.X ?? p.x ?? (Array.isArray(p) ? p[0] : NaN));
  const y = Number(p.Y ?? p.y ?? (Array.isArray(p) ? p[1] : NaN));
  const z = Number(p.Z ?? p.z ?? (Array.isArray(p) ? p[2] : NaN));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { X: x, Y: y, Z: Number.isFinite(z) ? z : null };
}
function mapName(id) { return state.maps.find((item) => item.id === id)?.name ?? (id === 'unmapped' ? L('地图待确认', 'Map unverified') : id); }
function categoryName(id) { return state.categories.find((item) => item.id === id)?.name ?? (LANGUAGE === 'en' ? T(`category.${id}`) : CATEGORY_NAMES[id]) ?? id; }
function categorySymbol(id) { return LANGUAGE === 'en' ? ({ bell: 'B', amber: 'A', blackStone: 'S', memoryFlower: 'F', weapon: 'W', shaqiWeapon: 'P', accessory: 'A', medicine: 'M', rongShu: 'H', longZhu: 'D', scarecrow: 'C', key: 'K', primary: 'I' }[id] ?? '•') : CATEGORY_SYMBOLS[id] ?? '物'; }
function playerText(value, fallback = '') { const text = human(value); return LANGUAGE === 'en' && /[\u3400-\u9fff]/u.test(text) ? fallback : text || fallback; }
function completionText(record) {
  return ({ done: L('存档已记录此项完成。', 'Your save records this entry as completed.'), missing: L('当前存档尚无此项完成记录。', 'No completion record was found in this save.'), unknown: L('现有记录不足以确认，请在游戏内核对。', 'There is not enough evidence to confirm this entry. Check your game.'), browse: L('导入存档后检查收集状态。', 'Load a save to check collection status.') })[statusOf(record)];
}
function errorMessage(error, context = 'save') {
  if (context === 'catalog') return L('物品清单暂时无法读取，请刷新页面重试。', 'The item checklist could not be loaded. Refresh the page and try again.');
  if (context === 'slot') return L('无法读取此栏位，请尝试其他存档栏位。', 'This slot could not be read. Try another save slot.');
  if (error?.code === 'DECOMPRESSION') return L('无法解压存档，请更新浏览器或尝试其他存档。', 'The save could not be decompressed. Update your browser or try another save.');
  return L('无法读取此存档，请确认游戏版本或尝试其他存档。', 'This save could not be read. Check the game version or try another save.');
}
function statusOf(record) {
  if (!state.slot) return 'browse';
  const raw = String(record.status ?? '').toLowerCase();
  if (['done', 'completed', 'complete', 'collected', 'acquired'].includes(raw)) return 'done';
  if (['missing', 'incomplete', 'not_done', 'not_collected', 'uncollected'].includes(raw)) return 'missing';
  return 'unknown';
}
function setNotice(message = '', kind = '') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = `notice${message ? '' : ' hidden'}${kind ? ` ${kind}` : ''}`;
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}
function setBusy(value) {
  state.busy = value;
  $('dropzone').setAttribute('aria-disabled', String(value));
  $('slot-select').disabled = value || !state.decoded?.slots?.length;
  $('clear-button').disabled = value || !state.decoded;
  $('replace-button').disabled = value;
  $('quests-button').disabled = value || !state.slot;
  $('export-button').disabled = value || !filteredRecords().length;
}
function safeExternalURL(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function addParagraphs(container, value, className = '') {
  const text = human(value);
  if (!text) return false;
  for (const line of text.split(/\r?\n/).filter(Boolean)) container.append(element('p', className, line));
  return true;
}
function normalizeCatalog(catalog) {
  state.catalog = catalog;
  state.maps = objectList(catalog.maps).map((item) => typeof item === 'string' ? { id: item, name: item } : item).map((item) => ({ ...item, id: String(item.id ?? item.mapId ?? item.key ?? item.slug ?? item.name), name: named(item, String(item.id ?? item.slug ?? '未知地图')) }));
  state.categories = objectList(catalog.categories).map((item) => typeof item === 'string' ? { id: item, name: CATEGORY_NAMES[item] ?? item } : item).map((item) => ({ ...item, id: String(item.id ?? item.key ?? item.category ?? item.slug ?? item.name), name: named(item, CATEGORY_NAMES[item.id] ?? String(item.id ?? '其他')) }));
  const records = objectList(catalog.records).filter((record) => !record.aggregationParent && !(record.counted === false && record.category === 'memoryFlower'));
  const seen = new Set();
  state.baseRecords = records.map((record, index) => {
    const id = itemId(record) || `record-${index}`;
    const category = itemCategory(record);
    const mapId = itemMap(record);
    const key = `${category}|${id}|${index}`;
    seen.add(category);
    return { ...record, id, category, mapId, name: named(record, id), _key: key, _index: index };
  });
  for (const id of seen) if (!state.categories.some((item) => item.id === id)) state.categories.push({ id, name: CATEGORY_NAMES[id] ?? id });
  for (const record of state.baseRecords) if (!state.maps.some((map) => map.id === record.mapId)) state.maps.push({ id: record.mapId, name: mapName(record.mapId) });
  state.records = state.baseRecords.map((record) => ({ ...record, status: 'browse' }));
  fillFilters();
}
async function loadCatalog() {
  if (state.catalog) return state.catalog;
  if (state.catalogPromise) return state.catalogPromise;
  state.catalogPromise = (async () => {
    const responses = await Promise.all([
      fetch(new URL('../data/catalog.json', import.meta.url), { cache: 'no-cache' }),
      ...(LANGUAGE === 'en' ? [fetch(new URL('../data/catalog.en.json', import.meta.url), { cache: 'no-cache' })] : []),
    ]);
    if (responses.some(response => !response.ok)) throw new Error('CATALOG');
    const [base, overlay] = await Promise.all(responses.map(response => response.json()));
    const catalog = localizeCatalog(base, overlay, LANGUAGE);
    if (!catalog || !Array.isArray(catalog.records)) throw new Error('CATALOG');
    normalizeCatalog(catalog);
    render();
    return catalog;
  })();
  try { return await state.catalogPromise; } catch (error) { state.catalogPromise = null; throw error; }
}
function fillFilters() {
  const mapSelect = $('map-select');
  const categorySelect = $('category-select');
  mapSelect.replaceChildren(new Option(T('label.allMaps'), 'all'));
  categorySelect.replaceChildren(new Option(T('label.allCategories'), 'all'));
  for (const map of state.maps) mapSelect.add(new Option(map.name, map.id));
  for (const category of state.categories) categorySelect.add(new Option(category.name, category.id));
  mapSelect.value = state.map;
  categorySelect.value = state.category;
}
function filteredRecords(ignoreMap = false) {
  let records = state.records.filter((record) => (ignoreMap || state.map === 'all' || record.mapId === state.map) && (state.category === 'all' || record.category === state.category) && (!state.pendingOnly || statusOf(record) !== 'done'));
  if (state.query) {
    const query = state.query.toLocaleLowerCase();
    records = records.filter((record) => [record.name, record.nameZh, record.id, mapName(record.mapId), state.maps.find(map => map.id === record.mapId)?.nameZh, categoryName(record.category), state.categories.find(category => category.id === record.category)?.nameZh, human(record.description), human(record.reason), ...objectList(record.requirements).map(requirement => [requirement.label, requirement.labelZh, requirement.id].join(' ')), human(record.locationHint)].join(' ').toLocaleLowerCase().includes(query));
  }
  const priority = { missing: 0, unknown: 1, browse: 2, done: 3 };
  return records.sort((a, b) => {
    if (state.sort === 'status') { const delta = priority[statusOf(a)] - priority[statusOf(b)]; if (delta) return delta; }
    if (state.sort === 'category') { const delta = categoryName(a.category).localeCompare(categoryName(b.category), LOCALE); if (delta) return delta; }
    return mapName(a.mapId).localeCompare(mapName(b.mapId), LOCALE) || a.name.localeCompare(b.name, LOCALE) || a.id.localeCompare(b.id);
  });
}
function currentSummary() {
  const records = state.records.filter((record) => (state.map === 'all' || record.mapId === state.map) && (state.category === 'all' || record.category === state.category));
  return records.reduce((sum, record) => { sum.total += 1; sum[statusOf(record)] += 1; return sum; }, { total: 0, done: 0, missing: 0, unknown: 0, browse: 0 });
}
function renderStats() {
  const summary = currentSummary();
  const loaded = Boolean(state.slot);
  const percent = summary.total ? (summary.done / summary.total * 100) : 0;
  $('stat-percent').textContent = loaded ? `${percent.toFixed(1)}%` : '—';
  $('stat-fraction').textContent = loaded ? L(`${number(summary.done)} / ${number(summary.total)} 个点位`, `${number(summary.done)} / ${number(summary.total)} locations`) : L(`${number(summary.total)} 个可浏览点位`, `${number(summary.total)} locations to browse`);
  for (const key of ['done', 'missing', 'unknown']) $(`stat-${key}`).textContent = loaded ? summary[key].toLocaleString() : '—';
  $('progress-fill').style.width = loaded ? `${percent}%` : '0%';
  $('pending-only').disabled = !loaded;
  $('session-label').textContent = loaded ? slotLabel(state.slot) : L('未导入存档 · 可浏览物品', 'No save loaded · browse items');
}
function renderList(records) {
  const list = $('record-list');
  const fragment = document.createDocumentFragment();
  for (const record of records.slice(0, state.pageSize)) {
    const status = statusOf(record);
    const button = element('button', `record-button${state.selected === record._key ? ' is-selected' : ''}`);
    button.type = 'button';
    button.dataset.key = record._key;
    button.setAttribute('aria-pressed', String(state.selected === record._key));
    button.setAttribute('aria-label', [record.name, categoryName(record.category), mapName(record.mapId), STATUS[status]].join(L('，', ', ')));
    button.append(element('span', 'record-symbol', categorySymbol(record.category)));
    const main = element('span', 'record-main');
    main.append(element('strong', '', record.name));
    const meta = element('span', 'record-meta');
    meta.append(element('span', 'category-label', categoryName(record.category)), element('span', 'divider', '·'), element('span', '', mapName(record.mapId)));
    main.append(meta);
    const statusNode = element('span', `record-status ${status}`);
    if (status !== 'browse') statusNode.append(element('i', `status-dot ${status}`));
    statusNode.append(document.createTextNode(state.slot ? STATUS[status] : L('查看位置', 'View location')));
    button.append(main, statusNode, element('span', 'record-arrow', '›'));
    button.addEventListener('click', () => selectRecord(record._key));
    fragment.append(button);
  }
  list.replaceChildren(fragment);
  list.classList.toggle('hidden', records.length === 0);
  $('list-empty').classList.toggle('hidden', records.length !== 0);
  $('visible-count').textContent = records.length.toLocaleString();
  $('list-pagination').classList.toggle('hidden', records.length <= PAGE_SIZE);
  $('load-more').classList.toggle('hidden', state.pageSize >= records.length);
  $('pagination-summary').textContent = T('list.showing', { shown: number(Math.min(state.pageSize, records.length)), total: number(records.length) });
  $('results-summary').textContent = state.catalog ? L(`${number(records.length)} 个点位${state.slot ? '' : ' · 导入存档可检查遗漏'}`, `${number(records.length)} locations${state.slot ? '' : ' · load a save to check missing entries'}`) : T('save.loadingCatalog');
  $('reset-filters').classList.toggle('hidden', !(state.map !== 'all' || state.category !== 'all' || state.query || state.pendingOnly));
  $('export-button').disabled = !records.length || state.busy;
}
function resetView() { state.zoom = 1; state.panX = 0; state.panY = 0; applyMapView(); }
function applyMapView() { $('map-world').setAttribute('transform', `translate(${state.panX} ${state.panY}) translate(380 295) scale(${state.zoom}) translate(-380 -295)`); }
function mapScopeId() {
  if (state.map !== 'all') return state.map;
  return state.records.find((record) => record._key === state.selected)?.mapId ?? null;
}
function publicBellRows(mapId) {
  const source = objectList(state.catalog?.bells);
  return source.filter((bell) => itemMap(bell) === mapId && position(bell)).map((bell) => ({ ...bell, id: itemId(bell), name: named(bell, itemId(bell)), mapId }));
}
function ensureTerrain(mapId) {
  if (state.terrainMapId === mapId && state.terrainStatus) return;
  const token = ++state.terrainLoadId;
  Object.assign(state, { terrainMapId: mapId, terrainStatus: 'loading', terrainData: null,
    terrainBandId: null, terrainSelectedKey: null, terrain3dSignature: '' });
  loadTerrainForMap(mapId).then(result => {
    if (token !== state.terrainLoadId) return;
    state.terrainData = result?.geometry ?? null;
    state.terrainStatus = result ? 'ready' : 'missing';
    if (mapScopeId() === mapId) renderMap(filteredRecords());
  }).catch(() => {
    if (token !== state.terrainLoadId) return;
    state.terrainStatus = 'error';
    if (mapScopeId() === mapId) renderMap(filteredRecords());
  });
}
function terrainContext(mapId, allPoints) {
  const geometry = state.terrainMapId === mapId ? state.terrainData : null;
  if (!geometry) return null;
  const selectedPoint = state.records.find(record => record._key === state.selected);
  let band = terrainBand(geometry, mapId, undefined, state.terrainBandId);
  if (state.terrainSelectedKey !== state.selected || state.terrainHeightFocus) {
    state.terrainSelectedKey = state.selected;
    band = terrainBand(geometry, mapId, position(selectedPoint || {})?.Z, state.terrainBandId);
  }
  state.terrainBandId = band?.id ?? null;
  const sourceFocus = terrainFocusBounds(geometry, mapId, band);
  const focusBounds = sourceFocus ? { min: [...sourceFocus.min], max: [...sourceFocus.max] } : null;
  const bandRange = band ? [band.bounds.min[2] - 100, band.bounds.max[2] + 100] : [-Infinity, Infinity];
  if (focusBounds) for (const point of allPoints) {
    const p = position(point);
    if (!p || p.Z < bandRange[0] || p.Z > bandRange[1]) continue;
    focusBounds.min[0] = Math.min(focusBounds.min[0], p.X); focusBounds.min[1] = Math.min(focusBounds.min[1], p.Y);
    focusBounds.max[0] = Math.max(focusBounds.max[0], p.X); focusBounds.max[1] = Math.max(focusBounds.max[1], p.Y);
  }
  const selectedZ = position(selectedPoint || {})?.Z;
  const heightRange = state.terrainHeightFocus && Number.isFinite(selectedZ)
    ? [selectedZ - 800, selectedZ + 800] : bandRange;
  const select = $('map-height-band');
  select.replaceChildren(...(geometry.zBands || []).map((entry, index) => new Option(
    L(`区域 ${index + 1} · ${Math.round(entry.bounds.min[2] / 100)}～${Math.round(entry.bounds.max[2] / 100)} 米`,
      `Area ${index + 1} · ${Math.round(entry.bounds.min[2] / 100)}–${Math.round(entry.bounds.max[2] / 100)} m`), entry.id)));
  select.value = band?.id ?? '';
  select.disabled = geometry.zBands?.length < 2;
  $('map-height-focus').disabled = !Number.isFinite(selectedZ);
  $('map-height-focus').checked = state.terrainHeightFocus;
  return { geometry, band, focusBounds, heightRange };
}
function inTerrainRange(point, context) {
  const z = position(point)?.Z;
  return !context || Number.isFinite(z) && z >= context.heightRange[0] && z <= context.heightRange[1];
}
function showTerrain3D(context, points, mapId) {
  if (state.terrain3d && !state.terrain3d.available) {
    state.mapMode = 'terrain'; $('map-view-select').value = 'terrain';
    setNotice(L('此设备无法显示 3D，已切换为 2D 地形图。', '3D is unavailable on this device. Showing the 2D terrain map.'));
    renderMap(filteredRecords()); return;
  }
  if (!state.terrain3dPromise) state.terrain3dPromise = import('./terrain-view.js?v=2.0.0').then(async ({ createTerrainView }) => {
    state.terrain3d = await createTerrainView($('map-3d'), { language: LANGUAGE,
      onSelect: key => { if (state.records.some(record => record._key === key)) selectRecord(key); },
      onError: () => { if (state.mapMode === '3d') { state.mapMode = 'terrain'; $('map-view-select').value = 'terrain'; renderMap(filteredRecords()); } },
    });
    if (!state.terrain3d.available && state.mapMode === '3d') {
      state.mapMode = 'terrain'; $('map-view-select').value = 'terrain';
      setNotice(L('此设备无法显示 3D，已切换为 2D 地形图。', '3D is unavailable on this device. Showing the 2D terrain map.'));
    }
    renderMap(filteredRecords());
  }).catch(() => {
    state.terrain3d = { available: false };
    if (state.mapMode === '3d') {
      state.mapMode = 'terrain'; $('map-view-select').value = 'terrain';
      setNotice(L('3D 资源暂时无法载入，已切换为 2D 地形图。', '3D resources could not be loaded. Showing the 2D terrain map.'));
      renderMap(filteredRecords());
    }
  });
  if (!state.terrain3d?.available) return;
  const signature = JSON.stringify([mapId, context.band?.id, context.heightRange, points.map(point => [point._key ?? point.id, point.status])]);
  if (signature !== state.terrain3dSignature) {
    state.terrain3dSignature = signature;
    state.terrain3d.setData(context.geometry, points, { mapId, focusBounds: context.focusBounds,
      heightRange: context.heightRange, bandId: context.band?.id });
    if (context.band) state.terrain3d.setBand(context.band.id);
    state.terrain3d.setHeightRange(...context.heightRange);
  }
  if (state.terrain3dSelected !== state.selected) {
    state.terrain3dSelected = state.selected;
    state.terrain3d.select(state.selected);
  }
  state.terrain3d.resize();
}
function renderMap(records) {
  const world = $('map-world');
  world.replaceChildren();
  const mapId = mapScopeId();
  const empty = $('map-empty');
  const legend = $('map-status-legend');
  legend.classList.toggle('hidden', !state.slot);
  const terrainMode = ['terrain', '3d'].includes(state.mapMode);
  $('map-3d').classList.add('hidden');
  $('coordinate-map').classList.remove('hidden');
  $('map-surface-controls').classList.add('hidden');
  $('zoom-in').classList.toggle('hidden', state.mapMode === '3d');
  $('zoom-out').classList.toggle('hidden', state.mapMode === '3d');
  if (!mapId) {
    empty.classList.remove('hidden');
    empty.querySelector('strong').textContent = L('选择一个地图', 'Choose a map');
    empty.querySelector('p').textContent = L('选择地图或物品，查看对应位置。', 'Choose a map or item to see its location.');
    $('map-scope').textContent = L('选择地图查看', 'Choose a map');
    $('map-projection-note').textContent = L('点击标记查看详情', 'Select a marker for details');
    state.mapItems = [];
    return;
  }
  if (state.lastMapScope !== mapId) { state.lastMapScope = mapId; resetView(); }
  const scopeRecords = records.filter((record) => record.mapId === mapId);
  const boundsRecords = state.records.filter((record) => record.mapId === mapId && position(record));
  const bells = publicBellRows(mapId);
  const allPoints = [...boundsRecords, ...bells];
  if (terrainMode) ensureTerrain(mapId);
  const terrain = terrainMode ? terrainContext(mapId, allPoints) : null;
  const metadata = { ...state.maps.find((map) => map.id === mapId) };
  if (terrain?.focusBounds) {
    const { min, max } = terrain.focusBounds;
    const padX = Math.max(1000, (max[0] - min[0]) * .04), padY = Math.max(1000, (max[1] - min[1]) * .04);
    metadata.worldBounds = { minX: min[0] - padX, maxX: max[0] + padX, minY: min[1] - padY, maxY: max[1] + padY };
  }
  const view = createMapView(allPoints, metadata, { mode: terrainMode ? 'world' : state.mapMode });
  const located = scopeRecords.filter((record) => view.project(record) && inTerrainRange(record, terrain));
  const plottedBells = bells.filter((bell) => view.project(bell) && inTerrainRange(bell, terrain));
  const unprojected = scopeRecords.filter((record) => position(record) && !view.project(record)).length;
  $('map-title').textContent = view.mode === 'game' ? L('游戏地图坐标', 'Game map coordinates') : L('世界坐标图', 'World coordinates');
  $('map-compass').classList.toggle('hidden', view.mode === 'game');
  $('map-projection-note').textContent = view.mode === 'game'
    ? L(`游戏锚点校准 · 无道路底图${unprojected ? ` · ${unprojected} 点待校准，可切换世界坐标` : ''}`, `Game map projection · no road background${unprojected ? ` · ${unprojected} uncalibrated; use world coordinates` : ''}`)
    : state.mapMode === 'game' ? L('此分区暂无可靠投影，显示世界 XY', 'No reliable projection for this region; showing world XY') : L('世界 XY · 非道路导航', 'World XY · not a walkable route');
  $('map-scope').textContent = `${mapName(mapId)} · ${number(located.length)}`;
  $('coordinate-map').dataset.projection = view.mode;
  $('map-stage').dataset.view = state.mapMode;
  if (terrainMode) {
    $('map-title').textContent = state.mapMode === '3d' ? L('3D 地形', '3D terrain') : L('2D 地形', '2D terrain');
    $('map-surface-controls').classList.toggle('hidden', !terrain);
    $('map-projection-note').textContent = terrain
      ? state.mapMode === '3d' ? L('拖动旋转 · 滚轮缩放 · 点击标记', 'Drag to orbit · scroll to zoom · select markers') : L('游戏通行区域 · 可切换 3D 查看高度', 'Game navigation surfaces · switch to 3D to see elevation')
      : state.terrainStatus === 'loading' ? L('正在加载地形…', 'Loading terrain…')
        : L('此分区暂未提供地形，显示坐标', 'No terrain for this region; showing coordinates');
  }
  if (!located.length && !plottedBells.length && !terrain) {
    empty.classList.remove('hidden');
    empty.querySelector('strong').textContent = L('此分区暂无可用坐标', 'No coordinates for this region');
    empty.querySelector('p').textContent = L('仍可选择清单中的物品查看详情。', 'Select an item in the checklist to view its details.');
    state.mapItems = [];
    return;
  }
  empty.classList.add('hidden');
  if (state.mapMode === '3d' && terrain) {
    $('coordinate-map').classList.add('hidden'); $('map-3d').classList.remove('hidden');
    $('map-compass').classList.add('hidden');
    const represented = new Set(located.filter(record => record.category === 'bell').map(record => String(record.source?.bellId ?? record.id).toLowerCase()));
    const points = [...located.map(record => ({ ...record, status: statusOf(record) })),
      ...bells.filter(bell => !represented.has(bell.id.toLowerCase())).map(bell => ({ ...bell, _key: `bellref:${bell.id}`, category: 'bell' }))];
    state.mapItems = located;
    showTerrain3D(terrain, points, mapId);
    return;
  }
  const project = view.project;
  if (terrainMode && terrain) {
    const foreign = svgElement('foreignObject', { x: 0, y: 0, width: 760, height: 590, 'aria-hidden': 'true', 'pointer-events': 'none' });
    const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = 1520; canvas.height = 1180; canvas.style.width = '760px'; canvas.style.height = '590px';
    foreign.append(canvas); world.append(foreign);
    const draw = drawTerrain2D(canvas, terrain.geometry, point => {
      const p = project(point); return p ? { x: p.x * 2, y: p.y * 2 } : null;
    }, { heightRange: terrain.heightRange, focusBounds: terrain.focusBounds });
    $('map-stage').dataset.terrain = draw.available ? 'ready' : 'unavailable';
  }
  const axis = svgElement('g', { 'aria-hidden': 'true' });
  if (view.mode === 'game') axis.append(svgElement('rect', { ...view.frame, fill: 'none', stroke: 'currentColor', opacity: .22, 'stroke-dasharray': '4 5' }));
  for (const tick of view.ticks) axis.append(svgElement('text', { x: tick.x, y: tick.y, 'text-anchor': tick.axis === 'x' ? 'middle' : 'start', class: 'map-axis-label' }, tick.label));
  world.append(axis);
  const bellGroup = svgElement('g', { class: 'map-bells' });
  const representedBells = new Set(located.filter((record) => record.category === 'bell').map((record) => String(record.source?.bellId ?? record.id).toLowerCase()));
  for (const bell of plottedBells) {
    if (representedBells.has(bell.id.toLowerCase())) continue;
    const p = project(bell);
    const marker = svgElement('g', { class: 'bell-map-marker', transform: `translate(${p.x} ${p.y})` });
    marker.dataset.bellId = bell.id;
    marker.append(svgElement('circle', { class: 'point-shape', r: 4, fill: '#17211b', stroke: '#99b88b', 'stroke-width': 1.2 }), svgElement('title', {}, `${L('铃铛', 'Bell')}: ${bell.name}`));
    marker.addEventListener('pointerenter', (event) => showTooltip(event, `${L('铃铛', 'Bell')} · ${bell.name}`));
    marker.addEventListener('pointerleave', hideTooltip);
    bellGroup.append(marker);
  }
  world.append(bellGroup);
  const markerGroup = svgElement('g');
  const sorted = located.slice().sort((a, b) => Number(a._key === state.selected) - Number(b._key === state.selected));
  state.mapItems = sorted;
  for (const record of sorted) {
    const p = project(record);
    const status = statusOf(record), color = COLORS[status];
    const selected = state.selected === record._key;
    const marker = svgElement('g', { class: `map-marker${selected ? ' is-selected' : ''}`, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${record.name}, ${state.slot ? STATUS[status] : L('查看位置', 'View location')}`, 'aria-pressed': selected });
    marker.dataset.key = record._key;
    marker.append(svgElement('circle', { class: 'point-halo', r: 12, fill: `${color}18`, stroke: `${color}66`, 'stroke-width': .8 }));
    if (record.category === 'bell') marker.append(svgElement('circle', { class: 'point-shape', r: 5, fill: '#17211b', stroke: color, 'stroke-width': 1.7 }));
    else marker.append(svgElement('path', { class: 'point-shape', d: 'M0-5.5 5.5 0 0 5.5-5.5 0Z', fill: status === 'done' ? '#17211b' : color, stroke: color, 'stroke-width': status === 'done' ? 1.5 : .8, opacity: status === 'done' ? .7 : 1 }));
    marker.append(svgElement('title', {}, `${record.name} · ${categoryName(record.category)}`));
    if (selected) marker.append(svgElement('text', { class: 'point-label', x: 11, y: -10 }, record.name.slice(0, 24)));
    marker.addEventListener('click', (event) => { event.stopPropagation(); selectRecord(record._key); });
    marker.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRecord(record._key); } });
    marker.addEventListener('pointerenter', (event) => showTooltip(event, `${record.name} · ${categoryName(record.category)}${state.slot ? ` · ${STATUS[status]}` : ''}`));
    marker.addEventListener('pointerleave', hideTooltip);
    markerGroup.append(marker);
  }
  world.append(markerGroup);
  applyMapView();
}
function showTooltip(event, text) {
  const tooltip = $('map-tooltip'), rect = $('map-stage').getBoundingClientRect();
  tooltip.textContent = text;
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX - rect.left + 12, rect.width - 232))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(event.clientY - rect.top - 38, rect.height - 45))}px`;
  tooltip.classList.remove('hidden');
}
function hideTooltip() { $('map-tooltip').classList.add('hidden'); }
function formatCoordinate(value) { return Math.abs(value) >= 100000 ? `${(value / 1000).toFixed(0)}k` : Math.round(value).toLocaleString(); }
function nearestBells(record) {
  if (Array.isArray(record.nearestBells)) return record.nearestBells;
  const p = position(record);
  if (!p) return [];
  return publicBellRows(record.mapId).filter((bell) => bell.id !== record.id).map((bell) => ({ ...bell, distance: Math.hypot(position(bell).X - p.X, position(bell).Y - p.Y), _nativeDistance: true })).sort((a, b) => a.distance - b.distance).slice(0, 3);
}
function renderEvidence(record) {
  const container = $('detail-evidence');
  container.replaceChildren();
  addParagraphs(container, `${L('记录编号', 'Entry ID')}: ${record.id}`);
  if (state.slot) {
    addParagraphs(container, L('原始判定依据', 'Original completion evidence (may include untranslated text)'), 'detail-muted');
    addParagraphs(container, record.reason ?? record.completionReason);
  }
  const labels = { bellId: L('铃铛编号', 'Bell ID'), itemId: L('物品编号', 'Item ID'), weaponId: L('武器编号', 'Weapon ID'), accessoryId: L('饰品编号', 'Accessory ID'), medicineId: L('药品编号', 'Medicine ID'), saveGuid: L('场景对象', 'Scene actor'), mobDomain: L('奖励敌群', 'Reward group'), nodeGuids: L('奖励事件', 'Reward events'), flowAsset: L('关联流程', 'Related flow'), path: L('资源条目', 'Resource'), type: L('来源类型', 'Source type') };
  for (const source of Array.isArray(record.source) ? record.source : record.source ? [record.source] : []) {
    const url = safeExternalURL(typeof source === 'string' ? source : source.url ?? source.href);
    if (url) {
      const paragraph = element('p'), anchor = element('a', '', L('查看来源', 'View source'));
      anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; paragraph.append(anchor); container.append(paragraph);
    } else if (source && typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) if (labels[key] && human(value)) addParagraphs(container, `${labels[key]}: ${human(value)}`);
    }
  }
  for (const condition of objectList(record.conditions)) {
    const text = [human(condition.label), human(condition.detail ?? condition.reason)].filter(Boolean).join(': ');
    if (text) addParagraphs(container, text);
  }
  for (const evidence of Array.isArray(record.evidence) ? record.evidence : [record.evidence]) addParagraphs(container, evidence);
  const originalHint = human(record.locationHint ?? record.hint ?? record.description);
  if (LANGUAGE === 'en' && /[\u3400-\u9fff]/u.test(originalHint)) addParagraphs(container, originalHint);
}
function renderDetail() {
  const record = state.records.find(item => item._key === state.selected);
  $('detail-placeholder').classList.toggle('hidden', Boolean(record));
  $('detail-content').classList.toggle('hidden', !record);
  $('detail-panel').open = Boolean(record);
  if (!record) return;
  const status = statusOf(record);
  $('detail-category').textContent = `${mapName(record.mapId)} / ${categoryName(record.category)}`;
  $('detail-title').textContent = record.name;
  $('detail-id').textContent = ''; $('detail-id').hidden = true;
  $('detail-status').textContent = STATUS[status];
  $('detail-status').className = `status-pill ${status}`;
  const location = $('detail-location'); location.replaceChildren();
  const point = position(record);
  const hint = playerText(record.locationHint ?? record.hint ?? record.description);
  addParagraphs(location, hint || (point ? L('结合地图标记与附近铃铛定位。', 'Use the map marker and nearby bells to find this location.') : L('此项暂无可靠坐标，请在游戏内核对相关物品或任务。', 'No reliable coordinates are available. Check the related item or quest in your game.')));
  $('detail-coordinates').replaceChildren();
  if (point) for (const [axis, value] of Object.entries(point)) if (value !== null) $('detail-coordinates').append(element('span', '', `${axis}  ${number(Math.round(value))}`));
  if (record.mapPosition) addParagraphs(location, L(`地图位置：横向 ${(record.mapPosition.X * 100).toFixed(1)}% · 纵向 ${(record.mapPosition.Y * 100).toFixed(1)}%（从左上角起）`, `Map position: ${(record.mapPosition.X * 100).toFixed(1)}% across · ${(record.mapPosition.Y * 100).toFixed(1)}% down from the top left`), 'detail-muted');
  else if (point) addParagraphs(location, L('此点可在世界坐标模式查看。', 'View this point in world coordinate mode.'), 'detail-muted');
  $('detail-reason').replaceChildren(element('p', '', completionText(record)));
  const conditions = $('detail-conditions'); conditions.replaceChildren();
  for (const [index, requirement] of objectList(record.requirements).entries()) {
    if (!['quest', 'item'].includes(requirement.type)) continue;
    const label = playerText(requirement.label);
    if (!label || label === requirement.id) continue;
    const prerequisite = requirement.relation === 'prerequisite';
    const raw = state.slot ? record.conditions?.[index]?.status : 'unknown';
    const conditionStatus = raw === 'met' ? 'met' : raw === 'unmet' && prerequisite ? 'unmet' : 'unknown';
    const row = element('div', `condition-row ${conditionStatus}`);
    row.append(element('span', 'condition-indicator', conditionStatus === 'met' ? '✓' : '?'));
    const content = element('span', '', `${prerequisite ? L('前置条件', 'Prerequisite') : requirement.type === 'quest' ? L('相关任务', 'Related quest') : L('关联物品', 'Related item')}: ${label}`);
    const statusText = conditionStatus === 'met' ? L('已有记录', 'Recorded') : conditionStatus === 'unmet' ? L('尚未满足', 'Not met') : L('待核对', 'Unverified');
    content.append(element('small', '', statusText));
    row.append(content); conditions.append(row);
  }
  const bellContainer = $('detail-bells'); bellContainer.replaceChildren();
  const bells = nearestBells(record).slice(0, 3);
  if (!bells.length) addParagraphs(bellContainer, L('暂无同分区铃铛参考。', 'No bell reference is available for this region.'), 'detail-muted');
  for (const bell of bells) {
    const row = element('div', 'bell-reference'); row.append(element('span', 'bell-symbol', '•'));
    const content = element('div'); content.append(element('strong', '', named(bell, itemId(bell))));
    const distance = Number(bell.distance), height = Number(bell.heightDelta);
    if (Number.isFinite(distance)) {
      const text = bell._nativeDistance ? L(`XY 直线距离 ${number(Math.round(distance))} 世界单位`, `XY straight-line distance: ${number(Math.round(distance))} world units`) : L(`直线距离 ${distance.toFixed(1)} 米${Number.isFinite(height) ? ` · 高差 ${height >= 0 ? '+' : ''}${height.toFixed(1)} 米` : ''}`, `Straight-line distance: ${distance.toFixed(1)} m${Number.isFinite(height) ? ` · height difference ${height >= 0 ? '+' : ''}${height.toFixed(1)} m` : ''}`);
      content.append(element('small', '', text));
    }
    row.append(content);
    if (state.slot && typeof bell.active === 'boolean') row.append(element('span', `bell-active${bell.active ? '' : ' inactive'}`, bell.active ? L('已开启', 'Activated') : L('未开启', 'Not activated')));
    bellContainer.append(row);
  }
  renderEvidence(record);
}
function renderWarnings() {
  const container = $('analysis-warnings');
  container.replaceChildren();
  const disclosure = container.closest('details');
  if (disclosure) disclosure.classList.add('hidden');
  container.classList.add('hidden');
}
function questStatus(quest) { return ['done', 'active', 'failed'].includes(quest.status) ? quest.status : 'unknown'; }
function renderQuests() {
  const all = state.slot && Array.isArray(state.analysis?.quests) ? state.analysis.quests : [];
  $('quests-count').textContent = all.length.toLocaleString();
  $('quests-button').disabled = state.busy || !state.slot;
  const statusNames = { active: T('quest.active'), done: T('quest.done'), failed: T('quest.failed'), unknown: T('quest.unknown') };
  const priority = { active: 0, failed: 1, unknown: 2, done: 3 };
  const query = state.questQuery.toLocaleLowerCase();
  const filtered = all.filter((quest) => (state.questStatus === 'all' || questStatus(quest) === state.questStatus) && (!query || [named(quest), quest.nameZh, quest.id, ...objectList(quest.branches).map((branch) => [human(branch.label), branch.labelZh, branch.id, human(branch.objectives), human(branch.targets), human(branch.tasks)].join(' '))].join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => priority[questStatus(a)] - priority[questStatus(b)] || named(a, a.id).localeCompare(named(b, b.id), LOCALE));
  const counts = { active: 0, done: 0, failed: 0, unknown: 0 };
  for (const quest of all) counts[questStatus(quest)] += 1;
  const countNode = $('quest-counts');
  countNode.replaceChildren(element('span', 'quest-result-count', L(`${number(filtered.length)} / ${number(all.length)} 项任务`, `${number(filtered.length)} / ${number(all.length)} quests`)));
  for (const status of ['active', 'done', 'failed', 'unknown']) countNode.append(element('span', `quest-count ${status}`, `${statusNames[status]} ${counts[status]}`));
  const list = $('quest-list');
  const fragment = document.createDocumentFragment();
  for (const quest of filtered) {
    const id = String(quest.id ?? '');
    const status = questStatus(quest);
    const details = element('details', `quest-entry ${status}`);
    details.open = state.questExpanded.has(id);
    const summary = element('summary');
    const heading = element('span', 'quest-title');
    heading.append(element('strong', '', playerText(named(quest), L('任务名称待核实', 'Quest name unavailable'))));
    summary.append(heading, element('span', `quest-status ${status}`, statusNames[status]));
    const content = element('div', 'quest-entry-content');
    const branches = objectList(quest.branches);
    if (branches.length) {
      const doneCount = branches.filter((branch) => branch.status === 'done').length;
      content.append(element('p', 'quest-branch-summary', L(`分支记录 · ${number(doneCount)} / ${number(branches.length)} 已完成`, `Objectives · ${number(doneCount)} / ${number(branches.length)} completed`)));
      for (const branch of branches) {
        const branchStatus = ['done', 'active'].includes(branch.status) ? branch.status : 'unknown';
        const row = element('div', `quest-branch ${branchStatus}`);
        row.append(element('span', 'condition-indicator', branchStatus === 'done' ? '✓' : branchStatus === 'active' ? '›' : '?'));
        const description = element('div', 'quest-branch-description');
        const branchHeading = element('div', 'quest-branch-heading');
        branchHeading.append(element('strong', '', playerText(branch.label, L('任务目标待核实', 'Objective text unavailable'))), element('span', '', branchStatus === 'done' ? L('已完成目标', 'Completed objective') : branchStatus === 'active' ? L('当前目标', 'Current objective') : T('status.unknown')));
        description.append(branchHeading);
        const objectives = branch.objectives ?? branch.targets ?? branch.tasks;
        if (Array.isArray(objectives) && objectives.length) {
          const goals = element('ul', 'quest-objectives');
          for (const objective of objectives) { const text = playerText(objective); if (text) goals.append(element('li', '', text)); }
          if (goals.childNodes.length) description.append(goals);
        } else if (typeof objectives === 'string' && playerText(objectives)) description.append(element('p', '', playerText(objectives)));
        if (LANGUAGE === 'en' && /[\u3400-\u9fff]/u.test(human(branch.label))) { const original = element('details', 'evidence-disclosure'); original.append(element('summary', '', T('detail.originalText')), element('p', '', human(branch.label))); description.append(original); }
        row.append(description); content.append(row);
      }
    } else content.append(element('p', 'detail-muted', L('此任务暂无目标记录。', 'No objective records are available for this quest.')));
    details.append(summary, content);
    details.addEventListener('toggle', () => { if (details.open) state.questExpanded.add(id); else state.questExpanded.delete(id); });
    fragment.append(details);
  }
  if (!filtered.length) {
    const empty = element('div', 'quest-empty');
    empty.append(element('strong', '', all.length ? T('quest.empty') : state.slot ? L('此栏位暂无任务记录', 'No quest records in this slot') : L('导入存档后查看任务', 'Load a save to view quests')), element('p', '', all.length ? L('试试更换搜索词或状态筛选。', 'Try a different search term or status filter.') : L('缺少记录不代表已完成或永久错过。', 'Missing records do not mean completed or permanently missable.')));
    fragment.append(empty);
  }
  list.replaceChildren(fragment);
}
function render() {
  renderStats();
  const records = filteredRecords();
  renderList(records);
  renderMap(records);
  renderDetail();
  renderWarnings();
  renderQuests();
}
function selectRecord(key) {
  const focused = document.activeElement;
  const focusOrigin = focused?.classList?.contains('record-button') ? 'list' : focused?.classList?.contains('map-marker') ? 'map' : null;
  state.selected = key;
  $('evidence-disclosure').open = false;
  hideTooltip();
  render();
  if (focusOrigin) {
    const candidates = focusOrigin === 'list' ? $('record-list').children : $('map-world').querySelectorAll('.map-marker');
    Array.from(candidates).find((node) => node.dataset.key === key)?.focus({ preventScroll: true });
  }
}
function slotLabel(slot) {
  const name = String(slot?.name ?? slot?.slot ?? L('存档', 'Save'));
  const display = name.replace(/^AutoSave/i, L('自动存档 ', 'Autosave ')).replace(/^ManualSave/i, L('手动存档 ', 'Manual save '));
  return display === name ? name : display.trim();
}
function headerText(header, key) {
  if (!header || typeof header !== 'object') return '';
  const aliases = { time: ['DateTimeString', 'saveTime', 'SaveTime', 'DateTime', 'dateTime', 'timestamp'], level: ['currentLevel', 'CurrentLevel', 'level', 'Level', 'mapName'], playtime: ['playTime', 'PlayTime', 'GameTime'] };
  for (const alias of aliases[key] ?? []) if (header[alias] !== undefined) return human(header[alias]);
  return '';
}
function fillSlots() {
  const select = $('slot-select');
  select.replaceChildren();
  for (const slot of state.decoded.slots) {
    const time = headerText(slot.header, 'time');
    const option = new Option(`${slotLabel(slot)}${time ? ` · ${time}` : ''}`, String(slot.name ?? slot.slot));
    select.add(option);
  }
  select.value = String(state.slot?.name ?? state.slot?.slot ?? '');
}
async function runAnalysis(slot) {
  const result = await analyzeSlot(slot, state.catalog);
  if (!result || !Array.isArray(result.records)) throw new Error('未能生成点位分析结果，请确认存档和图鉴版本。');
  const byId = new Map(), byCategoryId = new Map();
  for (const record of result.records) { byId.set(itemId(record), record); byCategoryId.set(`${itemCategory(record)}|${itemId(record)}`, record); }
  state.slot = slot;
  const questMetadata = new Map((state.catalog.questMetadata ?? []).map(quest => [quest.id.toLowerCase(), quest]));
  state.analysis = { ...result, quests: (result.quests ?? []).map(quest => {
    const meta = questMetadata.get(String(quest.id).toLowerCase());
    return { ...quest, nameZh: meta?.nameZh ?? meta?.name, branches: (quest.branches ?? []).map(branch => ({ ...branch, labelZh: meta?.branches?.find(item => item.id === branch.id)?.labelZh ?? meta?.branches?.find(item => item.id === branch.id)?.label })) };
  }) };
  state.records = state.baseRecords.map((record) => ({ ...record, ...(byCategoryId.get(`${record.category}|${record.id}`) ?? byId.get(record.id) ?? { status: 'unknown', reason: '此类别未返回明确分析结果。' }), _key: record._key, _index: record._index, id: record.id, category: record.category, mapId: record.mapId, name: record.name }));
  state.warnings = Array.isArray(result.warnings) ? result.warnings : result.warnings ? [result.warnings] : [];
  state.questExpanded.clear();
  fillSlots();
}
async function importFile(file) {
  if (!file || state.busy) return;
  if (!/\.sav$/i.test(file.name)) { setNotice(L('请选择游戏的 .sav 存档文件。', 'Choose a game .sav save file.'), 'error'); return; }
  if (!file.size) { setNotice(L('文件为空，请重新选择存档。', 'The file is empty. Choose another save.'), 'error'); return; }
  if (file.size > 40 * 1024 * 1024) { setNotice(L('文件超过 40 MiB，请确认选择的是游戏存档。', 'The file exceeds 40 MiB. Check that it is a game save.'), 'error'); return; }
  const token = ++state.loadToken;
  setBusy(true);
  setNotice(T('save.processing'), 'busy');
  try {
    await loadCatalog();
    const bytes = await file.arrayBuffer();
    const decoded = await decodeSave(bytes, { onProgress(progress) { if (token === state.loadToken && progress.total) setNotice(L(`正在读取存档（${Math.min(progress.current + 1, progress.total)} / ${progress.total}）…`, `Reading save (${Math.min(progress.current + 1, progress.total)} / ${progress.total})…`), 'busy'); } });
    if (token !== state.loadToken) return;
    if (!decoded || !Array.isArray(decoded.slots) || !decoded.slots.length) throw new Error('没有在文件中找到可用存档槽位。');
    const latest = decoded.slots.find((slot) => String(slot.name ?? slot.slot) === String(decoded.latestSlotName)) ?? decoded.slots[0];
    state.decoded = decoded;
    await runAnalysis(latest);
    if (token !== state.loadToken) return;
    state.file = { name: file.name, size: file.size };
    state.selected = null;
    state.pageSize = PAGE_SIZE;
    $('file-name').textContent = file.name;
    const info = [L(`${decoded.slots.length} 个栏位`, `${decoded.slots.length} slots`), `${(file.size / 1024 / 1024).toFixed(2)} MB`, L('读取完成 · 原存档未修改', 'Loaded · original save unchanged')];
    $('file-meta').textContent = info.join(' · ');
    document.querySelector('.intro').classList.add('loaded');
    $('file-bar').classList.remove('hidden');
    setNotice();
    render();
  } catch (error) {
    if (token !== state.loadToken) return;
    setNotice(errorMessage(error), 'error');
  } finally { if (token === state.loadToken) { setBusy(false); $('file-input').value = ''; } }
}
async function switchSlot(name) {
  if (state.busy || !state.decoded) return;
  const slot = state.decoded.slots.find((item) => String(item.name ?? item.slot) === name);
  if (!slot) return;
  setBusy(true);
  setNotice(L('正在检查此栏位…', 'Checking save slot…'), 'busy');
  try { await runAnalysis(slot); setNotice(); render(); } catch (error) { setNotice(errorMessage(error, 'slot'), 'error'); } finally { setBusy(false); }
}
function resetFilters() {
  state.map = 'all'; state.category = 'all'; state.query = ''; state.pendingOnly = false; state.sort = 'status'; state.pageSize = PAGE_SIZE;
  $('map-select').value = 'all'; $('category-select').value = 'all'; $('search-input').value = ''; $('pending-only').checked = false; $('sort-select').value = 'status';
  render();
}
function clearSession() {
  state.loadToken += 1;
  state.decoded = null; state.slot = null; state.analysis = null; state.file = null; state.selected = null; state.warnings = [];
  state.questQuery = ''; state.questStatus = 'all'; state.questExpanded.clear();
  $('quest-search').value = ''; $('quest-status-filter').value = 'all';
  if ($('quests-dialog').open) $('quests-dialog').close();
  state.records = state.baseRecords.map((record) => ({ ...record, status: 'browse' }));
  $('slot-select').replaceChildren(new Option(L('导入后选择', 'Load a save to choose'), ''));
  $('slot-select').disabled = true;
  $('file-input').value = '';
  $('file-name').textContent = ''; $('file-meta').textContent = '';
  $('file-bar').classList.add('hidden');
  document.querySelector('.intro').classList.remove('loaded');
  resetView(); resetFilters(); setNotice(); setBusy(false);
  $('dropzone').focus();
}
function csvCell(value) {
  let text = human(value).replace(/\r?\n/g, ' ');
  // Prevent spreadsheet formula injection, including formulas preceded by whitespace.
  if (typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function exportCSV() {
  const records = filteredRecords();
  const rows = [LANGUAGE === 'en' ? ['ID', 'Name', 'Map', 'Category', 'Status', 'X', 'Y', 'Z', 'Completion', 'Location hint'] : ['编号', '名称', '地图', '类别', '状态', 'X', 'Y', 'Z', '收集状态', '位置线索']];
  for (const record of records) {
    const p = position(record);
    rows.push([record.id, record.name, mapName(record.mapId), categoryName(record.category), STATUS[statusOf(record)], p?.X ?? '', p?.Y ?? '', p?.Z ?? '', completionText(record), playerText(record.locationHint ?? record.description)]);
  }
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = element('a'); anchor.href = url; anchor.download = `PBZ-${LANGUAGE}-${state.slot ? String(state.slot.name ?? state.slot.slot).replace(/[^a-zA-Z0-9_-]/g, '_') : 'collectibles'}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateFilters() {
  state.map = $('map-select').value; state.category = $('category-select').value; state.query = $('search-input').value.trim(); state.pendingOnly = $('pending-only').checked; state.sort = $('sort-select').value; state.pageSize = PAGE_SIZE;
  if (state.selected && !filteredRecords().some((record) => record._key === state.selected)) state.selected = null;
  render();
}
function openPicker() { if (!state.busy) $('file-input').click(); }
function closeHelp() { $('help-dialog').close(); }
function setupEvents() {
  $('dropzone').addEventListener('click', openPicker);
  $('dropzone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); } });
  $('file-input').addEventListener('change', (event) => importFile(event.target.files?.[0]));
  $('replace-button').addEventListener('click', openPicker);
  let dragCounter = 0;
  document.addEventListener('dragenter', (event) => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragCounter += 1; $('dropzone').classList.add('drag-active'); });
  document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('dragleave', () => { dragCounter = Math.max(0, dragCounter - 1); if (!dragCounter) $('dropzone').classList.remove('drag-active'); });
  document.addEventListener('drop', (event) => { event.preventDefault(); dragCounter = 0; $('dropzone').classList.remove('drag-active'); const files = event.dataTransfer?.files; if (files?.length) importFile(files[0]); });
  $('slot-select').addEventListener('change', (event) => switchSlot(event.target.value));
  for (const id of ['map-select', 'category-select', 'pending-only', 'sort-select']) $(id).addEventListener('change', updateFilters);
  let searchTimer;
  $('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(updateFilters, 130); });
  $('reset-filters').addEventListener('click', resetFilters);
  $('empty-reset-button').addEventListener('click', resetFilters);
  $('clear-button').addEventListener('click', clearSession);
  $('export-button').addEventListener('click', exportCSV);
  $('browse-button').addEventListener('click', () => { $('workspace').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('workspace').focus({ preventScroll: true }); });
  $('load-more').addEventListener('click', () => { state.pageSize += PAGE_SIZE; renderList(filteredRecords()); });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', closeHelp);
  $('help-done').addEventListener('click', closeHelp);
  $('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) { const r = $('help-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeHelp(); } });
  $('quests-button').addEventListener('click', () => { if (!state.slot || state.busy) return; renderQuests(); $('quests-dialog').showModal(); });
  $('close-quests').addEventListener('click', () => $('quests-dialog').close());
  $('quest-search').addEventListener('input', (event) => { state.questQuery = event.target.value.trim(); renderQuests(); });
  $('quest-status-filter').addEventListener('change', (event) => { state.questStatus = event.target.value; renderQuests(); });
  $('quests-dialog').addEventListener('click', (event) => { if (event.target === $('quests-dialog')) { const rect = $('quests-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('quests-dialog').close(); } });
  $('zoom-in').addEventListener('click', () => { state.zoom = Math.min(6, state.zoom * 1.25); applyMapView(); });
  $('zoom-out').addEventListener('click', () => { state.zoom = Math.max(.7, state.zoom / 1.25); applyMapView(); });
  $('zoom-reset').addEventListener('click', () => { if (state.mapMode === '3d') state.terrain3d?.reset(); else resetView(); });
  $('map-view-select').addEventListener('change', (event) => {
    state.mapMode = event.target.value;
    if (state.terrainStatus === 'error') { state.terrainMapId = null; state.terrainStatus = ''; }
    resetView(); hideTooltip(); renderMap(filteredRecords());
  });
  $('map-height-band').addEventListener('change', event => {
    state.terrainBandId = event.target.value; state.terrainHeightFocus = false;
    state.terrain3dSignature = ''; resetView(); renderMap(filteredRecords());
  });
  $('map-height-focus').addEventListener('change', event => {
    state.terrainHeightFocus = event.target.checked; state.terrain3dSignature = ''; renderMap(filteredRecords());
  });
  const map = $('coordinate-map');
  map.addEventListener('pointerdown', (event) => { if (event.target.closest('.map-marker')) return; state.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY }; map.setPointerCapture(event.pointerId); });
  map.addEventListener('pointermove', (event) => { if (!state.drag || state.drag.pointer !== event.pointerId) return; const rect = map.getBoundingClientRect(); const factor = 760 / rect.width; state.panX = state.drag.panX + (event.clientX - state.drag.x) * factor; state.panY = state.drag.panY + (event.clientY - state.drag.y) * factor; applyMapView(); hideTooltip(); });
  const endDrag = () => { state.drag = null; };
  map.addEventListener('pointerup', endDrag); map.addEventListener('pointercancel', endDrag);
  map.addEventListener('keydown', (event) => {
    if (event.target !== map) return;
    const delta = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] }[event.key];
    if (delta) { event.preventDefault(); state.panX += delta[0]; state.panY += delta[1]; applyMapView(); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); $('zoom-in').click(); }
    if (event.key === '-') { event.preventDefault(); $('zoom-out').click(); }
    if (event.key === 'Home' || event.key === '0') { event.preventDefault(); resetView(); }
  });
}

setupEvents();
loadCatalog().catch((error) => { setNotice(errorMessage(error, 'catalog'), 'error'); $('results-summary').textContent = L('物品清单暂不可用', 'Item checklist unavailable'); $('record-list').replaceChildren(element('p', 'loading-placeholder', L('请刷新页面重试。', 'Refresh the page and try again.'))); });
