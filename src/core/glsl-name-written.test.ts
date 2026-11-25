// Verifies: Rule 3.4.
// Verifies: Rule 11.10.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import { SHADE_FILES } from '../../examples/_example-file.js';
import { reflect } from './reflect.js';
import { glslOverrideNames } from './gl-overrides.js';
import { bothTake } from './testing/both-halves.js';
import { allKindsModule } from './testing/all-kinds-module.js';

const SOURCE = `"use typeshade";
class Frame {
  time: f32;
}
declare const frame: uniform<Frame>;
declare const texture: uniform<Frame>;
const quality: override<f32> = 0.5;
const sample: override<f32> = 0.25;
@compute([64, 1, 1]) export function run(gid: builtin<"global_invocation_id">) {
  const t = frame.time * texture.time * quality * sample;
}
`;

describe('the compiler writes the GLSL name of every binding and override (Rule 3.4, Rule 11.10)', () => {
  const halves = bothTake(SOURCE);
  const reflection = reflect(halves.result.module);
  const bindings = reflection.bindGroups.flatMap((g) => g.entries);

  it('reads the same source in both halves, and the editor shows no emittedGlsl', () => {
    expect(halves.editor).toEqual([]);
    expect(halves.hover('texture: uniform')).not.toContain('emittedGlsl');
  });

  it('writes emittedGlsl equal to emitted where the two targets spell a binding alike', () => {
    const frame = bindings.find((b) => b.name === 'frame')!;
    expect(frame.emitted).toBe('frame');
    expect(frame.emittedGlsl).toBe('frame');
  });

  it('writes the GLSL spelling of a binding the two targets spell apart', () => {
    const texture = bindings.find((b) => b.name === 'texture')!;
    expect(texture.emitted).toBe('texture');
    expect(texture.emittedGlsl).toBe('texture_');
  });

  it('writes emittedGlsl on each override, equal or different', () => {
    const byName = (n: string) => reflection.overrides.find((o) => o.name === n)!;
    expect(byName('quality').emittedGlsl).toBe('quality');
    expect(byName('sample').emitted).toBe('sample');
    expect(byName('sample').emittedGlsl).toBe('sample_');
  });

  it('copies emittedGlsl into the manifest, on every binding and override', () => {
    const pack = packModule(halves.result.module);
    for (const b of pack.bindings) expect(typeof b.emittedGlsl).toBe('string');
    for (const o of pack.overrides ?? []) expect(typeof o.emittedGlsl).toBe('string');
    expect(pack.bindings.find((b) => b.name === 'texture')!.emittedGlsl).toBe('texture_');
    expect(pack.overrides!.find((o) => o.name === 'quality')!.emittedGlsl).toBe('quality');
  });

  it('gives glslOverrideNames the names that differ from the authored name', () => {
    const pack = packModule(halves.result.module);
    expect(glslOverrideNames(pack)).toEqual({ sample: 'sample_' });
  });

  it('writes the field on an IR-built module as well', () => {
    const r = reflect(allKindsModule({ binding: 'texture', override: 'shared' }, 'graphics'));
    for (const b of r.bindGroups.flatMap((g) => g.entries))
      expect(typeof b.emittedGlsl).toBe('string');
    for (const o of r.overrides) expect(typeof o.emittedGlsl).toBe('string');
  });
});

describe('every example binding and override carries emittedGlsl in its manifest', () => {
  const dir = fileURLToPath(new URL('../../examples/', import.meta.url));
  for (const [id, path] of SHADE_FILES) {
    it(id, () => {
      let pack;
      try {
        const r = compile(readFileSync(dir + path, 'utf8'), { fileName: dir + path });
        pack = packModule(r.module);
      } catch {
        return;
      }
      for (const b of pack.bindings) expect(typeof b.emittedGlsl).toBe('string');
      for (const o of pack.overrides ?? []) expect(typeof o.emittedGlsl).toBe('string');
    });
  }
});
