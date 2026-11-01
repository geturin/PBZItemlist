// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { worldLocation, worldToThree, boundsOf, centerOfBounds, triangulatePolygons, prepareTerrainGeometry, boundarySkirts, markerPosition, inHeightRange, terrainViewBounds, clipSurfaceHeight, terrainVertexCount, terrainVertexAt, terrainBounds, cameraPoseAtTarget } from '../public/js/geometry-utils.js';
import { createTerrainView } from '../public/js/terrain-view.js';
import { drawTerrain2D } from '../public/js/terrain-2d.js';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const mesh = { format: 1, unit: 'cm', coordinateSystem: 'Unreal Z-up', vertices: [[10000000, 20000000, 300], [10000100, 20000000, 300], [10000100, 20000100, 400], [10000000, 20000100, 400]], polygons: [[0, 1, 2, 3]] };
const prepared = prepareTerrainGeometry(mesh);
assert.deepEqual([...prepared.indices], [0, 1, 2, 0, 2, 3], 'Only the supplied convex polygon is triangulated');
assert.deepEqual(prepared.origin, [10000050, 20000050, 350]);
assert.deepEqual([...prepared.positions.slice(0, 3)], [-0.5, -0.5, 0.5], 'Subtract double-precision world origin before converting to float32 meters');
assert.deepEqual(worldToThree([100, 200, 300]), [1, 3, -2], 'UE X/Z/-Y axis conversion');
assert.deepEqual(worldToThree([100, 200, 300], [50, 100, 200]), [0.5, 1, -1]);
assert.equal(worldLocation({ location: { X: 1, Y: 2 } }), null, 'Do not invent marker height');
assert.equal(worldToThree([1, NaN, 3]), null);
assert.deepEqual(boundsOf(mesh.vertices), { min: [10000000, 20000000, 300], max: [10000100, 20000100, 400] });
assert.deepEqual(centerOfBounds(boundsOf(mesh.vertices)), prepared.origin);
const indexed = prepareTerrainGeometry({ ...mesh, indices: [0, 2, 1, 0, 3, 2], polygons: undefined });
assert.deepEqual([...indexed.indices], [0, 2, 1, 0, 3, 2], 'Preserve native index order and zBand draw-range offsets');
const flat = { ...mesh, vertices: undefined, positionsXYZ: new Float64Array(mesh.vertices.flat()), indices: new Uint32Array([0, 2, 1, 0, 3, 2]) };
const transferred = prepareTerrainGeometry(flat);
assert.deepEqual(transferred.positions, indexed.positions, 'Worker Float64 input preserves large-world precision and axes');
assert.equal(transferred.indices, flat.indices, 'Transferred index storage is not duplicated');
assert.equal(terrainVertexCount(flat), 4);
const reusedVertex = [0, 0, 0];
assert.equal(terrainVertexAt(flat, 2, reusedVertex), reusedVertex);
assert.deepEqual(reusedVertex, mesh.vertices[2]);
assert.deepEqual(terrainBounds(flat), prepared.bounds);
assert.equal(terrainVertexAt(flat, 4), null);
assert.throws(() => prepareTerrainGeometry({ ...flat, positionsXYZ: new Float64Array([0, NaN, 0, 1, 2, 3, 4, 5, 6]) }), /vertices/);
assert(prepareTerrainGeometry({ ...mesh, indices: [0, 1, 2] }).indices instanceof Uint16Array, 'Small plain-array meshes use compact GPU indices');
assert.throws(() => prepareTerrainGeometry({ ...mesh, indices: [0, 1, 99] }), /index out of range/);
assert.throws(() => prepareTerrainGeometry({ ...mesh, unit: 'm' }), /format/);
assert.throws(() => triangulatePolygons([[0, 1, 4]], 4), /polygon/);
assert.deepEqual([...triangulatePolygons([[0, 1, 2, 0]], 3)], [0, 1, 2]);
const skirts = boundarySkirts(prepared.positions, prepared.indices, 0.4);
assert.equal(skirts.length, 4 * 6 * 3, 'Only four true polygon boundary edges get decorative thickness');
assert.equal(boundarySkirts(prepared.positions, prepared.indices, 0).length, 0);
const point = { id: 'upper', location: { X: 10000050, Y: 20000050, Z: 20350 } };
assert.deepEqual(markerPosition(point, prepared.origin, 60), [0, 200.6, 0], 'Markers retain their own floor height plus a small display lift');
assert(!inHeightRange(point, 0, 1000)); assert(inHeightRange(point, 20350, 20350), 'Height boundaries are inclusive original world centimeters');
const focus = { min: [0, 0, -1000], max: [1000, 1000, 500] };
assert.deepEqual(terrainViewBounds(mesh, [point], focus), focus, 'Explicit camera focus does not depend on shared-world bounds');
assert.deepEqual(terrainViewBounds(mesh, [point]), boundsOf([point]));
assert.deepEqual(terrainViewBounds(flat, []), prepared.bounds, 'Flat worker geometry supports fallback framing');
const selectedPose = cameraPoseAtTarget([1000, 2000, 3000], [0, 0, 0], [-200, 500, 100]);
assert.deepEqual(selectedPose, { position: [800, 2500, 3100], target: [-200, 500, 100] });
assert.equal(Math.hypot(...selectedPose.position.map((value,index) => value-selectedPose.target[index])), Math.hypot(1000,2000,3000), 'Selecting a marker preserves camera distance instead of jumping to a huge zoom');
const explicitFocus = cameraPoseAtTarget([1000,2000,3000],[0,0,0],[1,2,3],50);
assert(Math.abs(Math.hypot(...explicitFocus.position.map((value,index)=>value-explicitFocus.target[index]))-50)<1e-10, 'Only explicit focus changes zoom');
assert.deepEqual(mesh.polygons, [[0, 1, 2, 3]], 'Source geometry is not mutated');
const clipped = clipSurfaceHeight([[0, 0, 0], [100, 0, 100], [0, 100, 100]], 25, 75);
assert.equal(clipped.length, 4);
assert(clipped.every(([x, y, z]) => z >= 25 && z <= 75 && Math.abs(x + y - z) < 1e-8), 'Height clipping intersects the existing slope, without generating a new floor');
assert.equal(clipSurfaceHeight([[0, 0, 0], [100, 0, 0], [0, 100, 0]], 10, 20).length, 0);
class TestPath { moveTo() {} lineTo() {} closePath() {} }
const context = { save() {}, restore() {}, setTransform() {}, clearRect() {}, fill() {}, stroke() {} };
const canvas = { width: 760, height: 590, ownerDocument: { defaultView: { Path2D: TestPath } }, getContext: () => context };
const project = point => ({ x: point.location.X / 100, y: -point.location.Y / 100 });
const outline = { format: 2, bounds: { min: [0, 0], max: [100, 100] }, layers: [
  { id: 'ground', bandId: 'z0', minZ: 300, maxZ: 400, polygons: [[[[0,0],[100,0],[100,100],[0,100]],[[20,20],[20,30],[30,30],[30,20]]]] },
  { id: 'upper', bandId: 'z1', minZ: 1000, maxZ: 1100, polygons: [[[[0,0],[100,0],[100,100],[0,100]]]] },
] };
assert.equal(drawTerrain2D(canvas, outline, project).drawnLayers, 2);
assert.equal(drawTerrain2D(canvas, outline, project).cacheHit, true, 'Unchanged world projection reuses the Path2D');
assert.equal(drawTerrain2D(canvas, outline, project, { heightRange: [500, 600] }).drawnLayers, 0);
assert.equal(drawTerrain2D(canvas, outline, project, { bandId: 'z1' }).drawnLayers, 1);
assert.equal(drawTerrain2D(canvas, outline, () => null).available, false, 'Never substitute world XY under a game-UV projection');
const fallback = await createTerrainView(null);
assert.equal(fallback.available, false); assert.equal(fallback.setData(mesh, []), false); fallback.reset(); fallback.dispose();
const unsupported = await createTerrainView({ ownerDocument: { documentElement: { lang: 'en' }, createElement: () => ({ getContext: () => null }) } });
assert.equal(unsupported.available, false, 'Missing WebGL2 leaves a safe 2D fallback');
assert.equal(unsupported.getInfo(), null);

