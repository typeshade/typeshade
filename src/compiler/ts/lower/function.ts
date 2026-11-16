// === Function lowering: two-pass signatures then bodies ===
//
// Implements: Rule 2.3, Rule 8.3 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
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
import type { ShaderType } from '../../../core/ir/types.js';
import { f32T, structT, voidT } from '../../../core/ir/types.js';
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
  privateFieldTableOf,
  readonlyFieldTableOf,
  recoveredUsesDroppedSoFar,
  refusedDeclarationsOf,
  refusedModuleNames,
  restrictedFieldTableOf,
  withheldTableOf,
  writeRules,
  type CaptureKey,
} from '../context.js';
import { checkDefiniteAssignment } from '../definite.js';
import { checkValueArrayWritesByEffects } from '../value-array-write.js';
import {
  diagnosticAtSpan,
  keepUses,
  makeDiagnostic,
  noteCycleMembers,
  noteUse,
} from '../diagnostic.js';
import { calleeNamesOf } from '../function-call-graph.js';
import { instanceUsesOf } from '../generic-structs.js';
import {
  currentTypeArguments,
  inferFrom,
  instanceName,
  typeSuffix,
  withTypeArguments,
} from '../generics.js';
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
import { type CollectedStruct } from '../structs.js';
import {
  recordDeclaration,
  recordInferredReturn,
  recordResultCopies,
  type DeclaredSymbolSink,
} from '../symbols.js';
import { mapTsTypeToShaderType } from '../type-map.js';
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
import { lowerExpression } from './expression.js';
import { argumentSignature, capturesOfArgument, functionArgument } from './function-args.js';
import {
  type FunctionNode,
  type ScopedConst,
  decoratorsOf,
  parseSignature,
  refuseQualifiedParameter,
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
import { bodyReturnsAbsence } from './optional-values.js';
import {
  filledCallsOf,
  paramDefaultNodes,
  recordParamDefaults,
  setParamDefault,
} from './param-defaults.js';
import { checkReferenceAliases, qualifiersOf } from './references.js';
import { lowerStatements, lowerVoidArrowBody } from './statement.js';
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

/** What the source calls each function, each static field and each constant of a namespace or an
 *  enum of the module that the module emits under another name: `Voice.tally` for a class's
 *  `Voice_tally`, `Ns.f` for a namespace's `Ns_f`, `pick` for the instance `pick_u32` of a generic
 *  function, `bump` for the local function `count_bump`, `Voice.count` for the module variable
 *  `Voice_count` of a static field the file writes, `Voice.OFFSET` for the module constant
 *  `Voice_OFFSET` of one it does not, `Ns.K` for the `Ns_K` of a namespace's constant and `Mode.B`
 *  for the `Mode_B` of an enum's member. A name declared at the top level is emitted as written and
 *  has no row. The functions are read from the callee table, which holds every function of the file
 *  before any body is lowered, and the instances and the copies made by the calls lowered so far.
 *  The rows are in two tables, since a call reads a function and a `varref` or a `constref` a value,
 *  and neither reads a parameter's name (`KernelNames`, #988). */
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
    // A static field that holds a function is a function of the module, named above.
    if (holdsFunction(decl)) continue;
    const dot = field.indexOf('.');
    const member = emittedMemberName(field.slice(dot + 1));
    const name = staticConstName(field.slice(0, dot), member);
    values.set(scope.resolveModuleValue(name)?.irName ?? name, field);
  }
  for (const [emitted, written] of writtenConstNames(sourceFile)) values.set(emitted, written);
  return { values, functions };
}

