// Implements: Rule 6.3, Rule 7.4 (docs/language-design.md; traced in reqs/).

import { exportedConstant } from './abstract-const.js';
import {
  abstractConstFor,
  hasNoWrittenType,
  noteIntegerRead,
  recordModuleAbstractConst,
} from './abstract-const.js';
import { logicalTypeKey as typeKey } from './optional.js';
import ts from 'typescript';
import { isStageCall } from './stage-call.js';
import type { ConstDecl, Expr, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f64T, i32T } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import {
  LoweringScope,
  authorTypeText,
  refuseModuleName,
  refusedDeclarationsOf,
  sameFile,
  writtenName,
  writtenText,
} from './context.js';
import type { DeclaredSymbolSink } from './symbols.js';
import { captureExpressionRecords } from './symbols.js';
import { captureValueTypes } from './lower/optional-values.js';
import { mapTsTypeToShaderType } from './type-map.js';
import { refuseOptionalAt } from './optional.js';
import { foldConstComponents, foldConstValue } from './loop-bound.js';
import { foldF64ModuleConst } from './module-const-f64.js';
import {
  kindlessOrigin,
  markKindlessModuleConst,
  pendingKindlessRefusal,
  retargetIntLitCtx,
} from './lit-coerce.js';
import { lowerUntypedList, untypedListOf } from './lower/expression-array/untyped-list.js';
import { containsCall } from './expression-calls.js';
import { listBinding } from './lower/expression-array/list-values.js';
import { writtenTypeOf } from './lower/written-type.js';
import { isConstEvaluableMathFn } from './math-alias.js';
import { lowerExpression } from './lower/expression.js';
import { lowerArrayLiteral, refuseListSpread } from './lower/expression-array.js';
import { eachNamespaceStatement, namespaceMemberName, qualifiedParts } from './namespaces.js';
import { isResourceCall } from './bindings.js';
import { isOverrideType } from './overrides.js';
import { moduleVarSpace } from './module-vars.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { localFunctionOf } from './lower/local-functions.js';
import { declarationOf, importsName } from './lower/closures.js';
import { newTargetOf } from './lower/new-target.js';
import { isMixinApplication } from './mixins.js';
import { mathDeclarationOf } from './math-binding.js';
import {
  emittedMemberName,
  holdsFunction,
  isStaticMember,
  shadowedStaticFields,
  staticThisClass,
  writtenMemberName,
  writtenStaticFields,
} from './class-names.js';

export const staticConstName = (owner: string, member: string): string => `${owner}_${member}`;

export function writtenConstNames(sourceFile: ts.SourceFile): [string, string][] {
  const out: [string, string][] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    if (ts.isEnumDeclaration(stmt)) {
      for (const member of stmt.members) {
        if (!ts.isIdentifier(member.name)) continue;
        const owner = stmt.name.text;
        out.push([staticConstName(owner, member.name.text), `${owner}.${member.name.text}`]);
      }
      return;
    }
    if (prefix === '' || !isTopLevelConst(stmt)) return;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || localFunctionOf(decl) !== undefined) continue;
      const written = [decl.name.text];
      for (let at: ts.Node | undefined = stmt.parent; at !== undefined; at = at.parent) {
        if (ts.isModuleDeclaration(at) && ts.isIdentifier(at.name)) written.unshift(at.name.text);
      }
      out.push([namespaceMemberName(prefix, decl.name.text), written.join('.')]);
    }
  });
  return out;
}

// Why: Tint refuses a call in a module-scope initializer ("user-declared functions cannot be called at module-scope").
export function declaredCallIn(
  init: ts.Node,
  sourceFile: ts.SourceFile,
): ts.CallExpression | ts.NewExpression | undefined {
  let found: ts.CallExpression | ts.NewExpression | undefined;
  const walk = (n: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n)) return;
    if (ts.isCallExpression(n) && callsDeclared(n.expression)) {
      found = n;
      return;
    }
    if (
      ts.isNewExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ThisKeyword ||
        newTargetOf(n, sourceFile).kind === 'class')
    ) {
      found = n;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(init);
  return found;
}

