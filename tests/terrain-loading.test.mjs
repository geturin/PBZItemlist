// SPDX-License-Identifier: GPL-3.0-or-later
// Browser-free contract checks: fetch/Worker doubles do not measure browser rendering.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { decodeTerrainAsset } from '../public/js/terrain-format.js';

const bounds = { min: [0, 0, 0], max: [100, 100, 500] };
const geometry = { format: 1, unit: 'cm', coordinateSystem: 'Unreal Z-up', bounds,
  vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]], indices: [0, 1, 2] };
const outlines = { format: 2, unit: 'cm', coordinateSystem: 'Unreal Z-up', bounds,
  layers: [{ id: 'floor', minZ: 0, maxZ: 500, polygons: [[[[0, 0], [100, 0], [0, 100]]]] }] };
const fixtures = new Map();
const asset = (file, value) => {
  const raw = Buffer.from(JSON.stringify(value));
  fixtures.set(file, gzipSync(raw));
  return { file, jsonBytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
};
const manifest = { format: 2, maps: { first: { world: 'shared' }, second: { world: 'shared' }, other: { world: 'other' } }, worlds: {
  shared: { twoD: asset('shared.outlines.json.gz', outlines), threeD: asset('shared.floors.json.gz', geometry) },
  other: { twoD: asset('other.outlines.json.gz', { ...outlines, world: 'other' }), threeD: asset('other.floors.json.gz', geometry) }
} };
const originalFetch = globalThis.fetch, originalWorker = globalThis.Worker;
let serial = 0, passed = 0;
const fresh = () => import(`../public/js/terrain-data.js?loading-test=${++serial}`);
const nameOf = input => new URL(input).pathname.split('/').at(-1);
const responseFor = file => file === 'manifest.json'
  ? new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
  : new Response(fixtures.get(file), { status: fixtures.has(file) ? 200 : 404 });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
async function check(name, run) {
  try { delete globalThis.Worker; await run(); passed++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  finally { globalThis.fetch = originalFetch; if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; }
}

await check('default 2D and shared-world cache', async () => {
  const calls = [];
  globalThis.fetch = async input => { calls.push(nameOf(input)); return responseFor(nameOf(input)); };
  const loader = await fresh();
  const [first, second] = await Promise.all([loader.loadTerrainForMap('first'), loader.loadTerrainForMap('second')]);
  assert.equal(first.geometry, second.geometry);
  assert.equal(first.view, '2d');
  assert(!('vertices' in first.geometry) && !('indices' in first.geometry));
  assert.deepEqual(calls, ['manifest.json', 'shared.outlines.json.gz'], '2D must not fetch raw surfaces or 3D floors');
  assert.equal(await loader.loadTerrainForMap('unsupported'), null);
  await assert.rejects(() => loader.loadTerrainForMap('first', { view: 'bad' }), /Invalid terrain view/);
});

await check('independent view caches and release', async () => {
  const calls = [];
  globalThis.fetch = async input => { calls.push(nameOf(input)); return responseFor(nameOf(input)); };
  const loader = await fresh();
  const twoD = await loader.loadTerrainForMap('first');
  const threeD = await loader.loadTerrainForMap('first', { view: '3d' });
  assert(threeD.geometry.positionsXYZ instanceof Float64Array);
  assert(threeD.geometry.indices instanceof Uint32Array);
  loader.releaseTerrain('2d');
  assert.equal((await loader.loadTerrainForMap('second', { view: '3d' })).geometry, threeD.geometry);
  assert.notEqual((await loader.loadTerrainForMap('first')).geometry, twoD.geometry);
  assert.equal(calls.filter(file => file === 'shared.floors.json.gz').length, 1);
  assert.equal(calls.filter(file => file === 'shared.outlines.json.gz').length, 2);
  loader.releaseTerrain();
  await loader.loadTerrainForMap('first', { view: '3d' });
  assert.equal(calls.filter(file => file === 'shared.floors.json.gz').length, 2);
});

await check('release while manifest is pending', async () => {
  let finishManifest;
  const calls = [];
  globalThis.fetch = input => { calls.push(nameOf(input)); return new Promise(resolve => { finishManifest = resolve; }); };
  const loader = await fresh();
  const request = loader.loadTerrainForMap('first');
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await nextTurn();
  loader.releaseTerrain('2d');
  finishManifest(responseFor('manifest.json'));
  await rejected;
  assert.deepEqual(calls, ['manifest.json'], 'A cancelled request must not begin an asset download');
});

await check('world changes cancel old downloads without clearing the new cache', async () => {
  for (const completion of ['abort-error', 'late-response']) {
    const calls = [], signals = []; let finishOld;
    globalThis.fetch = async (input, options) => {
      const file = nameOf(input); calls.push(file);
      if (file !== 'shared.outlines.json.gz') return responseFor(file);
      return new Promise((resolve, reject) => {
        signals.push(options.signal); finishOld = resolve;
        if (completion === 'abort-error') options.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    };
    const loader = await fresh();
    const pending = loader.loadTerrainForMap('first');
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await nextTurn();
    const other = await loader.loadTerrainForMap('other');
    if (completion === 'late-response') finishOld(responseFor('shared.outlines.json.gz'));
    await rejected;
    assert(signals[0].aborted);
    assert.equal((await loader.loadTerrainForMap('other')).geometry, other.geometry);
    assert.equal(calls.filter(file => file === 'other.outlines.json.gz').length, 1);
  }
});

await check('failed manifest and asset downloads can be retried', async () => {
  let manifestFailures = 1, assetFailures = 1;
  globalThis.fetch = async input => {
    const file = nameOf(input);
    if (file === 'manifest.json' && manifestFailures-- > 0 || file !== 'manifest.json' && assetFailures-- > 0) return new Response('', { status: 503 });
    return responseFor(file);
  };
  const loader = await fresh();
  await assert.rejects(() => loader.loadTerrainForMap('first'), /manifest unavailable/);
  await assert.rejects(() => loader.loadTerrainForMap('first'), /Terrain unavailable/);
  assert.equal((await loader.loadTerrainForMap('first')).geometry.format, 2);
});

await check('manifest asset paths cannot escape the terrain directory', async () => {
  for (const file of ['../catalog.json', 'https://invalid.example/floors.json.gz']) {
    const badManifest = structuredClone(manifest); badManifest.worlds.shared.twoD.file = file;
    let assetFetches = 0;
    globalThis.fetch = async input => nameOf(input) === 'manifest.json' ? new Response(JSON.stringify(badManifest)) : (assetFetches++, responseFor(nameOf(input)));
    const loader = await fresh();
    await assert.rejects(() => loader.loadTerrainForMap('first'), /Invalid terrain URL/);
    assert.equal(assetFetches, 0);
  }
});

await check('3D uses a worker and terminates it after typed geometry arrives', async () => {
  const workers = [], calls = [];
  globalThis.fetch = async input => { calls.push(nameOf(input)); return responseFor(nameOf(input)); };
  globalThis.Worker = class {
    constructor(url, options) { assert.equal(options.type, 'module'); assert.match(url.pathname, /terrain-worker\.js$/); workers.push(this); }
    postMessage({ url, asset: metadata }) {
      this.url = url;
      const bytes = fixtures.get(nameOf(url));
      decodeTerrainAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata, '3d')
        .then(result => this.onmessage({ data: { ok: true, geometry: result } }));
    }
    terminate() { this.terminated = true; }
  };
  const loader = await fresh();
  const result = await loader.loadTerrainForMap('first', { view: '3d' });
  assert(result.geometry.positionsXYZ instanceof Float64Array);
  assert(result.geometry.indices instanceof Uint32Array);
  assert.deepEqual(calls, ['manifest.json'], 'Main-thread fetch must not download 3D geometry when Worker is available');
  assert.equal(workers.length, 1); assert(workers[0].terminated);
  assert.equal((await loader.loadTerrainForMap('second', { view: '3d' })).geometry, result.geometry);
});

await check('release cancels workers and a later request starts a fresh worker', async () => {
  const workers = [];
  globalThis.fetch = async input => responseFor(nameOf(input));
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const loader = await fresh();
  const pending = loader.loadTerrainForMap('first', { view: '3d' });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await nextTurn(); loader.releaseTerrain('3d'); await rejected;
  assert(workers[0].terminated);
  const replacement = loader.loadTerrainForMap('first', { view: '3d' });
  await nextTurn();
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { ok: true, geometry: { positionsXYZ: new Float64Array(9), indices: new Uint32Array([0, 1, 2]) } } });
  await replacement; assert(workers[1].terminated);
});

await check('worker failures release resources and permit retry', async () => {
  const workers = [];
  globalThis.fetch = async input => responseFor(nameOf(input));
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const loader = await fresh();
  const first = loader.loadTerrainForMap('first', { view: '3d' });
  const firstRejected = assert.rejects(first, /worker unavailable/);
  await nextTurn(); workers[0].onerror(); await firstRejected;
  const second = loader.loadTerrainForMap('first', { view: '3d' });
  const secondRejected = assert.rejects(second, /decoding failed/);
  await nextTurn(); workers[1].onmessage({ data: { ok: false } }); await secondRejected;
  const third = loader.loadTerrainForMap('first', { view: '3d' });
  await nextTurn(); workers[2].onmessage({ data: { ok: true, geometry: geometry } });
  assert.equal((await third).geometry, geometry);
  assert.equal(workers.length, 3); assert(workers.every(worker => worker.terminated));
});

console.log(`PASS terrain loading: ${passed} browser-free view isolation, cache, worker and cancellation checks`);
