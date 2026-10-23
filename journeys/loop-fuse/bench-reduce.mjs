// Is one loop dispatch for a chain that ends in a reduction faster than the calls one by one?
// (change 0058, step 5: a reduction as the last call of a fused group)
//
// `ops.shade.ts` is the loop-fuse journey's chain, here `add`, `mul` and `total`: two maps and a
// sum, three kernel functions over `Resident` arrays. This script calls it on headless Chromium's
// WebGPU, which here is software (SwiftShader), four ways:
//
//   apart    as a host calls them today: `add` and `mul` are a dispatch and a submission each, and
//            `total` is its loop and one fold for each level of partials, all in one submission.
//   batched  inside one `fuse` scope over a module built without `typeshade({ fuse: true })`,
//            which has no facts to fuse by: `add`, `mul` and the dispatches of `total` (its loop
//            and one fold for each level of partials) are one submission (step 2, and the
//            follow-up of D7 for `total`).
//   fused    inside one `fuse` scope over the module built with the facts: the three calls are one
//            group, whose loop dispatch runs `add` and `mul` as the prologue of each iteration of
//            the sum, and one fold dispatch follows for each level of partials (step 5). The two
//            intermediates are `Resident`s, so the entry stores them.
//   scratch  the same scope with the two intermediates made by `scope.scratch()`: the entry holds
//            them as locals, and the device is asked for no buffer for either (step 4).
//
// Each sample is one run of the chain, timed from the first call to `queue.onSubmittedWorkDone()`,
// and the ways take turns in the order they run, so that drift in the machine falls on all of
// them. The script prints the median, the least and the most of each, what the device was given
// (the page counts `queue.submit`, `dispatchWorkgroups` and `createBuffer` on their prototypes; the
// buffers are those of a way's first run, with the inputs already on the device), and whether the
// sum is the same bits all four ways and the CPU tier's. The sum is the tree sum of Rule 7.2 on
// every tier, and the inputs are random `f32` numbers, for which the order of the additions
// changes the bits, so the same bits are the same order.
//
// What it measures is host wall time on a software device: it says what the dispatches and the
// submissions cost here, and not how fast a hardware GPU runs the chain. SwiftShader executes on
// the CPU, and a real GPU's submit and its wait cost something else.
//
//   bun run build
//   TYPESHADE_CHROMIUM=/path/to/chrome node journeys/loop-fuse/bench-reduce.mjs [--n 32768] [--samples 20]

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { typeshade } from '../../dist/src/vite.js';
import { inPage, row } from '../_bench.mjs';

const { values: flags } = parseArgs({
  options: {
    n: { type: 'string', default: '32768' },
    samples: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '5' },
  },
});
const [n, samples, warmup] = [Number(flags.n), Number(flags.samples), Number(flags.warmup)];
if (
  ![n, samples].every((x) => Number.isInteger(x) && x >= 1) ||
  !Number.isInteger(warmup) ||
  warmup < 0
)
  throw new Error('--n and --samples are positive whole numbers and --warmup a whole number');

const HERE = dirname(fileURLToPath(import.meta.url));

/** The module the Vite plugin generates for the chain, twice: without the facts a scope fuses
 *  by, and with them. It is written from a copy so that the host view the plugin writes beside a
 *  module lands in a temporary directory. */
const work = mkdtempSync(join(tmpdir(), 'typeshade-bench-'));
cpSync(join(HERE, 'ops.shade.ts'), join(work, 'ops.shade.ts'));
const shader = join(work, 'ops.shade.ts');
const source = readFileSync(shader, 'utf8');
const modules = {
  '/ops.shade.ts': (await typeshade({ fuse: false }).transform(source, shader)).code,
  '/ops.fused.shade.ts': (await typeshade({ fuse: true }).transform(source, shader)).code,
};

