// Why: the emitted object is `self_`, not `self`: Tint refuses `self`, a WGSL reserved word.

import { hasNoWrittenResult } from '../abstract-const.js';
import { logicalTypeKey as typeKey } from '../optional.js';
import ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { SourceSpan } from '../../../core/ir/span.js';
import { boolT, f32T, i32T, structT, u32T, voidT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { CollectedStruct, FieldInit } from '../structs.js';
import {
  authorTypeText,
  classOfStruct,
  irNameOf,
  type LoweringScope,
  type SuperCtor,
} from '../context.js';
import { qualifiedParts } from '../namespaces.js';
import { pushTypeArguments } from '../generics.js';
import {
  ambiguousNew,
  isGenericClass,
  newInstanceName,
  writtenInstanceArgs,
} from '../generic-structs.js';
import { newRefusal, newTargetOf, thisObjectNewMessage } from './new-target.js';
import { TS_CODES, type TsCode } from '../codes.js';
import {
  methodNames,
  namespaceFunctionNames,
  staticMemberNames,
  unknownNameSentence,
} from '../unknown-names.js';
import { makeDiagnostic } from '../diagnostic.js';
import { spanOf, withSpan } from '../span.js';
import { reportIntLitRange, retargetIntLitCtx } from '../lit-coerce.js';
import { numericMismatch } from '../numeric.js';
import { lowerExpression } from './expression.js';
import { lowerGenericCall, lowerUserCall } from './expression-misc.js';
import { parseParams, parseReturnType } from './function-signature.js';
import { recordParamDefaults } from './param-defaults.js';
import { functionParams } from './function-types.js';
import {
  accessorFnName,
  buildsCallerClass,
  callerClassForm,
  emittedMemberName,
  isPrivateName,
  isStaticMember,
  returnsThis,
  staticThisClass,
  writtenMemberName,
} from '../class-names.js';
import { mapTsTypeToShaderType, writesUndeclaredType } from '../type-map.js';
import { writesThroughArgument } from './references.js';
import { ownParts } from '../object-reference.js';
import {
  checkFunctionAccess,
  checkInheritedPrivateStatic,
  checkPrivateAccess,
  memberFunctionOf,
  visibleField,
} from './class-access.js';
import { lowerCopyCall, mutatingReceiver } from './class-methods/mutating.js';

export interface Receiver {
  readonly type: ShaderType;
  readonly mode: 'param' | 'ctor' | 'inout';
  readonly fieldInits: readonly FieldInit[];
  readonly shown: string;
  readonly superCtor?: SuperCtor;
  readonly superMethods?: ReadonlyMap<string, string>;
  readonly paramProps?: readonly { readonly name: string; readonly type: ShaderType }[];
  readonly afterSuper?: {
    readonly paramProps: readonly { readonly name: string; readonly type: ShaderType }[];
    readonly fieldInits: readonly FieldInit[];
  };
  readonly afterBody?: readonly FieldInit[];
  readonly ownInits?: readonly FieldInit[];
}

export type MemberFunction = ts.MethodDeclaration | ts.AccessorDeclaration;

export const accessorHalf = (node: ts.Node): 'get' | 'set' | undefined =>
  ts.isGetAccessorDeclaration(node) ? 'get' : ts.isSetAccessorDeclaration(node) ? 'set' : undefined;

export interface ClassFunction {
  readonly stub: FuncDecl;
  readonly kind: 'method' | 'static' | 'ctor';
  readonly struct: CollectedStruct;
  readonly shown: string;
  readonly node: MemberFunction | ts.ConstructorDeclaration | undefined;
  readonly receiver: Receiver | undefined;
  readonly mutates: boolean;
  readonly member?: string;
  readonly accessor?: 'get' | 'set';
  readonly staticOwner?: string;
  readonly staticSuper?: ReadonlyMap<string, string>;
  readonly inherited?: true;
  readonly returnsThis?: true;
  readonly infers?: true;
  readonly valueFromGetter?: true;
  readonly takesFunctions?: ReadonlySet<number>;
}

export const methodFnName = (struct: string, member: string): string => `${struct}_${member}`;
export const ctorFnName = (struct: string): string => `${struct}_new`;
export const superFnName = (struct: string, base: string, member: string): string =>
  `${struct}_super_${base}_${member}`;

const registry = new WeakMap<FuncDecl, ClassFunction>();

const collided = new WeakSet<FuncDecl>();

export const isCollidedFunction = (decl: FuncDecl): boolean => collided.has(decl);

export const classFunctionOf = (decl: FuncDecl): ClassFunction | undefined => registry.get(decl);

export function registerClassCopy(copy: FuncDecl, cf: ClassFunction, writes: boolean): void {
  const receiver: Receiver | undefined =
    cf.receiver === undefined || cf.receiver.mode === 'ctor'
      ? cf.receiver
      : { ...cf.receiver, mode: writes ? 'inout' : 'param' };
  const made: ClassFunction = { ...cf, stub: copy, mutates: writes, receiver };
  delete (made as { takesFunctions?: unknown }).takesFunctions;
  registry.set(copy, made);
}

export const selfRef = (type: ShaderType, scope?: LoweringScope): Expr => ({
  op: 'varref',
  type,
  name: scope?.resolve('this') ? irNameOf(scope.resolve('this')!) : 'self_',
});

function noStaticFunction(
  name: string,
  member: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): string {
  return unknownNameSentence(`"${name}" has no static function "${member}".`, member, [
    [name, ...scope.ancestorsOf(name)].flatMap((c) => staticMemberNames(c, sourceFile)),
  ]);
}

const refusedMember = (name: string, member: string, scope: LoweringScope): boolean =>
  [name, ...scope.ancestorsOf(name)].some((c) =>
    scope.declarationRefused(methodFnName(c, emittedMemberName(member))),
  );

export const abstractBuilderText = (
  shown: string,
  member: string,
  through: string | undefined,
): string =>
  `"${shown}.${member}()" builds its value with "new this()", and "${shown}" is abstract, so ` +
  `there is no instance of it to build. Call it through a class that extends it` +
  (through === undefined ? '' : `, "${through}.${member}()"`);

function abstractBuilderSentence(
  owner: string,
  member: string,
  scope: LoweringScope,
): string | undefined {
  if (!scope.isAbstractStruct(owner)) return undefined;
  const classes = scope.classOrigins();
  for (const c of [owner, ...scope.ancestorsOf(owner)]) {
    const struct = classes.find((s) => s.decl.name === c);
    const written =
      struct === undefined
        ? undefined
        : memberFunctionsOf(struct).find(
            (m) =>
              isStaticMember(m) &&
              accessorHalf(m) === undefined &&
              writtenMemberName(m.name) === member,
          );
    if (written === undefined) continue;
    if (!buildsCallerClass(written)) return undefined;
    const through = classes.find(
      (s) => !s.abstract && s.binding === undefined && scope.extendsStruct(s.decl.name, owner),
    );
    return `${abstractBuilderText(
      classOfStruct(owner).written,
      member,
      through === undefined ? undefined : classOfStruct(through.decl.name).written,
    )}.`;
  }
  return undefined;
}

export function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode = TS_CODES.CLASS_MEMBER,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

function namesConstructed(
  sourceFile: ts.SourceFile,
  structs: readonly CollectedStruct[],
  byName: ReadonlyMap<string, CollectedStruct>,
): Set<string> {
  const out = new Set<string>();
  const throughThis = new Set<string>();
  const walk = (n: ts.Node): void => {
    const target = ts.isNewExpression(n) ? newTargetOf(n, sourceFile) : undefined;
    if (ts.isNewExpression(n) && target?.kind === 'class') {
      out.add(newInstanceName(n, target.flat, sourceFile) ?? target.flat);
    }
    if (ts.isNewExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const cls = staticThisClass(n.expression)?.name?.text;
      if (cls !== undefined) {
        out.add(newInstanceName(n, cls, sourceFile) ?? cls);
        throughThis.add(cls);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  for (const s of structs) {
    if (ancestorsOf(s.decl.name, byName).some((a) => throughThis.has(a.decl.name))) {
      out.add(s.decl.name);
    }
  }
  return out;
}

function callsSuper(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) return true;
  if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return false;
  return ts.forEachChild(node, callsSuper) ?? false;
}

function returnsBuiltThis(node: MemberFunction): boolean {
  const isNewThis = (e: ts.Expression): boolean => {
    const x = unparen(e);
    return ts.isNewExpression(x) && x.expression.kind === ts.SyntaxKind.ThisKeyword;
  };
  const built = new Set<string>();
  let returns = 0;
  let others = 0;
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) && !ts.isArrowFunction(n)) return;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      isNewThis(n.initializer)
    ) {
      built.add(n.name.text);
    }
    if (ts.isReturnStatement(n)) {
      returns++;
      const e = n.expression !== undefined ? unparen(n.expression) : undefined;
      if (!(e !== undefined && (isNewThis(e) || (ts.isIdentifier(e) && built.has(e.text))))) {
        others++;
      }
    }
    ts.forEachChild(n, walk);
  };
  if (node.body !== undefined) ts.forEachChild(node.body, walk);
  return returns > 0 && others === 0;
}

