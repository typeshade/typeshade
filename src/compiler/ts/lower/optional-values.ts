// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import { peekingReads } from '../abstract-const.js';
import { logicalTypeKey as typeKey } from '../optional.js';
import ts from 'typescript';
import type { Expr, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, irNameOf, type Binding, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import {
  absentOf,
  absentLiteral,
  presentOf,
  absentRemedyValue,
  isOptional,
  isUndefinedLiteral,
  notOf,
  optionalInner,
  optionalAbsence,
  type Absence,
  optionalTestOperand,
  optionalT,
  presentFlagOf,
  presenceTest,
  valueOf,
} from '../optional.js';
import { optionalHelper } from '../optional/helpers.js';
import { narrowingAt } from '../narrowing.js';
import { retargetIntLitCtx } from '../lit-coerce.js';
import { lowerExpression, placeOf } from './expression.js';
import { lowerLValue } from './statement.js';

const pushDiag = (
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: (typeof TS_CODES)[keyof typeof TS_CODES] = TS_CODES.TYPE_MISMATCH,
): void => {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
};

const skipParens = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
};

const valueTypes = new WeakMap<ts.Node, ShaderType>();
const valueTypeTrials: Map<ts.Node, ShaderType>[] = [];

export function captureValueTypes<T>(lower: () => T): { value: T; commit: () => void } {
  const trial = new Map<ts.Node, ShaderType>();
  valueTypeTrials.push(trial);
  let value: T;
  try {
    value = lower();
  } finally {
    valueTypeTrials.pop();
  }
  return {
    value,
    commit: () => {
      for (const [node, type] of trial) noteValueType(node, type);
    },
  };
}

export function noteValueType(node: ts.Node, type: ShaderType): void {
  const trial = valueTypeTrials.at(-1);
  if (trial === undefined) valueTypes.set(node, type);
  else trial.set(node, type);
}

export function recordedValueType(node: ts.Node): ShaderType | undefined {
  for (let i = valueTypeTrials.length - 1; i >= 0; i--) {
    const type = valueTypeTrials[i]!.get(node);
    if (type !== undefined) return type;
  }
  return valueTypes.get(node);
}

export function optionalBindingOf(node: ts.Expression, scope: LoweringScope): Binding | undefined {
  const x = skipParens(node);
  if (!ts.isIdentifier(x)) return undefined;
  const b = scope.resolve(x.text);
  if (b === undefined || (b.kind !== 'local' && b.kind !== 'param')) return undefined;
  return isOptional(b.type) ? b : undefined;
}

export function isMemberPath(e: ts.Expression): e is ts.PropertyAccessExpression {
  const x = skipParens(e);
  if (!ts.isPropertyAccessExpression(x) || x.questionDotToken !== undefined) return false;
  let base = skipParens(x.expression);
  while (ts.isPropertyAccessExpression(base) && base.questionDotToken === undefined) {
    base = skipParens(base.expression);
  }
  return ts.isIdentifier(base);
}

export function optionalPathOf(
  node: ts.Expression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): { readonly type: ShaderType; readonly text: string } | undefined {
  const b = optionalBindingOf(node, scope);
  if (b !== undefined) return { type: b.type, text: node.getText(sourceFile) };
  if (!isMemberPath(node)) return undefined;
  const value = peekingReads(() => lowerExpression(node, sourceFile, scope, []));
  if (value === undefined || !isOptional(value.type)) return undefined;
  return { type: value.type, text: node.getText(sourceFile) };
}

export function narrowedStateOf(
  sourceFile: ts.SourceFile,
  id: ts.Identifier | ts.PropertyAccessExpression,
  type?: ShaderType,
): 'present' | 'absent' | undefined {
  const n = narrowingAt(sourceFile, id);
  if (n === undefined) return undefined;
  if (n === 'absent') return n;
  if (typeof n === 'number') {
    const states = n & ((optionalAbsence(type) ?? 1) | 4);
    return states === 4 ? 'present' : (states & 4) === 0 ? 'absent' : undefined;
  }
  for (const source of n.sources) {
    if (source === null) continue;
    const from = recordedValueType(source);
    if (from === undefined || isOptional(from)) return undefined;
  }
  return 'present';
}

