// Local test runner. Reads private fixtures only from an explicit external argument.
import {readFile,writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {decodeSave,SAVE_LIMITS} from '../public/js/save-codec.js';

const KEY=Uint8Array.from('15a1fe0f55e0eb298e7c9461548351696a2a0700ed2d17ba1f871457e8f93e2d'.match(/../g),x=>parseInt(x,16));
const key=await crypto.subtle.importKey('raw',KEY,'AES-GCM',false,['encrypt']);
const encode=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
const sealedHeader=Uint8Array.of(80,66,90,83,1,1,0,0);
async function seal(raw){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128},key,raw));
 const result=new Uint8Array(36+raw.length);result.set(sealedHeader);result.set(iv,8);
 result.set(encrypted.subarray(-16),20);result.set(encrypted.subarray(0,-16),36);return result;
}
async function fixture(entries,{mutateDirectory,appendDirectoryBytes=0}={}){
 const blocks=await Promise.all(entries.map(e=>seal(e.compressed??deflateSync(e.raw??encode(e.data)))));
 const nameBytes=entries.map(e=>encode(e.name));
 const directoryLength=12+nameBytes.reduce((n,s)=>n+2+s.length+14,0)+appendDirectoryBytes;
 const header=new Uint8Array(12),hv=new DataView(header.buffer);header.set([80,66,90,83,3,1]);hv.setUint16(6,entries.length,true);hv.setUint32(8,directoryLength+36,true);
 const directory=new Uint8Array(directoryLength);directory.set(header);const dv=new DataView(directory.buffer);
 let position=12,relative=0;
 const fieldOffsets=[];
 entries.forEach((entry,i)=>{dv.setUint16(position,nameBytes[i].length,true);position+=2;directory.set(nameBytes[i],position);position+=nameBytes[i].length;fieldOffsets.push(position);dv.setUint8(position,entry.algorithm??1);dv.setUint8(position+1,1);dv.setUint32(position+2,entry.rawLength??(entry.raw??encode(entry.data)).length,true);dv.setUint32(position+6,relative,true);dv.setUint32(position+10,blocks[i].length,true);position+=14;relative+=blocks[i].length;});
 mutateDirectory?.(directory,fieldOffsets);
 const directoryBlock=await seal(directory);
 const output=new Uint8Array(12+directoryBlock.length+relative);output.set(header);output.set(directoryBlock,12);let cursor=12+directoryBlock.length;for(const block of blocks){output.set(block,cursor);cursor+=block.length;}return output;
}
const gameplay=(time)=>({PBZGameSystem:{DateTimeString:time,CurrentLevelName:'Synthetic'},Inventory:{InventoryInfos:{}}});
let passed=0;
const results=[];
async function test(name,fn){await fn();passed++;results.push({name,passed:true});console.log('PASS',name);}
async function rejects(bytes,code){await assert.rejects(()=>decodeSave(bytes),error=>error.code===code);}

