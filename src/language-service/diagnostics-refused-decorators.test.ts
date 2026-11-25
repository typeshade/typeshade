import { describe, it } from 'vitest';
import { bothRefuse } from '../core/testing/both-halves.js';

const FS = (decl: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(1.);
}
`;

const NO_PLACE =
  'A decorator has no place on "C.m"; an entry is a function declaration with a stage attribute, "@vertex export function vs(…) { … }".';

describe('the decorators of a method are refused together, at the first', () => {
  it('reports one sentence for two unknown attributes', () => {
    bothRefuse(FS('class C {\n  @foo @bar m(): f32 {\n    return 1.;\n  }\n}'), 'TS8035', NO_PLACE);
  });

  it('reports one sentence for two attributes the library declares', () => {
    bothRefuse(
      FS('class C {\n  @group(0) @binding(1) m(): f32 {\n    return 1.;\n  }\n}'),
      'TS8035',
      NO_PLACE,
    );
  });
});
