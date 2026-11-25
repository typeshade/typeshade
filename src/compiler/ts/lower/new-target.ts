import ts from 'typescript';
import { TS_CODES, type TsCode } from '../codes.js';
import {
  HANDLE_TYPE_NAMES,
  libraryNameSentence,
  lookupTypeName,
  mapTsTypeToShaderType,
} from '../type-map.js';
import {
  EXTRA_BUILTIN_FUNCTIONS,
  isCanonicalMathFn,
  resolveLangConst,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js';
import { removedCallSentence, removedConstantSentence } from '../removed-names.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../../core/intrinsics.js';
import { isConsoleMethod } from '../../../core/console.js';
import { isMixinApplication } from '../mixins.js';
import { isCallerClassThis, isStaticMember, staticThisClass } from '../class-names.js';
import { namespaceMember, qualifiedParts } from '../namespaces.js';
import { declarationOf } from './closures.js';
import { namesInScope, unknownNameSentence } from '../unknown-names.js';
import { arrayNewVerdict } from './array-constructor/form.js';
import {
  firstStatic,
  isStaticsOnly,
  namedStatics,
  namespaceStaticSentence,
} from './new-target/statics.js';

export type NewTarget =
  | {
      readonly kind: 'class';
      readonly flat: string;
      readonly dotted: string;
      readonly decl: ts.ClassDeclaration;
    }
  /** A value that holds a class, `const A = B` or `const Q = class {…}`: a class is no value
   *  here, which its declaration is refused for, and the `new` adds nothing (Rule 12.4). */
  | { readonly kind: 'held' }
  /** Anything else, with the sentence that says what it is and the code the sentence takes. */
  | { readonly kind: 'refused'; readonly message: string; readonly code: TsCode };

const BUILTIN_CALLEES: ReadonlySet<string> = new Set([
  'select',
  'random',
  'fill',
  'sum',
  'any',
  'all',
  'none',
  'zip',
  'workgroupUniformLoad',
]);

const NO_CONSTRUCTOR: ReadonlySet<string> = new Set([
  ...HANDLE_TYPE_NAMES,
  'atomic',
  'ptr',
  'uniform',
  'storage',
  'workgroup',
  'override',
]);

function unparen(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unparen(e.expression) : e;
}

function namePath(e: ts.Expression): ts.Identifier[] | undefined {
  if (ts.isIdentifier(e)) return [e];
  if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.name)) return undefined;
  const head = namePath(unparen(e.expression));
  return head === undefined ? undefined : [...head, e.name];
}

const within = (outer: ts.Node, inner: ts.Node): boolean =>
  inner.pos >= outer.pos && inner.end <= outer.end;

export function scopedDeclaration(id: ts.Identifier): ts.Node | undefined {
  const found = declarationOf(id);
  for (let at: ts.Node | undefined = id.parent; at !== undefined; at = at.parent) {
    if (!ts.isModuleDeclaration(at)) continue;
    if (found !== undefined && within(at, found)) return found;
    const hit = namespaceMember(at, id.text, id);
    if (hit !== undefined) return hit;
  }
  return found;
}

