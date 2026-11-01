// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { analyticsRequest, startAnalytics } from '../public/js/analytics.js';

const input = { hostname: 'game.kero.zone', protocol: 'https:', pathname: '/phantom-blade-zero/',
  referrer: 'https://search.example/results?q=PRIVATE_SEARCH#private', userAgent: 'Mozilla/5.0 Chrome/130.0' };
const target = new URL(analyticsRequest(input));
assert.deepEqual([...target.searchParams.keys()], ['p', 't', 'r']);
assert.equal(target.searchParams.get('p'), '/phantom-blade-zero/');
assert.equal(target.searchParams.get('r'), 'https://search.example');
assert(!target.href.includes('PRIVATE_SEARCH'));
for (const change of [{ hostname: 'localhost' }, { protocol: 'http:' }, { pathname: '/not-a-public-page/' },
  { webdriver: true }, { userAgent: 'Googlebot' }, { userAgent: 'HeadlessChrome' },
  { doNotTrack: true }, { globalPrivacyControl: true }, { excluded: true }]) {
  assert.equal(analyticsRequest({ ...input, ...change }), null);
}
for (const pathname of ['/', '/en/', '/phantom-blade-zero/', '/phantom-blade-zero/en/']) {
  assert.equal(new URL(analyticsRequest({ ...input, pathname })).searchParams.get('p'), pathname);
}
for (const referrer of ['', 'not a URL', 'file:///PRIVATE.sav', 'https://game.kero.zone/PRIVATE?save=PRIVATE']) {
  assert.equal(new URL(analyticsRequest({ ...input, referrer })).searchParams.has('r'), false);
}

const listeners = new Map(), requests = [];
const browser = { location: input, navigator: { userAgent: input.userAgent }, localStorage: { getItem: () => null },
  document: { visibilityState: 'visible', referrer: input.referrer,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); } },
  fetch(...args) { requests.push(args); return Promise.resolve(); } };
const stop = startAnalytics(browser);
assert.equal(requests.length, 0, 'Loading a page alone is not an interactive visit');
const listener = listeners.get('pointerdown');
listener({ isTrusted: false });
assert.equal(requests.length, 0, 'Scripted DOM interactions are not counted');
browser.document.visibilityState = 'hidden';
listener({ isTrusted: true });
assert.equal(requests.length, 0, 'Hidden-page activity is not counted');
browser.document.visibilityState = 'visible';
listener({ isTrusted: true });
listener({ isTrusted: true });
assert.equal(requests.length, 1, 'Only one interactive pageview is sent per page load');
assert.deepEqual(requests[0][1], { method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' });
assert.equal(listeners.size, 0);
stop();
assert.doesNotThrow(() => startAnalytics({ ...browser, fetch() { throw Error('offline'); } }));
console.log('PASS analytics: fixed public routes, interactive gate, bot/opt-out exclusions, no private payload');
