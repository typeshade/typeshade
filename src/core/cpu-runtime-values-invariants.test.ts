import { describe, expect, it } from 'vitest';
import {
  BUILTINS,
  cloneValue,
  convertComponent,
  convertComponents,
  copiedParams,
  elemKindOf,
  f32ToI32Sat,
  f32ToU32Sat,
  isAggregateType,
  matColumn,
  matMul,
  matMulShaped,
  matTransposeShaped,
  matVec,
  matVecShaped,
  setMatColumn,
  vecMatShaped,
  zeroOf,
  type CpuValue,
} from './cpu-runtime.js';
import type { ShaderType, StructDecl } from './ir/index.js';

const call = (name: string, ...args: unknown[]): CpuValue => {
  const f = BUILTINS[name];
  if (f === undefined) throw new Error(`no builtin ${name}`);
  return f(...(args as CpuValue[]));
};
const ty = (t: object): ShaderType => t as ShaderType;

describe('packed formats', () => {
  it('pack4x8unorm rounds the f32 product, so e = 0.8098039031028748 packs 207', () => {
    expect(call('pack4x8unorm', [0.8098039031028748, 0, 0, 0])).toBe(207);
    expect(call('pack4x8unorm', [1, 0.5, 0, 0])).toBe(0x80ff);
    expect(call('pack4x8unorm', [2, -1, 0, 0])).toBe(0xff);
  });
  it('pack4x8snorm packs a NaN as the largest value and the low byte first', () => {
    expect(call('pack4x8snorm', [Number.NaN, 0, 0, 0])).toBe(127);
    expect(call('pack4x8snorm', [0.011811023578047752, 0, 0, 0])).toBe(2);
    expect(call('pack4x8snorm', [1, -1, 0, 0])).toBe(0x817f);
    expect(call('pack4x8snorm', [2, -2, 0, 0])).toBe(0x817f);
  });
  it('unpack4x8 reads component 0 from the low byte and clamps -128 to -1', () => {
    expect(call('unpack4x8unorm', 0xff)).toEqual([1, 0, 0, 0]);
    expect(call('unpack4x8snorm', 0x80)).toEqual([-1, 0, 0, 0]);
    expect(call('unpack4x8snorm', 0x7f)).toEqual([1, 0, 0, 0]);
  });
  it('the 4x8 integer family reads four bytes, low byte first', () => {
    expect(call('unpack4xU8', 0x04030201)).toEqual([1, 2, 3, 4]);
    expect(call('unpack4xI8', 0x80ff7f01)).toEqual([1, 127, -1, -128]);
    expect(call('pack4xU8', [1, 2, 3, 4])).toBe(0x04030201);
    expect(call('pack4xU8', [257, 2, 3, 4])).toBe(0x04030201);
    expect(call('pack4xI8', [-1, 2, 3, 4])).toBe(0x040302ff);
    expect(call('pack4xU8Clamp', [300, -5, 255, 0])).toBe(0x00ff00ff);
    expect(call('pack4xI8Clamp', [200, -200, 5, -1])).toBe(0xff05807f);
    expect(call('dot4U8Packed', 0x01020304, 0x01010101)).toBe(10);
    expect(call('dot4I8Packed', 0xffffffff, 0x01010101)).toBe(-4);
  });
  it('the 2x16 pair puts component 0 in the low bits and rounds half up', () => {
    expect(call('pack2x16unorm', [1, 1])).toBe(0xffffffff);
    expect(call('pack2x16unorm', [0.5, 0])).toBe(0x8000);
    expect(call('pack2x16snorm', [-1, 1])).toBe(0x7fff8001);
    expect(call('unpack2x16unorm', 0xffff0000)).toEqual([0, 1]);
    expect(call('unpack2x16snorm', 0x8000)).toEqual([-1, 0]);
    expect(call('unpack2x16snorm', 0x00007fff)).toEqual([1, 0]);
  });
  it('the 2x16 float pack encodes binary16 and decodes it exactly', () => {
    expect(call('pack2x16float', [1, 2])).toBe(0x40003c00);
    expect(call('pack2x16float', [65520, Number.NaN])).toBe(0x7e007c00);
    expect(call('pack2x16float', [-Infinity, -0])).toBe(0x8000fc00);
    expect(call('pack2x16float', [2 ** -24, 2 ** -25])).toBe(0x00000001);
    expect(call('unpack2x16float', 0x40003c00)).toEqual([1, 2]);
    expect(call('unpack2x16float', 0x0001)).toEqual([2 ** -24, 0]);
    expect(call('unpack2x16float', 0x7c00)).toEqual([Infinity, 0]);
    expect(call('unpack2x16float', 0x7e00) as number[]).toSatisfy((v: number[]) =>
      Number.isNaN(v[0]),
    );
  });
  it('quantizeToF16 rounds to nearest even on every id', () => {
    for (const id of [
      'quantizeToF16',
      'quantizeToF16Vec2',
      'quantizeToF16Vec3',
      'quantizeToF16Vec4',
    ]) {
      expect(call(id, 1 + 2 ** -11)).toBe(1);
      expect(call(id, 1 + 3 * 2 ** -11)).toBe(1 + 2 ** -9);
      expect(call(id, 65519)).toBe(65504);
      expect(call(id, 65520)).toBe(Infinity);
      expect(call(id, 1e6)).toBe(Infinity);
      expect(call(id, -1e6)).toBe(-Infinity);
      expect(call(id, 2 ** -24)).toBe(2 ** -24);
      expect(call(id, 1.5 * 2 ** -25)).toBe(2 ** -24);
      expect(call(id, 2 ** -26)).toBe(0);
      expect(call(id, [1 + 2 ** -11, -0.1])).toEqual([1, -0.0999755859375]);
    }
  });
});