export const rawRead = (b: Binding): Expr =>
  b.kind === 'param'
    ? { op: 'param', type: b.type, name: irNameOf(b) }
    : { op: 'varref', type: b.type, name: irNameOf(b) };

function positionPhrase(node: ts.Node, sourceFile: ts.SourceFile): string {
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const p = at.parent;
  if (ts.isBinaryExpression(p)) return `"${p.operatorToken.getText(sourceFile)}" takes`;
  if (ts.isPrefixUnaryExpression(p)) return `"${ts.tokenToString(p.operator) ?? ''}" takes`;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const i = [...(p.arguments ?? [])].indexOf(at as ts.Expression);
    const callee = ts.isCallExpression(p)
      ? p.expression.getText(sourceFile)
      : p.expression.getText(sourceFile);
    return i >= 0 ? `argument ${String(i + 1)} of "${callee}" takes` : `"${callee}" takes`;
  }
  if (ts.isReturnStatement(p)) return 'the result here is';
  if (ts.isVariableDeclaration(p)) return `"${p.name.getText(sourceFile)}" is declared`;
  if (ts.isPropertyAccessExpression(p) && p.expression === at) return `".${p.name.text}" needs`;
  if (ts.isElementAccessExpression(p) && p.expression === at) return 'an index needs';
  if (ts.isElementAccessExpression(p)) return 'an index is';
  if (ts.isPropertyAssignment(p)) return `the field "${p.name.getText(sourceFile)}" is`;
  if (
    ts.isConditionalExpression(p) ||
    ts.isIfStatement(p) ||
    ts.isWhileStatement(p) ||
    ts.isForStatement(p)
  )
    return 'a condition is';
  return 'this position takes';
}

export function unnarrowedReadSentence(
  node: ts.Node,
  type: ShaderType,
  sourceFile: ts.SourceFile,
): string {
  const inner = optionalInner(type)!;
  const written = node.getText(sourceFile);
  const x = skipParens(node as ts.Expression);
  const zero = absentRemedyValue(inner, authorTypeText);
  const head = `"${written}" is "${authorTypeText(type)}" here, and ${positionPhrase(node, sourceFile)} ${anOf(authorTypeText(inner))}.`;
  if (ts.isElementAccessExpression(x)) {
    return (
      `${head} Take it in a const first, "const x = ${written}; if (${presenceTest('x', type)})", or give ` +
      `the absent case a value, "${written} ?? ${zero}".`
    );
  }
  const name = ts.isIdentifier(x) || isMemberPath(x) ? written : 'it';
  return (
    `${head} Test it first, "if (${presenceTest(name, type)})", or give the absent case a value, ` +
    `"${name} ?? ${zero}".`
  );
}

export function refuseOptionalWhereInnerWanted(
  value: Expr | undefined,
  node: ts.Expression,
  contextual: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (value === undefined || contextual === undefined) return false;
  const inner = optionalInner(value.type);
  if (inner === undefined || isOptional(contextual) || typeKey(inner) !== typeKey(contextual))
    return false;
  pushDiag(
    diagnostics,
    sourceFile,
    placeOf(node),
    unnarrowedReadSentence(node, value.type, sourceFile),
  );
  return true;
}

export function lowerOptionalMember(
  node: ts.PropertyAccessExpression,
  member: Expr,
  sourceFile: ts.SourceFile,
): Expr {
  const inner = optionalInner(member.type);
  if (inner === undefined || !isMemberPath(node)) return member;
  return narrowedStateOf(sourceFile, node, member.type) === 'present'
    ? valueOf(member, inner)
    : narrowOptional(member, narrowingAt(sourceFile, node));
}

const anOf = (t: string): string => (/^[aeiofAEIOF]/.test(t) ? `an ${t}` : `a ${t}`);

export function refuseOptionalUse(
  value: Expr | undefined,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (value === undefined || !isOptional(value.type)) return false;
  pushDiag(diagnostics, sourceFile, node, unnarrowedReadSentence(node, value.type, sourceFile));
  return true;
}

