// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { visibleTiles, createMapTileLayer } from '../public/js/map-tiles.js';

const root = new URL('../public/data/map-images-hi/', import.meta.url);
const manifestText = await fs.readFile(new URL('manifest.json', root), 'utf8');
const manifest = JSON.parse(manifestText);
const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const provenance = JSON.parse(await fs.readFile(new URL('../public/data/map-images/PROVENANCE.json', import.meta.url), 'utf8'));

// Inspect dimensions without loading native image libraries or decoding pixels.
function webpSize(bytes) {
  assert(bytes.length >= 30, 'WebP header is complete');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'RIFF length includes the complete tile');
  let canvas, image, offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    assert(start + length <= bytes.length, 'WebP chunk fits the tile');
    if (kind === 'VP8X') {
      assert(length >= 10);
      canvas = [1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3)];
    } else if (kind === 'VP8L') {
      assert(length >= 5); assert.equal(bytes[start], 0x2f);
      const bits = bytes.readUInt32LE(start + 1);
      image = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    } else if (kind === 'VP8 ') {
      assert(length >= 10);
      assert.equal(bytes.toString('hex', start + 3, start + 6), '9d012a');
      image = [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
    }
    offset = start + length + (length % 2);
  }
  assert.equal(offset, bytes.length, 'WebP chunks do not leave an unparsed tail');
  assert(image, 'WebP has an image bitstream');
  if (canvas) assert.deepEqual(canvas, image, 'Static tile canvas and image dimensions agree');
  return canvas || image;
}

assert.equal(manifest.format, 1);
assert.equal(manifest.kind, 'native-map-image-tiles');
assert.equal(manifest.encoding, 'WebP');
assert.equal(manifest.tileSize, 512);
assert(manifest.quality >= 85 && manifest.quality <= 90, 'High-resolution artwork keeps its approved quality range');
assert(Buffer.byteLength(manifestText) < 32 * 1024, 'Manifest uses URL templates instead of thousands of per-tile records');
assert(!/[A-Z]:[\\/]|pbz_analysis|\.uasset|\.ucas|\.pak|\.dds/.test(manifestText), 'Only web display metadata is published');
assert.equal(Object.keys(manifest.images).length, 8);
assert.equal(Object.keys(manifest.maps).length, 12);
assert.deepEqual(Object.keys(manifest.maps).sort(), catalog.maps.filter(map => map.image).map(map => map.id).sort());
for (const source of provenance.images) {
  const image = manifest.images[source.asset];
  assert(image, source.asset);
  assert.deepEqual([image.width, image.height], source.sourceSize, 'Highest level uses native dimensions, not an enlarged 2048 image');
  for (const mapId of source.mapIds) assert.equal(manifest.maps[mapId]?.image, source.asset);
}

const referenced = new Set();
let tileCount = 0, totalBytes = 0, maximumTile = 0, edgeTiles = 0;
for (const [id, image] of Object.entries(manifest.images)) {
  assert(/^[A-Za-z0-9_]+$/.test(id));
  assert.equal(image.width, 8192);
  assert.equal(image.height, id === 'T_Map_PZ_8k' ? 4512 : 8192);
  assert.equal(image.tileSize, 512);
  assert.deepEqual(image.levels.map(level => level.width), [2048, 4096, 8192]);
  for (const level of image.levels) {
    assert.equal(level.id, String(level.width));
    assert.equal(level.height, Math.round(level.width * image.height / image.width));
    const cols = Math.ceil(level.width / 512), rows = Math.ceil(level.height / 512);
    assert.equal(level.cols, cols); assert.equal(level.rows, rows);
    assert.equal(level.lastTileWidth, level.width - (cols - 1) * 512);
    assert.equal(level.lastTileHeight, level.height - (rows - 1) * 512);
    assert.equal(level.tiles, cols * rows);
    assert.match(level.sha256, /^[a-f0-9]{64}$/);
    assert.equal(level.urlTemplate, `${id}/${level.width}-${level.sha256.slice(0, 16)}/{x}_{y}.webp`);
    const hash = createHash('sha256');
    let bytes = 0, maximum = 0;
    // Level content hash order is y-major, then x, including the basename and NUL.
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const basename = `${x}_${y}.webp`;
      const relative = level.urlTemplate.replace('{x}', String(x)).replace('{y}', String(y));
      assert(!referenced.has(relative), 'Every published tile has one manifest reference');
      referenced.add(relative);
      const url = new URL(relative, root); assert(url.href.startsWith(root.href), 'Tile remains inside its static directory');
      const tile = await fs.readFile(url);
      const width = Math.min(512, level.width - x * 512), height = Math.min(512, level.height - y * 512);
      assert.deepEqual(webpSize(tile), [width, height], relative);
      assert(tile.length < 128 * 1024, 'A visible tile remains a small independent request');
      if (width < 512 || height < 512) edgeTiles++;
      hash.update(Buffer.from(`${basename}\0`, 'ascii')).update(tile);
      bytes += tile.length; maximum = Math.max(maximum, tile.length);
    }
    assert.equal(hash.digest('hex'), level.sha256, 'Immutable level directory matches all tile content');
    assert.equal(bytes, level.bytes); assert.equal(maximum, level.maxTileBytes);
    tileCount += level.tiles; totalBytes += bytes; maximumTile = Math.max(maximumTile, maximum);
  }
}

