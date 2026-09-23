// ═══ Every author-facing name has a source: WGSL, ECMAScript, or a listed TypeShade row ═══
//
// WHAT THIS IS FOR. The `"use typeshade"` surface is WGSL builtins, WGSL types and ordinary
// TypeScript, nothing else. A TypeShade-internal helper must not become a spelling an author
// can write: either the compiler does the work silently, or the program is refused with one
// sentence naming an ordinary remedy. The rule was written after `f64FromParts` and `f64Parts`,
// the internal bridge between an `f64` and its two `f32` halves, were declared in the
// ambient library as author-facing functions. Nothing failed: no test in the tree asked where a
// name came from, so a name from nowhere was indistinguishable from a name from WGSL.
//
// This test asks that question of every name. `SHADE_DTS` is the whole authorable vocabulary:
// the language service loads it as the program's only library file, and `scripts/emit-shade-dts.ts`
// writes the same string to `dist/shade.d.ts` for `tsc` users. So a name an author can write is
// a name declared in it, and a name declared in it has to come from one of three sources:
//
//   1. WGSL, as the specification spells it: a built-in function, a predeclared type or
//      type-generator, one of the predeclared `vecNf`/`matCxRf` aliases, an attribute (which is
//      what a decorator like `@fragment` or `@location` is), or a built-in value. The names come
//      from `fixtures/wgsl-names.json`, baked from gpuweb/gpuweb by `scripts/bake-wgsl-names.ts`.
//   2. ECMAScript, as TypeScript spells it: a `Math` member, a `console` method, or one of the
//      standard-library declarations the ambient file restates because the program is compiled
//      with `lib: []` (`Array`, `Pick`, `Object`, …) and would otherwise have none. A member
//      counts AT ITS SITE: `Math.fround` is ECMAScript's because the `Math` stand-in declares
//      it, and a FREE `declare function fround(…)` beside it is a different name under Rule
//      2.1(b), which is source 3's business. Classifying by the bare name instead is what let
//      `random` onto this surface with no row and no documentation (#181).
//   3. TypeShade itself: `TYPESHADE_EXTENSIONS` below, one row per name with the reason it
//      exists. This list is SHRINK-ONLY. A name may leave it (because WGSL grew the builtin, or
//      because the spelling was withdrawn); a name joins it only with a rationale in
//      `docs/language-design.md` §9 (what may become an author-facing name) and Rule 4.4 (the
//      f64 family, the one place TypeShade adds a type WGSL does not have) and a CHANGELOG entry.
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
// WHAT IT DOES NOT DO. It says nothing about the SIGNATURES of a WGSL name: that a name is
// WGSL's does not mean TypeShade gives it WGSL's arguments (`atan` takes two here, `select`
// takes WGSL's argument order). Those are the intrinsic tables' business, and
// `intrinsic-coverage.test.ts` is where they are held. The one family whose signatures ARE
// read here is the f64 family, because it has no WGSL signature to defer to and a second
// signature of `f64` is the bridge again under the allowed id: `f64(hi: f32, lo: f32)` is not a
// stray (the classifier reads names) and not a leak (`f64` has its row), so the last describe
// below pins each of its constructors to the forms WGSL gives the type it stands in for
// (docs/language-design.md Rule 9.2, Rule 2.2).
//
// Verifies: Rule 2.4, Rule 3.6, Rule 4.1, Rule 6.7, Rule 12.7, Rule 13.6, Rule 13.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SHADE_DTS } from '../../language-service/ambient.js';
import { compile } from '../../compiler/ts/compile.js';
import { isCanonicalMathFn, resolveMathFn } from '../../compiler/ts/math-alias.js';
import { PRE_EMIT_INTRINSICS, isKnownIntrinsic } from '../intrinsics.js';

// ── The WGSL vocabulary, as baked ──

interface NameList {
  section: string;
  count: number;
  names: string[];
}
interface WgslNames {
  specRepository: string;
  specCommit: string;
  generator: string;
  builtinFunctions: NameList;
  predeclaredTypes: NameList;
  typeGenerators: NameList;
  builtinValues: { section: string; count: number; values: { name: string }[] };
  attributes: NameList;
  keywords: NameList;
  reservedWords: NameList & { source: string };
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wgsl-names.json');
const DESIGN_DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'language-design.md',
);
const wgsl = JSON.parse(readFileSync(FIXTURE, 'utf8')) as WgslNames;

/** The predeclared aliases (`vec2f`, `vec4i`, `mat4x4f`, …). The specification writes them out in
 *  two tables, one under Vector Types and one under Matrix Types, that the fixture does not carry
 *  as a list of its own; both tables are the same rule, a predeclared vector or matrix
 *  type-generator suffixed by a letter naming a predeclared scalar type, so the set is expanded
 *  from the two lists the fixture DOES carry rather than retyped. `aliases are exactly these`
 *  below pins the expansion against the spec's tables, including what is NOT in them: there is no
 *  `vec2b`, because WGSL has no predeclared alias for a vector of bool. */
