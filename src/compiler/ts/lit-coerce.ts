// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).

import { logicalTypeKey as typeKey } from './optional.js';
import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f64T, isF64 } from '../../core/ir/types.js';
import { BUILTIN_IDS } from '../../core/builtin-ids.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { noteDemand } from './use-inference.js';
import { TS_CODES } from './codes.js';
import {
  abstractLiteralOf,
  abstractTreeOf,
  isIntegerWrittenRead,
  noteF64Read,
  noteIntegerContext,
  noteIntegerRead,
  noteQuotientRead,
} from './abstract-const.js';
import { foldIntLit, intElemOf, wrapInt } from '../../core/passes/opt/expr-utils.js';

export function isIntegerLiteralNode(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isIntegerLiteralNode(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isIntegerLiteralNode(node.operand);
  }
  return (ts.isNumericLiteral(node) && isIntegerWritten(node)) || isIntegerWrittenRead(node);
}

export function isIntegerWritten(node: ts.NumericLiteral): boolean {
  const written = node.getText();
  return /^0[xXbBoO]/.test(written) || !/[.eE]/.test(written);
}

export function isIntScalar(t: ShaderType): boolean {
  const k = typeKey(t);
  return k === 'i32' || k === 'u32';
}

export function isIntegerLiteralTree(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isIntegerLiteralTree(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isIntegerLiteralTree(node.operand);
  }
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    const arith =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken ||
      k === ts.SyntaxKind.SlashToken;
    return arith && isIntegerLiteralTree(node.left) && isIntegerLiteralTree(node.right);
  }
  return isIntegerLiteralNode(node);
}

export function fitsTarget(v: number, target: ShaderType): boolean {
  if (!Number.isInteger(v)) return false;
  return typeKey(target) === 'u32'
    ? v >= 0 && v <= 4294967295
    : v >= -2147483648 && v <= 2147483647;
}

export function foldNumericLit(expr: Expr): Expr {
  const int = intElemOf(expr.type);
  if (expr.op === 'unop' && expr.a.op === 'lit' && typeof expr.a.value === 'number') {
    // Why: a negated u32 has no u32 value to fold to, and the lowering has already refused it.
    if (int === 'u32') return expr;
    return {
      op: 'lit',
      type: expr.type,
      value: int === 'i32' ? wrapInt(-expr.a.value, 'i32') : -expr.a.value,
    };
  }
  if (
    expr.op === 'binop' &&
    (expr.bop === '+' || expr.bop === '-' || expr.bop === '*' || expr.bop === '/')
  ) {
    const a = foldNumericLit(expr.a);
    const b = foldNumericLit(expr.b);
    if (
      a.op === 'lit' &&
      b.op === 'lit' &&
      typeof a.value === 'number' &&
      typeof b.value === 'number'
    ) {
      if (int !== undefined) {
        const v = foldIntLit(expr.bop, a.value, b.value, int);
        return v === undefined ? expr : { op: 'lit', type: expr.type, value: v };
      }
      const v =
        expr.bop === '+'
          ? a.value + b.value
          : expr.bop === '-'
            ? a.value - b.value
            : expr.bop === '*'
              ? a.value * b.value
              : b.value === 0
                ? undefined
                : a.value / b.value;
      if (v !== undefined) return { op: 'lit', type: expr.type, value: v };
    }
  }
  return expr;
}

const kindlessBitwise = new WeakMap<Expr, Expr>();

const kindlessDivisions = new WeakMap<Expr, object>();

export function noteKindlessDivision(tree: Expr, info: object): void {
  kindlessDivisions.set(tree, info);
}

export type KindlessVerdict =
  | { readonly kind: 'int'; readonly lit: Expr }
  | { readonly kind: 'outside'; readonly lit: Expr; readonly value: number }
  | {
      readonly kind: 'readings';
      readonly lit: Expr;
      readonly u32: number;
      readonly ts: number;
    }
  | {
      readonly kind: 'quotient';
      readonly lit: Expr;
      readonly value: number;
      readonly division: object;
    };

