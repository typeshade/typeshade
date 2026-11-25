import { markInferredRead } from '../use-inference.js';
import { userCallExpr } from './caller-decided.js';

import { markAbstractRead, peekingReads } from '../abstract-const.js';
import ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { irNameOf, type Binding, type LoweringScope } from '../context.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { staticConstName } from '../module-const.js';
import {
  accessorFnName,
  emittedMemberName,
  isPrivateName,
  isReadonlyMember,
  isStaticMember,
  classExtends,
  keywordAccessOf,
  keywordAccessVia,
  memberDeclarationInChain,
  privateOwner,
  privateStaticFields,
  staticFieldDeclarations,
  writtenMemberName,
  type KeywordAccess,
} from '../class-names.js';
import {
  MISSING_HALF,
  NO_SUPER,
  classFunctionOf,
  isCollidedFunction,
  methodFnName,
  superFieldKey,
  type ClassFunction,
} from './class-methods.js';
import { mutatingReceiver } from './class-methods/mutating.js';
import { lowerExpression } from './expression.js';

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode = TS_CODES.CLASS_MEMBER,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

const unparen = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? unparen(e.expression) : e;

export function staticOwnerOf(obj: ts.Expression, scope: LoweringScope): string | undefined {
  const e = unparen(obj);
  if (e.kind === ts.SyntaxKind.ThisKeyword) {
    return scope.resolve('this') === undefined ? scope.staticClass() : undefined;
  }
  if (ts.isIdentifier(e) && scope.resolve(e.text) === undefined) return e.text;
  return undefined;
}

const declaringClass = (cf: ClassFunction): ts.ClassLikeDeclaration | undefined =>
  cf.node !== undefined && ts.isClassLike(cf.node.parent) ? cf.node.parent : undefined;

const classLabel = (cls: ts.ClassLikeDeclaration | undefined, fallback: string): string =>
  cls?.name?.text ?? fallback;

export function checkPrivateAccess(
  written: string,
  owner: ts.ClassLikeDeclaration | undefined,
  ownerShown: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!isPrivateName(written)) return true;
  const lexical = privateOwner(at, written);
  if (lexical !== undefined && (owner === undefined || lexical.cls === owner)) return true;
  pushDiag(
    diagnostics,
    sourceFile,
    at,
    `"${written}" is private to "${classLabel(owner, ownerShown)}", and this code is outside ` +
      `its class body. Reach it through a member "${classLabel(owner, ownerShown)}" declares ` +
      `without the "#".`,
  );
  return false;
}

export function checkKeywordAccess(
  found: KeywordAccess | undefined,
  foundOwner: ts.ClassLikeDeclaration | undefined,
  member: string,
  receiver: string | undefined,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  isStatic = false,
): boolean {
  let access = found;
  let owner = foundOwner;
  if (access === undefined || owner === undefined) return true;
  const lexical = ts.findAncestor(at, ts.isClassLike);
  if (lexical !== undefined && lexical !== owner && classExtends(owner, lexical) === true) {
    const seen = memberDeclarationInChain(lexical, member, isStatic);
    if (seen !== undefined) {
      access = keywordAccessOf(seen);
      owner = ts.findAncestor(seen, ts.isClassLike);
      if (access === undefined || owner === undefined) return true;
    }
  }
  const ownerName = classLabel(owner, 'its class');
  const shown = `${ownerName}.${member}`;
  const via = keywordAccessVia(access, owner, at);
  if (via === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      at,
      access === 'private'
        ? `"${shown}" is private, so only the body of "${ownerName}" may name it. Reach it ` +
            `through a public member of "${ownerName}".`
        : `"${shown}" is protected, so only "${ownerName}" and the classes that extend it may ` +
            `name it. Reach it through a public member of "${ownerName}".`,
    );
    return false;
  }
  if (access !== 'protected' || via === 'granted' || via === owner || receiver === undefined) {
    return true;
  }
  const viaName = via.name?.text;
  if (
    viaName === undefined ||
    scope.structByName(viaName) === undefined ||
    receiver === viaName ||
    scope.extendsStruct(receiver, viaName)
  ) {
    return true;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    at,
    `"${shown}" is protected, and "${viaName}" may name it only on a "${viaName}"; this object ` +
      `is a "${receiver}". Reach it through a public member of "${ownerName}".`,
  );
  return false;
}

