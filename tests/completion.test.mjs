import assert from 'node:assert/strict';
import { analyzeSlot } from '../public/js/completion.js';

const data = {
  PBZGameSystem: { CycleCount: 0, CompleteAddItemMobDomainNames: ['awarded'] },
  BellManager: { ActivateBellIDs: ['Bell_001'] },
  LevelActorManager: { 'Level-Actor': { SwitchState: false }, 'Direct': {} },
  EventPipeline: { ExecuteNodeGuid: { executed: null } },
  Inventory: {
    MainWeaponInfos: { blade: { AcquiredCycle: 0 } },
    ShaChiWeaponInfo: { cannon: { AcquiredCycle: 1 } },
    AccessoryInfos: { ring: {} }, MedicineInfos: { potion: { AcquiredCycle: 0 } },
    InventoryInfos: { flower: { AcquiredCycle: 0 }, usedKey: { CurrentAmount: 0, AcquiredCycle: 0 } },
  },
  MapSubsystem: { XiGu: { MapLockGroups: { 0: { SwitchLockJsonArray: [{ NeedItems: { lockedKey: 1 } }] } } } },
  Narrative: { NarrativeSavedQuests: [{ QuestClass: '/Game/Quest/Story.Story_C', QuestCompletion: 'EQuestCompletion::QC_Started', CompletedBranches: ['S1'] }] },
};
const rec = (id,category,source,extra={}) => ({id,category,mapId:'XiGu',name:id,location:{X:0,Y:0,Z:0},source,requirements:[],...extra});
const catalog = {
  categories:['bell','blackStone','amber','weapon','shaqiWeapon','accessory','medicine','memoryFlower','key','primary','rongShu','longZhu','scarecrow'],
  maps:[{id:'XiGu',name:'悲泣溪谷'}],
  bells:[{id:'Bell_001',mapId:'XiGu',name:'铃铛',location:{X:300,Y:400,Z:0}}],
  records: [
    rec('bell','bell',{bellId:'Bell_001'}),
    rec('actor','blackStone',{saveGuid:'Actor'}),
    rec('mob','amber',{mobDomain:'awarded'}),
    rec('blade','weapon',{weaponId:'blade'}),
    rec('cannon','shaqiWeapon',{weaponId:'cannon'}),
    rec('ring','accessory',{accessoryId:'ring'}),
    rec('potion','medicine',{medicineId:'potion'}),
    rec('flower','memoryFlower',{itemId:'flower'}),
    rec('used','key',{itemId:'usedKey'}),
    rec('locked','key',{itemId:'lockedKey'}),
    rec('absentKey','key',{itemId:'unrecordedKey'}),
    rec('primary','primary',{saveGuid:'Direct'}),
    rec('primaryExact','primary',{saveGuid:'Actor'}),
    rec('tree','rongShu',{nodeGuids:['executed']}),
    rec('pillar','longZhu',{nodeGuids:['not-executed']}),
    rec('scarecrow','scarecrow',{nodeGuids:[]}),
    rec('storyReward','primary',{saveGuid:'not-yet'}, {requirements:[{type:'quest',id:'Story',label:'相关故事',relation:'associated'}]}),
    rec('parent','memoryFlower',{itemId:'wholeFlower'},{aggregationParent:true}),
  ],
};
const result = analyzeSlot({name:'AutoSave0',data},catalog);
const records = Object.fromEntries(result.records.map(r=>[r.id,r]));
assert.equal(records.actor.status,'done','existence follows game rule even with false nested booleans');
assert.equal(records.mob.status,'done');
assert.equal(records.blade.status,'done');
assert.equal(records.cannon.status,'missing','different-cycle acquisition does not count this cycle');
assert.equal(records.ring.status,'unknown','old save missing cycle cannot be called missing');
assert.equal(records.used.status,'done','consumed key remains acquired');
assert.equal(records.locked.status,'missing');
assert.equal(records.absentKey.status,'unknown','absent key without active lock is unknown');
assert.equal(records.primaryExact.status,'missing','primary uses exact actor keys, unlike fragment compatibility');
assert.equal(records.tree.status,'done','flow key existence counts even when its value is null');
assert.equal(records.pillar.status,'missing');
assert.equal(records.scarecrow.status,'unknown');
assert.equal(records.storyReward.conditions[0].status,'unknown','associated quest is not automatically a prerequisite');
assert.equal(records.bell.nearestBells[0].distance,5);
assert(!records.parent);
assert.equal(result.summary.total,result.summary.done+result.summary.missing+result.summary.unknown);
const stripped=structuredClone(data);delete stripped.LevelActorManager;
assert.equal(analyzeSlot({data:stripped},{...catalog,records:[rec('unknown','blackStone',{saveGuid:'Actor'})]}).records[0].status,'unknown');
console.log('PASS completion rules: cycle, actor/flow existence, consumed keys, partial saves, quest association, 13 categories');
