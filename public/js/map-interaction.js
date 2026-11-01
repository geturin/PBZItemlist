// SPDX-License-Identifier: GPL-3.0-or-later
const CENTER = { x: 380, y: 295 };

export function toMapPoint(rect, clientX, clientY, width = 760, height = 590) {
  const scale = Math.min((rect.width || width) / width, (rect.height || height) / height);
  return { x: (clientX - (rect.left || 0) - ((rect.width || width) - width * scale) / 2) / scale,
    y: (clientY - (rect.top || 0) - ((rect.height || height) - height * scale) / 2) / scale };
}

export function zoomAt(view, point, factor, { minZoom = .25, maxZoom = 32 } = {}) {
  const zoom = Math.max(minZoom, Math.min(maxZoom, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return { zoom, panX: point.x - CENTER.x - (point.x - CENTER.x - view.panX) * ratio,
    panY: point.y - CENTER.y - (point.y - CENTER.y - view.panY) * ratio };
}

export function panFromClient(view, start, current, rect) {
  const a = toMapPoint(rect, start.clientX, start.clientY), b = toMapPoint(rect, current.clientX, current.clientY);
  return { ...view, panX: view.panX + b.x - a.x, panY: view.panY + b.y - a.y };
}

export function bindMapInteractions(stage, svg, { getView, onChange, onStart = () => {}, isEnabled = () => true }) {
  const pointers = new Map();
  let drag = null, pinch = null, moved = false;
  const rect = () => svg.getBoundingClientRect();
  const snapshot = () => { const v = getView(); return { zoom: v.zoom, panX: v.panX, panY: v.panY }; };
  const control = event => event.target?.closest?.('.map-zoom,button,input,select');
  const stop = event => { event.preventDefault(); event.stopPropagation(); };
  const wheel = event => {
    if (!isEnabled()) return;
    stop(event); onStart();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (rect().height || 590) : 1);
    onChange(zoomAt(snapshot(), toMapPoint(rect(), event.clientX, event.clientY), Math.exp(-Math.max(-500, Math.min(500, delta)) * .002)));
  };
  const begin = event => {
    if (!pointers.size) moved = false;
    if (!isEnabled() || control(event) || event.button > 0) return;
    if (event.pointerType !== 'touch' && event.target?.closest?.('.map-marker,.bell-map-marker')) return;
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    moved = false; onStart();
    try { svg.setPointerCapture(event.pointerId); } catch { /* Capture is optional in DOM emulators. */ }
    if (pointers.size === 1) drag = { view: snapshot(), start: pointers.get(event.pointerId) };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { view: snapshot(), distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        center: toMapPoint(rect(), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) };
    }
  };
  const move = event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (pointers.size >= 2 && pinch) {
      stop(event); moved = true;
      const [a, b] = [...pointers.values()], center = toMapPoint(rect(), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      const next = zoomAt(pinch.view, pinch.center, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.distance);
      next.panX += center.x - pinch.center.x; next.panY += center.y - pinch.center.y; onChange(next);
    } else if (drag) {
      const current = pointers.get(event.pointerId);
      if (Math.hypot(current.clientX - drag.start.clientX, current.clientY - drag.start.clientY) > 3) moved = true;
      if (moved) { stop(event); onChange(panFromClient(drag.view, drag.start, current, rect())); }
    }
  };
  const end = event => {
    pointers.delete(event.pointerId); pinch = null;
    if (event.type === 'pointercancel') moved = false;
    if (pointers.size === 1) drag = { view: snapshot(), start: [...pointers.values()][0] };
    else drag = null;
  };
  const click = event => { if (moved && !control(event)) { stop(event); moved = false; } };
  const doubleClick = event => {
    if (!isEnabled() || control(event)) return;
    stop(event); onChange(zoomAt(snapshot(), toMapPoint(rect(), event.clientX, event.clientY), 2));
  };
  stage.addEventListener('wheel', wheel, { capture: true, passive: false });
  stage.addEventListener('pointerdown', begin);
  stage.addEventListener('pointermove', move, { passive: false });
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('click', click, true); stage.addEventListener('dblclick', doubleClick);
  return () => {
    stage.removeEventListener('wheel', wheel, true); stage.removeEventListener('pointerdown', begin);
    stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', end);
    stage.removeEventListener('pointercancel', end); stage.removeEventListener('click', click, true); stage.removeEventListener('dblclick', doubleClick);
  };
}