export function checkFunctionAccess(
  cf: ClassFunction,
  receiver: string | undefined,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (cf.node === undefined || cf.member === undefined) return true;
  return checkKeywordAccess(
    keywordAccessOf(cf.node),
    declaringClass(cf),
    cf.member,
    receiver,
    at,
    sourceFile,
    scope,
    diagnostics,
    cf.kind === 'static',
  );
}

export function checkFieldAccess(
  struct: string,
  written: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (isPrivateName(written)) return true;
  const r = scope.restrictedField(struct, emittedMemberName(written));
  if (r === undefined) return true;
  return checkKeywordAccess(r.access, r.owner, written, struct, at, sourceFile, scope, diagnostics);
}

export function checkStaticFieldAccess(
  declaredOn: string,
  written: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const decl = staticFieldDeclarations(sourceFile).get(`${declaredOn}.${written}`);
  if (decl === undefined) return true;
  return checkKeywordAccess(
    keywordAccessOf(decl),
    ts.isClassLike(decl.parent) ? decl.parent : undefined,
    written,
    undefined,
    at,
    sourceFile,
    scope,
    diagnostics,
    true,
  );
}

export function memberFunctionOf(
  struct: string,
  written: string,
  role: 'method' | 'get' | 'set',
  scope: LoweringScope,
): { decl: FuncDecl; cf: ClassFunction } | undefined {
  const fn =
    role === 'method'
      ? methodFnName(struct, emittedMemberName(written))
      : accessorFnName(struct, role, written);
  const decl = scope.resolveCallee(fn);
  const cf = decl === undefined ? undefined : classFunctionOf(decl);
  if (decl === undefined || cf === undefined) return undefined;
  if (cf.member !== written || (cf.accessor ?? 'method') !== role) return undefined;
  return { decl, cf };
}

function privateFieldReadable(
  struct: string,
  written: string,
  at: ts.Node,
  scope: LoweringScope,
): boolean {
  const field = scope.privateField(struct, emittedMemberName(written));
  if (field === undefined || field.written !== written) return false;
  return privateOwner(at, written)?.cls === field.owner;
}

export function visibleField(
  struct: string,
  written: string,
  at: ts.Node,
  scope: LoweringScope,
): ShaderType | undefined {
  const emitted = emittedMemberName(written);
  const type = scope.fieldType(struct, emitted);
  if (type === undefined) return undefined;
  if (isPrivateName(written)) {
    return privateFieldReadable(struct, written, at, scope) ? type : undefined;
  }
  return scope.privateField(struct, emitted) === undefined ? type : undefined;
}

const callOf = (
  decl: FuncDecl,
  args: readonly Expr[],
  sourceFile: ts.SourceFile,
  at: ts.Node,
): Expr => withSpan(userCallExpr(decl, args, at, sourceFile), sourceFile, at);

// Why: the IR holds a name once in a function, and the oracle, the code generator, the debugger
// and the inliner look a `param` and a `varref` up by name in one environment, so a module
// variable beside a parameter of its name would read the parameter. Source parameters are
// separated from module variables before lowering (#1009); this guard covers a synthesized one.
function hiddenByParameter(b: Binding, scope: LoweringScope): boolean {
  const holder = scope.resolveIr(irNameOf(b));
  if (holder === undefined || holder === b || holder.kind !== 'param') return false;
  return b.kind === 'modvar';
}

export function staticFieldBinding(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): Binding | undefined {
  const emitted = emittedMemberName(written);
  const b = scope.resolveModuleValue(staticConstName(owner, emitted));
  if (b === undefined || (b.kind !== 'module' && b.kind !== 'modvar')) return undefined;
  if (hiddenByParameter(b, scope)) return undefined;
  const isPrivate = privateStaticFields(sourceFile).has(`${owner}.${emitted}`);
  return isPrivate === isPrivateName(written) ? b : undefined;
}

