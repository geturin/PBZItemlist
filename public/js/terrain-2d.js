// SPDX-License-Identifier: GPL-3.0-or-later
// Native SVG floor contours remain sharp at every zoom level.
const NS = 'http://www.w3.org/2000/svg';
export function createTerrain2DLayer(document, geometry, project, { heightRange = [-Infinity, Infinity], bandId } = {}) {
  if (geometry?.format !== 2 || !Array.isArray(geometry.layers)) throw Error('Invalid floor outlines');
  const group = document.createElementNS(NS, 'g'); group.setAttribute('class', 'terrain-vector-layer'); group.setAttribute('pointer-events', 'none');
  const origin = geometry.bounds.min;
  const probe = (x, y) => project({ location: { X: x, Y: y, Z: 0 } });
  const base = probe(origin[0], origin[1]), east = probe(origin[0] + 100, origin[1]), north = probe(origin[0], origin[1] + 100);
  if (!base || !east || !north) throw Error('World projection required');
  const xx = (east.x - base.x) / 100, xy = (east.y - base.y) / 100;
  const yx = (north.x - base.x) / 100, yy = (north.y - base.y) / 100;
  for (const layer of geometry.layers) {
    if (bandId && layer.bandId !== bandId || layer.maxZ < heightRange[0] || layer.minZ > heightRange[1]) continue;
    const commands = [];
    for (const polygon of layer.polygons) for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0] - origin[0], y = ring[i][1] - origin[1];
        commands.push(`${i ? 'L' : 'M'}${(base.x + x * xx + y * yx).toFixed(3)} ${(base.y + x * xy + y * yy).toFixed(3)}`);
      }
      commands.push('Z');
    }
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', commands.join(''));
    path.setAttribute('fill', '#5199c6'); path.setAttribute('fill-opacity', '.38'); path.setAttribute('fill-rule', 'evenodd');
    path.dataset.layer = layer.id ?? `${layer.bandId}:${layer.minZ}`; group.append(path);
  }
  return group;
}
