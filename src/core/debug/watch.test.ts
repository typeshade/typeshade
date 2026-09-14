// ═══ What is this expression, here, now (docs/debugging.md §4.5) ═══
//
// §4.5 chose to answer a watch by REUSING THE FRONT END: splice the text into a synthesised
// `"use typeshade"` source over the frame's names, compile it, evaluate the one expression it
// lowers to. The claims that choice makes, and that this file holds to: a watch means what the
// same text means written at that point in the shader; a type error in it is the compiler's own
// diagnostic, not a second opinion; it can call the module's own helpers; and it cannot change
// the run.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from '../../compiler/ts/source-file.js'
import { f32T, type ModuleDecl } from '../ir/index.js'
import { startDebugSession, type DebugSession } from './session.js'
import { DebugWatchError } from './watch.js'
import { formatCpuValue } from './value.js'
import { stampSpans } from '../testing/stamp-spans.js'

function compiled(source: string): ModuleDecl {
  const r = compileTsSource(source, { fileName: 'w.shade.ts' })
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  }
}

const SRC = `"use typeshade"

function twice(x: f32): f32 {
  return x * 2.
}

export function fs(a: f32): f32 {
  const b = a + 1.
  const p = vec3f(1., 2., 3.)
  let acc = 0.
  acc = b * 2.
  return acc
}
`

/** A session paused just before `return acc`, with every local assigned. */
function atEnd(precision: 'f32' | 'f64' = 'f64'): DebugSession {
  const s = startDebugSession(compiled(SRC), 'fs', [3], { precision })
  for (let i = 0; i < 4; i++) s.stepIn()
  expect(s.pause!.frames[0]!.locals.get('acc')).toBe(8)
  return s
}

describe('evaluate answers over the paused frame', () => {
  it('reads a local, a parameter, and arithmetic over both', () => {
    const s = atEnd()
    expect(s.evaluate('a').value).toBe(3)
    expect(s.evaluate('b').value).toBe(4)
    expect(s.evaluate('a + b * 2.').value).toBe(11)
  })

  it('gives the answer the compiler’s own type, not a guess from the value', () => {
    const s = atEnd()
    // The whole reason the snippet is a `const` in a `void` function: a watch box cannot
    // declare a return type it does not know yet, and this is the type it gets instead.
    expect(s.evaluate('a').type).toEqual({ kind: 'scalar', scalar: 'f32' })
    expect(s.evaluate('p').type).toEqual({ kind: 'vec', n: 3, elem: 'f32' })
    expect(s.evaluate('p.xy').type).toEqual({ kind: 'vec', n: 2, elem: 'f32' })
    expect(s.evaluate('a > 1.').type).toEqual({ kind: 'scalar', scalar: 'bool' })
    // …and with the type, a watch box can render it the way the author spelled it.
    const w = s.evaluate('p * 2.')
    expect(formatCpuValue(w.value, w.type)).toBe('vec3(2, 4, 6)')
  })

  it('calls the module’s own helpers', () => {
    // §4.5 names this as what reusing the front end buys. The snippet redeclares `twice` with
    // a stub body so the call type-checks; the interpreter then resolves it by name against
    // the running module, so the answer is the REAL helper's.
    const s = atEnd()
    expect(s.evaluate('twice(b)').value).toBe(8)
    expect(s.evaluate('twice(twice(a))').value).toBe(12)
  })

  it('calls the builtins', () => {
    const s = atEnd()
    expect(s.evaluate('length(p)').value).toBeCloseTo(Math.sqrt(14), 6)
    expect(s.evaluate('max(a, b)').value).toBe(4)
  })

  it('evaluates in the frame asked for, not always the innermost', () => {
    const s = startDebugSession(compiled(SRC), 'fs', [3], {})
    s.stepIn()
    s.stepIn()
    s.stepIn()
    s.stepIn() // `return acc`
    s.evaluate('twice(a)') // steps nothing; a watch is a reader
    expect(s.pause!.span!.line).toBe(11)
    expect(() => s.evaluate('a', 1)).toThrow(/no frame 1; the stack is 1 deep/)
  })

  it('is a reader: the run is exactly where it was', () => {
    const s = atEnd()
    const where = s.pause!.span
    const locals = new Map(s.pause!.frames[0]!.locals)
    s.evaluate('twice(b) + a')
    expect(s.pause!.span).toEqual(where)
    expect(new Map(s.pause!.frames[0]!.locals)).toEqual(locals)
    expect(s.done).toBe(false)
  })
})

