// ═══ The stepping walk is the oracle, not a second opinion (docs/debugging.md §2.5) ═══
//
// `interp.ts` is a THIRD walk over the IR. Two walks that must agree drift silently, which is
// exactly the archetype `cpu-codegen.test.ts` exists to stop for the `new Function` twin. This
// is the same gate for the stepping twin: the same generated corpus, the same seeded input
// sweep, and `Object.is` equality — so NaN ≡ NaN and −0 ≢ +0 rather than being smoothed.
//
// A fuzzer that finds nothing looks exactly like a fuzzer that cannot see, so the first arm
// is the instrument check: the corpus has to reach the constructs whose semantics the two
// walks could disagree about (integer `/` and `%`, a `continue` raised inside a `switch`
// inside a loop, calls, `select`, `for`, `if`), and the second arm proves the gate can fail
// by running it against a walk that is deliberately wrong.

import { describe, expect, it } from 'vitest'
import type { ModuleDecl, ShaderType } from '../ir/index.js'
import type { CpuValue } from '../cpu-runtime.js'
import { compileModule } from '../oracle.js'
import { generateModule, describeCorpus, mulberry32, type Corpus } from '../testing/random-ir.js'
import { startDebugSession } from './session.js'

const SEEDS = 16
const INPUTS_PER_FN = 6

const CORPUS: Corpus[] = Array.from({ length: SEEDS }, (_, i) => generateModule(i + 1))

/** A value of `t`, half of the sweep drawn from the boundaries where wrap, `x/0` and NaN
 *  propagation live. Mirrors `random-ir-differential.test.ts`'s generator. */
function genArg(t: ShaderType, rnd: () => number, boundary: boolean): CpuValue {
  const scalar = (s: string): number => {
    if (s === 'bool') return rnd() < 0.5 ? 1 : 0
    if (s === 'i32') {
      const pool = [0, 1, -1, 2, -2147483648, 2147483647, 255, -7]
      return boundary ? pool[Math.floor(rnd() * pool.length)]! : (Math.floor(rnd() * 4e9) - 2e9) | 0
    }
    if (s === 'u32') {
      const pool = [0, 1, 2, 4294967295, 2147483648, 255]
      return boundary
        ? pool[Math.floor(rnd() * pool.length)]!
        : Math.floor(rnd() * 4294967296) >>> 0
    }
    const pool = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1e-38, 3.4e38]
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : (rnd() - 0.5) * 200
  }
  if (t.kind === 'vec') return Array.from({ length: t.n }, () => scalar(t.elem)) as CpuValue
  return (t.kind === 'scalar' ? scalar(t.scalar) : 0) as CpuValue
}

function bitEqual(a: CpuValue, b: CpuValue): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => bitEqual(v as CpuValue, b[i] as CpuValue))
  return Object.is(a, b)
}

function* sweep(m: ModuleDecl): Generator<{ fn: string; args: CpuValue[]; key: string }> {
  for (const f of m.funcs) {
    const rnd = mulberry32(
      0x9e3779b9 ^ f.name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
    )
    for (let k = 0; k < INPUTS_PER_FN; k++) {
      const args = f.params.map((p) => genArg(p.type, rnd, k < INPUTS_PER_FN / 2))
      yield { fn: f.name, args, key: `${f.name}(${JSON.stringify(args)})` }
    }
  }
}

const clone = (v: CpuValue[]): CpuValue[] =>
  v.map((x) => (Array.isArray(x) ? [...x] : x)) as CpuValue[]

/** Drive a session to the end and hand back what the entry returned. */
function stepped(m: ModuleDecl, fn: string, args: readonly CpuValue[]): CpuValue | undefined {
  // `'f64'` here, not the session's own `'f32'` default: the question this gate asks is
  // whether the two WALKS agree, so both sides must be evaluating the same arithmetic.
  const s = startDebugSession(m, fn, args, { precision: 'f64', gpuStubs: true })
  s.continue()
  expect(s.done).toBe(true)
  return s.result
}

describe('the stepping walk agrees with the CPU oracle', () => {
  it('the corpus reaches the constructs the two walks could disagree about', () => {
    const f = describeCorpus(CORPUS)
    console.log(`[debug-diff] ${SEEDS} seeds · features: ${JSON.stringify(f)}`)
    expect(f['int/'] ?? 0).toBeGreaterThan(10)
    expect(f['int%'] ?? 0).toBeGreaterThan(10)
    expect(f.switchContinue ?? 0).toBeGreaterThan(0)
    expect(f.switchBreak ?? 0).toBeGreaterThan(0)
    for (const k of ['intShift', 'convert', 'builtin', 'select', 'for', 'if', 'callFn', 'assignOp'])
      expect(f[k] ?? 0, `corpus never generated '${k}'`).toBeGreaterThan(0)
  })

  it('is bit-identical to the interpreter over every generated program', () => {
    const divergences: string[] = []
    let checks = 0
    for (const c of CORPUS) {
      const interp = compileModule(c.module, { gpuStubs: true })
      for (const { fn, args, key } of sweep(c.module)) {
        const a = interp.fns[fn]!(...(clone(args) as never[]))
        const b = stepped(c.module, fn, clone(args))
        checks++
        if (!bitEqual(a, b as CpuValue) && divergences.length < 8) {
          divergences.push(
            `seed ${c.seed} ${key}: oracle ${JSON.stringify(a)} ≠ step ${JSON.stringify(b)}`,
          )
        }
      }
    }
    console.log(`[debug-diff] ${checks} oracle-vs-step comparisons`)
    expect(checks).toBeGreaterThan(200)
    expect(divergences).toEqual([])
  })

  it('the comparison can fail — a walk that rounds differently is caught', () => {
    // The instrument check for the arm above: run the same sweep with the session in `'f32'`
    // and the oracle in `'f64'`, which is a REAL semantic difference, and require the
    // comparison to notice. Without this, a green run above could mean the sweep compares
    // nothing.
    let noticed = 0
    for (const c of CORPUS) {
      const interp = compileModule(c.module, { gpuStubs: true })
      for (const { fn, args } of sweep(c.module)) {
        const a = interp.fns[fn]!(...(clone(args) as never[]))
        const s = startDebugSession(c.module, fn, clone(args), {
          precision: 'f32',
          gpuStubs: true,
        })
        s.continue()
        if (!bitEqual(a, s.result as CpuValue)) noticed++
      }
    }
    expect(noticed).toBeGreaterThan(0)
  })
})
