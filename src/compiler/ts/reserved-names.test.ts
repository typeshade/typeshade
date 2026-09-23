// A name a target reserves, reported where it is written (#103). Before this, the author got a
// line number in text they never wrote:
//
//   glsl: fragment: ERROR: 0:16: 'half' : Illegal use of reserved word
//
// Every expectation below was measured on the compilers that receive the emit, through the
// compile gate's own instrument (Chromium: Tint for WGSL, a real WebGL2 context for GLSL):
//
//   WGSL on Tint      var discard: f32   REFUSED  expected identifier for variable declaration
//                     var as: f32        REFUSED  'as' is a reserved keyword
//                     var filter: f32    REFUSED  'filter' is a reserved keyword
//                     var __x: f32       REFUSED  identifiers must not start with two or more underscores
//                     struct S { half }  accepted — WGSL does not reserve `half`
//                     const half: f32    accepted
//   GLSL ES 3.00      struct { vec2 half }   REFUSED  'half' : Illegal use of reserved word
//   on ANGLE          float filter           REFUSED  'filter' : Illegal use of reserved word
//                     float image2D          REFUSED  'image2D' : Illegal use of reserved word
//                     float sample           REFUSED  'sample' : Illegal use of reserved word
//                     float input            REFUSED  'input' : Illegal use of reserved word
//                     float buffer           accepted — an ES 3.10 keyword, free at 300
//                     float shared           accepted — the same
//                     float packed           accepted — reserved in ES 1.00, free at 300
//                     float gl_Scale         REFUSED  'gl_' : reserved built-in name
//                     float a__b             REFUSED  identifiers containing two consecutive
//                                                     underscores (__) are reserved …
//
// `buffer`, `shared` and `packed` are why `GLSL_ES300_RESERVED` is read off ANGLE's
// version-gated lexer rather than off a later spec: refusing them would refuse programs that
// compile. The last two rows are that section's SHAPE rules, which have no word list.
//
// SEVERITY. A WGSL word is an error — WGSL is the program. A GLSL ES 3.00 one is a warning,
// which is this package's existing answer for "the second target cannot take this module"
// (`compile.ts`): `wgsl` stays, `glsl` comes back undefined, and `sanitizeReservedIdents`
// fails the GLSL emit closed on the same names so nothing illegal is ever handed to a driver.
//
// Verifies: Rule 3.2, Rule 3.3, Rule 3.4, Rule 12.3 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

const ofCategory = (src: string, category: 'error' | 'warning') =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === category)
    .map((d) => `${d.code} ${d.message}`);

const errorsOf = (src: string) => ofCategory(src, 'error');
const warningsOf = (src: string) => ofCategory(src, 'warning');

/** The source text the first diagnostic underlines. */
const underlines = (src: string): string => {
  const d = compileTsSource(src).diagnostics[0];
  if (!d) throw new Error('expected a diagnostic');
  return src.slice(d.start, d.start + d.length);
};

const GLSL = (quoted: string, noun: string) =>
  `${TS_CODES.RESERVED_NAME} ${quoted} is reserved in GLSL ES 3.00, so ${noun} of that name cannot be emitted for the WebGL2 target. Rename it.`;
const WGSL = (quoted: string, noun: string) =>
  `${TS_CODES.RESERVED_NAME} ${quoted} is reserved in WGSL, so ${noun} of that name cannot be emitted for the WebGPU target. Rename it.`;

const render = (decls: string, body = 'return vec4(1., 0., 0., 1.)') => `"use typeshade"
${decls}
@fragment
export function fs(): vec4 { ${body} }
`;

