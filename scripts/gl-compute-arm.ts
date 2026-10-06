// ═══ The GPU differential's compute arm: the WebGL2 executor against its CPU model (change 0054) ═══
//
// WHAT IT PROVES. A compute entry runs on WebGL2 through the executor of change 0054
// (`src/core/gl-compute.ts`): its pass program, built by `buildGlCompute`, drawn a pass at a time,
// its writes scattered as points, its atomics resolved in invocation order. The CPU model of that
// executor (`src/core/testing/gl-model.ts`) is held to the phased oracle bit for bit by the unit
// tests. This arm runs the same entries on WebGL2 and holds every storage word they leave to the
// model's. Together the two say: WebGL2 leaves the memory the oracle does.
//
// THE CORPUS. The proposal's program list (`src/core/testing/compute-programs.ts`: a write at
// `gid.x`, a computed index, writes past the log, a read after its own write, a barrier with
// workgroup memory, a reduction, `atomicAdd` with and without its value, an append buffer, a loop
// with a barrier, a helper that waits) and every compute entry of `examples/*.shade.ts` that binds
// no texture. Each job runs twice: in the executor's own layout, and in layers of 32 words, so
// memory, state and output each span many layers of their 2D array textures.
//
// BIT FOR BIT, BUT WHERE WGSL SAYS OTHERWISE. A word must be the model's exactly, unless it holds
// an `f32` and the module's determinism report (Rule 11.5) lists an `f32` operation whose
// accuracy WGSL gives in ULP: then it may differ by 3 ULP, the most the report's 2.5 rounds to.
//
// WHY IT CANNOT BE VACUOUSLY GREEN:
//   1. WebGL2 must be reachable, and a pass program that is no program must be REPORTED.
//   2. A job run with one input word changed on purpose must be reported as a difference.
//   3. The corpus must reach each kind of cut (a barrier, an atomic operation, a full log) and a
//      floor of compared words.

import type { Page } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../src/compiler/ts/compile.js';
import type { CpuValue } from '../src/core/cpu-runtime.js';
import { stageOf, type ModuleDecl, type ShaderType } from '../src/core/ir/index.js';
import {
  buildGlCompute,
  type GlComputeLayout,
  type GlComputeProgram,
} from '../src/core/passes/gl-compute.js';
import { determinismReport } from '../src/core/passes/determinism.js';
import { PROGRAMS } from '../src/core/testing/compute-programs.js';
import { runGlModel, storageFloats, storageWords } from '../src/core/testing/gl-model.js';
import type { ComputeJob, ComputeResult } from './gl-compute-page.js';

