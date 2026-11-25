// Implements: Rule 2.3, Rule 8.3 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { sharedObjects } from '../object-share.js';
import { reassignedObjects } from '../object-share/reassigned.js';
import { isBarrierIntrinsic } from '../../../core/intrinsics.js';
import type {
  BindingDecl,
  Expr,
  FuncDecl,
  ModuleVarDecl,
  OverrideDecl,
  Stmt,
} from '../../../core/ir/nodes.js';
import { setParameterLocals } from '../../../core/ir/parameter-locals.js';
import type { SourceSpan } from '../../../core/ir/span.js';
import { f32T, structT, voidT, type ShaderType } from '../../../core/ir/types.js';
import { guardKernelBody } from '../../../core/passes/kernel-stores.js';
import { alwaysReturns } from '../../../core/passes/lint/rules/all-paths-return.js';
import {
  hasNoWrittenResult,
  isIntegerWrittenRead,
  moduleAbstractConst,
  noteCarriedReturn,
  unpeekedReads,
} from '../abstract-const.js';
import {
  buildsCallerClass,
  emittedMemberName,
  holdsFunction,
  staticFieldDeclarations,
} from '../class-names.js';
import { TS_CODES, type TsCode } from '../codes.js';
import {
  LoweringScope,
  THIS_CAPTURE,
  authorTypeText,
  fileFunctionsOf,
  recoveredUsesDroppedSoFar,
  refusedDeclarationsOf,
  refusedModuleNames,
  writeRules,
  type CaptureKey,
} from '../context.js';
import {
  privateFieldTableOf,
  readonlyFieldTableOf,
  restrictedFieldTableOf,
  withheldTableOf,
} from '../context/field-tables.js';
import { checkDefiniteAssignment } from '../definite.js';
import {
  diagnosticAtSpan,
  keepUses,
  makeDiagnostic,
  noteCycleMembers,
  noteUse,
} from '../diagnostic.js';
import { calleeNamesOf } from '../function-call-graph.js';
import { instanceUsesOf } from '../generic-structs.js';
import { currentTypeArguments, instanceName, withTypeArguments } from '../generics.js';
import { hostExportedDeclarations } from '../host-exports.js';
import { moduleIndexConst } from '../index-bound.js';
import { kernelSourceNames, type KernelNames } from '../kernel-loops.js';
import { isIntegerLiteralTree, reportIntLitRange, retargetIntLitCtx } from '../lit-coerce.js';
import { isMixinDeclaration } from '../mixins.js';
import { staticConstName, writtenConstNames } from '../module-const.js';
import { moduleVarSourceName } from '../module-var-names.js';
import { inferredModuleVar } from '../module-vars.js';
import {
  eachNamespaceStatement,
  namespaceMemberName,
  recordLocalFunction,
  recordNamespaceFunction,
  recordTemplateInstance,
  refuseNamespaceStatement,
  writtenFunctionOf,
} from '../namespaces.js';
import { absentOf, isOptional, optionalInner, logicalTypeKey as typeKey } from '../optional.js';
import {
  checkLoweredRecursion,
  checkRecursion,
  writtenHops,
  type RecursionNode,
} from '../recursion.js';
import { variableRefused } from '../refused-names.js';
import { isAsyncOrGenerator, isVarStatement, refusalWithin } from '../semantic.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { spanOf, withSpan } from '../span.js';
import { stageCallOf, stageCallOfDeclaration, stageDeclarationOf } from '../stage-call.js';
import { checkEntryStageUses } from '../stage-restrictions.js';
import { isInferredStorageAccess } from '../storage-access.js';
import { type CollectedStruct } from '../structs.js';
import {
  recordDeclaration,
  recordInferredReturn,
  recordResultCopies,
  type DeclaredSymbolSink,
} from '../symbols.js';
import {
  askedOf,
  calleeKeyOf,
  currentCopy,
  homeTagOf,
  inCopy,
  isCallerDecided,
  noteCallerDecided,
  readsUndecided,
  registerCallerDecided,
  setHomeTag,
  useInferenceActive,
} from '../use-inference.js';
import {
  classFunctionOf,
  collectClassFunctions,
  ctorParts,
  ctorPrologue,
  registerClassCopy,
  selfRef,
  type ClassFunction,
  type Receiver,
} from './class-methods.js';
import { closureUse, declarationOf } from './closures.js';
import { valueExprBinding } from './expression-array/list-values.js';
import { lowerExpression } from './expression.js';
import { argumentSignature, capturesOfArgument, functionArgument } from './function-args.js';
import {
  type FunctionNode,
  type ScopedConst,
  decoratorsOf,
  parseSignature,
  settleInferredEntryResult,
} from './function-signature.js';
import { functionParams, functionTypeOf, shapeOf, type FunctionShape } from './function-types.js';
import { inlineKernelMethods, type KernelInlineGap } from './kernel-methods.js';
import { countPushedLengths, pushedParams } from './kernel-push.js';
import {
  captureArguments,
  captureBindings,
  capturedName,
  collectLocalFunctions,
  declarationsIn,
  declaresFunction,
  liftCaptures,
  propagateCaptureRefs,
  type CaptureBinding,
  type Lifted,
  type LiftedThis,
  type LocalFunction,
  type LocalFunctionDecl,
} from './local-functions.js';
import { bodyReturnsAbsence, recordedValueType } from './optional-values.js';
import {
  filledCallsOf,
  paramDefaultNodes,
  recordParamDefaults,
  setParamDefault,
} from './param-defaults.js';
import { checkReferenceAliases } from './references.js';
import { deferRefusal, resolvePendingShares } from './pending-shares.js';
import { lowerStatements, lowerVoidArrowBody } from './statement.js';
import {
  decidedResultMismatch,
  newlineReturnRemedy,
  collectReturns,
  skipParens,
} from './function/return-checks.js';
import { arrayLengthParameters, typeArgumentsFor } from './function/type-arguments.js';
import { settleMadeArray } from './made-array/settle.js';
import { pushDiag } from './push-diag.js';
export { pushDiag };
export { FRAGMENT_ONLY_CALLS, FRAGMENT_OR_COMPUTE_CALLS } from '../stage-restrictions.js';
export {
  type F64IoPlace,
  type FunctionNode,
  type KernelWorkgroupAttr,
  type ScopedConst,
  hasRefusedIoParam,
  parseParams,
  parseReturnType,
  parseSignature,
  refuseF64EntryIo,
} from './function-signature.js';

function writtenModuleNames(
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): Pick<KernelNames, 'values' | 'functions'> {
  const functions = new Map<string, string>();
  const values = new Map<string, string>();
  for (const [emitted, decl] of scope.calleeTable()) {
    const written = classFunctionOf(decl)?.shown ?? writtenFunctionOf(decl);
    if (written !== undefined && written !== emitted) functions.set(emitted, written);
  }
  for (const [field, decl] of staticFieldDeclarations(sourceFile)) {
    if (holdsFunction(decl)) continue;
    const dot = field.indexOf('.');
    const member = emittedMemberName(field.slice(dot + 1));
    const name = staticConstName(field.slice(0, dot), member);
    values.set(scope.resolveModuleValue(name)?.irName ?? name, field);
  }
  for (const [emitted, written] of writtenConstNames(sourceFile)) values.set(emitted, written);
  return { values, functions };
}

function classSelf(cf: ClassFunction): LiftedThis | undefined {
  return cf.receiver !== undefined
    ? {
        receiver: {
          type: cf.receiver.type,
          mode: cf.receiver.mode === 'param' ? 'param' : 'inout',
          superMethods: cf.receiver.superMethods,
        },
        bindsThis: true,
        shown: cf.shown,
      }
    : cf.staticOwner !== undefined
      ? {
          staticOwner: cf.staticOwner,
          staticSuper: cf.staticSuper,
          bindsThis: true,
          shown: cf.shown,
        }
      : undefined;
}

