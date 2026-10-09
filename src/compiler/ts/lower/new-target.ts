// ═══ What a `new` names (Rule 2.1, Rule 8.13) ═══
//
// A `new` builds a class the file declares (#86, #190). Its target is resolved the way TypeScript
// resolves it, from where the `new` is written: the innermost declaration of the name, every
// block of a namespace around it counted as one namespace, and a dotted name through the
// namespaces it names (#107). It used to be matched by its spelling against every class
// declaration in the file, so a namespace's class answered to its short name from anywhere,
// `new (C)()` named nothing, and whatever else the target was, it was told that "new" allocates a
// JS object.
//
// What the target turns out to be decides the one sentence it gets. A class is built. A WGSL
// constructor and a function are called without `new`, an enum's values are its members, and a
// value, a namespace, a type and a type parameter are none of them a class. A name nothing
// declares is an unknown name, as it is in any other position (TS8022). The sentence is said once
// for the file, where the `new` is written ({@link newRefusal}, from semantic.ts), so a body no
// call lowers says it too and a body lowered once per instance says it once (Rule 12.4).

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
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../../core/intrinsics.js';
import { isConsoleMethod } from '../../../core/console.js';
import { isMixinApplication } from '../mixins.js';
import { isStaticMember, staticThisClass } from '../class-names.js';
import { namespaceMember, qualifiedParts } from '../namespaces.js';
import { declarationOf } from './closures.js';
import { namesInScope, unknownNameSentence } from '../unknown-names.js';

/** What a `new` names. */
export type NewTarget =
  /** A class of the file: the struct the module emits it as (`N_P`), its name written in full
   *  from the top of the file (`N.P`), and its declaration. */
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

/** The free functions a call reaches without a declaration of the file, which are no more a
 *  class than a declared function is. */
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

/** The WGSL types that have no constructor: a texture and a sampler, which the host binds, the
 *  memory an `atomic` names, a pointer, and the wrappers that say where a binding or a module
 *  variable lives. */
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

/** The identifiers of a dotted name, `N.P` as `[N, P]`, or undefined for any other shape. */
function namePath(e: ts.Expression): ts.Identifier[] | undefined {
  if (ts.isIdentifier(e)) return [e];
  if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.name)) return undefined;
  const head = namePath(unparen(e.expression));
  return head === undefined ? undefined : [...head, e.name];
}

const within = (outer: ts.Node, inner: ts.Node): boolean =>
  inner.pos >= outer.pos && inner.end <= outer.end;

/** The declaration `id` names, as TypeScript finds it: {@link declarationOf}'s innermost block,
 *  parameter list or loop header, with each namespace around `id` taken whole. Two
 *  `namespace N { ... }` blocks are one namespace, so a member one block exports is reached by its
 *  short name from another, ahead of a declaration of the same name further out; one it does not
 *  export is not. */
export function scopedDeclaration(id: ts.Identifier): ts.Node | undefined {
  const found = declarationOf(id);
  for (let at: ts.Node | undefined = id.parent; at !== undefined; at = at.parent) {
    if (!ts.isModuleDeclaration(at)) continue;
    // Found inside this namespace's own block, which is nearer than its other blocks.
    if (found !== undefined && within(at, found)) return found;
    const hit = namespaceMember(at, id.text, id);
    if (hit !== undefined) return hit;
  }
  return found;
}

/** An interface, a type alias or a type parameter of `name` that is visible where `at` is: the
 *  names a `new` finds and TypeScript refuses as "only refers to a type". */
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

/** The same expression called, which is what a constructor or a function wants: `vec3f(1., 2.,
 *  3.)` for `new vec3f(1., 2., 3.)`. */
function asCall(node: ts.NewExpression, shown: string, sourceFile: ts.SourceFile): string {
  const types = node.typeArguments?.map((t) => t.getText(sourceFile)).join(', ');
  const args = (node.arguments ?? []).map((a) => a.getText(sourceFile)).join(', ');
  return `${shown}${types === undefined ? '' : `<${types}>`}(${args})`;
}

const isAbstract = (decl: ts.ClassDeclaration): boolean =>
  decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

