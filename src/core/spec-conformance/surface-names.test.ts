// ═══ Every author-facing name has a source: WGSL, ECMAScript, or a listed TypeShade row ═══
//
// WHAT THIS IS FOR. The `"use typeshade"` surface is WGSL builtins, WGSL types and ordinary
// TypeScript — nothing else. A TypeShade-internal helper must not become a spelling an author
// can write: either the compiler does the work silently, or the program is refused with one
// sentence naming an ordinary remedy. The rule was written after `f64FromParts` and `f64Parts`,
// the f64 lane's internal bridge between an `f64` and its two `f32` halves, were declared in the
// ambient library as author-facing functions. Nothing failed: no test in the tree asked where a
// name came from, so a name from nowhere was indistinguishable from a name from WGSL.
//
// This test asks that question of every name. `SHADE_DTS` is the whole authorable vocabulary —
// the language service loads it as the program's only library file and `scripts/emit-shade-dts.ts`
// writes the same string to `dist/shade.d.ts` for `tsc` users — so a name an author can write is
// a name declared in it, and a name declared in it has to come from one of three sources:
//
//   1. WGSL, as the specification spells it: a built-in function, a predeclared type or
//      type-generator, one of the predeclared `vecNf`/`matCxRf` aliases, an attribute (which is
//      what a decorator like `@fragment` or `@location` is), or a built-in value. The names come
//      from `fixtures/wgsl-names.json`, baked from gpuweb/gpuweb by `scripts/bake-wgsl-names.ts`.
//   2. ECMAScript, as TypeScript spells it: a `Math` member, a `console` method, or one of the
//      standard-library declarations the ambient file restates because the program is compiled
//      with `lib: []` (`Array`, `Pick`, `Object`, …) and would otherwise have none.
//   3. TypeShade itself — `TYPESHADE_EXTENSIONS` below, one row per name with the reason it
//      exists. This list is SHRINK-ONLY. A name may leave it (because WGSL grew the builtin, or
//      because the spelling was withdrawn); a name joins it only with a rationale in
//      `docs/language-design.md` §9 (what may become an author-facing name) and §13 (the f64
//      family, the one place TypeShade adds a type WGSL does not have) and a CHANGELOG entry.
//      A row is a decision that was reviewed, not a place to put a name that failed the check.
//
// WHY THE COMPILER API AND NOT A REGEX. `SHADE_DTS` is generated: the vector types come out of
// `SUPPORTED_TYPE_NAMES`, the call signatures out of the intrinsic tables, the Math aliases out
// of `math-alias.ts`, and an overloaded builtin is emitted as several `declare function` lines
// with the same name. A pattern over the text would have to model overloads, the multi-line JSDoc
// blocks between declarations, and any namespace a future generator emits. The TypeScript parser
// already does, and it is the same reader `api-surface.test.ts` and `publish-manifest.test.ts`
// use on this package's other generated artifacts.
//
// WHAT IT DOES NOT DO. It says nothing about SIGNATURES: that a name is WGSL's does not mean
// TypeShade gives it WGSL's arguments (`atan` takes two here, `select` takes WGSL's argument
// order). Those are the intrinsic tables' business, and `intrinsic-coverage.test.ts` is where
// they are held. This test is about the vocabulary alone.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { SHADE_DTS } from '../../language-service/ambient.js'
import { isCanonicalMathFn, resolveMathFn } from '../../compiler/ts/math-alias.js'
import { PRE_EMIT_INTRINSICS, isKnownIntrinsic } from '../intrinsics.js'

// ── The WGSL vocabulary, as baked ──

interface NameList {
  section: string
  count: number
  names: string[]
}
interface WgslNames {
  specRepository: string
  specCommit: string
  generator: string
  builtinFunctions: NameList
  predeclaredTypes: NameList
  typeGenerators: NameList
  builtinValues: { section: string; count: number; values: { name: string }[] }
  attributes: NameList
  keywords: NameList
  reservedWords: NameList & { source: string }
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wgsl-names.json')
const DESIGN_DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'language-design.md',
)
const wgsl = JSON.parse(readFileSync(FIXTURE, 'utf8')) as WgslNames