describe('bit reinterpretation', () => {
  it('bitcast rounds to f32 and reads little-endian bits', () => {
    expect(call('bitcastU32', 1)).toBe(0x3f800000);
    expect(call('bitcastU32', 0.1)).toBe(0x3dcccccd);
    expect(call('bitcastF32', 0x3f800000)).toBe(1);
    expect(call('bitcastF32', -1)).toBe(call('bitcastF32', 0xffffffff));
    expect(call('bitcastVec2U32', [1, 2])).toEqual([0x3f800000, 0x40000000]);
    expect(call('bitcastVec4F32', [0x3f800000, 0, 0, 0x40000000])).toEqual([1, 0, 0, 2]);
  });
  it('the f64 word operations use a fixed byte order', () => {
    expect(call('__f64Hi', 1)).toBe(0x3ff00000);
    expect(call('__f64Lo', 1)).toBe(0);
    expect(call('__f64Hi', -2)).toBe(0xc0000000);
    expect(call('__f64Lo', 5e-324)).toBe(1);
    expect(call('__f64FromWords', 0x3ff00000, 0)).toBe(1);
    const hi = call('__f64Hi', Math.PI);
    const lo = call('__f64Lo', Math.PI);
    expect(call('__f64FromWords', hi, lo)).toBe(Math.PI);
  });
  it('__f64ToI32 truncates, sends NaN to 0 and saturates', () => {
    expect(call('__f64ToI32', -3.9)).toBe(-3);
    expect(call('__f64ToI32', Number.NaN)).toBe(0);
    expect(call('__f64ToI32', 1e20)).toBe(2147483647);
    expect(call('__f64ToI32', -1e20)).toBe(-2147483648);
  });
});

