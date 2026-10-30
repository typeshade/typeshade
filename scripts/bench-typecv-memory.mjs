// Bun, after building this compiler and a TypeCV checkout. Capture real BA inputs,
// then compare both compilers' entries on one runtime/device in alternating order.
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
    samples: { type: 'string', default: '61' },
    warmup: { type: 'string', default: '10' },
    points: { type: 'string', default: '256' },
    views: { type: 'string', default: '12' },
    fixture: { type: 'string' },
    workload: { type: 'string', default: 'memory' },
    batch: { type: 'string', default: '1' },
    output: { type: 'string', default: 'artifacts/memory-bench.json' },
  },
});
if (!values.base || !values.typecv) throw new Error('Require --base and --typecv');
if (!['memory', 'calls', 'regions'].includes(values.workload))
  throw new Error('Unknown --workload');
const root = resolve(import.meta.dirname, '..'),
  base = resolve(values.base),
  cv = resolve(values.typecv);
const samples = Number(values.samples),
  batch = Number(values.batch),
  warmup = Number(values.warmup),
  points = Number(values.points),
  views = Number(values.views);
if (
  ![samples, warmup, points, views, batch].every(Number.isSafeInteger) ||
  batch < 1 ||
  batch > 64 ||
  samples < 3 ||
  warmup < 1 ||
  points < 12 ||
  views < 4
)
  throw new Error('Require samples >= 3, warmup >= 1, points >= 12, views >= 4, batch 1..64');
const output = resolve(values.output);
mkdirSync(dirname(output), { recursive: true });

async function capture({ points, views }) {
  const { ShadeDevice, bundleAdjustGpu } = await import('/dist/gpu.js');
  const { jointFocalFixture } = await import('/tests/typeshade/joint-focal-cases.mjs');
  const { input } = jointFocalFixture({ points, views, noise: 0.1 });
  const C = input.views.length,
    P = input.landmarks.length,
    M = input.landmarks.reduce((n, p) => n + p.observations.length, 0);
  const lengths = {
    scene: 18 * C + 3 * P + 2 * M,
    trial: 12 * C + 3 * P,
    blocks: 45 * M + 13 * P + 78 * C,
    cameraScratch: 36 * C,
    schur: (6 * C + 1) ** 2,
    schurCross: 18 * M + 3 * P,
    focal: 6 * C + 6 + 2 * M,
    vectors: 5 * (6 * C + 1) + 3 * P,
    state: 26 + 2 * M,
    index: 3 * M + P + 2 * C + 2,
  };
  if (new Set(Object.values(lengths)).size !== Object.keys(lengths).length)
    throw new Error('Capture lengths must be unique');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter || !/swiftshader/i.test(adapter.info.architecture))
    throw new Error('Require SwiftShader');
  const gpu = await adapter.requestDevice();
  const d = await ShadeDevice.open({ gpuDevice: gpu, solverCheckpoints: true, poolBytes: 0 });
  const buffers = {},
    errors = [];
  gpu.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  for (const method of ['allocateF64', 'allocateU32']) {
    const original = d[method].bind(d);
    d[method] = (length, data) => {
      const buffer = original(length, data);
      for (const [key, n] of Object.entries(lengths)) if (n === length) buffers[key] = buffer;
      return buffer;
    };
  }
  let snapshot;
  const plan = d.planSteps.bind(d);
  d.planSteps = (steps) =>
    plan(
      (function* () {
        for (const step of steps) {
          if (step[0] !== 'cacheBundleSchurCross') {
            yield step;
            continue;
          }
          yield [
            step[0],
            step[1],
            async () => {
              await step[2]?.();
              const data = {};
              for (const [name, length] of Object.entries(lengths)) {
                if (!buffers[name]) throw new Error(`Missing captured buffer: ${name}`);
                data[name] = [...(await d.read(buffers[name], length))];
              }
              snapshot = { C, P, M, data };
              throw new Error('memory benchmark snapshot complete');
            },
          ];
        }
      })(),
    );
  try {
    await bundleAdjustGpu(d, input, {
      iterations: 1,
      refineSharedFocal: true,
      schurCache: true,
      maxCgIterations: 256,
      cgRelativeTolerance: 1e-10,
    });
  } catch (error) {
    if (!String(error).includes('memory benchmark snapshot complete')) throw error;
  } finally {
    await d.dispose();
    gpu.destroy();
  }
  if (!snapshot || errors.length) throw new Error(`Capture failed: ${errors.join('\n')}`);
  return snapshot;
}