/** The predeclared aliases (`vec2f`, `vec4i`, `mat4x4f`, …). The specification writes them out in
 *  two tables, one under Vector Types and one under Matrix Types, that the fixture does not carry
 *  as a list of its own; both tables are the same rule — a predeclared vector or matrix
 *  type-generator, suffixed by a letter naming a predeclared scalar type — so the set is expanded
 *  from the two lists the fixture DOES carry rather than retyped. `aliases are exactly these`
 *  below pins the expansion against the spec's tables, including what is NOT in them: there is no
 *  `vec2b`, because WGSL has no predeclared alias for a vector of bool. */
const ALIAS_SUFFIX: Record<string, string> = { f: 'f32', h: 'f16', i: 'i32', u: 'u32' }
const wgslAliases = new Set<string>()
for (const generator of wgsl.typeGenerators.names) {
  const vector = /^vec[234]$/.test(generator)
  if (!vector && !/^mat[234]x[234]$/.test(generator)) continue
  for (const [suffix, scalar] of Object.entries(ALIAS_SUFFIX)) {
    // A matrix element is floating-point; there is no `mat2x2i`.
    if (!vector && (suffix === 'i' || suffix === 'u')) continue
    if (!wgsl.predeclaredTypes.names.includes(scalar)) continue
    wgslAliases.add(generator + suffix)
  }
}

const wgslFunctions = new Set(wgsl.builtinFunctions.names)
const wgslTypes = new Set([...wgsl.predeclaredTypes.names, ...wgsl.typeGenerators.names])
const wgslAttributes = new Set(wgsl.attributes.names)
const wgslBuiltinValues = new Set(wgsl.builtinValues.values.map((v) => v.name))

/** Which WGSL list a name is in, or undefined. The order is the order a reader would check. */
function wgslSource(name: string): string | undefined {
  if (wgslFunctions.has(name)) return 'a WGSL built-in function'
  if (wgslTypes.has(name)) return 'a WGSL predeclared type or type-generator'
  if (wgslAliases.has(name)) return 'a WGSL predeclared alias'
  if (wgslAttributes.has(name)) return 'a WGSL attribute'
  if (wgslBuiltinValues.has(name)) return 'a WGSL built-in value'
  return undefined
}

// ── The ECMAScript vocabulary, read from the running engine rather than retyped ──

const MATH_MEMBERS = new Set(Object.getOwnPropertyNames(Math))
const CONSOLE_MEMBERS = new Set(Object.getOwnPropertyNames(console))

/** The standard-library declarations the ambient file restates because the service compiles the
 *  program with `lib: []` (design doc §6: no DOM globals in a shader program). Each is spelled
 *  exactly as TypeScript's own lib spells it, which is what makes it an ECMAScript name here and
 *  not a TypeShade invention — `MathObject`, the shape behind the `Math` stand-in, is spelled
 *  `Math` by `lib.es5.d.ts` and is therefore a TypeShade row instead. */
const ECMASCRIPT_LIB_STANDINS = new Set([
  'Array',
  'Boolean',
  'CallableFunction',
  'Console',
  'Function',
  'IArguments',
  'Math',
  'NewableFunction',
  'Number',
  'Object',
  'Pick',
  'RegExp',
  'String',
  'console',
])

function ecmascriptSource(name: string): string | undefined {
  if (ECMASCRIPT_LIB_STANDINS.has(name)) return 'a TypeScript standard-library declaration'
  if (MATH_MEMBERS.has(name)) return 'a member of ECMAScript `Math`'
  if (CONSOLE_MEMBERS.has(name)) return 'a method of ECMAScript `console`'
  return undefined
}

// ── The third source: what TypeShade adds, and why ──