function typeNamed(
  at: ts.Node,
  name: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | 'type parameter' | undefined {
  for (let n: ts.Node | undefined = at.parent; n !== undefined; n = n.parent) {
    const params = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      .typeParameters;
    if (params?.some((p) => p.name.text === name)) return 'type parameter';
    if (ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isBlock(n)) {
      for (const st of n.statements) {
        if (
          (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) &&
          st.name.text === name
        ) {
          return st;
        }
      }
    }
  }
  return undefined;
}

const refused = (message: string, code: TsCode = TS_CODES.CLASS_MEMBER): NewTarget => ({
  kind: 'refused',
  message,
  code,
});

function asCall(node: ts.NewExpression, shown: string, sourceFile: ts.SourceFile): string {
  const types = node.typeArguments?.map((t) => t.getText(sourceFile)).join(', ');
  const args = (node.arguments ?? []).map((a) => a.getText(sourceFile)).join(', ');
  return `${shown}${types === undefined ? '' : `<${types}>`}(${args})`;
}

const isAbstract = (decl: ts.ClassDeclaration): boolean =>
  decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

const abstractNewMessage = (shown: string): string =>
  `"${shown}" is abstract, so there is no instance of it to build. Construct a class that ` +
  `extends it.`;

const typeTarget = (shown: string): NewTarget =>
  refused(
    `"${shown}" is a type, not a value: an interface and a type alias declare a shape and ` +
      `carry no constructor. Write the object literal, { field: value }, or declare ` +
      `"${shown}" as a class to give it one.`,
  );

function aliasTarget(
  decl: ts.TypeAliasDeclaration,
  shown: string,
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): NewTarget {
  const kind = mapTsTypeToShaderType(decl.type, sourceFile, undefined)?.kind;
  if (kind !== 'scalar' && kind !== 'vec' && kind !== 'mat' && kind !== 'array') {
    return typeTarget(shown);
  }
  const target = decl.type.getText(decl.getSourceFile());
  const args = (node.arguments ?? []).map((a) => a.getText(sourceFile)).join(', ');
  return refused(
    `"${shown}" is a type alias of ${target}, which is built without "new": ${target}(${args}).`,
  );
}

const unknownTarget = (id: ts.Identifier): NewTarget =>
  refused(
    unknownNameSentence(`Unknown identifier "${id.text}".`, id.text, namesInScope(id, 'class')),
    TS_CODES.UNKNOWN_NAME,
  );

function holdsClass(decl: ts.VariableDeclaration): boolean {
  const init = decl.initializer === undefined ? undefined : unparen(decl.initializer);
  if (init === undefined) return false;
  if (ts.isClassExpression(init)) return true;
  return ts.isIdentifier(init) && ts.isClassDeclaration(scopedDeclaration(init) ?? init);
}

const functionTarget = (shown: string, node: ts.NewExpression, sourceFile: ts.SourceFile) =>
  refused(
    `"${shown}" is a function, which is called without "new": ${asCall(node, shown, sourceFile)}.`,
  );

const valueTarget = (shown: string): NewTarget => refused(`"${shown}" is a value, not a class.`);

const noMember = (reached: string, member: string, kind = 'member'): NewTarget =>
  refused(`"${reached}" has no ${kind} "${member}".`, TS_CODES.UNKNOWN_NAME);

function enumSentence(decl: ts.EnumDeclaration, shown: string, sourceFile: ts.SourceFile): string {
  const first = decl.members.find((m) => ts.isIdentifier(m.name))?.name.getText(sourceFile);
  return first === undefined
    ? `"${shown}" is an enum, whose values are its members.`
    : `"${shown}" is an enum, whose values are its members: ${shown}.${first}.`;
}

export function notAValueSentence(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): string | null | undefined {
  let decl = scopedDeclaration(id);
  let name = id.text;
  let at: ts.Node = id;
  for (; decl !== undefined && ts.isModuleDeclaration(decl); at = at.parent) {
    const access = at.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== at) break;
    const member = namespaceMember(decl, access.name.text);
    if (member === undefined) break;
    decl = member;
    name = `${name}.${access.name.text}`;
  }
  if (decl === undefined) {
    const type = typeNamed(id, name);
    if (type === 'type parameter') return `"${name}" is a type parameter, not a value.`;
    return type === undefined ? undefined : `"${name}" is a type, not a value.`;
  }
  const inNamespace = ts.isModuleBlock(decl.parent);
  if (ts.isEnumDeclaration(decl) && inNamespace) return null;
  if (ts.isClassDeclaration(decl) && inNamespace && decl.name !== undefined) {
    const read = at.parent;
    const memberRead = ts.isPropertyAccessExpression(read) && read.expression === at;
    const member = memberRead
      ? read.name.text
      : isStaticsOnly(decl)
        ? firstStatic(decl)?.name?.getText(sourceFile)
        : undefined;
    if (member !== undefined) {
      const declared = namedStatics(decl).some((m) => m.name!.getText(sourceFile) === member);
      return declared || !memberRead || decl.heritageClauses !== undefined
        ? namespaceStaticSentence(name, decl.name.text, member)
        : `"${name}" has no static member "${member}".`;
    }
  }
  if (ts.isEnumDeclaration(decl)) return enumSentence(decl, name, sourceFile);
  if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) {
    return `"${name}" is a type, not a value.`;
  }
  if (ts.isModuleDeclaration(decl)) {
    const body = decl.body;
    const constant =
      body !== undefined && ts.isModuleBlock(body)
        ? body.statements
            .filter(ts.isVariableStatement)
            .find((st) => st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
            ?.declarationList.declarations.find((d) => ts.isIdentifier(d.name))
        : undefined;
    return constant === undefined
      ? `"${name}" is a namespace, not a value.`
      : `"${name}" is a namespace, not a value: its values are its members, ` +
          `${name}.${constant.name.getText(sourceFile)}.`;
  }
  if (!ts.isClassDeclaration(decl)) return undefined;
  if (isAbstract(decl)) {
    return `"${name}" is an abstract class, not a value. Build a class that extends it.`;
  }
  const first = isStaticsOnly(decl) ? firstStatic(decl) : undefined;
  if (first !== undefined) {
    const member = `${name}.${first.name!.getText(sourceFile)}`;
    return (
      `"${name}" is a class of static members, not a value: its values are its members, ` +
      `${ts.isPropertyDeclaration(first) ? member : `${member}(...)`}.`
    );
  }
  return ts.findAncestor(id, ts.isFunctionLike) === undefined
    ? `"${name}" is a class, not a value.`
    : `"${name}" is a class, not a value. Build one with "new ${name}(...)".`;
}