function callsDeclared(callee: ts.Expression): boolean {
  let root = callee;
  while (ts.isParenthesizedExpression(root)) root = root.expression;
  const dotted = ts.isPropertyAccessExpression(root);
  while (ts.isPropertyAccessExpression(root) || ts.isParenthesizedExpression(root)) {
    root = root.expression;
  }
  if (root.kind === ts.SyntaxKind.ThisKeyword) return dotted && staticThisClass(root) !== undefined;
  if (!ts.isIdentifier(root)) return false;
  const decl = declarationOf(root);
  if (decl === undefined) return !dotted && importsName(root.getSourceFile(), root.text);
  if (dotted) return ts.isClassDeclaration(decl) || ts.isModuleDeclaration(decl);
  return (
    ts.isFunctionDeclaration(decl) ||
    (ts.isVariableDeclaration(decl) && localFunctionOf(decl) !== undefined)
  );
}

export function writtenModuleName(
  decl: ts.VariableDeclaration | ts.PropertyDeclaration,
  sourceFile: ts.SourceFile,
): string {
  const own = ts.isIdentifier(decl.name) ? writtenName(decl.name) : decl.name.getText(sourceFile);
  if (ts.isPropertyDeclaration(decl) && ts.isClassDeclaration(decl.parent)) {
    return [...qualifiedParts(decl.parent), own].join('.');
  }
  const parts = [own];
  for (let at: ts.Node | undefined = decl.parent; at !== undefined; at = at.parent) {
    if (ts.isModuleDeclaration(at) && ts.isIdentifier(at.name)) parts.unshift(writtenName(at.name));
  }
  return parts.join('.');
}

const constantShown = (
  decl: ts.VariableDeclaration | ts.PropertyDeclaration,
  sourceFile: ts.SourceFile,
): string =>
  `${ts.isPropertyDeclaration(decl) ? 'Static field' : 'Module const'} ` +
  `"${writtenModuleName(decl, sourceFile)}"`;

function declaredCallMessage(
  decl: ts.VariableDeclaration | ts.PropertyDeclaration,
  call: ts.CallExpression | ts.NewExpression,
  sourceFile: ts.SourceFile,
): string {
  const root = call.expression;
  const declared = ts.isIdentifier(root) ? declarationOf(root) : undefined;
  const imported =
    ts.isIdentifier(root) &&
    (declared === undefined ? importsName(sourceFile, root.text) : !sameFile(declared, decl));
  const what = `${ts.isNewExpression(call) ? 'builds a class' : 'calls a function'} this file ${
    imported ? 'imports' : 'declares'
  }`;
  const text = writtenText(call);
  const kind = ts.isPropertyDeclaration(decl)
    ? 'A static field no code writes is a module constant, folded'
    : 'A module constant is folded';
  return (
    `${constantShown(decl, sourceFile)} must be constant, and "${text}" ${what}. ${kind} ` +
    `before any function exists, so build the value inside the function that reads it.`
  );
}

function collectEnum(
  stmt: ts.EnumDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  out: ConstDecl[],
): void {
  const owner = stmt.name.text;
  if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        stmt.name,
        `"declare enum ${owner}" has no members to emit; declare the enum in this file.`,
        TS_CODES.TOP_LEVEL,
      ),
    );
    return;
  }
  let next = 0;
  const seen = new Map<string, number>();
  for (const member of stmt.members) {
    if (!ts.isIdentifier(member.name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          member.name,
          `Enum member "${owner}.${member.name.getText(sourceFile)}" must be a simple name.`,
          TS_CODES.TOP_LEVEL,
        ),
      );
      continue;
    }
    const shown = `${owner}.${member.name.text}`;
    const name = staticConstName(owner, member.name.text);
    let value = next;
    if (member.initializer !== undefined) {
      if (ts.isStringLiteralLike(member.initializer)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member,
            `Enum member "${shown}" has a string value, which no GPU type holds. A numeric ` +
              `enum member is an i32 constant; give it a number, or drop the value and take ` +
              `the position.`,
            TS_CODES.TYPE_MISMATCH,
          ),
        );
        continue;
      }
      if (declaredCallIn(member.initializer, sourceFile) !== undefined) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member,
            `Enum member "${shown}" needs a value this can compute: a whole number, or ` +
              `arithmetic over numbers and members declared before it.`,
            TS_CODES.TYPE_MISMATCH,
          ),
        );
        refuseModuleName(sourceFile, name);
        continue;
      }
      scope.push();
      for (const [bare, v] of seen) {
        scope.define({ kind: 'module', name: bare, type: i32T, mutable: false, constValue: v });
      }
      const init = lowerExpression(member.initializer, sourceFile, scope, diagnostics);
      const folded = init === undefined ? undefined : foldConstValue(init, scope);
      scope.pop();
      if (!init) continue;
      if (typeof folded !== 'number' || !Number.isInteger(folded)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member,
            `Enum member "${shown}" needs a value this can compute: a whole number, or ` +
              `arithmetic over numbers and members declared before it.`,
            TS_CODES.TYPE_MISMATCH,
          ),
        );
        continue;
      }
      value = folded;
    }
    if (value < -2147483648 || value > 2147483647) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          member,
          `Enum member "${shown}" is ${value}, which is outside an i32's [-2147483648, 2147483647].`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
      continue;
    }
    next = value + 1;
    seen.set(member.name.text, value);
    if (scope.hasInCurrent(name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          member.name,
          `Enum member "${shown}" collides with "${name}", which the file already declares.`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      );
      continue;
    }
    scope.define({ kind: 'module', name, type: i32T, mutable: false, constValue: value });
    scope.recordDeclaration(sourceFile, member.name, { name, kind: 'const', type: i32T });
    out.push({ name, type: i32T, wgslValue: value, cpuValue: value });
  }
}