describe('arrays, collections and saturation', () => {
  it('arrayLength is the length of the bound array', () => {
    expect(call('arrayLength', [1, 2, 3])).toBe(3);
  });
  it('push counts past the capacity and stores only inside it', () => {
    const xs = [0, 0];
    expect(call('push', xs, 1)).toBe(1);
    expect(call('push', xs, 2)).toBe(2);
    expect(call('push', xs, 3)).toBe(3);
    expect(xs).toEqual([1, 2]);
  });
  it('a map copies its value in and out, and a set keeps insertion semantics', () => {
    const m = new Map();
    const v = [1, 2];
    call('collectionSet', m, 1, v);
    v[0] = 99;
    expect(m.get(1)).toEqual([1, 2]);
    const out = call('collectionGet', m, 1) as number[];
    out[1] = 99;
    expect(m.get(1)).toEqual([1, 2]);
    expect(call('collectionHas', m, 1)).toBe(true);
    const s = new Set();
    call('collectionAdd', s, 4);
    call('collectionAdd', s, 4);
    expect(call('collectionHas', s, 4)).toBe(true);
    expect(call('collectionSize', s)).toBe(1);
  });
  it('a float source saturates at the largest f32-representable bound', () => {
    expect(f32ToU32Sat(1e20)).toBe(4294967040);
    expect(f32ToU32Sat(-5)).toBe(0);
    expect(f32ToU32Sat(Number.NaN)).toBe(0);
    expect(f32ToU32Sat(1.9)).toBe(1);
    expect(f32ToI32Sat(1e20)).toBe(2147483520);
    expect(f32ToI32Sat(-1e20)).toBe(-2147483648);
    expect(f32ToI32Sat(Number.NaN)).toBe(0);
    expect(f32ToI32Sat(-1.9)).toBe(-1);
  });
  it('an element-converting constructor follows the scalar rules', () => {
    expect(convertComponents([1.7, 2.9, -3.2], 'f32', 'u32')).toEqual([1, 2, 0]);
    expect(convertComponent(-1, 'i32', 'u32')).toBe(4294967295);
    expect(convertComponent(4294967295, 'u32', 'i32')).toBe(-1);
    expect(convertComponent(1e20, 'f64', 'i32')).toBe(2147483520);
    expect(convertComponent(5, 'u32', 'f32')).toBe(5);
    const same = [1.7];
    expect(convertComponents(same, 'f32', 'f32')).toBe(same);
    expect(convertComponents([1, 0], 'bool', 'f32')).toEqual([1, 0]);
  });
  it('elemKindOf names the single numeric element kind or nothing', () => {
    expect(elemKindOf(ty({ kind: 'vec', n: 2, elem: 'u32' }))).toBe('u32');
    expect(elemKindOf(ty({ kind: 'scalar', scalar: 'i32' }))).toBe('i32');
    expect(elemKindOf(ty({ kind: 'f64' }))).toBe('f64');
    expect(elemKindOf(ty({ kind: 'mat', cols: 2, rows: 2 }))).toBeUndefined();
    expect(elemKindOf(ty({ kind: 'struct', name: 'S' }))).toBeUndefined();
  });
});

describe('value semantics', () => {
  it('cloneValue copies arrays and structs deeply', () => {
    const v = { a: [1, [2, 3]], b: { c: 4 } } as unknown as CpuValue;
    const w = cloneValue(v) as unknown as { a: [number, number[]]; b: { c: number } };
    expect(w).toEqual(v);
    w.a[1]![0] = 99;
    w.b.c = 99;
    expect(v).toEqual({ a: [1, [2, 3]], b: { c: 4 } });
    expect(cloneValue(5)).toBe(5);
  });
  it('only a vector, matrix, array, struct or emulated-double vector is an aggregate', () => {
    for (const t of [
      { kind: 'vec', n: 2, elem: 'f32' },
      { kind: 'vec64', n: 2 },
      { kind: 'mat', cols: 2, rows: 2 },
      { kind: 'array', elem: { kind: 'scalar', scalar: 'f32' }, size: 2 },
      { kind: 'struct', name: 'S' },
    ]) {
      expect(isAggregateType(ty(t))).toBe(true);
    }
    expect(isAggregateType(ty({ kind: 'scalar', scalar: 'f32' }))).toBe(false);
    expect(isAggregateType(ty({ kind: 'f64' }))).toBe(false);
  });
  it('a function that writes copies its aggregate by-value parameters, not inout ones', () => {
    const params = [
      { type: ty({ kind: 'vec', n: 2, elem: 'f32' }) },
      { type: ty({ kind: 'scalar', scalar: 'f32' }) },
      { type: ty({ kind: 'struct', name: 'S' }), mode: 'inout' as const },
    ];
    expect(copiedParams(params, true)).toEqual([true, false, false]);
    expect(copiedParams(params, false)).toEqual([false, false, false]);
  });
});

