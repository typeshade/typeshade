// ═══ The stepping session stops where the author wrote, and only there ═══
//
// `docs/debugging.md` §1.2 states the promise this file holds to: set a breakpoint in the
// `.shade.ts` file, choose an invocation, and step statement by statement through the source
// with the locals, parameters and bindings visible. Every assertion here is one clause of it.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from '../../compiler/ts/source-file.js'
import { f32, f32T, fn, Var, type ModuleDecl } from '../ir/index.js'
import type { SourceSpan } from '../ir/span.js'
import { startDebugSession, type DebugPause } from './session.js'
import { compileModule } from '../oracle.js'

const FILE = 'unit.shade.ts'

function compiled(source: string): ModuleDecl {
  const r = compileTsSource(source, { fileName: FILE })
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  }
}

const textAt = (src: string, span: SourceSpan): string =>
  src.slice(span.start, span.start + span.length)

/** Every statement a run visits, as the source text of its span. */
function trace(
  m: ModuleDecl,
  src: string,
  entry: string,
  args: readonly unknown[] = [],
  opts?: Parameters<typeof startDebugSession>[3],
): string[] {
  const s = startDebugSession(m, entry, args as never[], opts)
  const out: string[] = []
  let p: DebugPause | undefined = s.pause
  while (p) {
    out.push(p.span ? textAt(src, p.span) : '<synthesised>')
    p = s.stepIn()
  }
  return out
}

const STRAIGHT = `"use typeshade"
export function f(a: f32): f32 {
  const two = 2.
  let acc = a
  acc = acc * two
  return acc
}
`

const WITH_HELPER = `"use typeshade"
export function double(x: f32): f32 {
  const d = x + x
  return d
}
export function f(a: f32): f32 {
  const first = double(a)
  const second = double(first)
  return second
}
`

describe('a stepped run stops at every statement, in source order', () => {
  it('reports the entry pause before the first statement runs', () => {
    const m = compiled(STRAIGHT)
    const s = startDebugSession(m, 'f', [3])
    expect(s.pause!.reason).toBe('entry')
    expect(textAt(STRAIGHT, s.pause!.span!)).toBe('const two = 2.')
    // Nothing has executed yet, so the only name in scope is the parameter.
    expect([...s.pause!.frames[0]!.locals.keys()]).toEqual(['a'])
    expect(s.done).toBe(false)
  })

  it('visits each statement once, in the order they were written', () => {
    expect(trace(compiled(STRAIGHT), STRAIGHT, 'f', [3])).toEqual([
      'const two = 2.',
      'let acc = a',
      'acc = acc * two',
      'return acc',
    ])
  })

  it('finishes with the value the oracle computes for the same invocation', () => {
    const m = compiled(STRAIGHT)
    const s = startDebugSession(m, 'f', [3], { precision: 'f64' })
    s.continue()
    expect(s.done).toBe(true)
    expect(s.result).toBe(compileModule(m).fns.f!(3))
  })

  it('a local appears in the frame only once its statement has run', () => {
    const m = compiled(STRAIGHT)
    const s = startDebugSession(m, 'f', [3], { precision: 'f64' })
    s.stepOver() // past `const two = 2.`
    expect(s.pause!.frames[0]!.locals.get('two')).toBe(2)
    expect(s.pause!.frames[0]!.locals.has('acc')).toBe(false)
    s.stepOver() // past `let acc = a`
    expect(s.pause!.frames[0]!.locals.get('acc')).toBe(3)
    s.stepOver() // past `acc = acc * two`
    expect(s.pause!.frames[0]!.locals.get('acc')).toBe(6)
  })

  it('the pause reports the precision it is evaluating at', () => {
    const m = compiled(STRAIGHT)
    expect(startDebugSession(m, 'f', [3]).precision).toBe('f32')
    expect(startDebugSession(m, 'f', [3], { precision: 'f64' }).precision).toBe('f64')
  })
})

