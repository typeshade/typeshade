import { describe, expect, it } from 'vitest';
import type { ShaderType, StructDecl } from '../../core/ir/index.js';
import { boolT, f32T, i32T, matT, u32T, vec2fT, vec3fT } from '../../core/ir/types.js';
import {
  absentOf,
  isOptional,
  logicalTypeKey,
  mayBeOptional,
  notOf,
  optionalAbsence,
  optionalDeclOf,
  optionalInner,
  optionalStructName,
  optionalT,
  presentFlagOf,
  presentOf,
  valueOf,
  zeroOfInner,
  type StructLookup,
} from './optional.js';

const noStructs: StructLookup = () => undefined;
const lit = (type: ShaderType, value: number | boolean) => ({ op: 'lit', type, value });

describe('optional representation', () => {
  it('names the struct over a payload from its key with unsafe characters replaced', () => {
    expect(optionalStructName(f32T)).toBe('__opt_f32');
    expect(optionalStructName(vec2fT)).toBe('__opt_vec2_f32');
    expect(optionalStructName({ kind: 'array', elem: f32T, size: 4 })).toBe('__opt_array_f32_4');
    expect(optionalStructName({ kind: 'struct', name: 'Ray' })).toBe('__opt_Ray');
  });

  it('registers the struct as value then present, with isNull last for three states', () => {
    const one = optionalT(vec3fT);
    expect(optionalDeclOf('__opt_vec3_f32')).toEqual({
      name: '__opt_vec3_f32',
      fields: [
        { name: 'value', type: vec3fT },
        { name: 'present', type: boolT },
      ],
    });
    const three = optionalT(vec3fT, 3);
    expect(three).toMatchObject({ kind: 'struct', name: '__opt3_vec3_f32' });
    expect(optionalDeclOf('__opt3_vec3_f32')!.fields.map((f) => f.name)).toEqual([
      'value',
      'present',
      'isNull',
    ]);
    expect(one).toEqual({ kind: 'struct', name: '__opt_vec3_f32' });
  });

  it('shares one physical struct between undefined-only and null-only optionals', () => {
    const undefinedOnly = optionalT(i32T, 1);
    const nullOnly = optionalT(i32T, 2);
    expect((nullOnly as { name: string }).name).toBe((undefinedOnly as { name: string }).name);
    expect(optionalAbsence(undefinedOnly)).toBe(1);
    expect(optionalAbsence(nullOnly)).toBe(2);
    expect(logicalTypeKey(nullOnly)).not.toBe(logicalTypeKey(undefinedOnly));
  });

  it('keeps a physical payload in the declaration and the logical one on the descriptor', () => {
    const inner = optionalT(u32T, 2);
    const outer = optionalT({ kind: 'array', elem: inner, size: 2 });
    const decl = optionalDeclOf((outer as { name: string }).name) as StructDecl;
    expect(decl.fields[0]!.type).toEqual({
      kind: 'array',
      elem: { kind: 'struct', name: (inner as { name: string }).name },
      size: 2,
    });
    expect(optionalInner(outer)).toEqual({ kind: 'array', elem: inner, size: 2 });
    expect(logicalTypeKey(outer)).not.toBe(
      logicalTypeKey(optionalT({ kind: 'array', elem: optionalT(u32T), size: 2 })),
    );
  });

  it('tells an optional from any other struct, and gives a name no declaration', () => {
    expect(isOptional(optionalT(f32T))).toBe(true);
    expect(isOptional({ kind: 'struct', name: 'Plain' })).toBe(false);
    expect(isOptional(undefined)).toBe(false);
    expect(optionalInner(f32T)).toBeUndefined();
    expect(optionalDeclOf('Plain')).toBeUndefined();
    expect(optionalAbsence({ kind: 'struct', name: 'Plain' })).toBeUndefined();
  });

  it('lets an optional hold a scalar, a vector, a matrix, a sized array and a struct only', () => {
    expect(mayBeOptional(f32T)).toBe(true);
    expect(mayBeOptional(vec2fT)).toBe(true);
    expect(mayBeOptional(matT(2, 2))).toBe(true);
    expect(mayBeOptional({ kind: 'f64' })).toBe(true);
    expect(mayBeOptional({ kind: 'vec64', n: 2 })).toBe(true);
    expect(mayBeOptional({ kind: 'struct', name: 'Plain' })).toBe(true);
    expect(mayBeOptional({ kind: 'array', elem: f32T, size: 3 })).toBe(true);
    expect(mayBeOptional({ kind: 'array', elem: f32T })).toBe(false);
    expect(mayBeOptional(optionalT(f32T))).toBe(false);
    expect(mayBeOptional({ kind: 'atomic', elem: 'u32' })).toBe(false);
    expect(mayBeOptional({ kind: 'sampler' })).toBe(false);
    expect(mayBeOptional({ kind: 'void' } as ShaderType)).toBe(false);
  });

  it('spells the zero of each payload kind', () => {
    expect(zeroOfInner(f32T, noStructs)).toEqual(lit(f32T, 0));
    expect(zeroOfInner(i32T, noStructs)).toEqual(lit(i32T, 0));
    expect(zeroOfInner(u32T, noStructs)).toEqual(lit(u32T, 0));
    expect(zeroOfInner(boolT, noStructs)).toEqual(lit(boolT, false));
    expect(zeroOfInner({ kind: 'f64' }, noStructs)).toEqual(lit({ kind: 'f64' }, 0));
    expect(zeroOfInner({ kind: 'vec', n: 2, elem: 'bool' }, noStructs)).toEqual({
      op: 'construct',
      type: { kind: 'vec', n: 2, elem: 'bool' },
      args: [lit(boolT, false), lit(boolT, false)],
    });
    expect(zeroOfInner({ kind: 'vec', n: 3, elem: 'u32' }, noStructs)).toMatchObject({
      args: [lit(u32T, 0), lit(u32T, 0), lit(u32T, 0)],
    });
    expect(zeroOfInner({ kind: 'vec64', n: 2 }, noStructs)).toMatchObject({
      args: [lit({ kind: 'f64' }, 0), lit({ kind: 'f64' }, 0)],
    });
  });

  it('spells the zero of a matrix by columns, an array by elements, a struct by fields', () => {
    const mat = zeroOfInner(matT(3, 2), noStructs) as unknown as { args: { type: ShaderType }[] };
    expect(mat.args).toHaveLength(3);
    expect(mat.args[0]!.type).toEqual({ kind: 'vec', n: 2, elem: 'f32' });
    const mat64 = zeroOfInner(matT(2, 2, 'f64'), noStructs) as unknown as {
      args: { type: ShaderType }[];
    };
    expect(mat64.args[0]!.type).toEqual({ kind: 'vec64', n: 2 });
    const array = zeroOfInner({ kind: 'array', elem: i32T, size: 3 }, noStructs) as unknown as {
      args: unknown[];
    };
    expect(array.args).toEqual([lit(i32T, 0), lit(i32T, 0), lit(i32T, 0)]);
    const structs: StructLookup = (name) =>
      name === 'P'
        ? {
            name: 'P',
            fields: [
              { name: 'a', type: f32T },
              { name: 'b', type: u32T },
            ],
          }
        : undefined;
    expect(zeroOfInner({ kind: 'struct', name: 'P' }, structs)).toMatchObject({
      args: [lit(f32T, 0), lit(u32T, 0)],
    });
  });

  it('builds the absent value as zero with present false, and null marks its own flag', () => {
    const one = optionalT(f32T);
    expect(absentOf(one, f32T, noStructs)).toEqual({
      op: 'construct',
      type: one,
      args: [lit(f32T, 0), lit(boolT, false)],
    });
    const three = optionalT(f32T, 3);
    expect((absentOf(three, f32T, noStructs, 1) as unknown as { args: unknown[] }).args).toEqual([
      lit(f32T, 0),
      lit(boolT, false),
      lit(boolT, false),
    ]);
    expect((absentOf(three, f32T, noStructs, 2) as unknown as { args: unknown[] }).args[2]).toEqual(
      lit(boolT, true),
    );
  });

  it('builds the present value with present true and isNull false', () => {
    const value = lit(f32T, 1);
    expect(presentOf(optionalT(f32T), value as never)).toMatchObject({
      args: [value, lit(boolT, true)],
    });
    const args = (presentOf(optionalT(f32T, 3), value as never) as unknown as { args: unknown[] })
      .args;
    expect(args).toEqual([value, lit(boolT, true), lit(boolT, false)]);
  });

  it('reads the value and the flag by member, and spells not as a comparison with false', () => {
    const v = { op: 'var', name: 'v', type: optionalT(f32T) } as never;
    expect(valueOf(v, f32T)).toEqual({ op: 'member', type: f32T, base: v, field: 'value' });
    expect(presentFlagOf(v)).toEqual({ op: 'member', type: boolT, base: v, field: 'present' });
    const b = lit(boolT, true) as never;
    expect(notOf(b)).toEqual({
      op: 'compare',
      type: boolT,
      cop: '==',
      a: b,
      b: lit(boolT, false),
    });
  });

  it('keys a fixed array by its pipeline override as well as its size', () => {
    const plain: ShaderType = { kind: 'array', elem: f32T, size: 4 };
    const overridden: ShaderType = { ...plain, sizeOverride: 'N' } as ShaderType;
    expect(logicalTypeKey(overridden)).toBe('array<f32,N>');
    expect(logicalTypeKey(plain)).toBe('array<f32,4>');
  });
});
