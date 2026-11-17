import { peekingReads } from '../../abstract-const.js';
import { logicalTypeKey as typeKey } from '../../optional.js';
import ts from 'typescript';
import type { Expr, Stmt } from '../../../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { readOnlyPhrase, writableRemedy, type LoweringScope, writeRules } from '../../context.js';
import { lowerExpression } from '../expression.js';
import { lowerUserCall } from '../expression-misc.js';
import { lowerLValue } from '../statement.js';
import { captureArguments } from '../local-functions.js';
import { heldRefusal } from '../pending-shares.js';
import { checkFunctionAccess, checkPrivateAccess, memberFunctionOf } from '../class-access.js';
import { ClassFunction, pushDiag, unparen, declaringClassOf } from '../class-methods.js';

export function lowerCopyCall(
  node: ts.CallExpression | ts.NewExpression,
  cf: ClassFunction,
  on: ts.Expression | undefined,
  recv: Expr | undefined,
  asStatement: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  throughSuper = false,
): Expr | undefined {
  const made = scope.instantiateMember(cf, node, on, sourceFile, diagnostics);
  if (made === undefined) return undefined;
  const { decl, writes } = made;
  const leading = captureArguments(decl, cf.shown, node, sourceFile, scope, diagnostics);
  if (leading === undefined) return undefined;
  if (throughSuper && recv !== undefined) {
    leading.push(recv);
  } else if (on !== undefined && cf.kind === 'method') {
    if (writes) {
      if (!asStatement) {
        if (!scope.calleeReady(decl, node, sourceFile, diagnostics)) return undefined;
        if (typeKey(decl.ret) === 'void') {
          pushDiag(
            diagnostics,
            sourceFile,
            node,
            `"${cf.shown}" changes its object and returns nothing; call it on its own line.`,
          );
          return undefined;
        }
      }
      const target = mutatingReceiver(node, on, cf.shown, sourceFile, scope, diagnostics);
      if (!target) return undefined;
      leading.push(target);
    } else {
      const value = recv ?? lowerExpression(on, sourceFile, scope, diagnostics);
      if (!value) return undefined;
      leading.push(value);
    }
  }
  const fnAt = cf.takesFunctions ?? new Set<number>();
  const written = (node.arguments ?? []).filter((_, i) => !fnAt.has(i));
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, {
    shown: cf.shown,
    leading,
    written,
  });
}

export function mutatingReceiver(
  node: ts.Node,
  obj: ts.Expression,
  shown: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const bare = unparen(obj);
  const alias = scope.chainAlias(bare);
  if (alias !== undefined) return alias();
  if (ts.isIdentifier(bare)) {
    const found = scope.resolve(bare.text);
    const b = found === undefined ? undefined : writeRules(found);
    if (b !== undefined && b.kind === 'param') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object, and "${bare.text}" is a parameter, which a function ` +
          `cannot write; copy it into a let first.`,
      );
      return undefined;
    }
    if (b !== undefined && !b.mutable && b.toVar !== undefined) b.toVar();
    if (
      b !== undefined &&
      !b.mutable &&
      b.kind === 'local' &&
      b.type.kind === 'struct' &&
      heldRefusal(diagnostics, bare.text, b.type)
    )
      return undefined;
    if (b !== undefined && !b.mutable) {
      const copy = b.kind === 'local' && b.type.kind === 'struct';
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        copy
          ? `"${shown}" changes its object, and "${bare.text}" is a const whose value may be ` +
              `one something else holds, which TypeScript would change with it and a copy here ` +
              `would not. Declare it with let to change a copy, or call it on the value itself.`
          : b.kind === 'binding'
            ? `"${shown}" changes its object, and "${bare.text}" is ` +
              `${readOnlyPhrase(b.kind)}.${writableRemedy(b, sourceFile)}`
            : `"${shown}" changes its object, and "${bare.text}" is ${readOnlyPhrase(b.kind)}; ` +
              `declare it with let.`,
      );
      return undefined;
    }
  }
  if (ts.isCallExpression(bare) && ts.isPropertyAccessExpression(bare.expression)) {
    const receiver = bare.expression.expression;
    const inner = peekingReads(() => lowerExpression(receiver, sourceFile, scope, []));
    const link =
      inner?.type.kind === 'struct'
        ? memberFunctionOf(inner.type.name, bare.expression.name.text, 'method', scope)
        : undefined;
    if (link?.cf.returnsThis === true) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object, and inside this expression it would change the copy ` +
          `"${bare.getText(sourceFile)}" hands back. Make the chain a statement of its own, ` +
          `or call each method on the object itself.`,
      );
      return undefined;
    }
  }
  if (ts.isCallExpression(bare) || ts.isNewExpression(bare)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" changes its object, and this one is a value that is dropped; keep it in a ` +
        `let and call the method on that.`,
    );
    return undefined;
  }
  return lowerLValue(obj, sourceFile, scope, diagnostics, true);
}

export function lowerMutatingCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined | 'not-a-mutating-call' {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return 'not-a-mutating-call';
  const obj = callee.expression;
  const member = callee.name.text;
  const peek = peekingReads(() => lowerExpression(obj, sourceFile, scope, []));
  if (!peek || peek.type.kind !== 'struct') return 'not-a-mutating-call';
  const name = peek.type.name;
  const found = memberFunctionOf(name, member, 'method', scope);
  if (
    found === undefined ||
    found.cf.kind === 'static' ||
    (!found.cf.mutates && found.cf.takesFunctions === undefined)
  ) {
    return 'not-a-mutating-call';
  }
  const { decl, cf } = found;
  if (!checkPrivateAccess(member, declaringClassOf(cf), name, callee.name, sourceFile, diagnostics))
    return undefined;
  if (!checkFunctionAccess(cf, name, callee.name, sourceFile, scope, diagnostics)) return undefined;
  if (cf.takesFunctions !== undefined) {
    const copied = lowerCopyCall(node, cf, obj, undefined, true, sourceFile, scope, diagnostics);
    return copied === undefined ? undefined : { s: 'call', expr: copied };
  }
  const shown = cf.shown;
  const target = mutatingReceiver(node, obj, shown, sourceFile, scope, diagnostics);
  if (!target) return undefined;
  const call = lowerUserCall(node, decl!, sourceFile, scope, diagnostics, {
    shown,
    leading: [target],
  });
  if (!call) return undefined;
  return { s: 'call', expr: call };
}