// Exercise real Three scene/geometry/control classes with a counting renderer.
// Happy DOM is an emulation: no browser process, WebGL, shader, or GPU is started.
const previousWindow = globalThis.window, previousDocument = globalThis.document;
const dom = new Window({ url: 'http://localhost/' });
globalThis.window = dom; globalThis.document = dom.document;
Object.defineProperty(dom, 'devicePixelRatio', { value: 3 });
const queued = new Map(); let nextFrame = 0;
dom.requestAnimationFrame = callback => { const id = ++nextFrame; queued.set(id, callback); return id; };
dom.cancelAnimationFrame = id => queued.delete(id);
dom.ResizeObserver = class { observe() {} disconnect() {} };
let contextOptions;
dom.HTMLCanvasElement.prototype.getContext = (type, options) => { contextOptions = options; return type === 'webgl2' ? { getExtension: () => null } : null; };
const rendererState = { sizes: [], draws: 0, listsCleared: 0 };
globalThis.__terrainRendererState = rendererState;
const threeURL = new URL('../public/vendor/three/three.module.min.js', import.meta.url).href;
const stub = `export * from ${JSON.stringify(threeURL)};
export class WebGLRenderer {
 constructor(options){this.domElement=options.canvas;this.state=globalThis.__terrainRendererState;this.state.options=options;this.renderLists={dispose:()=>this.state.listsCleared++};}
 setPixelRatio(value){this.state.pixelRatio=value;}
 setSize(width,height){this.state.sizes.push([width,height]);}
 render(scene,camera){scene.updateMatrixWorld();camera.updateMatrixWorld();this.state.draws++;this.state.scene=scene;}
 dispose(){this.state.disposed=true;}forceContextLoss(){this.state.contextLost=true;}
}`;
const stubURL = 'data:text/javascript;base64,' + Buffer.from(stub).toString('base64');
let moduleSource = await readFile(new URL('../public/js/terrain-view.js', import.meta.url), 'utf8');
moduleSource = moduleSource.replace(/from ['"]\.\/geometry-utils\.js(?:\?[^'"]*)?['"]/, `from ${JSON.stringify(new URL('../public/js/geometry-utils.js', import.meta.url).href)}`)
  .replace(/import\(['"]\.\.\/vendor\/three\/three\.module\.min\.js(?:\?[^'"]*)?['"]\)/, `import(${JSON.stringify(stubURL)})`)
  .replace(/import\(['"]\.\.\/vendor\/three\/OrbitControls\.js(?:\?[^'"]*)?['"]\)/, `import(${JSON.stringify(new URL('../public/vendor/three/OrbitControls.js', import.meta.url).href)})`);
