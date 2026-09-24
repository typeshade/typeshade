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
import { compileTsSources } from './module.js';
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

  it('an argument of another class', () => {
    // TypeScript takes one class for another with the same fields, so the editor is silent and
    // the sentence says why: it said "Argument 1 of "g" type mismatch." and nothing more.
    expect(
      said('function g(b: B): f32 { return b.x; }\nexport function k(a: A): f32 { return g(a); }'),
    ).toEqual([
      'TS8003 Argument 1 of "g" is A, and "g" takes B. A struct is its own type whatever its ' +
        'fields, so pass a value of type B.',
    ]);
  });

  it('an assignment, and a struct at a @location', () => {
    // An assignment reads in the order it is written, the value and then the place: "cannot
    // assign to A A and B" named the place twice, and its vector remedy added to the place
    // (`a + vec3(…)`) where the fix casts the value. The editor shows the one sentence.
    const assigns: [string, string][] = [
      [
        'export function k(a: A, b: B): f32 { let c = a; c = b; return c.x; }',
        'TS8003 Type mismatch: cannot assign B to A. Types must match.',
      ],
      [
        'export function k(b: vec3u): f32 { let a = vec3(0.); a = b; return a.x; }',
        'TS8003 Type mismatch: cannot assign vec3u to vec3. Vectors must have the same element ' +
          'type. Cast the value per component, e.g. a = vec3(f32(b.x), f32(b.y), f32(b.z)).',
      ],
      [
        'export function k(b: u32): i32 { let a = i32(0); a = b; return a; }',
        'TS8003 Type mismatch: cannot assign u32 to i32 — WGSL has no implicit integer ' +
          'conversion. Cast the value: i32(…), e.g. a = i32(b).',
      ],
    ];
    for (const [body, sentence] of assigns) {
      expect(said(body), body).toEqual([sentence]);
      const service = createTypeshadeLanguageService();
      service.openDocument('t.ts', `${classes}${body}\n`);
      expect(
        service.getDiagnostics('t.ts').map((d) => `${String(d.code)} ${d.message}`),
        body,
      ).toEqual([sentence]);
    }
    // No splat puts a vector in a scalar place.
    expect(said('export function k(b: vec2): f32 { let a = 0.; a = b; return a; }')).toEqual([
      'TS8003 Type mismatch: cannot assign vec2 to f32. Types must match.',
    ]);
    // Each remedy compiles when pasted.
    for (const body of [
      'export function k(b: vec3u): f32 { let a = vec3(0.); a = vec3(f32(b.x), f32(b.y), f32(b.z)); return a.x; }',
      'export function k(b: u32): i32 { let a = i32(0); a = i32(b); return a; }',
    ]) {
      expect(said(body), body).toEqual([]);
    }
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

  it('a value returned from a function that says it returns nothing', () => {
    // #249's sentence, merged after the rest took this printer, spelled `vec3<f32>`.
    expect(said('function f(a: f32): void { return vec3(a, 1., 2.); }')).toEqual([
      'TS8003 Function "f" returns void but returns a value of type vec3: write ": vec3" as its ' +
        'return type, or return nothing.',
    ]);
    expect(said('function f(a: u32): void { return vec2u(a, a); }')).toEqual([
      'TS8003 Function "f" returns void but returns a value of type vec2u: write ": vec2u" as ' +
        'its return type, or return nothing.',
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
      expect(messages).toEqual(['TS8002 Unknown type "vec2h". Did you mean "vec2"?']);
    }
  });
});

describe('a class named while the structs are collected, and a sentence about a struct itself', () => {
  const ns = [
    '"use typeshade";',
    'namespace N {',
    '  export class P { x: f32 = 0.; y: f32 = 0.; }',
    '  export class In { p: vec3 = vec3(0.); }',
    '}',
    'class Slot<T> { v: T; constructor(v: T) { this.v = v; } }',
    '',
  ].join('\n');
  const saidOf = (body: string): string[] =>
    compile(`${ns}${body}\n`).diagnostics.map((d) => `${d.code} ${d.message}`);

  // The written names were bound once the structs had been collected, and these sentences are
  // said while they are: they read `N_P`, `Slot_f32` and `N_In`.
  it('a field a derived class retypes, with a class in a namespace or a generic one', () => {
    expect(
      saidOf(
        [
          'class A { f: N.P = new N.P(); }',
          'class B extends A { f: f32 = 0.; }',
          'class C { s: Slot<f32> = new Slot<f32>(1.); }',
          'class D extends C { s: Slot<i32> = new Slot<i32>(1); }',
          'export function k(b: B, d: D): f32 { return 1.; }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8010 "B" declares "f" as f32, and "A" declares it as N.P. A struct has one layout, so ' +
        'a field cannot change type on the way down.',
      'TS8010 "D" declares "s" as Slot<i32>, and "C" declares it as Slot<f32>. A struct has one ' +
        'layout, so a field cannot change type on the way down.',
    ]);
  });

  it('a class at a @location, and at a builtin', () => {
    expect(
      saidOf(
        [
          'class VO {',
          '  @builtin("position") pos: vec4 = vec4(0.);',
          '  @location(0) b: N.In = new N.In();',
          '  @location(1) c: Slot<f32> = new Slot<f32>(1.);',
          '}',
          '@vertex export function vs(): VO { return new VO(); }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8003 "VO.b" is at a @location and is "N.In"; a value passed between stages is a ' +
        'numeric scalar or a numeric vector. Send its components as separate locations.',
      'TS8003 "VO.c" is at a @location and is "Slot<f32>"; a value passed between stages is a ' +
        'numeric scalar or a numeric vector. Send its components as separate locations.',
    ]);
    // Said twice, at the field and at the entry, and now in one spelling.
    expect(
      saidOf(
        [
          'class VO { @builtin("position") pos: N.In = new N.In(); }',
          '@vertex export function vs(): VO { return new VO(); }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8003 Builtin "position" is "vec4"; this declares it "N.In".',
      'TS8003 Builtin "position" is "vec4"; this declares it "N.In".',
    ]);
  });

  it('an object literal, a vertex entry and a method call of a class in a namespace', () => {
    expect(
      saidOf('export function k(): f32 { const p: N.P = { x: 1., y: 2., z: 3. }; return p.x; }'),
    ).toEqual(['TS8010 Struct N.P has no field "z".']);
    expect(saidOf('export function k(): f32 { const p: N.P = { x: 1. }; return p.x; }')).toEqual([
      'TS8010 Missing field "y" for struct N.P.',
    ]);
    expect(saidOf('export function k(p: N.P): f32 { return p.q(); }')).toEqual([
      'TS8035 "N.P" has no method "q".',
    ]);
    expect(
      saidOf(
        [
          'namespace S { export class VOut { @location(0) uv: vec2 = vec2(0.); } }',
          '@vertex export function vs(): S.VOut { return new S.VOut(); }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8020 "vs" is a @vertex entry, so what it returns has to carry the position: give ' +
        '"S.VOut" a field with @builtin("position"), typed vec4.',
    ]);
  });

  it('a member a call reaches on a class in a namespace, and a generic class built as a literal', () => {
    expect(saidOf('export function k(p: N.P): f32 { return p.x(); }')).toEqual([
      'TS8035 "x" is a field of N.P, not a method.',
    ]);
    // A static of a class in a namespace is called nowhere today (`N.P.m()` is TS8022 Unknown
    // identifier "N", a gap of its own), so the sentence names no call; the one it named,
    // `N_P.m(...)` and then `N.P.m(...)`, did not compile.
    expect(
      compile(
        [
          '"use typeshade";',
          'namespace N { export class P { x: f32 = 0.; static m(): f32 { return 1.; } } }',
          'export function k(p: N.P): f32 { return p.m(); }',
          '',
        ].join('\n'),
      ).diagnostics.map((d) => `${d.code} ${d.message}`),
    ).toEqual(['TS8035 "N.P.m" is static, so a value of N.P does not have it.']);
    const box = 'class Box<T> { #h: f32 = 0.; v: T; constructor(v: T) { this.v = v; } }';
    expect(
      saidOf(`${box}\nexport function k(): f32 { const b: Box<f32> = { v: 1. }; return b.v; }`),
    ).toEqual([
      'TS8010 "Box<f32>" has the private field "#h", which an object literal cannot set. Build ' +
        'it with "new Box<f32>(...)".',
    ]);
    expect(
      saidOf(
        `${box}\nexport function k(): f32 { const b: Box<f32> = new Box<f32>(1.); return b.v; }`,
      ),
    ).toEqual([]);
    expect(
      saidOf(
        [
          'class Two<T> { #v: f32 = 0.; w: T; constructor(w: T) { this.w = w; } }',
          'class D extends Two<f32> { #v: f32 = 1.; }',
          'export function k(d: D): f32 { return d.w; }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8010 "Two<f32>" declares "#v" and "D" declares "#v", which would both be the struct ' +
        'member "v": a private name is emitted without its "#". Rename one of them.',
    ]);
  });

  it('a struct declared in a namespace, as the sentence about its declaration names it', () => {
    expect(
      saidOf(
        [
          'namespace S {',
          '  export class E {}',
          '  export class VOut {',
          '    @builtin("position") pos: vec4 = vec4(0.);',
          '    @location(0) uv: vec2 = vec2(0.);',
          '    @location(0) c: vec2 = vec2(0.);',
          '  }',
          '  export class L { xs: array<f32>; n: u32 = 0; }',
          '}',
          'declare const b: storage<S.L, "read_write">;',
          'export function k(e: S.E): f32 { return 1.; }',
          '@vertex export function vs(): S.VOut { return new S.VOut(); }',
          '@compute([1, 1, 1]) export function cs(): void { b.n = 1; }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8010 Struct "S.E" has no fields. WGSL requires a struct to declare at least one ' +
        'member, so an empty one cannot be emitted.',
      'TS8010 Struct "S.VOut" puts "uv" and "c" both at @location(0); each slot carries one ' +
        'value.',
      'TS8051 "S.L.xs" is a list of no fixed length and is not the last field of "S.L": nothing ' +
        'after it has an offset. Move it last, or give it a length.',
    ]);
    expect(
      compile(
        [
          '"use typeshade";',
          '"enable dual_source_blending";',
          'namespace S { export class FOut { @location(0) @blend_src(0) c: vec4 = vec4(0.); } }',
          '@fragment export function fs(): S.FOut { return new S.FOut(); }',
          '',
        ].join('\n'),
      ).diagnostics.map((d) => `${d.code} ${d.message}`),
    ).toEqual([
      'TS8010 Struct "S.FOut" declares @blend_src(0) and not @blend_src(1); a dual-source blend ' +
        'mixes two colours, so both sit at the same @location.',
    ]);
  });

  it('the declaration sentences of a class in a namespace, and of a generic one', () => {
    // Each named the struct the class emits, `N_P` or `Slot_f32`, which the editor cannot find.
    const one = (decl: string, use: string): string[] => {
      const source = `"use typeshade";\n${decl}\nexport function k(${use}): f32 { return 1.; }\n`;
      const compiled = compile(source).diagnostics.map((d) => `${d.code} ${d.message}`);
      // The editor's list says the same (Rule 12.7); TypeScript's own word on the same
      // declaration, TS2300 or TS2392, is not this file's to judge.
      const service = createTypeshadeLanguageService();
      service.openDocument('t.ts', source);
      expect(
        service
          .getDiagnostics('t.ts')
          .filter((d) => d.source === 'typeshade')
          .map((d) => `${d.code} ${d.message}`),
      ).toEqual(compiled);
      return compiled;
    };
    const slot = (members: string): string =>
      `class Slot<T> { v: T; ${members} constructor(v: T) { this.v = v; } }`;
    // A second constructor is said once where the class is written, whatever instantiates it
    // (memberShapeSentences), so it names the class as its declaration writes it.
    expect(one(slot('constructor() {}'), 's: Slot<f32>')).toEqual([
      'TS8035 "Slot" declares two constructors; a shader function has one body.',
    ]);
    expect(one(slot('x: f32 = 0.; x: f32 = 1.;'), 's: Slot<f32>')).toEqual([
      'TS8010 Field "x" is declared twice on "Slot<f32>"; a struct has one member of a name.',
    ]);
    expect(one(slot('y;'), 's: Slot<f32>')).toEqual([
      'TS8010 Field "y" on "Slot<f32>" needs a type: write "y: T".',
    ]);
    const n = (members: string): string =>
      `namespace N { export class P { x: f32 = 0.; ${members} } }`;
    // Said where the class is written, and named as written there, `N.P`.
    expect(one(n('constructor() {} constructor(a: f32) {}'), 'p: N.P')).toEqual([
      'TS8035 "N.P" declares two constructors; a shader function has one body.',
    ]);
    expect(one(n('y?: f32;'), 'p: N.P')).toEqual([
      'TS8010 Optional field "y?" on "N.P" is not supported: a struct field is always present ' +
        'in the buffer the host fills.',
    ]);
    expect(one(n('#x: f32 = 1.;'), 'p: N.P')).toEqual([
      'TS8010 "N.P" declares "x" and "#x", which would both be the struct member "x": a private ' +
        'name is emitted without its "#". Rename one of them.',
    ]);
    expect(one(n('"a b": f32 = 0.;'), 'p: N.P')).toEqual([
      'TS8010 Field names on "N.P" must be plain identifiers: a WGSL struct member has no other ' +
        'spelling, and a quoted or computed name would not reach the emitted layout.',
    ]);
    expect(
      one(
        'namespace N { export class P { x: f32 = 0.; } export class P { y: f32 = 0.; } }',
        'p: N.P',
      ),
    ).toEqual([
      'TS8023 Struct "N.P" is declared more than once. A class, an interface and a type alias ' +
        'are three spellings of one struct, not declarations that merge — TypeScript would merge ' +
        'two interfaces, and the merged layout would disagree with this one at every use site.',
    ]);
    // An instance of a generic class is a base as it is written, `B<f32>`.
    expect(one('class B<T> { }\nclass C extends B<f32> { y: f32 = 0.; }', 'c: C')).toEqual([
      'TS8010 Struct "B<f32>" has no fields. WGSL requires a struct to declare at least one ' +
        'member, so an empty one cannot be emitted.',
      'TS8010 "C" extends "B<f32>", which this file does not declare as a struct. A base has ' +
        'to be a class or an interface whose fields are shader types.',
    ]);
    // The base is named as it is written, and the class that extends it as it is. A base
    // nothing declares is an unknown type (host-names.test.ts); one the file declares and does
    // not collect as a struct, an enum here, is the collector's sentence.
    expect(
      one(
        'enum Missing { A = 1 }\nnamespace N { export class Q extends Missing { y: f32 = 0.; } }',
        'q: N.Q',
      ),
    ).toEqual([
      'TS8010 "N.Q" extends "Missing", which this file does not declare as a struct. A base has ' +
        'to be a class or an interface whose fields are shader types.',
    ]);
    expect(
      one(
        [
          'function A<B extends new (...a: any[]) => object>(Base: B) {',
          '  return class extends Base { t: f32 = 0.; };',
          '}',
          'function C<B extends new (...a: any[]) => object>(Base: B) {',
          '  return class extends Base { t: i32 = 0; };',
          '}',
          'class Root { r: f32 = 0.; }',
          'namespace N { export class D extends A(C(Root)) { y: f32 = 0.; } }',
        ].join('\n'),
        'd: N.D',
      ),
    ).toEqual([
      'TS8099 "N.D" gets the field "t" twice through its mixins, written "i32" in one and "f32" ' +
        'in another. One of them decides the layout, and picking either silently would change ' +
        "what the other's code reads. Give them one type, or two names.",
    ]);
  });

  it('a struct two files declare, named as the author wrote it', () => {
    const twice = (decl: string, param: string): string[] =>
      compileTsSources(
        ['a.ts', 'b.ts'].map((fileName, i) => ({
          fileName,
          source: `"use typeshade";\n${decl}\nexport function f${String(i)}(${param}): f32 { return 1.; }\n`,
        })),
      ).diagnostics.map((d) => `${d.code} ${d.message}`);
    const rest =
      'is declared in both "a.ts" and "b.ts". A multi-file program is one module, so a name is ' +
      'declared once; rename one or move it.';
    expect(twice('namespace N { export class P { x: f32 = 0.; } }', 'p: N.P')).toEqual([
      `TS8023 Struct "N.P" ${rest}`,
    ]);
    expect(
      twice('class Slot<T> { v: T; constructor(v: T) { this.v = v; } }', 's: Slot<f32>'),
    ).toEqual([`TS8023 Struct "Slot<f32>" ${rest}`]);
  });

  it('a write to a binding whose type was refused says nothing more', () => {
    // The placeholder `mat2x3` printed as the f32 matrix it is not: "cannot assign to mat2x3
    // mat2x3 and mat2x3". The refusal at the declaration is the one mistake (Rule 12.4).
    expect(
      said(
        [
          'declare const mnd: storage<mat2x3<f64>, "read_write">;',
          'declare const vh: storage<array<vec2h>, "read_write">;',
          'declare const o: storage<array<f32>, "read_write">;',
          '@compute([1, 1, 1]) export function cs(): void {',
          '  mnd = mat2x3();',
          '  mnd *= 2.;',
          '  vh++;',
          '  let m = mnd;',
          '  o[0] = f32(m[0].x);',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      // A type name nothing declares is said before the lowering (semantic.ts), the matrix the
      // fp64 pass has no form for while the bindings are lowered.
      'TS8002 Unknown type "vec2h". Did you mean "vec2"?',
      'TS8027 mat2x3<f64> has no emulated-double form: the fp64 pass carries a square matrix of ' +
        'doubles only (mat2, mat3, mat4). Declare it mat2x3 and narrow, or use a square shape.',
    ]);
  });

  it('a function whose return reads such a binding does not return void to its caller', () => {
    // Its return type is the body's to say, and the body never said it: the caller was told
    // "cannot assign to f32 f32 and void" for a function that returns an f32 (Rule 12.4).
    const bindings = [
      'declare const vh: storage<array<vec2h>>;',
      'declare const mnd: storage<mat2x3<f64>>;',
      'declare const o: storage<array<f32>, "read_write">;',
    ].join('\n');
    const vec2h = 'TS8002 Unknown type "vec2h". Did you mean "vec2"?';
    const mat2x3 =
      'TS8027 mat2x3<f64> has no emulated-double form: the fp64 pass carries a square matrix of ' +
      'doubles only (mat2, mat3, mat4). Declare it mat2x3 and narrow, or use a square shape.';
    for (const [body, call] of [
      ['function g() { return vh[0].x; }', 'o[0] = g();'],
      ['function g(i: u32) { return f32(mnd[i].x); }', 'o[0] = g(u32(0)) * 2.;'],
      ['const g = () => vh[0].x;', 'o[0] = g();'],
      ['class K { w: f32 = 0.; get() { return vh[0].x; } }', 'o[0] = new K().get() + 1.;'],
    ] as const) {
      const lines = [bindings, body, `@compute([1, 1, 1]) export function cs(): void { ${call} }`];
      expect(said(lines.join('\n'))).toEqual([vec2h, mat2x3]);
      // The editor's list is the compiler's (Rule 12.7). TypeScript's own TS2315 on
      // `mat2x3<f64>` is not this file's to judge.
      const service = createTypeshadeLanguageService();
      service.openDocument('t.ts', `${classes}${lines.join('\n')}\n`);
      expect(
        service
          .getDiagnostics('t.ts')
          .filter((d) => d.source === 'typeshade')
          .map((d) => `${d.code} ${d.message}`),
      ).toEqual([vec2h, mat2x3]);
    }
  });

  it('a static of a generic class, called on a value, names the class with no type arguments', () => {
    // `Slot.m` is the class's, not the instance's, and was "Slot<f32>" has no method "m". The
    // call it names compiles; `Slot<f32>.m()` would be TS1477.
    const slot =
      'class Slot<T> { v: T; constructor(v: T) { this.v = v; } static m(): f32 { return 1.; } }';
    const source = (body: string): string =>
      `"use typeshade";\n${slot}\nexport function k(s: Slot<f32>): f32 { return ${body}; }\n`;
    expect(compile(source('s.m()')).diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8035 "Slot.m" is static; call it on the class: Slot.m(...).',
    ]);
    expect(compile(source('Slot.m()')).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('t.ts', source('Slot.m()'));
    expect(service.getDiagnostics('t.ts')).toEqual([]);
  });

  it('a module const whose annotation no call converts to names the annotation, which compiles', () => {
    // "Cast it, e.g. A(...)" named a call a class does not have, and `mat3x3<f64>(...)` and
    // `vec3u(u32(...))` are no module const either.
    expect(
      said(
        [
          'const K: A = sin(1.);',
          'const L: Slot<f32> = sin(1.);',
          'const M: vec3u = sin(1.);',
          'const Q: mat3x3<f64> = sin(1.);',
          'class Slot<T> { v: T; constructor(v: T) { this.v = v; } }',
          'export function k(): f32 { return 1.; }',
        ].join('\n'),
      ),
    ).toEqual([
      'TS8003 Module const "K" is A, but its initializer is f32. Change the annotation to f32.',
      'TS8003 Module const "L" is Slot<f32>, but its initializer is f32. Change the annotation ' +
        'to f32.',
      'TS8003 Module const "M" is vec3u, but its initializer is f32. Change the annotation to ' +
        'f32.',
      'TS8003 Module const "Q" is mat3x3<f64>, but its initializer is f32. Change the ' +
        'annotation to f32.',
    ]);
    expect(said('const K: f32 = sin(1.);\nexport function k(): f32 { return K; }')).toEqual([]);
    // A scalar keeps its cast, which is a module const.
    expect(said('const U: u32 = sin(1.);\nexport function k(): u32 { return U; }')).toEqual([
      'TS8003 Module const "U" is u32, but its initializer is f32. Cast it, e.g. u32(...), or ' +
        'change the annotation.',
    ]);
    expect(said('const U: u32 = u32(sin(1.));\nexport function k(): u32 { return U; }')).toEqual(
      [],
    );
  });

  it('an integer vector keeps the cast only where the splat is a module const', () => {
    // `vec3u(u32(floor(2.)))` is refused as not constant, so the conversion names the
    // annotation; a call that is already the element, `countOneBits(5)`, splats.
    const run = (line: string): string[] =>
      said(`${line}\nexport function k(): f32 { return 1.; }`);
    expect(run('const K: vec3u = u32(floor(2.));')).toEqual([
      'TS8003 Module const "K" is vec3u, but its initializer is u32. Change the annotation to ' +
        'u32.',
    ]);
    expect(run('const K: u32 = u32(floor(2.));')).toEqual([]);
    expect(run('const K: vec3i = i32(floor(2.));')).toEqual([
      'TS8003 Module const "K" is vec3i, but its initializer is i32. Change the annotation to ' +
        'i32.',
    ]);
    expect(run('const K: i32 = i32(floor(2.));')).toEqual([]);
    expect(run('const K: vec3i = countOneBits(5);')).toEqual([
      'TS8003 Module const "K" is vec3i, but its initializer is i32. Cast it, e.g. vec3i(...), ' +
        'or change the annotation.',
    ]);
    expect(run('const K: vec3i = vec3i(countOneBits(5));')).toEqual([]);
    // An f32 vector splats a conversion too, which lowers to the call it converts.
    expect(run('const K: vec3 = f32(floor(2.));')).toEqual([
      'TS8003 Module const "K" is vec3, but its initializer is f32. Cast it, e.g. vec3(...), or ' +
        'change the annotation.',
    ]);
    expect(run('const K: vec3 = vec3(f32(floor(2.)));')).toEqual([]);
  });
});
