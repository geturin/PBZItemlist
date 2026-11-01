// SPDX-License-Identifier: GPL-3.0-or-later
// Pure local analysis. This module makes no network requests and never edits saves.
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const meaningful = value => typeof value === 'string' && value.length > 0 && value !== 'None';
const truth = (status, reason, evidence = []) => ({ status, reason, evidence });
const unknown = reason => truth('unknown', reason);
const norm = value => String(value ?? '').toLowerCase();
function nameKey(entries, id) {
  if (!object(entries) || !meaningful(id)) return null;
  if (own(entries, id)) return id;
  return Object.keys(entries).find(key => norm(key) === norm(id)) ?? null;
}

function actorCheck(actors, id, compatibility = true) {
  if (!object(actors) || !meaningful(id)) return null;
  if (own(actors, id)) return { matched: id, method: '场景对象存档记录' };
  if (!compatibility) return false;
  const bare = id.includes('-') ? id.slice(id.indexOf('-') + 1) : id;
  if (own(actors, bare)) return { matched: bare, method: '旧版对象名称兼容记录' };
  if (bare === id) {
    const matches = Object.keys(actors).filter(key => key.endsWith('-' + id));
    if (matches.length === 1) return { matched: matches[0], method: '带关卡前缀的对象记录' };
    if (matches.length > 1) return null;
  }
  return false;
}

function domainCompletion(source, data) {
  const checks = [];
  if (meaningful(source.saveGuid)) {
    const result = actorCheck(data.LevelActorManager, source.saveGuid);
    if (result) return truth('done', result.method, [result.matched]);
    checks.push(result === false);
  }
  if (meaningful(source.mobDomain)) {
    const domains = data.PBZGameSystem?.CompleteAddItemMobDomainNames;
    if (Array.isArray(domains) && domains.includes(source.mobDomain)) return truth('done', '敌群奖励已经发放', [source.mobDomain]);
    checks.push(Array.isArray(domains));
  }
  if (Array.isArray(source.nodeGuids) && source.nodeGuids.length) {
    const nodes = data.EventPipeline?.ExecuteNodeGuid;
    const match = source.nodeGuids.find(id => own(nodes, id));
    if (match) return truth('done', '奖励事件节点已经执行', [match]);
    checks.push(object(nodes));
  }
  if (!checks.length) return unknown('资源条目没有足够的完成判定标识');
  return checks.every(Boolean) ? truth('missing', '尚无对应拾取、战斗发奖或奖励事件记录') : unknown('存档缺少部分奖励判定模块，无法可靠判断');
}

function acquired(source, data, field, idField) {
  const entries = data.Inventory?.[field];
  const id = source[idField];
  if (!object(entries) || !meaningful(id)) return unknown('缺少本类物品记录或物品编号');
  const key = nameKey(entries, id);
  if (!key) return truth('missing', '尚无本周目获得记录');
  const entry = entries[key];
  const cycle = data.PBZGameSystem?.CycleCount;
  if (cycle == null || entry?.AcquiredCycle == null) return unknown('旧存档未记录物品获得周目');
  return Number(entry.AcquiredCycle) === Number(cycle)
    ? truth('done', '本周目已经获得', [id])
    : truth('missing', '其他周目曾获得，本周目尚未获得', [id]);
}

function keyCompletion(source, data) {
  const id = source.itemId, inventory = data.Inventory?.InventoryInfos;
  if (!meaningful(id) || !object(inventory)) return unknown('缺少钥匙编号或背包记录');
  if (nameKey(inventory, id)) return truth('done', '存在钥匙获得记录；即使数量为零也可能已经使用', [id]);
  const actor = actorCheck(data.LevelActorManager, source.saveGuid);
  if (actor) return truth('done', '对应钥匙来源已有拾取记录', [actor.matched]);
  const nodes = source.nodeGuids || [];
  const node = nodes.find(item => own(data.EventPipeline?.ExecuteNodeGuid, item));
  if (node) return truth('done', '对应钥匙奖励事件已经执行', [node]);
  const map = data.MapSubsystem;
  if (object(map)) {
    for (const info of Object.values(map)) {
      for (const group of Object.values(info?.MapLockGroups || {})) {
        for (const lock of group?.SwitchLockJsonArray || []) {
          if (nameKey(lock.NeedItems, id)) return truth('missing', '尚无钥匙获得记录，地图仍记录了需要它的门锁', [id]);
        }
      }
    }
  }
  return unknown('未找到钥匙记录；离线存档不足以区分未拿、已用或当前门锁状态');
}

