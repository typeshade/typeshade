// Is one dispatch for a chain faster than three? (change 0058, step 3: the measured improvement
// over unplanned execution that the computing-platform plan's P3 asks for; step 4: the same
// chain with its two intermediates scratch arrays)
//
// `ops.shade.ts` is the loop-fuse journey's chain, `add`, `mul` and `relu`, three kernel
// functions over `Resident` arrays. This script calls it on headless Chromium's WebGPU, which here
// is software (SwiftShader), four ways:
//
//   apart    as a host calls them today: three dispatches, three submissions.
//   batched  inside one `fuse` scope over a module built without `typeshade({ fuse: true })`, which
//            has no facts to fuse by: three dispatches, one submission (step 2).
//   fused    inside one `fuse` scope over the module built with `typeshade({ fuse: true })`: the
//            three calls are one dispatch, and the scope is one submission (step 3). The two
//            intermediates are `Resident`s, so the entry stores them.
//   scratch  the same scope with the two intermediates made by `scope.scratch()`: the entry holds
//            them as locals, and the device is asked for no buffer for either (step 4).
//
// Each sample is one run of the chain, timed from the first call to `queue.onSubmittedWorkDone()`,
// and the ways take turns in the order they run, so that drift in the machine falls on all of
// them. The script prints the median, the least and the most of each, what the device was given
// (the page counts `queue.submit`, `dispatchWorkgroups` and `createBuffer` on their prototypes; the
// buffers are those of a way's first run, with the inputs already on the device), and whether the
// result is the same bits all four ways and the reference's.
//
// What it measures is host wall time on a software device: it says what one dispatch costs against
// three, and not how fast a hardware GPU runs the chain. SwiftShader executes on the CPU, and a
// real GPU's submit and its wait cost something else.
//
//   bun run build
//   TYPESHADE_CHROMIUM=/path/to/chrome node journeys/loop-fuse/bench.mjs [--n 32768] [--samples 20]

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
  '/ops.shade.ts': (await typeshade().transform(source, shader)).code,
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
  // The kernel calls run on the runtime's device, so the page can wait for it.
  configure({ runtime: rt });
  const { queue } = rt.device;

  const N = opts.n;
  // Small dyadic numbers, so that every step is exact in f32 and the reference is the same bits.
  const a = Float32Array.from({ length: N }, (_, i) => (i % 7) - 3);
  const b = Float32Array.from({ length: N }, (_, i) => ((i % 5) - 2) * 0.5);
  const c = Float32Array.from({ length: N }, (_, i) => ((i % 3) - 1) * 0.25);
  const inputs = { a: resident(a), b: resident(b), c: resident(c) };
  /** The arrays one way owns. */
  const own = () => ({
    t: resident(new Float32Array(N)),
    u: resident(new Float32Array(N)),
    out: resident(new Float32Array(N)),
  });
  const calls = (m, s) => [
    () => m.add(s.t, inputs.a, inputs.b),
    () => m.mul(s.u, s.t, inputs.c),
    () => m.relu(s.out, s.u),
  ];
  const reports = {};
  const ways = {
    apart: async (s) => {
      await Promise.all(calls(plain, s).map((call) => call()));
      await queue.onSubmittedWorkDone();
    },
    batched: async (s) => {
      reports.batched = await fuse(() => {
        for (const call of calls(plain, s)) call();
      });
      await queue.onSubmittedWorkDone();
    },
    fused: async (s) => {
      reports.fused = await fuse(() => {
        for (const call of calls(fusing, s)) call();
      });
      await queue.onSubmittedWorkDone();
    },
    scratch: async (s) => {
      reports.scratch = await fuse((scope) => {
        const [t, u] = [scope.scratch(N), scope.scratch(N)];
        fusing.add(t, inputs.a, inputs.b);
        fusing.mul(u, t, inputs.c);
        fusing.relu(s.out, u);
      });
      await queue.onSubmittedWorkDone();
    },
  };

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
  // The first run of each, which also builds the pipelines: all four ways must write the same
  // bits, and they must be the reference's.
  const seen = {};
  for (const name of names) seen[name] = await counted(ways[name], sets[name]);
  const out = {};
  for (const name of names) out[name] = await sets[name].out.read();
  const reference = Float32Array.from(a, (x, i) => Math.max((x + b[i]) * c[i], 0));
  const same = names.every((name) => out[name].every((x, i) => Object.is(x, out.apart[i])));
  const exact = out.apart.every((x, i) => Object.is(x, reference[i]));

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
  const info = rt.device.adapterInfo ?? {};
  rt.destroy();
  return {
    names,
    times,
    seen,
    reports,
    same,
    exact,
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
    apart: 'three calls, one submission each',
    batched: 'one fuse scope, built without the facts',
    fused: 'one fuse scope, built with the facts',
    scratch: 'the same, t and u scratch arrays',
  };
  const rows = got.names.map((name) => row(label[name], got.times[name], got.seen[name]));
  console.log(
    `add -> mul -> relu over ${n} elements, ${samples} samples each after ${warmup} warm-up runs.`,
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
  console.log(`the output, all four ways: same bits ${got.same}, the reference's ${got.exact}`);
  console.log(JSON.stringify({ n, samples, warmup, rows, same: got.same, reports: got.reports }));
  // Each scope's report is what the device was given, and a scope is one submission.
  const counts = (name) =>
    got.reports[name].submissions === 1 &&
    got.reports[name].submissions === got.seen[name].submits &&
    got.reports[name].dispatches === got.seen[name].dispatches;
  failed =
    !got.same ||
    !got.exact ||
    !counts('batched') ||
    !counts('fused') ||
    !counts('scratch') ||
    got.reports.fused.dispatches !== 1 ||
    got.reports.scratch.dispatches !== 1 ||
    // The scratch scope asks the device for the buffers of `out` and of its uniform, and for none
    // for `t` or `u`: two fewer than the same scope over residents.
    got.seen.scratch.buffers !== 2 ||
    got.seen.fused.buffers - got.seen.scratch.buffers !== 2;
  if (failed) console.error('FAIL: the ways differ, or a report is not what the device was given');
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