const ALIAS_SUFFIX: Record<string, string> = { f: 'f32', h: 'f16', i: 'i32', u: 'u32' };
const wgslAliases = new Set<string>();
for (const generator of wgsl.typeGenerators.names) {
  const vector = /^vec[234]$/.test(generator);
  if (!vector && !/^mat[234]x[234]$/.test(generator)) continue;
  for (const [suffix, scalar] of Object.entries(ALIAS_SUFFIX)) {
    // A matrix element is floating-point; there is no `mat2x2i`.
    if (!vector && (suffix === 'i' || suffix === 'u')) continue;
    if (!wgsl.predeclaredTypes.names.includes(scalar)) continue;
    wgslAliases.add(generator + suffix);
  }
}

const wgslFunctions = new Set(wgsl.builtinFunctions.names);
const wgslTypes = new Set([...wgsl.predeclaredTypes.names, ...wgsl.typeGenerators.names]);
const wgslAttributes = new Set(wgsl.attributes.names);
const wgslBuiltinValues = new Set(wgsl.builtinValues.values.map((v) => v.name));

/** Which WGSL list a name is in, or undefined. The order is the order a reader would check. */
function wgslSource(name: string): string | undefined {
  if (wgslFunctions.has(name)) return 'a WGSL built-in function';
  if (wgslTypes.has(name)) return 'a WGSL predeclared type or type-generator';
  if (wgslAliases.has(name)) return 'a WGSL predeclared alias';
  if (wgslAttributes.has(name)) return 'a WGSL attribute';
  if (wgslBuiltinValues.has(name)) return 'a WGSL built-in value';
  return undefined;
}

// ── The ECMAScript vocabulary, read from the running engine rather than retyped ──

const MATH_MEMBERS = new Set(Object.getOwnPropertyNames(Math));
const CONSOLE_MEMBERS = new Set(Object.getOwnPropertyNames(console));

/** The standard-library declarations the ambient file restates because the service compiles the
 *  program with `lib: []` (docs/language-design.md Rule 2.1(b)). Each is spelled exactly as
 *  TypeScript's own lib spells it, which is what makes it an ECMAScript name here and not a
 *  TypeShade invention. `MathObject`, the shape behind the `Math` stand-in, is spelled
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
  // lib.es2015.iterable.d.ts and lib.es2015.symbol.d.ts: what `[Symbol.iterator]` resolves
  // through, so `for (const x of xs)` type-checks (Rule 7.5). The compiler refuses `Symbol` as a
  // value (it is a host API), so an author still cannot write it.
  'Symbol',
  'SymbolConstructor',
  'console',
]);

/** The two sites that are not a top-level declaration: a member read out of one of the two
 *  stand-in interfaces. `interfaceMembers` names the site, since a member has no declaration
 *  kind of its own to record. */
const MATH_MEMBER = 'member of `Math`';
const CONSOLE_METHOD = 'method of `console`';

/** The declaration kinds `declaredNames()` records. Every one of them is a TOP-LEVEL
 *  declaration — a FREE name — which is the whole of the rule below: `Math` and `console`
 *  account for their MEMBERS, and a free declaration is not a member (Rule 2.1(b)). */
const FREE_KINDS: ReadonlySet<string> = new Set([
  'function',
  'value',
  'type',
  'interface',
  'class',
  'enum',
  'namespace',
]);

/**
 * Which ECMAScript vocabulary a name belongs to AT THE SITE IT IS DECLARED, or undefined.
 *
 * The site is the point. `declaredNames()` has always recorded a `kind` for every declaration
 * and this classifier used to throw it away, comparing the bare name against the members of the
 * running engine's `Math` and `console` — so the free top-level `declare function random(seed)`
 * was credited to the ECMAScript MEMBER `Math.random`, and a name with no §9.3 row and no
 * documentation anywhere passed the suite (#181). A free function and a member of `Math` are
 * different names under Rule 2.1(b): `Math.random()` is ECMAScript's, and a free `random` beside
 * it is TypeShade's own name whatever it computes, so it must be a WGSL name or carry a row.
 *
 * An unknown kind throws rather than defaulting, so a kind a future `declaredNames()` records
 * has to be classified here deliberately instead of falling into the free case by accident.
 */
function ecmascriptSource(name: string, kind: string): string | undefined {
  if (FREE_KINDS.has(kind)) {
    return ECMASCRIPT_LIB_STANDINS.has(name)
      ? 'a TypeScript standard-library declaration'
      : undefined;
  }
  if (kind === MATH_MEMBER)
    return MATH_MEMBERS.has(name) ? 'a member of ECMAScript `Math`' : undefined;
  if (kind === CONSOLE_METHOD)
    return CONSOLE_MEMBERS.has(name) ? 'a method of ECMAScript `console`' : undefined;
  throw new Error(`surface-names: no site is defined for the declaration kind "${kind}"`);
}