/** Runs INSIDE the page. `opts` is the length of the arrays, the samples and the warm-up runs. */
async function measure(opts) {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  const plain = await import('/ops.shade.ts');
  const fusing = await import('/ops.fused.shade.ts');
  const rt = await createRuntime({ prefer: ['webgpu'] });
  if (rt.tier !== 'webgpu') throw new Error(`the runtime runs on ${rt.tier}, not webgpu`);
  // The kernel calls run on the runtime's device, so the page can wait for it, and on WebGPU only:
  // a call that fell to another tier would be timed as if it had not.
  configure({ runtime: rt, prefer: ['webgpu'] });
  const { queue } = rt.device;

  const N = opts.n;
  // Random f32 numbers from a fixed seed: a sum of them depends on the order of its additions.
  const random = (seed) => {
    let x = seed >>> 0;
    return () =>
      Math.fround(((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 8);
  };
  const [a, b, c] = [1, 2, 3].map((seed) => Float32Array.from({ length: N }, random(seed)));
  const inputs = { a: resident(a), b: resident(b), c: resident(c) };
  /** The arrays one way owns. */
  const own = () => ({ t: resident(new Float32Array(N)), u: resident(new Float32Array(N)) });
  /** What each way last returned: the sum. */
  const sums = {};
  const ways = {
    apart: async (s) => {
      const calls = [
        plain.add(s.t, inputs.a, inputs.b),
        plain.mul(s.u, s.t, inputs.c),
        plain.total(s.u),
      ];
      sums.apart = (await Promise.all(calls))[2];
      await queue.onSubmittedWorkDone();
    },
    batched: async (s) => {
      let sum;
      reports.batched = await fuse(() => {
        plain.add(s.t, inputs.a, inputs.b);
        plain.mul(s.u, s.t, inputs.c);
        sum = plain.total(s.u);
      });
      sums.batched = await sum;
      await queue.onSubmittedWorkDone();
    },
    fused: async (s) => {
      let sum;
      reports.fused = await fuse(() => {
        fusing.add(s.t, inputs.a, inputs.b);
        fusing.mul(s.u, s.t, inputs.c);
        sum = fusing.total(s.u);
      });
      sums.fused = await sum;
      await queue.onSubmittedWorkDone();
    },
    scratch: async () => {
      let sum;
      reports.scratch = await fuse((scope) => {
        const [t, u] = [scope.scratch(N), scope.scratch(N)];
        fusing.add(t, inputs.a, inputs.b);
        fusing.mul(u, t, inputs.c);
        sum = fusing.total(u);
      });
      sums.scratch = await sum;
      await queue.onSubmittedWorkDone();
    },
  };
  const reports = {};

  // What the device is given for one run, counted on the prototypes it is given them through.
  const counted = async (run, s) => {
    const submit = GPUQueue.prototype.submit;
    const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups;
    const createBuffer = GPUDevice.prototype.createBuffer;
    const seen = { submits: 0, dispatches: 0, buffers: 0 };
    GPUQueue.prototype.submit = function (...a) {
      seen.submits++;
      return submit.apply(this, a);
    };
    GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...a) {
      seen.dispatches++;
      return dispatch.apply(this, a);
    };
    GPUDevice.prototype.createBuffer = function (...a) {
      seen.buffers++;
      return createBuffer.apply(this, a);
    };
    try {
      await run(s);
    } finally {
      GPUQueue.prototype.submit = submit;
      GPUComputePassEncoder.prototype.dispatchWorkgroups = dispatch;
      GPUDevice.prototype.createBuffer = createBuffer;
    }
    return seen;
  };

  const names = Object.keys(ways);
  const sets = Object.fromEntries(names.map((name) => [name, own()]));
  // The inputs go to the device first, by a run of another set, so that the buffers counted below
  // are the ones a way makes for its own arrays.
  await ways.apart(own());
  // The first run of each, which also builds the pipelines: all four ways must give the same
  // bits, and they must be the reference's.
  const seen = {};
  const first = {};
  for (const name of names) {
    seen[name] = await counted(ways[name], sets[name]);
    first[name] = sums[name];
  }
  // The CPU tier folds in the same tree order, so its sum is the device's, bit for bit.
  configure({ prefer: ['cpu'] });
  const cpu = own();
  await plain.add(cpu.t, inputs.a, inputs.b);
  await plain.mul(cpu.u, cpu.t, inputs.c);
  const reference = await plain.total(cpu.u);
  configure({ prefer: ['webgpu'] });
  const same = names.every((name) => Object.is(first[name], first.apart));
  const exact = Object.is(first.apart, reference);

  for (let i = 0; i < opts.warmup; i++) for (const name of names) await ways[name](sets[name]);
  const times = Object.fromEntries(names.map((name) => [name, []]));
  for (let i = 0; i < opts.samples; i++) {
    // The order they run in takes a turn: apart first, then batched, then fused.
    const turn = [...names.slice(i % names.length), ...names.slice(0, i % names.length)];
    for (const name of turn) {
      const t0 = performance.now();
      await ways[name](sets[name]);
      times[name].push(performance.now() - t0);
    }
  }
  // The sums of the timed runs are the first run's, in every way.
  const steady = names.every((name) => Object.is(sums[name], first.apart));
  const info = rt.device.adapterInfo ?? {};
  rt.destroy();
  return {
    names,
    times,
    seen,
    reports,
    sum: first.apart,
    same,
    exact,
    steady,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      isFallbackAdapter: info.isFallbackAdapter,
    },
  };
}

