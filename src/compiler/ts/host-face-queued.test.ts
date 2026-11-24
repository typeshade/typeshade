import { describe, expect, it } from 'vitest';
import { hostFace } from './host-face.js';

const SOURCE = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const open: storage<array<f32>, "read_write">;
declare const sized: storage<array<f32, 4>, "read_write">;
@compute([4])
export function writesOpen(gid: builtin<"global_invocation_id">) { open[gid.x] = xs[gid.x]; }
@compute([4])
export function writesNone(gid: builtin<"global_invocation_id">) { let x = xs[gid.x]; }
@compute([4])
export function writesSized(gid: builtin<"global_invocation_id">) { sized[gid.x] = xs[gid.x]; }
@compute([4])
export function writesBoth(gid: builtin<"global_invocation_id">) {
  open[gid.x] = xs[gid.x];
  sized[gid.x] = xs[gid.x];
}
`;

function entryOf(name: string) {
  const host = hostFace(SOURCE, { fileName: '/app/m.shade.ts' });
  expect(host.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const entry = host.exports?.find((e) => e.name === name);
  if (entry?.kind !== 'compute') throw new Error(`${name} is ${entry?.kind}`);
  return entry;
}

describe('a call on a resource that does not block (change 0138, R2)', () => {
  it('is typed for an entry whose every written binding is a storage array with no size', () => {
    const entry = entryOf('writesOpen');
    expect(entry.queuedType).toContain('open');
    expect(entry.waitingType).toContain('open');
  });

  it('is typed for no entry that writes nothing', () => {
    const entry = entryOf('writesNone');
    expect(entry.queuedType).toBeUndefined();
    expect(entry.waitingType).toBeUndefined();
  });

  it('is typed for no entry that writes an array with a size', () => {
    for (const name of ['writesSized', 'writesBoth']) {
      const entry = entryOf(name);
      expect(entry.queuedType, name).toBeUndefined();
      expect(entry.waitingType, name).toBeUndefined();
    }
  });
});