/** The sentence for a `new` on an `abstract` class, which TypeScript refuses as well. */
const abstractNewMessage = (shown: string): string =>
  `"${shown}" is abstract, so there is no instance of it to build. Construct a class that ` +
  `extends it.`;

/** An interface or a type alias the target reaches: a shape, with no constructor to call. */
const typeTarget = (shown: string): NewTarget =>
  refused(
    `"${shown}" is a type, not a value: an interface and a type alias declare a shape and ` +
      `carry no constructor. Write the object literal, { field: value }, or declare ` +
      `"${shown}" as a class to give it one.`,
  );

/** A type alias of a type WGSL builds with a constructor, `type S = vec3`, which has no fields
 *  to write in an object literal: its target, called (Rule 12.1). */
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

/** The sentence for a name nothing declares where a `new` names it, with the remedy every
 *  unknown name gets (Rule 12.1). The name it is spelled like is one a `new` builds, a class or a
 *  namespace on the way to one: a local `pos` is no remedy for `new Pos()`. */
const unknownTarget = (id: ts.Identifier): NewTarget =>
  refused(
    unknownNameSentence(`Unknown identifier "${id.text}".`, id.text, namesInScope(id, 'class')),
    TS_CODES.UNKNOWN_NAME,
  );

/** Whether a variable holds a class: one written in place, or one the file declares named by
 *  its name. */
function holdsClass(decl: ts.VariableDeclaration): boolean {
  const init = decl.initializer === undefined ? undefined : unparen(decl.initializer);
  if (init === undefined) return false;
  if (ts.isClassExpression(init)) return true;
  return ts.isIdentifier(init) && ts.isClassDeclaration(scopedDeclaration(init) ?? init);
}

/** A function the target reaches, which a call runs without `new`. */
const functionTarget = (shown: string, node: ts.NewExpression, sourceFile: ts.SourceFile) =>
  refused(
    `"${shown}" is a function, which is called without "new": ${asCall(node, shown, sourceFile)}.`,
  );

/** A value the target reaches, a number or an object, which is no class. */
const valueTarget = (shown: string): NewTarget => refused(`"${shown}" is a value, not a class.`);

/** A member a dotted target names that the thing before it does not have (TypeScript's TS2339). */
const noMember = (reached: string, member: string, kind = 'member'): NewTarget =>
  refused(`"${reached}" has no ${kind} "${member}".`, TS_CODES.UNKNOWN_NAME);

/** What an enum is: its values are its members, the first of which the sentence writes. */
function enumSentence(decl: ts.EnumDeclaration, shown: string, sourceFile: ts.SourceFile): string {
  const first = decl.members.find((m) => ts.isIdentifier(m.name))?.name.getText(sourceFile);
  return first === undefined
    ? `"${shown}" is an enum, whose values are its members.`
    : `"${shown}" is an enum, whose values are its members: ${shown}.${first}.`;
}

/**
 * What a name the file declares is, read where a value is, when it holds no value a shader has:
 * an enum, a namespace, a class or a type (Rule 2.1), in the words a `new` of it is told. Each
 * names the value it does offer: an enum's member, a namespace's exported constant, an instance
 * of a class or, for a class of statics, a static member. Undefined for a name the file does not
 * declare, or declares as anything else. It was `Unknown identifier "E"`, of a name the file
 * declares. Null where the declaration's own refusal is the one diagnostic (Rule 12.4): an enum
 * inside a namespace, refused where it is declared (TS8014).
 *
 * A class inside a namespace whose static member is read (`N.P.K`, `N.P.g()`, `P.g()` inside
 * the namespace) is not read as a value: the author read a member, which a shader does not read
 * on such a class, and the sentence says that, with the top-level class that does read it.
 */
export function notAValueSentence(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): string | null | undefined {
  let decl = scopedDeclaration(id);
  let name = id.text;
  let at: ts.Node = id;
  // `N.P` read through the namespaces it names is what its last name is.
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
    // A member read (`N.P.K`, `N.P.g()`) names that member; the class read whole, when it is a
    // class of statics, names its first static, the value it offers at the top level.
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
  // A module constant is folded before any function exists, so a `new` there is no remedy.
  return ts.findAncestor(id, ts.isFunctionLike) === undefined
    ? `"${name}" is a class, not a value.`
    : `"${name}" is a class, not a value. Build one with "new ${name}(...)".`;
}

