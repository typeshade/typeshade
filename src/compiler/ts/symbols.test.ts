import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { typeKey } from '../../core/ir/types.js'
import { TS_CODES } from './codes.js'
import type { DeclaredSymbol } from './symbols.js'

/** Every declaration in one file, one of each kind the front end records. */
const FIXTURE = [
  '"use typeshade";',
  'class Vertex {',
  '  @location(0) pos: vec3',
  '  @location(1) uv: vec2',
  '}',
  'class Camera {',
  '  view: mat4',
  '}',
  'declare const camera: uniform<Camera>',
  'const K: f32 = 2.;',
  'export function clamp01(x: f32, lo: f32): f32 {',
  '  let y = x;',
  '  return y;',
  '}',
  '@fragment',
  'export function fs(v: vec3, d: vec3<f64>): vec4 {',
  '  let x = 1.;',
  '  const half = 0.5;',
  '  let n = u32(1);',
  '  let wide = d;',
  '  let vv = vec3(x, 0., 0.);',
  '  for (let i: i32 = 0; i < 4; i++) {',
  '    n = n + u32(1);',
  '  }',
  '  return vec4(x, half, K, 1.);',
  '}',
].join('\n')

function errorsOf(diagnostics: readonly { category: string }[]): readonly unknown[] {
  return diagnostics.filter((d) => d.category === 'error')
}

/** The single recorded symbol named `name` (of `kind`, when the fixture declares that name
 *  more than once), failing the test when there is not exactly one. */
function only(
  symbols: readonly DeclaredSymbol[],
  name: string,
  kind?: DeclaredSymbol['kind'],
): DeclaredSymbol {
  const hits = symbols.filter((s) => s.name === name && (kind === undefined || s.kind === kind))
  expect(hits).toHaveLength(1)
  return hits[0]!
}

describe('DeclaredSymbol table', () => {
  const result = compileTsSource(FIXTURE, { fileName: 'fixture.ts' })

  it('lowers the fixture without errors', () => {
    expect(errorsOf(result.diagnostics)).toEqual([])
  })

  it('spans the declared name identifier exactly', () => {
    expect(result.symbols.length).toBeGreaterThan(0)
    for (const s of result.symbols) {
      expect(result.sourceFile.text.slice(s.start, s.start + s.length)).toBe(s.name)
    }
  })

  it('types a numeric-literal local f32, where TypeScript infers number', () => {
    const x = only(result.symbols, 'x', 'local')
    expect(x.kind).toBe('local')
    expect(typeKey(x.type)).toBe('f32')
    expect(x.mutable).toBe(true)
  })

  it('types a const bound to a fractional literal f32', () => {
    const half = only(result.symbols, 'half')
    expect(half.kind).toBe('local')
    expect(typeKey(half.type)).toBe('f32')
    expect(half.mutable).toBe(false)
  })

  it('types a local bound to a u32 conversion u32', () => {
    expect(typeKey(only(result.symbols, 'n').type)).toBe('u32')
  })

  it('types a local bound to a vec3 construction vec3<f32>', () => {
    expect(typeKey(only(result.symbols, 'vv').type)).toBe('vec3<f32>')
  })

  it('types a local bound to a vec3<f64> value as the emulated double vector', () => {
    expect(typeKey(only(result.symbols, 'wide').type)).toBe('vec3<f64>')
  })

  it('records a parameter with its annotated type', () => {
    const v = only(result.symbols, 'v', 'param')
    expect(v.kind).toBe('param')
    expect(typeKey(v.type)).toBe('vec3<f32>')
    expect(typeKey(only(result.symbols, 'd').type)).toBe('vec3<f64>')
  })

  it('records a module const', () => {
    const k = only(result.symbols, 'K')
    expect(k.kind).toBe('const')
    expect(typeKey(k.type)).toBe('f32')
  })

  it('records a uniform binding with the struct it carries', () => {
    const camera = only(result.symbols, 'camera')
    expect(camera.kind).toBe('binding')
    expect(typeKey(camera.type)).toBe('struct:Camera')
    expect(camera.mutable).toBe(false)
  })

  it("records a helper function's return type and parameters", () => {
    const clamp01 = only(result.symbols, 'clamp01')
    expect(clamp01.kind).toBe('function')
    expect(typeKey(clamp01.type)).toBe('f32')
    expect(clamp01.params?.map((p) => [p.name, typeKey(p.type)])).toEqual([
      ['x', 'f32'],
      ['lo', 'f32'],
    ])
  })

  it('records an entry function the same way', () => {
    const fs = only(result.symbols, 'fs')
    expect(fs.kind).toBe('function')
    expect(typeKey(fs.type)).toBe('vec4<f32>')
    expect(fs.params?.map((p) => p.name)).toEqual(['v', 'd'])
  })

  it('records a struct and each of its fields, with the owning struct name', () => {
    const vertex = only(result.symbols, 'Vertex')
    expect(vertex.kind).toBe('struct')
    expect(typeKey(vertex.type)).toBe('struct:Vertex')
    const fields = result.symbols.filter((s) => s.kind === 'field' && s.struct === 'Vertex')
    expect(fields.map((f) => [f.name, typeKey(f.type)])).toEqual([
      ['pos', 'vec3<f32>'],
      ['uv', 'vec2<f32>'],
    ])
    expect(typeKey(only(result.symbols, 'view').type)).toBe('mat4x4<f32>')
  })

  it('records the whole fixture in lowering order, one entry per declaration', () => {
    expect(result.symbols.map((s) => `${s.kind} ${s.name}`)).toEqual([
      'struct Vertex',
      'field pos',
      'field uv',
      'struct Camera',
      'field view',
      'binding camera',
      'const K',
      'function clamp01',
      'param x',
      'param lo',
      'local y',
      'function fs',
      'param v',
      'param d',
      'local x',
      'local half',
      'local n',
      'local wide',
      'local vv',
      'local i',
    ])
  })
})

