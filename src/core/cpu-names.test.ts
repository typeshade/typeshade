// The CPU oracle takes authored names (Proposal 0070, step 2, C10, T3 on the CPU tier). A module
// whose declarations are named like reserved words of WGSL and GLSL ES 3.00 runs through the
// oracle under those names: each result is keyed by the name the author wrote, and the writers
// (WGSL, GLSL) read the same module without changing the answer or the module.
//
import { describe, expect, it } from 'vitest';
import { compileModule } from './oracle.js';
import { allKindsModule } from './testing/all-kinds-module.js';
import { emitModule, emitGlslModule } from '../index.js';
import type { ModuleDecl } from './ir/index.js';
import { WGSL_RESERVED, GLSL_ES300_RESERVED } from './reserved-words.js';

/** Names the oracle must run under: a WGSL keyword, a WGSL predeclared name, a GLSL-only reserved
 *  word, and one GLSL keeps for a built-in function. */
const NAMES = ['struct', 'vec4', 'sampler', 'half', 'shared', 'texture'] as const;

const DEFAULT_KEYS = { binding: 'b', entry: 'e', field: 'f' };

/** Freeze a module and everything under it, so a writer that mutates its input fails the test. */
function deepFreeze<T>(x: T, seen = new WeakSet<object>()): T {
  if (typeof x !== 'object' || x === null || seen.has(x)) return x;
  seen.add(x);
  for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v, seen);
  return Object.freeze(x);
}

/** The compute entry of `allKindsModule` run once over one workgroup: its size is the constant and
 *  the override's default, 512 invocations, each writing its element of `bindingName` (an array
 *  of 512 structs). */
function runCompute(m: ModuleDecl, o: { binding: string; entry: string; field: string }): number[] {
  const cpu = compileModule(m, { precision: 'f32' });
  const arr: Record<string, number>[] = Array.from({ length: 512 }, () => ({ [o.field]: 0 }));
  cpu.setBinding(o.binding, arr as never);
  cpu.dispatch(o.entry, 1);
  return arr.map((x) => x[o.field]!);
}

describe('the CPU oracle runs a module under the authored names (Proposal 0070, C10)', () => {
  for (const name of NAMES) {
    // One declaration of each kind is named `name`; the others keep their defaults, so the module
    // has one declaration per name. The binding is read back under the name the author wrote.
    for (const kind of [
      'const',
      'var',
      'helper',
      'entry',
      'binding',
      'override',
      'struct',
      'field',
      'param',
    ] as const) {
      it(`runs a ${kind} named "${name}" under that name`, () => {
        const expected = runCompute(allKindsModule({}, 'compute'), DEFAULT_KEYS);
        const named = allKindsModule({ [kind]: name }, 'compute');
        expect(
          runCompute(named, {
            binding: kind === 'binding' ? name : 'b',
            entry: kind === 'entry' ? name : 'e',
            field: kind === 'field' ? name : 'f',
          }),
        ).toEqual(expected);
      });
    }

    it(`calls a helper named "${name}" by that name, and returns its argument`, () => {
      const cpu = compileModule(allKindsModule({ helper: name }, 'compute'), { precision: 'f32' });
      expect(cpu.fns[name]!(3)).toBe(3);
    });
  }

  it('gives the same answer after both writers have read the module, and leaves the module unchanged', () => {
    const module = allKindsModule({ binding: 'half', struct: 'vec4' }, 'compute');
    const before = runCompute(module, { binding: 'half', entry: 'e', field: 'f' });
    deepFreeze(module);
    // The WGSL writer reads a frozen module; a write to it would throw.
    expect(() => emitModule(module)).not.toThrow();
    expect(runCompute(module, { binding: 'half', entry: 'e', field: 'f' })).toEqual(before);
    // The GLSL writer reads a graphics module the same way.
    const graphics = deepFreeze(
      allKindsModule({ texture: 'texture', binding: 'half' }, 'graphics'),
    );
    const cpuGraphics = compileModule(graphics, { precision: 'f32' });
    const helper = cpuGraphics.fns['h']!(3);
    expect(() => emitGlslModule(graphics, 'vertex')).not.toThrow();
    expect(cpuGraphics.fns['h']!(3)).toBe(helper);
  });

  it('names no word of either target in its keys: every key is the authored one', () => {
    const module = allKindsModule({ binding: 'struct', helper: 'half' }, 'compute');
    const cpu = compileModule(module, { precision: 'f32' });
    expect(Object.keys(cpu.fns)).toContain('half');
    expect(WGSL_RESERVED.has('struct')).toBe(true);
    expect(GLSL_ES300_RESERVED.has('half')).toBe(true);
  });
});
