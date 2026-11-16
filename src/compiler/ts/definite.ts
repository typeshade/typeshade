// ═══ A read before an assignment (Rule 7.6, proposal 0043; `@out`, Rule 8.25, proposal 0040) ═══
//
// TypeScript reports TS2454 ("Variable 'x' is used before being assigned") where a local declared
// with no initializer is read on a path that has not assigned it. The compiler accepted those
// programs, and the targets disagreed on what such a read gives: WGSL and the CPU read zero, and
// GLSL ES 3.00 an undefined value. This pass refuses them with `TS8075`, by TypeScript's rule, so
// the compiler and the editor say one thing (Rule 12.7).
//
// It cannot take TypeScript's own answer, because of `@out`: TypeScript reads `add(a, b, s)` as a
// read of `s` and keeps `s` unassigned after it, where an argument an `@out` parameter takes is
// an assignment. So the flow is walked here, on the source, in TypeScript's terms:
//
//   - a `let` with no initializer starts unassigned; `x = e` assigns `x` after `e`; `x += e`,
//     `x++`, `x.f = e` and `x[i] = e` read `x` and assign nothing, as TypeScript reads them;
//   - `if`, `?:`, `&&`, `||`, `??`, `switch` and the loops join their paths: a variable is
//     assigned after them when every path that reaches there assigned it; a loop's body may not
//     run, so what only the body assigns is unassigned after a `while` or a `for`;
//   - `return`, `break`, `continue` and `throw` end a path;
//   - a read inside a local function or a function written as an argument is not checked, as
//     TypeScript does not check it, and an assignment there does not count outside it;
//   - an argument handed to an `@out` parameter of a function of the file assigns the variable.
//
// The walk reads no types, so one case is stricter than TypeScript: a `switch` with no `default`
// whose cases cover every value of a literal type (`switch (c ? 1 : 2) { case 1: … case 2: … }`)
// joins the path that matches no case, which TypeScript knows cannot run. A shader's `switch`
// is over an `i32` or a `u32`, which no list of cases covers.
//
// The same walk holds an `@out` parameter to its definite writes (Rule 8.25): the body reads it
// only after writing the whole parameter, and writes it on every path that returns. An `@out`
// array is no such parameter: the call fills it with zeros before the body runs, so the body may
// read it and need not write it.
//
// The same walk, with the join of its paths turned the other way, holds a parameter of an array
// with no qualifier to its writes (`TS8080`, Rule 8.23, change 0138, Amendment A15): the
// parameter is a value, so a write to it that any path carries to a `return` that does not return
// the parameter, or to the end of the function, is lost. A variable is assigned after a join when
// every path assigned it; a write is carried after a join when any path carried it.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { fileFunctionCalled, qualifiersOf } from './lower/references.js';
import { writesUndefinedUnion } from './optional.js';
import {
  isOutArrayParameter,
  isValueArrayParameter,
  lostWriteText,
  rootIdentifier,
  writeAt,
  writesAnUnsizedArray,
} from './value-array-write.js';

/** A variable the walk follows: a local declared with no initializer, or an `@out` parameter. */
interface Tracked {
  readonly name: string;
  readonly out: boolean;
  /** A parameter of an array with no qualifier, a value (`TS8080`): never read-checked. */
  readonly value?: true;
  /** A declared `@out` array: a push to it is refused (`TS8080`), no other write is followed. */
  readonly outArray?: true;
  /** A write to a value array parameter. It stays in the state while no path has carried it
   *  here: the state holds it from the write on, and a join keeps it when any path holds it. */
  readonly write?: { readonly param: Tracked; readonly node: ts.Node; readonly push: boolean };
}

/** The variables assigned on every path that reaches a point, or `null` where no path does. */
type State = ReadonlySet<Tracked> | null;

/** The paths a `break` or a `continue` hands to the statement it leaves. */
interface Target {
  readonly label: string | undefined;
  readonly loop: boolean;
  readonly breaks: State[];
  readonly continues: State[];
}