export function staticFieldRead(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): { binding: Binding; declaredOn: string } | undefined {
  const own = staticFieldBinding(owner, written, scope, sourceFile);
  if (own !== undefined) return { binding: own, declaredOn: owner };
  if (isPrivateName(written)) return undefined;
  for (const base of scope.ancestorsOf(owner)) {
    const holder = scope.staticHolderOf(base);
    const b = staticFieldBinding(holder, written, scope, sourceFile);
    if (b !== undefined) return { binding: b, declaredOn: holder };
  }
  return undefined;
}

export function inheritedStaticWrite(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string | undefined {
  const read = staticFieldRead(owner, written, scope, sourceFile);
  if (read === undefined || read.declaredOn === owner) return undefined;
  return (
    `"${owner}.${written}" is a static "${read.declaredOn}" declares, and assigning it through ` +
    `"${owner}" would give "${owner}" a copy of its own in TypeScript. Write ` +
    `"${read.declaredOn}.${written}".`
  );
}

export function lowerAccessorRead(
  node: ts.PropertyAccessExpression,
  struct: string,
  base: Expr | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'none' {
  const written = node.name.text;
  const isStatic = base === undefined;
  const getter = memberFunctionOf(struct, written, 'get', scope);
  const setter = memberFunctionOf(struct, written, 'set', scope);
  const pick = (f: { cf: ClassFunction } | undefined): boolean =>
    f !== undefined && (f.cf.kind === 'static') === isStatic;
  const found = pick(getter) ? getter : pick(setter) ? setter : undefined;
  if (found === undefined) {
    const taken = scope.resolveCallee(accessorFnName(struct, 'get', written));
    return taken !== undefined && isCollidedFunction(taken) ? undefined : 'none';
  }
  const shown = `${struct}.${written}`;
  if (
    !checkPrivateAccess(
      written,
      declaringClass(found.cf),
      struct,
      node.name,
      sourceFile,
      diagnostics,
    ) ||
    !checkInheritedPrivateStatic(found.cf, struct, node, sourceFile, diagnostics)
  ) {
    return undefined;
  }
  if (found !== getter) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" has a setter and no getter, so there is nothing to read. Declare ` +
        `"get ${written}()" beside the setter.`,
    );
    return undefined;
  }
  if (
    !checkFunctionAccess(
      getter.cf,
      isStatic ? undefined : struct,
      node.name,
      sourceFile,
      scope,
      diagnostics,
    )
  ) {
    return undefined;
  }
  if (!scope.calleeReady(getter.decl, node, sourceFile, diagnostics)) return undefined;
  if (isStatic) return callOf(getter.decl, [], sourceFile, node);
  if (getter.cf.mutates) {
    const place = mutatingReceiver(node, node.expression, shown, sourceFile, scope, diagnostics);
    return place === undefined ? undefined : callOf(getter.decl, [place], sourceFile, node);
  }
  return callOf(getter.decl, [base], sourceFile, node);
}

