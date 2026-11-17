import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js';
import { eachStmtExpr } from '../../ir/visit.js';
import {
  bodyHasEffectfulCall,
  fnReads,
  fnWrites,
  type FnReads,
  type FnWrites,
} from '../effects.js';
import { bodyHasRaw, collectLocals, collectMutatedRoots, eachExpr } from './expr-utils.js';
import { numberBlock, type MintedTemp } from './gvn/block.js';

const MIN_READS_OF_A_TEMP = 2;

function readsOfEachTemp(
  body: readonly Stmt[],
  temps: ReadonlyMap<string, unknown>,
): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'varref' && temps.has(x.name)) out.set(x.name, (out.get(x.name) ?? 0) + 1);
    });
  for (const s of body) eachStmtExpr(s, visit);
  return out;
}

function firstFreeTempNumber(localSet: ReadonlySet<string>): number {
  let next = 0;
  for (const n of localSet) {
    const match = /^_gv(\d+)$/.exec(n);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}

function numberFn(
  f: FuncDecl,
  loadRoots: ReadonlySet<string>,
  writes: FnWrites,
  reads: FnReads,
): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  if (bodyHasEffectfulCall(f.body, writes)) return f;
  const localSet = new Set<string>();
  collectLocals(f.body, localSet);
  collectMutatedRoots(f.body, localSet, writes);
  const firstTemp = firstFreeTempNumber(localSet);
  const deniedKeysByBlock = new Map<readonly Stmt[], Set<string>>();
  // Why: the denied set only grows, and a denied key is never minted in its block again,
  // so this loop ends.
  for (;;) {
    const minted = new Map<string, MintedTemp>();
    const body = numberBlock(f.body, {
      localSet,
      loadRoots,
      reads,
      next: { n: firstTemp },
      deny: deniedKeysByBlock,
      minted,
    });
    if (minted.size === 0) return { ...f, body };
    const readCounts = readsOfEachTemp(body, minted);
    let deniedOne = false;
    for (const [name, temp] of minted) {
      if ((readCounts.get(name) ?? 0) >= MIN_READS_OF_A_TEMP) continue;
      let denied = deniedKeysByBlock.get(temp.block);
      if (denied === undefined) deniedKeysByBlock.set(temp.block, (denied = new Set()));
      denied.add(temp.key);
      deniedOne = true;
    }
    if (!deniedOne) return { ...f, body };
  }
}

export function gvn(m: ModuleDecl): ModuleDecl {
  const loadRoots = new Set(m.bindings.map((b) => b.name));
  const writes = fnWrites(m);
  const reads = fnReads(m);
  return { ...m, funcs: m.funcs.map((f) => numberFn(f, loadRoots, writes, reads)) };
}