// ── The third source: what TypeShade adds, and why ──

/**
 * SHRINK-ONLY. Every row is a name WGSL does not have and TypeScript does not have, kept because
 * the language needs it and the reason is written down. To ADD a row: state the rationale in
 * `docs/language-design.md` §9 (the rules an author-facing name has to meet) and, for anything in
 * the f64 family, Rule 4.4, add a CHANGELOG entry, and only then write the row. An internal
 * helper is never a row: that is the case this test exists for.
 */
// LINT.IfChange(extensions)
const TYPESHADE_EXTENSIONS: readonly { name: string; reason: string }[] = [
  // The f64 family (docs/language-design.md Rule 4.4). WGSL has one floating-point type an
  // author can rely on; TypeShade carries a second, emitted as a pair of f32 and checked against
  // a CPU oracle.
  { name: 'f64', reason: 'the double-precision scalar WGSL has no type for' },
  { name: 'f64Tag', reason: 'the brand that keeps an `f64` from assigning to an `f32`' },
  { name: 'vec2f64', reason: 'the two-component vector of `f64`' },
  { name: 'vec3f64', reason: 'the three-component vector of `f64`' },
  { name: 'vec4f64', reason: 'the four-component vector of `f64`' },
  { name: 'vec2d', reason: 'the short spelling of `vec2f64`, a type name and never a call' },
  { name: 'vec3d', reason: 'the short spelling of `vec3f64`, a type name and never a call' },
  { name: 'vec4d', reason: 'the short spelling of `vec4f64`, a type name and never a call' },
  { name: 'vec64Tag', reason: 'the brand symbol of the three `f64` vector types' },

  // Bindings and module variables. WGSL declares these with `var<uniform>`, `var<storage>`,
  // `var<workgroup>` and `override`, which TypeScript has no syntax to borrow. `var<private>` has
  // no spelling: a top-level `let` is already that variable (#83).
  { name: 'uniform', reason: "declares a binding in WGSL's uniform address space" },
  { name: 'storage', reason: "declares a binding in WGSL's storage address space" },
  { name: 'workgroup', reason: "declares a module variable in WGSL's workgroup address space" },
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
  {
    name: 'mod',
    reason: 'floor-modulo over the truncating `%`; WGSL reserves the token and gives it no meaning',
  },
  { name: 'fill', reason: 'builds an `array<T, N>` from one value; WGSL takes N arguments' },
  { name: 'discard', reason: 'WGSL `discard` is a statement, and TypeScript has none to borrow' },

  // The free spelling of a `Math` member WGSL has no builtin for (Rule 9.4). The MEMBER is an
  // ECMAScript name and needs no row; the free name beside it is TypeShade's own (Rule 2.1(b)),
  // and each is expanded into WGSL arithmetic at the call.
  { name: 'log10', reason: 'the base-10 logarithm, `log(x) * LOG10E`; WGSL has `log` and `log2`' },
  { name: 'log1p', reason: 'the natural logarithm of 1 plus x, `log(x + 1)`' },
  { name: 'expm1', reason: 'e to the x, less one, `exp(x) - 1`' },
  { name: 'cbrt', reason: 'the cube root, `pow(x, 1 / 3)`' },
  { name: 'hypot', reason: 'the length of the vector its 2 or 3 arguments make, `length(v)`' },
  {
    name: 'random',
    reason: 'a hash of its seed, an `f32` in [0, 1); ECMAScript spells a draw `Math.random()`',
  },
  // The array folds WGSL has no builtin for, unrolled at the call (Rule 8.18).
  { name: 'sum', reason: "the sum of an array's elements, unrolled; WGSL has no fold" },
  {
    name: 'none',
    reason: 'whether no element passes a test, unrolled; the negation of the `any` fold',
  },
  {
    name: 'zip',
    reason: 'an array built from two, element by element, by a function the call hands over',
  },

  // Storage-texture vocabulary. WGSL writes these as predeclared enumerants inside
  // `texture_storage_2d<...>`; TypeShade passes the same strings, so the TYPE names are its own.
  { name: 'StorageFormat', reason: 'the texel formats a storage-texture binding may carry' },
  { name: 'ReadWriteStorageFormat', reason: 'the subset a device both loads and stores' },
  { name: 'StorageTexel', reason: 'the vector type a format reads and writes' },
  { name: 'StorageAccess', reason: "a storage texture's access mode: read, write, read_write" },

  // The type-level machinery the branded types are built from. None is a shader value; each is
  // named because TypeScript needs a name to refer to it by.
  { name: 'Numeric', reason: 'the scalar-and-vector union the arithmetic overloads use' },
  { name: 'Mat', reason: 'the matrix brand shape' },
  { name: 'MatColumn', reason: "a matrix column's vector type, per its element" },
  { name: 'LaneKeys', reason: 'which constant indices a vector or a matrix takes at each arity' },
  { name: 'Vec64Any', reason: 'the union of the three `f64` vectors, taken by the reductions' },
  { name: 'MathObject', reason: 'the shape of the `Math` stand-in; lib.es5.d.ts calls it `Math`' },
  { name: 'AnyClass', reason: 'the constructor shape a mixin extends (surface document §29)' },

  // The texture and vector type machinery #147 and #150 needed: each maps one type to another
  // so the editor can give a texture builtin the element type the texture was declared with.
  { name: 'TextureElem', reason: "what a sampled texture's element may be: `f32`, `i32` or `u32`" },
  {
    name: 'Vec4OfElem',
    reason: "the `vec4` a texel fetch or a gather yields, by the texture's element",
  },
  {
    name: 'TexelCoord2',
    reason: 'a 2d texel coordinate, which WGSL takes as either integer vector',
  },
  {
    name: 'TexelCoord3',
    reason: 'a 3d or array texel coordinate, the same union one component wider',
  },
  { name: 'BitcastArg', reason: 'what `bitcast<T>` reads, derived from the type argument' },
  { name: 'VecElemOf', reason: "a vector type's element kind, keyed on `keyof`" },
  { name: 'VecFor2', reason: 'the `vec2` alias of an element type' },
  { name: 'VecFor3', reason: 'the `vec3` alias of an element type' },
  { name: 'VecFor4', reason: 'the `vec4` alias of an element type' },
  {
    name: 'WriteOnlyStorageFormat',
    reason: 'the storage-texture formats a device stores to and never loads from',
  },

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

  // Constants, in the order `LANG_CONST` declares them. Six are the free spelling of a `Math`
  // constant, which is a member and not a free name (Rule 2.1(b)); WGSL predeclares no constant
  // at all, and each of these reaches the text as an inlined `f32` literal.
  { name: 'PI', reason: 'π as a free name; ECMAScript spells it `Math.PI`' },
  { name: 'TAU', reason: '2π, which neither WGSL nor ECMAScript `Math` predeclares' },
  { name: 'E', reason: 'e as a free name; ECMAScript spells it `Math.E`' },
  { name: 'LN2', reason: 'the natural logarithm of 2; ECMAScript spells it `Math.LN2`' },
  { name: 'LN10', reason: 'the natural logarithm of 10; ECMAScript spells it `Math.LN10`' },
  { name: 'LOG2E', reason: 'the base-2 logarithm of e; ECMAScript spells it `Math.LOG2E`' },
  { name: 'LOG10E', reason: 'the base-10 logarithm of e; ECMAScript spells it `Math.LOG10E`' },
];
// LINT.ThenChange(docs/language-design.md:extensions)

