// Why: WGSL's own name for the space, `private`, is a reserved word in strict mode, so no spelling.

import { logicalTypeKey as typeKey } from './optional.js';
import { moduleIndexConst } from './index-bound.js';
import ts from 'typescript';
import type { Expr, ModuleVarDecl, OverrideDecl, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { structT } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import {
  LoweringScope,
  authorTypeText,
  refuseModuleName,
  refusedDeclarationsOf,
  refusedModuleNames,
} from './context.js';
import { TS_CODES } from './codes.js';
import { mathDeclarationOf } from './math-binding.js';
import { makeDiagnostic } from './diagnostic.js';
import {
  mapTsTypeToShaderType,
  RETIRED_VAR_WRAPPER,
  retiredWrapperMessage,
  writesRefusedType,
} from './type-map.js';
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js';
import { foldConstComponents } from './loop-bound.js';
import { isIntegerLiteralTree, reportIntLitRange, retargetDeclaredIntLit } from './lit-coerce.js';
import { hasNoWrittenType, moduleAbstractConst } from './abstract-const.js';
import { useInferenceActive, type InferredValue } from './use-inference.js';
import { lowerExpression } from './lower/expression.js';
import { lowerArrayLiteral, refuseListSpread } from './lower/expression-array.js';
import { isOverrideType } from './overrides.js';
import { inferredModuleValue } from './module-vars/inferred-value.js';
import { lowerModuleLetList } from './module-vars/untyped-list.js';
import { listValueOf } from './lower/expression-array/list-values.js';
import {
  declaredCallIn,
  isFoldableConstExpr,
  staticConstName,
  writtenModuleName,
} from './module-const.js';
import { eachNamespaceStatement } from './namespaces.js';
import {
  emittedMemberName,
  holdsFunction,
  isStaticMember,
  shadowedStaticFields,
  writtenMemberName,
  writtenStaticFields,
} from './class-names.js';
import type { ScopedConst } from './lower/function-signature.js';
import { refuseOptionalAt, type StructLookup } from './optional.js';

const WRAPPERS: Readonly<Record<string, ModuleVarDecl['space']>> = {
  workgroup: 'workgroup',
};

export function moduleVarSpace(type: ts.TypeNode | undefined): ModuleVarDecl['space'] | undefined {
  if (type === undefined || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return undefined;
  }
  return WRAPPERS[type.typeName.text];
}

const diag = (sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic =>
  makeDiagnostic(sourceFile, node, message, TS_CODES.MODULE_VAR);

function holdsAtomic(
  type: ShaderType,
  structs: StructLookup,
  seen: Set<string> = new Set(),
): boolean {
  if (type.kind === 'atomic') return true;
  if (type.kind === 'array') return holdsAtomic(type.elem, structs, seen);
  if (type.kind !== 'struct' || seen.has(type.name)) return false;
  seen.add(type.name);
  return (structs(type.name)?.fields ?? []).some((field) => holdsAtomic(field.type, structs, seen));
}

function typeRefusal(t: ShaderType, space: ModuleVarDecl['space']): string | undefined {
  if (
    t.kind === 'texture' ||
    t.kind === 'sampler' ||
    t.kind === 'storage-texture' ||
    t.kind === 'depth-texture' ||
    t.kind === 'sampler-comparison'
  ) {
    const shown =
      t.kind === 'storage-texture'
        ? 'storage texture'
        : t.kind === 'depth-texture'
          ? 'depth texture'
          : t.kind === 'sampler-comparison'
            ? 'comparison sampler'
            : t.kind;
    return `a ${shown} is a resource, declared bare with "declare const"`;
  }
  if (t.kind === 'array' && t.size === undefined) {
    return 'a runtime-sized array lives in a storage binding only; give this one a size, array<f32, 64>';
  }
  if (t.kind === 'array') return typeRefusal(t.elem, space);
  if (space === 'private' && holdsAtomic(t, structsHere)) {
    return 'an atomic lives in storage or workgroup memory, not in a per-invocation variable';
  }
  return undefined;
}

let structsHere: StructLookup = () => undefined;

function typeOf(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  sizeOverrides: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  > = new Map(),
): ShaderType | undefined {
  const before = diagnostics.length;
  const mapped = mapTsTypeToShaderType(node, sourceFile, diagnostics, sizeOverrides);
  if (
    refuseOptionalAt(
      mapped,
      node,
      'a module variable',
      sourceFile,
      diagnostics,
      authorTypeText,
      structsHere,
    )
  )
    return undefined;
  if (mapped !== undefined || diagnostics.length > before) return mapped;
  return ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    !writesRefusedType(node, sourceFile)
    ? structT(node.typeName.text)
    : undefined;
}

const retiredWrapperArg = (type: ts.TypeNode, sourceFile: ts.SourceFile): string | undefined =>
  ts.isTypeReferenceNode(type) &&
  ts.isIdentifier(type.typeName) &&
  type.typeName.text === RETIRED_VAR_WRAPPER
    ? (type.typeArguments?.[0]?.getText(sourceFile) ?? 'T')
    : undefined;

const resourceWrapperOf = (type: ts.TypeNode | undefined): string | undefined =>
  type !== undefined &&
  ts.isTypeReferenceNode(type) &&
  ts.isIdentifier(type.typeName) &&
  (type.typeName.text === 'uniform' || type.typeName.text === 'storage')
    ? type.typeName.text
    : undefined;

export function collectModuleVars(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  consts: readonly ScopedConst[] = [],
  structs: readonly StructDecl[] = [],
  overrides: readonly OverrideDecl[] = [],
): ModuleVarDecl[] {
  const out: ModuleVarDecl[] = [];
  const seen = new Set<string>();
  const scope = new LoweringScope(undefined, undefined);
  const sizeOverrides = new Map(
    overrides.map((override) => [
      override.name,
      { type: override.type, default: override.default },
    ]),
  );
  scope.setStructs(structs);
  structsHere = (n) => scope.structByName(n);
  for (const refused of refusedModuleNames(sourceFile)) {
    refusedDeclarationsOf(scope.calleeTable()).add(refused);
  }
  for (const c of consts) {
    scope.define({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      constValue: c.type.kind === 'scalar' ? c.cpuValue : undefined,
      indexConstValue: moduleIndexConst(c, scope),
      ...(moduleAbstractConst(sourceFile, c.name) !== undefined
        ? { abstract: moduleAbstractConst(sourceFile, c.name) }
        : {}),
      ...(c.type.kind !== 'scalar' && c.valueExpr !== undefined ? { valueExpr: c.valueExpr } : {}),
    });
  }
  const writtenStatics = writtenStaticFields(sourceFile);
  const classes: ts.ClassDeclaration[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt) => {
    if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) classes.push(stmt);
  });
  for (const cls of classes) {
    const owner = cls.name!.text;
    const shadowed = shadowedStaticFields(cls);
    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member) || !isStaticMember(member)) continue;
      if (holdsFunction(member)) continue;
      if (shadowed.has(member)) continue;
      const written = writtenMemberName(member.name);
      if (written === undefined || !writtenStatics.has(`${owner}.${written}`)) continue;
      const name = staticConstName(owner, emittedMemberName(written));
      scope.setStaticClass(owner);
      const one = lowerPlain(member, name, sourceFile, scope, diagnostics);
      scope.setStaticClass(undefined);
      if (!one) continue;
      if (seen.has(one.name)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member.name,
            `Duplicate module variable "${one.name}".`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        );
        continue;
      }
      seen.add(one.name);
      out.push(one);
      recordDeclaration(symbols, sourceFile, member.name, {
        name: one.name,
        kind: 'binding',
        type: one.type,
        mutable: true,
      });
    }
  }
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet) continue;
    for (const decl of stmt.declarationList.declarations) {
      const wrapper = moduleVarSpace(decl.type);
      if (isConst) {
        if (wrapper === undefined) continue;
        const shown = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sourceFile);
        diagnostics.push(
          diag(
            sourceFile,
            decl,
            `"${shown}" is a module variable and is declared with let, not const: ` +
              `let ${shown}: workgroup<T>. A const is a module constant (§12).`,
          ),
        );
        continue;
      }
      if (isOverrideType(decl.type)) continue;
      if (
        decl.initializer !== undefined &&
        (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
      ) {
        continue;
      }
      const overMath = mathDeclarationOf(decl, sourceFile);
      if (overMath !== undefined && overMath.refusals.length > 0) {
        diagnostics.push(...overMath.refusals);
        for (const refused of overMath.names) {
          refusedDeclarationsOf(scope.calleeTable()).add(refused);
          refuseModuleName(sourceFile, refused);
        }
        continue;
      }
      if (!ts.isIdentifier(decl.name)) {
        diagnostics.push(
          diag(
            sourceFile,
            decl.name,
            `A module variable is one name with one type, let name: T = init; ` +
              `"${decl.name.getText(sourceFile)}" has no shader form.`,
          ),
        );
        continue;
      }
      const name = decl.name.text;
      const one =
        wrapper !== undefined && decl.type !== undefined
          ? lowerWrapped(
              decl,
              decl.type,
              name,
              wrapper,
              sourceFile,
              scope,
              diagnostics,
              sizeOverrides,
            )
          : lowerPlain(decl, name, sourceFile, scope, diagnostics);
      if (!one) continue;
      if (seen.has(one.name)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            decl.name,
            `Duplicate module variable "${one.name}".`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        );
        continue;
      }
      seen.add(one.name);
      out.push(one);
      recordDeclaration(symbols, sourceFile, decl.name, {
        name: one.name,
        kind: 'binding',
        type: one.type,
        mutable: true,
      });
    }
  }
  return out;
}

