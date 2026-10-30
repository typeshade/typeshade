// Bun, after build. Compile the same TypeCV P3P source with two compiler checkouts,
// then alternate the kernels on one SwiftShader device and one runtime.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inPage, median } from '../journeys/_bench.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    typecv: { type: 'string' },
    samples: { type: 'string', default: '31' },
    warmup: { type: 'string', default: '6' },
    repeats: { type: 'string', default: '8' },
    output: { type: 'string', default: 'artifacts/licm-p3p.json' },
  },
});
if (!values.base || !values.typecv) throw new Error('Require --base and --typecv checkouts');
const root = resolve(import.meta.dirname, '..'),
  base = resolve(values.base),
  cv = resolve(values.typecv);
const samples = Number(values.samples),
  warmup = Number(values.warmup),
  repeats = Number(values.repeats);
if (
  !Number.isInteger(samples) ||
  samples < 3 ||
  !Number.isInteger(warmup) ||
  warmup < 1 ||
  !Number.isInteger(repeats) ||
  repeats < 4 ||
  repeats % 4
)
  throw new Error('Require samples >= 3, warmup >= 1, repeats >= 4 divisible by 4');
const fixtureFile = join(cv, 'tests/typeshade/p3p-cases.mjs');
const { p3pCases, packP3pCases, p3pMetrics } = await import(pathToFileURL(fixtureFile).href);
const cases = p3pCases(),
  packed = [...packP3pCases(cases)];
const file = join(cv, 'src/gpu/p3p.shade.ts'),
  source = readFileSync(file, 'utf8');
const modules = {};
for (const [variant, checkout] of [
  ['before', base],
  ['after', root],
]) {
  const { typeshade } = await import(pathToFileURL(join(checkout, 'src/vite.ts')).href);
  const result = await typeshade({ fuse: true }).transform(source, file);
  if (!result) throw new Error(`No generated module for ${variant}`);
  modules[`/${variant}.js`] = typeof result === 'string' ? result : result.code;
}

async function measure({ packed, samples, warmup, repeats }) {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter || !/swiftshader/i.test(adapter.info.architecture))
    throw new Error('Require SwiftShader');
  if (!adapter.features.has('timestamp-query')) throw new Error('Require timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  configure({ runtime: await createRuntime({ device }), prefer: ['webgpu'] });
  const workloads = {},
    all = [];
  for (const [name, copies] of [
    ['full', repeats],
    ['quarter', repeats / 4],
    ['control', repeats],
  ]) {
    workloads[name] = {};
    for (const variant of ['before', 'after']) {
      const { solveP3p } = await import(`/${name === 'control' ? 'before' : variant}.js`);
      const input = Float64Array.from(Array.from({ length: copies }, () => packed).flat());
      const count = input.length / 18;
      const bindings = {
        problems: resident(input),
        poses: resident(new Float64Array(count * 48)),
        valid: resident(new Uint32Array(count * 4)),
        counts: resident(new Uint32Array(count)),
        status: resident(new Uint32Array(count)),
      };
      all.push(...Object.values(bindings));
      workloads[name][variant] = {
        bindings,
        run: () => fuse(() => solveP3p(bindings, Math.ceil(count / 32))),
      };
    }
  }
  const results = Object.fromEntries(
    Object.keys(workloads).map((name) => [name, { before: [], after: [] }]),
  );
  const outputs = {};
  try {
    for (let i = 0; i < warmup + samples; i++) {
      for (const [name, variants] of Object.entries(workloads)) {
        for (const variant of i % 2 ? ['after', 'before'] : ['before', 'after']) {
          const start = performance.now();
          const report = await variants[variant].run();
          await device.queue.onSubmittedWorkDone();
          const wallMs = performance.now() - start;
          const times = report.groups.map((g) => g.gpuTime);
          if (!times.length || times.some((t) => !(t > 0))) throw new Error('Missing timestamps');
          if (i >= warmup)
            results[name][variant].push({ gpuMs: times.reduce((a, b) => a + b, 0) / 1e6, wallMs });
        }
      }
    }
    for (const [name, variants] of Object.entries(workloads)) {
      outputs[name] = {};
      for (const variant of ['before', 'after']) {
        outputs[name][variant] = {};
        for (const key of ['poses', 'valid', 'counts', 'status'])
          outputs[name][variant][key] = [...(await variants[variant].bindings[key].read())];
      }
      for (const key of ['poses', 'valid', 'counts', 'status']) {
        const a = outputs[name].before[key],
          b = outputs[name].after[key];
        if (a.length !== b.length || a.some((v, i) => !Number.isFinite(v) || !Object.is(v, b[i])))
          throw new Error(`${name}/${key}: readback values differ or are nonfinite`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return {
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture },
      userAgent: navigator.userAgent,
      results,
      outputs,
      validationErrors: errors,
    };
  } finally {
    for (const r of all) r.destroy();
    device.destroy();
  }
}
const measured = await inPage({ modules, measure, options: { packed, samples, warmup, repeats } });
const metrics = [];
for (const [name, variants] of Object.entries(measured.outputs)) {
  for (const [variant, data] of Object.entries(variants)) {
    const copies = name === 'quarter' ? repeats / 4 : repeats;
    const result = p3pMetrics(Array.from({ length: copies }, () => cases).flat(), data);
    if (result.failures.length) throw new Error(JSON.stringify(result.failures));
    if (
      result.maxRayError >= 1e-7 ||
      result.maxOrthogonalityError >= 1e-7 ||
      result.maxTruthError >= 1e-6
    )
      throw new Error(`Geometry tolerance exceeded: ${name}/${variant}`);
    metrics.push({ name, variant, ...result, output: undefined });
  }
}
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
  const full = median(measured.results.full[variant].map((s) => s.gpuMs));
  const quarter = median(measured.results.quarter[variant].map((s) => s.gpuMs));
  if (full / quarter < 1.3) throw new Error(`Timing sensitivity failed: ${variant}`);
}
const sha = (s) => createHash('sha256').update(s).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const report = {
  recordedAt: new Date().toISOString(),
  samples,
  warmup,
  repeats,
  problems: cases.length * repeats,
  beforeCommit: git(base, 'rev-parse', 'HEAD'),
  afterCommit: git(root, 'rev-parse', 'HEAD'),
  typecvCommit: git(cv, 'rev-parse', 'HEAD'),
  compilerDiff: git(root, 'diff', '--', 'src/core/passes/opt/licm.ts'),
  sourceSha256: sha(source),
  fixtureSha256: sha(readFileSync(fixtureFile)),
  moduleHashes: Object.fromEntries(Object.entries(modules).map(([url, code]) => [url, sha(code)])),
  ...measured,
  metrics,
  summary,
};
mkdirSync(dirname(resolve(values.output)), { recursive: true });
writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, metrics }, null, 2));
