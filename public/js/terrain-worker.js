// SPDX-License-Identifier: GPL-3.0-or-later
import { decodeTerrainAsset } from './terrain-format.js';
self.onmessage = async event => {
  try {
    const { url, asset } = event.data;
    const target = new URL(url);
    if (target.origin !== self.location.origin) throw Error('Invalid asset origin');
    const response = await fetch(target, { cache: 'force-cache' });
    if (!response.ok) throw Error('Terrain unavailable');
    const geometry = await decodeTerrainAsset(await response.arrayBuffer(), asset, '3d');
    self.postMessage({ ok: true, geometry }, [geometry.positionsXYZ.buffer, geometry.indices.buffer]);
  } catch { self.postMessage({ ok: false }); }
};
