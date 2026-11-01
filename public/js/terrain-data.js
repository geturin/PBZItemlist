// SPDX-License-Identifier: GPL-3.0-or-later
// 2D outlines and 3D floors are separate, bounded, on-demand assets.
import { decodeTerrainAsset } from './terrain-format.js';
export { validateTerrainGeometry, validateTerrain2D } from './terrain-format.js';
const manifestURL = new URL('../data/terrain-low/manifest.json', import.meta.url);
let manifestPromise;
const cache = { '2d': null, '3d': null };
const generation = { '2d': 0, '3d': 0 };
const aborted = () => Object.assign(new Error('Terrain request cancelled'), { name: 'AbortError' });

export async function getTerrainManifest() {
  if (!manifestPromise) manifestPromise = fetch(manifestURL, { cache: 'no-cache' }).then(async response => {
    if (!response.ok) throw Error('Terrain manifest unavailable');
    const manifest = await response.json();
    if (manifest.format !== 2 || !manifest.maps || !manifest.worlds) throw Error('Invalid terrain manifest');
    return manifest;
  }).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

export function releaseTerrain(view) {
  for (const mode of view ? [view] : ['2d', '3d']) {
    if (!(mode in cache)) continue;
    generation[mode]++;
    cache[mode]?.controller.abort();
    cache[mode] = null;
  }
}

function workerGeometry(url, asset, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./terrain-worker.js?v=2.1.0', import.meta.url), { type: 'module' });
    const stop = () => { worker.terminate(); signal.removeEventListener('abort', cancel); };
    const cancel = () => { stop(); reject(aborted()); };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => {
      stop();
      if (!event.data?.ok) reject(Error('Terrain decoding failed'));
      else resolve(event.data.geometry);
    };
    worker.onerror = () => { stop(); reject(Error('Terrain worker unavailable')); };
    if (signal.aborted) cancel();
    else worker.postMessage({ url: url.href, asset });
  });
}

async function loadAsset(url, asset, view, signal) {
  if (view === '3d' && typeof Worker !== 'undefined') return workerGeometry(url, asset, signal);
  const response = await fetch(url, { cache: 'force-cache', signal });
  if (!response.ok) throw Error('Terrain unavailable');
  const geometry = await decodeTerrainAsset(await response.arrayBuffer(), asset, view);
  if (signal.aborted) throw aborted();
  return geometry;
}

export async function loadTerrainForMap(mapId, { view = '2d' } = {}) {
  if (!['2d', '3d'].includes(view)) throw Error('Invalid terrain view');
  const requestGeneration = generation[view];
  const manifest = await getTerrainManifest();
  if (requestGeneration !== generation[view]) throw aborted();
  const map = manifest.maps[mapId], world = map && manifest.worlds[map.world];
  const asset = world?.[view === '2d' ? 'twoD' : 'threeD'];
  if (!asset) return null;
  const key = `${map.world}:${asset.file}`;
  if (cache[view]?.key !== key) {
    cache[view]?.controller.abort();
    const controller = new AbortController();
    const url = new URL(asset.file, manifestURL);
    if (url.origin !== manifestURL.origin || !url.pathname.startsWith(new URL('.', manifestURL).pathname)) throw Error('Invalid terrain URL');
    const entry = { key, controller, promise: null };
    entry.promise = loadAsset(url, asset, view, controller.signal).catch(error => {
      if (cache[view] === entry) cache[view] = null;
      throw error;
    });
    cache[view] = entry;
  }
  return { geometry: await cache[view].promise, metadata: map, view };
}

export function terrainBand(mesh, mapId, z, preferredId) {
  const bands = mesh?.zBands || [];
  if (Number.isFinite(z)) {
    const containing = bands.find(band => z >= band.bounds.min[2] - 1000 && z <= band.bounds.max[2] + 1000);
    if (containing) return containing;
  }
  if (preferredId) {
    const preferred = bands.find(band => band.id === preferredId);
    if (preferred) return preferred;
  }
  const focus = mesh?.mapFocus?.find(entry => entry.mapId === mapId);
  const biggest = [...(focus?.focusByBand || [])].sort((a, b) => b.anchorCount - a.anchorCount)[0];
  return bands.find(band => band.id === biggest?.bandId)
    || bands.find(band => band.id === mesh.defaultBandId) || bands[0] || null;
}

export function terrainFocusBounds(mesh, mapId, band) {
  return mesh?.mapFocus?.find(entry => entry.mapId === mapId)?.focusByBand?.find(entry => entry.bandId === band?.id)?.bounds
    || band?.bounds || mesh?.bounds || null;
}