export function foldKindless(tree: Expr): KindlessVerdict | undefined {
  if (tree.op === 'binop' && tree.bop === '>>' && writtenU32(tree.a)) {
    const u = kindlessRoot(tree);
    const t = kindlessValue(tree);
    if (u !== undefined && t !== undefined && u >>> 0 !== t >>> 0) {
      return {
        kind: 'readings',
        lit: keep({ op: 'lit', type: u32Scalar, value: u }, tree),
        u32: u,
        ts: t,
      };
    }
  }
  const v = kindlessRoot(tree);
  if (v === undefined) return undefined;
  if (!Number.isFinite(v)) {
    return { kind: 'outside', lit: keep({ op: 'lit', type: i32Scalar, value: v }, tree), value: v };
  }
  if (!Number.isInteger(v)) {
    const division = outermostDivision(tree);
    if (division === undefined) return undefined;
    return {
      kind: 'quotient',
      lit: keep({ op: 'lit', type: f32Scalar, value: v }, tree),
      value: v,
      division,
    };
  }
  for (const type of [i32Scalar, u32Scalar]) {
    if (fitsTarget(v, type)) return { kind: 'int', lit: keep({ op: 'lit', type, value: v }, tree) };
  }
  return { kind: 'outside', lit: keep({ op: 'lit', type: i32Scalar, value: v }, tree), value: v };
}

function outermostDivision(tree: Expr): object | undefined {
  const queue: Expr[] = [tree];
  while (queue.length > 0) {
    const e = queue.shift()!;
    const inner = kindlessBitwise.get(e);
    if (inner !== undefined && inner !== e) {
      queue.push(inner);
      continue;
    }
    const info = kindlessDivisions.get(e);
    if (info !== undefined) {
      const q = kindlessValue(e);
      if (q !== undefined && !Number.isInteger(q)) return info;
    }
    if (e.op === 'binop') queue.push(e.a, e.b);
    else if (e.op === 'unop') queue.push(e.a);
    else if (e.op === 'call') queue.push(...e.args);
  }
  return undefined;
}

interface PendingRefusal {
  readonly diagnostic: TsCompilerDiagnostic;
  readonly into: TsCompilerDiagnostic[];
  readonly kind: KindlessVerdict['kind'];
  readonly value: number;
  readonly at?: (peer: ShaderType) => TsCompilerDiagnostic;
}

export interface RefusalCell {
  diagnostic: TsCompilerDiagnostic | undefined;
  readonly into: TsCompilerDiagnostic[];
  readonly kind: KindlessVerdict['kind'];
  readonly value: number;
  readonly at?: (peer: ShaderType) => TsCompilerDiagnostic;
}

const pendingRefusals = new WeakMap<Expr, RefusalCell>();

export function noteKindlessRefusal(lit: Expr, refusal: PendingRefusal): RefusalCell {
  refusal.into.push(refusal.diagnostic);
  const cell: RefusalCell = { ...refusal };
  pendingRefusals.set(lit, cell);
  return cell;
}

export function pendingKindlessRefusal(expr: Expr): KindlessVerdict['kind'] | undefined {
  return pendingRefusals.get(expr)?.kind;
}

export function replaceRefusal(cell: RefusalCell, diagnostic: TsCompilerDiagnostic): void {
  if (cell.diagnostic === undefined) return;
  const i = cell.into.indexOf(cell.diagnostic);
  if (i >= 0) cell.into[i] = diagnostic;
  cell.diagnostic = diagnostic;
}

export function retractKindlessRefusal(expr: Expr): boolean {
  const cell = pendingRefusals.get(expr);
  if (cell === undefined) return false;
  pendingRefusals.delete(expr);
  if (cell.diagnostic !== undefined) {
    const i = cell.into.indexOf(cell.diagnostic);
    if (i >= 0) cell.into.splice(i, 1);
    cell.diagnostic = undefined;
  }
  return true;
}

