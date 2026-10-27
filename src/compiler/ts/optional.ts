// ═══ Optional values: undefined, null and three states (Rule 7.10, changes 0088/0098) ═══
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
// other struct through {@link optionalInner}; private symbol metadata retains the logical
// absent states while names identify physical layouts. Every backend emits it
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

/** Logical absent values: undefined (1), null (2), or both (3). Kept private to the
 * front end; the two single-absence types deliberately share one physical struct. */
export type Absence = 1 | 2 | 3;
const LOGICAL_OPTIONAL = Symbol('logical optional');
type OptionalType = ShaderType & {
  readonly [LOGICAL_OPTIONAL]?: { readonly inner: ShaderType; readonly absence: Absence };
};

export function optionalAbsence(t: ShaderType | undefined): Absence | undefined {
  if (t === undefined) return undefined;
  return (
    (t as OptionalType)[LOGICAL_OPTIONAL]?.absence ??
    (t.kind === 'struct' && OPTIONALS.has(t.name)
      ? t.name.startsWith('__opt3_')
        ? 3
        : 1
      : undefined)
  );
}

/** Front-end identity, including optional elements in fixed arrays. Core typeKey remains
 * the physical identity used by the writers and layouts. Symbol metadata survives spreads. */
export function logicalTypeKey(t: ShaderType): string {
  const logical = (t as OptionalType)[LOGICAL_OPTIONAL];
  if (logical !== undefined) {
    const base = typeKey(t);
    return logical.absence === 1 && logicalTypeKey(logical.inner) === typeKey(logical.inner)
      ? base
      : `${base}:${logical.absence}:${logicalTypeKey(logical.inner)}`;
  }
  if (t.kind === 'array')
    return t.size === undefined
      ? `array<${logicalTypeKey(t.elem)}>`
      : `array<${logicalTypeKey(t.elem)},${t.sizeOverride ?? t.size}>`;
  return typeKey(t);
}

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

/** Optional declarations carry physical field types. Logical payload types stay on the
 * use-site descriptor, so the registry never depends on which absent spelling compiled first. */
function physicalPayload(type: ShaderType): ShaderType {
  if (type.kind === 'array') return { ...type, elem: physicalPayload(type.elem) };
  if (type.kind === 'struct' && isOptional(type)) return { kind: 'struct', name: type.name };
  return type;
}

/** The optional type over `inner`, registering its struct the first time it is asked for. */
export function optionalT(inner: ShaderType, absence: Absence = 1): ShaderType {
  const name = optionalStructName(inner).replace(PREFIX, absence === 3 ? '__opt3_' : PREFIX);
  if (!OPTIONALS.has(name)) {
    OPTIONALS.set(name, {
      inner: physicalPayload(inner),
      decl: {
        name,
        fields: [
          { name: 'value', type: physicalPayload(inner) },
          { name: 'present', type: boolT },
          ...(absence === 3 ? [{ name: 'isNull', type: boolT }] : []),
        ],
      },
    });
  }
  // Keep the original undefined-only IR descriptor unchanged when its payload has no
  // extra logical identity. The name registry already supplies that information.
  if (absence === 1 && logicalTypeKey(inner) === typeKey(inner)) return { kind: 'struct', name };
  return { kind: 'struct', name, [LOGICAL_OPTIONAL]: { inner, absence } } as OptionalType;
}

