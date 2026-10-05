// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

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

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
} from './service.js';
import { SHADE_DTS } from './ambient.js';
import { checkDocuments } from './check.js';
import { compile } from '../compiler/ts/compile.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { MATH_CONST_ALIAS, MATH_MEMBER_NAMES } from '../compiler/ts/math-alias.js';
import { LIBRARY_TYPE_NAMES, isLibraryTypeName } from '../compiler/ts/type-map.js';
import { LIBRARY_VALUES, isLibraryValueName } from '../compiler/ts/semantic.js';
import { builtinValueNames } from '../compiler/ts/lower/expression.js';

const editorRefusal = (source: string): string | null => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  const d = service.getDiagnostics('a.ts');
  return d.length === 0 ? null : `${d[0]!.source} ${String(d[0]!.code)}: ${String(d[0]!.message)}`;
};

const compilerRefusal = (source: string): string | null => {
  const d = compileTsSource(source).diagnostics.filter((x) => x.category === 'error');
  return d.length === 0 ? null : `${d[0]!.code}: ${d[0]!.message}`;
};

const FS = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`;

/** A row is `[name, program, 'both accept' | 'both refuse']`. The expectation is written out
 *  rather than inferred so a row that changes verdict has to be edited deliberately. */
const ROWS: readonly (readonly [string, string, 'accept' | 'refuse'])[] = [
  // `bitcast`'s vector overload (change 0044, #478): both halves take each width, and both
  // refuse a vector of the other width. The editor showed TS2344 on the accepted form before.
  [
    'bitcast to vec4u',
    FS('', '  const w = bitcast<vec4u>(vec4(uv, 0., 1.))\n  return bitcast<vec4>(w)'),
    'accept',
  ],
  [
    'bitcast to vec2u and vec3u',
    FS(
      '',
      '  const a = bitcast<vec2u>(uv)\n  const b = bitcast<vec3u>(vec3(uv, 1.))\n  return vec4(f32(a.x), f32(b.z), 0., 1.)',
    ),
    'accept',
  ],
  [
    'bitcast to vec3u of a vec4',
    FS('', '  const b = bitcast<vec3u>(vec4(uv, 0., 1.))\n  return vec4(f32(b.x), 0., 0., 1.)'),
    'refuse',
  ],
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
  // A gather is typed by the TEXTURE's element, on the array forms as much as the plain ones.
  // Both array overloads declared the element parameter and returned a bare `vec4` anyway, so
  // the editor reported "Argument of type 'vec4' is not assignable to parameter of type 'vec4u'"
  // on a program the compiler lowers — the exact false positive this file exists to catch. The
  // whole vector has to be passed somewhere a `vec4u` is required: the scalar brands are
  // mutually assignable, so `gather(...).x` into a `u32` does not tell the two apart.
  [
    'gather on a non-array integer texture, whole vector',
    FS(
      'declare const t: texture_2d<u32>\ndeclare const smp: sampler\nfunction take(v: vec4u): u32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, uv))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'gather on an ARRAY integer texture, whole vector',
    FS(
      'declare const t: texture_2d_array<u32>\ndeclare const smp: sampler\nfunction take(v: vec4u): u32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, uv, 0))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'gather on a cube-ARRAY integer texture, whole vector',
    FS(
      'declare const t: texture_cube_array<u32>\ndeclare const smp: sampler\nfunction take(v: vec4u): u32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, vec3(uv, 1.), 0))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  // The rest of the integer gathers (#175), so that every shape has a row for both kinds: the
  // cube with a `u32` element, and all four shapes with an `i32` one, where `Vec4OfElem` takes
  // its other arm. The determinism report dropped each of these while both halves took every
  // one of them, and the report is `compile()`'s alone, so this is where the editor's half of
  // the same programs is read (`determinism.test.ts` reads it beside the report).
  [
    'gather on a cube u32 texture, whole vector',
    FS(
      'declare const t: texture_cube<u32>\ndeclare const smp: sampler\nfunction take(v: vec4u): u32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, vec3(uv, 1.)))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'gather on a non-array i32 texture, whole vector',
    FS(
      'declare const t: texture_2d<i32>\ndeclare const smp: sampler\nfunction take(v: vec4i): i32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, uv))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'gather on an ARRAY i32 texture, whole vector',
    FS(
      'declare const t: texture_2d_array<i32>\ndeclare const smp: sampler\nfunction take(v: vec4i): i32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, uv, 0))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'gather on a cube i32 texture, whole vector',
    FS(
      'declare const t: texture_cube<i32>\ndeclare const smp: sampler\nfunction take(v: vec4i): i32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, vec3(uv, 1.)))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
  [
    'gather on a cube-ARRAY i32 texture, whole vector',
    FS(
      'declare const t: texture_cube_array<i32>\ndeclare const smp: sampler\nfunction take(v: vec4i): i32 { return v.x }',
      '  const n = take(textureGather(0, t, smp, vec3(uv, 1.), 0))\n  return vec4(f32(n) * 0., 0., 0., 1.)',
    ),
    'accept',
  ],
];

describe('the ambient library declares what the compiler lowers, no wider and no narrower', () => {
  it('has rows on both sides, so neither verdict can carry the suite alone', () => {
    expect(ROWS.filter((r) => r[2] === 'accept').length).toBeGreaterThanOrEqual(10);
    expect(ROWS.filter((r) => r[2] === 'refuse').length).toBeGreaterThanOrEqual(5);
  });

  for (const [name, source, verdict] of ROWS) {
    it(`${name}: the editor and the compiler both ${verdict}`, () => {
      const editor = editorRefusal(source);
      const compiler = compilerRefusal(source);
      expect(
        {
          editor: editor === null ? 'accept' : 'refuse',
          compiler: compiler === null ? 'accept' : 'refuse',
        },
        `editor: ${editor ?? '(clean)'}\ncompiler: ${compiler ?? '(clean)'}`,
      ).toEqual({ editor: verdict, compiler: verdict });
    });
  }

  // The compositions that were left UNDECLARED, with the call that declaring them used to
  // break (#157): a second two-argument `vec4` overload cost TypeScript the contextual type
  // `mix` inferred through. The projection writes the erased vector's type in now, so all
  // three are accepted by both halves, and so is the identity the converting forms skipped.
  for (const [name, source] of [
    ['vec4(x, v3)', FS('', '  const v = vec3(uv, 1.)\n  const w = vec4(uv.x, v)\n  return w')],
    ['vec4(v2, v2)', FS('', '  const w = vec4(uv, uv)\n  return w')],
    [
      'vec4(mix(c * 0.5, d, 0.5), 1.) beside them',
      FS(
        '',
        '  const c = vec3(uv, 1.)\n  const d = vec3(0.5)\n  return vec4(mix(c * 0.5, d, 0.5), 1.)',
      ),
    ],
    ['vec3(v3), the identity', FS('', '  const v = vec3(uv, 1.)\n  return vec4(vec3(v), 1.)')],
    [
      'vec2u(v2u), the identity',
      FS('', '  const v = vec2u(1, 2)\n  return vec4(vec2(vec2u(v)), 0., 1.)'),
    ],
  ] as const) {
    it(`${name} is accepted by the editor and the compiler (#157)`, () => {
      expect(editorRefusal(source)).toBeNull();
      expect(compilerRefusal(source)).toBeNull();
    });
  }
});

