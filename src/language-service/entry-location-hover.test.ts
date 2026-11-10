// The hover on a user-defined input or output shows the location it stands at, written
// (`location<n, T>`) or given by the compiler (change 0135, amendment A1), so the author sees
// the number a host reads. Each program is read by both halves (Rule 12.7): `compile()` for the
// diagnostics, the emitted `@location(n)` and `reflect()`, the language service for the hover.
// Every hover's number is held to `reflect()`'s for the same source.
//
// Verifies: Rule 6.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { reflect } from '../core/reflect.js';
import { createTypeshadeLanguageService } from './service.js';

const compiled = (source: string) => compile(source, { fileName: 'file:///a.shade.ts' });
const codesOf = (source: string): string[] => compiled(source).diagnostics.map((d) => String(d.code));

/** The hover at the first `needle` of `source`, `skip` characters into it. */
const hover = (source: string, needle: string, skip = 0): string => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  const at = source.indexOf(needle);
  expect(at, `"${needle}" is in the source`).toBeGreaterThanOrEqual(0);
  const before = source.slice(0, at + skip).split('\n');
  const h = service.getHover('a.ts', {
    line: before.length - 1,
    character: before[before.length - 1]!.length,
  });
  return h?.contents ?? '';
};
/** A hover that is the signature alone: no line about a location. */
const bare = (signature: string): string => `\`\`\`ts\n${signature}\n\`\`\``;
/** A hover that is the signature and the line under it. */
const withLine = (signature: string, line: string): string => `${bare(signature)}\n\n${line}`;

/** `reflect()`'s location of the input or output `name` of the entry `entry`, which is
 *  `undefined` for a built-in value and for a value the front end gave no location. */
const reflected = (
  source: string,
  entry: string,
  side: 'inputs' | 'outputs',
  name: string,
): number | undefined => {
  const info = reflect(compiled(source).module).entries.find((e) => e.name === entry);
  expect(info, `entry "${entry}"`).toBeDefined();
  const field = info!.io[side].find((f) => f.name === name);
  expect(field, `${side} "${name}" of "${entry}"`).toBeDefined();
  return field!.location;
};