export function lowerSourceFunctions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  consts: readonly ScopedConst[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly CollectedStruct[] = [],
  symbols?: DeclaredSymbolSink,
  overrides: readonly OverrideDecl[] = [],
  vars: readonly ModuleVarDecl[] = [],
): FuncDecl[] {
  const decls: { node: ts.FunctionDeclaration; irName: string | undefined; prefix: string }[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, diagnostics, (stmt, prefix) => {
    const sc = stageCallOf(stmt);
    if (sc !== undefined) {
      const node = stageDeclarationOf(sc);
      decls.push({
        node,
        irName: prefix === '' ? undefined : namespaceMemberName(prefix, sc.declaration.name.text),
        prefix,
      });
      return;
    }
    if (!ts.isFunctionDeclaration(stmt)) {
      if (
        prefix !== '' &&
        !isNamespaceConst(stmt) &&
        !ts.isClassDeclaration(stmt) &&
        !ts.isInterfaceDeclaration(stmt) &&
        !(ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) &&
        !(ts.isVariableStatement(stmt) && isVarStatement(stmt))
      ) {
        refuseNamespaceStatement(stmt, prefix, sourceFile, diagnostics);
      }
      return;
    }
    if (isMixinDeclaration(stmt)) return;
    decls.push({
      node: stmt,
      irName: prefix === '' ? undefined : namespaceMemberName(prefix, stmt.name?.text ?? ''),
      prefix,
    });
  });
  const implemented = new Set<string>();
  for (const { node, irName } of decls) {
    if (node.body && node.name) implemented.add(irName ?? node.name.text);
  }
  const isAmbient = (node: ts.FunctionDeclaration): boolean =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
  const callees = new Map<string, FuncDecl>();
  const fns = fileFunctionsOf(callees);
  const refused = fns.refused;
  const generics = new Map<string, { node: ts.FunctionDeclaration; prefix: string }>();
  const ready: { node: ts.FunctionDeclaration; stub: FuncDecl; prefix: string }[] = [];
  for (const { node: stmt, irName, prefix } of decls) {
    if (
      !stmt.body &&
      stmt.name !== undefined &&
      !isAmbient(stmt) &&
      implemented.has(irName ?? stmt.name.text)
    ) {
      continue;
    }
    if (isAsyncOrGenerator(stmt)) {
      refused.add(irName ?? stmt.name?.text ?? '');
      continue;
    }
    const fnAt = functionParams(stmt);
    if (
      ((stmt.typeParameters?.length ?? 0) > 0 || fnAt.size > 0) &&
      stmt.body &&
      stmt.name !== undefined
    ) {
      const base = irName ?? stmt.name.text;
      const isEntry = decoratorsOf(stmt).length > 0 || stageCallOfDeclaration(stmt) !== undefined;
      if (isEntry && (stmt.typeParameters?.length ?? 0) > 0) {
        pushDiag(
          diagnostics,
          sourceFile,
          stmt.typeParameters![0]!,
          `"${stmt.name.text}" is an entry, which the pipeline calls with no type arguments, so ` +
            `a generic entry has no instance to compile: write its types out, or move the ` +
            `generic code into a helper the entry calls (Rule 8.9).`,
          TS_CODES.FUNCTION_SHAPE,
        );
        refused.add(base);
        continue;
      }
      if (fnAt.size > 0 && isEntry) {
        pushDiag(
          diagnostics,
          sourceFile,
          stmt.parameters[[...fnAt][0]!]!,
          `An entry's parameters come from the pipeline, and a function is nothing the pipeline ` +
            `can supply: take the function in a helper the entry calls (Rule 8.18).`,
          TS_CODES.FUNCTION_SHAPE,
        );
        refused.add(base);
        continue;
      }
      const lengths = arrayLengthParameters(stmt);
      if (lengths.length > 0) {
        pushDiag(
          diagnostics,
          sourceFile,
          lengths[0]!,
          `"${stmt.name.text}" uses ${lengths.map((p) => `"${p.name.text}"`).join(' and ')} ` +
            `as an array length, but generic parameters name types, not lengths (Rule 8.9). ` +
            `Write a helper for each fixed length, or export a kernel taking an unsized array and a separate size argument.`,
          TS_CODES.UNKNOWN_TYPE,
        );
        refused.add(base);
        continue;
      }
      generics.set(base, { node: stmt, prefix });
      fns.generics.add(base);
      if (fnAt.size > 0) fns.fnParams.set(base, fnAt);
      continue;
    }
    const stub = parseSignature(
      stmt,
      sourceFile,
      diagnostics,
      structs,
      irName,
      undefined,
      consts,
      overrides,
    );
    if (!stub) {
      refused.add(irName ?? stmt.name?.text ?? '');
      if (stmt.name !== undefined) refused.add(stmt.name.text);
      continue;
    }
    if (callees.has(stub.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        stmt,
        `Duplicate function "${stub.name}".`,
        TS_CODES.DUPLICATE_SYMBOL,
      );
      continue;
    }
    callees.set(stub.name, stub);
    if (prefix !== '') recordNamespaceFunction(stub, stmt);
    ready.push({ node: stmt, stub, prefix });
  }
  const classFns = collectClassFunctions(structs, sourceFile, diagnostics, refused).filter((cf) => {
    const taken = callees.get(cf.stub.name);
    if (taken !== undefined) {
      const at = cf.node ?? cf.struct.members?.node ?? sourceFile;
      pushDiag(
        diagnostics,
        sourceFile,
        at,
        `"${cf.stub.name}" is both the function "${taken.name}" and the emitted name of ` +
          `"${cf.shown}"; rename one of them.`,
        TS_CODES.DUPLICATE_SYMBOL,
      );
      return false;
    }
    callees.set(cf.stub.name, cf.stub);
    return true;
  });
  const lifted: Lifted[] = [];
  const aliasesOf = new Map<string, Map<string, string>>();
  const localTemplates = new Map<string, { fn: LocalFunction; self: LiftedThis | undefined }>();
  const seeLocals = (
    decls: readonly LocalFunctionDecl[],
    ownerName: string,
    around: ReadonlyMap<ts.Node, FuncDecl>,
    self: LiftedThis | undefined,
    outer: ReadonlyMap<string, string>,
    into: Lifted[] = lifted,
    said: TsCompilerDiagnostic[] = diagnostics,
  ): void => {
    const found = collectLocalFunctions(decls, ownerName, sourceFile, said, structs, refused);
    const alias = new Map(outer);
    const kept: LocalFunction[] = [];
    for (const fn of found) {
      if (fn.takesFunctions !== undefined) {
        alias.set(fn.localName, fn.stub.name);
        fns.generics.add(fn.stub.name);
        fns.fnParams.set(fn.stub.name, fn.takesFunctions);
        const selfHere =
          self === undefined
            ? undefined
            : { ...self, bindsThis: self.bindsThis && ts.isArrowFunction(fn.node) };
        localTemplates.set(fn.stub.name, { fn, self: selfHere });
        continue;
      }
      if (callees.has(fn.stub.name)) {
        pushDiag(
          said,
          sourceFile,
          fn.decl,
          `"${fn.stub.name}" is both a function of this module and the emitted name of the ` +
            `local "${fn.localName}"; rename one of them.`,
          TS_CODES.DUPLICATE_SYMBOL,
        );
        continue;
      }
      callees.set(fn.stub.name, fn.stub);
      alias.set(fn.localName, fn.stub.name);
      kept.push(fn);
    }
    aliasesOf.set(ownerName, alias);
    for (const fn of kept) {
      const selfHere =
        self === undefined
          ? undefined
          : { ...self, bindsThis: self.bindsThis && ts.isArrowFunction(fn.node) };
      into.push({ fn, around, self: selfHere, ...(said !== diagnostics ? { said } : {}) });
      if (fn.node.body !== undefined) {
        seeLocals(
          declarationsIn(fn.node.body),
          fn.stub.name,
          new Map([...around, [fn.node, fn.stub]]),
          selfHere,
          alias,
          into,
          said,
        );
      }
    }
  };
  const topDecls = new Map<string, ts.VariableDeclaration[]>();
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    if (!ts.isVariableStatement(stmt)) return;
    const into = topDecls.get(prefix) ?? [];
    into.push(...stmt.declarationList.declarations);
    topDecls.set(prefix, into);
  });
  for (const [prefix, decls] of topDecls) seeLocals(decls, prefix, new Map(), undefined, new Map());
  for (const { node, stub } of ready) {
    if (node.body) {
      seeLocals(
        declarationsIn(node.body),
        stub.name,
        new Map([[node, stub]]),
        undefined,
        new Map(),
      );
    }
  }
  const inheritedSaid: { cf: ClassFunction; said: TsCompilerDiagnostic[] }[] = [];
  const saidOf = new Map<ClassFunction, TsCompilerDiagnostic[]>();
  const saidFor = (cf: ClassFunction): TsCompilerDiagnostic[] => {
    if (cf.inherited !== true) return diagnostics;
    let said = saidOf.get(cf);
    if (said === undefined) {
      said = [];
      saidOf.set(cf, said);
      inheritedSaid.push({ cf, said });
    }
    return said;
  };
  for (const cf of classFns) {
    if (cf.node?.body && cf.takesFunctions === undefined) {
      const self = classSelf(cf);
      seeLocals(
        declarationsIn(cf.node.body),
        cf.stub.name,
        new Map([[cf.node, cf.stub]]),
        self,
        new Map(),
        lifted,
        saidFor(cf),
      );
    }
  }
  const file = fileFunctionsOf(callees);
  liftCaptures(lifted, callees, file);
  const funcs: FuncDecl[] = [];
  const nodeByName = new Map<string, FunctionNode>();
  const writtenAs = new Map<string, string>();
  const pendingFill = new Map<FuncDecl, () => boolean>();
  const inferring = new Set<FuncDecl>();
  const filling: FuncDecl[] = [];
  const unsaid = new Set<FuncDecl>();
  const cyclic = new Set<FuncDecl>();
  const cycleAt = new Set<ts.Node>();
  const cycleNotes: { diagnostic: TsCompilerDiagnostic; path: readonly FuncDecl[] }[] = [];
  let bodiesOpen = false;
  const shownOf = (f: FuncDecl): string =>
    writtenAs.get(f.name) ?? classFns.find((cf) => cf.stub === f)?.shown ?? f.name;
  const track = (
    stub: FuncDecl,
    infers: boolean,
    said: readonly TsCompilerDiagnostic[],
    node: ts.Node,
    run: () => void,
  ): void => {
    const before = said.length;
    const droppedBefore = recoveredUsesDroppedSoFar();
    filling.push(stub);
    if (infers) inferring.add(stub);
    try {
      run();
    } finally {
      filling.pop();
      inferring.delete(stub);
    }
    if (
      infers &&
      (cyclic.has(stub) ||
        (typeKey(stub.ret) === 'void' &&
          (said.slice(before).some((d) => d.category === 'error') || refusalWithin(node))))
    ) {
      unsaid.add(stub);
    }
    if (infers && typeKey(stub.ret) === 'void' && recoveredUsesDroppedSoFar() > droppedBefore) {
      unsaid.add(stub);
    }
  };
  const runPending = (stub: FuncDecl): boolean => {
    const fill = pendingFill.get(stub);
    if (fill === undefined) return true;
    pendingFill.delete(stub);
    if (fill()) return true;
    pendingFill.set(stub, fill);
    return false;
  };
  const recursionGraph = (): RecursionNode[] => [
    ...ready.map(({ node, stub }) => ({
      name: stub.name,
      decl: node,
      sourceFile,
      resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
      filled: filledCallsOf(stub),
    })),
    ...classFns.flatMap((cf) =>
      cf.node === undefined
        ? []
        : [
            {
              name: cf.stub.name,
              shown: cf.shown,
              decl: cf.node,
              sourceFile,
              resolve: (callee: string) => (callees.has(callee) ? callee : undefined),
              filled: filledCallsOf(cf.stub),
            },
          ],
    ),
  ];
  fns.ensure = (decl, at, sf, diags): boolean => {
    if (pendingFill.has(decl)) {
      if (!bodiesOpen) {
        pushDiag(
          diags,
          sf,
          at,
          `"${shownOf(decl)}" says what it returns in its body, and a default is lowered ` +
            `before any body: write the return type on "${shownOf(decl)}" (Rule 8.19).`,
          TS_CODES.FUNCTION_SHAPE,
        );
        return false;
      }
      if (!runPending(decl)) {
        if (![...diagnostics, ...diags].some((d) => d.category === 'error')) {
          pushDiag(
            diags,
            sf,
            at,
            `"${shownOf(decl)}" reads a variable that is not declared yet where it is called: ` +
              `call it after the variables it reads are declared (Rule 8.17).`,
            TS_CODES.UNKNOWN_NAME,
          );
        }
        return false;
      }
    }
    if (unsaid.has(decl)) return false;
    if (!inferring.has(decl)) return true;
    const path = [...filling.slice(filling.lastIndexOf(decl)), decl];
    for (const f of path) if (inferring.has(f)) cyclic.add(f);
    if (!cycleAt.has(at)) {
      cycleAt.add(at);
      const hops = path.slice(1).map((to, i) => `${path[i]!.name} ${to.name}`);
      const written = writtenHops(recursionGraph());
      if (!hops.every((h) => written.has(h))) {
        pushDiag(
          diags,
          sf,
          at,
          `Recursive call: ${path.map((f) => `"${shownOf(f)}"`).join(' -> ')}. WGSL has no ` +
            `call stack, so a function must not take part in a call cycle.`,
          TS_CODES.RECURSION,
        );
        cycleNotes.push({ diagnostic: diags[diags.length - 1]!, path });
      }
    }
    return false;
  };
  const fillReady = (r: (typeof ready)[number], infers: boolean): void => {
    track(r.stub, infers, diagnostics, r.node, () => {
      fillFunctionBody(
        r.node,
        r.stub,
        sourceFile,
        diagnostics,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        undefined,
        undefined,
        r.prefix === '' ? undefined : r.prefix,
        aliasesOf.get(r.stub.name),
        undefined,
        undefined,
        undefined,
        undefined,
        infers,
      );
      funcs.push(r.stub);
      nodeByName.set(r.stub.name, r.node);
    });
  };
  const decidedByCallers = new Set<FuncDecl>();
  const copiesOf = new Map<FuncDecl, Map<string, FuncDecl>>();
  const planResult = (o: {
    readonly stub: FuncDecl;
    readonly node: ts.Node;
    readonly nameNode: ts.Node | undefined;
    readonly shown: string;
    readonly exported: boolean;
    readonly generic?: true;
    readonly refill: (copy: FuncDecl) => void;
  }): boolean => {
    if (!useInferenceActive(sourceFile)) return false;
    const key = calleeKeyOf(o.node, o.stub.name);
    registerCallerDecided(o.stub, {
      name: o.shown,
      node: o.nameNode ?? o.node,
      decl: o.node,
      key,
      copyFor: (t) => copyOfResult(o, t),
    });
    if (!isCallerDecided(sourceFile, o.node)) return false;
    const asked = askedOf(sourceFile, key);
    if (asked.size === 0) return false;
    const others = [...asked].filter(([k]) => k !== 'f32');
    const ret = asked.size === 1 && others.length === 1 && !o.exported ? others[0]![1] : f32T;
    (o.stub as { ret: ShaderType }).ret = ret;
    decidedByCallers.add(o.stub);
    setHomeTag(o.stub, `${o.stub.name}:${typeKey(ret)}`);
    const listed = new Map(asked);
    if (o.exported) listed.set('f32', f32T);
    if (o.nameNode !== undefined && o.generic !== true) {
      recordResultCopies(
        sourceFile,
        o.nameNode,
        o.shown,
        ['i32', 'u32', 'f32', 'f64'].flatMap((k) => (listed.has(k) ? [listed.get(k)!] : [])),
      );
    }
    return true;
  };
  const copyOfResult = (
    o: {
      readonly stub: FuncDecl;
      readonly node: ts.Node;
      readonly shown: string;
      readonly refill: (copy: FuncDecl) => void;
    },
    t: ShaderType,
  ): FuncDecl | undefined => {
    let byType = copiesOf.get(o.stub);
    if (byType === undefined) copiesOf.set(o.stub, (byType = new Map()));
    const had = byType.get(typeKey(t));
    if (had !== undefined) return had;
    const base = instanceName(o.stub.name, [t]);
    const body = (o.node as { body?: ts.Node }).body;
    const hasLocals =
      body !== undefined && ts.isBlock(body) && declarationsIn(body).some(declaresFunction);
    const taken = (n: string): boolean =>
      callees.has(n) ||
      refused.has(n) ||
      (hasLocals && [...callees.keys(), ...refused].some((c) => c.startsWith(`${n}_`)));
    let name = base;
    for (let n = 1; taken(name); n++) name = `${base}_${String(n)}`;
    const copy: FuncDecl = {
      ...o.stub,
      name,
      ret: t,
      body: [],
      params: o.stub.params.map((p) => ({ ...p })),
    };
    callees.set(name, copy);
    writtenAs.set(name, o.shown);
    const captured = file.captures.get(o.stub.name);
    if (captured !== undefined) file.captures.set(name, captured);
    byType.set(typeKey(t), copy);
    inCopy(name, () => o.refill(copy));
    return copy;
  };
  const localsOfCopy = (
    fnNode: ts.Node,
    copy: FuncDecl,
    self: LiftedThis | undefined,
    outer: ReadonlyMap<string, string>,
    around: ReadonlyMap<ts.Node, FuncDecl>,
    said: TsCompilerDiagnostic[],
    targets?: ReadonlyMap<ts.Node, FuncDecl>,
  ): Lifted[] => {
    const mine: Lifted[] = [];
    const body = (fnNode as { body?: ts.Node }).body;
    if (body === undefined || !ts.isBlock(body)) {
      aliasesOf.set(copy.name, new Map(outer));
      return mine;
    }
    seeLocals(
      declarationsIn(body),
      copy.name,
      new Map([...around, [fnNode, copy]]),
      self,
      outer,
      mine,
      said,
    );
    liftCaptures(mine, callees, file, targets);
    holdLifted(mine, sourceFile, said);
    return mine;
  };
  for (const r of ready) {
    if (r.stub.stage !== undefined || !hasNoWrittenResult(r.node, sourceFile)) continue;
    planResult({
      stub: r.stub,
      node: r.node,
      nameNode: r.node.name,
      shown:
        r.prefix === ''
          ? (r.node.name?.text ?? r.stub.name)
          : `${r.prefix}.${r.node.name?.text ?? ''}`,
      exported: hostExportedDeclarations(sourceFile).has(r.node),
      refill: (copy) => {
        const mine = localsOfCopy(r.node, copy, undefined, new Map(), new Map(), diagnostics);
        fillReady({ ...r, stub: copy }, false);
        fillLifted(mine, sourceFile, diagnostics);
      },
    });
  }
  for (const r of ready) {
    if (!hasNoWrittenResult(r.node, sourceFile) || r.stub.stage !== undefined) continue;
    if (decidedByCallers.has(r.stub)) continue;
    pendingFill.set(r.stub, () => {
      withTypeArguments(undefined, () => fillReady(r, true));
      return true;
    });
  }
  const fillClassFunction = (
    cf: ClassFunction,
    node: NonNullable<ClassFunction['node']>,
    infers: boolean,
  ): void => {
    const said = saidFor(cf);
    const saidBefore = said.length;
    track(cf.stub, infers, said, node, () =>
      fillFunctionBody(
        node,
        cf.stub,
        sourceFile,
        said,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        cf.receiver,
        cf.shown,
        undefined,
        aliasesOf.get(cf.stub.name),
        cf.staticOwner,
        cf.staticSuper,
        undefined,
        undefined,
        infers,
      ),
    );
    const made = instanceUsesOf(sourceFile, cf.struct.decl.name);
    if (made.length > 0) {
      for (const d of said.slice(saidBefore))
        for (const use of [...made].reverse()) noteUse(d, use, sourceFile);
    }
    nodeByName.set(cf.stub.name, node);
    funcs.push(cf.stub);
  };
  for (const cf of classFns) {
    if (cf.infers !== true || cf.node === undefined || cf.takesFunctions !== undefined) continue;
    const node = cf.node;
    if (
      !ts.isConstructorDeclaration(node) &&
      !ts.isSetAccessorDeclaration(node) &&
      planResult({
        stub: cf.stub,
        node,
        nameNode: (node as { name?: ts.Node }).name,
        shown: cf.shown,
        exported: hostExportedDeclarations(sourceFile).has(node.parent),
        refill: (copy) =>
          withTypeArguments(undefined, () => {
            const mine = localsOfCopy(node, copy, classSelf(cf), new Map(), new Map(), saidFor(cf));
            fillClassFunction({ ...cf, stub: copy }, node, false);
            fillLifted(mine, sourceFile, saidFor(cf));
          }),
      })
    ) {
      continue;
    }
    pendingFill.set(cf.stub, () => {
      withTypeArguments(undefined, () => fillClassFunction(cf, node, true));
      return true;
    });
  }
  for (const cf of classFns) {
    const node = cf.node;
    if (cf.valueFromGetter !== true || node === undefined || !ts.isSetAccessorDeclaration(node)) {
      continue;
    }
    const getter = classFns.find(
      (g) =>
        g.accessor === 'get' &&
        g.struct === cf.struct &&
        g.member === cf.member &&
        g.kind === cf.kind,
    );
    pendingFill.set(cf.stub, () => {
      const said = saidFor(cf);
      const value = node.parameters[0]!;
      const named = value.name.getText(sourceFile);
      const fix = `write "set ${cf.member ?? 'x'}(${named}: T)".`;
      if (getter === undefined) {
        pushDiag(
          said,
          sourceFile,
          value,
          `The setter "${cf.shown}" needs a type for "${named}": ${fix}`,
          TS_CODES.UNKNOWN_TYPE,
        );
        unsaid.add(cf.stub);
        return true;
      }
      if (!fns.ensure!(getter.stub, value, sourceFile, said)) {
        unsaid.add(cf.stub);
        return true;
      }
      const type = getter.stub.ret;
      if (typeKey(type) === 'void') {
        pushDiag(
          said,
          sourceFile,
          value,
          `The getter "${getter.shown}" returns nothing, so the setter has no type for ` +
            `"${named}": ${fix}`,
          TS_CODES.UNKNOWN_TYPE,
        );
        unsaid.add(cf.stub);
        return true;
      }
      const params = cf.stub.params;
      (params[params.length - 1] as { type: ShaderType }).type = type;
      withTypeArguments(undefined, () => fillClassFunction(cf, node, false));
      return true;
    });
  }
  const fillOneLifted = (l: Lifted, sf: ts.SourceFile, said: TsCompilerDiagnostic[]): boolean => {
    const fn = l.fn;
    const bound = captureBindings(l, file);
    if (bound === undefined) return false;
    const into = l.said ?? said;
    track(fn.stub, fn.infers, into, fn.node, () => {
      fillFunctionBody(
        fn.node,
        fn.stub,
        sf,
        into,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        bound.receiver,
        undefined,
        undefined,
        aliasesOf.get(fn.stub.name),
        l.self?.bindsThis === true ? l.self.staticOwner : undefined,
        l.self?.bindsThis === true ? l.self.staticSuper : undefined,
        bound.captures,
        undefined,
        fn.infers,
      );
      funcs.push(fn.stub);
      nodeByName.set(fn.stub.name, fn.node);
    });
    return true;
  };
  const holdLifted = (
    list: readonly Lifted[],
    sf: ts.SourceFile,
    said: TsCompilerDiagnostic[],
  ): void => {
    const typeArgs = currentTypeArguments();
    for (const l of list) {
      if (!l.fn.infers) continue;
      const named = (l.fn.decl as { name?: ts.Node }).name ?? l.fn.node.name;
      if (
        planResult({
          stub: l.fn.stub,
          node: l.fn.node,
          nameNode: named,
          shown: l.fn.localName,
          exported: hostExportedDeclarations(sourceFile).has(l.fn.decl),
          refill: (copy) =>
            withTypeArguments(typeArgs, () => {
              const mine = localsOfCopy(
                l.fn.node,
                copy,
                l.self,
                aliasesOf.get(l.fn.ownerName) ?? new Map(),
                l.around,
                l.said ?? said,
              );
              fillOneLifted({ ...l, fn: { ...l.fn, stub: copy, infers: false } }, sf, said);
              fillLifted(mine, sf, l.said ?? said);
            }),
        })
      ) {
        continue;
      }
      pendingFill.set(l.fn.stub, () =>
        withTypeArguments(typeArgs, () => fillOneLifted(l, sf, said)),
      );
    }
  };
  holdLifted(lifted, sourceFile, diagnostics);
  const defaulted = [...ready, ...classFns.map((cf) => ({ stub: cf.stub, prefix: '' }))];
  const lowerAll = (into: TsCompilerDiagnostic[], final: boolean): boolean => {
    let progressed = false;
    for (const { stub, prefix } of defaulted) {
      const moved = lowerParamDefaults(
        stub,
        sourceFile,
        into,
        callees,
        consts,
        bindings,
        structs,
        final ? symbols : undefined,
        overrides,
        vars,
        prefix === '' ? undefined : prefix,
        final,
      );
      progressed ||= moved;
    }
    return progressed;
  };
  while (lowerAll([], false));
  lowerAll(diagnostics, true);
  bodiesOpen = true;
  const fillLifted = (
    list: readonly Lifted[],
    sf: ts.SourceFile,
    said: TsCompilerDiagnostic[],
  ): void => {
    for (const l of list) {
      if (decidedByCallers.has(l.fn.stub))
        fillOneLifted({ ...l, fn: { ...l.fn, infers: false } }, sf, said);
      else if (l.fn.infers) runPending(l.fn.stub);
      else fillOneLifted(l, sf, said);
    }
    propagateCaptureRefs(
      list.map((l) => l.fn.stub),
      callees,
      file,
    );
  };
  const instances = new Map<string, FuncDecl>();
  const making: string[] = [];
  const freshName = (base: string): string => {
    let name = base;
    for (let n = 1; callees.has(name) || refused.has(name); n++) name = `${base}_${String(n)}`;
    return name;
  };
  fns.instantiate = (name, node, argTypes, sf, diags, scope): FuncDecl | undefined => {
    const generic = generics.get(name);
    if (generic === undefined) {
      const local = localTemplates.get(name);
      return local === undefined ? undefined : copyLocal(name, local, node, sf, diags, scope);
    }
    const fnAt = fns.fnParams.get(name) ?? new Set<number>();
    const order = (generic.node.typeParameters ?? []).map((p) => p.name.text);
    const named = new Map<number, { params: readonly ShaderType[]; ret: ShaderType }>();
    for (const i of fnAt) {
      const arg = node.arguments[i];
      const x = arg === undefined ? undefined : skipParens(arg);
      if (x === undefined || !ts.isIdentifier(x)) continue;
      const decl = scope.resolveCallee(x.text);
      if (decl === undefined) continue;
      if (captureArguments(decl, x.text, x, sf, scope, []) === undefined) continue;
      if (!scope.calleeReady(decl, x, sf, diags)) continue;
      const captured = file.captures.get(decl.name)?.length ?? 0;
      named.set(i, { params: decl.params.slice(captured).map((p) => p.type), ret: decl.ret });
    }
    const bound = typeArgumentsFor(generic.node, order, node, argTypes, sf, diags, named);
    if (bound === undefined) return undefined;
    return withTypeArguments(bound, (): FuncDecl | undefined => {
      const targets: { param: ts.ParameterDeclaration; fn: FuncDecl }[] = [];
      for (const i of [...fnAt].sort((a, b) => a - b)) {
        const param = generic.node.parameters[i]!;
        const shape = shapeOf(functionTypeOf(param.type)!, sf, diags);
        if (shape === undefined) {
          refused.add(name);
          return undefined;
        }
        const fn = functionArgument(node, i, param, shape, name, scope, sf, diags);
        if (fn === undefined) return undefined;
        targets.push({ param, fn });
      }
      const typed = instanceName(
        name,
        order.map((n) => bound.get(n)!),
      );
      const key = [typed, ...targets.map((t) => t.fn.name)].join('|');
      const had = instances.get(key);
      if (had !== undefined) return had;
      if (fnAt.size > 0 && making.includes(name)) {
        pushDiag(
          diags,
          sf,
          node,
          `"${name}" calls itself, through the functions it is handed, with a function made ` +
            `anew for each call, so there is no last copy of it to compile. WGSL has no call ` +
            `stack, so a function must not take part in a call cycle (Rule 8.4).`,
          TS_CODES.RECURSION,
        );
        return undefined;
      }
      const emitted =
        targets.length === 0
          ? typed
          : freshName([typed, ...targets.map((t) => t.fn.name)].join('_'));
      const stub = parseSignature(generic.node, sf, diags, structs, emitted, fnAt);
      if (!stub) {
        refused.add(name);
        return undefined;
      }
      recordTemplateInstance(stub, generic.node);
      const keys: CaptureKey[] = [];
      for (const t of targets) {
        for (const k of file.captures.get(t.fn.name) ?? []) {
          if (keys.includes(k)) continue;
          if (k === THIS_CAPTURE) keys.unshift(k);
          else keys.push(k);
        }
      }
      const taken = new Set(stub.params.map((p) => p.name));
      taken.add('self_');
      const captures: CaptureBinding[] = [];
      const hidden = keys.map((k): FuncDecl['params'][number] => {
        const held =
          scope.bindingOfDeclaration(k) ?? (k === THIS_CAPTURE ? scope.resolve('this') : undefined);
        const type = held?.type ?? voidT;
        let pname = 'self_';
        if (k !== THIS_CAPTURE) {
          const base = capturedName(k);
          pname = base;
          for (let n = 1; taken.has(pname); n++) pname = `${base}_${String(n)}`;
          taken.add(pname);
        }
        captures.push({
          key: k,
          byName: false,
          binding: { kind: 'param', name: pname, type, mutable: true },
        });
        return { name: pname, type };
      });
      (stub as { params: FuncDecl['params'] }).params = [...hidden, ...stub.params];
      if (keys.length > 0) file.captures.set(emitted, keys);
      instances.set(key, stub);
      callees.set(emitted, stub);
      writtenAs.set(emitted, name);
      making.push(name);
      const saidBefore = diags.length;
      try {
        const handed = new Map<string, string>();
        for (const t of targets) {
          if (ts.isIdentifier(t.param.name)) handed.set(t.param.name.text, t.fn.name);
        }
        const mine: Lifted[] = [];
        if (generic.node.body !== undefined) {
          seeLocals(
            declarationsIn(generic.node.body),
            emitted,
            new Map([[generic.node, stub]]),
            undefined,
            handed,
            mine,
            diags,
          );
          liftCaptures(
            mine,
            callees,
            file,
            new Map(targets.map((t) => [t.param as ts.Node, t.fn])),
          );
          holdLifted(mine, sf, diags);
        }
        const fillInstance = (
          target: FuncDecl,
          inferring: boolean,
          aliases?: ReadonlyMap<string, string>,
        ): void =>
          track(target, inferring, diags, generic.node, () =>
            fillFunctionBody(
              generic.node,
              target,
              sf,
              diags,
              callees,
              consts,
              bindings,
              structs,
              symbols,
              overrides,
              vars,
              undefined,
              name,
              generic.prefix === '' ? undefined : generic.prefix,
              aliases ?? aliasesOf.get(emitted) ?? handed,
              undefined,
              undefined,
              captures,
              generic.node.parameters.filter((_, i) => !fnAt.has(i)),
              inferring,
            ),
          );
        const infers =
          hasNoWrittenResult(generic.node, sf) &&
          !planResult({
            stub,
            node: generic.node,
            nameNode: generic.node.name,
            shown: name,
            exported: false,
            generic: true,
            refill: (copy) =>
              withTypeArguments(bound, () => {
                const mine = localsOfCopy(
                  generic.node,
                  copy,
                  undefined,
                  handed,
                  new Map(),
                  diags,
                  new Map(targets.map((t) => [t.param as ts.Node, t.fn])),
                );
                fillInstance(copy, false, aliasesOf.get(copy.name));
                funcs.push(copy);
                nodeByName.set(copy.name, generic.node);
                fillLifted(mine, sf, diags);
              }),
          });
        fillInstance(stub, infers);
        funcs.push(stub);
        nodeByName.set(emitted, generic.node);
        fillLifted(mine, sf, diags);
      } finally {
        making.pop();
        for (const d of diags.slice(saidBefore)) noteUse(d, node, sf);
      }
      return stub;
    });
  };
  const localCopies = new Map<string, FuncDecl>();
  const copyLocal = (
    name: string,
    t: { fn: LocalFunction; self: LiftedThis | undefined },
    node: ts.CallExpression,
    sf: ts.SourceFile,
    diags: TsCompilerDiagnostic[],
    scope: LoweringScope,
  ): FuncDecl | undefined => {
    const fn = t.fn;
    const fnAt = fn.takesFunctions!;
    const owner = scope.owner();
    if (owner === undefined) return undefined;
    const targets: { param: ts.ParameterDeclaration; fn: FuncDecl }[] = [];
    for (const i of [...fnAt].sort((a, b) => a - b)) {
      const param = fn.node.parameters[i]!;
      const shape = shapeOf(functionTypeOf(param.type)!, sf, diags);
      if (shape === undefined) return undefined;
      const handedFn = functionArgument(node, i, param, shape, fn.localName, scope, sf, diags);
      if (handedFn === undefined) return undefined;
      targets.push({ param, fn: handedFn });
    }
    const key = [name, owner.name, ...targets.map((x) => x.fn.name)].join('|');
    const had = localCopies.get(key);
    if (had !== undefined) return had;
    if (making.includes(name)) {
      pushDiag(
        diags,
        sf,
        node,
        `"${fn.localName}" calls itself, through the functions it is handed, with a function ` +
          `made anew for each call, so there is no last copy of it to compile. WGSL has no call ` +
          `stack, so a function must not take part in a call cycle (Rule 8.4).`,
        TS_CODES.RECURSION,
      );
      return undefined;
    }
    const use = closureUse(fn.node, declaresFunction);
    const mine: CaptureKey[] = use.captures.map((c) => c.decl);
    const add = (list: CaptureKey[], k: CaptureKey): void => {
      if (list.includes(k)) return;
      if (k === THIS_CAPTURE) list.unshift(k);
      else list.push(k);
    };
    if (use.usesThis && ts.isArrowFunction(fn.node) && scope.resolve('this') !== undefined) {
      add(mine, THIS_CAPTURE);
    }
    for (const d of use.calls) {
      if ((fn.node.parameters as readonly ts.Node[]).includes(d)) continue;
      const n = (d as { name?: ts.Node }).name;
      const called =
        n !== undefined && ts.isIdentifier(n) ? scope.resolveCallee(n.text) : undefined;
      for (const k of called === undefined ? [] : (file.captures.get(called.name) ?? [])) {
        add(mine, k);
      }
    }
    const keys = [...mine];
    for (const x of targets) for (const k of file.captures.get(x.fn.name) ?? []) add(keys, k);
    const emitted = freshName([name, ...targets.map((x) => x.fn.name)].join('_'));
    const stub: FuncDecl = {
      name: emitted,
      params: fn.stub.params.map((p) => ({ ...p })),
      ret: fn.stub.ret,
      body: [],
    };
    (stub as { span?: unknown }).span = spanOf(sf, fn.node);
    const taken = new Set(stub.params.map((p) => p.name));
    taken.add('self_');
    const captures: CaptureBinding[] = [];
    let receiver: Receiver | undefined;
    const hidden: FuncDecl['params'][number][] = [];
    for (const k of keys) {
      const held =
        k === THIS_CAPTURE
          ? (scope.bindingOfDeclaration(k) ?? scope.resolve('this'))
          : scope.bindingOfDeclaration(k);
      if (held === undefined) {
        if (
          k !== THIS_CAPTURE &&
          k.getSourceFile() === sf &&
          k.end <= node.pos &&
          variableRefused(k, sf, [...diagnostics, ...diags])
        )
          return undefined;
        pushDiag(
          diags,
          sf,
          node,
          `"${fn.localName}" reads "${keyName(k)}", which is not declared yet where ` +
            `"${fn.localName}" is called: a let or a const is not there before its declaration, ` +
            `and TypeScript throws. Call "${fn.localName}" after "${keyName(k)}" is declared.`,
          TS_CODES.UNKNOWN_NAME,
        );
        return undefined;
      }
      if (k === THIS_CAPTURE) {
        hidden.unshift({
          name: 'self_',
          type: held.type,
          ...(held.mutable ? { mode: 'inout' as const } : {}),
        });
        receiver = {
          type: held.type,
          mode: held.mutable ? 'inout' : 'param',
          fieldInits: [],
          shown: owner.name,
          ...(scope.superMethods() !== undefined ? { superMethods: scope.superMethods() } : {}),
        };
        continue;
      }
      const base = capturedName(k);
      let pname = base;
      for (let n = 1; taken.has(pname); n++) pname = `${base}_${String(n)}`;
      taken.add(pname);
      const param: FuncDecl['params'][number] = { name: pname, type: held.type };
      hidden.push(param);
      if (!mine.includes(k)) {
        captures.push({
          key: k,
          byName: false,
          binding: { kind: 'param', name: pname, type: held.type, mutable: true },
        });
        continue;
      }
      const of = writeRules(held);
      captures.push({
        key: k,
        byName: true,
        binding: {
          kind: 'param',
          name: base,
          type: held.type,
          mutable: of.mutable,
          ...(of.constValue !== undefined ? { constValue: of.constValue } : {}),
          irName: pname,
          capture: {
            of,
            byRef: () => {
              (param as { mode?: 'inout' }).mode = 'inout';
            },
          },
        },
      });
    }
    (stub as { params: FuncDecl['params'] }).params = [...hidden, ...stub.params];
    if (keys.length > 0) file.captures.set(emitted, keys);
    localCopies.set(key, stub);
    callees.set(emitted, stub);
    writtenAs.set(emitted, fn.localName);
    const declared = writtenFunctionOf(fn.stub);
    if (declared !== undefined) recordLocalFunction(stub, declared);
    making.push(name);
    try {
      const handed = new Map<string, string>();
      for (const x of targets) {
        if (ts.isIdentifier(x.param.name)) handed.set(x.param.name.text, x.fn.name);
      }
      const outer = new Map([...(scope.localFunctions() ?? new Map<string, string>()), ...handed]);
      const lifts: Lifted[] = [];
      if (fn.node.body !== undefined) {
        seeLocals(
          declarationsIn(fn.node.body),
          emitted,
          new Map([[fn.node, stub]]),
          t.self,
          outer,
          lifts,
          diags,
        );
        liftCaptures(lifts, callees, file, new Map(targets.map((x) => [x.param as ts.Node, x.fn])));
        holdLifted(lifts, sf, diags);
      }
      const arrow = ts.isArrowFunction(fn.node);
      track(stub, fn.infers, diags, fn.node, () =>
        fillFunctionBody(
          fn.node,
          stub,
          sf,
          diags,
          callees,
          consts,
          bindings,
          structs,
          symbols,
          overrides,
          vars,
          receiver,
          undefined,
          scope.namespaceOf(),
          aliasesOf.get(emitted) ?? outer,
          arrow ? scope.staticClass() : undefined,
          arrow && receiver === undefined ? scope.superMethods() : undefined,
          captures,
          fn.node.parameters.filter((_, i) => !fnAt.has(i)),
          fn.infers,
        ),
      );
      funcs.push(stub);
      nodeByName.set(emitted, fn.node);
      fillLifted(lifts, sf, diags);
    } finally {
      making.pop();
    }
    return stub;
  };
  const memberCopies = new Map<string, { decl: FuncDecl; writes: boolean }>();
  const makingMembers: string[] = [];
  const placeKey = (e: ts.Expression, scope: LoweringScope): CaptureKey | undefined => {
    let x = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    if (x.kind === ts.SyntaxKind.ThisKeyword || x.kind === ts.SyntaxKind.SuperKeyword) {
      return scope.resolve('this') !== undefined ? THIS_CAPTURE : undefined;
    }
    return ts.isIdentifier(x) ? declarationOf(x) : undefined;
  };
  const rootKey = (e: ts.Expression, scope: LoweringScope): CaptureKey | undefined => {
    let x = e;
    for (;;) {
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
      else break;
    }
    return x === e ? undefined : placeKey(x, scope);
  };
  const keyName = (k: CaptureKey): string => (k === THIS_CAPTURE ? 'this' : capturedName(k));
  const keyId = (k: CaptureKey): string => (k === THIS_CAPTURE ? 'this' : String(k.pos));
  fns.instantiateMember = (cf, node, on, sf, diags, scope) => {
    const fnAt = cf.takesFunctions;
    const member = cf.node;
    if (fnAt === undefined || member === undefined) return undefined;
    const targets: { param: ts.ParameterDeclaration; fn: FuncDecl }[] = [];
    for (const i of [...fnAt].sort((a, b) => a - b)) {
      const param = member.parameters[i]!;
      const shape = shapeOf(functionTypeOf(param.type)!, sf, diags);
      if (shape === undefined) return undefined;
      const fn = functionArgument(
        node as ts.CallExpression,
        i,
        param,
        shape,
        cf.shown,
        scope,
        sf,
        diags,
      );
      if (fn === undefined) return undefined;
      targets.push({ param, fn });
    }
    const keys: CaptureKey[] = [];
    for (const t of targets) {
      for (const k of file.captures.get(t.fn.name) ?? []) if (!keys.includes(k)) keys.push(k);
    }
    const holderOf = (k: CaptureKey) =>
      k === THIS_CAPTURE ? scope.resolve('this') : scope.bindingOfDeclaration(k);
    const method = cf.kind === 'method' && on !== undefined;
    const share = method ? placeKey(on, scope) : undefined;
    const root = method && share === undefined ? rootKey(on, scope) : undefined;
    if (root !== undefined && keys.includes(root) && (cf.mutates || holderOf(root)?.mutable)) {
      const t = targets.find((x) => (file.captures.get(x.fn.name) ?? []).includes(root))!;
      const pname = ts.isIdentifier(t.param.name) ? t.param.name.text : 'f';
      pushDiag(
        diags,
        sf,
        node,
        `"${pname}" of "${cf.shown}" reaches "${keyName(root)}", which holds ` +
          `"${on!.getText(sf)}", the object the call is on, so the call would take two ` +
          `references into one variable, which WGSL refuses where either is written. Call it on ` +
          `a copy in a let, and assign the copy back if the call changes it (Rule 8.18).`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    const shared = share !== undefined && keys.includes(share);
    const writes = method && (cf.mutates || (shared && holderOf(share)?.mutable === true));
    const own = keys.filter((k) => !(shared && k === share));
    const key = [
      cf.stub.name,
      ...targets.map((t) => t.fn.name),
      writes ? 'w' : 'r',
      shared ? keyId(share) : '-',
    ].join('|');
    const had = memberCopies.get(key);
    if (had !== undefined) return had;
    if (makingMembers.includes(cf.stub.name)) {
      pushDiag(
        diags,
        sf,
        node,
        `"${cf.shown}" calls itself, through the functions it is handed, with a function made ` +
          `anew for each call, so there is no last copy of it to compile. WGSL has no call ` +
          `stack, so a function must not take part in a call cycle (Rule 8.4).`,
        TS_CODES.RECURSION,
      );
      return undefined;
    }
    const emitted = freshName([cf.stub.name, ...targets.map((t) => t.fn.name)].join('_'));
    const receiverParams = cf.kind === 'method' ? cf.stub.params.slice(0, 1) : [];
    const ownParams = cf.stub.params.slice(receiverParams.length);
    const taken = new Set(ownParams.map((p) => p.name));
    if (cf.kind !== 'static') taken.add('self_');
    const captures: CaptureBinding[] = [];
    const hidden = own.map((k): FuncDecl['params'][number] => {
      const type = holderOf(k)?.type ?? voidT;
      const base = k === THIS_CAPTURE ? (cf.kind === 'static' ? 'self_' : 'this_') : keyName(k);
      let pname = base;
      for (let n = 1; taken.has(pname); n++) pname = `${base}_${String(n)}`;
      taken.add(pname);
      captures.push({
        key: k,
        byName: false,
        binding: { kind: 'param', name: pname, type, mutable: true },
      });
      return { name: pname, type };
    });
    const stub: FuncDecl = {
      name: emitted,
      params: [
        ...hidden,
        ...receiverParams.map((p) => ({
          name: p.name,
          type: p.type,
          ...(writes ? { mode: 'inout' as const } : {}),
        })),
        ...ownParams.map((p) => ({ ...p })),
      ],
      ret: cf.stub.ret,
      body: [],
    };
    (stub as { span?: SourceSpan }).span = spanOf(sf, member);
    if (own.length > 0) file.captures.set(emitted, own);
    const made = { decl: stub, writes };
    memberCopies.set(key, made);
    callees.set(emitted, stub);
    writtenAs.set(emitted, cf.shown);
    registerClassCopy(stub, cf, writes);
    const receiver: Receiver | undefined =
      cf.receiver === undefined || cf.receiver.mode === 'ctor'
        ? cf.receiver
        : { ...cf.receiver, mode: writes ? 'inout' : 'param' };
    const said = saidFor(cf);
    makingMembers.push(cf.stub.name);
    try {
      const handed = new Map<string, string>();
      for (const t of targets) {
        if (ts.isIdentifier(t.param.name)) handed.set(t.param.name.text, t.fn.name);
      }
      const self: LiftedThis | undefined =
        receiver !== undefined
          ? {
              receiver: {
                type: receiver.type,
                mode: receiver.mode === 'param' ? 'param' : 'inout',
                superMethods: receiver.superMethods,
              },
              bindsThis: true,
              shown: cf.shown,
            }
          : cf.staticOwner !== undefined
            ? {
                staticOwner: cf.staticOwner,
                staticSuper: cf.staticSuper,
                bindsThis: true,
                shown: cf.shown,
              }
            : undefined;
      const mine: Lifted[] = [];
      if (member.body !== undefined) {
        seeLocals(
          declarationsIn(member.body),
          emitted,
          new Map([[member, stub]]),
          self,
          handed,
          mine,
          said,
        );
        liftCaptures(mine, callees, file, new Map(targets.map((t) => [t.param as ts.Node, t.fn])));
        holdLifted(mine, sf, said);
      }
      const infers = cf.infers === true;
      track(stub, infers, said, member, () =>
        fillFunctionBody(
          member,
          stub,
          sf,
          said,
          callees,
          consts,
          bindings,
          structs,
          symbols,
          overrides,
          vars,
          receiver,
          cf.shown,
          undefined,
          aliasesOf.get(emitted) ?? handed,
          cf.staticOwner,
          cf.staticSuper,
          captures,
          member.parameters.filter((_, i) => !fnAt.has(i)),
          infers,
          shared ? [share] : undefined,
        ),
      );
      funcs.push(stub);
      nodeByName.set(emitted, member);
      fillLifted(mine, sf, said);
    } finally {
      makingMembers.pop();
    }
    return made;
  };
  const built = new Map<string, FuncDecl>();
  fns.build = (key, base, shown, captures, build): FuncDecl => {
    const had = built.get(key);
    if (had !== undefined) return had;
    const decl = build(freshName(base));
    callees.set(decl.name, decl);
    if (captures.length > 0) file.captures.set(decl.name, captures);
    writtenAs.set(decl.name, shown);
    funcs.push(decl);
    built.set(key, decl);
    return decl;
  };
  const liftedArguments = new Map<ts.Node, Map<FuncDecl, FuncDecl>>();
  fns.lift = (node, shape, hint, scope, sf, diags): FuncDecl | undefined => {
    const owner = scope.owner();
    if (owner === undefined) return undefined;
    const had = liftedArguments.get(node)?.get(owner);
    if (had !== undefined) return had;
    const made = liftArgument(node, shape, hint, owner, scope, sf, diags);
    if (made === undefined) return undefined;
    let byOwner = liftedArguments.get(node);
    if (byOwner === undefined) liftedArguments.set(node, (byOwner = new Map()));
    byOwner.set(owner, made);
    return made;
  };
  const liftArgument = (
    node: ts.ArrowFunction | ts.FunctionExpression,
    shape: FunctionShape,
    hint: string,
    owner: FuncDecl,
    scope: LoweringScope,
    sf: ts.SourceFile,
    diags: TsCompilerDiagnostic[],
  ): FuncDecl | undefined => {
    const signature = argumentSignature(node, shape, sf, diags);
    if (signature === undefined) return undefined;
    const name = freshName(`${owner.name}_${hint}`);
    const stub: FuncDecl = {
      name,
      params: signature.params,
      ret: signature.ret ?? voidT,
      body: [],
    };
    (stub as { span?: unknown }).span = spanOf(sf, node);
    recordParamDefaults(stub, node.parameters, 0, true);
    callees.set(name, stub);
    const keys = capturesOfArgument(node, scope);
    const taken = new Set(stub.params.map((p) => p.name));
    taken.add('self_');
    const captures: CaptureBinding[] = [];
    let receiver: Receiver | undefined;
    const hidden: FuncDecl['params'][number][] = [];
    for (const k of keys) {
      const held =
        k === THIS_CAPTURE
          ? (scope.bindingOfDeclaration(k) ?? scope.resolve('this'))
          : scope.bindingOfDeclaration(k);
      if (held === undefined) {
        const shownName = k === THIS_CAPTURE ? 'this' : capturedName(k);
        pushDiag(
          diags,
          sf,
          node,
          `The function written here reads "${shownName}", which is not declared yet where it ` +
            `runs: a let or a const is not there before its declaration, and TypeScript ` +
            `throws. Declare "${shownName}" above this call.`,
          TS_CODES.UNKNOWN_NAME,
        );
        callees.delete(name);
        refused.add(name);
        return undefined;
      }
      if (k === THIS_CAPTURE) {
        const param: FuncDecl['params'][number] = {
          name: 'self_',
          type: held.type,
          ...(held.mutable ? { mode: 'inout' as const } : {}),
        };
        hidden.unshift(param);
        receiver = {
          type: held.type,
          mode: held.mutable ? 'inout' : 'param',
          fieldInits: [],
          shown: owner.name,
          ...(scope.superMethods() !== undefined ? { superMethods: scope.superMethods() } : {}),
        };
        continue;
      }
      const base = capturedName(k);
      let pname = base;
      for (let n = 1; taken.has(pname); n++) pname = `${base}_${String(n)}`;
      taken.add(pname);
      const param: FuncDecl['params'][number] = { name: pname, type: held.type };
      hidden.push(param);
      const of = writeRules(held);
      captures.push({
        key: k,
        byName: true,
        binding: {
          kind: 'param',
          name: base,
          type: held.type,
          mutable: of.mutable,
          ...(of.constValue !== undefined ? { constValue: of.constValue } : {}),
          irName: pname,
          capture: {
            of,
            byRef: () => {
              (param as { mode?: 'inout' }).mode = 'inout';
            },
          },
        },
      });
    }
    (stub as { params: FuncDecl['params'] }).params = [...hidden, ...stub.params];
    if (keys.length > 0) file.captures.set(name, keys);
    const outer = scope.localFunctions() ?? new Map<string, string>();
    const mine: Lifted[] = [];
    seeLocals(
      declarationsIn(node.body),
      name,
      new Map([[node, stub]]),
      undefined,
      outer,
      mine,
      diags,
    );
    liftCaptures(mine, callees, file);
    holdLifted(mine, sf, diags);
    const arrow = ts.isArrowFunction(node);
    const infers = signature.ret === undefined;
    track(stub, infers, diags, node, () =>
      fillFunctionBody(
        node,
        stub,
        sf,
        diags,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        receiver,
        undefined,
        scope.namespaceOf(),
        aliasesOf.get(name) ?? outer,
        arrow ? scope.staticClass() : undefined,
        arrow && receiver === undefined ? scope.superMethods() : undefined,
        captures,
        signature.written,
        infers,
      ),
    );
    funcs.push(stub);
    nodeByName.set(name, node);
    fillLifted(mine, sf, diags);
    return stub;
  };
  for (const cf of classFns) {
    if (cf.takesFunctions !== undefined) continue;
    if (decidedByCallers.has(cf.stub) && cf.node !== undefined) {
      fillClassFunction(cf, cf.node, false);
      continue;
    }
    if ((cf.infers === true || cf.valueFromGetter === true) && cf.node !== undefined) {
      runPending(cf.stub);
      continue;
    }
    if (cf.node !== undefined) {
      fillClassFunction(cf, cf.node, false);
      continue;
    }
    if (cf.receiver !== undefined) {
      const scope = functionScope(
        cf.stub,
        callees,
        consts,
        bindings,
        structs,
        symbols,
        overrides,
        vars,
        sourceFile,
      );
      (cf.stub as { body: readonly Stmt[] }).body = [
        ...ctorPrologue(cf.receiver, scope, sourceFile, diagnostics),
        { s: 'return', expr: selfRef(cf.receiver.type, scope) },
      ];
    }
    funcs.push(cf.stub);
  }
  for (const r of ready) {
    if (pendingFill.has(r.stub)) runPending(r.stub);
    // A result its callers decided is lowered as one the author wrote.
    else if (decidedByCallers.has(r.stub)) fillReady(r, false);
    // An entry that writes no return type returns what its body does (Rule 8.19, change 0136).
    else if (!hasNoWrittenResult(r.node, sourceFile) || r.stub.stage !== undefined)
      fillReady(
        r,
        r.stub.stage === undefined
          ? hasNoWrittenResult(r.node, sourceFile)
          : r.node.type === undefined,
      );
  }
  fillLifted(lifted, sourceFile, diagnostics);
  propagateCaptureRefs(
    [...file.captures.keys()].flatMap((n) => {
      const f = callees.get(n);
      return f === undefined ? [] : [f];
    }),
    callees,
    file,
  );
  sayInherited(inheritedSaid, funcs, new Set(classFns.map((cf) => cf.stub)), diagnostics);
  const graph = recursionGraph();
  checkRecursion(graph, diagnostics);
  checkLoweredRecursion(
    graph,
    funcs,
    new Map([...writtenAs, ...classFns.map((cf) => [cf.stub.name, cf.shown] as const)]),
    nodeByName,
    sourceFile,
    diagnostics,
  );
  for (const { diagnostic, path } of cycleNotes) {
    noteCycleMembers(
      diagnostic,
      path.map((f) => nodeByName.get(f.name)),
    );
  }
  checkEntryStageUses(funcs, vars, bindings, nodeByName, sourceFile, diagnostics);
  checkDefiniteAssignment(sourceFile, diagnostics);
  const shownAs = new Map([
    ...writtenAs,
    ...classFns.map((cf) => [cf.stub.name, cf.shown] as const),
  ]);
  checkReferenceAliases(
    funcs,
    bindings,
    vars,
    (fn) => shownAs.get(fn) ?? fn,
    (fn) => nodeByName.get(fn),
    sourceFile,
    diagnostics,
  );
  resolvePendingShares(
    funcs,
    new Set(classFns.filter((cf) => cf.kind === 'ctor').map((cf) => cf.stub)),
    structs.map((st) => st.decl),
    diagnostics,
  );
  return funcs;
}

function sayInherited(
  inherited: readonly { cf: ClassFunction; said: readonly TsCompilerDiagnostic[] }[],
  funcs: FuncDecl[],
  classStubs: ReadonlySet<FuncDecl>,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const onlyLowering = (cf: ClassFunction): boolean =>
    (cf.kind !== 'static' || (cf.node !== undefined && buildsCallerClass(cf.node))) &&
    cf.node !== undefined &&
    ts.isClassLike(cf.node.parent) &&
    (cf.node.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false);
  const byName = new Map(funcs.map((f) => [f.name, f]));
  const live = new Set<string>();
  const visit = (names: Iterable<string>): void => {
    for (const name of names) {
      if (live.has(name)) continue;
      live.add(name);
      const f = byName.get(name);
      if (f !== undefined) visit(calleeNamesOf(f.body));
    }
  };
  for (const f of funcs) if (!classStubs.has(f)) visit([f.name]);
  const dropped = new Set(
    inherited
      .filter(
        ({ cf, said }) =>
          !onlyLowering(cf) && !live.has(cf.stub.name) && said.some((d) => d.category === 'error'),
      )
      .map(({ cf }) => cf.stub.name),
  );
  for (let grew = dropped.size > 0; grew;) {
    grew = false;
    for (const f of funcs) {
      if (dropped.has(f.name) || live.has(f.name)) continue;
      if ([...calleeNamesOf(f.body)].some((n) => dropped.has(n))) {
        dropped.add(f.name);
        grew = true;
      }
    }
  }
  for (let i = funcs.length - 1; i >= 0; i--) if (dropped.has(funcs[i]!.name)) funcs.splice(i, 1);
  const key = (d: TsCompilerDiagnostic, message = d.message): string =>
    JSON.stringify([d.fileName, d.start, d.length, d.category, d.code, message]);
  const said = new Set(diagnostics.map((d) => key(d)));
  const fields = new Map<string, { index: number; classes: string[] }>();
  for (const { cf, said: own } of inherited) {
    if (dropped.has(cf.stub.name)) continue;
    for (const d of own) {
      if (said.has(key(d))) continue;
      said.add(key(d));
      const prefix = d.message.match(/^Unknown field "[^"]+" on /)?.[0];
      const name = authorTypeText(structT(cf.struct.decl.name));
      if (
        onlyLowering(cf) &&
        d.code === TS_CODES.UNKNOWN_NAME &&
        prefix !== undefined &&
        d.message.startsWith(`${prefix}${name}.`)
      ) {
        const suffix = d.message.slice(prefix.length + name.length);
        const id = key(d, `${prefix}${suffix}`);
        const group = fields.get(id);
        if (group !== undefined) {
          if (!group.classes.includes(name)) group.classes.push(name);
          const names = group.classes;
          const together =
            names.length === 1
              ? names[0]!
              : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
          const joined = { ...d, message: `${prefix}${together}${suffix}` };
          keepUses(joined, diagnostics[group.index]!);
          diagnostics[group.index] = joined;
          continue;
        }
        fields.set(id, { index: diagnostics.length, classes: [name] });
      }
      diagnostics.push(d);
    }
  }
}

export function lowerFunctionDeclaration(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees?: Map<string, FuncDecl>,
): FuncDecl | undefined {
  const stub = parseSignature(node, sourceFile, diagnostics);
  if (!stub) return undefined;
  const table = callees ?? new Map<string, FuncDecl>();
  if (!table.has(stub.name)) table.set(stub.name, stub);
  fillFunctionBody(node, stub, sourceFile, diagnostics, table);
  return stub;
}

function isNamespaceConst(stmt: ts.Statement): boolean {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function namespaceNamesOf(sourceFile: ts.SourceFile): string[] {
  const out: string[] = [];
  const walk = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const stmt of statements) {
      if (!ts.isModuleDeclaration(stmt) || !ts.isIdentifier(stmt.name)) continue;
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
      const name = prefix === '' ? stmt.name.text : namespaceMemberName(prefix, stmt.name.text);
      out.push(name);
      const body = stmt.body;
      if (body === undefined) continue;
      if (ts.isModuleBlock(body)) walk(body.statements, name);
      else if (ts.isModuleDeclaration(body)) walk([body], name);
    }
  };
  walk(sourceFile.statements, '');
  return out;
}