let fixture;
if (values.fixture) fixture = JSON.parse(readFileSync(values.fixture, 'utf8'));
else {
  const { inBrowser } = await import(pathToFileURL(join(cv, 'tests/typeshade/browser.mjs')).href);
  const captured = await inBrowser(capture, { points, views }, { timeoutMs: 300000 });
  if (captured.errors.length) throw new Error(JSON.stringify(captured.errors));
  fixture = captured.result;
  writeFileSync(output.replace(/\.json$/, '') + '-fixture.json', JSON.stringify(fixture) + '\n');
}
const file = join(cv, 'src/gpu/joint-focal.shade.ts'),
  source = readFileSync(file, 'utf8');
const modules = {};
for (const [variant, checkout] of [
  ['before', base],
  ['after', root],
]) {
  const { typeshade } = await import(pathToFileURL(join(checkout, 'src/vite.ts')).href);
  const transformed = await typeshade({ fuse: true }).transform(source, file);
  if (!transformed) throw new Error(`No module for ${variant}`);
  modules[`/${variant}.js`] = typeof transformed === 'string' ? transformed : transformed.code;
}

async function measure({ fixture, samples, warmup, workload, batch }) {
  const { createRuntime, configure, resident } = await import('typeshade/runtime');
  const { fuse } = await import('typeshade/fuse');
  const adapter = await navigator.gpu.requestAdapter();
  if (
    !adapter ||
    !/swiftshader/i.test(adapter.info.architecture) ||
    !adapter.features.has('timestamp-query')
  )
    throw new Error('Require SwiftShader timestamps');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
  configure({ runtime: await createRuntime({ device }), prefer: ['webgpu'] });
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const { C, P, M, data } = fixture;
  if (data.state[1] !== 1 || data.state[20] !== 0)
    throw new Error('Fixture must execute active solver paths');
  const control = {
    cameras: C,
    points: P,
    observations: M,
    anchor: 0,
    scaleView: 1,
    normalizeScale: 1,
    huber: 1,
    relativeTolerance: 1e-10,
    cgIterations: 256,
  };
  const all = [],
    workloads = {},
    results = {};
  const primary = workload === 'calls' ? 'metrics' : workload === 'regions' ? 'point' : 'schur';
  for (const name of [primary, 'update', 'control']) {
    workloads[name] = {};
    results[name] = { before: [], after: [] };
    for (const variant of ['before', 'after']) {
      const mod = await import(`/${name === 'control' ? 'before' : variant}.js`);
      const metrics = name === 'metrics' || (name === 'control' && workload === 'calls');
      const point = name === 'point' || (name === 'control' && workload === 'regions');
      const keys = point
        ? ['index', 'blocks', 'vectors', 'state']
        : metrics
          ? ['index', 'scene', 'trial', 'focal', 'state']
          : name === 'update'
            ? ['index', 'scene', 'trial', 'blocks', 'vectors', 'focal', 'state']
            : ['index', 'blocks', 'cameraScratch', 'focal', 'state', 'schurCross', 'schur'];
      const bindings = { control };
      for (const key of keys) {
        // A small deterministic nonzero step exercises both pose-update branches.
        const array =
          key === 'index'
            ? Uint32Array.from(data[key])
            : key === 'vectors'
              ? Float64Array.from(data[key], (_, i) => 1e-5 * Math.sin(i + 1))
              : Float64Array.from(data[key]);
        // A zero-step candidate has the captured current geometry. Explicitly
        // activate validity; the capture precedes candidate construction.
        if (metrics && key === 'trial') array.set(data.scene.slice(0, 12 * C + 3 * P));
        if (metrics && key === 'state') array[15] = 1;
        if (metrics && key === 'focal') array[6 * C + 4] = array[6 * C + 3];
        if (point && key === 'state') array[19] = 1;
        bindings[key] = resident(array);
        all.push(bindings[key]);
      }
      const dispatch = () =>
        point
          ? mod.bundleSchurPoint(bindings, Math.ceil(P / 64))
          : metrics
            ? mod.bundleCandidateMetrics(bindings, Math.ceil(M / 64))
            : name === 'update'
              ? mod.updateBundleCandidate(bindings, Math.ceil(Math.max(C, P) / 64))
              : mod.cacheBundleSchurRows(bindings, Math.ceil((6 * C + 1) / 64));
      workloads[name][variant] = {
        bindings,
        run: (count = 1) =>
          fuse(() => {
            for (let j = 0; j < count; j++) dispatch();
          }),
      };
    }
  }
  const outputs = {},
    instrument = {};
  const timed = async (run, count) => {
    const start = performance.now(),
      report = await run(count);
    if (report.dispatches !== count) throw new Error('Unexpected dispatch count');
    await device.queue.onSubmittedWorkDone();
    const times = report.groups.map((g) => g.gpuTime);
    if (!times.length || times.some((t) => !Number.isFinite(t) || t <= 0))
      throw new Error('Invalid timestamp');
    return { gpuMs: times.reduce((a, b) => a + b, 0) / 1e6, wallMs: performance.now() - start };
  };
  try {
    for (let i = 0; i < samples + warmup; i++)
      for (const name of Object.keys(workloads))
        for (const variant of i % 2 ? ['after', 'before'] : ['before', 'after']) {
          const measured = await timed(workloads[name][variant].run, batch);
          if (i >= warmup) results[name][variant].push(measured);
        }
    for (const [name, variants] of Object.entries(workloads)) {
      outputs[name] = {};
      for (const variant of ['before', 'after']) {
        outputs[name][variant] = {};
        for (const key of name === 'update'
          ? ['trial', 'focal']
          : workload === 'regions'
            ? ['vectors']
            : workload === 'calls'
              ? ['state']
              : ['schur'])
          outputs[name][variant][key] = [...(await variants[variant].bindings[key].read())];
      }
      for (const key of Object.keys(outputs[name].before)) {
        const a = outputs[name].before[key],
          b = outputs[name].after[key];
        if (a.length !== b.length || a.some((v, i) => !Number.isFinite(v) || !Object.is(v, b[i])))
          throw new Error(`${name}/${key}: unequal or nonfinite readbacks`);
      }
      if (
        name !== 'update' &&
        workload === 'memory' &&
        !outputs[name].before.schur.some((x) => x !== 0)
      )
        throw new Error('Empty Schur result');
      if (name !== 'update' && workload === 'calls') {
        const metrics = outputs[name].before.state.slice(26);
        if (
          metrics.length !== M * 2 ||
          !metrics.some((x) => x > 0) ||
          metrics.some((x) => x >= 1e30)
        )
          throw new Error('Candidate metrics did not evaluate all observations');
      }
      if (name !== 'update' && workload === 'regions') {
        const offset = 5 * (6 * C + 1);
        if (
          !outputs[name].before.vectors
            .slice(offset)
            .some((x, i) => !Object.is(x, 1e-5 * Math.sin(offset + i + 1)))
        )
          throw new Error('Point Schur entry did not update its output slice');
      }
      if (
        name === 'update' &&
        !outputs[name].before.trial.some((x, i) => !Object.is(x, data.trial[i]))
      )
        throw new Error('Update entry did not change its captured output');
    }
    for (const variant of ['before', 'after']) {
      instrument[variant] = [];
      for (let i = 0; i < 5; i++)
        instrument[variant].push(await timed(workloads[primary][variant].run, 4 * batch));
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return {
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture },
      userAgent: navigator.userAgent,
      results,
      outputs,
      instrument,
      validationErrors: errors,
    };
  } finally {
    for (const r of all) r.destroy();
    device.destroy();
  }
}
const measured = await inPage({
  modules,
  measure,
  options: { fixture, samples, warmup, workload: values.workload, batch },
});
const summary = Object.entries(measured.results).map(([name, variants]) => {
  const beforeMs = median(variants.before.map((s) => s.gpuMs)) / batch,
    afterMs = median(variants.after.map((s) => s.gpuMs)) / batch;
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
  if (
    median(measured.instrument[variant].map((s) => s.gpuMs)) /
      median(
        measured.results[
          values.workload === 'calls'
            ? 'metrics'
            : values.workload === 'regions'
              ? 'point'
              : 'schur'
        ][variant].map((s) => s.gpuMs),
      ) <
    2
  )
    throw new Error('Four-dispatch timing sensitivity failed');
}
const sha = (s) => createHash('sha256').update(s).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const report = {
  recordedAt: new Date().toISOString(),
  samples,
  warmup,
  workload: values.workload,
  batch,
  dimensions: { cameras: fixture.C, points: fixture.P, observations: fixture.M },
  beforeCommit: git(base, 'rev-parse', 'HEAD'),
  beforeDiff: git(base, 'diff', '--', 'src'),
  afterCommit: git(root, 'rev-parse', 'HEAD'),
  afterDiff: git(root, 'diff', '--', 'src'),
  newPasses: Object.fromEntries(
    [
      'opt/loop-load-reuse',
      'opt/sink-aggregate-init',
      'specialize-calls',
      'restructure-calls',
      'scalarize-locals',
      'outline-regions',
      'connect-local-calls',
      'storage-load-reuse',
    ].map((n) => [n, readFileSync(join(root, `src/core/passes/${n}.ts`), 'utf8')]),
  ),
  typecvCommit: git(cv, 'rev-parse', 'HEAD'),
  sourceSha256: sha(source),
  fixtureSha256: sha(JSON.stringify(fixture)),
  moduleHashes: Object.fromEntries(Object.entries(modules).map(([url, text]) => [url, sha(text)])),
  ...measured,
  summary,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
