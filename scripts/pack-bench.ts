// ═══ What a flat f32 array costs to validate, upload and read back on the host ═══
//
// The call layer packs every array argument of a kernel or entry call into its layout's bytes,
// validates it on the way, and unpacks a written array when the call returns. For a runtime-sized
// array of `f32`, `i32` or `u32` whose host value is the matching typed array, those bytes are the
// typed array's own bytes, so the work is one copy and not one `DataView` call per element.
// This script measures the three steps on the host, the work every tier shares before and after
// the device is touched. The validation is timed both ways: the dry pack the call ran before the
// change, and the `byteSize` check it runs now for a flat typed array. It does not measure the
// GPU: Node has no WebGPU device, and a Chromium measurement is a separate run.
//
//   bun scripts/pack-bench.ts [elements] [repetitions]
//
// The steps are timed in turn, each as a median of the repetitions, after a warm-up. The spread
// (the minimum and the maximum) is printed beside the median, so a single lucky run is visible.
// The script is not a CI gate: a timing depends on the machine it runs on.

import { packed, byteSize, pack, readInto, type EntryBinding } from '../src/core/host-entry.js';

const n = Number(process.argv[2] ?? 1_000_000);
const reps = Number(process.argv[3] ?? 15);

const binding: EntryBinding = {
  name: 'xs',
  group: 0,
  binding: 0,
  space: 'storage',
  writes: true,
  layout: { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } },
  s: 'array<f32>',
};

const host = new Float32Array(n);
for (let i = 0; i < n; i++) host[i] = Math.sin(i) * 1e3;

/** The validation a call ran before the change: a dry pack into scratch memory. On a checkout
 *  that has the bulk copy, `pack` takes it too, so this row then times one copy and not the old
 *  element loop: run the script on the parent commit (copy the file there) for the old cost. */
function validateByPack(): void {
  const size = byteSize(binding.layout, host, '');
  pack(new DataView(new ArrayBuffer(Math.max(4, size))), 0, binding.layout, host, '');
}

/** The validation a call runs now: `byteSize` checks the typed array's type, length and emptiness,
 *  and a flat typed array needs nothing more (`checkArray` skips the dry pack for it). */
function validateByLayout(): void {
  byteSize(binding.layout, host, '');
}

/** The upload: the bytes a binding is packed into. */
function upload(): ArrayBuffer {
  return packed(binding, host);
}

const bytes = upload();
const target = new Float32Array(n);

/** The readback of a written array into the caller's typed array. */
function readback(): void {
  readInto(new DataView(bytes), 0, binding.layout, target);
}

function time(f: () => void): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

function summary(samples: number[]): string {
  const s = [...samples].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)]!;
  return `median ${median.toFixed(3)} ms  (min ${s[0]!.toFixed(3)}, max ${s[s.length - 1]!.toFixed(3)})`;
}

const steps: [string, () => void][] = [
  ['validate (dry pack)', validateByPack],
  ['validate (byteSize)', validateByLayout],
  ['upload (packed)', () => void upload()],
  ['readback (readInto)', readback],
];

console.log(`flat f32 array, ${n} elements (${(n * 4) / 1e6} MB), ${reps} repetitions`);
console.log(`node ${process.version}, ${process.platform} ${process.arch}`);
for (const [label, f] of steps) {
  for (let w = 0; w < 3; w++) f();
  const samples: number[] = [];
  for (let r = 0; r < reps; r++) samples.push(time(f));
  console.log(`${label.padEnd(22)} ${summary(samples)}`);
}