describe('evaluate refuses what it cannot answer', () => {
  it('reports the front end’s own diagnostic for a type error', () => {
    const s = atEnd()
    // Not this module's opinion of the text — the compiler's, verbatim, which is what makes a
    // watch error read the same as the squiggle in the editor.
    let err: DebugWatchError | undefined
    try {
      s.evaluate('nope + 1.')
    } catch (e) {
      err = e as DebugWatchError
    }
    expect(err).toBeInstanceOf(DebugWatchError)
    expect(err!.problems.join(' ')).toMatch(/Unknown identifier "nope"/)
    expect(err!.message).toMatch(/cannot evaluate watch "nope \+ 1\."/)
  })

  it('refuses an assignment rather than performing one', () => {
    // A watch that could write would make a debugger's readout a lie. This one is the SOURCE
    // LANGUAGE's doing, not this module's — `=`, `+=` and `++` are statements in
    // `"use typeshade"` and not values, so there is no expression form of them for a watch to
    // reach. Pinned anyway: it is a property a watch box depends on, whoever enforces it.
    const s = atEnd()
    expect(() => s.evaluate('acc = 99.')).toThrow(DebugWatchError)
    expect(() => s.evaluate('acc += 1.')).toThrow(DebugWatchError)
    expect(() => s.evaluate('acc++')).toThrow(DebugWatchError)
    expect(s.pause!.frames[0]!.locals.get('acc')).toBe(8)
  })

  it('refuses a text that is not one expression, rather than answering its first part', () => {
    // What the snippet's parentheses are actually for. Unparenthesised, `a, c: f32 = 1.`
    // becomes a second DECLARATOR in the statement the snippet builds: it compiles cleanly,
    // the statement read back is still `const … = a`, and the watch would answer `3` for a
    // text that asked something else entirely. Silently answering the wrong question is the
    // one failure a watch box must not have.
    const s = atEnd()
    expect(() => s.evaluate('a, c: f32 = 1.')).toThrow(DebugWatchError)
    expect(() => s.evaluate('a, b')).toThrow(DebugWatchError)
  })

  it('refuses an empty watch', () => {
    expect(() => atEnd().evaluate('   ')).toThrow(/the expression is empty/)
  })

  it('refuses a name that is declared but not yet assigned at this pause', () => {
    // `b` has a TYPE in the frame from the first statement onward and a VALUE only after it
    // runs. Evaluating it early would read `undefined` into a NaN that looks like an answer.
    const s = startDebugSession(compiled(SRC), 'fs', [3], {})
    expect(s.pause!.frames[0]!.localTypes.has('b')).toBe(true)
    expect(s.pause!.frames[0]!.locals.has('b')).toBe(false)
    expect(() => s.evaluate('b')).toThrow(/"b" is declared in fs but not yet assigned/)
    expect(s.evaluate('a').value).toBe(3)
  })

  it('refuses to evaluate once the run has finished', () => {
    const s = startDebugSession(compiled(SRC), 'fs', [3], {})
    s.continue()
    expect(s.done).toBe(true)
    expect(() => s.evaluate('a')).toThrow(/the run is not paused/)
  })
})

describe('a watch answers the same question the run does', () => {
  it('rounds to f32 when the session does', () => {
    // The point: a watch beside a statement must not quietly answer in a different precision.
    // 0.1 + 0.2 is the standard witness — f32 and f64 disagree in the 8th digit.
    const src = `"use typeshade"\nexport function fs(a: f32): f32 {\n  const b = a\n  return b\n}\n`
    const m = compiled(src)
    const f32 = startDebugSession(m, 'fs', [1], { precision: 'f32' })
    const f64 = startDebugSession(m, 'fs', [1], { precision: 'f64' })
    const expr = 'a * 0.1 + a * 0.2'
    const wide = f64.evaluate(expr).value as number
    const narrow = f32.evaluate(expr).value as number
    expect(wide).toBe(0.1 + 0.2)
    expect(narrow).not.toBe(wide)
    expect(narrow).toBe(Math.fround(Math.fround(1 * 0.1) + Math.fround(1 * 0.2)))
  })

  it('reports an answer derived from a stand-in as one', () => {
    const m = compiled(SRC)
    const s = startDebugSession(m, 'fs', [3], {})
    s.stepIn()
    // Nothing stubbed in this module, so nothing a watch reads is a stand-in.
    expect(s.evaluate('a + 1.').stubbed).toBe(false)
  })
})

describe('the compile cache', () => {
  it('compiles one watch once across a walk, and recompiles when the frame changes', () => {
    // The cost §4.5 names — "a compile per distinct expression (cacheable by text and frame
    // shape)" — is what this keeps paid once. Measured as wall time rather than asserted from
    // the implementation: 200 evaluations of one text must not cost 200 compiles.
    const s = atEnd()
    const once = Date.now()
    s.evaluate('twice(b) + a * 2.')
    const first = Date.now() - once
    const many = Date.now()
    for (let i = 0; i < 200; i++) s.evaluate('twice(b) + a * 2.')
    const rest = Date.now() - many
    expect(rest).toBeLessThan(Math.max(first, 5) * 50)
  })

  it('answers the frame it is asked in, not the frame it was compiled in', () => {
    const src = `"use typeshade"
function half(x: f32): f32 {
  const h = x * 0.5
  return h
}
export function fs(a: f32): f32 {
  const r = half(a)
  return r
}
`
    const s = startDebugSession(compiled(src), 'fs', [8], {})
    expect(s.evaluate('a').value).toBe(8)
    s.stepIn() // into half()
    s.stepIn()
    expect(s.pause!.frames[0]!.fnName).toBe('half')
    // `a` is not a name in this frame, and the cache must not answer with the other frame's.
    expect(() => s.evaluate('a')).toThrow(DebugWatchError)
    expect(s.evaluate('x').value).toBe(8)
    expect(s.evaluate('h').value).toBe(4)
  })
})