export function lowerOptionalRead(
  id: ts.Identifier,
  b: Binding,
  contextual: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const inner = optionalInner(b.type)!;
  const state = narrowedStateOf(sourceFile, id, b.type);
  if (state === 'present') return valueOf(rawRead(b), inner);
  const narrowed = narrowOptional(rawRead(b), narrowingAt(sourceFile, id));
  if (isOptional(contextual) && typeKey(optionalInner(contextual)!) === typeKey(inner))
    return narrowed;
  pushDiag(diagnostics, sourceFile, placeOf(id), unnarrowedReadSentence(id, b.type, sourceFile));
  return undefined;
}

export function lowerUndefinedValue(
  node: ts.Expression,
  contextual: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const inner = optionalInner(contextual);
  const absence = skipParens(node).kind === ts.SyntaxKind.NullKeyword ? 2 : 1;
  if (inner !== undefined && (optionalAbsence(contextual)! & absence) !== 0)
    return absentOf(contextual!, inner, (n) => scope.structByName(n), absence);
  if (absence === 2) {
    pushDiag(
      diagnostics,
      sourceFile,
      placeOf(node),
      '"null" needs a context whose type includes null (Rule 7.10).',
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    placeOf(node),
    `"undefined" is the absent value of an optional type, "T | undefined", and nothing here ` +
      `declares one (Rule 7.10). Write it where a "T | undefined" is expected: a result, a ` +
      `local or a parameter declared so.`,
  );
  return undefined;
}

export function lowerOptionalOperand(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const b = optionalBindingOf(node, scope);
  if (b !== undefined) return rawRead(b);
  return lowerExpression(node, sourceFile, scope, diagnostics);
}

function once(
  value: Expr,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (readsOnce(value)) return value;
  if (scope.canHoist()) return scope.hoistTemp('_opt', value);
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${node.getText(sourceFile)}" is read twice here, for its flag and its value, and runs ` +
      `once: take it in a const on a line of its own first, or, in a loop's condition, in a ` +
      `local the body assigns.`,
    TS_CODES.UNSUPPORTED,
  );
  return undefined;
}

const readsOnce = (e: Expr): boolean =>
  e.op === 'varref' ||
  e.op === 'param' ||
  e.op === 'constref' ||
  e.op === 'lit' ||
  (e.op === 'member' && readsOnce(e.base)) ||
  (e.op === 'index' && readsOnce(e.base) && readsOnce(e.idx));

const EQUALITY: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

const isEqualsOp = (k: ts.SyntaxKind): boolean =>
  k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken;

export function lowerUndefinedTest(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-test' {
  if (!EQUALITY.has(node.operatorToken.kind)) return 'not-a-test';
  const tested = optionalTestOperand(node);
  if (tested === undefined) return 'not-a-test';
  const value = lowerOptionalOperand(tested, sourceFile, scope, diagnostics);
  if (value === undefined) return undefined;
  if (!isOptional(value.type)) {
    const literal =
      isUndefinedLiteral(node.left) || isUndefinedLiteral(node.right) ? 'undefined' : 'null';
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${tested.getText(sourceFile)}" is ${anOf(authorTypeText(value.type))}, which is always ` +
        `there, so comparing it with ${literal} is never true. Declare it ` +
        `"${authorTypeText(value.type)} | undefined" if it may be absent, or drop the test.`,
    );
    return undefined;
  }
  const k = node.operatorToken.kind;
  const loose = k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
  const absent = isUndefinedLiteral(node.left) || isUndefinedLiteral(node.right) ? 1 : 2;
  const mask = optionalAbsence(value.type)!;
  if (loose || mask === absent) {
    const flag = presentFlagOf(value);
    return isEqualsOp(k) ? notOf(flag) : flag;
  }
  const predicate = (v: Expr): Expr => {
    if ((mask & absent) === 0) return { op: 'lit', type: boolT, value: !isEqualsOp(k) };
    const tag: Expr = { op: 'member', type: boolT, base: v, field: 'isNull' };
    const equal: Expr = {
      op: 'logical',
      type: boolT,
      lop: '&&',
      a: notOf(presentFlagOf(v)),
      b: absent === 2 ? tag : notOf(tag),
    };
    return isEqualsOp(k) ? equal : notOf(equal);
  };
  return readsOnce(value)
    ? predicate(value)
    : optionalHelper(`test_${absent}_${isEqualsOp(k) ? 'eq' : 'ne'}`, [value], ([v]) =>
        predicate(v!),
      );
}