describe('helpers: step in, step out, step over', () => {
  it('step in enters the helper and pushes a frame', () => {
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1])
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['f'])
    s.stepIn()
    // Innermost first, as a debug adapter reports a stack.
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['double', 'f'])
    expect(textAt(WITH_HELPER, s.pause!.span!)).toBe('const d = x + x')
    // The frame knows where it was called from, and the caller still shows its own statement.
    expect(textAt(WITH_HELPER, s.pause!.frames[0]!.callSpan!)).toBe('double(a)')
    expect(textAt(WITH_HELPER, s.pause!.frames[1]!.span!)).toBe('const first = double(a)')
    expect(s.pause!.frames[0]!.locals.get('x')).toBe(1)
  })

  it('step over runs the helper to completion without stopping inside it', () => {
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1])
    s.stepOver()
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['f'])
    expect(textAt(WITH_HELPER, s.pause!.span!)).toBe('const second = double(first)')
    expect(s.pause!.frames[0]!.locals.get('first')).toBe(2)
  })

  it('step out returns to the SAME statement, with the callee frame gone', () => {
    // `docs/debugging.md` §2.1: "stepIn on that statement enters f, stepOut returns to the
    // same statement with f's frame gone". It used to return to the caller's NEXT statement,
    // because a step-out was only "run until the stack is shallower" and pauses exist only at
    // statement boundaries, which is also why the second call of a two-call statement could
    // not be stepped into at all. The post-call event is what fixes both.
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1])
    s.stepIn()
    expect(s.pause!.frames).toHaveLength(2)
    s.stepOut()
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['f'])
    expect(textAt(WITH_HELPER, s.pause!.span)).toBe('const first = double(a)')
    // …and the callee's result is in hand, which is what makes the stop worth having.
    s.stepOver()
    expect(s.pause!.frames[0]!.locals.get('first')).toBe(2)
  })

  it('step out then step in enters the NEXT call of the same statement', () => {
    // The clause §2.1 ends on: "and stepIn again enters g". This is the scenario the review
    // named, `return fA(a) + gB(a)`, where a depth-only step-out ran gB and the rest of the
    // program to completion.
    const src = `"use typeshade"
export function fA(x: f32): f32 {
  return x + 1.
}
export function gB(x: f32): f32 {
  return x * 10.
}
export function f(a: f32): f32 {
  return fA(a) + gB(a)
}
`
    const m = compiled(src)
    const s = startDebugSession(m, 'f', [2])
    expect(textAt(src, s.pause!.span)).toBe('return fA(a) + gB(a)')
    s.stepIn()
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['fA', 'f'])
    s.stepOut()
    // Back on the calling statement, one frame deep, with fA done and gB not yet begun.
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['f'])
    expect(textAt(src, s.pause!.span)).toBe('return fA(a) + gB(a)')
    s.stepIn()
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['gB', 'f'])
    expect(textAt(src, s.pause!.span)).toBe('return x * 10.')
    s.continue()
    expect(s.result).toBe(23)
  })

  it('step in and step over do not stop twice on one statement', () => {
    // The post-call event exists for stepOut alone. If the other moves saw it, stepping
    // through a statement with a call would report that statement twice, which is not what
    // either move means.
    expect(trace(compiled(WITH_HELPER), WITH_HELPER, 'f', [1])).toEqual([
      'const first = double(a)',
      'const d = x + x',
      'return d',
      'const second = double(first)',
      'const d = x + x',
      'return d',
      'return second',
    ])
  })

  it('step in visits both call sites of the same helper, one frame at a time', () => {
    expect(trace(compiled(WITH_HELPER), WITH_HELPER, 'f', [1])).toEqual([
      'const first = double(a)',
      'const d = x + x',
      'return d',
      'const second = double(first)',
      'const d = x + x',
      'return d',
      'return second',
    ])
  })
})

describe('loops', () => {
  const LOOP = `"use typeshade"
export function f(): f32 {
  let acc = 0.
  for (let i: i32 = 0; i < 3; i++) {
    acc += 1.
  }
  return acc
}
`

  it('pauses once per iteration on the body and on the update', () => {
    expect(trace(compiled(LOOP), LOOP, 'f')).toEqual([
      'let acc = 0.',
      'for (let i: i32 = 0; i < 3; i++) {\n    acc += 1.\n  }',
      'let i: i32 = 0',
      'acc += 1.',
      'i++',
      'acc += 1.',
      'i++',
      'acc += 1.',
      'i++',
      'return acc',
    ])
  })

  it('step over inside a loop body advances one iteration at a time', () => {
    const m = compiled(LOOP)
    const s = startDebugSession(m, 'f', [], { precision: 'f64' })
    while (s.pause && textAt(LOOP, s.pause.span!) !== 'acc += 1.') s.stepIn()
    expect(s.pause!.frames[0]!.locals.get('i')).toBe(0)
    s.stepOver() // the update
    s.stepOver() // back to the body on iteration 2
    expect(textAt(LOOP, s.pause!.span!)).toBe('acc += 1.')
    expect(s.pause!.frames[0]!.locals.get('i')).toBe(1)
    expect(s.pause!.frames[0]!.locals.get('acc')).toBe(1)
  })
})

