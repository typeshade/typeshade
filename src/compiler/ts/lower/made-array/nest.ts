// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr, Stmt } from '../../../../core/ir/nodes.js';
import { boolT, u32T, type ShaderType } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../../core/ir/visit.js';
import { rangeOf, type ForStmt } from '../../../../core/passes/kernel-lower-ir.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { diagnosticAtSpan, makeDiagnostic } from '../../diagnostic.js';
import type { GrownLoop, GrownTerm, MadeLowering } from './registry.js';
import { hostCondition, hostReadable, notKnown, type Readable } from './readable.js';

export function loopText(loop: ts.IterationStatement, sourceFile: ts.SourceFile): string {
  if (ts.isDoStatement(loop)) return `do … while (${loop.expression.getText(sourceFile)})`;
  return sourceFile.text
    .slice(loop.getStart(sourceFile), loop.statement.getStart(sourceFile))
    .trim();
}

function isPush(x: Expr, param: string): boolean {
  return (
    x.op === 'call' && x.fn === 'push' && x.args[0]?.op === 'param' && x.args[0].name === param
  );
}

function pushesIn(st: Stmt, param: string): number {
  let count = 0;
  const visit = (s: Stmt): void =>
    eachStmtExpr(
      s,
      (e) =>
        eachExpr(e, (x) => {
          if (isPush(x, param)) count++;
        }),
      visit,
    );
  visit(st);
  return count;
}

function counted(loop: ForStmt): GrownLoop | undefined {
  const range = rangeOf(loop);
  if (range === undefined || loop.counted?.op !== 'add') return undefined;
  const t: ShaderType = range.type;
  if (t.kind !== 'scalar' || (t.scalar !== 'u32' && t.scalar !== 'i32')) return undefined;
  const up = range.cop === '<' || range.cop === '<=';
  const [low, high] = up ? [range.start, range.bound] : [range.bound, range.start];
  return {
    low,
    high,
    inclusive: range.cop === '<=' || range.cop === '>=',
    step: Math.abs(loop.counted.step),
  };
}

function nodeAt<T extends ts.Node>(
  root: ts.Node,
  start: number | undefined,
  sourceFile: ts.SourceFile,
  is: (n: ts.Node) => n is T,
): T | undefined {
  if (start === undefined) return undefined;
  const find = (n: ts.Node): T | undefined =>
    is(n) && n.getStart(sourceFile) === start ? n : ts.forEachChild(n, find);
  return find(root);
}

const isLoop = (n: ts.Node): n is ts.IterationStatement => ts.isIterationStatement(n, false);

const falseLit: Expr = { op: 'lit', type: boolT, value: false };

const not = (e: Expr): Expr => ({ op: 'compare', type: boolT, cop: '==', a: e, b: falseLit });

const allOf = (...parts: readonly (Expr | undefined)[]): Expr | undefined =>
  parts.reduce<Expr | undefined>(
    (a, b) =>
      b === undefined ? a : a === undefined ? b : { op: 'logical', type: boolT, lop: '&&', a, b },
    undefined,
  );

export const once = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });

interface Place {
  readonly loops: readonly GrownLoop[];
  readonly when?: Expr;
  pushes: number;
}

export interface NestEnv {
  readonly name: string;
  readonly made: MadeLowering;
  readonly r: Readable;
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: TsCompilerDiagnostic[];
  readonly writesIn: (loop: ForStmt) => number;
}

