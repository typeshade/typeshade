// ═══ fp64-lane-stripes — the CPU agrees with the arithmetic the GPU runs ═══
//
// `emit-goldens.test.ts` pins this example's bytes and `scripts/compile-gate.ts` proves Tint
// and a real WebGL2 driver accept them. Neither says the program computes the right number,
// which for an emulated double is the whole point: a df64 pair that lowered to plausible but
// wrong f32 arithmetic would pass both.
//
// So this is the third leg. `stripeAt` is the example's numeric core, and it is evaluated
// twice over the same IR: once on the CPU oracle, which carries an `f64` natively as a
// JavaScript double (JS numbers ARE IEEE binary64 — the definitional semantics), and once on
// the fp64-LOWERED module under an f32-rounding regime, which is the arithmetic a GPU
// executes. The two agreeing is what "CPU/GPU agreement" means for this example, and it is
// the metamorphic gate the fp64 pass is designed around (`oracle(fp64Lower(m)) ≈ oracle(m)`).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/index.js';
import { compileModule } from '../src/core/oracle.js';
import { fp64Lower } from '../src/core/passes/fp64-lower.js';
import { splitF64 } from '../src/core/fp64/df64-lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'fp64-lane-stripes.shade.ts'), 'utf8');
const { diagnostics, module } = compile(source);

/** hi + lo — the double a lowered f64 pair stands for. */
const val = (r: unknown): number => {
  const [hi, lo] = r as number[];
  return hi! + lo!;
};

describe('fp64-lane-stripes computes the same stripe on both precisions', () => {
  it('compiles with no diagnostics', () => {
    expect(diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  // The distances the example is about: 1e7 is where an f32 ulp reaches 1 and the plain-f32
  // half of the picture goes flat, so it is also where the emulation has to still be right.
  const cases: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.5, 0.0625],
    [1e6 + 0.5, 0.25],
    [1e7 + 0.0625, 0],
    [1e7 + 0.375, -0.125],
    [123456789.0625, 0.03125],
  ];

  it.each(cases)('stripeAt(%f, %f) agrees between the double and the lowered pair', (o, t) => {
    const double = compileModule(module).fns.stripeAt!(o, t) as number;
    const emulated = val(
      compileModule(fp64Lower(module), { precision: 'f32' }).fns.stripeAt!(splitF64(o), t),
    );
    // The pair carries ~48 significand bits against the double's 53, so the comparison is a
    // tolerance and not an equality — but a thousand times tighter than one f32 ulp at 1e7,
    // which is what the discriminative half below measures.
    expect(Math.abs(emulated - double), `stripeAt(${o}, ${t})`).toBeLessThan(1e-6);
  });

  it('and plain f32 cannot do it — the discriminative half', () => {
    // At 1e7 an f32 ulp is 1, so a coordinate 1/16 of the way into a 0.125-wide stripe
    // rounds to the stripe boundary and the band is simply gone: the same expression in f32
    // answers 0 where the double answers 0.5, half a stripe away. Without this, the
    // agreement above would be satisfied by an implementation that quietly narrowed
    // everything to f32 and agreed with itself.
    const [o, t] = [1e7 + 0.0625, 0] as const;
    const double = compileModule(module).fns.stripeAt!(o, t) as number;
    expect(double).toBeCloseTo(0.5, 10);
    const asF32 = Math.fround(Math.fround(Math.fround(o) + Math.fround(t)) / 0.125);
    expect(asF32 - Math.floor(asF32)).toBe(0);
    // And the emulation lands on the double's answer, not f32's.
    const emulated = val(
      compileModule(fp64Lower(module), { precision: 'f32' }).fns.stripeAt!(splitF64(o), t),
    );
    expect(Math.abs(emulated - double)).toBeLessThan(1e-6);
  });
});
