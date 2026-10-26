// ═══ Narrowing of an optional value (Rule 7.10, change 0088; decision D2) ═══
//
// TypeScript narrows `v: f32 | undefined` to `f32` after `if (v !== undefined)`, after an
// assignment `v = 1.`, and on the paths an early `return` leaves. The compiler follows the same
// forms, so a program TypeScript accepts compiles, and an un-narrowed read is refused where
// TypeScript reports TS18048 (Rule 12.7). The compiler has no checker to ask (Rule 8.19), so the
// flow is walked here, on the source, in TypeScript's terms, as `definite.ts` walks it for Rule
// 7.6. The walk reads no types: it records, for every read of a local or a parameter, what the
// flow says of the name, and the lowering consults the record for the names whose type is an
// optional and ignores it for every other.
//
// What the walk records for a read:
//
//   - `present`: a test `v !== undefined` (and `v != undefined`, in either operand order, and
//     `!` of `v === undefined`) held true on the path here, or `v ??= d` ran;
//   - `absent`: the opposite test held, `v = undefined` ran, or `let v: T | undefined;` declared
//     it with no initializer (the absent value, Rule 7.10);
//   - `{ from }`: an assignment or an initializer `v = e` ran last, and what `e` lowered to says
//     whether `v` is present (a `T`) or unknown (an optional);
//   - nothing: the paths disagree, a loop may have changed it, or nothing narrowed it.
//
// The forms followed are those of the proposal: the conditions of `if`, `?:`, `&&`, `||`,
// `while` and `for`, an early `return`, `break`, `continue` or `discard`, an assignment and
// `??=`. Inside a local function or an arrow function, TypeScript 5.4's rule for a closure: a
// `const` keeps its narrowing, and a `let` or a parameter keeps it only when nothing assigns it
// after the closure. A user type guard, an aliased condition, `typeof v === "undefined"` and
// `switch (true)` are not followed; each is a recorded divergence (Rule 7.2).
//
// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { isUndefinedLiteral, writesUndefinedUnion } from './optional.js';

/** What the flow says of a name at a read: absent, or present when each of its sources is. A
 *  source is a test that held (`null`), or the expression an assignment or an initializer gave
 *  it, whose lowered type says whether it was a `T` (present) or an optional (unknown). Two
 *  paths that assigned different expressions join as both sources, as TypeScript joins the
 *  narrowed types of the two paths. */
export type Narrowing = 'absent' | { readonly sources: readonly (ts.Expression | null)[] };

const PRESENT: Narrowing = { sources: [null] };

/** A variable the walk follows: a local or a parameter of the function being walked, or one a
 *  closure captures. */
interface Tracked {
  readonly name: string;
  readonly isConst: boolean;
}

/** The narrowing of each followed variable on every path that reaches a point, or `null`
 *  where no path does. A variable with no entry is not narrowed. */
type State = ReadonlyMap<Tracked, Narrowing> | null;

/** What a condition says when it holds (`t`) and when it does not (`f`). */
interface Facts {
  readonly t: ReadonlyMap<Tracked, 'present' | 'absent'>;
  readonly f: ReadonlyMap<Tracked, 'present' | 'absent'>;
}

interface Target {
  readonly label: string | undefined;
  readonly loop: boolean;
  readonly breaks: State[];
  readonly continues: State[];
}

const same = (a: Narrowing, b: Narrowing): boolean =>
  a === b ||
  (typeof a === 'object' &&
    typeof b === 'object' &&
    a.sources.length === b.sources.length &&
    a.sources.every((x) => b.sources.includes(x)));

/** The narrowing where two paths meet: absent on both, or the union of their sources. */
const meet = (a: Narrowing, b: Narrowing): Narrowing | undefined => {
  if (a === 'absent' || b === 'absent') return a === b ? 'absent' : undefined;
  const sources = [...a.sources];
  for (const x of b.sources) if (!sources.includes(x)) sources.push(x);
  return { sources };
};

const join = (a: State, b: State): State => {
  if (a === null) return b;
  if (b === null) return a;
  const out = new Map<Tracked, Narrowing>();
  for (const [t, n] of a) {
    const m = b.get(t);
    if (m === undefined) continue;
    const met = meet(n, m);
    if (met !== undefined) out.set(t, met);
  }
  return out;
};

const joinAll = (states: readonly State[]): State =>
  states.reduce<State>((acc, s) => join(acc, s), null);