export function lowerOptionalEquality(
  node: ts.BinaryExpression,
  left: Expr,
  right: Expr,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-optional' {
  const lo = optionalInner(left.type);
  const ro = optionalInner(right.type);
  if (lo === undefined && ro === undefined) return 'not-optional';
  if (!EQUALITY.has(node.operatorToken.kind)) {
    const bad = lo !== undefined ? node.left : node.right;
    pushDiag(
      diagnostics,
      sourceFile,
      bad,
      unnarrowedReadSentence(bad, lo !== undefined ? left.type : right.type, sourceFile),
    );
    return undefined;
  }
  const inner = lo ?? ro!;
  if (
    typeKey(inner) !== typeKey(lo === undefined ? left.type : ro === undefined ? right.type : ro!)
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Type mismatch in compare: ${authorTypeText(left.type)} and ${authorTypeText(right.type)}.`,
    );
    return undefined;
  }
  if (inner.kind !== 'scalar' && inner.kind !== 'vec' && inner.kind !== 'f64') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot ${node.operatorToken.getText(sourceFile)} ${authorTypeText(inner)}: WGSL has no ` +
        `equality on ${anOf(inner.kind === 'struct' ? 'struct' : inner.kind === 'array' ? 'array' : 'matrix')}. Compare the fields, or test the flag alone, "v !== undefined".`,
    );
    return undefined;
  }
  const l = lo !== undefined ? once(left, node.left, sourceFile, scope, diagnostics) : left;
  const r = ro !== undefined ? once(right, node.right, sourceFile, scope, diagnostics) : right;
  if (l === undefined || r === undefined) return undefined;
  const negated = !isEqualsOp(node.operatorToken.kind);
  const lv = lo !== undefined ? valueOf(l, inner) : l;
  const rv = ro !== undefined ? valueOf(r, inner) : r;
  const sameValue: Expr =
    inner.kind === 'vec'
      ? { op: 'compare', type: { kind: 'vec', n: inner.n, elem: 'bool' }, cop: '==', a: lv, b: rv }
      : { op: 'compare', type: boolT, cop: '==', a: lv, b: rv };
  let both: Expr;
  if (lo !== undefined && ro !== undefined) {
    const flags: Expr = {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: presentFlagOf(l),
      b: presentFlagOf(r),
    };
    let absentEqual: Expr = notOf(presentFlagOf(l));
    const strict =
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    if (strict && (optionalAbsence(l.type) !== 1 || optionalAbsence(r.type) !== 1)) {
      const tag = (v: Expr): Expr =>
        optionalAbsence(v.type) === 3
          ? { op: 'member', type: boolT, base: v, field: 'isNull' }
          : { op: 'lit', type: boolT, value: optionalAbsence(v.type) === 2 };
      absentEqual = {
        op: 'logical',
        type: boolT,
        lop: '&&',
        a: absentEqual,
        b: { op: 'compare', type: boolT, cop: '==', a: tag(l), b: tag(r) },
      };
    }
    if (inner.kind === 'vec') {
      const all: Expr = { op: 'call', type: boolT, fn: 'all', args: [sameValue] };
      both = {
        op: 'logical',
        type: boolT,
        lop: '&&',
        a: flags,
        b:
          strict && (optionalAbsence(l.type) !== 1 || optionalAbsence(r.type) !== 1)
            ? {
                op: 'select',
                type: boolT,
                cond: presentFlagOf(l),
                ifTrue: all,
                ifFalse: absentEqual,
              }
            : { op: 'logical', type: boolT, lop: '||', a: absentEqual, b: all },
      };
    } else {
      both = {
        op: 'logical',
        type: boolT,
        lop: '&&',
        a: flags,
        b:
          strict && (optionalAbsence(l.type) !== 1 || optionalAbsence(r.type) !== 1)
            ? {
                op: 'select',
                type: boolT,
                cond: presentFlagOf(l),
                ifTrue: sameValue,
                ifFalse: absentEqual,
              }
            : { op: 'logical', type: boolT, lop: '||', a: absentEqual, b: sameValue },
      };
    }
  } else {
    const flag = presentFlagOf(lo !== undefined ? l : r);
    if (inner.kind === 'vec') {
      const no: Expr = { op: 'lit', type: boolT, value: false };
      const falses: Expr = {
        op: 'construct',
        type: { kind: 'vec', n: inner.n, elem: 'bool' },
        args: Array.from({ length: inner.n }, () => no),
      };
      const picked: Expr = {
        op: 'select',
        type: falses.type,
        cond: flag,
        ifTrue: sameValue,
        ifFalse: falses,
      };
      return negated ? notVec(picked) : picked;
    }
    both = { op: 'logical', type: boolT, lop: '&&', a: flag, b: sameValue };
  }
  return negated ? notOf(both) : both;
}