export function unparen(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unparen(e.expression) : e;
}

function rootedInThis(e: ts.Expression, parts: ReadonlyMap<string, unknown> = NO_PARTS): boolean {
  const n = unparen(e);
  if (n.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
    return rootedInThis(n.expression, parts);
  }
  return ts.isIdentifier(n) && parts.has(n.text);
}
const NO_PARTS: ReadonlyMap<string, unknown> = new Map();

const memberKeyOf = (node: MemberFunction): string | undefined => {
  const written = writtenMemberName(node.name);
  if (written === undefined) return undefined;
  const half = accessorHalf(node);
  return half === undefined ? written : `${half} ${written}`;
};

function writesThis(
  body: ts.Block,
  self: string,
  table: MutationTable,
  byName: ReadonlyMap<string, CollectedStruct>,
): boolean {
  const parts = ownParts(body, body.getSourceFile());
  const placeType = (e: ts.Expression): ShaderType | undefined => {
    const x = unparen(e);
    if (x.kind === ts.SyntaxKind.ThisKeyword) return structT(self);
    if (ts.isIdentifier(x)) {
      const part = parts.get(x.text);
      if (part === undefined) return undefined;
      const from = placeType(part.from);
      return part.element ? (from?.kind === 'array' ? from.elem : undefined) : from;
    }
    if (ts.isPropertyAccessExpression(x)) {
      const base = placeType(x.expression);
      if (base?.kind !== 'struct') return undefined;
      const field = emittedMemberName(x.name.text);
      return byName.get(base.name)?.decl.fields.find((f) => f.name === field)?.type;
    }
    if (ts.isElementAccessExpression(x)) {
      const base = placeType(x.expression);
      return base?.kind === 'array' ? base.elem : undefined;
    }
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
      const base = placeType(x.expression.expression);
      return base?.kind === 'struct' && table.chainable(base.name).has(x.expression.name.text)
        ? base
        : undefined;
    }
    return undefined;
  };
  const changes = (receiver: ts.Expression, key: string): boolean => {
    const t = placeType(receiver);
    return t?.kind === 'struct' && table.keys(t.name).has(key);
  };
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      rootedInThis(n.left, parts)
    ) {
      found = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken ||
        n.operator === ts.SyntaxKind.MinusMinusToken) &&
      rootedInThis(n.operand, parts)
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      changes(n.expression.expression, n.expression.name.text)
    ) {
      found = true;
      return;
    }
    if (ts.isPropertyAccessExpression(n) && changes(n.expression, `get ${n.name.text}`)) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(n) &&
      n.arguments.some(
        (a, i) => rootedInThis(a, parts) && writesThroughArgument(n, i, body.getSourceFile()),
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(body);
  return found;
}

interface MutationTable {
  keys(struct: string): ReadonlySet<string>;
  chainable(struct: string): ReadonlySet<string>;
}

function mutatingBodiesOfAll(
  classes: readonly { readonly name: string; readonly bodies: readonly ClassBody[] }[],
  byName: ReadonlyMap<string, CollectedStruct>,
): Map<string, Set<string>> {
  const fns = new Map<string, Set<string>>();
  const keys = new Map<string, Set<string>>();
  const chainable = new Map<string, Set<string>>();
  const candidatesOf = new Map<string, ClassBody[]>();
  for (const { name, bodies } of classes) {
    const candidates = bodies.filter(
      (b) => !b.isStatic && b.node.body !== undefined && memberKeyOf(b.node) !== undefined,
    );
    candidatesOf.set(name, candidates);
    fns.set(name, new Set());
    keys.set(name, new Set());
    chainable.set(
      name,
      new Set(
        candidates
          .filter((b) => !b.isSuper && b.accessor === undefined && returnsThis(b.node.body))
          .map((b) => b.member),
      ),
    );
  }
  const none: ReadonlySet<string> = new Set();
  const table: MutationTable = {
    keys: (struct) => keys.get(struct) ?? none,
    chainable: (struct) => chainable.get(struct) ?? none,
  };
  const throughSuper = (b: ClassBody, own: ReadonlySet<string>): boolean => {
    let found = false;
    eachSuperRef(b.node.body!, (ref) => {
      const fn = b.superMethods.get(superKey(ref));
      if (fn !== undefined && own.has(fn)) found = true;
    });
    return found;
  };
  for (;;) {
    let grew = false;
    for (const { name } of classes) {
      const own = fns.get(name)!;
      for (const b of candidatesOf.get(name)!) {
        if (own.has(b.fnName)) continue;
        if (writesThis(b.node.body!, name, table, byName) || throughSuper(b, own)) {
          own.add(b.fnName);
          if (!b.isSuper) keys.get(name)!.add(memberKeyOf(b.node)!);
          grew = true;
        }
      }
    }
    if (!grew) return fns;
  }
}

interface ClassBody {
  readonly node: MemberFunction;
  readonly declaredIn: string;
  readonly fnName: string;
  readonly member: string;
  readonly accessor?: 'get' | 'set';
  readonly isStatic: boolean;
  readonly isSuper: boolean;
  readonly superMethods: ReadonlyMap<string, string>;
}

interface MemberCollision {
  readonly at: ts.Node;
  readonly message: string;
  readonly fnName: string;
}