/**
 * SHRINK-ONLY. Every row is a name WGSL does not have and TypeScript does not have, kept because
 * the language needs it and the reason is written down. To ADD a row: state the rationale in
 * `docs/language-design.md` §9 (the rules an author-facing name has to meet) and, for anything in
 * the f64 family, §13, add a CHANGELOG entry, and only then write the row. An internal helper is
 * never a row — that is the case this test exists for.
 */
const TYPESHADE_EXTENSIONS: readonly { name: string; reason: string }[] = [
  // The f64 family (docs/language-design.md §13). WGSL has one floating-point type an author can
  // rely on; TypeShade carries a second, emitted as a pair of f32 and checked against a CPU oracle.
  { name: 'f64', reason: 'the double-precision scalar WGSL has no type for' },
  { name: 'f64Tag', reason: 'the brand that keeps an `f64` from assigning to an `f32`' },
  { name: 'vec2f64', reason: 'the two-component vector of `f64`' },
  { name: 'vec3f64', reason: 'the three-component vector of `f64`' },
  { name: 'vec4f64', reason: 'the four-component vector of `f64`' },
  { name: 'vec2d', reason: 'the short spelling of `vec2f64`, a type name and never a call' },
  { name: 'vec3d', reason: 'the short spelling of `vec3f64`, a type name and never a call' },
  { name: 'vec4d', reason: 'the short spelling of `vec4f64`, a type name and never a call' },
  { name: 'Vec64', reason: 'the brand shape the three `f64` vector types share' },
  { name: 'vec64Tag', reason: 'the brand symbol of `Vec64`' },

  // Bindings and module variables. WGSL declares these with `var<uniform>`, `var<storage>`,
  // `var<workgroup>`, `var<private>` and `override`, which TypeScript has no syntax to borrow.
  { name: 'uniform', reason: "declares a binding in WGSL's uniform address space" },
  { name: 'storage', reason: "declares a binding in WGSL's storage address space" },
  { name: 'workgroup', reason: "declares a module variable in WGSL's workgroup address space" },
  { name: 'perInvocation', reason: 'declares a per-invocation module variable; WGSL says private' },
  { name: 'override', reason: 'declares a pipeline-overridable constant, WGSL `override`' },

  // Vectors of bool. WGSL writes `vec2<bool>` and predeclares no alias for it, but every
  // comparison over vectors produces one, so the surface needs a spelling.
  { name: 'vec2b', reason: 'the two-component vector of bool, which WGSL has no alias for' },
  { name: 'vec3b', reason: 'the three-component vector of bool, which WGSL has no alias for' },
  { name: 'vec4b', reason: 'the four-component vector of bool, which WGSL has no alias for' },
  { name: 'BoolVec', reason: 'the union of the three, taken by `any`, `all` and `select`' },

  // Square matrices. WGSL predeclares `mat2x2f` but nothing shorter.
  { name: 'mat2', reason: 'the short spelling of a 2x2 matrix' },
  { name: 'mat3', reason: 'the short spelling of a 3x3 matrix' },
  { name: 'mat4', reason: 'the short spelling of a 4x4 matrix' },

  // Operations with no WGSL builtin of the same name.
  { name: 'mod', reason: 'floor-modulo; WGSL has only the truncating `%` and no name for it' },
  { name: 'fill', reason: 'builds an `array<T, N>` from one value; WGSL takes N arguments' },
  { name: 'discard', reason: 'WGSL `discard` is a statement, and TypeScript has none to borrow' },

  // Storage-texture vocabulary. WGSL writes these as predeclared enumerants inside
  // `texture_storage_2d<...>`; TypeShade passes the same strings, so the TYPE names are its own.
  { name: 'StorageFormat', reason: 'the texel formats a storage-texture binding may carry' },
  { name: 'ReadWriteStorageFormat', reason: 'the subset a device both loads and stores' },
  { name: 'StorageTexel', reason: 'the vector type a format reads and writes' },
  { name: 'StorageAccess', reason: "a storage texture's access mode: read, write, read_write" },

  // The type-level machinery the branded types are built from. None is a shader value; each is
  // named because TypeScript needs a name to refer to it by.
  { name: 'Numeric', reason: 'the scalar-and-vector union the arithmetic overloads use' },
  { name: 'VecOf', reason: 'the vector shape, which gives a vector its `.x` and `.rgb` members' },
  { name: 'ScalarOf', reason: "a vector's element type, per its element kind" },
  { name: 'ComponentKeys', reason: 'which component members exist at each arity' },
  { name: 'Mat', reason: 'the matrix brand shape' },
  { name: 'MathObject', reason: 'the shape of the `Math` stand-in; lib.es5.d.ts calls it `Math`' },
  { name: 'AnyClass', reason: 'the constructor shape a mixin extends (surface document §29)' },

  // Brand symbols. Each keeps one type from assigning to another; an author never writes one,
  // but each is a declared name and so is listed here rather than exempted by a pattern.
  { name: 'f32Tag', reason: 'the brand symbol of `f32`' },
  { name: 'i32Tag', reason: 'the brand symbol of `i32`' },
  { name: 'u32Tag', reason: 'the brand symbol of `u32`' },
  { name: 'vecTag', reason: 'the brand symbol of the vector types' },
  { name: 'matTag', reason: 'the brand symbol of the matrix types' },
  { name: 'arrayTag', reason: 'the brand symbol of `array`' },
  { name: 'atomicTag', reason: 'the brand symbol of `atomic`' },
  { name: 'textureTag', reason: 'the brand symbol of the sampled texture handles' },
  { name: 'storageTextureTag', reason: 'the brand symbol of the storage texture handles' },
  { name: 'depthTextureTag', reason: 'the brand symbol of the depth texture handles' },
  { name: 'samplerTag', reason: 'the brand symbol of `sampler`' },
  { name: 'samplerComparisonTag', reason: 'the brand symbol of `sampler_comparison`' },

  // Constants.
  { name: 'TAU', reason: '2π, which neither WGSL nor ECMAScript `Math` predeclares' },
]

