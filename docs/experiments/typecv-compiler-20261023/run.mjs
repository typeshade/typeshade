import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { inBrowser } = await import(pathToFileURL(resolve('tests/typeshade/browser.mjs')).href);

const names = process.argv.slice(2).filter((s) => !s.startsWith('--'));
assert.ok(names.length >= 2, 'compare at least two compiled variants');
const serve = Object.fromEntries(
  names.map((name) => [`/study/${name}.js`, resolve(`.compiler-study/bundles/${name}.js`)]),
);
const cacheOnly = process.argv.includes('--cache');
const { result, errors } = await inBrowser(
  async ({ names, samples, cacheOnly }) => {
    const { bundleFixture, bundleMetrics } = await import('/tests/typeshade/geometry-cases.mjs');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const gpu = await adapter.requestDevice({ requiredFeatures: features });
    const validation = [],
      rows = [];
    gpu.addEventListener('uncapturederror', (e) => validation.push(e.error.message));
    const apis = await Promise.all(names.map((name) => import(`/study/${name}.js`)));
    const coordinates = (model) => [
      ...model.views.flatMap((v) => [...v.pose.R, ...v.pose.t, v.camera.fx, v.camera.fy]),
      ...model.landmarks.flatMap((p) => [...p.xyz]),
    ];
    const discrepancy = (a, b) => {
      if (
        a.length !== b.length ||
        a.some((x) => !Number.isFinite(x)) ||
        b.some((x) => !Number.isFinite(x))
      )
        return Infinity;
      return Math.max(0, ...a.map((v, i) => Math.abs(v - b[i]) / Math.max(1, Math.abs(b[i]))));
    };
    // Prove the numerical instrument detects corrupted geometry before accepting any zero.
    if (discrepancy([1, 2], [1, 3]) <= 2e-10 || discrepancy([NaN], [0]) !== Infinity)
      throw new Error('Blind comparison instrument');
    const budget = (input, shared) => {
      const C = input.views.length,
        P = input.landmarks.length;
      const M = input.landmarks.reduce((n, p) => n + p.observations.length, 0);
      const doubles =
        18 * C +
        3 * P +
        2 * M +
        12 * C +
        3 * P +
        30 * C +
        3 * P +
        (shared ? 5 : 0) +
        26 +
        3 * Math.ceil(M / 64) +
        12 * C +
        3 * P +
        (shared ? 27 : 26) +
        78 * C +
        36 * C +
        (shared ? 6 * C + 6 : 0);
      return 8 * doubles + 4 * (3 * M + P + 2 * C + 2) + 8 + 64 * (shared ? 376 : 336) + 64 * 104;
    };
    try {
      for (const config of [
        { name: 'fixed-8', views: 8, count: 131, shared: false },
        { name: 'shared-8', views: 8, count: 131, shared: true },
        { name: 'fixed-17-bounded', views: 17, count: 131, shared: false, bounded: true },
        { name: 'shared-6-streamed', views: 6, count: 60, shared: true, streamed: true },
        { name: 'shared-8-cached', views: 8, count: 131, shared: true, cached: true },
      ].filter((c) => (cacheOnly ? c.cached : !c.cached))) {
        const input = bundleFixture({ views: config.views, count: config.count, outlier: true });
        const unchanged = JSON.stringify(input),
          entries = [];
        let reference;
        for (let i = 0; i < names.length; i++) {
          const device = await apis[i].ShadeDevice.open({
            gpuDevice: gpu,
            poolBytes: 0,
            occupancyFloors: false,
            fp64Flavor: 'float',
            boundedSubmissions: !config.cached,
            maxDispatchesPerSubmission: 1,
            solverCheckpoints: true,
            chunkTimingSamples: 1,
            workingBytes: config.streamed ? budget(input, config.shared) : 64 * 1024 ** 2,
          });
          const row = {
            variant: names[i],
            wallMs: [],
            gpuNs: [],
            timedGroups: [],
            dispatches: [],
            submissions: [],
            uploadBytes: [],
            readbackBytes: [],
            peakLogicalBytes: 0,
            maxGeometryError: 0,
            maxCostError: 0,
          };
          const run = async (measured) => {
            const model = structuredClone(input),
              before = device.statistics;
            device.resetKernelStatistics();
            await gpu.queue.onSubmittedWorkDone();
            const start = performance.now();
            const output = await apis[i].bundleAdjustGpu(device, model, {
              iterations: 3,
              maxCgIterations: 64,
              huberPx: 1,
              refineSharedFocal: config.shared,
              schurReduction: 'serial',
              schurCache: config.cached ?? false,
            });
            await gpu.queue.onSubmittedWorkDone();
            const wall = performance.now() - start,
              stats = device.statistics;
            if (stats.liveBuffers !== 0)
              throw new Error(`${config.name}/${row.variant}: resident buffer leak`);
            if (output.linearSolverFailures || !output.diagnostics.acceptedSteps)
              throw new Error(`${config.name}/${row.variant}: solver failure`);
            const streamed = output.execution.report.groups.some((g) =>
              g.calls.includes('checkBundlePoints'),
            );
            if (streamed !== !!config.streamed)
              throw new Error(`${config.name}: wrong memory path`);
            const cached = output.execution.report.groups.some((g) =>
              g.calls.includes('cacheBundleSchurCross'),
            );
            if (cached !== !!config.cached)
              throw new Error(`${config.name}: wrong Schur-cache path`);
            const values = coordinates(output.reconstruction),
              metrics = bundleMetrics(output.reconstruction, 1);
            reference ??= { values, metrics };
            if (!Number.isFinite(metrics.cost) || !Number.isFinite(metrics.rmse))
              throw new Error(`${config.name}/${row.variant}: non-finite metrics`);
            const delta = discrepancy(values, reference.values);
            const costDelta =
              Math.abs(metrics.cost - reference.metrics.cost) /
              Math.max(1, Math.abs(reference.metrics.cost));
            if (delta > 2e-10 || costDelta > 2e-10)
              throw new Error(
                `${config.name}/${row.variant}: numerical regression ${delta}, cost ${costDelta}`,
              );
            row.maxGeometryError = Math.max(row.maxGeometryError, delta);
            row.maxCostError = Math.max(row.maxCostError, costDelta);
            row.peakLogicalBytes = Math.max(
              row.peakLogicalBytes,
              device.diagnostics.memory.peakLiveBytes,
            );
            row.finalCost = metrics.cost;
            row.rmsePx = metrics.rmse;
            row.acceptedSteps = output.diagnostics.acceptedSteps;
            if (!measured) {
              row.coldMs ??= wall;
              return;
            }
            row.wallMs.push(wall);
            row.gpuNs.push(stats.kernels.reduce((n, k) => n + k.gpuNs, 0));
            row.timedGroups.push(stats.kernels.reduce((n, k) => n + k.timedGroups, 0));
            row.dispatches.push(output.execution.report.dispatches);
            row.submissions.push(output.execution.report.submissions);
            row.uploadBytes.push(stats.applicationUploadBytes - before.applicationUploadBytes);
            row.readbackBytes.push(
              stats.applicationReadbackBytes - before.applicationReadbackBytes,
            );
          };
          entries.push({ device, row, run });
        }
        try {
          for (let round = 0; round < 2; round++)
            for (const e of round ? [...entries].reverse() : entries) await e.run(false);
          for (let round = 0; round < samples; round++) {
            const order = entries.map((_, i) => entries[(i + round) % entries.length]);
            if (round % 2) order.reverse();
            for (const entry of order) await entry.run(true);
          }
          if (JSON.stringify(input) !== unchanged) throw new Error('Input mutated');
          rows.push({
            config,
            observations: input.landmarks.reduce((n, p) => n + p.observations.length, 0),
            runs: entries.map((e) => e.row),
          });
        } finally {
          for (const e of entries) await e.device.dispose();
        }
      }
      return {
        adapter: {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
          fallback: adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter,
        },
        fallback: adapter.isFallbackAdapter,
        features,
        samples,
        schedule: cacheOnly
          ? 'automatic (required for shared-focal Schur cache)'
          : 'bounded: one dispatch per submission',
        rows,
        validation,
        numericalCorruptionProbe: true,
      };
    } finally {
      gpu.destroy();
    }
  },
  { names, samples: process.argv.includes('--quick') ? 2 : 5, cacheOnly },
  { serve, timeoutMs: 1800000 },
);
assert.deepEqual(errors, []);
assert.deepEqual(result.validation, []);
const source = JSON.parse(await readFile('.compiler-study/records/typecv-source.json', 'utf8'));
const output = `.compiler-study/records/ba-${names.join('-')}${cacheOnly ? '-cached' : ''}.json`;
await writeFile(output, JSON.stringify({ typecv: source.commit, ...result }, null, 2) + '\n');
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
for (const row of result.rows)
  console.log(
    JSON.stringify({
      name: row.config.name,
      runs: row.runs.map((r) => ({
        variant: r.variant,
        wallMs: median(r.wallMs),
        gpuNs: median(r.gpuNs),
        timedGroups: median(r.timedGroups),
        peakLogicalBytes: r.peakLogicalBytes,
        geometryError: r.maxGeometryError,
        cost: r.finalCost,
      })),
    }),
  );
console.log(output);
