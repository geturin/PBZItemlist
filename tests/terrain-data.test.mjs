// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validateTerrainGeometry, validateTerrain2D, terrainBand, terrainFocusBounds } from '../public/js/terrain-data.js';
import { decodeTerrainAsset } from '../public/js/terrain-format.js';
import { prepareTerrainGeometry } from '../public/js/geometry-utils.js';
import { drawTerrain2D, clearTerrain2DCache } from '../public/js/terrain-2d.js';
const bounds = (low, high) => ({ min: [0, 0, low], max: [100, 100, high] });
const mesh = { format: 1, unit: 'cm', coordinateSystem: 'Unreal Z-up', vertices: [[0, 0, 0], [100, 0, 30], [0, 100, 30]], indices: [0, 1, 2],
  zBands: [{ id: 'ground', bounds: bounds(-100, 100) }, { id: 'alternate', bounds: bounds(2_000_000, 2_010_000) }],
  defaultBandId: 'ground', mapFocus: [{ mapId: 'sample', focusByBand: [{ bandId: 'ground', anchorCount: 4, bounds: bounds(0, 30) }] }] };
assert.equal(validateTerrainGeometry(mesh), mesh);
for (const change of [{ unit: 'm' }, { vertices: [[0, NaN, 0]] }, { indices: [0, 1, 3] }, { indices: [0.5, 1, 2] }, { indices: [0, 1] }]) {
  assert.throws(() => validateTerrainGeometry({ ...mesh, ...change }));
}
assert.equal(terrainBand(mesh, 'sample').id, 'ground');
assert.equal(terrainBand(mesh, 'sample', 2_000_100).id, 'alternate', 'A high-scene item must keep its own vertical surface');
assert.equal(terrainBand(mesh, 'sample', undefined, 'alternate').id, 'alternate');
assert.deepEqual(terrainFocusBounds(mesh, 'sample', mesh.zBands[0]), bounds(0, 30));
assert.deepEqual(terrainFocusBounds(mesh, 'sample', mesh.zBands[1]), bounds(2_000_000, 2_010_000));

const flat = { ...mesh, positionsXYZ: new Float64Array(mesh.vertices.flat()), indices: new Uint32Array(mesh.indices) };
delete flat.vertices;
assert.equal(validateTerrainGeometry(flat), flat);
assert.equal(prepareTerrainGeometry(flat).indices, flat.indices, 'Transferred indices must keep their original buffer');
assert.deepEqual(prepareTerrainGeometry(flat).positions, prepareTerrainGeometry(mesh).positions);
assert.throws(() => validateTerrainGeometry({ ...flat, positionsXYZ: new Float64Array([0, 0, Infinity]) }));
assert.throws(() => validateTerrainGeometry({ ...flat, positionsXYZ: new Float64Array(600_003) }), 'Over-budget vertex counts are rejected');
assert.throws(() => validateTerrainGeometry({ ...flat, indices: new Uint32Array(1_200_003) }), 'Over-budget face counts are rejected');

const outlines = { format: 2, unit: 'cm', coordinateSystem: 'Unreal Z-up', layers: [
  { id: 'floor-0', bandId: 'ground', minZ: 0, maxZ: 500, polygons: [
    [[[0, 0], [100, 0], [100, 100], [0, 100]], [[25, 25], [25, 75], [75, 75], [75, 25]]]
  ] }
] };
assert.equal(validateTerrain2D(outlines), outlines, 'A polygon may contain a genuine hole');
for (const change of [
  { vertices: [] }, { indices: [] }, { unit: 'm' },
  { layers: [{ minZ: 500, maxZ: 0, polygons: [] }] },
  { layers: [{ minZ: 0, maxZ: 500, polygons: [[[[0, 0], [100, NaN], [100, 100]]]] }] },
  { layers: [{ minZ: 0, maxZ: 500, polygons: [[[[0, 0], [100, 0]]]] }] }
]) assert.throws(() => validateTerrain2D({ ...outlines, ...change }));

const bufferOf = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const raw = Buffer.from(JSON.stringify(mesh));
const asset = { jsonBytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
for (const bytes of [raw, gzipSync(raw)]) {
  const decoded = await decodeTerrainAsset(bufferOf(bytes), asset, '3d');
  assert(decoded.positionsXYZ instanceof Float64Array);
  assert(decoded.indices instanceof Uint32Array);
  assert(!('vertices' in decoded), 'Nested JSON vertices must not be retained alongside transferred coordinates');
  assert.deepEqual([...decoded.positionsXYZ], mesh.vertices.flat());
  assert.deepEqual([...decoded.indices], mesh.indices);
}
const raw2D = Buffer.from(JSON.stringify(outlines));
assert.deepEqual(await decodeTerrainAsset(bufferOf(gzipSync(raw2D)), { jsonBytes: raw2D.length }, '2d'), outlines);
await assert.rejects(() => decodeTerrainAsset(bufferOf(raw), { ...asset, jsonBytes: raw.length + 1 }, '3d'), /size mismatch/);
await assert.rejects(() => decodeTerrainAsset(bufferOf(raw), { ...asset, sha256: '0'.repeat(64) }, '3d'), /integrity mismatch/);
await assert.rejects(() => decodeTerrainAsset(new ArrayBuffer(16 * 1024 * 1024 + 1), {}, '3d'), /display budget/);
await assert.rejects(() => decodeTerrainAsset(bufferOf(raw), asset, '2d'), /outline data/);

let pathCommands = 0, projectionCalls = 0, fills = 0;
class PathCounter { moveTo() { pathCommands++; } lineTo() { pathCommands++; } closePath() { pathCommands++; } }
const context = { save() {}, restore() {}, setTransform() {}, clearRect() {}, fill(path, rule) { assert(path instanceof PathCounter); assert.equal(rule, 'evenodd'); fills++; } };
const canvas = { width: 950, height: 738, getContext: () => context, ownerDocument: { defaultView: { Path2D: PathCounter } } };
const project = point => { projectionCalls++; return { x: point.location.X / 2, y: -point.location.Y / 2 }; };
const cold = drawTerrain2D(canvas, outlines, project, { heightRange: [0, 500], bandId: 'ground' });
assert.equal(cold.coordinates, 8);
assert.equal(cold.cacheHit, false);
assert.equal(pathCommands, 10, 'Outer boundary and hole each close once');
assert.equal(projectionCalls, 3, 'Affine world display needs three probes, not one projection per contour point');
const warm = drawTerrain2D(canvas, outlines, project, { heightRange: [0, 500], bandId: 'ground' });
assert(warm.cacheHit); assert.equal(pathCommands, 10); assert.equal(fills, 2);
clearTerrain2DCache(outlines);
assert.equal(drawTerrain2D(canvas, outlines, project).cacheHit, false);
assert.equal(drawTerrain2D(canvas, outlines, project, { heightRange: [501, 999] }).drawnLayers, 0);
assert.equal(drawTerrain2D(canvas, mesh, project).available, false, 'The 2D outline renderer must not consume 3D triangle assets');
console.log('PASS terrain data: bounded outlines/typed geometry, gzip/hash, cached paths, height scenes and map focus');