function ancestorsOf(
  name: string,
  byName: ReadonlyMap<string, CollectedStruct>,
): readonly CollectedStruct[] {
  const out: CollectedStruct[] = [];
  const seen = new Set<string>([name]);
  const queue = [...(byName.get(name)?.bases ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const s = byName.get(next);
    if (!s) continue;
    out.push(s);
    queue.push(...(s.bases ?? []));
  }
  return out;
}

function ownMethod(
  struct: CollectedStruct | undefined,
  member: string,
  isStatic: boolean,
): ts.MethodDeclaration | undefined {
  for (const m of struct?.members?.methods ?? []) {
    if (!m.body || writtenMemberName(m.name) !== member) continue;
    if (isStaticMember(m) === isStatic) return m;
  }
  return undefined;
}

export interface SuperRef {
  readonly kind: 'method' | 'get' | 'set';
  readonly member: string;
}

export const MISSING_HALF = '';

export const superKey = (ref: SuperRef): string =>
  ref.kind === 'method' ? ref.member : `${ref.kind} ${ref.member}`;

function eachSuperRef(node: ts.Node, f: (ref: SuperRef) => void): void {
  const isSuper = (e: ts.Expression): boolean => e.kind === ts.SyntaxKind.SuperKeyword;
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && isSuper(n.expression)) {
      const member = n.name.text;
      const parent = n.parent;
      if (ts.isCallExpression(parent) && parent.expression === n) {
        f({ kind: 'method', member });
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.left === n &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        if (parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) f({ kind: 'get', member });
        f({ kind: 'set', member });
      } else if (
        (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
          parent.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        f({ kind: 'get', member });
        f({ kind: 'set', member });
      } else {
        f({ kind: 'get', member });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
}

function ownAccessor(
  struct: CollectedStruct | undefined,
  member: string,
  half: 'get' | 'set',
  isStatic: boolean,
): ts.AccessorDeclaration | undefined {
  return struct?.members?.accessors.find(
    (a) =>
      a.body !== undefined &&
      accessorHalf(a) === half &&
      isStaticMember(a) === isStatic &&
      writtenMemberName(a.name) === member,
  );
}

const ownStaticField = (struct: CollectedStruct, member: string): boolean =>
  struct.classNode?.members.some(
    (m) => ts.isPropertyDeclaration(m) && isStaticMember(m) && writtenMemberName(m.name) === member,
  ) ?? false;

export const superFieldKey = (member: string): string => `field ${member}`;

function superTargetOf(
  target: string,
  declaredIn: string,
  ref: SuperRef,
  byName: ReadonlyMap<string, CollectedStruct>,
  isStatic = false,
):
  | { node: MemberFunction; owner: string; fnName: string }
  | { field: string }
  | typeof MISSING_HALF
  | undefined {
  for (const a of ancestorsOf(declaredIn, byName)) {
    if (ref.kind === 'method') {
      const hit = ownMethod(a, ref.member, isStatic);
      if (hit === undefined) continue;
      return {
        node: hit,
        owner: a.decl.name,
        fnName: superFnName(target, a.decl.name, emittedMemberName(ref.member)),
      };
    }
    const either =
      ownAccessor(a, ref.member, 'get', isStatic) ?? ownAccessor(a, ref.member, 'set', isStatic);
    if (either === undefined) {
      if (isStatic && ownStaticField(a, ref.member)) return { field: a.decl.name };
      continue;
    }
    const hit = ownAccessor(a, ref.member, ref.kind, isStatic);
    if (hit === undefined) return MISSING_HALF;
    return {
      node: hit,
      owner: a.decl.name,
      fnName: superFnName(target, a.decl.name, `${ref.kind}_${emittedMemberName(ref.member)}`),
    };
  }
  return undefined;
}

const memberFunctionsOf = (struct: CollectedStruct): readonly MemberFunction[] =>
  [...(struct.members?.methods ?? []), ...(struct.members?.accessors ?? [])]
    .filter((m) => m.body !== undefined)
    .sort((a, b) => a.pos - b.pos);

function effectiveMembers(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): {
  bodies: readonly ClassBody[];
  fieldInits: readonly FieldInit[];
  collisions: readonly MemberCollision[];
} {
  const target = struct.decl.name;
  const chain = [struct, ...ancestorsOf(target, byName)];
  const bodies: ClassBody[] = [];
  const collisions: MemberCollision[] = [];
  const emitted = new Set<string>();
  const pending: {
    node: MemberFunction;
    declaredIn: string;
    fnName: string;
    member: string;
    isSuper: boolean;
  }[] = [];

  const see = (
    node: MemberFunction,
    declaredIn: string,
    fnName: string,
    member: string,
    isSuper: boolean,
  ): void => {
    if (emitted.has(fnName)) return;
    emitted.add(fnName);
    pending.push({ node, declaredIn, fnName, member, isSuper });
  };
  const claimed = new Map<string, { key: string; owner: string; shown: string; written: string }>();
  const taken = new Map<string, string>();
  for (const owner of chain) {
    for (const m of memberFunctionsOf(owner)) {
      const written = writtenMemberName(m.name);
      if (written === undefined) continue;
      const isStatic = isStaticMember(m);
      const half = accessorHalf(m);
      const key = `${isStatic ? 'static ' : ''}${half !== undefined ? 'accessor ' : ''}${written}`;
      const holder = taken.get(key);
      if (holder !== undefined && holder !== owner.decl.name) {
        if (!isPrivateName(written)) continue;
      } else taken.set(key, owner.decl.name);
      const fnName =
        half !== undefined
          ? accessorFnName(target, half, written)
          : methodFnName(target, emittedMemberName(written));
      const shown = `${owner.decl.name}.${written}`;
      const prior = claimed.get(fnName);
      if (prior !== undefined) {
        const two = prior.key !== key || prior.owner !== owner.decl.name;
        if (two && (isPrivateName(written) || isPrivateName(prior.written))) {
          collisions.push({
            at: m.name,
            fnName,
            message:
              `"${prior.shown}" and "${shown}" would both be the function "${fnName}": a ` +
              `private name is emitted without its "#". Rename one of them.`,
          });
        }
        continue;
      }
      claimed.set(fnName, { key, owner: owner.decl.name, shown, written });
      see(m, owner.decl.name, fnName, written, false);
    }
  }
  if (struct.binding === undefined) {
    for (const f of struct.classNode?.members ?? []) {
      if (!ts.isPropertyDeclaration(f) || !isStaticMember(f)) continue;
      const written = writtenMemberName(f.name);
      if (written === undefined) continue;
      const fnName = methodFnName(target, emittedMemberName(written));
      const prior = claimed.get(fnName);
      if (prior === undefined) continue;
      const why =
        isPrivateName(written) || isPrivateName(prior.written)
          ? ': a private name is emitted without its "#"'
          : ', where a class names its functions and its statics alike';
      collisions.push({
        at: f.name,
        fnName,
        message:
          `The static field "${target}.${written}" and the function "${prior.shown}" would both ` +
          `be "${fnName}"${why}. Rename one of them.`,
      });
    }
  }
  const follow = (body: ts.Node, declaredIn: string, isStatic = false): Map<string, string> => {
    const superMethods = new Map<string, string>();
    eachSuperRef(body, (ref) => {
      const found = superTargetOf(target, declaredIn, ref, byName, isStatic);
      if (found === undefined) return;
      if (found === MISSING_HALF) {
        superMethods.set(superKey(ref), MISSING_HALF);
        return;
      }
      if ('field' in found) {
        superMethods.set(superFieldKey(ref.member), found.field);
        return;
      }
      superMethods.set(superKey(ref), found.fnName);
      see(found.node, found.owner, found.fnName, ref.member, true);
    });
    return superMethods;
  };
  const ctor = effectiveCtor(struct, byName);
  if (ctor?.node.body !== undefined) follow(ctor.node.body, ctor.owner.decl.name);
  while (pending.length > 0) {
    const { node, declaredIn, fnName, member, isSuper } = pending.shift()!;
    const superMethods = follow(node.body!, declaredIn, isStaticMember(node));
    const half = accessorHalf(node);
    bodies.push({
      node,
      declaredIn,
      fnName,
      member,
      ...(half !== undefined ? { accessor: half } : {}),
      isStatic: isStaticMember(node),
      isSuper,
      superMethods,
    });
  }
  const fieldInits: FieldInit[] = [];
  const initsOf = (s: CollectedStruct | undefined, seen: Set<string>): void => {
    if (!s || seen.has(s.decl.name)) return;
    seen.add(s.decl.name);
    for (const base of s.bases ?? []) initsOf(byName.get(base), seen);
    for (const f of s.members?.fieldInits ?? []) fieldInits.push(f);
  };
  initsOf(struct, new Set());
  return { bodies, fieldInits, collisions };
}

function ctorSuperMethods(
  struct: CollectedStruct,
  declaredIn: string,
  byName: ReadonlyMap<string, CollectedStruct>,
  ctor: ts.ConstructorDeclaration | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!ctor?.body) return out;
  eachSuperRef(ctor.body, (ref) => {
    const found = superTargetOf(struct.decl.name, declaredIn, ref, byName);
    if (found !== undefined && !(typeof found === 'object' && 'field' in found)) {
      out.set(superKey(ref), found === MISSING_HALF ? MISSING_HALF : found.fnName);
    }
  });
  return out;
}

function effectiveCtor(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): { node: ts.ConstructorDeclaration; owner: CollectedStruct } | undefined {
  const seen = new Set<string>();
  const walk = (
    s: CollectedStruct | undefined,
  ): { node: ts.ConstructorDeclaration; owner: CollectedStruct } | undefined => {
    if (!s || seen.has(s.decl.name)) return undefined;
    seen.add(s.decl.name);
    if (s.members?.ctor) return { node: s.members.ctor, owner: s };
    for (const base of s.bases ?? []) {
      const hit = walk(byName.get(base));
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(struct);
}

function superCtorOf(
  owner: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
): SuperCtor | undefined {
  for (const base of owner.bases ?? []) {
    const found = effectiveCtor(byName.get(base) ?? owner, byName);
    if (!found) continue;
    const filled = byName.get(base);
    if (!filled) continue;
    return { fn: ctorFnName(base), type: structT(base), fields: filled.decl.fields };
  }
  return undefined;
}

function inheritedBinding(
  struct: CollectedStruct,
  byName: ReadonlyMap<string, CollectedStruct>,
  seen: Set<string> = new Set(),
): ReadonlyMap<string, ShaderType> | undefined {
  for (const base of struct.bases ?? []) {
    if (seen.has(base)) continue;
    seen.add(base);
    const owner = byName.get(base);
    if (owner === undefined) continue;
    const found = owner.binding ?? inheritedBinding(owner, byName, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function methodSignature(
  method: MemberFunction,
  shown: string,
  isStatic: boolean,
  selfT: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  skip: ReadonlySet<number> = new Set(),
):
  | { params: FuncDecl['params'][number][]; ret: ShaderType; infers?: true; callerClass?: true }
  | undefined {
  const caller = isStatic ? callerClassForm(method) : undefined;
  const written = method.parameters.filter(
    (p, i) => !skip.has(i) && !(caller !== undefined && p === caller.thisParam),
  );
  const params = parseParams(written, sourceFile, diagnostics, structs, undefined, {
    owner: shown,
    forbidSelf: !isStatic,
  });
  if (!params) return undefined;
  if (caller !== undefined) {
    const constraint = (method as ts.MethodDeclaration).typeParameters?.find(
      (p) => p.name.text === caller.typeParam,
    )?.constraint;
    if (
      selfT.kind === 'struct' &&
      isGenericClass(selfT.name, sourceFile) &&
      constraint !== undefined
    ) {
      const bound = parseReturnType(constraint, sourceFile, diagnostics, structs, undefined);
      if (!bound) return undefined;
      return { params, ret: bound, callerClass: true };
    }
    return { params, ret: selfT, callerClass: true };
  }
  if (method.type?.kind === ts.SyntaxKind.ThisType) return { params, ret: selfT };
  const infers = hasNoWrittenResult(method, sourceFile);
  const ret = parseReturnType(
    infers ? undefined : method.type,
    sourceFile,
    diagnostics,
    structs,
    undefined,
  );
  if (!ret) return undefined;
  return infers ? { params, ret, infers: true } : { params, ret };
}

function callerClassRefusal(
  method: MemberFunction,
  declaredIn: string,
  caller: string,
  shown: string,
): string {
  const member = shown.split('.').pop() ?? shown;
  const statics = new Map<string, string>();
  const cls = method.parent;
  const typeOfStatic = (name: string): string => {
    const decl = ts.isClassLike(cls)
      ? cls.members.find(
          (m): m is ts.PropertyDeclaration =>
            ts.isPropertyDeclaration(m) &&
            isStaticMember(m) &&
            ts.isIdentifier(m.name) &&
            m.name.text === name,
        )
      : undefined;
    if (decl?.type !== undefined) return decl.type.getText();
    const init = decl?.initializer;
    if (init !== undefined && (ts.isNumericLiteral(init) || ts.isPrefixUnaryExpression(init))) {
      return 'f32';
    }
    if (init !== undefined && ts.isCallExpression(init)) return init.expression.getText();
    return 'f32';
  };
  const walk = (n: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(n.name)
    ) {
      statics.set(n.name.text, typeOfStatic(n.name.text));
    }
    ts.forEachChild(n, walk);
  };
  if (method.body !== undefined) walk(method.body);
  const members = ['new (): C', ...[...statics].map(([k, t]) => `${k}: ${t}`)].join('; ');
  const params = method.parameters.map((p) => p.getText()).join(', ');
  const declaredType = authorTypeText(structT(declaredIn));
  return (
    `"${classOfStruct(declaredIn).written}.${member}" builds its value with "new this()", so ` +
    `"${classOfStruct(caller).written}.${member}()" returns a ${authorTypeText(structT(caller))}, ` +
    `but it is declared to return a ${declaredType}, which is the type the editor ` +
    `gives the call. Declare the class the call names: static ${member}<C extends ${declaredType}>` +
    `(this: { ${members} }${params === '' ? '' : `, ${params}`}): C`
  );
}

function otherHalf(node: ts.AccessorDeclaration): ts.AccessorDeclaration | undefined {
  const written = writtenMemberName(node.name);
  const want = ts.isGetAccessorDeclaration(node) ? 'set' : 'get';
  const parent = node.parent;
  if (!ts.isClassLike(parent)) return undefined;
  return parent.members.find(
    (m): m is ts.AccessorDeclaration =>
      accessorHalf(m) === want &&
      writtenMemberName((m as ts.AccessorDeclaration).name) === written &&
      isStaticMember(m) === isStaticMember(node),
  );
}

function accessorSignature(
  node: ts.AccessorDeclaration,
  half: 'get' | 'set',
  shown: string,
  selfT: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
):
  | { params: FuncDecl['params'][number][]; ret: ShaderType; infers?: true; fromGetter?: true }
  | undefined {
  const pair = otherHalf(node);
  const pairType = (): ShaderType | undefined => {
    const t =
      pair === undefined ? undefined : half === 'get' ? pair.parameters[0]?.type : pair.type;
    if (t === undefined) return undefined;
    if (t.kind === ts.SyntaxKind.ThisType) return selfT;
    return mapTsTypeToShaderType(t, sourceFile, undefined);
  };
  if (half === 'get') {
    if (node.type === undefined || hasNoWrittenResult(node, sourceFile)) {
      const inferred = pairType();
      if (inferred !== undefined) return { params: [], ret: inferred };
      return { params: [], ret: voidT, infers: true };
    }
    if (node.type.kind === ts.SyntaxKind.ThisType) return { params: [], ret: selfT };
    const ret = parseReturnType(node.type, sourceFile, diagnostics, structs, undefined);
    return ret === undefined ? undefined : { params: [], ret };
  }
  const value = node.parameters[0];
  if (value === undefined || !ts.isIdentifier(value.name)) return undefined;
  if (value.type !== undefined) {
    const params = parseParams(node.parameters, sourceFile, diagnostics, structs, undefined, {
      owner: shown,
      forbidSelf: true,
    });
    return params === undefined ? undefined : { params, ret: voidT };
  }
  const inferred = pairType();
  if (value.name.text === 'self_') {
    pushDiag(
      diagnostics,
      sourceFile,
      value,
      `"self_" is a name ${shown} gives its object in the emitted function; rename the parameter.`,
    );
    return undefined;
  }
  return inferred === undefined
    ? { params: [{ name: value.name.text, type: voidT }], ret: voidT, fromGetter: true }
    : { params: [{ name: value.name.text, type: inferred }], ret: voidT };
}

function writtenClass(struct: CollectedStruct): string {
  if (struct.classNode === undefined) return struct.decl.name;
  const base = qualifiedParts(struct.classNode).join('.');
  if (struct.binding === undefined) return base;
  const args = writtenInstanceArgs(struct.decl.name, struct.classNode.getSourceFile());
  return `${base}<${args ?? [...struct.binding.values()].map(authorTypeText).join(', ')}>`;
}

export function collectClassFunctions(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  refused?: Set<string>,
): ClassFunction[] {
  const out: ClassFunction[] = [];
  const byName = new Map(structs.map((s) => [s.decl.name, s]));
  const constructed = namesConstructed(sourceFile, structs, byName);
  const superTargets = new Set<string>();
  for (const struct of structs) {
    const body = struct.members?.ctor?.body;
    if (body === undefined || !callsSuper(body)) continue;
    const target = superCtorOf(struct, byName);
    if (target !== undefined) superTargets.add(target.fn);
  }
  const reported = new Set<string>();
  const effectiveOf = new Map(structs.map((s) => [s.decl.name, effectiveMembers(s, byName)]));
  const bodiesOf = (struct: CollectedStruct): readonly ClassBody[] => {
    const effective = effectiveOf.get(struct.decl.name)!;
    const own =
      struct.binding !== undefined ? effective.bodies.filter((b) => !b.isStatic) : effective.bodies;
    return struct.abstract ? own.filter((b) => b.isStatic && !buildsCallerClass(b.node)) : own;
  };
  const mutatingOf = mutatingBodiesOfAll(
    structs.map((s) => ({ name: s.decl.name, bodies: bodiesOf(s) })),
    byName,
  );
  for (const struct of structs) {
    const unbind = pushTypeArguments(struct.binding ?? inheritedBinding(struct, byName));
    try {
      const name = struct.decl.name;
      const selfT = structT(name);
      const members = struct.members;
      const effective = effectiveOf.get(name)!;
      const bodies = bodiesOf(struct);
      const mutating = mutatingOf.get(name)!;
      const lost = new Set(
        [struct, ...ancestorsOf(name, byName)].flatMap((s) => [...(s.withheldFunctions ?? [])]),
      );
      for (const suffix of lost) refused?.add(methodFnName(name, suffix));
      for (const c of effective.collisions) {
        const key = `${c.at.pos}:${c.message}`;
        if (reported.has(key)) continue;
        reported.add(key);
        pushDiag(diagnostics, sourceFile, c.at, c.message);
      }
      for (const body of bodies) {
        const method = body.node;
        const member = body.member;
        const half = body.accessor;
        const isSuperBody = body.isSuper;
        const shown = isSuperBody ? `super.${member}` : `${name}.${member}`;
        const isStatic = body.isStatic;
        const written = method.name.parent;
        const decorated = ts.canHaveDecorators(written) ? (ts.getDecorators(written) ?? []) : [];
        const at = decorated[0];
        if (at !== undefined && !reported.has(`decorator:${at.pos}`)) {
          reported.add(`decorator:${at.pos}`);
          const owner = ts.isClassLike(written.parent) ? written.parent.name?.text : undefined;
          pushDiag(
            diagnostics,
            sourceFile,
            at,
            `A decorator has no place on "${owner ?? name}.${member}"; an entry is a function ` +
              `declaration with a stage attribute, "@vertex export function vs(…) { … }".`,
          );
        }
        if (
          (ts.isMethodDeclaration(method) && method.asteriskToken) ||
          method.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        ) {
          refused?.add(body.fnName);
          continue;
        }
        const fnAt = half === undefined ? functionParams(method) : new Set<number>();
        const parsed = diagnostics.length;
        const signature =
          half === undefined
            ? methodSignature(
                method,
                shown,
                isStatic,
                selfT,
                sourceFile,
                diagnostics,
                structs,
                fnAt,
              )
            : accessorSignature(
                method as ts.AccessorDeclaration,
                half,
                shown,
                selfT,
                sourceFile,
                diagnostics,
                structs,
              );
        if (!signature) {
          if (diagnostics.length === parsed) refused?.add(body.fnName);
          continue;
        }
        const { params } = signature;
        const declaresOwnClass = typeKey(signature.ret) === typeKey(structT(body.declaredIn));
        if (
          isStatic &&
          half === undefined &&
          body.declaredIn !== name &&
          !('callerClass' in signature) &&
          declaresOwnClass &&
          returnsBuiltThis(method)
        ) {
          const key = `caller-class:${body.declaredIn}.${shown}`;
          if (!reported.has(key)) {
            reported.add(key);
            pushDiag(
              diagnostics,
              sourceFile,
              method.name,
              callerClassRefusal(method, body.declaredIn, name, shown),
            );
          }
        }
        const thisReturning =
          signature.infers === true && half === undefined && !isStatic && returnsThis(method.body);
        const infers = signature.infers === true && !thisReturning;
        const ret =
          thisReturning ||
          (declaresOwnClass &&
            ((half === undefined && !isStatic && returnsThis(method.body)) ||
              (isStatic && body.declaredIn !== name && returnsBuiltThis(method))))
            ? selfT
            : signature.ret;
        const writes = !isStatic && mutating.has(body.fnName);
        const stub: FuncDecl = {
          name: body.fnName,
          params: isStatic
            ? params
            : [
                { name: 'self_', type: selfT, ...(writes ? { mode: 'inout' as const } : {}) },
                ...params,
              ],
          ret,
          body: [],
        };
        (stub as { span?: SourceSpan }).span = spanOf(sourceFile, method);
        (stub as { nameSpan?: SourceSpan }).nameSpan = spanOf(sourceFile, method.name);
        if (fnAt.size === 0) recordParamDefaults(stub, method.parameters, isStatic ? 0 : 1);
        const cf: ClassFunction = {
          stub,
          kind: isStatic ? 'static' : 'method',
          struct,
          shown,
          node: method,
          receiver: isStatic
            ? undefined
            : {
                type: selfT,
                mode: writes ? 'inout' : 'param',
                fieldInits: [],
                shown,
                superMethods: body.superMethods,
              },
          mutates: writes,
          member,
          ...(half !== undefined ? { accessor: half } : {}),
          ...(isStatic ? { staticOwner: name, staticSuper: body.superMethods } : {}),
          ...(body.declaredIn !== name ? { inherited: true as const } : {}),
          ...(half === undefined &&
          !isStatic &&
          returnsThis(method.body) &&
          typeKey(ret) === typeKey(selfT)
            ? { returnsThis: true as const }
            : {}),
          ...(infers ? { infers: true as const } : {}),
          ...('fromGetter' in signature && signature.fromGetter === true
            ? { valueFromGetter: true as const }
            : {}),
          ...(fnAt.size > 0 ? { takesFunctions: fnAt } : {}),
        };
        registry.set(stub, cf);
        if (
          effective.collisions.some((c) => c.fnName === stub.name) ||
          lost.has(stub.name.slice(name.length + 1))
        ) {
          collided.add(stub);
        }
        out.push(cf);
      }
      const fieldInits = effective.fieldInits;
      const found =
        struct.abstract && !superTargets.has(ctorFnName(name))
          ? struct.members?.ctor
            ? { node: struct.members.ctor, owner: struct }
            : undefined
          : effectiveCtor(struct, byName);
      const ctor = found?.node;
      if (struct.abstract && ctor === undefined) continue;
      if (ctor === undefined && fieldInits.length === 0 && !constructed.has(name)) continue;
      const shown = `new ${writtenClass(struct)}`;
      const ctorFnAt = ctor ? functionParams(ctor) : new Set<number>();
      const params = ctor
        ? parseParams(
            ctor.parameters.filter((_, i) => !ctorFnAt.has(i)),
            sourceFile,
            diagnostics,
            structs,
            undefined,
            { owner: shown, forbidSelf: true },
          )
        : [];
      if (!params) {
        refused?.add(ctorFnName(name));
        continue;
      }
      const stub: FuncDecl = { name: ctorFnName(name), params, ret: selfT, body: [] };
      if (ctor && ctorFnAt.size === 0) recordParamDefaults(stub, ctor.parameters);
      const propNames = new Set(
        (ctor?.parameters ?? [])
          .filter((p) => ts.isParameterPropertyDeclaration(p, ctor!) && ts.isIdentifier(p.name))
          .map((p) => (p.name as ts.Identifier).text),
      );
      const paramProps = params
        .filter(
          (p) =>
            propNames.has(p.name) &&
            struct.decl.fields.some(
              (f) => f.name === p.name && typeKey(f.type) === typeKey(p.type),
            ),
        )
        .map((p) => ({ name: p.name, type: p.type }));
      const at = ctor ?? members?.node;
      if (at !== undefined) (stub as { span?: SourceSpan }).span = spanOf(sourceFile, at);
      const superCtor = found ? superCtorOf(found.owner, byName) : undefined;
      const chain: readonly (ts.ClassLikeDeclaration | undefined)[] = [
        struct,
        ...ancestorsOf(name, byName),
      ].map((c) => c.classNode);
      const ownerAt = found?.owner.classNode ? chain.indexOf(found.owner.classNode) : -1;
      const afterSuperRuns =
        superCtor !== undefined && ctor?.body !== undefined && callsSuper(ctor.body);
      const first: FieldInit[] = [];
      const atOwner: FieldInit[] = [];
      const below: FieldInit[] = [];
      for (const f of fieldInits) {
        const cls = ts.findAncestor(f.init, ts.isClassLike);
        const depth = ownerAt < 0 || cls === undefined ? -1 : chain.indexOf(cls);
        if (depth < 0) first.push(f);
        else if (depth > ownerAt) {
          if (superCtor === undefined) first.push(f);
        } else if (depth === ownerAt) atOwner.push(f);
        else below.push(f);
      }
      const cf: ClassFunction = {
        stub,
        kind: 'ctor',
        struct,
        shown,
        node: ctor,
        receiver: {
          type: selfT,
          mode: 'ctor',
          fieldInits: first,
          shown,
          ...(superCtor !== undefined ? { superCtor } : {}),
          superMethods: ctorSuperMethods(struct, found?.owner.decl.name ?? name, byName, ctor),
          ...(paramProps.length > 0 && !afterSuperRuns ? { paramProps } : {}),
          ...(afterSuperRuns
            ? { afterSuper: { paramProps, fieldInits: atOwner } }
            : atOwner.length > 0
              ? { ownInits: atOwner }
              : {}),
          ...(below.length > 0 ? { afterBody: below } : {}),
        },
        mutates: false,
        ...(ctorFnAt.size > 0 ? { takesFunctions: ctorFnAt } : {}),
      };
      registry.set(stub, cf);
      out.push(cf);
    } finally {
      unbind();
    }
  }
  return out;
}

export function zeroExprOf(type: ShaderType, scope: LoweringScope): Expr | undefined {
  switch (type.kind) {
    case 'scalar': {
      const k = typeKey(type);
      if (k === 'bool') return { op: 'lit', type: boolT, value: false };
      if (k === 'f32') return { op: 'lit', type: f32T, value: 0 };
      if (k === 'i32') return { op: 'lit', type: i32T, value: 0 };
      if (k === 'u32') return { op: 'lit', type: u32T, value: 0 };
      return undefined;
    }
    case 'vec': {
      const elemT = type.elem === 'f32' ? f32T : type.elem === 'i32' ? i32T : u32T;
      const elem: Expr = { op: 'lit', type: elemT, value: 0 };
      return { op: 'construct', type, args: Array.from({ length: type.n }, () => elem) };
    }
    case 'array': {
      if (type.size === undefined) return undefined;
      const elem = zeroExprOf(type.elem, scope);
      if (!elem) return undefined;
      return { op: 'construct', type, args: Array.from({ length: type.size }, () => elem) };
    }
    case 'struct': {
      const decl = scope.structByName(type.name);
      if (!decl) return undefined;
      const args: Expr[] = [];
      for (const f of decl.fields) {
        const z = zeroExprOf(f.type, scope);
        if (!z) return undefined;
        args.push(z);
      }
      return { op: 'construct', type, args };
    }
    default:
      return undefined;
  }
}

export function ctorPrologue(
  receiver: Receiver,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const parts = ctorParts(receiver, scope, sourceFile, diagnostics);
  return [...parts.prologue, ...parts.afterSuper, ...parts.afterBody];
}

export function ctorParts(
  receiver: Receiver,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): { prologue: Stmt[]; afterSuper: Stmt[]; afterBody: Stmt[] } {
  const prologue = ctorStart(receiver, scope, sourceFile, diagnostics);
  if (receiver.mode === 'inout') return { prologue, afterSuper: [], afterBody: [] };
  const after = receiver.afterSuper;
  return {
    prologue,
    afterSuper:
      after === undefined
        ? []
        : [
            ...paramPropAssigns(after.paramProps, receiver.type, scope),
            ...initAssigns(after.fieldInits, receiver.type, scope, sourceFile, diagnostics),
          ],
    afterBody: initAssigns(receiver.afterBody ?? [], receiver.type, scope, sourceFile, diagnostics),
  };
}

function paramPropAssigns(
  props: readonly { readonly name: string; readonly type: ShaderType }[],
  type: ShaderType,
  scope: LoweringScope,
): Stmt[] {
  return props.map((p) => ({
    s: 'assign',
    target: { op: 'member', type: p.type, base: selfRef(type, scope), field: p.name },
    expr: { op: 'param', type: p.type, name: p.name },
  }));
}

function initAssigns(
  inits: readonly FieldInit[],
  type: ShaderType,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const out: Stmt[] = [];
  for (const f of inits) {
    if (type.kind === 'struct' && scope.isWithheld(type.name, f.name)) continue;
    const lowered = lowerExpression(f.init, sourceFile, scope, diagnostics, f.type);
    if (!lowered) continue;
    const retargeted = retargetIntLitCtx(lowered, f.init, f.type);
    const init =
      reportIntLitRange(retargeted, f.init, f.type, sourceFile, diagnostics) ?? retargeted;
    if (typeKey(init.type) !== typeKey(f.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        f.init,
        numericMismatch('assign', f.type, init.type),
        TS_CODES.TYPE_MISMATCH,
      );
      continue;
    }
    out.push({
      s: 'assign',
      target: { op: 'member', type: f.type, base: selfRef(type, scope), field: f.name },
      expr: init,
    });
  }
  return out;
}

function ctorStart(
  receiver: Receiver,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const self = scope.define(
    { kind: 'local', name: 'this', type: receiver.type, mutable: true, irName: 'self_' },
    false,
    receiver.mode === 'inout',
  );
  if (receiver.mode === 'inout') return [];
  const zero = zeroExprOf(receiver.type, scope);
  const out: Stmt[] = [
    zero
      ? { s: 'var', name: irNameOf(self), type: receiver.type, init: zero }
      : { s: 'var', name: irNameOf(self), type: receiver.type },
  ];
  out.push(
    ...initAssigns(receiver.fieldInits, receiver.type, scope, sourceFile, diagnostics),
    ...paramPropAssigns(receiver.paramProps ?? [], receiver.type, scope),
    ...initAssigns(receiver.ownInits ?? [], receiver.type, scope, sourceFile, diagnostics),
  );
  return out;
}

export function lowerThis(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const b = scope.resolve('this');
  if (!b) {
    const cls = scope.staticClass();
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      cls !== undefined
        ? `In a static member, "this" is the class "${cls}", which is not a value. Name one of ` +
            `its statics through it, "this.K" or "this.f()".`
        : '"this" names a method\'s object; a static function and a top-level function have none.',
    );
    return undefined;
  }
  return b.kind === 'param'
    ? { op: 'param', type: b.type, name: irNameOf(b) }
    : { op: 'varref', type: b.type, name: irNameOf(b) };
}

const noConstructorMessage = (shown: string): string =>
  `"${shown}" has no constructor here; build it as an object literal, { field: value }.`;

export function lowerNew(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  let flat: string;
  let shown: string;
  let dotted: string;
  if (unparen(node.expression).kind === ts.SyntaxKind.ThisKeyword) {
    const cls = scope.resolve('this') === undefined ? scope.staticClass() : undefined;
    if (newRefusal(node, sourceFile) !== undefined) return undefined;
    if (cls === undefined) {
      pushDiag(diagnostics, sourceFile, node, thisObjectNewMessage(node));
      return undefined;
    }
    flat = cls;
    shown = cls;
    dotted = cls;
  } else {
    const target = newTargetOf(node, sourceFile);
    if (target.kind !== 'class') return undefined;
    flat = target.flat;
    shown = unparen(node.expression).getText(sourceFile);
    dotted = target.dotted;
  }
  const instance = newInstanceName(node, flat, sourceFile);
  if (instance === undefined) {
    if (node.typeArguments?.some((t) => writesUndeclaredType(t, sourceFile))) return undefined;
    const why = ambiguousNew(dotted, sourceFile);
    if (why !== undefined) {
      pushDiag(diagnostics, sourceFile, node, why);
      return undefined;
    }
  }
  const name = instance ?? scope.qualifiedStruct(flat);
  const struct = name === undefined ? undefined : scope.structByName(name);
  if (name === undefined || struct === undefined) return undefined;
  const decl = scope.resolveCallee(ctorFnName(name));
  const cf = decl === undefined ? undefined : classFunctionOf(decl);
  if (decl === undefined || cf?.kind !== 'ctor') {
    if (
      !scope.isAbstractStruct(name) &&
      decl === undefined &&
      !scope.declarationRefused(ctorFnName(name))
    ) {
      pushDiag(diagnostics, sourceFile, node, noConstructorMessage(shown));
    }
    return undefined;
  }
  if (cf.node === undefined && (node.arguments?.length ?? 0) > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" declares no constructor, so "new ${shown}()" takes no arguments, as it does in ` +
        `TypeScript. Declare a constructor to pass values, or write the fields: ` +
        `{ ${struct.fields.map((f) => `${f.name}: ...`).join(', ')} }.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const call =
    cf.takesFunctions !== undefined
      ? lowerCopyCall(node, cf, undefined, undefined, false, sourceFile, scope, diagnostics)
      : lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown: `new ${shown}` });
  return call?.op === 'call' ? withSpan(call, sourceFile, node) : call;
}

function flattenedOwner(expr: ts.Expression, scope: LoweringScope): string | undefined {
  const parts: string[] = [];
  let node: ts.Expression = expr;
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text);
      break;
    }
    if (ts.isPropertyAccessExpression(node)) {
      parts.unshift(node.name.text);
      node = node.expression;
      continue;
    }
    return undefined;
  }
  const joined = parts.join('_');
  const qualified = scope.qualifiedNamespace(joined);
  if (qualified !== undefined) return qualified;
  if (parts.length === 1) return joined;
  return undefined;
}

function lowerSuperMethodCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  member: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const self = scope.resolve('this');
  if (!self && scope.staticClass() !== undefined) {
    return lowerStaticSuperCall(node, callee, member, sourceFile, scope, diagnostics);
  }
  if (!self || self.type.kind !== 'struct') {
    pushDiag(diagnostics, sourceFile, callee, NO_SUPER);
    return undefined;
  }
  const fn = scope.superMethods()?.get(member);
  const decl = fn === undefined ? undefined : scope.resolveCallee(fn);
  if (!decl) {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      `Nothing above this class declares a method "${member}", so "super.${member}" names no body.`,
    );
    return undefined;
  }
  const cf = classFunctionOf(decl);
  if (
    cf !== undefined &&
    !checkFunctionAccess(cf, self.type.name, callee.name, sourceFile, scope, diagnostics)
  ) {
    return undefined;
  }
  const leading: Expr[] = [
    self.kind === 'param'
      ? { op: 'param', type: self.type, name: irNameOf(self) }
      : { op: 'varref', type: self.type, name: irNameOf(self) },
  ];
  if (cf?.takesFunctions !== undefined) {
    return lowerCopyCall(
      node,
      cf,
      callee.expression,
      leading[0],
      true,
      sourceFile,
      scope,
      diagnostics,
      true,
    );
  }
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, {
    leading,
    shown: `super.${member}`,
  });
}

export const NO_SUPER =
  '"super" names the class above the one whose body it is written in; a top-level function has none.';

function lowerStaticSuperCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  member: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const fn = scope.superMethods()?.get(member);
  const decl = fn === undefined || fn === MISSING_HALF ? undefined : scope.resolveCallee(fn);
  if (!decl) {
    pushDiag(
      diagnostics,
      sourceFile,
      callee,
      `Nothing above this class declares a static function "${member}", so "super.${member}" ` +
        `names no body.`,
    );
    return undefined;
  }
  const cf = classFunctionOf(decl);
  if (
    cf !== undefined &&
    !checkFunctionAccess(cf, undefined, callee.name, sourceFile, scope, diagnostics)
  ) {
    return undefined;
  }
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown: `super.${member}` });
}

export function lowerClassCall(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  seen: { recv?: Expr } = {},
): Expr | undefined | 'not-a-class-call' {
  const obj = callee.expression;
  const member = callee.name.text;
  if (obj.kind === ts.SyntaxKind.SuperKeyword) {
    return lowerSuperMethodCall(node, callee, member, sourceFile, scope, diagnostics);
  }
  const staticThis =
    unparen(obj).kind === ts.SyntaxKind.ThisKeyword && scope.resolve('this') === undefined
      ? scope.staticClass()
      : undefined;
  const owner = staticThis ?? flattenedOwner(obj, scope);
  if (
    owner !== undefined &&
    (staticThis !== undefined || scope.resolve(owner) === undefined) &&
    (scope.structByName(owner) !== undefined || scope.isNamespace(owner))
  ) {
    const name = owner;
    const shown = `${name}.${member}`;
    const decl = scope.resolveCallee(methodFnName(name, emittedMemberName(member)));
    const cf = decl === undefined ? undefined : classFunctionOf(decl);
    if (cf === undefined) {
      if (scope.isNamespace(name)) {
        if (decl !== undefined)
          return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown });
        const qualified = methodFnName(name, emittedMemberName(member));
        if (scope.isGenericFunction(qualified)) {
          return lowerGenericCall(node, qualified, shown, sourceFile, scope, diagnostics);
        }
        if (scope.declarationRefused(qualified)) return undefined;
        pushDiag(
          diagnostics,
          sourceFile,
          callee.name,
          unknownNameSentence(`"${name}" has no function "${member}".`, member, [
            namespaceFunctionNames(name, sourceFile),
          ]),
        );
        return undefined;
      }
      if (scope.isWithheld(name, emittedMemberName(member))) return undefined;
      if (refusedMember(name, member, scope)) return undefined;
      const builder = abstractBuilderSentence(name, member, scope);
      if (builder !== undefined) {
        pushDiag(diagnostics, sourceFile, node, builder);
        return undefined;
      }
      pushDiag(
        diagnostics,
        sourceFile,
        callee.name,
        noStaticFunction(name, member, scope, sourceFile),
      );
      return undefined;
    }
    if (cf.member !== member || cf.accessor !== undefined) {
      if (isCollidedFunction(decl!)) return undefined;
      pushDiag(
        diagnostics,
        sourceFile,
        callee.name,
        noStaticFunction(name, member, scope, sourceFile),
      );
      return undefined;
    }
    if (
      !checkPrivateAccess(member, declaringClassOf(cf), name, callee.name, sourceFile, diagnostics)
    )
      return undefined;
    if (!checkInheritedPrivateStatic(cf, name, callee, sourceFile, diagnostics)) return undefined;
    if (!checkFunctionAccess(cf, undefined, callee.name, sourceFile, scope, diagnostics)) {
      return undefined;
    }
    if (cf.kind !== 'static') {
      if (scope.isWithheld(name, emittedMemberName(member))) return undefined;
      pushDiag(
        diagnostics,
        sourceFile,
        callee,
        `"${shown}" is a method; call it on a ${name} value: v.${member}(...).`,
      );
      return undefined;
    }
    if (cf.takesFunctions !== undefined) {
      return lowerCopyCall(node, cf, undefined, undefined, false, sourceFile, scope, diagnostics);
    }
    return lowerUserCall(node, decl!, sourceFile, scope, diagnostics, { shown });
  }
  const recv = lowerExpression(obj, sourceFile, scope, diagnostics);
  if (!recv) return undefined;
  if (recv.type.kind !== 'struct') {
    seen.recv = recv;
    return 'not-a-class-call';
  }
  const name = recv.type.name;
  const written = authorTypeText(recv.type);
  const shown = `${written}.${member}`;
  const found = memberFunctionOf(name, member, 'method', scope);
  const withheld = scope.isWithheld(name, emittedMemberName(member));
  if (found === undefined) {
    if (withheld) return undefined;
    if (scope.ancestorsOf(name).some((a) => scope.structByName(a) === undefined)) {
      return undefined;
    }
    const taken = scope.resolveCallee(methodFnName(name, emittedMemberName(member)));
    if (taken !== undefined && isCollidedFunction(taken)) return undefined;
    if (refusedMember(name, member, scope)) return undefined;
    const accessor =
      memberFunctionOf(name, member, 'get', scope) ?? memberFunctionOf(name, member, 'set', scope);
    const field = visibleField(name, member, callee.name, scope) !== undefined;
    const cls = classOfStruct(name);
    const onClass =
      cls.base === name ? undefined : memberFunctionOf(cls.base, member, 'method', scope);
    if (onClass?.cf.kind === 'static') {
      pushDiag(diagnostics, sourceFile, callee, staticOnValue(name, member));
      return undefined;
    }
    const declaredMethods = [name, ...scope.ancestorsOf(name)].flatMap((c) =>
      methodNames(classOfStruct(c).base, sourceFile),
    );
    if (
      !field &&
      accessor === undefined &&
      scope.isAbstractStruct(name) &&
      declaredMethods.includes(member)
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        callee.name,
        `"${written}" is abstract, so there is no instance of it on which "${member}" could run. ` +
          `Construct a concrete class that extends it and call "${member}" on that value.`,
      );
      return undefined;
    }
    pushDiag(
      diagnostics,
      sourceFile,
      accessor !== undefined || field ? callee : callee.name,
      accessor !== undefined
        ? `"${shown}" is an accessor, not a method; read or assign it without the call: ` +
            `v.${member}.`
        : field
          ? `"${member}" is a field of ${written}, not a method.`
          : unknownNameSentence(`"${written}" has no method "${member}".`, member, [
              declaredMethods,
            ]),
    );
    return undefined;
  }
  const { decl, cf } = found;
  if (!checkPrivateAccess(member, declaringClassOf(cf), name, callee.name, sourceFile, diagnostics))
    return undefined;
  if (!checkFunctionAccess(cf, name, callee.name, sourceFile, scope, diagnostics)) return undefined;
  if (cf.kind === 'static') {
    if (withheld) return undefined;
    pushDiag(diagnostics, sourceFile, callee, staticOnValue(name, member));
    return undefined;
  }
  if (cf.takesFunctions !== undefined) {
    return lowerCopyCall(node, cf, obj, recv, false, sourceFile, scope, diagnostics);
  }
  if (cf.mutates) {
    if (!scope.calleeReady(decl, node, sourceFile, diagnostics)) return undefined;
    if (typeKey(cf.stub.ret) === 'void') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" changes its object and returns nothing; call it on its own line.`,
      );
      return undefined;
    }
    const target = mutatingReceiver(node, obj, shown, sourceFile, scope, diagnostics);
    if (!target) return undefined;
    return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown, leading: [target] });
  }
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown, leading: [recv] });
}

function staticOnValue(name: string, member: string): string {
  const cls = classOfStruct(name);
  const shown = `"${cls.written}.${member}"`;
  return cls.inNamespace
    ? `${shown} is static, so a value of ${cls.written} does not have it.`
    : `${shown} is static; call it on the class: ${cls.written}.${member}(...).`;
}

export const declaringClassOf = (cf: ClassFunction): ts.ClassLikeDeclaration | undefined =>
  cf.node !== undefined && ts.isClassLike(cf.node.parent) ? cf.node.parent : undefined;