export function destructuredGetter(
  struct: string,
  field: string,
  base: Expr,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'none' {
  const getter = memberFunctionOf(struct, field, 'get', scope);
  if (getter === undefined || getter.cf.kind === 'static') return 'none';
  if (!checkFunctionAccess(getter.cf, struct, at, sourceFile, scope, diagnostics)) return undefined;
  if (getter.cf.mutates) {
    pushDiag(
      diagnostics,
      sourceFile,
      at,
      `"${struct}.${field}" changes its object, and a pattern reads a copy of it that is ` +
        `dropped. Read it as a member instead, "const ${field} = v.${field}".`,
    );
    return undefined;
  }
  if (!scope.calleeReady(getter.decl, at, sourceFile, diagnostics)) return undefined;
  return callOf(getter.decl, [base], sourceFile, at);
}

function superReceiver(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const self = scope.resolve('this');
  if (self === undefined || self.type.kind !== 'struct') {
    pushDiag(diagnostics, sourceFile, node, NO_SUPER);
    return undefined;
  }
  return self.kind === 'param'
    ? { op: 'param', type: self.type, name: irNameOf(self) }
    : { op: 'varref', type: self.type, name: irNameOf(self) };
}

const inStaticMember = (scope: LoweringScope): boolean =>
  scope.resolve('this') === undefined && scope.staticClass() !== undefined;

const superField = (written: string, scope: LoweringScope): string | undefined =>
  inStaticMember(scope) ? scope.superMethods()?.get(superFieldKey(written)) : undefined;

function superHalf(
  written: string,
  half: 'get' | 'set',
  scope: LoweringScope,
): FuncDecl | undefined {
  const fn = scope.superMethods()?.get(`${half} ${written}`);
  return fn === undefined || fn === MISSING_HALF ? undefined : scope.resolveCallee(fn);
}

function superMiss(
  node: ts.PropertyAccessExpression,
  half: 'get' | 'set',
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const written = node.name.text;
  const shown = `super.${written}`;
  const self = scope.resolve('this');
  const struct = self?.type.kind === 'struct' ? self.type.name : undefined;
  const other = scope.superMethods()?.get(`${half} ${written}`) === MISSING_HALF;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    other
      ? half === 'get'
        ? `"${shown}" has a setter and no getter above this class, so there is nothing to read.`
        : `"${shown}" has a getter and no setter above this class, so it cannot be assigned.`
      : struct !== undefined && visibleField(struct, written, node.name, scope) !== undefined
        ? `"${shown}" names a field, and a field is the object's own, which "super" does not ` +
          `reach. Write "this.${written}".`
        : inStaticMember(scope)
          ? `Nothing above this class declares a static accessor or field "${written}", so ` +
            `"${shown}" names nothing.`
          : `Nothing above this class declares an accessor "${written}", so "${shown}" names ` +
            `nothing.`,
  );
}

export function lowerSuperAccessorRead(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const written = node.name.text;
  const fieldOwner = superField(written, scope);
  if (fieldOwner !== undefined) {
    const b = staticFieldBinding(scope.staticHolderOf(fieldOwner), written, scope, sourceFile);
    if (b === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"super.${written}" names the static "${written}" of "${fieldOwner}", which this ` +
          `module emits no value for.`,
        TS_CODES.UNKNOWN_NAME,
      );
      return undefined;
    }
    if (!checkStaticFieldAccess(fieldOwner, written, node.name, sourceFile, scope, diagnostics)) {
      return undefined;
    }
    return b.kind === 'modvar'
      ? { op: 'varref', type: b.type, name: irNameOf(b) }
      : markAbstractRead({ op: 'constref', type: b.type, name: b.name }, node, b.abstract);
  }
  const statik = inStaticMember(scope);
  const recv = statik ? undefined : superReceiver(node, sourceFile, scope, diagnostics);
  if (!statik && recv === undefined) return undefined;
  const getter = superHalf(written, 'get', scope);
  if (getter === undefined) {
    superMiss(node, 'get', sourceFile, scope, diagnostics);
    return undefined;
  }
  const cf = classFunctionOf(getter);
  const self = recv?.type.kind === 'struct' ? recv.type.name : undefined;
  if (
    cf !== undefined &&
    !checkFunctionAccess(cf, self, node.name, sourceFile, scope, diagnostics)
  ) {
    return undefined;
  }
  if (!scope.calleeReady(getter, node, sourceFile, diagnostics)) return undefined;
  return callOf(getter, recv === undefined ? [] : [recv], sourceFile, node);
}

function superAccessorTarget(
  node: ts.PropertyAccessExpression,
  reads: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): AccessorTarget | undefined {
  const written = node.name.text;
  const fieldOwner = superField(written, scope);
  if (fieldOwner !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Assigning "super.${written}" writes the static "${written}" of "this" in TypeScript, not ` +
        `the one "${fieldOwner}" declares. Write "this.${written}" or "${fieldOwner}.${written}".`,
    );
    return undefined;
  }
  const statik = inStaticMember(scope);
  const recv = statik ? undefined : superReceiver(node, sourceFile, scope, diagnostics);
  if (!statik && recv === undefined) return undefined;
  const setter = superHalf(written, 'set', scope);
  if (setter === undefined) {
    superMiss(node, 'set', sourceFile, scope, diagnostics);
    return undefined;
  }
  const getter = reads ? superHalf(node.name.text, 'get', scope) : undefined;
  if (reads && getter === undefined) {
    superMiss(node, 'get', sourceFile, scope, diagnostics);
    return undefined;
  }
  const self = recv?.type.kind === 'struct' ? recv.type.name : undefined;
  const on = recv === undefined ? [] : [recv];
  if (getter !== undefined && !scope.calleeReady(getter, node, sourceFile, diagnostics)) {
    return undefined;
  }
  if (!scope.calleeReady(setter, node, sourceFile, diagnostics)) return undefined;
  for (const half of [setter, getter]) {
    const cf = half === undefined ? undefined : classFunctionOf(half);
    if (
      cf !== undefined &&
      !checkFunctionAccess(cf, self, node.name, sourceFile, scope, diagnostics)
    ) {
      return undefined;
    }
  }
  return {
    type: setter.params[setter.params.length - 1]!.type,
    read: getter === undefined ? undefined : callOf(getter, on, sourceFile, node),
    write: (v: Expr): Stmt => ({
      s: 'call',
      expr: callOf(setter, [...on, v], sourceFile, node),
    }),
  };
}