function restatePending(expr: Expr, peer: ShaderType): void {
  const cell = pendingRefusals.get(expr);
  if (cell?.at === undefined) return;
  replaceRefusal(cell, cell.at(peer));
}

export function retractOperandRefusals(tree: Expr): void {
  const parts: Expr[] =
    tree.op === 'binop'
      ? [tree.a, tree.b]
      : tree.op === 'unop'
        ? [tree.a]
        : tree.op === 'call'
          ? [...tree.args]
          : [];
  for (const part of parts) {
    retractKindlessRefusal(part);
    if (part.op === 'call' && part.fn === 'u32') retractKindlessRefusal(part.args[0]!);
  }
}

const i32Scalar: ShaderType = { kind: 'scalar', scalar: 'i32' };
const u32Scalar: ShaderType = { kind: 'scalar', scalar: 'u32' };
const f32Scalar: ShaderType = { kind: 'scalar', scalar: 'f32' };

function keep(lit: Expr, tree: Expr): Expr {
  kindlessBitwise.set(lit, kindlessBitwise.get(tree) ?? tree);
  return lit;
}

function carryPending(from: Expr, to: Expr): Expr {
  const pending = pendingRefusals.get(from);
  if (pending !== undefined) {
    pendingRefusals.set(to, pending);
    pendingRefusals.delete(from);
  }
  return to;
}

export function isKindlessBitwise(expr: Expr): boolean {
  return kindlessBitwise.has(expr);
}

function kindlessIn(expr: Expr, target: ShaderType): number | undefined {
  const tree = kindlessBitwise.get(expr);
  return tree === undefined || !isIntScalar(target) ? undefined : kindlessRoot(tree);
}

function retypeKindless(expr: Expr, target: ShaderType, declared: boolean): Expr | undefined {
  if (!isKindlessBitwise(expr) || !isIntScalar(target)) return undefined;
  let v = kindlessIn(expr, target);
  if (v === undefined) return undefined;
  const readings = kindlessReadings(expr);
  if (readings !== undefined && typeKey(target) === 'i32') v = readings.ts;
  const pending = pendingRefusals.get(expr);
  if (pending?.kind === 'readings') {
    return typeKey(expr.type) === typeKey(target)
      ? undefined
      : carryPending(expr, keep({ op: 'lit', type: target, value: v >>> 0 }, expr));
  }
  if (!Number.isInteger(v)) {
    const t = Math.trunc(v);
    if (declared) {
      retractKindlessRefusal(expr);
      return fitsTarget(t, target) ? keep({ op: 'lit', type: target, value: t }, expr) : undefined;
    }
    restatePending(expr, target);
    return carryPending(expr, keep({ op: 'lit', type: target, value: t }, expr));
  }
  if (typeKey(expr.type) === typeKey(target) && fitsTarget(v, target)) return undefined;
  if (fitsTarget(v, target)) return keep({ op: 'lit', type: target, value: v }, expr);
  if (pending?.kind === 'outside' && !declared) {
    restatePending(expr, target);
    return carryPending(expr, keep({ op: 'lit', type: target, value: v }, expr));
  }
  return undefined;
}

export function readKindlessExactly(expr: Expr): void {
  if (pendingRefusals.get(expr)?.kind === 'quotient') retractKindlessRefusal(expr);
}

export function retypeKindlessDeclared(expr: Expr, target: ShaderType): Expr | undefined {
  return retypeKindless(expr, target, true);
}

const BIT_OPS: ReadonlySet<string> = new Set(['&', '|', '^', '<<', '>>']);

function writtenU32(e: Expr): boolean {
  return (
    e.op === 'lit' && typeof e.value === 'number' && e.value > 2147483647 && !kindlessBitwise.has(e)
  );
}

