// SPDX-License-Identifier: GPL-3.0-or-later
// Small synthetic navigation surfaces in the released geometry format.
export function terrainFixture(catalog) {
  const mapId='ZhengDaoDaYing',world='UI-Test-World';
  const stones=catalog.records.filter(record=>record.mapId===mapId&&record.category==='blackStone');
  const p=stones[0].location,q=stones.at(-1).location;
  const all=[...catalog.records,...catalog.bells].filter(record=>record.mapId===mapId&&Number.isFinite(record.location?.Z));
  const high=Math.max(...all.map(record=>record.location.Z))+1_000_000;
  const normal={min:[0,40000,5000],max:[100000,160000,15000]};
  const alternate={min:[0,40000,high-100],max:[100000,160000,high+100]};
  const vertices=[
    [p.X-300,p.Y-300,p.Z],[p.X+300,p.Y-300,p.Z],[p.X,p.Y+300,p.Z],
    [q.X-300,q.Y-300,q.Z],[q.X+300,q.Y-300,q.Z],[q.X,q.Y+300,q.Z],
    [p.X-300,p.Y-300,high],[p.X+300,p.Y-300,high],[p.X,p.Y+300,high],
  ];
  const zBands=[{id:'z0',firstIndex:0,indexCount:6,triangleCount:2,bounds:normal},
    {id:'z1',firstIndex:6,indexCount:3,triangleCount:1,bounds:alternate}];
  const mapFocus={mapId,world,defaultBandId:'z0',focusByBand:[{bandId:'z0',anchorCount:4,bounds:normal},{bandId:'z1',anchorCount:1,bounds:alternate}]};
  return {manifest:{format:1,maps:{[mapId]:mapFocus},worlds:{[world]:{id:world,file:'ui-test-world.json.gz'}}},
    geometry:{format:1,world,unit:'cm',coordinateSystem:'Unreal Z-up',vertices,indices:[0,1,2,3,4,5,6,7,8],
      bounds:{min:normal.min,max:alternate.max},zBands,defaultBandId:'z0',mapFocus:[mapFocus]}};
}
