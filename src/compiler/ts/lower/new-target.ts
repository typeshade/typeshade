// ═══ What a `new` names (Rule 2.1, Rule 8.13) ═══
//
// A `new` builds a class the file declares (#86, #190). Its target is resolved the way TypeScript
// resolves it, from where the `new` is written: the innermost declaration of the name, and a
// dotted name through the namespaces it names (#107). It used to be matched by its spelling
// against every class declaration in the file, so a namespace's class answered to its short name
// from anywhere, `new (C)()` named nothing, and whatever else the target was, it was told that
// "new" allocates a JS object.
//
// What the target turns out to be decides the one sentence it gets. A class is built. A WGSL
// constructor and a function are called without `new`, an enum's values are its members, and a
// value, a namespace, a type and a type parameter are none of them a class. A name nothing
// declares is an unknown name, as it is in any other position (TS8022).

import ts from 'typescript';
import { TS_CODES, type TsCode } from '../codes.js';
import { lookupTypeName } from '../type-map.js';
import { USER_FIRST_BUILTINS, isCanonicalMathFn, resolveMathExpand } from '../math-alias.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../../core/intrinsics.js';
import { isMixinApplication } from '../mixins.js';
import { declarationOf } from './closures.js';

/** What a `new` names. */
export type NewTarget =
  /** A class the file declares: its declaration, the struct the module emits it as (`N_P`),
   *  and its name written in full from the top of the file (`N.P`). */
  | {
      readonly kind: 'class';
      readonly decl: ts.ClassDeclaration;
      readonly flat: string;
      readonly dotted: string;
    }
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

/** The name a declaration statement gives, when it gives one plainly. */
function declaredName(st: ts.Statement, name: string): ts.Node | undefined {
  if (
    (ts.isClassDeclaration(st) ||
      ts.isFunctionDeclaration(st) ||
      ts.isEnumDeclaration(st) ||
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) ||
      ts.isModuleDeclaration(st)) &&
    st.name !== undefined &&
    ts.isIdentifier(st.name) &&
    st.name.text === name
  ) {
    return st;
  }
  if (ts.isVariableStatement(st)) {
    return st.declarationList.declarations.find(
      (d) => ts.isIdentifier(d.name) && d.name.text === name,
    );
  }
  return undefined;
}

/** The member `name` of a namespace, looked for in every block of that name beside it, since
 *  two `namespace N { ... }` blocks are one namespace. */
