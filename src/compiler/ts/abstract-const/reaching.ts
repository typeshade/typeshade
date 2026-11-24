import ts from 'typescript';
import type { Reading } from './reading.js';

export interface FlowSources {
  storeSites(d: ts.VariableDeclaration): readonly ts.Node[];
  declarationOf(id: ts.Identifier): ts.Node | undefined;
  keySites(d: ts.VariableDeclaration, key: string): ReadonlySet<ts.Node> | undefined;
}

export type JointStores = readonly (readonly (ts.Node | undefined)[])[];

class Unsupported extends Error {}

const isStatementNode = (n: ts.Node): boolean =>
  ts.isBlock(n) ||
  (n.kind >= ts.SyntaxKind.FirstStatement && n.kind <= ts.SyntaxKind.LastStatement);

const isAssignment = (k: ts.SyntaxKind): boolean =>
  k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;

export function statementOf(node: ts.Node): ts.Node | undefined {
  for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
    if (isStatementNode(n) && !ts.isBlock(n)) return n;
  }
  return undefined;
}

function storeOf(s: ts.Node): { site: ts.Node; id: ts.Identifier }[] {
  if (ts.isVariableStatement(s)) {
    return s.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) && d.initializer !== undefined ? [{ site: d, id: d.name }] : [],
    );
  }
  if (!ts.isExpressionStatement(s)) return [];
  let e = s.expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  let target: ts.Expression | undefined;
  if (ts.isBinaryExpression(e) && isAssignment(e.operatorToken.kind)) target = e.left;
  else if (
    (ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) &&
    (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    target = e.operand;
  }
  while (target !== undefined && ts.isParenthesizedExpression(target)) target = target.expression;
  return target !== undefined && ts.isIdentifier(target) ? [{ site: e, id: target }] : [];
}

function functionOf(n: ts.Node): ts.Node | undefined {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if (ts.isFunctionLike(p)) return p;
  }
  return undefined;
}

const cache = new WeakMap<ts.Node, Map<string, JointStores | undefined>>();
const pairSites = new WeakMap<ts.Node, boolean>();

const isTrackedLet = (d: ts.Node): d is ts.VariableDeclaration =>
  ts.isVariableDeclaration(d) &&
  (d.parent.flags & ts.NodeFlags.Let) !== 0 &&
  ts.isVariableStatement(d.parent.parent);

function hasPairSite(fn: ts.Node, src: FlowSources): boolean {
  const known = pairSites.get(fn);
  if (known !== undefined) return known;
  const declarationsIn = (e: ts.Node): ts.Node[] => {
    const out = new Set<ts.Node>();
    const visit = (n: ts.Node): void => {
      const d = ts.isIdentifier(n) ? src.declarationOf(n) : undefined;
      if (d !== undefined && isTrackedLet(d)) out.add(d);
      ts.forEachChild(n, visit);
    };
    visit(e);
    return [...out];
  };
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    const operands =
      ts.isBinaryExpression(n) && !isAssignment(n.operatorToken.kind)
        ? [n.left, n.right]
        : ts.isCallExpression(n)
          ? [...n.arguments]
          : [];
    const sets = operands.map(declarationsIn);
    found = sets.some((a, i) =>
      sets.slice(i + 1).some((b) => a.some((x) => b.some((y) => x !== y))),
    );
    if (!found) ts.forEachChild(n, visit);
  };
  visit(fn);
  pairSites.set(fn, found);
  return found;
}

export function jointStoresAt(
  decls: readonly ts.VariableDeclaration[],
  at: ts.Node,
  src: FlowSources,
): JointStores | undefined {
  const first = decls[0];
  if (first === undefined) return undefined;
  const fn = functionOf(first);
  const target = statementOf(at);
  if (fn === undefined || target === undefined || functionOf(at) !== fn) return undefined;
  if (
    !decls.every(
      (d) =>
        functionOf(d) === fn &&
        (d.parent.flags & ts.NodeFlags.Let) !== 0 &&
        ts.isVariableStatement(d.parent.parent),
    )
  ) {
    return undefined;
  }
  const key = `${decls.map((d) => d.pos).join(',')}@${target.pos}`;
  let byKey = cache.get(fn);
  if (byKey === undefined) cache.set(fn, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key);
  const result = walk(decls, fn, target, src);
  byKey.set(key, result);
  return result;
}

type Entry = readonly (ts.Node | undefined)[];

