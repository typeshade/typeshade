// ═══ An optional value, `T | undefined` (Rule 7.10, change 0088) ═══
//
// An author writes "no value here" the way TypeScript writes it: a type `T | undefined`, a
// `return undefined;`, a test `v === undefined` and a fallback `v ?? d`. The compiler carries
// whether the value is there. Each `T | undefined` lowers to one internal struct of two fields,
// the value and a `bool` that says whether the value is there:
//
//   struct __opt_f32 { value: f32, present: bool }
//
// The name begins with `__`, which neither target spells as written: each writer gives it a
// fresh spelling under the reserved-name scheme (surface §62), and no author identifier reaches
// the IR under that prefix. The struct is not in `reflect()` output, since no binding may hold
// one, and it has no host value (Rule 8.21, decision D4). This file is the one place the
// representation is spelled: the name, the field order (`value` then `present`, decision D1),
// the absent value (the zero of `T` and `false`) and the present value (`T` and `true`).
//
// Nothing in the IR knows the struct is special. The front end tells an optional from any
// other struct by its name alone, through {@link optionalInner}, and every backend emits it
// as the ordinary struct it is.
//
// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr, FuncDecl, Stmt, StructDecl } from '../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import type { ShaderType } from '../../core/ir/types.js';
import { boolT, f32T, i32T, typeKey, u32T } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';

const PREFIX = '__opt_';

/** The internal struct of each optional type any compile has mapped, by its name. The map is
 *  never cleared: an entry is a pure function of the name, so a stale one is still right. */
const OPTIONALS = new Map<string, { readonly inner: ShaderType; readonly decl: StructDecl }>();

/** The emitted name of the optional struct over `inner`: the prefix and `inner`'s key with
 *  every character a name cannot hold replaced, `__opt_f32`, `__opt_vec2_f32`,
 *  `__opt_array_f32_4`, `__opt_Ray`. */
export function optionalStructName(inner: ShaderType): string {
  const key = inner.kind === 'struct' ? inner.name : typeKey(inner);
  return `${PREFIX}${key.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+$/, '')}`;
}

/** The optional type over `inner`, registering its struct the first time it is asked for. */
export function optionalT(inner: ShaderType): ShaderType {
  const name = optionalStructName(inner);
  if (!OPTIONALS.has(name)) {
    OPTIONALS.set(name, {
      inner,
      decl: {
        name,
        fields: [
          { name: 'value', type: inner },
          { name: 'present', type: boolT },
        ],
      },
    });
  }
  return { kind: 'struct', name };
}

/** The `T` of an optional type `T | undefined`, or undefined for any other type. */
export function optionalInner(t: ShaderType | undefined): ShaderType | undefined {
  if (t === undefined || t.kind !== 'struct' || !t.name.startsWith(PREFIX)) return undefined;
  return OPTIONALS.get(t.name)?.inner;
}

export const isOptional = (t: ShaderType | undefined): boolean => optionalInner(t) !== undefined;

/** The declaration of the optional struct `name`, or undefined for any other name. */
export function optionalDeclOf(name: string): StructDecl | undefined {
  return OPTIONALS.get(name)?.decl;
}

/** Whether `inner` is a type an optional may hold (Rule 7.10): what a function-scope struct
 *  field may hold. A texture, a sampler, an atomic, a runtime-sized array, a Map, a Set, `void`
 *  and another optional stay refused. */
export function mayBeOptional(inner: ShaderType): boolean {
  switch (inner.kind) {
    case 'scalar':
    case 'f64':
    case 'vec64':
    case 'vec':
    case 'mat':
      return true;
    case 'array':
      return inner.size !== undefined && mayBeOptional(inner.elem);
    case 'struct':
      return !isOptional(inner);
    default:
      return false;
  }
}

/** The structs a zero may need: the fields of a struct `inner` names. */
export type StructLookup = (name: string) => StructDecl | undefined;

/** The zero of `inner` as an expression, for the absent value's `value` field, spelled out so
 *  the CPU oracle and GLSL ES 3.00 start it where WGSL's zero constructor would. */
