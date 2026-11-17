// Why: Implements: Rule 6.10, Rule 8.8, Rule 8.28 (docs/language-design.md; traced in reqs/).

import { copiedObjectsActive } from '../../../core/copied-objects.js';
import ts from 'typescript';
import { logicalTypeKey as typeKey, optionalInner } from '../optional.js';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { cloneIr, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { bare } from '../object-reference.js';
import { aliasedCall, isNewObject, isObjectType } from '../new-object.js';
import { deferRefusal } from './pending-shares.js';
import { objectWrittenAround, usesOfDeclared, wholeWrite } from '../object-share/uses.js';

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

export function holdIndexesOnce(e: Expr, scope: LoweringScope): Expr | undefined {
  if (e.op === 'member') {
    const base = holdIndexesOnce(e.base, scope);
    return base === undefined ? undefined : { ...e, base };
  }
  if (e.op === 'index') {
    const base = holdIndexesOnce(e.base, scope);
    if (base === undefined) return undefined;
    if (e.idx.op === 'lit') return { ...e, base };
    if (!scope.canHoist()) return undefined;
    return { ...e, base, idx: scope.hoistTemp('_at', e.idx) };
  }
  return e;
}

function isPlaceChain(e: Expr): boolean {
  for (let at = e; ; at = at.base) {
    if (at.op === 'varref' || at.op === 'param' || at.op === 'externref') return true;
    if (at.op !== 'member' && at.op !== 'index') return false;
  }
}

export function copyOfObject(
  decl: ts.VariableDeclaration,
  name: ts.Node,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  type: ShaderType,
): boolean {
  if (isConst && !objectWrittenAround(decl, sourceFile)) return true;
  const call = (decl.initializer ?? decl).getText(sourceFile).replace(/\s+/g, ' ');
  deferRefusal(diagnostics, {
    sourceFile,
    node: name,
    type,
    name: name.getText(sourceFile),
    code: TS_CODES.UNSUPPORTED,
    message:
      `"${name.getText(sourceFile)}" would name an object that "${call}" gives back, which may ` +
      `already have a name, and the function writes an object after that. One object under two ` +
      `names is not supported yet (change 0142, stage 2). Read what you need from the call ` +
      `first, or write through the name that holds the object.`,
  });
  return true;
}

export function secondNameOf(
  decl: ts.VariableDeclaration,
  init: Expr,
  annotated: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): 'bound' | 'refused' | 'none' {
  const type = annotated ?? init.type;
  if (!isObjectType(type) && !isObjectType(init.type)) return 'none';
  if (copiedObjectsActive() || !ts.isIdentifier(decl.name) || decl.initializer === undefined)
    return 'none';
  if (isNewObject(decl.initializer, sourceFile, init.type)) return 'none';
  const name = decl.name.text;
  const list = decl.parent as ts.VariableDeclarationList;
  const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
  const direct = bare(decl.initializer);
  const from = ts.isIdentifier(direct) ? direct : aliasedCall(decl, sourceFile)?.argument;
  const target = from === undefined ? undefined : scope.resolve(from.text);
  const refuse = (node: ts.Node, message: string): 'refused' => {
    pushDiag(diagnostics, sourceFile, node, message, TS_CODES.UNSUPPORTED);
    return 'refused';
  };
  const sameType = typeKey(init.type) === typeKey(type) && optionalInner(init.type) === undefined;
  const plain =
    target !== undefined &&
    from !== undefined &&
    scope.chainAlias(from) === undefined &&
    (target.kind === 'local' || target.kind === 'param' || target.kind === 'binding') &&
    typeKey(target.type) === typeKey(type);
  if (!sameType || !(plain || isPlaceChain(init))) {
    if (
      optionalInner(type) === undefined &&
      optionalInner(init.type) === undefined &&
      type.kind === 'struct' &&
      init.type.kind === 'struct' &&
      typeKey(type) !== typeKey(init.type)
    )
      return 'none';
    copyOfObject(decl, decl.name, isConst, sourceFile, diagnostics, init.type);
    return 'none';
  }
  let region: ts.Node = list.parent;
  if (ts.isVariableStatement(region)) region = region.parent;
  const uses = usesOfDeclared(decl, region, sourceFile);
  if (uses.some((u) => functionBetween(u, region))) {
    return refuse(
      decl.name,
      `"${name}" is a second name of an object that already has a name, and a function inside ` +
        `this one uses "${name}". A second name that a local function captures is not ` +
        `supported yet (change 0142, stage 2). Use the first name in that function.`,
    );
  }
  if (uses.some((u) => wholeWrite(u) === 'compound')) return 'none';
  const assigned = uses.some((u) => wholeWrite(u) === 'assign');
  if (assigned) {
    deferRefusal(diagnostics, {
      sourceFile,
      node: decl.name,
      type,
      code: TS_CODES.UNSUPPORTED,
      message:
        `"${name}" is a second name of an object that already has a name, and "${name}" is ` +
        `assigned again later. Following which object each name then refers to is not ` +
        `supported yet (change 0142, stage 2). Give "${name}" its own variable for the second ` +
        `object.`,
    });
    return 'none';
  }
  const mutable = !isConst;
  try {
    if (plain) scope.defineAlias(name, target!);
    else scope.define({ kind: 'local', name, type, mutable });
  } catch (e) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      e instanceof Error ? e.message : String(e),
      TS_CODES.DUPLICATE_SYMBOL,
    );
    return 'refused';
  }
  scope.recordDeclaration(sourceFile, decl.name, {
    name,
    kind: 'local',
    type,
    mutable: plain ? target!.mutable : mutable,
  });
  if (plain) return 'bound';
  const fixed = holdIndexesOnce(init, scope);
  if (fixed === undefined) {
    return refuse(
      decl.name,
      `"${name}" names "${decl.initializer.getText(sourceFile)}", and an index in it is read ` +
        `once, where "${name}" is declared. This statement cannot hold the index. Declare the ` +
        `index first, const k = …, and name ps[k].`,
    );
  }
  for (const use of uses) scope.setChainAlias(use, (): Expr => cloneIr(fixed));
  return 'bound';
}

function functionBetween(n: ts.Node, region: ts.Node): boolean {
  for (let at = n.parent; at !== undefined && at !== region; at = at.parent)
    if (ts.isFunctionLike(at)) return true;
  return false;
}
