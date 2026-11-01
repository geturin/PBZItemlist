// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateTerrainGeometry } from '../public/js/terrain-data.js';

const root = new URL('../public/data/terrain/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
assert.equal(Object.keys(manifest.worlds).length, 9);
assert.equal(Object.keys(manifest.maps).length, 12);
let vertices = 0, triangles = 0, witnesses = 0;
for (const [id, world] of Object.entries(manifest.worlds)) {
  assert(/^[A-Za-z0-9_]+\.[a-f0-9]{16}\.json\.gz$/.test(world.file));
  const compressed = await fs.readFile(new URL(world.file, root));
  assert.equal(compressed.length, world.gzipBytes);
  const raw = gunzipSync(compressed);
  assert.equal(raw.length, world.jsonBytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'), world.sha256);
  assert(!/[A-Z]:[\\/]|pbz_analysis|\.uasset|\.umap|\.ucas|\.pak/.test(raw.toString('utf8')));
  const geometry = validateTerrainGeometry(JSON.parse(raw));
  assert.equal(geometry.world, id);
  assert.equal(geometry.vertices.length, world.vertices);
  assert.equal(geometry.indices.length / 3, world.triangles);
  let end = 0;
  for (const band of geometry.zBands) {
    assert.equal(band.firstIndex, end);
    assert.equal(band.indexCount % 3, 0);
    end += band.indexCount;
  }
  assert.equal(end, geometry.indices.length, 'Height bands preserve every original surface triangle');
  vertices += geometry.vertices.length; triangles += geometry.indices.length / 3;
  if (id === 'PBZ_Fujizhilin_WP') {
    for (const bellId of ['Bell_LZSJ_017', 'Bell_LZSJ_018', 'Bell_LZSJ_019']) {
      const bell = catalog.bells.find(item => item.id === bellId);
      assert(bell?.location, bellId);
      const { X, Y, Z } = bell.location;
      let distance2 = Infinity;
      for (const v of geometry.vertices) distance2 = Math.min(distance2, (v[0] - X) ** 2 + (v[1] - Y) ** 2 + (v[2] - Z) ** 2);
      assert(distance2 < 150 ** 2, `${bellId} must align with its actual tower elevation, not another floor`);
      witnesses++;
    }
  }
}
assert.equal(vertices, manifest.totals.vertices);
assert.equal(triangles, manifest.totals.triangles);
assert.equal(witnesses, 3);
assert(!manifest.maps.XueSeSenLin && !manifest.maps.HuanShuShi, 'Do not invent terrain aliases for unverified definitions');
console.log(`PASS terrain assets: 9 worlds / 12 maps / ${triangles} source triangles / 3 independent tower landmarks`);