function classify(
  decl: ts.Node,
  shown: string,
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): NewTarget {
  if (ts.isClassDeclaration(decl)) {
    if (isAbstract(decl)) return refused(abstractNewMessage(shown));
    const parts = qualifiedParts(decl);
    return { kind: 'class', flat: parts.join('_'), dotted: parts.join('.'), decl };
  }
  const holdsFunction =
    ts.isVariableDeclaration(decl) &&
    decl.initializer !== undefined &&
    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
  if (ts.isFunctionDeclaration(decl) || holdsFunction) {
    return functionTarget(shown, node, sourceFile);
  }
  if (ts.isEnumDeclaration(decl)) return refused(enumSentence(decl, shown, sourceFile));
  if (ts.isModuleDeclaration(decl)) return refused(`"${shown}" is a namespace, not a class.`);
  if (ts.isTypeAliasDeclaration(decl)) return aliasTarget(decl, shown, node, sourceFile);
  if (ts.isInterfaceDeclaration(decl)) return typeTarget(shown);
  if (ts.isVariableDeclaration(decl) && isMixinApplication(decl, sourceFile)) {
    return refused(
      `"${shown}" is a mixin applied to a class, and is built through a class that extends ` +
        `it: class C extends ${shown} {}, then new C().`,
    );
  }
  if (ts.isVariableDeclaration(decl) && holdsClass(decl)) return { kind: 'held' };
  return valueTarget(shown);
}

function memberOf(
  decl: ts.EnumDeclaration | ts.ClassDeclaration,
  reached: string,
  member: string,
  shown: string,
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): NewTarget {
  if (ts.isEnumDeclaration(decl)) {
    return decl.members.some((m) => m.name.getText(sourceFile) === member)
      ? valueTarget(shown)
      : noMember(reached, member);
  }
  const found = decl.members.find(
    (m) => isStaticMember(m) && m.name !== undefined && m.name.getText(sourceFile) === member,
  );
  if (found === undefined) return noMember(reached, member, 'static member');
  return ts.isMethodDeclaration(found)
    ? functionTarget(shown, node, sourceFile)
    : valueTarget(shown);
}

function hostMember(
  root: 'Math' | 'console',
  rest: readonly ts.Identifier[],
  shown: string,
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): NewTarget {
  const member = rest[0]!.text;
  const isFunction =
    root === 'Math'
      ? resolveMathFn(member) !== undefined || resolveMathExpand(member) !== undefined
      : isConsoleMethod(member);
  const isValue = root === 'Math' && resolveMathConst(member) !== undefined;
  if (!isFunction && !isValue) return noMember(root, member);
  if (rest.length > 1) return noMember(`${root}.${member}`, rest[1]!.text);
  return isFunction ? functionTarget(shown, node, sourceFile) : valueTarget(shown);
}

