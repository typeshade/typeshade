// Verifies: Rule 7.2 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
//
// The four loop examples of change 0013, held to one answer on the CPU backends: each kernel
// function called through the import on the CPU tier (the generated code, as a host runs it
// where there is no WebGPU) against the oracle's interpreter at f32 on the same arguments,
// reductions included, bit for bit. The WebGPU tier of the same shapes is held to references
// by the import journey (`scripts/user-journey.ts`).

import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../src/compiler/ts/host-face.js';
import { compile } from '../src/compiler/ts/compile.js';
import { compileModule } from '../src/core/oracle.js';
import { fromCpu, toCpu } from '../src/core/host-entry.js';
import { fromShader, toShader } from '../src/core/host-values.js';
import type { KernelFace } from '../src/core/host-kernel.js';
import type { CpuValue } from '../src/core/cpu-runtime.js';

const RUNTIME = resolve(__dirname, '../src/core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const f = Math.fround;
const xs = (n: number): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => f(Math.sin(i * 0.7) * 1000.123));

/** Each example's kernel functions, with the arguments to call them on. */
const CALLS: Record<string, Record<string, () => unknown[]>> = {
  'loop-kernel': { render: () => [[1, 0.5, 2, 0.25], 16, new Float32Array(256)] },
  'loop-reduction': {
    sum: () => [xs(5000)],
    meanVariance: () => [xs(5000)],
    histogram: () => [xs(5000), new Uint32Array(32), -1000.123, 32 / 2000.246],
  },
  'loop-struct-array': {
    step: () => [
      Array.from({ length: 50 }, (_, i) => ({
        pos: [i * 0.1, 0.05 * (i % 7), 0, 1],
        vel: [0.5, -1 - i * 0.01, 0.25, 0],
      })),
      0.016,
    ],
  },
  'loop-on-cpu': {
    halve: () => [xs(64)],
    firstNegative: () => [xs(64)],
    nearest: () => [xs(64), 3],
    prefix: () => [xs(64)],
    counted: () => [xs(64)],
    logged: () => [xs(4)],
  },
};

async function loadHost(source: string, file: string) {
  const face = hostFace(source, { fileName: `/app/${file}`, runtime: RUNTIME });
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-loop-examples-'));
  dirs.push(dir);
  const out = join(dir, file.replace(/\.ts$/, '.mjs'));
  writeFileSync(out, face.code!);
  const m = (await import(/* @vite-ignore */ pathToFileURL(out).href)) as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >;
  return { m, faces: face.exports ?? [] };
}

describe('the loop examples compute one answer on the CPU tier and the oracle (change 0013)', () => {
  for (const [example, calls] of Object.entries(CALLS)) {
    it(example, async () => {
      const file = `${example}.shade.ts`;
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      const { m, faces } = await loadHost(source, file);
      const oracle = compileModule(compile(source, { fileName: file }).module, {
        precision: 'f32',
      });
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        for (const [fn, args] of Object.entries(calls)) {
          const face = faces.find((e) => e.kind === 'kernel' && e.name === fn) as
            { face: KernelFace } | undefined;
          expect(face, fn).toBeDefined();
          const k = face!.face;
          // The CPU tier, as a host runs it.
          const hostArgs = args();
          const got = await m[fn]!(...hostArgs);
          // The interpreter, on the same arguments converted the way the tier converts them.
          const oracleArgs = args();
          const cpu = k.params.map((p, i) =>
            p.k === 'array'
              ? toCpu(p.layout, oracleArgs[i], false)
              : (toShader(fn, p.name, p.type, oracleArgs[i]) as CpuValue),
          );
          const raw = oracle.fns[k.fn]!(...cpu);
          k.params.forEach((p, i) => {
            if (p.k === 'array') fromCpu(p.layout, cpu[i]!, oracleArgs[i], false);
          });
          expect(got, `${fn}: result`).toEqual(fromShader(k.result, raw));
          if (typeof got === 'number')
            expect(Object.is(got, fromShader(k.result, raw)), `${fn}: result bits`).toBe(true);
          expect(hostArgs, `${fn}: arrays`).toEqual(oracleArgs);
        }
      } finally {
        log.mockRestore();
      }
    });
  }
});
