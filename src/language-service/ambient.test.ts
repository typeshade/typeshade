import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createTypeshadeLanguageService } from './service.js'
import { TypeshadeHost, AMBIENT_LIB_URI } from './host.js'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLES_DIR = join(HERE, '..', '..', 'examples')
const SOT_FILE = join(HERE, '..', 'core', 'sot.ts')
const FUNCTION_FILE = join(HERE, '..', 'compiler', 'ts', 'lower', 'function.ts')
const STRUCTS_FILE = join(HERE, '..', 'compiler', 'ts', 'structs.ts')
// `'builtin'` itself is matched in builtin-check.ts now (shared by function.ts's parameter
// decorator and structs.ts's field decorator, so the allow-list/stage checks live in one
// place) — included here so this test still covers where `@builtin(...)` is actually parsed.
const BUILTIN_CHECK_FILE = join(HERE, '..', 'compiler', 'ts', 'builtin-check.ts')

/** Every `"use typeshade"` example, read from the directory rather than listed by hand so a new
 * one joins this corpus by existing. The corpus was the five `hello*` files, which are all
 * vertex and fragment shaders; `compute-reduction-twin.shade.ts` is what caught the ambient
 * `array`'s read-only index signature, since a compute kernel is the only program that writes
 * to a storage binding. */
const SHADE_EXAMPLES = readdirSync(EXAMPLES_DIR)
  .filter((name) => name.endsWith('.shade.ts'))
  .sort()

/** The names this corpus must contain: a `readdirSync` that resolved nothing, or an examples
 * directory that lost its compute kernel, would otherwise leave the suite below green over
 * nothing at all. */
const REQUIRED_EXAMPLES = [
  'compute-reduction-twin.shade.ts',
  'hello-camera.shade.ts',
  // #18's uniform struct: the first example in this corpus whose fragment multiplies a vector
  // and hands the product to `vec4(...)`, which is the shape issue #43 is about.
  'hello-uniform-struct.shade.ts',
  'hello-uniform.shade.ts',
  'hello-vsin.shade.ts',
  'hello-vsout.shade.ts',
  'hello.shade.ts',
]

describe('SHADE_DTS: every .shade.ts example produces zero diagnostics', () => {
  it('reads a corpus that still holds every example this suite was built on', () => {
    for (const name of REQUIRED_EXAMPLES) {
      expect(SHADE_EXAMPLES, `${name} is missing from the examples corpus`).toContain(name)
    }
  })

  for (const name of SHADE_EXAMPLES) {
    it(`${name}: zero TypeScript diagnostics and zero TypeShade diagnostics`, () => {
      const text = readFileSync(join(EXAMPLES_DIR, name), 'utf8')
      const service = createTypeshadeLanguageService()
      service.openDocument(name, text)
      const diagnostics = service.getDiagnostics(name)
      // Zero, not "zero but for TS1206": `@vertex`/`@compute` on a top-level function and
      // `@builtin(...)` on its parameters are the one grammar no ambient lib can declare away,
      // and `diagnostics.ts` already filters exactly that shape (design doc §6).
      expect(
        diagnostics.map((d) => `${d.source} ${d.code}: ${d.message}`),
        `${name} should compile clean under the ambient lib`,
      ).toEqual([])
    })
  }
})

// Regression for the false positive PR #31's tarball measurement surfaced and the Playground
// reported as "compute reduction: output[idx] = sum shows an error": the ambient `array`'s index
// signature was `readonly`, which made the store every compute kernel ends with a TS2542 in the
// editor while the compiler lowered it happily. The example suite above now covers the same
// ground through `compute-reduction-twin.shade.ts`; this arm names the one construct, so a
// regression says what broke rather than which file stopped compiling.
describe('a storage array is writable in the editor, as it is in the compiler', () => {
  const kernel = (body: string): string =>
    '"use typeshade"\n' +
    'declare let out: storage<array<f32>>\n' +
    '@compute([64, 1, 1])\n' +
    'export function k(@builtin("global_invocation_id") gid: vec3u): void {\n' +
    `  ${body}\n` +
    '}\n'

  it('out[gid.x] = value reports no TS2542, and nothing else either', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', kernel('out[gid.x] = 1.'))
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.filter((d) => d.source === 'typescript' && d.code === 2542)).toEqual([])
    expect(diagnostics.map((d) => `${d.source} ${d.code}: ${d.message}`)).toEqual([])
  })

  it('keeps length read-only, so the change reaches the index signature only', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', kernel('out.length = 2'))
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.some((d) => d.source === 'typescript' && d.code === 2540)).toBe(true)
  })
})

