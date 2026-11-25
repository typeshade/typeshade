// Verifies: Rule 3.4.
// Verifies: Rule 11.10.

import { describe, expect, it } from 'vitest';
import { packModule } from '../compiler/ts/pack.js';
import { examples } from '../../examples/index.js';
import { shadeExamples } from '../../examples/_shade.js';
import type { ModuleDecl } from './ir/nodes.js';
import { buildManifest } from './manifest.js';
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
    expect(halves.hover('texture: uniform')).toBe(
      '```ts\nconst texture: Frame\n```\n\nuniform resource at @group(0) @binding(1)',
    );
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
  const corpus = [...examples, ...shadeExamples].filter(
    (e): e is typeof e & { module: ModuleDecl } => e.module !== undefined,
  );
  const seen = { bindings: 0, overrides: 0 };

  for (const ex of corpus) {
    it(ex.id, () => {
      const pack = buildManifest(ex.module, { console: true });
      for (const b of pack.bindings) expect(typeof b.emittedGlsl).toBe('string');
      for (const o of pack.overrides ?? []) expect(typeof o.emittedGlsl).toBe('string');
      seen.bindings += pack.bindings.length;
      seen.overrides += pack.overrides?.length ?? 0;
    });
  }

  it('covers at least one binding and one override', () => {
    expect(corpus.length).toBeGreaterThan(80);
    expect(seen.bindings).toBeGreaterThan(0);
    expect(seen.overrides).toBeGreaterThan(0);
  });
});

describe('the record of a struct and of a field carries emitted only (Rule 3.4)', () => {
  const r = reflect(allKindsModule({ struct: 'common', field: 'half' }, 'graphics'));
  const structs = [...r.uniforms, ...r.storage];

  it('names a struct and a field whose GLSL spelling is reserved without emittedGlsl', () => {
    expect(structs.length).toBeGreaterThan(0);
    for (const s of structs) {
      expect(s).not.toHaveProperty('emittedGlsl');
      for (const f of s.fields) expect(f).not.toHaveProperty('emittedGlsl');
    }
    expect(structs.flatMap((s) => s.fields.map((f) => f.name))).toContain('half');
  });

  it('names an entry without emittedGlsl', () => {
    for (const e of r.entries) expect(e).not.toHaveProperty('emittedGlsl');
  });
});
