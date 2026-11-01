// SPDX-License-Identifier: GPL-3.0-or-later
// Optional, on-demand low-poly navigation view. No pathfinding.
import { centerOfBounds, validBounds, worldLocation, worldToThree, prepareTerrainGeometry, boundarySkirts, markerPosition, pointKey, terrainViewBounds, cameraPoseAtTarget } from './geometry-utils.js';

const fallback = reason => ({ available: false, reason, setData: () => false, select: () => false, reset() {}, focusSelection: () => false, setHeightRange: () => false, setBand: () => false, getHeightRange: () => null, getInfo: () => null, setActive() {}, clearData() {}, resize() {}, dispose() {} });

/**
 * setData(mesh, points, {focusBounds?, heightRange?, bandId?, mapId?}) uses UE cm.
 * Worker-transferred positionsXYZ/indices and legacy nested vertices are accepted.
 * Call setActive(false) and clearData() when leaving 3D to release large resources.
 */
export async function createTerrainView(container, options = {}) {
  const document = container?.ownerDocument;
  if (!document) return fallback('invalid-container');
  const window = document.defaultView;
  const english = /^en(?:-|$)/i.test(options.language ?? document.documentElement.lang);
  const L = (zh, en) => english ? en : zh;
  const report = code => { try { options.onError?.({ code }); } catch { /* Keep save handling independent. */ } };
  const canvas = document.createElement('canvas');
  let context;
  try { context = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' }); } catch { /* Keep 2D usable. */ }
  if (!context) { report('webgl-unavailable'); return fallback('webgl-unavailable'); }
  let THREE, OrbitControls, renderer;
  try {
    [THREE, { OrbitControls }] = await Promise.all([import('../vendor/three/three.module.min.js'), import('../vendor/three/OrbitControls.js')]);
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
  } catch {
    context.getExtension('WEBGL_lose_context')?.loseContext();
    report('webgl-unavailable'); return fallback('webgl-unavailable');
  }
  let disposed = false, available = true, active = options.active !== false, frame = 0;
  let width = 0, height = 0, radius = 100, geometryBuilds = 0;
  let currentMesh = null, currentScope = '', currentMapId = null, prepared = null, focusBounds = null;
  let selected = '', minZ = -Infinity, maxZ = Infinity, interaction = 'pan';
  let surface = null, walls = null, wire = null;
  const markers = new Map();
  const host = document.createElement('div'); host.className = 'terrain-view';
  Object.assign(host.style, { position: 'relative', width: '100%', height: '100%', minHeight: '280px', overflow: 'hidden', background: '#081725' });
  host.setAttribute('role', 'region'); host.setAttribute('aria-label', L('三维通行面与收集点', '3D navigation surfaces and collectible locations'));
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' }); canvas.tabIndex = 0;
  host.append(canvas);
  const markerLayer = document.createElement('div'); markerLayer.className = 'terrain-markers';
  Object.assign(markerLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' }); host.append(markerLayer);
  const tooltip = document.createElement('div'); tooltip.className = 'terrain-tooltip'; tooltip.hidden = true;
  Object.assign(tooltip.style, { position: 'absolute', zIndex: '300', pointerEvents: 'none', background: '#101c2b', border: '1px solid #8ec8ff', padding: '7px 10px', borderRadius: '5px', color: '#f1f7ff', maxWidth: '260px', fontSize: '13px', whiteSpace: 'pre-line' });
  tooltip.setAttribute('role', 'tooltip'); host.append(tooltip);
  const toolbar = document.createElement('div'); toolbar.className = 'terrain-controls'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', L('三维地图操作', '3D map controls'));
  Object.assign(toolbar.style, { position: 'absolute', right: '8px', top: '8px', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '4px', maxWidth: 'calc(100% - 16px)', zIndex: '350' });
  host.append(toolbar); container.append(host);
  const buttons = new Map();
  function button(id, label, action, title = label) {
    const node = document.createElement('button'); node.type = 'button'; node.dataset.action = id; node.textContent = label; node.title = title; node.setAttribute('aria-label', title);
    Object.assign(node.style, { minWidth: '34px', minHeight: '34px', padding: '4px 8px', background: '#10293aef', border: '1px solid #426987', borderRadius: '4px', color: '#e5f3ff', font: '12px system-ui', cursor: 'pointer' });
    node.addEventListener('click', action); toolbar.append(node); buttons.set(id, node); return node;
  }
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#081725');
  scene.add(new THREE.HemisphereLight('#d4edff', '#15253b', 2.2));
  const light = new THREE.DirectionalLight('#d4eaff', 2.5); light.position.set(200, 400, 150); scene.add(light);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
  const controls = new OrbitControls(camera, canvas);
  // Direct, event-driven controls avoid an idle animation/damping loop.
  controls.enableDamping = false; controls.enabled = active;
  controls.minPolarAngle = 0.05; controls.maxPolarAngle = Math.PI * 0.49;
  controls.listenToKeyEvents?.(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.localClippingEnabled = true;
  const projectedPoint = new THREE.Vector3(), cameraPoint = new THREE.Vector3(), offset = new THREE.Vector3();
  function setInteraction(mode) {
    interaction = mode;
    controls.mouseButtons.LEFT = mode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = mode === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = mode === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.touches.TWO = mode === 'pan' ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;
    for (const id of ['pan', 'orbit']) { const node = buttons.get(id); node.setAttribute('aria-pressed', String(id === mode)); node.style.background = id === mode ? '#296188' : '#10293aef'; }
    canvas.setAttribute('aria-label', mode === 'pan' ? L('拖动平移，右键旋转，双指或滚轮缩放，Home复位', 'Drag to pan, right-drag to orbit, pinch or scroll to zoom, Home to reset') : L('拖动旋转，右键平移，双指或滚轮缩放，Home复位', 'Drag to orbit, right-drag to pan, pinch or scroll to zoom, Home to reset'));
  }
  button('pan', L('平移', 'Pan'), () => setInteraction('pan'));
  button('orbit', L('旋转', 'Orbit'), () => setInteraction('orbit'));
  button('zoom-in', '+', () => zoom(0.8), L('放大', 'Zoom in'));
  button('zoom-out', '−', () => zoom(1.25), L('缩小', 'Zoom out'));
  button('reset', L('复位', 'Reset'), reset);
  button('focus', L('靠近选中', 'Focus item'), focusSelection);
  setInteraction('pan');
  function updateButtons() { for (const [id, node] of buttons) node.disabled = !active || (id === 'focus' ? !markers.has(selected) : !prepared); }
  function requestRender() { if (!disposed && available && active && !frame) frame = window.requestAnimationFrame(renderFrame); }
  function renderFrame() {
    frame = 0;
    if (disposed || !available || !active) return;
    try { controls.update(); renderer.render(scene, camera); }
    catch { available = false; host.hidden = true; report('webgl-render-failed'); return; }
    for (const marker of markers.values()) {
      let hidden = marker.z < minZ || marker.z > maxZ;
      if (!hidden) {
        cameraPoint.copy(marker.position).applyMatrix4(camera.matrixWorldInverse); projectedPoint.copy(marker.position).project(camera);
        hidden = cameraPoint.z >= 0 || projectedPoint.z < -1 || projectedPoint.z > 1 || Math.abs(projectedPoint.x) > 1.1 || Math.abs(projectedPoint.y) > 1.1;
      }
      if (marker.hidden !== hidden) { marker.hidden = hidden; marker.button.hidden = hidden; marker.button.style.display = hidden ? 'none' : 'grid'; }
      if (!hidden) {
        const x = (projectedPoint.x * 0.5 + 0.5) * width, y = (-projectedPoint.y * 0.5 + 0.5) * height;
        if (Math.abs(x - marker.x) > 0.2 || Math.abs(y - marker.y) > 0.2) { marker.x = x; marker.y = y; marker.button.style.transform = `translate(${(x - 16).toFixed(1)}px,${(y - 16).toFixed(1)}px)`; }
      }
    }
  }
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => { tooltip.hidden = true; });
  function disposeSurfaces() {
    const geometries = new Set(), materials = new Set();
    for (const mesh of [surface, walls, wire]) if (mesh) { scene.remove(mesh); geometries.add(mesh.geometry); materials.add(mesh.material); }
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    surface = walls = wire = null; renderer.renderLists.dispose();
  }
  function updateDrawRange() {
    if (!surface) return;
    const bands = currentMesh.zBands?.length ? currentMesh.zBands.filter(band => band.bounds.max[2] >= minZ - 100 && band.bounds.min[2] <= maxZ + 100) : null;
    const band = bands?.length === 1 ? bands[0] : null;
    if (band && Number.isInteger(band.firstIndex) && Number.isInteger(band.indexCount) && band.firstIndex >= 0 && band.indexCount > 0 && band.firstIndex + band.indexCount <= prepared.indices.length) surface.geometry.setDrawRange(band.firstIndex, band.indexCount);
    else surface.geometry.setDrawRange(0, bands?.length === 0 ? 0 : prepared.indices.length);
  }
  function updateClipping() {
    if (!prepared) return;
    const planes = [];
    if (Number.isFinite(minZ)) planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(minZ - prepared.origin[2]) / 100));
    if (Number.isFinite(maxZ)) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), (maxZ - prepared.origin[2]) / 100));
    for (const mesh of [surface, walls, wire]) if (mesh) { const changed = mesh.material.clippingPlanes?.length !== planes.length; mesh.material.clippingPlanes = planes; if (changed) mesh.material.needsUpdate = true; }
    tooltip.hidden = true; updateDrawRange(); requestRender();
  }
  function setHeightRange(min = -Infinity, max = Infinity) {
    if (disposed || typeof min !== 'number' || typeof max !== 'number' || Number.isNaN(min) || Number.isNaN(max) || min > max) return false;
    if (minZ === min && maxZ === max) return true;
    minZ = min; maxZ = max;
    for (const marker of markers.values()) if (marker.z < min || marker.z > max) { marker.hidden = true; marker.button.hidden = true; marker.button.style.display = 'none'; }
    updateClipping(); options.onHeightRangeChange?.([minZ, maxZ]); return true;
  }
  function resize() {
    if (disposed || !active) return;
    const box = container.getBoundingClientRect(), nextWidth = Math.max(1, box.width || container.clientWidth || 760), nextHeight = Math.max(1, box.height || container.clientHeight || 590);
    if (width === nextWidth && height === nextHeight) return;
    width = nextWidth; height = nextHeight; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); requestRender();
  }
  function reset() {
    if (!prepared || !focusBounds || disposed) return;
    const middle = worldToThree(centerOfBounds(focusBounds), prepared.origin), spans = focusBounds.max.map((value, axis) => (value - focusBounds.min[axis]) / 100);
    radius = Math.max(15, Math.hypot(...spans) / 2);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.15 / Math.min(1, camera.aspect);
    controls.target.fromArray(middle); camera.position.copy(controls.target).add(offset.set(1, 0.95, 1.1).normalize().multiplyScalar(distance));
    camera.near = Math.max(0.05, distance / 100000); camera.far = Math.max(50000, distance * 30); camera.updateProjectionMatrix();
    controls.minDistance = 1; controls.maxDistance = Math.max(2000, distance * 8); controls.update(); requestRender();
  }
  function zoom(factor) {
    if (!prepared) return;
    offset.copy(camera.position).sub(controls.target); const current = offset.length();
    if (!current) return;
    offset.multiplyScalar(THREE.MathUtils.clamp(current * factor, controls.minDistance, controls.maxDistance) / current);
    camera.position.copy(controls.target).add(offset); controls.update(); requestRender();
  }
  function paintMarker(marker) {
    const isSelected = marker.key === selected, signature = `${isSelected}:${marker.point.status}:${marker.point.category}`;
    if (signature === marker.paint) return;
    marker.paint = signature; marker.button.setAttribute('aria-pressed', String(isSelected)); marker.button.style.zIndex = isSelected ? '200' : '10';
    marker.dot.style.background = isSelected ? '#f8d780' : marker.point.status === 'done' ? '#70b897' : marker.point.status === 'unknown' ? '#d3b86a' : '#5db9ff';
    marker.dot.style.borderColor = isSelected ? '#fff7da' : '#e3f2ff'; marker.dot.style.boxShadow = isSelected ? '0 0 0 4px #ffe9a52e' : '0 1px 5px #000b'; marker.dot.style.transform = isSelected ? 'scale(1.15)' : 'none';
    marker.dot.textContent = marker.point.category === 'bell' ? (english ? 'B' : '铃') : '•'; marker.dot.style.borderRadius = marker.point.category === 'bell' ? '50%' : '5px';
  }
  function showTooltip(marker) {
    tooltip.textContent = marker.button.title; tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(marker.x + 12, width - 270))}px`; tooltip.style.top = `${Math.max(8, marker.y - 46)}px`;
  }
  function updateMarkers(nextPoints) {
    const seen = new Set();
    for (const point of Array.isArray(nextPoints) ? nextPoints : []) {
      const position = markerPosition(point, prepared.origin, options.markerLiftCm ?? 60), xyz = worldLocation(point), key = pointKey(point);
      if (!position || !xyz || !key || seen.has(key)) continue;
      seen.add(key); let marker = markers.get(key);
      if (!marker) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'terrain-marker'; button.dataset.key = key;
        Object.assign(button.style, { position: 'absolute', left: '0', top: '0', width: '32px', height: '32px', display: 'none', placeItems: 'center', padding: '0', margin: '0', border: '0', background: 'transparent', pointerEvents: 'auto', cursor: 'pointer' });
        const dot = document.createElement('span'); dot.setAttribute('aria-hidden', 'true');
        Object.assign(dot.style, { display: 'grid', placeItems: 'center', width: '19px', height: '19px', border: '2px solid', color: '#081725', font: 'bold 11px system-ui' });
        button.append(dot); markerLayer.append(button);
        marker = { point, key, button, dot, position: new THREE.Vector3(), z: xyz[2], x: Infinity, y: Infinity, hidden: true }; markers.set(key, marker);
        button.addEventListener('click', event => { event.stopPropagation(); select(key); options.onSelect?.(key); });
        button.addEventListener('pointerenter', () => showTooltip(marker)); button.addEventListener('pointerleave', () => { tooltip.hidden = true; });
        button.addEventListener('focus', () => showTooltip(marker)); button.addEventListener('blur', () => { tooltip.hidden = true; });
      }
      marker.point = point; marker.z = xyz[2]; marker.position.fromArray(position);
      const name = String(point.name ?? point.nameZh ?? point.id ?? key), title = name + (point.nameZh && point.nameZh !== name ? `\n${point.nameZh}` : '');
      if (marker.button.title !== title) { marker.button.title = title; marker.button.setAttribute('aria-label', title); }
      paintMarker(marker);
    }
    for (const [key, marker] of markers) if (!seen.has(key)) { marker.button.remove(); markers.delete(key); }
    tooltip.hidden = true; updateButtons(); requestRender();
  }
  function moveToMarker(marker, distance) {
    if (!marker || !prepared) return false;
    if (marker.z < minZ || marker.z > maxZ) setHeightRange(marker.z - 1500, marker.z + 1500);
    const pose = cameraPoseAtTarget(camera.position.toArray(), controls.target.toArray(), marker.position.toArray(), distance);
    camera.position.fromArray(pose.position); controls.target.fromArray(pose.target); controls.update(); requestRender(); return true;
  }
  function select(key) {
    const previous = markers.get(selected); selected = String(key ?? '');
    if (previous) paintMarker(previous); const marker = markers.get(selected); if (marker) paintMarker(marker);
    updateButtons(); return moveToMarker(marker);
  }
  function focusSelection() { return moveToMarker(markers.get(selected), Math.max(30, Math.min(radius * 0.12, 200))); }
  function setBand(id) {
    const band = currentMesh?.zBands?.find(item => String(item.id) === String(id));
    if (!band || !validBounds(band.bounds)) return false;
    return setHeightRange(band.bounds.min[2] - 100, band.bounds.max[2] + 100);
  }
  function setData(mesh, nextPoints = [], view = {}) {
    if (disposed || !available) return false;
    const mapId = view.mapId ?? mesh?.mapId ?? nextPoints[0]?.mapId ?? (mesh === currentMesh ? currentMapId : null);
    let bounds;
    try { bounds = terrainViewBounds(mesh, nextPoints, view.focusBounds); if (!validBounds(bounds)) return false; } catch { report('invalid-navigation-data'); return false; }
    const scope = JSON.stringify([bounds, mapId]), changedScope = scope !== currentScope;
    if (mesh !== currentMesh || !prepared) {
      let converted;
      try { converted = prepareTerrainGeometry(mesh, { origin: centerOfBounds(bounds) }); } catch { report('invalid-navigation-data'); return false; }
      disposeSurfaces(); prepared = converted; currentMesh = mesh; geometryBuilds++;
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(prepared.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(prepared.indices, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const colors = new Float32Array(prepared.positions.length), low = new THREE.Color('#215b8a'), high = new THREE.Color('#8fcfff');
      const span = Math.max(1, (bounds.max[2] - bounds.min[2]) / 100), base = (bounds.min[2] - prepared.origin[2]) / 100;
      const dr = high.r - low.r, dg = high.g - low.g, db = high.b - low.b;
      for (let index = 0; index < colors.length; index += 3) { const t = Math.max(0, Math.min(1, (prepared.positions[index + 1] - base) / span)); colors[index] = low.r + dr * t; colors[index + 1] = low.g + dg * t; colors[index + 2] = low.b + db * t; }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, side: THREE.DoubleSide })); scene.add(surface);
      // Expensive decorative edge maps and a second wireframe draw are opt-in.
      if (options.wireframe === true) { wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#b4dcff', wireframe: true, transparent: true, opacity: 0.1, depthWrite: false })); scene.add(wire); }
      if (Number.isFinite(options.thicknessMeters) && options.thicknessMeters > 0) { const skirt = boundarySkirts(prepared.positions, prepared.indices, options.thicknessMeters); if (skirt.length) { const wallGeometry = new THREE.BufferGeometry(); wallGeometry.setAttribute('position', new THREE.BufferAttribute(skirt, 3)); wallGeometry.computeVertexNormals(); walls = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: '#143c5d', roughness: 1, flatShading: true, side: THREE.DoubleSide })); scene.add(walls); } }
    }
    focusBounds = bounds; currentScope = scope; currentMapId = mapId;
    const range = view.heightRange ?? mesh.defaultHeightRange;
    if (range) setHeightRange(range[0], range[1]);
    else if (!setBand(view.bandId ?? mesh.defaultBandId)) setHeightRange(bounds.min[2] - 1500, bounds.max[2] + 1500);
    updateClipping(); updateMarkers(nextPoints); resize(); if (changedScope) reset(); return true;
  }
  function clearData() {
    disposeSurfaces(); markerLayer.replaceChildren(); markers.clear(); currentMesh = prepared = focusBounds = null;
    currentScope = ''; currentMapId = null; selected = ''; minZ = -Infinity; maxZ = Infinity; tooltip.hidden = true; updateButtons(); requestRender();
  }
  function setActive(value) {
    if (disposed) return; active = Boolean(value); controls.enabled = active; tooltip.hidden = true;
    if (!active) { if (frame) window.cancelAnimationFrame(frame); frame = 0; renderer.setSize(1, 1, false); width = height = 0; }
    else { resize(); requestRender(); }
    updateButtons();
  }
  const onKey = event => { if (event.key === 'Home') { event.preventDefault(); reset(); } };
  canvas.addEventListener('keydown', onKey);
  const onContextLost = event => { event.preventDefault(); available = false; host.hidden = true; if (frame) window.cancelAnimationFrame(frame); frame = 0; report('webgl-context-lost'); };
  canvas.addEventListener('webglcontextlost', onContextLost);
  const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null; observer?.observe(container); window.addEventListener('resize', resize);
  function dispose() {
    if (disposed) return; setActive(false); clearData(); disposed = true; available = false;
    observer?.disconnect(); window.removeEventListener('resize', resize); canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('webglcontextlost', onContextLost);
    controls.dispose(); renderer.dispose(); renderer.forceContextLoss(); host.remove();
  }
  updateButtons(); if (active) resize(); else renderer.setSize(1, 1, false);
  return { get available() { return available && !disposed; }, setData, select, reset, focusSelection, setHeightRange, setBand, getHeightRange: () => [minZ, maxZ], setActive, clearData, resize, dispose,
    getInfo: () => prepared ? { vertices: prepared.vertexCount, triangles: prepared.triangleCount, markers: markers.size, origin: [...prepared.origin], geometryBuilds, active, interaction, cameraDistance: camera.position.distanceTo(controls.target), target: controls.target.toArray() } : null };
}
