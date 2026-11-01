// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { createMapView } from '../public/js/map-view.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const point = (X, Y, u, v) => ({ location: { X, Y, Z: 0 }, ...(u === undefined ? {} : { mapPosition: { X: u, Y: v } }) });
const metadata = { mapProjection: { method: 'anchor-mesh', width: 4096, height: 2304 } };
const points = [point(0, 0, 0, 0), point(10000, 20000, 1, 1), point(5000, 10000, 0.5, 0.5)];

// UV coordinates have a top-left origin and retain the texture's landscape aspect.
const game = createMapView(points, metadata);
assert.equal(game.mode, 'game');
assert.deepEqual(game.frame, { x: 60, y: 115, width: 640, height: 360 });
assert.deepEqual(game.project(points[0]), { x: 60, y: 115 });
assert.deepEqual(game.project(points[1]), { x: 700, y: 475 });
assert.deepEqual(game.project(points[2]), { x: 380, y: 295 });
assert.equal(game.ticks.length, 10);
assert.deepEqual(game.ticks.filter((tick) => tick.axis === 'y').map((tick) => tick.label), ['0%', '25%', '50%', '75%', '100%']);

// Texture framing is independent of which categories or points are currently shown.
assert.deepEqual(createMapView([points[2]], metadata).project(points[2]), game.project(points[2]));
assert.deepEqual(createMapView([points[2]], metadata).frame, game.frame);
const portrait = createMapView(points, { mapProjection: { method: 'anchor-mesh', width: 1000, height: 2000 } });
close(portrait.frame.width / portrait.frame.height, 0.5);
close(portrait.frame.height, 475);
close(portrait.project(points[2]).x, 380);
close(portrait.project(points[2]).y, 295);

// A failed mesh hit is omitted rather than mixing native world XY into a UV view.
const uncalibrated = point(1234, 5678);
const partial = createMapView([...points, uncalibrated], metadata);
assert.equal(partial.mode, 'game');
assert.equal(partial.project(uncalibrated), null);
assert.equal(partial.project({ mapPosition: { X: NaN, Y: 0 } }), null);
assert.equal(partial.project({ X: 0, Y: 0 }), null);
assert.equal(partial.project(null), null);
assert.deepEqual(partial.project(points[2]), game.project(points[2]));
assert.ok(partial.project(point(0, 0, 1.1, 0.5)).x > partial.frame.x + partial.frame.width);

// Unknown metadata or zero calibrated points falls back to one uniform world XY view.
const worldPoints = [point(-1000, -2000, 0.9, 0.1), point(1000, 2000, 0.1, 0.9), point(0, 0, 0.5, 0.5)];
for (const unknown of [undefined, {}, { mapProjection: { ...metadata.mapProjection, method: 'unknown' } },
  { mapProjection: { ...metadata.mapProjection, width: 0 } }]) {
  const view = createMapView(worldPoints, unknown);
  assert.equal(view.mode, 'world');
  assert.deepEqual(view.project(worldPoints[2]), { x: 380, y: 295 });
  assert.ok(view.project(worldPoints[1]).x > view.project(worldPoints[0]).x);
  assert.ok(view.project(worldPoints[1]).y < view.project(worldPoints[0]).y);
  close((view.project(worldPoints[1]).x - 380) / 1000, (295 - view.project(worldPoints[1]).y) / 2000);
  assert.equal(view.project({ location: { X: Infinity, Y: 0 } }), null);
  assert.equal(view.project({ location: { X: 0, Y: 0, Z: NaN } }), null);
  assert.equal(view.project({ X: 0, Y: 0 }), null);
}
assert.equal(createMapView([uncalibrated], metadata).mode, 'world');
assert.equal(createMapView(points, metadata, { mode: 'world' }).mode, 'world');

// The caller can pin world bounds, so filtering cannot silently rescale that view.
const worldMetadata = { worldBounds: { minX: -1000, maxX: 1000, minY: -2000, maxY: 2000 } };
const whole = createMapView(worldPoints, worldMetadata);
const filtered = createMapView([worldPoints[1]], worldMetadata);
assert.deepEqual(filtered.frame, whole.frame);
assert.deepEqual(filtered.project(worldPoints[1]), whole.project(worldPoints[1]));
const custom = createMapView(points, metadata, { width: 1000, height: 700 });
assert.deepEqual(custom.project(points[2]), { x: 500, y: 350 });
const empty = createMapView([], metadata);
assert.equal(empty.mode, 'world');
assert.ok(Object.values(empty.frame).every(Number.isFinite));

console.log('map-view: projection direction, aspect, partial hits, fallback and stable bounds passed');
