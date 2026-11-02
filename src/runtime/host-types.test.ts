// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
//
// The host type family (change 0116) and the shader's vocabulary are one set of names (Rule
// 12.7). A shader file has `f32`, `vec3`, `mat4x4` and `array<T>` from the ambient library, and a
// host file has the same names from `typeshade/runtime` (`host-types.ts`), each a name for the
// host value of Rule 8.21. The two lists are written apart, and two lists drift: a value type the
// library gains would have no host name, and a host name the library drops would be a spelling no
// shader writes. So this file holds the family to the library in both directions, in the shape of
// the shrink-only test of Rule 9.6 (`surface-names.test.ts`): a failure names the type and the
// edit that ends it.
//
// It then holds each type to the shape the compiler gives its name (`lookupTypeName`), and the
// flavor to the behaviour the proposal measured, with `tsc` itself. The behaviour is TypeScript's
// (the weak-type check is not applied to a member of an intersection), so the file imports
// `typescript` and runs on each TypeScript version of CI's unit shards
// (`scripts/typescript-tests.ts`).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { SHADE_DTS } from '../language-service/ambient.js';
import { lookupTypeName } from '../compiler/ts/type-map.js';
import type { ShaderType } from '../core/ir/types.js';
import { tscDiagnostics } from '../core/testing/tsc-diagnostics.js';

const FAMILY_FILE = resolve(__dirname, 'host-types.ts');
const RESIDENT_FILE = resolve(__dirname, '../core/resident.ts');
const FAMILY = readFileSync(FAMILY_FILE, 'utf8');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The names of the types `text` declares: each interface and type alias, at any depth. */
function declaredTypes(text: string): Set<string> {
  const sf = ts.createSourceFile('shade.d.ts', text, ts.ScriptTarget.Latest, true);
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) out.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** The value types the ambient library declares: each name the compiler maps to a scalar, a
 *  vector or a matrix, and `array`, the one wrapper whose instances are values (`array<T, N>` and
 *  `array<T>`, Appendix A of `docs/language-design.md`). */
function libraryValueTypes(dts: string): Set<string> {
  return new Set(
    [...declaredTypes(dts)].filter((n) => lookupTypeName(n) !== undefined || n === 'array'),
  );
}