describe('every type the library declares is a name the compiler knows is declared', () => {
  // A type name nothing declares is `TS8002` wherever it is written (Rule 2.1, proposal 0008),
  // and the compiler reads "nothing" through `isLibraryTypeName`. A type the library declares
  // and the compiler does not know would be refused in a constraint the editor takes, such as
  // the mixin's `<TBase extends AnyClass>` (surface §29).
  const declared = (): string[] => {
    const sf = ts.createSourceFile('shade.d.ts', SHADE_DTS, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const walk = (n: ts.Node): void => {
      if (
        (ts.isInterfaceDeclaration(n) ||
          ts.isTypeAliasDeclaration(n) ||
          ts.isClassDeclaration(n) ||
          ts.isEnumDeclaration(n)) &&
        n.name !== undefined
      ) {
        out.push(n.name.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    return [...new Set(out)].sort();
  };

  it('each one, and no name the library does not declare', () => {
    const names = declared();
    expect(names.filter((n) => !isLibraryTypeName(n))).toEqual([]);
    expect([...LIBRARY_TYPE_NAMES].filter((n) => !names.includes(n))).toEqual([]);
  });
});

describe('every value the library declares is a name the compiler knows is declared', () => {
  // A value or a callee nothing declares is said once the file is lowered, in a body no call
  // lowers too (Rule 2.1, proposal 0008), and the compiler reads "nothing" through
  // `isLibraryValueName`. A value the library declares and the compiler does not know would be
  // refused where the editor takes it. The brands its types are written with (`vecTag`, a
  // `unique symbol`) are no name an author reads, and a read of one stays the lowering's to say.
  const declared = (): string[] => {
    const sf = ts.createSourceFile('shade.d.ts', SHADE_DTS, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name !== undefined) out.push(st.name.text);
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const brand =
          d.type !== undefined &&
          ts.isTypeOperatorNode(d.type) &&
          d.type.operator === ts.SyntaxKind.UniqueKeyword;
        if (ts.isIdentifier(d.name) && !brand) out.push(d.name.text);
      }
    }
    return [...new Set(out)].sort();
  };

  it('each one, and no name the library does not declare', () => {
    const names = declared();
    expect(names.filter((n) => !isLibraryValueName(n))).toEqual([]);
    expect([...LIBRARY_VALUES, ...builtinValueNames()].filter((n) => !names.includes(n))).toEqual(
      [],
    );
  });
});

// ═══ `Math`: the object the editor reads is the table the compiler resolves (#186) ═══
//
// `Math.cbrt(x)` compiled, and the editor said "Property 'cbrt' does not exist on type
// 'MathObject'". The compiler resolves `Math.log10`, `log1p`, `expm1`, `cbrt` and `hypot` through
// `MATH_EXPAND_ALIAS` and `Math.atan(y, x)` through `atan2` (Rule 9.2's recorded exception), and
// `MathObject` was a list of names written out beside those tables: the 27 aliases and none of
// the five expansions, and `atan` with one arity, so six spellings were red in the editor over a
// program that compiled. Rule 12.7 has the declarations derived from the compiler's tables, and
// this is the assertion that keeps them so. It asks the two halves the same question of every
// member the compiler names and every member the library declares, at every count of arguments,
// so a member added to one side and not the other is a row that fails, and no row is a name
// somebody remembered to list.
//
// The editor's half is TypeScript's own, read with the two halves unmerged. The merged list
// carries the compiler's diagnostics too, so a call the library got wrong would be hidden
// whenever the compiler said the same thing, and a call only the library refuses is the failure
// this exists to see.
//
// What it does not read is an argument that is not an `f32`. The compiler takes a vector for the
// members that lower to a WGSL builtin (`Math.sin(v)` on a `vec3`), and the library declares
// `number`, so TypeScript reports TS2345 there: a disagreement of its own, open, and not one the
// names and counts below can see.

/** What `interface MathObject` declares in a copy of the library, read with the parser: the
 *  members that are calls (a method, once however many overloads it has) and the members that are
 *  values (a `readonly` property). */
function mathObjectMembers(dts: string): { readonly calls: string[]; readonly values: string[] } {
  const sf = ts.createSourceFile('shade.d.ts', dts, ts.ScriptTarget.Latest, true);
  const calls = new Set<string>();
  const values = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isInterfaceDeclaration(st) || st.name.text !== 'MathObject') continue;
    for (const m of st.members) {
      if (m.name === undefined || !ts.isIdentifier(m.name)) continue;
      (ts.isMethodSignature(m) ? calls : values).add(m.name.text);
    }
  }
  return { calls: [...calls].sort(), values: [...values].sort() };
}

