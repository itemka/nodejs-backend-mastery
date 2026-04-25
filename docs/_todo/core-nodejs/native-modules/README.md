# Native modules (N-API)

**Category:** core-nodejs · **Primary app:** — · **Prereqs:** streams-buffering · **Status:** todo

## Scope
- Node-API (N-API / node-addon-api) stability contract vs legacy V8 API.
- When to reach for native: crypto hot paths, bindings to existing C/C++ libs, SIMD.
- `node-gyp` build pipeline and prebuilt-binary distribution.

## Sub-tasks
- [ ] Build a trivial N-API addon (string reverse) to practice the build loop.
- [ ] Benchmark a pure-JS implementation vs the addon to learn when native actually pays.
- [ ] Document distribution options (prebuildify, node-pre-gyp) and CI matrix for Linux/macOS.

## Concepts to know
- ABI stability guarantees of N-API across Node versions.
- Costs: build complexity, cross-platform support, debugging story.
- When `wasm` is a better answer than a native addon.

## Interview questions
- When is a native Node addon worth the build-system pain?
- N-API vs V8 C++ API — why N-API won.
- How would you ship a native addon to consumers without asking them to compile?
