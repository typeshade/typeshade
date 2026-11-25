import { describe, expect, it } from 'vitest';
import {
  atan2,
  f32T,
  f64T,
  i32T,
  matT,
  param,
  samplerT,
  texture2dArrayfT,
  texture2dfT,
  textureLoad,
  textureSampleLevel,
  typeKey,
  vec2fT,
  vec2iT,
  vec3fT,
  type Node,
  type ReadonlyNode,
  type ShaderType,
} from './index.js';

const p = (t: ShaderType): Node<string> => param('p', t) as Node<string>;
const keyOf = (n: ReadonlyNode<string>): string => typeKey(n.type);
type Lit = { readonly op: string; readonly type: ShaderType; readonly value: number };
const argsOf = (n: ReadonlyNode<string>): Lit[] =>
  (n.expr as unknown as { args: Lit[] }).args.filter((a) => a.op === 'lit');

describe('the level and the layer of a texture read', () => {
  const tex = p(texture2dfT) as Node<'texture_2d<f32>'>;
  const array = p(texture2dArrayfT) as Node<'texture_2d_array<f32>'>;
  const smp = p(samplerT) as Node<'sampler'>;
  const uv = p(vec2fT) as Node<'vec2<f32>'>;
  const at = p(vec2iT);

  it('lifts the bare level of textureLoad to an integer literal, and not to f32', () => {
    const [level] = argsOf(textureLoad(tex, at, 3));
    expect(typeKey(level!.type)).toBe('u32');
    expect(level!.value).toBe(3);
    const [layer, mip] = argsOf(textureLoad(array, at, 1, 2));
    expect(typeKey(layer!.type)).toBe('i32');
    expect(typeKey(mip!.type)).toBe('u32');
  });

  it('refuses a fractional level or layer with SD0015', () => {
    expect(() => textureLoad(tex, at, 1.5)).toThrow(/SD0015/);
    expect(() => textureLoad(array, at, 1, 0.5)).toThrow(/SD0015/);
    expect(() => textureLoad(array, at, 0.5, 1)).toThrow(/SD0015/);
  });

  it('keeps the level of textureSampleLevel an f32 literal, fractions included', () => {
    const [level] = argsOf(textureSampleLevel(tex, smp, uv, 1.5));
    expect(typeKey(level!.type)).toBe('f32');
    expect(level!.value).toBe(1.5);
    const [layer, mip] = argsOf(textureSampleLevel(array, smp, uv, 1, 2.5));
    expect(typeKey(layer!.type)).toBe('i32');
    expect(typeKey(mip!.type)).toBe('f32');
    expect(mip!.value).toBe(2.5);
  });
});

describe('the matrix table of a binary operation', () => {
  const m = p(matT(3, 2));
  const n = p(matT(2, 3));
  const s = p(f32T);
  const v3 = p(vec3fT);
  const v2 = p(vec2fT);

  it('scales a matrix by an f32 scalar on either side, to the matrix type', () => {
    expect(keyOf(m.mul(s))).toBe('mat3x2<f32>');
    expect(keyOf(s.mul(m))).toBe('mat3x2<f32>');
    expect(() => m.mul(p(i32T))).toThrow(/SD0004/);
  });

  it('gives a vector of the rows for a matrix times a vector of the columns', () => {
    expect(keyOf(m.mul(v3))).toBe('vec2<f32>');
    expect(() => m.mul(v2)).toThrow(/SD0001/);
  });

  it('gives a vector of the columns for a vector of the rows times a matrix', () => {
    expect(keyOf(v2.mul(m))).toBe('vec3<f32>');
    expect(() => v3.mul(m)).toThrow(/SD0001/);
  });

  it('gives columns of the right and rows of the left for a matrix product', () => {
    expect(keyOf(m.mul(n))).toBe('mat2x2<f32>');
    expect(keyOf(n.mul(m))).toBe('mat3x3<f32>');
    expect(keyOf(p(matT(2, 3)).mul(p(matT(4, 2))))).toBe('mat4x3<f32>');
    expect(() => m.mul(m)).toThrow(/SD0001/);
  });

  it('refuses a division and a modulo of a matrix by anything', () => {
    for (const other of [s, v3, n]) {
      expect(() => m.div(other)).toThrow(/SD0004/);
      expect(() => m.mod(other)).toThrow(/SD0004/);
    }
    expect(() => v3.div(m)).toThrow(/SD0004/);
  });

  it('refuses a scalar sum, difference and quotient with a matrix, on either side', () => {
    for (const make of [
      (a: Node<string>, b: Node<string>) => a.add(b),
      (a: Node<string>, b: Node<string>) => a.sub(b),
      (a: Node<string>, b: Node<string>) => a.div(b),
    ]) {
      expect(() => make(m, s)).toThrow(/SD0004/);
      expect(() => make(s, m)).toThrow(/SD0004/);
    }
  });
});

describe('type-level', () => {
  it('types the f64 widening of sub and div, the vector broadcast of mod, and refuses a vector atan2', () => {
    const f = p(f32T) as Node<'f32'>;
    const d = p(f64T) as Node<'f64'>;
    const v3 = p(vec3fT) as Node<'vec3<f32>'>;
    const widenedSub: Node<'f64'> = f.sub(d);
    const widenedDiv: Node<'f64'> = f.div(d);
    const broadcast: Node<'vec3<f32>'> = f.mod(v3);
    expect([widenedSub, widenedDiv, broadcast]).toHaveLength(3);
    expect(keyOf(widenedSub)).toBe('f64');
    expect(keyOf(widenedDiv)).toBe('f64');
    expect(keyOf(broadcast)).toBe('vec3<f32>');
    // @ts-expect-error mod has no f64 widening
    expect(() => f.mod(d)).toThrow(/SD0041/);
    // @ts-expect-error a literal y takes a scalar x only
    expect(() => atan2(1, v3)).not.toThrow();
  });
});
