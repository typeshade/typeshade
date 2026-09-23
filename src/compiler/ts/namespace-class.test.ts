// A class inside a namespace (#107). Functions and constants inside a `namespace` flatten to
// `Ns_member` (roadmap 0.3 item T4); a class did not, and was refused with "a class inside "N"
// has no flattened form. Declare it at the top level of the file." That was the one place left
// where declaring a class and constructing it did not work, and grouping types in a namespace
// is ordinary TypeScript.
//
// The struct takes the same flattened name, so everything that names a struct follows from it:
// the methods, the constructor, and `new`, written either way.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected)
  }
}

describe('a class inside a namespace is the struct Ns_P', () => {
  it('with its constructor and its methods, built from inside the namespace', () => {
    const r = compile(`"use typeshade";
namespace N {
  export class P {
    x: f32;
    constructor(x: f32) {
      this.x = x;
    }
    twice(): f32 {
      return this.x * 2.;
    }
  }
  export function make(v: f32): P {
    return new P(v);
  }
}
@fragment
export function fs(): vec4 {
  const p = N.make(3.);
  return vec4(p.twice(), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct N_P {')
    expect(r.wgsl).toContain('fn N_P_new(x: f32) -> N_P {')
    expect(r.wgsl).toContain('fn N_P_twice(self_: N_P) -> f32 {')
    expect(r.glsl?.fragment).toContain('struct N_P {')
    agree(r, [6, 0, 0, 1])
  })

  it('and from outside it, written N.P', () => {
    const r = compile(`"use typeshade";
namespace N {
  export class P {
    x: f32;
    constructor(x: f32) {
      this.x = x;
    }
  }
}
function take(p: N.P): f32 {
  return p.x;
}
@fragment
export function fs(): vec4 {
  const p = new N.P(4.);
  return vec4(take(p), p.x, 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let p = N_P_new(4.0);')
    expect(r.wgsl).toContain('fn take(p: N_P) -> f32 {')
    agree(r, [4, 4, 0, 1])
  })

  it('nested, and as a field of another struct', () => {
    const r = compile(`"use typeshade";
namespace A {
  export namespace B {
    export class Inner {
      v: f32;
    }
  }
  export class Outer {
    i: A.B.Inner;
    k: f32;
  }
}
@fragment
export function fs(): vec4 {
  const o: A.Outer = { i: { v: 2. }, k: 3. };
  return vec4(o.i.v, o.k, 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct A_B_Inner {')
    expect(r.wgsl).toContain('struct A_Outer {')
    expect(r.wgsl).toContain('i: A_B_Inner,')
    agree(r, [2, 3, 0, 1])
  })

  it('as a binding type, reflected under the flattened name', () => {
    const r = compile(`"use typeshade";
namespace Scene {
  export class Camera {
    pos: vec3;
    zoom: f32;
  }
}
declare const cam: uniform<Scene.Camera>;
@fragment
export function fs(): vec4 {
  return vec4(cam.pos, cam.zoom);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Scene_Camera {')
    // The binding carries the flattened struct, so the reflection the host reads names it too.
    expect(r.module.bindings?.[0]?.name).toBe('cam')
    expect(r.wgsl).toContain('var<uniform> cam: Scene_Camera;')
  })
})

describe('what the short name cannot answer', () => {
  it('a name two namespaces both declare', () => {
    expect(
      errorsOf(`"use typeshade";
namespace A {
  export class P {
    x: f32;
  }
}
namespace B {
  export class P {
    y: f32;
  }
}
function take(p: P): f32 {
  return 1.;
}
@fragment
export function fs(): vec4 {
  return vec4(take({ x: 1. }), 0., 0., 1.);
}
`)[0],
    ).toBe(`TS8002 "P" is declared in 2 namespaces ("A.P", "B.P"). Write the one you mean.`)
  })

  it('a top-level declaration of the same name wins, as it does in TypeScript', () => {
    const r = compile(`"use typeshade";
class P {
  top: f32;
}
namespace N {
  export class P {
    inner: f32;
  }
}
declare const u: uniform<N.P>;
@fragment
export function fs(): vec4 {
  const p: P = { top: 1. };
  return vec4(p.top, u.inner, 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct P {\n  top: f32,\n}')
    expect(r.wgsl).toContain('struct N_P {\n  inner: f32,\n}')
  })

  it('a dotted name that names no struct says so', () => {
    expect(
      errorsOf(`"use typeshade";
namespace N {
  export class P {
    x: f32;
  }
}
function take(q: N.Q): f32 {
  return 1.;
}
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)[0],
    ).toBe(
      `TS8002 "N.Q" names no struct this file declares. A class inside a namespace is written "N.Q".`,
    )
  })

  it('an enum, a type or a variable in a namespace keeps its refusal', () => {
    expect(
      errorsOf(`"use typeshade";
namespace A {
  export enum E {
    X,
  }
}
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)[0],
    ).toContain(
      'A namespace holds functions, constants, classes and namespaces; an enum inside "A" has no flattened form.',
    )
  })
})
