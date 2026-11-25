import { describe, expect, it } from 'vitest';
import * as ir from './index.js';
import {
  param,
  matT,
  mat3f64T,
  mat4f64T,
  vec3f64T,
  vec3fT,
  vec4fT,
  f32T,
  i32T,
  u32T,
  f64T,
  boolT,
  texture2dfT,
  texture2duT,
  texture2diT,
  typeKey,
  add,
  mix,
  select,
  construct,
  vec2u,
  vec4,
  matchExpr,
  f32,
  i32,
  u32,
  textureLoad,
  installStmtSink,
  type Node,
  type ReadonlyNode,
  type ScalarKey,
  type ShaderType,
} from './index.js';

const p = (t: ShaderType): Node<string> => param('p', t) as Node<string>;
const keyOf = (n: ReadonlyNode<string>): string => typeKey(n.type);
type Ex = {
  readonly op: string;
  readonly type: ShaderType;
  readonly args: Ex[];
  readonly a: Ex;
  readonly b: Ex;
};
const exprOf = (n: ReadonlyNode<string>): Ex => n.expr as unknown as Ex;

describe('binary result types', () => {
  it('promotes mixed scalars f32 over i32 over u32', () => {
    expect(keyOf(p(i32T).add(p(u32T)))).toBe('i32');
    expect(keyOf(p(u32T).add(p(i32T)))).toBe('i32');
    expect(keyOf(p(f32T).add(p(i32T)))).toBe('f32');
    expect(keyOf(p(u32T).add(p(f32T)))).toBe('f32');
  });

  it('refuses a bool operand', () => {
    expect(() => p(boolT).add(p(f32T))).toThrow(/SD0003/);
  });

  it('widens f32 with f64 to f64 in either order', () => {
    expect(keyOf(p(f32T).add(p(f64T)))).toBe('f64');
    expect(keyOf(p(f64T).add(p(f32T)))).toBe('f64');
  });

  it('refuses f64 with an integer and f64 modulo', () => {
    expect(() => p(f64T).add(p(i32T))).toThrow(/SD0004/);
    expect(() => p(i32T).mul(p(f64T))).toThrow(/SD0004/);
    expect(() => p(f64T).mod(p(f32T))).toThrow(/SD0041/);
    expect(() => p(f32T).mod(p(f64T))).toThrow(/SD0041/);
  });

  it('keeps vec64 with a same-width vec64 or an f32 or f64 scalar', () => {
    expect(keyOf(p(vec3f64T).add(p(vec3f64T)))).toBe('vec3<f64>');
    expect(keyOf(p(vec3f64T).mul(p(f32T)))).toBe('vec3<f64>');
    expect(keyOf(p(f64T).mul(p(vec3f64T)))).toBe('vec3<f64>');
    expect(() => p(vec3f64T).add(p(i32T))).toThrow(/SD0004/);
    expect(() => p(vec3f64T).mod(p(vec3f64T))).toThrow(/SD0041/);
    expect(() => p(vec3f64T).add(p(vec3fT))).toThrow(/SD0004/);
  });

  it('allows only the product on mat64', () => {
    expect(() => p(mat4f64T).add(p(mat4f64T))).toThrow(/SD0041/);
    expect(keyOf(p(mat4f64T).mul(p(mat4f64T)))).toBe('mat4x4<f64>');
    expect(() => p(mat4f64T).mul(p(mat3f64T))).toThrow(/SD0002/);
  });

  it('refuses a matrix product across element kinds', () => {
    expect(() => p(matT(4, 4)).mul(p(mat4f64T))).toThrow(/SD0004/);
    expect(() => p(matT(3, 3)).mul(p({ kind: 'vec', n: 3, elem: 'i32' }))).toThrow(/SD0004/);
    expect(() => p(matT(3, 3)).add(p(vec3fT))).toThrow(/SD0004/);
    expect(keyOf(p(matT(3, 3)).mul(p(vec3fT)))).toBe('vec3<f32>');
  });

  it('adds two matrices of one shape without the product dimension rule', () => {
    expect(keyOf(p(matT(2, 3)).add(p(matT(2, 3))))).toBe('mat2x3<f32>');
    expect(() => p(matT(2, 3)).add(p(matT(3, 2)))).toThrow();
  });
});