export type VarSite = ts.VariableDeclaration | ts.PropertyDeclaration;

function lowerWrapped(
  decl: ts.VariableDeclaration,
  wrapper: ts.TypeNode,
  name: string,
  space: ModuleVarDecl['space'],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  sizeOverrides: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ModuleVarDecl | undefined {
  const word = 'workgroup';
  const inner = ts.isTypeReferenceNode(wrapper) ? wrapper.typeArguments?.[0] : undefined;
  if (inner === undefined) {
    diagnostics.push(diag(sourceFile, wrapper, `${word}<T> needs a type argument.`));
    return undefined;
  }
  const type = typeOf(inner, sourceFile, diagnostics, sizeOverrides);
  if (!type) return undefined;
  const symbolicSizes = symbolicArraySizes(type);
  if (
    symbolicSizes.length > 0 &&
    (space !== 'workgroup' ||
      type.kind !== 'array' ||
      type.sizeOverride === undefined ||
      symbolicSizes.length !== 1)
  ) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        inner,
        'An override-sized array is supported only as the outer array of a workgroup variable, ' +
          'for example workgroup<array<f32, WG_SIZE>>.',
        TS_CODES.UNSUPPORTED,
      ),
    );
    return undefined;
  }
  const asPrivate =
    typeRefusal(type, 'private') === undefined ? inner.getText(sourceFile) : undefined;
  return finish(
    decl,
    inner,
    name,
    space,
    type,
    `a ${word}<${authorTypeText(type)}>`,
    asPrivate,
    sourceFile,
    scope,
    diagnostics,
  );
}

