// The editor and the compiler agree, in BOTH directions (#157).
//
// The ambient library is a second implementation of the surface's type rules, written in
// TypeScript's vocabulary instead of the compiler's, and two implementations drift. A rule the
// ambient lib states more narrowly than the compiler is a FALSE POSITIVE: red squiggles on a
// program that compiles, which is the worse of the two failures because it stops an author who
// was right. A rule it states more widely is a false negative: the editor is silent and the
// compiler refuses a moment later.
//
// So this file asserts the AGREEMENT rather than either verdict. Each row is a program; the
// test asks tsc through the language service and the compiler through `compileTsSource`, and
// requires that both accept it or both refuse it. It deliberately does not say WHICH, because
// the rows where they agree to refuse are as much the subject as the rows where they agree to
// accept — and a row that flips from "both refuse" to "both accept" is a feature, not a
// regression this test should hide.

import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'
import { compileTsSource } from '../compiler/ts/source-file.js'

const editorRefusal = (source: string): string | null => {
  const service = createTypeshadeLanguageService()
  service.openDocument('a.ts', source)
  const d = service.getDiagnostics('a.ts')
  return d.length === 0 ? null : `${d[0]!.source} ${String(d[0]!.code)}: ${String(d[0]!.message)}`
}

const compilerRefusal = (source: string): string | null => {
  const d = compileTsSource(source).diagnostics.filter((x) => x.category === 'error')
  return d.length === 0 ? null : `${d[0]!.code}: ${d[0]!.message}`
}