describe('comparison and logic receivers', () => {
  it('refuses a vector receiver at run time', () => {
    expect(() => p(vec3fT).lt(p(vec3fT))).toThrow(/SD0002/);
  });

  it('accepts an f64 receiver and refuses an f64 against an integer', () => {
    expect(keyOf(p(f64T).lt(p(f32T)))).toBe('bool');
    expect(() => p(f64T).lt(p(i32T))).toThrow(/SD0004/);
    expect(() => p(i32T).lt(p(f64T))).toThrow(/SD0004/);
  });

  it('refuses a non-bool receiver of and and or', () => {
    expect(() => p(f32T).and(p(boolT) as Node<'bool'>)).toThrow(/SD0004/);
    expect(() => p(i32T).or(p(boolT) as Node<'bool'>)).toThrow(/SD0004/);
    expect(keyOf(p(boolT).and(p(boolT) as Node<'bool'>))).toBe('bool');
  });
});

describe('bitwise operands', () => {
  it('lifts a bare number to the receiver kind for and, or, xor', () => {
    expect(exprOf(p(i32T).bitAnd(1)).b.type).toEqual(i32T);
    expect(exprOf(p(u32T).bitOr(1)).b.type).toEqual(u32T);
  });

  it('lifts a shift amount to the receiver kind, as the surface does for a number', () => {
    expect(exprOf(p(u32T).shl(2)).b.type).toEqual(u32T);
    expect(keyOf(p(i32T).shr(p(u32T) as Node<'u32'>))).toBe('i32');
  });

  it('refuses a float receiver', () => {
    expect(() => p(f32T).bitAnd(1)).toThrow(/SD0005/);
  });
});

describe('component access', () => {
  it('reads a vec64 component as f64', () => {
    expect(keyOf(p(vec3f64T).x)).toBe('f64');
    expect(() => p(vec3f64T).w).toThrow(/SD0007/);
  });

  it('refuses a swizzle that mixes xyzw and rgba', () => {
    expect(() => p(vec4fT).swizzle('xg')).toThrow(/SD0008[\s\S]*mixes/);
    expect(keyOf(p(vec4fT).swizzle('rgb'))).toBe('vec3<f32>');
    expect(keyOf(p(vec4fT).swizzle('xyz'))).toBe('vec3<f32>');
  });
});

describe('lifting of bare numbers', () => {
  it('construct lifts a number to the element scalar of the constructed type', () => {
    expect(exprOf(vec4(p(vec3fT), 1)).args[1].type).toEqual(f32T);
    expect(exprOf(vec2u(0, 1)).args.map((a: Ex) => a.type)).toEqual([u32T, u32T]);
    expect(exprOf(construct(vec3f64T, [1, 2, 3])).args[0].type).toEqual(f64T);
    expect(exprOf(construct({ kind: 'vec', n: 2, elem: 'i32' }, [1, 2])).args[0].type).toEqual(
      i32T,
    );
  });

  it('lifts the literal against the operand that is a node in a free function', () => {
    expect(exprOf(add(1, p(u32T))).a.type).toEqual(u32T);
    expect(exprOf(add(p(i32T), 1)).b.type).toEqual(i32T);
    expect(() => add(1, 2 as never)).toThrow(/at least one operand must be a Node/);
  });

  it('mix of two numbers lifts both to f32', () => {
    const m = mix(0.35, 1, p(f32T) as Node<'f32'>);
    expect(keyOf(m)).toBe('f32');
    expect(exprOf(m).args.map((a: Ex) => a.type)).toEqual([f32T, f32T, f32T]);
  });

  it('select of two numbers is an f32', () => {
    const s = select(p(boolT) as Node<'bool'>, 0, 1);
    expect(keyOf(s)).toBe('f32');
  });
});

describe('scalar casts and literals', () => {
  it('refuse a value that is neither a number nor a node', () => {
    expect(() => f32({} as never)).toThrow(/numeric literal or a scalar Node/);
    expect(() => i32({} as never)).toThrow(TypeError);
    expect(() => u32(undefined as never)).toThrow(TypeError);
  });

  it('refuse a non-finite literal', () => {
    expect(() => f32(Infinity)).toThrow(/finite/);
    expect(() => f32(NaN)).toThrow(/finite/);
    expect(() => construct(vec3fT, [NaN])).toThrow(/finite/);
  });
});

