// === The names a class member is written and emitted under (§26, Rule 8.11, Rule 8.12) ===
//
// A class member is written `x` or, when it is private to its class, `#x`. WGSL and GLSL ES 3.00
// have no `#`, so a private member is emitted under the name without it: the field `#count` is
// the struct member `count`, the method `#step` is `Cls_step`. What keeps it private is the
// front end, which lets `#count` be named only inside the class that declares it (the rule
// TypeScript's checker enforces), and which refuses a class chain where the name without the
// `#` would stand for two members.
//
// An accessor is two functions of the module, `Cls_get_x` and `Cls_set_x`: a getter and a
// setter share the property's name, so each half takes a word that says which it is.
//
// One file for these, because four collectors and three lowerers spell them and a spelling
// that drifts between two of them is a call that resolves to nothing.

import ts from 'typescript';

/** The name a class member is written under: `x`, or `#x` for a private name. `undefined` for
 *  a quoted or computed name, which has no struct spelling. */
export function writtenMemberName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

/** Whether a written member name is private to its class: `#x`. */
export const isPrivateName = (written: string): boolean => written.startsWith('#');

/** The name a member takes in the emitted text: a private name without its `#`. */
export const emittedMemberName = (written: string): string =>
  isPrivateName(written) ? written.slice(1) : written;

/** The emitted name of one half of an accessor: `Circle_get_area`, `Slider_set_value`. */
export const accessorFnName = (struct: string, half: 'get' | 'set', written: string): string =>
  `${struct}_${half}_${emittedMemberName(written)}`;

/** Whether `node` is a `static` member. */
export const isStaticMember = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (m) => m.kind === ts.SyntaxKind.StaticKeyword,
  ) ?? false;

/** The class declarations or expressions `node` stands inside, innermost first. A private name
 *  resolves to the first of them that declares it, which is TypeScript's lexical rule. */
export function enclosingClasses(node: ts.Node): ts.ClassLikeDeclaration[] {
  const out: ts.ClassLikeDeclaration[] = [];
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at) || ts.isClassExpression(at)) out.push(at);
  }
  return out;
}

/** The member of `cls` declared under the private name `written` (`#x`), or `undefined`. */
export function privateMemberOf(
  cls: ts.ClassLikeDeclaration,
  written: string,
): ts.ClassElement | undefined {
  return cls.members.find(
    (m) => m.name !== undefined && ts.isPrivateIdentifier(m.name) && m.name.text === written,
  );
}

/** The class that declares the private name `written` for an access at `node`: the innermost
 *  enclosing class declaring it, as TypeScript resolves it, or `undefined` when none does. */
export function privateOwner(
  node: ts.Node,
  written: string,
): { cls: ts.ClassLikeDeclaration; member: ts.ClassElement } | undefined {
  for (const cls of enclosingClasses(node)) {
    const member = privateMemberOf(cls, written);
    if (member !== undefined) return { cls, member };
  }
  return undefined;
}

/** Whether every `return` in `body` returns `this`, and there is at least one: the shape of a
 *  method a chain `a.m().n()` continues from, since the object it hands back is its own. */
export function returnsThis(body: ts.Block | undefined): boolean {
  if (body === undefined) return false;
  let found = 0;
  let other = false;
  const walk = (n: ts.Node): void => {
    if (other) return;
    // A nested function's returns are its own.
    if (ts.isFunctionLike(n) && n !== body.parent) return;
    if (ts.isReturnStatement(n)) {
      let e = n.expression;
      while (e !== undefined && ts.isParenthesizedExpression(e)) e = e.expression;
      if (e !== undefined && e.kind === ts.SyntaxKind.ThisKeyword) found++;
      else other = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return found > 0 && !other;
}

/** Whether a class member is `readonly`. */
export const isReadonlyMember = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
  ) ?? false;

/** The class a `this` inside a static member names: the class that declares the member, found
 *  through the arrow functions between (which keep the `this` around them). Undefined for a
 *  `this` in an instance member, a constructor or a plain function. */
export function staticThisClass(node: ts.Node): ts.ClassDeclaration | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isArrowFunction(at)) continue;
    if (
      ts.isMethodDeclaration(at) ||
      ts.isGetAccessorDeclaration(at) ||
      ts.isSetAccessorDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isClassStaticBlockDeclaration(at)
    ) {
      const owner = at.parent;
      const statik = ts.isClassStaticBlockDeclaration(at) || isStaticMember(at);
      return statik && ts.isClassDeclaration(owner) ? owner : undefined;
    }
    if (ts.isFunctionLike(at) || ts.isClassLike(at)) return undefined;
  }
  return undefined;
}