describe('breakpoints', () => {
  it('continue stops at the first statement whose span starts on the line', () => {
    const m = compiled(STRAIGHT)
    // `acc = acc * two` is the fifth line of the source, zero-based line 4.
    const line = STRAIGHT.split('\n').findIndex((l) => l.includes('acc = acc * two'))
    const s = startDebugSession(m, 'f', [3], { breakpoints: [{ line }], precision: 'f64' })
    const hit = s.continue()
    expect(hit!.reason).toBe('breakpoint')
    expect(textAt(STRAIGHT, hit!.span!)).toBe('acc = acc * two')
    expect(s.pause!.frames[0]!.locals.get('acc')).toBe(3)
  })

  it('a breakpoint on a line with no statement never fires, and the run completes', () => {
    const m = compiled(STRAIGHT)
    const s = startDebugSession(m, 'f', [3], { breakpoints: [{ line: 0 }], precision: 'f64' })
    expect(s.continue()).toBeUndefined()
    expect(s.done).toBe(true)
    expect(s.result).toBe(6)
  })

  it('a breakpoint naming another file does not fire', () => {
    const m = compiled(STRAIGHT)
    const line = STRAIGHT.split('\n').findIndex((l) => l.includes('acc = acc * two'))
    const s = startDebugSession(m, 'f', [3], {
      breakpoints: [{ file: 'other.shade.ts', line }],
      precision: 'f64',
    })
    expect(s.continue()).toBeUndefined()
    expect(s.done).toBe(true)
  })

  it('a breakpoint inside a helper fires on the helper frame', () => {
    const m = compiled(WITH_HELPER)
    const line = WITH_HELPER.split('\n').findIndex((l) => l.includes('const d = x + x'))
    const s = startDebugSession(m, 'f', [1], { breakpoints: [{ line }] })
    const hit = s.continue()
    expect(hit!.frames.map((fr) => fr.fnName)).toEqual(['double', 'f'])
    // …and again on the second call.
    expect(s.continue()!.frames[0]!.locals.get('x')).toBe(2)
  })

  it('breakpoints can be replaced while the run is stopped', () => {
    const m = compiled(STRAIGHT)
    const s = startDebugSession(m, 'f', [3], { precision: 'f64' })
    const line = STRAIGHT.split('\n').findIndex((l) => l.includes('return acc'))
    s.setBreakpoints([{ line }])
    expect(textAt(STRAIGHT, s.continue()!.span!)).toBe('return acc')
  })
})

