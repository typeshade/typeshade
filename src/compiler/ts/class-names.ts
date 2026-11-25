import ts from 'typescript';
import { writtenMemberName } from './class-names/member-names.js';
import {
  isStaticMember,
  isReadonlyMember,
  type KeywordAccess,
} from './class-names/member-modifiers.js';
import { enclosingClasses } from './class-names/private-owner.js';
import { staticThisClass } from './class-names/static-this.js';
export {
  privateStaticFields,
  shadowedStaticFields,
  staticFieldDeclarations,
} from './class-names/static-fields.js';
export {
  staticThisMember,
  staticThisClass,
  callerClassForm,
  isCallerClassThis,
  buildsCallerClass,
} from './class-names/static-this.js';
export { enclosingClasses, privateMemberOf, privateOwner } from './class-names/private-owner.js';
export { returnsThis, holdsFunction } from './class-names/method-shape.js';
export {
  isStaticMember,
  isReadonlyMember,
  keywordAccessOf,
} from './class-names/member-modifiers.js';
export type { KeywordAccess } from './class-names/member-modifiers.js';
export {
  writtenMemberName,
  isPrivateName,
  emittedMemberName,
  accessorFnName,
} from './class-names/member-names.js';

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