function kindlessRoot(tree: Expr): number | undefined {
  if (
    tree.op === 'call' &&
    tree.fn === '~' &&
    tree.args.length === 1 &&
    writtenU32(tree.args[0]!)
  ) {
    return ~(tree.args[0] as { value: number }).value >>> 0;
  }
  if (tree.op === 'binop' && BIT_OPS.has(tree.bop) && (writtenU32(tree.a) || writtenU32(tree.b))) {
    const a = kindlessValue(tree.a);
    const b = kindlessValue(tree.b);
    if (a === undefined || b === undefined) return undefined;
    const [ua, ub] = [a >>> 0, b >>> 0];
    switch (tree.bop) {
      case '&':
        return (ua & ub) >>> 0;
      case '|':
        return (ua | ub) >>> 0;
      case '^':
        return (ua ^ ub) >>> 0;
      case '<<':
        return ub > 31 ? undefined : (ua << ub) >>> 0;
      default:
        return ub > 31 ? undefined : ua >>> ub;
    }
  }
  return kindlessValue(tree);
}

export function kindlessReadings(
  expr: Expr,
): { readonly u32: number; readonly ts: number } | undefined {
  if (!kindlessBitwise.has(expr)) return undefined;
  const tree = kindlessBitwise.get(expr)!;
  const u = kindlessRoot(tree);
  const t = kindlessValue(tree);
  if (u === undefined || t === undefined || u === t) return undefined;
  return { u32: u, ts: t };
}

function kindlessValue(expr: Expr): number | undefined {
  const inner = kindlessBitwise.get(expr);
  if (inner !== undefined && inner !== expr) return kindlessValue(inner);
  if (expr.op === 'lit') {
    return typeof expr.value === 'number' && Number.isFinite(expr.value) ? expr.value : undefined;
  }
  if (expr.op === 'call' && expr.fn === '~' && expr.args.length === 1) {
    const a = kindlessValue(expr.args[0]!);
    return a === undefined ? undefined : ~a;
  }
  if (expr.op === 'unop') {
    const a = kindlessValue(expr.a);
    return a === undefined ? undefined : -a;
  }
  if (expr.op === 'call' && expr.fn === 'u32' && expr.args.length === 1) {
    const a = kindlessValue(expr.args[0]!);
    return a === undefined ? undefined : a >>> 0;
  }
  if (expr.op !== 'binop') return undefined;
  const a = kindlessValue(expr.a);
  const b = kindlessValue(expr.b);
  if (a === undefined || b === undefined) return undefined;
  switch (expr.bop) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? undefined : a / b;
    case '%':
      return b === 0 ? undefined : a % b;
    case '&':
      return a & b;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '<<':
      return b >>> 0 > 31 ? undefined : a << b;
    case '>>':
      return b >>> 0 > 31 ? undefined : a >> b;
    default:
      return undefined;
  }
}

const kindlessModuleConsts = new WeakMap<ts.SourceFile, Set<string>>();

export function isKindlessModuleConst(sourceFile: ts.SourceFile, name: string): boolean {
  return kindlessModuleConsts.get(sourceFile)?.has(name) === true;
}

export function markKindlessLeaf(lit: Expr): Expr {
  kindlessBitwise.set(lit, lit);
  return lit;
}

export function markKindlessModuleConst(sourceFile: ts.SourceFile, name: string): void {
  let names = kindlessModuleConsts.get(sourceFile);
  if (names === undefined) kindlessModuleConsts.set(sourceFile, (names = new Set()));
  names.add(name);
}

const kindlessBindings = new WeakMap<object, string>();

export function markKindlessBinding(binding: object, declared: string): void {
  kindlessBindings.set(binding, declared);
}

const readingsBindings = new WeakMap<object, { readonly u32: number; readonly ts: number }>();

export function readingsOf(
  expr: Expr,
  resolve: (name: string) => object | undefined,
): { readonly u32: number; readonly ts: number } | undefined {
  const direct = kindlessReadings(expr);
  if (direct !== undefined) return direct;
  if (expr.op !== 'varref') return undefined;
  const b = resolve(expr.name);
  return b === undefined ? undefined : readingsBindings.get(b);
}

export function markReadingsWith(
  binding: object | undefined,
  readings: { readonly u32: number; readonly ts: number } | undefined,
): void {
  if (binding !== undefined && readings !== undefined) readingsBindings.set(binding, readings);
}