export interface AccessorTarget {
  readonly type: ShaderType;
  readonly read: Expr | undefined;
  readonly write: (value: Expr) => Stmt;
}

function readsOnly(e: Expr): boolean {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
    case 'overrideref':
    case 'lit':
      return true;
    case 'member':
      return readsOnly(e.base);
    case 'index':
      return readsOnly(e.base) && readsOnly(e.idx);
    default:
      return false;
  }
}

export function lowerAccessorTarget(
  left: ts.Expression,
  reads: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): AccessorTarget | undefined | 'not-an-accessor' {
  const node = unparen(left);
  if (!ts.isPropertyAccessExpression(node)) return 'not-an-accessor';
  if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return superAccessorTarget(node, reads, sourceFile, scope, diagnostics);
  }
  const written = node.name.text;
  const obj = node.expression;
  const owner = staticOwnerOf(obj, scope);
  let struct: string;
  if (owner !== undefined) {
    if (staticFieldRead(owner, written, scope, sourceFile) !== undefined) return 'not-an-accessor';
    struct = owner;
  } else {
    const peek = peekingReads(() => lowerExpression(obj, sourceFile, scope, []));
    if (peek === undefined || peek.type.kind !== 'struct') return 'not-an-accessor';
    if (visibleField(peek.type.name, written, node.name, scope) !== undefined) {
      return 'not-an-accessor';
    }
    struct = peek.type.name;
  }
  const isStatic = owner !== undefined;
  const getter = memberFunctionOf(struct, written, 'get', scope);
  const setter = memberFunctionOf(struct, written, 'set', scope);
  const usable = (
    f: { cf: ClassFunction } | undefined,
  ): f is { decl: FuncDecl; cf: ClassFunction } =>
    f !== undefined && (f.cf.kind === 'static') === isStatic;
  const get = usable(getter) ? getter : undefined;
  const set = usable(setter) ? setter : undefined;
  const either = set ?? get;
  if (either === undefined) return 'not-an-accessor';
  const shown = `${struct}.${written}`;
  if (
    !checkPrivateAccess(
      written,
      declaringClass(either.cf),
      struct,
      node.name,
      sourceFile,
      diagnostics,
    ) ||
    !checkInheritedPrivateStatic(either.cf, struct, node, sourceFile, diagnostics)
  ) {
    return undefined;
  }
  if (set === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" has a getter and no setter, so it cannot be assigned. Declare ` +
        `"set ${written}(value)" beside the getter.`,
    );
    return undefined;
  }
  if (reads && get === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" has a setter and no getter, so there is nothing for this assignment to ` +
        `read. Declare "get ${written}()" beside the setter, or assign it with "=".`,
    );
    return undefined;
  }
  const recvStruct = isStatic ? undefined : struct;
  if (!checkFunctionAccess(set.cf, recvStruct, node.name, sourceFile, scope, diagnostics)) {
    return undefined;
  }
  if (
    reads &&
    get !== undefined &&
    !checkFunctionAccess(get.cf, recvStruct, node.name, sourceFile, scope, diagnostics)
  ) {
    return undefined;
  }
  if (!scope.calleeReady(set.decl, node, sourceFile, diagnostics)) return undefined;
  const type = set.decl.params[set.decl.params.length - 1]!.type;
  const receiverFor = (f: { cf: ClassFunction }): Expr[] | undefined => {
    if (isStatic) return [];
    if (f.cf.mutates) {
      const place = mutatingReceiver(node, obj, shown, sourceFile, scope, diagnostics);
      return place === undefined ? undefined : [place];
    }
    const recv = lowerExpression(obj, sourceFile, scope, diagnostics);
    return recv === undefined ? undefined : [recv];
  };
  const setArgs = receiverFor(set);
  if (setArgs === undefined) return undefined;
  let read: Expr | undefined;
  if (reads && get !== undefined) {
    const getArgs = receiverFor(get);
    if (getArgs === undefined) return undefined;
    if (!isStatic && !readsOnly(setArgs[0]!)) {
      pushDiag(
        diagnostics,
        sourceFile,
        obj,
        `"${node.getText(sourceFile)}" reads through the getter and writes through the setter, ` +
          `so "${obj.getText(sourceFile)}" would run twice. Bind it to a let first.`,
      );
      return undefined;
    }
    if (!scope.calleeReady(get.decl, node, sourceFile, diagnostics)) return undefined;
    read = callOf(get.decl, getArgs, sourceFile, node);
  }
  return {
    type,
    read,
    write: (v: Expr): Stmt => ({
      s: 'call',
      expr: callOf(set.decl, [...setArgs, v], sourceFile, node),
    }),
  };
}