function isTopLevelConst(stmt: ts.Statement): stmt is ts.VariableStatement {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

export function collectModuleConsts(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  structs: readonly StructDecl[] = [],
): ConstDecl[] {
  const scope = new LoweringScope(undefined, symbols);
  scope.setStructs(structs);
  scope.markModuleConstants();
  const out: ConstDecl[] = [];
  const valueExprs = new Map<string, Expr>();
  const sites: { stmt: ts.Statement; prefix: string }[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    sites.push({ stmt, prefix });
  });
  for (const { stmt, prefix } of sites) {
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const written = writtenStaticFields(sourceFile);
      const shadowed = shadowedStaticFields(stmt);
      for (const member of stmt.members) {
        if (!ts.isPropertyDeclaration(member) || !isStaticMember(member)) continue;
        if (holdsFunction(member)) continue;
        if (shadowed.has(member)) continue;
        const name = writtenMemberName(member.name);
        if (name === undefined) continue;
        if (written.has(`${stmt.name.text}.${name}`)) continue;
        if (!member.initializer) {
          diagnostics.push(
            makeDiagnostic(
              sourceFile,
              member,
              `Static field "${stmt.name.text}.${name}" needs an initializer: it ` +
                `is a module constant, and a constant has a value.`,
              TS_CODES.TOP_LEVEL,
            ),
          );
          continue;
        }
        const previousClass = scope.staticClass();
        scope.setStaticClass(stmt.name.text);
        let c: ConstDecl | undefined;
        try {
          c = lowerOne(
            member,
            sourceFile,
            scope,
            diagnostics,
            valueExprs,
            staticConstName(stmt.name.text, emittedMemberName(name)),
          );
        } finally {
          scope.setStaticClass(previousClass);
        }
        if (!c) continue;
        out.push(c);
        if (c.valueExpr) valueExprs.set(c.name, c.valueExpr);
      }
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      collectEnum(stmt, sourceFile, scope, diagnostics, out);
      continue;
    }
    if (!isTopLevelConst(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (isOverrideType(decl.type)) continue;
      const overMath = mathDeclarationOf(decl, sourceFile);
      if (overMath !== undefined) {
        const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported && overMath.refusals.length === 0) {
          diagnostics.push(
            makeDiagnostic(
              sourceFile,
              decl,
              `"${overMath.names.join('", "')}" binds a Math member, which a module does not ` +
                `export. Write the const in each module that calls it.`,
              TS_CODES.TOP_LEVEL,
            ),
          );
        } else {
          diagnostics.push(...overMath.refusals);
        }
        if (exported || overMath.refusals.length > 0) {
          for (const bound of overMath.names) {
            refusedDeclarationsOf(scope.calleeTable()).add(bound);
            refuseModuleName(sourceFile, bound);
          }
        }
        continue;
      }
      if (moduleVarSpace(decl.type) !== undefined) continue;
      if (localFunctionOf(decl) !== undefined) continue;
      if (decl.initializer !== undefined && isStageCall(decl.initializer)) continue;
      if (isMixinApplication(decl, sourceFile)) continue;
      const c = lowerOne(
        decl,
        sourceFile,
        scope,
        diagnostics,
        valueExprs,
        prefix === '' || !ts.isIdentifier(decl.name)
          ? undefined
          : namespaceMemberName(prefix, decl.name.text),
      );
      if (!c) continue;
      out.push(c);
      if (c.valueExpr) valueExprs.set(c.name, c.valueExpr);
    }
  }
  return out;
}

