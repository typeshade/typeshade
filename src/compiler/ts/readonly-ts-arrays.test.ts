import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { copy } from '../../core/testing/kernel-plan.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import type { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { applyRemedy, remedyLines } from './remedy-lines/apply.js';

const SPELLINGS = ['readonly f32[]', 'ReadonlyArray<f32>'] as const;
const WRITABLE: Readonly<Record<(typeof SPELLINGS)[number], string>> = {
  'readonly f32[]': 'f32[]',
  'ReadonlyArray<f32>': 'Array<f32>',
};

const kernel = (t: string): string => `"use typeshade";
export function scale(xs: ${t}, out: f32[], k: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * k;
  }
}
`;

const binding = (t: string): string => `"use typeshade";
declare const xs: storage<${t}>;
declare const out: storage<f32[], "read_write">;
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
declare const p: storage<Particles>;
declare const out: storage<f32[], "read_write">;
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = f32(p.count) + p.data[gid.x] + f32(p.data.length);
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

const writeSentence = (place: string, written: string, writable?: string): string =>
  `Cannot write to "${place}" — its type "${written}" promises that nothing writes it.` +
  (writable === undefined ? '' : ` Write "${writable}" to write to it.`);

describe("TypeScript's spelling of an array with no size that nothing writes (change 0114, S1)", () => {
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
          const args: CpuValue[] = [[1, 2, 3, 4], [0, 0, 0, 0], 2.5].map(copy);
          compileModule(r.module, { precision: 'f32' }).fns.scale!(...args);
          return args;
        };
        expect(run(written.result)).toEqual(run(base.result));
        expect(run(written.result)[1]).toEqual([2.5, 5, 7.5, 10]);
        const face = (u: string): string =>
          withoutSpans(hostFace(kernel(u), { fileName: 'a.shade.ts' }).exports);
        expect(face(t)).toBe(face('array<f32>'));
      });

      it("is a storage binding's value type, with the emit of array<f32>", () => {
        const base = bothTake(binding('array<f32>'));
        const written = bothTake(binding(t));
        expect(written.result.wgsl).toBe(base.result.wgsl);
        expect(emitOf(written.result)).toBe(emitOf(base.result));
        expect(written.result.wgsl).toContain('array<f32>');
        expect(withoutSpans(written.result.module.bindings)).toBe(
          withoutSpans(base.result.module.bindings),
        );
        const readWrite = (u: string): string =>
          binding(u).replace(`storage<${u}>`, `storage<${u}, "read_write">`);
        expect(emitOf(bothTake(readWrite(t)).result)).toBe(
          emitOf(bothTake(readWrite('array<f32>')).result),
        );
      });

      it('is the last field of a storage struct, with the emit of array<f32>', () => {
        const base = bothTake(lastField('array<f32>'));
        const written = bothTake(lastField(t));
        expect(emitOf(written.result)).toBe(emitOf(base.result));
      });

      it('has a u32 length and reads as array<f32> in both halves', () => {
        const halves = bothTake(kernel(t).replace('i < xs.length', 'i < xs.length + 0'));
        expect(halves.hover('length')).toContain('length: u32');
        expect(halves.hover('xs:')).toContain('(parameter) xs: array<f32>');
        expect(bothTake(binding(t)).hover('length')).toContain('length: u32');
      });

      it('runs the methods that read an array as array<f32> runs them', () => {
        const source = (u: string): string => `"use typeshade";
