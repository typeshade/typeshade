// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// A scatter's own combine reads its target. Only that read is exempt from the carried-read
// refusal: its index and every other read still have to be independent (#761).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { compileModule } from '../../core/oracle.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { copy, runKernelPlan } from '../../core/testing/kernel-plan.js';
import type { CpuValue } from '../../core/cpu-runtime.js';

const source = (body: string, elem = 'u32'): string => `"use typeshade";
export function scatter(best: array<${elem}>, keys: array<u32>, values: array<${elem}>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    ${body}
  }
}`;

function edited(src: string) {
  const service = createTypeshadeLanguageService();
  service.openDocument('scatter.shade.ts', src);
  return service.getDiagnostics('scatter.shade.ts');
}

describe('an integer min/max scatter (#761)', () => {
  it.each([
    ['u32', 'min', false],
    ['u32', 'max', true],
    ['i32', 'min', true],
    ['i32', 'max', false],
  ] as const)('runs %s %s with reversed operands %s', (elem, op, reverse) => {
    const target = reverse ? 'best[keys[i]]' : 'best[k]';
    const operands = reverse ? `values[i], ${target}` : `${target}, values[i]`;
    const src = source(
      `${reverse ? '' : 'const k = keys[i];'} ${target} = ${op}(${operands});`,
      elem,
    );
    const r = compile(src, { fileName: 'scatter.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    expect(edited(src)).toEqual([]);
    const proof = proveKernels(r.module)[0]!;
    expect(proof.loops[0]).toMatchObject({
      ok: true,
      writes: [{ kind: 'scatter', name: 'best', op }],
    });
    const plan = lowerKernel(
      r.module.funcs.find((f) => f.name === 'scatter')!,
      r.module,
      proof,
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    expect(emitModule(plan.module)).toContain(op === 'min' ? 'atomicMin(' : 'atomicMax(');

    // Colliding keys, signed extremes and high unsigned values expose the wrong operation or
    // storage type. Compare both the function and its lowered dispatch plan with plain JS.
    const initial = elem === 'u32' ? [0xffffffff, 0, 20, 42] : [2147483647, -2147483648, 20, 42];
    const keys = [0, 1, 0, 2, 1, 0];
    const values =
      elem === 'u32' ? [0xfffffffe, 4, 7, 30, 0x80000000, 99] : [-7, 4, -99, 30, -2, 99];
    const want = initial.slice();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      want[key] = Math[op](want[key]!, values[i]!);
    }
    const args: CpuValue[] = [initial, keys, values];
    const cpu = args.map(copy);
    compileModule(r.module, { precision: 'f32' }).fns.scatter!(...cpu);
    expect(cpu[0]).toEqual(want);
    expect(runKernelPlan(r.module, 'scatter', plan, args).arrays[0]).toEqual(want);
  });

  it.each([
    [
      'a separate target read',
      'best[keys[i]] = min(best[keys[i]], values[i]); values[i] = best[keys[i]];',
    ],
    [
      'a cross-element operand',
      'best[keys[i]] = min(best[keys[i]], best[(keys[i] + 1) % best.length]);',
    ],
    ['a target-dependent key', 'best[best[i]] = min(best[best[i]], values[i]);'],
    [
      'a key another iteration writes',
      'keys[i] = i; best[keys[(i + 1) % keys.length]] = max(best[keys[(i + 1) % keys.length]], values[i]);',
    ],
  ])('still refuses %s in both halves', (_label, body) => {
    const src = source(body);
    const diagnostics = compile(src, { fileName: 'scatter.shade.ts' }).diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'TS8070', category: 'warning' });
    expect(edited(src).map((d) => [d.code, d.message])).toEqual(
      diagnostics.map((d) => [d.code, d.message]),
    );
  });
});