export function isFoldableConstExpr(e: Expr, scope: LoweringScope): boolean {
  return isFoldableValueExpr(e, scope, new Map());
}

function isFoldableValueExpr(
  e: Expr,
  scope: LoweringScope,
  valueExprs: ReadonlyMap<string, Expr>,
): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return true;
    case 'unop':
      return isFoldableValueExpr(e.a, scope, valueExprs);
    case 'binop':
      if ((e.bop === '/' || e.bop === '%') && foldsToZero(e.b, scope, valueExprs)) return false;
      return (
        isFoldableValueExpr(e.a, scope, valueExprs) && isFoldableValueExpr(e.b, scope, valueExprs)
      );
    case 'construct':
      return e.args.every((a) => isFoldableValueExpr(a, scope, valueExprs));
    case 'call':
      return (
        e.declRef === undefined &&
        isConstEvaluableMathFn(e.fn) &&
        e.args.every((a) => isFoldableValueExpr(a, scope, valueExprs))
      );
    default:
      return false;
  }
}

function foldsToZero(
  e: Expr,
  scope: LoweringScope,
  valueExprs: ReadonlyMap<string, Expr>,
): boolean {
  const parts = foldConstComponents(e, scope, valueExprs);
  return parts !== undefined && parts.some((v) => v === 0);
}

function isValueExprType(t: ShaderType): boolean {
  // Why: ANGLE does not accept the nested array type that the GLSL ES 3.00 writer spells inline.
  if (t.kind === 'array') return t.elem.kind !== 'array';
  return t.kind === 'vec' || t.kind === 'struct' || t.kind === 'mat';
}