const notVec = (m: Expr): Expr => {
  const t = m.type as { kind: 'vec'; n: 2 | 3 | 4 };
  const no: Expr = { op: 'lit', type: boolT, value: false };
  return {
    op: 'compare',
    type: m.type,
    cop: '==',
    a: m,
    b: { op: 'construct', type: m.type, args: Array.from({ length: t.n }, () => no) },
  };
};

export function lowerNullish(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual: ShaderType | undefined,
): Expr | undefined {
  const left = lowerOptionalOperand(node.left, sourceFile, scope, diagnostics);
  if (left === undefined) return undefined;
  const inner = optionalInner(left.type);
  if (inner === undefined) {
    lowerExpression(node.right, sourceFile, scope, [], left.type);
    return left;
  }
  const v = once(left, node.left, sourceFile, scope, diagnostics);
  if (v === undefined) return undefined;
  const rightMark = scope.hoistMark();
  const literal = absentLiteral(node.right);
  const rightCtx =
    literal !== undefined
      ? optionalT(inner, literal)
      : optionalInner(contextual) !== undefined
        ? contextual
        : inner;
  const rightName = optionalBindingOf(node.right, scope);
  let right =
    rightName !== undefined &&
    narrowedStateOf(sourceFile, skipParens(node.right) as ts.Identifier, rightName.type) !==
      'present'
      ? rawRead(rightName)
      : isMemberPath(node.right)
        ? lowerExpression(node.right, sourceFile, scope, diagnostics)
        : lowerExpression(node.right, sourceFile, scope, diagnostics, rightCtx);
  const rightSetup = scope.takeHoisted(rightMark);
  if (right === undefined) return undefined;
  right = retargetIntLitCtx(right, node.right, inner);
  if (typeKey(right.type) === typeKey(inner)) {
    return scope.selectWithSetup(presentFlagOf(v), valueOf(v, inner), right, [], rightSetup);
  }
  if (isOptional(right.type) && typeKey(optionalInner(right.type)!) === typeKey(inner)) {
    const present =
      typeKey(right.type) === typeKey(v.type) ? v : presentOf(right.type, valueOf(v, inner));
    return scope.selectWithSetup(presentFlagOf(v), present, right, [], rightSetup);
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"??" gives ${authorTypeText(inner)} from "${node.left.getText(sourceFile)}" and ` +
      `${authorTypeText(right.type)} from "${node.right.getText(sourceFile)}", and a value has one type.`,
  );
  return undefined;
}

export function lowerNullishAssign(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const b = optionalBindingOf(node.left, scope);
  if (b === undefined) {
    const place = isMemberPath(node.left)
      ? lowerLValue(node.left, sourceFile, scope, diagnostics)
      : lowerOptionalOperand(node.left, sourceFile, scope, diagnostics);
    if (place === undefined) return undefined;
    const inner = optionalInner(place.type);
    if (inner === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"??=" assigns an optional local, parameter or field when it is absent, and ` +
          `"${node.left.getText(sourceFile)}" is ${anOf(authorTypeText(place.type))}.`,
      );
      return undefined;
    }
    const mark = scope.hoistMark();
    const value = lowerExpression(node.right, sourceFile, scope, diagnostics, place.type);
    const setup = scope.takeHoisted(mark);
    if (value === undefined) return undefined;
    if (typeKey(value.type) !== typeKey(place.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.right,
        `Type mismatch in assign: ${authorTypeText(value.type)} to ${authorTypeText(place.type)}.`,
      );
      return undefined;
    }
    return {
      s: 'if',
      arms: [
        {
          cond: notOf(presentFlagOf(place)),
          body: [...setup, { s: 'assign', target: place, expr: value }],
        },
      ],
    };
  }
  if (!b.mutable) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.left,
      `Cannot assign to "${node.left.getText(sourceFile)}": it is a const.`,
      TS_CODES.CONST_ASSIGN,
    );
    return undefined;
  }
  const mark = scope.hoistMark();
  const right = lowerExpression(node.right, sourceFile, scope, diagnostics, b.type);
  const setup = scope.takeHoisted(mark);
  if (right === undefined) return undefined;
  if (typeKey(right.type) !== typeKey(b.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.right,
      `Type mismatch in assign: ${authorTypeText(right.type)} to ${authorTypeText(b.type)}.`,
    );
    return undefined;
  }
  const target = rawRead(b);
  return {
    s: 'if',
    arms: [
      {
        cond: notOf(presentFlagOf(target)),
        body: [...setup, { s: 'assign', target, expr: right }],
      },
    ],
  };
}

