// ═══ A shader value, shown the way its author spelled its type ═══
//
// The CPU value model is `number[]` for a vector, a flat `number[]` for a matrix and a plain
// object for a struct: right for evaluating, and the reason a stock JavaScript debugger shows
// a `vec3` as `(3) [0.5, 0.5, 1]`. `docs/debugging.md` §2.3 names that as one of the two
// reasons the design owns its own presentation layer rather than borrowing one. This is that
// layer, and these are its claims.

import { describe, expect, it } from 'vitest'
import {
  boolT,
  f32T,
  f64T,
  i32T,
  u32T,
  vec2fT,
  vec3fT,
  vec4fT,
  mat4x4fT,
  arrayT,
  type ShaderType,
} from '../ir/types.js'
import type { StructDecl } from '../ir/nodes.js'
import {
  coerceValue,
  createValueFormatter,
  formatCpuValue,
  shapeError,
  zeroValueOf,
} from './value.js'

const CAMERA: StructDecl = {
  name: 'Camera',
  fields: [
    { name: 'pos', type: vec3fT },
    { name: 'zoom', type: f32T },
  ],
}
const structs = new Map<string, StructDecl>([['Camera', CAMERA]])
const cameraT: ShaderType = { kind: 'struct', name: 'Camera' }

describe('formatCpuValue renders the declared type, not the JavaScript one', () => {
  it('a vector is a vector, not an array', () => {
    expect(formatCpuValue([0.5, 0.5, 1], vec3fT)).toBe('vec3(0.5, 0.5, 1)')
    expect(formatCpuValue([1, 2], vec2fT)).toBe('vec2(1, 2)')
  })

  it('a matrix is its columns, in the order it is stored', () => {
    // Column-major, as the IR stores it: the first four numbers are column 0.
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
    expect(formatCpuValue(m, mat4x4fT)).toBe(
      'mat4x4(1, 0, 0, 0)(0, 1, 0, 0)(0, 0, 1, 0)(5, 6, 7, 1)',
    )
  })

  it('a struct is its fields by name', () => {
    expect(formatCpuValue({ pos: [1, 2, 3], zoom: 2 }, cameraT)).toBe(
      'Camera { pos: [1, 2, 3], zoom: 2 }',
    )
  })

  it('given the struct table, the fields render at their own declared types too', () => {
    // Without it, `pos` is a JavaScript array and the rendering stops one level short of what
    // the author wrote, which is exactly the failure this whole layer exists to avoid.
    expect(formatCpuValue({ pos: [1, 2, 3], zoom: 2 }, cameraT, structs)).toBe(
      'Camera { pos: vec3(1, 2, 3), zoom: 2 }',
    )
  })

  it('createValueFormatter binds a module’s structs once, for an adapter to reuse', () => {
    const show = createValueFormatter({ structs: [CAMERA] })
    expect(show({ pos: [Math.fround(0.8), 0, 0], zoom: 1 }, cameraT)).toBe(
      'Camera { pos: vec3(0.8, 0, 0), zoom: 1 }',
    )
    expect(show([1, 2], vec2fT)).toBe('vec2(1, 2)')
  })

  it('an array renders its elements at the element type', () => {
    expect(
      formatCpuValue(
        [
          [1, 2],
          [3, 4],
        ] as never,
        arrayT(vec2fT, 2),
      ),
    ).toBe('[vec2(1, 2), vec2(3, 4)]')
  })

  it('a bool is a bool', () => {
    expect(formatCpuValue(true, boolT)).toBe('true')
  })

  it('without a type it falls back to the value’s own shape', () => {
    expect(formatCpuValue([1, 2, 3])).toBe('[1, 2, 3]')
    expect(formatCpuValue({ a: 1, b: [2, 3] })).toBe('{ a: 1, b: [2, 3] }')
  })
})

describe('an f32 prints as the decimal it stands for', () => {
  it('shows 0.8, not the double the f32 nearest 0.8 happens to be', () => {
    // This is the number a stepped `let x = 0.8` actually holds in f32 mode. Printing
    // 0.800000011920929 is exact and unreadable; every f32 printer, WGSL's own included,
    // writes 0.8, and the shortest round-tripping decimal is how you get there.
    const f32_0_8 = Math.fround(0.8)
    expect(f32_0_8).toBe(0.800000011920929)
    expect(formatCpuValue(f32_0_8, f32T)).toBe('0.8')
    expect(formatCpuValue([f32_0_8, -f32_0_8], vec2fT)).toBe('vec2(0.8, -0.8)')
  })

  it('an f64 keeps every digit, because there they are the answer', () => {
    expect(formatCpuValue(0.800000011920929, f64T)).toBe('0.800000011920929')
  })

  it('round-trips rather than truncating: two distinct f32 values stay distinct', () => {
    const a = Math.fround(1.0000001)
    const b = Math.fround(1.0000002)
    expect(a).not.toBe(b)
    expect(formatCpuValue(a, f32T)).not.toBe(formatCpuValue(b, f32T))
    expect(Math.fround(Number(formatCpuValue(a, f32T)))).toBe(a)
    expect(Math.fround(Number(formatCpuValue(b, f32T)))).toBe(b)
  })

  it('the values that are not numbers print as themselves', () => {
    expect(formatCpuValue(NaN, f32T)).toBe('NaN')
    expect(formatCpuValue(Infinity, f32T)).toBe('inf')
    expect(formatCpuValue(-Infinity, f32T)).toBe('-inf')
    expect(formatCpuValue(-0, f32T)).toBe('-0')
    expect(formatCpuValue(0, f32T)).toBe('0')
  })
})

