// Is one submission for the four kernel calls of a training batch faster than four, and is one
// dispatch for the calls that fuse faster still? (change 0058, steps 2 and 3, decision 9)
//
// `batch.shade.ts` is one batch of the MNIST journey's softmax regression (batch 32, 784 pixels
// and a bias input, 10 classes) as four kernel functions: forward, objective, backward and
// update. This script calls them over `Resident` arrays on headless Chromium's WebGPU, which here
// is software (SwiftShader), three ways:
//
//   apart    as a host calls them today: four dispatches, four submissions.
//   batched  inside one `fuse` scope over a module built without `typeshade({ fuse: true })`, which
//            has no facts to fuse by: four dispatches, one submission (step 2).
//   fused    inside one `fuse` scope over the module built with `typeshade({ fuse: true })`: the
//            calls the facts allow are one dispatch, and the scope is one submission (step 3).
//            `backward` writes `grad` at `k` and `update` reads it at `k`, so those two are one
//            dispatch. The other pairs stay apart, and the report says why: `objective` reads
//            `logits` at `row * 10 + k` and not at its own index, and `backward` runs over the
//            7,850 weights where `objective` runs over the 320 logits.
//
// Each sample is one batch, timed from the first call to `queue.onSubmittedWorkDone()`, and the
// three ways take turns in the order they run, so that drift in the machine falls on all of them.
// The script prints the median, the least and the most of each, what the device was given (the
// page counts `queue.submit` and `dispatchWorkgroups` on their prototypes), the scope's reports,
// and whether the weights after one batch are the same bits all three ways.
//
// What it measures is host wall time on a software device. It says what one submission costs
// against four, and one dispatch against several, and not how fast a hardware GPU trains:
// SwiftShader executes on the CPU, and a real GPU's submit and its wait cost something else.
//
//   bun run build
//   TYPESHADE_CHROMIUM=/path/to/chrome node journeys/mnist/bench-submissions.mjs [--samples 20]

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { typeshade } from '../../dist/src/vite.js';
import { inPage, row } from '../_bench.mjs';

const { values: flags } = parseArgs({
  options: {
    samples: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '5' },
  },
});
const samples = Number(flags.samples);
const warmup = Number(flags.warmup);
if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(warmup) || warmup < 0)
  throw new Error('--samples is a positive whole number and --warmup a whole number');

const HERE = dirname(fileURLToPath(import.meta.url));

/** The module the Vite plugin generates for the batch's kernel functions, twice: without the
 *  facts a scope fuses by, and with them. It is written from a copy so that the host view the
 *  plugin writes beside a module lands in a temporary directory. */
const work = mkdtempSync(join(tmpdir(), 'typeshade-bench-'));
cpSync(join(HERE, 'batch.shade.ts'), join(work, 'batch.shade.ts'));
const shader = join(work, 'batch.shade.ts');
const source = readFileSync(shader, 'utf8');
const modules = {
  '/batch.shade.ts': (await typeshade().transform(source, shader)).code,
  '/batch.fused.shade.ts': (await typeshade({ fuse: true }).transform(source, shader)).code,
};

