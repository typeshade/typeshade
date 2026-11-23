import type { FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachBlockStmt as eachBodyStmt, eachBodyExpr } from './opt/sroa/blocks.js';
import { inheritEffects } from './effects.js';
import { fixpoint } from './opt/optimize.js';
import { varToLet } from './opt/var-to-let.js';
import { constProp } from './opt/const-prop.js';
import { copyProp } from './opt/copy-prop.js';
import { deadBranch } from './opt/dead-branch.js';
import { structCtor } from './opt/struct-ctor.js';
import { memberFold } from './opt/member-fold.js';
import { dce } from './opt/dce.js';

const SETTLE = [varToLet, constProp, copyProp, deadBranch, structCtor, memberFold, dce];

export function bodyCost(body: readonly Stmt[]): number {
  let n = 0;
  eachBodyStmt(body, () => n++);
  eachBodyExpr(body, () => n++);
  return n;
}

const settled = new WeakMap<FuncDecl, FuncDecl>();

export function settledFn(f: FuncDecl, m: ModuleDecl): FuncDecl {
  const known = settled.get(f);
  if (known !== undefined) return known;
  const view: ModuleDecl = { ...m, funcs: [f] };
  inheritEffects(m, view);
  const out = fixpoint(view, SETTLE).funcs[0]!;
  settled.set(f, out);
  return out;
}
