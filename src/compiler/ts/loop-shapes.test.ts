// Loop diagnostics and the multiplicative step (#8 A15).
//
// Two things were wrong with the way this surface answered a `for` loop. A loop that exits
// too LATE was reported as one that does not exit at all, because the trip counter walked the
// sequence and could only look `MAX_LOOP_TRIPS + 2` steps ahead — so a policy violation wore
// the words of a non-terminating loop. And `i *= 2`, an ordinary counted loop that reaches its
// bound in six iterations, was "Unsupported for-update" because nothing lowered it.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { MAX_LOOP_TRIPS } from './loop-bound.js'

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
  `
}

function diagnose(head: string): string {
  const r = compileTsSource(loop(head))
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

function accepts(head: string): void {
  const r = compileTsSource(loop(head))
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
}

describe('a loop that exits too late says so', () => {
  it('names the trip count instead of claiming the loop does not exit', () => {
    // 1024 exits, at 1024. The old walk gave up after 258 steps and said "does not exit",
    // which is a statement about a different program than the one the author wrote.
    expect(diagnose('let i: i32 = 0; i < 1024; i++')).toBe('for trip count 1024 exceeds 256.')
    expect(diagnose('let i: u32 = u32(0); i < u32(100000); i++')).toBe(
      'for trip count 100000 exceeds 256.',
    )
    expect(diagnose('let i: i32 = 0; i < 4096; i += 4')).toBe('for trip count 1024 exceeds 256.')
  })

  it('keeps "does not exit" for a loop that really does not', () => {
    expect(diagnose('let i: i32 = 0; i < 16; i -= 1')).toBe(
      'for (i = 0; i < 16; i -= 1) does not exit.',
    )
    // 0 * 2 is 0 forever, so this one is genuinely stuck even though the factor advances.
    expect(diagnose('let i: i32 = 0; i < 64; i *= 2')).toBe(
      'for (i = 0; i < 64; i *= 2) does not exit.',
    )
  })

  it('still accepts the largest loop the policy allows, and counts the edges exactly', () => {
    accepts(`let i: i32 = 0; i < ${MAX_LOOP_TRIPS}; i++`)
    accepts(`let i: i32 = 0; i <= ${MAX_LOOP_TRIPS - 1}; i++`)
    expect(diagnose(`let i: i32 = 0; i < ${MAX_LOOP_TRIPS + 1}; i++`)).toBe(
      `for trip count ${MAX_LOOP_TRIPS + 1} exceeds ${MAX_LOOP_TRIPS}.`,
    )
    // A loop whose condition is false at the start runs zero times and is not an error.
    accepts('let i: i32 = 8; i < 4; i++')
  })
})

describe('a multiplicative step is a counted loop', () => {
  it('accepts *= and /=, and emits the update as written', () => {
    const r = compileTsSource(loop('let i: i32 = 1; i < 64; i *= 2'))
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('i *= 2')
    const down = compileTsSource(loop('let i: i32 = 64; i > 1; i /= 2'))
    expect(down.diagnostics).toEqual([])
    expect(down.wgsl).toContain('i /= 2')
  })

  it('accepts -= too, which was refused for the same reason', () => {
    accepts('let i: i32 = 8; i > 0; i -= 1')
    accepts('let i: i32 = 16; i > 0; i -= 4')
  })

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
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('doubling', [])).toBe(6) // 1 2 4 8 16 32
    expect(c.eval('halving', [])).toBe(6) // 64 32 16 8 4 2
    expect(c.eval('down', [])).toBe(4) // 8 6 4 2
  })

  it('refuses a step that cannot advance, each for its own reason', () => {
    // One message — "step of i is 0" — used to cover a case it did not fit and three it never
    // reached, since the other three could not be spelled at all.
    expect(diagnose('let i: i32 = 0; i < 16; i += 0')).toBe(
      'for step "i += 0" never advances "i" — a step of 0 leaves it where it is.',
    )
    expect(diagnose('let i: i32 = 1; i < 64; i *= 1')).toBe(
      'for step "i *= 1" never advances "i" — multiplying or dividing by 1 leaves it where it is.',
    )
    expect(diagnose('let i: i32 = 1; i < 64; i *= 0')).toBe(
      'for step "i *= 0" never advances "i" — multiplying by 0 pins it at 0.',
    )
    expect(diagnose('let i: i32 = 64; i > 1; i /= 0')).toBe(
      'for step "i /= 0" never advances "i" — dividing by 0 is undefined on both targets.',
    )
  })

  it('names the forms it takes when the update is none of them', () => {
    // `%=` is not one of the four the update table takes, and a plain assignment is not an
    // update shape at all — both stop in lowerUpdate, before the counting.
    expect(diagnose('let i: i32 = 0; i < 16; i %= 3')).toBe('Unsupported for-update.')
    expect(diagnose('let i: i32 = 0; i < 16; i = i * i')).toBe('Unsupported for-update.')
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
    `)
    expect(r.diagnostics[0]!.message).toBe(
      'for-update must be i++ / i += <const>, or i *= / /= <const>.',
    )
  })
})

describe('the exact count handles every comparison', () => {
  it('counts <, <=, > and >= and the step sizes between them', () => {
    accepts('let i: i32 = 0; i < 16; i += 3') // 0 3 6 9 12 15
    accepts('let i: i32 = 0; i <= 16; i += 3')
    accepts('let i: i32 = 16; i > 0; i -= 3')
    accepts('let i: i32 = 16; i >= 0; i -= 3')
    expect(diagnose('let i: i32 = 0; i <= 1024; i += 2')).toBe('for trip count 513 exceeds 256.')
  })

  it('counts !== as hitting a value, not as crossing a threshold', () => {
    accepts('let i: i32 = 0; i !== 16; i += 2')
    expect(diagnose('let i: i32 = 0; i !== 1024; i++')).toBe('for trip count 1024 exceeds 256.')
    // A bound the step steps straight over is never reached.
    // The message prints the IR's own comparison tag, which is WGSL's `!=`.
    expect(diagnose('let i: i32 = 0; i !== 9; i += 2')).toBe(
      'for (i = 0; i != 9; i += 2) does not exit.',
    )
  })
})
