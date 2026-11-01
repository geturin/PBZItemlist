// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic authenticated PBZS 3 files for UI regression; no player save data.
import { deflateSync } from 'node:zlib';

const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
// The format key is the same public constant used by the browser codec.
const keyBytes = Uint8Array.from('15a1fe0f55e0eb298e7c9461548351696a2a0700ed2d17ba1f871457e8f93e2d'.match(/../g), x => parseInt(x, 16));

export async function makeSyntheticSave(entries) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  async function seal(raw) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, raw));
    const output = new Uint8Array(36 + raw.length);
    output.set([80, 66, 90, 83, 1, 1, 0, 0]); output.set(iv, 8);
    output.set(encrypted.subarray(-16), 20); output.set(encrypted.subarray(0, -16), 36);
    return output;
  }
  const raw = entries.map(entry => bytes(entry.data));
  const blocks = await Promise.all(raw.map(value => seal(deflateSync(value))));
  const names = entries.map(entry => bytes(entry.name));
  const directoryLength = 12 + names.reduce((sum, name) => sum + 2 + name.length + 14, 0);
  const header = new Uint8Array(12), hv = new DataView(header.buffer);
  header.set([80, 66, 90, 83, 3, 1]); hv.setUint16(6, entries.length, true); hv.setUint32(8, directoryLength + 36, true);
  const directory = new Uint8Array(directoryLength), dv = new DataView(directory.buffer); directory.set(header);
  let cursor = 12, offset = 0;
  for (let index = 0; index < entries.length; index++) {
    dv.setUint16(cursor, names[index].length, true); cursor += 2; directory.set(names[index], cursor); cursor += names[index].length;
    dv.setUint8(cursor, 1); dv.setUint8(cursor + 1, 1); dv.setUint32(cursor + 2, raw[index].length, true);
    dv.setUint32(cursor + 6, offset, true); dv.setUint32(cursor + 10, blocks[index].length, true); cursor += 14; offset += blocks[index].length;
  }
  const sealedDirectory = await seal(directory), output = new Uint8Array(12 + sealedDirectory.length + offset);
  output.set(header); output.set(sealedDirectory, 12); cursor = 12 + sealedDirectory.length;
  for (const block of blocks) { output.set(block, cursor); cursor += block.length; }
  return output;
}

export function syntheticGameplay(catalog, { latest = false } = {}) {
  const actor = catalog.records.find(record => record.category === 'blackStone' && record.source?.saveGuid);
  const quests = catalog.questMetadata.slice(0, 4).map((quest, index) => ({
    QuestClass: `/Game/Synthetic/${quest.id}.${quest.id}_C`,
    QuestCompletion: ['EQuestCompletion::QC_Started', 'EQuestCompletion::QC_Succeded', 'EQuestCompletion::QC_Failed', 'EQuestCompletion::QC_None'][index],
    CompletedBranches: quest.branches?.slice(0, 1).map(branch => branch.id) ?? [],
    QuestBranches: quest.branches?.slice(0, 2).map((branch, branchIndex) => ({ BranchID: branch.id, BranchType: branchIndex ? 'EBranchType::BranchActivating' : 'EBranchType::BranchCompleted' })) ?? [],
  }));
  return {
    PBZGameSystem: { DateTimeString: latest ? '2026.11.01-13.00.00' : '2026.11.01-12.00.00', CurrentLevelName: 'Synthetic', CycleCount: 0, CompleteAddItemMobDomainNames: [] },
    BellManager: { ActivateBellIDs: latest ? catalog.bells.slice(0, 2).map(bell => bell.id) : [] },
    LevelActorManager: latest && actor ? { [actor.source.saveGuid]: {} } : {},
    EventPipeline: { ExecuteNodeGuid: {} },
    Inventory: { MainWeaponInfos: {}, ShaChiWeaponInfo: {}, AccessoryInfos: {}, MedicineInfos: {}, InventoryInfos: {} },
    MapSubsystem: {}, Narrative: { NarrativeSavedQuests: quests },
  };
}