function symbolicArraySizes(type: ShaderType): string[] {
  if (type.kind !== 'array') return [];
  return [
    ...(type.sizeOverride === undefined ? [] : [type.sizeOverride]),
    ...symbolicArraySizes(type.elem),
  ];
}

function declaredResourceText(type: ts.TypeNode, sourceFile: ts.SourceFile): string {
  const written = type.getText(sourceFile);
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return written;
  const args = type.typeArguments;
  if (args === undefined || args.length === 0) return `${type.typeName.text}<...>`;
  if (type.typeName.text !== 'storage') return written;
  if (args.length !== 1) return written;
  return `storage<${args[0].getText(sourceFile)}, "read_write">`;
}

function spreadRefused(
  decl: VarSite,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  return (
    decl.initializer !== undefined &&
    ts.isArrayLiteralExpression(decl.initializer) &&
    refuseListSpread(decl.initializer, sourceFile, scope, diagnostics)
  );
}

function lowerPlain(
  decl: VarSite,
  name: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): ModuleVarDecl | undefined {
  if (decl.initializer !== undefined && declaredCallIn(decl.initializer, sourceFile)) {
    diagnostics.push(
      diag(sourceFile, decl.initializer, notConstantMessage(decl, decl.initializer, sourceFile)),
    );
    refuse(name, sourceFile, scope);
    return undefined;
  }
  const projected =
    decl.type !== undefined &&
    decl.initializer !== undefined &&
    (isIntegerLiteralTree(decl.initializer) || ts.isArrayLiteralExpression(decl.initializer)) &&
    hasNoWrittenType(decl, sourceFile);
  if (decl.type !== undefined && !projected) {
    const retired = retiredWrapperArg(decl.type, sourceFile);
    if (retired !== undefined) {
      diagnostics.push(
        diag(
          sourceFile,
          decl.type,
          retiredWrapperMessage(`Drop the wrapper and write let ${name}: ${retired}.`),
        ),
      );
      return undefined;
    }
    const resource = resourceWrapperOf(decl.type);
    if (resource !== undefined) {
      diagnostics.push(
        diag(
          sourceFile,
          decl,
          `"${name}" is a ${resource} binding the host provides, and needs declare: write ` +
            `"declare const ${name}: ${declaredResourceText(decl.type, sourceFile)}".`,
        ),
      );
      return undefined;
    }
    const before = diagnostics.length;
    const type = typeOf(decl.type, sourceFile, diagnostics);
    if (!type) {
      if (diagnostics.length > before) refuse(name, sourceFile, scope);
      return undefined;
    }
    if (spreadRefused(decl, sourceFile, scope, diagnostics)) return undefined;
    return finish(
      decl,
      decl.type,
      name,
      'private',
      type,
      authorTypeText(type),
      undefined,
      sourceFile,
      scope,
      diagnostics,
    );
  }
  if (decl.initializer === undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        decl,
        `"${name}" needs a type or an initializer: let ${name}: f32, or let ${name} = 0.`,
      ),
    );
    return undefined;
  }
  if (ts.isArrayLiteralExpression(decl.initializer) && ts.isVariableDeclaration(decl)) {
    const init = lowerModuleLetList(decl, decl.initializer, name, sourceFile, scope, diagnostics);
    if (init === undefined) {
      if (diagnostics.some((d) => d.category === 'error')) refuse(name, sourceFile, scope);
      return undefined;
    }
    const one = finish(
      decl,
      decl,
      name,
      'private',
      init.type,
      authorTypeText(init.type),
      undefined,
      sourceFile,
      scope,
      diagnostics,
      init,
    );
    const inferred = listValueOf(init);
    if (one !== undefined && inferred !== undefined) inferredVars.set(one, inferred);
    return one;
  }
  const inferred =
    useInferenceActive(sourceFile) && isIntegerLiteralTree(decl.initializer)
      ? inferredModuleValue(decl, name, sourceFile, diagnostics)
      : undefined;
  if (inferred?.type !== undefined) {
    const one = finish(
      decl,
      decl,
      name,
      'private',
      inferred.type,
      authorTypeText(inferred.type),
      undefined,
      sourceFile,
      scope,
      diagnostics,
    );
    if (one !== undefined) inferredVars.set(one, inferred);
    return one;
  }
  const before = diagnostics.length;
  const init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics);
  if (!init) {
    refuseIfSilent(name, before, sourceFile, scope, diagnostics);
    return undefined;
  }
  const one = finish(
    decl,
    decl,
    name,
    'private',
    init.type,
    authorTypeText(init.type),
    undefined,
    sourceFile,
    scope,
    diagnostics,
    init,
  );
  if (one !== undefined && inferred !== undefined) inferredVars.set(one, inferred);
  return one;
}

