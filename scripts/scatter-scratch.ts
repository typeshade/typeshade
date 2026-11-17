// The scratch size and the time of the f32 scatter in the tree order (change 0056, option C), on a
// synthetic splat kernel of a stated size. A measurement for decision 3 of the proposal, not a gate:
// it prints and exits 0. Run it with bun: `bun scripts/scatter-scratch.ts`.
//
// The kernel: each of `N` invocations (iterations) adds `K` splat contributions, one per splat it
// covers, into an `f32` array of `P` pixel sums, at an index read from a list. The loop runs on the
// CPU tier: the generated code (`compileModuleJs`), at `f32`. Two times are taken: the loop as the
// tree order runs it, and the same loop with the scatter as a plain sequential `+=` (what TypeScript
// means), so the cost of the order alone is separate from the cost of the generated code.
//
// Scratch is counted by the run itself (`ScatterRun.contributions`): one entry per (element,
// iteration) that holds a contribution, the structure option C keeps until the loop ends. Bytes are
// the entries times 8 (a 4-byte index and a 4-byte value); this is an estimate of a GPU layout, not
// a measurement of one. The CPU figure is a count of JavaScript arrays, reported as entries.

import { compile } from '../src/compiler/ts/compile.js';
import { compileModuleJs } from '../src/core/cpu-codegen.js';
import { ScatterRun } from '../src/core/kernel-tree.js';

const SOURCE = `"use typeshade";
export function splat(g: array<f32>, idx: array<u32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) {
    g[idx[i]] += x[i];
  }
}`;

/** A seeded generator, so each run of the script sees the same input. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = Number(process.env['SCATTER_N'] ?? 100_000);
const P = Number(process.env['SCATTER_P'] ?? 4096);
const REPS = Number(process.env['SCATTER_REPS'] ?? 3);

const r = compile(SOURCE, { fileName: 'splat.shade.ts' });
const errors = r.diagnostics.filter((d) => d.category === 'error');
if (errors.length > 0) throw new Error(`the kernel does not compile: ${errors[0]!.message}`);
const tree = compileModuleJs(r.module, { precision: 'f32' }).fns['splat']!;

const next = rng(0x0056);
const idx = Array.from({ length: N }, () => Math.floor(next() * P));
const x = Array.from({ length: N }, () => Math.fround((next() - 0.5) * 2));

/** Median of a sample, in milliseconds. */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function timeIt(run: () => void): number {
  const samples: number[] = [];
  for (let k = 0; k < REPS; k++) {
    const t0 = performance.now();
    run();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

const g0 = (): number[] => new Array<number>(P).fill(0);
const treeMs = timeIt(() => tree(g0(), idx, x));

// The sequential reading, as TypeScript means it: the same `+=` in iteration order, with no run.
const seqMs = timeIt(() => {
  const g = g0();
  for (let i = 0; i < N; i++) g[idx[i]!] = Math.fround(g[idx[i]!]! + x[i]!);
});

// Scratch: the run's own count of kept contributions, after the last iteration and before the fold,
// on the same input. The loop body and `end()` are the ones the generated code calls.
const run = new ScatterRun([g0()], true);
const v = run.view(0);
for (let i = 0; i < N; i++) {
  v[idx[i]!] = Math.fround((v[idx[i]!] as number) + x[i]!);
  run.end();
}
const entries = run.contributions;
const bytes = entries * 8;
run.finish();

// The shape option C's scratch depends on: one invocation adds its `K` splats to the elements of a
// tile (here `K` splats of one tile, each in its own iteration of the tile loop, `TILE` pixels per
// invocation). The count is the entries the run keeps, the same structure as above.
const TILE = Number(process.env['SCATTER_TILE'] ?? 256);
const invocations = Math.ceil(N / TILE);
const tileRun = new ScatterRun([g0()], true);
const tv = tileRun.view(0);
for (let inv = 0; inv < invocations; inv++) {
  // Each invocation's own contributions: the tile's splats in program order, with the element each
  // one hits drawn from the same list, so the input is the same as the flat run's.
  for (let i = inv * TILE; i < Math.min(N, (inv + 1) * TILE); i++) {
    tv[idx[i]!] = Math.fround((tv[idx[i]!] as number) + x[i]!);
  }
  tileRun.end();
}
const tileEntries = tileRun.contributions;
tileRun.finish();

const out = {
  measured: {
    iterations: N,
    elements: P,
    reps: REPS,
    treeOrderMs: Number(treeMs.toFixed(2)),
    sequentialMs: Number(seqMs.toFixed(2)),
    ratio: Number((treeMs / seqMs).toFixed(2)),
    scratchEntriesOneElementPerIteration: entries,
    scratchBytesEstimated: bytes,
    tileInvocations: invocations,
    tileSize: TILE,
    scratchEntriesPerInvocationTile: tileEntries,
  },
  note: 'times: median of REPS runs of the generated CPU code. scratch: entries the run keeps; bytes = entries x 8 is an estimate of a GPU layout, not a measurement of one.',
};
console.log(JSON.stringify(out, null, 2));
