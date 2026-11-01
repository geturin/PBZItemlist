// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateTerrainGeometry, validateTerrain2D } from '../public/js/terrain-data.js';

const root = new URL('../public/data/terrain-low/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
assert.equal(manifest.format, 2);
assert.equal(Object.keys(manifest.worlds).length, 9);
assert.equal(Object.keys(manifest.maps).length, 12);
const totals = { vertices: 0, triangles: 0, twoDJsonBytes: 0, twoDGzipBytes: 0, threeDJsonBytes: 0, threeDGzipBytes: 0 };
let witnesses = 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validBounds = bounds => Array.isArray(bounds?.min) && Array.isArray(bounds?.max)
  && bounds.min.length === 3 && bounds.max.length === 3
  && bounds.min.every((number, axis) => Number.isFinite(number) && Number.isFinite(bounds.max[axis]) && number <= bounds.max[axis]);
async function readAsset(metadata, kind) {
  assert(new RegExp(`^[A-Za-z0-9_]+\\.${kind}\\.[a-f0-9]{16}\\.json\\.gz$`).test(metadata.file));
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

// Match a nearby XY surface and its height, never a remote tower floor.
function nearestXY(point, a, b, c) {
  const [x, y] = point;
  const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(determinant) > 1e-9) {
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / determinant;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / determinant;
    if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) return [0, u * a[2] + v * b[2] + (1 - u - v) * c[2]];
  }
  let best = [Infinity, 0];
  for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const dx = q[0] - p[0], dy = q[1] - p[1], length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / length2)) : 0;
    const distance2 = (x - p[0] - t * dx) ** 2 + (y - p[1] - t * dy) ** 2;
    if (distance2 < best[0]) best = [distance2, p[2] + t * (q[2] - p[2])];
  }
  return best;
}

for (const [id, world] of Object.entries(manifest.worlds)) {
  assert(world.twoD && world.threeD, 'Views must have separate, independently loadable assets');
  assert.notEqual(world.twoD.file, world.threeD.file);
  const outlines = validateTerrain2D(await readAsset(world.twoD, 'outlines'));
  const geometry = validateTerrainGeometry(await readAsset(world.threeD, 'floors'));
  assert.equal(outlines.world, id); assert.equal(geometry.world, id);
  assert(validBounds(geometry.bounds)); assert(validBounds(outlines.bounds));
  assert.equal(geometry.vertices.length, world.threeD.vertices);
  assert.equal(geometry.indices.length / 3, world.threeD.triangles);
  assert.equal(outlines.layers.length, world.twoD.layers);
  let contourPoints = 0;
  for (const layer of outlines.layers) for (const polygon of layer.polygons) for (const ring of polygon) contourPoints += ring.length;
  assert.equal(contourPoints, world.twoD.contourPoints);
  assert.equal(world.displayApproximation?.precision, 'display-approximation-not-walkability');
  assert.equal(world.displayApproximation?.routing, false);
  let end = 0;
  for (const band of geometry.zBands) {
    assert(validBounds(band.bounds));
    assert.equal(band.firstIndex, end); assert.equal(band.indexCount % 3, 0);
    assert.equal(band.triangleCount, band.indexCount / 3);
    end += band.indexCount;
  }
  assert.equal(end, geometry.indices.length, 'Height bands partition the simplified display triangles');
  for (const vertex of geometry.vertices) for (let axis = 0; axis < 3; axis++) {
    assert(vertex[axis] >= geometry.bounds.min[axis] - .01 && vertex[axis] <= geometry.bounds.max[axis] + .01, 'Display bounds must enclose exported vertices');
  }
  assert(geometry.zBands.some(band => band.id === geometry.defaultBandId));
  for (const mapId of world.mapIds) assert.equal(manifest.maps[mapId]?.world, id);
  totals.vertices += geometry.vertices.length; totals.triangles += geometry.indices.length / 3;
  for (const field of ['jsonBytes', 'gzipBytes']) {
    totals[`twoD${field[0].toUpperCase()}${field.slice(1)}`] += world.twoD[field];
    totals[`threeD${field[0].toUpperCase()}${field.slice(1)}`] += world.threeD[field];
  }
  if (id === 'PBZ_Fujizhilin_WP') {
    for (const bellId of ['Bell_LZSJ_017', 'Bell_LZSJ_018', 'Bell_LZSJ_019']) {
      const bell = catalog.bells.find(item => item.id === bellId);
      assert(bell?.location, bellId);
      const { X, Y, Z } = bell.location;
      let bestHeightError = Infinity;
      for (let index = 0; index < geometry.indices.length; index += 3) {
        const a = geometry.vertices[geometry.indices[index]], b = geometry.vertices[geometry.indices[index + 1]], c = geometry.vertices[geometry.indices[index + 2]];
        if (Math.max(a[0], b[0], c[0]) < X - 500 || Math.min(a[0], b[0], c[0]) > X + 500
            || Math.max(a[1], b[1], c[1]) < Y - 500 || Math.min(a[1], b[1], c[1]) > Y + 500) continue;
        const [distance2, surfaceZ] = nearestXY([X, Y], a, b, c);
        if (distance2 <= 500 ** 2) bestHeightError = Math.min(bestHeightError, Math.abs(surfaceZ - Z));
      }
      assert(bestHeightError <= 150, `${bellId}: a display patch within 5 m XY must retain its own floor within 1.5 m Z (got ${bestHeightError} cm)`);
      witnesses++;
    }
  }
}
for (const [key, value] of Object.entries(totals)) assert.equal(value, manifest.totals[key], key);
assert(totals.triangles < 500_000, 'Display floors must reduce the former 1,783,699 triangles by at least 72%');
assert(totals.threeDGzipBytes < 6_000_000, '3D display data must be substantially smaller than the former 20.7 MB download');
assert(totals.twoDGzipBytes < 3_000_000, 'Optional 2D floor outlines have their own small download budget');
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
console.log(`PASS terrain assets: 9 worlds / 12 maps / ${totals.triangles} display triangles / 3 floor witnesses / 16 hashed map images`);
