// A call as a statement (#47). `store(gid.x);` lowers to the IR's `call` statement, both
// writers spell it, the CPU backends run it for its effect, and the optimizer treats a call
// that writes a binding as the one impure expression the IR has. Measured on `main` before
// this: `Unsupported expression statement "store(gid.x)"` (TS8099) and nothing emitted.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { emitStmt, withDeclaredFns } from '../../core/emit.js'
import { emitModule, wgslBackend } from '../../core/backends/wgsl.js'
import { glslEs300Backend } from '../../core/backends/glsl.js'
import { unrollLoops } from '../../core/passes/opt/unroll.js'
import { inlineLinearAll } from '../../core/passes/inline-linear.js'
import { isSemanticallyEqual, semanticDiff } from '../../core/semantic-diff.js'
import { startDebugSession } from '../../core/debug/session.js'
import { countOps } from '../../core/measure.js'
import { f32T, u32T } from '../../core/ir/types.js'
import type { Expr, Stmt } from '../../core/ir/nodes.js'

const STORE = `"use typeshade";
declare let dst: storage<array<f32>>;
function store(i: u32): void {
  dst[i] = 1.;
}
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  store(gid.x);
}
`

const BUMP = `"use typeshade";
declare let dst: storage<array<f32>>;
function bump(i: u32): f32 {
  dst[i] = dst[i] + 1.;
  return dst[i];
}
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  const a = dst[gid.x];
  bump(gid.x);
  bump(gid.x);
  const b = dst[gid.x];
  max(a, 1.);
  dst[gid.x] = a + b;
}
`

function runOnDst(
  make: typeof compileModule,
  source: string,
  entry: string,
  gid: number,
  dst: number[],
): number[] {
  const r = compile(source)
  expect(r.diagnostics).toEqual([])
  const cm = make(r.module)
  cm.setBinding('dst', dst)
  cm.fns[entry]!([gid, 0, 0])
  return dst
}