describe('GLSL ES 3.00 reserves the name, and the module has a GLSL form (#103)', () => {
  it('reports a struct field named half, on the field', () => {
    const src = `"use typeshade";
class V {
  @builtin("position") pos: vec4;
  @location(0) half: vec2;
}
@vertex
export function vs(): V { return { pos: vec4(0., 0., 0., 1.), half: vec2(0., 0.) }; }
@fragment
export function fs(v: V): vec4 { return vec4(v.half, 0., 1.); }
`;
    expect(warningsOf(src)).toContain(GLSL('"half"', 'a field'));
    expect(errorsOf(src)).toEqual([]);
    expect(underlines(src)).toBe('half');
    // The module still compiles for WebGPU, and the GLSL emit refuses it rather than handing
    // ANGLE a reserved word: the same shape as every other second-target shortfall.
    const r = compile(src);
    expect(r.wgsl).toContain('half');
    expect(r.glsl).toBeUndefined();
  });

  it.each([
    ['interface S { half: f32, rest: f32 }', '"half"'],
    ['type S = { half: f32, rest: f32 }', '"half"'],
  ])('reads a struct spelled %s too', (decl, quoted) => {
    // A class, an interface and a type alias are three spellings of one struct and the writers
    // spell all three the same way, so all three have to reach the declared-symbol table.
    const src = `"use typeshade"
${decl}
declare const cam: uniform<S>
@fragment
export function fs(): vec4 { return vec4(cam.half + cam.rest, 0., 0., 1.) }
`;
    expect(warningsOf(src)).toContain(GLSL(quoted, 'a field'));
  });

  it('reads the two shape rules §3.6 has beside its word list', () => {
    expect(warningsOf(render('const gl_Scale: f32 = 2.'))).toContain(
      `${TS_CODES.RESERVED_NAME} "gl_Scale" begins with "gl_", which GLSL ES 3.00 keeps for built-ins, so a module constant of that name cannot be emitted for the WebGL2 target. Rename it.`,
    );
    expect(warningsOf(render('const a__b: f32 = 2.'))).toContain(
      `${TS_CODES.RESERVED_NAME} "a__b" has two consecutive underscores, which GLSL ES 3.00 reserves for future keywords, so a module constant of that name cannot be emitted for the WebGL2 target. Rename it.`,
    );
  });

  it.each([
    ['const half: f32 = 0.5', '"half"', 'a module constant'],
    ['declare const half: uniform<f32>', '"half"', 'a binding'],
    ['declare const half: override<f32>', '"half"', 'an override'],
    ['let input: f32 = 0.', '"input"', 'a module variable'],
  ])('reports %s', (decl, quoted, noun) => {
    expect(warningsOf(render(decl))).toContain(GLSL(quoted, noun));
    expect(errorsOf(render(decl))).toEqual([]);
  });

  it('reports a struct whose own name is reserved, as an error since WGSL reserves it too', () => {
    // `Self` is on WGSL's list, and WGSL is every module's target, so WGSL is what answers.
    // A capitalized word keeps this to ONE diagnostic: a lowercase class name does not resolve
    // as a type here at all, which is a separate, pre-existing TS8002.
    const src = `"use typeshade";
class Self {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(): Self { return { pos: vec4(0., 0., 0., 1.) }; }
`;
    expect(errorsOf(src)).toEqual([WGSL('"Self"', 'a struct')]);
  });
});

describe('WGSL reserves the name (#103)', () => {
  it.each([
    ['let as: f32 = 1.; return vec4(as, 0., 0., 1.)', '"as"', 'a local'],
    ['let discard: f32 = 1.; return vec4(discard, 0., 0., 1.)', '"discard"', 'a local'],
  ])('refuses %s', (body, quoted, noun) => {
    expect(errorsOf(render('', body))).toEqual([WGSL(quoted, noun)]);
  });

  it('refuses a parameter', () => {
    expect(
      errorsOf(`"use typeshade";
export function g(as: f32): f32 { return as; }
@fragment
export function fs(): vec4 { return vec4(g(1.), 0., 0., 1.); }
`),
    ).toEqual([WGSL('"as"', 'a parameter')]);
  });

  it('refuses the two shapes the spec rules out beside the word lists', () => {
    expect(errorsOf(render('', 'let __t: f32 = 1.; return vec4(__t, 0., 0., 1.)'))).toEqual([
      `${TS_CODES.RESERVED_NAME} "__t" begins with two underscores, which WGSL reserves, so a local of that name cannot be emitted for the WebGPU target. Rename it.`,
    ]);
    expect(errorsOf(render('', 'let _: f32 = 1.; return vec4(_, 0., 0., 1.)'))).toEqual([
      `${TS_CODES.RESERVED_NAME} "_" is WGSL's phony assignment target, not an identifier, so a local of that name cannot be emitted for the WebGPU target. Rename it.`,
    ]);
  });
});

