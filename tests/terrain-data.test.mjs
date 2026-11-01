// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validateTerrain2D, terrainBand, terrainFocusBounds } from '../public/js/terrain-data.js';
import { decodeTerrainAsset } from '../public/js/terrain-format.js';
const bounds = (low, high) => ({ min: [0, 0, low], max: [100, 100, high] });
const plan = { format: 2, unit: 'cm', coordinateSystem: 'Unreal Z-up', bounds: bounds(0, 500),
  zBands: [{ id: 'ground', bounds: bounds(0, 500) }, { id: 'alternate', bounds: bounds(2_000_000, 2_010_000) }],
  defaultBandId: 'ground', mapFocus: [{ mapId: 'sample', focusByBand: [{ bandId: 'ground', anchorCount: 4, bounds: bounds(0, 30) }] }],
  layers: [{ bandId: 'ground', minZ: 0, maxZ: 500, polygons: [
    [[[0, 0], [100, 0], [100, 100], [0, 100]], [[25, 25], [25, 75], [75, 75], [75, 25]]]
  ], polygonZ: [100] }] };
assert.equal(validateTerrain2D(plan), plan, 'A floor polygon may contain a genuine hole');
for (const change of [
  { vertices: [] }, { indices: [] }, { unit: 'm' }, { layers: Array(2049).fill(plan.layers[0]) },
  { layers: [{ minZ: 500, maxZ: 0, polygons: [] }] },
  { layers: [{ minZ: 0, maxZ: 500, polygons: [[[[0, 0], [100, NaN], [100, 100]]]] }] },
  { layers: [{ minZ: 0, maxZ: 500, polygons: [[[[0, 0], [100, 0]]]] }] }
]) assert.throws(() => validateTerrain2D({ ...plan, ...change }));
assert.equal(terrainBand(plan, 'sample').id, 'ground');
assert.equal(terrainBand(plan, 'sample', 2_000_100).id, 'alternate');
assert.equal(terrainBand(plan, 'sample', undefined, 'alternate').id, 'alternate');
assert.deepEqual(terrainFocusBounds(plan, 'sample', plan.zBands[0]), bounds(0, 30));
assert.deepEqual(terrainFocusBounds(plan, 'sample', plan.zBands[1]), bounds(2_000_000, 2_010_000));

const bufferOf = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const raw = Buffer.from(JSON.stringify(plan));
const asset = { jsonBytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
for (const bytes of [raw, gzipSync(raw)]) assert.deepEqual(await decodeTerrainAsset(bufferOf(bytes), asset), plan);
await assert.rejects(() => decodeTerrainAsset(bufferOf(raw), { ...asset, jsonBytes: raw.length + 1 }), /size mismatch/);
await assert.rejects(() => decodeTerrainAsset(bufferOf(raw), { ...asset, sha256: '0'.repeat(64) }), /integrity mismatch/);
await assert.rejects(() => decodeTerrainAsset(new ArrayBuffer(16 * 1024 * 1024 + 1), {}), /display budget/);
const oldGeometry = Buffer.from(JSON.stringify({ format: 1, vertices: [[0, 0, 0]], indices: [] }));
await assert.rejects(() => decodeTerrainAsset(bufferOf(oldGeometry), {}), /outline data/);
console.log('PASS 2D floor data: bounded outlines/holes, gzip/hash, explicit height areas and map focus');
