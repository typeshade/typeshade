// ═══ The performance gate: what the compiled kernels cost on a device, measured, not inferred ═══
//
//   bun run build && bun run gate:perf [--samples 20] [--warmup 5] [--n 1048576] [--hardware]
//                                      [--software] [--record] [--check] [--tolerance 0.25]
//
// The compile gate says a program compiles and the journeys say it computes the right values;
// neither says what it costs. Every optimization proposal's validation asks for a measurement on
// a hardware adapter, and until this gate each proposal recorded that step as not run. This gate
// runs a fixed corpus of kernel chains through the runtime on a WebGPU device and reports, per
// case, the wall time of one run (from the first call to `queue.onSubmittedWorkDone()`) and,
// where the device has `timestamp-query`, the GPU time of the plan's compute passes (the fuse
// report's `gpuTime`, change 0066). The corpus is what a host writes today, through the Vite
// plugin's module and `fuse` over `Resident` arrays:
//
//   chain      add, mul, relu over `n` elements, one fused dispatch (journeys/loop-fuse)
//   reduce     add, mul, then the sum `total` over `n` elements: the loop and its folds
//   tonemap    `exposure` then the reduction `peak` over `n` pixels (examples/hosts/host-kernel)
//   batch      one softmax-regression batch of 128 rows: forward, objective, backward, update
//              (journeys/mnist)
//   branch     a loop whose body chooses between a costly helper and the input by a condition
//              that holds for one element in four, in runs of 256 (`journeys/loop-fuse/branch.shade.ts`,
//              change 0097)
//
// Prove the instrument before believing a number (AGENTS.md): the chain is also run over `n / 4`
// elements, and the gate fails unless four times the work costs more time, by GPU time where the
// device measures it and by wall time otherwise. A device that cannot show that difference cannot
// show a regression either.
//
// Two devices:
//   - CI runs it on SwiftShader, a software device, with few samples. Those numbers say what one
//     instruction costs on a CPU executing WebGPU, which is not a GPU's cost; CI keeps the proof
//     of the instrument and the shape of the report. `--software` lets a software device be
//     recorded and checked as a baseline of the machine that recorded it: the owner's decision of
//     2026-10-26, until a hardware baseline exists. CI records its own run (the record is printed
//     between `--- record ---` lines, for `perf/google-swiftshader.json`) and checks the run
//     against the committed one, with a wide tolerance, since one runner differs from the next.
//   - `--hardware` launches Chromium without the software flags, so the page gets the machine's
//     own adapter. `--record` writes `perf/<vendor>-<architecture>.json`, the baseline of that
//     device; `--check` compares this run's medians with that file and fails on a case slower
//     than the baseline by more than `--tolerance` (0.25: a quarter). `docs/performance.md` is
//     the procedure, and the owner's device of `docs/hardware-notes.md` the configuration the
//     baselines are meant for.
//
// A timing depends on the machine: a baseline is compared only with a run on the same adapter
// key (vendor and architecture, as `GPUAdapterInfo` reports them), and the record carries the
// commit, the browser and the sample count the numbers came from. Chromium rounds a timestamp
// to a coarser step unless told otherwise, so the GPU times are the coarse ones every host sees.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { typeshade } from '../src/vite.js';
import { inPage, median } from '../journeys/_bench.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PERF = join(ROOT, 'perf');

const { values: flags } = parseArgs({
  options: {
    samples: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '5' },
    n: { type: 'string', default: String(1 << 20) },
    hardware: { type: 'boolean', default: false },
    software: { type: 'boolean', default: false },
    record: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    tolerance: { type: 'string', default: '0.25' },
  },
});
const samples = Number(flags.samples);
const warmup = Number(flags.warmup);
const n = Number(flags.n);
const tolerance = Number(flags.tolerance);
if (!Number.isInteger(samples) || samples < 1)
  throw new Error('--samples is a positive whole number');
if (!Number.isInteger(warmup) || warmup < 0) throw new Error('--warmup is a whole number');
if (!Number.isInteger(n) || n < 1024 || n % 4 !== 0)
  throw new Error('--n is a multiple of 4, at least 1024');
if (!(tolerance >= 0)) throw new Error('--tolerance is a fraction, 0.25 for a quarter');

/** The shader modules of the corpus, built by the Vite plugin with the facts a scope fuses by,
 *  from copies, so the host view the plugin writes beside a module lands in a temporary
 *  directory. */
