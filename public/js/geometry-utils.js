// SPDX-License-Identifier: GPL-3.0-or-later
// Pure conversion of cooked navigation surfaces. No route or terrain inference.

export function worldLocation(value) {
  const location = value?.location ?? value;
  const xyz = Array.isArray(location) ? location : [location?.X, location?.Y, location?.Z];
  return xyz.length >= 3 && xyz.slice(0, 3).every(Number.isFinite) ? xyz.slice(0, 3) : null;
}

export function worldToThree(value, origin = [0, 0, 0]) {
  const xyz = worldLocation(value);
  if (!xyz || !worldLocation(origin)) return null;
  return [(xyz[0] - origin[0]) / 100, (xyz[2] - origin[2]) / 100, -(xyz[1] - origin[1]) / 100 || 0];
}

export function boundsOf(values) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const value of values ?? []) {
    const xyz = worldLocation(value);
    if (!xyz) continue;
    count++;
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], xyz[axis]); max[axis] = Math.max(max[axis], xyz[axis]); }
  }
  return count ? { min, max } : null;
}

export function validBounds(bounds) {
  return Boolean(worldLocation(bounds?.min) && worldLocation(bounds?.max) && bounds.min.every((value, axis) => value <= bounds.max[axis]));
}

export function centerOfBounds(bounds) {
  if (!validBounds(bounds)) throw new Error('Invalid world bounds');
  return bounds.min.map((value, axis) => value + (bounds.max[axis] - value) / 2);
}

/** Detour ground polygons are convex; fan triangulation preserves their surface. */
export function triangulatePolygons(polygons, vertexCount) {
  if (!Array.isArray(polygons)) throw new Error('Navigation polygons are missing');
  const triangles = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(index => Number.isInteger(index) && index >= 0 && index < vertexCount)) throw new Error('Invalid navigation polygon');
    const ring = polygon[0] === polygon.at(-1) ? polygon.slice(0, -1) : polygon;
    if (ring.length < 3) throw new Error('Invalid navigation polygon');
    for (let index = 1; index < ring.length - 1; index++) triangles.push(ring[0], ring[index], ring[index + 1]);
  }
  return new Uint32Array(triangles);
}

/** Keeps indexed triangle order intact so native zBand draw ranges remain valid. */
export function prepareTerrainGeometry(mesh, options = {}) {
  if (mesh?.format !== 1 || mesh.unit !== 'cm' || mesh.coordinateSystem !== 'Unreal Z-up') throw new Error('Unsupported navigation geometry format');
  if (!Array.isArray(mesh.vertices) || mesh.vertices.length < 3 || !mesh.vertices.every(vertex => Array.isArray(vertex) && vertex.length === 3 && vertex.every(Number.isFinite))) throw new Error('Invalid navigation vertices');
  const bounds = boundsOf(mesh.vertices);
  const origin = options.origin ? worldLocation(options.origin) : centerOfBounds(bounds);
  if (!origin) throw new Error('Invalid geometry origin');
  let indices;
  if (mesh.indices != null) {
    if (!(Array.isArray(mesh.indices) || ArrayBuffer.isView(mesh.indices)) || mesh.indices.length % 3 || !mesh.indices.length) throw new Error('Invalid navigation triangle indices');
    if (!Array.from(mesh.indices).every(index => Number.isInteger(index) && index >= 0 && index < mesh.vertices.length)) throw new Error('Navigation index out of range');
    indices = new Uint32Array(mesh.indices);
  } else indices = triangulatePolygons(mesh.polygons, mesh.vertices.length);
  if (!indices.length) throw new Error('Navigation surface is empty');
  const positions = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((vertex, index) => positions.set(worldToThree(vertex, origin), index * 3));
  return { positions, indices, origin, bounds, vertexCount: mesh.vertices.length, triangleCount: indices.length / 3 };
}

/** Thin decorative skirts follow existing boundary edges; they are not new ground. */
export function boundarySkirts(positions, indices, thicknessMeters = 0.4) {
  if (!Number.isFinite(thicknessMeters) || thicknessMeters <= 0) return new Float32Array();
  const count = positions.length / 3, edges = new Map();
  for (let index = 0; index < indices.length; index += 3) {
    for (const [a, b] of [[indices[index], indices[index + 1]], [indices[index + 1], indices[index + 2]], [indices[index + 2], indices[index]]]) {
      const key = Math.min(a, b) * count + Math.max(a, b);
      const edge = edges.get(key);
      if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
    }
  }
  const boundary = [...edges.values()].filter(edge => edge.count === 1);
  const skirt = new Float32Array(boundary.length * 18);
  boundary.forEach(({ a, b }, index) => {
    const A = Array.from(positions.subarray(a * 3, a * 3 + 3)), B = Array.from(positions.subarray(b * 3, b * 3 + 3));
    const downA = [A[0], A[1] - thicknessMeters, A[2]], downB = [B[0], B[1] - thicknessMeters, B[2]];
    skirt.set([...A, ...B, ...downB, ...A, ...downB, ...downA], index * 18);
  });
  return skirt;
}

export function markerPosition(point, origin, liftCm = 60) {
  const xyz = worldLocation(point);
  if (!xyz || !Number.isFinite(liftCm)) return null;
  return worldToThree([xyz[0], xyz[1], xyz[2] + liftCm], origin);
}

export function inHeightRange(point, min = -Infinity, max = Infinity) {
  const xyz = worldLocation(point);
  return Boolean(xyz && xyz[2] >= min && xyz[2] <= max);
}

export function pointKey(point) { return String(point?._key ?? point?.key ?? point?.id ?? ''); }

/** Intersect an existing surface polygon with horizontal planes; never fill gaps. */
export function clipSurfaceHeight(vertices, min = -Infinity, max = Infinity) {
  let result = vertices;
  for (const [height, above] of [[min, true], [max, false]]) {
    if (!Number.isFinite(height) || !result.length) continue;
    const clipped = [];
    let previous = result.at(-1), previousInside = above ? previous[2] >= height : previous[2] <= height;
    for (const current of result) {
      const inside = above ? current[2] >= height : current[2] <= height;
      if (inside !== previousInside) {
        const fraction = (height - previous[2]) / (current[2] - previous[2]);
        clipped.push([previous[0] + (current[0] - previous[0]) * fraction, previous[1] + (current[1] - previous[1]) * fraction, height]);
      }
      if (inside) clipped.push(current);
      previous = current; previousInside = inside;
    }
    result = clipped;
  }
  return result;
}

/** Focus bounds are a camera hint, never a fabricated region boundary. */
export function terrainViewBounds(mesh, points, supplied) {
  if (validBounds(supplied)) return { min: [...supplied.min], max: [...supplied.max] };
  return boundsOf(points) ?? boundsOf(mesh.vertices);
}
