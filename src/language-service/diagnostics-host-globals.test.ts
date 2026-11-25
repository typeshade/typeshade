import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../core/testing/both-halves.js';

const FS = (decl: string, body = '  return vec4(1.);'): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

const GENERATOR = (name: string): string =>
  `"${name}" is a generator, and a shader function runs to completion in one call: nothing suspends it at a "yield". Remove the "*" and return one value.`;

describe('a form that names a global type the ambient library omits is the compiler refusal alone', () => {
  it('reports a generator declaration that has no yield', () => {
    bothRefuse(FS('function* g() {\n}'), 'TS8013', GENERATOR('g'));
  });

  it('reports a generator declaration that returns one value', () => {
    bothRefuse(FS('function* g(): f32 {\n  return 1.;\n}'), 'TS8013', GENERATOR('g'));
  });

  it('reports a generator expression that has no yield', () => {
    bothRefuse(
      FS('', '  const g = function* () {};\n  return vec4(1.);'),
      'TS8020',
      GENERATOR('g'),
    );
  });

  it('reports a for await loop', () => {
    bothRefuse(
      FS('', '  for await (const x of [1., 2.]) {\n  }\n  return vec4(1.);'),
      'TS8013',
      'for await iterates an async JS iterable. Shader functions are synchronous.',
    );
  });

  it('reports a tagged template whose tag the file declares', () => {
    bothRefuse(
      FS('function tag(s: f32): f32 {\n  return s;\n}', '  const x = tag`a`;\n  return vec4(1.);'),
      'TS8013',
      'Template strings are JS. TypeShade has no string type.',
    );
  });
});

describe('a read of a declaration as a value hides only the reports that judge that read', () => {
  it('keeps TypeScript on an unrelated mistake in the same file', () => {
    const halves = bothHalves(
      FS('enum E {\n  A,\n}', '  const k: f32 = E;\n  const z: f32 = "x";\n  return vec4(k);'),
    );
    expect(halves.editor.map((line) => line.split(':')[0])).toEqual([
      'typeshade TS8022',
      'typescript 2322',
      'typeshade TS8099',
    ]);
    expect(halves.compiler.map((line) => line.split(':')[0])).toEqual([
      'typeshade TS8022',
      'typeshade TS8099',
    ]);
  });
});
