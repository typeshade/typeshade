import ts from 'typescript';
import { writtenMemberName, emittedMemberName } from './class-names/member-names.js';
export {
  writtenMemberName,
  isPrivateName,
  emittedMemberName,
  accessorFnName,
} from './class-names/member-names.js';

export const isStaticMember = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (m) => m.kind === ts.SyntaxKind.StaticKeyword,
  ) ?? false;

export function enclosingClasses(node: ts.Node): ts.ClassLikeDeclaration[] {
  const out: ts.ClassLikeDeclaration[] = [];
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at) || ts.isClassExpression(at)) out.push(at);
  }
  return out;
}

export function privateMemberOf(
  cls: ts.ClassLikeDeclaration,
  written: string,
): ts.ClassElement | undefined {
  return cls.members.find(
    (m) => m.name !== undefined && ts.isPrivateIdentifier(m.name) && m.name.text === written,
  );
}

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

export function returnsThis(body: ts.Block | undefined): boolean {
  if (body === undefined) return false;
  let found = 0;
  let other = false;
  const walk = (n: ts.Node): void => {
    if (other) return;
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

export const holdsFunction = (member: ts.PropertyDeclaration): boolean =>
  member.initializer !== undefined &&
  (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer));

export const isReadonlyMember = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
  ) ?? false;

export function staticThisMember(node: ts.Node): ts.ClassElement | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isArrowFunction(at)) continue;
    if (
      ts.isMethodDeclaration(at) ||
      ts.isGetAccessorDeclaration(at) ||
      ts.isSetAccessorDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isClassStaticBlockDeclaration(at)
    ) {
      return ts.isClassStaticBlockDeclaration(at) || isStaticMember(at) ? at : undefined;
    }
    if (ts.isFunctionLike(at) || ts.isClassLike(at)) return undefined;
  }
  return undefined;
}

export function staticThisClass(node: ts.Node): ts.ClassDeclaration | undefined {
  const owner = staticThisMember(node)?.parent;
  return owner !== undefined && ts.isClassDeclaration(owner) ? owner : undefined;
}

export function callerClassForm(
  method: ts.MethodDeclaration | ts.AccessorDeclaration,
): { readonly thisParam: ts.ParameterDeclaration; readonly typeParam: string } | undefined {
  const first = method.parameters[0];
  if (first === undefined || !ts.isIdentifier(first.name) || first.name.text !== 'this') {
    return undefined;
  }
  const t = first.type;
  if (t === undefined || !ts.isTypeLiteralNode(t)) return undefined;
  const ctor = t.members.find(ts.isConstructSignatureDeclaration);
  const built = ctor?.type;
  if (built === undefined || !ts.isTypeReferenceNode(built) || !ts.isIdentifier(built.typeName)) {
    return undefined;
  }
  const name = built.typeName.text;
  const own = (method as ts.MethodDeclaration).typeParameters?.some((p) => p.name.text === name);
  const ret = method.type;
  const returnsIt =
    ret !== undefined &&
    ts.isTypeReferenceNode(ret) &&
    ts.isIdentifier(ret.typeName) &&
    ret.typeName.text === name;
  return own === true && returnsIt ? { thisParam: first, typeParam: name } : undefined;
}

// Why: TypeScript lets `new this()` build whatever class the call names under the `this`
// parameter of 0020, an `abstract` one aside, which the call alone is refused for (TS2684);
// without it `this` is the class that declares the member, and a `new` of it is refused when
// that class is abstract (TS2511).
export function isCallerClassThis(node: ts.Node): boolean {
  const member = staticThisMember(node);
  return (
    member !== undefined && ts.isMethodDeclaration(member) && callerClassForm(member) !== undefined
  );
}

export function buildsCallerClass(member: ts.Node): boolean {
  if (!ts.isMethodDeclaration(member) || !isStaticMember(member) || member.body === undefined) {
    return false;
  }
  if (callerClassForm(member) === undefined) return false;
  let builds = false;
  const walk = (n: ts.Node): void => {
    if (builds) return;
    if (ts.isNewExpression(n)) {
      let target: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(target)) target = target.expression;
      if (target.kind === ts.SyntaxKind.ThisKeyword) {
        builds = true;
        return;
      }
    }
    if ((ts.isFunctionLike(n) && !ts.isArrowFunction(n)) || ts.isClassLike(n)) return;
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(member.body, walk);
  return builds;
}

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
  const reachesSuper = (cls: ts.ClassDeclaration, member: string): boolean =>
    cls.members.some((m) => isStaticMember(m) && namesSuper(m, member));
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
  const thisClassesOf = (node: ts.Node): string[] => {
    const owner = staticThisClass(node);
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

export type KeywordAccess = 'private' | 'protected';

export function keywordAccessOf(node: ts.Node): KeywordAccess | undefined {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (mods?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (mods?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  return undefined;
}

const CLASSES = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.ClassDeclaration[]>>();

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
