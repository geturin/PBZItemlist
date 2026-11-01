// SPDX-License-Identifier: GPL-3.0-or-later
// Canvas backdrop from real navigation triangles, using the existing world-XY view.
import { triangulatePolygons, clipSurfaceHeight } from './geometry-utils.js';

const cache = new WeakMap();
const invalid = reason => ({ available: false, reason, drawnTriangles: 0, cacheHit: false });
const record = vertex => ({ location: { X: vertex[0], Y: vertex[1], Z: vertex[2] } });

/**
 * project accepts the same {location:{X,Y,Z}} points as createMapView().project.
 * canvas coordinates are the SVG's logical 760x590 units. Apply pan/zoom to its
 * enclosing SVG group, rather than rebuilding the world-space path on each drag.
 * heightRange is [minZ,maxZ] in UE centimeters; focusBounds only rejects distant
 * triangles and does not pretend to be a physical map boundary.
 */
export function drawTerrain2D(canvas, geometry, project, options = {}) {
  let context;
  try { context = canvas?.getContext('2d'); } catch { return invalid('canvas-unavailable'); }
  if (!context || typeof project !== 'function') return invalid('canvas-unavailable');
  if (geometry?.format !== 1 || geometry.unit !== 'cm' || geometry.coordinateSystem !== 'Unreal Z-up' || !Array.isArray(geometry.vertices)) return invalid('invalid-navigation-data');
  const vertices = geometry.vertices;
  let indices;
  try { indices = geometry.indices ?? triangulatePolygons(geometry.polygons, vertices.length); } catch { return invalid('invalid-navigation-data'); }
  if (!(Array.isArray(indices) || ArrayBuffer.isView(indices)) || indices.length % 3) return invalid('invalid-navigation-data');
  const range = options.heightRange ?? [-Infinity, Infinity];
  const minZ = range[0] ?? -Infinity, maxZ = range[1] ?? Infinity;
  if (Number.isNaN(minZ) || Number.isNaN(maxZ) || minZ > maxZ) return invalid('invalid-height-range');
  const bounds = options.focusBounds;
  const minX = bounds?.min?.[0] ?? bounds?.minX ?? -Infinity, maxX = bounds?.max?.[0] ?? bounds?.maxX ?? Infinity;
  const minY = bounds?.min?.[1] ?? bounds?.minY ?? -Infinity, maxY = bounds?.max?.[1] ?? bounds?.maxY ?? Infinity;
  const probe = vertices[0];
  if (!probe || !probe.every(Number.isFinite)) return invalid('invalid-navigation-data');
  let signature;
  try {
    const projected = [probe, [probe[0] + 100, probe[1], probe[2]], [probe[0], probe[1] + 100, probe[2]]].map(vertex => project(record(vertex)));
    if (projected.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return invalid('world-projection-required');
    signature = JSON.stringify([canvas.width, canvas.height, minZ, maxZ, minX, maxX, minY, maxY, ...projected.flatMap(point => [point.x, point.y])].map(value => Number.isFinite(value) ? value : String(value)));
  } catch { return invalid('world-projection-required'); }
  let entries = cache.get(geometry);
  if (!entries) { entries = new Map(); cache.set(geometry, entries); }
  let prepared = entries.get(signature), cacheHit = Boolean(prepared);
  if (!prepared) {
    const Path = canvas.ownerDocument?.defaultView?.Path2D ?? globalThis.Path2D;
    if (!Path) return invalid('canvas-path-unavailable');
    const path = new Path(); let drawnTriangles = 0;
    try {
      for (let index = 0; index < indices.length; index += 3) {
        const triangle = [vertices[indices[index]], vertices[indices[index + 1]], vertices[indices[index + 2]]];
        if (triangle.some(vertex => !vertex || vertex.length !== 3 || !vertex.every(Number.isFinite))) return invalid('invalid-navigation-data');
        if (Math.max(...triangle.map(vertex => vertex[0])) < minX || Math.min(...triangle.map(vertex => vertex[0])) > maxX || Math.max(...triangle.map(vertex => vertex[1])) < minY || Math.min(...triangle.map(vertex => vertex[1])) > maxY || Math.max(...triangle.map(vertex => vertex[2])) < minZ || Math.min(...triangle.map(vertex => vertex[2])) > maxZ) continue;
        const polygon = clipSurfaceHeight(triangle, minZ, maxZ);
        if (polygon.length < 3) continue;
        const points = polygon.map(vertex => project(record(vertex)));
        if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
        path.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) path.lineTo(point.x, point.y);
        path.closePath(); drawnTriangles++;
      }
    } catch { return invalid('invalid-navigation-data'); }
    prepared = { path, drawnTriangles }; entries.set(signature, prepared);
    if (entries.size > 4) entries.delete(entries.keys().next().value);
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (options.clear !== false) context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.fill ?? 'rgba(43,130,204,0.35)'; context.fill(prepared.path);
  context.strokeStyle = options.stroke ?? 'rgba(154,209,255,0.14)'; context.lineWidth = options.lineWidth ?? 0.55; context.stroke(prepared.path);
  context.restore();
  return { available: true, sourceTriangles: indices.length / 3, drawnTriangles: prepared.drawnTriangles, cacheHit };
}

export function clearTerrain2DCache(geometry) { cache.delete(geometry); }
