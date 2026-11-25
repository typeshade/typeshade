import type { Expr, StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, f32T, i32T, typeKey, u32T } from '../../../core/ir/types.js';
import { optionalAbsence } from './registry.js';

export type StructLookup = (name: string) => StructDecl | undefined;

// Why: the zero is spelled out as an expression so that the CPU oracle and GLSL ES 3.00 start the
// value where WGSL's zero constructor would.
export function zeroOfInner(inner: ShaderType, structs: StructLookup): Expr {
  switch (inner.kind) {
    case 'scalar': {
      const k = typeKey(inner);
      if (k === 'bool') return { op: 'lit', type: boolT, value: false };
      if (k === 'i32') return { op: 'lit', type: i32T, value: 0 };
      if (k === 'u32') return { op: 'lit', type: u32T, value: 0 };
      // Why: a key type is a u32 id (`keysOf`), so it took the integer arm above.
      return { op: 'lit', type: f32T, value: 0 };
    }
    case 'f64':
      return { op: 'lit', type: inner, value: 0 };
    case 'vec': {
      const elemT =
        inner.elem === 'f32'
          ? f32T
          : inner.elem === 'i32'
            ? i32T
            : inner.elem === 'u32'
              ? u32T
              : boolT;
      const zero: Expr =
        inner.elem === 'bool'
          ? { op: 'lit', type: boolT, value: false }
          : { op: 'lit', type: elemT, value: 0 };
      return { op: 'construct', type: inner, args: Array.from({ length: inner.n }, () => zero) };
    }
    case 'vec64': {
      const zero: Expr = { op: 'lit', type: { kind: 'f64' }, value: 0 };
      return { op: 'construct', type: inner, args: Array.from({ length: inner.n }, () => zero) };
    }
    case 'mat': {
      const column: ShaderType =
        inner.elem === 'f64'
          ? { kind: 'vec64', n: inner.rows }
          : { kind: 'vec', n: inner.rows, elem: 'f32' };
      const zero = zeroOfInner(column, structs);
      return { op: 'construct', type: inner, args: Array.from({ length: inner.cols }, () => zero) };
    }
    case 'array': {
      const elem = zeroOfInner(inner.elem, structs);
      return {
        op: 'construct',
        type: inner,
        args: Array.from({ length: inner.size ?? 0 }, () => elem),
      };
    }
    case 'struct': {
      const decl = structs(inner.name);
      return {
        op: 'construct',
        type: inner,
        args: (decl?.fields ?? []).map((f) => zeroOfInner(f.type, structs)),
      };
    }
    default:
      return { op: 'construct', type: inner, args: [] };
  }
}

export function absentOf(
  opt: ShaderType,
  inner: ShaderType,
  structs: StructLookup,
  absence: 1 | 2 = optionalAbsence(opt) === 2 ? 2 : 1,
): Expr {
  return {
    op: 'construct',
    type: opt,
    args: [
      zeroOfInner(inner, structs),
      { op: 'lit', type: boolT, value: false },
      ...(optionalAbsence(opt) === 3
        ? [{ op: 'lit' as const, type: boolT, value: absence === 2 }]
        : []),
    ],
  };
}

export function presentOf(opt: ShaderType, value: Expr): Expr {
  return {
    op: 'construct',
    type: opt,
    args: [
      value,
      { op: 'lit', type: boolT, value: true },
      ...(optionalAbsence(opt) === 3 ? [{ op: 'lit' as const, type: boolT, value: false }] : []),
    ],
  };
}

export function valueOf(v: Expr, inner: ShaderType): Expr {
  return { op: 'member', type: inner, base: v, field: 'value' };
}

export function presentFlagOf(v: Expr): Expr {
  return { op: 'member', type: boolT, base: v, field: 'present' };
}

export function notOf(b: Expr): Expr {
  return {
    op: 'compare',
    type: boolT,
    cop: '==',
    a: b,
    b: { op: 'lit', type: boolT, value: false },
  };
}
