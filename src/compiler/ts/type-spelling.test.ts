// A type in a message is written as the author writes it (proposal 0008 §5).
//
// The messages printed the IR's key, `typeKey`: `struct:B` for a class the author called `B`,
// `vec3<f32>` for a `vec3`, `vec3<u32>` for a `vec3u`, `mat3x3<f32>` for a `mat3x3`, and
// `array<f32,4>` with no space. `vec3<f32>` is a spelling the editor refuses (TS2315, "Type
// 'vec3' is not generic"), so the compiler named a type the editor says does not exist. Every
// message now spells a type through `authorTypeText`, whose names come from the table
// `type-map.ts` parses a declaration with, and the describes below paste each of those
// spellings back into the editor.
//
// A class is named as it is written, not as it is emitted: `N.P` for the struct `N_P` a class
// inside a namespace becomes, `Slot<f32>` for the struct `Slot_f32` a generic class becomes.
// Both emitted names are TS2304 "Cannot find name" in the editor.
//
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { authorTypeText } from './context.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import {
  arrayT,
  atomicU32T,
  casResultT,
  mat3f64T,
  mat4x4fT,
  structT,
  vec2bT,
  vec3f64T,
  vec3fT,
  vec3iT,
  vec3uT,
  type ShaderType,
} from '../../core/ir/types.js';

const classes = '"use typeshade";\nclass A { x: f32 = 0.; }\nclass B { x: f32 = 0.; }\n';

/** Every diagnostic of `body` after the two classes, as `code message`. */
function said(body: string): string[] {
  return compile(`${classes}${body}\n`).diagnostics.map((d) => `${d.code} ${d.message}`);
}

