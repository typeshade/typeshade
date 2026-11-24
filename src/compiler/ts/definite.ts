// ═══ A read before an assignment (Rule 7.6, proposal 0043) ═══
//
// TypeScript reports TS2454 ("Variable 'x' is used before being assigned") where a local declared
// with no initializer is read on a path that has not assigned it. The compiler accepted those
// programs, and the targets disagreed on what such a read gives: WGSL and the CPU read zero, and
// GLSL ES 3.00 an undefined value. This pass refuses them with `TS8075`, by TypeScript's rule, so
// the compiler and the editor say one thing (Rule 12.7). The flow is walked here, on the source,
// in TypeScript's terms:
//
//   - a `let` with no initializer starts unassigned; `x = e` assigns `x` after `e`; `x += e`,
//     `x++`, `x.f = e` and `x[i] = e` read `x` and assign nothing, as TypeScript reads them;
//   - `if`, `?:`, `&&`, `||`, `??`, `switch` and the loops join their paths: a variable is
//     assigned after them when every path that reaches there assigned it; a loop's body may not
//     run, so what only the body assigns is unassigned after a `while` or a `for`;
//   - `return`, `break`, `continue` and `throw` end a path;
//   - a read inside a local function or a function written as an argument is not checked, as
//     TypeScript does not check it, and an assignment there does not count outside it.
//
// The walk reads no types, so one case is stricter than TypeScript: a `switch` with no `default`
// whose cases cover every value of a literal type (`switch (c ? 1 : 2) { case 1: … case 2: … }`)
// joins the path that matches no case, which TypeScript knows cannot run. A shader's `switch`
// is over an `i32` or a `u32`, which no list of cases covers.
//
// Change 0142 removed `@out` (a call no longer assigns the caller's local through an argument,
// and no parameter is held to its definite writes) and `TS8080` with the value reading of an
// array parameter.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { writesUndefinedUnion } from './optional.js';

interface Tracked {
  readonly name: string;
}

type State = ReadonlySet<Tracked> | null;

interface Target {
  readonly label: string | undefined;
  readonly loop: boolean;
  readonly breaks: State[];
  readonly continues: State[];
}

const join = (a: State, b: State): State => {
  if (a === null) return b;
  if (b === null) return a;
  const out = new Set<Tracked>();
  for (const t of a) if (b.has(t)) out.add(t);
  return out;
};

const joinAll = (states: readonly State[]): State =>
  states.reduce<State>((acc, s) => join(acc, s), null);

const add = (s: State, t: Tracked): State => {
  if (s === null) return s;
  const out = new Set(s);
  out.add(t);
  return out;
};