const equal = (a: State, b: State): boolean => {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  for (const [t, n] of a) {
    const m = b.get(t);
    if (m === undefined || !same(n, m)) return false;
  }
  return true;
};

const set = (s: State, t: Tracked, n: Narrowing | undefined): State => {
  if (s === null) return s;
  const out = new Map(s);
  if (n === undefined) out.delete(t);
  else out.set(t, n);
  return out;
};

const apply = (s: State, facts: ReadonlyMap<Tracked, 'present' | 'absent'>): State => {
  if (s === null || facts.size === 0) return s;
  const out = new Map(s);
  for (const [t, n] of facts) out.set(t, n === 'present' ? PRESENT : 'absent');
  return out;
};

const NO_FACTS: Facts = { t: new Map(), f: new Map() };

const skipParens = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
};

const tables = new WeakMap<ts.SourceFile, ReadonlyMap<ts.Identifier, Narrowing>>();

/** What the flow says of the variable `id` reads, or undefined when nothing narrows it there,
 *  when `id` is no read of a local or a parameter, or when the read is inside a form the walk
 *  does not follow. */
export function narrowingAt(sourceFile: ts.SourceFile, id: ts.Identifier): Narrowing | undefined {
  let table = tables.get(sourceFile);
  if (table === undefined) {
    table = walkFile(sourceFile);
    tables.set(sourceFile, table);
  }
  return table.get(id);
}

/** The names `body` assigns (`x = …`, `x ??= …`, `x++`, every compound form), at a position
 *  at or after `after`. */
