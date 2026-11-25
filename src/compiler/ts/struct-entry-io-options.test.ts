import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';

const header = `"use typeshade"\n`;

describe('where an entry-IO option belongs, said once at the declaration', () => {
  it('invariant on a location is refused, since only the position builtin has the promise', () => {
    const line =
      'typeshade TS8010: The invariant option belongs on builtin<"position">: it is WGSL\'s ' +
      'promise that this position is computed the same way in two pipelines, and no other ' +
      'output has that meaning.';
    const halves = bothHalves(
      `${header}class V { a: location<0, vec4, { invariant: true }> = vec4(0.); pos: builtin<'position'> = vec4(0.); }
@vertex export function vs(): V { return new V(); }
`,
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('interpolate on a builtin of an interface is refused, as on a class', () => {
    const line =
      'typeshade TS8010: The interpolate option belongs on a location<…> field: it says how a ' +
      'VARYING is interpolated, and a builtin<…> carries its own rule.';
    const halves = bothHalves(
      `${header}interface V { a: builtin<'position', vec4, { interpolate: 'flat' }> }
@vertex export function vs(): V { return { a: vec4(0.) }; }
`,
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('a clip_distances member derives its capability whatever the struct is used for', () => {
    const halves = bothHalves(
      `${header}class V { c: builtin<'clip_distances', array<f32, 4>>; pos: builtin<'position'> = vec4(0.); }
@compute([1]) export function main(): void { }
`,
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
    expect(halves.result.wgsl).toContain('enable clip_distances;');
    expect(halves.result.wgsl).toContain('@builtin(clip_distances) c: array<f32, 4>,');
  });

  it('a dual-source pair is taken at any one location', () => {
    const halves = bothHalves(
      `${header}class O { a: location<1, vec4, { blend_src: 0 }> = vec4(0.); b: location<1, vec4, { blend_src: 1 }> = vec4(0.); }
@fragment export function fs(): O { return new O(); }
`,
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
    expect(halves.result.wgsl).toContain('@location(1) @blend_src(1) b: vec4<f32>,');
  });

  it('the type of a builtin is checked at the declaration, once, whether or not an entry uses it', () => {
    const wrong = (type: string, got: string): string =>
      `typeshade TS8003: Builtin "${type}" is "${got}"`;
    const unused = bothHalves(
      `${header}class V { vi: builtin<'vertex_index', f32>; }
@compute([1]) export function main(): void { }
`,
    );
    expect(unused.compiler).toEqual([`${wrong('vertex_index', 'u32')}; this declares it "f32".`]);
    expect(unused.editor).toContain(unused.compiler[0]);
    const used = bothHalves(
      `${header}class V { pos: builtin<'position', vec3>; }
@vertex export function vs(): V { return new V(); }
`,
    );
    expect(used.compiler).toEqual([`${wrong('position', 'vec4')}; this declares it "vec3".`]);
    expect(used.editor).toContain(used.compiler[0]);
  });

  it('a clip_distances member longer than WGSL allows is refused where it is declared', () => {
    const line =
      'typeshade TS8003: Builtin "clip_distances" is "array<f32, 9>"; WGSL gives it array<f32, N> with N from 1 to 8.';
    const halves = bothHalves(
      `${header}class V { c: builtin<'clip_distances', array<f32, 9>>; pos: builtin<'position'> = vec4(0.); }
@compute([1]) export function main(): void { }
`,
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });
});