const inferredVars = new WeakMap<ModuleVarDecl, InferredValue>();

export function inferredModuleVar(v: ModuleVarDecl): InferredValue | undefined {
  return inferredVars.get(v);
}

function finish(
  decl: VarSite,
  typeNode: ts.Node,
  name: string,
  space: ModuleVarDecl['space'],
  type: ShaderType,
  shown: string,
  asPrivate: string | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  lowered?: Expr,
): ModuleVarDecl | undefined {
  const refusal = typeRefusal(type, space);
  if (refusal !== undefined) {
    diagnostics.push(diag(sourceFile, typeNode, `"${name}" cannot be ${shown}: ${refusal}.`));
    refuse(name, sourceFile, scope);
    return undefined;
  }
  if (decl.initializer === undefined) return { name, space, type };
  if (space === 'workgroup') {
    const move =
      asPrivate === undefined ? '' : `, or make it per-invocation: let ${name}: ${asPrivate}`;
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" is workgroup memory and takes no initializer: it is zero at the start of ` +
          `each workgroup. Assign it inside the entry${move}.`,
      ),
    );
    return undefined;
  }
  const before = diagnostics.length;
  let init: Expr | undefined =
    lowered ??
    (ts.isArrayLiteralExpression(decl.initializer)
      ? lowerArrayLiteral(decl.initializer, type, sourceFile, scope, diagnostics)
      : lowerExpression(decl.initializer, sourceFile, scope, diagnostics, type));
  if (!init) {
    refuseIfSilent(name, before, sourceFile, scope, diagnostics);
    return undefined;
  }
  init = retargetDeclaredIntLit(init, decl.initializer, type);
  init = reportIntLitRange(init, decl.initializer, type, sourceFile, diagnostics) ?? init;
  if (typeKey(init.type) !== typeKey(type)) {
    diagnostics.push(
      diag(
        sourceFile,
        decl.initializer,
        `"${name}" is declared ${authorTypeText(type)} but its initializer is ${authorTypeText(init.type)}.`,
      ),
    );
    return undefined;
  }
  const folds =
    (init.op === 'lit' && typeof init.value === 'boolean') ||
    foldConstComponents(init, scope) !== undefined ||
    isFoldableConstExpr(init, scope);
  if (!folds) {
    diagnostics.push(
      diag(sourceFile, decl.initializer, notConstantMessage(decl, decl.initializer, sourceFile)),
    );
    refuse(name, sourceFile, scope);
    return undefined;
  }
  return { name, space, type, init };
}

const notConstantMessage = (
  decl: VarSite,
  init: ts.Expression,
  sourceFile: ts.SourceFile,
): string =>
  `"${writtenModuleName(decl, sourceFile)}" needs a constant initializer (a literal, a module ` +
  `const, arithmetic or a math builtin over those); "${init.getText(sourceFile)}" is not one. ` +
  `Assign it inside the entry.`;

function refuse(name: string, sourceFile: ts.SourceFile, scope: LoweringScope): void {
  refusedDeclarationsOf(scope.calleeTable()).add(name);
  refuseModuleName(sourceFile, name);
}

function refuseIfSilent(
  name: string,
  before: number,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: readonly TsCompilerDiagnostic[],
): void {
  if (diagnostics.length === before && diagnostics.some((d) => d.category === 'error')) {
    refuse(name, sourceFile, scope);
  }
}