// #8 A16 made `const xs: array<f32, 3> = [1., 2., 3.]` compile, and the ambient `array`'s tag
// was REQUIRED, so the editor answered a program the compiler accepts with TS2322 ("Property
// '[arrayTag]' is missing in type '[number, number, number]'"). The tag is optional now. The
// example sweep above covers the same ground through `array-literal-ramp.shade.ts`; this arm
// names the construct, and pins what the change must NOT cost — `length` is still `N`, so the
// sizes stay apart.
describe('a list initializes an array in the editor, as it does in the compiler', () => {
  const helper = (body: string): string =>
    '"use typeshade"\n' + 'export function f(): f32 {\n' + `  ${body}\n` + '  return xs[0]\n}\n'

  it('reports nothing on a list of the declared size', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', helper('const xs: array<f32, 3> = [1., 2., 3.]'))
    expect(
      service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
    ).toEqual([])
  })

  it('still reports a list of the wrong size, which is what `length: N` buys', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', helper('const xs: array<f32, 3> = [1., 2.]'))
    expect(
      service.getDiagnostics('a.ts').some((d) => d.source === 'typescript' && d.code === 2322),
    ).toBe(true)
  })
})

// Issue #43: `v * s` is typed `number`, so using the product AS a vector was rejected at every
// call. The gate above was already green on this corpus before that rule landed, because #18 paid
// for it with an annotated local in `hello-uniform-struct.shade.ts` (`const rgb: vec3 = ...`, see
// the comment in that file). Measured over the 17 `.shade.ts` files on `feat/porting-twins`, which
// carries the twins as well, 11 reported and this shape was the largest single cause, while every
// one of them compiled and linked on Tint and WebGL2. A twin cannot take #18's workaround, since
// it is supposed to mirror its EDSL original, so the line this example actually wanted is pinned
// here.
describe('a vector product used as a vector is clean in the editor (issue #43)', () => {
  const uniformStructFragment =
    '"use typeshade"\n' +
    'class Uniforms {\n' +
    '  tint: vec4\n' +
    '  gain: f32\n' +
    '}\n' +
    'declare const u: uniform<Uniforms>\n' +
    'class VsOut {\n' +
    '  @builtin("position") pos: vec4\n' +
    '  @location(0) uv: vec2\n' +
    '}\n' +
    '@fragment\n' +
    'export function fs(vo: VsOut): vec4 {\n' +
    '  return vec4(u.tint.rgb * (vo.uv.y * u.gain), u.tint.a)\n' +
    '}\n'

  it('hello-uniform-struct.shade.ts (#18) without its annotated local has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', uniformStructFragment)
    expect(
      service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
    ).toEqual([])
  })
})

// Regression for the blocker where `VecOf`'s use of the standard-lib `Pick` helper resolved to
// an error type under `lib: []` (`Pick` is declared by `lib.es5.d.ts`, never loaded here), which
// silently collapsed every vector type to `any` instead of raising a TypeScript error inside
// the ambient lib itself. The zero-diagnostics suite above cannot catch this: it can only see
// false positives on the examples, never a type system that has gone permissive. This is the
// real §6 guard.
describe('AMBIENT_LIB_URI: the bundled shade.d.ts itself must type-check cleanly', () => {
  it('produces zero TypeScript diagnostics against its own compiler options', () => {
    const host = new TypeshadeHost()
    host.openDocument('a.ts', '"use typeshade"\nexport function f(): void {}\n')
    const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
    const diagnostics = [
      ...ls.getSyntacticDiagnostics(AMBIENT_LIB_URI),
      ...ls.getSemanticDiagnostics(AMBIENT_LIB_URI),
    ]
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  })

  it('actually type-checks vector arguments (a vec2 does not satisfy a vec4 parameter)', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\n' +
      'function g(a: vec4): void {}\n' +
      'export function f(): void {\n' +
      '  g(vec2(1, 2))\n' +
      '}\n'
    service.openDocument('a.ts', source)
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.some((d) => d.source === 'typescript' && d.code === 2345)).toBe(true)
  })

  it('actually type-checks member access on a vector (no member named "nope")', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\n' + 'export function f(a: vec4): f32 {\n' + '  return a.nope\n' + '}\n'
    service.openDocument('a.ts', source)
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.some((d) => d.source === 'typescript' && d.code === 2339)).toBe(true)
  })
})

