// A user-defined input or output takes its location from the compiler (change 0135, decision
// D2.1): `uv: vec2` on an entry I/O struct, a bare vertex or fragment parameter, and a field of
// a fragment result write no `location<…>`, and `location<n, T>` stays to fix a number or to
// carry an option. Each program is read by both halves (Rule 12.7): `compile()` for the
// diagnostics, the emit and `reflect()`, the language service for its merged diagnostics.
//
// Verifies: Rule 6.6, Rule 6.8, Rule 8.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { reflect } from '../../core/reflect.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

interface Said {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  /** The text the diagnostic underlines. */
  readonly at: string;
}

const compiled = (source: string) => compile(source, { fileName: 'file:///a.shade.ts' });
const compilerSays = (source: string): Said[] =>
  compiled(source).diagnostics.map((d) => ({
    category: d.category,
    code: String(d.code),
    message: d.message,
    at: source.slice(d.start, d.start + d.length),
  }));
const offsetOf = (source: string, p: { line: number; character: number }): number =>
  source.split('\n').slice(0, p.line).join('\n').length + (p.line === 0 ? 0 : 1) + p.character;
const editorSays = (source: string): Said[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => ({
    category: d.severity,
    code: String(d.code),
    message: d.message,
    at: source.slice(offsetOf(source, d.range.start), offsetOf(source, d.range.end)),
  }));
};
/** Both halves say exactly `expected`, in order. */
const bothSay = (source: string, expected: readonly Said[]): void => {
  expect(compilerSays(source)).toEqual(expected);
  expect(editorSays(source)).toEqual(expected);
};
const error = (code: string, message: string, at: string): Said => ({
  category: 'error',
  code,
  message,
  at,
});
/** The emit and the host-facing report of a program that compiles. */
const emitOf = (source: string) => {
  const r = compiled(source);
  return { wgsl: r.wgsl, glsl: r.glsl, reflect: JSON.stringify(reflect(r.module)) };
};

// The example of the proposal, `examples/hello-vsout.shade.ts`, in both spellings.
const PROGRAM = (o: {
  uv: string;
  color: string;
  vsResult?: string;
  fsResult?: string;
}): string => `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: ${o.uv};
}
interface Color {
  color: ${o.color};
}
@vertex
export function vs(i: builtin<"vertex_index">)${o.vsResult ?? ': VsOut'} {
  const x = f32(i32(i) / 2) * 4. - 1.;
  const y = f32(i32(i) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}
@fragment
export function fs(v: VsOut)${o.fsResult ?? ': Color'} {
  return { color: vec4(v.uv.x, v.uv.y, 0.2, 1.) };
}
`;
const WRITTEN = PROGRAM({ uv: 'location<0, vec2>', color: 'location<0, vec4>' });
const GIVEN = PROGRAM({ uv: 'vec2', color: 'vec4' });

