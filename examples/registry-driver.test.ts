// ═══ The registry driver, C4 and C5 (change 0145, amendment A2, M4.6) ═══
//
// `_driver.ts` reads the registry and runs each `"host": "run"` example on the CPU tier. This
// suite holds what every such example owes, with no hand-written reference for it:
//
//   C4. Each example that lists `cpu` runs twice on the CPU tier. The two results are equal, every
//       number is finite, each listed extra resolves with its defaults, and its `check.ts` passes
//       where one exists (it reads the result of `run` and the results of the extras).
//   C5. Where an oracle case names the bindings of its `host.ts`, the CPU `run()` is held to the
//       `f64` oracle of the same IR (`_oracle.ts`), exact where the determinism report of the
//       module lists no operation, within `PIXEL` and `RELATIVE` otherwise.
//
// What C5 does not cover is `UNCOVERED`, with the reason; `path/parallel-sum` and
// `hosts/host-program` list no CPU tier, so neither C4 nor C5 runs them. A new example that is in neither list
// fails the last test of this file, so a hole is never silent.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareParts, nonFinite } from './_compare.js';
import {
  cpuRunnables,
  runCheck,
  runExtras,
  runnables,
  runOnCpu,
  type Runnable,
} from './_driver.js';
import { exampleSource } from './_example-file.js';
import { expectedOf, oracleOutputs, type OracleCase } from './_oracle.js';
import { ORACLE_CASES as HOST_CASES } from './hosts/_oracle-cases.js';
import { ORACLE_CASES as PATH_CASES } from './path/_oracle-cases.js';
import { PIXEL, RELATIVE } from './path/_reference.js';

const CASES: Readonly<Record<string, OracleCase>> = {
  ...Object.fromEntries(Object.entries(PATH_CASES).map(([id, c]) => [`path/${id}`, c])),
  ...Object.fromEntries(Object.entries(HOST_CASES).map(([id, c]) => [`hosts/${id}`, c])),
};

const NOT_PROBED =
  'its run() calls kernel functions or a specialization; the oracle call is not built';

/** The CPU-listed examples that C5 does not cover, and why. */
const UNCOVERED: Readonly<Record<string, string>> = {
  'hosts/host-compute': `${NOT_PROBED} (entry overrides and a workgroup size chosen per call)`,
  'hosts/host-kernel': NOT_PROBED,
  'hosts/host-resident': NOT_PROBED,
  'hosts/host-helper':
    'its run() reads a helper on the CPU and draws; the oracle call is not built',
  'hosts/loop-fuse': NOT_PROBED,
  'hosts/host-set-unique': NOT_PROBED,
  'hosts/string-keys-record': NOT_PROBED,
};

const key = (r: Runnable): string => `${r.group}/${r.id}`;
const entries = cpuRunnables();

describe('the registry: every host "run" example is found', () => {
  it('lists the path steps and the host examples, each once', () => {
    const all = runnables().map(key);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((k) => k.startsWith('path/')).length).toBeGreaterThanOrEqual(13);
    expect(all.filter((k) => k.startsWith('hosts/')).length).toBeGreaterThanOrEqual(9);
  });

  it('lists the CPU tier of an entry exactly when its tiers do', () => {
    const cpu = entries.map(key);
    expect(cpu).toContain('path/first-color');
    expect(cpu).toContain('hosts/host-draw');
    expect(cpu).not.toContain('hosts/host-program');
  });
});

