// #961: generated calls publish into the existing return slot, including nested calls.
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModuleJs } from './cpu-codegen.js';
import { compileModule } from './oracle.js';
import { inoutReturn } from './cpu-runtime.js';

const source = `"use typeshade";
class Counter {
  value: f32 = 0.;
  add(a: f32, b: f32): f32 { this.value += a + b; return this.value; }
  tick(): f32 { this.value += 1.; return this.value; }
  nested(): f32 { return this.add(this.tick(), 2.); }
}
export function run(): f32 {
  const c = new Counter();
  return c.nested();
}
`;

describe('generated inout return storage', () => {
  it.each(['f32', 'f64'] as const)(
    'reuses each function buffer at its parameter width (%s)',
    (precision) => {
      const r = compile(source);
      expect(r.diagnostics).toEqual([]);
      const js = compileModuleJs(r.module, { precision });
      const c = { value: 0 };
      js.fns.Counter_add!(c, 2, 3);
      const slot = inoutReturn.values;
      expect(slot).toEqual([c, 2, 3]);
      expect(js.fns.Counter_tick!(c)).toBe(6);
      const narrow = inoutReturn.values;
      expect(narrow).toEqual([c]);
      js.fns.Counter_tick!({ value: 9 });
      expect(inoutReturn.values).toBe(narrow);
      expect(js.fns.Counter_add!(c, 4, 5)).toBe(15);
      expect(inoutReturn.values).toBe(slot);
      expect(slot).toEqual([c, 4, 5]);
    },
  );

  it.each(['f32', 'f64'] as const)('publishes after nested calls finish (%s)', (precision) => {
    const r = compile(source);
    expect(r.diagnostics).toEqual([]);
    const oracle = compileModule(r.module, { precision });
    const js = compileModuleJs(r.module, { precision });
    expect(oracle.fns.run!()).toBe(4);
    expect(js.fns.run!()).toBe(4);
    // An interpreter call can replace the slot between compiled calls.
    oracle.fns.Counter_add!({ value: 0 }, 7, 8);
    expect(js.fns.Counter_tick!({ value: 10 })).toBe(11);
    expect(inoutReturn.values).toEqual([{ value: 11 }]);
  });
});
