// The emitted-name record (Rule 11.10, proposal 0070 D2 and D3): every named record of
// `reflect()` and of the manifest carries the authored name beside the name the emitted text
// declares it under, and the manifest carries the schema that holds the record (schema 2).
// Commit one of 0070 adds the fields; the names are still the authored ones, so each pair is
// equal. The later commits make a pair differ, and these tests show the record follows.
//
// Verifies: Rule 11.10.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import { checkManifest } from '../runtime/program.js';
import { reflect } from './reflect.js';
import { PACK_SCHEMA } from './manifest-types.js';
import { emitModuleWithReflection } from './emit.js';
import { wgslBackend } from './backends/wgsl.js';
import { allKindsModule } from './testing/all-kinds-module.js';

// One module that uses every named declaration kind of the record: a struct and its field, a
// uniform binding, a storage binding, an override, a compute entry and a module constant.
const SRC = `"use typeshade";
const SCALE: f32 = 2.;
class Frame {
  time: f32;
  count: u32;
}
declare const frame: uniform<Frame>;
declare const dst: storage<array<f32>, "read_write">;
const quality: override<f32> = 0.5;
@compute([64, 1, 1])
export function step(@builtin("global_invocation_id") gid: vec3u) {
  dst[gid.x] = frame.time * SCALE * quality;
}
`;

const moduleOf = () => {
  const r = compile(SRC);
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  expect(errors).toEqual([]);
  return r.module;
};

describe('the emitted-name record (Rule 11.10)', () => {
  it('pins the schema the manifest carries and the runtime reads', () => {
    expect(PACK_SCHEMA).toBe(2);
    const m = packModule(moduleOf());
    expect(m.schema).toBe(2);
    expect(() => checkManifest(m)).not.toThrow();
    expect(() => checkManifest({ ...m, schema: 1 })).toThrow(/schema 1/);
  });

  it('pairs each reflected name with its emitted name', () => {
    const r = reflect(moduleOf());
    const entry = r.entries.find((e) => e.name === 'step')!;
    // `step` is a WGSL predeclared function: the entry is spelled `step_` (Proposal 0070, Q1).
    expect(entry.emitted).toBe('step_');
    expect(r.overrides.map((o) => [o.name, o.emitted])).toEqual([['quality', 'quality']]);
    const bindings = r.bindGroups.flatMap((g) => g.entries);
    expect(bindings.map((b) => [b.name, b.emitted]).sort()).toEqual([
      ['dst', 'dst'],
      ['frame', 'frame'],
    ]);
    expect(r.uniforms.map((s) => [s.name, s.emitted])).toEqual([['Frame', 'Frame']]);
    expect(r.uniforms[0]!.fields.map((f) => [f.name, f.emitted])).toEqual([
      ['time', 'time'],
      ['count', 'count'],
    ]);
  });

  it('round-trips each pair through the JSON manifest', () => {
    const m = packModule(moduleOf());
    const back = JSON.parse(JSON.stringify(m)) as typeof m;
    expect(back.entries.map((e) => [e.name, e.emitted])).toEqual([['step', 'step_']]);
    expect(back.overrides.map((o) => [o.name, o.emitted])).toEqual([['quality', 'quality']]);
    expect(back.bindings.map((b) => [b.name, b.emitted]).sort()).toEqual([
      ['dst', 'dst'],
      ['frame', 'frame'],
    ]);
    expect(back.structs).toEqual([
      {
        name: 'Frame',
        emitted: 'Frame',
        fields: [
          { name: 'time', emitted: 'time', type: 'f32' },
          { name: 'count', emitted: 'count', type: 'u32' },
        ],
      },
    ]);
  });
});

// The record reads the spelling plan (Proposal 0070, C4): `emitted` is the WGSL spelling, and
// `emittedGlsl` is present only where the GLSL spelling differs.
describe('the spelling record reads the plan (Proposal 0070, C4)', () => {
  const names = {
    const: 'class',
    var: 'shared',
    helper: 'fract',
    entry: 'step',
    binding: '$b',
    struct: 'common',
    field: 'half',
    param: 'f32',
  };

  it('names the entry in the record as the emitted text declares it (point 1)', () => {
    const m = allKindsModule(names, 'compute');
    const { code, reflection } = emitModuleWithReflection(m, wgslBackend);
    const entry = reflection.entries.find((e) => e.name === 'step')!;
    expect(entry.emitted).toBe('step_');
    expect(code).toMatch(new RegExp(`\\bfn ${entry.emitted}\\(`));
  });

  it('carries emittedGlsl only where the GLSL spelling differs from the WGSL one', () => {
    const r = reflect(allKindsModule({ binding: 'texture', field: 'half' }, 'graphics'));
    const tex = r.bindGroups.flatMap((g) => g.entries).find((b) => b.name === 'texture')!;
    expect(tex.emitted).toBe('texture');
    expect(tex.emittedGlsl).toBe('texture_');
    const dst = r.bindGroups.flatMap((g) => g.entries).find((b) => b.name !== 'texture')!;
    expect(dst.emittedGlsl).toBeUndefined();
  });
});