describe('zeroValueOf descends where the evaluator’s does not', () => {
  it('fills a struct’s fields, so an omitted uniform is inspectable', () => {
    expect(zeroValueOf(cameraT, structs)).toEqual({ pos: [0, 0, 0], zoom: 0 })
  })

  it('fills a sized array, element by element', () => {
    expect(zeroValueOf(arrayT(vec2fT, 3), structs)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
  })

  it('a bool zero is false, not 0', () => {
    expect(zeroValueOf(boolT, structs)).toBe(false)
  })

  it('every numeric scalar zero is 0', () => {
    for (const t of [f32T, i32T, u32T, f64T]) expect(zeroValueOf(t, structs)).toBe(0)
  })
})

describe('shapeError names both shapes, or says nothing', () => {
  const ok = (v: unknown, t: ShaderType): void =>
    expect(shapeError(v, t, structs), `${JSON.stringify(v)} as ${t.kind}`).toBeUndefined()

  it('accepts what fits', () => {
    ok(1, f32T)
    ok(true, boolT)
    ok([1, 2, 3], vec3fT)
    ok(new Array<number>(16).fill(0), mat4x4fT)
    ok({ pos: [1, 2, 3], zoom: 1 }, cameraT)
    ok([1, 2], arrayT(f32T, 2))
    ok([1, 2, 3, 4, 5], arrayT(f32T)) // runtime-sized: any length
  })

  it('a wrong element count names the count it wanted', () => {
    expect(shapeError([1, 2], vec3fT, structs)).toBe(
      'expected vec3<f32> (3 numbers), got an array of 2',
    )
    expect(shapeError([1], mat4x4fT, structs)).toBe(
      'expected mat4x4<f32> (16 numbers, column-major), got an array of 1',
    )
  })

  it('a non-number inside a vector names which element', () => {
    expect(shapeError([1, 'x', 3], vec3fT, structs)).toContain('element 1 is string "x"')
  })

  it('a scalar given an array, and a vector given a scalar', () => {
    expect(shapeError([1], f32T, structs)).toBe('expected f32 (a number), got an array of 1')
    expect(shapeError(1, vec3fT, structs)).toBe('expected vec3<f32> (3 numbers), got number 1')
  })

  it('a bool is not a number, either way round', () => {
    expect(shapeError(1, boolT, structs)).toBe('expected bool (a boolean), got number 1')
    expect(shapeError(true, f32T, structs)).toBe('expected f32 (a number), got boolean true')
  })

  it('a struct names an unknown field and lists the real ones', () => {
    expect(shapeError({ poss: [1, 2, 3] }, cameraT, structs)).toBe(
      'struct:Camera has no field "poss"; its fields are pos, zoom',
    )
  })

  it('a struct field of the wrong shape is reported under its own name', () => {
    expect(shapeError({ pos: [1, 2] }, cameraT, structs)).toBe(
      'field "pos": expected vec3<f32> (3 numbers), got an array of 2',
    )
  })

  it('an array element of the wrong shape is reported by index', () => {
    expect(shapeError([[1, 2], [3]], arrayT(vec2fT, 2), structs)).toBe(
      'element 1: expected vec2<f32> (2 numbers), got an array of 1',
    )
  })

  it('a sized array of the wrong length says so', () => {
    expect(shapeError([1, 2, 3], arrayT(f32T, 2), structs)).toBe(
      'expected array<f32,2> (2 elements), got an array of 3',
    )
  })
})

describe('coerceValue fills what is missing and keeps what must be shared', () => {
  it('zero-fills an absent struct field', () => {
    expect(coerceValue({ zoom: 2 }, cameraT, structs)).toEqual({ pos: [0, 0, 0], zoom: 2 })
  })

  it('returns an array by identity, because a storage binding is the host’s buffer', () => {
    const buffer = [1, 2, 3]
    expect(coerceValue(buffer, arrayT(f32T), structs)).toBe(buffer)
  })

  it('leaves a scalar and a vector alone', () => {
    const v = [1, 2, 3]
    expect(coerceValue(v, vec3fT, structs)).toBe(v)
    expect(coerceValue(4, f32T, structs)).toBe(4)
  })

  it('a struct is rebuilt in declaration order, whatever order it was written in', () => {
    // A launch.json is hand-written, so its keys arrive in whatever order the author typed.
    expect(
      Object.keys(coerceValue({ zoom: 2, pos: [1, 2, 3] }, cameraT, structs) as object),
    ).toEqual(['pos', 'zoom'])
  })
})

describe('the formatter and the session meet', () => {
  it('renders a vec4 a fragment entry returned, at f32', () => {
    expect(formatCpuValue([Math.fround(0.8), 0, 0, 1], vec4fT)).toBe('vec4(0.8, 0, 0, 1)')
  })
})