describe('a user-defined input or output takes its location from the compiler (change 0135)', () => {
  it('uv: vec2 and color: vec4 compile with no diagnostic in either half', () => {
    bothSay(GIVEN, []);
    const { wgsl, glsl } = compiled(GIVEN);
    expect(wgsl).toContain('  @location(0) uv: vec2<f32>,');
    expect(wgsl).toContain('  @location(0) color: vec4<f32>,');
    // GLSL ES 3.00 links a varying by its name, and a render target by its location.
    expect(glsl?.vertex).toContain('out vec2 uv;');
    expect(glsl?.fragment).toContain('in vec2 uv;');
    expect(glsl?.fragment).toContain('layout(location = 0) out vec4 color;');
  });

  it('the emit and reflect() are those of the written locations, byte for byte', () => {
    expect(emitOf(GIVEN)).toEqual(emitOf(WRITTEN));
  });

  it('an inferred result takes the same locations as a written one (Rule 8.19)', () => {
    const inferred = PROGRAM({ uv: 'vec2', color: 'vec4', vsResult: '', fsResult: '' });
    bothSay(inferred, []);
    expect(emitOf(inferred)).toEqual(emitOf(WRITTEN));
    // A bare result that is inferred is location 0, as a written one is (Rule 8.2).
    const bare = (result: string): string => `"use typeshade";
@fragment
export function fs()${result} {
  return vec4(1., 0., 0., 1.);
}
`;
    bothSay(bare(''), []);
    expect(compiled(bare('')).wgsl).toContain('fn fs() -> @location(0) vec4<f32>');
    expect(emitOf(bare(''))).toEqual(emitOf(bare(': vec4')));
  });

  it('a vertex attribute is numbered across the entry, in declaration order (Rule 6.8)', () => {
    const source = (a: string, b: string, c: string): string => `"use typeshade";
interface VsIn {
  position: ${a};
  uv: ${b};
}
@vertex
export function vs(v: VsIn, w: ${c}): vec4 {
  return vec4(v.position, w + v.uv.x);
}
`;
    const given = source('vec3', 'vec2', 'f32');
    bothSay(given, []);
    const r = compiled(given);
    expect(r.wgsl).toContain('  @location(0) position: vec3<f32>,');
    expect(r.wgsl).toContain('  @location(1) uv: vec2<f32>,');
    expect(r.wgsl).toContain('fn vs(v: VsIn, @location(2) w: f32)');
    expect(r.glsl?.vertex).toContain('layout(location = 2) in float a_w;');
    expect(reflect(r.module).vertex).toEqual({
      attributes: [
        expect.objectContaining({ name: 'position', location: 0, offset: 0 }),
        expect.objectContaining({ name: 'uv', location: 1, offset: 12 }),
        expect.objectContaining({ name: 'w', location: 2, offset: 20 }),
      ],
      arrayStride: 24,
    });
    expect(emitOf(given)).toEqual(
      emitOf(source('location<0, vec3>', 'location<1, vec2>', 'location<2, f32>')),
    );
  });

  it('a written number holds, and the given ones fill the places no written one holds', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  a: vec2;
  b: location<0, vec2>;
  c: vec2;
  d: location<2, vec2>;
  e: vec2;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), a: vec2(0.), b: vec2(0.), c: vec2(0.), d: vec2(0.), e: vec2(0.) };
}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(v.a + v.b + v.c + v.d, v.e);
}
`;
    bothSay(source, []);
    const { wgsl } = compiled(source);
    for (const line of [
      '@location(1) a: vec2<f32>,',
      '@location(0) b: vec2<f32>,',
      '@location(3) c: vec2<f32>,',
      '@location(2) d: vec2<f32>,',
      '@location(4) e: vec2<f32>,',
    ])
      expect(wgsl).toContain(line);
  });

  it('a fragment result is numbered in declaration order, one render target each', () => {
    const source = `"use typeshade";
interface Targets {
  color: vec4;
  normal: vec4;
  depth: builtin<"frag_depth">;
  id: u32;
}
@fragment
export function fs(): Targets {
  return { color: vec4(1.), normal: vec4(0.), depth: 0.5, id: 7 };
}
`;
    bothSay(source, []);
    const r = compiled(source);
    expect(r.wgsl).toContain('@location(0) color: vec4<f32>,');
    expect(r.wgsl).toContain('@location(1) normal: vec4<f32>,');
    expect(r.wgsl).toContain('@builtin(frag_depth) depth: f32,');
    expect(r.wgsl).toContain('@location(2) id: u32,');
    const io = reflect(r.module).entries.find((e) => e.name === 'fs')!.io;
    expect(io.outputs.map((o) => [o.name, o.location ?? o.builtin])).toEqual([
      ['color', 0],
      ['normal', 1],
      ['depth', 'frag_depth'],
      ['id', 2],
    ]);
  });

  it('an integer varying with a given location is flat on both writers (surface §53)', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  id: u32;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0.), id: i, uv: vec2(0.) };
}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(v.uv, f32(v.id), 1.);
}
`;
    bothSay(source, []);
    const { wgsl, glsl } = compiled(source);
    expect(wgsl).toContain('@location(0) @interpolate(flat) id: u32,');
    expect(wgsl).toContain('@location(1) uv: vec2<f32>,');
    expect(glsl?.vertex).toContain('flat out uint id;');
  });
});