const extensionRows = new Map(TYPESHADE_EXTENSIONS.map((row) => [row.name, row]))

// ── Reading the names out of the generated library ──

interface Declared {
  name: string
  kind: string
  line: number
}

/** Every name the library declares at the top level, plus the members of any namespace it
 *  declares. Overloads collapse to one entry: it is the NAME that is or is not authorable. */
function declaredNames(dts: string): Declared[] {
  const source = ts.createSourceFile(
    'shade.d.ts',
    dts,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const found = new Map<string, Declared>()
  const record = (name: string, kind: string, node: ts.Node): void => {
    if (found.has(name)) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    found.set(name, { name, kind, line })
  }
  const walk = (parent: ts.Node): void => {
    ts.forEachChild(parent, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) record(node.name.text, 'function', node)
      else if (ts.isInterfaceDeclaration(node)) record(node.name.text, 'interface', node)
      else if (ts.isTypeAliasDeclaration(node)) record(node.name.text, 'type', node)
      else if (ts.isClassDeclaration(node) && node.name) record(node.name.text, 'class', node)
      else if (ts.isEnumDeclaration(node)) record(node.name.text, 'enum', node)
      else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) record(declaration.name.text, 'value', node)
        }
      } else if (ts.isModuleDeclaration(node)) {
        record(node.name.getText(source), 'namespace', node)
        if (node.body && ts.isModuleBlock(node.body)) walk(node.body)
      }
    })
  }
  walk(source)
  return [...found.values()]
}

/** The members of one declared interface, by interface name — how `Math.fround` and
 *  `console.warn` are reached, since neither is a top-level name. */
function interfaceMembers(dts: string, interfaceName: string): string[] {
  const source = ts.createSourceFile(
    'shade.d.ts',
    dts,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const members: string[] = []
  ts.forEachChild(source, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== interfaceName) return
    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) members.push(member.name.text)
    }
  })
  return members
}