const extensionRows = new Map(TYPESHADE_EXTENSIONS.map((row) => [row.name, row]));

// ── Reading the names out of the generated library ──

interface Declared {
  name: string;
  kind: string;
  line: number;
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
  );
  const found = new Map<string, Declared>();
  const record = (name: string, kind: string, node: ts.Node): void => {
    if (found.has(name)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    found.set(name, { name, kind, line });
  };
  const walk = (parent: ts.Node): void => {
    ts.forEachChild(parent, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) record(node.name.text, 'function', node);
      else if (ts.isInterfaceDeclaration(node)) record(node.name.text, 'interface', node);
      else if (ts.isTypeAliasDeclaration(node)) record(node.name.text, 'type', node);
      else if (ts.isClassDeclaration(node) && node.name) record(node.name.text, 'class', node);
      else if (ts.isEnumDeclaration(node)) record(node.name.text, 'enum', node);
      else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) record(declaration.name.text, 'value', node);
        }
      } else if (ts.isModuleDeclaration(node)) {
        record(node.name.getText(source), 'namespace', node);
        if (node.body && ts.isModuleBlock(node.body)) walk(node.body);
      }
    });
  };
  walk(source);
  return [...found.values()];
}

/** The members of one declared interface, by interface name: how `Math.fround` and
 *  `console.warn` are reached, since neither is a top-level name. */
function interfaceMembers(dts: string, interfaceName: string): string[] {
  const source = ts.createSourceFile(
    'shade.d.ts',
    dts,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const members: string[] = [];
  ts.forEachChild(source, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== interfaceName) return;
    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) members.push(member.name.text);
    }
  });
  return members;
}

/** Every `declare function` of one name, as the list of its parameters' type texts: the
 *  overloads of a constructor, one entry per signature. */
function functionSignatures(dts: string, name: string): string[][] {
  const source = ts.createSourceFile(
    'shade.d.ts',
    dts,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const signatures: string[][] = [];
  ts.forEachChild(source, (node) => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== name) return;
    signatures.push(node.parameters.map((p) => (p.type ? p.type.getText(source) : '')));
  });
  return signatures;
}

