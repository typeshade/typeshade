import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { copy } from '../../core/testing/kernel-plan.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import type { compile } from './compile.js';

const SPELLINGS = ['f32[]', 'Array<f32>'] as const;

const kernel = (t: string): string => `"use typeshade";
export function scale(xs: ${t}, k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}
`;

const binding = (t: string): string => `"use typeshade";
declare const xs: storage<${t}>;
declare const out: storage<${t}, "read_write">;
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = xs[gid.x] + f32(xs.length);
}
`;

const lastField = (t: string): string => `"use typeshade";
class Particles {
  count: u32;
  data: ${t};
}
declare const p: storage<Particles, "read_write">;
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  p.data[gid.x] = f32(p.count) + f32(p.data.length);
}
`;

const emitOf = (r: ReturnType<typeof compile>): string => JSON.stringify([r.wgsl, r.glsl]);

const withoutSpans = (value: unknown): string =>
  JSON.stringify(value, (key, v: unknown) =>
    key === 'span' || key === 'nameSpan' ? undefined : v,
  );

function kernelWgsl(r: ReturnType<typeof compile>): string {
  const proof = proveKernels(r.module)[0]!;
  const plan = lowerKernel(
    r.module.funcs.find((f) => f.name === 'scale')!,
    r.module,
    proof,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return emitModule(plan.module);
}

describe("TypeScript's spelling of an array with no size (change 0114, S1)", () => {
  for (const t of SPELLINGS) {
    describe(t, () => {
      it("is a kernel function's parameter, with the emit and the CPU result of array<f32>", () => {
        const base = bothTake(kernel('array<f32>'));
        const written = bothTake(kernel(t));
        expect(withoutSpans(written.result.module.funcs)).toBe(
          withoutSpans(base.result.module.funcs),
        );
        expect(kernelWgsl(written.result)).toBe(kernelWgsl(base.result));
        expect(kernelWgsl(written.result)).toContain('array<f32>');
        const run = (r: ReturnType<typeof compile>): CpuValue[] => {
          const args: CpuValue[] = [[1, 2, 3, 4], 2.5].map(copy);
          compileModule(r.module, { precision: 'f32' }).fns.scale!(...args);
          return args;
        };
        expect(run(written.result)).toEqual(run(base.result));
        expect(run(written.result)[0]).toEqual([2.5, 5, 7.5, 10]);
      });

      it("is a storage binding's value type, read and read_write, with the emit of array<f32>", () => {
        const base = bothTake(binding('array<f32>'));
        const written = bothTake(binding(t));
        expect(written.result.wgsl).toBe(base.result.wgsl);
        expect(emitOf(written.result)).toBe(emitOf(base.result));
        expect(written.result.wgsl).toContain('array<f32>');
        expect(withoutSpans(written.result.module.bindings)).toBe(
          withoutSpans(base.result.module.bindings),
        );
      });

      it('is the last field of a storage struct, with the emit of array<f32>', () => {
        const base = bothTake(lastField('array<f32>'));
        const written = bothTake(lastField(t));
        expect(emitOf(written.result)).toBe(emitOf(base.result));
      });

      it('has a u32 length in both halves', () => {
        const halves = bothTake(kernel(t).replace('i < xs.length', 'i < xs.length + 0'));
        expect(halves.hover('length')).toContain('length: u32');
        expect(halves.hover('xs:')).toContain('(parameter) xs: array<f32>');
        expect(bothTake(binding(t)).hover('length')).toContain('length: u32');
      });

      it('runs the methods an array has as array<f32> runs them', () => {
        const source = (u: string): string => `"use typeshade";
export function f(xs: ${u}) {
  xs.fill(1.);
  for (let i = 0; i < 3; i++) {
    xs.push(2.);
  }
  const s = xs.reduce((a, b) => a + b, 0.);
  xs.forEach((x, i) => {
    xs[i] = x + s;
  });
  for (const x of xs) {
    xs[0] = x;
  }
}
`;
        const base = bothHalves(source('array<f32>'));
        const written = bothHalves(source(t));
        expect(written.compiler).toEqual(base.compiler);
        expect(written.editor).toEqual(base.editor);
      });
    });
  }
});

describe('where array<T> with no size is refused, so is f32[] and Array<f32> (change 0114, S1)', () => {
  const PLACES: readonly (readonly [string, (t: string) => string])[] = [
    [
      'a local',
      (t) => `"use typeshade";
export function f(xs: ${t}): f32 {
  const a: ${t} = xs;
  return a[0];
}
`,
    ],
    [
      "a function's result",
      (t) => `"use typeshade";
export function f(xs: ${t}): ${t} {
  return xs;
}
`,
    ],
    [
      "a helper function's parameter",
      (t) => `"use typeshade";
function h(xs: ${t}): f32 {
  return xs[0];
}
@compute([1])
export function main() {}
`,
    ],
    [
      "a local function's parameter",
      (t) => `"use typeshade";
export function f(xs: ${t}, out: ${t}) {
  const g = (a: ${t}): f32 => a[0];
  out[0] = g(xs);
}
`,
    ],
    [
      'a uniform',
      (t) => `"use typeshade";
declare const u: uniform<${t}>;
@compute([1])
export function main() {
  const x = u[0];
}
`,
    ],
    [
      'a field of a storage struct that is not the last',
      (t) => `"use typeshade";
class P {
  data: ${t};
  n: u32;
}
declare const p: storage<P, "read_write">;
@compute([1])
export function main() {
  p.n = u32(1);
}
`,
    ],
    [
      'a module variable',
      (t) => `"use typeshade";
let xs: ${t};
@compute([1])
export function main() {
  xs[0] = 1.;
}
`,
    ],
    [
      'a list of lists in storage',
      (t) => `"use typeshade";
declare const xs: storage<array<${t}>>;
`,
    ],
    [
      'an element that may be undefined',
      (t) => `"use typeshade";
export function f(xs: ${t.replace('f32', 'f32 | undefined').replace('f32 | undefined[]', '(f32 | undefined)[]')}): f32 {
  return 0.;
}
`,
    ],
  ];
  for (const [place, source] of PLACES) {
    it(`${place}: the same code and sentence in both halves`, () => {
      const base = bothHalves(source('array<f32>'));
      expect(base.compiler.length).toBeGreaterThan(0);
      for (const t of SPELLINGS) {
        const written = bothHalves(source(t));
        expect(written.compiler, t).toEqual(base.compiler);
        expect(written.editor, t).toEqual(base.editor);
        expect(written.editor, t).toEqual(written.compiler);
      }
    });
  }

  it('Array<T> with two type arguments names array<T, N> in the compiler', () => {
    const halves = bothHalves(`"use typeshade";
export function f(xs: Array<f32, 4>): f32 {
  return 0.;
}
`);
    const said =
      'typeshade TS8002: Array<T> takes one type argument, the element. A list with a size is array<T, N>.';
    expect(halves.compiler).toEqual([said]);
    expect(halves.editor).toContain(said);
  });
});