function walk(
  decls: readonly ts.VariableDeclaration[],
  fn: ts.Node,
  target: ts.Node,
  src: FlowSources,
): JointStores | undefined {
  const body = (fn as ts.FunctionLikeDeclaration).body;
  if (body === undefined || !ts.isBlock(body)) return undefined;
  const visited = new Set<ts.Node>();
  let recorded: Map<string, Entry> | undefined;
  const keyOf = (e: Entry): string => e.map((n) => (n === undefined ? '-' : n.pos)).join(',');
  const union = (...sets: readonly Map<string, Entry>[]): Map<string, Entry> => {
    const out = new Map<string, Entry>();
    for (const s of sets) for (const [k, e] of s) out.set(k, e);
    return out;
  };
  const record = (s: Map<string, Entry>): void => {
    recorded = recorded === undefined ? new Map(s) : union(recorded, s);
  };
  const loop = (
    ins: Map<string, Entry>,
    run: (head: Map<string, Entry>) => Map<string, Entry>,
  ): Map<string, Entry> => {
    let head = ins;
    for (;;) {
      const next = union(head, run(head));
      if (next.size === head.size) return head;
      head = next;
    }
  };
  const exec = (s: ts.Node, ins: Map<string, Entry>): Map<string, Entry> => {
    if (s === target) record(ins);
    if (ts.isBlock(s)) return s.statements.reduce((cur, c) => exec(c, cur), ins);
    if (ts.isVariableStatement(s) || ts.isExpressionStatement(s)) {
      let cur = ins;
      for (const { site, id } of storeOf(s)) {
        const i = decls.findIndex((d) => src.declarationOf(id) === d);
        if (i < 0) continue;
        visited.add(site);
        cur = new Map(
          [...cur.values()].map((e) => {
            const next = [...e];
            next[i] = site;
            return [keyOf(next), next] as const;
          }),
        );
      }
      return cur;
    }
    if (ts.isIfStatement(s)) {
      const out = [exec(s.thenStatement, ins)];
      out.push(s.elseStatement === undefined ? ins : exec(s.elseStatement, ins));
      return union(...out);
    }
    if (ts.isIterationStatement(s, false) && !ts.isDoStatement(s)) {
      const head = loop(ins, (h) => exec(s.statement, h));
      if (s === target) record(head);
      return head;
    }
    if (ts.isDoStatement(s)) {
      const out = loop(ins, (h) => exec(s.statement, h));
      const last = exec(s.statement, out);
      if (s === target) record(out);
      return last;
    }
    if (ts.isReturnStatement(s)) return new Map();
    if (
      ts.isEmptyStatement(s) ||
      ts.isFunctionDeclaration(s) ||
      ts.isClassDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isInterfaceDeclaration(s)
    ) {
      return ins;
    }
    throw new Unsupported();
  };
  try {
    const start: Entry = decls.map(() => undefined);
    exec(body, new Map([[keyOf(start), start]]));
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
  if (recorded === undefined || recorded.size === 0) return undefined;
  for (const d of decls) {
    if (!src.storeSites(d).every((site) => visited.has(site))) return undefined;
  }
  return [...(recorded as Map<string, Entry>).values()];
}

export function coexist(a: Reading, b: Reading, at: ts.Node, src: FlowSources): boolean {
  for (const [da, ka] of a.picks) {
    for (const [db, kb] of b.picks) {
      if (da === db || !ts.isVariableDeclaration(da) || !ts.isVariableDeclaration(db)) continue;
      const [sa, sb] = [src.keySites(da, ka), src.keySites(db, kb)];
      if (sa === undefined || sb === undefined) continue;
      const joint = jointStoresAt([da, db], at, src);
      if (
        joint !== undefined &&
        !joint.some(([x, y]) => x !== undefined && y !== undefined && sa.has(x) && sb.has(y))
      ) {
        return false;
      }
    }
  }
  return true;
}

function feedOf(at: ts.Node, statement: ts.Node): 'copy' | 'self' | undefined {
  let n: ts.Node = at;
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  if (storeOf(statement).length === 0) return undefined;
  if (
    (ts.isVariableDeclaration(p) && p.initializer === n) ||
    (ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      p.right === n)
  ) {
    return 'copy';
  }
  const self =
    (ts.isBinaryExpression(p) && isAssignment(p.operatorToken.kind) && p.left === n) ||
    ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
      (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken));
  return self ? 'self' : undefined;
}

export function reachingReadings(
  xs: Reading[],
  d: ts.VariableDeclaration,
  at: ts.Node,
  src: FlowSources,
): Reading[] {
  const statement = statementOf(at);
  const feed = statement === undefined ? undefined : feedOf(at, statement);
  if (feed === undefined) return xs;
  const fn = functionOf(d);
  if (feed === 'self' && (fn === undefined || !hasPairSite(fn, src))) return xs;
  const joint = jointStoresAt([d], at, src);
  if (joint === undefined) return xs;
  const reaching = new Set(joint.map(([x]) => x));
  const kept = xs.filter((x) => {
    const pick = x.picks.find(([n]) => n === d);
    const sites = pick === undefined ? undefined : src.keySites(d, pick[1]);
    return sites === undefined || [...sites].some((n) => reaching.has(n));
  });
  return kept.length > 0 ? kept : xs;
}

export function pickedAt(
  sites: Map<ts.Node, Map<string, Set<ts.Node>>>,
  d: ts.VariableDeclaration,
  at: ts.Node,
  x: Reading,
  key: string,
): Reading {
  const byKey = sites.get(d) ?? new Map<string, Set<ts.Node>>();
  sites.set(d, byKey);
  byKey.set(key, (byKey.get(key) ?? new Set()).add(at));
  return { ...x, picks: [[d, key]] };
}

export const flowSourcesOf = (
  stores: (d: ts.VariableDeclaration) => readonly { readonly at: ts.Node }[],
  declarationOf: (id: ts.Identifier) => ts.Node | undefined,
  sites: ReadonlyMap<ts.Node, ReadonlyMap<string, ReadonlySet<ts.Node>>>,
): FlowSources => ({
  storeSites: (d) => stores(d).map((s) => s.at),
  declarationOf,
  keySites: (d, key) => sites.get(d)?.get(key),
});