const actual = (await fs.readdir(root, { recursive: true })).map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.webp'));
assert.deepEqual(actual.sort(), [...referenced].sort(), 'No missing or obsolete candidate tiles are shipped');
assert.equal(tileCount, 2548);
assert.equal(edgeTiles, 28, 'The non-square map has actual 104/208/416-pixel bottom edges at all three levels');
assert.equal(manifest.totals.images, 8); assert.equal(manifest.totals.maps, 12);
assert.equal(manifest.totals.tiles, tileCount); assert.equal(manifest.totals.bytes, totalBytes);
assert(totalBytes < 160_000_000, 'The disk payload stays bounded; clients request visible tiles rather than this whole pyramid');
assert(!manifest.maps.XueSeSenLin && !manifest.maps.HuanShuShi, 'Unverified map definitions do not acquire invented artwork aliases');

// Selection is checked against viewport coverage, not just asset headers.
const frame = { x: 142.5, y: 57.5, width: 475, height: 475 };
const square = manifest.images[manifest.maps.FuJiZhiLin.image];
const view = (zoom, panX = 0, panY = 0) => ({ zoom, panX, panY });
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const contains = (tile, x, y) => x >= tile.x - 1e-9 && x <= tile.x + tile.width + 1e-9
  && y >= tile.y - 1e-9 && y <= tile.y + tile.height + 1e-9;
