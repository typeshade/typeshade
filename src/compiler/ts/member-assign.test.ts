// Member and component assignment in "use typeshade" (#8 A2): `v.x = 0.`, `o.pos = …`,
// `ps[i].a = 1.` and `v.x += 1.` write through a field, a single vector component or an
// element, as WGSL, GLSL ES 3.00 and the fn() EDSL's `v.x.assign(…)` do. A swizzle naming
// more than one component is rejected, as WGSL rejects it.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { typeKey } from '../../core/ir/types.js'
import type { Expr, Stmt } from '../../core/ir/nodes.js'

const STRUCTS = `
  class P {
    a: f32
    b: f32
  }
`

function lowerBody(source: string): readonly Stmt[] {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  return r.funcs[0]!.body
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

function code(source: string): string | undefined {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.code
}

function expectMember(e: Expr, field: string, type: string, base: (x: Expr) => void): void {
  expect(e.op).toBe('member')
  if (e.op !== 'member') return
  expect(e.field).toBe(field)
  expect(typeKey(e.type)).toBe(type)
  base(e.base)
}

const varref = (name: string, type: string) => (x: Expr) => {
  expect(x.op).toBe('varref')
  if (x.op === 'varref') expect(x.name).toBe(name)
  expect(typeKey(x.type)).toBe(type)
}

describe('component assignment', () => {
  it('lowers v.x = a to an assign whose target is a member of the var', () => {
    const body = lowerBody(`
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.x = a;
        return v;
      }
    `)
    const s = body[1]!
    expect(s.s).toBe('assign')
    if (s.s !== 'assign') return
    expectMember(s.target, 'x', 'f32', varref('v', 'vec3<f32>'))
    expect(s.expr.op).toBe('param')
  })

  it('accepts an rgba component and keeps the spelling the author wrote', () => {
    const body = lowerBody(`
      export function f(a: f32): vec4 {
        let c = vec4(0.);
        c.r = a;
        c.a = 1.;
        return c;
      }
    `)
    const first = body[1]!
    const second = body[2]!
    if (first.s !== 'assign' || second.s !== 'assign') throw new Error('expected two assigns')
    expectMember(first.target, 'r', 'f32', varref('c', 'vec4<f32>'))
    expectMember(second.target, 'a', 'f32', varref('c', 'vec4<f32>'))
  })

  it('lowers v.x += 1. to an assignOp on the member', () => {
    const body = lowerBody(`
      export function f(): vec3 {
        let v = vec3(0.);
        v.x += 1.;
        return v;
      }
    `)
    const s = body[1]!
    expect(s.s).toBe('assignOp')
    if (s.s !== 'assignOp') return
    expect(s.bop).toBe('+')
    expectMember(s.target, 'x', 'f32', varref('v', 'vec3<f32>'))
    expect(s.expr).toEqual({ op: 'lit', type: expect.anything(), value: 1 })
    expect(typeKey(s.expr.type)).toBe('f32')
  })

  it('takes the component kind for a bare integer literal in v.x += 1', () => {
    const body = lowerBody(`
      export function f(): vec3u {
        let v = vec3u(u32(1), u32(2), u32(3));
        v.x += 1;
        return v;
      }
    `)
    const s = body[1]!
    if (s.s !== 'assignOp') throw new Error(`expected an assignOp, got ${s.s}`)
    expect(typeKey(s.expr.type)).toBe('u32')
  })

  it('lowers v.z++ to an assign of a binop on the member', () => {
    const body = lowerBody(`
      export function f(): vec3 {
        let v = vec3(0.);
        v.z++;
        return v;
      }
    `)
    const s = body[1]!
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`)
    expectMember(s.target, 'z', 'f32', varref('v', 'vec3<f32>'))
    expect(s.expr.op).toBe('binop')
    if (s.expr.op !== 'binop') return
    expect(s.expr.bop).toBe('+')
    expect(typeKey(s.expr.type)).toBe('f32')
    expect(s.expr.b).toEqual({ op: 'lit', type: expect.anything(), value: 1 })
  })
})

describe('field assignment', () => {
  it('lowers o.a = x on a struct local', () => {
    const body = lowerBody(`
      ${STRUCTS}
      export function f(x: f32): f32 {
        let p: P = { a: 0., b: 0. };
        p.a = x;
        return p.a;
      }
    `)
    const s = body[1]!
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`)
    expectMember(s.target, 'a', 'f32', varref('p', 'struct:P'))
  })

  it('lowers a field of an element: ps[i].a = 1.', () => {
    const body = lowerBody(`
      ${STRUCTS}
      declare let ps: storage<array<P>>
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        ps[gid.x].a = 1.;
      }
    `)
    const s = body[0]!
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`)
    expect(s.target.op).toBe('member')
    if (s.target.op !== 'member') return
    expect(s.target.field).toBe('a')
    expect(s.target.base.op).toBe('index')
  })

  it('lowers a component of a field: o.pos.x = 2.', () => {
    const body = lowerBody(`
      class VsOut {
        @builtin("position") pos: vec4
        @location(0) uv: vec2
      }
      @vertex
      export function vs(@location(0) p: vec2): VsOut {
        let o: VsOut = { pos: vec4(p, 0., 1.), uv: p };
        o.pos.x = 2.;
        return o;
      }
    `)
    const s = body[1]!
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`)
    expect(s.target.op).toBe('member')
    if (s.target.op !== 'member') return
    expect(s.target.field).toBe('x')
    expect(s.target.base.op).toBe('member')
    if (s.target.base.op !== 'member') return
    expect(s.target.base.field).toBe('pos')
  })
})