// Regression for the major finding where a REQUIRED unique-symbol brand on f32/i32/u32/f64 made
// an ordinary valid "use typeshade" program report TS2322, because nothing in the authoring
// surface ever produces a literal value that already carries the brand. The corpus here is
// deliberately wider than the five hello examples (none of which annotates an f32 return or
// local), since that narrower corpus is exactly what let the bug through originally.
describe('scalar brands: an f32/u32/... annotation never false-positives on a plain number', () => {
  it('an f32 helper function with an f32 parameter and return has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\n' +
      'export function h(a: f32, b: f32): f32 {\n' +
      '  return a * b\n' +
      '}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('a bare float literal returned from an f32-annotated function has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade"\nexport function h(a: f32): f32 {\n  return a + 1.\n}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('an f32-typed local initialized from a float literal has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\nexport function h(): f32 {\n  let t: f32 = 1.0\n  return t\n}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('dot(...), typed number in the ambient lib, satisfies an f32 return with zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\nexport function h(a: vec4, b: vec4): f32 {\n  return dot(a, b)\n}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })
})

// The generic math signatures' own shape, which is what the twins corpus failed on rather than
// any diagnostic worth filtering. Two arms, and the second is the load-bearing one:
//
//   1. `mix(vecN, vecN, f32)` is real: WGSL spells it `mix(e1: vecN<T>, e2: vecN<T>, e3: T)`,
//      GLSL ES 3.00 `mix(genType, genType, float)`, and the compiler lowers it to exactly that
//      call. `mix<T extends Numeric>(a: T, b: T, t: T)` demanded a vector for `t`, which is why
//      `mix(u.bottom.rgb, u.top.rgb, t)` drew TS2345 on a line that compiles and runs.
//   2. Every OTHER vector-beside-scalar shape the front end accepts is NOT real: measured by
//      emitting one module per shape and handing it to Tint and to WebGL2's GLSL ES 3.00
//      translator, `clamp(vecN, s, s)`, `min`/`max(vecN, s)`, `pow(vecN, s)`, `step(vecN, s)`
//      and `mix` on an `i32`/`u32` vector are all rejected with "no matching call". The front
//      end has no argument check for the math functions at all (#57), so TypeScript is the only
//      thing reporting them and this lib must not declare them away.
describe('vector-with-scalar math shapes: exactly the ones both backends accept', () => {
  const diagnosticsOf = (body: string): string[] => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', `"use typeshade"\n${body}\n`)
    return service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`)
  }
  const reports = (body: string): boolean =>
    diagnosticsOf(body).some(
      (d) => d.startsWith('typescript 2345') || d.startsWith('typescript 2769'),
    )

  describe('mix(vecN, vecN, scalar) is clean, for every f32 arity', () => {
    for (const [type, ctor] of [
      ['vec2', 'vec2(1., 2.)'],
      ['vec3', 'vec3(1., 2., 3.)'],
      ['vec4', 'vec4(1., 2., 3., 4.)'],
    ]) {
      it(`${type} endpoints with an f32 blend factor`, () => {
        expect(
          diagnosticsOf(
            `export function f(a: ${type}, b: ${type}, t: f32): ${type} {\n  return mix(a, b, t)\n}`,
          ),
        ).toEqual([])
      })
      it(`${type} endpoints with a literal blend factor`, () => {
        expect(
          diagnosticsOf(
            `export function f(a: ${type}, b: ${type}): ${type} {\n  return mix(a, b, 0.5)\n}`,
          ),
        ).toEqual([])
      })
      it(`${type} constructors with a computed blend factor`, () => {
        expect(
          diagnosticsOf(
            `export function f(t: f32): ${type} {\n  return mix(${ctor}, ${ctor}, t * 0.5 + 0.5)\n}`,
          ),
        ).toEqual([])
      })
    }

    // The line PR #42's gradient twin is written in, which is where this started.
    it('a swizzle pair from a uniform struct with a uniform-driven t', () => {
      expect(
        diagnosticsOf(
          'class U {\n  top: vec4\n  bottom: vec4\n  mix_bias: f32\n}\n' +
            'declare const u: uniform<U>\n' +
            'export function f(uv: vec2): vec4 {\n' +
            '  const t = uv.y + u.mix_bias\n' +
            '  return vec4(mix(u.bottom.rgb, u.top.rgb, t), 1.)\n' +
            '}',
        ),
      ).toEqual([])
    })

    it('keeps the same-shape form: mix(vecN, vecN, vecN) and mix(f32, f32, f32)', () => {
      expect(
        diagnosticsOf(
          'export function f(a: vec3, b: vec3, t: vec3): vec3 {\n  return mix(a, b, t)\n}',
        ),
      ).toEqual([])
      expect(
        diagnosticsOf('export function f(a: f32, b: f32, t: f32): f32 {\n  return mix(a, b, t)\n}'),
      ).toEqual([])
      // An integer `mix` is a shape the ambient lib takes and both GPU compilers refuse (Tint:
      // no matching call to 'mix(vec3<i32>, vec3<i32>, vec3<i32>)'); the front end's argument
      // check says so (#57, TS8036), and the service reports it like any compiler diagnostic.
      expect(
        diagnosticsOf(
          'export function f(a: vec3i, b: vec3i, t: vec3i): vec3i {\n  return mix(a, b, t)\n}',
        ),
      ).toEqual(['typeshade TS8036: mix takes an f32, or a vector of them; got vec3<i32>.'])
    })
  })

  describe('a literal beside an f32 no longer settles T to the literal type', () => {
    it('smoothstep(0.3, 0.55, h) on an f32 h', () => {
      expect(
        diagnosticsOf('export function f(h: f32): f32 {\n  return smoothstep(0.3, 0.55, h)\n}'),
      ).toEqual([])
    })
    it('step(horizon, y) on a literal-typed const', () => {
      expect(
        diagnosticsOf(
          'export function f(y: f32): f32 {\n  const horizon = 0.58\n  return step(horizon, y)\n}',
        ),
      ).toEqual([])
    })
    it('max(0.3, h) on an f32 h', () => {
      expect(diagnosticsOf('export function f(h: f32): f32 {\n  return max(0.3, h)\n}')).toEqual([])
    })
    it('the same call nested in mix, which is how the twins write it', () => {
      expect(
        diagnosticsOf(
          'export function f(a: vec3, b: vec3, h: f32): vec3 {\n  return mix(a, b, smoothstep(0.3, 0.55, h))\n}',
        ),
      ).toEqual([])
    })
  })

  describe('every shape a GPU compiler rejects still reports', () => {
    // Each of these emits WGSL the front end is happy with and Tint refuses: measured through
    // the compile gate's own instruments, on SwiftShader, with the broken-shader check first.
    const rejectedByTint: Readonly<Record<string, string>> = {
      'clamp(vec3, f32, f32)':
        'export function f(a: vec3, lo: f32, hi: f32): vec3 {\n  return clamp(a, lo, hi)\n}',
      'min(vec3, f32)': 'export function f(a: vec3, s: f32): vec3 {\n  return min(a, s)\n}',
      'max(vec3, f32)': 'export function f(a: vec3, s: f32): vec3 {\n  return max(a, s)\n}',
      'pow(vec3, f32)': 'export function f(a: vec3, s: f32): vec3 {\n  return pow(a, s)\n}',
      'step(vec3, f32)': 'export function f(a: vec3, s: f32): vec3 {\n  return step(a, s)\n}',
      'mix(vec3i, vec3i, i32)':
        'export function f(a: vec3i, b: vec3i, t: i32): vec3i {\n  return mix(a, b, t)\n}',
      'mix(vec3u, vec3u, u32)':
        'export function f(a: vec3u, b: vec3u, t: u32): vec3u {\n  return mix(a, b, t)\n}',
    }
    for (const [name, body] of Object.entries(rejectedByTint)) {
      it(`${name}: reported, because Tint reports it too`, () => {
        expect(reports(body), body).toBe(true)
      })
    }

    const wrongShape: Readonly<Record<string, string>> = {
      'dot(vec3, vec2)': 'export function f(a: vec3, b: vec2): f32 {\n  return dot(a, b)\n}',
      'mix(vec3, vec2, f32)':
        'export function f(a: vec3, b: vec2, t: f32): vec3 {\n  return mix(a, b, t)\n}',
      'mix(vec3, vec3, vec2)':
        'export function f(a: vec3, b: vec3, t: vec2): vec3 {\n  return mix(a, b, t)\n}',
      'mix(vec2, vec2, vec3)':
        'export function f(a: vec2, b: vec2, t: vec3): vec2 {\n  return mix(a, b, t)\n}',
      'mix(f32, vec3, f32): a scalar where a vector is required':
        'export function f(a: f32, b: vec3, t: f32): vec3 {\n  return mix(a, b, t)\n}',
      'mix(vec3, vec3i, f32): same arity, different element kind':
        'export function f(a: vec3, b: vec3i, t: f32): vec3 {\n  return mix(a, b, t)\n}',
    }
    for (const [name, body] of Object.entries(wrongShape)) {
      it(`${name}: reported`, () => {
        expect(reports(body), body).toBe(true)
      })
    }
  })
})

// WHERE THE DIAGNOSTIC LANDS, which is the other half of the TS2769 rule. TypeScript puts an
// overload failure on the ARGUMENT span only when the first argument is the one that failed; as
// soon as the mismatch is in a later argument it reports on the CALLEE instead. A filter that can
// only read an argument span therefore gave up on exactly the calls it exists to drop:
// `max(base, u.tint.rgb * u.gain)` with two vec3 is clean on main, reported "No overload matches
// this call" once `mix` and the generic math names became overloaded, and is a program both Tint
// and ANGLE's GLSL ES 3.00 translator accept. Arithmetic in the FIRST argument was always clean,
// which is why neither the twins corpus nor `examples/` caught it.
describe('vector arithmetic in a later argument stays clean (the callee-span TS2769)', () => {
  const diagnosticsOf = (body: string): string[] => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', `"use typeshade"\n${body}\n`)
    return service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`)
  }

  it('max(a, b * 2.) with two vec3, the shape that measured this', () => {
    expect(
      diagnosticsOf('export function f(a: vec3, b: vec3): vec3 {\n  return max(a, b * 2.)\n}'),
    ).toEqual([])
  })

  it('clamp(a, b * 2., c): arithmetic in the middle of three arguments', () => {
    expect(
      diagnosticsOf(
        'export function f(a: vec3, b: vec3, c: vec3): vec3 {\n  return clamp(a, b * 2., c)\n}',
      ),
    ).toEqual([])
  })

  it('smoothstep(a, b, c * 2.): arithmetic in the last argument', () => {
    expect(
      diagnosticsOf(
        'export function f(a: vec3, b: vec3, c: vec3): vec3 {\n  return smoothstep(a, b, c * 2.)\n}',
      ),
    ).toEqual([])
  })

  it('max(a, b * 2.) with a vec2 b still reports, so the span is not a licence', () => {
    // The callee-span path drops the per-argument guard, so the whole-signature question is the
    // only thing holding the rule: no overload takes a vec3 first and a vec2 second.
    expect(
      diagnosticsOf('export function f(a: vec3, b: vec2): vec3 {\n  return max(a, b * 2.)\n}'),
    ).not.toEqual([])
  })

  // The vocabulary swept rather than sampled: every free math name whose parameters are all one
  // shape, at every arity it has, with the arithmetic moved through each argument position in
  // turn. 92 calls. All 92 are clean on main; 30 of them reported on this branch before the
  // callee-span path, every one a min/max/pow/step/mod/atan2/clamp/smoothstep with its
  // arithmetic anywhere but the first argument.
  const SAME_SHAPE_ARITY: Readonly<Record<string, number>> = {
    min: 2,
    max: 2,
    pow: 2,
    step: 2,
    mod: 2,
    atan2: 2,
    clamp: 3,
    smoothstep: 3,
    mix: 3,
    dot: 2,
    distance: 2,
    cross: 2,
    normalize: 1,
    abs: 1,
    sqrt: 1,
    floor: 1,
    fract: 1,
  }
  /** The two names that reduce a vector to a scalar, so the sweep annotates the return type. */
  const SCALAR_RESULT: ReadonlySet<string> = new Set(['dot', 'distance'])

  it('every same-shape all-vector call is clean with arithmetic in any argument', () => {
    const reported: string[] = []
    let calls = 0
    for (const [name, arity] of Object.entries(SAME_SHAPE_ARITY)) {
      // `cross` is vec3-only in GLSL and in WGSL, and the ambient lib declares it that way.
      for (const vec of name === 'cross' ? ['vec3'] : ['vec2', 'vec3', 'vec4']) {
        for (let k = 0; k < arity; k++) {
          const params = Array.from({ length: arity }, (_, i) => `p${i}: ${vec}`).join(', ')
          const args = Array.from({ length: arity }, (_, i) =>
            i === k ? `p${i} * 2.` : `p${i}`,
          ).join(', ')
          const result = SCALAR_RESULT.has(name) ? 'f32' : vec
          const body = `export function f(${params}): ${result} {\n  return ${name}(${args})\n}`
          calls++
          const diagnostics = diagnosticsOf(body)
          if (diagnostics.length > 0) reported.push(`${name}(${vec}) at ${k}: ${diagnostics[0]}`)
        }
      }
    }
    expect(calls).toBe(92)
    expect(reported).toEqual([])
  })
})