describe('a fragment input is linked to the vertex results by its name (D2.1)', () => {
  const MIXED = (bn: string, extra = ''): string => `"use typeshade";
interface A {
  pos: builtin<"position">;
  uv: location<0, vec2>;
  n: vec3;
}
interface B {
  pos: builtin<"position">;
  n: ${bn};
}
${extra}
@vertex
export function va(): A {
  return { pos: vec4(0.), uv: vec2(0.), n: vec3(0.) };
}
@fragment
export function fb(v: B): vec4 {
  return vec4(v.n, 1.);
}
`;

  it("the mixed case: each struct keeps its written numbers, and B.n takes the name's", () => {
    const given = MIXED('vec3');
    bothSay(given, []);
    const { wgsl } = compiled(given);
    // `A.n` is the lowest number no written field of `A` holds, and `B.n` is where the vertex
    // results have `n`.
    expect(wgsl).toMatch(
      /struct A \{[^}]*@location\(0\) uv: vec2<f32>,\s*@location\(1\) n: vec3<f32>,/,
    );
    expect(wgsl).toMatch(/struct B \{[^}]*@location\(1\) n: vec3<f32>,/);
    expect(emitOf(given)).toEqual(emitOf(MIXED('location<1, vec3>')));
  });

  it('a bare fragment parameter takes the location its name has in the vertex result', () => {
    const source = (uv: string): string => `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  tint: vec3;
  uv: vec2;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), tint: vec3(1.), uv: vec2(0.) };
}
@fragment
export function fs(uv: ${uv}): vec4 {
  return vec4(uv, 0., 1.);
}
`;
    bothSay(source('vec2'), []);
    expect(compiled(source('vec2')).wgsl).toContain('fn fs(@location(1) uv: vec2<f32>)');
    expect(emitOf(source('vec2'))).toEqual(emitOf(source('location<1, vec2>')));
  });

  it('a name no vertex result has is the one TS8010, on the field or the parameter', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
interface FsIn {
  uv: vec2;
  n: vec3;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), uv: vec2(0.) };
}
@fragment
export function fs(v: FsIn, shade: f32): vec4 {
  return vec4(v.uv, v.n.x, shade);
}
`;
    bothSay(source, [
      error(
        'TS8010',
        '"FsIn.n" has no location and the vertex results give "n" none: write location<n, T> on it.',
        'n: vec3;',
      ),
      error(
        'TS8010',
        '"shade" has no location and the vertex results give "shade" none: write location<n, T> on it.',
        'shade: f32',
      ),
    ]);
  });

  it('a fragment entry in a file with no vertex entry writes its locations', () => {
    const source = (uv: string): string => `"use typeshade";
@fragment
export function fs(uv: ${uv}): vec4 {
  return vec4(uv, 0., 1.);
}
`;
    bothSay(source('vec2'), [
      error(
        'TS8010',
        '"uv" has no location and the vertex results give "uv" none: write location<n, T> on it.',
        'uv: vec2',
      ),
    ]);
    bothSay(source('location<0, vec2>'), []);
  });

  it('a name two vertex results put at two locations is the one TS8010', () => {
    const source = MIXED(
      'vec3',
      `interface C {
  pos: builtin<"position">;
  n: vec3;
}
@vertex
export function vc(): C {
  return { pos: vec4(0.), n: vec3(0.) };
}`,
    );
    bothSay(source, [
      error(
        'TS8010',
        '"B.n" has no location and the vertex results give "n" 0 in "C" and 1 in "A": write location<n, T> on it.',
        'n: vec3;',
      ),
    ]);
  });

  it('a location taken by name that another input wrote is refused as two written ones are', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
  n: vec3;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), uv: vec2(0.), n: vec3(0.) };
}
@fragment
export function fs(n: location<0, vec3>, uv: vec2): vec4 {
  return vec4(uv, n.x, 1.);
}
@fragment
export function other(v: VsOut): vec4 {
  return vec4(v.uv, v.n.x, 1.);
}
`;
    // Two fragment entries, so which pairs with the vertex entry is the host's choice, and the
    // interstage check says nothing: the slot is the one mistake.
    bothSay(source, [
      error(
        'TS8010',
        '"fs" puts "n" and "uv" both at location<0, …>; each slot carries one value.',
        'uv: vec2',
      ),
    ]);
  });
});