export function zeroOfInner(inner: ShaderType, structs: StructLookup): Expr {
  switch (inner.kind) {
    case 'scalar': {
      const k = typeKey(inner);
      if (k === 'bool') return { op: 'lit', type: boolT, value: false };
      if (k === 'i32') return { op: 'lit', type: i32T, value: 0 };
      if (k === 'u32') return { op: 'lit', type: u32T, value: 0 };
      // A key type is a u32 id (`keysOf`), so it took the integer arm above.
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

/** The absent value of the optional type `opt`: the zero of its `T` and `present: false`. */
export function absentOf(opt: ShaderType, inner: ShaderType, structs: StructLookup): Expr {
  return {
    op: 'construct',
    type: opt,
    args: [zeroOfInner(inner, structs), { op: 'lit', type: boolT, value: false }],
  };
}

/** The present value of the optional type `opt` holding `value`. */
export function presentOf(opt: ShaderType, value: Expr): Expr {
  return { op: 'construct', type: opt, args: [value, { op: 'lit', type: boolT, value: true }] };
}

/** `v.value`, the `T` a present optional holds. */
export function valueOf(v: Expr, inner: ShaderType): Expr {
  return { op: 'member', type: inner, base: v, field: 'value' };
}

/** `v.present`, whether the optional holds a value. */
export function presentFlagOf(v: Expr): Expr {
  return { op: 'member', type: boolT, base: v, field: 'present' };
}

/** `!b` as the IR spells a logical not: a comparison with `false`. */
export function notOf(b: Expr): Expr {
  return {
    op: 'compare',
    type: boolT,
    cop: '==',
    a: b,
    b: { op: 'lit', type: boolT, value: false },
  };
}

/** Whether `node`, without its parentheses, is the identifier `undefined`, which nothing in a
 *  `"use typeshade"` file may declare (`undefined` is a TypeScript value, not a name the file
 *  binds; `semantic.ts` lists it among the names a body does not read). */
export function isUndefinedLiteral(node: ts.Node): boolean {
  let x: ts.Node = node;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return ts.isIdentifier(x) && x.text === 'undefined';
}

/** Whether a written type contains `undefined` as a union member: `f32 | undefined`, through
 *  parentheses. Read off the syntax alone, for the walks that read no types (`definite.ts`,
 *  `narrowing.ts`). A type alias of such a union is not seen, and a local declared through one
 *  with no initializer is then held to Rule 7.6 as TypeScript holds it to TS2454. */
export function writesUndefinedUnion(type: ts.TypeNode | undefined): boolean {
  let t = type;
  while (t !== undefined && ts.isParenthesizedTypeNode(t)) t = t.type;
  return (
    t !== undefined &&
    ts.isUnionTypeNode(t) &&
    t.types.some((m) => m.kind === ts.SyntaxKind.UndefinedKeyword)
  );
}

/** The spelling of a value an author writes for the absent case in a remedy: `0.` for an
 *  `f32`, `0` for an integer, `false` for a bool, and the type's own zero constructor for a
 *  vector, a matrix, an array or a struct. */
export function absentRemedyValue(inner: ShaderType, spell: (t: ShaderType) => string): string {
  const k = typeKey(inner);
  if (k === 'f32') return '0.';
  if (k === 'i32' || k === 'u32') return '0';
  if (k === 'bool') return 'false';
  if (inner.kind === 'vec') return `${spell(inner).replace(/<.*$/, '')}()`;
  return `${spell(inner)}()`;
}

/** The TS8002 sentence for an optional written where this change does not allow one (Rule
 *  7.10): `position` names the place, "a struct field". The remedy is the one the old
 *  sentence gave, since a hand-carried flag is what the position can hold. */
export function refusedOptionalPosition(written: string, position: string, inner: string): string {
  return (
    `"${written}" holds a value and a flag saying whether it is there, which a local, a ` +
    `parameter or a function's result may hold; ${position} may not. Carry a bool ${
      position.includes('field') ? 'field' : 'value'
    } beside the value, "${inner}".`
  );
}

/** Refuse `type` at `node` when it is an optional and `position` may not hold one, with the
 *  sentence above; true when refused. */
export function refuseOptionalAt(
  type: ShaderType | undefined,
  node: ts.Node,
  position: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  spell: (t: ShaderType) => string,
): boolean {
  const inner = optionalInner(type);
  if (inner === undefined) return false;
  diagnostics?.push(
    makeDiagnostic(
      sourceFile,
      node,
      refusedOptionalPosition(`${spell(inner)} | undefined`, position, spell(inner)),
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return true;
}

/** The IR name a struct of the module carries that is an optional's: every one the functions
 *  name, in a type of a parameter, a result, a local or an expression, so the module declares
 *  exactly the optional structs it uses, after every struct an author declared (an optional of
 *  a struct comes after that struct, and no struct holds an optional). */
export function usedOptionalDecls(types: Iterable<ShaderType>): StructDecl[] {
  const names = new Set<string>();
  for (const t of types) collectOptionalNames(t, names);
  return [...names].map((n) => optionalDeclOf(n)).filter((d): d is StructDecl => d !== undefined);
}

function collectOptionalNames(t: ShaderType, out: Set<string>): void {
  if (t.kind === 'struct' && t.name.startsWith(PREFIX)) out.add(t.name);
  else if (t.kind === 'array') collectOptionalNames(t.elem, out);
}

/** Every type the functions name: a parameter's, a result's, a `var`'s and an expression's. */
export function typesOfFunctions(funcs: readonly FuncDecl[]): ShaderType[] {
  const out: ShaderType[] = [];
  const visitExpr = (e: Expr): void => eachExpr(e, (x) => out.push(x.type));
  const visitStmt = (s: Stmt): void => {
    if (s.s === 'var') out.push(s.type);
    eachStmtExpr(s, visitExpr, visitStmt);
  };
  for (const f of funcs) {
    for (const p of f.params) out.push(p.type);
    out.push(f.ret);
    for (const st of f.body) visitStmt(st);
  }
  return out;
}