describe('DeclaredSymbol table: a binding, and what mutable means for one', () => {
  // `mutable` on a BINDING follows the ACCESS MODE, not the keyword. Every binding is declared
  // `const` (design rule 6.1), so the keyword tells a reader of the table nothing; what it has
  // to be able to tell apart is a `storage<T>` from a `storage<T, "read_write">`, because that
  // is what decides whether the buffer may be written. For a LOCAL `mutable` is still the
  // keyword, which is the case the arms above this one cover.
  const source = [
    '"use typeshade";',
    'declare const ro: storage<array<f32>>',
    'declare const rw: storage<array<f32>, "read_write">',
    '@compute([64, 1, 1])',
    'export function cs(@builtin("global_invocation_id") gid: vec3u): void {',
    '  rw[gid.x] = ro[gid.x];',
    '}',
  ].join('\n')

  it('records the access mode of each binding, and the keyword of neither', () => {
    const r = compileTsSource(source)
    expect(errorsOf(r.diagnostics)).toEqual([])
    expect(only(r.symbols, 'ro').mutable).toBe(false)
    expect(only(r.symbols, 'rw').mutable).toBe(true)
    expect(r.bindings.find((b) => b.name === 'rw')?.access).toBe('read_write')
    expect(r.bindings.find((b) => b.name === 'ro')?.access).toBe('read')
  })

  it('a uniform binding is never mutable, whatever it is declared with', () => {
    const r = compileTsSource(
      [
        '"use typeshade";',
        'declare const u: uniform<f32>',
        'export function f(): f32 { return u }',
      ].join('\n'),
    )
    expect(errorsOf(r.diagnostics)).toEqual([])
    expect(only(r.symbols, 'u').mutable).toBe(false)
  })
})

describe('DeclaredSymbol table: a for-init declarator', () => {
  const header = (init: string) =>
    [
      '"use typeshade";',
      'export function f(): f32 {',
      `  for (${init}; i < 4; i++) {}`,
      '  return 1.;',
      '}',
    ].join('\n')

  it('records an annotated induction variable as i32', () => {
    const r = compileTsSource(header('let i: i32 = 0'))
    expect(errorsOf(r.diagnostics)).toEqual([])
    const i = only(r.symbols, 'i')
    expect(i.kind).toBe('local')
    expect(typeKey(i.type)).toBe('i32')
    expect(i.mutable).toBe(true)
  })

  it('records an unannotated `let i = 0` as the i32 it now is', () => {
    // This is the update the previous version of this test asked for in as many words: a bare
    // integer literal lowered to f32, the loop-induction check (i32 or u32 only) rejected
    // `let i = 0` before it was ever defined, and no symbol was recorded. A3 gives a for-init
    // literal the i32 an induction variable must have, so it is an ordinary local now.
    const r = compileTsSource(header('let i = 0'))
    expect(errorsOf(r.diagnostics)).toEqual([])
    const i = only(r.symbols, 'i')
    expect(i.kind).toBe('local')
    expect(typeKey(i.type)).toBe('i32')
    expect(i.mutable).toBe(true)
  })
})

describe('DeclaredSymbol table: shadowing and errors', () => {
  it('gives a shadowing redeclaration its own entry with its own span', () => {
    const source = [
      '"use typeshade";',
      'export function f(): f32 {',
      '  let x = 1.;',
      '  {',
      '    let x = 2;',
      '  }',
      '  return x;',
      '}',
    ].join('\n')
    const r = compileTsSource(source)
    const xs = r.symbols.filter((s) => s.name === 'x')
    expect(xs).toHaveLength(2)
    expect(xs[0]!.start).toBe(source.indexOf('let x = 1.') + 4)
    expect(xs[1]!.start).toBe(source.indexOf('let x = 2') + 4)
    for (const x of xs) expect(source.slice(x.start, x.start + x.length)).toBe('x')
  })

  it('keeps the declarations lowered before a type error', () => {
    const source = [
      '"use typeshade";',
      'export function f(v: vec3): f32 {',
      '  let before = 1.;',
      '  let bad: f32 = v;',
      '  let after = 3.;',
      '  return before + after;',
      '}',
    ].join('\n')
    const r = compileTsSource(source)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.TYPE_MISMATCH)).toBe(true)
    expect(r.symbols.filter((s) => s.kind === 'local').map((s) => s.name)).toEqual([
      'before',
      'after',
    ])
  })

  it('records nothing when nothing is lowered', () => {
    expect(compileTsSource('export const x = 1\n').symbols).toEqual([])
    expect(
      compileTsSource('"use typeshade";\nexport function f(): f32 { return 1.\n').symbols,
    ).toEqual([])
  })
})
