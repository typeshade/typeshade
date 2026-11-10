import { describe, it, expect } from 'vitest';
import type { Expr, ModuleDecl } from '../ir/index.js';
import { f32T, vec2fT, i32T } from '../ir/index.js';
import { compileModule } from '../oracle.js';
import { LIBM_TRIG } from '../cpu-runtime.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { froundF32 } from './precision.js';
import { compile } from '../../compiler/ts/compile.js';
import { CPU_ONLY_IDS } from '../cpu-only-ids.js';
import { startDebugSession } from '../debug/session.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

// X-GIS #2426 — the f32 oracle mode. The default oracle is f64 BY DESIGN (it is the algebra
// reference); this pass makes the same IR evaluate as a correctly-rounding f32 machine, so a
// parity gate can compare at ulp scale instead of a tolerance wide enough to hide a real error.

/** 0.1 + 0.2 is the classic case: f64 gives 0.30000000000000004, f32 gives 0.30000001192... */
const addModule: ModuleDecl = {
  consts: [],
  structs: [],
  bindings: [],
  funcs: [
    {
      name: 'k',
      params: [{ name: 'a', type: f32T }],
      ret: f32T,
      attrs: [],
      body: [
        {
          s: 'return',
          expr: {
            op: 'binop',
            type: f32T,
            bop: '+',
            a: { op: 'param', type: f32T, name: 'a' },
            b: { op: 'lit', type: f32T, value: 0.2 },
          },
        },
      ],
    },
  ],
};

