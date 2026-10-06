// The CPU model of the WebGL2 executor (change 0054, step 2) against the phased oracle. The model
// runs a split entry with its memory as std430 words: loads from the pass's snapshot or the
// invocation's own log, stores to the log, a scatter in invocation order, and a resolve pass for
// the atomics. On `f32` precision the oracle and the model must leave the same memory, bit for
// bit, on every program the proposal lists and on every runnable compute example.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { dispatchCompute } from '../debug/dispatch.js';
import { runGlModel } from './gl-model.js';
import { PROGRAMS } from './compute-programs.js';
import { lowerMemoryWords } from '../passes/memory-words.js';
import { splitPhases } from '../passes/phase-split.js';
import { autoVars } from '../passes/opt/index.js';
import { stageOf, type ModuleDecl, type ShaderType } from '../ir/index.js';
import type { CpuValue } from '../cpu-runtime.js';

type Bindings = Record<string, CpuValue>;

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

function both(m: ModuleDecl, entry: string, workgroups: number, make: () => Bindings) {
  const oracle = make();
  dispatchCompute(m, entry, workgroups, oracle, { precision: 'f32' });
  const model = make();
  const report = runGlModel(m, entry, workgroups, model);
  return { oracle, model, report };
}

describe("the GL executor, modelled on words, leaves the oracle's memory (change 0054)", () => {
  for (const [name, p] of Object.entries(PROGRAMS)) {
    it(name, () => {
      const r = both(moduleOf(p.src), p.entry, p.workgroups, p.bindings);
      expect(r.model).toEqual(r.oracle);
      expect(r.report.maxLogWords).toBeLessThanOrEqual(16);
    });
  }

  it('a struct array and a vector field, read and written lane by lane', () => {
    const src = `"use typeshade";
class P { pos: vec3f; mass: f32; tag: u32; }
declare const ps: storage<array<P>, "read_write">;
@compute([4, 1, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  const p = ps[gid.x];
  ps[gid.x].pos = p.pos * 2. + vec3f(p.mass, 0., 1.);
  ps[gid.x].tag = p.tag + gid.x;
}
`;
    const make = (): Bindings => ({
      ps: Array.from({ length: 4 }, (_, i) => ({
        pos: [i, i + 0.5, -i],
        mass: i * 0.25,
        tag: 7 * i,
      })) as unknown as CpuValue,
    });
    const r = both(moduleOf(src), 'main', 1, make);
    expect(r.model).toEqual(r.oracle);
  });

  it('turns every read and write of memory into words, and leaves no binding read', () => {
    const p = PROGRAMS['a barrier with workgroup memory']!;
    const plan = lowerMemoryWords(splitPhases(autoVars(moduleOf(p.src)), p.entry));
    const text = JSON.stringify(plan.module.funcs.find((f) => f.name === p.entry)!.body);
    expect(text).toContain('"_phLoad"');
    expect(text).toContain('"_phStore"');
    for (const root of plan.roots) expect(text).not.toContain(`"name":"${root.name}"`);
    expect(plan.roots.map((r) => [r.name, r.space])).toEqual([
      ['xs', 'storage'],
      ['out', 'storage'],
      ['tile', 'workgroup'],
    ]);
  });
});

describe('every compute example, on the GL model and the oracle (change 0054)', () => {
  // A runtime-sized array gets 512 elements, so no example reads past its end with these
  // inputs: WGSL gives such a read no one value, and the oracle and a texel fetch differ there.
  const dir = fileURLToPath(new URL('../../../examples/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.shade.ts'));

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

  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    if (!src.includes('@compute')) continue;
    const r = compile(src);
    if (r.diagnostics.some((d) => d.category === 'error')) continue;
    const m = r.module;
    const sampled = m.bindings.some((b) =>
      ['texture', 'storage-texture', 'sampler'].includes(b.type.kind),
    );
    for (const f of m.funcs) {
      if (stageOf(f) !== 'compute') continue;
      it.skipIf(sampled)(`${file}: ${f.name}`, () => {
        const make = (): Bindings => {
          const seed = { n: 1 };
          return Object.fromEntries(m.bindings.map((b) => [b.name, valueOf(b.type, m, seed, 512)]));
        };
        const out = both(m, f.name, 2, make);
        expect(out.model).toEqual(out.oracle);
      });
    }
  }
});
