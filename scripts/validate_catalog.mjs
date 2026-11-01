import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const catalog = JSON.parse(await fs.readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const categories = new Set(catalog.categories.map(c => c.id));
const maps = new Set(catalog.maps.map(m => m.id));
const ids = new Set();
assert.equal(categories.size,13);
assert.equal(catalog.records.length,698);
for (const record of catalog.records) {
  assert.equal(typeof record.id,'string');assert(!ids.has(record.id));ids.add(record.id);
  assert(categories.has(record.category));assert(maps.has(record.mapId));
  assert.equal(typeof record.name,'string');assert.equal(typeof record.aggregationParent,'boolean');
  assert(record.source && typeof record.source==='object');
  if(record.location!==null) assert(['X','Y','Z'].every(axis=>Number.isFinite(record.location[axis])));
  for(const requirement of record.requirements || []) assert(['associated','prerequisite'].includes(requirement.relation));
}
assert.equal(catalog.bells.length,187);
assert.equal(catalog.questMetadata.length,80);
assert(!('provenance' in catalog),'Raw extraction provenance stays outside the runtime catalog');
for(const map of catalog.maps) if(map.mapProjection) {
  assert.equal(map.mapProjection.method,'anchor-mesh');
  assert(map.mapProjection.width>0&&map.mapProjection.height>0);
}
for(const point of [...catalog.records,...catalog.bells]) if(point.mapPosition) {
  assert(Number.isFinite(point.mapPosition.X)&&Number.isFinite(point.mapPosition.Y));
  assert(catalog.maps.find(map=>map.id===point.mapId)?.mapProjection,'UV coordinates require matching map metadata');
}
assert.equal(catalog.records.filter(r=>r.mapPosition).length,646);
assert.equal(catalog.bells.filter(r=>r.mapPosition).length,175);
console.log('PASS catalog: 698 points / 13 categories / 187 bell references / 80 task records');
