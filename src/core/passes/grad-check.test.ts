// gradCheck (change 0056, item 5, roadmap item 20): the check the grad tests run, as an export.
// It is held both ways (AGENTS.md#gate-discipline): it passes a right derivative in either mode,
// and it reports where a derivative and the central difference part.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { TypeShadeError } from '../diagnostics/error.js';
import { gradCheck } from './grad-check.js';
import type { ModuleDecl } from '../ir/nodes.js';

function moduleOf(src: string): ModuleDecl {
  const r = compile(`"use typeshade"\n${src}`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

describe('gradCheck', () => {
  const m = moduleOf(`export function f(p: vec2, k: f32): vec2 {
  return vec2(sin(p.x * k), p.y * p.x) * exp(k);
}
export function vis(x: f32, k: f32): f32 {
  return x < k ? 1. : 0.;
}`);
  const at = [
    [[0.3, 1.1], 0.7],
    [[-0.5, 0.2], -1.3],
  ];

  it('passes a right derivative in forward mode and in reverse mode', () => {
    for (const mode of ['forward', 'reverse'] as const) {
      const r = gradCheck(m, 'f', { wrt: ['p', 'k'], at, mode });
      // Two points, two results, three input components.
      expect(r).toEqual({ ok: true, checked: 2 * 2 * 3 });
    }
    expect(gradCheck(m, 'f', { wrt: 'k', at }).ok).toBe(true);
  });

  it('reports where a derivative and the central difference part', () => {
    // At a jump the derivative is zero (change 0056, item 7) and the difference is not.
    const r = gradCheck(m, 'vis', {
      wrt: 'k',
      at: [
        [0.2, 0.7],
        [0.5, 0.5 - 1e-7],
      ],
      mode: 'reverse',
    });
    expect(r.ok).toBe(false);
    expect(r.worst).toMatchObject({ param: 'k', point: 1, component: 0, output: 0, derivative: 0 });
    expect(r.worst!.difference).toBeGreaterThan(1e4);
  });

  it('refuses what grad refuses', () => {
    expect(() => gradCheck(m, 'f', { wrt: 'q', at })).toThrow(TypeShadeError);
    expect(() => gradCheck(m, 'nope', { wrt: 'k', at })).toThrow('no function "nope"');
  });
});
