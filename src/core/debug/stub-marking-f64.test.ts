import { describe, expect, it } from 'vitest';
import { f32T } from '../ir/index.js';
import { call, entryModule, lit, param, ref } from '../testing/ir-shorthand.js';
import { startDebugSession } from './session.js';

describe('stubbedLocals at f64 precision, where a compound assignment is not rewritten', () => {
  const m = entryModule([
    { s: 'var', name: 'acc', type: f32T, init: call('dpdx', [param('x')]) },
    { s: 'assignOp', target: ref('acc'), bop: '+', expr: lit(1) },
    { s: 'return', expr: ref('acc') },
  ]);

  it('keeps the mark through a compound assignment, whose old value is an input', () => {
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true, precision: 'f64' });
    s.stepIn();
    s.stepIn();
    expect(s.pause!.frames[0]!.stubbedLocals).toEqual(new Set(['acc']));
    s.continue();
    expect(s.result).toBe(1);
  });
});