describe('C4: each example runs twice on the CPU tier, equal and finite', () => {
  it.each(entries.map((e) => [key(e), e] as const))('%s', async (_name, entry) => {
    const first = await runOnCpu(entry);
    const second = await runOnCpu(entry);
    expect(typeof first, String(first)).not.toBe('string');
    expect(second).toEqual(first);
    const ran = first as Exclude<typeof first, string>;
    expect(Object.keys(ran).length).toBeGreaterThan(0);
    expect(nonFinite(ran)).toEqual([]);
    const extras = await runExtras(entry);
    expect(Object.keys(extras)).toEqual(entry.extras);
    if (entry.check !== undefined)
      expect(await runCheck(entry.check, ran, 'cpu', extras)).toBeUndefined();
  });

  it.each(entries.filter((e) => e.extras.length > 0).map((e) => [key(e), e] as const))(
    '%s: host.ts exports each listed extra, and no other export than run',
    async (_name, entry) => {
      const host = (await import(/* @vite-ignore */ join(entry.dir, 'host.ts'))) as Record<
        string,
        unknown
      >;
      expect(Object.keys(host).sort()).toEqual(['run', ...entry.extras].sort());
      for (const x of entry.extras) expect(typeof host[x], x).toBe('function');
    },
  );

  it('runCheck() reports a failing check and a file with no check (the instrument is not blind)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-check-'));
    try {
      const ok = join(dir, 'ok.ts');
      const bad = join(dir, 'bad.ts');
      const none = join(dir, 'none.ts');
      writeFileSync(ok, 'export function check() {}\n');
      writeFileSync(bad, "export function check() { throw new Error('wrong group count'); }\n");
      writeFileSync(none, 'export const x = 1;\n');
      expect(await runCheck(ok, { a: [1] }, 'cpu')).toBeUndefined();
      expect(await runCheck(bad, { a: [1] }, 'cpu')).toContain('wrong group count');
      expect(await runCheck(none, { a: [1] }, 'cpu')).toContain('no check');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('nonFinite() sees NaN and Infinity', () => {
    expect(nonFinite({ a: [1, 2] })).toEqual([]);
    expect(nonFinite({ a: [1, Number.NaN], b: [Number.POSITIVE_INFINITY] })).toHaveLength(2);
  });
});

describe('C5: the CPU run() is held to the f64 oracle of the same IR', () => {
  const covered = entries.filter((e) => CASES[key(e)] !== undefined);

  it.each(covered.map((e) => [key(e), e] as const))('%s', async (name, entry) => {
    const c = CASES[name]!;
    const source = exampleSource(entry.id);
    const oracle = oracleOutputs(source, `${entry.id}.shade.ts`, c);
    const want = expectedOf(oracle, (part) => (part === 'pixels' ? PIXEL : RELATIVE));
    expect(compareParts(name, await runOnCpu(entry), want)).toEqual([]);
  });

  it('covers every example of the path and says why for the rest', () => {
    const names = entries.map(key);
    const holes = names.filter((n) => CASES[n] === undefined && UNCOVERED[n] === undefined);
    expect(holes, 'an example with no oracle case and no reason').toEqual([]);
    const stale = [...Object.keys(CASES), ...Object.keys(UNCOVERED)].filter(
      (n) => !names.includes(n),
    );
    expect(stale, 'a case or a reason for an example that is gone').toEqual([]);
    expect(Object.keys(CASES).filter((n) => UNCOVERED[n] !== undefined)).toEqual([]);
    expect(names.filter((n) => n.startsWith('path/') && CASES[n] === undefined)).toEqual([]);
  });

  it('names the examples that list no CPU tier, which neither C4 nor C5 runs', () => {
    expect(
      runnables()
        .filter((r) => !r.tiers.includes('cpu'))
        .map(key),
    ).toEqual(['path/parallel-sum', 'hosts/host-program']);
  });

  it('is exact where the determinism report lists no operation, and loose where it does', () => {
    const exactOf = (id: string): boolean => {
      const entry = entries.find((e) => key(e) === id)!;
      const source = exampleSource(entry.id);
      return oracleOutputs(source, `${entry.id}.shade.ts`, CASES[id]!).exact;
    };
    expect(exactOf('path/first-color')).toBe(true);
    expect(exactOf('path/double-array')).toBe(true);
    expect(exactOf('path/ray-tracer')).toBe(false);
  });

  it('sees a wrong pixel, a wrong value and a failed run (the instrument is not blind)', () => {
    const source = exampleSource('first-color');
    const oracle = oracleOutputs(source, 'first-color.shade.ts', CASES['path/first-color']!);
    const want = expectedOf(oracle, () => PIXEL);
    const pixels = [...oracle.outputs['pixels']!];
    expect(compareParts('first-color', { pixels }, want)).toEqual([]);
    expect(pixels.slice(0, 4)).toEqual([51, 153, 255, 255]);
    pixels[0] = pixels[0]! + 1;
    expect(compareParts('first-color', { pixels }, want)).toHaveLength(1);
    expect(compareParts('first-color', 'TypeError: no tier', want)).toHaveLength(1);
    expect(compareParts('first-color', { pixels: pixels.slice(4) }, want)).toHaveLength(1);
  });
});
