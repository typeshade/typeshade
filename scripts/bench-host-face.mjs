// Build both revisions first, then run:
// node scripts/bench-host-face.mjs [baseline-checkout]
// Uses the same source paths for both builds. Alternates order to limit warmup/drift bias;
// compares generated code, declarations, diagnostics and dependencies outside the timer.
// This measures warm compiler calls, not Vite startup, HMR latency or GPU execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async (dir) =>
  (await import(pathToFileURL(join(dir, 'dist/src/compiler/ts/host-face.js')).href)).hostFace;
const engines = [['candidate', await load(root)]];
if (process.argv[2]) engines.unshift(['baseline', await load(resolve(process.argv[2]))]);
const readDocument = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};
const output = ({ code, view, diagnostics, files }) => ({ code, view, diagnostics, files });
const warmup = 8;
const samples = 25;
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, warmup, samples }));
for (const file of [
  'journeys/loop-fuse/ops.shade.ts',
  'journeys/mnist/batch.shade.ts',
  'examples/path-tracer.shade.ts',
]) {
  const fileName = join(root, file);
  const source = readFileSync(fileName, 'utf8');
  const options = { fileName, readDocument };
  const times = Object.fromEntries(engines.map(([name]) => [name, []]));
  let expected;
  for (let i = 0; i < warmup + samples; i++) {
    for (const [name, run] of i % 2 ? [...engines].reverse() : engines) {
      const start = performance.now();
      const result = run(source, options);
      const ms = performance.now() - start;
      assert.deepEqual(
        result.diagnostics.filter((d) => d.category === 'error'),
        [],
      );
      assert.equal(typeof result.code, 'string');
      expected ??= output(result);
      assert.deepEqual(output(result), expected);
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