export function continuesOptionalChain(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
      if (x.questionDotToken !== undefined) return true;
      x = x.expression;
      continue;
    }
    if (ts.isCallExpression(x)) {
      if (x.questionDotToken !== undefined) return true;
      x = x.expression;
      continue;
    }
    return false;
  }
}

export function lowerOptionalChain(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  read: () => Expr | undefined,
): Expr | undefined {
  const obj = lowerOptionalOperand(node.expression, sourceFile, scope, diagnostics);
  if (obj === undefined) return undefined;
  const inner = optionalInner(obj.type);
  if (inner === undefined) {
    scope.setChainAlias(node.expression, () => obj);
    return read();
  }
  const o = once(obj, node.expression, sourceFile, scope, diagnostics);
  if (o === undefined) return undefined;
  scope.setChainAlias(node.expression, () => valueOf(o, inner));
  const member = read();
  if (member === undefined) return undefined;
  const memberInner = optionalInner(member.type);
  if (memberInner !== undefined) {
    const out = optionalT(memberInner, (optionalAbsence(member.type)! | 1) as Absence);
    const converted = convertOptional(member, out, node, sourceFile, scope, diagnostics);
    if (converted === undefined) return undefined;
    return {
      op: 'select',
      type: out,
      cond: presentFlagOf(o),
      ifTrue: converted,
      ifFalse: absentOf(out, memberInner, (n) => scope.structByName(n), 1),
    };
  }
  return { op: 'construct', type: optionalT(member.type), args: [member, presentFlagOf(o)] };
}

export function optionalConditionSentence(
  node: ts.Expression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string | undefined {
  const b = optionalPathOf(node, scope, sourceFile);
  if (b === undefined) return undefined;
  const inner = optionalInner(b.type)!;
  const name = b.text;
  const remedy =
    typeKey(inner) === 'bool'
      ? `"${name} === true", or "${name} ?? false"`
      : `"${presenceTest(name, b.type)}"`;
  return `A condition is a bool, and "${name}" is "${authorTypeText(b.type)}". Write ${remedy}.`;
}

export function refuseNonNull(
  node: ts.NonNullExpression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const b = optionalPathOf(node.expression, scope, sourceFile);
  if (b === undefined) return false;
  const inner = optionalInner(b.type)!;
  const name = b.text;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${name}!" asserts that "${name}" is there, which a shader cannot check. Test it, ` +
      `"if (${presenceTest(name, b.type)})", or give the absent case a value, ` +
      `"${name} ?? ${absentRemedyValue(inner, authorTypeText)}".`,
  );
  return true;
}