// ── The f64 family's signatures: WGSL's constructor forms and no other ──

/** The sentence a signature outside the constructor forms gets. */
function signatureMessage(name: string, params: readonly string[], why: string): string {
  return (
    `${name}(${params.join(', ')}) is declared in the ambient library, and ${why}: the f64 family ` +
    'takes the constructor forms WGSL gives the type it stands in for and no other signature ' +
    '(docs/language-design.md Rule 9.2); a bridge between an f64 and its f32 halves is a ' +
    'compiler-internal operation under any spelling, a second signature included (Rule 2.2).'
  );
}

/** Every signature of `f64` and of the three `vecNf64` constructors that is not one of WGSL's
 *  value-constructor forms (wgsl #value-constructor-builtin-function). `f64(x)` is the one-
 *  argument scalar constructor, as `f32(x)` is. A `vecNf64` takes what `vecN<T>(...)` takes: a
 *  splat (one scalar), N scalar components, or a narrower `f64` vector plus scalar components
 *  that add up to N. A scalar component is spelled `number` (the untyped literal or an `f64`,
 *  which the library types as a branded number); nothing of the family takes an `f32` vector,
 *  since the only thing an f32 vector could be to an f64 constructor is a hi or a lo plane. */
function f64FamilySignatureStrays(dts: string): string[] {
  const out: string[] = [];
  for (const params of functionSignatures(dts, 'f64')) {
    if (params.length !== 1) {
      out.push(signatureMessage('f64', params, 'a scalar constructor takes exactly one argument'));
    }
  }
  for (const n of [2, 3, 4] as const) {
    const name = `vec${String(n)}f64`;
    for (const params of functionSignatures(dts, name)) {
      // How many of the N components each parameter supplies, or undefined for a type no
      // constructor form takes (`f32`, `vec2`, `vec2f`, a matrix, …).
      const widths = params.map((type) => {
        if (type === 'number') return 1;
        const m = /^vec([234])f64$/.exec(type);
        return m ? Number(m[1]) : undefined;
      });
      if (widths.some((w) => w === undefined)) {
        out.push(
          signatureMessage(
            name,
            params,
            'a parameter is neither a component nor a narrower f64 vector',
          ),
        );
        continue;
      }
      const total = widths.reduce<number>((sum, w) => sum + (w ?? 0), 0);
      const splat = params.length === 1 && widths[0] === 1;
      if (!splat && total !== n) {
        out.push(
          signatureMessage(
            name,
            params,
            `its parameters supply ${String(total)} components, not ${String(n)}`,
          ),
        );
      }
    }
  }
  return out;
}

/** The sentence a stray name gets. One per name, saying what it is and what to do about it. */
function strayMessage(declared: Declared): string {
  return (
    `${declared.name} (${declared.kind}, shade.d.ts line ${declared.line}) is declared in the ambient ` +
    'library but is not a WGSL name, is not an ECMAScript name, and is not a row of ' +
    'TYPESHADE_EXTENSIONS: remove it from the author-facing surface, or add a row with its reason ' +
    'once docs/language-design.md §9 (and Rule 4.4 for the f64 family) and the CHANGELOG say ' +
    'why it exists.'
  );
}

function unaccounted(dts: string, rows: ReadonlyMap<string, unknown> = extensionRows): string[] {
  return declaredNames(dts)
    .filter((d) => !wgslSource(d.name) && !ecmascriptSource(d.name, d.kind) && !rows.has(d.name))
    .map(strayMessage);
}

// ── The compiler-internal names, by the mechanical criterion ──

/** The one pre-emit id that is also a type name. `f64(x)` is the value constructor of the `f64`
 *  type, spelled as WGSL spells `f32(x)`, and its TYPESHADE_EXTENSIONS row is the type's
 *  (docs/language-design.md §2.1, Rule 2.2). Every other id in PRE_EMIT_INTRINSICS is a bridge
 *  between two passes that no author's text spells. */
const PRE_EMIT_TYPE_NAMES: ReadonlySet<string> = new Set(['f64']);

/** Every pre-emit intrinsic id that has reached the author-facing surface, by either route: a
 *  declaration in the library, or a row of the allowlist. The `f64FromParts` case took the first
 *  route; a row would have been the second, and the first sentinel test below does not close it,
 *  since a row is exactly what makes a declared name pass. Rules 2.2 and 9.8. */
function internalLeaks(dts: string, rows: ReadonlyMap<string, unknown>): string[] {
  const declared = new Map(declaredNames(dts).map((d) => [d.name, d]));
  return [...PRE_EMIT_INTRINSICS]
    .filter((id) => !PRE_EMIT_TYPE_NAMES.has(id))
    .flatMap((id) => {
      const out: string[] = [];
      const d = declared.get(id);
      if (d) {
        out.push(
          `${id} (${d.kind}, shade.d.ts line ${d.line}) is a pre-emit intrinsic id, one a pass rewrites ` +
            'away before any backend runs, and is declared in the ambient library: no author spelling of ' +
            'it exists, so remove the declaration (docs/language-design.md Rule 2.2).',
        );
      }
      if (rows.has(id)) {
        out.push(
          `${id} is a pre-emit intrinsic id and has a TYPESHADE_EXTENSIONS row: a row records a reviewed ` +
            'extension and never an internal helper, so delete the row (docs/language-design.md Rule 9.8).',
        );
      }
      return out;
    });
}

