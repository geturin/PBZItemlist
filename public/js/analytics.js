// SPDX-License-Identifier: GPL-3.0-or-later
// Count an interactive page visit, never a save, search, filter or application event.
const PAGES = Object.freeze({
  '/': 'Game Collection Checkers',
  '/en/': 'Game Collection Checkers · English',
  '/phantom-blade-zero/': 'Phantom Blade Zero Checker · 中文',
  '/phantom-blade-zero/en/': 'Phantom Blade Zero Checker · English',
});
const BOT = /bot\b|crawler|spider|headless|lighthouse|pagespeed|prerender|preview|slurp|phantomjs|selenium|puppeteer|playwright/i;
const EXCLUDE_KEY = 'game.analytics.exclude';

export function analyticsRequest({ hostname, protocol, pathname, referrer = '', userAgent = '', webdriver = false,
  doNotTrack = false, globalPrivacyControl = false, excluded = false }) {
  if (hostname !== 'game.kero.zone' || protocol !== 'https:' || webdriver || BOT.test(userAgent)
      || doNotTrack || globalPrivacyControl || excluded || !Object.hasOwn(PAGES, pathname)) return null;
  const params = new URLSearchParams({ p: pathname, t: PAGES[pathname] });
  try {
    const source = new URL(referrer);
    if (['http:', 'https:'].includes(source.protocol) && source.hostname !== hostname) params.set('r', source.origin);
  } catch { /* Empty or invalid referrers are omitted. */ }
  return `https://game.kero.zone/stats/count?${params}`;
}

export function startAnalytics(window) {
  const { document, navigator, location } = window;
  let excluded = false;
  try { excluded = window.localStorage.getItem(EXCLUDE_KEY) === '1'; } catch { /* Storage is optional. */ }
  const target = analyticsRequest({ hostname: location.hostname, protocol: location.protocol, pathname: location.pathname,
    referrer: document.referrer, userAgent: navigator.userAgent, webdriver: navigator.webdriver,
    doNotTrack: navigator.doNotTrack === '1', globalPrivacyControl: navigator.globalPrivacyControl === true, excluded });
  if (!target) return () => {};
  let sent = false;
  const events = ['pointerdown', 'keydown'];
  const stop = () => events.forEach(type => document.removeEventListener(type, visit, true));
  const visit = event => {
    if (sent || !event.isTrusted || document.visibilityState !== 'visible') return;
    sent = true;
    stop();
    // GoatCounter 2.7 decodes its query parameters even for POST; no body is sent.
    // No referrer header, cookies, screen dimensions or full source URL are sent.
    try { Promise.resolve(window.fetch(target, { method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' })).catch(() => {}); }
    catch { /* Analytics must never interrupt the checker or navigation. */ }
  };
  events.forEach(type => document.addEventListener(type, visit, { capture: true, passive: true }));
  return stop;
}

if (typeof window !== 'undefined' && window.document) startAnalytics(window);