export function finishAccessorWrite(
  stmt: Stmt | undefined,
  target: AccessorTarget | 'not-an-accessor',
): Stmt | undefined {
  if (stmt === undefined || target === 'not-an-accessor') return stmt;
  if (stmt.s === 'assign') return target.write(stmt.expr);
  if (stmt.s === 'assignOp') {
    return target.write({
      op: 'binop',
      type: target.type,
      bop: stmt.bop,
      a: target.read!,
      b: stmt.expr,
    });
  }
  return stmt;
}

export function refuseReadonlyWrite(
  target: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (target.op !== 'member' || target.base.type.kind !== 'struct') return false;
  const cls = scope.readonlyField(target.base.type.name, target.field);
  if (cls === undefined) return false;
  const owner = scope.owner();
  const cf = owner === undefined ? undefined : classFunctionOf(owner);
  if (cf?.kind === 'ctor' && cf.node !== undefined && cf.node.parent === cls) return false;
  const shown = classLabel(cls, target.base.type.name);
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Cannot assign to "${node.getText(sourceFile)}" — "${target.field}" is readonly, so only ` +
      `the constructor of "${shown}" may assign it.`,
    TS_CODES.CONST_ASSIGN,
  );
  return true;
}

export function getterInChain(e: Expr): ClassFunction | undefined {
  let at: Expr = e;
  for (;;) {
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    if (at.op === 'call' && at.declRef !== undefined) {
      const cf = classFunctionOf(at.declRef);
      return cf?.accessor === 'get' ? cf : undefined;
    }
    return undefined;
  }
}

export function refuseWriteThroughGetter(
  node: ts.Node,
  cf: ClassFunction,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${node.getText(sourceFile)}" writes into what the getter "${cf.shown}" returns, which is ` +
      `a copy, so the write would be lost. Assign the whole property, or add a method that ` +
      `changes the field.`,
    TS_CODES.ASSIGN_TARGET,
  );
}