const join = (a: State, b: State): State => {
  if (a === null) return b;
  if (b === null) return a;
  // A variable is assigned after a join when every path assigned it; a write to a value array
  // parameter is carried when any path carried it.
  const out = new Set<Tracked>();
  for (const t of a) if (t.write !== undefined || b.has(t)) out.add(t);
  for (const t of b) if (t.write !== undefined) out.add(t);
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

/** Refuse each read of a local before it is assigned, and each `@out` parameter read before it
 *  is written or left unwritten on a path that returns, in every function `sourceFile` holds. */
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
    const outs: Tracked[] = [];
    const shown =
      fn.name !== undefined && ts.isIdentifier(fn.name) ? fn.name.text : 'this function';
    const writes = new Map<ts.Node, Tracked>();
    // A function expression, an arrow function and an accessor have no declared name to say.
    const named =
      (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) &&
      fn.name !== undefined &&
      ts.isIdentifier(fn.name);
    for (const p of fn.parameters) {
      if (!ts.isIdentifier(p.name)) continue;
      // The call fills an `@out` array with zeros before the body runs, so the body may read it
      // and need not write it (Rule 8.25, change 0138, Amendment A15, decision 2).
      const out =
        ts.isFunctionDeclaration(fn) &&
        qualifiersOf(p).some((q) => q.name === 'out') &&
        !isOutArrayParameter(p, sourceFile)
          ? { name: p.name.text, out: true }
          : null;
      const value: Tracked | null =
        out === null && named && isValueArrayParameter(p, sourceFile)
          ? { name: p.name.text, out: false, value: true }
          : null;
      const outArray: Tracked | null =
        named && isOutArrayParameter(p, sourceFile) && writesAnUnsizedArray(p.type, sourceFile)
          ? { name: p.name.text, out: false, value: true, outArray: true }
          : null;
      scopes[0]!.set(p.name.text, out ?? value ?? outArray);
      if (out !== null) outs.push(out);
    }
    const valueNames = new Set(
      fn.parameters.flatMap((p) =>
        ts.isIdentifier(p.name) &&
        named &&
        (isValueArrayParameter(p, sourceFile) ||
          (isOutArrayParameter(p, sourceFile) && writesAnUnsizedArray(p.type, sourceFile)))
          ? [p.name.text]
          : [],
      ),
    );
    // Each write to such a parameter, found before the walk (shadowing is settled in the walk).
    const collect = (n: ts.Node): void => {
      if (n !== body && ts.isFunctionLike(n)) return;
      const w = writeAt(n);
      if (w !== undefined) {
        const root = rootIdentifier(w.place);
        if (root !== undefined && valueNames.has(root.text))
          writes.set(n, {
            name: root.text,
            out: false,
            write: { param: null as unknown as Tracked, node: w.place, push: w.push },
          });
      }
      if (ts.isCallExpression(n)) {
        for (const [i, arg] of n.arguments.entries()) {
          const root = rootIdentifier(arg);
          if (root !== undefined && valueNames.has(root.text) && qualified(n, i))
            writes.set(arg, {
              name: root.text,
              out: false,
              write: { param: null as unknown as Tracked, node: arg, push: false },
            });
        }
      }
      ts.forEachChild(n, collect);
    };
    const qualified = (call: ts.CallExpression, index: number): boolean => {
      const p = fileFunctionCalled(call, sourceFile)?.parameters[index];
      return p !== undefined && qualifiersOf(p).length > 0;
    };
    if (valueNames.size > 0) collect(body);
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
      if (t === null || s === null || t.value === true) return;
      if (s.has(t)) return;
      report(
        id,
        t.out
          ? `"${t.name}" is an @out parameter, and is read here before ${shown} writes it: it ` +
              `holds no value until the function writes it. Write "${t.name}" first, or declare ` +
              `it @inout (Rule 8.25).`
          : `"${t.name}" is read here before it is assigned on every path. Assign it before ` +
              `this read, or declare it with a value (Rule 7.6).`,
      );
    };

    /** The write `node` makes, if it writes a value array parameter: a push is refused where it
     *  stands, any other write is left in the state until a path carries it to a return. */
    const reach = (node: ts.Node, s: State): State => {
      const ev = writes.get(node);
      if (ev === undefined || s === null) return s;
      const w = ev.write!;
      const param = resolve(ev.name);
      if (param === null || param.value !== true) return s;
      const key = { ...ev, write: { ...w, param } } as Tracked;
      // An `@out` array is written freely; only a push to it is refused.
      if (param.outArray === true && !w.push) return s;
      if (w.push) {
        reportLost(w.node, param, true);
        return s;
      }
      const known = reached.get(node) ?? key;
      reached.set(node, known);
      const out = new Set(s);
      out.add(known);
      return out;
    };

    /** One state item for each write, so a join of two paths that carry it holds it once. */
    const reached = new Map<ts.Node, Tracked>();
    const reportLost = (node: ts.Node, param: Tracked, push: boolean): void => {
      // A write TS8018 already refuses (an element of a fixed-size array parameter) says so once.
      const start = node.getStart(sourceFile);
      if (
        diagnostics.some(
          (d) =>
            d.code === TS_CODES.ASSIGN_TARGET && d.start <= start && start < d.start + d.length,
        )
      )
        return;
      const key = `${String(start)}|lost`;
      if (said.has(key)) return;
      said.add(key);
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          lostWriteText(
            shown,
            param.name,
            param.outArray === true ? 'out-push' : push ? 'push' : 'write',
          ),
          TS_CODES.VALUE_ARRAY_WRITE_LOST,
        ),
      );
    };

    const checkReturn = (at: ts.Node, s: State, returned: Tracked | null = null): void => {
      if (s === null) return;
      for (const ev of s) {
        if (ev.write !== undefined && ev.write.param !== returned)
          reportLost(ev.write.node, ev.write.param, false);
      }
      for (const t of outs) {
        if (s.has(t)) continue;
        report(
          at,
          `"${shown}" returns here without writing "${t.name}", an @out parameter: the caller's ` +
            `variable would hold no value. Write "${t.name}" on every path (Rule 8.25).`,
        );
      }
    };

    /** The variable `e` assigns when it stands where a value is written, if one is followed. */
    const assignedBy = (e: ts.Expression): Tracked | null => {
      let x = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      return ts.isIdentifier(x) ? resolve(x.text) : null;
    };

    const isOutArgument = (call: ts.CallExpression, index: number): boolean => {
      const p = fileFunctionCalled(call, sourceFile)?.parameters[index];
      return p !== undefined && qualifiersOf(p).some((q) => q.name === 'out');
    };

    const expr = (e: ts.Node | undefined, s: State): State =>
      e === undefined ? s : reach(e, exprOf(e, s));

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
        const assigned: Tracked[] = [];
        for (const [i, arg] of (e.arguments ?? []).entries()) {
          const target = ts.isCallExpression(e) && isOutArgument(e, i) ? assignedBy(arg) : null;
          if (target !== null) {
            assigned.push(target);
            after = reach(arg, after);
          } else after = expr(arg, after);
        }
        for (const t of assigned) after = add(after, t);
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
      // Every other expression reads its operands in source order.
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
          // A `let` of an optional type with no initializer starts absent (Rule 7.10), and
          // TypeScript reports no TS2454 for a type that contains `undefined`.
          if (
            d.initializer === undefined &&
            (list.flags & ts.NodeFlags.Const) === 0 &&
            !writesUndefinedUnion(d.type)
          ) {
            define(d.name.text, { name: d.name.text, out: false });
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
        const after = expr(st.expression, s);
        let returned: Tracked | null = null;
        if (st.expression !== undefined) {
          let r: ts.Expression = st.expression;
          while (ts.isParenthesizedExpression(r)) r = r.expression;
          if (ts.isIdentifier(r)) returned = resolve(r.text);
        }
        checkReturn(st, after, returned);
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
          // A second pass: what the body carries comes back to its own returns.
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
      // Every other statement (an empty one, a type, an interface) reads nothing.
      return s;
    };

    const start: State = new Set<Tracked>();
    let end: State;
    if (ts.isBlock(body)) end = block(body.statements, start);
    else end = expr(body, start);
    if (ts.isBlock(body)) {
      checkReturn(body.getLastToken(sourceFile) ?? body, end);
    }
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