describe('bindings, stubs and the ways a run can end', () => {
  const STORAGE = `"use typeshade"
declare const scale: uniform<f32>
declare let out: storage<array<f32>>
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = scale * 2.
}
`

  it('a binding is visible as its own scope and reads its supplied value', () => {
    const m = compiled(STORAGE)
    const out = [0, 0]
    const s = startDebugSession(m, 'k', [[1, 0, 0]], {
      bindings: { scale: 3, out },
      precision: 'f64',
    })
    expect(s.pause!.bindings.get('scale')).toBe(3)
    s.continue()
    expect(s.done).toBe(true)
    expect(out).toEqual([0, 6])
  })

  it('a missing parameter reads as the zero of its type', () => {
    const m = compiled(STORAGE)
    const out = [0, 0]
    startDebugSession(m, 'k', [], { bindings: { scale: 3, out }, precision: 'f64' }).continue()
    expect(out).toEqual([6, 0])
  })

  it('a GPU-only intrinsic throws by default and is named when stubbed', () => {
    // Hand-built, because the `"use typeshade"` grammar has no spelling for a screen-space
    // derivative or a texture type (docs/debugging.md §2.4 and §4.4). What is asserted is the
    // POLICY the session applies when one is reached, which is the oracle's policy: throw
    // rather than hand back a plausible wrong number, unless the caller asked for stubs.
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'fs',
          params: [{ name: 'x', type: f32T }],
          ret: f32T,
          body: [
            {
              s: 'return',
              expr: {
                op: 'call',
                type: f32T,
                fn: 'dpdx',
                args: [{ op: 'param', type: f32T, name: 'x' }],
              },
            },
          ],
        },
      ],
    }
    expect(() => startDebugSession(m, 'fs', [1]).continue()).toThrow(/GPU-only/)
    const s = startDebugSession(m, 'fs', [1], { gpuStubs: true })
    s.continue()
    expect(s.stubbedIntrinsics).toEqual(['dpdx'])
    expect(s.result).toBe(0)
  })

  it('stepping past the end leaves the session done and idempotent', () => {
    const m = compiled(STRAIGHT)
    const s = startDebugSession(m, 'f', [3], { precision: 'f64' })
    s.continue()
    expect(s.done).toBe(true)
    expect(s.pause).toBeUndefined()
    expect(s.stepIn()).toBeUndefined()
    expect(s.stepOver()).toBeUndefined()
    expect(s.stepOut()).toBeUndefined()
    expect(s.continue()).toBeUndefined()
    expect(s.result).toBe(6)
    expect(s.discarded).toBe(false)
  })

  it('a binding read resolves, and an unsupplied one is named rather than read as zero', () => {
    // Since #18 (issue #14) a binding read is a `varref`, the same node any other name gets,
    // which is why the session needs the module's declared binding names to tell the two
    // apart. The `constref` spelling this test also builds is what the front end produced
    // BEFORE #18; it is kept as a hand-built module because a module reaching the session
    // from anywhere else must still not resolve a binding through it — the arm that used to
    // do so is gone, so this half pins that it now fails loudly as an unknown constant.
    const bindingRead = (op: 'constref' | 'varref'): ModuleDecl => ({
      consts: [],
      structs: [],
      bindings: [
        { name: 'scale', type: f32T, space: 'uniform', access: 'read', group: 0, binding: 0 },
      ],
      funcs: [
        {
          name: 'f',
          params: [],
          ret: f32T,
          body: [{ s: 'return', expr: { op, type: f32T, name: 'scale' } }],
        },
      ],
    })
    // The live spelling: resolves, and names the binding when nobody supplied one.
    const live = bindingRead('varref')
    const s = startDebugSession(live, 'f', [], { bindings: { scale: 7 }, precision: 'f64' })
    s.continue()
    expect(s.result).toBe(7)
    expect(() => startDebugSession(live, 'f').continue()).toThrow(
      /no value supplied for binding 'scale'/,
    )

    // The retired spelling: no longer resolved, and no longer silently wrong either.
    const retired = bindingRead('constref')
    expect(() =>
      startDebugSession(retired, 'f', [], { bindings: { scale: 7 } }).continue(),
    ).toThrow(/unknown const scale/)
  })

  it('an unknown entry point is an error naming it', () => {
    expect(() => startDebugSession(compiled(STRAIGHT), 'nope')).toThrow(/no function "nope"/)
  })
})

describe('the statement a pause reports is the statement it is about to execute', () => {
  it('every pause span lies inside its own frame’s function span', () => {
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1])
    let p: DebugPause | undefined = s.pause
    let seen = 0
    while (p) {
      const frame = p.frames[0]!
      expect(p.span, 'authored statements all have a span here').toBeDefined()
      expect(frame.span).toEqual(p.span)
      expect(p.span!.start).toBeGreaterThanOrEqual(frame.fnSpan!.start)
      expect(p.span!.start + p.span!.length).toBeLessThanOrEqual(
        frame.fnSpan!.start + frame.fnSpan!.length,
      )
      seen++
      p = s.stepIn()
    }
    expect(seen).toBe(7)
  })
})

// ═══ The rules a review found each resting on one test, or on none ═══

const WHILE_SRC = `"use typeshade"
export function f(n: i32): f32 {
  let acc = 0.
  let w: i32 = 0
  while (w < 3) {
    acc = acc + 1.
    w = w + 1
  }
  return acc
}
`

