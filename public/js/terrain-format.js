// SPDX-License-Identifier: GPL-3.0-or-later
// Pure checks shared by the main thread and the 3D decoding worker.
export function validateTerrain2D(map) {
  if (map?.format !== 2 || map.unit !== 'cm' || map.coordinateSystem !== 'Unreal Z-up'
      || !Array.isArray(map.layers) || map.layers.length > 2048 || 'vertices' in map || 'indices' in map) throw Error('Invalid floor outline data');
  let count = 0;
  for (const layer of map.layers) {
    if (!Number.isFinite(layer.minZ) || !Number.isFinite(layer.maxZ) || layer.minZ > layer.maxZ || !Array.isArray(layer.polygons)) throw Error('Invalid floor layer');
    for (const polygon of layer.polygons) {
      if (!Array.isArray(polygon)) throw Error('Invalid floor polygon');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 3) throw Error('Invalid floor ring');
        count += ring.length;
        for (const point of ring) if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw Error('Invalid floor coordinate');
      }
    }
  }
  if (count > 500_000) throw Error('Floor outline exceeds display budget');
  return map;
}

export async function decodeTerrainAsset(buffer, asset, view) {
  if (buffer.byteLength > 16 * 1024 * 1024) throw Error('Terrain exceeds display budget');
  const prefix = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
    buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  if (buffer.byteLength > 16 * 1024 * 1024 || (asset.jsonBytes && buffer.byteLength !== asset.jsonBytes)) throw Error('Terrain size mismatch');
  if (asset.sha256 && globalThis.crypto?.subtle) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw Error('Terrain integrity mismatch');
  }
  const data = JSON.parse(new TextDecoder().decode(buffer));
  return validateTerrain2D(data);
}