interface Bundler {
  build(options: { entrypoints: string[]; target: 'browser'; format: 'esm' }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

/** The fewest words the arm must compare. */
const COMPARED_FLOOR = 2000;

/** A layout of 32 words a layer and 16 invocations a row: the corpus run again in it spans
 *  many layers of memory, state and output, which the default layout reaches only past four
 *  million words. */
const SMALL: GlComputeLayout = { width: 16, layerRows: 2 };

export interface Case {
  readonly id: string;
  readonly m: ModuleDecl;
  readonly entry: string;
  readonly workgroups: number;
  readonly bindings: () => Record<string, CpuValue>;
}

/** A value of type `t` for a binding: numbers that differ by position. */
function valueOf(t: ShaderType, m: ModuleDecl, seed: { n: number }, length: number): CpuValue {
  const next = (): number => (seed.n = (seed.n * 7 + 3) % 61);
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? next() % 2 === 0 : t.scalar === 'f32' ? next() / 8 : next();
    case 'atomic':
      return 0;
    case 'vec':
      return Array.from({ length: t.n }, () => (t.elem === 'f32' ? next() / 8 : next()));
    case 'mat':
      return Array.from({ length: t.cols * t.rows }, () => next() / 8);
    case 'array':
      return Array.from({ length: t.size ?? length }, () =>
        valueOf(t.elem, m, seed, length),
      ) as CpuValue;
    case 'struct': {
      const s = m.structs.find((x) => x.name === t.name)!;
      return Object.fromEntries(s.fields.map((f) => [f.name, valueOf(f.type, m, seed, length)]));
    }
    default:
      throw new Error(`no test value for ${t.kind}`);
  }
}

/** The arm's corpus: the proposal's programs and every texture-free example compute entry. */
export function corpus(): Case[] {
  const cases: Case[] = [];
  for (const [id, p] of Object.entries(PROGRAMS)) {
    cases.push({
      id,
      m: compile(p.src).module,
      entry: p.entry,
      workgroups: p.workgroups,
      bindings: p.bindings,
    });
  }
  for (const f of readdirSync('examples').filter((x) => x.endsWith('.shade.ts'))) {
    const src = readFileSync(join('examples', f), 'utf8');
    if (!src.includes('@compute')) continue;
    const r = compile(src);
    if (r.diagnostics.some((d) => d.category === 'error')) continue;
    const m = r.module;
    if (m.bindings.some((b) => ['texture', 'storage-texture', 'sampler'].includes(b.type.kind)))
      continue;
    for (const e of m.funcs.filter((x) => stageOf(x) === 'compute')) {
      // A runtime-sized array gets 512 elements, so no example reads past its end with these
      // inputs (WGSL gives such a read no one value).
      cases.push({
        id: `${f}:${e.name}`,
        m,
        entry: e.name,
        workgroups: 2,
        bindings: () => {
          const seed = { n: 1 };
          return Object.fromEntries(m.bindings.map((b) => [b.name, valueOf(b.type, m, seed, 512)]));
        },
      });
    }
  }
  return cases;
}

/** A difference between the model's words and the GPU's, or undefined. */
function difference(
  want: Record<string, Uint32Array>,
  got: Record<string, number[]> | undefined,
  floats: Record<string, Uint8Array>,
  ulp: boolean,
  tally: { compared: number },
): string | undefined {
  if (got === undefined) return 'no memory came back';
  for (const [name, w] of Object.entries(want)) {
    const g = got[name];
    if (g === undefined || g.length !== w.length)
      return `${name}: ${String(g?.length)} words, want ${String(w.length)}`;
    for (let i = 0; i < w.length; i++) {
      tally.compared++;
      if (w[i] === g[i]) continue;
      const near = ulp && floats[name]![i] === 1 && Math.abs((w[i]! | 0) - (g[i]! | 0)) <= 3;
      if (!near) return `${name}[${String(i)}]: model ${String(w[i])}, gpu ${String(g[i])}`;
    }
  }
  return undefined;
}

/** Run the arm on `page`; the number of failures. */
export async function computeArm(page: Page): Promise<number> {
  const bun = (globalThis as { Bun?: Bundler }).Bun;
  if (bun === undefined) throw new Error('the compute arm needs Bun: run the gate with bun');
  const built = await bun.build({
    entrypoints: [join(import.meta.dirname, 'gl-compute-page.ts')],
    target: 'browser',
    format: 'esm',
  });
  if (!built.success)
    throw new Error(`the compute page did not build: ${built.logs.map(String).join('\n')}`);
  await page.addScriptTag({ content: await built.outputs[0]!.text(), type: 'module' });
  const runOnPage = (jobs: ComputeJob[]): Promise<{ renderer: string; results: ComputeResult[] }> =>
    page.evaluate(
      (j) =>
        (
          globalThis as unknown as {
            __runCompute: (j: unknown) => { renderer: string; results: ComputeResult[] };
          }
        ).__runCompute(j),
      jobs,
    );

  let failures = 0;
  const cases = corpus();
  const prepared = cases.flatMap((c) => [prepare(c), prepare(c, SMALL)]);
  function prepare(c: Case, layout?: GlComputeLayout) {
    const program: GlComputeProgram = buildGlCompute(c.m, c.entry, layout);
    const input = c.bindings();
    const model = c.bindings();
    runGlModel(c.m, c.entry, c.workgroups, model);
    const report = determinismReport(c.m);
    const id =
      layout === undefined
        ? c.id
        : `${c.id} (layers of ${String(layout.width * layout.layerRows)} words)`;
    return {
      c,
      program,
      id,
      job: {
        id,
        program,
        workgroups: c.workgroups,
        memory: Object.fromEntries(
          Object.entries(storageWords(c.m, input)).map(([k, v]) => [k, [...v]]),
        ),
        uniforms: Object.fromEntries(
          c.m.bindings.filter((b) => b.space === 'uniform').map((b) => [b.name, input[b.name]]),
        ),
      } satisfies ComputeJob,
      want: storageWords(c.m, model),
      floats: storageFloats(c.m, model),
      ulp: report.some((r) => r.kind === 'ulp' && r.elem === 'f32'),
    };
  }

  // The instruments first: a broken pass program, and a job with an input word changed.
  const first = prepared[0]!;
  const broken: ComputeJob = {
    ...first.job,
    id: 'broken',
    program: { ...first.program, vertex: '#version 300 es\nvoid main( {' },
  };
  const changed: ComputeJob = {
    ...first.job,
    id: 'changed',
    memory: Object.fromEntries(
      Object.entries(first.job.memory).map(([k, v], i) => [
        k,
        i === 0 ? v.map((x, j) => (j === 0 ? x ^ 1 : x)) : v,
      ]),
    ),
  };
  const probe = await runOnPage([broken, changed]);
  console.log(`compute differential: WebGL2 renderer ${probe.renderer}`);
  const b = probe.results.find((r) => r.id === 'broken')!;
  if (b.error !== undefined && /did not compile/.test(b.error)) {
    console.log('instrument: a pass program that is no program was REPORTED');
  } else {
    console.error(
      'FAIL  instrument: a broken pass program ran, so every verdict below would be blind',
    );
    failures++;
  }
  const ch = probe.results.find((r) => r.id === 'changed')!;
  const chDiff = difference(first.want, ch.memory, first.floats, false, { compared: 0 });
  if (chDiff !== undefined)
    console.log(`instrument: an input word changed on purpose was REPORTED (${chDiff})`);
  else {
    console.error('FAIL  instrument: an input word changed on purpose matched the model');
    failures++;
  }

  const tally = { compared: 0 };
  const kinds = new Set<string>();
  const { results } = await runOnPage(prepared.map((p) => p.job));
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const p of prepared) {
    const r = byId.get(p.id);
    const diff =
      r?.error !== undefined ? r.error : difference(p.want, r?.memory, p.floats, p.ulp, tally);
    if (diff !== undefined) {
      console.error(`FAIL  ${p.id}: ${diff.slice(0, 300)}`);
      failures++;
      continue;
    }
    for (const k of Object.values(p.program.cuts)) kinds.add(k);
    console.log(
      `ok    ${p.id}: ${String(r!.passes)} pass(es)${p.ulp ? ', f32 within 3 ULP (Rule 11.5)' : ''}`,
    );
  }
  for (const k of ['barrier', 'atomic', 'log']) {
    if (!kinds.has(k)) {
      console.error(`FAIL  the corpus reaches no ${k} cut`);
      failures++;
    }
  }
  if (tally.compared < COMPARED_FLOOR) {
    console.error(
      `FAIL  the arm compared ${String(tally.compared)} words, under its floor of ${String(COMPARED_FLOOR)}`,
    );
    failures++;
  }
  console.log(
    `compute differential: ${String(cases.length)} compute entries on WebGL2, each in the default layout and in layers of ${String(SMALL.width * SMALL.layerRows)} words, against the GL executor's CPU model · ` +
      `${String(tally.compared)} storage words compared · failures: ${String(failures)}`,
  );
  return failures;
}
