// SPDX-License-Identifier: GPL-3.0-or-later
// Fetch doubles exercise the public 2D loader; no browser or worker is started.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const plan = { format: 2, unit: 'cm', coordinateSystem: 'Unreal Z-up', layers: [
  { minZ: 0, maxZ: 500, polygons: [[[[0, 0], [100, 0], [0, 100]]]] }
] };
const fixtures = new Map();
function asset(file, value) {
  const raw = Buffer.from(JSON.stringify(value)); fixtures.set(file, gzipSync(raw));
  return { file, jsonBytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
}
const manifest = { format: 2, maps: { first: { world: 'shared' }, second: { world: 'shared' }, other: { world: 'other' } }, worlds: {
  shared: { twoD: asset('shared.outlines.json.gz', plan) }, other: { twoD: asset('other.outlines.json.gz', { ...plan, world: 'other' }) }
} };
const originalFetch = globalThis.fetch, originalWorker = globalThis.Worker;
let serial = 0, passed = 0;
const fresh = () => import(`../public/js/terrain-data.js?loading-test=${++serial}`);
const nameOf = input => new URL(input).pathname.split('/').at(-1);
const responseFor = file => file === 'manifest.json' ? new Response(JSON.stringify(manifest)) : new Response(fixtures.get(file), { status: fixtures.has(file) ? 200 : 404 });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
async function check(name, run) {
  try { globalThis.Worker = class { constructor() { assert.fail('2D loading must not construct a Worker'); } }; await run(); passed++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  finally { globalThis.fetch = originalFetch; if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; }
}
await check('independent outlines and shared world cache', async () => {
  const calls = []; globalThis.fetch = async input => { calls.push(nameOf(input)); return responseFor(nameOf(input)); };
  const loader = await fresh();
  const [first, second] = await Promise.all([loader.loadTerrainForMap('first'), loader.loadTerrainForMap('second')]);
  assert.equal(first.geometry, second.geometry); assert.equal(first.geometry.format, 2);
  assert(!('vertices' in first.geometry) && !('indices' in first.geometry));
  assert.deepEqual(calls, ['manifest.json', 'shared.outlines.json.gz']);
  assert.equal(await loader.loadTerrainForMap('unsupported'), null);
});
await check('release drops the active cache and reloads it', async () => {
  const calls = []; globalThis.fetch = async input => { calls.push(nameOf(input)); return responseFor(nameOf(input)); };
  const loader = await fresh(), first = await loader.loadTerrainForMap('first');
  loader.releaseTerrain(); assert.notEqual((await loader.loadTerrainForMap('second')).geometry, first.geometry);
  assert.equal(calls.filter(file => file === 'shared.outlines.json.gz').length, 2);
  assert.equal(calls.filter(file => file === 'manifest.json').length, 1);
});
await check('release during manifest download prevents an asset request', async () => {
  let finish; const calls = [];
  globalThis.fetch = input => { calls.push(nameOf(input)); return new Promise(resolve => { finish = resolve; }); };
  const loader = await fresh(), pending = loader.loadTerrainForMap('first');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await nextTurn(); loader.releaseTerrain(); finish(responseFor('manifest.json')); await rejected;
  assert.deepEqual(calls, ['manifest.json']);
});
await check('switching worlds cancels old requests and preserves the latest cache', async () => {
  for (const completion of ['abort-error', 'late-response']) {
    let signal, finish; const calls = [];
    globalThis.fetch = async (input, options) => {
      const file = nameOf(input); calls.push(file);
      if (file !== 'shared.outlines.json.gz') return responseFor(file);
      return new Promise((resolve, reject) => { signal = options.signal; finish = resolve;
        if (completion === 'abort-error') signal.addEventListener('abort', () => reject(abortError()), { once: true }); });
    };
    const loader = await fresh(), pending = loader.loadTerrainForMap('first');
    const rejected = assert.rejects(pending, { name: 'AbortError' }); await nextTurn();
    const other = await loader.loadTerrainForMap('other');
    if (completion === 'late-response') finish(responseFor('shared.outlines.json.gz'));
    await rejected; assert(signal.aborted);
    assert.equal((await loader.loadTerrainForMap('other')).geometry, other.geometry);
    assert.equal(calls.filter(file => file === 'other.outlines.json.gz').length, 1);
  }
});
await check('release cancels an active download', async () => {
  let signal;
  globalThis.fetch = async (input, options) => nameOf(input) === 'manifest.json' ? responseFor('manifest.json') : new Promise((resolve, reject) => {
    signal = options.signal; signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
  const loader = await fresh(), pending = loader.loadTerrainForMap('first');
  const rejected = assert.rejects(pending, { name: 'AbortError' }); await nextTurn(); loader.releaseTerrain(); await rejected; assert(signal.aborted);
});
await check('failed manifest and asset downloads can be retried', async () => {
  let manifestFailures = 1, assetFailures = 1;
  globalThis.fetch = async input => { const file = nameOf(input);
    return file === 'manifest.json' && manifestFailures-- > 0 || file !== 'manifest.json' && assetFailures-- > 0 ? new Response('', { status: 503 }) : responseFor(file); };
  const loader = await fresh();
  await assert.rejects(() => loader.loadTerrainForMap('first'), /manifest unavailable/);
  await assert.rejects(() => loader.loadTerrainForMap('first'), /Terrain unavailable/);
  assert.equal((await loader.loadTerrainForMap('first')).geometry.format, 2);
});
await check('asset paths cannot escape the published outline directory', async () => {
  for (const file of ['../catalog.json', 'https://invalid.example/outlines.json.gz']) {
    const changed = structuredClone(manifest); changed.worlds.shared.twoD.file = file; let assets = 0;
    globalThis.fetch = async input => nameOf(input) === 'manifest.json' ? new Response(JSON.stringify(changed)) : (assets++, responseFor(nameOf(input)));
    const loader = await fresh(); await assert.rejects(() => loader.loadTerrainForMap('first'), /Invalid terrain URL/); assert.equal(assets, 0);
  }
});
await check('removed 3D and unsupported modes fail before any fetch', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; assert.fail('Unsupported views must not download data'); };
  const loader = await fresh();
  for (const view of ['3d', 'unknown']) await assert.rejects(() => loader.loadTerrainForMap('first', { view }), /Invalid terrain view/);
  assert.equal(calls, 0);
});
await check('an integrity failure cannot poison the next outline load', async () => {
  let assets = 0;
  globalThis.fetch = async input => {
    const file = nameOf(input);
    if (file === 'manifest.json') return responseFor(file);
    if (++assets === 1) return new Response(gzipSync(JSON.stringify({ ...plan, unit: 'mm' })));
    return responseFor(file);
  };
  const loader = await fresh();
  await assert.rejects(() => loader.loadTerrainForMap('first'), /integrity mismatch/);
  assert.equal((await loader.loadTerrainForMap('first')).geometry.unit, 'cm'); assert.equal(assets, 2);
});
console.log(`PASS 2D floor loading: ${passed} shared-cache, cancellation/race, retry, path and no-worker checks`);