describe('a statement nobody wrote is never a stop', () => {
  it('a while loop pauses only on statements the author can see', () => {
    // `docs/debugging.md` §3.4: the counter a `while` lowers to has no authored origin. It
    // used to pause anyway, with no line to show: 3 of 11 stops on a two-iteration loop.
    // Every span below is real text from the source, which is the whole of the claim.
    const t = trace(compiled(WHILE_SRC), WHILE_SRC, 'f', [0])
    expect(t).toEqual([
      'let acc = 0.',
      'let w: i32 = 0',
      'while (w < 3) {\n    acc = acc + 1.\n    w = w + 1\n  }',
      'acc = acc + 1.',
      'w = w + 1',
      'acc = acc + 1.',
      'w = w + 1',
      'acc = acc + 1.',
      'w = w + 1',
      'return acc',
    ])
    expect(t).not.toContain('<synthesised>')
  })

  it('the loop still runs: the synthesised statements execute between stops', () => {
    const s = startDebugSession(compiled(WHILE_SRC), 'f', [0], { precision: 'f64' })
    s.continue()
    expect(s.result).toBe(3)
  })

  it('a module with no spans at all runs to completion without pausing', () => {
    // The honest consequence of the rule, named rather than left to be discovered: an
    // `fn()`-authored module carries no spans, so there is no source to step. It is not a
    // failure, since the debugger is for `"use typeshade"` and the EDSL keeps its own
    // line-level tracing, but a caller must not be left waiting for a pause that cannot come.
    const handle = fn('g', { a: f32T }, f32T, ({ a }, b) => {
      const acc = Var('acc', f32(0))
      b.assign(acc, a)
      return acc
    })
    const m: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [handle.decl] }
    const s = startDebugSession(m, 'g', [4], { precision: 'f64' })
    expect(s.pause).toBeUndefined()
    expect(s.done).toBe(true)
    expect(s.result).toBe(4)
  })
})

describe('a breakpoint stops every move, not only continue', () => {
  it('fires inside a helper the stepped-over statement calls', () => {
    // DAP's `next` reports a `breakpoint` stop when one is hit while stepping over. It used
    // to run the helper to completion regardless.
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1], { breakpoints: [{ line: 2 }] })
    const p = s.stepOver()
    expect(p!.reason).toBe('breakpoint')
    expect(p!.frames.map((fr) => fr.fnName)).toEqual(['double', 'f'])
    expect(textAt(WITH_HELPER, p!.span)).toBe('const d = x + x')
  })

  it('fires during stepIn and stepOut too', () => {
    const m = compiled(WITH_HELPER)
    const over = startDebugSession(m, 'f', [1], { breakpoints: [{ line: 3 }] })
    expect(over.stepIn()!.reason).toBe('step') // into double(), line 2
    expect(over.stepIn()!.reason).toBe('breakpoint') // `return d`, line 3
    const out = startDebugSession(m, 'f', [1], { breakpoints: [{ line: 3 }] })
    out.stepIn()
    expect(out.stepOut()!.reason).toBe('breakpoint')
  })

  it('reports a breakpoint on the entry’s first statement, even as the entry stop', () => {
    // It used to be swallowed: the constructor consumed that statement as the `entry` pause,
    // so a later `continue()` resumed past it and a one-statement entry never stopped at all.
    const one = `"use typeshade"
export function f(a: f32): f32 {
  return a * 2.
}
`
    const s = startDebugSession(compiled(one), 'f', [3], { breakpoints: [{ line: 2 }] })
    expect(s.pause!.reason).toBe('breakpoint')
    expect(textAt(one, s.pause!.span)).toBe('return a * 2.')
    s.continue()
    expect(s.done).toBe(true)
  })
})

