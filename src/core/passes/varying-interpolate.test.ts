// The two units §53 added on the IR, exercised on the IR — not only through the
// `"use typeshade"` front end, which reaches both by a different route (the front end calls
// `interstageMismatches` itself, and the emit calls `flatIntegerVaryings` from the WGSL
// backend's `optimize` chain). A module assembled here is the other authoring surface, and it
// is the one that would carry a regression neither the goldens nor the front-end tests see.

import { describe, it, expect } from 'vitest'
import {
  canonicalInterpolation,
  emittedInterpolation,
  flatIntegerVaryings,
  isIntegerVarying,
} from './varying-interpolate.js'
import { interstageMismatches } from './lint/rules/interstage-io.js'
import type { FuncDecl, ModuleDecl, StructDecl } from '../ir/nodes.js'
import { f32T, u32T, vec2fT, vec2uT, vec4fT, structT } from '../ir/types.js'

const vsOut = (id: { type: typeof u32T | typeof vec2fT; interpolate?: string }): StructDecl => ({
  name: 'VsOut',
  fields: [
    { name: 'pos', type: vec4fT, builtin: 'position', attr: '@builtin(position)' },
    {
      name: 'id',
      type: id.type,
      location: 0,
      attr: '@location(0)',
      ...(id.interpolate !== undefined ? { interpolate: id.interpolate } : {}),
    },
  ],
})

const entry = (
  name: string,
  stage: FuncDecl['stage'],
  ret: FuncDecl['ret'],
  params: FuncDecl['params'] = [],
): FuncDecl => ({ name, params, ret, body: [], stage })

describe('the integer-varying predicate, shared by both writers and the interstage rule', () => {
  it('is the integer scalars and their vectors, and nothing else', () => {
    expect(isIntegerVarying(u32T)).toBe(true)
    expect(isIntegerVarying(vec2uT)).toBe(true)
    expect(isIntegerVarying(f32T)).toBe(false)
    expect(isIntegerVarying(vec2fT)).toBe(false)
  })

  it('answers what the pass will write, before the pass runs', () => {
    expect(emittedInterpolation({ type: u32T, location: 0 })).toBe('flat')
    expect(emittedInterpolation({ type: vec2fT, location: 0 })).toBeUndefined()
    // A `@builtin` has no location and takes no attribute.
    expect(emittedInterpolation({ type: u32T })).toBeUndefined()
    // What the author wrote wins, because the pass leaves it alone.
    expect(emittedInterpolation({ type: vec2fT, location: 0, interpolate: 'flat' })).toBe('flat')
  })

  it("fills in WGSL's own sampling defaults so two spellings compare equal", () => {
    expect(canonicalInterpolation('flat')).toBe(canonicalInterpolation('flat, first'))
    expect(canonicalInterpolation(undefined)).toBe(canonicalInterpolation('perspective'))
    expect(canonicalInterpolation(undefined)).toBe(canonicalInterpolation('perspective, center'))
    expect(canonicalInterpolation('linear')).toBe('linear, center')
    expect(canonicalInterpolation('flat')).not.toBe(canonicalInterpolation('flat, either'))
  })
})

describe('flatIntegerVaryings, on the IR', () => {
  const moduleWith = (s: StructDecl, fragParams: FuncDecl['params'] = []): ModuleDecl => ({
    consts: [],
    structs: [s],
    bindings: [],
    funcs: [
      entry('vs', 'vertex', structT('VsOut')),
      entry('fs', 'fragment', vec4fT, [
        ...(fragParams.length > 0 ? fragParams : [{ name: 'v', type: structT('VsOut') }]),
      ]),
    ],
  })

  it('gives an integer varying the attribute and leaves a float one alone', () => {
    const out = flatIntegerVaryings(moduleWith(vsOut({ type: u32T })))
    const id = out.structs[0]!.fields[1]!
    expect(id.interpolate).toBe('flat')
    expect(id.attr).toBe('@location(0) @interpolate(flat)')
    const float = flatIntegerVaryings(moduleWith(vsOut({ type: vec2fT })))
    expect(float.structs[0]!.fields[1]!.interpolate).toBeUndefined()
  })

  it('is the identity for a module it changes nothing in, so the emit cannot move', () => {
    const m = moduleWith(vsOut({ type: vec2fT }))
    expect(flatIntegerVaryings(m)).toBe(m)
  })

  it('leaves an interpolation the author already wrote exactly as it is', () => {
    const out = flatIntegerVaryings(moduleWith(vsOut({ type: u32T, interpolate: 'flat, either' })))
    expect(out.structs[0]!.fields[1]!.interpolate).toBe('flat, either')
  })

  it('reaches a bare fragment PARAMETER, which no struct rewrite would', () => {
    const m = moduleWith(vsOut({ type: u32T }), [{ name: 'id', type: u32T, location: 0 }])
    const fs = flatIntegerVaryings(m).funcs.find((f) => f.name === 'fs')!
    expect(fs.params[0]!.attr).toBe('@location(0) @interpolate(flat)')
    // A VERTEX entry's `@location` parameters are vertex attributes, not varyings.
    const vertexIn: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [entry('vs', 'vertex', vec4fT, [{ name: 'a', type: u32T, location: 0 }])],
    }
    expect(flatIntegerVaryings(vertexIn)).toBe(vertexIn)
  })
})

describe('interstageMismatches, on the IR', () => {
  const pair = (out: StructDecl, into: StructDecl): ModuleDecl => ({
    consts: [],
    structs: out.name === into.name ? [out] : [out, into],
    bindings: [],
    funcs: [
      entry('vs', 'vertex', structT(out.name)),
      entry('fs', 'fragment', vec4fT, [{ name: 'v', type: structT(into.name) }]),
    ],
  })

  const fsIn = (type: typeof u32T | typeof vec2fT, interpolate?: string): StructDecl => ({
    name: 'FsIn',
    fields: [
      { name: 'pos', type: vec4fT, builtin: 'position', attr: '@builtin(position)' },
      {
        name: 'id',
        type,
        location: 0,
        attr: '@location(0)',
        ...(interpolate !== undefined ? { interpolate } : {}),
      },
    ],
  })

  it('is silent when the two sides agree', () => {
    expect(
      interstageMismatches([vsOut({ type: u32T })], pair(vsOut({ type: u32T }), fsIn(u32T)).funcs),
    ).toEqual([])
  })

  it('names both sides of a type mismatch', () => {
    const m = pair(vsOut({ type: u32T }), fsIn(vec2fT))
    const found = interstageMismatches(m.structs, m.funcs)
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('leaves "vs" as u32')
    expect(found[0]!.message).toContain('enters "fs" as vec2<f32>')
    expect(found[0]!.fragment).toBe('fs')
  })

  it('takes the derived flat on one side and the written one on the other', () => {
    const m = pair(vsOut({ type: u32T, interpolate: 'flat' }), fsIn(u32T))
    expect(interstageMismatches(m.structs, m.funcs)).toEqual([])
  })

  it("is silent with several entries of a stage, where the pairing is the host's", () => {
    const m = pair(vsOut({ type: u32T }), fsIn(vec2fT))
    const two = { ...m, funcs: [...m.funcs, entry('fs2', 'fragment', vec4fT)] }
    expect(interstageMismatches(two.structs, two.funcs)).toEqual([])
  })
})
