import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { accuracyOf } from './determinism.js';

describe('the exact column of accuracyOf', () => {
  it('holds the integer, packed and bit builtins, the append and collection operations, and the barriers', () => {
    for (const op of [
      'absU',
      'dotI',
      'dotU',
      'dot4U8Packed',
      'dot4I8Packed',
      'pack4xU8',
      'pack4xI8',
      'pack4xU8Clamp',
      'pack4xI8Clamp',
      'unpack4xU8',
      'unpack4xI8',
      '~',
      'countOneBits',
      'reverseBits',
      'firstLeadingBit',
      'extractBits',
      'insertBits',
      'arrayLength',
      'push',
      'pushCount',
      'pushedReadAt',
      'pushedStoreAt',
      'collectionAdd',
      'collectionSet',
      'collectionHas',
      'collectionGet',
      'collectionSize',
      'workgroupBarrier',
      'storageBarrier',
      'textureBarrier',
      'workgroupUniformLoad',
    ]) {
      expect(accuracyOf(op), op).toEqual({ kind: 'exact' });
    }
  });

  it('holds the CPU-only operations of the libm source', () => {
    for (const op of ['__fround', '__f64Hi', '__f64Lo', '__f64FromWords', '__f64ToI32']) {
      expect(accuracyOf(op), op).toEqual({ kind: 'exact' });
    }
  });

  it('holds every id that begins with an exact prefix, the subgroup family and the f64 plumbing included', () => {
    for (const op of [
      'subgroupMin',
      'subgroupBallot',
      'storageFetchF32',
      'textureDimensions',
      'textureNumLevels',
      'textureStore',
      'atomicMax',
      'f64Guard',
      'f64FromParts',
      'f64Parts',
    ]) {
      expect(accuracyOf(op), op).toEqual({ kind: 'exact' });
    }
  });

  it('keeps degrees and radians inherited, since the product with the constant is not representable', () => {
    expect(accuracyOf('degrees')?.kind).toBe('inherited');
    expect(accuracyOf('radians')?.kind).toBe('inherited');
  });

  it('lists nothing for min and max on an emulated double', () => {
    const r = compile(`"use typeshade";
export function g(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  const y: f64 = f64(b);
  return f32(min(x, y) + max(x, y));
}`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.determinism.map((e) => e.op)).toEqual(['+']);
  });
});
