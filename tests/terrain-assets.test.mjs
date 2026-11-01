// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateTerrain2D } from '../public/js/terrain-data.js';

const root = new URL('../public/data/terrain-low/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
assert.equal(manifest.format, 2);
assert.equal(Object.keys(manifest.worlds).length, 9);
assert.equal(Object.keys(manifest.maps).length, 12);
const totals = { twoDJsonBytes: 0, twoDGzipBytes: 0 };
const published = new Set(['manifest.json']);
let witnesses = 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validBounds = bounds => Array.isArray(bounds?.min) && Array.isArray(bounds?.max)
  && bounds.min.length === 3 && bounds.max.length === 3
  && bounds.min.every((number, axis) => Number.isFinite(number) && Number.isFinite(bounds.max[axis]) && number <= bounds.max[axis]);
async function readAsset(metadata, kind) {
  assert(new RegExp(`^[A-Za-z0-9_]+\\.${kind}\\.[a-f0-9]{16}\\.json\\.gz$`).test(metadata.file));
  published.add(metadata.file);
  const compressed = await fs.readFile(new URL(metadata.file, root));
  assert.equal(compressed.length, metadata.gzipBytes);
  assert(compressed.length < 2 * 1024 * 1024, 'Each optional map asset must stay below 2 MiB compressed');
  const raw = gunzipSync(compressed);
  assert.equal(raw.length, metadata.jsonBytes);
  assert(raw.length <= 16 * 1024 * 1024, 'Every decoded asset must fit the loader budget');
  assert.equal(sha256(raw), metadata.sha256);
  assert(metadata.file.includes(metadata.sha256.slice(0, 16)), 'Immutable asset filename must match its content');
  assert(!/[A-Z]:[\\/]|pbz_analysis|\.uasset|\.umap|\.ucas|\.pak/.test(raw.toString('utf8')), 'Published geometry must not contain raw package names or private paths');
  return JSON.parse(raw);
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygonDistance2(point, polygon) {
  if (insideRing(point, polygon[0]) && !polygon.slice(1).some(ring => insideRing(point, ring))) return 0;
  let best = Infinity;
  for (const ring of polygon) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
    best = Math.min(best, (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2);
  }
  return best;
}

for (const [id, world] of Object.entries(manifest.worlds)) {
  assert(world.twoD && !world.threeD, 'The release publishes only 2D outline geometry');
  const outlines = validateTerrain2D(await readAsset(world.twoD, 'outlines'));
  assert.equal(outlines.world, id); assert(validBounds(outlines.bounds));
  assert.equal(outlines.layers.length, world.twoD.layers);
  let contourPoints = 0;
  for (const layer of outlines.layers) {
    assert.equal(layer.polygonZ.length, layer.polygons.length);
    assert(layer.polygonZ.every(z => Number.isFinite(z) && z >= layer.minZ - 1 && z <= layer.maxZ + 1));
    for (const polygon of layer.polygons) for (const ring of polygon) {
      assert.deepEqual(ring[0], ring.at(-1), 'Published vector rings close exactly');
      contourPoints += ring.length;
    }
  }
  assert.equal(contourPoints, world.twoD.contourPoints);
  assert.equal(world.displayApproximation?.precision, 'display-approximation-not-walkability');
  assert.equal(world.displayApproximation?.routing, false);
  for (const band of outlines.zBands) assert(validBounds(band.bounds));
  assert(outlines.zBands.some(band => band.id === outlines.defaultBandId));
  for (const mapId of world.mapIds) assert.equal(manifest.maps[mapId]?.world, id);
  for (const field of ['jsonBytes', 'gzipBytes']) {
    totals[`twoD${field[0].toUpperCase()}${field.slice(1)}`] += world.twoD[field];
  }
  if (id === 'PBZ_Fujizhilin_WP') {
    for (const bellId of ['Bell_LZSJ_017', 'Bell_LZSJ_018', 'Bell_LZSJ_019']) {
      const bell = catalog.bells.find(item => item.id === bellId);
      assert(bell?.location, bellId);
      const { X, Y, Z } = bell.location;
      let bestHeightError = Infinity;
      for (const layer of outlines.layers) for (let index = 0; index < layer.polygons.length; index++) {
        const heightError = Math.abs(layer.polygonZ[index] - Z);
        if (heightError < bestHeightError && polygonDistance2([X, Y], layer.polygons[index]) <= 500 ** 2) bestHeightError = heightError;
      }
      assert(bestHeightError <= 150, `${bellId}: a display patch within 5 m XY must retain its own floor within 1.5 m Z (got ${bestHeightError} cm)`);
      witnesses++;
    }
  }
}
for (const [key, value] of Object.entries(totals)) assert.equal(value, manifest.totals[key], key);
assert(totals.twoDGzipBytes < 3_000_000, 'Optional 2D floor outlines have their own small download budget');
assert.deepEqual((await fs.readdir(root)).sort(), [...published].sort(), 'No obsolete 3D or candidate geometry remains in the published directory');
assert.equal(witnesses, 3);
assert(!manifest.maps.XueSeSenLin && !manifest.maps.HuanShuShi, 'Do not invent terrain aliases for unverified definitions');

function webpSize(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    assert(start + length <= bytes.length);
    if (kind === 'VP8X') return [1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3)];
    if (kind === 'VP8L') { assert.equal(bytes[start], 0x2f); const bits = bytes.readUInt32LE(start + 1); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; }
    if (kind === 'VP8 ') { assert.equal(bytes.toString('hex', start + 3, start + 6), '9d012a'); return [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff]; }
    offset = start + length + (length % 2);
  }
  assert.fail('Missing WebP image dimensions');
}
const art = catalog.maps.filter(map => map.image), uniqueArt = new Set();
assert.equal(art.length, 12, 'All native projected maps must have an image');
for (const map of art) {
  const image = map.image, ratio = image.height / image.width;
  assert(Math.abs(ratio - map.mapProjection.height / map.mapProjection.width) < 1e-9, `${map.id}: image and UV frame aspect ratio must agree`);
  for (const [field, byteField, width] of [['file', 'previewBytes', 1024], ['detailFile', 'detailBytes', 2048]]) {
    const match = /^map-images\/map-([a-f0-9]{16})-(1024|2048)\.webp$/.exec(image[field]);
    assert(match); assert.equal(Number(match[2]), width);
    const bytes = await fs.readFile(new URL('../public/data/' + image[field], import.meta.url));
    assert.equal(bytes.length, image[byteField]); assert.equal(sha256(bytes).slice(0, 16), match[1]);
    const [actualWidth, actualHeight] = webpSize(bytes);
    assert.equal(actualWidth, width); assert(Math.abs(actualHeight - width * ratio) <= 1);
    assert(bytes.length <= (width === 1024 ? 160 : 700) * 1024, 'Image stays within its independent display budget');
    uniqueArt.add(image[field]);
  }
}
assert.equal(uniqueArt.size, 16, 'Shared native textures must be reused rather than copied per map');
for (const ids of [['PangZhen', 'HouJie', 'XiMeng'], ['MeiGuHu', 'MeiGu_YiJi'], ['DuanHunYa', 'DuanHunShan']]) {
  assert.equal(new Set(ids.map(id => art.find(map => map.id === id).image.file)).size, 1);
}
console.log('PASS 2D floor assets: 9 worlds / 12 maps / 3 height witnesses / 16 hashed previews and details / no 3D assets');
