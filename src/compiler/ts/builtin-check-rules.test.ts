import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const USE = '"use typeshade"\n';

const varying = (field: string, value: string): string =>
  `${USE}interface VsOut { pos: builtin<"position">; ${field} }
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.), ${value} } }
@fragment export function fs(v: VsOut): vec4 { return vec4(1.) }`;

const interpolated = (type: string, interpolate: string, value: string): string =>
  varying(`u: location<0, ${type}, { interpolate: ${interpolate} }>`, `u: ${value}`);

const clipOutput = (type: string): string =>
  `${USE}interface VsOut { pos: builtin<"position">; c: builtin<"clip_distances", ${type}> }
@vertex export function vs(): VsOut { return { pos: vec4(0.), c: ${type}() } }`;

const frontEndTakes = (source: string): void => {
  const halves = bothHalves(source);
  expect(halves.result.diagnostics.filter((d) => d.code !== 'TS8015')).toEqual([]);
  expect(halves.editor).toEqual([]);
};

const onlySentence = (source: string, code: string, sentence: string): void => {
  const halves = bothHalves(source);
  const line = `typeshade ${code}: ${sentence}`;
  expect(halves.compiler).toEqual([line]);
  expect(halves.editor.filter((d) => d === line)).toEqual([line]);
};

describe('an interpolation sampling is one the interpolation type admits', () => {
  it.each([
    ['flat', '"flat"', 'a bare type'],
    ['flat', '["flat", "first"]', 'first'],
    ['flat', '["flat", "either"]', 'either'],
    ['perspective', '["perspective", "center"]', 'center'],
    ['perspective', '["perspective", "centroid"]', 'centroid'],
    ['perspective', '["perspective", "sample"]', 'sample'],
    ['linear', '["linear", "center"]', 'center'],
    ['linear', '["linear", "centroid"]', 'centroid'],
    ['linear', '["linear", "sample"]', 'sample'],
  ])('both halves take %s with %s (%s)', (_type, interpolate) => {
    frontEndTakes(interpolated('f32', interpolate, '1.'));
  });

  it.each([
    ['flat', 'center'],
    ['flat', 'centroid'],
    ['flat', 'sample'],
    ['perspective', 'first'],
    ['perspective', 'either'],
    ['linear', 'first'],
    ['linear', 'either'],
  ])('both halves refuse %s with %s', (type, sampling) => {
    const samplings = type === 'flat' ? 'first or either' : 'center or centroid or sample';
    bothRefuse(
      interpolated('f32', `["${type}", "${sampling}"]`, '1.'),
      'TS8028',
      `interpolate type "${type}" takes the sampling ${samplings}, not "${sampling}".`,
    );
  });

  it('refuses an interpolation type WGSL does not have, naming the three it has', () => {
    onlySentence(
      interpolated('f32', '"smooth"', '1.'),
      'TS8028',
      'interpolate type "smooth" is not one WGSL has: perspective, linear, flat.',
    );
  });
});

describe('an interpolate attribute is read once, as one mistake', () => {
  const arity =
    'interpolate takes a type, and optionally a sampling, as strings: ' +
    '{ interpolate: "flat" } or { interpolate: ["linear", "centroid"] }.';

  it('refuses three arguments with one sentence from each half', () => {
    onlySentence(interpolated('f32', '["flat", "first", "x"]', '1.'), 'TS8028', arity);
  });

  it('refuses a number where the type is written with one sentence from each half', () => {
    onlySentence(interpolated('f32', '1', '1.'), 'TS8028', arity);
  });

  it('refuses the decorator form with a malformed argument list once', () => {
    const source = `${USE}class VsOut {
  @builtin("position") pos!: vec4
  @location(0) @interpolate(1) u!: f32
}
@vertex export function vs(): VsOut { return { pos: vec4(0.), u: 1. } }`;
    onlySentence(source, 'TS8028', arity);
  });

  it('refuses a sampling the decorator form does not admit, once', () => {
    const source = `${USE}class VsOut {
  @builtin("position") pos!: vec4
  @location(0) @interpolate("flat", "bogus") u!: f32
}
@vertex export function vs(): VsOut { return { pos: vec4(0.), u: 1. } }`;
    onlySentence(
      source,
      'TS8028',
      'interpolate type "flat" takes the sampling first or either, not "bogus".',
    );
  });
});

describe('an integer varying has one interpolation, flat', () => {
  const sentence = (type: string, written: string): string =>
    `"VsOut.u" is "${type}" at a location, so its interpolation is "flat"; "${written}" is not ` +
    `one an integer has. Drop the interpolate option — it is derived from the type — or send an f32.`;

  it.each([['perspective'], ['linear']])('refuses a u32 written %s in both halves', (written) => {
    bothRefuse(interpolated('u32', `"${written}"`, '1'), 'TS8003', sentence('u32', written));
  });

  it('refuses an i32 written with a sampling in both halves', () => {
    bothRefuse(
      interpolated('i32', '["linear", "sample"]', '1'),
      'TS8003',
      sentence('i32', 'linear, sample'),
    );
  });

  it('takes an integer written flat, with and without a sampling', () => {
    bothTake(interpolated('u32', '"flat"', '1'));
    bothTake(interpolated('u32', '["flat", "either"]', '1'));
  });
});

