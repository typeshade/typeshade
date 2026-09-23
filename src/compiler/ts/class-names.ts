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

/** Whether a field's initializer is a function: an arrow function or a function expression,
 *  which is a method under the field's name (Rule 8.16) and never a value. */
export const holdsFunction = (member: ts.PropertyDeclaration): boolean =>
  member.initializer !== undefined &&
  (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer));

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

/** Whether `node` holds a `super.member` reference, a call or an access. */
function namesSuper(node: ts.Node, member: string): boolean {
  if (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.SuperKeyword &&
    node.name.text === member
  ) {
    return true;
  }
  return ts.forEachChild(node, (n) => namesSuper(n, member)) ?? false;
}

const WRITTEN_STATICS = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The static fields the file writes, as `Cls.field` keys with the field as written (Rule
 *  8.13): an assignment, a compound assignment, `++` or `--` whose target is `Cls.field`, or an
 *  element or member of it, or the same through `this` inside a static member of `Cls`. Such a
 *  field is a module variable; every other static field stays a module constant. A `readonly`
 *  one is never a variable, and a write to it is refused where it stands.
 *
 *  A static member a class inherits runs with `this` as that class, so `this.hits += 1.` in
 *  `Base.record` writes `Derived.hits` too when `Derived` declares a `hits` of its own and
 *  inherits `record`. */