// The four `mix` blend factors both GPU compilers refuse that the ambient lib takes. `mix`'s
// blend factor is declared `t: number`, which is wider than the `f32` WGSL and GLSL ES 3.00
// require, and narrowing it to `f32` closes none of these: the scalar brands are OPTIONAL, so
// `i32`, `u32` and `f64` are all assignable to `f32` too (measured). They were pinned here as
// silent until the front end's argument check for the math builtins (#57, TS8036, roadmap 0.2
// item 9); all four are that diagnostic now, reported by the service like any compiler
// diagnostic. The `f64` factor was the last silent one: it reached emit and came back as
// SD0041 with no source span, which is the hole #151 closes — an emulated double is refused
// where it is WRITTEN, whether it is the operand or, as here, the blend factor of native
// vectors.
describe('mix blend factors the GPU compilers refuse (#57)', () => {
  const diagnosticsOf = (body: string): string[] => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', `"use typeshade"\n${body}\n`)
    return service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`)
  }

  const factor = (t: string): string =>
    `typeshade TS8036: mix takes this argument as vec3<f32>, the first argument's type, or as a scalar f32; got ${t}.`
  const reported: Readonly<Record<string, readonly [string, readonly string[]]>> = {
    // Tint: no matching call to 'mix(vec3<f32>, vec3<f32>, i32)'
    'mix(vec3, vec3, i32)': [
      'export function f(a: vec3, b: vec3, t: i32): vec3 {\n  return mix(a, b, t)\n}',
      [factor('i32')],
    ],
    // Tint: no matching call to 'mix(vec3<f32>, vec3<f32>, u32)'
    'mix(vec3, vec3, u32)': [
      'export function f(a: vec3, b: vec3, t: u32): vec3 {\n  return mix(a, b, t)\n}',
      [factor('u32')],
    ],
    // An `f64` blend factor has no overload on either target — the pass would have to narrow
    // it, which loses the half of the double f32 cannot hold. Tint: no matching call to
    // 'mix(vec3<f32>, vec3<f32>, vec2<f32>)' on the lowered pair (#151).
    'mix(vec3, vec3, f64)': [
      'export function f(a: vec3, b: vec3, t: f64): vec3 {\n  return mix(a, b, t)\n}',
      [factor('f64')],
    ],
    // A blend factor whose vector brand the arithmetic already erased: `c * 2.` types as
    // `number`, so it matches `mix(vec3, vec3, number)` outright and the TS2769 rule in
    // `diagnostics.ts` is never consulted; the front end still knows the shape. Tint: no
    // matching call to 'mix(vec3<f32>, vec3<f32>, vec2<f32>)'.
    'mix(vec3, vec3, vec2 * f32)': [
      'export function f(a: vec3, b: vec3, c: vec2): vec3 {\n  return mix(a, b, c * 2.)\n}',
      [factor('vec2<f32>')],
    ],
  }
  for (const [name, [body, expected]] of Object.entries(reported)) {
    it(`${name}: TS8036 on the factor`, () => {
      expect(diagnosticsOf(body)).toEqual(expected)
    })
  }
})

