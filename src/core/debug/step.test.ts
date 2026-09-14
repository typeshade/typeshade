// ═══ The stepping session stops where the author wrote, and only there ═══
//
// `docs/debugging.md` §1.2 states the promise this file holds to: set a breakpoint in the
// `.shade.ts` file, choose an invocation, and step statement by statement through the source
// with the locals, parameters and bindings visible. Every assertion here is one clause of it.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from '../../compiler/ts/source-file.js'
import { f32T, type ModuleDecl } from '../ir/index.js'
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
    expect(textAt(STRAIGHT, s.pause!.span!)).toBe('two = 2.')
    // Nothing has executed yet, so the only name in scope is the parameter.
    expect([...s.pause!.frames[0]!.locals.keys()]).toEqual(['a'])
    expect(s.done).toBe(false)
  })

  it('visits each statement once, in the order they were written', () => {
    expect(trace(compiled(STRAIGHT), STRAIGHT, 'f', [3])).toEqual([
      'two = 2.',
      'acc = a',
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
    expect(textAt(WITH_HELPER, s.pause!.span!)).toBe('d = x + x')
    // The frame knows where it was called from, and the caller still shows its own statement.
    expect(textAt(WITH_HELPER, s.pause!.frames[0]!.callSpan!)).toBe('double(a)')
    expect(textAt(WITH_HELPER, s.pause!.frames[1]!.span!)).toBe('first = double(a)')
    expect(s.pause!.frames[0]!.locals.get('x')).toBe(1)
  })

  it('step over runs the helper to completion without stopping inside it', () => {
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1])
    s.stepOver()
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['f'])
    expect(textAt(WITH_HELPER, s.pause!.span!)).toBe('second = double(first)')
    expect(s.pause!.frames[0]!.locals.get('first')).toBe(2)
  })

  it('step out returns to the caller', () => {
    const m = compiled(WITH_HELPER)
    const s = startDebugSession(m, 'f', [1])
    s.stepIn()
    expect(s.pause!.frames).toHaveLength(2)
    s.stepOut()
    expect(s.pause!.frames.map((fr) => fr.fnName)).toEqual(['f'])
    expect(textAt(WITH_HELPER, s.pause!.span!)).toBe('second = double(first)')
  })

  it('step in visits both call sites of the same helper, one frame at a time', () => {
    expect(trace(compiled(WITH_HELPER), WITH_HELPER, 'f', [1])).toEqual([
      'first = double(a)',
      'd = x + x',
      'return d',
      'second = double(first)',
      'd = x + x',
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
      'acc = 0.',
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