describe('the name that reaches the backend is the FLATTENED one (#103)', () => {
  it('names both spellings for a static field, whose emitted name is Cls_member', () => {
    const src = `"use typeshade";
class atomic { static uint: u32 = 1; }
@fragment
export function fs(): vec4 { return vec4(f32(atomic.uint), 0., 0., 1.); }
`;
    expect(warningsOf(src)).toContain(
      `${TS_CODES.RESERVED_NAME} "uint" is emitted as "atomic_uint", which is reserved in GLSL ES 3.00, so this module constant cannot be emitted for the WebGL2 target. Rename it.`,
    );
    // On the member the author wrote, not on the spelling only the emit has.
    expect(underlines(src)).toBe('uint');
  });

  it('does the same for a namespace member, and for a WGSL word', () => {
    expect(
      errorsOf(`"use typeshade";
namespace thread { export const local: f32 = 1.; }
@fragment
export function fs(): vec4 { return vec4(thread.local, 0., 0., 1.); }
`),
    ).toEqual([
      `${TS_CODES.RESERVED_NAME} "local" is emitted as "thread_local", which is reserved in WGSL, so this module constant cannot be emitted for the WebGPU target. Rename it.`,
    ]);
  });

  it('leaves a flattened name that is NOT reserved alone', () => {
    // A class `S` with a static `half` is `S_half`, which neither target reserves. The written
    // name alone would have refused it — which is the reason the check reads the emitted one.
    const r = compile(`"use typeshade";
class S { static half: f32 = 0.5; }
@fragment
export function fs(): vec4 { return vec4(S.half, 0., 0., 1.); }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('S_half');
  });
});

describe('the GLSL rename never lands on a name already in scope (#103)', () => {
  it('numbers the suffix instead of colliding with a module const', () => {
    // `float` is renamed for GLSL; the old suffix loop knew only the function's own names, so
    // it produced a second `float_` beside the module const of that name and the GLSL answered
    // 4 where WGSL and the CPU oracle answered 12 — compiling cleanly, with no diagnostic. The
    // enlarged word list is what made this reachable for the type names.
    const r = compile(`"use typeshade";
const float_: f32 = 10.;
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let float = uv.x * 2.;
  float = float + 1.;
  return vec4(float + float_, 0., 0., 1.);
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.glsl?.fragment).toContain('float float_1 = (uv.x * 2.0);');
    expect(r.glsl?.fragment).toContain('(float_1 + float_)');
    // 0.5 * 2 + 1 + 10, the answer all three backends now agree on.
    expect(r.eval('fs', [[0.5, 0]])).toEqual([12, 0, 0, 1]);
  });

  it('never spells a rename with two underscores, which ANGLE reserves', () => {
    // Measured: `float__` is "identifiers containing two consecutive underscores (__) are
    // reserved as possible future keywords", so repeating the underscore walked out of one
    // rule of §3.6 into another.
    const r = compile(`"use typeshade";
const float_: f32 = 1.;
const float_1: f32 = 2.;
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let float = uv.x;
  return vec4(float + float_ + float_1, 0., 0., 1.);
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.glsl?.fragment).not.toMatch(/__/);
    expect(r.glsl?.fragment).toContain('float_2');
  });

  it('renames a helper named main, which is the entry point GLSL emits', () => {
    const r = compile(`"use typeshade";
export function main(x: f32): f32 { return x * 2.; }
@fragment
export function fs(@location(0) uv: vec2): vec4 { return vec4(main(uv.x), 0., 0., 1.); }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.glsl?.fragment).toContain('float main_(float x)');
    expect(r.glsl?.fragment).toContain('main_(uv.x)');
    // One `void main()`, the stage entry, and nothing else called that.
    expect(r.glsl?.fragment?.match(/\bmain\s*\(/g)).toEqual(['main(']);
  });
});

describe('a module the target never reaches is not held to its list (#103)', () => {
  it('keeps a field named half in a compute-only module, which emits no GLSL', () => {
    const r = compile(`"use typeshade";
declare let sink: storage<array<f32>>;
class P { half: f32; }
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  const p: P = { half: 2. };
  sink[gid.x] = p.half;
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // Measured: Tint accepts `half` as a struct member; GLSL ES 3.00 is not a target here.
    expect(r.wgsl).toContain('half');
    expect(r.glsl).toBeUndefined();
  });

  it('keeps the names the GLSL writer renames for itself', () => {
    // `out` and `in` are GLSL keywords, and `sanitizeReservedIdents` rewrites a local, a
    // parameter and a function name consistently with every reference — so these have always
    // compiled and still do. Only the module surface it cannot rename is refused above.
    const r = compile(render('', 'let out: f32 = 1.; return vec4(out, 0., 0., 1.)'));
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.glsl?.fragment).toContain('out_');
    expect(r.wgsl).toContain('out');
  });
});
