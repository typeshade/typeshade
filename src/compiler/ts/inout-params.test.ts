// A parameter the callee writes through: `inout` in the IR, a qualifier on GLSL ES 3.00 and a
// pointer on WGSL.
//
// A method that changes its object used to take the struct and RETURN it — `Ray_advance(
// self_in: Ray, t: f32) -> Ray` opening with `var self_ = self_in` and closing with
// `return self_` — and the call site read the receiver, called, and stored the result back.
// Three copies of a struct for one method that changes a field, and the reason given in the
// source was that "WGSL and GLSL ES 3.00 both take a struct parameter by value, so both targets
// spell every one of these as written, and the IR is unchanged".
//
// What the two targets actually take, measured on real Tint and a real WebGL2 driver before
// any of this was written:
//
//   WGSL   ptr<function, S> with &local                accepts
//   WGSL   ptr<storage, S, read_write> with &buf[i]    accepts
//   WGSL   ptr<function, S> handed &buf[i]             REJECTS — the address space is part of
//                                                      the pointer's type
//   WGSL   ptr<private, S>, ptr<workgroup, S>          accept
//   GLSL   inout on a struct, an array, an array element   all accept
//
// So the IR says WHICH parameters a callee writes through and nothing about how a target
// spells it. GLSL writes one function with `inout`. WGSL writes one per address space its
// calls use, which is the WGSL backend's own pass and reaches nothing above it.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { dispatchCompute } from '../../core/debug/dispatch.js'
import { fnWrites } from '../../core/passes/effects.js'
import type { CpuValue } from '../../core/cpu-runtime.js'

const LOCAL = `"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
  doubled(): f32 {
    return this.v * 2.;
  }
}
@fragment
export function fs(): vec4 {
  let p = new P();
  p.bump(0.25);
  p.bump(0.5);
  return vec4(p.doubled(), 0., 0., 1.);
}
`

describe('WGSL spells it as a pointer, and reads through it', () => {
  it('the parameter, the body and the argument', () => {
    const r = compile(LOCAL)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn P_bump(self_: ptr<function, P>, d: f32) {')
    expect(r.wgsl).toContain('  (*self_).v = ((*self_).v + d);')
    expect(r.wgsl).toContain('  P_bump(&p, 0.25);')
    // A method that only reads keeps its object by value, as every method did before.
    expect(r.wgsl).toContain('fn P_doubled(self_: P) -> f32 {')
    expect(r.wgsl).toContain('P_doubled(p)')
  })

  it('a pointer the function already holds is passed on, not addressed again', () => {
    const r = compile(`"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
  twice(d: f32): void {
    this.bump(d);
    this.bump(d);
  }
}
@fragment
export function fs(): vec4 {
  let p = new P();
  p.twice(0.25);
  return vec4(p.v, 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('  P_bump(self_, d);\n  P_bump(self_, d);')
    expect(r.wgsl).not.toContain('&(*self_)')
  })
})

describe('GLSL ES 3.00 spells it inout, with no pointer and one function', () => {
  it('the parameter, the body and the argument', () => {
    const r = compile(LOCAL)
    expect(r.diagnostics).toEqual([])
    const g = r.glsl!.fragment
    expect(g).toContain('void P_bump(inout P self_, float d) {')
    expect(g).toContain('  self_.v = (self_.v + d);')
    expect(g).toContain('  P_bump(p, 0.25);')
    expect(g).toContain('float P_doubled(P self_) {')
    // No address-of anywhere: GLSL's inout takes the l-value as written.
    expect(g).not.toContain('&')
  })
})

describe('one WGSL function per address space its calls use', () => {
  const SPACES = `"use typeshade";
declare let ps: storage<array<P>>;
let held: P = { v: 0. };
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ps[gid.x].bump(0.25);
  held.bump(0.5);
  let local = new P();
  local.bump(1.);
  ps[gid.x].v = ps[gid.x].v + local.v + held.v;
}
`

  it('three spaces, three copies, each with its own pointer type', () => {
    const r = compile(SPACES)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    expect(w).toContain('fn P_bump_storage(self_: ptr<storage, P, read_write>, d: f32) {')
    expect(w).toContain('fn P_bump_private(self_: ptr<private, P>, d: f32) {')
    expect(w).toContain('fn P_bump_function(self_: ptr<function, P>, d: f32) {')
    expect(w).toContain('  P_bump_storage(&ps[gid.x], 0.25);')
    expect(w).toContain('  P_bump_private(&held, 0.5);')
    expect(w).toContain('  P_bump_function(&local, 1.0);')
  })

  it('one space and the function keeps its name, which is every other module', () => {
    const r = compile(LOCAL)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn P_bump(')
    expect(r.wgsl).not.toContain('P_bump_function')
  })

  it('GLSL writes one function for all three, since inout carries no space', () => {
    const r = compile(SPACES.replace('@compute([1, 1, 1])', '@compute([1, 1, 1])'))
    expect(r.diagnostics).toEqual([])
    // This module is compute-only, so it has no GLSL; the IR is what GLSL would spell, and it
    // carries ONE `P_bump`. The per-space copies are made inside the WGSL backend.
    expect(r.module.funcs.filter((f) => f.name.startsWith('P_bump'))).toHaveLength(1)
    expect(r.module.funcs.find((f) => f.name === 'P_bump')!.params[0]!.mode).toBe('inout')
  })
})

describe('a write through a reference is an effect', () => {
  it('the call statement is not dropped as dead', () => {
    // Before the effect table learned about `inout`, a write to a parameter read as "owned",
    // so the callee wrote nothing, so every call to it was dead code: the methods emitted
    // their bodies and `fs` called none of them.
    const r = compile(LOCAL)
    expect(r.wgsl).toContain('P_bump(&p, 0.25);')
    expect([...fnWrites(r.module).get('P_bump')!]).toEqual(['self_'])
  })

  it('the caller writes what the argument is rooted at, not the callee\'s word for it', () => {
    const r = compile(`"use typeshade";
declare let ps: storage<array<P>>;
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ps[gid.x].bump(0.25);
}
`)
    expect(r.diagnostics).toEqual([])
    expect([...fnWrites(r.module).get('k')!]).toEqual(['ps'])
  })

  it('a write to a local through a reference is not a write the caller exports', () => {
    const r = compile(LOCAL)
    // `fs` writes its own local and nothing of the module's, so it stays out of the table.
    expect([...fnWrites(r.module).get('fs')!]).toEqual([])
  })
})

describe('both CPU backends see the write, as the GPU does', () => {
  it('the oracle and the codegen agree on a local receiver', () => {
    const r = compile(`"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
export function probe(): f32 {
  let p = new P();
  p.bump(0.25);
  p.bump(0.5);
  return p.v;
}
@fragment
export function fs(): vec4 {
  return vec4(probe(), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(r.module).fns['probe']!()).toBeCloseTo(0.75, 6)
    }
  })

  it('a dispatch writes through to the storage buffer', () => {
    const r = compile(`"use typeshade";
declare let ps: storage<array<P>>;
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
@compute([4, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= u32(arrayLength(ps))) {
    return;
  }
  ps[gid.x].bump(0.5);
}
`)
    expect(r.diagnostics).toEqual([])
    const bindings = { ps: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }] as unknown as CpuValue }
    dispatchCompute(r.module, 'k', 1, bindings)
    expect(bindings.ps).toEqual([{ v: 1.5 }, { v: 2.5 }, { v: 3.5 }, { v: 4.5 }])
  })
})
