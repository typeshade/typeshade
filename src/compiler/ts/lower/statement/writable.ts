import ts from 'typescript';
import { heldRefusal } from '../pending-shares.js';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { isVec64 } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import {
  LoweringScope,
  authorTypeText,
  readOnlyPhrase,
  writableRemedy,
  writeRules,
} from '../../context.js';
import { classFunctionOf } from '../class-methods.js';
import { inheritedStaticWrite, staticConstantWrite } from '../class-access.js';
import { unknownIdentifierSentence } from '../expression.js';
import { TS_CODES } from '../../codes.js';
import { readonlyWriteThrough } from '../readonly-promise.js';
import { unknownNameAlreadyReported } from '../../refused-names.js';
import {
  isComposite,
  constCopyWrite,
  rootLValueName,
  staticRootOf,
  unwrapParens,
  pushDiag,
} from '../statement.js';

export function checkRootWritable(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  into = false,
): boolean {
  return (
    checkRootNamed(node, sourceFile, scope, diagnostics, into) &&
    checkRootMutable(node, sourceFile, scope, diagnostics, into)
  );
}

export function checkRootNamed(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  into = false,
): boolean {
  const root = rootLValueName(node);
  if (!root) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Assignment target must be a name, or a field, component or element of one.',
      TS_CODES.ASSIGN_TARGET,
    );
    return false;
  }
  const rootName = ts.isIdentifier(root) ? root.text : 'this';
  const statik = staticRootOf(node, scope, sourceFile, into);
  if (statik !== undefined && 'said' in statik) return false;
  if (statik !== undefined && 'refused' in statik) {
    pushDiag(diagnostics, sourceFile, node, statik.refused, TS_CODES.CLASS_MEMBER);
    return false;
  }
  if (statik !== undefined) {
    const inherited = statik.whole
      ? inheritedStaticWrite(statik.owner, statik.written, scope, sourceFile)
      : undefined;
    if (inherited !== undefined) {
      pushDiag(diagnostics, sourceFile, node, inherited, TS_CODES.CONST_ASSIGN);
      return false;
    }
    if (statik.binding.kind === 'modvar') return true;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      staticConstantWrite(statik.owner, statik.written, sourceFile),
      TS_CODES.CONST_ASSIGN,
    );
    return false;
  }
  const binding = scope.resolve(rootName);
  if (!binding && scope.declarationRefused(rootName)) return false;
  if (!binding) {
    if (rootName !== 'this' && unknownNameAlreadyReported(node, rootName, sourceFile, diagnostics))
      return false;
    pushDiag(
      diagnostics,
      sourceFile,
      ts.isIdentifier(root) ? root : node,
      ts.isIdentifier(root)
        ? unknownIdentifierSentence(root, `Cannot assign to unknown name "${rootName}".`)
        : '"this" names a method\'s object; a static function and a top-level function have none.',
      TS_CODES.UNKNOWN_NAME,
    );
    return false;
  }
  if (binding.kind === 'param' && rootName === 'this') {
    const owner = scope.owner();
    const shown = owner === undefined ? undefined : classFunctionOf(owner)?.shown;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      shown?.startsWith('super.')
        ? `"${shown}" runs the base's body on an object it can only read, so the body cannot ` +
            `write "this" (§26). Move the write into a method no class overrides and call that ` +
            `on "this" instead.`
        : `${shown === undefined ? 'This body' : `"${shown}"`} reads its object only, so it ` +
            `cannot write "this" (§26).`,
      TS_CODES.CLASS_MEMBER,
    );
    return false;
  }
  const rules = writeRules(binding);
  if (rules.kind === 'param' && rules.space !== 'storage') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      rules.type.kind === 'struct' || rules.type.kind === 'array'
        ? `Cannot write through parameter "${rootName}": this kind of function does not take ` +
            `the caller's object yet (change 0142, stage 2). A function of the file or of a ` +
            `namespace does: move the write there, or return the new value.`
        : `Cannot write through parameter "${rootName}" — parameters are not writable. Use a local or storage.` +
            (mayTakeReference(node, rootName)
              ? ` To change the caller's value, return it, and write [a, b] = f(a, b) for more than one.`
              : ''),
      TS_CODES.ASSIGN_TARGET,
    );
    return false;
  }
  return true;
}

