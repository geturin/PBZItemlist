// SPDX-License-Identifier: GPL-3.0-or-later
// Precomputed floor outlines: no triangles are read or looped over here.
const cache = new WeakMap();
const invalid = reason => ({ available: false, reason, drawnLayers: 0, cacheHit: false });
const record = (x, y) => ({ location: { X: x, Y: y, Z: 0 } });

export function drawTerrain2D(canvas, geometry, project, options = {}) {
  let context;
  try { context = canvas?.getContext('2d'); } catch { return invalid('canvas-unavailable'); }
  if (!context || typeof project !== 'function') return invalid('canvas-unavailable');
  if (geometry?.format !== 2 || !Array.isArray(geometry.layers)) return invalid('invalid-outline-data');
  const [minZ = -Infinity, maxZ = Infinity] = options.heightRange ?? [];
  if (minZ > maxZ || Number.isNaN(minZ) || Number.isNaN(maxZ)) return invalid('invalid-height-range');
  const probe = geometry.bounds?.min ?? [0, 0];
  const origin = project(record(probe[0], probe[1]));
  const east = project(record(probe[0] + 100, probe[1]));
  const north = project(record(probe[0], probe[1] + 100));
  if (![origin, east, north].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return invalid('world-projection-required');
  const selected = geometry.layers.filter(layer => layer.maxZ >= minZ && layer.minZ <= maxZ && (!options.bandId || layer.bandId === options.bandId));
  const signature = JSON.stringify([canvas.width, canvas.height, origin, east, north, selected.map(layer => layer.id ?? `${layer.bandId}:${layer.minZ}`)]);
  let entries = cache.get(geometry);
  if (!entries) { entries = new Map(); cache.set(geometry, entries); }
  let prepared = entries.get(signature), cacheHit = Boolean(prepared);
  if (!prepared) {
    const Path = canvas.ownerDocument?.defaultView?.Path2D ?? globalThis.Path2D;
    if (!Path) return invalid('canvas-path-unavailable');
    const xx = (east.x - origin.x) / 100, xy = (east.y - origin.y) / 100;
    const yx = (north.x - origin.x) / 100, yy = (north.y - origin.y) / 100;
    const paths = []; let coordinates = 0;
    for (const layer of selected) {
      const path = new Path();
      for (const polygon of layer.polygons) for (const ring of polygon) {
        for (let i = 0; i < ring.length; i++) {
          const x = ring[i][0] - probe[0], y = ring[i][1] - probe[1];
          const px = origin.x + x * xx + y * yx, py = origin.y + x * xy + y * yy;
          if (!i) path.moveTo(px, py); else path.lineTo(px, py);
          coordinates++;
        }
        path.closePath();
      }
      paths.push(path);
    }
    prepared = { paths, coordinates }; entries.set(signature, prepared);
    if (entries.size > 2) entries.delete(entries.keys().next().value);
  }
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
  if (options.clear !== false) context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.fill ?? 'rgba(78,151,200,0.45)';
  for (const path of prepared.paths) context.fill(path, 'evenodd');
  context.restore();
  return { available: true, drawnLayers: selected.length, coordinates: prepared.coordinates, cacheHit };
}

export function clearTerrain2DCache(geometry) { cache.delete(geometry); }