describe('array element and texel types', () => {
  it('at without a token reads the array element, and refuses a non-array', () => {
    const arr = p({ kind: 'array', elem: f32T, len: 4 } as ShaderType) as Node<`array<${string}>`>;
    expect(keyOf(arr.at(0))).toBe('f32');
    expect(() => (p(vec3fT) as Node<`array<${string}>`>).at(0)).toThrow(/SD0117/);
  });

  it('textureLoad follows the element of the texture', () => {
    const at = (t: ShaderType): string =>
      keyOf(textureLoad(p(t) as Node<'texture_2d<f32>'>, p(vec3fT), 0));
    expect(at(texture2dfT)).toBe('vec4<f32>');
    expect(at(texture2duT)).toBe('vec4<u32>');
    expect(at(texture2diT)).toBe('vec4<i32>');
  });
});

describe('matchExpr arms', () => {
  it('takes eager nodes and thunks alike', () => {
    const eager = matchExpr(p(u32T) as Node<'u32'>, [[1, f32(1)]], f32(0));
    const lazy = matchExpr(p(u32T) as Node<'u32'>, [[1, () => f32(1)]], () => f32(0));
    expect(exprOf(lazy)).toEqual(exprOf(eager));
    expect(() => matchExpr(p(u32T) as Node<'u32'>, [[1, f32(1)]], i32(0) as never)).toThrow(
      /SD0011/,
    );
  });
});

describe('compound assignment sinks', () => {
  it('uses assignOp when the sink has it', () => {
    const calls: string[] = [];
    installStmtSink({
      assign: () => calls.push('assign'),
      assignOp: () => calls.push('assignOp'),
    });
    p(f32T).addAssign(2);
    expect(calls).toEqual(['assignOp']);
  });

  it('falls back to assign with a binop of the promoted type when it lacks assignOp', () => {
    const seen: Array<ReadonlyNode<string>> = [];
    installStmtSink({
      assign: (_target, value) => seen.push(value as ReadonlyNode<string>),
    });
    p(i32T).addAssign(p(f32T));
    expect(seen).toHaveLength(1);
    expect(exprOf(seen[0]!)).toMatchObject({ op: 'binop', bop: '+' });
    expect(keyOf(seen[0]!)).toBe('f32');
  });
});

describe('type-level pairing', () => {
  it('keeps the kind-matched operand rules at tsc', () => {
    const f = p(f32T) as Node<'f32'>;
    const i = p(i32T) as Node<'i32'>;
    const v3 = p(vec3fT) as Node<'vec3<f32>'>;
    const v2 = p({ kind: 'vec', n: 2, elem: 'f32' }) as Node<'vec2<f32>'>;
    const d = p(f64T) as Node<'f64'>;
    const broadcast: Node<'vec3<f32>'> = f.add(v3);
    const widened: Node<'f64'> = f.add(d);
    const widenedMul: Node<'f64'> = f.mul(d);
    const cond = p(boolT) as Node<'bool'>;
    const pinned: Node<'f32'> = f.sub(cond.select(0, 1));
    expect([broadcast, widened, widenedMul, pinned]).toHaveLength(4);
    expect(() => {
      // @ts-expect-error a mixed scalar pair is a tsc error
      f.add(i);
      // @ts-expect-error a vec2 against a vec3 is a tsc error
      v3.add(v2);
      // @ts-expect-error a float receiver takes no bit operand
      f.bitAnd(f);
    }).toThrow();
    const widenedKey: ReadonlyNode<string> = d;
    const vecKey: ReadonlyNode<string> = v3;
    const scalarKey: ReadonlyNode<ScalarKey> = i;
    expect([widenedKey, vecKey, scalarKey]).toHaveLength(3);
  });
});

describe('names of the ir', () => {
  it('does not export reflect, which the std140 reflection engine owns', () => {
    expect('reflect' in ir).toBe(false);
  });
});