function valueExprConst(
  name: string,
  decl: ConstSite,
  init: Expr,
  annotated: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  valueExprs: ReadonlyMap<string, Expr>,
): ConstDecl | undefined {
  const type = annotated ?? init.type;
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is declared ${authorTypeText(annotated)} but its value is ${authorTypeText(init.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  if (!isFoldableValueExpr(init, scope, valueExprs)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `${constantShown(decl, sourceFile)} must be constant: a literal, a whole earlier module ` +
          `const, a constructor over those, or arithmetic over those with a non-zero divisor. ` +
          `It may call a math builtin over those, but not a declared function or a derivative, ` +
          `and it cannot read a resource or take a component, field or element.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    refusedDeclarationsOf(scope.calleeTable()).add(name);
    refuseModuleName(sourceFile, name);
    return undefined;
  }
  if (!isValueExprType(type)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be a foldable scalar (literal or const expression), ` +
          `or a whole vector or array built from them; ${authorTypeText(type)} is neither.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  scope.define({
    kind: 'module',
    name,
    type,
    mutable: false,
    valueExpr: init,
    ...listBinding(init),
  });
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'const', type });
  return { name, type, wgslValue: 0, cpuValue: 0, valueExpr: init };
}

type ConstSite = ts.VariableDeclaration | ts.PropertyDeclaration;

function lowerOne(
  decl: ConstSite,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  valueExprs: ReadonlyMap<string, Expr>,
  irName?: string,
): ConstDecl | undefined {
  if (!ts.isIdentifier(decl.name) && !(ts.isPrivateIdentifier(decl.name) && irName !== undefined)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        'Module const must be a simple name.',
        TS_CODES.TOP_LEVEL,
      ),
    );
    return undefined;
  }
  const name = irName ?? (decl.name as ts.Identifier).text;
  if (scope.hasInCurrent(name)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        `Duplicate module const "${name}".`,
        TS_CODES.DUPLICATE_SYMBOL,
      ),
    );
    return undefined;
  }
  if (decl.initializer && isResourceCall(decl.initializer)) return undefined;
  if (!decl.initializer) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" needs an initializer.`,
        TS_CODES.TOP_LEVEL,
      ),
    );
    return undefined;
  }
  const declaredCall = declaredCallIn(decl.initializer, sourceFile);
  if (declaredCall !== undefined) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        declaredCallMessage(decl, declaredCall, sourceFile),
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    refusedDeclarationsOf(scope.calleeTable()).add(name);
    refuseModuleName(sourceFile, name);
    return undefined;
  }
  const mapped = diagnostics.length;
  const writtenType = writtenTypeOf(decl, sourceFile);
  const annotated = writtenType
    ? mapTsTypeToShaderType(writtenType, sourceFile, diagnostics)
    : undefined;
  if (
    refuseOptionalAt(
      annotated,
      writtenType ?? decl,
      'a module constant',
      sourceFile,
      diagnostics,
      authorTypeText,
      (n) => scope.structByName(n),
    )
  ) {
    refusedDeclarationsOf(scope.calleeTable()).add(name);
    refuseModuleName(sourceFile, name);
    return undefined;
  }
  if (writtenType !== undefined && annotated === undefined) {
    if (diagnostics.length > mapped) {
      refusedDeclarationsOf(scope.calleeTable()).add(name);
      refuseModuleName(sourceFile, name);
    }
    return undefined;
  }
  let init: Expr | undefined;
  const list = untypedListOf(decl.initializer, annotated === undefined);
  if (list !== undefined) {
    if (refuseListSpread(list, sourceFile, scope, diagnostics)) return undefined;
    const declared = { said: `Module const "${name}"`, head: `const ${name}`, at: decl };
    init = annotated
      ? lowerArrayLiteral(list, annotated, sourceFile, scope, diagnostics)
      : lowerUntypedList(list, declared, { sourceFile, scope, diagnostics });
  } else {
    const initializer = decl.initializer;
    const lower = (into = diagnostics): Expr | undefined =>
      lowerExpression(initializer, sourceFile, scope, into, annotated);
    if (annotated !== undefined) {
      init = annotated.kind === 'f64' ? scope.withF64ConstPrecision(() => lower()) : lower();
    } else {
      const trial = (typed: boolean) => {
        const messages: TsCompilerDiagnostic[] = [];
        const records = captureExpressionRecords(sourceFile, () =>
          captureValueTypes(() =>
            typed ? scope.withF64ConstPrecision(() => lower(messages)) : lower(messages),
          ),
        );
        return {
          value: records.value.value,
          commit: () => {
            records.commit();
            records.value.commit();
            diagnostics.push(...messages);
          },
          messages,
        };
      };
      const ordinary = trial(false);
      if (ordinary.value?.type.kind === 'f64') {
        init = scope.withF64ConstPrecision(() => lower());
      } else if (ordinary.value === undefined && ordinary.messages.length > 0) {
        const typed = trial(true);
        const selected = typed.value?.type.kind === 'f64' ? typed : ordinary;
        selected.commit();
        init = selected.value;
      } else {
        ordinary.commit();
        init = ordinary.value;
      }
    }
  }
  if (!init) {
    if (diagnostics.some((d) => d.category === 'error')) {
      refusedDeclarationsOf(scope.calleeTable()).add(name);
      refuseModuleName(sourceFile, name);
    }
    return undefined;
  }
  const exportedQuotient =
    pendingKindlessRefusal(init) === 'quotient' &&
    annotated === undefined &&
    typeKey(init.type) === 'f32' &&
    ts.isVariableDeclaration(decl) &&
    exportedConstant(decl);
  if (pendingKindlessRefusal(init) !== undefined && !exportedQuotient) {
    refusedDeclarationsOf(scope.calleeTable()).add(name);
    refuseModuleName(sourceFile, name);
    return undefined;
  }
  if (
    annotated === undefined &&
    kindlessOrigin(init, (n) => scope.resolveIr(n), sourceFile) === 'kindless'
  ) {
    markKindlessModuleConst(sourceFile, name);
  }
  if ((annotated ?? init.type).kind === 'f64') {
    const refuse = (message: string): undefined => {
      diagnostics.push(makeDiagnostic(sourceFile, decl, message, TS_CODES.TYPE_MISMATCH));
      refusedDeclarationsOf(scope.calleeTable()).add(name);
      refuseModuleName(sourceFile, name);
      return undefined;
    };
    if (
      init.type.kind !== 'f64' &&
      (containsCall(init) || (init.type.kind === 'scalar' && init.type.scalar !== 'f32'))
    ) {
      const conversion =
        init.type.kind === 'scalar' && (init.type.scalar === 'i32' || init.type.scalar === 'u32')
          ? 'f64(f32(...))'
          : 'f64(...)';
      return refuse(
        `Module const "${name}" is f64, but its initializer is ${authorTypeText(init.type)}. ` +
          (init.type.kind === 'scalar' && init.type.scalar !== 'bool'
            ? `Cast it, e.g. ${conversion}, or change the annotation.`
            : `Change the annotation to ${authorTypeText(init.type)}.`),
      );
    }
    init = retargetIntLitCtx(init, decl.initializer, f64T);
    const value = foldF64ModuleConst(init, scope);
    if (value === undefined) {
      return refuse(
        `Module const "${name}" must be constant: a scalar literal, a whole earlier module ` +
          `const, or supported scalar arithmetic and math builtins over those with a non-zero ` +
          `divisor. It cannot call a declared function or read a resource, component, field or element.`,
      );
    }
    // Why: these are splitF64's two words; the front end stays independent of the helper library, which builds GPU functions at import time.
    const hi = Math.fround(value);
    const lo = Math.fround(value - hi);
    if (!Number.isFinite(value) || !Number.isFinite(hi) || !Number.isFinite(lo)) {
      return refuse(
        `Module const "${name}" is f64, but its value cannot be represented by two finite f32 words. ` +
          `Use a finite value within the emulated double's f32 range.`,
      );
    }
    scope.define({ kind: 'module', name, type: f64T, mutable: false, constValue: value });
    scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'const', type: f64T });
    return { name, type: f64T, wgslValue: value, cpuValue: value };
  }
  if (annotated !== undefined && (typeKey(annotated) === 'i32' || typeKey(annotated) === 'u32')) {
    noteIntegerRead(decl.initializer, typeKey(annotated) === 'u32' ? 'u32' : 'i32');
  }
  const folded = foldConstValue(init, scope);
  if (typeof folded !== 'number' && typeof folded !== 'boolean') {
    return valueExprConst(name, decl, init, annotated, sourceFile, scope, diagnostics, valueExprs);
  }
  const type = annotated ?? init.type;
  const k = typeKey(type);
  const called = containsCall(init);
  if (called && annotated && typeKey(init.type) !== k) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is ${authorTypeText(type)}, but its initializer is ` +
          `${authorTypeText(init.type)}. ` +
          ((type.kind === 'scalar' && type.scalar !== 'bool') ||
          (type.kind === 'vec' &&
            typeKey(init.type) === type.elem &&
            isFoldableValueExpr(init, scope, valueExprs))
            ? `Cast it, e.g. ${authorTypeText(type)}(...), or change the annotation.`
            : `Change the annotation to ${authorTypeText(init.type)}.`),
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be f32, i32, u32, or bool for now.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  const numeric = typeof folded === 'boolean' ? (folded ? 1 : 0) : folded;
  if (k === 'i32' || k === 'u32') {
    const lo = k === 'i32' ? -2147483648 : 0;
    const hi = k === 'i32' ? 2147483647 : 4294967295;
    if (!Number.isInteger(numeric)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          decl,
          `Module const "${name}" is ${k}, but ${numeric} is not an integer.`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
      return undefined;
    }
    if (numeric < lo || numeric > hi) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          decl,
          `Module const "${name}" is ${k}, but ${numeric} is outside [${lo}, ${hi}].`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
      return undefined;
    }
  }
  if (k === 'bool' && numeric !== 0 && numeric !== 1) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is bool, but ${numeric} is neither true nor false. Write true, false, 1 or 0.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  const value = k === 'f32' ? numeric : k === 'bool' ? numeric : Math.trunc(numeric);
  const abstract =
    hasNoWrittenType(decl, sourceFile) && k === 'f32'
      ? abstractConstFor(
          ts.isPropertyDeclaration(decl) && ts.isClassLike(decl.parent) && decl.parent.name
            ? `${decl.parent.name.text}.${decl.name.getText(sourceFile).replace(/^#/, '')}`
            : decl.name.getText(sourceFile),
          decl.name,
          decl.initializer,
          ts.isPropertyDeclaration(decl) ? 'static' : 'const',
        )
      : undefined;
  if (abstract !== undefined) recordModuleAbstractConst(sourceFile, name, abstract);
  scope.define({
    kind: 'module',
    name,
    type,
    mutable: false,
    constValue: typeof folded === 'boolean' ? folded : value,
    ...(abstract !== undefined ? { abstract } : {}),
  });
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'const', type });
  return called
    ? { name, type, wgslValue: value, cpuValue: value, valueExpr: init }
    : { name, type, wgslValue: value, cpuValue: value };
}
