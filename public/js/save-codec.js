// SPDX-License-Identifier: GPL-3.0-or-later
// PBZS v3 reader. All save bytes stay in the calling browser; this module uploads nothing.

export const SAVE_LIMITS = Object.freeze({
  fileBytes: 40 * 1024 * 1024,
  directoryBytes: 1024 * 1024,
  slotRawBytes: 50 * 1024 * 1024,
  totalRawBytes: 150 * 1024 * 1024,
  slotCount: 128,
  nameBytes: 128,
});

const SEALED_HEADER = new Uint8Array([80, 66, 90, 83, 1, 1, 0, 0]);
// Shared game-format constant; not an account credential.
const KEY_BYTES = Uint8Array.from('15a1fe0f55e0eb298e7c9461548351696a2a0700ed2d17ba1f871457e8f93e2d'.match(/../g), byte => parseInt(byte, 16));
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class SaveDecodeError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SaveDecodeError';
    this.code = code;
  }
}

function fail(code, message) { throw new SaveDecodeError(code, message); }
function assert(condition, code, message) { if (!condition) fail(code, message); }
function sameBytes(a, b) { return a.length === b.length && a.every((byte, index) => byte === b[index]); }
function asBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input) && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  fail('INPUT_TYPE', '请选择游戏的 .sav 存档文件。');
}

async function unseal(bytes, key, label) {
  assert(bytes.length >= 36 && sameBytes(bytes.subarray(0, 8), SEALED_HEADER), 'SEALED_FORMAT', `${label}的加密格式不受支持。`);
  // PBZS stores tag before ciphertext; WebCrypto expects ciphertext followed by the tag.
  const ciphertextAndTag = new Uint8Array(bytes.length - 20);
  ciphertextAndTag.set(bytes.subarray(36), 0);
  ciphertextAndTag.set(bytes.subarray(20, 36), bytes.length - 36);
  try {
    return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(8, 20), tagLength: 128 }, key, ciphertextAndTag));
  } catch (cause) {
    throw new SaveDecodeError('AUTHENTICATION', `${label}认证失败：文件可能损坏，或使用了尚未支持的存档格式。`, cause);
  }
}

function readDirectory(directory, source, count, blockBase) {
  assert(directory.length >= 12 && sameBytes(directory.subarray(0, 12), source.subarray(0, 12)), 'HEADER_COPY', '存档目录与文件头不一致。');
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = [];
  const names = new Set();
  let position = 12;
  let totalRaw = 0;
  for (let index = 0; index < count; index++) {
    assert(position + 2 <= directory.length, 'DIRECTORY_TRUNCATED', '存档目录不完整。');
    const nameLength = view.getUint16(position, true);
    position += 2;
    assert(nameLength > 0 && nameLength <= SAVE_LIMITS.nameBytes && position + nameLength + 14 <= directory.length, 'DIRECTORY_ENTRY', '存档槽位信息不完整或超出限制。');
    let name;
    try { name = utf8.decode(directory.subarray(position, position + nameLength)); }
    catch (cause) { throw new SaveDecodeError('SLOT_NAME', '存档槽位名称编码无效。', cause); }
    position += nameLength;
    assert(/^[A-Za-z0-9_-]+$/.test(name) && !names.has(name), 'SLOT_NAME', '存档槽位名称无效或重复。');
    names.add(name);
    const algorithm = view.getUint8(position);
    const encrypted = view.getUint8(position + 1);
    const rawLength = view.getUint32(position + 2, true);
    const relativeOffset = view.getUint32(position + 6, true);
    const storedLength = view.getUint32(position + 10, true);
    position += 14;
    assert(encrypted === 1, 'ENCRYPTION_UNSUPPORTED', '此存档使用了尚未支持的加密方式。');
    assert(algorithm === 1 || algorithm === 2, 'COMPRESSION_UNSUPPORTED', '此存档使用了尚未支持的压缩方式。');
    assert(rawLength > 0 && rawLength <= SAVE_LIMITS.slotRawBytes, 'SLOT_TOO_LARGE', '单个存档槽位解压后超过 50 MiB 限制。');
    totalRaw += rawLength;
    assert(totalRaw <= SAVE_LIMITS.totalRawBytes, 'TOTAL_TOO_LARGE', '存档解压后的总数据超过 150 MiB 限制。');
    const start = blockBase + relativeOffset;
    const end = start + storedLength;
    assert(storedLength >= 36 && start >= blockBase && end <= source.length, 'BLOCK_BOUNDS', '存档数据段越界或不完整。');
    entries.push({ name, algorithm, rawLength, start, end });
  }
  assert(position === directory.length, 'DIRECTORY_TRAILING', '存档目录包含无法识别的附加数据。');
  let cursor = blockBase;
  for (const entry of [...entries].sort((a, b) => a.start - b.start)) {
    assert(entry.start === cursor, 'BLOCK_LAYOUT', '存档数据段重叠或存在未说明的间隔。');
    cursor = entry.end;
  }
  assert(cursor === source.length, 'FILE_TRAILING', '存档末尾包含无法识别的附加数据。');
  return entries;
}

