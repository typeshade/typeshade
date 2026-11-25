import { describe, expect, it } from 'vitest';
import { glslOverrideNames } from './gl-overrides.js';
import type { Pack } from './manifest-types.js';

const overrides = (
  ...records: readonly { name: string; emitted: string; emittedGlsl?: string }[]
): Pick<Pack, 'overrides'> =>
  ({ overrides: records.map((r) => ({ type: 'f32', default: 1, ...r })) }) as Pick<
    Pack,
    'overrides'
  >;

describe('the GLSL spelling of each override', () => {
  it('is the GLSL spelling when the record gives one', () => {
    expect(glslOverrideNames(overrides({ name: 'a', emitted: 'a_w', emittedGlsl: 'a_g' }))).toEqual(
      { a: 'a_g' },
    );
  });

  it('is the WGSL spelling when the record gives none', () => {
    expect(glslOverrideNames(overrides({ name: 'a', emitted: 'a_w' }))).toEqual({ a: 'a_w' });
  });

  it('leaves out an override that both targets spell as the host supplies it', () => {
    expect(glslOverrideNames(overrides({ name: 'a', emitted: 'a' }))).toEqual({});
  });
});
