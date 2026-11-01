// SPDX-License-Identifier: GPL-3.0-or-later
// Pure viewport math; no browser layout or GPU is involved.
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { toMapPoint, zoomAt, panFromClient, bindMapInteractions } from '../public/js/map-interaction.js';
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
const project = (view, world) => ({ x: 380 + view.panX + (world.x - 380) * view.zoom, y: 295 + view.panY + (world.y - 295) * view.zoom });
const worldAt = (view, point) => ({ x: 380 + (point.x - 380 - view.panX) / view.zoom, y: 295 + (point.y - 295 - view.panY) / view.zoom });

const exact = { left: 20, top: 40, width: 760, height: 590 };
assert.deepEqual(toMapPoint(exact, 20, 40), { x: 0, y: 0 });
assert.deepEqual(toMapPoint(exact, 780, 630), { x: 760, y: 590 });
const wide = { left: 10, top: 20, width: 1000, height: 500 };
const wideScale = 500 / 590, wideInset = (1000 - 760 * wideScale) / 2;
const widePoint = toMapPoint(wide, 10 + wideInset + 100 * wideScale, 20 + 120 * wideScale);
close(widePoint.x, 100, 'Wide viewport horizontal letterbox'); close(widePoint.y, 120, 'Wide viewport uniform scale');
const tall = { left: 30, top: 50, width: 380, height: 800 };
const tallPoint = toMapPoint(tall, 80, 50 + (800 - 590 * .5) / 2 + 120 * .5);
close(tallPoint.x, 100, 'Tall viewport uniform scale'); close(tallPoint.y, 120, 'Tall viewport vertical letterbox');
assert.deepEqual(toMapPoint(wide, 510, 270), { x: 380, y: 295 });
const custom = toMapPoint({ left: 0, top: 0, width: 1000, height: 1000 }, 500, 500, 200, 100);
close(custom.x, 100, 'Custom viewBox center X'); close(custom.y, 50, 'Custom viewBox center Y');

for (const view of [{ zoom: 1, panX: 0, panY: 0 }, { zoom: 3, panX: -147.25, panY: 63.5 }]) {
  for (const point of [{ x: 100, y: 75 }, { x: 380, y: 295 }, { x: 725, y: 555 }]) {
    for (const factor of [.3, 1.25, 4, 1000]) {
      const original = { ...view }, anchor = worldAt(view, point), next = zoomAt(view, point, factor), screen = project(next, anchor);
      close(screen.x, point.x, 'Cursor world point remains fixed horizontally'); close(screen.y, point.y, 'Cursor world point remains fixed vertically');
      assert(next.zoom >= .25 && next.zoom <= 32); assert.deepEqual(view, original, 'Zoom must not mutate the previous gesture state');
    }
  }
}
for (const [zoom, factor] of [[.25, .5], [32, 2]]) {
  const view = { zoom, panX: 91.25, panY: -17.5 };
  assert.deepEqual(zoomAt(view, { x: 10, y: 510 }, factor), view, 'At a zoom limit the map must not drift sideways');
}
const bounded = zoomAt({ zoom: 2, panX: 0, panY: 0 }, { x: 380, y: 295 }, 100, { minZoom: .5, maxZoom: 8 });
assert.equal(bounded.zoom, 8);

// The gesture uses initial client positions; root's binder supplies clientX/Y.
const initial = { zoom: 3, panX: 10, panY: -20 };
const pan = panFromClient(initial, { clientX: 200, clientY: 180 }, { clientX: 200 + 100 * wideScale, clientY: 180 + 50 * wideScale }, wide);
close(pan.panX, 110, 'Horizontal drag uses SVG meet scale'); close(pan.panY, 30, 'Vertical drag uses the same SVG meet scale');
assert.equal(pan.zoom, 3, 'Panning preserves zoom');
assert.deepEqual(initial, { zoom: 3, panX: 10, panY: -20 });