/** The sentence a stray name gets. One per name, saying what it is and what to do about it. */
function strayMessage(declared: Declared): string {
  return (
    `${declared.name} (${declared.kind}, shade.d.ts line ${declared.line}) is declared in the ambient ` +
    'library but is not a WGSL name, is not an ECMAScript name, and is not a row of ' +
    'TYPESHADE_EXTENSIONS: remove it from the author-facing surface, or add a row with its reason ' +
    'once docs/language-design.md §9 (and §13 for the f64 family) and the CHANGELOG say why it exists.'
  )
}

function unaccounted(dts: string, rows: ReadonlyMap<string, unknown> = extensionRows): string[] {
  return declaredNames(dts)
    .filter((d) => !wgslSource(d.name) && !ecmascriptSource(d.name) && !rows.has(d.name))
    .map(strayMessage)
}

// ── The compiler-internal names, by the mechanical criterion ──

/** The one pre-emit id that is also a type name. `f64(x)` is the value constructor of the `f64`
 *  type, spelled as WGSL spells `f32(x)`, and its TYPESHADE_EXTENSIONS row is the type's
 *  (docs/language-design.md §2.1, Rule 2.2). Every other id in PRE_EMIT_INTRINSICS is a bridge
 *  between two passes that no author's text spells. */
const PRE_EMIT_TYPE_NAMES: ReadonlySet<string> = new Set(['f64'])

/** Every pre-emit intrinsic id that has reached the author-facing surface, by either route: a
 *  declaration in the library, or a row of the allowlist. The `f64FromParts` case took the first
 *  route; a row would have been the second, and the first sentinel test below does not close it,
 *  since a row is exactly what makes a declared name pass. Rules 2.2 and 9.8. */
function internalLeaks(dts: string, rows: ReadonlyMap<string, unknown>): string[] {
  const declared = new Map(declaredNames(dts).map((d) => [d.name, d]))
  return [...PRE_EMIT_INTRINSICS]
    .filter((id) => !PRE_EMIT_TYPE_NAMES.has(id))
    .flatMap((id) => {
      const out: string[] = []
      const d = declared.get(id)
      if (d) {
        out.push(
          `${id} (${d.kind}, shade.d.ts line ${d.line}) is a pre-emit intrinsic id, one a pass rewrites ` +
            'away before any backend runs, and is declared in the ambient library: no author spelling of ' +
            'it exists, so remove the declaration (docs/language-design.md Rule 2.2).',
        )
      }
      if (rows.has(id)) {
        out.push(
          `${id} is a pre-emit intrinsic id and has a TYPESHADE_EXTENSIONS row: a row records a reviewed ` +
            'extension and never an internal helper, so delete the row (docs/language-design.md Rule 9.8).',
        )
      }
      return out
    })
}

/** The rows of the extension table in docs/language-design.md §9.6, in document order. The
 *  table sits between Rule 9.6 and the sentence that opens the family list, and every row of it
 *  is `| family | \`name\` | reason |`; no other table in the document is read. */