const work = mkdtempSync(join(tmpdir(), 'typeshade-perf-'));
const SOURCES: readonly (readonly [string, string])[] = [
  ['/ops.shade.ts', join(ROOT, 'journeys/loop-fuse/ops.shade.ts')],
  ['/batch.shade.ts', join(ROOT, 'journeys/mnist/batch.shade.ts')],
  ['/host-kernel.shade.ts', join(ROOT, 'examples/hosts/host-kernel/host-kernel.shade.ts')],
  ['/branch.shade.ts', join(ROOT, 'journeys/loop-fuse/branch.shade.ts')],
];
const modules: Record<string, string> = {};
try {
  const plugin = typeshade({ fuse: true });
  for (const [url, path] of SOURCES) {
    const copy = join(work, url.slice(1));
    cpSync(path, copy);
    const out = await plugin.transform(readFileSync(copy, 'utf8'), copy);
    if (out === null || out === undefined) throw new Error(`the plugin did not transform ${url}`);
    modules[url] = typeof out === 'string' ? out : out.code;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** One case's samples: the wall time of each run and, where the device measured it, the GPU
 *  time of each run's compute passes; and what the device was given for one run. */
interface Samples {
  readonly wallMs: number[];
  /** `null` where the device did not measure a run. */
  readonly gpuMs: (number | null)[];
  readonly dispatches: number;
  readonly submissions: number;
}
interface Measured {
  readonly adapter: { vendor: string; architecture: string; device: string; description: string };
  readonly timestampQuery: boolean;
  readonly userAgent: string;
  readonly cases: Record<string, Samples>;
}

/** Runs INSIDE the page: the corpus, each case `opts.warmup` runs to warm the pipelines and the
 *  caches, then `opts.samples` runs, the cases taking turns in the order they run, so that drift
 *  in the machine falls on all of them alike. */
async function measure(opts: { n: number; samples: number; warmup: number }): Promise<Measured> {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  // The corpus modules the page serves; loaded by URL, which no type names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const load = (url: string): Promise<Record<string, (...args: any[]) => any>> => import(url);
  const ops = await load('/ops.shade.ts');
  const batch = await load('/batch.shade.ts');
  const tone = await load('/host-kernel.shade.ts');
  const branch = await load('/branch.shade.ts');
  const gpu = (navigator as unknown as { gpu: GPU }).gpu;
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error('WebGPU gave no adapter');
  const timestampQuery = adapter.features.has('timestamp-query');
  // The runtime takes the device, so that the plans' passes carry timestamps where the adapter
  // has them: `createRuntime` alone requests the features the programs need, and none does.
  const device = await adapter.requestDevice({
    requiredFeatures: timestampQuery ? ['timestamp-query'] : [],
  });
  const rt = await createRuntime({ device });
  if (rt.tier !== 'webgpu') throw new Error(`the runtime runs on ${rt.tier}, not webgpu`);
  configure({ runtime: rt });
  const { queue } = rt.device as unknown as { queue: GPUQueue };
  const info = adapter.info;

  let seed = 123;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const floats = (count: number, f: (i: number) => number) =>
    Float32Array.from({ length: count }, (_, i) => f(i));

  /** A case: its arrays, made once, and the scope that runs it once. */
  interface Case {
    readonly run: () => Promise<FuseReportLike>;
  }
  interface FuseReportLike {
    readonly dispatches: number;
    readonly submissions: number;
    readonly groups: readonly { readonly gpuTime?: number }[];
  }
  const chainOf = (count: number): Case => {
    const a = resident(floats(count, (i) => (i % 7) - 3));
    const b = resident(floats(count, (i) => ((i % 5) - 2) * 0.5));
    const c = resident(floats(count, (i) => ((i % 3) - 1) * 0.25));
    const out = resident(new Float32Array(count));
    return {
      run: () =>
        fuse((scope) => {
          const t = scope.scratch(count);
          const u = scope.scratch(count);
          ops.add(t, a, b);
          ops.mul(u, t, c);
          ops.relu(out, u);
        }) as Promise<FuseReportLike>,
    };
  };
  const reduceOf = (count: number): Case => {
    const a = resident(floats(count, (i) => (i % 7) - 3));
    const b = resident(floats(count, (i) => ((i % 5) - 2) * 0.5));
    const c = resident(floats(count, (i) => ((i % 3) - 1) * 0.25));
    return {
      run: async () => {
        let sum: Promise<number> | undefined;
        const report = (await fuse((scope) => {
          const t = scope.scratch(count);
          const u = scope.scratch(count);
          ops.add(t, a, b);
          ops.mul(u, t, c);
          sum = ops.total(u);
        })) as FuseReportLike;
        await sum;
        return report;
      },
    };
  };
  const tonemapOf = (count: number): Case => {
    const pixels = resident(floats(count, (i) => (i % 64) / 16));
    return {
      run: async () => {
        let peak: Promise<number> | undefined;
        const report = (await fuse(() => {
          tone.exposure(1.5, pixels);
          peak = tone.peak(pixels);
        })) as FuseReportLike;
        await peak;
        return report;
      },
    };
  };
  const batchOf = (rows: number): Case => {
    const INPUTS = 785;
    const CLASSES = 10;
    const pixels = new Float32Array(rows * INPUTS);
    for (let r = 0; r < rows; r++) {
      for (let p = 0; p < INPUTS - 1; p++) pixels[r * INPUTS + p] = Math.fround(next());
      pixels[r * INPUTS + INPUTS - 1] = 1;
    }
    const s = {
      pixels: resident(pixels),
      labels: resident(Uint32Array.from({ length: rows }, () => Math.floor(next() * CLASSES))),
      weights: resident(floats(INPUTS * CLASSES, () => Math.fround((next() - 0.5) * 0.02))),
      logits: resident(new Float32Array(rows * CLASSES)),
      delta: resident(new Float32Array(rows * CLASSES)),
      grad: resident(new Float32Array(INPUTS * CLASSES)),
    };
    return {
      run: () =>
        fuse(() => {
          batch.forward(s.logits, s.pixels, s.weights);
          batch.objective(s.delta, s.logits, s.labels, rows);
          batch.backward(s.grad, s.pixels, s.delta, rows);
          batch.update(s.weights, s.grad, 0.1);
        }) as Promise<FuseReportLike>,
    };
  };

  const branchOf = (count: number): Case => {
    // One element in four is above 0.75, in runs of 256: lanes that agree take one arm, and
    // the costly arm runs for the quarter alone under an `if`. A per-lane random condition would
    // make nearly every workgroup run both arms, on a GPU and on SwiftShader alike.
    const xs = resident(floats(count, (i) => Math.fround((i % 1024) / 1024)));
    const out = resident(new Float32Array(count));
    return {
      run: () =>
        fuse(() => {
          branch.branchy(out, xs);
        }) as Promise<FuseReportLike>,
    };
  };

  const cases: Record<string, Case> = {
    chain: chainOf(opts.n),
    'chain/4': chainOf(opts.n / 4),
    reduce: reduceOf(opts.n),
    tonemap: tonemapOf(opts.n),
    batch: batchOf(128),
    branch: branchOf(opts.n),
  };
  const out: Record<
    string,
    { wallMs: number[]; gpuMs: (number | null)[]; dispatches: number; submissions: number }
  > = {};
  for (const name of Object.keys(cases))
    out[name] = { wallMs: [], gpuMs: [], dispatches: 0, submissions: 0 };
  const once = async (name: string, keep: boolean) => {
    const start = performance.now();
    const report = await cases[name]!.run();
    await queue.onSubmittedWorkDone();
    const wall = performance.now() - start;
    if (!keep) return;
    const times = report.groups.map((g) => g.gpuTime);
    const gpu =
      times.length > 0 && times.every((t) => typeof t === 'number')
        ? times.reduce((p, q) => p! + q!, 0)! / 1e6
        : null;
    out[name]!.wallMs.push(wall);
    out[name]!.gpuMs.push(gpu);
    out[name]!.dispatches = report.dispatches;
    out[name]!.submissions = report.submissions;
  };
  for (let i = 0; i < opts.warmup; i++)
    for (const name of Object.keys(cases)) await once(name, false);
  for (let i = 0; i < opts.samples; i++)
    for (const name of Object.keys(cases)) await once(name, true);
  return {
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    },
    timestampQuery,
    userAgent: navigator.userAgent,
    cases: out,
  };
}

const measured = await inPage({
  modules,
  measure,
  options: { n, samples, warmup },
  hardware: flags.hardware,
});

// ─── The report ───

interface Row {
  readonly name: string;
  readonly wallMs: number;
  readonly wallMinMs: number;
  readonly wallMaxMs: number;
  /** The median GPU time, or null where the device did not measure every sample. */
  readonly gpuMs: number | null;
  readonly dispatches: number;
  readonly submissions: number;
}
const round = (x: number): number => Number(x.toFixed(3));
const rows: Row[] = Object.entries(measured.cases).map(([name, s]) => ({
  name,
  wallMs: round(median(s.wallMs)),
  wallMinMs: round(Math.min(...s.wallMs)),
  wallMaxMs: round(Math.max(...s.wallMs)),
  gpuMs: s.gpuMs.every((g): g is number => g !== null) ? round(median(s.gpuMs)) : null,
  dispatches: s.dispatches,
  submissions: s.submissions,
}));
const key = `${measured.adapter.vendor || 'unknown'}-${measured.adapter.architecture || 'unknown'}`;
const software = /swiftshader/i.test(
  `${measured.adapter.vendor} ${measured.adapter.architecture} ${measured.adapter.description}`,
);
console.log(
  `perf gate: ${key}${measured.adapter.device ? ` (${measured.adapter.device})` : ''}` +
    `${software ? ', a software device' : ''}; timestamp-query ${measured.timestampQuery ? 'yes' : 'no'}; ` +
    `n = ${n}, ${samples} sample(s) after ${warmup} warm-up run(s)`,
);
console.table(rows.map((r) => ({ ...r, gpuMs: r.gpuMs ?? 'n/a' })));

// ─── Prove the instrument ───

const byName = new Map(rows.map((r) => [r.name, r]));
const full = byName.get('chain')!;
const quarter = byName.get('chain/4')!;
const measureOf = (r: Row): number =>
  full.gpuMs !== null && quarter.gpuMs !== null ? r.gpuMs! : r.wallMs;
const ratio = measureOf(full) / measureOf(quarter);
const by = full.gpuMs !== null && quarter.gpuMs !== null ? 'GPU time' : 'wall time';
let failed = false;
if (!(ratio >= 1.3)) {
  console.error(
    `FAIL instrument: the chain over ${n} elements costs ${ratio.toFixed(2)}x the chain over ${n / 4} by ${by}; ` +
      `four times the work must cost more time (at least 1.3x), or the gate cannot see a regression either. ` +
      `Raise --n, or raise --samples on a noisy machine.`,
  );
  failed = true;
} else console.log(`ok   instrument: four times the work costs ${ratio.toFixed(2)}x by ${by}`);

// ─── The record and the baseline ───

interface Record_ {
  readonly adapterKey: string;
  readonly adapter: Measured['adapter'];
  readonly software: boolean;
  /** The processor, which is the device where `software` is true. */
  readonly cpu: string;
  readonly timestampQuery: boolean;
  readonly userAgent: string;
  readonly commit: string;
  readonly recordedAt: string;
  readonly n: number;
  readonly samples: number;
  readonly warmup: number;
  readonly rows: readonly Row[];
}
const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
const cpu = `${cpus()[0]?.model.trim() ?? 'unknown'} x${cpus().length}`;
const record: Record_ = {
  adapterKey: key,
  adapter: measured.adapter,
  software,
  cpu,
  timestampQuery: measured.timestampQuery,
  userAgent: measured.userAgent,
  commit,
  recordedAt: new Date().toISOString(),
  n,
  samples,
  warmup,
  rows,
};
const baselinePath = join(PERF, `${key}.json`);
// The check reads the committed baseline before `--record` writes this run over it.
if (flags.check) {
  if (!existsSync(baselinePath)) {
    console.log(
      `no baseline for ${key} (${baselinePath}); nothing compared. Record one with --hardware --record` +
        `${software ? ', or --software --record on the machine the baseline is for' : ''}.`,
    );
  } else {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record_;
    if (baseline.n !== n) {
      console.error(
        `FAIL check: the baseline was recorded at n = ${baseline.n}; run with --n ${baseline.n}`,
      );
      failed = true;
    } else {
      console.log(
        `check against ${baselinePath} (recorded at ${baseline.commit.slice(0, 8)}, ${baseline.recordedAt}), tolerance ${tolerance}`,
      );
      if (baseline.software && baseline.cpu !== cpu)
        console.log(
          `note: a software baseline is the processor's; it was recorded on ${baseline.cpu}, this run is on ${cpu}`,
        );
      for (const was of baseline.rows) {
        const now = byName.get(was.name);
        if (now === undefined) {
          console.error(`FAIL ${was.name}: the baseline has a case this run has not`);
          failed = true;
          continue;
        }
        const useGpu = was.gpuMs !== null && now.gpuMs !== null;
        const before = useGpu ? was.gpuMs! : was.wallMs;
        const after = useGpu ? now.gpuMs! : now.wallMs;
        const change = after / before - 1;
        const verdict = change > tolerance ? 'FAIL' : 'ok  ';
        if (change > tolerance) failed = true;
        console.log(
          `${verdict} ${was.name.padEnd(8)} ${useGpu ? 'GPU ' : 'wall'} ${before.toFixed(3)} ms -> ${after.toFixed(3)} ms (${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%)`,
        );
      }
    }
  }
}
if (flags.record) {
  if (software && !flags.software) {
    console.error(
      'FAIL record: a software device is no baseline; run with --hardware on the machine the baseline is for, ' +
        'or with --software to record this device as the baseline of this processor',
    );
    failed = true;
  } else {
    const text = `${JSON.stringify(record, null, 2)}\n`;
    mkdirSync(PERF, { recursive: true });
    writeFileSync(baselinePath, text);
    console.log(`recorded ${baselinePath} at ${commit.slice(0, 8)}`);
    // The record itself, so that a run on a machine nobody commits from (CI) can be copied into
    // the repository from its log.
    console.log(`--- record ---\n${text}--- end of record ---`);
  }
}
if (failed) process.exit(1);