function undeclared(
  id: ts.Identifier,
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): NewTarget {
  const name = id.text;
  const type = typeNamed(node, name);
  if (type === 'type parameter') return refused(`"${name}" is a type parameter, not a class.`);
  if (type !== undefined && ts.isTypeAliasDeclaration(type)) {
    return aliasTarget(type, name, node, sourceFile);
  }
  if (type !== undefined) return typeTarget(name);
  if (lookupTypeName(name) !== undefined || name === 'array') {
    return refused(
      `"${name}" is a WGSL constructor, which is called without "new": ` +
        `${asCall(node, name, sourceFile)}.`,
    );
  }
  if (NO_CONSTRUCTOR.has(name)) {
    return refused(`"${name}" is a type, not a value, and WGSL gives it no constructor.`);
  }
  const library = libraryNameSentence(name, 'class');
  if (library !== undefined) return refused(library);
  const removed = removedCallSentence(name) ?? removedConstantSentence(name);
  if (removed !== undefined) return refused(removed, TS_CODES.UNKNOWN_NAME);
  if (
    isCanonicalMathFn(name) ||
    EXTRA_BUILTIN_FUNCTIONS.has(name) ||
    resolveMathExpand(name) ||
    isAtomicIntrinsic(name) ||
    isBarrierIntrinsic(name) ||
    BUILTIN_CALLEES.has(name)
  ) {
    return functionTarget(name, node, sourceFile);
  }
  if (resolveLangConst(name) !== undefined) return valueTarget(name);
  return unknownTarget(id);
}

export function newTargetOf(node: ts.NewExpression, sourceFile: ts.SourceFile): NewTarget {
  const target = unparen(node.expression);
  const shown = target.getText(sourceFile);
  const path = namePath(target);
  if (path === undefined) {
    return refused(
      `A class this file declares is built with "new", and "${shown}" is not one of them.`,
    );
  }
  const [root, ...rest] = path as [ts.Identifier, ...ts.Identifier[]];
  let decl = scopedDeclaration(root);
  if (decl === undefined) {
    if (rest.length === 0) return undeclared(root, node, sourceFile);
    if (root.text === 'Math' || root.text === 'console') {
      return hostMember(root.text, rest, shown, node, sourceFile);
    }
    return unknownTarget(root);
  }
  let reached = root.text;
  for (const [i, part] of rest.entries()) {
    if (ts.isEnumDeclaration(decl) || ts.isClassDeclaration(decl)) {
      const upTo = [reached, ...rest.slice(0, i + 1).map((p) => p.text)].join('.');
      return memberOf(decl, reached, part.text, upTo, node, sourceFile);
    }
    if (!ts.isModuleDeclaration(decl)) return valueTarget(shown);
    const member: ts.Node | undefined = namespaceMember(decl, part.text);
    if (member === undefined) return noMember(reached, part.text);
    decl = member;
    reached = `${reached}.${part.text}`;
  }
  return classify(decl, shown, node, sourceFile);
}

function enclosingClassName(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassLike(at)) return at.name?.text;
  }
  return undefined;
}

export const thisObjectNewMessage = (node: ts.NewExpression): string =>
  `"this" here is an object, not a class, so "new" cannot build one from it. Name the class, ` +
  `"new ${enclosingClassName(node) ?? 'C'}(...)"; "new this()" builds the class in a static ` +
  `member.`;

export function newRefusal(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): { readonly message: string; readonly code: TsCode } | undefined {
  const array = arrayNewVerdict(node);
  if (array !== undefined) return array === 'built-here' ? undefined : array;
  const target = unparen(node.expression);
  if (target.kind === ts.SyntaxKind.ThisKeyword) {
    const cls = staticThisClass(target);
    if (cls === undefined) {
      return { message: thisObjectNewMessage(node), code: TS_CODES.CLASS_MEMBER };
    }
    return isAbstract(cls) && !isCallerClassThis(target)
      ? { message: abstractNewMessage(cls.name?.text ?? ''), code: TS_CODES.CLASS_MEMBER }
      : undefined;
  }
  const t = newTargetOf(node, sourceFile);
  return t.kind === 'refused' ? t : undefined;
}
