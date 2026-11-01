// SPDX-License-Identifier: GPL-3.0-or-later
// PBZ Collector adapter, 2026. Uses the unmodified ooz-wasm 2.0.0 build.
// Each caller gets an isolated WASM heap; temporary allocations are always freed.
import oozFactory from './build/ooz.js';

export async function createOodleDecoder() {
  const instance = await oozFactory();
  return {
    decompress(input, rawSize) {
      let inputPointer = 0;
      let outputPointer = 0;
      try {
        inputPointer = instance._malloc(input.byteLength + 64);
        outputPointer = instance._malloc(rawSize + 64);
        if (!inputPointer || !outputPointer) throw new Error('Oodle allocation failed');
        instance.HEAPU8.fill(0, inputPointer, inputPointer + input.byteLength + 64);
        instance.HEAPU8.set(input, inputPointer);
        const count = instance._Kraken_Decompress(inputPointer, input.byteLength, outputPointer, rawSize);
        if (count !== rawSize) throw new Error('Oodle decompressed size mismatch');
        return instance.HEAPU8.slice(outputPointer, outputPointer + rawSize);
      } finally {
        if (inputPointer) instance._free(inputPointer);
        if (outputPointer) instance._free(outputPointer);
      }
    },
  };
}