/** Runs INSIDE the page. `opts` is the sample count and the warm-up batches. */
async function measure(opts) {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  const plain = await import('/batch.shade.ts');
  const fusing = await import('/batch.fused.shade.ts');
  const rt = await createRuntime({ prefer: ['webgpu'] });
  if (rt.tier !== 'webgpu') throw new Error(`the runtime runs on ${rt.tier}, not webgpu`);
  // The kernel calls run on the runtime's device, so the page can wait for it.
  configure({ runtime: rt });
  const { queue } = rt.device;

  const ROWS = 32;
  const INPUTS = 785;
  const CLASSES = 10;
  const RATE = 0.1;
  let seed = 123;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const pixels = new Float32Array(ROWS * INPUTS);
  for (let r = 0; r < ROWS; r++) {
    for (let p = 0; p < INPUTS - 1; p++) pixels[r * INPUTS + p] = Math.fround(next());
    pixels[r * INPUTS + INPUTS - 1] = 1;
  }
  const labels = Uint32Array.from({ length: ROWS }, () => Math.floor(next() * CLASSES));
  const start = Float32Array.from({ length: INPUTS * CLASSES }, () =>
    Math.fround((next() - 0.5) * 0.02),
  );
  const shared = { pixels: resident(pixels), labels: resident(labels) };
  /** The arrays one way of training owns: its weights start as `start`. */
  const own = () => ({
    weights: resident(start.slice()),
    logits: resident(new Float32Array(ROWS * CLASSES)),
    delta: resident(new Float32Array(ROWS * CLASSES)),
    grad: resident(new Float32Array(INPUTS * CLASSES)),
  });
  const calls = (m, s) => [
    () => m.forward(s.logits, shared.pixels, s.weights),
    () => m.objective(s.delta, s.logits, shared.labels, ROWS),
    () => m.backward(s.grad, shared.pixels, s.delta, ROWS),
    () => m.update(s.weights, s.grad, RATE),
  ];
  const reports = {};
  const ways = {
    // The four calls are made one after another, as a host makes them, and each reaches the queue
    // on its own.
    apart: async (s) => {
      await Promise.all(calls(plain, s).map((call) => call()));
      await queue.onSubmittedWorkDone();
    },
    // The four calls are recorded and run as one plan: with no facts, each is a group of its own.
    batched: async (s) => {
      reports.batched = await fuse(() => {
        for (const call of calls(plain, s)) call();
      });
      await queue.onSubmittedWorkDone();
    },
    // The same plan over the module built for fusion.
    fused: async (s) => {
      reports.fused = await fuse(() => {
        for (const call of calls(fusing, s)) call();
      });
      await queue.onSubmittedWorkDone();
    },
  };

  // What the device is given for one batch, counted on the prototypes it is given them through.
  const counted = async (run, s) => {
    const submit = GPUQueue.prototype.submit;
    const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups;
    const seen = { submits: 0, dispatches: 0 };
    GPUQueue.prototype.submit = function (...a) {
      seen.submits++;
      return submit.apply(this, a);
    };
    GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...a) {
      seen.dispatches++;
      return dispatch.apply(this, a);
    };
    try {
      await run(s);
    } finally {
      GPUQueue.prototype.submit = submit;
      GPUComputePassEncoder.prototype.dispatchWorkgroups = dispatch;
    }
    return seen;
  };

  const names = Object.keys(ways);
  const sets = Object.fromEntries(names.map((n) => [n, own()]));
  // The first batch of each, which also builds the pipelines: all three ways must leave the
  // weights as the same bits.
  const seen = {};
  for (const n of names) seen[n] = await counted(ways[n], sets[n]);
  const weights = {};
  for (const n of names) weights[n] = await sets[n].weights.read();
  const same = names.every(
    (n) =>
      weights[n].length === weights.apart.length &&
      weights[n].every((w, i) => Object.is(w, weights.apart[i])),
  );
  const moved = weights.apart.some((w, i) => w !== start[i]);

  for (let i = 0; i < opts.warmup; i++) for (const n of names) await ways[n](sets[n]);
  const times = Object.fromEntries(names.map((n) => [n, []]));
  for (let i = 0; i < opts.samples; i++) {
    // The order they run in takes a turn: apart first, then batched, then fused.
    const turn = [...names.slice(i % names.length), ...names.slice(0, i % names.length)];
    for (const n of turn) {
      const t0 = performance.now();
      await ways[n](sets[n]);
      times[n].push(performance.now() - t0);
    }
  }
  const info = rt.device.adapterInfo ?? {};
  rt.destroy();
  return {
    names,
    times,
    seen,
    reports,
    same,
    moved,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      isFallbackAdapter: info.isFallbackAdapter,
    },
  };
}

let failed = false;
try {
  const got = await inPage({ modules, measure, options: { samples, warmup } });
  const label = {
    apart: 'four calls, one submission each',
    batched: 'one fuse scope, built without the facts',
    fused: 'one fuse scope, built with the facts',
  };
  const rows = got.names.map((n) => row(label[n], got.times[n], got.seen[n]));
  console.log(
    `One MNIST-shaped training batch (32 rows, 785 inputs, 10 classes), four kernel calls, ${samples} samples each after ${warmup} warm-up batches.`,
  );
  console.log(
    `WebGPU adapter: ${JSON.stringify(got.adapter)}. Host wall time to onSubmittedWorkDone.`,
  );
  console.table(rows);
  const [apart, batched, fused] = rows;
  const ratio = (a, b) => (a.medianMs / b.medianMs).toFixed(2);
  console.log(
    `median ratios: batched over apart ${ratio(batched, apart)}, fused over apart ${ratio(fused, apart)}, fused over batched ${ratio(fused, batched)}`,
  );
  console.log(`the batched scope's report: ${JSON.stringify(got.reports.batched)}`);
  console.log(`the fused scope's report: ${JSON.stringify(got.reports.fused)}`);
  console.log(`weights after one batch, all three ways: same bits ${got.same}, moved ${got.moved}`);
  console.log(JSON.stringify({ samples, warmup, rows, same: got.same, reports: got.reports }));
  // Each scope's report is what the device was given, and a scope is one submission.
  const counts = (n) =>
    got.reports[n].submissions === 1 &&
    got.reports[n].submissions === got.seen[n].submits &&
    got.reports[n].dispatches === got.seen[n].dispatches;
  failed = !got.same || !got.moved || !counts('batched') || !counts('fused');
  if (failed) console.error('FAIL: the ways differ, or a report is not what the device was given');
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
