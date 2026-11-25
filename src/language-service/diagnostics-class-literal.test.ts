import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../core/testing/both-halves.js';

const FS = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

const READ_STATE = '  const r: Rng = { state: 1. };\n  return vec4(r.state);';

describe('an object literal typed as a class carries its fields only (Rule 6.9)', () => {
  it('takes a literal that leaves out a method', () => {
    bothTake(
      FS(
        'class Rng {\n  state: f32 = 1.;\n  next(): f32 {\n    return this.state;\n  }\n}',
        READ_STATE,
      ),
    );
  });

  it('takes a literal that leaves out an accessor', () => {
    bothTake(
      FS(
        'class Rng {\n  state: f32 = 1.;\n  get next(): f32 {\n    return this.state;\n  }\n}',
        READ_STATE,
      ),
    );
  });

  it('keeps the TypeScript report when a field is missing beside a method', () => {
    const halves = bothHalves(
      FS(
        'class Rng {\n  state: f32 = 1.;\n  other: f32 = 1.;\n  next(): f32 {\n    return this.state;\n  }\n}',
        READ_STATE,
      ),
    );
    expect(halves.compiler).toEqual(['typeshade TS8010: Missing field "other" for struct Rng.']);
    expect(halves.editor).toEqual([
      "typescript 2739: Type '{ state: number; }' is missing the following properties from type 'Rng': other, next",
      'typeshade TS8010: Missing field "other" for struct Rng.',
    ]);
  });
});