describe('zero values', () => {
  const structs = new Map<string, StructDecl>([
    ['In', { name: 'In', fields: [{ name: 'k', type: ty({ kind: 'scalar', scalar: 'bool' }) }] }],
    [
      'S',
      {
        name: 'S',
        fields: [
          { name: 'a', type: ty({ kind: 'vec', n: 2, elem: 'f32' }) },
          { name: 'in', type: ty({ kind: 'struct', name: 'In' }) },
          {
            name: 'xs',
            type: ty({ kind: 'array', elem: { kind: 'scalar', scalar: 'f32' }, size: 2 }),
          },
        ],
      } as unknown as StructDecl,
    ],
  ]);
  it('vectors, matrices and bools start at zero or false', () => {
    expect(zeroOf(ty({ kind: 'vec', n: 3, elem: 'f32' }))).toEqual([0, 0, 0]);
    expect(zeroOf(ty({ kind: 'vec', n: 2, elem: 'bool' }))).toEqual([false, false]);
    expect(zeroOf(ty({ kind: 'vec64', n: 2 }))).toEqual([0, 0]);
    expect(zeroOf(ty({ kind: 'mat', cols: 2, rows: 3 }))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(zeroOf(ty({ kind: 'scalar', scalar: 'bool' }))).toBe(false);
    expect(zeroOf(ty({ kind: 'scalar', scalar: 'f32' }))).toBe(0);
  });
  it('a struct zero-initialises field by field and an unknown struct is empty', () => {
    expect(zeroOf(ty({ kind: 'struct', name: 'S' }), structs)).toEqual({
      a: [0, 0],
      in: { k: false },
      xs: [0, 0],
    });
    expect(zeroOf(ty({ kind: 'struct', name: 'S' }))).toEqual({});
  });
  it('an array owns its elements and a runtime-sized one starts empty', () => {
    const t = ty({ kind: 'array', elem: { kind: 'vec', n: 2, elem: 'f32' }, size: 2 });
    const a = zeroOf(t) as unknown as number[][];
    a[0]![0] = 1;
    expect(a).toEqual([
      [1, 0],
      [0, 0],
    ]);
    expect(zeroOf(ty({ kind: 'array', elem: { kind: 'scalar', scalar: 'f32' } }))).toEqual([]);
  });
  it('an array-size override must be a positive integer', () => {
    const t = ty({ kind: 'array', elem: { kind: 'scalar', scalar: 'f32' }, sizeOverride: 'N' });
    expect(zeroOf(t, undefined, new Map([['N', 3]]))).toEqual([0, 0, 0]);
    for (const bad of [0, 1.5, -1]) {
      expect(() => zeroOf(t, undefined, new Map([['N', bad]]))).toThrow(
        /array-size override 'N' must be a positive integer/,
      );
    }
  });
});

describe('matrix helpers (column-major)', () => {
  const m23 = [1, 2, 3, 4, 5, 6];
  it('matrix times column vector', () => {
    expect(matVecShaped(m23, [1, 10], 2, 3)).toEqual([41, 52, 63]);
    expect(matVec([1, 2, 3, 4], [1, 1])).toEqual([4, 6]);
    expect(matVec([1, 0, 0, 0, 1, 0, 0, 0, 1], [7, 8, 9])).toEqual([7, 8, 9]);
  });
  it('row vector times matrix is transpose(m) * v', () => {
    expect(vecMatShaped([1, 1, 1], m23, 2, 3)).toEqual([6, 15]);
  });
  it('matrix products take the shape from the arguments', () => {
    expect(matMulShaped(m23, [1, 10], 2, 3, 1)).toEqual([41, 52, 63]);
    expect(matMulShaped(m23, [1, 10, 2, 20], 2, 3, 2)).toEqual([41, 52, 63, 82, 104, 126]);
    expect(matMul([1, 2, 3, 4], [5, 6, 7, 8])).toEqual([23, 34, 31, 46]);
  });
  it('a column is read and written as a whole', () => {
    expect(matColumn(m23, 1, 3)).toEqual([4, 5, 6]);
    const m = [...m23];
    setMatColumn(m, 1, 3, [7, 8, 9]);
    expect(m).toEqual([1, 2, 3, 7, 8, 9]);
  });
  it('transpose swaps rows and columns, shaped or square', () => {
    expect(matTransposeShaped(m23, 2, 3)).toEqual([1, 4, 2, 5, 3, 6]);
    expect(call('transpose', [1, 2, 3, 4])).toEqual([1, 3, 2, 4]);
  });
});