describe('froundF32 — the f32 oracle mode', () => {
  it('rounds after every f32 operation, where f64 does not', () => {
    const f64 = compileModule(addModule).fns.k!(0.1);
    const f32 = compileModule(addModule, { precision: 'f32' }).fns.k!(0.1);
    expect(f64).toBe(0.1 + 0.2); // 0.30000000000000004 — the f64 answer, unchanged
    expect(f32).toBe(Math.fround(Math.fround(0.1) + Math.fround(0.2)));
    expect(f32).not.toBe(f64);
  });

  it('rounds the PARAMETER and the LITERAL too, which the wrappers it replaces did not', () => {
    // 16777217 is the first integer f32 cannot represent; it must arrive rounded, not merely
    // be rounded after the addition.
    const m: ModuleDecl = {
      ...addModule,
      funcs: [
        {
          ...addModule.funcs[0]!,
          body: [{ s: 'return', expr: { op: 'param', type: f32T, name: 'a' } }],
        },
      ],
    };
    expect(compileModule(m).fns.k!(16777217)).toBe(16777217);
    expect(compileModule(m, { precision: 'f32' }).fns.k!(16777217)).toBe(16777216);

    const litOnly: ModuleDecl = {
      ...addModule,
      funcs: [
        {
          ...addModule.funcs[0]!,
          body: [{ s: 'return', expr: { op: 'lit', type: f32T, value: 0.1 } }],
        },
      ],
    };
    expect(compileModule(litOnly).fns.k!(0)).toBe(0.1);
    expect(compileModule(litOnly, { precision: 'f32' }).fns.k!(0)).toBe(Math.fround(0.1));
  });

  it('overflows to Infinity as f32 does', () => {
    const m: ModuleDecl = {
      ...addModule,
      funcs: [
        {
          ...addModule.funcs[0]!,
          body: [
            {
              s: 'return',
              expr: {
                op: 'binop',
                type: f32T,
                bop: '*',
                a: { op: 'param', type: f32T, name: 'a' },
                b: { op: 'lit', type: f32T, value: 1e30 },
              },
            },
          ],
        },
      ],
    };
    // f64 has the range for 1e30 * 1e30 (the exact double is 1.0000000000000001e+60, which is
    // why this asserts finiteness rather than a literal); f32 tops out at ~3.4e38.
    expect(Number.isFinite(compileModule(m).fns.k!(1e30) as number)).toBe(true);
    expect(compileModule(m, { precision: 'f32' }).fns.k!(1e30)).toBe(Infinity);
  });

  it('leaves an ASSIGNMENT TARGET alone — the trap the naive rule falls into', () => {
    // `mapStmt` rewrites targets as well as values, so wrapping every f32 expr would emit
    // `__fround(x) = …`. A var written then read must still round its stored value.
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'k',
          params: [{ name: 'a', type: f32T }],
          ret: f32T,
          attrs: [],
          body: [
            { s: 'var', name: 'acc', type: f32T, init: { op: 'lit', type: f32T, value: 0 } },
            {
              s: 'assign',
              target: { op: 'varref', type: f32T, name: 'acc' },
              expr: {
                op: 'binop',
                type: f32T,
                bop: '+',
                a: { op: 'param', type: f32T, name: 'a' },
                b: { op: 'lit', type: f32T, value: 0.2 },
              },
            },
            { s: 'return', expr: { op: 'varref', type: f32T, name: 'acc' } },
          ],
        },
      ],
    };
    expect(() => compileModule(m, { precision: 'f32' })).not.toThrow();
    expect(compileModule(m, { precision: 'f32' }).fns.k!(0.1)).toBe(
      Math.fround(Math.fround(0.1) + Math.fround(0.2)),
    );
    // the target itself is untouched in the rewritten IR
    const assignStmt = froundF32(m).funcs[0]!.body[1]!;
    expect(assignStmt.s).toBe('assign');
    expect((assignStmt as { target: Expr }).target.op).toBe('varref');
  });

  it('is idempotent, and leaves non-f32 types alone', () => {
    const once = froundF32(addModule);
    expect(JSON.stringify(froundF32(once))).toBe(JSON.stringify(once));

    const intM: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'k',
          params: [{ name: 'a', type: i32T }],
          ret: i32T,
          attrs: [],
          body: [{ s: 'return', expr: { op: 'param', type: i32T, name: 'a' } }],
        },
      ],
    };
    expect(JSON.stringify(froundF32(intM))).toBe(JSON.stringify(intM));
  });

  it('rounds a compound assignment, which it spelled out, as it rounds `s = s + x`', () => {
    // `s += x` computed its sum inside the statement, where no expression rewrite reached it,
    // so it stayed an f64 sum in f32 mode on both CPU backends (found by change 0013's tests).
    const run = (body: string) => {
      const r = compile(
        `"use typeshade";\nexport function k(a: f32, n: i32): f32 { let s = 0.; let v = vec2(0.); for (let i = 0; i < n; i++) { ${body} } return s + v.y; }`,
        { fileName: 'm.shade.ts' },
      );
      const js = compileModuleJs(r.module, { precision: 'f32' }).fns.k!(0.1 as never, 10 as never);
      const interp = compileModule(r.module, { precision: 'f32' }).fns.k!(
        0.1 as never,
        10 as never,
      );
      expect(Object.is(js, interp)).toBe(true);
      return js;
    };
    let want = 0;
    for (let i = 0; i < 10; i++) want = Math.fround(want + Math.fround(0.1));
    expect(run('s += a;')).toBe(want);
    expect(run('s = s + a;')).toBe(want);
    // A vector target rounds component-wise too.
    expect(run('v += vec2(0., a);')).toBe(want);
    const once = froundF32(
      compile(`"use typeshade";\nexport function k(a: f32): f32 { let s = 1.; s *= a; return s; }`)
        .module,
    );
    expect(JSON.stringify(froundF32(once))).toBe(JSON.stringify(once));
  });

  it('rounds component-wise over f32 vectors', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'k',
          params: [{ name: 'a', type: vec2fT }],
          ret: vec2fT,
          attrs: [],
          body: [{ s: 'return', expr: { op: 'param', type: vec2fT, name: 'a' } }],
        },
      ],
    };
    expect(compileModule(m, { precision: 'f32' }).fns.k!([0.1, 16777217])).toEqual([
      Math.fround(0.1),
      16777216,
    ]);
  });

  // The mode has to reach BOTH engines identically, or they stop being differentials of each
  // other. One shared BUILTINS entry should make that free; this is what proves it.
  it('the interpreter and the codegen agree in f32 mode', () => {
    for (const v of [0.1, 16777217, 1e30, -0, NaN, 1 / 3]) {
      const a = compileModule(addModule, { precision: 'f32' }).fns.k!(v);
      const b = compileModuleJs(addModule, { precision: 'f32' }).fns.k!(v);
      expect(Object.is(a, b), `v=${v}: interp=${a} js=${b}`).toBe(true);
    }
  });

  it('defaults to f64 — an omitted option changes nothing', () => {
    expect(compileModule(addModule).fns.k!(0.1)).toBe(compileModule(addModule, {}).fns.k!(0.1));
  });
});

