// Build both revisions first, then run:
// node scripts/bench-host-face.mjs [baseline-checkout]
// Each build has its own worker/heap. Alternates order to limit warmup/drift bias;
// compares generated code, declarations, diagnostics and dependencies outside the timer.
// This measures warm compiler calls, not Vite startup, HMR latency or GPU execution.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

if (!isMainThread) {
  const { hostFace } = await import(
    pathToFileURL(join(workerData, 'dist/src/compiler/ts/host-face.js')).href
  );
  const readDocument = (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  };
  parentPort.on('message', ({ source, fileName }) => {
    const start = performance.now();
    const { code, view, diagnostics, files } = hostFace(source, { fileName, readDocument });
    const ms = performance.now() - start;
    // IPC/serialization and comparison happen after timing; each engine has its own GC.
    parentPort.postMessage({ ms, output: { code, view, diagnostics, files } });
  });
  parentPort.postMessage('ready');
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const builds = [['candidate', root]];
  if (process.argv[2]) builds.unshift(['baseline', resolve(process.argv[2])]);
  const engines = [];
  try {
    for (const [name, dir] of builds) {
      const worker = new Worker(new URL(import.meta.url), { workerData: dir });
      engines.push([name, worker]);
      await once(worker, 'message');
    }
    const warmup = 20;
    const samples = 75;
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, warmup, samples }));
    for (const file of [
      'journeys/loop-fuse/ops.shade.ts',
      'journeys/mnist/batch.shade.ts',
      'examples/path-tracer.shade.ts',
    ]) {
      const fileName = join(root, file);
      const source = readFileSync(fileName, 'utf8');
      const times = Object.fromEntries(engines.map(([name]) => [name, []]));
      let expected;
      for (let i = 0; i < warmup + samples; i++) {
        for (const [name, worker] of i % 2 ? [...engines].reverse() : engines) {
          const reply = once(worker, 'message');
          worker.postMessage({ source, fileName });
          const [{ ms, output }] = await reply;
          assert.deepEqual(
            output.diagnostics.filter((d) => d.category === 'error'),
            [],
          );
          assert.equal(typeof output.code, 'string');
          expected ??= output;
          assert.deepEqual(output, expected);
          if (i >= warmup) times[name].push(ms);
        }
      }
      for (const [name] of engines) {
        const sorted = times[name].sort((a, b) => a - b);
        console.log(
          JSON.stringify({
            file,
            engine: name,
            medianMs: sorted[Math.floor(samples / 2)],
            minMs: sorted[0],
            maxMs: sorted[samples - 1],
          }),
        );
      }
    }
  } finally {
    await Promise.all(engines.map(([, worker]) => worker.terminate()));
  }
}