const { createTerrainView: controlledView } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const host = dom.document.createElement('div'); dom.document.body.append(host);
host.getBoundingClientRect = () => ({ width: 760, height: 590 });
const view = await controlledView(host, { language: 'en' });
const frame = () => { const callbacks = [...queued.values()]; queued.clear(); for (const callback of callbacks) callback(0); };
assert(view.available);
assert.equal(contextOptions.antialias, false); assert.equal(rendererState.options.antialias, false);
assert.equal(rendererState.pixelRatio, 1.5, 'High-DPR screens do not multiply framebuffer memory without a cap');
const first = { id: 'first', mapId: 'one', name: 'First', location: { X: 10000050, Y: 20000050, Z: 350 } };
const second = { ...point, id: 'second', mapId: 'one', name: 'Second' };
const viewOptions = { mapId: 'one', focusBounds: { min: [10000000, 20000000, 0], max: [11000000, 21000000, 30000] }, heightRange: [-1000, 30000] };
assert(view.setData(flat, [first, second], viewOptions)); frame();
assert.equal(rendererState.scene.children.filter(node => node.isMesh).length, 1, 'No default boundary skirt or wireframe duplicate draw');
const firstButton = host.querySelector('[data-key="first"]');
const startingDistance = view.getInfo().cameraDistance;
assert(view.select('first')); frame();
assert(Math.abs(view.getInfo().cameraDistance - startingDistance) < 1e-6, 'Selecting a nearby marker preserves the existing zoom');
host.querySelector('[data-action="focus"]').click(); frame();
assert(view.getInfo().cameraDistance < startingDistance, 'Explicit Focus item provides deliberate close-up navigation');
host.querySelector('[data-action="orbit"]').click(); assert.equal(view.getInfo().interaction, 'orbit');
host.querySelector('[data-action="pan"]').click(); assert.equal(view.getInfo().interaction, 'pan');
assert(view.setData(flat, [{ ...first, status: 'done' }], { ...viewOptions, mapId: 'shared-subregion', focusBounds: { min: [10000000, 20000000, 0], max: [10100000, 20100000, 30000] } })); frame();
assert.equal(view.getInfo().geometryBuilds, 1, 'Shared-world focus/subregion changes do not rebuild GPU buffers');
assert.equal(host.querySelector('[data-key="first"]'), firstButton, 'Marker updates reuse keyed DOM buttons');
assert.equal(host.querySelector('[data-key="second"]'), null);
const retainedGeometry = rendererState.scene.children.find(node => node.isMesh).geometry;
assert.equal(retainedGeometry.getIndex().array, flat.indices);
let disposedGeometry = 0; retainedGeometry.addEventListener('dispose', () => disposedGeometry++);
view.setActive(false); assert.deepEqual(rendererState.sizes.at(-1), [1, 1]); assert.equal(queued.size, 0);
const pausedDraws = rendererState.draws; view.resize(); frame(); assert.equal(rendererState.draws, pausedDraws, 'Hidden views do not resize or render');
view.clearData(); assert.equal(view.getInfo(), null); assert.equal(host.querySelectorAll('.terrain-marker').length, 0); assert.equal(disposedGeometry, 1);
assert.equal(rendererState.scene.children.filter(node => node.isMesh).length, 0, 'Clear releases scene geometry and markers while keeping the renderer');
assert(rendererState.listsCleared > 0);
view.setActive(true); assert(view.setData(flat, [first], viewOptions)); frame();
assert.equal(view.getInfo().geometryBuilds, 2, 'A cleared view can load new data');
view.dispose(); assert(rendererState.disposed && rendererState.contextLost); assert.equal(host.childElementCount, 0); assert.equal(queued.size, 0);
await dom.happyDOM.close();
if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
delete globalThis.__terrainRendererState;
console.log('Terrain: typed geometry precision, camera controls, buffer/marker reuse, pause/clear lifecycle, and safe fallback passed (no browser/GPU)');