// The example of the proposal, `examples/hello-vsout.shade.ts`, with a helper that reads the
// struct the two entries share.
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
function shade(w: VsOut): f32 {
  return w.uv.x;
}
@vertex
export function vs(i: builtin<"vertex_index">)${o.vsResult ?? ': VsOut'} {
  const x = f32(i32(i) / 2) * 4. - 1.;
  const y = f32(i32(i) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}
@fragment
export function fs(v: VsOut)${o.fsResult ?? ': Color'} {
  return { color: vec4(v.uv.x, shade(v), 0.2, 1.) };
}
`;
const GIVEN = PROGRAM({ uv: 'vec2', color: 'vec4' });

describe('the hover shows the location of a user-defined input or output (change 0135)', () => {
  it('a field of a vertex result: the location the compiler gave it', () => {
    expect(codesOf(GIVEN)).toEqual([]);
    expect(compiled(GIVEN).wgsl).toContain('  @location(0) uv: vec2<f32>,');
    expect(reflected(GIVEN, 'vs', 'outputs', 'uv')).toBe(0);
    expect(hover(GIVEN, 'uv:')).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
  });

  it('the same struct as a fragment input: the declaration and a use say one thing', () => {
    expect(reflected(GIVEN, 'fs', 'inputs', 'uv')).toBe(0);
    const expected = withLine(
      '(property) VsOut.uv: vec2<f32>',
      'value between stages at @location(0)',
    );
    expect(hover(GIVEN, 'uv:')).toBe(expected);
    // `uv` of `v.uv`, in the fragment entry.
    expect(hover(GIVEN, 'v.uv', 2)).toBe(expected);
    // The field the vertex entry's result writes.
    expect(hover(GIVEN, 'uv: vec2(x')).toBe(expected);
  });

  it('a helper that reads the struct shows the field as the entries have it', () => {
    // `uv` of `w.uv`, in `shade`, which is no entry.
    expect(hover(GIVEN, 'w.uv', 2)).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
    // The helper's own parameter is a struct, which stands at no location.
    expect(hover(GIVEN, 'w:')).toBe(bare('(parameter) w: VsOut'));
  });

  it('a field of a fragment result: a render target', () => {
    expect(compiled(GIVEN).wgsl).toContain('  @location(0) color: vec4<f32>,');
    expect(reflected(GIVEN, 'fs', 'outputs', 'color')).toBe(0);
    expect(hover(GIVEN, 'color:')).toBe(
      withLine('(property) Color.color: vec4<f32>', 'render target at @location(0)'),
    );
  });

  it('a built-in value keeps its hover', () => {
    expect(reflected(GIVEN, 'vs', 'outputs', 'pos')).toBeUndefined();
    expect(reflected(GIVEN, 'vs', 'inputs', 'i')).toBeUndefined();
    expect(hover(GIVEN, 'pos:')).toBe(bare('(property) VsOut.pos: vec4<f32>'));
    expect(hover(GIVEN, 'i:')).toBe(bare('(parameter) i: u32'));
    // An entry that returns a struct, or the position, returns no bare render target.
    expect(hover(GIVEN, 'vs(')).toBe(bare('function vs(i: u32): VsOut'));
    expect(hover(GIVEN, 'fs(')).toBe(bare('function fs(v: VsOut): Color'));
  });

  it('a written location<n, T> is the location, with and without an option', () => {
    const written = PROGRAM({ uv: 'location<2, vec2>', color: 'location<1, vec4>' });
    expect(codesOf(written)).toEqual([]);
    expect(compiled(written).wgsl).toContain('  @location(2) uv: vec2<f32>,');
    expect(reflected(written, 'vs', 'outputs', 'uv')).toBe(2);
    expect(reflected(written, 'fs', 'inputs', 'uv')).toBe(2);
    expect(reflected(written, 'fs', 'outputs', 'color')).toBe(1);
    expect(hover(written, 'uv:')).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(2)'),
    );
    expect(hover(written, 'v.uv', 2)).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(2)'),
    );
    expect(hover(written, 'color:')).toBe(
      withLine('(property) Color.color: vec4<f32>', 'render target at @location(1)'),
    );

    const option = PROGRAM({
      uv: 'location<1, vec2, { interpolate: "flat" }>',
      color: 'vec4',
    });
    expect(codesOf(option)).toEqual([]);
    expect(compiled(option).wgsl).toContain('  @location(1) @interpolate(flat) uv: vec2<f32>,');
    expect(reflected(option, 'vs', 'outputs', 'uv')).toBe(1);
    expect(hover(option, 'uv:')).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(1)'),
    );
  });

  it('a given location fills the place no written one holds (the mixed case)', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
  n: location<0, vec3>;
  t: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.), n: vec3(0., 0., 1.), t: vec2(0., 0.) };
}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(v.n, v.uv.x + v.t.x);
}
`;
    expect(codesOf(source)).toEqual([]);
    expect(reflected(source, 'vs', 'outputs', 'uv')).toBe(1);
    expect(reflected(source, 'vs', 'outputs', 'n')).toBe(0);
    expect(reflected(source, 'vs', 'outputs', 't')).toBe(2);
    expect(hover(source, 'uv:')).toBe(
      withLine('(property) VsOut.uv: vec2<f32>', 'value between stages at @location(1)'),
    );
    expect(hover(source, 'n:')).toBe(
      withLine('(property) VsOut.n: vec3<f32>', 'value between stages at @location(0)'),
    );
    expect(hover(source, 't:')).toBe(
      withLine('(property) VsOut.t: vec2<f32>', 'value between stages at @location(2)'),
    );
  });

  it('an inferred result takes the same line as a written one (Rule 8.19)', () => {
    const inferred = PROGRAM({ uv: 'vec2', color: 'vec4', vsResult: '', fsResult: '' });
    expect(codesOf(inferred)).toEqual([]);
    expect(reflected(inferred, 'vs', 'outputs', 'uv')).toBe(0);
    expect(reflected(inferred, 'fs', 'outputs', 'color')).toBe(0);
    expect(hover(inferred, 'uv:')).toBe(hover(GIVEN, 'uv:'));
    expect(hover(inferred, 'v.uv', 2)).toBe(hover(GIVEN, 'v.uv', 2));
    expect(hover(inferred, 'color:')).toBe(hover(GIVEN, 'color:'));
  });

  it("a fragment entry's bare result, written or inferred: the render target it returns", () => {
    const source = (result: string): string => `"use typeshade";
@fragment
export function fs()${result} {
  return vec4(1., 0., 0., 1.);
}
`;
    for (const result of [': vec4', '']) {
      const s = source(result);
      expect(codesOf(s)).toEqual([]);
      expect(compiled(s).wgsl).toContain('fn fs() -> @location(0) vec4<f32>');
      expect(reflected(s, 'fs', 'outputs', '_ret')).toBe(0);
      expect(hover(s, 'fs(')).toBe(
        withLine('function fs(): vec4<f32>', 'returns a render target at @location(0)'),
      );
    }
  });

  it('a vertex attribute: a bare parameter and a field, numbered across the entry', () => {
    const source = `"use typeshade";
interface VsIn {
  position: vec3;
  uv: location<0, vec2>;
}
@vertex
export function vs(v: VsIn, w: f32): vec4 {
  return vec4(v.position, w + v.uv.x);
}
`;
    expect(codesOf(source)).toEqual([]);
    expect(compiled(source).wgsl).toContain('fn vs(v: VsIn, @location(2) w: f32)');
    expect(reflect(compiled(source).module).vertex?.attributes).toEqual([
      expect.objectContaining({ name: 'position', location: 1 }),
      expect.objectContaining({ name: 'uv', location: 0 }),
      expect.objectContaining({ name: 'w', location: 2 }),
    ]);
    expect(hover(source, 'position:')).toBe(
      withLine('(property) VsIn.position: vec3<f32>', 'vertex attribute at @location(1)'),
    );
    expect(hover(source, 'uv:')).toBe(
      withLine('(property) VsIn.uv: vec2<f32>', 'vertex attribute at @location(0)'),
    );
    // The declaration of the bare parameter, and a use of it.
    expect(hover(source, 'w:')).toBe(
      withLine('(parameter) w: f32', 'vertex attribute at @location(2)'),
    );
    expect(hover(source, 'w +')).toBe(
      withLine('(parameter) w: f32', 'vertex attribute at @location(2)'),
    );
    // A bare vertex result is the position, a built-in value.
    expect(hover(source, 'vs(')).toBe(bare('function vs(v: VsIn, w: f32): vec4<f32>'));
  });

  it('a fragment input takes the location of its name: a bare parameter and a field', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  n: vec3;
  uv: vec2;
}
interface FsIn {
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), n: vec3(0., 0., 1.), uv: vec2(f32(i), 0.) };
}
@fragment
export function fs(v: FsIn, n: vec3): vec4 {
  return vec4(n, v.uv.x);
}
`;
    expect(codesOf(source)).toEqual([]);
    expect(reflected(source, 'vs', 'outputs', 'uv')).toBe(1);
    expect(reflected(source, 'fs', 'inputs', 'uv')).toBe(1);
    expect(reflected(source, 'fs', 'inputs', 'n')).toBe(0);
    expect(hover(source, 'uv: vec2;\n}\n@')).toBe(
      withLine('(property) FsIn.uv: vec2<f32>', 'value between stages at @location(1)'),
    );
    expect(hover(source, 'n: vec3)')).toBe(
      withLine('(parameter) n: vec3<f32>', 'value between stages at @location(0)'),
    );
  });

  it('a struct that no entry uses: nothing about a location, unless the field writes one', () => {
    const source = `"use typeshade";