await test('Authenticated zlib slots, timestamp and metadata',async()=>{
 const bytes=await fixture([{name:'AutoSave0',data:gameplay('2026.11.01-12.00.00')},{name:'AutoSave1',data:gameplay('2026.11.01-13.00.00')},{name:'__Advanced__',data:{LastContinueSlot:'AutoSave0'}}]);
 const events=[];const d=await decodeSave(bytes,{onProgress:p=>events.push(p)});assert.equal(d.latestSlotName,'AutoSave1');assert.equal(d.slots.length,2);assert.equal(d.formatVersion,3);assert.equal(events.at(-1).phase,'complete');
});
await test('Synthetic Oodle stored frame through real WASM',async()=>{
 const data=gameplay('2000.01.01-00.00.00');const raw=encode(data);
 const compressed=new Uint8Array(raw.length+2);compressed.set([0xcc,0x0a]);compressed.set(raw,2);
 const decoded=await decodeSave(await fixture([{name:'AutoSave0',data,compressed,algorithm:2}]));
 assert.deepEqual(decoded.slots[0].data,data);
});
await test('Exact timestamp ties prefer LastContinueSlot',async()=>{
 const bytes=await fixture([{name:'AutoSave0',data:gameplay('2026.11.01-12.00.00')},{name:'AutoSave1',data:gameplay('2026.11.01-12.00.00')},{name:'__Advanced__',data:{LastContinueSlot:'AutoSave1'}}]);assert.equal((await decodeSave(bytes)).latestSlotName,'AutoSave1');
});
await test('Settings-only file yields no gameplay slots',async()=>{const d=await decodeSave(await fixture([{name:'__Advanced__',data:{LastContinueSlot:''}}]));assert.equal(d.latestSlotName,null);assert.equal(d.slots.length,0);});
await test('Callback failures do not corrupt decode',async()=>{await decodeSave(await fixture([{name:'AutoSave0',data:gameplay('2026.11.01-12.00.00')}]),{onProgress:()=>{throw Error('consumer callback');}});});
const valid=await fixture([{name:'AutoSave0',data:gameplay('2026.11.01-12.00.00')}]);
await test('Magic validation',async()=>{const b=valid.slice();b[0]=0;await rejects(b,'FILE_MAGIC');});
await test('Version validation',async()=>{const b=valid.slice();b[4]=4;await rejects(b,'FORMAT_VERSION');});
await test('Truncated input rejected',()=>rejects(valid.slice(0,20),'FILE_TRUNCATED'));
await test('40 MiB input ceiling',()=>rejects(new Uint8Array(SAVE_LIMITS.fileBytes+1),'FILE_TOO_LARGE'));
await test('Directory authentication',async()=>{const b=valid.slice();b[50]^=1;await rejects(b,'AUTHENTICATION');});
await test('Slot authentication',async()=>{const b=valid.slice();b[b.length-1]^=1;await rejects(b,'AUTHENTICATION');});
await test('50 MiB slot ceiling',async()=>rejects(await fixture([{name:'AutoSave0',data:{},rawLength:SAVE_LIMITS.slotRawBytes+1}]),'SLOT_TOO_LARGE'));
await test('150 MiB total ceiling before allocation',async()=>rejects(await fixture(Array.from({length:4},(_,i)=>({name:'AutoSave'+i,data:{},rawLength:SAVE_LIMITS.slotRawBytes}))),'TOTAL_TOO_LARGE'));
await test('Overlapping blocks rejected',async()=>rejects(await fixture([{name:'A',data:{}},{name:'B',data:{}}],{mutateDirectory:(d,fields)=>new DataView(d.buffer).setUint32(fields[1]+6,0,true)}),'BLOCK_LAYOUT'));
await test('Out-of-file offset rejected',async()=>rejects(await fixture([{name:'A',data:{}}],{mutateDirectory:(d,fields)=>new DataView(d.buffer).setUint32(fields[0]+6,0xffffffff,true)}),'BLOCK_BOUNDS'));
await test('Unknown compression rejected',async()=>rejects(await fixture([{name:'A',data:{},algorithm:9}]),'COMPRESSION_UNSUPPORTED'));
await test('Duplicate slot names rejected',async()=>rejects(await fixture([{name:'A',data:{}},{name:'A',data:{}}]),'SLOT_NAME'));
await test('Invalid slot names rejected',async()=>rejects(await fixture([{name:'../slot',data:{}}]),'SLOT_NAME'));
await test('Deflate output checked while streaming',async()=>rejects(await fixture([{name:'A',data:{long:'x'.repeat(4000)},rawLength:100}]),'DECOMPRESSED_LENGTH'));
await test('Invalid JSON rejected',async()=>rejects(await fixture([{name:'A',raw:encode('{invalid')}]),'JSON'));
await test('Invalid UTF8 rejected',async()=>rejects(await fixture([{name:'A',raw:Uint8Array.of(255,255)}]),'JSON'));
await test('Non-object JSON root rejected',async()=>rejects(await fixture([{name:'A',data:[1,2]}]),'JSON_ROOT'));
await test('Authenticated header mirror checked',async()=>rejects(await fixture([{name:'A',data:{}}],{mutateDirectory:d=>{d[4]=2;}}),'HEADER_COPY'));
await test('Trailing directory data rejected',async()=>rejects(await fixture([{name:'A',data:{}}],{appendDirectoryBytes:1}),'DIRECTORY_TRAILING'));

if(process.argv[2])await test('Real PBZS AES-GCM + WASM, all gameplay slots equal native decode',async()=>{
 const dir=process.argv[2];const bytes=await readFile(`${dir}/source.sav`);const decoded=await decodeSave(bytes);
 assert(decoded.slots.length>0);
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 // Python's prior JSON re-serialization normalized -0 to 0. Canonical JSON treats these identically.
 for(const slot of decoded.slots){const expected=JSON.parse(await readFile(`${dir}/${slot.name}.json`,'utf8'));assert.equal(digest(slot.data),digest(expected),`${slot.name} canonical JSON differs`);}
 for(const name of Object.keys(decoded.metadata))assert.equal(digest(decoded.metadata[name]),digest(JSON.parse(await readFile(`${dir}/${name}.json`,'utf8'))));
});
console.log(JSON.stringify({tests_passed:passed,private_fixture_used:Boolean(process.argv[2])}));
await writeFile(new URL('./test_codec_results.json',import.meta.url),JSON.stringify({tests_passed:passed,private_fixture_used:Boolean(process.argv[2]),tests:results},null,2)+'\n');
