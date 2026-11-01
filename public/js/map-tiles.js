// SPDX-License-Identifier: GPL-3.0-or-later
const NS = 'http://www.w3.org/2000/svg';
const manifestURL = new URL('../data/map-images-hi/manifest.json', import.meta.url);
let manifestPromise;
export function visibleTiles(image, frame, view, { pixelRatio = 1, scale = 1, bounds = { minX: 0, minY: 0, maxX: 760, maxY: 590 } } = {}) {
  const demand = frame.width * view.zoom * scale * Math.min(2, pixelRatio);
  if (demand <= 1024) return [];
  const level = image.levels.find(entry => entry.width >= demand) ?? image.levels.at(-1);
  if (!level) return [];
  const inverseX = x => (x - 380 - view.panX) / view.zoom + 380;
  const inverseY = y => (y - 295 - view.panY) / view.zoom + 295;
  const tile = image.tileSize || 512;
  const left = Math.max(0, Math.floor((inverseX(bounds.minX) - frame.x) / frame.width * level.width / tile) - 1);
  const right = Math.min(level.cols - 1, Math.floor((inverseX(bounds.maxX) - frame.x) / frame.width * level.width / tile) + 1);
  const top = Math.max(0, Math.floor((inverseY(bounds.minY) - frame.y) / frame.height * level.height / tile) - 1);
  const bottom = Math.min(level.rows - 1, Math.floor((inverseY(bounds.maxY) - frame.y) / frame.height * level.height / tile) + 1);
  const result = [];
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) result.push({ key: `${level.id}:${x}:${y}`,
    file: level.urlTemplate.replace('{x}', x).replace('{y}', y),
    x: frame.x + x * tile / level.width * frame.width, y: frame.y + y * tile / level.height * frame.height,
    width: Math.min(tile, level.width - x * tile) / level.width * frame.width,
    height: Math.min(tile, level.height - y * tile) / level.height * frame.height });
  // Overscan can exceed the budget on unusually wide screens: prioritize center.
  const cx = (inverseX((bounds.minX + bounds.maxX) / 2)), cy = inverseY((bounds.minY + bounds.maxY) / 2);
  return result.sort((a, b) => (a.x + a.width / 2 - cx) ** 2 + (a.y + a.height / 2 - cy) ** 2 - ((b.x + b.width / 2 - cx) ** 2 + (b.y + b.height / 2 - cy) ** 2)).slice(0, 36);
}

export function createMapTileLayer(document, mapId, frame) {
  const node = document.createElementNS(NS, 'g'); node.classList.add('map-hires-tiles'); node.setAttribute('pointer-events', 'none');
  const tiles = new Map(); let disposed = false, generation = 0;
  async function update(view, options) {
    const token = ++generation;
    if (frame.width * view.zoom * (options?.scale ?? 1) * Math.min(2, options?.pixelRatio ?? 1) <= 1024) {
      tiles.clear(); node.replaceChildren(); return;
    }
    if (!manifestPromise) manifestPromise = fetch(manifestURL, { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw Error('Map detail unavailable'); return response.json();
    }).catch(error => { manifestPromise = null; throw error; });
    try {
      const manifest = await manifestPromise;
      if (disposed || token !== generation) return;
      const image = manifest.images[manifest.maps[mapId]?.image];
      if (!image) return;
      const visible = visibleTiles(image, frame, view, options), keys = new Set(visible.map(tile => tile.key));
      for (const [key, tile] of tiles) if (!keys.has(key)) { tile.remove(); tiles.delete(key); }
      for (const tile of visible) if (!tiles.has(tile.key)) {
        const imageNode = document.createElementNS(NS, 'image'); imageNode.setAttribute('preserveAspectRatio', 'none');
        for (const key of ['x', 'y', 'width', 'height']) imageNode.setAttribute(key, tile[key]);
        const url = new URL(tile.file, manifestURL);
        if (url.origin !== manifestURL.origin || !url.pathname.startsWith(new URL('.', manifestURL).pathname)) continue;
        imageNode.setAttribute('href', url.href); node.append(imageNode); tiles.set(tile.key, imageNode);
        imageNode.addEventListener('error', () => { imageNode.remove(); if (tiles.get(tile.key) === imageNode) tiles.delete(tile.key); });
      }
    } catch { /* The small preview remains available if detail cannot load. */ }
  }
  return { node, update, dispose() { disposed = true; ++generation; node.replaceChildren(); tiles.clear(); } };
}