export function f(xs: ${u}, out: f32[]) {
  xs.forEach((x, i) => {
    out[i] = x + f32(xs.indexOf(x)) + f32(xs.findIndex((y) => y > x));
  });
  for (const x of xs) {
    out[0] = x;
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

describe('a write through an array that nothing writes is refused in both halves (change 0114, S1)', () => {
  for (const t of SPELLINGS) {
    const said = writeSentence('xs', t, WRITABLE[t]);
    const WRITES: readonly (readonly [string, string])[] = [
      ['an element assignment', 'xs[0] = 1.;'],
      ['a compound assignment', 'xs[1] += 1.;'],
      ['an increment', 'xs[2]++;'],
      ['push', 'for (let i = 0; i < 2; i++) {\n    xs.push(2.);\n  }'],
      ['fill', 'xs.fill(0.);'],
      ['sort', 'xs.sort();'],
      ['a write from a local function', 'const g = (k: f32) => {\n    xs[0] = k;\n  };\n  g(1.);'],
    ];
    for (const [what, write] of WRITES) {
      it(`${t}: ${what}`, () => {
        bothRefuse(
          `"use typeshade";\nexport function f(xs: ${t}) {\n  ${write}\n}\n`,
          'TS8005',
          said,
        );
      });
    }
  }

  it('names the alias a parameter is declared with, and no remedy', () => {
    bothRefuse(
      `"use typeshade";\ntype Xs = readonly f32[];\nexport function f(xs: Xs) {\n  xs[0] = 1.;\n}\n`,
      'TS8005',
      writeSentence('xs', 'Xs'),
    );
  });

  it('refuses a write to a readonly storage binding, read or read_write, in either form', () => {
    const source = `"use typeshade";
declare const xs: storage<readonly f32[]>;
const ys = storage<ReadonlyArray<f32>, "read_write">(0, 3);
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  xs[gid.x] = 1.;
  ys.fill(0.);
}
`;
    const refused = bothRefuse(source, 'TS8005', [
      writeSentence('xs', 'readonly f32[]', 'declare const xs: storage<f32[], "read_write">'),
      writeSentence(
        'ys',
        'ReadonlyArray<f32>',
        'const ys = storage<Array<f32>, "read_write">(0, 3)',
      ),
    ]);
    const lines = refused.compiler.flatMap(remedyLines);
    expect(lines).toHaveLength(2);
    bothTake(lines.reduce(applyRemedy, source));
  });

  it('refuses a write through the readonly last field of a storage struct', () => {
    bothRefuse(
      `"use typeshade";
class P {
  count: u32;
  data: readonly f32[];
}
declare const p: storage<P, "read_write">;
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  p.count = u32(1);
  p.data[gid.x] = 1.;
}
`,
      'TS8005',
      writeSentence('p.data', 'readonly f32[]', 'f32[]'),
    );
  });

  it('keeps a read binding of f32[] refused as it was, with no TypeScript report beside it', () => {
    const halves = bothHalves(`"use typeshade";
declare const xs: storage<f32[]>;
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  xs[gid.x] = 1.;
  xs.fill(0.);
}
`);
    expect(halves.compiler).toHaveLength(2);
    expect(halves.compiler[0]).toContain('typeshade TS8005: Cannot assign to "xs"');
    expect(halves.compiler[1]).toContain('typeshade TS8099: "xs.fill" writes "xs"');
    expect(halves.editor).toEqual(halves.compiler);
  });
});

describe('where array<T> with no size is refused, so is a readonly array (change 0114, S1)', () => {
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

  it('ReadonlyArray<T> with two type arguments names array<T, N> in the compiler', () => {
    const halves = bothHalves(`"use typeshade";
export function f(xs: ReadonlyArray<f32, 4>): f32 {
  return 0.;
}
`);
    const said =
      'typeshade TS8002: ReadonlyArray<T> takes one type argument, the element. A list with a size is array<T, N>.';
    expect(halves.compiler).toEqual([said]);
    expect(halves.editor).toContain(said);
  });

  it('readonly array<f32> stays refused with TS8002 in both halves', () => {
    const halves = bothHalves(`"use typeshade";
export function f(xs: readonly array<f32>) {}
`);
    const said = 'typeshade TS8002: Unsupported type syntax "readonly array<f32>".';
    expect(halves.compiler).toEqual([said]);
    expect(halves.editor).toContain(said);
  });
});
