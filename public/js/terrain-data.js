// SPDX-License-Identifier: GPL-3.0-or-later
// Lazy-load derived navigation surfaces. No game packages or player data are used here.
const manifestURL = new URL('../data/terrain/manifest.json', import.meta.url);
let manifestPromise;
const cache = new Map();

export function validateTerrainGeometry(mesh) {
  if (mesh?.format !== 1 || mesh.unit !== 'cm' || mesh.coordinateSystem !== 'Unreal Z-up' || !Array.isArray(mesh.vertices)
      || !Array.isArray(mesh.indices) || mesh.indices.length % 3 !== 0
      || mesh.vertices.length > 4_000_000 || mesh.indices.length > 24_000_000) throw Error('Invalid terrain data');
  if (!mesh.vertices.every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw Error('Invalid terrain vertex');
  if (!mesh.indices.every(i => Number.isSafeInteger(i) && i >= 0 && i < mesh.vertices.length)) throw Error('Invalid terrain face');
  return mesh;
}

export async function getTerrainManifest() {
  if (!manifestPromise) manifestPromise = fetch(manifestURL, { cache: 'no-cache' }).then(async response => {
    if (!response.ok) throw Error('Terrain manifest unavailable');
    const manifest = await response.json();
    if (manifest.format !== 1 || !manifest.maps || !manifest.worlds) throw Error('Invalid terrain manifest');
    return manifest;
  }).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

export async function loadTerrainForMap(mapId) {
  const manifest = await getTerrainManifest();
  const map = manifest.maps[mapId];
  const world = map && manifest.worlds[map.world];
  if (!world) return null;
  if (!cache.has(map.world)) {
    // Keep one world in memory. Subregions in the same world reuse that surface.
    cache.clear();
    const promise = (async () => {
      const url = new URL(world.file, manifestURL);
      if (url.origin !== manifestURL.origin || !url.pathname.startsWith(new URL('.', manifestURL).pathname)) throw Error('Invalid terrain URL');
      if (world.sha256) url.searchParams.set('v', world.sha256.slice(0, 16));
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw Error('Terrain unavailable');
      let buffer = await response.arrayBuffer();
      const prefix = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2));
      if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
        buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
      if (buffer.byteLength > 220 * 1024 * 1024 || (world.jsonBytes && buffer.byteLength !== world.jsonBytes)) throw Error('Terrain size mismatch');
      if (world.sha256 && globalThis.crypto?.subtle) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== world.sha256) throw Error('Terrain integrity mismatch');
      }
      return validateTerrainGeometry(JSON.parse(new TextDecoder().decode(buffer)));
    })();
    cache.set(map.world, promise);
    promise.catch(() => { if (cache.get(map.world) === promise) cache.delete(map.world); });
  }
  return { geometry: await cache.get(map.world), metadata: map };
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