export function lowerStaticFieldTarget(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  into = false,
): Expr | 'refused' | undefined {
  const staticOwner = staticOwnerOf(node.expression, scope);
  if (staticOwner === undefined) return undefined;
  const written = node.name.text;
  const read = into ? staticFieldRead(staticOwner, written, scope, sourceFile) : undefined;
  const owner = read?.declaredOn ?? staticOwner;
  const b = read?.binding ?? staticFieldBinding(owner, written, scope, sourceFile);
  if (b === undefined) {
    if (scope.declarationRefused(`${owner}_${emittedMemberName(written)}`)) return 'refused';
    const inherited = inheritedStaticWrite(owner, written, scope, sourceFile);
    if (inherited !== undefined) {
      pushDiag(diagnostics, sourceFile, node, inherited, TS_CODES.CONST_ASSIGN);
      return 'refused';
    }
    const inheritedPrivate = inheritedPrivateStaticField(owner, written, scope, sourceFile);
    if (inheritedPrivate === undefined) return undefined;
    pushDiag(diagnostics, sourceFile, node, inheritedPrivate);
    return 'refused';
  }
  if (!checkPrivateStatic(owner, written, node.name, sourceFile, diagnostics, scope)) {
    return 'refused';
  }
  if (!checkStaticFieldAccess(owner, written, node.name, sourceFile, scope, diagnostics)) {
    return 'refused';
  }
  if (b.kind !== 'modvar') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      staticConstantWrite(owner, written, sourceFile),
      TS_CODES.CONST_ASSIGN,
    );
    return 'refused';
  }
  return markInferredRead(
    withSpan({ op: 'varref', type: b.type, name: irNameOf(b) } as Expr, sourceFile, node),
    node,
    b.inferred,
  );
}

export function staticConstantWrite(
  owner: string,
  written: string,
  sourceFile: ts.SourceFile,
): string {
  let readonly = false;
  const walk = (n: ts.Node): void => {
    if (readonly) return;
    if (ts.isClassDeclaration(n) && n.name?.text === owner) {
      readonly = n.members.some(
        (m) =>
          ts.isPropertyDeclaration(m) &&
          isStaticMember(m) &&
          isReadonlyMember(m) &&
          writtenMemberName(m.name) === written,
      );
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  return readonly
    ? `Cannot assign to "${owner}.${written}" — it is static readonly.`
    : `"${owner}.${written}" is a module constant, since this file never assigns it, so it ` +
        `cannot change here. Assign it where it should change, "${owner}.${written} = ...", and ` +
        `it becomes a module variable.`;
}

export function checkPrivateStatic(
  owner: string,
  written: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  scope?: LoweringScope,
): boolean {
  if (!isPrivateName(written)) return true;
  const lexical = privateOwner(at, written);
  const declaredIn = lexical?.cls.name?.text;
  if (declaredIn === owner) return true;
  pushDiag(
    diagnostics,
    sourceFile,
    at,
    declaredIn !== undefined && scope?.extendsStruct(owner, declaredIn) === true
      ? inheritedPrivateStatic(owner, written, declaredIn)
      : `"${written}" is private to "${owner}", and this code is outside its class body. Reach ` +
          `it through a member "${owner}" declares without the "#".`,
  );
  return false;
}

export function checkInheritedPrivateStatic(
  cf: ClassFunction,
  owner: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (cf.kind !== 'static' || cf.member === undefined || !isPrivateName(cf.member)) return true;
  const declaredIn = declaringClass(cf)?.name?.text;
  if (declaredIn === undefined || declaredIn === owner) return true;
  pushDiag(diagnostics, sourceFile, at, inheritedPrivateStatic(owner, cf.member, declaredIn));
  return false;
}

export function inheritedPrivateStatic(owner: string, written: string, declaredIn: string): string {
  return (
    `"${owner}" has no "${written}": a private static is the class's own, and TypeScript throws ` +
    `where a body "${owner}" inherits reaches it through "this". Name the class that declares ` +
    `it, "${declaredIn}.${written}".`
  );
}

export function inheritedPrivateStaticField(
  owner: string,
  written: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!isPrivateName(written)) return undefined;
  for (const base of scope.ancestorsOf(owner)) {
    if (staticFieldBinding(base, written, scope, sourceFile) !== undefined) {
      return inheritedPrivateStatic(owner, written, base);
    }
  }
  return undefined;
}