const FS = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`

/** A row is `[name, program, 'both accept' | 'both refuse']`. The expectation is written out
 *  rather than inferred so a row that changes verdict has to be edited deliberately. */
const ROWS: readonly (readonly [string, string, 'accept' | 'refuse'])[] = [
  // `select` over every type WGSL gives it (wgsl.txt:21338-21352), not the numeric ones alone.
  // The compiler always lowered all of these; the ambient `T extends Numeric` was the narrow
  // one, so a bool select was red in the editor and green a moment later.
  [
    'select of bools',
    FS(
      '',
      '  const a = uv.x > 0.\n  const s = select(a, a, a)\n  return vec4(s ? 1. : 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'select of bool vectors',
    FS(
      '',
      '  const a = uv.x > 0.\n  const s = select(vec2b(false, false), vec2b(true, true), a)\n  return vec4(s.x ? 1. : 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'select with a vector condition',
    FS(
      '',
      '  const c = vec2b(true, false)\n  const s = select(vec2(0., 0.), uv, c)\n  return vec4(s, 0., 1.)',
    ),
    'accept',
  ],
  // The vector compositions (wgsl.txt:20889/20987). Only the vector-FIRST forms were declared,
  // so anything with a vector after a scalar was red in the editor and green in the compiler.
  ['vec3(x, v2)', FS('', '  const w = vec3(uv.x, uv)\n  return vec4(w, 1.)'), 'accept'],
  ['vec3(v2, x)', FS('', '  const w = vec3(uv, uv.x)\n  return vec4(w, 1.)'), 'accept'],
  ['vec4(x, v2, w)', FS('', '  const w = vec4(uv.x, uv, uv.y)\n  return w'), 'accept'],
  ['vec4(x, y, v2)', FS('', '  const w = vec4(uv.x, uv.y, uv)\n  return w'), 'accept'],
  ['vec4(v2, x, y)', FS('', '  const w = vec4(uv, uv.x, uv.y)\n  return w'), 'accept'],
  ['vec4(v3, x)', FS('', '  const w = vec4(vec3(uv, 1.), uv.x)\n  return w'), 'accept'],
  [
    'vec3u(x, v2u)',
    FS('', '  const w = vec3u(u32(1), vec2u(2, 3))\n  return vec4(f32(w.x) * 0., 0., 0., 1.)'),
    'accept',
  ],
  // A cast takes a bool (wgsl.txt:20207). The compiler lowered it; the editor said "Argument of
  // type 'boolean' is not assignable to parameter of type 'number'".
  ['f32(bool)', FS('', '  const k = f32(true)\n  return vec4(k, 0., 0., 1.)'), 'accept'],
  ['i32(bool)', FS('', '  const k = i32(true)\n  return vec4(f32(k) * 0., 0., 0., 1.)'), 'accept'],
  ['u32(bool)', FS('', '  const k = u32(true)\n  return vec4(f32(k) * 0., 0., 0., 1.)'), 'accept'],
  [
    'bool(number)',
    FS('', '  const k = bool(1.)\n  return vec4(k ? 1. : 0., 0., 0., 1.)'),
    'accept',
  ],
  // The rows where they agree to REFUSE. Each was listed as a disagreement in the audit and is
  // one no longer; they are here so a future widening of either layer alone shows up.
  [
    'normalize of a scalar',
    FS('', '  const n = normalize(uv.x)\n  return vec4(n, 0., 0., 1.)'),
    'refuse',
  ],
  [
    'reflect of a scalar',
    FS('', '  const r = reflect(uv.x, uv.x)\n  return vec4(r, 0., 0., 1.)'),
    'refuse',
  ],
  [
    'faceForward of a scalar',
    FS('', '  const r = faceForward(uv.x, uv.x, uv.x)\n  return vec4(r, 0., 0., 1.)'),
    'refuse',
  ],
  [
    'refract of a scalar',
    FS('', '  const r = refract(uv.x, uv.x, 0.5)\n  return vec4(r, 0., 0., 1.)'),
    'refuse',
  ],
  [
    'sign of an unsigned vector',
    FS('', '  const g = sign(vec2u(1, 2))\n  return vec4(f32(g.x) * 0., 0., 0., 1.)'),
    'refuse',
  ],
  [
    'ldexp with a float exponent',
    FS('', '  const k = ldexp(uv.x, 2.5)\n  return vec4(k, 0., 0., 1.)'),
    'refuse',
  ],
  [
    'ldexp with an i32 exponent',
    FS('', '  const k = ldexp(uv.x, i32(2))\n  return vec4(k, 0., 0., 1.)'),
    'accept',
  ],
  [
    'arrayLength of a fixed array',
    FS(
      '',
      '  const a = array(1., 2., 3.)\n  const n = arrayLength(a)\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'refuse',
  ],
  // A binding declared with an INTERFACE works; a type literal is refused by both layers. The
  // audit asks for the literal to be accepted, which needs the compiler to synthesise an
  // anonymous struct — a feature, not a parity fix. Pinned as it stands so the day it changes
  // is a deliberate edit, and so the two layers are known to move together when it does.
  [
    'binding declared with an interface',
    FS('interface P { m: mat4 }\ndeclare const U: uniform<P>', '  return U.m * vec4(uv, 0., 1.)'),
    'accept',
  ],
  [
    'binding declared with a type literal',
    FS('declare const U: uniform<{ m: mat4 }>', '  return U.m * vec4(uv, 0., 1.)'),
    'refuse',
  ],
]

describe('the ambient library declares what the compiler lowers, no wider and no narrower', () => {
  it('has rows on both sides, so neither verdict can carry the suite alone', () => {
    expect(ROWS.filter((r) => r[2] === 'accept').length).toBeGreaterThanOrEqual(10)
    expect(ROWS.filter((r) => r[2] === 'refuse').length).toBeGreaterThanOrEqual(5)
  })

  for (const [name, source, verdict] of ROWS) {
    it(`${name}: the editor and the compiler both ${verdict}`, () => {
      const editor = editorRefusal(source)
      const compiler = compilerRefusal(source)
      expect(
        {
          editor: editor === null ? 'accept' : 'refuse',
          compiler: compiler === null ? 'accept' : 'refuse',
        },
        `editor: ${editor ?? '(clean)'}\ncompiler: ${compiler ?? '(clean)'}`,
      ).toEqual({ editor: verdict, compiler: verdict })
    })
  }

  // The two compositions left UNDECLARED on purpose, with the cost that declaring them carries.
  // They are real WGSL and the compiler takes both; the editor does not, and this pins that as
  // a known, reasoned gap rather than letting it read as a row nobody looked at.
  for (const [name, source] of [
    ['vec4(x, v3)', FS('', '  const v = vec3(uv, 1.)\n  const w = vec4(uv.x, v)\n  return w')],
    ['vec4(v2, v2)', FS('', '  const w = vec4(uv, uv)\n  return w')],
  ] as const) {
    it.fails(`${name} is accepted by the compiler and NOT by the editor (#157)`, () => {
      // Adding a second TWO-argument `vec4` overload costs TypeScript the contextual type it
      // uses to infer through vector arithmetic: `vec4(mix(c * 0.5, d, 0.5), 1.)` then reports
      // TS2769 on a program that compiles, because `mix` infers from the `number` the
      // arithmetic erased rather than from the `vec3` the context supplied. `vec4(c * 0.5, 1.)`
      // is a far more common spelling than either of these two, so the editor is better off
      // without them until the #43 filter can restore a shape through a NESTED call.
      expect(editorRefusal(source)).toBeNull()
      expect(compilerRefusal(source)).toBeNull()
    })
  }
})