/** The `T` of an optional type `T | undefined`, or undefined for any other type. */
export function optionalInner(t: ShaderType | undefined): ShaderType | undefined {
  if (t === undefined || t.kind !== 'struct') return undefined;
  return (t as OptionalType)[LOGICAL_OPTIONAL]?.inner ?? OPTIONALS.get(t.name)?.inner;
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
      return inner.size !== undefined && (isOptional(inner.elem) || mayBeOptional(inner.elem));
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

/** The present value of the optional type `opt` holding `value`. */
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

/** The value compared with an absent literal by a supported presence test (Rule 7.10).
 *  Strict comparisons distinguish absent values; only loose comparisons may use `null`
 *  as the test for an existing `T | undefined` (change 0098, D4). Shared by lowering and
 *  control-flow analysis so they recognize exactly the same operand and operator forms. */
export function optionalTestOperand(node: ts.BinaryExpression): ts.Expression | undefined {
  const op = node.operatorToken.kind;
  const loose =
    op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  if (
    !loose &&
    op !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return undefined;
  }
  const literal = (e: ts.Expression): boolean => {
    let x = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    return isUndefinedLiteral(x) || x.kind === ts.SyntaxKind.NullKeyword;
  };
  return literal(node.right) ? node.left : literal(node.left) ? node.right : undefined;
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

/** An optional a type holds (Rule 7.10, change 0093): the type itself, an element of an array,
 *  a field of a struct, or one of those inside another, with the path to it as an author reads
 *  it: `` (the type itself), `w`, `u.w`, `xs[i]`, `[i].w`. */
export interface OptionalWithin {
  readonly opt: ShaderType;
  readonly inner: ShaderType;
  readonly path: string;
}

/** The first optional `t` holds, in field order and depth first, or undefined when it holds
 *  none. `structs` resolves the fields of a struct `t` names. */
export function optionalWithin(
  t: ShaderType | undefined,
  structs: StructLookup,
  seen: Set<string> = new Set(),
): OptionalWithin | undefined {
  if (t === undefined) return undefined;
  const inner = optionalInner(t);
  if (inner !== undefined) return { opt: t, inner, path: '' };
  if (t.kind === 'array') {
    const w = optionalWithin(t.elem, structs, seen);
    return w === undefined ? undefined : { ...w, path: `[i]${w.path}` };
  }
  if (t.kind === 'struct') {
    if (seen.has(t.name)) return undefined;
    seen.add(t.name);
    for (const f of structs(t.name)?.fields ?? []) {
      const w = optionalWithin(f.type, structs, seen);
      if (w !== undefined) return { ...w, path: `.${f.name}${w.path}` };
    }
  }
  return undefined;
}

/** The TS8002 sentence for an optional written where Rule 7.10 does not allow one (change
 *  0093): `position` names the place, "a binding". A `holder` is the struct or the array
 *  written there that holds the optional through `path`. The remedy names a `u32` flag, since
 *  WGSL forbids a `bool` in host-shareable memory. */
export function refusedOptionalPosition(
  written: string,
  position: string,
  inner: string,
  holder?: { readonly type: string; readonly path: string },
): string {
  const subject =
    holder === undefined
      ? `"${written}" holds`
      : `"${holder.type}" holds "${holder.path.replace(/^\./, '')}: ${written}",`;
  return (
    `${subject} a value and a flag saying whether it is there, which a local, a parameter, a ` +
    `function's result, a struct field or an array element may hold; ${position} may not. ` +
    `Carry a u32 flag beside the value, "${inner}".`
  );
}

/** Refuse `type` at `node` when it is an optional, or holds one through a field or an element
 *  when `structs` is given, and `position` may not hold one, with the sentence above; true
 *  when refused. */
export function refuseOptionalAt(
  type: ShaderType | undefined,
  node: ts.Node,
  position: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  spell: (t: ShaderType) => string,
  structs: StructLookup = () => undefined,
): boolean {
  const within = optionalWithin(type, structs);
  if (within === undefined) return false;
  const mask = optionalAbsence(within.opt)!;
  const written = `${spell(within.inner)}${mask & 2 ? ' | null' : ''}${mask & 1 ? ' | undefined' : ''}`;
  diagnostics?.push(
    makeDiagnostic(
      sourceFile,
      node,
      refusedOptionalPosition(
        written,
        position,
        spell(within.inner),
        within.path === '' ? undefined : { type: spell(type!), path: within.path },
      ),
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return true;
}

/** The type of a field or a parameter written with a `?`, `f?: T` or `x?: T` (Rule 7.10, change
 *  0093, decisions D3 and D5): `T | undefined`, which is `T` itself when `T` is already an
 *  optional. Undefined, having said why, when `T` is a type an optional may not hold.
 *  `subject` names the declaration in the sentence, `"f?" on "U"` or `parameter "x?"`. One with
 *  no `?` keeps `mapped`. */
export function optionalDeclaredType(
  mapped: ShaderType | undefined,
  questionToken: ts.QuestionToken | undefined,
  subject: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  spell: (t: ShaderType) => string,
): ShaderType | undefined {
  if (mapped === undefined || questionToken === undefined) return mapped;
  const inner = optionalInner(mapped);
  if (inner !== undefined) return optionalT(inner, (optionalAbsence(mapped)! | 1) as Absence);
  if (mayBeOptional(mapped)) return optionalT(mapped);
  const name = spell(mapped);
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      questionToken,
      `${subject} would hold ${/^[aeiofAEIOF]/.test(name) ? 'an' : 'a'} ${name} and a flag ` +
        `saying whether it is there, and an optional holds what a function-scope struct field ` +
        `may: a scalar, a vector, a matrix, an array with a size or a struct.`,
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return undefined;
}

/** The fields declared `f?: T` (change 0093, decision D3), by struct and field, per file: an
 *  object literal may omit one, and the omitted field is absent. */
const OMITTABLE = new WeakMap<ts.SourceFile, Set<string>>();

export function markOmittableField(sourceFile: ts.SourceFile, struct: string, field: string): void {
  let set = OMITTABLE.get(sourceFile);
  if (set === undefined) {
    set = new Set();
    OMITTABLE.set(sourceFile, set);
  }
  set.add(`${struct}.${field}`);
}

export function isOmittableField(
  sourceFile: ts.SourceFile,
  struct: string,
  field: string,
): boolean {
  return OMITTABLE.get(sourceFile)?.has(`${struct}.${field}`) ?? false;
}

/** The IR name a struct of the module carries that is an optional's: every one the functions
 *  name, in a type of a parameter, a result, a local or an expression, and every one a struct
 *  of the module holds in a field (change 0093), so the module declares exactly the optional
 *  structs it uses. {@link orderedStructDecls} places each one. */
export function usedOptionalDecls(types: Iterable<ShaderType>): StructDecl[] {
  const names = new Set<string>();
  for (const t of types) collectOptionalNames(t, names);
  return [...names].map((n) => optionalDeclOf(n)).filter((d): d is StructDecl => d !== undefined);
}

function collectOptionalNames(t: ShaderType, out: Set<string>): void {
  if (t.kind === 'struct' && OPTIONALS.has(t.name)) {
    collectOptionalNames(optionalInner(t)!, out);
    out.add(t.name);
  } else if (t.kind === 'array') collectOptionalNames(t.elem, out);
}

/** The structs a type names, through an array: what a declaration of it must follow. */
function structNamesOf(t: ShaderType, out: Set<string> = new Set()): Set<string> {
  if (t.kind === 'struct') out.add(t.name);
  else if (t.kind === 'array') structNamesOf(t.elem, out);
  return out;
}

/** The module's structs in declaration order (change 0093, decision D11): each optional struct
 *  before the first struct of `declared` that holds it, and after the struct its `T` names
 *  when that struct is one of `declared` (an optional of a struct follows that struct). An
 *  optional no declared struct holds comes after every declared struct, and an optional of a
 *  struct declared below its first holder comes right after that struct. `declared` keeps its
 *  own order. */
export function orderedStructDecls<S extends { readonly decl: StructDecl }>(
  declared: readonly S[],
  optionals: readonly StructDecl[],
  wrap: (decl: StructDecl) => S,
): S[] {
  const out: S[] = [];
  const placed = new Set<string>();
  const declaredNames = new Set(declared.map((s) => s.decl.name));
  const optional = new Map(optionals.map((d) => [d.name, d]));
  /** The optionals waiting for a declared struct their `T` names. */
  const waiting = new Map<string, StructDecl[]>();
  const place = (name: string): void => {
    const decl = optional.get(name);
    if (decl === undefined || placed.has(name)) return;
    const inner = optionalInner({ kind: 'struct', name })!;
    for (const dep of structNamesOf(inner)) {
      if (declaredNames.has(dep) && !placed.has(dep)) {
        const list = waiting.get(dep) ?? [];
        if (!list.includes(decl)) list.push(decl);
        waiting.set(dep, list);
        return;
      }
    }
    placed.add(name);
    out.push(wrap(decl));
  };
  for (const s of declared) {
    const held = new Set<string>();
    for (const f of s.decl.fields) collectOptionalNames(f.type, held);
    for (const name of held) place(name);
    placed.add(s.decl.name);
    out.push(s);
    for (const d of waiting.get(s.decl.name) ?? []) place(d.name);
    waiting.delete(s.decl.name);
  }
  for (const d of optionals) place(d.name);
  for (const list of waiting.values())
    for (const d of list)
      if (!placed.has(d.name)) {
        placed.add(d.name);
        out.push(wrap(d));
      }
  return out;
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

/** An absent literal, after parentheses: undefined (1), null (2), or neither. */
export function absentLiteral(node: ts.Expression): 1 | 2 | undefined {
  let x = node;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return isUndefinedLiteral(x) ? 1 : x.kind === ts.SyntaxKind.NullKeyword ? 2 : undefined;
}

/** A presence test that excludes every absent value of this logical type. */
export function presenceTest(name: string, type: ShaderType): string {
  const mask = optionalAbsence(type);
  return `${name} ${mask === 3 ? '!= null' : mask === 2 ? '!== null' : '!== undefined'}`;
}

/** Whether a value/result can widen into an optional without changing an absent identity. */
export function fitsOptional(from: ShaderType, to: ShaderType | undefined): boolean {
  const inner = optionalInner(to);
  if (inner === undefined) return false;
  return (
    logicalTypeKey(optionalInner(from) ?? from) === logicalTypeKey(inner) &&
    ((optionalAbsence(from) ?? 0) & optionalAbsence(to)!) === (optionalAbsence(from) ?? 0)
  );
}

// Pure representation helpers keep an effectful argument in its original expression position.
// Hoisting it before the enclosing statement would reorder earlier arguments or operands.
const OPTIONAL_HELPERS = new Map<string, FuncDecl>();
export function optionalHelper(
  operation: string,
  inputs: readonly Expr[],
  build: (params: Expr[]) => Expr,
): Expr {
  const name = `__opt_${operation}_${inputs.map((v) => logicalTypeKey(v.type)).join('_')}`.replace(
    /[^A-Za-z0-9_]/g,
    '_',
  );
  let decl = OPTIONAL_HELPERS.get(name);
  if (decl === undefined) {
    const params = inputs.map((v, i) => ({ name: `v${i}`, type: v.type }));
    const result = build(params.map((p) => ({ op: 'param', ...p })));
    decl = { name, params, ret: result.type, body: [{ s: 'return', expr: result }] };
    OPTIONAL_HELPERS.set(name, decl);
  }
  return { op: 'call', type: decl.ret, fn: name, args: [...inputs], declRef: decl };
}

/** Only helpers this module actually calls; emitted before their callers. */
export function optionalHelpersOf(funcs: readonly FuncDecl[]): FuncDecl[] {
  const used = new Map<string, FuncDecl>();
  for (const f of funcs)
    for (const stmt of f.body)
      eachStmtExpr(stmt, (expr) => {
        eachExpr(expr, (e) => {
          if (e.op !== 'call') return;
          const helper = OPTIONAL_HELPERS.get(e.fn);
          if (helper !== undefined) used.set(helper.name, helper);
        });
      });
  return [...used.values()];
}
