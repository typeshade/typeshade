// The libm of the CPU tier (change 0042, milestone 1a): the JavaScript form of the routines of
// `trig.shade.ts`, which `scripts/bake-libm.ts` writes to `trig.generated.ts`.
//
// The generated code is a factory over the op library, as the generated code of any module is
// (`cpu-codegen.ts`). `src/core/cpu-runtime.ts` builds the routines once from its own tables
// and binds `sin` and `cos` to them, so the interpreter, the generated JavaScript and every
// helper call one form. No code is built at run time.

import { trigFactory } from './trig.generated.js';

/** What the generated routines read off the op library: its builtin tables and the integer
 *  division helpers. */
export interface LibmHost {
  readonly B: Readonly<Record<string, (...args: never[]) => unknown>>;
  readonly L: Readonly<Record<string, { readonly lane: (...xs: number[]) => number }>>;
  readonly intDiv: (a: number, b: number, kind: 'i32' | 'u32') => number;
  readonly intRem: (a: number, b: number, kind: 'i32' | 'u32') => number;
}

/** sin and cos, for an `f32` operand and for an `f64` operand. Each has an error under 1 ULP
 *  (decision N9 of change 0042). An `f32` routine takes and returns an `f32` value. */
export interface LibmTrig {
  readonly sinF32: (x: number) => number;
  readonly cosF32: (x: number) => number;
  readonly sinF64: (x: number) => number;
  readonly cosF64: (x: number) => number;
}

/** The routines of `trig.shade.ts`, built over `host`. */
export function makeTrig(host: LibmHost): LibmTrig {
  // The generated functions call each other through `$.F`, filled once they exist.
  const $ = { ...host, F: {} as Record<string, unknown> };
  const fns = trigFactory($) as Record<string, unknown>;
  $.F = fns;
  return fns as unknown as LibmTrig;
}