export function functionScope(
  stub: FuncDecl,
  callees: Map<string, FuncDecl>,
  consts: readonly ScopedConst[],
  bindings: readonly BindingDecl[],
  structs: readonly CollectedStruct[],
  symbols: DeclaredSymbolSink | undefined,
  overrides: readonly OverrideDecl[],
  vars: readonly ModuleVarDecl[],
  sourceFile?: ts.SourceFile,
  nsPrefix?: string,
): LoweringScope {
  const scope = new LoweringScope(callees, symbols);
  if (sourceFile) {
    for (const name of refusedModuleNames(sourceFile)) refusedDeclarationsOf(callees).add(name);
  }
  scope.setNamespacePrefix(nsPrefix);
  scope.setStructs(structs.map((s) => s.decl));
  scope.setClassStructs(structs);
  scope.setPrivateFields(privateFieldTableOf(structs));
  scope.setWithheldFields(withheldTableOf(structs));
  scope.setReadonlyFields(readonlyFieldTableOf(structs));
  scope.setRestrictedFields(restrictedFieldTableOf(structs));
  scope.setBases(new Map(structs.filter((s) => s.bases).map((s) => [s.decl.name, s.bases!])));
  scope.setAbstractStructs(new Set(structs.filter((s) => s.abstract).map((s) => s.decl.name)));
  scope.setStaticHolders(
    new Map(
      structs
        .filter((s) => s.staticHolder !== undefined)
        .map((s) => [s.decl.name, s.staticHolder!] as const),
    ),
  );
  if (sourceFile) {
    scope.setEnums(sourceFile.statements.filter(ts.isEnumDeclaration).map((e) => e.name.text));
    scope.setNamespaces(namespaceNamesOf(sourceFile));
  }
  scope.setStage(stub.stage);
  scope.setResourceStructs(resourceStructsOf(bindings, vars));
  scope.setReturnType(stub.ret);

  const defineOnce = (b: Parameters<LoweringScope['define']>[0]): void => {
    if (!scope.hasInCurrent(b.name)) scope.define(b);
  };
  for (const c of consts) {
    defineOnce({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      constValue: c.type.kind === 'scalar' ? c.cpuValue : undefined,
      indexConstValue: moduleIndexConst(c, scope),
      ...(moduleAbstractConst(sourceFile, c.name) !== undefined
        ? { abstract: moduleAbstractConst(sourceFile, c.name) }
        : {}),
      ...valueExprBinding(c),
    });
  }
  for (const b of bindings) {
    defineOnce({
      kind: 'binding',
      name: b.name,
      type: b.type,
      mutable: b.access === 'read_write' || isInferredStorageAccess(sourceFile, b.name),
      space: b.space,
    });
  }
  for (const o of overrides)
    defineOnce({ kind: 'override', name: o.name, type: o.type, mutable: false });
  for (const v of vars) {
    const inferred = inferredModuleVar(v);
    defineOnce({
      kind: 'modvar',
      name: moduleVarSourceName(v),
      irName: v.name,
      type: v.type,
      mutable: true,
      space: v.space,
      ...(inferred !== undefined ? { inferred } : {}),
    });
  }
  scope.push();
  return scope;
}