/** The names the family exports: each `export type` of `host-types.ts`. */
function familyNames(text: string): Set<string> {
  const sf = ts.createSourceFile('host-types.ts', text, ts.ScriptTarget.Latest, true);
  const out = new Set<string>();
  for (const st of sf.statements)
    if (
      ts.isTypeAliasDeclaration(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      out.add(st.name.text);
  return out;
}

/** Each name one side has and the other lacks, with the edit that ends it. */
function disagreements(dts: string, family: string): string[] {
  const library = libraryValueTypes(dts);
  const names = familyNames(family);
  return [
    ...[...library]
      .filter((n) => !names.has(n))
      .map(
        (n) =>
          `${n} is a value type the ambient library declares, and the family has no type of that name: add it to src/runtime/host-types.ts.`,
      ),
    ...[...names]
      .filter((n) => !library.has(n))
      .map(
        (n) =>
          `${n} is a type of the family, and the ambient library declares no value type of that name: delete it from src/runtime/host-types.ts.`,
      ),
  ];
}

describe('the host type family is the ambient library’s value types, one for one (Rule 12.7)', () => {
  it('reads both sides, so neither list is empty', () => {
    // 5 scalars, 21 vectors, 21 matrices and `array` (AGENTS.md#gate-discipline: a floor).
    expect(familyNames(FAMILY).size).toBeGreaterThanOrEqual(48);
    expect(libraryValueTypes(SHADE_DTS).size).toBeGreaterThanOrEqual(48);
  });

  it('has a type for each value type the library declares, and no other', () => {
    expect(disagreements(SHADE_DTS, FAMILY)).toEqual([]);
  });

  it('sees a name one side lacks, in either direction, in a doctored copy', () => {
    const dts = SHADE_DTS.replace(/^type vec2d = .*$/m, '');
    expect(dts).not.toBe(SHADE_DTS);
    expect(disagreements(dts, FAMILY)).toEqual([
      'vec2d is a type of the family, and the ambient library declares no value type of that name: delete it from src/runtime/host-types.ts.',
    ]);
    const family = FAMILY.replace(/^export type vec4b = .*$/m, '');
    expect(family).not.toBe(FAMILY);
    expect(disagreements(SHADE_DTS, family)).toEqual([
      'vec4b is a value type the ambient library declares, and the family has no type of that name: add it to src/runtime/host-types.ts.',
    ]);
  });
});

/** `n` copies of `e`, as a `readonly` tuple. */
const tuple = (e: string, n: number): string => `readonly [${Array(n).fill(e).join(', ')}]`;

/** The lines of a program that hold the family's type `name` to the shape the compiler gives the
 *  name: the same tuple for a vector, and for a matrix a tuple of its components, column-major,
 *  that `array<T>` takes as a matrix and not as a vector. */
function shapeLines(name: string, t: ShaderType): string[] {
  switch (t.kind) {
    case 'scalar':
      return [`ok<Equal<${name}, ${t.scalar}>>();`];
    case 'f64':
      return [`ok<Equal<${name}, f64>>();`];
    case 'vec':
      return [`ok<Equal<${name}, ${tuple(t.elem, t.n)}>>();`];
    case 'vec64':
      return [`ok<Equal<${name}, ${tuple('f64', t.n)}>>();`];
    case 'mat': {
      const components = tuple(t.elem, t.cols * t.rows);
      return [
        `ok<Mutual<${name}, ${components}>>();`,
        `ok<Equal<${name}['length'], ${t.cols * t.rows}>>();`,
        `ok<Equal<array<${name}>, readonly ${name}[] | Resident<${name}[]>>>();`,
      ];
    }
    default:
      throw new Error(`${name} maps to a ${t.kind}, which the family has no shape for`);
  }
}

/** A host program over the family that `tsc` must accept with no diagnostic: each line that
 *  must be refused carries `@ts-expect-error`, which is itself a diagnostic when nothing is
 *  refused there. */
function familyProgram(): string {
  const names = [...familyNames(FAMILY)];
  const shapes = names
    .filter((n) => n !== 'array')
    .flatMap((n) => shapeLines(n, lookupTypeName(n)!));
  return [
    `import type { ${names.join(', ')} } from ${JSON.stringify(FAMILY_FILE)};`,
    `import type { Resident } from ${JSON.stringify(RESIDENT_FILE)};`,
    'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
    'type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;',
    'declare function ok<T extends true>(): T;',
    '',
    '// Each type has the shape the compiler gives its name.',
    ...shapes,
    '',
    '// A plain literal is a value of the family, and an f32 is a number.',
    'const k: f32 = 0.1;',
    'const n: u32 = 3;',
    'const b: bool = true;',
    'const v: vec3 = [1, 2, 3];',
    'const m: mat2x2 = [1, 0, 0, 1];',
    'const md: mat3<f64> = [1, 0, 0, 0, 1, 0, 0, 0, 1];',
    'const x: number = k;',
    'const y: boolean = b;',
    '',
    '// A conditional type tells the names apart.',
    'type IsU32<T> = T extends u32 ? true : false;',
    'ok<Equal<IsU32<u32>, true>>();',
    'ok<Equal<IsU32<f32>, false>>();',
    '',
    '// array<T> is what a kernel function takes for an array with no size (Rule 8.21).',
    'ok<Equal<array<f32>, Float32Array | Resident<Float32Array>>>();',
    'ok<Equal<array<f64>, Float64Array | Resident<Float64Array>>>();',
    'ok<Equal<array<i32>, Int32Array | Resident<Int32Array>>>();',
    'ok<Equal<array<u32>, Uint32Array | Resident<Uint32Array>>>();',
    'ok<Equal<array<vec3>, Float32Array | Resident<Float32Array>>>();',
    'ok<Equal<array<vec4u>, Uint32Array | Resident<Uint32Array>>>();',
    'ok<Equal<array<vec2f64>, Float64Array | Resident<Float64Array>>>();',
    'type Pole = { z: f32; k: f32 };',
    'ok<Equal<array<Pole>, readonly Pole[] | Resident<Pole[]>>>();',
    'ok<Equal<array<f32, 4>, readonly f32[]>>();',
    'ok<Equal<array<Pole, 2>, readonly Pole[]>>();',
    '',
    '// What does not fit is refused.',
    'declare const fs: array<f32>;',
    '// @ts-expect-error an f32 array where a u32 array goes',
    'const us: array<u32> = fs;',
    '// @ts-expect-error a vec3 where a vec2 goes',
    'const v2: vec2 = v;',
    '// @ts-expect-error a u32 where an f32 goes',
    'const kk: f32 = n;',
    '// @ts-expect-error a mat2x3 where a mat3x2 goes',
    'const m32: mat3x2 = [1, 2, 3, 4, 5, 6] as mat2x3;',
    '',
    '// Each type is assignable from the value the structural spelling named, and to it.',
    'const old = { n: 5, v: [1, 2, 3] as readonly [number, number, number], a: new Float32Array(2) as Float32Array | Resident<Float32Array> };',
    'const toN: f32 = old.n;',
    'const toV: vec3 = old.v;',
    'const toA: array<f32> = old.a;',
    'const backN: number = toN;',
    'const backV: readonly [number, number, number] = toV;',
    'const backA: Float32Array | Resident<Float32Array> = toA;',
    'const poles: array<Pole> = [{ z: 0, k: 0.1 }];',
    '',
    'export { md, x, y, us, v2, kk, m32, backN, backV, backA, poles };',
    '',
  ].join('\n');
}

describe('each type of the family is the host value its name has (Rule 8.21)', () => {
  it('has the compiler’s shape for each name, and the behaviour of the flavor, under tsc', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-types-'));
    dirs.push(dir);
    const program = familyProgram();
    // Each name but `array` is held to a shape (AGENTS.md#gate-discipline: a floor).
    expect(program.match(/^ok<(Equal|Mutual)<(\w+)(, |\[)/gm)?.length).toBeGreaterThanOrEqual(47);
    const file = join(dir, 'host.ts');
    writeFileSync(file, program);
    const found = await tscDiagnostics([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    });
    expect(found.map((d) => `${d.fileName?.slice(dir.length + 1)}:${d.line} TS${d.code}`)).toEqual(
      [],
    );
  });

  it('fails a program that writes a wrong shape, so the check above can fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-types-'));
    dirs.push(dir);
    const file = join(dir, 'host.ts');
    writeFileSync(
      file,
      [
        `import type { vec3u, array } from ${JSON.stringify(FAMILY_FILE)};`,
        'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
        'declare function ok<T extends true>(): T;',
        'ok<Equal<vec3u, readonly [number, number, number]>>();',
        'ok<Equal<array<vec3u>, Float32Array>>();',
        '',
      ].join('\n'),
    );
    const found = await tscDiagnostics([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    });
    expect(found.map((d) => `${d.line} TS${d.code}`)).toEqual(['4 TS2344', '5 TS2344']);
  });
});