/** A class's static members a `.` names: fields and methods written with a name. */
function namedStatics(decl: ts.ClassDeclaration): ts.ClassElement[] {
  return decl.members.filter(
    (m) => isStaticMember(m) && m.name !== undefined && ts.isIdentifier(m.name),
  );
}

/** Whether a class has statics and no field of each value: a class of static members. */
function isStaticsOnly(decl: ts.ClassDeclaration): boolean {
  const instanceField = decl.members.some((m) => ts.isPropertyDeclaration(m) && !isStaticMember(m));
  return !instanceField && namedStatics(decl).length > 0;
}

/** The static a sentence names for a class of statics: its first field, else its first method. */
function firstStatic(decl: ts.ClassDeclaration): ts.ClassElement | undefined {
  const statics = namedStatics(decl);
  return statics.find(ts.isPropertyDeclaration) ?? statics[0];
}

/** A static member of a class inside a namespace, which a shader does not read: the same class
 *  declared at the top level of the file does. */
function namespaceStaticSentence(shown: string, className: string, member: string): string {
  return (
    `"${shown}" is a class inside a namespace, and a shader does not read the static members ` +
    `of one ("${shown}.${member}"). Declare "${className}" at the top level of the file and ` +
    `use "${className}.${member}".`
  );
}

/** What a declaration the target resolved to is, as a `new` sees it. */
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
  // A mixin applied and named holds a class the file builds through a class that extends it,
  // which TypeScript would build as it is (T8, #92).
  if (ts.isVariableDeclaration(decl) && isMixinApplication(decl, sourceFile)) {
    return refused(
      `"${shown}" is a mixin applied to a class, and is built through a class that extends ` +
        `it: class C extends ${shown} {}, then new C().`,
    );
  }
  if (ts.isVariableDeclaration(decl) && holdsClass(decl)) return { kind: 'held' };
  return valueTarget(shown);
}

/** A member of an enum or a class a dotted target reaches: `E.A`, `C.make`, `C.K`. */
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

/** A `new` on a member of `Math` or `console`, the two host objects the ambient library keeps
 *  (Rule 2.1): a function of either is called, a constant of `Math` is a value. */
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

/** A bare name no declaration of the file gives: a type parameter or a type around it, a WGSL
 *  type, a name the library declares (a type of its own, `Math`, `console`, `Symbol`), a builtin
 *  function, a §9.3 constant, or nothing at all. */
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

/** What `new X(...)` names, for any target but `this`, which the lowering reads off its scope. */
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
      // What the member is decides, whatever follows it: `E.A` and `C.K` are values.
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

/** The name of the class a node stands inside, the innermost one. */
function enclosingClassName(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassLike(at)) return at.name?.text;
  }
  return undefined;
}

/** The sentence a `new this()` outside a static member gets: `this` there is an object. */
export const thisObjectNewMessage = (node: ts.NewExpression): string =>
  `"this" here is an object, not a class, so "new" cannot build one from it. Name the class, ` +
  `"new ${enclosingClassName(node) ?? 'C'}(...)"; "new this()" builds the class in a static ` +
  `member.`;

/** Why a `new` builds no class, or undefined when it builds one: the one sentence for the file,
 *  said where the `new` is written. `new this()` builds the class in a static member (Rule 8.13),
 *  and anything else is {@link newTargetOf}'s. */
export function newRefusal(
  node: ts.NewExpression,
  sourceFile: ts.SourceFile,
): { readonly message: string; readonly code: TsCode } | undefined {
  const target = unparen(node.expression);
  if (target.kind === ts.SyntaxKind.ThisKeyword) {
    const cls = staticThisClass(target);
    if (cls === undefined) {
      return { message: thisObjectNewMessage(node), code: TS_CODES.CLASS_MEMBER };
    }
    // A static member of an abstract class builds no instance of it, as TypeScript says (TS2511).
    return isAbstract(cls)
      ? { message: abstractNewMessage(cls.name?.text ?? ''), code: TS_CODES.CLASS_MEMBER }
      : undefined;
  }
  const t = newTargetOf(node, sourceFile);
  return t.kind === 'refused' ? t : undefined;
}