describe('what cannot take a location is refused once (D2.1)', () => {
  it('a bool field of an entry I/O struct is the one TS8003, though two entries use the struct', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  ok: bool;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), ok: true };
}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(v.ok ? 1. : 0.);
}
`;
    bothSay(source, [
      error(
        'TS8003',
        '"VsOut.ok" is at a location and is "bool"; a value passed between stages is a numeric scalar or a numeric vector. Send a u32 and compare it.',
        'ok: bool;',
      ),
    ]);
  });

  it('a bare parameter that is a matrix is TS8003', () => {
    const source = `"use typeshade";
@vertex
export function vs(m: mat4x4): vec4 {
  return m[0];
}
`;
    bothSay(source, [
      error(
        'TS8003',
        '"m" is at a location and is "mat4x4"; a value passed between stages is a numeric scalar or a numeric vector. Send its components as separate locations.',
        'm: mat4x4',
      ),
    ]);
  });

  it('a field that is a struct is TS8003', () => {
    const source = `"use typeshade";
interface Inner {
  a: f32;
}
interface VsOut {
  pos: builtin<"position">;
  inner: Inner;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), inner: { a: 1. } };
}
`;
    bothSay(source, [
      error(
        'TS8003',
        '"VsOut.inner" is at a location and is "Inner"; a value passed between stages is a numeric scalar or a numeric vector. Send its components as separate locations.',
        'inner: Inner;',
      ),
    ]);
  });

  it('a field two entries would number differently is the one TS8010', () => {
    const source = `"use typeshade";
interface S {
  a: vec2;
}
@vertex
export function v1(x: f32, s: S): vec4 {
  return vec4(s.a, x, 1.);
}
@vertex
export function v2(s: S): vec4 {
  return vec4(s.a, 0., 1.);
}
`;
    bothSay(source, [
      error(
        'TS8010',
        '"S.a" has no location and its uses give it 1 as an input of "v1" and 0 as an input of "v2": write location<n, T> on it.',
        'a: vec2;',
      ),
    ]);
  });

  it('a compute entry has no user-defined input: a bare parameter and a struct field are TS8029', () => {
    const bare = `"use typeshade";
@compute([64])
export function c(x: u32, id: builtin<"global_invocation_id">) {
  const y = x + id.x;
}
`;
    bothSay(bare, [
      error(
        'TS8029',
        '"x" is a user-defined input of a compute entry, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
        'x: u32',
      ),
    ]);
    const field = `"use typeshade";
interface In {
  id: builtin<"global_invocation_id">;
  x: u32;
}
@compute([64])
export function c(v: In) {
  const y = v.x + v.id.x;
}
`;
    bothSay(field, [
      error(
        'TS8029',
        'Struct "In" field "x" is a user-defined input and "In" is a compute entry input, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
        'v: In',
      ),
    ]);
    const located = bare.replace('x: u32', 'x: location<0, u32>');
    bothSay(located, [
      error(
        'TS8029',
        '"x" is at a location<…> on a compute entry, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
        'x: location<0, u32>',
      ),
    ]);
  });
});
