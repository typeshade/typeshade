// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr, Stmt } from '../../../../core/ir/nodes.js';
import { boolT, u32T } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../../core/ir/visit.js';
import { plainCount } from '../../../../core/passes/countable.js';
import { rangeOf, type ForStmt } from '../../../../core/passes/kernel-lower-ir.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import type { GrownLoop, GrownTerm, MadeLowering, UnreadLoop } from './registry.js';
import {
  hostCondition,
  hostReadable,
  notKnown,
  readsGrownLength,
  type Readable,
} from './readable.js';

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
  if (range === undefined || loop.counted?.op !== 'add' || !plainCount(loop)) return undefined;
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
  readonly defer: (loop: UnreadLoop) => void;
  readonly open: () => void;
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
  const refuse = (message: string, at: ts.Node): void => {
    diagnostics.push(makeDiagnostic(sourceFile, at, message, TS_CODES.UNSUPPORTED));
    ok = false;
  };
  const loopIn = (st: ForStmt, loops: readonly GrownLoop[], at: Place): Place | undefined => {
    const factor = counted(st);
    if (factor === undefined) {
      env.open();
      return undefined;
    }
    const node = nodeAt(root, st.span?.start, sourceFile, isLoop);
    const shown = node === undefined ? 'a loop' : `"${loopText(node, sourceFile)}"`;
    const adds =
      pushesIn(st, made.param) > 0
        ? `${shown} pushes onto "${name}"`
        : `${shown} writes an element of "${name}" that can append to it`;
    const range = rangeOf(st)!;
    if (!hostReadable(range.start, r) || !hostReadable(range.bound, r)) {
      const what = `${adds}, and its start or bound`;
      const unread = { what, node: node ?? made.decl };
      if (loops.length === 0) {
        if (!readsGrownLength([range.start, range.bound], made.param)) {
          refuse(notKnown(what), unread.node);
          return undefined;
        }
        env.open();
        env.defer(unread);
        return undefined;
      }
      env.defer(unread);
    }
    const own = place([...loops, factor], at.when);
    own.pushes += loops.length === 0 ? env.writesIn(st) : 0;
    return own;
  };
  const walk = (sts: readonly Stmt[], at: Place, under = false): void => {
    for (const st of sts) {
      if (!ok) return;
      switch (st.s) {
        case 'for': {
          if (pushesIn(st, made.param) + env.writesIn(st) === 0) break;
          if (under) {
            env.open();
            break;
          }
          const inner = loopIn(st, at.loops, at);
          if (inner !== undefined) walk(st.body, inner);
          break;
        }
        case 'if': {
          if (at.loops.length > 0 || pushesIn(st, made.param) === 0) {
            const nested = under || at.loops.length > 0;
            for (const arm of st.arms) walk(arm.body, at, nested);
            if (st.elseBody !== undefined) walk(st.elseBody, at, nested);
            break;
          }
          branch(st, at, under);
          break;
        }
        case 'switch':
          for (const c of st.cases) walk(c.body, at, true);
          if (st.defaultBody !== undefined) walk(st.defaultBody, at, true);
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
  const branch = (st: Stmt & { s: 'if' }, at: Place, under: boolean): void => {
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
        env.open();
        return;
      }
      const when = allOf(at.when, before, arm.cond);
      before = allOf(before, not(arm.cond));
      if (arm.pushes > 0) walk(arm.body, place(at.loops, when), under);
    }
    if (elseHolds && ok) walk(st.elseBody!, place(at.loops, allOf(at.when, before)), under);
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