/** The rows of the extension table in docs/language-design.md §9.3, in document order. The
 *  table sits between Rule 9.6 and the sentence that opens the family list, and every row of it
 *  is `| family | \`name\` | reason |`; no other table in the document is read. */
function documentedExtensions(markdown: string): { name: string; reason: string }[] {
  const start = markdown.indexOf('**Rule 9.6.**');
  const stop = markdown.indexOf('Nine families', start);
  if (start < 0 || stop < 0) throw new Error('docs/language-design.md has no §9.3 extension table');
  const rows: { name: string; reason: string }[] = [];
  for (const line of markdown.slice(start, stop).split('\n')) {
    const m = /^\| [^|]+ \| `([^`]+)`\s+\| (.*?)\s+\|$/.exec(line);
    if (m) rows.push({ name: m[1]!, reason: m[2]! });
  }
  return rows;
}

describe('the author-facing surface has three sources and no fourth', () => {
  it('every name the ambient library declares is WGSL, ECMAScript, or a listed TypeShade row', () => {
    expect(unaccounted(SHADE_DTS)).toEqual([]);
  });

  it('reports an internal helper by name when one reaches the surface', () => {
    // The `f64FromParts` case itself, run against a copy of the library rather than the library,
    // so the check that would have caught it is pinned instead of remembered.
    const withHelper = `${SHADE_DTS}\ndeclare function f64FromParts(hi: f32, lo: f32): f64\n`;
    const reported = unaccounted(withHelper);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('f64FromParts (function');
    expect(reported[0]).toContain('is not a WGSL name');
    expect(reported[0]).toContain('is not an ECMAScript name');
    expect(reported[0]).toContain('is not a row of TYPESHADE_EXTENSIONS');
  });

  it('the Math and console stand-ins declare only members the real ones have', () => {
    // The member site of the classifier above, and the only site at which `Math` and `console`
    // account for a name: a free declaration of the same name is judged by `unaccounted`.
    const strays = [
      ...interfaceMembers(SHADE_DTS, 'MathObject')
        .filter((name) => !ecmascriptSource(name, MATH_MEMBER))
        .map(
          (name) =>
            `Math.${name} is declared in the ambient library but is not a member of ECMAScript Math`,
        ),
      ...interfaceMembers(SHADE_DTS, 'Console')
        .filter((name) => !ecmascriptSource(name, CONSOLE_METHOD))
        .map(
          (name) =>
            `console.${name} is declared in the ambient library but is not a method of ECMAScript console`,
        ),
    ];
    expect(strays).toEqual([]);
  });

  it('a free declaration is never credited to the member of the same name', () => {
    // The `random` case, which is what tightened the classifier (#181): a free top-level
    // declaration named after a `Math` member used to be sourced to that member, so a name with
    // no §9.3 row passed. `clz32` stands in for it here, against a copy of the library rather
    // than the library — it is a `Math` member, it is not a WGSL name, and nothing declares it.
    expect(MATH_MEMBERS.has('clz32')).toBe(true);
    expect(wgslSource('clz32')).toBeUndefined();
    const withFree = `${SHADE_DTS}\ndeclare function clz32(x: u32): u32\n`;
    const reported = unaccounted(withFree);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('clz32 (function');
    expect(reported[0]).toContain('is not an ECMAScript name');
    // The same name AS A MEMBER is ECMAScript's, which is the distinction the kind carries.
    expect(ecmascriptSource('clz32', MATH_MEMBER)).toBe('a member of ECMAScript `Math`');
    expect(ecmascriptSource('clz32', 'function')).toBeUndefined();
  });
});

describe('the TypeShade allowlist shrinks', () => {
  it('every row names something the ambient library still declares', () => {
    const declared = new Set(declaredNames(SHADE_DTS).map((d) => d.name));
    const dead = TYPESHADE_EXTENSIONS.filter((row) => !declared.has(row.name)).map(
      (row) =>
        `${row.name} is a TYPESHADE_EXTENSIONS row but is no longer declared: delete the row.`,
    );
    expect(dead).toEqual([]);
  });

  it('no row keeps a name WGSL or ECMAScript now covers', () => {
    // At the site the row's name is declared, which is what decides whether ECMAScript covers
    // it: a row IS a free declaration (the case above pins that each one is still declared), and
    // a free name is not covered by the `Math` or `console` member of the same spelling.
    const declared = new Map(declaredNames(SHADE_DTS).map((d) => [d.name, d.kind]));
    const redundant = TYPESHADE_EXTENSIONS.flatMap((row) => {
      const source =
        wgslSource(row.name) ?? ecmascriptSource(row.name, declared.get(row.name) ?? 'function');
      return source
        ? [`${row.name} is ${source}, so its TYPESHADE_EXTENSIONS row is stale: delete the row.`]
        : [];
    });
    expect(redundant).toEqual([]);
  });

  it('the rows that are WGSL keywords or reserved words are exactly the three §9.3 records', () => {
    // `override` and `discard` are WGSL keywords given the same meaning here, and `mod` is a WGSL
    // reserved word, a token the specification reserves and gives no meaning. The document's §9.3
    // records the three; a new row that collides with either list is recorded there first, which
    // is what turning this case red asks for.
    const keywords = new Set(wgsl.keywords.names);
    const reserved = new Set(wgsl.reservedWords.names);
    const colliding = TYPESHADE_EXTENSIONS.filter(
      (row) => keywords.has(row.name) || reserved.has(row.name),
    ).map((row) => `${row.name} (${keywords.has(row.name) ? 'keyword' : 'reserved word'})`);
    expect(colliding).toEqual(['override (keyword)', 'mod (reserved word)', 'discard (keyword)']);
  });

  it('every row is named once and carries a reason', () => {
    expect(extensionRows.size).toBe(TYPESHADE_EXTENSIONS.length);
    const silent = TYPESHADE_EXTENSIONS.filter((row) => row.reason.trim().length === 0).map(
      (row) => `${row.name} has an empty reason: say in one line why the language needs the name.`,
    );
    expect(silent).toEqual([]);
  });
});

describe('a compiler-internal name is never authorable', () => {
  it('no pre-emit intrinsic id is declared or listed', () => {
    expect(internalLeaks(SHADE_DTS, extensionRows)).toEqual([]);
  });

  it('the exception is exactly the pre-emit id that names a type, and that id has its row', () => {
    for (const id of PRE_EMIT_TYPE_NAMES) {
      expect(PRE_EMIT_INTRINSICS.has(id)).toBe(true);
      expect(extensionRows.has(id)).toBe(true);
    }
  });

  it('the front end resolves no pre-emit id as a builtin', () => {
    // The call route, beside the declaration and row routes above. `resolveMathFn` is how a
    // spelled name becomes an intrinsic id, and it requires `isKnownIntrinsic` of every id but
    // `f32`, `atan2` and `mod`, none of them pre-emit: so `f64Parts(x)` in a shader is
    // `TS8004 Unknown function`, and an alias
    // table entry that maps a new spelling to a pre-emit id resolves to nothing. `f64(x)` is not
    // an exception here: the constructor is lowered as a scalar cast, not as a builtin call.
    // What this does NOT close: a bespoke lowering that builds the pre-emit call by hand under a
    // new spelling. That is a name for an internal representation whatever its id, and review
    // applies docs/language-design.md §2.1 to it (Rule 9.8).
    for (const id of PRE_EMIT_INTRINSICS) {
      expect(isKnownIntrinsic(id), `${id} must not be a spellable intrinsic`).toBe(false);
      expect(isCanonicalMathFn(id), `${id} must not be a canonical builtin name`).toBe(false);
      expect(resolveMathFn(id), `${id} must not resolve through the Math alias table`).toBe(
        undefined,
      );
    }
  });

  it('reports the row route as well as the declaration route', () => {
    // The `f64Parts` case by the route the first sentinel leaves open: the helper is declared AND
    // given a row, so the three-source check is satisfied. Run against copies, as the sentinel is.
    const withHelper = `${SHADE_DTS}\ndeclare function f64Parts(x: f64): vec2f\n`;
    const withRow = new Map(extensionRows);
    withRow.set('f64Parts', {
      name: 'f64Parts',
      reason: 'an author spelling of the f64 lane bridge',
    });
    expect(unaccounted(withHelper, withRow)).toEqual([]);
    const reported = internalLeaks(withHelper, withRow);
    expect(reported).toHaveLength(2);
    expect(reported[0]).toContain('f64Parts (function');
    expect(reported[0]).toContain('remove the declaration');
    expect(reported[1]).toContain('has a TYPESHADE_EXTENSIONS row');
    expect(reported[1]).toContain('delete the row');
  });
});

describe('the f64 family has the constructor signatures of the type it stands in for', () => {
  it('the f64 family declares only the constructor forms WGSL gives the type it stands in for', () => {
    // The route the name checks above cannot see: the bridge as a SECOND SIGNATURE of the one
    // allowed id. Every `f64` overload takes one argument, as `f32(x)` does, and every
    // `vecNf64` overload is one of WGSL's vector constructor forms; the short spellings
    // `vec2d`/`vec3d`/`vec4d` are type names and never a call, as their rows say.
    expect(f64FamilySignatureStrays(SHADE_DTS)).toEqual([]);
    expect(functionSignatures(SHADE_DTS, 'f64').length).toBeGreaterThan(0);
    for (const n of [2, 3, 4]) {
      expect(functionSignatures(SHADE_DTS, `vec${String(n)}f64`).length).toBeGreaterThan(0);
      expect(functionSignatures(SHADE_DTS, `vec${String(n)}d`)).toEqual([]);
    }
  });

  it('reports the bridge when it is a second signature of an allowed name', () => {
    // `f64FromParts` re-spelled as an overload of `f64`, and `f64Parts` reversed as a vector
    // constructor from two f32 planes. Neither is a stray, neither is a leak; both are caught
    // here, against copies of the library as the other sentinels are.
    const asOverload = `${SHADE_DTS}\ndeclare function f64(hi: f32, lo: f32): f64\n`;
    expect(unaccounted(asOverload)).toEqual([]);
    expect(internalLeaks(asOverload, extensionRows)).toEqual([]);
    const overloadReport = f64FamilySignatureStrays(asOverload);
    expect(overloadReport).toHaveLength(1);
    expect(overloadReport[0]).toContain('f64(f32, f32)');
    expect(overloadReport[0]).toContain('exactly one argument');

    const asPlanes = `${SHADE_DTS}\ndeclare function vec2f64(hi: vec2, lo: vec2): vec2f64\n`;
    expect(unaccounted(asPlanes)).toEqual([]);
    const planesReport = f64FamilySignatureStrays(asPlanes);
    expect(planesReport).toHaveLength(1);
    expect(planesReport[0]).toContain('vec2f64(vec2, vec2)');
    expect(planesReport[0]).toContain('neither a component nor a narrower f64 vector');
  });

  it('the compiler refuses a second argument to f64', () => {
    // The call route of the same overload: the library above says what an editor accepts, and
    // this says what the compiler accepts. A lane that added the overload would have to change
    // both, and this pins the lowering's arity so that the change turns this case red.
    const result = compile(
      '"use typeshade"\nexport function f(a: f32, b: f32): f64 { return f64(a, b) }\n',
    );
    const codes = result.diagnostics.map((d) => `${d.code} ${d.message}`);
    expect(codes).toContain('TS8019 f64() expects 1 argument.');
    expect(result.wgsl).toBeUndefined();
  });
});

describe('the extension table of docs/language-design.md', () => {
  it('is TYPESHADE_EXTENSIONS, row for row', () => {
    // Rule 9.7: a row is added to the table and to the allowlist with the same reason. The name,
    // the order and the reason text are compared, so the document cannot drift from the test.
    const documented = documentedExtensions(readFileSync(DESIGN_DOC, 'utf8'));
    expect(documented).toEqual(TYPESHADE_EXTENSIONS.map(({ name, reason }) => ({ name, reason })));
  });
});

describe('the WGSL fixture is a real bake', () => {
  it('names the specification commit it was read from', () => {
    expect(wgsl.specRepository).toBe('https://github.com/gpuweb/gpuweb');
    expect(wgsl.specCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('carries the whole predeclared vocabulary, so a broken bake cannot pass this suite', () => {
    // At the baked commit the specification has 169 built-in functions and 220 distinct
    // predeclared names once the two alias tables are expanded. The floors are below those and
    // far above anything a truncated parse would produce: the failure this guards against is a
    // bake that writes a fixture holding a handful of names, which would make every check above
    // vacuous: an empty WGSL list accuses TypeShade of having invented `textureSample`.
    expect(wgsl.builtinFunctions.names.length).toBeGreaterThanOrEqual(150);
    const predeclared = new Set([
      ...wgsl.builtinFunctions.names,
      ...wgsl.predeclaredTypes.names,
      ...wgsl.typeGenerators.names,
      ...wgslAliases,
    ]);
    expect(predeclared.size).toBeGreaterThanOrEqual(200);
    expect(wgsl.builtinFunctions.names.length).toBe(wgsl.builtinFunctions.count);
    for (const sentinel of ['textureSample', 'workgroupUniformLoad', 'quantizeToF16', 'bitcast']) {
      expect(wgslFunctions.has(sentinel)).toBe(true);
    }
  });

  it('the predeclared aliases are the ones the specification tabulates, and no others', () => {
    for (const alias of ['vec2f', 'vec3i', 'vec4u', 'vec2h', 'mat4x4f', 'mat2x3h']) {
      expect(wgslAliases.has(alias)).toBe(true);
    }
    // Not in either table: bool vectors, TypeShade's `d`/`f64` spellings, integer matrices, and
    // the bare square-matrix names. Each of these is a TYPESHADE_EXTENSIONS row instead.
    for (const absent of ['vec2b', 'vec2d', 'vec2f64', 'mat2x2i', 'mat4']) {
      expect(wgslAliases.has(absent)).toBe(false);
    }
  });
});
