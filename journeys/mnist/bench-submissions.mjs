// Is one submission for the four kernel calls of a training batch faster than four? (change 0058,
// step 2, decision 9)
//
// `batch.shade.ts` is one batch of the MNIST journey's softmax regression (batch 32, 784 pixels
// and a bias input, 10 classes) as four kernel functions: forward, objective, backward and
// update. This script calls them over `Resident` arrays on headless Chromium's WebGPU, which here
// is software (SwiftShader), two ways. Apart, as a host calls them today: four dispatches, four
// submissions. Inside one `fuse` scope from `typeshade/fuse`: four dispatches, one submission.
// Each sample is one batch, timed from the first call to `queue.onSubmittedWorkDone()`, and the
// two ways alternate so that drift in the machine falls on both. The script prints the median,
// the least and the most of each, what the device was given (the page counts `queue.submit` and
// `dispatchWorkgroups` on their prototypes), and whether the weights after one batch are the same
// bits both ways.
//
// What it measures is host wall time on a software device. It says what one submission costs
// against four, and not how fast a hardware GPU trains: SwiftShader executes on the CPU, and a
// real GPU's submit and its wait cost something else.
//
//   bun run build
//   TYPESHADE_CHROMIUM=/path/to/chrome node journeys/mnist/bench-submissions.mjs [--samples 20]

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { typeshade } from '../../dist/src/vite.js';

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
const DIST = normalize(join(HERE, '../../dist/src'));

/** The module the Vite plugin generates for the batch's kernel functions, written from a copy so
 *  that the host view the plugin writes beside a module lands in a temporary directory. */
const work = mkdtempSync(join(tmpdir(), 'typeshade-bench-'));
cpSync(join(HERE, 'batch.shade.ts'), join(work, 'batch.shade.ts'));
const shader = join(work, 'batch.shade.ts');
const generated = (await typeshade().transform(readFileSync(shader, 'utf8'), shader)).code;

/** Runs INSIDE the page. `opts` is the sample count and the warm-up batches. */
async function measure(opts) {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  const { forward, objective, backward, update } = await import('/batch.shade.ts');
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
  const calls = (s) => [
    () => forward(s.logits, shared.pixels, s.weights),
    () => objective(s.delta, s.logits, shared.labels, ROWS),
    () => backward(s.grad, shared.pixels, s.delta, ROWS),
    () => update(s.weights, s.grad, RATE),
  ];
  // Apart: the four calls are made one after another, as a host makes them, and each reaches the
  // queue on its own.
  const apart = async (s) => {
    await Promise.all(calls(s).map((call) => call()));
    await queue.onSubmittedWorkDone();
  };
  // In one scope: the four calls are recorded and run as one plan.
  let report;
  const together = async (s) => {
    report = await fuse(() => {
      for (const call of calls(s)) call();
    });
    await queue.onSubmittedWorkDone();
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

  const a = own();
  const b = own();
  // The first batch of each, which also builds the pipelines: apart and together must leave the
  // weights as the same bits.
  const seenApart = await counted(apart, a);
  const seenTogether = await counted(together, b);
  const [wa, wb] = [await a.weights.read(), await b.weights.read()];
  const same = wa.length === wb.length && wa.every((w, i) => Object.is(w, wb[i]));
  const moved = wa.some((w, i) => w !== start[i]);

  for (let i = 0; i < opts.warmup; i++) {
    await apart(a);
    await together(b);
  }
  const times = { apart: [], together: [] };
  const timed = async (name, run, s) => {
    const t0 = performance.now();
    await run(s);
    times[name].push(performance.now() - t0);
  };
  for (let i = 0; i < opts.samples; i++) {
    if (i % 2 === 0) {
      await timed('apart', apart, a);
      await timed('together', together, b);
    } else {
      await timed('together', together, b);
      await timed('apart', apart, a);
    }
  }
  const info = rt.device.adapterInfo ?? {};
  rt.destroy();
  return {
    times,
    seen: { apart: seenApart, together: seenTogether },
    report,
    same,
    moved,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      isFallbackAdapter: info.isFallbackAdapter,
    },
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const text = (body) => {
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.end(body);
  };
  if (url.pathname === '/batch.shade.ts') return text(generated);
  if (url.pathname.startsWith('/typeshade/')) {
    const file = normalize(join(DIST, url.pathname.slice('/typeshade/'.length)));
    if (!file.startsWith(DIST + sep) || extname(file) !== '.js') {
      res.statusCode = 404;
      return res.end();
    }
    return text(readFileSync(file, 'utf8'));
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><title>typeshade bench</title>' +
      '<script type="importmap">{"imports":{' +
      '"typeshade/runtime":"/typeshade/runtime.js",' +
      '"typeshade/runtime/internal":"/typeshade/runtime-internal.js",' +
      '"typeshade/fuse":"/typeshade/fuse.js"}}</script>',
  );
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  executablePath: process.env.TYPESHADE_CHROMIUM || undefined,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
});

const median = (xs) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
let failed = false;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const got = await page.evaluate(measure, { samples, warmup });
  const row = (name, key) => {
    const t = got.times[key];
    return {
      name,
      medianMs: Number(median(t).toFixed(2)),
      minMs: Number(Math.min(...t).toFixed(2)),
      maxMs: Number(Math.max(...t).toFixed(2)),
      submissions: got.seen[key].submits,
      dispatches: got.seen[key].dispatches,
    };
  };
  const rows = [row('four calls, one submission each', 'apart'), row('one fuse scope', 'together')];
  console.log(
    `One MNIST-shaped training batch (32 rows, 785 inputs, 10 classes), four kernel calls, ${samples} samples each after ${warmup} warm-up batches.`,
  );
  console.log(
    `WebGPU adapter: ${JSON.stringify(got.adapter)}. Host wall time to onSubmittedWorkDone.`,
  );
  console.table(rows);
  const ratio = rows[1].medianMs / rows[0].medianMs;
  console.log(
    `median ratio, fuse scope over four submissions: ${ratio.toFixed(2)} (${rows[1].medianMs} ms against ${rows[0].medianMs} ms)`,
  );
  console.log(`the scope's report: ${JSON.stringify(got.report)}`);
  console.log(
    `weights after one batch, apart and together: same bits ${got.same}, moved ${got.moved}`,
  );
  console.log(JSON.stringify({ samples, warmup, rows, same: got.same, report: got.report }));
  failed =
    !got.same ||
    !got.moved ||
    got.report.submissions !== 1 ||
    got.report.submissions !== got.seen.together.submits ||
    got.report.dispatches !== got.seen.together.dispatches;
  if (failed)
    console.error('FAIL: the two ways differ, or the report is not what the device was given');
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