export function markReadingsBinding(
  binding: object,
  init: Expr,
  resolve: (name: string) => object | undefined,
): void {
  const readings = readingsOf(init, resolve);
  if (readings !== undefined) readingsBindings.set(binding, readings);
}

export function kindlessDeclaration(binding: object | undefined): string | undefined {
  return binding === undefined ? undefined : kindlessBindings.get(binding);
}

export function statesType(n: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(n)) return statesType(n.expression);
  if (ts.isCallExpression(n)) {
    return ts.isIdentifier(n.expression) && ['i32', 'u32', 'f32'].includes(n.expression.text);
  }
  if (ts.isPrefixUnaryExpression(n)) return statesType(n.operand);
  if (ts.isBinaryExpression(n)) return statesType(n.left) || statesType(n.right);
  return false;
}

const STATED_TYPE = /^(f32|f16|f64|i32|u32|bool|vec[234][fiuh]?|mat[234](x[234])?[fh]?|array)$/;

export function kindlessOrigin(
  expr: Expr,
  resolve: (name: string) => object | undefined,
  sourceFile?: ts.SourceFile,
): 'kindless' | 'written' | 'typed' {
  if (kindlessBitwise.has(expr)) return 'kindless';
  if (expr.op === 'lit') return typeof expr.value === 'number' ? 'written' : 'typed';
  const abstract = abstractLiteralOf(expr);
  if (
    abstract !== undefined &&
    kindlessModuleConsts.get(sourceFile!)?.has((expr as { name?: string }).name ?? '') !== true
  ) {
    return abstract.op === 'lit' && typeof abstract.value === 'number' ? 'written' : 'typed';
  }
  if (expr.op === 'constref') {
    return sourceFile !== undefined && kindlessModuleConsts.get(sourceFile)?.has(expr.name) === true
      ? 'kindless'
      : 'typed';
  }
  if (expr.op === 'varref' || expr.op === 'param') {
    const b = resolve(expr.name);
    return b !== undefined && kindlessBindings.has(b) ? 'kindless' : 'typed';
  }
  const parts: Expr[] =
    expr.op === 'unop'
      ? [expr.a]
      : expr.op === 'call' && expr.fn === '~' && expr.declRef === undefined
        ? [...expr.args]
        : expr.op === 'call' &&
            expr.declRef === undefined &&
            BUILTIN_IDS.has(expr.fn) &&
            !STATED_TYPE.test(expr.fn)
          ? expr.fn === 'select'
            ? expr.args.slice(0, -1)
            : [...expr.args]
          : expr.op === 'select'
            ? [expr.ifTrue, expr.ifFalse]
            : expr.op === 'binop' && (expr.bop === '<<' || expr.bop === '>>')
              ? [expr.a]
              : expr.op === 'binop' && ['+', '-', '*', '%', '&', '|', '^'].includes(expr.bop)
                ? [expr.a, expr.b]
                : [];
  if (parts.length === 0) return 'typed';
  const each = parts.map((e) => kindlessOrigin(e, resolve, sourceFile));
  if (each.includes('typed')) return 'typed';
  const bits =
    (expr.op === 'binop' && ['&', '|', '^', '<<', '>>'].includes(expr.bop)) ||
    (expr.op === 'call' && expr.fn === '~');
  return bits || each.includes('kindless') ? 'kindless' : 'written';
}

const integerQuotients = new WeakMap<
  Expr,
  (target: ShaderType, declared: boolean) => Expr | undefined
>();

export function markIntegerQuotient(
  float: Expr,
  at: (target: ShaderType, declared: boolean) => Expr | undefined,
): Expr {
  integerQuotients.set(float, at);
  return float;
}

export function isIntegerQuotient(expr: Expr): boolean {
  return integerQuotients.has(expr);
}

const quotientBindings = new WeakSet<object>();

export function markQuotientBinding(binding: object): void {
  quotientBindings.add(binding);
}

