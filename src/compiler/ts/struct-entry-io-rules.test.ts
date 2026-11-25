import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';

const header = `"use typeshade"\n`;
const fragment = (declarations: string, parameter: string): string =>
  `${header}${declarations}\n@fragment export function fs(i: ${parameter}): vec4 { return vec4(0.); }\n`;

const bothRead = (source: string, expected: readonly string[]): void => {
  const halves = bothHalves(source);
  expect(halves.compiler).toEqual(expected);
  for (const line of expected) expect(halves.editor).toContain(line);
};

const collision = (struct: string, a: string, b: string): string =>
  `typeshade TS8010: Struct "${struct}" puts "${a}" and "${b}" both at location<0, …>; each slot carries one value.`;

const dualSource = (struct: string): string =>
  `typeshade TS8010: Struct "${struct}" declares { blend_src: 0 } and not { blend_src: 1 }; a dual-source blend mixes two colours, so both sit at the same location<…>.`;

const numeric = (field: string, type: string): string =>
  `typeshade TS8003: "${field}" is at a location and is "${type}"; a value passed between stages is a numeric scalar or a numeric vector. Send a u32 and compare it.`;

describe('two members at one location', () => {
  it('are refused once for a struct that the vertex stage returns and the fragment stage takes', () => {
    const source = `${header}class V { a: location<0, vec4> = vec4(0.); b: location<0, vec4> = vec4(0.); pos: builtin<'position'> = vec4(0.); }
@vertex export function vs(): V { return new V(); }
@fragment export function fs(i: V): vec4 { return i.a; }
`;
    const halves = bothHalves(source);
    const same = halves.compiler.filter((line) => line === collision('V', 'a', 'b'));
    expect(same).toHaveLength(1);
    expect(halves.editor.filter((line) => line === collision('V', 'a', 'b'))).toHaveLength(1);
  });

  it('are found across a base and the class that extends it', () => {
    const halves = bothHalves(
      fragment(
        `class Base { a: location<0, vec4> = vec4(0.); }
class V extends Base { b: location<0, vec4> = vec4(0.); }`,
        'V',
      ),
    );
    expect(halves.compiler).toEqual([collision('V', 'a', 'b')]);
    expect(halves.editor).toContain(collision('V', 'a', 'b'));
  });

  it('are named as the author writes the class in a namespace', () => {
    bothRead(
      fragment(
        `namespace N { export class V { a: location<0, vec4> = vec4(0.); b: location<0, vec4> = vec4(0.); } }`,
        'N.V',
      ),
      [collision('N.V', 'a', 'b')],
    );
  });

  it('are named for each instance of a generic class, as the author writes it', () => {
    const halves = bothHalves(
      `${header}class V<T> { a: location<0, vec4> = vec4(0.); b: location<0, vec4> = vec4(0.); }
@fragment export function fs(i: V<f32>, j: V<vec3>): vec4 { return i.a; }
`,
    );
    expect(halves.compiler).toEqual([
      collision('V<f32>', 'a', 'b'),
      collision('V<vec3>', 'a', 'b'),
    ]);
    expect(halves.editor).toContain(collision('V<vec3>', 'a', 'b'));
  });

  it('are refused on an exported interface that nothing in the file uses', () => {
    bothRead(`${header}export interface V { a: location<0, vec4>; b: location<0, vec4> }\n`, [
      collision('V', 'a', 'b'),
    ]);
  });

  it('are left alone on an exported interface whose fields are not all shader types', () => {
    bothRead(
      `${header}export interface Config { seed: number; a: location<0, vec4>; b: location<0, vec4> }\n`,
      [],
    );
  });

  it('are left alone on an exported interface that extends another', () => {
    bothRead(
      `${header}export interface B { a: location<0, vec4> }
export interface V extends B { b: location<0, vec4>; c: location<0, vec4> }\n`,
      [],
    );
  });

  it('are left alone on an interface that nothing uses and nothing exports', () => {
    bothRead(`${header}interface V { a: location<0, vec4>; b: location<0, vec4> }\n`, []);
  });
});