describe('a value passed between stages is a numeric scalar or vector', () => {
  const tail = 'a value passed between stages is a numeric scalar or a numeric vector.';

  it.each([
    ['bool', 'true', 'bool', 'Send a u32 and compare it.'],
    ['vec2b', 'vec2b(true, true)', 'vec2b', 'Send a u32 and compare it.'],
    ['mat4', 'mat4()', 'mat4x4', 'Send its components as separate locations.'],
  ])('refuses %s at a location, with its own remedy', (type, value, shown, remedy) => {
    bothRefuse(
      varying(`b: location<0, ${type}>`, `b: ${value}`),
      'TS8003',
      `"VsOut.b" is at a location and is "${shown}"; ${tail} ${remedy}`,
    );
  });

  it.each([
    ['f32', '1.'],
    ['u32', '1'],
    ['vec3', 'vec3(1.)'],
    ['vec2i', 'vec2i(1, 2)'],
  ])('takes %s at a location', (type, value) => {
    bothTake(varying(`b: location<0, ${type}>`, `b: ${value}`));
  });

  it('leaves an emulated double at a location to the entry-IO rule, which keeps a scalar attribute', () => {
    const source = `${USE}@vertex export function vs(p: location<0, f64>): vec4 { return vec4(0.) }`;
    const halves = bothHalves(source);
    expect(halves.compiler.filter((d) => d.includes('at a location'))).toEqual([]);
    expect(halves.editor.filter((d) => d.includes('at a location'))).toEqual([]);
  });
});

describe('the type declared for a builtin is the one WGSL fixes for it', () => {
  it('refuses a vertex_index of another type in both halves', () => {
    bothRefuse(
      `${USE}@vertex export function vs(i: builtin<"vertex_index", f32>): vec4 { return vec4(0.) }`,
      'TS8003',
      'Builtin "vertex_index" is "u32"; this declares it "f32".',
    );
  });

  it('says nothing about the type of an unknown builtin beyond the unknown name', () => {
    bothRefuse(
      `${USE}@vertex export function vs(i: builtin<"vertex_idx", f32>): vec4 { return vec4(0.) }`,
      'TS8024',
      'Unknown builtin "vertex_idx". Did you mean "vertex_index"?',
    );
  });

  it.each([['array<f32, 1>'], ['array<f32, 8>']])('takes clip_distances as %s', (type) => {
    frontEndTakes(clipOutput(type));
  });

  it.each([['array<f32, 9>'], ['array<i32, 2>']])('refuses clip_distances as %s', (type) => {
    bothRefuse(
      clipOutput(type),
      'TS8003',
      `Builtin "clip_distances" is "${type}"; WGSL gives it array<f32, N> with N from 1 to 8.`,
    );
  });
});

describe('a builtin is valid in the stages and directions WGSL gives it', () => {
  const refused = (name: string, stage: string, direction: string, allowed: string): void => {
    const entry =
      stage === 'vertex'
        ? `@vertex export function vs(x: builtin<"${name}">): vec4 { return vec4(0.) }`
        : stage === 'fragment'
          ? `@fragment export function fs(x: builtin<"${name}">): vec4 { return vec4(1.) }`
          : `@compute([64]) export function cs(x: builtin<"${name}">) {}`;
    bothRefuse(
      `${USE}${entry}`,
      'TS8025',
      `Builtin "${name}" is not a valid ${stage} ${direction}; it is a ${allowed}.`,
    );
  };

  it('takes the subgroup pair as a fragment input as well as a compute input', () => {
    bothTake(`${USE}@fragment export function fs(i: builtin<"subgroup_invocation_id">,
  s: builtin<"subgroup_size">): vec4 { return vec4(f32(i + s)) }`);
    bothTake(`${USE}@compute([64]) export function cs(i: builtin<"subgroup_invocation_id">,
  s: builtin<"subgroup_size">) {}`);
  });

  it('takes subgroup_id and num_subgroups as compute inputs only', () => {
    bothTake(`${USE}@compute([64]) export function cs(i: builtin<"subgroup_id">,
  n: builtin<"num_subgroups">) {}`);
    refused('subgroup_id', 'fragment', 'input', 'compute input');
    refused('num_subgroups', 'fragment', 'input', 'compute input');
  });

  it('refuses clip_distances as a fragment input, because it is a vertex output only', () => {
    bothRefuse(
      `${USE}@fragment export function fs(c: builtin<"clip_distances", array<f32, 2>>): vec4 { return vec4(1.) }`,
      'TS8025',
      'Builtin "clip_distances" is not a valid fragment input; it is a vertex output.',
    );
  });

  it('refuses each builtin in the stage or direction it does not belong to', () => {
    refused('position', 'vertex', 'input', 'vertex output or fragment input');
    refused('frag_depth', 'fragment', 'input', 'fragment output');
    refused('global_invocation_id', 'vertex', 'input', 'compute input');
    refused('vertex_index', 'fragment', 'input', 'vertex input');
    refused('front_facing', 'vertex', 'input', 'fragment input');
  });

  it('takes position as a fragment input and sample_mask as both fragment directions', () => {
    bothTake(`${USE}@fragment export function fs(p: builtin<"position">): vec4 { return p }`);
    frontEndTakes(`${USE}interface Out { m: builtin<"sample_mask"> }
@fragment export function fs(m: builtin<"sample_mask">): Out { return { m } }`);
  });
});