export function markQuotientRead(read: Expr, binding: object, node?: ts.Node): Expr {
  if (quotientBindings.has(binding)) {
    if (node !== undefined) noteQuotientRead(node);
    integerQuotients.set(read, (target) => ({
      op: 'call',
      type: target,
      fn: typeKey(target) === 'u32' ? 'u32' : 'i32',
      args: [read],
    }));
  }
  return read;
}

export function integerQuotientAt(
  expr: Expr,
  target: ShaderType,
  declared: boolean,
): Expr | undefined {
  const at = integerQuotients.get(expr);
  return at === undefined || !isIntScalar(target) ? undefined : at(target, declared);
}

export function retargetIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  noteDemand(expr, peer);
  const kindless = retypeKindless(expr, peer, false);
  if (kindless !== undefined) return kindless;
  if (isIntScalar(peer) && integerQuotients.has(expr)) {
    const q = integerQuotientAt(expr, peer, false);
    if (q !== undefined) return q;
  }
  if (isIntScalar(peer)) noteIntegerContext(node, typeKey(peer) === 'u32' ? 'u32' : 'i32');
  const abstract = abstractLiteralOf(expr);
  if (abstract !== undefined && abstract.op === 'lit' && typeof abstract.value === 'number') {
    if (!isIntScalar(peer)) return expr;
    const kind = typeKey(peer) === 'u32' ? 'u32' : 'i32';
    const tree = abstractTreeOf(node);
    if (
      tree === undefined ||
      !tree.integerWritten ||
      !Number.isInteger(abstract.value) ||
      !fitsTarget(abstract.value, peer)
    )
      return expr;
    noteIntegerRead(node, kind);
    return { op: 'lit', type: peer, value: abstract.value };
  }
  return retargetWrittenIntLit(expr, node, peer);
}

function retargetWrittenIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  const folded = foldNumericLit(expr);
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return folded;
  if (!isIntScalar(peer)) return folded;
  if (statesType(node)) return folded;
  if (!isIntegerLiteralNode(node) && folded === expr) return folded;
  if (!isIntegerLiteralNode(node) && !Number.isInteger(folded.value)) return folded;
  if (!isIntegerLiteralNode(node) && expr.op !== 'unop' && expr.op !== 'binop') return folded;
  if (!isIntegerLiteralNode(node) && expr.op === 'lit') return folded;
  if (!fitsTarget(folded.value, peer)) return expr;
  return { op: 'lit', type: peer, value: folded.value };
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

function retargetF64DeclaredLit(expr: Expr, node: ts.Expression): Expr {
  if (ts.isCallExpression(stripParens(node))) return expr;
  const folded = foldNumericLit(abstractLiteralOf(expr) ?? expr);
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return expr;
  if (typeKey(folded.type) !== 'f32') return expr;
  noteF64Read(node, f64T);
  return { op: 'lit', type: f64T, value: folded.value };
}

export function retargetIntLitCtx(
  expr: Expr,
  node: ts.Expression,
  target: ShaderType,
  declared = true,
): Expr {
  noteDemand(expr, target);
  if (isIntScalar(target)) noteIntegerContext(node, typeKey(target) === 'u32' ? 'u32' : 'i32');
  if (isF64(target)) return retargetF64DeclaredLit(expr, node);
  if (!isIntScalar(target)) return expr;
  const kindless = retypeKindless(expr, target, declared);
  if (kindless !== undefined) return kindless;
  const quotient = integerQuotientAt(expr, target, declared);
  if (quotient !== undefined) return quotient;
  const inner = stripParens(node);
  if (!ts.isConditionalExpression(inner) && !isIntegerLiteralTree(inner)) return expr;
  if (expr.op === 'select' && ts.isConditionalExpression(inner)) {
    const ifTrue = retargetIntLitCtx(expr.ifTrue, inner.whenTrue, target);
    const ifFalse = retargetIntLitCtx(expr.ifFalse, inner.whenFalse, target);
    if (ifTrue === expr.ifTrue && ifFalse === expr.ifFalse) return expr;
    if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) return expr;
    return { ...expr, type: ifTrue.type, ifTrue, ifFalse };
  }
  return retargetIntLit(expr, node, target);
}

