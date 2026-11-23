// Verifies: Rule 8.1 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.9 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { exampleSource } from '../../../examples/_example-file.js';

function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number');
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(expected)),
    );
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    for (const [k, e] of Object.entries(expected)) {
      expectClose((actual as Record<string, unknown>)[k], e);
    }
    return;
  }
  expect(actual).toEqual(expected);
}

function runAll(src: string, args: unknown[] = [], fn = 'run'): unknown {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const oracle = r.eval(fn, args);
  expect(compileModuleJs(r.module).fns[fn]!(...(args as never[]))).toEqual(oracle);
  const s = startDebugSession(r.module, fn, args as never[]);
  s.continue();
  expect(s.done).toBe(true);
  expectClose(s.result, oracle);
  return oracle;
}

describe('the example', () => {
  it('examples/class-syntax.shade.ts renders the two rings on every CPU path', async () => {
    const src = exampleSource('class-syntax');
    const input = { pos: [0, 0, 0, 1], uv: [0.5, 0] };
    expect(runAll(src, [input], 'fs')).toEqual({ color: [0.95, 0.74, 0.32, 1] });
    expect(runAll(src, [{ pos: [0, 0, 0, 1], uv: [0, 0] }], 'fs')).toEqual({
      color: [0.07, 0.08, 0.14, 1],
    });
  });

  it('examples/class-builder.shade.ts renders the three discs on every CPU path', async () => {
    const src = exampleSource('class-builder');
    const at = (uv: number[], color: number[]): void =>
      expectClose(runAll(src, [{ pos: [0, 0, 0, 1], uv }], 'fs'), { color });
    at([-0.45, 0], [0.95, 0.74, 0.32, 1]);
    at([0.4, 0], [0.3, 0.6, 0.95, 1]);
    at([0, 0.55], [0.9, 0.3, 0.4, 1]);
    at([0.72, 0], [0.07, 0.08, 0.14, 1]);
  });

  it('examples/class-parts.shade.ts renders the ring and the dot on every CPU path', async () => {
    const src = exampleSource('class-parts');
    const at = (uv: number[], color: number[]): void =>
      expectClose(runAll(src, [{ pos: [0, 0, 0, 1], uv }], 'fs'), { color });
    at([0.55, 0.1], [0.95, 0.7, 0.3, 1]);
    at([-0.45, -0.3], [0.3, 0.7, 0.95, 1]);
    at([0.25, 0.1], [0.06, 0.07, 0.12, 1]);
  });
});
