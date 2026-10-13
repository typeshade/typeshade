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
    expect(entry.emitted).toBe('step');
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
    expect(back.entries.map((e) => [e.name, e.emitted])).toEqual([['step', 'step']]);
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