export function retargetDeclaredIntLit(expr: Expr, node: ts.Expression, target: ShaderType): Expr {
  const byContext = retargetIntLitCtx(expr, node, target);
  if (byContext !== expr || !isIntScalar(target) || isKindlessBitwise(expr)) return byContext;
  if (expr.op !== 'lit' || typeof expr.value !== 'number') return expr;
  if (!fitsTarget(expr.value, target)) return expr;
  return { op: 'lit', type: target, value: expr.value };
}

export function intLiteralRangeMessage(value: number, target: ShaderType): string {
  const k = typeKey(target);
  const range = k === 'u32' ? '0 to 4294967295' : '-2147483648 to 2147483647';
  return `The value has to fit: ${String(value)} is outside ${k}, which holds ${range} (§13).`;
}

export function outOfRangeIntLit(
  expr: Expr,
  node: ts.Expression,
  target: ShaderType,
): { readonly value: number; readonly node: ts.Expression } | undefined {
  if (!isIntScalar(target)) return undefined;
  const inner = stripParens(node);
  if (expr.op === 'select' && ts.isConditionalExpression(inner)) {
    return (
      outOfRangeIntLit(expr.ifTrue, inner.whenTrue, target) ??
      outOfRangeIntLit(expr.ifFalse, inner.whenFalse, target)
    );
  }
  if (isKindlessBitwise(expr)) {
    const exact = kindlessIn(expr, target);
    const v = exact === undefined ? undefined : Math.trunc(exact);
    if (v === undefined || fitsTarget(v, target)) return undefined;
    retractKindlessRefusal(expr);
    return { value: v, node: inner };
  }
  if (!isIntegerLiteralTree(inner)) return undefined;
  const folded = foldNumericLit(abstractLiteralOf(expr) ?? expr);
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return undefined;
  if (!Number.isInteger(folded.value) || fitsTarget(folded.value, target)) return undefined;
  return { value: folded.value, node: inner };
}

export function reportIntLitRange(
  expr: Expr,
  node: ts.Expression,
  target: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const bad = outOfRangeIntLit(expr, node, target);
  if (!bad) return undefined;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      bad.node,
      intLiteralRangeMessage(bad.value, target) + bitsEdit(expr, bad.value, target),
      TS_CODES.TYPE_MISMATCH,
    ),
  );
  return expr.op === 'select'
    ? { ...expr, type: target }
    : { op: 'lit', type: target, value: bad.value };
}

function bitsEdit(expr: Expr, value: number, target: ShaderType): string {
  const tree = kindlessBitwise.get(expr);
  if (tree === undefined) return '';
  if (typeKey(target) === 'i32' && value > 2147483647 && value <= 4294967295) {
    return ` Write the i32 with the same bits, ${String(value | 0)}, or declare a u32.`;
  }
  if (typeKey(target) !== 'u32' || value >= 0 || value < -2147483648) return '';
  const bitwise =
    (tree.op === 'call' && tree.fn === '~') ||
    (tree.op === 'binop' && ['&', '|', '^', '<<', '>>'].includes(tree.bop));
  return bitwise ? ` Write the u32 with the same bits, 0x${(value >>> 0).toString(16)}.` : '';
}

// Why: WGSL's i32 and u32 and GLSL ES 3.00's int and uint are all 32 bits wide.
const SHIFT_BITS = 32;

// Why: WGSL refuses a constant shift amount of 32 or more at shader creation, and GLSL ES 3.00 leaves the result undefined.
export function shiftAmountMessage(amount: number): string {
  return (
    `A shift amount must be between 0 and ${String(SHIFT_BITS - 1)}, got ${String(amount)}: ` +
    `a ${String(SHIFT_BITS)}-bit integer has no bit to shift into.`
  );
}

export function shiftAmountOutOfRange(amount: number): boolean {
  return amount < 0 || amount >= SHIFT_BITS;
}