/** The compiler's own table (`MATH_MEMBER_NAMES`, what a misspelled `Math.` member is measured
 *  against), split into the constants it bakes and the calls it lowers. */
const COMPILER_VALUES: readonly string[] = Object.keys(MATH_CONST_ALIAS).sort();
const COMPILER_CALLS: readonly string[] = MATH_MEMBER_NAMES.filter(
  (n) => !COMPILER_VALUES.includes(n),
).sort();

/** Every name one side has and the other lacks, as the author would meet it. */
function mathNameDrift(dts: string): string[] {
  const declared = mathObjectMembers(dts);
  const drift: string[] = [];
  for (const [kind, named, has] of [
    ['call', COMPILER_CALLS, declared.calls],
    ['value', COMPILER_VALUES, declared.values],
  ] as const) {
    for (const n of named) {
      if (!has.includes(n)) {
        drift.push(`Math.${n} is a ${kind} the compiler resolves and the library does not declare`);
      }
    }
    for (const n of has) {
      if (!named.includes(n)) {
        drift.push(`Math.${n} is a ${kind} the library declares and the compiler does not resolve`);
      }
    }
  }
  return drift;
}

/** The counts of arguments the sweep writes a call with. No `Math` member takes more than three
 *  (`hypot`, whose third is optional), so four is the first count every one of them refuses, and
 *  none is the count `Math.random()` is written with. */
