// The element-converting vector constructor on the CPU, `vecN<T>(v: vecN<S>)` (#8 A8).
// Both CPU backends convert every component the way WGSL's scalar conversion does, and they
// must agree bit for bit: the interpreter is the reference and the generator is the fast
// path, and compileModuleJs falls back to the interpreter per function, so one module can be
// part each. Before this, both flattened the source components verbatim and
// `vec3<u32>(vec3<f32>(1.7, 2.9, -3.2))` came back as `[1.7, 2.9, -3.2]`.

import { describe, expect, it } from 'vitest';
import { compileModule } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import { convertComponent, convertComponents, elemKindOf } from './cpu-runtime.js';
import { emitModule } from './emit.js';
import { wgslBackend } from './backends/wgsl.js';
import { f32T, i32T, u32T, vec3fT, vec3iT, vec3uT, type ShaderType } from './ir/types.js';
import type { FuncDecl, ModuleDecl } from './ir/nodes.js';

/** `fn name(v: from) -> to { return to(v); }` as the IR node the EDSL's `vec3(v)` and the
 *  "use typeshade" `vec3f(v)` both build: one construct, one vector argument. Written out
 *  rather than through the builder so the shape under test is unmistakable. */
function convertFn(name: string, from: ShaderType, to: ShaderType): FuncDecl {
  return {
    name,
    params: [{ name: 'v', type: from }],
    ret: to,
    body: [
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: to,
          args: [{ op: 'param', type: from, name: 'v' }],
        },
      },
    ],
  };
}

describe('convertComponent', () => {
  it('is the identity when the kinds match', () => {
    expect(convertComponent(1.5, 'f32', 'f32')).toBe(1.5);
    expect(convertComponent(-1, 'i32', 'i32')).toBe(-1);
  });

  it('saturates a float source into an integer target, as WGSL does', () => {
    expect(convertComponent(1.7, 'f32', 'u32')).toBe(1);
    expect(convertComponent(-3.2, 'f32', 'u32')).toBe(0);
    expect(convertComponent(-3.2, 'f32', 'i32')).toBe(-3);
    expect(convertComponent(1e30, 'f32', 'u32')).toBe(4294967040);
    expect(convertComponent(NaN, 'f32', 'i32')).toBe(0);
  });

  it('reinterprets between i32 and u32 two’s-complement', () => {
    expect(convertComponent(-1, 'i32', 'u32')).toBe(4294967295);
    expect(convertComponent(4294967295, 'u32', 'i32')).toBe(-1);
  });

  it('takes any source into a float target as the number itself', () => {
    expect(convertComponent(4294967295, 'u32', 'f32')).toBe(4294967295);
    expect(convertComponent(-1, 'i32', 'f32')).toBe(-1);
  });

  it('maps a whole component list, and skips the work when the kinds match', () => {
    const same = [1, 2, 3];
    expect(convertComponents(same, 'f32', 'f32')).toBe(same);
    expect(convertComponents([1.7, 2.9, -3.2], 'f32', 'u32')).toEqual([1, 2, 0]);
  });

  it('names the element kind of each vector and scalar type', () => {
    expect(elemKindOf(vec3uT)).toBe('u32');
    expect(elemKindOf(f32T)).toBe('f32');
    expect(elemKindOf(i32T)).toBe('i32');
    expect(elemKindOf(u32T)).toBe('u32');
    expect(elemKindOf({ kind: 'f64' })).toBe('f64');
    expect(elemKindOf({ kind: 'struct', name: 'S' })).toBeUndefined();
  });
});

describe('a converting constructor on both CPU backends', () => {
  const m: ModuleDecl = {
    consts: [],
    structs: [],
    bindings: [],
    funcs: [
      convertFn('up', vec3uT, vec3fT),
      convertFn('down', vec3fT, vec3uT),
      convertFn('toI', vec3fT, vec3iT),
      convertFn('reint', vec3iT, vec3uT),
    ],
  };

  const cases: [string, number[], number[]][] = [
    ['up', [1, 2, 3], [1, 2, 3]],
    ['down', [1.7, 2.9, -3.2], [1, 2, 0]],
    ['toI', [1.7, 2.9, -3.2], [1, 2, -3]],
    ['reint', [-1, 2, 3], [4294967295, 2, 3]],
  ];

  it('emits the constructor WGSL spells', () => {
    const code = emitModule(m, wgslBackend);
    expect(code).toContain('return vec3<f32>(v);');
    expect(code).toContain('return vec3<u32>(v);');
    expect(code).toContain('return vec3<i32>(v);');
  });

  it.each(cases)('%s converts every component in the interpreter', (name, input, want) => {
    const cpu = compileModule(m);
    expect(cpu.fns[name]!(input)).toEqual(want);
  });

  it.each(cases)('%s converts every component in the generated code', (name, input, want) => {
    const cpu = compileModuleJs(m);
    expect(cpu.fns[name]!(input)).toEqual(want);
  });

  it('leaves an ordinary composing constructor emitting and evaluating as before', () => {
    const plain: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'plain',
          params: [{ name: 'a', type: f32T }],
          ret: vec3fT,
          body: [
            {
              s: 'return',
              expr: {
                op: 'construct',
                type: vec3fT,
                args: [
                  { op: 'param', type: f32T, name: 'a' },
                  { op: 'lit', type: f32T, value: 2 },
                  { op: 'lit', type: f32T, value: 3 },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(emitModule(plain, wgslBackend)).toContain('return vec3<f32>(a, 2.0, 3.0);');
    expect(compileModule(plain).fns.plain!(1.5)).toEqual([1.5, 2, 3]);
    expect(compileModuleJs(plain).fns.plain!(1.5)).toEqual([1.5, 2, 3]);
    // …and the generated code does not merely agree, it does not carry the conversion at all:
    // no `$.cvt` / `$.cvtVec` call is emitted where every component kind already matches. That
    // is the claim "a module that converts nothing generates what it generated before" makes,
    // and reading the source is the only way to see it — an equal result would also come from
    // a conversion that happens to be the identity.
    const source = compileModuleJs(plain).fns.plain!.toString();
    expect(source).not.toContain('$.cvt');
  });
});
