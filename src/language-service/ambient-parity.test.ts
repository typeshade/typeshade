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
import { createTypeshadeLanguageService } from './service.js';
import { SHADE_DTS } from './ambient.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
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
