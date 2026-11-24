import { describe, expect, it } from 'vitest';
import { hostFace, type HostExport } from './host-face.js';

function exportsOf(source: string): readonly HostExport[] {
  const f = hostFace(source, { fileName: '/app/m.shade.ts' });
  expect(f.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([]);
  return f.exports!;
}

describe('the builtin a function reaches that only the GPU runs', () => {
  const SOURCE = `"use typeshade";
function dpdy(x: f32): f32 { return x * 2.; }
export function declared(x: f32): f32 { return dpdy(x); }
export function builtins(x: f32): f32 { return dpdx(x) + fwidth(x); }
`;

  it('is the first one the body calls, named in the refusal', () => {
    const all = exportsOf(SOURCE);
    const builtins = all.find((e) => e.name === 'builtins');
    expect(builtins).toMatchObject({ kind: 'never' });
    expect((builtins as { reason: string }).reason).toMatch(/^it reaches dpdx, /);
  });

  it('is no call of a function the module declares under the name of a builtin (Rule 9.5)', () => {
    expect(exportsOf(SOURCE).find((e) => e.name === 'declared')?.kind).toBe('function');
  });
});

describe('the barrier an entry reaches', () => {
  const SOURCE = `"use typeshade";
let tile: workgroup<array<f32, 4>>;
declare const ys: storage<array<f32>, "read_write">;
function workgroupBarrier(): void {}
@compute([4])
export function plain(gid: builtin<"global_invocation_id">) {
  workgroupBarrier();
  ys[gid.x] = 1.;
}
`;
  const SYNCED = `"use typeshade";
let tile: workgroup<array<f32, 4>>;
declare const ys: storage<array<f32>, "read_write">;
@compute([4])
export function synced(gid: builtin<"global_invocation_id">, lid: builtin<"local_invocation_index">) {
  tile[lid] = f32(gid.x);
  workgroupBarrier();
  ys[gid.x] = tile[lid];
  workgroupBarrier();
}
`;

  it('is the first one, with the line it is written on', () => {
    const entry = exportsOf(SYNCED).find((e) => e.name === 'synced');
    if (entry?.kind !== 'compute') throw new Error(`synced is ${entry?.kind}`);
    expect(entry.entry.barrier).toBe('workgroupBarrier() at m.shade.ts:7');
  });

  it('is no call of a function the module declares under the name of a barrier (Rule 9.5)', () => {
    const entry = exportsOf(SOURCE).find((e) => e.name === 'plain');
    if (entry?.kind !== 'compute') throw new Error(`plain is ${entry?.kind}`);
    expect(entry.entry.barrier).toBeUndefined();
  });
});
