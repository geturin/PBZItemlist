// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { validateTerrainGeometry, terrainBand, terrainFocusBounds } from '../public/js/terrain-data.js';
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
console.log('PASS terrain data: face validation, height-scene selection and map-specific camera bounds');