const WITH_BINDING = `"use typeshade"

class Uniforms {
  tint: vec4
  gain: f32
}

declare const u: uniform<Uniforms>

export function fs(a: f32): f32 {
  const g = a * u.gain
  return g
}
`

describe('a watch sees the bindings and the structs', () => {
  const started = (): DebugSession =>
    startDebugSession(compiled(WITH_BINDING), 'fs', [2], {
      bindings: { u: { tint: [1, 0, 0, 1], gain: 3 } },
    })

  it('reads a binding field, and the whole binding', () => {
    const s = started()
    expect(s.evaluate('u.gain').value).toBe(3)
    expect(s.evaluate('u.tint').value).toEqual([1, 0, 0, 1])
    // A struct-typed answer comes back as the CPU value model spells one, with the struct type
    // beside it — which is what lets a variables view expand it by field name.
    const whole = s.evaluate('u')
    expect(whole.value).toEqual({ tint: [1, 0, 0, 1], gain: 3 })
    expect(whole.type).toEqual({ kind: 'struct', name: 'Uniforms' })
  })

  it('mixes a binding with the frame’s own names, and swizzles the result', () => {
    const s = started()
    expect(s.evaluate('a * u.gain').value).toBe(6)
    expect(s.evaluate('u.tint.rgb').value).toEqual([1, 0, 0])
    expect(s.evaluate('u.tint.rgb').type).toEqual({ kind: 'vec', n: 3, elem: 'f32' })
  })

  it('does not let a watch write through a binding', () => {
    const s = started()
    expect(() => s.evaluate('u.gain = 9.')).toThrow(DebugWatchError)
    expect(s.evaluate('u.gain').value).toBe(3)
  })
})

describe('a watch over a stand-in says so', () => {
  // Hand-built for the same reason `stub-marking.test.ts` is: `dpdx` is not reachable from
  // "use typeshade" yet, so there is no source that can produce this module.
  const STUBBED: ModuleDecl = stampSpans({
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
            s: 'let',
            name: 'd',
            expr: {
              op: 'call',
              type: f32T,
              fn: 'dpdx',
              args: [{ op: 'param', type: f32T, name: 'x' }],
            },
          },
          { s: 'let', name: 'clean', expr: { op: 'param', type: f32T, name: 'x' } },
          { s: 'return', expr: { op: 'varref', type: f32T, name: 'd' } },
        ],
      },
    ],
  })

  it('marks an answer that read a marked local, and leaves a clean one alone', () => {
    const s = startDebugSession(STUBBED, 'fs', [2], { gpuStubs: true })
    s.stepIn()
    s.stepIn() // both `d` and `clean` assigned
    expect(new Set(s.pause!.frames[0]!.stubbedLocals)).toEqual(new Set(['d']))
    // The value is 0 either way; `stubbed` is the only thing that distinguishes the fiction
    // from the answer, which is the whole of §2.4's point applied to a value with no name.
    expect(s.evaluate('d * 1000.').stubbed).toBe(true)
    expect(s.evaluate('clean * 1000.').stubbed).toBe(false)
    expect(s.evaluate('d + clean').stubbed).toBe(true)
  })

  it('cannot call a GPU-only intrinsic, because the source language cannot spell one', () => {
    // Not a policy this module applies — the front end's. `dpdx` is not in the callable
    // surface of `"use typeshade"` at all (docs/debugging.md §2.4 says the type map has no
    // texture or sampler spelling either), so a watch that names one fails at compile with the
    // compiler's own words rather than reaching the stub table. Pinned because it is the
    // visible edge of §4.5's "the snippet is checked by the real compiler": a watch can ask
    // exactly what the language can ask, and no more.
    const s = startDebugSession(STUBBED, 'fs', [2], { gpuStubs: true })
    let err: DebugWatchError | undefined
    try {
      s.evaluate('dpdx(x)')
    } catch (e) {
      err = e as DebugWatchError
    }
    expect(err).toBeInstanceOf(DebugWatchError)
    expect(err!.problems.join(' ')).toMatch(/Unknown function "dpdx\(x\)"/)
    // …while reading the value the RUN already got from that intrinsic works, and is marked.
    s.stepIn()
    expect(s.evaluate('d').stubbed).toBe(true)
  })
})