// A function an author declares under the name of a CPU-only id is that function (Rule 9.5).
// The pass read the name `__fround` alone, dropped the author's call and kept its argument, so
// `__fround(x)` gave `x` rounded on the interpreter and on the generated JavaScript. The emitted
// WGSL and GLSL called the author's function, so the CPU and the GPU disagreed.
describe('an author-declared function named like a CPU-only id', () => {
  const editorDiagnostics = (source: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
  };

  for (const id of CPU_ONLY_IDS) {
    const source = `"use typeshade";
function ${id}(x: f32): f32 { return x * 2.0 + 0.1; }
export function once(x: f32): f32 { return ${id}(x) + 0.25; }
export function twice(x: f32): f32 { return ${id}(${id}(x)); }
export function lanes(v: vec2): vec2 { return vec2(${id}(v.x), ${id}(v.y)); }
@fragment export function fs(uv: location<0, vec2>): vec4 { return vec4(once(uv.x), twice(uv.y), 0., 1.); }
`;
    const fr = Math.fround;
    const own = (x: number): number => fr(fr(fr(x) * 2) + fr(0.1));

    it(`${id}: compile() and the language service accept the declaration and the calls`, () => {
      const r = compile(source);
      expect(r.diagnostics).toEqual([]);
      expect(editorDiagnostics(source)).toEqual([]);
      // Both writers emit the author's function and call it.
      expect(r.wgsl).toMatch(/fn \w+\(x: f32\) -> f32 \{\n {2}return \(\(x \* 2\.0\) \+ 0\.1\);/);
      expect(r.glsl?.fragment).toContain('* 2.0) + 0.1)');
    });

    it(`${id}: the interpreter, the generated JavaScript and the stepper call the author's function`, () => {
      const module = compile(source).module;
      const x = 0.3;
      for (const precision of ['f32', 'f64'] as const) {
        const want =
          precision === 'f32'
            ? { once: fr(own(x) + 0.25), twice: own(own(x)) }
            : { once: x * 2 + 0.1 + 0.25, twice: (x * 2 + 0.1) * 2 + 0.1 };
        for (const build of [compileModule, compileModuleJs]) {
          const fns = build(module, { precision }).fns as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          expect(fns['once']!(x)).toBe(want.once);
          expect(fns['twice']!(x)).toBe(want.twice);
          if (precision === 'f32') expect(fns['lanes']!([x, 1])).toEqual([own(x), own(1)]);
        }
        const stepper = startDebugSession(module, 'once', [x], { precision });
        stepper.continue();
        expect(stepper.result).toBe(want.once);
      }
    });

    it(`${id}: the pass stays idempotent on such a module`, () => {
      const once = froundF32(compile(source).module);
      expect(froundF32(once)).toEqual(once);
    });
  }

  it('the rounding step itself is still collapsed: a second application adds no wrapper', () => {
    const once = froundF32(addModule);
    expect(froundF32(once)).toEqual(once);
  });
});

// A module constant whose value is an expression computes in `'f32'` precision as a function
// body does. The pass rewrote function bodies only, so `const S: f32 = sin(X)` ran in f64 on the
// unrounded `X`, while `sin(X)` in a function read `X` as the f32 it is, as the GPU does.
describe('a module constant with an expression rounds as a function body does', () => {
  const SOURCE = `"use typeshade";
const X: f32 = 100.7;
const S: f32 = sin(X);
const C: f32 = cos(X) * 2.0;
const V: vec2 = vec2(sin(X), 0.1);
export function constantS(): f32 { return S; }
export function functionS(): f32 { return sin(X); }
export function constantC(): f32 { return C; }
export function functionC(): f32 { return cos(X) * 2.0; }
export function constantV(): vec2 { return V; }
export function functionV(): vec2 { return vec2(sin(X), 0.1); }
@fragment export function fs(uv: location<0, vec2>): vec4 { return vec4(S, C, V); }
`;
  const compiled = compile(SOURCE);
  const fr = Math.fround;

  it('compile() and the language service accept the program, and the emit keeps the expressions', () => {
    expect(compiled.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    expect(service.getDiagnostics('a.ts')).toEqual([]);
    // The GPU computes each constant from `X`, which it holds as an f32. The pass runs on the
    // CPU engines only, so this text is the same before and after the fix.
    expect(compiled.wgsl).toContain('const X: f32 = 100.7;\nconst S: f32 = sin(X);');
    expect(compiled.wgsl).toContain('const C: f32 = (cos(X) * 2.0);');
    expect(compiled.wgsl).toContain('const V: vec2<f32> = vec2<f32>(sin(X), 0.1);');
  });

  it("in 'f32' precision the constant is the function's value, on every CPU walk", () => {
    const sinX = fr(LIBM_TRIG.sinF64(fr(100.7)));
    // The operand is where the two differed: the f64 routine on the unrounded 100.7.
    expect(sinX).not.toBe(fr(LIBM_TRIG.sinF64(100.7)));
    for (const build of [compileModule, compileModuleJs]) {
      const fns = build(compiled.module, { precision: 'f32' }).fns as Record<string, () => unknown>;
      expect(fns['functionS']!()).toBe(sinX);
      expect(fns['constantS']!()).toBe(sinX);
      expect(fns['constantC']!()).toBe(fns['functionC']!());
      expect(fns['constantC']!()).toBe(fr(fr(LIBM_TRIG.cosF64(fr(100.7))) * 2));
      expect(fns['constantV']!()).toEqual(fns['functionV']!());
      expect(fns['constantV']!()).toEqual([sinX, fr(0.1)]);
    }
    for (const [name, want] of [
      ['constantS', sinX],
      ['functionS', sinX],
    ] as const) {
      const stepper = startDebugSession(compiled.module, name, [], { precision: 'f32' });
      stepper.continue();
      expect(stepper.result).toBe(want);
    }
  });

  it("in 'f64' precision nothing rounds, as before", () => {
    for (const build of [compileModule, compileModuleJs]) {
      const fns = build(compiled.module, { precision: 'f64' }).fns as Record<string, () => unknown>;
      expect(fns['constantS']!()).toBe(LIBM_TRIG.sinF64(100.7));
      expect(fns['functionS']!()).toBe(LIBM_TRIG.sinF64(100.7));
    }
  });

  it('the pass stays idempotent on a module with such constants', () => {
    const once = froundF32(compiled.module);
    expect(froundF32(once)).toEqual(once);
    // And it rewrites the constants: a module with none is returned with the same constants.
    expect(once.consts.find((c) => c.name === 'S')!.valueExpr).not.toEqual(
      compiled.module.consts.find((c) => c.name === 'S')!.valueExpr,
    );
  });

  it('a constant the compiler folds to a literal is the literal the GPU receives, rounded', () => {
    // `Y` has no expression left: the front end folds it and emits the literal. The CPU reads
    // that value rounded once, which is what a GPU reads from the emitted text.
    const folded = compile(`"use typeshade";
const X: f32 = 0.0117;
const Y: f32 = X * 3.0;
export function constantY(): f32 { return Y; }
@fragment export function fs(uv: location<0, vec2>): vec4 { return vec4(Y, 0., 0., 1.); }
`);
    expect(folded.diagnostics).toEqual([]);
    const literal = /const Y: f32 = ([0-9.e+-]+);/.exec(folded.wgsl ?? '')?.[1];
    expect(literal).toBeDefined();
    for (const build of [compileModule, compileModuleJs]) {
      const fns = build(folded.module, { precision: 'f32' }).fns as Record<string, () => unknown>;
      expect(fns['constantY']!()).toBe(fr(Number(literal)));
    }
  });
});
