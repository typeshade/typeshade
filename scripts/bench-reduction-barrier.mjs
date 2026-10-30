// Run with Bun, after build. --base is a checkout with its compiler dependencies installed.
// Both compilers transform the SAME source; one runtime/device alternates the resulting kernels.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inPage, median } from '../journeys/_bench.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    samples: { type: 'string', default: '61' },
    warmup: { type: 'string', default: '10' },
    n: { type: 'string', default: '262144' },
    output: { type: 'string', default: 'artifacts/barrier-interleaved.json' },
  },
});
if (!values.base) throw new Error('--base must name the baseline checkout');
const samples = Number(values.samples),
  warmup = Number(values.warmup),
  n = Number(values.n);
if (
  !Number.isInteger(samples) ||
  samples < 3 ||
  !Number.isInteger(warmup) ||
  warmup < 1 ||
  !Number.isInteger(n) ||
  n < 1024 ||
  n % 4 !== 0
)
  throw new Error('Require samples >= 3, warmup >= 1 and n >= 1024 divisible by 4');
const base = resolve(values.base);
const modules = {},
  sources = {};
for (const [variant, checkout] of [
  ['before', base],
  ['after', root],
]) {
  const { typeshade } = await import(pathToFileURL(join(checkout, 'src/vite.ts')).href);
  const temp = mkdtempSync(join(tmpdir(), 'barrier-bench-'));
  try {
    const plugin = typeshade({ fuse: true });
    for (const [name, source] of [
      ['ops', 'journeys/loop-fuse/ops.shade.ts'],
      ['tone', 'examples/hosts/host-kernel/host-kernel.shade.ts'],
    ]) {
      const code = readFileSync(join(root, source), 'utf8');
      sources[source] = createHash('sha256').update(code).digest('hex');
      const file = join(temp, `${name}.shade.ts`);
      writeFileSync(file, code);
      const transformed = await plugin.transform(code, file);
      if (!transformed) throw new Error(`No module for ${name}`);
      modules[`/${variant}/${name}.js`] =
        typeof transformed === 'string' ? transformed : transformed.code;
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function measure({ n, samples, warmup }) {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter || !/swiftshader/i.test(adapter.info.architecture))
    throw new Error('Require SwiftShader');
  if (!adapter.features.has('timestamp-query')) throw new Error('Require timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
  configure({ runtime: await createRuntime({ device }) });
  const cases = {};
  const arrays = (count, f) => resident(Float32Array.from({ length: count }, (_, i) => f(i)));
  for (const variant of ['before', 'after']) {
    const ops = await import(`/${variant}/ops.js`),
      tone = await import(`/${variant}/tone.js`);
    function chain(count, reduce) {
      const a = arrays(count, (i) => (i % 7) - 3),
        b = arrays(count, (i) => ((i % 5) - 2) * 0.5),
        c = arrays(count, (i) => ((i % 3) - 1) * 0.25);
      const out = arrays(count, () => 0);
      return async () => {
        let value;
        const report = await fuse((scope) => {
          const t = scope.scratch(count),
            u = scope.scratch(count);
          ops.add(t, a, b);
          ops.mul(u, t, c);
          if (reduce) value = ops.total(u);
          else ops.relu(out, u);
        });
        return { report, value: reduce ? await value : null };
      };
    }
    const pixels = arrays(n, (i) => (i % 64) / 16);
    cases[variant] = {
      chain: chain(n, false),
      quarter: chain(n / 4, false),
      reduce: chain(n, true),
      tonemap: async () => {
        let value;
        const report = await fuse(() => {
          tone.exposure(1.5, pixels);
          value = tone.peak(pixels);
        });
        return { report, value: await value };
      },
    };
  }
  const results = {};
  for (const name of Object.keys(cases.before)) results[name] = { before: [], after: [] };
  for (let i = 0; i < warmup + samples; i++) {
    for (const name of Object.keys(cases.before)) {
      const values = {};
      for (const variant of i % 2 ? ['after', 'before'] : ['before', 'after']) {
        const start = performance.now();
        const { report, value } = await cases[variant][name]();
        await device.queue.onSubmittedWorkDone();
        const wallMs = performance.now() - start;
        values[variant] = value;
        const times = report.groups.map((g) => g.gpuTime);
        if (!times.length || times.some((t) => typeof t !== 'number' || !(t > 0)))
          throw new Error('Missing/invalid timestamps');
        if (i >= warmup)
          results[name][variant].push({
            wallMs,
            gpuMs: times.reduce((a, b) => a + b, 0) / 1e6,
            dispatches: report.dispatches,
            submissions: report.submissions,
            value,
          });
      }
      if (!Object.is(values.before, values.after))
        throw new Error(`${name}: before/after results differ`);
      if (values.before !== null && !Number.isFinite(values.before))
        throw new Error('Nonfinite result');
    }
  }
  const info = adapter.info;
  device.destroy();
  return {
    adapter: { vendor: info.vendor, architecture: info.architecture },
    userAgent: navigator.userAgent,
    results,
  };
}
const measured = await inPage({ modules, measure, options: { n, samples, warmup } });
const summary = Object.entries(measured.results).map(([name, variants]) => {
  const beforeMs = median(variants.before.map((s) => s.gpuMs)),
    afterMs = median(variants.after.map((s) => s.gpuMs));
  return {
    name,
    beforeMs,
    afterMs,
    changePercent: 100 * (afterMs / beforeMs - 1),
    pairedMedianChangePercent: median(
      variants.before.map((s, i) => 100 * (variants.after[i].gpuMs / s.gpuMs - 1)),
    ),
  };
});
for (const variant of ['before', 'after']) {
  const full = median(measured.results.chain[variant].map((s) => s.gpuMs));
  const quarter = median(measured.results.quarter[variant].map((s) => s.gpuMs));
  if (full / quarter < 1.3) throw new Error(`Timing instrument failed for ${variant}`);
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const report = {
  recordedAt: new Date().toISOString(),
  n,
  samples,
  warmup,
  cpu: cpus()[0]?.model,
  cpuCount: cpus().length,
  beforeCommit: git(base, 'rev-parse', 'HEAD'),
  afterCommit: git(root, 'rev-parse', 'HEAD'),
  afterCompilerDiff: git(root, 'diff', '--', 'src/core/passes/kernel-lower.ts'),
  sources,
  moduleHashes: Object.fromEntries(
    Object.entries(modules).map(([url, text]) => [
      url,
      createHash('sha256').update(text).digest('hex'),
    ]),
  ),
  ...measured,
  summary,
};
mkdirSync(dirname(resolve(values.output)), { recursive: true });
writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