export function refuseOptionalCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const callee = node.expression;
  const chained =
    node.questionDotToken !== undefined ||
    ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      callee.questionDotToken !== undefined);
  if (!chained) return false;
  const obj =
    ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
      ? callee.expression.getText(sourceFile)
      : callee.getText(sourceFile);
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"?." before a call tests a function value, and a shader has none. Test the object first, ` +
      `"if (${obj} !== undefined)", and call it there.`,
    TS_CODES.UNSUPPORTED,
  );
  return true;
}

export function bodyReturnsAbsence(body: ts.Block): number {
  let absence = 0;
  let bare = false;
  let valued = false;
  const visit = (n: ts.Node): void => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
    if (ts.isReturnStatement(n)) {
      if (n.expression === undefined) bare = true;
      else if (absentLiteral(n.expression) !== undefined) absence |= absentLiteral(n.expression)!;
      else valued = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return absence | ((valued || absence !== 0) && (bare || !blockAlwaysReturns(body)) ? 1 : 0);
}

function blockAlwaysReturns(block: ts.Block): boolean {
  return statementsAlwaysReturn(block.statements);
}

function statementsAlwaysReturn(statements: readonly ts.Statement[]): boolean {
  const last = statements[statements.length - 1];
  return last !== undefined && statementTerminates(last);
}

function statementTerminates(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s)) return true;
  if (
    ts.isExpressionStatement(s) &&
    ts.isIdentifier(s.expression) &&
    s.expression.text === 'discard'
  )
    return true;
  if (ts.isBlock(s)) return statementsAlwaysReturn(s.statements);
  if (ts.isIfStatement(s)) {
    if (s.elseStatement === undefined) return false;
    return statementTerminates(s.thenStatement) && statementTerminates(s.elseStatement);
  }
  if (ts.isSwitchStatement(s)) {
    const clauses = s.caseBlock.clauses;
    if (!clauses.some((c) => ts.isDefaultClause(c))) return false;
    return clauses.every((c) => statementsAlwaysReturn(c.statements));
  }
  return false;
}

export function lowerOptionalInitializer(
  init: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
): Expr | undefined {
  const b = optionalBindingOf(init, scope);
  if (b === undefined) return undefined;
  const id = skipParens(init) as ts.Identifier;
  const inner = optionalInner(b.type)!;
  const value =
    narrowedStateOf(sourceFile, id, b.type) === 'present'
      ? valueOf(rawRead(b), inner)
      : narrowOptional(rawRead(b), narrowingAt(sourceFile, id));
  noteValueType(init, value.type);
  return value;
}

function narrowOptional(value: Expr, state: ReturnType<typeof narrowingAt>): Expr {
  const old = optionalAbsence(value.type)!;
  if (typeof state !== 'number' || old !== 3) return value;
  const remaining = old & state;
  if (remaining !== 1 && remaining !== 2) return value;
  return {
    op: 'construct',
    type: optionalT(optionalInner(value.type)!, remaining),
    args: [valueOf(value, optionalInner(value.type)!), presentFlagOf(value)],
  };
}

export function convertOptional(
  value: Expr,
  target: ShaderType,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  _scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const from = optionalAbsence(value.type);
  const to = optionalAbsence(target);
  if (from === undefined || to === undefined || typeKey(value.type) === typeKey(target))
    return value;
  if (
    typeKey(optionalInner(value.type)!) !== typeKey(optionalInner(target)!) ||
    (from & to) !== from
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      placeOf(node),
      `Type mismatch: ${authorTypeText(value.type)} to ${authorTypeText(target)}.`,
    );
    return undefined;
  }
  const build = (v: Expr): Expr => ({
    op: 'construct',
    type: target,
    args: [
      valueOf(v, optionalInner(target)!),
      presentFlagOf(v),
      { op: 'lit', type: boolT, value: from === 2 },
    ],
  });
  return readsOnce(value) ? build(value) : optionalHelper('widen', [value], ([v]) => build(v!));
}