async function inflateBounded(compressed, rawLength) {
  assert(typeof DecompressionStream !== 'undefined', 'BROWSER_DEFLATE', '当前浏览器不支持此存档所需的 zlib 解压，请使用新版浏览器。');
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const output = new Uint8Array(rawLength);
  let position = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      assert(position + value.length <= rawLength, 'DECOMPRESSED_LENGTH', '解压数据超过目录声明的长度。');
      output.set(value, position);
      position += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  assert(position === rawLength, 'DECOMPRESSED_LENGTH', '解压后的长度与存档目录不一致。');
  return output;
}

/**
 * Decode a user-selected save entirely in this browser.
 * onProgress receives {phase,current,total,name?,message}; callback errors are ignored.
 * slots contains gameplay saves only; account-wide records are in metadata.
 * Newest timestamp wins; exact ties prefer the game's LastContinueSlot, then slot name.
 */
export async function decodeSave(arrayBuffer, { onProgress } = {}) {
  const source = asBytes(arrayBuffer);
  assert(source.length <= SAVE_LIMITS.fileBytes, 'FILE_TOO_LARGE', '存档文件超过 40 MiB 限制。');
  assert(source.length >= 48, 'FILE_TRUNCATED', '文件过短，不是完整的 PBZS 存档。');
  assert(sameBytes(source.subarray(0, 4), SEALED_HEADER.subarray(0, 4)), 'FILE_MAGIC', '未识别为影之刃零 PBZS 存档，请选择 PBZSaveGame.sav。');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const version = view.getUint8(4);
  assert(version === 3 && view.getUint8(5) === 1, 'FORMAT_VERSION', `暂不支持此 PBZS 版本（${version}）。`);
  const count = view.getUint16(6, true);
  const directoryLength = view.getUint32(8, true);
  assert(count > 0 && count <= SAVE_LIMITS.slotCount, 'SLOT_COUNT', '存档槽位数无效或超过限制。');
  assert(directoryLength >= 48 && directoryLength <= SAVE_LIMITS.directoryBytes && 12 + directoryLength <= source.length, 'DIRECTORY_BOUNDS', '存档目录长度无效或文件不完整。');
  assert(globalThis.crypto?.subtle, 'WEBCRYPTO', '浏览器未提供 WebCrypto。请通过 HTTPS 或本机 localhost 打开页面。');
  const progress = (phase, current, total, name, message) => { try { onProgress?.({ phase, current, total, name, message }); } catch {} };
  progress('directory', 0, count, undefined, '正在本机验证存档目录…');
  const key = await globalThis.crypto.subtle.importKey('raw', KEY_BYTES, 'AES-GCM', false, ['decrypt']);
  const directory = await unseal(source.subarray(12, 12 + directoryLength), key, '存档目录');
  const entries = readDirectory(directory, source, count, 12 + directoryLength);
  const slots = [];
  const metadata = Object.create(null);
  let oodle;
  try {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      progress('decode', index, count, entry.name, `正在本机解码 ${entry.name}（${index + 1}/${count}）…`);
      const compressed = await unseal(source.subarray(entry.start, entry.end), key, entry.name);
      let raw;
      try {
        if (entry.algorithm === 2) {
          if (!oodle) {
            const { createOodleDecoder } = await import('../vendor/ooz-wasm/decoder.js');
            oodle = await createOodleDecoder();
          }
          raw = oodle.decompress(compressed, entry.rawLength);
        } else raw = await inflateBounded(compressed, entry.rawLength);
      } catch (cause) {
        if (cause instanceof SaveDecodeError) throw cause;
        throw new SaveDecodeError('DECOMPRESSION', `${entry.name}无法解压：数据可能损坏，或浏览器不支持所需的 WebAssembly SIMD。`, cause);
      }
      assert(raw.length === entry.rawLength, 'DECOMPRESSED_LENGTH', `${entry.name}的解压长度不一致。`);
      let data;
      try { data = JSON.parse(utf8.decode(raw)); }
      catch (cause) { throw new SaveDecodeError('JSON', `${entry.name}解压后不是有效的 UTF-8 JSON 存档。`, cause); }
      assert(data && typeof data === 'object' && !Array.isArray(data), 'JSON_ROOT', `${entry.name}的存档结构不受支持。`);
      if (data.PBZGameSystem && typeof data.PBZGameSystem === 'object' && !Array.isArray(data.PBZGameSystem)) {
        slots.push({ name: entry.name, header: data.PBZGameSystem, data });
      } else metadata[entry.name] = data;
      // Keep the UI responsive between independent slot decodes.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { oodle = undefined; }
  const preferred = metadata.__Advanced__?.LastContinueSlot;
  const time = slot => typeof slot.header.DateTimeString === 'string' ? slot.header.DateTimeString : '';
  slots.sort((a, b) => time(b).localeCompare(time(a)) || ((b.name === preferred) - (a.name === preferred)) || a.name.localeCompare(b.name));
  progress('complete', count, count, slots[0]?.name, '本机解码完成，存档没有上传。');
  return { slots, latestSlotName: slots[0]?.name ?? null, formatVersion: version, metadata };
}
