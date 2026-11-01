# ooz-wasm 2.0.0

This directory redistributes the unmodified `ooz-wasm` 2.0.0 npm artifact,
licensed **GPL-3.0-or-later**. Its `build/ooz.js` embeds the WebAssembly binary,
so decompression needs no external CDN, DLL, service, or save upload.

- WASM bindings: Alexander Drozdov / SnosMe, <https://github.com/SnosMe/ooz-wasm>.
- Underlying ooz decoder: Copyright (C) 2016 Powzix, GPL-3.0-or-later,
  <https://github.com/powzix/ooz>.
- Full license: [LICENSE](LICENSE).
- Corresponding upstream source and build recipe: [source/](source/) (also available in the
  [GitHub repository](https://github.com/geturin/PBZItemlist/tree/main/public/vendor/ooz-wasm/source)).
- Pinned package integrity and source revision: [PROVENANCE.json](PROVENANCE.json).

`decoder.js` is the PBZ Collector adapter (2026), also GPL-3.0-or-later. It
creates an isolated WASM heap per save decode, frees temporary buffers after
each decompression, checks output lengths, and does not send data anywhere.
The adapter source is distributed in this directory.

To rebuild upstream, install Emscripten and CMake, then run from `source/`:

```
emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

The project enables WebAssembly SIMD and emits an ES module with the WASM
embedded (`SINGLE_FILE=1`). The prebuilt artifact was obtained from the npm
registry URL recorded in PROVENANCE.json and SHA-512 verified before use.
The checked-out source has identical package.json, index.js, README.md and
LICENSE to that npm version. Upstream does not record the exact Emscripten
version used to build its published artifact.

The PBZS reader in `../../js/save-codec.js` is GPL-3.0-or-later and reads the
game-format constant locally; it is not an account credential. No proprietary
Oodle DLL or game executable is redistributed here.
