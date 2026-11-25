import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.resetModules());

it('installs the program runtime at the first call, and no earlier than that', async () => {
  vi.resetModules();
  const compute = await import('./host-compute.js');
  const resident = await import('./resident.js');
  await import('../fuse.js');
  expect(compute.entryPrograms.run).toBeUndefined();
  resident.configure({ prefer: ['cpu'] });
  const harness = await import('./testing/entry-program-harness.js');
  const { hostFace } = await import('../compiler/ts/host-face.js');
  const m = await harness.loadEntries(hostFace);
  expect(compute.entryPrograms.run).toBeUndefined();
  await m.scale(
    {
      params: { k: 2 },
      xs: Float32Array.of(1),
      out: Float32Array.of(0),
      total: Float32Array.of(0),
    },
    1,
  );
  expect(Object.keys(compute.entryPrograms.run ?? {}).sort()).toEqual(['cpu', 'gl', 'gpu']);
});
