import assert from 'node:assert/strict';
import { resolveCatalogLink } from '../public/js/catalog-link.js';
const catalog = { maps: [{ id: 'camp' }], categories: [{ id: 'bell' }, { id: 'stone' }],
  records: [{ id: '1', mapId: 'camp', category: 'bell', _key: 'b' }, { id: '1', mapId: 'camp', category: 'stone', _key: 's' }] };
assert.deepEqual(resolveCatalogLink('?map=camp&category=stone&item=1', catalog), { map: 'camp', category: 'stone', selectedKey: 's' });
assert.equal(resolveCatalogLink('?item=1', catalog).selectedKey, null, 'Ambiguous IDs must not choose an arbitrary item');
assert.deepEqual(resolveCatalogLink('?map=unknown&category=unknown&save=PRIVATE.sav', catalog), { map: 'all', category: 'all', selectedKey: null });
assert.deepEqual(resolveCatalogLink('?map=camp&category=bell', catalog), { map: 'camp', category: 'bell', selectedKey: null });
console.log('PASS guide links: validated map/category/unique item and ignored unrelated parameters');