describe('emitted text', () => {
  const RENDER = `
    "use typeshade";
    class VsOut {
      @builtin("position") pos: vec4
      @location(0) uv: vec2
    }
    class Color {
      @location(0) color: vec4
    }
    @vertex
    export function vs(@location(0) p: vec2): VsOut {
      let o: VsOut = { pos: vec4(p, 0., 1.), uv: p };
      o.pos.x = o.pos.x * 2.;
      return o;
    }
    @fragment
    export function fs(v: VsOut): Color {
      let c = vec4(0.);
      c.r = v.uv.x;
      c.a = 1.;
      return { color: c };
    }
  `

  it('emits the member assignment verbatim in WGSL', () => {
    const c = compile(RENDER)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('o.pos.x = (o.pos.x * 2.0);')
    expect(c.wgsl).toContain('c.r = v.uv.x;')
    expect(c.wgsl).toContain('c.a = 1.0;')
  })

  it('emits the member assignment verbatim in GLSL ES 3.00', () => {
    const c = compile(RENDER)
    expect(c.glsl?.vertex).toContain('o.pos.x = (o.pos.x * 2.0);')
    expect(c.glsl?.fragment).toContain('c.r = uv.x;')
    expect(c.glsl?.fragment).toContain('c.a = 1.0;')
  })

  it('emits a compound component assignment as WGSL `+=`', () => {
    const c = compile(`
      "use typeshade";
      export function f(): vec3 {
        let v = vec3(0.);
        v.x += 1.;
        return v;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('v.x += 1.0;')
  })

  it('emits a field write through an element in WGSL', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      declare let ps: storage<array<P>>
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        ps[gid.x].a = 1.;
        ps[gid.x].b += 2.;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('ps[gid.x].a = 1.0;')
    expect(c.wgsl).toContain('ps[gid.x].b += 2.0;')
  })
})

describe('the CPU oracle evaluates the same writes', () => {
  it('evaluates component writes in place', () => {
    const c = compile(`
      "use typeshade";
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.x = a;
        v.y += 1.;
        v.z++;
        return v;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('f', [2.5])).toEqual([2.5, 1, 1])
  })

  it('evaluates field writes in place', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      export function g(x: f32): f32 {
        let p: P = { a: x, b: 0. };
        p.b = p.a * 2.;
        p.a += 1.;
        return p.a + p.b;
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.eval('g', [3])).toBe(10)
  })
})

describe('rejections', () => {
  it('rejects a swizzle naming more than one component, as WGSL does', () => {
    const src = `
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.xy = vec2(a, a);
        return v;
      }
    `
    expect(diagnose(src)).toBe(
      'Cannot assign to the swizzle ".xy" — WGSL writes one component at a time. ' +
        'Assign each component (e.g. v.x = …; v.y = …), or build a whole vec3<f32> and assign that.',
    )
    expect(code(src)).toBe('TS8018')
  })

  it('rejects a multi-component rgba swizzle too', () => {
    expect(
      diagnose(`
        export function f(a: f32): vec4 {
          let c = vec4(0.);
          c.rg = vec2(a, a);
          return c;
        }
      `),
    ).toContain('Cannot assign to the swizzle ".rg"')
  })

  it('rejects a write through a parameter', () => {
    const src = `
      export function f(v: vec3): vec3 {
        v.x = 1.;
        return v;
      }
    `
    expect(diagnose(src)).toBe(
      'Cannot write through parameter "v" — parameters are not writable. Use a local or storage.',
    )
    expect(code(src)).toBe('TS8018')
  })

  it('rejects a write through a const local', () => {
    const src = `
      export function f(a: f32): vec3 {
        const v = vec3(0.);
        v.x = a;
        return v;
      }
    `
    expect(diagnose(src)).toBe('Cannot assign to "v" — it is declared with const.')
    expect(code(src)).toBe('TS8005')
  })

  it('rejects a write through a read-only resource', () => {
    const src = `
      class C {
        pos: vec3
      }
      declare const cam: uniform<C>
      export function f(a: f32): vec3 {
        cam.pos.x = a;
        return cam.pos;
      }
    `
    expect(diagnose(src)).toBe('Cannot assign to "cam" — it is read-only resource or const.')
    expect(code(src)).toBe('TS8005')
  })

  it('rejects a chain rooted in an unknown name', () => {
    const src = `
      export function f(a: f32): f32 {
        q.x = a;
        return a;
      }
    `
    expect(diagnose(src)).toBe('Cannot assign to unknown name "q".')
    expect(code(src)).toBe('TS8018')
  })

  it('rejects a chain rooted in something that is not a name', () => {
    const src = `
      export function f(a: f32): f32 {
        vec3(0.).x = a;
        return a;
      }
    `
    expect(diagnose(src)).toBe(
      'Assignment target must be a name, or a field, component or element of one.',
    )
    expect(code(src)).toBe('TS8018')
  })

  it('rejects a value of the wrong type for the component', () => {
    expect(
      diagnose(`
        export function f(a: vec2): vec3 {
          let v = vec3(0.);
          v.x = a;
          return v;
        }
      `),
    ).toContain('Type mismatch')
  })

  it('rejects an unknown field on a struct target', () => {
    expect(
      diagnose(`
        ${STRUCTS}
        export function f(x: f32): f32 {
          let p: P = { a: 0., b: 0. };
          p.c = x;
          return p.a;
        }
      `),
    ).toBe('Unknown field "c" on struct:P.')
  })

  it('rejects a component out of range on the target vector', () => {
    expect(
      diagnose(`
        export function f(a: f32): vec2 {
          let v = vec2(0.);
          v.z = a;
          return v;
        }
      `),
    ).toBe('.z out of range on vec2<f32>.')
  })
})