const window = new Window({ url: 'http://127.0.0.1/' });
const stage = window.document.createElement('div'), svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
const marker = window.document.createElementNS(svg.namespaceURI, 'g'); marker.classList.add('map-marker');
const button = window.document.createElement('button');
stage.append(svg, button); svg.append(marker); window.document.body.append(stage);
svg.getBoundingClientRect = () => wide;
const captured = new Set();
svg.setPointerCapture = id => captured.add(id); svg.releasePointerCapture = id => captured.delete(id);
let view = { zoom: 1, panX: 0, panY: 0 }, changes = 0, enabled = true;
const dispose = bindMapInteractions(stage, svg, { getView: () => view, onChange: next => { view = next; changes++; }, isEnabled: () => enabled });
const pointer = (type, id, x, y, pointerType = 'mouse', target = svg) => {
  const event = new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType, button: 0, clientX: x, clientY: y });
  target.dispatchEvent(event); return event;
};
const scroll = (target, deltaY, options = {}) => {
  const event = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 210, deltaY, ...options });
  // Happy DOM's WheelEvent omits MouseEvent coordinates; browsers provide them.
  Object.defineProperties(event, { clientX: { value: 300 }, clientY: { value: 210 } });
  target.dispatchEvent(event); return event;
};
const cursor = toMapPoint(wide, 300, 210);
for (const target of [svg, marker, button]) {
  const anchor = worldAt(view, cursor), event = scroll(target, -120), after = project(view, anchor);
  assert(event.defaultPrevented, 'Wheel must stay inside the map even over marker or controls');
  close(after.x, cursor.x, 'DOM wheel cursor anchor X'); close(after.y, cursor.y, 'DOM wheel cursor anchor Y');
}
for (const [zoom, deltaY] of [[32, -120], [.25, 120]]) {
  view = { zoom, panX: 30, panY: -40 }; const before = { ...view };
  assert(scroll(marker, deltaY).defaultPrevented, 'Wheel at a map zoom limit must not scroll the page');
  assert.deepEqual(view, before);
}
view = { zoom: 1, panX: 0, panY: 0 };
pointer('pointerdown', 1, 300, 200);
assert(captured.has(1));
assert(pointer('pointermove', 1, 300 + 100 * wideScale, 200 + 50 * wideScale).defaultPrevented);
pointer('pointerup', 1, 300 + 100 * wideScale, 200 + 50 * wideScale);
close(view.panX, 100, 'DOM drag exact horizontal scale'); close(view.panY, 50, 'DOM drag exact vertical scale');
const afterDragClick = new window.MouseEvent('click', { bubbles: true, cancelable: true }); svg.dispatchEvent(afterDragClick);
assert(afterDragClick.defaultPrevented, 'A drag must not accidentally select an item');

view = { zoom: 1, panX: 0, panY: 0 };
const pinchCenter = toMapPoint(wide, 300, 250), pinchAnchor = worldAt(view, pinchCenter);
pointer('pointerdown', 10, 200, 250, 'touch'); pointer('pointerdown', 11, 400, 250, 'touch');
pointer('pointermove', 10, 150, 250, 'touch'); pointer('pointermove', 11, 450, 250, 'touch');
close(view.zoom, 1.5, 'Two fingers control pinch distance');
const afterPinch = project(view, pinchAnchor); close(afterPinch.x, pinchCenter.x, 'Pinch center anchor X'); close(afterPinch.y, pinchCenter.y, 'Pinch center anchor Y');
pointer('pointerup', 10, 150, 250, 'touch'); const afterLift = { ...view };
pointer('pointermove', 11, 450 + 20 * wideScale, 250, 'touch');
close(view.panX, afterLift.panX + 20, 'Remaining finger continues panning without a jump');
pointer('pointerup', 11, 450 + 20 * wideScale, 250, 'touch');
// Consume the compatibility click after that completed gesture.
svg.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

pointer('pointerdown', 20, 200, 200); pointer('pointermove', 20, 250, 220); pointer('pointercancel', 20, 250, 220);
pointer('pointerdown', 21, 250, 220, 'mouse', marker); pointer('pointerup', 21, 250, 220, 'mouse', marker);
const afterCancelledGesture = new window.MouseEvent('click', { bubbles: true, cancelable: true }); marker.dispatchEvent(afterCancelledGesture);
assert(!afterCancelledGesture.defaultPrevented, 'A cancelled gesture must not swallow the next deliberate marker click');

view = { zoom: 1, panX: 0, panY: 0 }; scroll(svg, -3, { deltaMode: 1 }); const lineZoom = view.zoom;
view = { zoom: 1, panX: 0, panY: 0 }; scroll(svg, -48); close(view.zoom, lineZoom, 'Line wheel deltas normalize to pixels');
enabled = false; const beforeDisabled = changes;
assert(!scroll(svg, -120).defaultPrevented); assert.equal(changes, beforeDisabled);
enabled = true; dispose(); const beforeDispose = changes;
assert(!scroll(marker, -120).defaultPrevented); assert.equal(changes, beforeDispose);
await window.happyDOM.close();
console.log('PASS map interaction: exact letterbox/anchored zoom, contained wheel, drag, pinch, limits and disposal (DOM emulation)');