describe('a call as a statement', () => {
  it('lowers a call whose value is dropped and emits it bare on WGSL', () => {
    const r = compile(STORE)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn store(i: u32) {')
    expect(r.wgsl).toContain('  store(gid.x);')
  })

  it('is run for its effect by the oracle and by the CPU codegen', () => {
    expect(runOnDst(compileModule, STORE, 'main_k', 3, [0, 0, 0, 0, 0])).toEqual([0, 0, 0, 1, 0])
    expect(runOnDst(compileModuleJs, STORE, 'main_k', 2, [0, 0, 0, 0, 0])).toEqual([0, 0, 1, 0, 0])
  })

  it('keeps every call that writes a binding and shares no read across one', () => {
    const r = compile(BUMP)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    // Two calls, two writes. gvn would have numbered `dst[gid.x]` once and cse would have
    // shared the two `bump(gid.x)`; both leave a function with an effectful call alone.
    expect(w.match(/bump\(gid\.x\);/g)).toHaveLength(2)
    expect(w).toContain('let a = dst[gid.x];')
    expect(w).toContain('let b = dst[gid.x];')
    expect(w).not.toMatch(/_gv\d/)
    // 5 + (6 + 7): the second read sees both bumps.
    expect(runOnDst(compileModule, BUMP, 'main_k', 1, [5, 5, 5])).toEqual([5, 12, 5])
  })

  it('drops a call statement whose call has no effect', () => {
    // `max(a, 1.)` computes and drops; dce removes it the way it removes an unread `let`.
    expect(compile(BUMP).wgsl).not.toContain('max(')
  })

  it('refuses a value that is not a call standing alone', () => {
    const r = compileTsSource(`"use typeshade";
class Color { @location(0) color: vec4; }
@fragment
export function fs(@location(0) uv: vec2): Color {
  vec3(1., 2., 3.);
  return { color: vec4(uv, 0., 1.) };
}
`)
    expect(r.diagnostics.map((d) => d.code)).toEqual(['TS8099'])
    expect(r.diagnostics[0]!.message).toContain('builds a value and drops it')
  })

  it("spells a dropped builtin result behind WGSL's phony assignment and bare on GLSL", () => {
    const x: Expr = { op: 'param', type: f32T, name: 'x' }
    const one: Expr = { op: 'lit', type: f32T, value: 1 }
    const s: Stmt = { s: 'call', expr: { op: 'call', type: f32T, fn: 'max', args: [x, one] } }
    // Measured against Tint: `max(1.0, 2.0);` is rejected as ignoring a `@must_use` result,
    // `_ = max(1.0, 2.0);` is accepted. GLSL ES 3.00 takes the bare call.
    expect(emitStmt(s, 1, wgslBackend)).toBe('  _ = max(x, 1.0);')
    expect(emitStmt(s, 1, glslEs300Backend)).toBe('  max(x, 1.0);')
  })

  it("spells a user function's dropped result bare on both targets", () => {
    const r = compile(BUMP)
    const i: Expr = { op: 'param', type: u32T, name: 'i' }
    const bump = r.module.funcs.find((f) => f.name === 'bump')!
    const s: Stmt = {
      s: 'call',
      expr: { op: 'call', type: f32T, fn: 'bump', args: [i], declRef: bump },
    }
    // Tint accepts a bare `twice(gid.x);` for a user fn returning u32; only builtins are
    // `@must_use`. The declared-function set is the one `emitModule` scopes for its walk.
    expect(withDeclaredFns(r.module, () => emitStmt(s, 1, wgslBackend))).toBe('  bump(i);')
    expect(withDeclaredFns(r.module, () => emitStmt(s, 1, glslEs300Backend))).toBe('  bump(i);')
  })

  it('unrolls with the counter substituted into the call', () => {
    const src = `"use typeshade";
declare let dst: storage<array<f32>>;
function store(i: u32): void {
  dst[i] = 1.;
}
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  for (let i: u32 = 0; i < 2; i++) {
    store(i + gid.x);
  }
}
`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const unrolled = unrollLoops(r.module)
    const body = unrolled.funcs.find((f) => f.name === 'main_k')!.body
    // Two copies of the call, the counter replaced by its literal in each, no `i` left.
    expect(body.map((s) => s.s)).toEqual(['call', 'call'])
    // Without `declRef`: the callee's own parameter is named `i` too.
    const noRef = (k: string, v: unknown) => (k === 'declRef' ? undefined : v)
    const args = body.map((s) => JSON.stringify(s.s === 'call' ? s.expr : null, noRef))
    expect(args[0]).toContain('"value":0')
    expect(args[1]).toContain('"value":1')
    expect(args.join()).not.toContain('"name":"i"')
    const before = compileModule(r.module)
    const after = compileModule(unrolled)
    const a = [0, 0, 0, 0]
    const b = [0, 0, 0, 0]
    before.setBinding('dst', a)
    after.setBinding('dst', b)
    before.fns['main_k']!([1, 0, 0])
    after.fns['main_k']!([1, 0, 0])
    expect(a).toEqual([0, 1, 1, 0])
    expect(b).toEqual(a)
  })

  it('is not lifted out of a helper by the linear inliner', () => {
    const src = `"use typeshade";
declare let dst: storage<array<f32>>;
function store(i: u32): void {
  dst[i] = 1.;
}
function h(i: u32): f32 {
  store(i);
  return 2.;
}
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x > 4) {
    dst[gid.x] = h(gid.x);
  }
}
`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    // Splicing h's prelude ahead of the `if` would run `store(i)` on every invocation, not
    // only those past 4. The prelude blocker names the call statement and h stays a call.
    const w = emitModule(inlineLinearAll(r.module))
    expect(w).toContain('fn h(i: u32) -> f32 {')
    expect(w).toContain('h(gid.x)')
  })

  it('is stepped through by the debugger and counted by the op counter', () => {
    const r = compile(STORE)
    const dst = [0, 0, 0, 0, 0]
    const s = startDebugSession(r.module, 'main_k', [[4, 0, 0]], { bindings: { dst } })
    s.continue()
    expect(s.done).toBe(true)
    expect(dst).toEqual([0, 0, 0, 0, 1])
    // One call in `main_k`, none in `store`: the counter walks the statement's expression.
    expect(countOps(r.module).calls).toBe(1)
  })

  it('is part of a function body for the semantic diff', () => {
    const a = compile(STORE).module
    const b = compile(STORE.replace('store(gid.x)', 'store(gid.x + 1u)')).module
    expect(isSemanticallyEqual(semanticDiff(a, compile(STORE).module))).toBe(true)
    expect(isSemanticallyEqual(semanticDiff(a, b))).toBe(false)
  })
})
