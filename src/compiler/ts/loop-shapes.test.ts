// Loop diagnostics and the multiplicative step (#8 A15).
//
// Two things were wrong with the way this surface answered a `for` loop. A loop that exits
// too LATE was reported as one that does not exit at all, because the trip counter walked the
// sequence and could only look `MAX_LOOP_TRIPS + 2` steps ahead — so a policy violation wore
// the words of a non-terminating loop. And `i *= 2`, an ordinary counted loop that reaches its
// bound in six iterations, was "Unsupported for-update" because nothing lowered it.
//
// The multiplicative step has no `fn()` EDSL spelling: `forRange` builds an additive loop and
// nothing else, so ir-equality.test.ts cannot pin `i *= 2` against a twin the way it pins the
// rest of this surface. Until `forRange` takes a step operation, the CPU count below is what
// stands in for that: the interpreter and the generator both run the emitted loop and both
// have to agree with the sequence written out beside the assertion.
//
// Verifies: Rule 7.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';

/** One loop, as a whole module, with `head` spliced into the `for`. */
function loop(head: string): string {
  return `"use typeshade";
    export function f(): f32 {
      let a = 0.;
      for (${head}) {
        a += 1.;
      }
      return a;
    }
  `;
}

function diagnose(head: string): string {
  const r = compileTsSource(loop(head));
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

function accepts(head: string): void {
  const r = compileTsSource(loop(head));
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
}

/** How many times the loop's body runs, on the CPU, once the header is accepted. */
function trips(head: string): unknown {
  const c = compile(loop(head));
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c.eval('f', []);
}

describe('a trip count has no ceiling (Rule 7.5, #203)', () => {
  it('accepts a loop of any length, where 256 trips used to be the most', () => {
    // These were `for trip count N exceeds 256.` Neither target limits a trip count, and
    // nothing downstream read the ceiling but the check itself (#203).
    expect(trips('let i: i32 = 0; i < 1024; i++')).toBe(1024);
    expect(trips('let i: u32 = u32(0); i < u32(100000); i++')).toBe(100000);
    expect(trips('let i: i32 = 0; i < 4096; i += 4')).toBe(1024);
    expect(trips('let i: i32 = 257; i > 0; i -= 1')).toBe(257);
    // A loop whose condition is false at the start runs zero times and is not an error.
    expect(trips('let i: i32 = 8; i < 4; i++')).toBe(0);
  });

  it('keeps "does not exit" for a loop that really does not', () => {
    expect(diagnose('let i: i32 = 0; i < 16; i -= 1')).toBe(
      'for (i = 0; i < 16; i -= 1) does not exit.',
    );
    // 0 * 2 is 0 forever, so this one is genuinely stuck even though the factor advances.
    expect(diagnose('let i: i32 = 0; i < 64; i *= 2')).toBe(
      'for (i = 0; i < 64; i *= 2) does not exit.',
    );
  });
});

describe('a multiplicative step is a counted loop', () => {
  it('accepts *= and /=, and emits the update as written', () => {
    const r = compileTsSource(loop('let i: i32 = 1; i < 64; i *= 2'));
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('i *= 2');
    const down = compileTsSource(loop('let i: i32 = 64; i > 1; i /= 2'));
    expect(down.diagnostics).toEqual([]);
    expect(down.wgsl).toContain('i /= 2');
  });

  it('accepts -= too, which was refused for the same reason', () => {
    accepts('let i: i32 = 8; i > 0; i -= 1');
    accepts('let i: i32 = 16; i > 0; i -= 4');
  });

  it('runs the right number of times on the CPU', () => {
    const c = compile(`
      "use typeshade";
      export function doubling(): f32 {
        let a = 0.;
        for (let i: i32 = 1; i < 64; i *= 2) {
          a += 1.;
        }
        return a;
      }
      export function halving(): f32 {
        let a = 0.;
        for (let i: i32 = 64; i > 1; i /= 2) {
          a += 1.;
        }
        return a;
      }
      export function down(): f32 {
        let a = 0.;
        for (let i: i32 = 8; i > 0; i -= 2) {
          a += 1.;
        }
        return a;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('doubling', [])).toBe(6); // 1 2 4 8 16 32
    expect(c.eval('halving', [])).toBe(6); // 64 32 16 8 4 2
    expect(c.eval('down', [])).toBe(4); // 8 6 4 2
  });

  it('refuses a step that cannot advance, each for its own reason', () => {
    // One message — "step of i is 0" — used to cover a case it did not fit and three it never
    // reached, since the other three could not be spelled at all.
    expect(diagnose('let i: i32 = 0; i < 16; i += 0')).toBe(
      'for step "i += 0" never advances "i": a step of 0 leaves it where it is.',
    );
    expect(diagnose('let i: i32 = 1; i < 64; i *= 1')).toBe(
      'for step "i *= 1" never advances "i": multiplying or dividing by 1 leaves it where it is.',
    );
    expect(diagnose('let i: i32 = 1; i < 64; i *= 0')).toBe(
      'for step "i *= 0" never advances "i": multiplying by 0 pins it at 0.',
    );
    // Not "undefined on both targets": WGSL DEFINES integer `x / 0` as `x`, which is exactly
    // why the loop is stuck rather than unpredictable.
    expect(diagnose('let i: i32 = 64; i > 1; i /= 0')).toBe(
      'for step "i /= 0" never advances "i": dividing by 0 cannot move it.',
    );
  });

  it('refuses a step the induction type cannot hold, at the source', () => {
    // These used to be retyped to a literal the type cannot spell — `{ op: 'lit', type: i32,
    // value: 2.5 }` — and only the BACKEND caught them, as an SD0017 out of compile() naming
    // a literal the author's source does not contain. `fitsTarget` is the predicate #8 A3
    // uses at a declaration, so a step and an initializer agree on what an integer holds.
    expect(diagnose('let i: i32 = 1; i < 64; i *= 2.5')).toBe(
      'for step "i *= 2.5" does not fit "i", which is i32: 2.5 is not a whole number.',
    );
    expect(diagnose('let i: i32 = 0; i < 16; i += 3000000000')).toBe(
      'for step "i += 3000000000" does not fit "i", which is i32: 3000000000 is outside its range.',
    );
    expect(diagnose('let i: u32 = u32(0); i < u32(16); i += -1')).toBe(
      'for step "i += -1" does not fit "i", which is u32: -1 is outside its range.',
    );
    // A step WRITTEN as a float but valued as a whole number is still accepted, because it was
    // before: `i += 2.0` emitted `i += 2` on the merge base and still does. Refusing it here
    // would take back source that compiles.
    accepts('let i: i32 = 0; i < 16; i += 2.0');
    accepts('let i: i32 = 0; i < 16; i += (1.5 + 1.5)');
  });

  it('names the forms it takes when the update is none of them', () => {
    // `%=` is not one of the four the update table takes — a remainder step is a fixed point
    // after one application, so no `for` it heads exits — and a plain assignment is not an
    // update shape at all. Both stop in lowerUpdate, before the counting.
    expect(diagnose('let i: i32 = 0; i < 16; i %= 3')).toBe('Unsupported for-update.');
    expect(diagnose('let i: i32 = 0; i < 16; i = i * i')).toBe('Unsupported for-update.');
    // A step that lowers but is not a compile-time constant reaches the counter, which names
    // the forms it can read.
    const r = compileTsSource(`"use typeshade";
      export function f(n: i32): f32 {
        let a = 0.;
        for (let i: i32 = 1; i < 64; i *= n) {
          a += 1.;
        }
        return a;
      }
    `);
    expect(r.diagnostics[0]!.message).toBe(
      'for-update must be i++ / i += <const>, or i *= / /= <const>.',
    );
  });
});

describe('the exact count handles every comparison', () => {
  it('counts <, <=, > and >= and the step sizes between them', () => {
    accepts('let i: i32 = 0; i < 16; i += 3'); // 0 3 6 9 12 15
    accepts('let i: i32 = 0; i <= 16; i += 3');
    accepts('let i: i32 = 16; i > 0; i -= 3');
    accepts('let i: i32 = 16; i >= 0; i -= 3');
    // An exact count for each of the four thresholds, so the loop the closed form accepts is
    // the loop that runs. `>=` and `<=` run the extra trip that lands ON the bound.
    expect(trips('let i: i32 = 0; i <= 1024; i += 2')).toBe(513);
    expect(trips('let i: i32 = 0; i < 1024; i += 2')).toBe(512);
    expect(trips('let i: i32 = 0; i > -1024; i--')).toBe(1024);
    expect(trips('let i: i32 = 0; i >= -1024; i -= 1')).toBe(1025);
  });

  it('counts !== as hitting a value, not as crossing a threshold', () => {
    accepts('let i: i32 = 0; i !== 16; i += 2');
    expect(trips('let i: i32 = 0; i !== 1024; i++')).toBe(1024);
    // A bound the step steps straight over is never reached.
    // The message prints the IR's own comparison tag, which is WGSL's `!=`.
    expect(diagnose('let i: i32 = 0; i !== 9; i += 2')).toBe(
      'for (i = 0; i != 9; i += 2) does not exit.',
    );
    // `!==` needs no induction-range check of its own, unlike the four thresholds: it only
    // counts when the walk lands EXACTLY on the bound, so every value it visits lies between
    // the start and the bound and the last one IS the bound. A bound the type cannot hold is
    // therefore a bound LITERAL the type cannot hold, and it is refused where it is spelled:
    // an integer literal outside i32 does not take the induction variable's type (#8 A3), so
    // it stays f32 and the comparison itself is what says no. Pinned here so that "this arm
    // has no range check" stays a fact about a covered case.
    expect(diagnose('let i: i32 = 2147483645; i !== 2147483650; i += 1')).toBe(
      'Type mismatch: cannot compare i32 and f32 — no implicit int/float conversion. ' +
        'Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    );
  });

  it('separates a loop that never exits from one that runs out of the type', () => {
    // 1 3 9 … 1162261467, and the next value is 3486784401, which an i32 cannot hold. The
    // loop does reach its bound; what the hardware does on the way is overflow, not an exit.
    // One `undefined` used to cover this and the genuinely stuck loop above, so both were
    // told "does not exit", and only one of them was.
    expect(diagnose('let i: i32 = 1; i < 2147483647; i *= 3')).toBe(
      'for (i = 1; i < 2147483647; i *= 3) walks "i" outside the range of i32 before the condition fails.',
    );
    // The closed form has the same case: the value AFTER the final trip is computed before the
    // condition rejects it, and 2147484000 is not an i32.
    expect(diagnose('let i: i32 = 2147483000; i < 2147483647; i += 1000')).toBe(
      'for (i = 2147483000; i < 2147483647; i += 1000) walks "i" outside the range of i32 before the condition fails.',
    );
    // A u32 loop that walks down to exactly 0 stays inside its own range and is accepted.
    accepts('let i: u32 = u32(4); i > u32(0); i -= 1');
  });
});