/** What `this` is to an arrow function inside the class function `cf`: the method's object, or
 *  inside a static member the class the call names (Rule 8.13). */
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
  // Every function the file declares, at the top level and inside a namespace, with the
  // emitted name each takes (T4, #92): a top-level `warm` is `warm`, and the same function
  // inside `namespace Palette` is `Palette_warm`.
  const decls: { node: ts.FunctionDeclaration; irName: string | undefined; prefix: string }[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, diagnostics, (stmt, prefix) => {
    // A stage call, `const vs = vertex(function vs(…) { … })`, is refused (`refuseStageCalls`,
    // changes 0130 and 0140). It is still read as the function it wraps, under the constant's
    // name, so that refusal is the one diagnostic for it (Rule 12.4).
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
      // A namespace holds functions, constants, classes and namespaces. The consts are
      // module-const.ts's and the classes are structs.ts's, under the same flattened name
      // (#107); the rest has no flattened form. Only the namespace's own statements are refused
      // here, since a top-level statement of any kind is semantic.ts's to judge. An interface
      // and an object-type alias are structs.ts's too, which refuses one here itself, and a
      // `var` is semantic.ts's, in a namespace as anywhere else.
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
    // A mixin is a function whose body is one `return class … { … }` (T8, #92). It runs when
    // the file is compiled, in structs.ts, and emits no function of its own: a class
    // expression is no GPU value, and there is nothing for a call to it to mean at run time.
    if (isMixinDeclaration(stmt)) return;
    decls.push({
      node: stmt,
      irName: prefix === '' ? undefined : namespaceMemberName(prefix, stmt.name?.text ?? ''),
      prefix,
    });
  });
  // An overload signature is a declaration of the same function with no body, above the one
  // that has it (roadmap 0.3 item T6, #92). WGSL has no overloading and TypeScript's own rule
  // makes the implementation signature the one every call is checked against, so the
  // signatures are skipped and the implementation is lowered. A body-less declaration with no
  // implementation, and an ambient `declare function`, keep the error they had: neither names
  // a function this module can emit.
  const implemented = new Set<string>();
  for (const { node, irName } of decls) {
    if (node.body && node.name) implemented.add(irName ?? node.name.text);
  }
  const isAmbient = (node: ts.FunctionDeclaration): boolean =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
  const callees = new Map<string, FuncDecl>();
  // What this file knows about its own functions beside the callee table: the names it could
  // not lower, so a call to one says nothing instead of "Unknown function" (T10, #92), and the
  // generic ones with the hook that makes an instance (T9, #92).
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
    // An async function or a generator is semantic.ts's refusal, and its body is that one
    // mistake: it is not lowered, and a call to it, `h(a)` or `N.h(a)`, says nothing more
    // (Rule 12.4).
    if (isAsyncOrGenerator(stmt)) {
      refused.add(irName ?? stmt.name?.text ?? '');
      continue;
    }
    // A generic function is compiled once per set of argument types the file calls it with
    // (roadmap 0.3 item T9, #92), so it has no signature of its own: `pick<T>` is not a
    // function the module emits, `pick_f32` and `pick_vec3` are. Held aside for the
    // instantiator below, which a call site reaches through the scope. So is one that takes a
    // function, once per set of functions a call hands it (Rule 8.18): `apply_sq`.
    const fnAt = functionParams(stmt);
    if (
      ((stmt.typeParameters?.length ?? 0) > 0 || fnAt.size > 0) &&
      stmt.body &&
      stmt.name !== undefined
    ) {
      const base = irName ?? stmt.name.text;
      const isEntry = decoratorsOf(stmt).length > 0 || stageCallOfDeclaration(stmt) !== undefined;
      // An entry is compiled once, as the pipeline calls it, with no type arguments, so a generic
      // one has no instance to compile, and nothing would say so (Rule 8.9).
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
        // An entry's parameters come from the pipeline, and no call hands it anything. A stage
        // call's function is an entry as a decorated one is (change 0111).
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
      // A generic function takes no qualified parameter (Rule 8.25), said where it is
      // declared, since its body is lowered only where a call makes an instance and one nothing
      // calls says nothing.
      if ((stmt.typeParameters?.length ?? 0) > 0) {
        const takes = stmt.parameters.find((p) => qualifiersOf(p).length > 0);
        if (takes !== undefined) {
          const refusal = refuseQualifiedParameter(takes, qualifiersOf(takes), undefined, {})!;
          // The type form's own refusal says it (`TS8028`, change 0137; Rule 12.4).
          if (!refusal.typeForm)
            pushDiag(diagnostics, sourceFile, refusal.at, refusal.message, TS_CODES.REFERENCE);
          refused.add(base);
          continue;
        }
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
  // A class's methods, static functions and constructor are functions of the module (#86),
  // registered before any body is lowered so a call in either direction resolves. The emitted
  // name is `Struct_member`; a top-level function of that name is a clash, said on both.
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
  // A local function is a function of the module, named after the body that declares it
  // (roadmap 0.3 item T7, #92). Collected before any body is lowered, so a call to one
  // resolves; the alias from the written name to the emitted one rides on the scope, which is
  // what lets two bodies each declare an `f`. A body sees its own local functions and those of
  // every body around it, as TypeScript's scopes do, so a helper may call its sibling.
  const lifted: Lifted[] = [];
  const aliasesOf = new Map<string, Map<string, string>>();
  // The local functions that take a function, by emitted name: each call makes a copy.
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
      // One that takes a function is a pattern a call copies (Rule 8.18): named in its body, and
      // made where a call hands it its functions, with its own local functions per copy.
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
      // An arrow function's `this` is the one around it; any other function's is its own,
      // though it may still hand the method's object on to an arrow it calls.
      const selfHere =
        self === undefined
          ? undefined
          : { ...self, bindsThis: self.bindsThis && ts.isArrowFunction(fn.node) };
      into.push({ fn, around, self: selfHere, ...(said !== diagnostics ? { said } : {}) });
      // A local function's own body is an owner in turn, so a helper inside a helper works.
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
  // The module top level, and each namespace body, where a `const f = (…) => …` is already a
  // module function: it takes the namespace's flattened name (`N_f`), which is how a call to it
  // inside that namespace resolves with no alias at all (T4, #92).
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
  // What a body a class inherits says goes to a list of its own, which `sayInherited` reads once
  // every body is lowered; its local functions' diagnostics go there too.
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
    // A class's function that takes a function is lowered once for each copy a call makes, and
    // its local functions with it (Rule 8.18).
    if (cf.node?.body && cf.takesFunctions === undefined) {
      // Inside a method, an arrow function's `this` is the method's object, and inside a static
      // member the class the call names (Rule 8.13).
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
  // The name each instance's author wrote: `pick` for `pick_f32`.
  const writtenAs = new Map<string, string>();
  // ═══ A return type the body says (Rule 8.19) ═══
  //
  // A function that writes no return type has one once its body is lowered, and a call may
  // need it before the body's turn: that call lowers the body first (`fns.ensure`). Each such
  // function waits in `pendingFill` with what lowers its body, until a call or its turn comes.
  // `inferring` holds the ones whose body is being lowered, whose return type is not known
  // yet, and `filling` every body being lowered, innermost last: a call back into one of them
  // closes the cycle `filling` holds from it up.
  const pendingFill = new Map<FuncDecl, () => boolean>();
  const inferring = new Set<FuncDecl>();
  const filling: FuncDecl[] = [];
  // The ones whose body did not lower, and so says nothing it returns: a call of one adds
  // nothing to what the body said. So is one a call cycle runs through, whose return type
  // waits on itself.
  const unsaid = new Set<FuncDecl>();
  const cyclic = new Set<FuncDecl>();
  // Each call a cycle closes at, said once however many paths reach it.
  const cycleAt = new Set<ts.Node>();
  // The cycles said above with the functions they run through, to record the declarations of.
  const cycleNotes: { diagnostic: TsCompilerDiagnostic; path: readonly FuncDecl[] }[] = [];
  // A default is lowered before any body (below), so it cannot wait on one.
  let bodiesOpen = false;
  const shownOf = (f: FuncDecl): string =>
    writtenAs.get(f.name) ?? classFns.find((cf) => cf.stub === f)?.shown ?? f.name;
  /** Lower a body with `stub` on the stack of those being lowered; `infers` when its return
   *  type is the body's to say. `node` is the function written, which may hold a refusal
   *  semantic.ts said, at which its lowering stopped and added nothing. */
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
    // A body that dropped a use of a binding whose declared type was refused did not lower
    // either, and its refusal was said at the declaration (`dropsRecoveredUse`). It never got to
    // the `return` that says its type, so its callers would be told it returns `void` (Rule 12.4).
    if (infers && typeKey(stub.ret) === 'void' && recoveredUsesDroppedSoFar() > droppedBefore) {
      unsaid.add(stub);
    }
  };
  /** Lower the body `stub` waits on, if it still waits. False when it cannot be lowered yet:
   *  a variable it captures is not lowered where it is declared. */
  const runPending = (stub: FuncDecl): boolean => {
    const fill = pendingFill.get(stub);
    if (fill === undefined) return true;
    pendingFill.delete(stub);
    if (fill()) return true;
    pendingFill.set(stub, fill);
    return false;
  };
  /** The call graph `checkRecursion` walks: the functions the file and its classes declare. In
   *  a single file a function is called by the name it is declared under, so the graph key and
   *  the resolver are both just `callees`. A method called through its object (`r.at(t)`) is
   *  not an identifier call and is not in this graph; the lowered calls are where its cycle
   *  shows. */
  const recursionGraph = (): RecursionNode[] => [
    ...ready.map(({ node, stub }) => ({
      // The EMITTED name, which for a namespace's function is the flattened one (T4, #92):
      // the graph's keys and the call resolver are both `callees`, which is keyed by it.
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
        // It captures a variable its declaration did not lower, which said why there. A call
        // dropped without a word anywhere would be a program that compiles wrong, so a file
        // with no error yet hears what this one stands on.
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
    // A call back into a body still being lowered, whose return type is not known yet: a call
    // cycle, which WGSL refuses anyway (Rule 8.4). One every hop of which the syntactic check
    // follows is that check's to name, at the call it closes on; the rest are named here.
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
        // The declarations are known once every body is lowered, and a local function is
        // added to `nodeByName` after its body.
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
  // ═══ A result its callers decide (Rule 8.19, change 0134 item 1) ═══
  //
  // A function, a method, a getter, a local or arrow function, or an instance of a generic
  // function, that writes no result type and whose first `return` is a written integer or a value
  // no use has decided (`noteCallerDecided`), takes its result from its calls. Each call records
  // the type its own use asks (`callerDecidedCall`), and the next pass reads what the calls asked
  // (`askedOf`): where they asked one type, the function returns it; where they asked two or
  // more, or the function is one the host calls (an export), the function keeps the `f32` result
  // under its own name, and a call that asks another type takes a copy named as an instance is
  // (`g_u32`, Rule 8.9), made the first time a call asks for it (Amendment A5 of change 0134,
  // "작성자 기본값 유지"; "export는 f32 유지"). Each copy infers its own locals (Amendment A1,
  // "사본마다 추론"): its body is lowered under its own key (`inCopy`).
  /** The functions whose result the calls fixed for this pass: lowered as if it were written. */
  const decidedByCallers = new Set<FuncDecl>();
  const copiesOf = new Map<FuncDecl, Map<string, FuncDecl>>();
  /** Plans `o.stub`; true when its calls fixed its result, so its body is lowered against it. */
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
    // The hover names each result type at the declaration (item 4 of change 0134); the host
    // calls an exported function at the `f32` it keeps.
    const listed = new Map(asked);
    if (o.exported) listed.set('f32', f32T);
    // One type is recorded too: a method, a getter or a local or arrow function its calls fixed
    // hovers as that type, as a function of the file does (Rule 12.7).
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
    // The copy's local functions are named after it (`g_u32_inc`), so a name is free only when
    // no function of the module begins with it either, where the body declares any.
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
  /** The local functions of a copy's body, its own (`g_u32_inc`): what they capture has the
   *  copy's types. Lowered after the copy's body with `fillLifted`. */
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
    // Lowered outside any instance of a generic function, wherever the call that asks is.
    pendingFill.set(r.stub, () => {
      withTypeArguments(undefined, () => fillReady(r, true));
      return true;
    });
  }
  // A method, an accessor half or a constructor, into the list its class's body says things to.
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
    // What the body of a generic class's instance says is true of the places that write the
    // instance, `Box<P>`: a program that imports the class reports it at the first of them its
    // entry file writes (#1186). The last recorded use is the first one read.
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
    // A method, a getter or a static function its calls decide (Rule 8.19, change 0134): a
    // member of an exported class is one the host calls.
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
  // A setter whose value writes no type beside a getter that writes none takes what the
  // getter's body returns, as TypeScript types it (Rule 8.19). Its turn, or an assignment that
  // needs the type first, lowers the getter's body first. With no getter, or beside one that
  // returns nothing, the value has no type (TypeScript's implicit `any`, TS7006), which is
  // refused where the value is declared and nowhere else (Rule 12.4).
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
  // A local function's body, once the body that declares it has lowered what it captures. False
  // when that is not yet so.
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
  /** Hold each local function of `list` that writes no return type until a call needs its body
   *  or its turn comes, to be lowered under the type arguments in force here (Rule 8.19). */
  const holdLifted = (
    list: readonly Lifted[],
    sf: ts.SourceFile,
    said: TsCompilerDiagnostic[],
  ): void => {
    const typeArgs = currentTypeArguments();
    for (const l of list) {
      if (!l.fn.infers) continue;
      // A local or arrow function its calls decide (Rule 8.19, change 0134); one at the top level
      // that the file exports is one the host calls.
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
  // Every default, lowered before any body, since a body may call a function declared after it
  // and the call needs the default already in hand (roadmap 0.3 item T7, #92). The scope is the
  // module's, with no parameters in it, which is why a default that reads one was refused at
  // the signature.
  //
  // To a fixed point, because one default may be `g()` where `g` itself has a default to fill
  // in, in either declaration order. Every pass but the last writes its diagnostics to a
  // scratch list and throws them away: a default that could not be lowered yet is not yet an
  // error. The pass that adds nothing runs once more into the real list, this time saying so.
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
  // Each local function's body after the bodies around it, whose declarations say what each
  // variable it captures is (Rule 8.17); then a capture handed on to a local function that
  // writes it is made the caller's to write back.
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
  // One instance of a generic function per set of argument types (roadmap 0.3 item T9, #92).
  // Made where a call asks for it rather than in a pass of its own, because a call is the only
  // thing that says which types: `pick(1., 2.)` is what decides that `pick_f32` exists.
  //
  // The instance is pushed into `funcs` as it is made, which puts it ahead of the body that
  // asked for it — WGSL wants a function declared before it is called, and the bodies below
  // push themselves only after they are filled.
  const instances = new Map<string, FuncDecl>();
  // The functions whose instance is being made, innermost last: one asked for again while its
  // instance is made, for other function arguments, would be made again without end (Rule 8.4).
  const making: string[] = [];
  /** A name no function of the module has yet: `base`, or `base_1`, `base_2` and so on. */
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
    // A function handed over by its name says what the type parameters in its parameter's type
    // are, as an argument's value does for its own.
    const named = new Map<number, { params: readonly ShaderType[]; ret: ShaderType }>();
    for (const i of fnAt) {
      const arg = node.arguments[i];
      const x = arg === undefined ? undefined : skipParens(arg);
      if (x === undefined || !ts.isIdentifier(x)) continue;
      const decl = scope.resolveCallee(x.text);
      if (decl === undefined) continue;
      // What it returns, which one that writes no return type says once its body is lowered
      // (Rule 8.19); one that captures a variable not declared yet here is `functionArgument`'s
      // to refuse, below.
      if (captureArguments(decl, x.text, x, sf, scope, []) === undefined) continue;
      if (!scope.calleeReady(decl, x, sf, diags)) continue;
      const captured = file.captures.get(decl.name)?.length ?? 0;
      named.set(i, { params: decl.params.slice(captured).map((p) => p.type), ret: decl.ret });
    }
    const bound = typeArgumentsFor(generic.node, order, node, argTypes, sf, diags, named);
    if (bound === undefined) return undefined;
    return withTypeArguments(bound, (): FuncDecl | undefined => {
      // Each function argument, as the function of the module it stands for (Rule 8.18).
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
      // `|` joins the key, which no name holds, so `both(a_b, c)` and `both(a, b_c)` are two.
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
      // An instance or a copy is named as the author wrote its template where a message says which
      // function it is: `pick` for the instance `pick_u32` and `apply` for the copy `apply_inc`,
      // and `Ns.pick` for `Ns_pick_u32` and `Ns.apply` for `Ns_apply_count_f` in a namespace. Its
      // stub is made here, not where the template is declared, so this is where the name is
      // recorded (Rule 8.22).
      recordTemplateInstance(stub, generic.node);
      // What the functions handed over capture (Rule 8.17), which this instance takes ahead of
      // its own parameters and hands on to them: typed as the calling body holds each.
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
      // Registered BEFORE the body is lowered, so a generic that calls itself at the same types
      // finds this instance rather than making another one forever.
      instances.set(key, stub);
      callees.set(emitted, stub);
      writtenAs.set(emitted, name);
      making.push(name);
      // What the body says of this instance is true of the call that asked for it: a program
      // that imports the function reports it at that call (#1186).
      const saidBefore = diags.length;
      try {
        // In the body, a parameter of function type names the function handed over.
        const handed = new Map<string, string>();
        for (const t of targets) {
          if (ts.isIdentifier(t.param.name)) handed.set(t.param.name.text, t.fn.name);
        }
        // The instance's own local functions, whose types may name the type parameters: one set
        // per instance, as the body around them is (`pick_f32_sw`).
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
        // With no return type written, the body says it (Rule 8.19), or this instance's calls
        // do (change 0134): its copies are this instance's (Rule 8.9). A result type the
        // editor's projection wrote is not the author's, as for any function (#1277).
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
  // A local function that takes a function (Rule 8.18): one copy for each set of functions its
  // calls hand it, lifted into the body the call is in as an arrow function written as an
  // argument is. It takes what its own body captures there, by reference once it writes it, and
  // what the functions handed over capture, which it only hands on.
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
    // What its body reads from the functions around it, `this` in an arrow function inside a
    // method, and what the local functions it calls capture; not a call of its own parameters.
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
        // A captured local declared above the call may be absent because its initializer was
        // refused. Keep that cause, rather than claiming the declaration is below this call.
        if (
          k !== THIS_CAPTURE &&
          k.getSourceFile() === sf &&
          k.end <= node.pos &&
          variableRefused(k, sf, [...diagnostics, ...diags])
        )
          return undefined;
        // Read before its declaration, where TypeScript throws: the call runs the function now.
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
        // Captured by a function handed over and named nowhere in this body: handed on.
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
    // Registered BEFORE the body is lowered, so a copy that calls itself with the same functions
    // finds this one rather than making another forever.
    localCopies.set(key, stub);
    callees.set(emitted, stub);
    writtenAs.set(emitted, fn.localName);
    // To the author a copy is the one local function it is made from (#987).
    const declared = writtenFunctionOf(fn.stub);
    if (declared !== undefined) recordLocalFunction(stub, declared);
    making.push(name);
    try {
      // In the body, a parameter of function type names the function handed over.
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
  // A method, a static method or a constructor that takes a function (Rule 8.18): one copy for
  // each set of functions its calls hand it, as a function of the file is, and made where a
  // call asks for it. The copy takes what the functions handed over capture ahead of its own
  // parameters, then its object, then the rest.
  //
  // One variable, one reference. When a function handed over captures the very variable the
  // call is on (`this.each((i) => { this.total += … })`, `g.each(() => g.n++)`), TypeScript
  // has one object where the copy would have two: the copy's object stands for that capture
  // too, by reference when the caller may write it, so the method reads what the function
  // wrote. A capture of the variable that HOLDS the object, through a field or an element of it,
  // would be a second reference into one variable, which WGSL refuses when either is written
  // (Alias Analysis); that call is refused first (Rule 12.6).
  const memberCopies = new Map<string, { decl: FuncDecl; writes: boolean }>();
  const makingMembers: string[] = [];
  /** The capture key of the variable `e` names: `this` in a method, or a local or a parameter. */
  const placeKey = (e: ts.Expression, scope: LoweringScope): CaptureKey | undefined => {
    let x = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    // `super.m(...)` runs on this body's own object.
    if (x.kind === ts.SyntaxKind.ThisKeyword || x.kind === ts.SyntaxKind.SuperKeyword) {
      return scope.resolve('this') !== undefined ? THIS_CAPTURE : undefined;
    }
    return ts.isIdentifier(x) ? declarationOf(x) : undefined;
  };
  /** The capture key of the variable a field or element path `e` starts from. */
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
    // What the functions handed over capture, once each, in the order they are met.
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
    // A method's object and a constructor's object under construction are both `self_`.
    const taken = new Set(ownParams.map((p) => p.name));
    if (cf.kind !== 'static') taken.add('self_');
    const captures: CaptureBinding[] = [];
    const hidden = own.map((k): FuncDecl['params'][number] => {
      const type = holderOf(k)?.type ?? voidT;
      // `this` of the calling body, which is not the copy's own object: a name of its own.
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
    // Registered BEFORE the body is lowered, so a copy that calls itself with the same functions
    // finds this one rather than making another forever.
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
      // In the body, a parameter of function type names the function handed over.
      const handed = new Map<string, string>();
      for (const t of targets) {
        if (ts.isIdentifier(t.param.name)) handed.set(t.param.name.text, t.fn.name);
      }
      // Its own local functions, one set per copy, as the body around them is.
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
  // An arrow function or a function expression written as an argument (Rule 8.18): a local
  // function of the body the call is in, lifted where the call is lowered, once for each body
  // lowered, since its captures are that body's.
  // A function the front end builds itself (surface §63): an array's method, made for the array
  // type and the function a call hands it the first time a call asks for it. What it captures
  // is the function's, which a call passes ahead of the rest (Rule 8.17).
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
    // `(x?: f32) => …` takes the absent value where a call omits `x` (change 0093, D6).
    recordParamDefaults(stub, node.parameters, 0, true);
    callees.set(name, stub);
    // What it captures, read from the body it is written in (Rule 8.17).
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
        // Read before its declaration, where TypeScript throws: the call runs the function now.
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
    // Its own local functions, which see the ones of the body it is written in.
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
  // A body lowered for a class that inherits it says what it says into a list of its own. What
  // it shares with the body the declaring class lowered was said there, once (Rule 12.4); a
  // static that fails only for the inheriting class, where `this` is that class, is an error
  // where something calls it and nothing where nothing does (Rule 8.13), which is decided once
  // every body is lowered and the calls are known.
  for (const cf of classFns) {
    // One that takes a function has no body of its own: each call made the copy it needs.
    if (cf.takesFunctions !== undefined) continue;
    // One whose body says its return type, or a setter whose value takes its getter's, and that
    // a call lowered already, is not lowered again.
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
      // A class with no constructor still answers `new P()`: the zero struct with its field
      // initializers, and nothing else.
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
  // Each function the file declares, in order; one whose body says its return type and a call
  // lowered already is not lowered again.
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
  // Once every body is lowered, the instances and the functions written as arguments among
  // them: a capture handed on to one that writes it is the caller's to write back (Rule 8.17).
  propagateCaptureRefs(
    [...file.captures.keys()].flatMap((n) => {
      const f = callees.get(n);
      return f === undefined ? [] : [f];
    }),
    callees,
    file,
  );
  sayInherited(inheritedSaid, funcs, new Set(classFns.map((cf) => cf.stub)), diagnostics);
  // Before the bodies are handed on: a call cycle emits WGSL Tint refuses (#48), and no gate
  // downstream of here was looking for one.
  const graph = recursionGraph();
  checkRecursion(graph, diagnostics);
  // A cycle through a call on a value (`this.g(n)`, `o.m()`), a getter, a setter or `new`, none
  // of which names a function in its text: read off the calls the bodies lowered to (Rule 8.4).
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
  checkEntryStageUses(funcs, vars, nodeByName, sourceFile, diagnostics);
  // A read before an assignment, and an `@out` parameter's definite writes, on the source
  // (Rules 7.6 and 8.25).
  checkDefiniteAssignment(sourceFile, diagnostics);
  // A write to a value array parameter that only the lowered body shows: a method on an element
  // (Rule 8.23, change 0138, Amendment A15).
  checkValueArrayWritesByEffects(
    funcs,
    bindings,
    vars,
    (fn) => nodeByName.get(fn),
    sourceFile,
    diagnostics,
  );
  // Two references to one place in one call, read off the lowered calls once every callee says
  // what it reads and writes (Rule 8.25).
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
  return funcs;
}

/** What the bodies lowered for an inheriting class said, now that every call is known. A
 *  diagnostic the file already carries at the same place is left out (Rule 12.4).
 *
 *  A body lowered again for a class that inherits it can fail for that class alone: `this.#k`
 *  in a static `Derived` inherits, `weigh(this)` where `weigh` takes the base. Such a copy is
 *  refused where a call reaches it and dropped where none does, as TypeScript, which lowers
 *  nothing per class, has nothing to say about a body no one runs that way. What reaches it is
 *  a function that is not a class's own (an entry, a top-level function), through any chain of
 *  calls; a class's function that nothing so reaches and that calls a dropped copy is dropped
 *  with it, so no call is left without its function. A copy of an `abstract` class's method is
 *  the only lowering its body gets, so what it says is said whether or not anything calls it;
 *  so is a copy of its static that builds its value with `new this()` (0020), which the abstract
 *  class itself has no lowering of. Identical missing-field reports in those copies name
 *  the affected classes together; different source spans or remedies stay separate. */
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
      // Only the receiver's name varies in this sentence. Do not erase other type names or
      // a different suggested field: those can identify a failure specific to one class.
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

/** Whether a statement inside a namespace is a `const`, which `module-const.ts` collects as
 *  the flattened constant `Ns_NAME` and this walk therefore leaves alone. */
function isNamespaceConst(stmt: ts.Statement): boolean {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

/** Every namespace name the file declares, flattened: `namespace A { export namespace B {} }`
 *  yields `A` and `A_B`, which is what `A.f()` and `A.B.f()` resolve against. */
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

/** The scope a function body is lowered in: the module's consts, bindings, overrides and
 *  variables defined once each, the struct table, the stage and the return type. Shared by
 *  {@link fillFunctionBody} and the constructor a class without one gets (#86). */
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
  /** The namespace whose body this function belongs to, flattened (T4, #92). */
  nsPrefix?: string,
): LoweringScope {
  const scope = new LoweringScope(callees, symbols);
  // A module-scope declaration refused before any function existed stays refused in every body.
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
  // The enum names, so a mistyped member reads as one rather than as an unknown identifier
  // (T1, #92); the members themselves are module constants and resolve through the scope.
  if (sourceFile) {
    scope.setEnums(sourceFile.statements.filter(ts.isEnumDeclaration).map((e) => e.name.text));
    scope.setNamespaces(namespaceNamesOf(sourceFile));
  }
  scope.setStage(stub.stage);
  scope.setResourceStructs(resourceStructsOf(bindings, vars));
  // `return 0` in a function declared i32/u32 types the literal from the signature (#8 A3),
  // and `return { … }` knows which struct it builds (#8 A11). One field, two readers.
  scope.setReturnType(stub.ret);

  // Every module-scope define is guarded, because `scope.define` THROWS on a repeat and this
  // is the last place a collision between two collectors can land. Each collector reports its
  // own duplicates, so a name arriving twice here has already been diagnosed — an override
  // beside a module const of the same name, say — and the second define would turn that
  // diagnostic into an exception out of `compile()` and out of the language service's
  // `getDiagnostics()`, where a squiggle belongs.
  const defineOnce = (b: Parameters<LoweringScope['define']>[0]): void => {
    if (!scope.hasInCurrent(b.name)) scope.define(b);
  };
  for (const c of consts) {
    defineOnce({
      kind: 'module',
      name: c.name,
      type: c.type,
      mutable: false,
      // A non-scalar const's `cpuValue` is the 0 the collector writes as a placeholder beside
      // its `valueExpr`, not a value; taking it as one made `v / Z` for any vector const `Z`
      // a division by zero to the constant folder (#68). The initializer rides along instead.
      constValue: c.type.kind === 'scalar' ? c.cpuValue : undefined,
      indexConstValue: moduleIndexConst(c, scope),
      ...(moduleAbstractConst(sourceFile, c.name) !== undefined
        ? { abstract: moduleAbstractConst(sourceFile, c.name) }
        : {}),
      ...(c.type.kind !== 'scalar' && c.valueExpr !== undefined ? { valueExpr: c.valueExpr } : {}),
    });
  }
  for (const b of bindings) {
    defineOnce({
      kind: 'binding',
      name: b.name,
      type: b.type,
      mutable: b.access === 'read_write',
      space: b.space,
    });
  }
  // An override reads as an `overrideref`, which no pass folds: its value arrives when the
  // pipeline is built, not when the module is compiled (#8 A7).
  for (const o of overrides) {
    defineOnce({ kind: 'override', name: o.name, type: o.type, mutable: false });
  }
  // A module variable (§24) reads and writes as a `varref`, like a binding; its space decides
  // what may hold an atomic and which stage may reach it.
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
  // Module values live outside the parameters and body locals, as in TypeScript (#429).
  scope.push();
  return scope;
}

/** An arrow function's expression body when nothing says what it returns (Rules 8.18, 8.19):
 *  its value, whose type the function's return type becomes. An assignment, `++` or `--`, and a
 *  call of a function that returns nothing, run as a statement, and the function returns
 *  nothing. */
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
  // An expression body of a written integer, or of a value no use has decided, is a result its
  // callers decide (Rule 8.19, change 0134 item 1), as such a first `return` is.
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

/** Whether `call` names a function of the file that returns nothing, its body lowered first
 *  when that is what says so (Rule 8.19). */
function callsVoidFunction(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const callee = skipParens(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  const decl = scope.resolveCallee(callee.text);
  // A barrier is a statement and nothing else (§25), where no function of the file takes its name.
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

/** Lower every default `stub`'s signature writes, in the module's scope (roadmap 0.3 item T7,
 *  #92). The result is spliced at each call that omits the argument, so it is lowered here,
 *  once, rather than at every call site: the two would be the same expression, and one
 *  diagnostic about a default belongs where the default is written.
 *
 *  A default that does not lower, or whose type is not its parameter's, keeps none; the call
 *  site then reports the arity it always did, after the reason has been said here. */
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
  /** The last pass: report a default that still has no value, rather than leave it for the
   *  next one. */
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
      // A call that omits an argument whose default has no value yet lowers to nothing and
      // says nothing, because on an earlier pass that is not an error. On the last pass it is
      // the one shape this cannot fill: a default that waits on itself.
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

/** Lower `node`'s body into `stub`. For a class method or constructor (#86) `receiver` says
 *  what `this` is: the struct-typed first parameter of a method, read as `self_`, or the local
 *  `self_` a constructor starts from the zero struct and returns.
 *
 *  A body is lowered once and kept (a generic instance is cached where it is first called), so
 *  a lookahead lowering that reaches it records the reads of the body for the hover
 *  (`unpeekedReads`, change 0134 item 4). */
export function fillFunctionBody(
  ...args: Parameters<typeof fillFunctionBodyNow>
): ReturnType<typeof fillFunctionBodyNow> {
  // A function whose calls fixed its result lowers its body under a key of that result
  // (`setHomeTag`, change 0134).
  const home = homeTagOf(args[1]);
  return home === undefined
    ? unpeekedReads(() => fillFunctionBodyNow(...args))
    : inCopy(home, () => unpeekedReads(() => fillFunctionBodyNow(...args)));
}

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
  /** The local functions this body declares, from the written name to the emitted one
   *  (roadmap 0.3 item T7, #92). */
  localFunctions?: ReadonlyMap<string, string>,
  /** For a static member, the class it is emitted for: what `this` names (Rule 8.13). */
  staticOwner?: string,
  /** For a static member, what `super` names in its body (Rule 8.13). */
  staticSuper?: ReadonlyMap<string, string>,
  /** For a local function, the parameters it takes for what it captures (Rule 8.17). */
  captures?: readonly CaptureBinding[],
  /** The declarations of the stub's own parameters when they are not the node's: a function
   *  that takes a function has none for those (Rule 8.18), and a function written as an
   *  argument none for a parameter it leaves off, whose entry is undefined. */
  written?: readonly (ts.ParameterDeclaration | undefined)[],
  /** Whether the stub's return type is the body's to say: a function written as an argument
   *  where nothing says what it returns (Rule 8.18). An expression body returns its value, and
   *  a block what its `return`s do. */
  inferRet?: boolean,
  /** The variables the body's object stands for as well as `this`: in the copy of a method a
   *  call made on one, the capture of it a function handed over takes (Rule 8.18). */
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
  // The body's calls are this function's, including any a filled-in default brings in
  // (roadmap 0.3 item T7, #92).
  scope.setOwner(stub);
  scope.setOwnerNode(node);
  // What `super.m(...)` names in this body (roadmap 0.3 item T5, #92).
  scope.setSuperMethods(receiver?.superMethods ?? staticSuper);
  scope.setLocalFunctions(localFunctions);
  scope.setStaticClass(staticOwner);
  // With no return type written, the body's first `return` with a value says it (Rule 8.19);
  // with a `return undefined;`, a bare `return;` or a path that ends the body beside it, the
  // result is `T | undefined` (changes 0088 and 0099).
  if (inferRet === true && node.body !== undefined && ts.isBlock(node.body)) {
    scope.setInferredReturn(stub);
    scope.setReturnsAbsence(bodyReturnsAbsence(node.body));
  }
  // `this` is defined first, so the IR name `self_` is free for it: the stub's own parameter
  // and the receiver read the same name. A user parameter called `self_` was refused at the
  // signature (TS8035), and a local called `self_` is renamed as any shadowing local is.
  const prologue: Stmt[] = [];
  // A constructor a class inherits runs the initializers of the classes below the one that
  // declared it when its body returns (Rule 8.14).
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
      // `super(...)` is a statement of this body and nowhere else (roadmap 0.3 item T5, #92).
      if (receiver.mode === 'ctor') scope.setSuperCtor(receiver.superCtor);
      const parts = ctorParts(receiver, scope, sourceFile, diagnostics);
      prologue.push(...parts.prologue);
      scope.setAfterSuper(parts.afterSuper);
      afterBody.push(...parts.afterBody);
    }
  }
  // A method's stub carries `self_` ahead of the declared parameters; a constructor's carries
  // exactly the declared ones.
  const declaredParams: readonly (ts.ParameterDeclaration | undefined)[] =
    written ?? node.parameters;
  // Verifies: Rule 8.8. A whole write rebinds a value local, never the caller's argument.
  // Declaration identity keeps shadowing separate and lets a closure share this local.
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
  // Parameters and top-level body locals share a frame, inside the module's frame.
  stub.params.forEach((p, i) => {
    if (i < offset) return;
    const declared = declaredParams[i - offset];
    // A parameter a function written as an argument left off: taken, and named nowhere.
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
    // A kernel function's array is the caller's storage, read and written in place (Rule 8.23).
    const storage = stub.kernel === true && p.type.kind === 'array' && p.type.size === undefined;
    // An `@inout` or `@out` parameter names the caller's place (Rule 8.25): bound as the object of a
    // method that changes it is, a local the body writes under the parameter's own IR name,
    // which the targets spell as the pointer or the `inout` parameter. A whole write lands on
    // the caller's place, so it takes no local copy (Rule 8.8).
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
    // What a local function in this body that captures the parameter passes for it (Rule 8.17).
    scope.bindDeclaration(declared, stored);
    if (copy) copied.push({ declared, param: p });
  });
  // Reserve all inputs first, so a parameter `a_1` is not stolen by the copy of `a`.
  // Signatures and reflection retain the authored names; only the body's local is fresh.
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
  // The method's object, which an arrow function in this body captures as `this`, and what a
  // local function takes for each variable it captures (Rule 8.17): under the variable's own
  // name, unless one of its own parameters took that name first. One the body does not read by
  // name is bound under a name no source can write, `#n`, and reached through its declaration.
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
  // What a hover on the function's name shows: its return type, which a function that writes
  // none has only once its body is lowered.
  const recordName = (): void => {
    if (node.name === undefined || !ts.isIdentifier(node.name)) return;
    // A copy of a function its calls decide (change 0134) is not what its name declares: the
    // function itself is, with the `f32` the host reads (Amendment A5, "export는 f32 유지").
    if (currentCopy() === stub.name) return;
    recordDeclaration(symbols, sourceFile, node.name, {
      name: shown ?? stub.name,
      kind: 'function',
      type: stub.ret,
      params: stub.params.slice(offset).map((p) => ({ name: p.name, type: p.type })),
    });
  };
  if (inferRet !== true) recordName();
  // The stub's parameters and the declaration's are one to one and in order: `parseSignature`
  // pushes one entry per parameter and bails out on the first it cannot accept, so it returns a
  // stub only when it accepted them all.
  stub.params.forEach((p, i) => {
    if (i < offset) return;
    const nameNode = declaredParams[i - offset]?.name;
    if (nameNode === undefined || !ts.isIdentifier(nameNode)) return;
    recordDeclaration(symbols, sourceFile, nameNode, { name: p.name, kind: 'param', type: p.type });
  });
  // An arrow with an expression body is the one return it stands for (T7, #92); every other
  // shape carries a block.
  // One that returns nothing is the expression as a statement, whose value TypeScript drops.
  let body =
    inferRet === true && ts.isArrowFunction(node) && !ts.isBlock(node.body)
      ? inferredArrowValue(node.body, stub, sourceFile, scope, diagnostics)
      : ts.isArrowFunction(node) && !ts.isBlock(node.body)
        ? typeKey(stub.ret) === 'void'
          ? lowerVoidArrowBody(node.body, sourceFile, scope, diagnostics)
          : lowerArrowValue(node.body, stub, sourceFile, scope, diagnostics)
        : lowerStatements((node.body as ts.Block).statements, sourceFile, scope, diagnostics);
  if (inferRet === true) recordName();
  // An expression body is the function's one `return`: a value that comes from a constant of no
  // fixed type hands its origin to each call (Amendment A3 of change 0134), as a `return` does.
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && hasNoWrittenResult(node, sourceFile)) {
    noteCarriedReturn(
      sourceFile,
      stub.name,
      node.body,
      (callee) => scope.resolveCallee(callee) === undefined && scope.resolve(callee) === undefined,
    );
  }
  // A path that ends a function with an optional result without a `return` is the absent
  // value, as TypeScript reads the end of the body (Rule 7.10, change 0099): the return is
  // appended here, with the same value `return undefined;` lowers to. A plain function's
  // fall-through stays the IR lint's (`all-paths-return`).
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
  // A `return undefined;` that no `return` with a value followed says what `T` is nowhere.
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
    // A constructor returns the struct it built: a bare `return` inside it returns `self_`,
    // and one more closes the body. A method that CHANGES its object returns nothing — it
    // writes through its receiver — so its bare returns stay bare.
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
    // A body whose `super(...)` did not lower still runs what follows it, first.
    const pending = scope.afterSuperPending() ? scope.takeAfterSuper() : [];
    body = [...prologue, ...pending, ...body, ...afterBody, { s: 'return', expr: self }];
  } else if (receiver !== undefined && receiver.mode === 'inout') {
    body = [...prologue, ...body];
  }
  body = [...parameterLocals, ...body];
  // An array a kernel function pushes onto measures the count pushed (change 0078).
  // The names a method on a kernel function's array makes, as the author wrote them.
  const kernelMethodNames = new Map<string, string>();
  if (stub.kernel === true) {
    // A method on its array is a loop of its body (change 0079).
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
    // A store after the last loop, and a store of a loop whose range the device holds, is dropped
    // past the array's end on every tier (change 0094, decision D2).
    body = guardKernelBody({ params: stub.params, body });
  }
  (stub as { body: readonly Stmt[] }).body = body;
  // A kernel function's loops are proved on its IR, and a refusal names the author's names
  // (Rule 8.22): keep what each IR name was written as, the functions it calls and the static
  // fields it reaches among them. The scope names a module-level name as itself, which is why a
  // value of the module has a table of its own: a parameter that shares its IR name is a `param`,
  // and reads the scope's table (#988).
  if (stub.kernel === true)
    kernelSourceNames.set(stub, {
      locals: new Map([...scope.sourceNames(), ...kernelMethodNames]),
      ...writtenModuleNames(scope, sourceFile),
    });
  // The type a function that writes none returns, which the language service writes into the
  // text TypeScript reads when its return does vector arithmetic (#162, `projection.ts`), and
  // for an entry whatever its return does (change 0136).
  if (node.type === undefined) recordInferredReturn(sourceFile, node, stub.ret);
  // An entry that writes no return type returns what its body says (Rule 8.19, change 0136): its
  // output takes the attribute its stage gives that type, as a written one does.
  // An annotation the projection wrote is not the author's (`hasNoWrittenResult`, Rule 12.7).
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
    // A function that says it returns nothing, in its signature or as an entry's written
    // `: void`, cannot return a value: WGSL refuses a `return` with a value in a function with
    // no return type (Rule 1.1), so the front end says it where TypeScript's TS2322 says it, on
    // the `return` (Rules 12.6, 12.7), under the code TS2322 reads as (Rule 12.4) (#212).
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
  // Each report sits on the `return` it is about (Rule 12.1: the offending thing), which is the
  // span `lowerStatement` stamped on it; with two returns, the name of the function would not
  // say which. It is also where TypeScript reports the same mistake (TS2322 and the codes it
  // reads as TS2322), so the editor's merged list reads it once (Rule 12.4). A return a pass
  // synthesised has no span, and falls back to the function's name.
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
            : // A result its calls decided (change 0134) was not declared: say whose it is.
              ts.isFunctionLike(node) && hasNoWrittenResult(node, sourceFile)
              ? decidedResultMismatch(node, shown, stub, r, captures, sourceFile)
              : `Function "${shown ?? stub.name}" return type mismatch: declared ${authorTypeText(stub.ret)}, got ${authorTypeText(r.expr.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
    }
  }
}

/** The sentence of a `return` whose type differs from the result its calls fixed (Rule 8.19,
 *  change 0134), naming the function as the author wrote it (Rule 12.5). Where the `return` reads
 *  a variable the function captures, that is why: every copy reads the one variable, which has
 *  one type. */
function decidedResultMismatch(
  node: FunctionNode,
  shown: string | undefined,
  stub: FuncDecl,
  r: { readonly expr?: Expr; readonly span?: SourceSpan },
  captures: readonly CaptureBinding[] | undefined,
  sourceFile: ts.SourceFile,
): string {
  const written =
    (node as { name?: ts.Node }).name ??
    (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined);
  const name =
    shown ?? (written !== undefined && ts.isIdentifier(written) ? written.text : stub.name);
  const got = authorTypeText(r.expr!.type);
  const text =
    r.span === undefined ? '' : sourceFile.text.slice(r.span.start, r.span.start + r.span.length);
  const captured = (captures ?? [])
    .filter((c) => c.byName)
    .map((c) => c.binding.name)
    .find((n) => new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}($|[^\\w$])`).test(text));
  if (captured !== undefined) {
    return (
      `Function "${name}" returns ${authorTypeText(stub.ret)} where its calls use it and ${got} ` +
      `at a "return" that reads "${captured}", a variable of the function around it: every copy ` +
      `of "${name}" reads the one "${captured}", which has one type (Rule 8.19). Write the type ` +
      `of "${captured}", or the return type of "${name}".`
    );
  }
  return (
    `Function "${name}" returns ${authorTypeText(stub.ret)} where its calls use it and ${got} at ` +
    `a "return"; a function returns one type (Rule 8.19): make them agree, or write the return ` +
    `type.`
  );
}

/** How many errors `diagnostics` holds. */
function errorsOf(diagnostics: readonly TsCompilerDiagnostic[]): number {
  return diagnostics.filter((d) => d.category === 'error').length;
}

/** The structs a binding, a module variable or workgroup memory holds, through arrays: none of
 *  them is an entry's result by inference (Rule 8.19, change 0136). */
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

/** ASI keeps a newline after `return` from handing back the following expression. Explain
 *  that spelling without joining the statements or changing a deliberate `return;`. */
function newlineReturnRemedy(sourceFile: ts.SourceFile, span: SourceSpan | undefined): string {
  if (span === undefined) return '';
  let remedy = '';
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.getStart(sourceFile) === span.start) {
      if (node.expression !== undefined || node.getText(sourceFile).endsWith(';')) return;
      const parent = node.parent;
      const siblings =
        ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)
          ? parent.statements
          : undefined;
      if (siblings === undefined) return;
      const next = siblings[siblings.indexOf(node) + 1];
      if (
        next !== undefined &&
        ts.isExpressionStatement(next) &&
        /[\r\n\u2028\u2029]/.test(sourceFile.text.slice(node.end, next.getStart(sourceFile)))
      ) {
        remedy =
          ' The newline after "return" ends the return statement in TypeScript. Put the expression on the same line, or write "return (" before the newline and close it with ");".';
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return remedy;
}

function collectReturns(stmts: readonly Stmt[]): { expr?: Expr; span?: SourceSpan }[] {
  const out: { expr?: Expr; span?: SourceSpan }[] = [];
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      if (s.s === 'return') out.push(s);
      else if (s.s === 'if') {
        for (const arm of s.arms) walk(arm.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') walk(s.body);
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  walk(stmts);
  return out;
}

/** `e` without the parentheses around it. */
function skipParens(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

/** A type parameter used as an array length cannot be supplied by a type argument. */
function arrayLengthParameters(decl: ts.FunctionDeclaration): ts.TypeParameterDeclaration[] {
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === 'array'
    ) {
      const length = node.typeArguments?.[1];
      if (
        length !== undefined &&
        ts.isTypeReferenceNode(length) &&
        ts.isIdentifier(length.typeName)
      )
        used.add(length.typeName.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const parameter of decl.parameters) if (parameter.type !== undefined) visit(parameter.type);
  if (decl.type !== undefined) visit(decl.type);
  return decl.typeParameters?.filter((parameter) => used.has(parameter.name.text)) ?? [];
}

/** The type arguments one call settles: the ones it writes, or the ones its arguments show.
 *  Reports and returns undefined for a type parameter neither reaches (roadmap 0.3 item T9,
 *  #92). */
function typeArgumentsFor(
  decl: ts.FunctionDeclaration,
  order: readonly string[],
  node: ts.CallExpression,
  argTypes: readonly (ShaderType | undefined)[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  /** The functions a call hands over by name, by parameter index (Rule 8.18): their own
   *  parameters' types and return type say what the type parameters in the parameter's type
   *  are. */
  named: ReadonlyMap<
    number,
    { readonly params: readonly ShaderType[]; readonly ret: ShaderType }
  > = new Map(),
): Map<string, ShaderType> | undefined {
  if (order.length === 0) return new Map();
  const shown = decl.name?.text ?? 'this function';
  const out = new Map<string, ShaderType>();
  const written = node.typeArguments ?? [];
  if (written.length > 0) {
    if (written.length !== order.length) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" takes ${String(order.length)} type argument(s), got ${String(written.length)}.`,
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    for (const [i, typeNode] of written.entries()) {
      // Mapped in the CALLER's scope, whose own type arguments are still bound: a generic
      // calling `pick<T>(…)` passes its own T through.
      const mapped = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics);
      if (!mapped) return undefined;
      out.set(order[i]!, mapped);
    }
    return out;
  }
  const names = new Set(order);
  for (const [i, p] of decl.parameters.entries()) {
    const fnType = functionTypeOf(p.type);
    const handed = named.get(i);
    if (fnType !== undefined) {
      if (handed === undefined) continue;
      fnType.parameters.forEach((fp, j) => {
        const actual = handed.params[j];
        if (fp.type !== undefined && actual !== undefined) inferFrom(fp.type, actual, names, out);
      });
      if (fnType.type.kind !== ts.SyntaxKind.VoidKeyword) {
        inferFrom(fnType.type, handed.ret, names, out);
      }
      continue;
    }
    const actual = argTypes[i];
    if (p.type === undefined || actual === undefined) continue;
    inferFrom(p.type, actual, names, out);
  }
  const missing = order.filter((n) => !out.has(n));
  if (missing.length > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `This call does not say what ${missing.map((n) => `"${n}"`).join(' and ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} in "${shown}". A type argument is read off an ` +
        `argument whose parameter is written as it, or as array<it, N>; write it instead, as ` +
        `"${shown}<${order.map((n) => (out.get(n) === undefined ? 'f32' : typeSuffix(out.get(n)!))).join(', ')}>(…)".`,
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  return out;
}
