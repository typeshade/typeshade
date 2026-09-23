// ═══ fp64-julia — the escape loop computes each square once a trip ═══
//
// The escape loop needs zx², zy² twice a trip: in the step (zx² − zy² + c) and in |z|² for the
// escape test. Written as two expressions, the same square is computed twice, and whether an
// optimizer can share them depends on WHERE the two sit. In the shape the example started
// from, the test `if (zx*zx + zy*zy <= 16)` dominates the step in its body, so a dominator-
// based CSE shares the squares within the trip. Once |z|² is CARRIED (refreshed at the end of
// the step, so a trip after escape recomputes nothing), the refresh at the end of trip k and
// the step at the start of trip k+1 square the same z on opposite sides of the loop's back
// edge, and neither dominates the other: no CSE shares them, and the f32 half paid two
// multiplies a trip more than the first shape did under a dominator CSE. So the f32 half
// carries the squares themselves beside |z|². The f64 half has nothing to carry: its step
// squares in df64 and its refresh squares the narrowed f32 words, two different values.
//
// The byte goldens pin the emit, but a re-bake overwrites them with whatever the example now
// says. This pins the property, on the EDSL original and on its `"use typeshade"` twin (a twin
// spells what its original spells, so a regression in either is a regression): in every loop
// of `fs_julia`, each operand is squared at most once, in f32 or in df64, and the escape test
// calls no df64 comparison (48 bits change which side of 16 |z|² lies on only within an f32
// rounding of the threshold; `fp64-julia.ts` has the measurement).

import { describe, it, expect } from 'vitest';
import { examples } from './index.js';
import { shadeExamples } from './_shade.js';
import { emitModule } from '../src/index.js';

/** The text between the brace at `open` and its partner. */
function braced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('unbalanced braces');
}

/** The body of `fs_julia` in emitted WGSL. */
function fsJulia(wgsl: string): string {
  const at = wgsl.indexOf('fn fs_julia(');
  expect(at, 'fs_julia is emitted').toBeGreaterThanOrEqual(0);
  return braced(wgsl, wgsl.indexOf('{', at));
}

/** Each `for` body of a function, in source order: one trip's worth of code. */
function loopBodies(body: string): string[] {
  return [...body.matchAll(/\bfor \(/g)].map((m) => braced(body, body.indexOf('{', m.index)));
}

/** How many times one trip squares each operand: `(x * x)` in f32, `df64_mul(x, x, …)` or
 *  `df64_sqr(x, …)` in df64. Keyed by the operand's emitted name. */
function squares(trip: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const re of [/\((\w+) \* \1\)/g, /\bdf64_mul\((\w+), \1,/g, /\bdf64_sqr\((\w+),/g])
    for (const m of trip.matchAll(re)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  return counts;
}

const modules = [
  ['fp64-julia', examples.find((e) => e.id === 'fp64-julia')?.module],
  ['fp64-julia-twin', shadeExamples.find((e) => e.id === 'fp64-julia-twin')?.module],
] as const;

describe('fp64-julia: the escape loop computes each square once a trip', () => {
  for (const [id, module] of modules) {
    it(`${id}: no loop in fs_julia squares the same operand twice`, () => {
      expect(module, `${id} is registered`).toBeDefined();
      const trips = loopBodies(fsJulia(emitModule(module!)));
      // One loop a half. Fewer would mean a half lost its loop and the check below read the
      // other half twice; more would mean a loop this file does not know how to read.
      expect(trips).toHaveLength(2);
      for (const [half, trip] of trips.map((t, i) => [i === 0 ? 'f32' : 'f64', t] as const)) {
        const sq = squares(trip);
        // Not vacuous: each half squares both coordinates somewhere in its trip.
        expect(sq.size, `${id} ${half} half: squares found`).toBeGreaterThanOrEqual(2);
        for (const [operand, n] of sq)
          expect(n, `${id} ${half} half: ${operand} squared ${n} times in one trip`).toBe(1);
      }
    });

    it(`${id}: the escape test is taken in f32, not by a df64 comparison`, () => {
      expect(fsJulia(emitModule(module!))).not.toMatch(/\bdf64_(lt|le|gt|ge|eq|ne)\(/);
    });
  }
});
