// SPDX-License-Identifier: GPL-3.0-or-later
// Save data lives in this page's memory only. No upload, storage, or telemetry.
import { decodeSave } from './save-codec.js';
import { analyzeSlot } from './completion.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const PAGE_SIZE = 100;
const STATUS = { done: '已完成', missing: '未完成', unknown: '待确认', browse: '待载入' };
const COLORS = { done: '#99b88b', missing: '#d99d7f', unknown: '#d5bf80', browse: '#c9af79' };
const CATEGORY_SYMBOLS = { bell: '铃', amber: '琥', hupo: '琥', blackStone: '石', blackstone: '石', heishi: '石', memoryFlower: '花', flower: '花', weapon: '刃', mainWeapon: '刃', shaqiWeapon: '武', shaqi: '武', phantomEdge: '武', accessory: '饰', medicine: '药', rongShu: '榕', longZhu: '柱', scarecrow: '试', challenge: '试', key: '钥', book: '书', quest: '闻', treasure: '藏', material: '材', primary: '物' };
const CATEGORY_NAMES = { bell: '铃铛', amber: '杀气琥珀', hupo: '杀气琥珀', blackStone: '黑石', blackstone: '黑石', heishi: '黑石', memoryFlower: '记忆之花', flower: '记忆之花', weapon: '主武器', mainWeapon: '主武器', shaqiWeapon: '影之武装', shaqi: '影之武装', phantomEdge: '影之武装', accessory: '饰品', medicine: '药瓶', rongShu: '榕树挑战', longZhu: '龙柱挑战', scarecrow: '稻草人挑战', challenge: '挑战', key: '钥匙与机关', book: '书籍', quest: '异闻与任务', treasure: '宝藏', material: '材料', primary: '剧情物品' };
const state = { catalog: null, catalogPromise: null, baseRecords: [], records: [], maps: [], categories: [], decoded: null, slot: null, analysis: null, file: null, map: 'all', category: 'all', query: '', pendingOnly: false, sort: 'status', selected: null, pageSize: PAGE_SIZE, busy: false, loadToken: 0, zoom: 1, panX: 0, panY: 0, mapItems: [], warnings: [], drag: null, lastMapScope: null, questQuery: '', questStatus: 'all', questExpanded: new Set() };

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
  if (Array.isArray(value)) return value.map((entry) => human(entry)).filter(Boolean).join('；');
  return human(value.label ?? value.name_zh ?? value.name ?? value.description ?? value.detail ?? value.text ?? value.reason ?? value.id, fallback);
}
function objectList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) => typeof item === 'object' && item !== null ? { id, ...item } : { id, name: item });
  return [];
}
function itemId(item) { return String(item.id ?? item.ID ?? item.row ?? item.key ?? ''); }
function itemMap(item) { return String(item.mapId ?? item.mapID ?? item.map_id ?? item.map ?? item.mapName ?? 'unmapped'); }
function itemCategory(item) { return String(item.category ?? item.categoryId ?? item.type ?? 'other'); }
function named(item, fallback = '') { return human(item.name_zh ?? item.nameZh ?? item.title_zh ?? item.name ?? item.title, fallback); }
function position(item) {
  const p = item.location ?? item.position ?? item.coordinates ?? item.worldPosition ?? item.mapPosition;
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.X ?? p.x ?? (Array.isArray(p) ? p[0] : NaN));
  const y = Number(p.Y ?? p.y ?? (Array.isArray(p) ? p[1] : NaN));
  const z = Number(p.Z ?? p.z ?? (Array.isArray(p) ? p[2] : NaN));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { X: x, Y: y, Z: Number.isFinite(z) ? z : null };
}
function mapName(id) { return state.maps.find((item) => item.id === id)?.name ?? (id === 'unmapped' ? '地图待确认' : id); }
function categoryName(id) { return state.categories.find((item) => item.id === id)?.name ?? CATEGORY_NAMES[id] ?? id; }
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
    const response = await fetch(new URL('../data/catalog.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('图鉴数据暂时无法读取，请刷新页面重试。');
    const catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.records)) throw new Error('图鉴数据格式不完整，请稍后重试。');
    normalizeCatalog(catalog);
    render();
    return catalog;
  })();
  try { return await state.catalogPromise; } catch (error) { state.catalogPromise = null; throw error; }
}
function fillFilters() {
  const mapSelect = $('map-select');
  const categorySelect = $('category-select');
  mapSelect.replaceChildren(new Option('全部地图', 'all'));
  categorySelect.replaceChildren(new Option('全部类别', 'all'));
  for (const map of state.maps) mapSelect.add(new Option(map.name, map.id));
  for (const category of state.categories) categorySelect.add(new Option(category.name, category.id));
  mapSelect.value = state.map;
  categorySelect.value = state.category;
}
function filteredRecords(ignoreMap = false) {
  let records = state.records.filter((record) => (ignoreMap || state.map === 'all' || record.mapId === state.map) && (state.category === 'all' || record.category === state.category) && (!state.pendingOnly || statusOf(record) !== 'done'));
  if (state.query) {
    const query = state.query.toLocaleLowerCase();
    records = records.filter((record) => [record.name, record.id, mapName(record.mapId), categoryName(record.category), human(record.description), human(record.reason), human(record.requirements), human(record.locationHint)].join(' ').toLocaleLowerCase().includes(query));
  }
  const priority = { missing: 0, unknown: 1, browse: 2, done: 3 };
  return records.sort((a, b) => {
    if (state.sort === 'status') { const delta = priority[statusOf(a)] - priority[statusOf(b)]; if (delta) return delta; }
    if (state.sort === 'category') { const delta = categoryName(a.category).localeCompare(categoryName(b.category), 'zh-CN'); if (delta) return delta; }
    return mapName(a.mapId).localeCompare(mapName(b.mapId), 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id);
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
  $('stat-fraction').textContent = loaded ? `${summary.done.toLocaleString()} / ${summary.total.toLocaleString()} 个点位` : `${summary.total.toLocaleString()} 个可浏览点位`;
  for (const key of ['done', 'missing', 'unknown']) $(`stat-${key}`).textContent = loaded ? summary[key].toLocaleString() : '—';
  $('progress-fill').style.width = loaded ? `${percent}%` : '0%';
  $('pending-only').disabled = !loaded;
  $('session-label').textContent = loaded ? slotLabel(state.slot) : '图鉴浏览 · 载入后核对';
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
    button.setAttribute('aria-label', `${record.name}，${categoryName(record.category)}，${mapName(record.mapId)}，${STATUS[status]}`);
    button.append(element('span', 'record-symbol', CATEGORY_SYMBOLS[record.category] ?? '物'));
    const main = element('span', 'record-main');
    main.append(element('strong', '', record.name));
    const meta = element('span', 'record-meta');
    meta.append(element('span', 'category-label', categoryName(record.category)), element('span', 'divider', '·'), element('span', '', mapName(record.mapId)));
    main.append(meta);
    const statusNode = element('span', `record-status ${status}`);
    if (status !== 'browse') statusNode.append(element('i', `status-dot ${status}`));
    statusNode.append(document.createTextNode(state.slot ? record.statusLabel ?? STATUS[status] : '位置图鉴'));
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
  $('pagination-summary').textContent = `已显示 ${Math.min(state.pageSize, records.length)} / ${records.length}`;
  $('results-summary').textContent = state.catalog ? `${records.length.toLocaleString()} 个点位${state.slot ? ' · 统计按当前地图与类别，非游戏内总完成度' : ' · 当前仅浏览位置，载入存档后显示完成状态'}` : '正在读取收集图鉴…';
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
function renderMap(records) {
  const world = $('map-world');
  world.replaceChildren();
  const mapId = mapScopeId();
  const empty = $('map-empty');
  const legend = $('map-status-legend');
  legend.classList.toggle('hidden', !state.slot);
  if (!mapId) {
    empty.classList.remove('hidden');
    empty.querySelector('strong').textContent = '江湖自此展开';
    empty.querySelector('p').textContent = '选择一个地图分区，或点选一条记录查看位置。';
    $('map-scope').textContent = '选择地图以定位';
    state.mapItems = [];
    return;
  }
  if (state.lastMapScope !== mapId) { state.lastMapScope = mapId; resetView(); }
  const scopeRecords = records.filter((record) => record.mapId === mapId);
  const located = scopeRecords.filter((record) => position(record));
  const boundsRecords = state.records.filter((record) => record.mapId === mapId && position(record));
  const bells = publicBellRows(mapId);
  const allPositions = [...boundsRecords, ...bells].map(position);
  $('map-scope').textContent = `${mapName(mapId)} · ${located.length} 个坐标`;
  if (!allPositions.length || !located.length && !bells.length) {
    empty.classList.remove('hidden');
    empty.querySelector('strong').textContent = '此分区暂无可用坐标';
    empty.querySelector('p').textContent = '仍可在右侧清单中查看完成依据与相关条件。';
    state.mapItems = [];
    return;
  }
  empty.classList.add('hidden');
  const xs = allPositions.map((p) => p.X), ys = allPositions.map((p) => p.Y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 1000), rangeY = Math.max(maxY - minY, 1000);
  const scale = Math.min(640 / rangeX, 475 / rangeY);
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const project = (p) => ({ x: 380 + (p.X - centerX) * scale, y: 295 - (p.Y - centerY) * scale });
  const axis = svgElement('g', { 'aria-hidden': 'true' });
  for (let i = 0; i <= 4; i += 1) {
    const x = minX + (maxX - minX) * i / 4, y = minY + (maxY - minY) * i / 4;
    const xp = project({ X: x, Y: centerY }), yp = project({ X: centerX, Y: y });
    axis.append(svgElement('text', { x: xp.x, y: 571, 'text-anchor': 'middle', class: 'map-axis-label' }, formatCoordinate(x)), svgElement('text', { x: 11, y: yp.y + 3, class: 'map-axis-label' }, formatCoordinate(y)));
  }
  world.append(axis);
  const bellGroup = svgElement('g', { class: 'map-bells' });
  const representedBells = new Set(located.filter((record) => record.category === 'bell').map((record) => record.id.toLowerCase()));
  for (const bell of bells) {
    if (representedBells.has(bell.id.toLowerCase())) continue;
    const p = project(position(bell));
    const marker = svgElement('g', { class: 'bell-map-marker', transform: `translate(${p.x} ${p.y})` });
    marker.append(svgElement('circle', { class: 'point-shape', r: 4, fill: '#17211b', stroke: '#99b88b', 'stroke-width': 1.2 }), svgElement('title', {}, `铃铛：${bell.name}`));
    marker.addEventListener('pointerenter', (event) => showTooltip(event, `铃铛 · ${bell.name}`));
    marker.addEventListener('pointerleave', hideTooltip);
    bellGroup.append(marker);
  }
  world.append(bellGroup);
  const markerGroup = svgElement('g');
  const sorted = located.slice().sort((a, b) => Number(a._key === state.selected) - Number(b._key === state.selected));
  state.mapItems = sorted;
  for (const record of sorted) {
    const p = project(position(record));
    const status = statusOf(record), color = COLORS[status];
    const selected = state.selected === record._key;
    const marker = svgElement('g', { class: `map-marker${selected ? ' is-selected' : ''}`, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${record.name}，${state.slot ? STATUS[status] : '位置图鉴'}`, 'aria-pressed': selected });
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
  const sourceItems = Array.isArray(record.source) ? record.source : record.source ? [record.source] : [];
  for (const source of sourceItems) {
    const url = safeExternalURL(typeof source === 'string' ? source : source.url ?? source.href);
    if (url) {
      const p = element('p'), anchor = element('a', '', typeof source === 'object' ? named(source, '查看来源') : '查看来源');
      anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; p.append(anchor); container.append(p);
    } else if (source && typeof source === 'object' && !Array.isArray(source)) {
      const labels = { bellId: '铃铛编号', itemId: '物品编号', weaponId: '武器编号', accessoryId: '饰品编号', medicineId: '药瓶编号', saveGuid: '场景对象', mobDomain: '奖励敌群', nodeGuids: '奖励事件', path: '资源条目', type: '来源类型' };
      for (const [key, value] of Object.entries(source)) {
        if (!labels[key]) continue;
        const text = human(value);
        if (text) addParagraphs(container, `${labels[key]}：${text}`);
      }
    } else addParagraphs(container, source);
  }
  for (const item of Array.isArray(record.evidence) ? record.evidence : [record.evidence]) addParagraphs(container, item);
  if (record.limitations) addParagraphs(container, record.limitations);
  if (!container.childNodes.length) addParagraphs(container, '此记录来自当前版本图鉴。未提供额外来源说明。');
}
function renderDetail() {
  const record = state.records.find((item) => item._key === state.selected);
  $('detail-placeholder').classList.toggle('hidden', Boolean(record));
  $('detail-content').classList.toggle('hidden', !record);
  if (!record) return;
  const status = statusOf(record);
  $('detail-category').textContent = `${mapName(record.mapId)} / ${categoryName(record.category)}`;
  $('detail-title').textContent = record.name;
  $('detail-id').textContent = record.id;
  $('detail-status').textContent = state.slot ? record.statusLabel ?? STATUS[status] : '图鉴浏览';
  $('detail-status').className = `status-pill ${status}`;
  const locationContainer = $('detail-location');
  locationContainer.replaceChildren();
  const p = position(record);
  const locationHint = record.locationHint ?? record.hint ?? record.description ?? (typeof record.location === 'string' ? record.location : record.location?.description);
  if (!addParagraphs(locationContainer, locationHint)) addParagraphs(locationContainer, p ? '此点位保留了游戏原生世界坐标。可结合相邻铃铛与地图位置，在游戏内继续核对。' : '当前图鉴未提供可用位置坐标，请结合物品编号及相关任务在游戏内核对。', p ? '' : 'detail-muted');
  $('detail-coordinates').replaceChildren();
  if (p) for (const [key, value] of Object.entries(p)) if (value !== null) $('detail-coordinates').append(element('span', '', `${key}  ${Math.round(value).toLocaleString()}`));
  const reason = $('detail-reason');
  reason.replaceChildren();
  if (!state.slot) addParagraphs(reason, '载入存档并选择槽位后，可在这里查看完成依据。', 'detail-muted');
  else if (!addParagraphs(reason, record.reason ?? record.completionReason)) addParagraphs(reason, status === 'done' ? '存档中存在匹配的完成记录。' : status === 'missing' ? '当前槽位尚未记录此点位为完成。' : '当前槽位未提供足以确定此点位状态的证据。');
  const conditions = $('detail-conditions');
  conditions.replaceChildren();
  const conditionItems = objectList(record.conditions?.length ? record.conditions : record.requirements);
  for (const condition of conditionItems) {
    const isObject = condition && typeof condition === 'object';
    const raw = state.slot && isObject ? String(condition.status ?? '') : '';
    const conditionStatus = ['met', 'done', 'complete', 'completed'].includes(raw) ? 'met' : ['unmet', 'missing', 'incomplete'].includes(raw) ? 'unmet' : 'unknown';
    const row = element('div', `condition-row ${conditionStatus}`);
    row.append(element('span', 'condition-indicator', conditionStatus === 'met' ? '✓' : conditionStatus === 'unmet' ? '·' : '?'));
    const text = element('span', '', human(isObject ? condition.label ?? condition.name ?? condition.description ?? condition.id : condition, '相关条件'));
    const detail = isObject ? human(condition.detail ?? condition.reason) : '';
    if (detail) text.append(element('small', '', detail));
    row.append(text); conditions.append(row);
  }
  const bellContainer = $('detail-bells');
  bellContainer.replaceChildren();
  const bells = nearestBells(record).slice(0, 3);
  if (!bells.length) addParagraphs(bellContainer, '暂无同分区铃铛的距离参考。', 'detail-muted');
  for (const bell of bells) {
    const row = element('div', 'bell-reference');
    row.append(element('span', 'bell-symbol', '♧'));
    const text = element('div');
    text.append(element('strong', '', named(bell, itemId(bell))));
    const distance = Number(bell.distance);
    if (Number.isFinite(distance)) {
      const height = Number(bell.heightDelta);
      const detail = bell._nativeDistance ? `XY 直线距离 ${Math.round(distance).toLocaleString()} 世界单位` : bell.distanceLabel ?? `直线距离 ${distance.toFixed(1)} 米${Number.isFinite(height) ? ` · 高差 ${height >= 0 ? '+' : ''}${height.toFixed(1)} 米` : ''}`;
      text.append(element('small', '', detail));
    }
    row.append(text);
    if (state.slot && typeof bell.active === 'boolean') row.append(element('span', `bell-active${bell.active ? '' : ' inactive'}`, bell.active ? '已开启' : '未开启'));
    bellContainer.append(row);
  }
  if (bells.length) addParagraphs(bellContainer, '直线距离仅作参考，不代表最近可行走路线。', 'detail-muted');
  renderEvidence(record);
}
function renderWarnings() {
  const container = $('analysis-warnings');
  const entries = state.slot ? state.warnings : [];
  container.replaceChildren();
  if (state.slot) container.append(element('p', '', '统计按收集点位汇总，部分物品可能有多个位置。此比例不等同于游戏内地图总完成度；任务状态仅展示已记录证据。'));
  for (const entry of entries) addParagraphs(container, entry);
  container.classList.toggle('hidden', !state.slot);
}
function questStatus(quest) { return ['done', 'active', 'failed'].includes(quest.status) ? quest.status : 'unknown'; }
function renderQuests() {
  const all = state.slot && Array.isArray(state.analysis?.quests) ? state.analysis.quests : [];
  $('quests-count').textContent = all.length.toLocaleString();
  $('quests-button').disabled = state.busy || !state.slot;
  const statusNames = { active: '进行中', done: '已完成', failed: '失败记录', unknown: '待确认' };
  const priority = { active: 0, failed: 1, unknown: 2, done: 3 };
  const query = state.questQuery.toLocaleLowerCase();
  const filtered = all.filter((quest) => (state.questStatus === 'all' || questStatus(quest) === state.questStatus) && (!query || [named(quest), quest.id, ...objectList(quest.branches).map((branch) => [human(branch.label), branch.id, human(branch.objectives), human(branch.targets), human(branch.tasks)].join(' '))].join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => priority[questStatus(a)] - priority[questStatus(b)] || named(a, a.id).localeCompare(named(b, b.id), 'zh-CN'));
  const counts = { active: 0, done: 0, failed: 0, unknown: 0 };
  for (const quest of all) counts[questStatus(quest)] += 1;
  const countNode = $('quest-counts');
  countNode.replaceChildren(element('span', 'quest-result-count', `${filtered.length} / ${all.length} 项任务`));
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
    heading.append(element('strong', '', named(quest, id)), element('code', '', id));
    summary.append(heading, element('span', `quest-status ${status}`, quest.statusLabel ?? statusNames[status]));
    const content = element('div', 'quest-entry-content');
    const branches = objectList(quest.branches);
    if (branches.length) {
      const doneCount = branches.filter((branch) => branch.status === 'done').length;
      content.append(element('p', 'quest-branch-summary', `分支记录 · ${doneCount} / ${branches.length} 已完成`));
      for (const branch of branches) {
        const branchStatus = ['done', 'active'].includes(branch.status) ? branch.status : 'unknown';
        const row = element('div', `quest-branch ${branchStatus}`);
        row.append(element('span', 'condition-indicator', branchStatus === 'done' ? '✓' : branchStatus === 'active' ? '›' : '?'));
        const description = element('div', 'quest-branch-description');
        const branchHeading = element('div', 'quest-branch-heading');
        branchHeading.append(element('strong', '', human(branch.label, String(branch.id ?? '任务分支'))), element('span', '', branchStatus === 'done' ? '已完成分支' : branchStatus === 'active' ? '当前分支' : '状态待确认'));
        description.append(branchHeading);
        const objectives = branch.objectives ?? branch.targets ?? branch.tasks;
        if (Array.isArray(objectives) && objectives.length) {
          const goals = element('ul', 'quest-objectives');
          for (const objective of objectives) { const text = human(objective); if (text) goals.append(element('li', '', text)); }
          if (goals.childNodes.length) description.append(goals);
        } else if (typeof objectives === 'string') description.append(element('p', '', objectives));
        if (branch.detail) description.append(element('p', '', human(branch.detail)));
        row.append(description); content.append(row);
      }
    } else content.append(element('p', 'detail-muted', '此任务暂无可展示的分支或目标记录。'));
    details.append(summary, content);
    details.addEventListener('toggle', () => { if (details.open) state.questExpanded.add(id); else state.questExpanded.delete(id); });
    fragment.append(details);
  }
  if (!filtered.length) {
    const empty = element('div', 'quest-empty');
    empty.append(element('strong', '', all.length ? '没有匹配的任务记录' : state.slot ? '当前槽位没有可展示的任务记录' : '载入存档后查看任务记录'), element('p', '', all.length ? '试试更换搜索词或状态筛选。' : '任务数据缺失不会被当作已完成或永久错过。'));
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
  hideTooltip();
  render();
  if (focusOrigin) {
    const candidates = focusOrigin === 'list' ? $('record-list').children : $('map-world').querySelectorAll('.map-marker');
    Array.from(candidates).find((node) => node.dataset.key === key)?.focus({ preventScroll: true });
  }
}
function slotLabel(slot) {
  const name = String(slot?.name ?? slot?.slot ?? '存档');
  const display = name.replace(/^AutoSave/i, '自动存档 ').replace(/^ManualSave/i, '手动存档 ');
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
  state.analysis = result;
  state.records = state.baseRecords.map((record) => ({ ...record, ...(byCategoryId.get(`${record.category}|${record.id}`) ?? byId.get(record.id) ?? { status: 'unknown', reason: '此类别未返回明确分析结果。' }), _key: record._key, _index: record._index, id: record.id, category: record.category, mapId: record.mapId, name: record.name }));
  state.warnings = Array.isArray(result.warnings) ? result.warnings : result.warnings ? [result.warnings] : [];
  state.questExpanded.clear();
  fillSlots();
}
async function importFile(file) {
  if (!file || state.busy) return;
  if (!/\.sav$/i.test(file.name)) { setNotice('请选择游戏的 .sav 存档文件。', 'error'); return; }
  if (!file.size) { setNotice('这个文件是空的，请重新选择存档。', 'error'); return; }
  if (file.size > 40 * 1024 * 1024) { setNotice('文件超过 40 MiB，无法在此页面读取。请确认选择的是游戏存档。', 'error'); return; }
  const token = ++state.loadToken;
  setBusy(true);
  setNotice('正在本地解码存档并读取槽位，请稍候…', 'busy');
  try {
    await loadCatalog();
    const bytes = await file.arrayBuffer();
    const decoded = await decodeSave(bytes, { onProgress(progress) { if (token === state.loadToken && progress.total) setNotice(`正在本地解码存档（${Math.min(progress.current + 1, progress.total)} / ${progress.total}）…`, 'busy'); } });
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
    const info = [decoded.slots.length ? `${decoded.slots.length} 个槽位` : '', `${(file.size / 1024 / 1024).toFixed(2)} MB`, '读取完成 · 原存档未修改'].filter(Boolean);
    $('file-meta').textContent = info.join(' · ');
    document.querySelector('.intro').classList.add('loaded');
    $('file-bar').classList.remove('hidden');
    setNotice();
    render();
  } catch (error) {
    if (token !== state.loadToken) return;
    const message = error instanceof Error ? error.message : '无法解析此存档。';
    setNotice(`读取失败：${message.slice(0, 450)}\n请确认文件来自支持的游戏版本，或尝试其他存档。`, 'error');
  } finally { if (token === state.loadToken) { setBusy(false); $('file-input').value = ''; } }
}
async function switchSlot(name) {
  if (state.busy || !state.decoded) return;
  const slot = state.decoded.slots.find((item) => String(item.name ?? item.slot) === name);
  if (!slot) return;
  setBusy(true);
  setNotice('正在核对当前槽位的收集点位…', 'busy');
  try { await runAnalysis(slot); setNotice(); render(); } catch (error) { setNotice(error instanceof Error ? error.message : '切换槽位失败。', 'error'); } finally { setBusy(false); }
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
  $('slot-select').replaceChildren(new Option('载入存档后选择', ''));
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
  const rows = [['编号', '名称', '地图', '类别', '状态', 'X', 'Y', 'Z', '完成依据', '位置线索']];
  for (const record of records) {
    const p = position(record);
    rows.push([record.id, record.name, mapName(record.mapId), categoryName(record.category), state.slot ? STATUS[statusOf(record)] : '未载入存档', p?.X ?? '', p?.Y ?? '', p?.Z ?? '', state.slot ? record.reason ?? '' : '', human(record.locationHint ?? record.description)]);
  }
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = element('a'); anchor.href = url; anchor.download = `影境拾遗-${state.slot ? String(state.slot.name ?? state.slot.slot).replace(/[^a-zA-Z0-9_-]/g, '_') : '收集图鉴'}.csv`;
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
  $('zoom-reset').addEventListener('click', resetView);
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
loadCatalog().catch((error) => { setNotice(error instanceof Error ? error.message : '无法载入图鉴数据。', 'error'); $('results-summary').textContent = '图鉴数据暂不可用'; $('record-list').replaceChildren(element('p', 'loading-placeholder', '请刷新页面，重新读取收集图鉴。')); });