describe('a message names a class by the name the author gave it', () => {
  it('a return of the wrong class', () => {
    expect(said('export function k(): B { return new A(); }')).toEqual([
      'TS8003 Function "k" return type mismatch: declared B, got A.',
    ]);
  });

  it('two arms of a conditional', () => {
    expect(said('export function k(c: bool): A { return c ? new A() : new B(); }')).toEqual([
      'TS8003 Ternary arm type mismatch: A vs B.',
    ]);
  });

  it('an index, a condition and a Math argument', () => {
    expect(said('export function k(a: A): f32 { return a[0]; }')).toEqual([
      'TS8003 Cannot index A.',
    ]);
    expect(said('export function k(a: A): f32 { if (a) { return 1.; } return 0.; }')).toEqual([
      'TS8003 if condition must be bool, got A.',
    ]);
    expect(said('export function k(a: A): f32 { return Math.min(a, 1.); }')).toEqual([
      'TS8036 Math.min takes a number, or a vector of them; got A.',
    ]);
  });

  it('an assignment, and a struct at a @location', () => {
    expect(said('export function k(a: A, b: B): f32 { let c = a; c = b; return c.x; }')).toEqual([
      'TS8003 Type mismatch: cannot assign to A A and B. Types must match.',
    ]);
    expect(
      said(
        [
          'class In { @location(0) p: vec3 = vec3(0.); }',
          'class VO { @builtin("position") pos: vec4 = vec4(0.); @location(0) b: In = new In(); }',
          '@vertex export function vs(): VO { return new VO(); }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8003 "VO.b" is at a @location and is "In"; a value passed between stages is a numeric ' +
        'scalar or a numeric vector. Send its components as separate locations.',
    ]);
  });

  it('an array element of the wrong class, told no cast since a class has none', () => {
    expect(
      said('export function k(a: A, b: B): f32 { const xs: array<A, 2> = [a, b]; return 1.; }'),
    ).toEqual(['TS8003 array<A, 2> element 1 must be A, got B. There is no implicit conversion.']);
    // A number against a number still has the cast.
    expect(
      said('export function k(n: i32): f32 { const xs: array<f32, 2> = [1., n]; return 1.; }'),
    ).toEqual([
      'TS8003 array<f32, 2> element 1 must be f32, got i32. There is no implicit conversion; cast it.',
    ]);
  });
});

describe('a message names a vector, a matrix and an array as the author writes them', () => {
  it('the vectors by their short names', () => {
    expect(said('export function k(v: vec3u, w: vec3): vec3u { return v * w; }')).toEqual([
      'TS8003 Type mismatch: cannot * vec3u and vec3. Vectors must have the same element type. ' +
        'Cast one side per component, e.g. a * vec3u(u32(b.x), u32(b.y), u32(b.z)).',
    ]);
    expect(said('export function k(v: vec3u): f32 { return sqrt(v); }')).toEqual([
      'TS8036 sqrt takes an f32, or a vector of them; got vec3u.',
    ]);
  });

  it('a matrix by its name, and a matrix of doubles by the generic form', () => {
    expect(said('export function k(m: mat3x3, v: vec4): vec4 { return m * v; }')).toEqual([
      'TS8003 Type mismatch: cannot * mat3x3 and vec4. Types must match.',
    ]);
    expect(
      said('export function k(m: mat3x3<f64>, v: vec4f64): vec4f64 { return m * v; }'),
    ).toEqual(['TS8003 Type mismatch: cannot * mat3x3<f64> and vec4f64. Types must match.']);
  });

  it('an array with its element and a space after the comma', () => {
    expect(
      said(
        'export function k(xs: array<vec3, 4>): f32 { const y: array<vec3u, 4> = xs; return y[0].x; }',
      ),
    ).toContain(
      'TS8003 Type mismatch: cannot let/const y array<vec3u, 4> and array<vec3, 4>. Types must match.',
    );
  });

  it('a storage texture with the string literals of its format and access', () => {
    expect(
      said(
        [
          'declare const tex: texture_storage_2d<"rgba8unorm", "write">;',
          '@compute([1, 1, 1]) export function main() { textureStore(tex, vec3i(0, 0, 0), vec4(1.)); }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8041 textureStore on a texture_storage_2d<"rgba8unorm", "write"> takes a vec2 ' +
        'coordinate; got vec3i.',
    ]);
  });
});

describe('every spelling a message uses is a type the editor reads', () => {
  // The spellings the IR key got wrong, one of each kind. Each is pasted into a parameter list,
  // and TypeScript over the ambient library has to find nothing to say about any of them: a
  // message that names a type the editor refuses is the mismatch this file is about.
  const types: readonly ShaderType[] = [
    structT('A'),
    vec3fT,
    vec3iT,
    vec3uT,
    vec2bT,
    vec3f64T,
    mat4x4fT,
    mat3f64T,
    arrayT(vec3uT, 4),
    arrayT(structT('A')),
    atomicU32T,
    {
      kind: 'storage-texture',
      dim: '2d-array',
      format: 'rgba8unorm',
      access: 'write',
    } as ShaderType,
    casResultT('u32'),
  ];

  it('prints the source spelling, never the IR key', () => {
    expect(types.map(authorTypeText)).toEqual([
      'A',
      'vec3',
      'vec3i',
      'vec3u',
      'vec2b',
      'vec3f64',
      'mat4x4',
      'mat3x3<f64>',
      'array<vec3u, 4>',
      'array<A>',
      'atomic<u32>',
      'texture_storage_2d_array<"rgba8unorm", "write">',
      '{ old_value: u32; exchanged: bool }',
    ]);
  });

  it('draws no TypeScript diagnostic when written as a type', () => {
    const params = types.map((t, i) => `p${String(i)}: ${authorTypeText(t)}`).join(', ');
    const service = createTypeshadeLanguageService();
    service.openDocument('t.ts', `${classes}export declare function f(${params}): void;\n`);
    expect(
      service
        .getDiagnostics('t.ts')
        .filter((d) => d.source === 'typescript')
        .map((d) => `TS${String(d.code)}: ${d.message}`),
    ).toEqual([]);
  });
});

describe('a message names a class in a namespace, and a generic one, as written', () => {
  const decls = [
    '"use typeshade";',
    'namespace N {',
    '  export class P { x: f32 = 0.; }',
    '  export class Pair<T> { v: T; constructor(v: T) { this.v = v; } }',
    '}',
    'namespace A.B { export class Q { x: f32 = 0.; } }',
    'class Slot<T> { v: T; constructor(v: T) { this.v = v; } }',
    '',
  ].join('\n');
  const saidOf = (body: string): string[] =>
    compile(`${decls}${body}\n`).diagnostics.map((d) => `${d.code} ${d.message}`);

  it('the namespace path, dotted, for the struct N_P', () => {
    expect(saidOf('export function k(): N.P { return new A.B.Q(); }')).toEqual([
      'TS8003 Function "k" return type mismatch: declared N.P, got A.B.Q.',
    ]);
  });

  it('the type arguments, for the struct Slot_f32', () => {
    expect(saidOf('export function k(): Slot<f32> { return new Slot<i32>(1); }')).toEqual([
      'TS8003 Function "k" return type mismatch: declared Slot<f32>, got Slot<i32>.',
    ]);
    expect(
      saidOf(
        'export function k(c: bool): f32 { const s = c ? new Slot<f32>(1.) : new Slot<i32>(1); return 1.; }',
      ),
    ).toEqual(['TS8003 Ternary arm type mismatch: Slot<f32> vs Slot<i32>.']);
  });

  it('both at once, with a class as the type argument', () => {
    expect(
      saidOf(
        'export function k(): f32 { const p = new N.Pair<N.P>(new N.P()); if (p) { return 1.; } return 0.; }',
      ),
    ).toEqual(['TS8003 if condition must be bool, got N.Pair<N.P>.']);
    expect(
      saidOf('export function k(): f32 { const s = new Slot<vec3u>(vec3u(u32(1))); return s[0]; }'),
    ).toEqual(['TS8003 Cannot index Slot<vec3u>.']);
  });

  it('a field a pattern reads, and a stage struct, of a class in a namespace', () => {
    expect(saidOf('export function k(): f32 { const { y } = new N.P(); return y; }')).toContain(
      'TS8022 "N.P" has no field "y".',
    );
    expect(
      compile(
        [
          '"use typeshade";',
          'namespace S {',
          '  export class VOut { @builtin("position") pos: vec4 = vec4(0.); uv: vec2 = vec2(0.); }',
          '}',
          '@vertex export function vs(): S.VOut { return new S.VOut(); }',
          '',
        ].join('\n'),
      ).diagnostics.map((d) => `${d.code} ${d.message}`),
    ).toEqual([
      'TS8029 Struct "S.VOut" field "uv" is used as a vertex output but has neither ' +
        '@builtin(...) nor @location(...): WGSL requires every entry output struct member to ' +
        'declare one.',
    ]);
  });

  it('each of those names is a type the editor reads', () => {
    const shown = ['N.P', 'A.B.Q', 'Slot<f32>', 'Slot<i32>', 'N.Pair<N.P>', 'Slot<vec3u>'];
    const params = shown.map((t, i) => `p${String(i)}: ${t}`).join(', ');
    const service = createTypeshadeLanguageService();
    service.openDocument('t.ts', `${decls}export declare function f(${params}): void;\n`);
    expect(
      service
        .getDiagnostics('t.ts')
        .filter((d) => d.source === 'typescript')
        .map((d) => `TS${String(d.code)}: ${d.message}`),
    ).toEqual([]);
  });
});

describe('the messages round one left on the key', () => {
  it('a module const whose call is not its type, and the cast it names compiles', () => {
    expect(said('const K: vec3 = sin(1.);\nexport function k(): vec3 { return K; }')).toContain(
      'TS8003 Module const "K" is vec3, but its initializer is f32. Cast it, e.g. vec3(...), ' +
        'or change the annotation.',
    );
    const pasted = compile(
      `${classes}const K: vec3 = vec3(sin(1.));\nexport function k(): vec3 { return K; }\n`,
    );
    expect(pasted.diagnostics).toEqual([]);
  });

  it('a sampler argument that is not a sampler', () => {
    const fragment = (call: string): string[] =>
      said(
        [
          'declare const dt: texture_depth_2d;',
          'declare const smp: sampler;',
          `@fragment export function fs(@builtin("position") p: vec4): vec4 { return ${call}; }`,
        ].join('\n'),
      );
    expect(fragment('vec4(textureSampleCompare(dt, p.xy, p.xy, 0.5))')).toEqual([
      'TS8003 textureSampleCompare compares through a sampler_comparison; got vec2. An ordinary ' +
        'sampler filters a texel and has no reference to compare against. Declare the sampler ' +
        '"declare const smp: sampler_comparison".',
    ]);
    expect(fragment('textureGather(dt, p, p.xy)')).toEqual([
      'TS8003 textureGather reads through an ordinary sampler; got vec4. A sampler_comparison ' +
        'compares instead, with textureGatherCompare.',
    ]);
  });

  it('an interstage slot of two types, with a vertex struct inside a namespace', () => {
    const pair = (out: string, vs: string): string[] =>
      said(
        [
          out,
          'class FIn { @location(0) uv: vec2 = vec2(0.); }',
          `@vertex export function vs(): ${vs} { return new ${vs}(); }`,
          '@fragment export function fs(i: FIn): vec4 { return vec4(i.uv, 0., 1.); }',
        ].join('\n'),
      );
    const vout = '{ @builtin("position") pos: vec4 = vec4(0.); @location(0) uv: vec3 = vec3(0.); }';
    expect(pair(`class VOut ${vout}`, 'VOut')).toEqual([
      'TS8010 @location(0) leaves "vs" as vec3 (VOut.uv) and enters "fs" as vec2 (FIn.uv); ' +
        'an interstage slot is one type on both sides.',
    ]);
    expect(pair(`namespace N { export class VOut ${vout} }`, 'N.VOut')).toEqual([
      'TS8010 @location(0) leaves "vs" as vec3 (N.VOut.uv) and enters "fs" as vec2 (FIn.uv); ' +
        'an interstage slot is one type on both sides.',
    ]);
  });

  it('a field whose type a derived class changes', () => {
    expect(
      said(
        'class D extends A { x: vec3 = vec3(0.); }\nexport function k(d: D): f32 { return 1.; }',
      ),
    ).toEqual([
      'TS8010 "D" declares "x" as vec3, and "A" declares it as f32. A struct has one layout, so ' +
        'a field cannot change type on the way down.',
    ]);
  });

  it('what atomicCompareExchangeWeak returns, as the ambient library declares it', () => {
    expect(
      said(
        [
          'declare const at: storage<array<atomic<u32>>, "read_write">;',
          '@compute([1, 1, 1]) export function cs(): void {',
          '  const r = atomicCompareExchangeWeak(at[0], u32(0), u32(1));',
          '  if (r) { return; }',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['TS8003 if condition must be bool, got { old_value: u32; exchanged: bool }.']);
  });

  it('a read of a binding whose type was refused says nothing about the placeholder', () => {
    // `storage<array<vec2h>>` recovers as a struct called `array`, which printed as `array`
    // would call an indexable array unindexable. The refusal is the one mistake (Rule 12.4).
    for (const read of ['vh[0]', 'vh.length']) {
      const messages = said(
        [
          'declare const vh: storage<array<vec2h>, "read_write">;',
          `@compute([1, 1, 1]) export function cs(): void { const y = ${read}; }`,
        ].join('\n'),
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/^TS8002 Unknown type "vec2h"\./);
    }
  });
});
