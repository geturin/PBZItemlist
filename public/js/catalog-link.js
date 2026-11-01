// SPDX-License-Identifier: GPL-3.0-or-later
// Guide links can select catalog entries, never read or import a save.
export function resolveCatalogLink(search, { maps, categories, records }) {
  const params = new URLSearchParams(search);
  const map = maps.some(entry => entry.id === params.get('map')) ? params.get('map') : 'all';
  const category = categories.some(entry => entry.id === params.get('category')) ? params.get('category') : 'all';
  const matches = params.has('item') ? records.filter(record => record.id === params.get('item')
    && (map === 'all' || record.mapId === map) && (category === 'all' || record.category === category)) : [];
  const selected = matches.length === 1 ? matches[0] : null;
  return { map: selected?.mapId ?? map, category: selected?.category ?? category, selectedKey: selected?._key ?? null };
}