interface Pair {
  a: vec2;
  b: location<3, vec2>;
}
function sum(p: Pair, k: f32): f32 {
  return p.a.x + p.b.x + k;
}
@fragment
export function fs(): vec4 {
  const p: Pair = { a: vec2(1., 0.), b: vec2(0., 1.) };
  return vec4(sum(p, 1.), 0., 0., 1.);
}
`;
    expect(codesOf(source)).toEqual([]);
    // No entry's input or output is a field of `Pair`, so `reflect()` reports none of them.
    for (const e of reflect(compiled(source).module).entries)
      expect([...e.io.inputs, ...e.io.outputs].map((f) => f.name)).toEqual(['_ret']);
    expect(hover(source, 'a:')).toBe(bare('(property) Pair.a: vec2<f32>'));
    expect(hover(source, 'p.a', 2)).toBe(bare('(property) Pair.a: vec2<f32>'));
    // The written location is in the emitted struct, and the hover names it as what it is.
    expect(compiled(source).wgsl).toContain('  @location(3) b: vec2<f32>,');
    expect(hover(source, 'b:')).toBe(
      withLine('(property) Pair.b: vec2<f32>', 'user-defined input or output at @location(3)'),
    );
    expect(hover(source, 'p.b', 2)).toBe(
      withLine('(property) Pair.b: vec2<f32>', 'user-defined input or output at @location(3)'),
    );
    // A helper's parameter is no input of an entry.
    expect(hover(source, 'k:')).toBe(bare('(parameter) k: f32'));
  });

  it('a fragment input no vertex result names (TS8010): the hover invents no number', () => {
    const source = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
interface FsIn {
  n: vec3;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
@fragment
export function fs(v: FsIn, q: f32): vec4 {
  return vec4(v.n, v.uv.x + q);
}
`;
    expect(compiled(source).diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8010 "FsIn.n" has no location and the vertex results give "n" none: write location<n, T> on it.',
      'TS8010 "q" has no location and the vertex results give "q" none: write location<n, T> on it.',
    ]);
    expect(reflected(source, 'fs', 'inputs', 'n')).toBeUndefined();
    expect(reflected(source, 'fs', 'inputs', 'q')).toBeUndefined();
    expect(hover(source, 'n:')).toBe(bare('(property) FsIn.n: vec3<f32>'));
    expect(hover(source, 'v.n', 2)).toBe(bare('(property) FsIn.n: vec3<f32>'));
    expect(hover(source, 'q:')).toBe(bare('(parameter) q: f32'));
    // The field beside it, which a vertex result names, has its location.
    expect(reflected(source, 'fs', 'inputs', 'uv')).toBe(0);
    expect(hover(source, 'uv: vec2;\n}\n@')).toBe(
      withLine('(property) FsIn.uv: vec2<f32>', 'value between stages at @location(0)'),
    );
  });

  it('a field two places number differently (TS8010): the hover invents no number', () => {
    const source = `"use typeshade";
interface S {
  a: vec2;
}
@vertex
export function v1(p: f32, s: S): vec4 {
  return vec4(s.a, p, 1.);
}
@vertex
export function v2(s: S): vec4 {
  return vec4(s.a, 0., 1.);
}
`;
    expect(compiled(source).diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8010 "S.a" has no location and its uses give it 1 as an input of "v1" and 0 as an input of "v2": write location<n, T> on it.',
    ]);
    expect(reflected(source, 'v1', 'inputs', 'a')).toBeUndefined();
    expect(reflected(source, 'v2', 'inputs', 'a')).toBeUndefined();
    expect(hover(source, 'a:')).toBe(bare('(property) S.a: vec2<f32>'));
    expect(hover(source, 's.a', 2)).toBe(bare('(property) S.a: vec2<f32>'));
    // The bare parameter beside it is numbered.
    expect(reflected(source, 'v1', 'inputs', 'p')).toBe(0);
    expect(hover(source, 'p:')).toBe(
      withLine('(parameter) p: f32', 'vertex attribute at @location(0)'),
    );
  });

  it('a struct in two places says both', () => {
    const source = `"use typeshade";
interface V {
  p: vec4;
}
@fragment
export function fs(v: V): V {
  return { p: v.p };
}
@vertex
export function vs(i: builtin<"vertex_index">): vec4 {
  return vec4(f32(i), 0., 0., 1.);
}
`;
    // The compiler numbers `p` as a render target, and the interstage check then refuses the
    // input by that number. The hover names the number the diagnostic and `reflect()` name.
    expect(compiled(source).diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8010 V.p reads @location(0), which "vs" does not produce.',
    ]);
    expect(reflected(source, 'fs', 'outputs', 'p')).toBe(0);
    expect(hover(source, 'p:')).toBe(
      withLine(
        '(property) V.p: vec4<f32>',
        'value between stages and render target at @location(0)',
      ),
    );

    // A struct that is a vertex entry's input and a fragment entry's input, with one number.
    const shared = `"use typeshade";
interface V {
  p: vec4;
}
interface Out {
  pos: builtin<"position">;
  p: vec4;
}
@vertex
export function vs(a: V): Out {
  return { pos: a.p, p: a.p };
}
@fragment
export function fs(v: V): vec4 {
  return v.p;
}
`;
    expect(codesOf(shared)).toEqual([]);
    expect(reflected(shared, 'vs', 'inputs', 'p')).toBe(0);
    expect(reflected(shared, 'fs', 'inputs', 'p')).toBe(0);
    expect(hover(shared, 'p:')).toBe(
      withLine(
        '(property) V.p: vec4<f32>',
        'vertex attribute and value between stages at @location(0)',
      ),
    );
  });
});