let failed = false;
try {
  const got = await inPage({ modules, measure, options: { n, samples, warmup } });
  const label = {
    apart: 'three calls, a submission for each call',
    batched: 'one fuse scope, built without the facts',
    fused: 'one fuse scope, built with the facts',
    scratch: 'the same, t and u scratch arrays',
  };
  const rows = got.names.map((name) => row(label[name], got.times[name], got.seen[name]));
  console.log(
    `add -> mul -> total over ${n} elements, ${samples} samples each after ${warmup} warm-up runs.`,
  );
  console.log(
    `WebGPU adapter: ${JSON.stringify(got.adapter)}. Host wall time to onSubmittedWorkDone.`,
  );
  console.table(rows);
  const [apart, batched, fused, scratch] = rows;
  const ratio = (x, y) => (x.medianMs / y.medianMs).toFixed(2);
  console.log(
    `median ratios: batched over apart ${ratio(batched, apart)}, fused over apart ${ratio(fused, apart)}, fused over batched ${ratio(fused, batched)}, scratch over apart ${ratio(scratch, apart)}, scratch over fused ${ratio(scratch, fused)}`,
  );
  console.log(`the fused scope's report: ${JSON.stringify(got.reports.fused)}`);
  console.log(`the scratch scope's report: ${JSON.stringify(got.reports.scratch)}`);
  console.log(
    `the sum, all four ways: ${got.sum}, same bits ${got.same}, the CPU tier's ${got.exact}, and the same in the timed runs ${got.steady}`,
  );
  console.log(JSON.stringify({ n, samples, warmup, rows, same: got.same, reports: got.reports }));
  // Each scope's report is what the device was given. The levels of the reduction are dispatches
  // of the plan's batch, so each scope is one submission, whatever the number of levels.
  const counts = (name) =>
    got.reports[name].submissions === got.seen[name].submits &&
    got.reports[name].dispatches === got.seen[name].dispatches;
  // The loop and one fold for each level of partials: 256 iterations to a workgroup, and 256
  // partials to a fold.
  let folds = 0;
  for (let count = Math.ceil(n / 256); count > 1; count = Math.ceil(count / 256)) folds++;
  failed =
    !got.same ||
    !got.exact ||
    !got.steady ||
    !counts('batched') ||
    !counts('fused') ||
    !counts('scratch') ||
    got.reports.fused.dispatches !== 1 + folds ||
    got.reports.scratch.dispatches !== 1 + folds ||
    got.reports.fused.submissions !== 1 ||
    got.reports.scratch.submissions !== 1 ||
    got.reports.fused.groups.length !== 1 ||
    got.reports.scratch.groups.length !== 1 ||
    // The scratch scope is asked for two buffers fewer than the same scope over residents.
    got.seen.fused.buffers - got.seen.scratch.buffers !== 2;
  if (failed) console.error('FAIL: the ways differ, or a report is not what the device was given');
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