describe('a dual-source blend pair', () => {
  const pair = (second: string): string =>
    fragment('', 'vec4').replace(
      '@fragment',
      `class O { a: location<0, vec4, { blend_src: 0 }> = vec4(0.); b: ${second} = vec4(0.); }
@fragment`,
    );

  it('at one location is taken, and emits the extension and both sources', () => {
    const halves = bothHalves(
      `${header}class O { a: location<0, vec4, { blend_src: 0 }> = vec4(0.); b: location<0, vec4, { blend_src: 1 }> = vec4(0.); }
@fragment export function fs(): O { return new O(); }
`,
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
    const text = halves.result.wgsl ?? '';
    expect(text).toContain('enable dual_source_blending;');
    expect(text).toContain('@location(0) @blend_src(0) a: vec4<f32>,');
    expect(text).toContain('@location(0) @blend_src(1) b: vec4<f32>,');
  });

  it('is not a slot collision, though both members sit at location 0', () => {
    const source = pair('location<0, vec4, { blend_src: 1 }>');
    expect(bothHalves(source).compiler.filter((line) => line.includes('both at location'))).toEqual(
      [],
    );
  });

  it('with one source alone is refused, for a class and for an interface', () => {
    bothRead(
      `${header}class O { a: location<0, vec4, { blend_src: 0 }> = vec4(0.); }
@fragment export function fs(): O { return new O(); }
`,
      [dualSource('O')],
    );
    bothRead(`${header}export interface O { a: location<0, vec4, { blend_src: 0 }> }\n`, [
      dualSource('O'),
    ]);
  });
});

describe('the type of a value that is passed between stages', () => {
  it('a bool at a location is refused for a class and for an interface', () => {
    bothRead(
      `${header}class V { a: location<0, bool> = false; }
@fragment export function fs(i: V): vec4 { return vec4(0.); }
`,
      [numeric('V.a', 'bool')],
    );
    bothRead(`${header}export interface V { a: location<0, bool> }\n`, [numeric('V.a', 'bool')]);
  });

  it('a bool at a location is refused once when both stages use the struct', () => {
    const halves = bothHalves(
      `${header}class V { a: location<0, bool> = false; pos: builtin<'position'> = vec4(0.); }
@vertex export function vs(): V { return new V(); }
@fragment export function fs(i: V): vec4 { return vec4(0.); }
`,
    );
    expect(halves.compiler).toEqual([numeric('V.a', 'bool')]);
    expect(halves.editor).toContain(numeric('V.a', 'bool'));
  });

  it('an optional value at a location is refused', () => {
    const halves = bothHalves(`${header}export interface V { a?: location<0, vec4>; }\n`);
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toContain('"V.a" is at a location and is "vec4 | undefined"');
    expect(halves.editor).toContain(halves.compiler[0]);
  });

  it('a clip_distances builtin with no array type is refused where it is declared', () => {
    const line =
      'typeshade TS8003: Builtin "clip_distances" has no single type: write ' +
      'builtin<"clip_distances", array<f32, N>> with N from 1 to 8.';
    const halves = bothHalves(
      `${header}class V { c: builtin<'clip_distances'>; }
@compute([1]) export function main(): void { }
`,
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });
});

describe('entry-IO options', () => {
  it('interpolate rides a location, and is emitted with it', () => {
    const halves = bothTake(
      `${header}class V { a: location<0, vec4, { interpolate: 'flat' }> = vec4(0.); pos: builtin<'position'> = vec4(0.); }
@vertex export function vs(): V { return new V(); }
`,
    );
    expect(halves.result.wgsl).toContain('@location(0) @interpolate(flat) a: vec4<f32>,');
  });

  it('invariant rides the position builtin, and is emitted with it', () => {
    const halves = bothHalves(
      `${header}class V { pos: builtin<'position', vec4, { invariant: true }> = vec4(0.); }
@vertex export function vs(): V { return new V(); }
`,
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.result.wgsl).toContain('@invariant @builtin(position) pos: vec4<f32>,');
  });

  it('interpolate on a builtin is refused where it is written', () => {
    const line =
      'typeshade TS8010: The interpolate option belongs on a location<…> field: it says how a ' +
      'VARYING is interpolated, and a builtin<…> carries its own rule.';
    const halves = bothHalves(
      `${header}class V { @builtin('position') @interpolate('flat') a: vec4 = vec4(0.); }
@vertex export function vs(): V { return new V(); }
`,
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('an interface field carries an attribute in its type alone', () => {
    const halves = bothTake(
      `${header}interface V { pos: builtin<'position'>; c: location<0, vec4> }
@vertex export function vs(): V { return { pos: vec4(0.), c: vec4(0.) }; }
`,
    );
    expect(halves.result.wgsl).toContain('@builtin(position) pos: vec4<f32>,');
    expect(halves.result.wgsl).toContain('@location(0) c: vec4<f32>,');
  });
});