function documentedExtensions(markdown: string): { name: string; reason: string }[] {
  const start = markdown.indexOf('**Rule 9.6.**')
  const stop = markdown.indexOf('Seven families', start)
  if (start < 0 || stop < 0) throw new Error('docs/language-design.md has no §9.6 extension table')
  const rows: { name: string; reason: string }[] = []
  for (const line of markdown.slice(start, stop).split('\n')) {
    const m = /^\| [^|]+ \| `([^`]+)`\s+\| (.*?)\s+\|$/.exec(line)
    if (m) rows.push({ name: m[1]!, reason: m[2]! })
  }
  return rows
}

describe('the author-facing surface has three sources and no fourth', () => {
  it('every name the ambient library declares is WGSL, ECMAScript, or a listed TypeShade row', () => {
    expect(unaccounted(SHADE_DTS)).toEqual([])
  })

  it('reports an internal helper by name when one reaches the surface', () => {
    // The `f64FromParts` case itself, run against a copy of the library rather than the library,
    // so the check that would have caught it is pinned instead of remembered.
    const withHelper = `${SHADE_DTS}\ndeclare function f64FromParts(hi: f32, lo: f32): f64\n`
    const reported = unaccounted(withHelper)
    expect(reported).toHaveLength(1)
    expect(reported[0]).toContain('f64FromParts (function')
    expect(reported[0]).toContain('is not a WGSL name')
    expect(reported[0]).toContain('is not an ECMAScript name')
    expect(reported[0]).toContain('is not a row of TYPESHADE_EXTENSIONS')
  })

  it('the Math and console stand-ins declare only members the real ones have', () => {
    const strays = [
      ...interfaceMembers(SHADE_DTS, 'MathObject')
        .filter((name) => !MATH_MEMBERS.has(name))
        .map(
          (name) =>
            `Math.${name} is declared in the ambient library but is not a member of ECMAScript Math`,
        ),
      ...interfaceMembers(SHADE_DTS, 'Console')
        .filter((name) => !CONSOLE_MEMBERS.has(name))
        .map(
          (name) =>
            `console.${name} is declared in the ambient library but is not a method of ECMAScript console`,
        ),
    ]
    expect(strays).toEqual([])
  })
})

describe('the TypeShade allowlist shrinks', () => {
  it('every row names something the ambient library still declares', () => {
    const declared = new Set(declaredNames(SHADE_DTS).map((d) => d.name))
    const dead = TYPESHADE_EXTENSIONS.filter((row) => !declared.has(row.name)).map(
      (row) =>
        `${row.name} is a TYPESHADE_EXTENSIONS row but is no longer declared: delete the row.`,
    )
    expect(dead).toEqual([])
  })

  it('no row keeps a name WGSL or ECMAScript now covers', () => {
    const redundant = TYPESHADE_EXTENSIONS.flatMap((row) => {
      const source = wgslSource(row.name) ?? ecmascriptSource(row.name)
      return source
        ? [`${row.name} is ${source}, so its TYPESHADE_EXTENSIONS row is stale: delete the row.`]
        : []
    })
    expect(redundant).toEqual([])
  })

  it('every row is named once and carries a reason', () => {
    expect(extensionRows.size).toBe(TYPESHADE_EXTENSIONS.length)
    const silent = TYPESHADE_EXTENSIONS.filter((row) => row.reason.trim().length === 0).map(
      (row) => `${row.name} has an empty reason: say in one line why the language needs the name.`,
    )
    expect(silent).toEqual([])
  })
})

describe('a compiler-internal name is never authorable', () => {
  it('no pre-emit intrinsic id is declared or listed', () => {
    expect(internalLeaks(SHADE_DTS, extensionRows)).toEqual([])
  })

  it('the exception is exactly the pre-emit id that names a type, and that id has its row', () => {
    for (const id of PRE_EMIT_TYPE_NAMES) {
      expect(PRE_EMIT_INTRINSICS.has(id)).toBe(true)
      expect(extensionRows.has(id)).toBe(true)
    }
  })

  it('the front end resolves no pre-emit id as a builtin', () => {
    // The call route, beside the declaration and row routes above. `resolveMathFn` is how a
    // spelled name becomes an intrinsic id, and it requires `isKnownIntrinsic`, which excludes
    // every pre-emit id: so `f64Parts(x)` in a shader is `TS8004 Unknown function`, and an alias
    // table entry that maps a new spelling to a pre-emit id resolves to nothing. `f64(x)` is not
    // an exception here — the constructor is lowered as a scalar cast, not as a builtin call.
    // What this does NOT close: a bespoke lowering that builds the pre-emit call by hand under a
    // new spelling. That is a name for an internal representation whatever its id, and review
    // applies docs/language-design.md §2.1 to it (Rule 9.8).
    for (const id of PRE_EMIT_INTRINSICS) {
      expect(isKnownIntrinsic(id), `${id} must not be a spellable intrinsic`).toBe(false)
      expect(isCanonicalMathFn(id), `${id} must not be a canonical builtin name`).toBe(false)
      expect(resolveMathFn(id), `${id} must not resolve through the Math alias table`).toBe(
        undefined,
      )
    }
  })

  it('reports the row route as well as the declaration route', () => {
    // The `f64Parts` case by the route the first sentinel leaves open: the helper is declared AND
    // given a row, so the three-source check is satisfied. Run against copies, as the sentinel is.
    const withHelper = `${SHADE_DTS}\ndeclare function f64Parts(x: f64): vec2f\n`
    const withRow = new Map(extensionRows)
    withRow.set('f64Parts', {
      name: 'f64Parts',
      reason: 'an author spelling of the f64 lane bridge',
    })
    expect(unaccounted(withHelper, withRow)).toEqual([])
    const reported = internalLeaks(withHelper, withRow)
    expect(reported).toHaveLength(2)
    expect(reported[0]).toContain('f64Parts (function')
    expect(reported[0]).toContain('remove the declaration')
    expect(reported[1]).toContain('has a TYPESHADE_EXTENSIONS row')
    expect(reported[1]).toContain('delete the row')
  })
})

describe('the extension table of docs/language-design.md', () => {
  it('is TYPESHADE_EXTENSIONS, row for row', () => {
    // Rule 9.7: a row is added to the table and to the allowlist with the same reason. The name,
    // the order and the reason text are compared, so the document cannot drift from the test.
    const documented = documentedExtensions(readFileSync(DESIGN_DOC, 'utf8'))
    expect(documented).toEqual(TYPESHADE_EXTENSIONS.map(({ name, reason }) => ({ name, reason })))
  })
})

describe('the WGSL fixture is a real bake', () => {
  it('names the specification commit it was read from', () => {
    expect(wgsl.specRepository).toBe('https://github.com/gpuweb/gpuweb')
    expect(wgsl.specCommit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('carries the whole predeclared vocabulary, so a broken bake cannot pass this suite', () => {
    // At the baked commit the specification has 169 built-in functions and 220 distinct
    // predeclared names once the two alias tables are expanded. The floors are below those and
    // far above anything a truncated parse would produce: the failure this guards against is a
    // bake that writes a fixture holding a handful of names, which would make every check above
    // vacuous — an empty WGSL list accuses TypeShade of having invented `textureSample`.
    expect(wgsl.builtinFunctions.names.length).toBeGreaterThanOrEqual(150)
    const predeclared = new Set([
      ...wgsl.builtinFunctions.names,
      ...wgsl.predeclaredTypes.names,
      ...wgsl.typeGenerators.names,
      ...wgslAliases,
    ])
    expect(predeclared.size).toBeGreaterThanOrEqual(200)
    expect(wgsl.builtinFunctions.names.length).toBe(wgsl.builtinFunctions.count)
    for (const sentinel of ['textureSample', 'workgroupUniformLoad', 'quantizeToF16', 'bitcast']) {
      expect(wgslFunctions.has(sentinel)).toBe(true)
    }
  })

  it('the predeclared aliases are the ones the specification tabulates, and no others', () => {
    for (const alias of ['vec2f', 'vec3i', 'vec4u', 'vec2h', 'mat4x4f', 'mat2x3h']) {
      expect(wgslAliases.has(alias)).toBe(true)
    }
    // Not in either table: bool vectors, TypeShade's `d`/`f64` spellings, integer matrices, and
    // the bare square-matrix names. Each of these is a TYPESHADE_EXTENSIONS row instead.
    for (const absent of ['vec2b', 'vec2d', 'vec2f64', 'mat2x2i', 'mat4']) {
      expect(wgslAliases.has(absent)).toBe(false)
    }
  })
})