function completion(record, data) {
  const source = record.source || {};
  switch (record.category) {
    case 'bell': {
      const ids = data.BellManager?.ActivateBellIDs;
      if (!Array.isArray(ids) || !meaningful(source.bellId)) return unknown('缺少铃铛激活记录');
      return ids.some(id => norm(id) === norm(source.bellId)) ? truth('done', '铃铛已经激活', [source.bellId]) : truth('missing', '铃铛尚未激活');
    }
    case 'blackStone': case 'amber': return domainCompletion(source, data);
    case 'weapon': return acquired(source, data, 'MainWeaponInfos', 'weaponId');
    case 'shaqiWeapon': return acquired(source, data, 'ShaChiWeaponInfo', 'weaponId');
    case 'accessory': return acquired(source, data, 'AccessoryInfos', 'accessoryId');
    case 'medicine': return acquired(source, data, 'MedicineInfos', 'medicineId');
    case 'memoryFlower': {
      const result = acquired(source, data, 'InventoryInfos', 'itemId');
      return result.status === 'missing' && record.gameCounted === null ? unknown('本条旧花编号缺少物品定义，尚不能可靠认定为未收') : result;
    }
    case 'rongShu': case 'longZhu': case 'scarecrow': {
      if (!source.nodeGuids?.length || !object(data.EventPipeline?.ExecuteNodeGuid)) return unknown('缺少挑战完成节点或事件记录');
      const match = source.nodeGuids.find(id => own(data.EventPipeline.ExecuteNodeGuid, id));
      return match ? truth('done', '挑战完成事件已经执行', [match]) : truth('missing', '尚无挑战完成事件记录');
    }
    case 'primary': {
      if (!meaningful(source.saveGuid)) return unknown('本条资源没有可用于离线判定的拾取对象编号');
      const match = actorCheck(data.LevelActorManager, source.saveGuid, false);
      return match ? truth('done', '对应场景拾取记录已经保存', [match.matched]) : match === false ? truth('missing', '尚无对应场景拾取记录') : unknown('缺少场景对象记录');
    }
    case 'key': return keyCompletion(source, data);
    default: return unknown('此类别暂无已验证的离线判定规则');
  }
}

function questId(path) {
  const name = String(path || '').split('/').pop().split('.')[0];
  return name.replace(/_C$/, '');
}

function questConditions(record, data, catalog) {
  const requirements = record.requirements || [];
  const questList = data.Narrative?.NarrativeSavedQuests;
  const index = new Map((questList || []).map(q => [questId(q.QuestClass), q]));
  const conditions = requirements.map(req => {
    if (req.type === 'quest' || req.questId) {
      const id = req.questId || req.id;
      const meta = Array.isArray(catalog.questMetadata) ? catalog.questMetadata.find(q => q.id === id) : catalog.questMetadata?.[id];
      const name = req.label || meta?.name || id;
      const q = index.get(id);
      const association = req.relation !== 'prerequisite';
      const label = `${association ? '相关任务' : '前置任务'}：${name}`;
      if (!q) return { label, status: 'unknown', detail: '存档中尚无该任务记录，不能据此断言任务不可接取' };
      const status = q.QuestCompletion || '';
      if (req.branchId) {
        const done = (q.CompletedBranches || []).includes(req.branchId);
        return { label: `${label} / ${req.branchId}`, status: done ? 'met' : association ? 'unknown' : 'unmet', detail: done ? '指定任务分支已经完成' : '尚无指定分支完成记录' };
      }
      if (status.endsWith('QC_Succeded')) return { label, status: 'met', detail: '任务已经完成' };
      if (status.endsWith('QC_Failed')) return { label, status: 'unmet', detail: '任务记录为失败；是否影响此物品仍需结合获取条件判断' };
      if (status.endsWith('QC_Started')) return { label, status: association ? 'unknown' : 'unmet', detail: '任务进行中；不能只到坐标处就认定已满足奖励条件' };
      return { label, status: 'unknown', detail: '任务状态尚不能确定' };
    }
    if (req.type === 'item') {
      const entries = data.Inventory?.InventoryInfos;
      const key = nameKey(entries, req.id);
      const info = key ? entries[key] : null;
      if (req.relation === 'associated') return { label: `关联物品：${req.label || req.id}`, status: info ? 'met' : 'unknown', detail: info ? '存档有对应物品记录；此关联不是前置条件。' : '这是资源中的关联物品，不是已证实的持有要求。' };
      const amount = info?.CurrentAmount;
      return { label: req.label || `所需物品：${req.id}`, status: amount == null ? 'unknown' : amount >= (req.amount || 1) ? 'met' : 'unmet', detail: amount == null ? '存档无当前持有数量' : `当前持有 ${amount}` };
    }
    if (req.type === 'flow') {
      if (req.relation === 'associated' && record.source?.flowAsset === req.id) return { label: '关联奖励流程', status: 'unknown', detail: '资源指向一个剧情或战斗流程；具体任务前置未由此名称单独证实。' };
      const done = own(data.EventPipeline?.ExecuteNodeGuid, req.id);
      return { label: req.label || '奖励事件', status: done ? 'met' : object(data.EventPipeline?.ExecuteNodeGuid) ? 'unmet' : 'unknown', detail: done ? '指定事件已经执行' : '尚无指定事件执行记录' };
    }
    return { label: req.label || '其他获取条件', status: 'unknown', detail: req.description || '此条件尚不能从存档可靠判断' };
  });
  const source = record.source || {};
  if (source.mobDomain) {
    const domains = data.PBZGameSystem?.CompleteAddItemMobDomainNames;
    conditions.push({ label: '战斗奖励记录', status: Array.isArray(domains) && domains.includes(source.mobDomain) ? 'met' : 'unknown', detail: '该点位关联敌群战斗发奖；尚无记录时，需要在游戏中核对对应战斗。' });
  }
  if (source.nodeGuids?.length) {
    const nodes = data.EventPipeline?.ExecuteNodeGuid;
    const done = source.nodeGuids.some(id => own(nodes, id));
    conditions.push({ label: ['rongShu','longZhu','scarecrow'].includes(record.category) ? '挑战事件' : '剧情或奖励事件', status: done ? 'met' : 'unknown', detail: done ? '对应事件节点已有执行记录。' : '尚无关联节点记录；奖励可能需要相应剧情、任务或战斗流程触发。' });
  }
  return conditions;
}

