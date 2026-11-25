import { describe, expect, it, vi } from 'vitest';
import type { RhiDevice } from './rhi.js';
import { CONFORMANCE, differences, runConformance } from './rhi-conformance.js';

const deviceOf = (shaderLanguage: string): RhiDevice =>
  ({ caps: { shaderLanguage } }) as unknown as RhiDevice;

const refusing = CONFORMANCE.find((c) => c.refusedOnCpu !== undefined)!;

describe('runConformance outcomes', () => {
  it('reports a case that throws as a failure named with the error', async () => {
    const results = await runConformance(deviceOf('wgsl'));
    expect(results).toHaveLength(CONFORMANCE.length);
    const failed = results.filter((r) => r.skipped === undefined);
    expect(failed.length).toBeGreaterThan(0);
    for (const r of failed) {
      expect(r.got).toBeUndefined();
      expect(r.name).toContain(': threw ');
      expect(differences(r)).toEqual([`${r.name}: no answer`]);
    }
  });

  it('does not skip a refusing case on a backend other than the CPU', async () => {
    const spy = vi.spyOn(refusing, 'run').mockRejectedValue(new Error(refusing.refusedOnCpu!));
    try {
      const r = (await runConformance(deviceOf('wgsl'))).find((x) =>
        x.name.startsWith(refusing.name),
      )!;
      expect(r.skipped).toBeUndefined();
      expect(r.name).toBe(`${refusing.name}: threw ${refusing.refusedOnCpu}`);
    } finally {
      spy.mockRestore();
    }
  });

  it('skips a refusing case on the CPU backend when its error says the refusal', async () => {
    const spy = vi
      .spyOn(refusing, 'run')
      .mockRejectedValue(new Error(`no: ${refusing.refusedOnCpu}`));
    try {
      const r = (await runConformance(deviceOf('cpu'))).find((x) => x.name === refusing.name)!;
      expect(r.skipped).toBe(`refused: no: ${refusing.refusedOnCpu}`);
      expect(differences(r)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('fails a refusing case that runs on the CPU backend', async () => {
    const spy = vi.spyOn(refusing, 'run').mockResolvedValue({ got: [1], want: [1] });
    try {
      const results = await runConformance(deviceOf('cpu'));
      const r = results.find((x) => x.name.startsWith(`${refusing.name}: ran`))!;
      expect(r.name).toBe(
        `${refusing.name}: ran, and the CPU backend refuses it ("${refusing.refusedOnCpu}")`,
      );
      expect(differences(r)).toEqual([`${r.name}: no answer`]);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a non-finite or negative-zero difference as a difference only when unequal', () => {
    expect(differences({ name: 'x', got: [NaN], want: [NaN] })).toEqual([]);
    expect(differences({ name: 'x', got: [0], want: [-0] })).toEqual([]);
    expect(differences({ name: 'x', got: [1], want: [NaN] })).toEqual([
      'x: number 0 is 1, expected NaN',
    ]);
  });
});