function mayTakeReference(node: ts.Node, name: string): boolean {
  for (let at: ts.Node = node; ; at = at.parent) {
    if (ts.isSourceFile(at)) return false;
    if (!ts.isFunctionLike(at)) continue;
    const fn: ts.SignatureDeclaration = at;
    if (!fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) continue;
    return (
      ts.isFunctionDeclaration(fn) &&
      (ts.isSourceFile(fn.parent) || ts.isModuleBlock(fn.parent)) &&
      (fn.typeParameters?.length ?? 0) === 0 &&
      !(fn.modifiers ?? []).some(ts.isDecorator)
    );
  }
}

export function checkRootMutable(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  into = false,
): boolean {
  const root = rootLValueName(node);
  if (!root) return true;
  if (staticRootOf(node, scope, sourceFile, into) !== undefined) return true;
  if (
    ts.isIdentifier(root) &&
    scope.chainAlias(root) !== undefined &&
    (into || !ts.isIdentifier(unwrapParens(node)))
  )
    return checkPlaceWritable(scope.chainAlias(root)!(), node, sourceFile, scope, diagnostics);
  const rootName = ts.isIdentifier(root) ? root.text : 'this';
  const binding = scope.resolve(rootName);
  if (!binding) return true;
  const rules = writeRules(binding);
  const promised = readonlyWriteThrough(node, binding, sourceFile);
  if (promised !== undefined) {
    pushDiag(diagnostics, sourceFile, node, promised, TS_CODES.CONST_ASSIGN);
    return false;
  }
  if (!rules.mutable) {
    const through = into || !ts.isIdentifier(unwrapParens(node));
    if (through && rules.toVar !== undefined) {
      rules.toVar();
      binding.capture?.byRef();
      return true;
    }
    if (
      through &&
      rules.kind === 'local' &&
      isComposite(rules.type) &&
      heldRefusal(diagnostics, rootName, rules.type)
    )
      return false;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      through && rules.kind === 'local' && isComposite(rules.type)
        ? constCopyWrite(rootName, rules.type)
        : `Cannot assign to "${rootName}" — it is ${readOnlyPhrase(rules.kind)}.` +
            writableRemedy(rules, sourceFile),
      TS_CODES.CONST_ASSIGN,
    );
    return false;
  }
  binding.capture?.byRef();
  return true;
}

export function checkPlaceWritable(
  place: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  let at = place;
  while (at.op === 'member' || at.op === 'index') at = at.base;
  if (at.op !== 'varref' && at.op !== 'param' && at.op !== 'externref') return true;
  const binding = scope.resolveIr(at.name);
  if (binding === undefined) return true;
  const rules = writeRules(binding);
  if (!rules.mutable) {
    if (rules.toVar !== undefined) {
      rules.toVar();
      binding.capture?.byRef();
      return true;
    }
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to "${rules.name}" — it is ${readOnlyPhrase(rules.kind)}.` +
        writableRemedy(rules, sourceFile),
      TS_CODES.CONST_ASSIGN,
    );
    return false;
  }
  binding.capture?.byRef();
  return true;
}

export function refuseVec64LaneWrite(
  base: ShaderType,
  what: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!isVec64(base)) return false;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Cannot assign to ${what} of a ${authorTypeText(base)}: an emulated-double vector is a pair of ` +
      `hi/lo planes after lowering, so a lane of it is a read, not a place. Rebuild the ` +
      `vector instead, e.g. v = vec${(base as { n: number }).n}f64(x, …).`,
    TS_CODES.ASSIGN_TARGET,
  );
  return true;
}

export function refuseParamWrite(
  node: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Cannot assign to "${name}": a parameter that names another value from here on is not ` +
      `supported yet in this position (change 0142, stage 2). Declare a local for the other ` +
      `value: "let ${name}_ = …;", then use that.`,
    TS_CODES.ASSIGN_TARGET,
  );
}
