// What an entry may return (#86 follow-up, and the DX note on it). A vertex entry can return
// just the position, or a struct carrying it and any number of varyings; a fragment entry can
// return one value of any width, or a struct of render targets. The constraints that remain are
// the ones WGSL actually has.
//
// Measured on `main` before this, with real Tint (`GPUDevice.createShaderModule` +
// `getCompilationInfo`), five shapes compiled with zero errors and were rejected by the
// backend, and one that Tint accepts silently lost its WebGL2 target:
//
//   vertex returning a struct with no position   Tint: a vertex shader must include the
//   vertex returning void                        'position' builtin in its return type
//   vertex returning a bare f32                  Tint: missing entry point IO attribute
//   fragment returning a bare f32                Tint: missing entry point IO attribute
//   fragment returning a bare vec3               Tint: missing entry point IO attribute
//   vertex returning a bare vec4                 Tint accepts; GLSL refused it

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const FS = `@fragment
export function fs(): vec4 {
  return vec4(1.)
}
`;

describe('a vertex entry returns the position, alone or in a struct', () => {
  it('alone, and on both targets', () => {
    const r = compile(`"use typeshade"
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.)
}
${FS}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('-> @builtin(position) vec4<f32> {');
    // The GLSL target was lost here until the emitter's bare-output refusal was narrowed: a
    // return carrying a BUILTIN is `gl_Position`, not a varying, so it links nothing.
    expect(r.glsl?.vertex).toContain('gl_Position = ');
    expect(r.glsl?.vertex).not.toContain('out vec4');
  });

  it('in a struct, with as many varyings as the program wants', () => {
    const r = compile(`"use typeshade";
class Out {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
  @location(1) color: vec3;
  @location(2) w: f32;
}
@vertex
export function vs(): Out {
  return { pos: vec4(1.), uv: vec2(0.), color: vec3(1.), w: 2. };
}
@fragment
export function fs(v: Out): vec4 {
  return vec4(v.color, v.w);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl?.vertex).toContain('out vec3 color;');
  });

  it('and with no parameters at all', () => {
    const r = compile(`"use typeshade"
@vertex
export function vs(): vec4 {
  return vec4(0., 0., 0., 1.)
}
${FS}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl?.vertex).toContain('gl_Position = ');
  });
});

describe('a fragment entry returns one value of any width, or a struct of targets', () => {
  it.each([
    ['f32', '0.5', '@location(0) f32'],
    ['vec2', 'vec2(0.5)', '@location(0) vec2<f32>'],
    ['vec3', 'vec3(0.5)', '@location(0) vec3<f32>'],
    ['vec4', 'vec4(0.5)', '@location(0) vec4<f32>'],
  ])('a bare %s takes @location(0)', (type, value, attr) => {
    // Only the vec4 case got the attribute before this; the other three emitted WGSL with no
    // entry-point IO attribute on the return, which Tint refuses.
    const r = compile(`"use typeshade"
@fragment
export function fs(): ${type} {
  return ${value}
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(`-> ${attr} {`);
    expect(r.glsl?.fragment).toBeDefined();
  });

  it('and a struct of two render targets', () => {
    const r = compile(`"use typeshade";
class Targets {
  @location(0) albedo: vec4;
  @location(1) normal: vec4;
}
@fragment
export function fs(): Targets {
  return { albedo: vec4(1.), normal: vec4(0., 1., 0., 1.) };
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl?.fragment).toContain('layout(location = 1) out vec4 normal;');
  });
});

describe('the one constraint a vertex entry keeps', () => {
  it('a struct with no position field says which field to add', () => {
    expect(
      errorsOf(`"use typeshade";
class Out {
  @location(0) uv: vec2;
}
@vertex
export function vs(): Out {
  return { uv: vec2(0.) };
}
@fragment
export function fs(v: Out): vec4 {
  return vec4(v.uv, 0., 1.);
}
`)[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "vs" is a @vertex entry, so what it returns has to carry the position: give "Out" a field with @builtin("position"), typed vec4.`,
    );
  });

  it('returning nothing, or a type that is not a vec4, says what a position is', () => {
    expect(
      errorsOf(`"use typeshade"
@vertex
export function vs(): void {}
${FS}`)[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "vs" is a @vertex entry, so it returns the position: a vec4, which takes @builtin("position") on its own, or a struct with a vec4 field that carries it. It returns nothing.`,
    );
    expect(
      errorsOf(`"use typeshade"
@vertex
export function vs(): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "vs" is a @vertex entry, so it returns the position: a vec4, which takes @builtin("position") on its own, or a struct with a vec4 field that carries it. It returns f32.`,
    );
  });
});
