// ═══ Shader DSL — IR barrel ═══
//
// The single import surface for the IR. ir.ts grew past ~580 LOC, so it was
// split by concern into types / nodes / node / builder (DAG: types ← nodes ←
// node ← builder). Import the IR via this barrel (`core/ir`), never the
// individual files.

export * from './types.js';
export * from './span.js';
export * from './nodes.js';
export * from './node.js';
export * from './builder.js';
// The single-source-of-truth declarators (`uniformStruct`, `ioStruct`, `storageBuffer`, …) live in
// `../sot.ts`, which imports this barrel. Re-exported last (change 0060), so every module this
// barrel lists above is evaluated before `sot.ts` runs its module-scope code, whichever of the
// two files is loaded first.
export * from '../sot.js';