const WRITTEN_STATICS = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The static fields the file writes, as `Cls.field` keys with the field as written (Rule
 *  8.13): an assignment, a compound assignment, `++` or `--` whose target is `Cls.field`, or an
 *  element or member of it, or the same through `this` inside a static member of `Cls`. Such a
 *  field is a module variable; every other static field stays a module constant. A `readonly`
 *  one is never a variable, and a write to it is refused where it stands. */
export function writtenStaticFields(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = WRITTEN_STATICS.get(sourceFile);
  if (cached !== undefined) return cached;
  const fields = new Map<string, Set<string>>();
  const collect = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      const own = fields.get(n.name.text) ?? new Set<string>();
      for (const m of n.members) {
        if (!ts.isPropertyDeclaration(m) || !isStaticMember(m) || isReadonlyMember(m)) continue;
        const written = writtenMemberName(m.name);
        if (written !== undefined) own.add(written);
      }
      fields.set(n.name.text, own);
    }
    ts.forEachChild(n, collect);
  };
  collect(sourceFile);
  const out = new Set<string>();
  /** The static field `target` is rooted in, as its key. */
  const rootOf = (target: ts.Expression): string | undefined => {
    let at = target;
    for (;;) {
      while (ts.isParenthesizedExpression(at)) at = at.expression;
      if (ts.isPropertyAccessExpression(at)) {
        let obj: ts.Expression = at.expression;
        while (ts.isParenthesizedExpression(obj)) obj = obj.expression;
        const cls = ts.isIdentifier(obj)
          ? obj.text
          : obj.kind === ts.SyntaxKind.ThisKeyword
            ? staticThisClass(obj)?.name?.text
            : undefined;
        if (cls !== undefined && fields.get(cls)?.has(at.name.text)) {
          return `${cls}.${at.name.text}`;
        }
        at = at.expression;
        continue;
      }
      if (ts.isElementAccessExpression(at)) {
        at = at.expression;
        continue;
      }
      return undefined;
    }
  };
  const visit = (n: ts.Node): void => {
    let target: ts.Expression | undefined;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      target = n.left;
    } else if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      target = n.operand;
    }
    if (target !== undefined) {
      const key = rootOf(target);
      if (key !== undefined) out.add(key);
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  WRITTEN_STATICS.set(sourceFile, out);
  return out;
}

const PRIVATE_STATICS = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The static fields the file declares under a private name, as `Cls.name` keys with the name
 *  the field is emitted as: `static #gain` is `Cfg.gain`. `Cfg.gain` written elsewhere names a
 *  public member, an accessor say, and must not reach the constant `Cfg_gain` the private field
 *  became (Rule 8.12). */
export function privateStaticFields(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = PRIVATE_STATICS.get(sourceFile);
  if (cached !== undefined) return cached;
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      for (const m of n.members) {
        if (ts.isPropertyDeclaration(m) && isStaticMember(m) && ts.isPrivateIdentifier(m.name)) {
          out.add(`${n.name.text}.${emittedMemberName(m.name.text)}`);
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  PRIVATE_STATICS.set(sourceFile, out);
  return out;
}

/** The static fields of `cls` whose emitted name an earlier static field of it already took:
 *  `static #n` and `static n` would both be the module constant `Cls_n`. The struct collector
 *  reports the pair (Rule 8.12); the constant and variable collectors pass the second over, so
 *  the one mistake is one diagnostic (Rule 12.4). */
export function shadowedStaticFields(cls: ts.ClassLikeDeclaration): Set<ts.PropertyDeclaration> {
  const seen = new Set<string>();
  const out = new Set<ts.PropertyDeclaration>();
  for (const m of cls.members) {
    if (!ts.isPropertyDeclaration(m) || !isStaticMember(m)) continue;
    const written = writtenMemberName(m.name);
    if (written === undefined) continue;
    const emitted = emittedMemberName(written);
    if (seen.has(emitted)) out.add(m);
    seen.add(emitted);
  }
  return out;
}
