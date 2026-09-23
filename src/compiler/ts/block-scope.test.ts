// Block scope reaches the IR (#38). TypeScript lets two lexically disjoint blocks, or an inner
// block and the one around it, declare the same name; the IR identifies a local by its name
// alone within a function, so the lowerer handed both bindings one name and the emit refused
// the module with SD0112 ("fn 'fs' declares 'i' more than once"), reported at line 1 of the
// file. Measured on `main` before this: every program below that declares a name twice failed
// that way. The second declaration of a name in a function now takes the IR name `i_1`,
// `p_1`, ...; resolution never changed, so an inner shadow still wins inside its block and the
// outer binding is what the code after the block reads.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import type { Stmt } from '../../core/ir/nodes.js'

const TWO_LOOPS = `"use typeshade";
@fragment
export function fs(): vec4 {
  let a = 0.;
  for (let i: u32 = 0; i < 4; i++) {
    a = a + f32(i);
  }
  for (let i: u32 = 0; i < 3; i++) {
    a = a + f32(i) * 2.;
  }
  return vec4(a, 0., 0., 1.);
}
`

const errorsOf = (src: string) =>
  compileTsSource(src).diagnostics.filter((d) => d.category === 'error')

/** Every `let`/`var` name a body declares, nested blocks included, in source order. */
const declared = (body: readonly Stmt[], out: string[] = []): string[] => {
  for (const s of body) {
    if (s.s === 'let' || s.s === 'var') out.push(s.name)
    else if (s.s === 'if') {
      for (const a of s.arms) declared(a.body, out)
      if (s.elseBody) declared(s.elseBody, out)
    } else if (s.s === 'for') {
      declared([s.init], out)
      declared(s.body, out)
    } else if (s.s === 'switch') {
      for (const c of s.cases) declared(c.body, out)
      if (s.defaultBody) declared(s.defaultBody, out)
    }
  }
  return out
}

describe('block scope in the IR (#38)', () => {
  it('two sequential loops over i: the second counter is i_1', () => {
    const r = compile(TWO_LOOPS)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('for (var i: u32 = 0u; (i < 4u); i = (i + 1u)) {')
    expect(r.wgsl).toContain('for (var i_1: u32 = 0u; (i_1 < 3u); i_1 = (i_1 + 1u)) {')
    // 0+1+2+3, then (0+1+2)*2.
    expect(r.eval('fs', [])).toEqual([12, 0, 0, 1])
  })

  it('sibling blocks: a p in a loop body and a p in an if arm', () => {
    const r = compile(`"use typeshade";
@fragment
export function fs(): vec4 {
  let acc = 0.;
  for (let i: u32 = 0; i < 4; i++) {
    const p = f32(i) * 2.;
    acc = acc + p;
  }
  if (acc > 1.) {
    const p = acc * 3.;
    acc = p;
  }
  return vec4(acc, 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let p = (f32(i) * 2.0);')
    expect(r.wgsl).toContain('let p_1 = (acc * 3.0);')
    expect(r.eval('fs', [])).toEqual([36, 0, 0, 1])
  })

  it('an inner block shadows the outer name inside the block only', () => {
    const r = compile(`"use typeshade";
@fragment
export function fs(): vec4 {
  const p = 1.;
  let acc = 0.;
  if (p > 0.) {
    const p = 99.;
    acc = p;
  }
  return vec4(acc, p, 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    const fs = r.module.funcs.find((f) => f.name === 'fs')!
    expect(declared(fs.body)).toEqual(['p', 'acc', 'p_1'])
    // The outer `p` is what the return reads, after the block that shadowed it.
    expect(r.eval('fs', [])).toEqual([99, 1, 0, 1])
  })

  it('a local shadows a parameter', () => {
    const r = compile(`"use typeshade";
function g(p: f32): f32 {
  let acc = p;
  if (p > 0.) {
    const p = 2.;
    acc = acc + p;
  }
  return acc;
}
@fragment
export function fs(): vec4 {
  return vec4(g(1.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn g(p: f32) -> f32 {')
    const g = r.module.funcs.find((f) => f.name === 'g')!
    expect(declared(g.body)).toEqual(['acc', 'p_1'])
    expect(r.eval('fs', [])).toEqual([3, 0, 0, 1])
  })

  it('a local that shadows a resource binding is renamed; the binding keeps its name', () => {
    const r = compile(`"use typeshade";
declare let dst: storage<array<f32>>;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x > 0) {
    const dst = 2.;
    return;
  }
  dst[gid.x] = 1.;
}
`)
    expect(r.diagnostics).toEqual([])
    const main = r.module.funcs.find((f) => f.name === 'main_k')!
    expect(declared(main.body)).toEqual(['dst_1'])
    // `varref dst` is the binding alone, so the write is a binding write to every pass.
    expect(r.wgsl).toContain('dst[gid.x] = 1.0;')
  })

  it('an IR name resolves back to its binding: a shadowing const still folds a loop bound', () => {
    const r = compile(`"use typeshade";
@fragment
export function fs(): vec4 {
  const n: i32 = 2;
  let a = 0.;
  if (a < 1.) {
    const n: i32 = 3;
    for (let i: i32 = 0; i < n; i++) {
      a = a + 1.;
    }
  }
  return vec4(a, f32(n), 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.eval('fs', [])).toEqual([3, 2, 0, 1])
  })

  it('follows a renamed alias to the storage binding it copies', () => {
    const r = compileTsSource(`"use typeshade";
declare const src: storage<array<f32>>;
@fragment
export function fs(): vec4 {
  const a = 1.;
  if (a > 0.) {
    const a = src;
    return vec4(f32(a.length), 0., 0., 1.);
  }
  return vec4(a, 0., 0., 1.);
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&src)')
  })

  it('names the counter as the author spelled it in a loop diagnostic', () => {
    const errors = errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  let a = 0.;
  for (let i: u32 = 0; i < 4; i++) { a = a + f32(i); }
  for (let i: u32 = 0; i < 3; i += 0) { a = a + f32(i); }
  return vec4(a, 0., 0., 1.);
}
`)
    expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.LOOP_INFINITE} for step "i += 0" never advances "i": a step of 0 leaves it where it is.`,
    ])
  })

  it('a repeat in one block is still refused, as TypeScript refuses it', () => {
    const errors = errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  const p = 1.;
  const p = 2.;
  return vec4(p, 0., 0., 1.);
}
`)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(TS_CODES.DUPLICATE_SYMBOL)
  })
})