export function checkDefiniteAssignment(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const said = new Set<string>();
  const report = (node: ts.Node, message: string): void => {
    const key = `${String(node.getStart(sourceFile))}|${message}`;
    if (said.has(key)) return;
    said.add(key);
    diagnostics.push(makeDiagnostic(sourceFile, node, message, TS_CODES.UNASSIGNED_READ));
  };

  const walkFunction = (fn: ts.SignatureDeclaration & { body?: ts.Node }): void => {
    const body = fn.body;
    if (body === undefined) return;
    const scopes: Map<string, Tracked | null>[] = [new Map()];
    for (const p of fn.parameters) {
      if (ts.isIdentifier(p.name)) scopes[0]!.set(p.name.text, null);
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

    const read = (id: ts.Identifier, s: State): void => {
      const t = resolve(id.text);
      if (t === null || s === null) return;
      if (s.has(t)) return;
      report(
        id,
        `"${t.name}" is read here before it is assigned on every path. Assign it before ` +
          `this read, or declare it with a value (Rule 7.6).`,
      );
    };

    const assignedBy = (e: ts.Expression): Tracked | null => {
      let x = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      return ts.isIdentifier(x) ? resolve(x.text) : null;
    };

    const expr = (e: ts.Node | undefined, s: State): State => (e === undefined ? s : exprOf(e, s));

    const exprOf = (e: ts.Node | undefined, s: State): State => {
      if (e === undefined || s === null) return s;
      if (ts.isTypeNode(e)) return s;
      if (ts.isIdentifier(e)) {
        read(e, s);
        return s;
      }
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e)) {
        return s;
      }
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
      if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind;
        if (op === ts.SyntaxKind.EqualsToken) {
          const target = assignedBy(e.left);
          if (target !== null) return add(expr(e.right, s), target);
          if (ts.isArrayLiteralExpression(e.left) || ts.isObjectLiteralExpression(e.left)) {
            let after: State = expr(e.right, s);
            const each = (n: ts.Node): void => {
              if (ts.isIdentifier(n)) {
                const t = resolve(n.text);
                if (t !== null) after = add(after, t);
                return;
              }
              ts.forEachChild(n, each);
            };
            each(e.left);
            return after;
          }
          return expr(e.right, expr(e.left, s));
        }
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          const left = expr(e.left, s);
          return join(left, expr(e.right, left));
        }
        return expr(e.right, expr(e.left, s));
      }
      if (ts.isConditionalExpression(e)) {
        const c = expr(e.condition, s);
        return join(expr(e.whenTrue, c), expr(e.whenFalse, c));
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
          else if (ts.isShorthandPropertyAssignment(p)) {
            read(p.name, after);
          } else if (ts.isSpreadAssignment(p)) after = expr(p.expression, after);
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
      for (const d of list.declarations) {
        if (d.initializer !== undefined) after = expr(d.initializer, after);
        if (ts.isIdentifier(d.name)) {
          if (
            d.initializer === undefined &&
            (list.flags & ts.NodeFlags.Const) === 0 &&
            !writesUndefinedUnion(d.type)
          ) {
            define(d.name.text, { name: d.name.text });
          } else define(d.name.text, null);
        } else {
          const each = (n: ts.Node): void => {
            if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) define(n.name.text, null);
            ts.forEachChild(n, each);
          };
          each(d.name);
        }
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

    const loop = (
      label: string | undefined,
      run: (t: Target) => { exit: State },
    ): { exit: State; t: Target } => {
      const t = target(label, true);
      targets.push(t);
      const { exit } = run(t);
      targets.pop();
      return { exit: joinAll([exit, ...t.breaks]), t };
    };

    const stmt = (st: ts.Statement, s: State, label?: string): State => {
      if (s === null) return null;
      if (ts.isVariableStatement(st)) return declareList(st.declarationList, s);
      if (ts.isExpressionStatement(st)) return expr(st.expression, s);
      if (ts.isBlock(st)) return block(st.statements, s);
      if (ts.isIfStatement(st)) {
        const c = expr(st.expression, s);
        const then = stmt(st.thenStatement, c);
        const other = st.elseStatement !== undefined ? stmt(st.elseStatement, c) : c;
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
        const head = expr(st.expression, s);
        return loop(label, (t) => {
          const end = stmt(st.statement, head);
          stmt(st.statement, join(head, end));
          return { exit: joinAll([head, end, ...t.continues]) };
        }).exit;
      }
      if (ts.isDoStatement(st)) {
        let cond: State = null;
        const { exit } = loop(label, (t) => {
          const end = stmt(st.statement, s);
          cond = expr(st.expression, joinAll([end, ...t.continues]));
          stmt(st.statement, join(s, cond));
          return { exit: cond };
        });
        return exit;
      }
      if (ts.isForStatement(st)) {
        scopes.push(new Map());
        let init: State = s;
        if (st.initializer !== undefined) {
          init = ts.isVariableDeclarationList(st.initializer)
            ? declareList(st.initializer, s)
            : expr(st.initializer, s);
        }
        const head = st.condition !== undefined ? expr(st.condition, init) : init;
        const { exit } = loop(label, (t) => {
          const end = stmt(st.statement, head);
          const next = expr(st.incrementor, joinAll([end, ...t.continues]));
          stmt(st.statement, join(head, next));
          return { exit: st.condition !== undefined ? joinAll([head, next]) : null };
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
          }
        }
        const { exit } = loop(label, (t) => {
          const end = stmt(st.statement, head);
          stmt(st.statement, join(head, end));
          return { exit: joinAll([head, end, ...t.continues]) };
        });
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
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) return s;
      return s;
    };

    const start: State = new Set<Tracked>();
    if (ts.isBlock(body)) block(body.statements, start);
    else expr(body, start);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.body !== undefined
    ) {
      walkFunction(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
