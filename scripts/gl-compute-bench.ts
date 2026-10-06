// The WebGL2 compute executor's cost (change 0054): each job of the compute arm's corpus, run on
// WebGL2 in Chromium, its median time and its time per pass. A measurement, not a gate: it
// prints and exits 0. `TYPESHADE_BENCH_REPS` sets the runs per job (default 5).

import { chromium } from 'playwright';
import { join } from 'node:path';
import { buildGlCompute } from '../src/core/passes/gl-compute.js';
import { storageWords } from '../src/core/testing/gl-model.js';
import { corpus } from './gl-compute-arm.js';
import type { ComputeJob } from './gl-compute-page.js';

interface Bundler {
  build(options: { entrypoints: string[]; target: 'browser'; format: 'esm' }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

const REPS = Number(process.env['TYPESHADE_BENCH_REPS'] ?? 5);

const bun = (globalThis as { Bun?: Bundler }).Bun;
if (bun === undefined) throw new Error('the bench needs Bun: run it with bun');
const built = await bun.build({
  entrypoints: [join(import.meta.dirname, 'gl-compute-page.ts')],
  target: 'browser',
  format: 'esm',
});
if (!built.success) throw new Error(built.logs.map(String).join('\n'));
const jobs: ComputeJob[] = corpus().map((c) => {
  const input = c.bindings();
  return {
    id: c.id,
    program: buildGlCompute(c.m, c.entry),
    workgroups: c.workgroups,
    memory: Object.fromEntries(
      Object.entries(storageWords(c.m, input)).map(([k, v]) => [k, [...v]]),
    ),
    uniforms: Object.fromEntries(
      c.m.bindings.filter((b) => b.space === 'uniform').map((b) => [b.name, input[b.name]]),
    ),
  };
});
const browser = await chromium.launch({
  executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: await built.outputs[0]!.text(), type: 'module' });
  const r = await page.evaluate(
    ({ j, reps }) =>
      (
        globalThis as unknown as {
          __benchCompute: (
            j: unknown,
            reps: number,
          ) => { renderer: string; results: { id: string; passes: number; ms: number }[] };
        }
      ).__benchCompute(j, reps),
    { j: jobs, reps: REPS },
  );
  console.log(`WebGL2 renderer ${r.renderer} · ${String(REPS)} runs per job, median`);
  let ms = 0;
  let passes = 0;
  for (const x of r.results) {
    ms += x.ms;
    passes += x.passes;
    console.log(
      `${x.ms.toFixed(2).padStart(9)} ms  ${String(x.passes).padStart(4)} pass(es)  ` +
        `${(x.ms / Math.max(1, x.passes)).toFixed(2).padStart(7)} ms/pass  ${x.id}`,
    );
  }
  console.log(
    `total ${ms.toFixed(1)} ms over ${String(passes)} passes · ${(ms / passes).toFixed(2)} ms/pass`,
  );
  // Decision 5: the time of one pass with the memory as `R32F` and as `R32UI`.
  for (const words of [4096, 65536, 1 << 20]) {
    const f = await page.evaluate(
      ({ n, reps }) =>
        (
          globalThis as unknown as {
            __benchFormats: (n: number, reps: number) => { r32ui: number; r32f: number | null };
          }
        ).__benchFormats(n, reps),
      { n: words, reps: REPS * 4 },
    );
    console.log(
      `one pass over ${String(words).padStart(7)} words: R32UI ${f.r32ui.toFixed(2)} ms · ` +
        `R32F ${f.r32f === null ? 'no EXT_color_buffer_float' : `${f.r32f.toFixed(2)} ms`}`,
    );
  }
} finally {
  await browser.close();
}
