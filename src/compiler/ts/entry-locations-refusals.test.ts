// A field or parameter that cannot take a given location is refused once, and what reads it
// says nothing more. Each program is read by both halves (Rule 12.7).

import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';

const bothSay = (source: string): readonly string[] => {
  const { compiler, editor } = bothHalves(source);
  expect(editor).toEqual(compiler);
  return compiler;
};

describe('a user-defined value that cannot take a given location is refused once', () => {
  it('an f64 field of a vertex result is the one TS8038', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  d: f64;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), d: f64(1.) };
}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(f32(v.d));
}
`;
    const said = bothSay(source);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(
      /^typeshade TS8038: Struct "VsOut" field "d", a vertex output, carries f64/,
    );
  });

  it('a bare fragment parameter that is an f64 is the one TS8038', () => {
    const source = `"use typeshade";
@fragment
export function fs(d: f64): vec4 {
  return vec4(f32(d));
}
`;
    const said = bothSay(source);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^typeshade TS8038: Parameter "d" carries f64/);
  });

  it('a fragment input named after a refused vertex field says nothing more', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  ok: bool;
}
interface FsIn {
  ok: f32;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), ok: true };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.ok);
}
`;
    const said = bothSay(source);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^typeshade TS8003: "VsOut.ok" is at a location and is "bool"/);
  });

  it('a field that a fragment input numbers differently from its vertex input is the one TS8010', () => {
    const source = `"use typeshade";
interface S {
  a: vec2;
}
interface VsOut {
  pos: builtin<"position">;
  x: vec2;
  a: vec2;
}
@vertex
export function vs(s: S): VsOut {
  return { pos: vec4(0.), x: s.a, a: s.a };
}
@fragment
export function fs(s: S): vec4 {
  return vec4(s.a, 0., 1.);
}
`;
    const said = bothSay(source);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^typeshade TS8010: "S.a" has no location and its uses give it 0 /);
  });

  it('a given location that a written one of the same struct holds is the one TS8010', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  a: vec2;
}
interface FsIn {
  a: vec2;
  b: location<0, vec2>;
}
@vertex
export function vs(): VsOut {
  return { pos: vec4(0.), a: vec2(0.) };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.a + v.b, 0., 1.);
}
`;
    const said = bothSay(source);
    expect(said.filter((m) => m.includes('puts "a" and "b"'))).toHaveLength(1);
    expect(said[1]).toMatch(/^typeshade TS8010: Struct "FsIn" puts "a" and "b" both at location<0/);
  });
});