function inferredArrowValue(
  expr: ts.Expression,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const bare = skipParens(expr);
  const statement = ts.isPrefixUnaryExpression(bare)
    ? bare.operator === ts.SyntaxKind.PlusPlusToken ||
      bare.operator === ts.SyntaxKind.MinusMinusToken
    : ts.isPostfixUnaryExpression(bare) ||
      (ts.isBinaryExpression(bare) &&
        bare.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        bare.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      (ts.isCallExpression(bare) && callsVoidFunction(bare, sourceFile, scope, diagnostics));
  if (statement) {
    (stub as { ret: ShaderType }).ret = voidT;
    return lowerVoidArrowBody(expr, sourceFile, scope, diagnostics);
  }
  const lowered = lowerExpression(expr, sourceFile, scope, diagnostics);
  if (!lowered) return [];
  if (
    ts.isArrowFunction(expr.parent) &&
    (isIntegerLiteralTree(expr) || isIntegerWrittenRead(expr) || readsUndecided(lowered))
  ) {
    noteCallerDecided(sourceFile, expr.parent);
  }
  (stub as { ret: ShaderType }).ret = lowered.type;
  if (typeKey(lowered.type) === 'void') {
    return lowered.op === 'call' ? [withSpan({ s: 'call', expr: lowered }, sourceFile, expr)] : [];
  }
  return [withSpan({ s: 'return', expr: lowered }, sourceFile, expr)];
}

function callsVoidFunction(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const callee = skipParens(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  const decl = scope.resolveCallee(callee.text);
  if (decl === undefined) return isBarrierIntrinsic(callee.text);
  if (!scope.calleeReady(decl, call, sourceFile, diagnostics)) return false;
  return typeKey(decl.ret) === 'void';
}

function lowerArrowValue(
  expr: ts.Expression,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const lowered = lowerExpression(expr, sourceFile, scope, diagnostics, stub.ret);
  if (!lowered) return [];
  const retargeted = retargetIntLitCtx(lowered, expr, stub.ret);
  const ret = reportIntLitRange(retargeted, expr, stub.ret, sourceFile, diagnostics) ?? retargeted;
  return [withSpan({ s: 'return', expr: ret }, sourceFile, expr)];
}

export function lowerParamDefaults(
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly ScopedConst[],
  bindings: readonly BindingDecl[],
  structs: readonly CollectedStruct[],
  symbols: DeclaredSymbolSink | undefined,
  overrides: readonly OverrideDecl[],
  vars: readonly ModuleVarDecl[],
  nsPrefix?: string,
  final = false,
): boolean {
  const nodes = paramDefaultNodes(stub);
  if (nodes.length === 0) return false;
  let progressed = false;
  const scope = functionScope(
    stub,
    callees,
    consts,
    bindings,
    structs,
    symbols,
    overrides,
    vars,
    sourceFile,
    nsPrefix,
  );
  for (const [i, node] of nodes) {
    const want = stub.params[i]!.type;
    const before = diagnostics.length;
    const lowered = lowerExpression(node, sourceFile, scope, diagnostics, want);
    if (!lowered) {
      if (final && diagnostics.length === before && !refusalWithin(node)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `The default for "${stub.params[i]!.name}" calls a function whose own default waits ` +
            `on this one, so neither has a value. Write the value out here.`,
          TS_CODES.FUNCTION_SHAPE,
        );
      }
      continue;
    }
    const fixed = retargetIntLitCtx(lowered, node, want);
    if (typeKey(fixed.type) !== typeKey(want)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `The default for "${stub.params[i]!.name}" is ${authorTypeText(fixed.type)}, and the ` +
          `parameter is ${authorTypeText(want)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      continue;
    }
    setParamDefault(stub, i, fixed);
    progressed = true;
  }
  return progressed;
}

export function fillFunctionBody(
  ...args: Parameters<typeof fillFunctionBodyNow>
): ReturnType<typeof fillFunctionBodyNow> {
  const home = homeTagOf(args[1]);
  const fill = (): void => unpeekedReads(() => fillFunctionBodyNow(...args));
  if (home === undefined) fill();
  else inCopy(home, fill);
  settleMadeArray(args[1], args[2], args[3]);
}

function reportSharedObjects(
  node: FunctionNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  let reported = SHARED_REPORTED.get(diagnostics);
  if (reported === undefined) SHARED_REPORTED.set(diagnostics, (reported = new Set()));
  const say = (
    at: ts.Node,
    message: string,
    code: TsCode = TS_CODES.UNSUPPORTED,
    store?: { readonly type: ShaderType | undefined },
  ): void => {
    const key = `${at.getStart(sourceFile)}:${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    if (store !== undefined)
      deferRefusal(diagnostics, { sourceFile, node: at, message, code, type: store.type });
    else pushDiag(diagnostics, sourceFile, at, message, code);
  };
  for (const again of reassignedObjects(node, sourceFile)) {
    say(
      again.node,
      again.array !== undefined
        ? `This statement may put another object in "${again.array}" inside the loop that ` +
            `names its elements "${again.name}". A loop that must keep the array and the ` +
            `objects it found is not supported yet (change 0142, stage 2). Loop over the ` +
            `indexes, for (let i = 0; i < ${again.array}.length; i++), and read ` +
            `${again.array}[i].`
        : `"${again.name}" is assigned another object here, after a write to the object it ` +
            `named until now. A name that stops naming the caller's object part of the way ` +
            `through is not supported yet (change 0142, stage 2). Declare a local for the ` +
            `other object.`,
    );
  }
  const clean = errorsOf(diagnostics) === 0;
  for (const shared of sharedObjects(node, sourceFile, recordedValueType, clean))
    say(
      shared.node,
      shared.text,
      shared.pairing === true ? TS_CODES.REFERENCE_ALIAS : TS_CODES.UNSUPPORTED,
      shared.store,
    );
}
const SHARED_REPORTED = new WeakMap<TsCompilerDiagnostic[], Set<string>>();

function fillFunctionBodyNow(
  node: FunctionNode,
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  callees: Map<string, FuncDecl>,
  consts: readonly ScopedConst[] = [],
  bindings: readonly BindingDecl[] = [],
  structs: readonly CollectedStruct[] = [],
  symbols?: DeclaredSymbolSink,
  overrides: readonly OverrideDecl[] = [],
  vars: readonly ModuleVarDecl[] = [],
  receiver?: Receiver,
  shown?: string,
  nsPrefix?: string,
  localFunctions?: ReadonlyMap<string, string>,
  staticOwner?: string,
  staticSuper?: ReadonlyMap<string, string>,
  captures?: readonly CaptureBinding[],
  written?: readonly (ts.ParameterDeclaration | undefined)[],
  inferRet?: boolean,
  receiverKeys?: readonly CaptureKey[],
): void {
  const errorsBefore = errorsOf(diagnostics);
  const scope = functionScope(
    stub,
    callees,
    consts,
    bindings,
    structs,
    symbols,
    overrides,
    vars,
    sourceFile,
    nsPrefix,
  );
  scope.setOwner(stub);
  scope.setOwnerNode(node);
  scope.setSuperMethods(receiver?.superMethods ?? staticSuper);
  scope.setLocalFunctions(localFunctions);
  scope.setStaticClass(staticOwner);
  if (inferRet === true && node.body !== undefined && ts.isBlock(node.body)) {
    scope.setInferredReturn(stub);
    scope.setReturnsAbsence(bodyReturnsAbsence(node.body));
  }
  const prologue: Stmt[] = [];
  const afterBody: Stmt[] = [];
  if (receiver !== undefined) {
    if (receiver.mode === 'param') {
      scope.define({
        kind: 'param',
        name: 'this',
        type: receiver.type,
        mutable: false,
        irName: 'self_',
      });
    } else {
      if (receiver.mode === 'ctor') scope.setSuperCtor(receiver.superCtor);
      const parts = ctorParts(receiver, scope, sourceFile, diagnostics);
      prologue.push(...parts.prologue);
      scope.setAfterSuper(parts.afterSuper);
      afterBody.push(...parts.afterBody);
    }
  }
  const declaredParams: readonly (ts.ParameterDeclaration | undefined)[] =
    written ?? node.parameters;
  // Verifies: Rule 8.8. A whole write rebinds a value local, never the caller's argument.
  const rebound = new Set<ts.Node>();
  const seeTarget = (target: ts.Expression): void => {
    target = skipParens(target);
    if (ts.isIdentifier(target)) {
      const declared = declarationOf(target);
      if (declared !== undefined && declaredParams.includes(declared as ts.ParameterDeclaration))
        rebound.add(declared);
    }
  };
  const seeWrites = (at: ts.Node): void => {
    if (ts.isTypeNode(at)) return;
    let target: ts.Expression | undefined;
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      target = at.left;
    if (
      (ts.isPrefixUnaryExpression(at) || ts.isPostfixUnaryExpression(at)) &&
      (at.operator === ts.SyntaxKind.PlusPlusToken || at.operator === ts.SyntaxKind.MinusMinusToken)
    )
      target = at.operand;
    if (target !== undefined) seeTarget(target);
    ts.forEachChild(at, seeWrites);
  };
  if (node.body !== undefined) seeWrites(node.body);
  const parameterLocals: Stmt[] = [];
  const copied: { declared: ts.ParameterDeclaration; param: FuncDecl['params'][number] }[] = [];
  const offset = stub.params.length - declaredParams.length;
  const parameterNames = new Set<string>();
  stub.params.forEach((p, i) => {
    if (i < offset) return;
    const declared = declaredParams[i - offset];
    if (declared === undefined) {
      scope.define({
        kind: 'param',
        name: `#${p.name}`,
        irName: p.name,
        type: p.type,
        mutable: true,
      });
      return;
    }
    if (parameterNames.has(p.name) || scope.hasInCurrent(p.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        declared.name,
        `Duplicate parameter "${p.name}" in this scope.`,
        TS_CODES.DUPLICATE_SYMBOL,
      );
      return;
    }
    parameterNames.add(p.name);
    // Implements: Rule 8.23
    const storage = stub.kernel === true && p.type.kind === 'array' && p.type.size === undefined;
    if (p.mode === 'inout' && !storage) {
      const place = scope.define(
        { kind: 'local', name: p.name, type: p.type, mutable: true, reference: true },
        false,
        true,
      );
      scope.bindDeclaration(declared, place);
      return;
    }
    const copy =
      rebound.has(declared) && !storage && p.type.kind !== 'texture' && p.type.kind !== 'sampler';
    const stored = scope.define({
      kind: 'param',
      name: copy ? `#input_${p.name}` : p.name,
      ...(copy ? { irName: p.name } : {}),
      type: p.type,
      mutable: true,
      ...(storage ? { space: 'storage' as const } : {}),
    });
    scope.bindDeclaration(declared, stored);
    if (copy) copied.push({ declared, param: p });
  });
  const localNames = new Map<string, string>();
  for (const { declared, param } of copied) {
    const local = scope.define(
      { kind: 'local', name: param.name, type: param.type, mutable: true },
      true,
    );
    scope.bindDeclaration(declared, local);
    localNames.set(param.name, local.irName ?? local.name);
    parameterLocals.push({
      s: 'var',
      name: local.irName ?? local.name,
      type: param.type,
      init: { op: 'varref', name: param.name, type: param.type },
    });
  }
  setParameterLocals(stub, localNames);
  const self = scope.resolve('this');
  if (self !== undefined) {
    scope.bindDeclaration(THIS_CAPTURE, self);
    for (const k of receiverKeys ?? []) scope.bindDeclaration(k, self);
  }
  for (const c of captures ?? []) {
    const named = c.byName && !scope.hasInCurrent(c.binding.name);
    const ir = c.binding.irName ?? c.binding.name;
    const stored = scope.define(named ? c.binding : { ...c.binding, name: `#${ir}`, irName: ir });
    scope.bindDeclaration(c.key, stored);
  }
  const recordName = (): void => {
    if (node.name === undefined || !ts.isIdentifier(node.name)) return;
    if (currentCopy() === stub.name) return;
    recordDeclaration(symbols, sourceFile, node.name, {
      name: shown ?? stub.name,
      kind: 'function',
      type: stub.ret,
      params: stub.params.slice(offset).map((p) => ({ name: p.name, type: p.type })),
    });
  };
  if (inferRet !== true) recordName();
  stub.params.forEach((p, i) => {
    if (i < offset) return;
    const nameNode = declaredParams[i - offset]?.name;
    if (nameNode === undefined || !ts.isIdentifier(nameNode)) return;
    recordDeclaration(symbols, sourceFile, nameNode, { name: p.name, kind: 'param', type: p.type });
  });
  let body =
    inferRet === true && ts.isArrowFunction(node) && !ts.isBlock(node.body)
      ? inferredArrowValue(node.body, stub, sourceFile, scope, diagnostics)
      : ts.isArrowFunction(node) && !ts.isBlock(node.body)
        ? typeKey(stub.ret) === 'void'
          ? lowerVoidArrowBody(node.body, sourceFile, scope, diagnostics)
          : lowerArrowValue(node.body, stub, sourceFile, scope, diagnostics)
        : lowerStatements((node.body as ts.Block).statements, sourceFile, scope, diagnostics);
  reportSharedObjects(node, sourceFile, diagnostics);
  if (inferRet === true) recordName();
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && hasNoWrittenResult(node, sourceFile)) {
    noteCarriedReturn(
      sourceFile,
      stub.name,
      node.body,
      (callee) => scope.resolveCallee(callee) === undefined && scope.resolve(callee) === undefined,
    );
  }
  // Implements: Rule 7.10
  if (
    isOptional(stub.ret) &&
    node.body !== undefined &&
    ts.isBlock(node.body) &&
    receiver?.mode !== 'ctor' &&
    !alwaysReturns(body)
  ) {
    const inner = optionalInner(stub.ret)!;
    body = [
      ...body,
      { s: 'return', expr: absentOf(stub.ret, inner, (n) => scope.structByName(n)) },
    ];
  }
  if (scope.pendingAbsentReturns() > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.name ?? node,
      `"${shown ?? stub.name}" returns undefined and no value, so nothing says what its result ` +
        `is: write a result type, ": T | undefined", or return a value on another path (Rule 8.19).`,
      TS_CODES.RETURN_SHAPE,
    );
    scope.dropAbsentReturns();
  }
  if (receiver !== undefined && receiver.mode === 'ctor') {
    const self = selfRef(receiver.type, scope);
    const early = collectReturns(body);
    if (afterBody.length > 0 && early.length > 0) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.name ?? node,
        `"${shown ?? stub.name}" runs a constructor it inherits, and the initializers of the ` +
          `classes below the one that declared it run when that body returns; a "return" ` +
          `inside it would skip them. Declare a constructor on the class, or end the body ` +
          `without "return".`,
        TS_CODES.CLASS_MEMBER,
      );
    }
    for (const r of early) if (!r.expr) (r as { expr?: Expr }).expr = self;
    const pending = scope.afterSuperPending() ? scope.takeAfterSuper() : [];
    body = [...prologue, ...pending, ...body, ...afterBody, { s: 'return', expr: self }];
  } else if (receiver !== undefined && receiver.mode === 'inout') {
    body = [...prologue, ...body];
  }
  body = [...parameterLocals, ...body];
  const kernelMethodNames = new Map<string, string>();
  if (stub.kernel === true) {
    const gaps: KernelInlineGap[] = [];
    body = inlineKernelMethods(
      body,
      stub.params.map((p) => p.name),
      gaps,
      kernelMethodNames,
    );
    for (const g of gaps) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          g.why === 'return'
            ? `A method on an array of "${shown ?? stub.name}" hands its elements to a function that returns from inside its body. On a kernel function's array the function is written into the loop: end it with one return.`
            : `A method on an array of "${shown ?? stub.name}" is called in a loop's header, where it would run on every iteration. Read it into a const before the loop.`,
          TS_CODES.UNSUPPORTED,
        ),
      );
    }
    body = countPushedLengths(body, pushedParams(body));
    body = guardKernelBody({ params: stub.params, body });
  }
  (stub as { body: readonly Stmt[] }).body = body;
  // Implements: Rule 8.22
  if (stub.kernel === true)
    kernelSourceNames.set(stub, {
      locals: new Map([...scope.sourceNames(), ...kernelMethodNames]),
      ...writtenModuleNames(scope, sourceFile),
    });
  if (node.type === undefined) recordInferredReturn(sourceFile, node, stub.ret);
  if (hasNoWrittenResult(node, sourceFile) && stub.stage !== undefined) {
    settleInferredEntryResult(
      stub,
      node,
      sourceFile,
      diagnostics,
      structs,
      errorsOf(diagnostics) > errorsBefore,
    );
    if (typeKey(stub.ret) === 'void') return;
  }
  if (typeKey(stub.ret) === 'void') {
    for (const r of collectReturns(body)) {
      if (!r.expr) continue;
      diagnostics.push(
        diagnosticAtSpan(
          sourceFile,
          r.span,
          node.name ?? node,
          `Function "${shown ?? stub.name}" returns void but returns a value of type ` +
            `${authorTypeText(r.expr.type)}: write ": ${authorTypeText(r.expr.type)}" as its return ` +
            `type, or return nothing.`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
    }
    return;
  }
  for (const r of collectReturns(body)) {
    if (!r.expr) {
      diagnostics.push(
        diagnosticAtSpan(
          sourceFile,
          r.span,
          node.name ?? node,
          `Function "${stub.name}" returns ${authorTypeText(stub.ret)} but has a bare "return".` +
            newlineReturnRemedy(sourceFile, r.span),
          TS_CODES.RETURN_SHAPE,
        ),
      );
      continue;
    }
    if (typeKey(r.expr.type) !== typeKey(stub.ret)) {
      if (
        r.expr.op === 'construct' &&
        stub.ret.kind === 'struct' &&
        r.expr.type.kind === 'struct'
      ) {
        (r.expr as { type: ShaderType }).type = stub.ret;
        continue;
      }
      diagnostics.push(
        diagnosticAtSpan(
          sourceFile,
          r.span,
          node.name ?? node,
          inferRet === true
            ? `Function "${shown ?? stub.name}" returns ${authorTypeText(stub.ret)} at its first ` +
                `"return" and ${authorTypeText(r.expr.type)} at another; a function returns one type ` +
                `(Rule 8.19): make them agree, or write the return type.`
            : ts.isFunctionLike(node) && hasNoWrittenResult(node, sourceFile)
              ? decidedResultMismatch(node, shown, stub, r, captures, sourceFile)
              : `Function "${shown ?? stub.name}" return type mismatch: declared ${authorTypeText(stub.ret)}, got ${authorTypeText(r.expr.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
    }
  }
}

function errorsOf(diagnostics: readonly TsCompilerDiagnostic[]): number {
  return diagnostics.filter((d) => d.category === 'error').length;
}

function resourceStructsOf(
  bindings: readonly BindingDecl[],
  vars: readonly ModuleVarDecl[],
): Set<string> {
  const out = new Set<string>();
  const see = (t: ShaderType): void => {
    if (t.kind === 'struct') out.add(t.name);
    else if (t.kind === 'array') see(t.elem);
  };
  for (const b of bindings) see(b.type);
  for (const v of vars) see(v.type);
  return out;
}
