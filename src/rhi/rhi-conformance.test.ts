// The conformance suite of the render hardware interface (change 0120, M2), held to itself: it
// reaches every member of the interface or says where that member is held instead, its comparison
// can fail, and the compile gate runs it on both GPU backends. The runs themselves need a device:
// `bun run gate:compile` runs the suite on WebGPU and on WebGL2 in headless Chromium
// (`scripts/rhi-conformance-arm.ts`), with a perturbed device as its instrument, and `cpu.test.ts`
// runs it on the CPU backend (M3).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFORMANCE, NOT_REACHED, differences } from './rhi-conformance.js';

/** The source of a file, by its path from this directory. */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The members of the interface `name` of `rhi.ts`: each method and property it declares. */
function membersOf(name: string): string[] {
  const source = read('./rhi.ts');
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`rhi.ts declares no interface ${name}`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^ {2}(?:readonly )?([a-zA-Z]+)[?<(:]/gm)].map((m) => m[1]!);
}

/** The commands a case can call: the device's operations and the encoder's and passes' calls. */
const CALLS = [
  ...membersOf('RhiDevice').filter((m) => !['backend', 'caps', 'native'].includes(m)),
  ...membersOf('RhiCommandEncoder'),
  ...membersOf('RhiRenderPass'),
  ...membersOf('RhiComputePass'),
];

describe('the RHI conformance suite', () => {
  it('reads the members of the interface (the instrument sees them)', () => {
    // A known floor: the reader is broken, not the interface, when it finds fewer.
    expect(CALLS).toEqual(
      expect.arrayContaining(['createBuffer', 'drawIndexed', 'dispatchWorkgroups']),
    );
    expect(CALLS.length).toBeGreaterThanOrEqual(35);
  });

  it('reaches every call of the interface, or names where it is held instead', () => {
    const covered = new Set(CONFORMANCE.flatMap((c) => c.covers));
    const missing = CALLS.filter((m) => !covered.has(m) && NOT_REACHED[m] === undefined);
    expect(missing).toEqual([]);
  });

  it('names only calls the interface has', () => {
    const known = new Set(CALLS);
    const stray = [...CONFORMANCE.flatMap((c) => c.covers), ...Object.keys(NOT_REACHED)].filter(
      (m) => !known.has(m),
    );
    expect(stray).toEqual([]);
  });

  it('gives each case a name of its own', () => {
    const names = CONFORMANCE.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('finds a difference where there is one, and none where there is none', () => {
    expect(differences({ name: 'x', got: [1, 2, 3], want: [1, 2, 3] })).toEqual([]);
    expect(differences({ name: 'x', got: [1, 2, 4], want: [1, 2, 3] })).toEqual([
      'x: number 2 is 4, expected 3',
    ]);
    expect(differences({ name: 'x', got: [1], want: [1, 2] })).toEqual([
      'x: 1 numbers read back, 2 expected',
    ]);
    expect(differences({ name: 'x: threw no device' })).toEqual(['x: threw no device: no answer']);
    expect(differences({ name: 'x', skipped: 'no compute pass' })).toEqual([]);
  });

  it('runs on both GPU backends in the compile gate', () => {
    const gate = read('../../scripts/compile-gate.ts');
    expect(gate).toContain('rhiConformanceVerdicts(rhiReport)');
    const page = read('../../scripts/rhi-conformance-page.ts');
    expect(page).toContain('runConformance(webgpuDevice(device))');
    expect(page).toContain('runConformance(webgl2Device(glContext()))');
  });
});