export function nestTerms(env: NestEnv, body: readonly Stmt[]): readonly GrownTerm[] | undefined {
  const { name, made, r, sourceFile, diagnostics } = env;
  const root = made.decl.parent.parent.parent;
  const places: Place[] = [];
  let ok = true;
  const place = (loops: readonly GrownLoop[], when: Expr | undefined): Place => {
    const p: Place = { loops, ...(when !== undefined ? { when } : {}), pushes: 0 };
    places.push(p);
    return p;
  };
  const refuse = (message: string, at: ts.Node, span?: Stmt['span']): void => {
    diagnostics.push(
      span === undefined
        ? makeDiagnostic(sourceFile, at, message, TS_CODES.UNSUPPORTED)
        : diagnosticAtSpan(sourceFile, span, at, message, TS_CODES.UNSUPPORTED, 'error'),
    );
    ok = false;
  };
  const loopIn = (st: ForStmt, loops: readonly GrownLoop[], at: Place): Place | undefined => {
    const node = nodeAt(root, st.span?.start, sourceFile, isLoop);
    const shown = node === undefined ? 'a loop' : `"${loopText(node, sourceFile)}"`;
    const adds =
      pushesIn(st, made.param) > 0
        ? `${shown} pushes onto "${name}"`
        : `${shown} writes an element of "${name}" that can append to it`;
    const factor = counted(st);
    if (factor === undefined) {
      refuse(
        `${adds}, and its trip count is no count from a start to a bound by a constant whole ` +
          `step, so the call cannot reserve room for "${name}" before it runs; that is not ` +
          `supported yet.`,
        node ?? made.decl,
      );
      return undefined;
    }
    const range = rangeOf(st)!;
    if (!hostReadable(range.start, r) || !hostReadable(range.bound, r)) {
      refuse(notKnown(`${adds}, and its start or bound`), node ?? made.decl);
      return undefined;
    }
    const own = place([...loops, factor], at.when);
    own.pushes += loops.length === 0 ? env.writesIn(st) : 0;
    return own;
  };
  const walk = (sts: readonly Stmt[], at: Place): void => {
    for (const st of sts) {
      if (!ok) return;
      switch (st.s) {
        case 'for': {
          if (pushesIn(st, made.param) + env.writesIn(st) === 0) break;
          const inner = loopIn(st, at.loops, at);
          if (inner !== undefined) walk(st.body, inner);
          break;
        }
        case 'if': {
          if (at.loops.length > 0 || pushesIn(st, made.param) === 0) {
            for (const arm of st.arms) walk(arm.body, at);
            if (st.elseBody !== undefined) walk(st.elseBody, at);
            break;
          }
          branch(st, at);
          break;
        }
        case 'switch':
          for (const c of st.cases) walk(c.body, at);
          if (st.defaultBody !== undefined) walk(st.defaultBody, at);
          break;
        default:
          eachStmtExpr(st, (e) =>
            eachExpr(e, (x) => {
              if (isPush(x, made.param)) at.pushes++;
            }),
          );
      }
    }
  };
  const branch = (st: Stmt & { s: 'if' }, at: Place): void => {
    let before: Expr | undefined;
    const arms = st.arms.map((a) => ({
      ...a,
      pushes: pushesIn({ s: 'if', arms: [a] }, made.param),
    }));
    const last = arms.reduce((n, a, i) => (a.pushes > 0 ? i : n), -1);
    const elseHolds =
      st.elseBody !== undefined && st.elseBody.some((x) => pushesIn(x, made.param) > 0);
    for (const [i, arm] of arms.entries()) {
      if (i > last && !elseHolds) break;
      if (!hostCondition(arm.cond, r)) {
        const node = nodeAt(root, st.span?.start, sourceFile, ts.isIfStatement);
        const text =
          node === undefined ? 'a branch' : `"if (${node.expression.getText(sourceFile)})"`;
        refuse(
          notKnown(`${text} decides whether a loop pushes onto "${name}", and its condition`),
          node ?? made.decl,
          st.span,
        );
        return;
      }
      const when = allOf(at.when, before, arm.cond);
      before = allOf(before, not(arm.cond));
      if (arm.pushes > 0) walk(arm.body, place(at.loops, when));
    }
    if (elseHolds && ok) walk(st.elseBody!, place(at.loops, allOf(at.when, before)));
  };
  const top = place([], undefined);
  walk(body, top);
  if (!ok) return undefined;
  return places
    .filter((p) => p.pushes > 0)
    .map((p): GrownTerm => {
      const [head, ...inner] = p.loops;
      const loop = head ?? { low: once(0), high: once(1), inclusive: false, step: 1 };
      return {
        ...loop,
        pushes: p.pushes,
        ...(inner.length > 0 ? { inner } : {}),
        ...(p.when !== undefined ? { when: p.when } : {}),
      };
    });
}
