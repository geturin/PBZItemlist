// SPDX-License-Identifier: GPL-3.0-or-later
// Optional Three.js view of real cooked navigation surfaces. No pathfinding.
import { boundsOf, centerOfBounds, validBounds, worldLocation, worldToThree, prepareTerrainGeometry, boundarySkirts, markerPosition, inHeightRange, pointKey, terrainViewBounds } from './geometry-utils.js';

const fallback = reason => ({ available: false, reason, setData: () => false, select: () => false, reset() {}, setHeightRange: () => false, setBand: () => false, getHeightRange: () => null, getInfo: () => null, resize() {}, dispose() {} });

/**
 * Lazy WebGL2 initialization. A failure resolves to a harmless unavailable view.
 * setData(mesh, points, {focusBounds?, heightRange?, bandId?}) accepts UE XYZ cm.
 * Height ranges are original UE Z centimeters, never Three.js meters.
 */
export async function createTerrainView(container, options = {}) {
  const document = container?.ownerDocument;
  if (!document) return fallback('invalid-container');
  const window = document.defaultView;
  const english = /^en(?:-|$)/i.test(options.language ?? document.documentElement.lang);
  const L = (zh, en) => english ? en : zh;
  const report = code => { try { options.onError?.({ code }); } catch { /* Host UI errors do not change save handling. */ } };
  const canvas = document.createElement('canvas');
  let context;
  try { context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'low-power' }); } catch { /* 2D remains usable. */ }
  if (!context) { report('webgl-unavailable'); return fallback('webgl-unavailable'); }
  let THREE, OrbitControls, renderer;
  try {
    [THREE, { OrbitControls }] = await Promise.all([import('../vendor/three/three.module.min.js'), import('../vendor/three/OrbitControls.js')]);
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
  } catch {
    context.getExtension('WEBGL_lose_context')?.loseContext();
    report('webgl-unavailable'); return fallback('webgl-unavailable');
  }
  let disposed = false, available = true, frame = 0, width = 1, height = 1;
  let currentMesh = null, currentScope = '', currentMapId = null, prepared = null, focusBounds = null;
  let points = [], markers = [], selected = '', minZ = -Infinity, maxZ = Infinity;
  let surface = null, walls = null, wire = null, radius = 100;
  const host = document.createElement('div'); host.className = 'terrain-view';
  Object.assign(host.style, { position: 'relative', width: '100%', height: '100%', minHeight: '280px', overflow: 'hidden', background: '#081725' });
  host.setAttribute('role', 'region'); host.setAttribute('aria-label', L('三维通行面与收集点', '3D navigation surfaces and collectible locations'));
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', L('拖动旋转，滚轮缩放，右键平移，Home复位', 'Drag to orbit, scroll to zoom, right-drag to pan, Home to reset'));
  host.append(canvas);
  const markerLayer = document.createElement('div'); markerLayer.className = 'terrain-markers';
  Object.assign(markerLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' }); host.append(markerLayer);
  const tooltip = document.createElement('div'); tooltip.className = 'terrain-tooltip'; tooltip.hidden = true;
  Object.assign(tooltip.style, { position: 'absolute', zIndex: '300', pointerEvents: 'none', background: '#101c2b', border: '1px solid #8ec8ff', padding: '7px 10px', borderRadius: '5px', color: '#f1f7ff', maxWidth: '260px', fontSize: '13px', whiteSpace: 'pre-line' });
  tooltip.setAttribute('role', 'tooltip'); host.append(tooltip); container.append(host);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#081725');
  scene.add(new THREE.HemisphereLight('#d4edff', '#15253b', 2.2));
  const light = new THREE.DirectionalLight('#d4eaff', 2.5); light.position.set(200, 400, 150); scene.add(light);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.minPolarAngle = 0.05; controls.maxPolarAngle = Math.PI * 0.49;
  controls.listenToKeyEvents?.(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;

  function requestRender() {
    if (!disposed && available && !frame) frame = window.requestAnimationFrame(renderFrame);
  }
  function renderFrame() {
    frame = 0;
    if (disposed || !available) return;
    try { controls.update(); renderer.render(scene, camera); }
    catch { available = false; host.hidden = true; report('webgl-render-failed'); return; }
    for (const marker of markers) {
      const visible = inHeightRange(marker.point, minZ, maxZ);
      const viewPoint = marker.position.clone().applyMatrix4(camera.matrixWorldInverse);
      const projected = marker.position.clone().project(camera);
      marker.button.hidden = !visible || viewPoint.z >= 0 || projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1;
      marker.button.style.display = marker.button.hidden ? 'none' : 'grid';
      if (!marker.button.hidden) {
        marker.x = (projected.x * 0.5 + 0.5) * width; marker.y = (-projected.y * 0.5 + 0.5) * height;
        marker.button.style.transform = `translate(${marker.x - 16}px,${marker.y - 16}px)`;
      }
    }
  }
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => { tooltip.hidden = true; });

  function disposeSurfaces() {
    const geometries = new Set(), materials = new Set();
    for (const mesh of [surface, walls, wire]) if (mesh) { scene.remove(mesh); geometries.add(mesh.geometry); materials.add(mesh.material); }
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    surface = walls = wire = null;
  }
  function updateClipping() {
    if (!prepared) return;
    const planes = [];
    if (Number.isFinite(minZ)) planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(minZ - prepared.origin[2]) / 100));
    if (Number.isFinite(maxZ)) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), (maxZ - prepared.origin[2]) / 100));
    for (const mesh of [surface, walls, wire]) if (mesh) {
      const changed = mesh.material.clippingPlanes?.length !== planes.length;
      mesh.material.clippingPlanes = planes;
      if (changed) mesh.material.needsUpdate = true;
    }
    tooltip.hidden = true; requestRender();
  }
  function setHeightRange(min = -Infinity, max = Infinity) {
    if (disposed || typeof min !== 'number' || typeof max !== 'number' || Number.isNaN(min) || Number.isNaN(max) || min > max) return false;
    minZ = min; maxZ = max;
    if (surface) surface.geometry.setDrawRange(0, prepared.indices.length);
    for (const marker of markers) if (!inHeightRange(marker.point, minZ, maxZ)) { marker.button.hidden = true; marker.button.style.display = 'none'; }
    updateClipping();
    options.onHeightRangeChange?.([minZ, maxZ]); return true;
  }
  function resize() {
    if (disposed) return;
    const box = container.getBoundingClientRect(); width = Math.max(1, box.width || container.clientWidth || 760); height = Math.max(1, box.height || container.clientHeight || 590);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); requestRender();
  }
  function reset() {
    if (!prepared || !focusBounds || disposed) return;
    const middle = worldToThree(centerOfBounds(focusBounds), prepared.origin);
    const spans = focusBounds.max.map((value, axis) => (value - focusBounds.min[axis]) / 100);
    radius = Math.max(15, Math.hypot(...spans) / 2);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.15 / Math.min(1, camera.aspect);
    controls.target.fromArray(middle);
    camera.position.copy(controls.target).add(new THREE.Vector3(1, 0.95, 1.1).normalize().multiplyScalar(distance));
    camera.near = Math.max(0.05, distance / 100000); camera.far = Math.max(50000, distance * 30); camera.updateProjectionMatrix();
    controls.minDistance = 1; controls.maxDistance = Math.max(2000, distance * 8);
    controls.update(); requestRender();
  }
  function paintMarkers() {
    for (const marker of markers) {
      const active = marker.key === selected;
      marker.button.setAttribute('aria-pressed', String(active)); marker.button.style.zIndex = active ? '200' : '10';
      marker.dot.style.background = active ? '#f8d780' : marker.point.status === 'done' ? '#70b897' : marker.point.status === 'unknown' ? '#d3b86a' : '#5db9ff';
      marker.dot.style.borderColor = active ? '#fff7da' : '#e3f2ff'; marker.dot.style.boxShadow = active ? '0 0 0 5px #ffe9a52e,0 0 14px #ffe9a588' : '0 1px 6px #000b';
      marker.dot.style.transform = active ? 'scale(1.2)' : 'none';
    }
  }
  function showTooltip(marker) {
    tooltip.textContent = marker.button.title; tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(marker.x + 12, width - 270))}px`; tooltip.style.top = `${Math.max(8, marker.y - 46)}px`;
  }
  function updateMarkers(nextPoints) {
    markerLayer.replaceChildren(); markers = []; points = Array.isArray(nextPoints) ? nextPoints : [];
    for (const point of points) {
      const position = markerPosition(point, prepared.origin, options.markerLiftCm ?? 60), key = pointKey(point);
      if (!position || !key) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'terrain-marker'; button.dataset.key = key;
      const name = String(point.name ?? point.nameZh ?? point.id ?? key);
      button.title = name + (point.nameZh && point.nameZh !== name ? `\n${point.nameZh}` : ''); button.setAttribute('aria-label', button.title);
      Object.assign(button.style, { position: 'absolute', left: '0', top: '0', width: '32px', height: '32px', display: 'grid', placeItems: 'center', padding: '0', margin: '0', border: '0', background: 'transparent', pointerEvents: 'auto', cursor: 'pointer' });
      const dot = document.createElement('span'); dot.textContent = point.category === 'bell' ? (english ? 'B' : '铃') : '•'; dot.setAttribute('aria-hidden', 'true');
      Object.assign(dot.style, { display: 'grid', placeItems: 'center', width: '19px', height: '19px', border: '2px solid', borderRadius: point.category === 'bell' ? '50%' : '5px', color: '#081725', font: 'bold 11px system-ui' });
      button.append(dot); markerLayer.append(button);
      const marker = { point, key, button, dot, position: new THREE.Vector3().fromArray(position), x: 0, y: 0 }; markers.push(marker);
      button.addEventListener('click', event => { event.stopPropagation(); select(key); options.onSelect?.(key); });
      button.addEventListener('pointerenter', () => showTooltip(marker)); button.addEventListener('pointerleave', () => { tooltip.hidden = true; });
      button.addEventListener('focus', () => showTooltip(marker)); button.addEventListener('blur', () => { tooltip.hidden = true; });
    }
    paintMarkers(); requestRender();
  }
  function select(key) {
    selected = String(key ?? ''); paintMarkers();
    const marker = markers.find(item => item.key === selected);
    if (!marker || !prepared) { requestRender(); return false; }
    if (!inHeightRange(marker.point, minZ, maxZ)) { const z = worldLocation(marker.point)[2]; setHeightRange(z - 1500, z + 1500); }
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target), 25, Math.max(60, Math.min(radius * 0.4, 250)));
    controls.target.copy(marker.position); camera.position.copy(marker.position).add(direction.multiplyScalar(distance));
    controls.update(); requestRender(); return true;
  }
  function setBand(id) {
    if (!surface || !currentMesh) return false;
    const band = currentMesh.zBands?.find(item => String(item.id) === String(id));
    if (!band || !Number.isInteger(band.firstIndex) || !Number.isInteger(band.indexCount) || band.firstIndex < 0 || band.indexCount <= 0 || band.firstIndex % 3 || band.indexCount % 3 || band.firstIndex + band.indexCount > prepared.indices.length) return false;
    if (validBounds(band.bounds)) setHeightRange(band.bounds.min[2] - 100, band.bounds.max[2] + 100);
    surface.geometry.setDrawRange(band.firstIndex, band.indexCount);
    requestRender(); return true;
  }
  function setData(mesh, nextPoints = [], view = {}) {
    if (disposed || !available) return false;
    const mapId = view.mapId ?? mesh?.mapId ?? nextPoints[0]?.mapId ?? (mesh === currentMesh ? currentMapId : null);
    const scope = JSON.stringify([view.focusBounds ?? null, mapId]);
    if (mesh === currentMesh && scope === currentScope && prepared) { updateMarkers(nextPoints); return true; }
    let converted, bounds;
    try {
      bounds = terrainViewBounds(mesh, nextPoints, view.focusBounds);
      converted = prepareTerrainGeometry(mesh, { origin: centerOfBounds(bounds) });
    } catch { report('invalid-navigation-data'); return false; }
    disposeSurfaces(); prepared = converted; focusBounds = bounds; currentMesh = mesh; currentScope = scope; currentMapId = mapId;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(prepared.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(prepared.indices, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const colors = new Float32Array(prepared.positions.length), low = new THREE.Color('#215b8a'), high = new THREE.Color('#8fcfff');
    const heightSpan = Math.max(1, bounds.max[2] - bounds.min[2]);
    for (let index = 0; index < mesh.vertices.length; index++) { const color = low.clone().lerp(high, THREE.MathUtils.clamp((mesh.vertices[index][2] - bounds.min[2]) / heightSpan, 0, 1)); colors.set([color.r, color.g, color.b], index * 3); }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })); scene.add(surface);
    wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#b4dcff', wireframe: true, transparent: true, opacity: 0.13, depthWrite: false })); scene.add(wire);
    const skirt = boundarySkirts(prepared.positions, prepared.indices, options.thicknessMeters ?? 0.4);
    if (skirt.length) { const wallGeometry = new THREE.BufferGeometry(); wallGeometry.setAttribute('position', new THREE.BufferAttribute(skirt, 3)); wallGeometry.computeVertexNormals(); walls = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: '#143c5d', roughness: 1, flatShading: true, side: THREE.DoubleSide })); scene.add(walls); }
    const initialRange = view.heightRange ?? mesh.defaultHeightRange ?? [bounds.min[2] - 1500, bounds.max[2] + 1500];
    setHeightRange(initialRange[0], initialRange[1]);
    if (view.bandId != null || mesh.defaultBandId != null) setBand(view.bandId ?? mesh.defaultBandId);
    if (view.heightRange) setHeightRange(view.heightRange[0], view.heightRange[1]);
    updateMarkers(nextPoints); resize(); reset(); return true;
  }
  const onKey = event => { if (event.key === 'Home') { event.preventDefault(); reset(); } };
  canvas.addEventListener('keydown', onKey);
  const onContextLost = event => { event.preventDefault(); available = false; host.hidden = true; if (frame) window.cancelAnimationFrame(frame); frame = 0; report('webgl-context-lost'); };
  canvas.addEventListener('webglcontextlost', onContextLost);
  const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
  observer?.observe(container); window.addEventListener('resize', resize);
  function dispose() {
    if (disposed) return; disposed = true; available = false;
    if (frame) window.cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', resize);
    canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('webglcontextlost', onContextLost);
    controls.dispose(); disposeSurfaces(); renderer.dispose(); renderer.forceContextLoss(); host.remove(); markers = []; points = [];
  }
  resize();
  return { get available() { return available && !disposed; }, setData, select, reset, setHeightRange, setBand, getHeightRange: () => [minZ, maxZ], getInfo: () => prepared ? { vertices: prepared.vertexCount, triangles: prepared.triangleCount, markers: markers.length, origin: [...prepared.origin] } : null, resize, dispose };
}
