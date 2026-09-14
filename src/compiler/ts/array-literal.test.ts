// A list as a local array's initializer, and where the missing-return-type warning lands
// (#8 A16). `const xs: array<f32, 3> = [1., 2., 3.]` was "Unsupported expression"; the only
// spelling that worked, `array<f32, 3>(1., 2., 3.)`, is in neither the guide nor the docs. The
// warning half of the item is already fixed on main — these tests pin it so it stays fixed.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { stripSpans } from '../../core/testing/strip-spans.js'
import type { Stmt } from '../../core/ir/nodes.js'

function src(body: string, ret = 'f32', params = ''): string {
  return `"use typeshade";\nexport function f(${params}): ${ret} {\n${body}\n}`
}

function bodyOf(text: string): readonly Stmt[] {
  const r = compileTsSource(text)
  expect(r.diagnostics).toEqual([])
  return r.funcs[r.funcs.length - 1]!.body
}

function wgslOf(text: string): string {
  const c = compile(text)
  expect(c.diagnostics).toEqual([])
  return c.wgsl ?? ''
}

function diagnose(text: string): string {
  const r = compileTsSource(text)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

describe('a list initializes a local array', () => {
  const LIST = src('  const xs: array<f32, 3> = [1., 2., 3.];\n  return xs[0];')
  const CALL = src('  const xs: array<f32, 3> = array<f32, 3>(1., 2., 3.);\n  return xs[0];')

  it('builds exactly what the array<T, N>(...) call builds', () => {
    // Spans stripped: the two spellings are two spellings, so they carry different source
    // extents. The claim is that the IR is the same.
    expect(stripSpans(bodyOf(LIST))).toEqual(stripSpans(bodyOf(CALL)))
    expect(wgslOf(LIST)).toBe(wgslOf(CALL))
    expect(wgslOf(LIST)).toContain('array<f32, 3>(1.0, 2.0, 3.0)')
  })

  it('is one construct node of the declared array type', () => {
    const stmt = bodyOf(LIST)[0]!
    if (stmt.s !== 'let') throw new Error(`expected a let, got ${stmt.s}`)
    expect(stmt.expr.op).toBe('construct')
    expect(stmt.expr.type).toEqual({
      kind: 'array',
      elem: { kind: 'scalar', scalar: 'f32' },
      size: 3,
    })
    expect(stmt.expr.op === 'construct' && stmt.expr.args.length).toBe(3)
  })

  it('emits in GLSL ES 3.00 as well', () => {
    const c = compile(`"use typeshade";
class Out {
  @location(0) color: vec4
}
@fragment
export function fs(): Out {
  const xs: array<f32, 3> = [1., 2., 3.];
  return { color: vec4(xs[0], xs[1], xs[2], 1.) };
}`)
    expect(c.diagnostics).toEqual([])
    expect(c.glsl?.fragment).toContain('float[3](1.0, 2.0, 3.0)')
  })

  it('evaluates on the CPU oracle', () => {
    const c = compile(
      src('  const xs: array<f32, 3> = [1., 2., 4.];\n  return xs[0] + xs[1] + xs[2];'),
    )
    expect(c.diagnostics).toEqual([])
    expect(c.eval('f')).toBe(7)
  })

  it('takes an integer element type, which the call form cannot spell', () => {
    // The call form lowers each argument on its own, so `array<i32, 3>(1, 2, 3)` emits
    // `array<i32, 3>(1.0, 2.0, 3.0)` — float literals in an i32 array, which Tint rejects
    // (that is #8 A3's to fix at the call site). The list is lowered AGAINST the annotation,
    // so it knows what each element must be.
    expect(wgslOf(src('  const xs: array<i32, 3> = [1, 2, 3];\n  return xs[0];', 'i32'))).toContain(
      'array<i32, 3>(1, 2, 3)',
    )
    expect(wgslOf(src('  const xs: array<u32, 2> = [1, 2];\n  return xs[0];', 'u32'))).toContain(
      'array<u32, 2>(1u, 2u)',
    )
    expect(wgslOf(src('  const xs: array<i32, 2> = [-1, 2];\n  return xs[0];', 'i32'))).toContain(
      'array<i32, 2>(-1, 2)',
    )
  })

  it('takes a bool, a vector and an arbitrary expression as elements', () => {
    expect(
      wgslOf(src('  const xs: array<bool, 2> = [true, false];\n  return xs[0];', 'bool')),
    ).toContain('array<bool, 2>(true, false)')
    expect(
      wgslOf(
        src('  const xs: array<vec2, 2> = [vec2(0., 0.), vec2(1., 1.)];\n  return xs[1];', 'vec2'),
      ),
    ).toContain('array<vec2<f32>, 2>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0))')
    expect(
      wgslOf(
        src('  const xs: array<f32, 2> = [a * 2., a + 1.];\n  return xs[0];', 'f32', 'a: f32'),
      ),
    ).toContain('array<f32, 2>((a * 2.0), (a + 1.0))')
  })

  it('takes a `let` as readily as a `const`, and the binding stays writable', () => {
    const wgsl = wgslOf(src('  let xs: array<f32, 2> = [1., 2.];\n  xs[0] = 5.;\n  return xs[0];'))
    expect(wgsl).toContain('var xs: array<f32, 2> = array<f32, 2>(1.0, 2.0);')
    expect(wgsl).toContain('xs[0] = 5.0;')
  })
})

describe('what a list is refused for', () => {
  it('needs an annotation to take its type from', () => {
    expect(diagnose(src('  const xs = [1., 2., 3.];\n  return xs[0];'))).toBe(
      '"const xs" needs an array type annotation to take a list, e.g. const xs: array<f32, 3> = [...].',
    )
    expect(diagnose(src('  let xs = [1., 2.];\n  return xs[0];'))).toBe(
      '"let xs" needs an array type annotation to take a list, e.g. let xs: array<f32, 2> = [...].',
    )
  })

  it('needs that annotation to be an array', () => {
    expect(diagnose(src('  const xs: f32 = [1., 2.];\n  return xs;'))).toBe(
      'An array literal needs a declared array type, got f32.',
    )
  })

  it('needs a fixed size to fill', () => {
    expect(diagnose(src('  const xs: array<f32> = [1., 2.];\n  return xs[0];'))).toBe(
      'A list needs a fixed size to fill: write the size, e.g. array<f32, 2>.',
    )
  })

  it('must have exactly that many elements', () => {
    expect(diagnose(src('  const xs: array<f32, 3> = [1., 2.];\n  return xs[0];'))).toBe(
      'array<f32, 3> takes 3 element(s), got 2.',
    )
    expect(diagnose(src('  const xs: array<f32, 2> = [1., 2., 3.];\n  return xs[0];'))).toBe(
      'array<f32, 2> takes 2 element(s), got 3.',
    )
  })

  it('rejects an element of another type, cast included', () => {
    // `i32(2)` states its own type, so it is NOT retyped the way a written `2` is.
    expect(diagnose(src('  const xs: array<f32, 2> = [1., i32(2)];\n  return xs[0];'))).toBe(
      'array<f32, 2> element 1 must be f32, got i32. There is no implicit conversion; cast it.',
    )
  })

  it('rejects a spread, before counting the elements it cannot see', () => {
    const r = compileTsSource(
      src('  const xs: array<f32, 2> = [...a];\n  return xs[0];', 'f32', 'a: array<f32, 2>'),
    )
    expect(r.diagnostics.map((d) => d.message)).toContain(
      'An array literal element must be a value; a spread or a hole is not supported.',
    )
    expect(r.diagnostics.map((d) => d.message)).not.toContain(
      'array<f32, 2> takes 2 element(s), got 1.',
    )
  })

  it('names the two spellings that do work when a list is written elsewhere', () => {
    expect(diagnose(src('  return sum([1., 2.]);'))).toBe(
      'A list is only an initializer: write it as "const xs: array<T, 2> = [...]", or call array<T, 2>(...) here.',
    )
  })
})

describe('the missing-return-type warning', () => {
  // The other half of #8 A16: at the investigated base (b6d6c56) this warning was pushed with
  // a hardcoded `line: 1, character: 1` and fired for entry functions too, so the docs'
  // `@compute` example warned about a return type it does not want. Both are already fixed on
  // main; these pin them.
  it('lands on the function it is about, not at line 1', () => {
    const r = compileTsSource(
      '"use typeshade";\n\nexport function helper(a: f32) {\n  let x: f32 = a;\n}',
    )
    expect(r.diagnostics).toHaveLength(1)
    const d = r.diagnostics[0]!
    expect(d.message).toBe('Function "helper" has no return type annotation; defaulting to void.')
    expect(d.category).toBe('warning')
    expect(d.line).toBe(3)
  })

  it('is not raised for an entry function, which wants no return type', () => {
    const r = compileTsSource(`"use typeshade";
declare let out: storage<array<f32>>
@compute([64, 1, 1])
export function sum(@builtin("global_invocation_id") gid: vec3u) {
  out[gid.x] = 1.;
}`)
    expect(r.diagnostics).toEqual([])
  })
})
