// SPDX-License-Identifier: GPL-3.0-or-later

const isNumber = Number.isFinite;
const hasUV = (point) => isNumber(point?.mapPosition?.X) && isNumber(point?.mapPosition?.Y);
const hasWorldPosition = (point) => isNumber(point?.location?.X) && isNumber(point?.location?.Y)
  && (point.location.Z === undefined || isNumber(point.location.Z));

function worldBounds(points, supplied) {
  if (supplied && ['minX', 'maxX', 'minY', 'maxY'].every((key) => isNumber(supplied[key]))
      && supplied.minX <= supplied.maxX && supplied.minY <= supplied.maxY) return supplied;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!hasWorldPosition(point)) continue;
    minX = Math.min(minX, point.location.X);
    maxX = Math.max(maxX, point.location.X);
    minY = Math.min(minY, point.location.Y);
    maxY = Math.max(maxY, point.location.Y);
  }
  return isNumber(minX) ? { minX, maxX, minY, maxY } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

/**
 * Build once from every point in the selected map, then project any filtered subset.
 * Game coordinates use a fixed texture frame. Missing UVs stay unplotted in that mode.
 * options.mode='world' forces the independent world XY view; worldBounds can pin its bounds.
 */
export function createMapView(points, mapMetadata, options = {}) {
  points = Array.isArray(points) ? points : [];
  const width = isNumber(options.width) && options.width > 0 ? options.width : 760;
  const height = isNumber(options.height) && options.height > 0 ? options.height : 590;
  const availableWidth = Math.max(1, width - 120);
  const availableHeight = Math.max(1, height - 115);
  const centerX = width / 2, centerY = height / 2;
  const metadata = mapMetadata?.mapProjection;
  const game = options.mode !== 'world' && metadata?.method === 'anchor-mesh'
    && isNumber(metadata.width) && metadata.width > 0
    && isNumber(metadata.height) && metadata.height > 0 && points.some(hasUV);
  let frame, project, tickValue;

  if (game) {
    const scale = Math.min(availableWidth / metadata.width, availableHeight / metadata.height);
    frame = { x: centerX - metadata.width * scale / 2, y: centerY - metadata.height * scale / 2,
      width: metadata.width * scale, height: metadata.height * scale };
    project = (point) => hasUV(point) ? {
      x: frame.x + point.mapPosition.X * frame.width,
      y: frame.y + point.mapPosition.Y * frame.height,
    } : null;
    tickValue = (fraction) => `${fraction * 100}%`;
  } else {
    const bounds = worldBounds(points, mapMetadata?.worldBounds);
    const middleX = (bounds.minX + bounds.maxX) / 2;
    const middleY = (bounds.minY + bounds.maxY) / 2;
    const rangeX = Math.max(bounds.maxX - bounds.minX, 1000);
    const rangeY = Math.max(bounds.maxY - bounds.minY, 1000);
    const scale = Math.min(availableWidth / rangeX, availableHeight / rangeY);
    frame = { x: centerX - rangeX * scale / 2, y: centerY - rangeY * scale / 2,
      width: rangeX * scale, height: rangeY * scale };
    project = (point) => hasWorldPosition(point) ? {
      x: centerX + (point.location.X - middleX) * scale,
      y: centerY - (point.location.Y - middleY) * scale,
    } : null;
    tickValue = (fraction, axis) => String(Math.round(axis === 'x'
      ? middleX + (fraction - 0.5) * rangeX : middleY + (0.5 - fraction) * rangeY));
  }

  const ticks = [];
  for (let index = 0; index <= 4; index += 1) {
    const fraction = index / 4;
    ticks.push({ x: frame.x + fraction * frame.width, y: height - 19, label: tickValue(fraction, 'x'), axis: 'x' });
    ticks.push({ x: 11, y: frame.y + fraction * frame.height + 3, label: tickValue(fraction, 'y'), axis: 'y' });
  }
  return { mode: game ? 'game' : 'world', project, ticks, frame };
}