describe('the two rules the mutation survey found under-tested', () => {
  it('a breakpoint matches the line a statement STARTS on, not every line it covers', () => {
    // The rule `DebugBreakpoint` documents. A mutation to a range match (does the statement's
    // span COVER this line) survived the whole suite, including the test named for the rule,
    // because no fixture had a breakpoint on an inner line of a multi-line statement.
    const src = `"use typeshade"
export function f(n: i32): f32 {
  let acc = 0.
  if (n > 0) {
    acc = 1.
  }
  return acc
}
`
    const m = compiled(src)
    const stops = (line: number): string[] => {
      const s = startDebugSession(m, 'f', [1], { breakpoints: [{ line }] })
      const out: string[] = []
      while (s.pause) {
        if (s.pause.reason === 'breakpoint') out.push(textAt(src, s.pause.span))
        s.continue()
      }
      return out
    }
    // Line 3 is where the `if` STARTS, so it fires there…
    expect(stops(3)).toEqual(['if (n > 0) {\n    acc = 1.\n  }'])
    // …line 4 is the body statement, which starts there and is its own stop…
    expect(stops(4)).toEqual(['acc = 1.'])
    // …and line 5 is the closing brace, inside the `if`'s span and the start of nothing. A
    // range match would fire here; the STARTS rule must not.
    expect(stops(5)).toEqual([])
  })

  it('an f32 session rounds the locals it shows, not only the value it returns', () => {
    // Deleting the `froundF32` line survived every test but the differential instrument. A
    // local read at a pause is the number an author is looking AT, so it has to be the f32
    // one; `0.1 + 0.2` is the standard witness.
    const src = `"use typeshade"
export function f(a: f32): f32 {
  const tenth = a * 0.1
  const fifth = a * 0.2
  const sum = tenth + fifth
  return sum
}
`
    const m = compiled(src)
    const localsAfter3 = (precision: 'f32' | 'f64'): number => {
      const s = startDebugSession(m, 'f', [1], { precision })
      s.stepOver()
      s.stepOver()
      s.stepOver()
      return s.pause!.frames[0]!.locals.get('sum') as number
    }
    const wide = localsAfter3('f64')
    const narrow = localsAfter3('f32')
    expect(wide).toBe(0.1 + 0.2)
    expect(narrow).toBe(Math.fround(Math.fround(1 * 0.1) + Math.fround(1 * 0.2)))
    expect(narrow).not.toBe(wide)
  })
})

describe('a run that cannot finish, and one abandoned on purpose', () => {
  const FOREVER = `"use typeshade"
export function f(a: f32): f32 {
  let acc = a
  while (acc > 0.) {
    acc = acc + 1.
  }
  return acc
}
`

  it('a step budget turns an unbounded loop into an error naming the limit', () => {
    // `continue()` is a loop on the caller's own thread, so there is no timeout and nothing to
    // cancel: without a budget this call simply does not return. The front end accepts the
    // program, so the session has to be the thing that says no.
    const s = startDebugSession(compiled(FOREVER), 'f', [1], { maxSteps: 500 })
    expect(() => s.continue()).toThrow(/reached 500 statements without finishing/)
    expect(s.done).toBe(true)
  })

  it('the budget bounds the work, not the number of stops', () => {
    const s = startDebugSession(compiled(FOREVER), 'f', [1], { maxSteps: 20 })
    let stops = 0
    expect(() => {
      while (s.pause) {
        stops++
        s.stepIn()
      }
    }).toThrow(/maxSteps/)
    expect(stops).toBeGreaterThan(0)
  })

  it('unset, a terminating program is unaffected', () => {
    const s = startDebugSession(compiled(STRAIGHT), 'f', [3], { precision: 'f64' })
    s.continue()
    expect(s.result).toBe(6)
  })

  it('terminate abandons the run and makes every further move a no-op', () => {
    const s = startDebugSession(compiled(STRAIGHT), 'f', [3])
    expect(s.pause).toBeDefined()
    s.terminate()
    expect(s.done).toBe(true)
    expect(s.pause).toBeUndefined()
    expect(s.stepIn()).toBeUndefined()
    expect(s.stepOver()).toBeUndefined()
    expect(s.stepOut()).toBeUndefined()
    expect(s.continue()).toBeUndefined()
    // It abandoned rather than finished, so there is no result to report.
    expect(s.result).toBeUndefined()
  })
})

describe('bindings are checked against what the module declares', () => {
  const BOUND = `"use typeshade"
declare const scale: uniform<f32>
export function f(a: f32): f32 {
  return a * scale
}
`

  it('a name the module does not declare is rejected, with the declared ones named', () => {
    // Storing it silently is the bad outcome: the real binding stays unsupplied, and the run
    // then fails naming the binding the caller believes they just supplied.
    expect(() => startDebugSession(compiled(BOUND), 'f', [2], { bindings: { scal: 3 } })).toThrow(
      /no binding "scal" in this module; it declares scale/,
    )
  })

  it('the declared one is accepted and read', () => {
    const s = startDebugSession(compiled(BOUND), 'f', [2], {
      bindings: { scale: 3 },
      precision: 'f64',
    })
    s.continue()
    expect(s.result).toBe(6)
  })
})
