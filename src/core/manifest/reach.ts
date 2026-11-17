import { wgslBackend } from '../backends/wgsl.js';
import { loweredWithPlugins } from '../emit.js';
import type { FuncDecl, ModuleDecl } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { fnReads, fnWrites } from '../passes/effects.js';

export function calleesOf(f: FuncDecl, declared: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && declared.has(x.fn)) out.add(x.fn);
      }),
    );
  return out;
}

export function closureOf(
  root: string,
  callees: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const out = new Set<string>([root]);
  const todo = [root];
  while (todo.length > 0) {
    for (const c of callees.get(todo.pop()!) ?? [])
      if (!out.has(c)) {
        out.add(c);
        todo.push(c);
      }
  }
  return out;
}

export interface BindingReach {
  readonly touched: ReadonlySet<string>;
  readonly written: ReadonlySet<string>;
}

export function reachOf(m: ModuleDecl): (root: string) => BindingReach {
  const declared = new Set(m.funcs.map((f) => f.name));
  const callees = new Map(m.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  const reads = fnReads(m);
  const writes = fnWrites(m);
  return (root) => {
    const touched = new Set<string>();
    const written = new Set<string>();
    for (const g of closureOf(root, callees)) {
      for (const n of reads.get(g) ?? []) touched.add(n);
      for (const n of writes.get(g) ?? []) {
        touched.add(n);
        written.add(n);
      }
    }
    return { touched, written };
  };
}

export function emittedReachOf(m: ModuleDecl): (entry: string) => BindingReach {
  return reachOf(loweredWithPlugins(m, wgslBackend));
}
