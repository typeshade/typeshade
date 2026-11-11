// The libm of the CPU tier (change 0042, milestone 1a): the JavaScript form of the routines of
// each family's source, `<family>.shade.ts`, which `scripts/bake-libm.ts` writes to
// `<family>.generated.ts`.
//
// The generated code is a factory over the op library, as the generated code of any module is
// (`cpu-codegen.ts`). `src/core/cpu-runtime.ts` builds the routines once from its own tables
// and binds each builtin of the libm to them, so the interpreter, the generated JavaScript and every
// helper call one form. No code is built at run time.

import { trigFactory } from './trig.generated.js';
import { explogFactory } from './explog.generated.js';
import { invtrigFactory } from './invtrig.generated.js';

/** What the generated routines read off the op library: its builtin tables and the integer
 *  division helpers. */
export interface LibmHost {
  readonly B: Readonly<Record<string, (...args: never[]) => unknown>>;
  readonly L: Readonly<Record<string, { readonly lane: (...xs: number[]) => number }>>;
  readonly intDiv: (a: number, b: number, kind: 'i32' | 'u32') => number;
  readonly intRem: (a: number, b: number, kind: 'i32' | 'u32') => number;
}

/** The routines of the libm, one for each function, on an `f64` (Amendment A2 of change 0042).
 *  Each has an error under 1 ULP (decision N9); `ldexpF64` is correctly rounded. The result for
 *  an `f32` operand is the same routine's result rounded once to `f32`. */
export interface Libm {
  readonly sinF64: (x: number) => number;
  readonly cosF64: (x: number) => number;
  readonly tanF64: (x: number) => number;
  readonly asinF64: (x: number) => number;
  readonly acosF64: (x: number) => number;
  readonly atanF64: (x: number) => number;
  /** The angle of the point (x, y): the first operand is y. */
  readonly atan2F64: (y: number, x: number) => number;
  readonly expF64: (x: number) => number;
  readonly exp2F64: (x: number) => number;
  readonly logF64: (x: number) => number;
  readonly log2F64: (x: number) => number;
  readonly ldexpF64: (x: number, n: number) => number;
  readonly sinhF64: (x: number) => number;
  readonly coshF64: (x: number) => number;
  readonly tanhF64: (x: number) => number;
  readonly asinhF64: (x: number) => number;
  readonly acoshF64: (x: number) => number;
  readonly atanhF64: (x: number) => number;
  /** x to the power y, with ECMA-262's special values (Number::exponentiate). */
  readonly powF64: (x: number, y: number) => number;
}

/** The routines of every family's source, built over `host`. */
export function makeLibm(host: LibmHost): Libm {
  const build = (factory: ($: unknown) => unknown): Record<string, unknown> => {
    // The generated functions of one family call each other through `$.F`, filled once they
    // exist.
    const $ = { ...host, F: {} as Record<string, unknown> };
    const fns = factory($) as Record<string, unknown>;
    $.F = fns;
    return fns;
  };
  return {
    ...build(trigFactory),
    ...build(explogFactory),
    ...build(invtrigFactory),
  } as unknown as Libm;
}