// The `f64` vectors are the second family `mix` declares a vector-with-scalar overload for.
// `Numeric` does not include them at all, so before the overload existed the editor reported the
// shape TWICE (a TS2741 naming `vec2`, plus the TS2769) on a program the fp64 pass lowers into a
// `df64_vN_mix` call. The emitter's own rule is the same one: every other vec64 form fails with
// "mix() on vec64 needs a scalar f32 interpolant".
describe('mix on f64 vectors: declared, and it emits', () => {
  for (const [type, ctor] of [
    ['vec2f64', 'df64_v2_mix'],
    ['vec3f64', 'df64_v3_mix'],
    ['vec4f64', 'df64_v4_mix'],
  ]) {
    it(`mix(${type}, ${type}, f32) is clean and emits ${ctor}`, () => {
      const service = createTypeshadeLanguageService()
      service.openDocument(
        'a.ts',
        '"use typeshade"\n' +
          `export function blend(a: ${type}, b: ${type}, t: f32): ${type} {\n` +
          '  return mix(a, b, t)\n' +
          '}\n',
      )
      expect(
        service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
      ).toEqual([])
      const output = service.getCompiledOutput('a.ts', 'wgsl')
      expect(output?.diagnostics).toEqual([])
      expect(output?.text ?? '').toContain(ctor)
    })
  }
})