function namespaceMember(ns: ts.ModuleDeclaration, name: string): ts.Node | undefined {
  const around = ns.parent;
  const blocks =
    ts.isSourceFile(around) || ts.isModuleBlock(around)
      ? around.statements.filter(
          (st): st is ts.ModuleDeclaration =>
            ts.isModuleDeclaration(st) &&
            ts.isIdentifier(st.name) &&
            ts.isIdentifier(ns.name) &&
            st.name.text === ns.name.text,
        )
      : [ns];
  for (const block of blocks) {
    const body = block.body;
    // `namespace A.B { ... }`: the body of `A` is `B` itself.
    if (body !== undefined && ts.isModuleDeclaration(body)) {
      if (ts.isIdentifier(body.name) && body.name.text === name) return body;
      continue;
    }
    if (body === undefined || !ts.isModuleBlock(body)) continue;
    for (const st of body.statements) {
      const hit = declaredName(st, name);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** What another block of a namespace around `id` declares under its name: two
 *  `namespace N { ... }` blocks are one namespace, and a member one of them exports is reached by
 *  its short name from the other, which the block-by-block lookup of {@link declarationOf} does
 *  not see. */
function mergedNamespaceMember(id: ts.Identifier): ts.Node | undefined {
  for (let at: ts.Node | undefined = id.parent; at !== undefined; at = at.parent) {
    if (!ts.isModuleDeclaration(at)) continue;
    const hit = namespaceMember(at, id.text);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** The namespaces around a declaration, outermost first, and its own name: `[N, P]`. */
function qualifiedParts(decl: ts.ClassDeclaration): string[] {
  const parts = [decl.name?.text ?? ''];
  for (let at: ts.Node | undefined = decl.parent; at !== undefined; at = at.parent) {
    if (ts.isModuleDeclaration(at) && ts.isIdentifier(at.name)) parts.unshift(at.name.text);
  }
  return parts;
}

/** An interface, a type alias or a type parameter of `name` that is visible where `at` is: the
 *  names a `new` finds and TypeScript refuses as "only refers to a type". */
function typeNamed(at: ts.Node, name: string): 'type' | 'type parameter' | undefined {
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
          return 'type';
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
export const abstractNewMessage = (shown: string): string =>
  `"${shown}" is abstract, so there is no instance of it to build. Construct a class that ` +
  `extends it.`;

/** An interface or a type alias the target reaches: a shape, with no constructor to call. */
const typeTarget = (shown: string): NewTarget =>
  refused(
    `"${shown}" is a type, not a value: an interface and a type alias declare a shape and ` +
      `carry no constructor. Write the object literal, { field: value }, or declare ` +
      `"${shown}" as a class to give it one.`,
  );

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
    return { kind: 'class', decl, flat: parts.join('_'), dotted: parts.join('.') };
  }
  const holdsFunction =
    ts.isVariableDeclaration(decl) &&
    decl.initializer !== undefined &&
    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
  if (ts.isFunctionDeclaration(decl) || holdsFunction) {
    return refused(
      `"${shown}" is a function, which is called without "new": ${asCall(node, shown, sourceFile)}.`,
    );
  }
  if (ts.isEnumDeclaration(decl)) {
    const first = decl.members.find((m) => ts.isIdentifier(m.name))?.name.getText(sourceFile);
    return refused(
      first === undefined
        ? `"${shown}" is an enum, whose values are its members.`
        : `"${shown}" is an enum, whose values are its members: ${shown}.${first}.`,
    );
  }
  if (ts.isModuleDeclaration(decl)) return refused(`"${shown}" is a namespace, not a class.`);
  if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) return typeTarget(shown);
  // A mixin applied and named holds a class the file builds through a class that extends it.
  if (ts.isVariableDeclaration(decl) && isMixinApplication(decl, sourceFile)) {
    return refused(
      `A class this file declares is built with "new", and "${shown}" is not one of them.`,
    );
  }
  return refused(`"${shown}" is a value, not a class.`);
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
  let decl = declarationOf(root) ?? mergedNamespaceMember(root);
  if (decl === undefined) {
    const name = root.text;
    if (rest.length > 0) return refused(`Unknown identifier "${name}".`, TS_CODES.UNKNOWN_NAME);
    const type = typeNamed(node, name);
    if (type === 'type parameter') return refused(`"${name}" is a type parameter, not a class.`);
    if (type === 'type') return typeTarget(name);
    if (lookupTypeName(name) !== undefined || name === 'array') {
      return refused(
        `"${name}" is a WGSL constructor, which is called without "new": ` +
          `${asCall(node, name, sourceFile)}.`,
      );
    }
    if (
      isCanonicalMathFn(name) ||
      USER_FIRST_BUILTINS.has(name) ||
      resolveMathExpand(name) ||
      isAtomicIntrinsic(name) ||
      isBarrierIntrinsic(name) ||
      BUILTIN_CALLEES.has(name)
    ) {
      return refused(
        `"${name}" is a function, which is called without "new": ${asCall(node, name, sourceFile)}.`,
      );
    }
    return refused(`Unknown identifier "${name}".`, TS_CODES.UNKNOWN_NAME);
  }
  let reached = root.text;
  for (const part of rest) {
    if (!ts.isModuleDeclaration(decl)) {
      return ts.isClassDeclaration(decl) || ts.isEnumDeclaration(decl)
        ? refused(
            `A class this file declares is built with "new", and "${shown}" is not one of them.`,
          )
        : refused(`"${shown}" is a value, not a class.`);
    }
    const member: ts.Node | undefined = namespaceMember(decl, part.text);
    if (member === undefined) {
      return refused(`"${reached}" has no member "${part.text}".`, TS_CODES.UNKNOWN_NAME);
    }
    decl = member;
    reached = `${reached}.${part.text}`;
  }
  return classify(decl, shown, node, sourceFile);
}