export function writtenStaticFields(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = WRITTEN_STATICS.get(sourceFile);
  if (cached !== undefined) return cached;
  const fields = new Map<string, Set<string>>();
  const classes: ts.ClassDeclaration[] = [];
  const collect = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      classes.push(n);
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
  const byName = classesByName(sourceFile);
  /** The class `cls` names in `extends`, when the file declares exactly one of that name. */
  const baseOf = (cls: ts.ClassDeclaration): ts.ClassDeclaration | undefined => {
    const e = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]
      ?.expression;
    const found = e !== undefined && ts.isIdentifier(e) ? byName.get(e.text) : undefined;
    return found?.length === 1 ? found[0] : undefined;
  };
  const declaresStatic = (cls: ts.ClassDeclaration, member: string): boolean =>
    cls.members.some(
      (m) =>
        (ts.isMethodDeclaration(m) || ts.isAccessor(m)) &&
        isStaticMember(m) &&
        writtenMemberName(m.name) === member,
    );
  /** Whether a static member of `cls` names `member` through `super`: `super.record()` in an
   *  override of `record`, or in any other static of the class. */
  const reachesSuper = (cls: ts.ClassDeclaration, member: string): boolean =>
    cls.members.some((m) => isStaticMember(m) && namesSuper(m, member));
  /** The classes a static member `member` of `owner` runs for: `owner`, and each class that
   *  extends it and reaches it, by inheriting it or through `super` from a class on the way
   *  down that declares its own. */
  const runsFor = (owner: ts.ClassDeclaration, member: string | undefined): string[] => {
    const out = [owner.name!.text];
    if (member === undefined) return out;
    for (const cls of classes) {
      for (let at: ts.ClassDeclaration | undefined = cls, depth = 0; at !== undefined; depth++) {
        if (at === owner) {
          if (cls !== owner) out.push(cls.name!.text);
          break;
        }
        if (depth > classes.length) break;
        if (declaresStatic(at, member) && !reachesSuper(at, member)) break;
        at = baseOf(at);
      }
    }
    return out;
  };
  /** The class above `name` that declares the static field `field`, the nearest first. */
  const declaringAncestor = (name: string, field: string): string | undefined => {
    const found = byName.get(name);
    let at = found?.length === 1 ? baseOf(found[0]!) : undefined;
    for (let depth = 0; at !== undefined && depth <= classes.length; depth++) {
      if (fields.get(at.name!.text)?.has(field)) return at.name!.text;
      at = baseOf(at);
    }
    return undefined;
  };
  const out = new Set<string>();
  /** The static fields `target` is rooted in, as their keys. */
  const rootsOf = (target: ts.Expression): string[] => {
    let at = target;
    for (;;) {
      while (ts.isParenthesizedExpression(at)) at = at.expression;
      if (ts.isPropertyAccessExpression(at)) {
        let obj: ts.Expression = at.expression;
        while (ts.isParenthesizedExpression(obj)) obj = obj.expression;
        const field = at.name.text;
        const owners = ts.isIdentifier(obj)
          ? [obj.text]
          : obj.kind === ts.SyntaxKind.ThisKeyword
            ? thisClassesOf(obj)
            : [];
        const keys = owners.filter((c) => fields.get(c)?.has(field)).map((c) => `${c}.${field}`);
        if (keys.length > 0) return keys;
        // A write into a static a base declares, `Derived.origin.y = 5.`, lands on the base's:
        // the object is the one both classes read. A write to the static itself is refused
        // where it is lowered (Rule 8.13).
        if (at !== target) {
          const above = owners
            .map((c) => declaringAncestor(c, field))
            .filter((c): c is string => c !== undefined);
          if (above.length > 0) return above.map((c) => `${c}.${field}`);
        }
        at = at.expression;
        continue;
      }
      if (ts.isElementAccessExpression(at)) {
        at = at.expression;
        continue;
      }
      return [];
    }
  };
  /** The classes `this` names in the static member around `node`. */
  const thisClassesOf = (node: ts.Node): string[] => {
    const owner = staticThisClass(node);
    // A class with no name (`export default class { … }`) has no static a name can reach.
    if (owner?.name === undefined) return [];
    let member: ts.Node = node;
    while (member.parent !== owner) member = member.parent;
    return runsFor(
      owner,
      ts.isMethodDeclaration(member) || ts.isAccessor(member)
        ? writtenMemberName(member.name)
        : undefined,
    );
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
    if (target !== undefined) for (const key of rootsOf(target)) out.add(key);
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

/** The access a member declares with a keyword: `private`, `protected`, or undefined for a
 *  public one. A `#` name is a different mechanism (Rule 8.12). */
export type KeywordAccess = 'private' | 'protected';

export function keywordAccessOf(node: ts.Node): KeywordAccess | undefined {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (mods?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (mods?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  return undefined;
}

const CLASSES = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.ClassDeclaration[]>>();

/** Every class declaration of the file under its name, including those in namespaces. */
function classesByName(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.ClassDeclaration[]> {
  const cached = CLASSES.get(sourceFile);
  if (cached !== undefined) return cached;
  const out = new Map<string, ts.ClassDeclaration[]>();
  const walk = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      const list = out.get(n.name.text) ?? [];
      list.push(n);
      out.set(n.name.text, list);
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  CLASSES.set(sourceFile, out);
  return out;
}

/** The declaration of the member `member` that code in the body of `cls` sees: `cls`'s own, or
 *  the nearest in the chain above it that the file declares with `extends X`. A parameter
 *  property is found as the parameter that declares it. Undefined when the chain runs out, or
 *  runs into a base the file does not resolve. This is what TypeScript checks `this.m()` against
 *  in `cls`'s body, whichever class that body is later lowered for (Rule 8.15). */
export function memberDeclarationInChain(
  cls: ts.ClassLikeDeclaration,
  member: string,
  isStatic: boolean,
): ts.ClassElement | ts.ParameterDeclaration | undefined {
  const seen = new Set<ts.ClassLikeDeclaration>();
  let at: ts.ClassLikeDeclaration | undefined = cls;
  while (at !== undefined && !seen.has(at)) {
    seen.add(at);
    for (const m of at.members) {
      if (ts.isConstructorDeclaration(m)) {
        if (isStatic) continue;
        for (const p of m.parameters) {
          if (ts.isIdentifier(p.name) && p.name.text === member && ts.getModifiers(p)?.length) {
            return p;
          }
        }
        continue;
      }
      if (m.name === undefined || isStaticMember(m) !== isStatic) continue;
      if (writtenMemberName(m.name) === member) return m;
    }
    at = baseClassOf(at);
  }
  return undefined;
}

/** The class `cls` extends, when its `extends` names one class the file declares. */
export function baseClassOf(cls: ts.ClassLikeDeclaration): ts.ClassDeclaration | undefined {
  const e: ts.Expression | undefined = cls.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
  )?.types[0]?.expression;
  const found: readonly ts.ClassDeclaration[] | undefined =
    e !== undefined && ts.isIdentifier(e)
      ? classesByName(cls.getSourceFile()).get(e.text)
      : undefined;
  return found?.length === 1 ? found[0] : undefined;
}

/** Whether `cls` extends `owner`, at any depth, as far as the file shows it: an `extends X`
 *  naming a class of the file, and a mixin application `extends M(X)`, whose argument is the
 *  base. `'unknown'` when a heritage names something the file does not resolve (a mixin's own
 *  parameter), where a check has to give the author the benefit of the doubt. */
export function classExtends(
  cls: ts.ClassLikeDeclaration,
  owner: ts.ClassLikeDeclaration,
): boolean | 'unknown' {
  const byName = classesByName(cls.getSourceFile());
  const seen = new Set<ts.ClassLikeDeclaration>();
  const viaExpr = (e: ts.Expression): boolean | 'unknown' => {
    if (ts.isIdentifier(e)) {
      const found = byName.get(e.text);
      if (found === undefined) return 'unknown';
      let unknown = false;
      for (const c of found) {
        const r = via(c);
        if (r === true) return true;
        if (r === 'unknown') unknown = true;
      }
      return unknown ? 'unknown' : false;
    }
    if (ts.isCallExpression(e)) {
      let unknown = false;
      for (const a of e.arguments) {
        const r = viaExpr(a);
        if (r === true) return true;
        if (r === 'unknown') unknown = true;
      }
      return unknown ? 'unknown' : false;
    }
    return 'unknown';
  };
  const via = (c: ts.ClassLikeDeclaration): boolean | 'unknown' => {
    if (c === owner) return true;
    if (seen.has(c)) return false;
    seen.add(c);
    let unknown = false;
    for (const h of c.heritageClauses ?? []) {
      if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const t of h.types) {
        const r = viaExpr(t.expression);
        if (r === true) return true;
        if (r === 'unknown') unknown = true;
      }
    }
    return unknown ? 'unknown' : false;
  };
  let unknown = false;
  for (const h of cls.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of h.types) {
      const r = viaExpr(t.expression);
      if (r === true) return true;
      if (r === 'unknown') unknown = true;
    }
  }
  return unknown ? 'unknown' : false;
}

/** The class through which the code at `at` may name a member declared `access` in `owner`:
 *  `owner` itself when the code stands in its body, and for a protected member a class that
 *  extends it (TypeScript's TS2341 and TS2445). `'granted'` when a heritage the file does not
 *  resolve might be the way; undefined when nothing grants it. */
export function keywordAccessVia(
  access: KeywordAccess,
  owner: ts.ClassLikeDeclaration,
  at: ts.Node,
): ts.ClassLikeDeclaration | 'granted' | undefined {
  const around = enclosingClasses(at);
  if (around.includes(owner)) return owner;
  if (access === 'private') return undefined;
  let granted = false;
  for (const cls of around) {
    const r = classExtends(cls, owner);
    if (r === true) return cls;
    if (r === 'unknown') granted = true;
  }
  return granted ? 'granted' : undefined;
}

const STATIC_DECLS = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.PropertyDeclaration>>();

/** The declaration of each static field, as `Cls.name` with the name as written, so a read of
 *  one can be checked against its `private` or `protected`. */
export function staticFieldDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.PropertyDeclaration> {
  const cached = STATIC_DECLS.get(sourceFile);
  if (cached !== undefined) return cached;
  const out = new Map<string, ts.PropertyDeclaration>();
  const walk = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name !== undefined) {
      for (const m of n.members) {
        if (!ts.isPropertyDeclaration(m) || !isStaticMember(m)) continue;
        const written = writtenMemberName(m.name);
        if (written !== undefined) out.set(`${n.name.text}.${written}`, m);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  STATIC_DECLS.set(sourceFile, out);
  return out;
}