describe('WGSL_BUILTIN_NAMES stays in sync with core/sot.ts#WgslBuiltinName', () => {
  it('matches the type alias exactly', () => {
    const text = readFileSync(SOT_FILE, 'utf8')
    const sf = ts.createSourceFile(SOT_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    let names: string[] | undefined
    sf.forEachChild((node) => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'WgslBuiltinName') {
        const type = node.type
        if (ts.isUnionTypeNode(type)) {
          names = type.types.map((member) => {
            if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
              return member.literal.text
            }
            throw new Error('WgslBuiltinName member is not a string literal')
          })
        }
      }
    })
    expect(names, 'WgslBuiltinName type alias not found in core/sot.ts').toBeDefined()
    expect([...WGSL_BUILTIN_NAMES].sort()).toEqual([...names!].sort())
  })
})

describe('ATTRIBUTE_NAMES matches what lower/function.ts and structs.ts actually parse', () => {
  it('every listed name is checked for by the two decorator readers', () => {
    const fn = readFileSync(FUNCTION_FILE, 'utf8')
    const structs = readFileSync(STRUCTS_FILE, 'utf8')
    const builtinCheck = readFileSync(BUILTIN_CHECK_FILE, 'utf8')
    const combined = fn + structs + builtinCheck
    for (const name of ATTRIBUTE_NAMES) {
      expect(combined, `${name} should be a literal this pipeline checks for`).toContain(
        `'${name}'`,
      )
    }
  })

  it('does not list a name the compiler does not implement (interpolate/align/size/ignore)', () => {
    const fn = readFileSync(FUNCTION_FILE, 'utf8')
    const structs = readFileSync(STRUCTS_FILE, 'utf8')
    // structs.ts only ever *rejects* @align ("on a field is not applied") — it never reads one
    // as a real decorator the way builtinDecoratorArg/numberDecorator read builtin/location.
    for (const name of ['interpolate', 'align', 'size', 'ignore']) {
      expect(ATTRIBUTE_NAMES, `${name} is not implemented by the compiler`).not.toContain(name)
    }
    expect(fn + structs).not.toContain("'interpolate'")
  })
})