const ARITIES = [0, 1, 2, 3, 4] as const;
const PARAMETERS = ['x', 'y', 'z', 'w'] as const;

const callSource = (name: string, arity: number): string =>
  '"use typeshade"\nexport function f(x: f32, y: f32, z: f32, w: f32): f32 {\n' +
  `  return Math.${name}(${PARAMETERS.slice(0, arity).join(', ')})\n}\n`;

const valueSource = (name: string): string =>
  `"use typeshade"\nexport function f(): f32 {\n  return Math.${name}\n}\n`;

/** TypeScript's own view of a program: the ambient library over the file, the two halves
 *  unmerged, and its errors alone. `null` when it has none. */
const unmerged = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
let opened = 0;
const typescriptRefusal = (source: string): string | null => {
  const uri = `/math/${opened++}.shade.ts`;
  unmerged.openDocument(uri, source);
  const errors = unmerged
    .getDiagnostics(uri)
    .filter((d) => d.source === 'typescript' && d.severity === 'error');
  unmerged.closeDocument(uri);
  const first = errors[0];
  return first === undefined ? null : `TS${String(first.code)}: ${first.message.split('\n')[0]!}`;
};

/** The counts of arguments at which TypeScript and the compiler give `Math.<name>(...)`
 *  different verdicts, with what each said. */
const disagreements = (
  name: string,
): { arity: number; typescript: string | null; compiler: string | null }[] =>
  ARITIES.flatMap((arity) => {
    const source = callSource(name, arity);
    const typescript = typescriptRefusal(source);
    const compiler = compilerRefusal(source);
    return (typescript === null) === (compiler === null) ? [] : [{ arity, typescript, compiler }];
  });

/** The one member whose halves disagree, and the issue that owns the disagreement: the library
 *  declares `random(): number` and the compiler takes one seed, so `Math.random(x)` compiles and
 *  is TS2554 in the editor, and `Math.random()` is accepted by TypeScript and refused by the
 *  compiler (TS8019), which leaves no spelling of it that works (#181). */
const KNOWN_DISAGREEMENT: Readonly<Record<string, string>> = { random: '#181' };