function nearestBells(record, catalog, activated) {
  const location = record.location;
  if (!location || !['X','Y','Z'].every(axis => Number.isFinite(location[axis]))) return [];
  return (catalog.bells || []).filter(b => norm(b.mapId ?? b.map) === norm(record.mapId) && b.location && !norm(b.id).includes('broken') && Math.abs(b.location.Z) < 1e6)
    .map(b => ({ id: b.id, name: b.name || b.name_zh || b.id, mapId: b.mapId ?? b.map, location: b.location,
      active: activated.has(b.id), distance: Math.hypot(...['X','Y','Z'].map(axis => location[axis] - b.location[axis])) / 100,
      heightDelta: (location.Z - b.location.Z) / 100 }))
    .sort((a,b) => a.distance - b.distance).slice(0,3);
}

function counts(records) {
  const result = { total: records.length, done: 0, missing: 0, unknown: 0 };
  for (const item of records) result[item.status]++;
  return result;
}

function questsFromSave(data, catalog) {
  const metadata = new Map((Array.isArray(catalog.questMetadata) ? catalog.questMetadata : []).map(q => [norm(q.id), q]));
  return (data.Narrative?.NarrativeSavedQuests || []).map(q => {
    const id = questId(q.QuestClass), meta = metadata.get(norm(id));
    const status = q.QuestCompletion?.endsWith('QC_Succeded') ? 'done' : q.QuestCompletion?.endsWith('QC_Started') ? 'active' : q.QuestCompletion?.endsWith('QC_Failed') ? 'failed' : 'unknown';
    const completed = new Set(q.CompletedBranches || []);
    const branches = (q.QuestBranches || []).map(branch => ({
      id: branch.BranchID,
      label: meta?.branches?.find(b => b.id === branch.BranchID)?.label || branch.BranchID,
      status: completed.has(branch.BranchID) || branch.BranchType?.endsWith('BranchCompleted') ? 'done' : branch.BranchType?.endsWith('BranchActivating') ? 'active' : 'unknown',
    }));
    return { id, name: meta?.name || id, status, statusLabel: {done:'已完成',active:'进行中',failed:'记录为失败',unknown:'待确认'}[status], branches };
  });
}

export function analyzeSlot(slot, catalog) {
  const data = slot?.data || slot;
  if (!object(data) || !object(data.PBZGameSystem)) throw new Error('这个槽位不含可识别的游戏进度。');
  const activated = new Set(data.BellManager?.ActivateBellIDs || []);
  const records = [];
  for (const record of catalog.records || []) {
    if (record.aggregationParent || record.counted === false && record.category === 'memoryFlower') continue;
    const result = completion(record, data);
    records.push({ ...record, ...result, statusLabel: {done:'已完成',missing:'未完成',unknown:'待确认'}[result.status],
      conditions: questConditions(record, data, catalog), nearestBells: nearestBells(record, catalog, activated) });
  }
  const categories = (catalog.categories || []).map(c => typeof c === 'string' ? {id:c,name:c} : c);
  const maps = (catalog.maps || []).map(m => typeof m === 'string' ? {id:m,name:m} : m);
  return {
    slotName: slot.name || '', summary: counts(records), records,
    byCategory: categories.map(c => ({ id:c.id, name:c.name || c.id, ...counts(records.filter(r => r.category === c.id)) })),
    byMap: maps.map(m => ({ id:m.id, name:m.name || m.id, ...counts(records.filter(r => r.mapId === m.id)) })),
    warnings: ['统计以当前目录中的收集点位为单位；任务和奖励是否满足以可验证的存档记录为准。',
      '附近铃铛按直线距离排列，坐标示意图不代表道路、入口或可直接步行的路线。',
      ...(catalog.limitations || []).filter(item => typeof item === 'string')],
    cycle: data.PBZGameSystem.CycleCount, saveTime: data.PBZGameSystem.DateTimeString || '',
    quests: questsFromSave(data, catalog),
  };
}