function assertSelection(image, area, camera, options = {}) {
  const selected = visibleTiles(image, area, camera, options);
  assert(selected.length <= 36, 'High zoom does not retain the full source image');
  assert.equal(new Set(selected.map(tile => tile.key)).size, selected.length);
  for (const tile of selected) {
    const [id, xText, yText] = tile.key.split(':');
    const level = image.levels.find(entry => entry.id === id), x = Number(xText), y = Number(yText);
    assert(level && Number.isSafeInteger(x) && Number.isSafeInteger(y));
    assert(x >= 0 && x < level.cols && y >= 0 && y < level.rows, 'Selection never invents a grid coordinate');
    assert.equal(tile.file, level.urlTemplate.replace('{x}', xText).replace('{y}', yText));
    near(tile.x, area.x + x * 512 / level.width * area.width);
    near(tile.y, area.y + y * 512 / level.height * area.height);
    near(tile.width, Math.min(512, level.width - x * 512) / level.width * area.width);
    near(tile.height, Math.min(512, level.height - y * 512) / level.height * area.height);
  }
  // The SVG viewport spans 760x590 around (380,295). Every sampled visible
  // point inside the art must be covered, including its center and corners.
  const bounds = options.bounds || { minX: 0, minY: 0, maxX: 760, maxY: 590 };
  for (let row = 0; row <= 4; row++) for (let col = 0; col <= 4; col++) {
    const screenX = bounds.minX + (bounds.maxX - bounds.minX) * col / 4;
    const screenY = bounds.minY + (bounds.maxY - bounds.minY) * row / 4;
    const x = 380 + (screenX - 380 - camera.panX) / camera.zoom;
    const y = 295 + (screenY - 295 - camera.panY) / camera.zoom;
    if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
      assert(selected.some(tile => contains(tile, x, y)), `Visible art at ${screenX},${screenY} must have a selected tile`);
    }
  }
  return selected;
}
assert.deepEqual(visibleTiles(square, frame, view(1), { pixelRatio: 1 }), [], 'The small preview handles zoom 1 without high-resolution requests');
for (const [zoom, width] of [[4, 2048], [8, 4096], [16, 8192]]) {
  const selected = assertSelection(square, frame, view(zoom), { pixelRatio: 1 });
  assert(selected.length && selected.every(tile => tile.key.startsWith(`${width}:`)), `Zoom ${zoom} picks its required native resolution`);
}
for (const camera of [view(32), view(32, 240, -170), view(32, -350, 210)]) {
  const selected = assertSelection(square, frame, camera);
  const centerX = 380 - camera.panX / camera.zoom, centerY = 295 - camera.panY / camera.zoom;
  assert(selected.some(tile => contains(tile, centerX, centerY)), 'A pan retains the tile beneath the viewport center');
}
for (const [panX, panY] of [[100000, 0], [-100000, 0], [0, 100000], [0, -100000]]) {
  assert.deepEqual(visibleTiles(square, frame, view(32, panX, panY)), [], 'Fully offscreen artwork requests no tiles');
}
const wide = manifest.images[manifest.maps.PangZhen.image];
const wideFrame = { x: 142.5, y: 295 - 475 * wide.height / wide.width / 2, width: 475, height: 475 * wide.height / wide.width };
const targetX = wideFrame.x + wideFrame.width - 256 * 475 / 8192;
const targetY = wideFrame.y + wideFrame.height - 208 * 475 / 8192;
const edgeCamera = view(32, (380 - targetX) * 32, (295 - targetY) * 32);
const edgeSelection = assertSelection(wide, wideFrame, edgeCamera);
const bottomRight = edgeSelection.find(tile => tile.key === '8192:15:8');
assert(bottomRight && contains(bottomRight, targetX, targetY), 'Panning to the cropped edge still covers the center');
near(bottomRight.width, 512 * 475 / 8192); near(bottomRight.height, 416 * 475 / 8192);
near(bottomRight.x + bottomRight.width, wideFrame.x + wideFrame.width);
near(bottomRight.y + bottomRight.height, wideFrame.y + wideFrame.height);

// A minimal SVG-node stub exercises URL guards without a browser or images.
const fakeDocument = {
  createElementNS(_namespace, tag) {
    return { tag, attributes: {}, children: [], classList: { add() {} },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      append(node) { node.parent = this; this.children.push(node); },
      replaceChildren() { this.children = []; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); },
      addEventListener() {} };
  },
};
const testImage = structuredClone(square);
const mockManifest = { maps: { test: { image: 'test' } }, images: { test: testImage } };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => mockManifest });
try {
  for (const template of ['https://untrusted.invalid/{x}_{y}.webp', '../../outside/{x}_{y}.webp', '../%2e%2e/outside/{x}_{y}.webp']) {
    for (const level of testImage.levels) level.urlTemplate = template;
    const layer = createMapTileLayer(fakeDocument, 'test', frame);
    await layer.update(view(4));
    assert.equal(layer.node.children.length, 0, 'External and normalized traversal URLs never become image requests');
    layer.dispose();
  }
  for (let index = 0; index < testImage.levels.length; index++) testImage.levels[index].urlTemplate = square.levels[index].urlTemplate;
  const layer = createMapTileLayer(fakeDocument, 'test', frame);
  await layer.update(view(4));
  assert(layer.node.children.length > 0, 'Safe same-directory tile URLs remain usable');
  const base = new URL('../public/data/map-images-hi/', import.meta.url);
  for (const node of layer.node.children) {
    const url = new URL(node.attributes.href);
    assert.equal(url.origin, base.origin); assert(url.pathname.startsWith(base.pathname));
  }
  layer.dispose();
} finally { globalThis.fetch = originalFetch; }
console.log(`Native map tiles: ${tileCount} headers/hashes, viewport coverage, cropped edges and URL guards verified; ${totalBytes} bytes on disk, max tile ${maximumTile} bytes.`);