describe("the Math object the ambient library declares is the compiler's table (#186)", () => {
  const declared = mathObjectMembers(SHADE_DTS);

  it('reads both sides, so no arm below is vacuous', () => {
    expect(declared.calls.length).toBeGreaterThan(25);
    expect(declared.calls).toContain('sin');
    expect(declared.values).toContain('PI');
    expect(COMPILER_CALLS).toContain('cbrt');
    expect(COMPILER_VALUES).toContain('SQRT1_2');
  });

  it('declares every name the compiler resolves on Math, as the call or the value it is', () => {
    expect(mathNameDrift(SHADE_DTS)).toEqual([]);
  });

  it('sees a name one side lacks, in either direction, in a doctored copy of the library', () => {
    // The instrument, before a zero is believed: each copy differs from the library in one
    // member, and the check has to say which.
    const withoutCall = SHADE_DTS.replace(/^ {2}sin\(.*\n/m, '');
    expect(withoutCall).not.toBe(SHADE_DTS);
    expect(mathNameDrift(withoutCall)).toEqual([
      'Math.sin is a call the compiler resolves and the library does not declare',
    ]);
    const withoutValue = SHADE_DTS.replace(/^ {2}readonly PI: number\n/m, '');
    expect(withoutValue).not.toBe(SHADE_DTS);
    expect(mathNameDrift(withoutValue)).toEqual([
      'Math.PI is a value the compiler resolves and the library does not declare',
    ]);
    const withExtra = SHADE_DTS.replace(
      'interface MathObject {\n',
      'interface MathObject {\n  clz32(x: number): number\n',
    );
    expect(withExtra).not.toBe(SHADE_DTS);
    expect(mathNameDrift(withExtra)).toEqual([
      'Math.clz32 is a call the library declares and the compiler does not resolve',
    ]);
  });

  // One row per name either side has, so a member declared and not compiled is a row as much as
  // one compiled and not declared.
  const swept = [...new Set([...COMPILER_CALLS, ...declared.calls])]
    .filter((name) => !(name in KNOWN_DISAGREEMENT))
    .sort();

  it('sweeps every call the two tables name but the recorded exclusion', () => {
    expect(swept.length).toBeGreaterThanOrEqual(COMPILER_CALLS.length - 1);
    expect(swept).toContain('cbrt');
    expect(swept).toContain('atan');
    expect(swept).not.toContain('random');
  });

  for (const name of swept) {
    it(`Math.${name}: at every count of arguments both halves accept it or both refuse it`, () => {
      expect(disagreements(name)).toEqual([]);
    });
  }

  it('Math.random is the one exclusion, and it is still needed (#181)', () => {
    // Its two halves disagree at none and at one argument, which is what the sweep above would
    // report. The day they agree at every count this is red, and the line to write is to delete
    // the exclusion so the sweep reads `random` as it reads the rest.
    expect(
      disagreements('random').map((d) => d.arity),
      "Math.random's halves agree now, or differ at other counts: delete its KNOWN_DISAGREEMENT entry (#181)",
    ).toEqual([0, 1]);
  });

  // A constant is read, and TypeScript's half says nothing of a call of one (TS2349 is dropped
  // for the compiler's own sentence, `"Math.PI" is a constant, not a function`), so what the
  // library has to get right is that each is declared as a value, which the name check above
  // reads, and that the read compiles.
  for (const name of COMPILER_VALUES) {
    it(`Math.${name}: a value both halves read`, () => {
      const source = valueSource(name);
      expect([typescriptRefusal(source), compilerRefusal(source)]).toEqual([null, null]);
    });
  }
});

describe('a Math member the compiler expands, and atan(y, x), is written one way in both halves (#186)', () => {
  // Each row is one program read twice, by `compile()` and by the language service: the compiler
  // takes it, the editor has nothing to say about it, TypeScript's own share of that included,
  // and a hover on the member names the signature the compiler's arity gives it (Rules 9.2, 9.4
  // and 12.7). The signature is what the library declares, so a hover that reads `(x: number)`
  // for `hypot` would be the library and the compiler disagreeing about how many arguments it takes.
  const programOf = (expression: string): string =>
    `"use typeshade"\nexport function f(x: f32, y: f32, z: f32): f32 {\n  return ${expression}\n}\n`;
  const errorsOf = (source: string): string[] =>
    compile(source)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => `${d.code} ${d.message}`);

  /** `[the expression, the member it calls, the signature the editor hovers, a phrase of its documentation]` */
  const EXPRESSIONS: readonly (readonly [string, string, string, string])[] = [
    ['Math.log10(x)', 'log10', 'log10(x: number): number', 'base-10 logarithm'],
    ['Math.log1p(x)', 'log1p', 'log1p(x: number): number', 'natural logarithm of (1 plus'],
    ['Math.expm1(x)', 'expm1', 'expm1(x: number): number', 'minus 1'],
    ['Math.cbrt(x)', 'cbrt', 'cbrt(x: number): number', 'cube root'],
    [
      'Math.hypot(x, y)',
      'hypot',
      'hypot(a: number, b: number, c?: number): number',
      'Euclidean length',
    ],
    [
      'Math.hypot(x, y, z)',
      'hypot',
      'hypot(a: number, b: number, c?: number): number',
      'Euclidean length',
    ],
    [
      'Math.hypot(3, 4)',
      'hypot',
      'hypot(a: number, b: number, c?: number): number',
      'Euclidean length',
    ],
    [
      'Math.atan(y, x)',
      'atan',
      'atan(y: number, x: number): number (+1 overload)',
      'using the signs of both arguments',
    ],
    ['Math.atan(x)', 'atan', 'atan(x: number): number (+1 overload)', 'arctangent of `x`'],
  ];

  for (const [expression, member, signature, phrase] of EXPRESSIONS) {
    it(`${expression}: compiled, nothing in the editor, and ${member} hovers as ${signature}`, () => {
      const source = programOf(expression);
      // The compiler's half.
      expect(errorsOf(source)).toEqual([]);
      expect(compile(source).wgsl).toBeDefined();
      // The editor's half: everything it shows, and TypeScript's own share of it, and what
      // `tshc check` reports, which reads the same service (Rule 12.7 names both).
      const editor = createTypeshadeLanguageService();
      const uri = '/math/expanded.shade.ts';
      editor.openDocument(uri, source);
      expect(editor.getDiagnostics(uri)).toEqual([]);
      expect(typescriptRefusal(source)).toBeNull();
      expect(
        checkDocuments([{ path: 'expanded.shade.ts', uri, text: source }]).diagnostics.filter(
          (d) => d.severity === 'error',
        ),
      ).toEqual([]);
      const at = editor.positionAt(uri, source.indexOf(`Math.${member}`) + 'Math.'.length + 1);
      const hover = editor.getHover(uri, at)?.contents ?? '';
      expect(hover.split('\n')[1]).toBe(`(method) MathObject.${signature}`);
      expect(hover).toContain(phrase);
    });
  }

  // A count the compiler refuses is one sentence in the editor, the compiler's, with TypeScript's
  // own "Expected 2-3 arguments" folded into it (Rule 12.4), and the sentence is pinned with its
  // code (Rule 12.5).
  const WRONG_COUNT: readonly (readonly [string, string])[] = [
    ['Math.log10()', 'TS8003 log10 expects 1 argument.'],
    ['Math.log1p(x, y)', 'TS8003 log1p expects 1 argument.'],
    ['Math.expm1(x, y)', 'TS8003 expm1 expects 1 argument.'],
    ['Math.cbrt(x, y)', 'TS8003 cbrt expects 1 argument.'],
    ['Math.hypot(x)', 'TS8003 hypot expects 2 or 3 arguments.'],
    ['Math.hypot(x, y, z, x)', 'TS8003 hypot expects 2 or 3 arguments.'],
    ['Math.atan()', 'TS8019 Math.atan expects 1 argument, or 2 for atan(y, x), got 0.'],
    ['Math.atan(x, y, z)', 'TS8019 Math.atan expects 1 argument, or 2 for atan(y, x), got 3.'],
  ];

  for (const [expression, sentence] of WRONG_COUNT) {
    it(`${expression}: one sentence, ${sentence}`, () => {
      const source = programOf(expression);
      expect(errorsOf(source)).toEqual([sentence]);
      const editor = createTypeshadeLanguageService();
      const uri = '/math/refused.shade.ts';
      editor.openDocument(uri, source);
      expect(
        editor.getDiagnostics(uri).map((d) => `${d.source} ${String(d.code)} ${d.message}`),
      ).toEqual([`typeshade ${sentence}`]);
    });
  }
});