function assignedNames(body: ts.Node, after: number): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (
        k >= ts.SyntaxKind.FirstAssignment &&
        k <= ts.SyntaxKind.LastAssignment &&
        n.getStart() >= after
      ) {
        const left = skipParens(n.left);
        if (ts.isIdentifier(left)) out.add(left.text);
      }
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken ||
        n.operator === ts.SyntaxKind.MinusMinusToken) &&
      n.getStart() >= after
    ) {
      const x = skipParens(n.operand);
      if (ts.isIdentifier(x)) out.add(x.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return out;
}

function walkFile(sourceFile: ts.SourceFile): ReadonlyMap<ts.Identifier, Narrowing> {
  const result = new Map<ts.Identifier, Narrowing>();

  /** Walk one function body with `outer` as the narrowing of what it captures. */
  const walkFunction = (
    fn: ts.SignatureDeclaration & { body?: ts.Node },
    outerScopes: readonly Map<string, Tracked | null>[],
    outer: ReadonlyMap<Tracked, Narrowing>,
  ): void => {
    const body = fn.body;
    if (body === undefined) return;
    const scopes: Map<string, Tracked | null>[] = [
      ...outerScopes.map((m) => new Map(m)),
      new Map(),
    ];
    const own = scopes[scopes.length - 1]!;
    for (const p of fn.parameters) {
      if (ts.isIdentifier(p.name)) own.set(p.name.text, { name: p.name.text, isConst: false });
      else declarePattern(p.name, own, false);
    }
    const targets: Target[] = [];

    const resolve = (name: string): Tracked | null => {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const hit = scopes[i]!.get(name);
        if (hit !== undefined) return hit;
      }
      return null;
    };
    const define = (name: string, tracked: Tracked | null): void => {
      scopes[scopes.length - 1]!.set(name, tracked);
    };

    /** A closure met at `node` on `s`: walked with what it may keep of `s` (TypeScript 5.4). */
    const closure = (node: ts.SignatureDeclaration & { body?: ts.Node }, s: State): void => {
      const kept = new Map<Tracked, Narrowing>();
      if (s !== null) {
        const later = assignedNames(body, node.getStart());
        for (const [t, n] of s) {
          if (t.isConst || !later.has(t.name)) kept.set(t, n);
        }
      }
      walkFunction(node, scopes, kept);
    };

    const facts = (e: ts.Expression): Facts => {
      const x = skipParens(e);
      if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken) {
        const inner = facts(x.operand);
        return { t: inner.f, f: inner.t };
      }
      if (ts.isBinaryExpression(x)) {
        const k = x.operatorToken.kind;
        if (k === ts.SyntaxKind.AmpersandAmpersandToken) {
          const a = facts(x.left);
          const b = facts(x.right);
          const t = new Map([...a.t, ...b.t]);
          const f = new Map<Tracked, 'present' | 'absent'>();
          for (const [tr, n] of a.f) if (b.f.get(tr) === n) f.set(tr, n);
          return { t, f };
        }
        if (k === ts.SyntaxKind.BarBarToken) {
          const a = facts(x.left);
          const b = facts(x.right);
          const f = new Map([...a.f, ...b.f]);
          const t = new Map<Tracked, 'present' | 'absent'>();
          for (const [tr, n] of a.t) if (b.t.get(tr) === n) t.set(tr, n);
          return { t, f };
        }
        const equality =
          k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken;
        const inequality =
          k === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          k === ts.SyntaxKind.ExclamationEqualsToken;
        if (equality || inequality) {
          const tested = isUndefinedLiteral(x.right)
            ? skipParens(x.left)
            : isUndefinedLiteral(x.left)
              ? skipParens(x.right)
              : undefined;
          if (tested !== undefined && ts.isIdentifier(tested)) {
            const t = resolve(tested.text);
            if (t !== null) {
              const whenTrue = new Map<Tracked, 'present' | 'absent'>([
                [t, equality ? 'absent' : 'present'],
              ]);
              const whenFalse = new Map<Tracked, 'present' | 'absent'>([
                [t, equality ? 'present' : 'absent'],
              ]);
              return { t: whenTrue, f: whenFalse };
            }
          }
        }
      }
      return NO_FACTS;
    };

    const read = (id: ts.Identifier, s: State): void => {
      const t = resolve(id.text);
      if (t === null || s === null) return;
      const n = s.get(t);
      if (n !== undefined) result.set(id, n);
    };

    const assigned = (e: ts.Expression): Narrowing =>
      isUndefinedLiteral(e) ? 'absent' : { sources: [e] };

    /** `e` evaluated on `s`; the state after it. Conditions narrow their right operands. */
    const expr = (e: ts.Node | undefined, s: State): State => {
      if (e === undefined || s === null) return s;
      if (ts.isTypeNode(e)) return s;
      if (ts.isIdentifier(e)) {
        read(e, s);
        return s;
      }
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        closure(e, s);
        return s;
      }
      if (ts.isClassExpression(e)) return s;
      if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) {
        return expr(e.expression, s);
      }
      if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
        return expr(e.expression, s);
      }
      if (ts.isPropertyAccessExpression(e)) return expr(e.expression, s);
      if (ts.isElementAccessExpression(e)) {
        return expr(e.argumentExpression, expr(e.expression, s));
      }
      if (ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) {
        return expr(e.operand, s);
      }
      if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind;
        if (op === ts.SyntaxKind.EqualsToken) {
          const target = skipParens(e.left);
          if (ts.isIdentifier(target)) {
            const t = resolve(target.text);
            const after = expr(e.right, s);
            return t === null ? after : set(after, t, assigned(e.right));
          }
          return expr(e.right, expr(e.left, s));
        }
        if (op === ts.SyntaxKind.QuestionQuestionEqualsToken) {
          const target = skipParens(e.left);
          const left = expr(e.left, s);
          const after = join(left, expr(e.right, left));
          if (ts.isIdentifier(target)) {
            const t = resolve(target.text);
            return t === null ? after : set(after, t, assigned(e.right));
          }
          return after;
        }
        if (
          op >= ts.SyntaxKind.FirstCompoundAssignment &&
          op <= ts.SyntaxKind.LastCompoundAssignment
        ) {
          const target = skipParens(e.left);
          const after = expr(e.right, expr(e.left, s));
          if (ts.isIdentifier(target)) {
            const t = resolve(target.text);
            return t === null ? after : set(after, t, undefined);
          }
          return after;
        }
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
          const left = expr(e.left, s);
          const f = facts(e.left);
          return join(expr(e.right, apply(left, f.t)), left);
        }
        if (op === ts.SyntaxKind.BarBarToken) {
          const left = expr(e.left, s);
          const f = facts(e.left);
          return join(expr(e.right, apply(left, f.f)), left);
        }
        if (op === ts.SyntaxKind.QuestionQuestionToken) {
          const left = expr(e.left, s);
          return join(left, expr(e.right, left));
        }
        return expr(e.right, expr(e.left, s));
      }
      if (ts.isConditionalExpression(e)) {
        const c = expr(e.condition, s);
        const f = facts(e.condition);
        return join(expr(e.whenTrue, apply(c, f.t)), expr(e.whenFalse, apply(c, f.f)));
      }
      if (ts.isCallExpression(e) || ts.isNewExpression(e)) {
        let after: State = expr(e.expression, s);
        for (const arg of e.arguments ?? []) after = expr(arg, after);
        return after;
      }
      if (ts.isObjectLiteralExpression(e)) {
        let after: State = s;
        for (const p of e.properties) {
          if (ts.isPropertyAssignment(p)) after = expr(p.initializer, after);
          else if (ts.isShorthandPropertyAssignment(p)) read(p.name, after);
          else if (ts.isSpreadAssignment(p)) after = expr(p.expression, after);
        }
        return after;
      }
      let after: State = s;
      ts.forEachChild(e, (child) => {
        if (ts.isToken(child) && !ts.isIdentifier(child)) return;
        after = expr(child, after);
      });
      return after;
    };

    const declareList = (list: ts.VariableDeclarationList, s: State): State => {
      let after: State = s;
      const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
      for (const d of list.declarations) {
        if (d.initializer !== undefined) after = expr(d.initializer, after);
        if (ts.isIdentifier(d.name)) {
          const t: Tracked = { name: d.name.text, isConst };
          define(d.name.text, t);
          if (d.initializer !== undefined) after = set(after, t, assigned(d.initializer));
          else if (writesUndefinedUnion(d.type)) after = set(after, t, 'absent');
        } else declarePattern(d.name, scopes[scopes.length - 1]!, isConst);
      }
      return after;
    };

    const hoist = (statements: readonly ts.Statement[]): void => {
      for (const st of statements) {
        if (ts.isFunctionDeclaration(st) && st.name !== undefined) define(st.name.text, null);
        if (ts.isClassDeclaration(st) && st.name !== undefined) define(st.name.text, null);
      }
    };

    const block = (statements: readonly ts.Statement[], s: State): State => {
      scopes.push(new Map());
      hoist(statements);
      let after: State = s;
      for (const st of statements) after = stmt(st, after);
      scopes.pop();
      return after;
    };

    const target = (label: string | undefined, loop: boolean): Target => ({
      label,
      loop,
      breaks: [],
      continues: [],
    });

    const findTarget = (label: string | undefined, isContinue: boolean): Target | undefined => {
      for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i]!;
        if (label !== undefined ? t.label === label : isContinue ? t.loop : true) {
          if (isContinue && !t.loop) continue;
          return t;
        }
      }
      return undefined;
    };

    /** A loop: its head is where the entry and the back edge meet, run to a fixed point. The
     *  lattice has one step below a narrowing, so two rounds settle it; a third is a guard. */
    const loop = (
      label: string | undefined,
      entry: State,
      run: (head: State, t: Target) => { back: State; exit: State },
    ): State => {
      let head: State = entry;
      let exit: State = null;
      for (let round = 0; round < 3; round++) {
        const t = target(label, true);
        targets.push(t);
        const r = run(head, t);
        targets.pop();
        exit = joinAll([r.exit, ...t.breaks]);
        const next = joinAll([entry, r.back, ...t.continues]);
        if (equal(next, head)) break;
        head = next;
      }
      return exit;
    };

    const stmt = (st: ts.Statement, s: State, label?: string): State => {
      if (s === null) return null;
      if (ts.isVariableStatement(st)) return declareList(st.declarationList, s);
      // A bare `discard;` ends the invocation (Rule 7.7), but TypeScript's flow does not know
      // it: a read after `if (v === undefined) { discard; }` is TS18048 to the editor. The walk
      // follows TypeScript (Rule 12.7), so both halves say one thing; the author writes the
      // read inside an `else`, or gives the absent case a value.
      if (ts.isExpressionStatement(st)) return expr(st.expression, s);
      if (ts.isBlock(st)) return block(st.statements, s);
      if (ts.isIfStatement(st)) {
        const c = expr(st.expression, s);
        const f = facts(st.expression);
        const then = stmt(st.thenStatement, apply(c, f.t));
        const other =
          st.elseStatement !== undefined ? stmt(st.elseStatement, apply(c, f.f)) : apply(c, f.f);
        return join(then, other);
      }
      if (ts.isReturnStatement(st)) {
        expr(st.expression, s);
        return null;
      }
      if (ts.isThrowStatement(st)) {
        expr(st.expression, s);
        return null;
      }
      if (ts.isBreakStatement(st) || ts.isContinueStatement(st)) {
        const isContinue = ts.isContinueStatement(st);
        const t = findTarget(st.label?.text, isContinue);
        if (t !== undefined) (isContinue ? t.continues : t.breaks).push(s);
        return null;
      }
      if (ts.isLabeledStatement(st)) {
        const inner = st.statement;
        if (ts.isIterationStatement(inner, false)) return stmt(inner, s, st.label.text);
        const t = target(st.label.text, false);
        targets.push(t);
        const after = stmt(inner, s);
        targets.pop();
        return joinAll([after, ...t.breaks]);
      }
      if (ts.isWhileStatement(st)) {
        return loop(label, s, (head) => {
          const c = expr(st.expression, head);
          const f = facts(st.expression);
          const back = stmt(st.statement, apply(c, f.t));
          return { back, exit: apply(c, f.f) };
        });
      }
      if (ts.isDoStatement(st)) {
        return loop(label, s, (head, t) => {
          const end = stmt(st.statement, head);
          const c = expr(st.expression, joinAll([end, ...t.continues]));
          const f = facts(st.expression);
          return { back: apply(c, f.t), exit: apply(c, f.f) };
        });
      }
      if (ts.isForStatement(st)) {
        scopes.push(new Map());
        let init: State = s;
        if (st.initializer !== undefined) {
          init = ts.isVariableDeclarationList(st.initializer)
            ? declareList(st.initializer, s)
            : expr(st.initializer, s);
        }
        const exit = loop(label, init, (head, t) => {
          const c = st.condition !== undefined ? expr(st.condition, head) : head;
          const f = st.condition !== undefined ? facts(st.condition) : NO_FACTS;
          const end = stmt(st.statement, apply(c, f.t));
          const back = expr(st.incrementor, joinAll([end, ...t.continues]));
          return { back, exit: st.condition !== undefined ? apply(c, f.f) : null };
        });
        scopes.pop();
        return exit;
      }
      if (ts.isForOfStatement(st) || ts.isForInStatement(st)) {
        const head = expr(st.expression, s);
        scopes.push(new Map());
        if (ts.isVariableDeclarationList(st.initializer)) {
          for (const d of st.initializer.declarations) {
            if (ts.isIdentifier(d.name)) define(d.name.text, null);
            else declarePattern(d.name, scopes[scopes.length - 1]!, true);
          }
        }
        const exit = loop(label, head, (at) => ({ back: stmt(st.statement, at), exit: at }));
        scopes.pop();
        return exit;
      }
      if (ts.isSwitchStatement(st)) {
        const head = expr(st.expression, s);
        const t = target(label, false);
        targets.push(t);
        scopes.push(new Map());
        let fall: State = null;
        let hasDefault = false;
        for (const clause of st.caseBlock.clauses) {
          if (ts.isDefaultClause(clause)) hasDefault = true;
          else expr(clause.expression, head);
          let at = join(head, fall);
          hoist(clause.statements);
          for (const inner of clause.statements) at = stmt(inner, at);
          fall = at;
        }
        scopes.pop();
        targets.pop();
        return joinAll([fall, ...t.breaks, hasDefault ? null : head]);
      }
      if (ts.isFunctionDeclaration(st)) {
        closure(st, s);
        return s;
      }
      if (ts.isClassDeclaration(st)) {
        for (const m of st.members) {
          if (
            (ts.isMethodDeclaration(m) ||
              ts.isConstructorDeclaration(m) ||
              ts.isGetAccessorDeclaration(m) ||
              ts.isSetAccessorDeclaration(m)) &&
            m.body !== undefined
          ) {
            closure(m, s);
          }
        }
        return s;
      }
      return s;
    };

    const start: State = new Map(outer);
    if (ts.isBlock(body)) block(body.statements, start);
    else expr(body, start);
  };

  const visit = (node: ts.Node): void => {
    // A top-level function, method, constructor or accessor starts a walk of its own; a closure
    // inside a body is walked by the body's walk, with what it captures.
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)) &&
      node.body !== undefined
    ) {
      walkFunction(node, [], new Map());
      return;
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body !== undefined) {
      walkFunction(node, [], new Map());
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/** Declare each name of a binding pattern as a followed variable nothing narrows. */
function declarePattern(
  pattern: ts.BindingName,
  into: Map<string, Tracked | null>,
  isConst: boolean,
): void {
  const each = (n: ts.Node): void => {
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
      into.set(n.name.text, { name: n.name.text, isConst });
    }
    ts.forEachChild(n, each);
  };
  each(pattern);
}
