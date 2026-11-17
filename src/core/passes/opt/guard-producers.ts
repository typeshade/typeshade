import { stageOf, type Expr, type FuncDecl, type ModuleDecl, type Stmt } from '../../ir/index.js';
import { eachStmtExpr } from '../../ir/visit.js';
import { fnWrites, type FnWrites } from '../effects.js';
import { bodyHasRaw } from './dce.js';
import { GUARD_PREFIX } from './guard-producers/guard-expr.js';
import { guardOneChain, type ChainScope } from './guard-producers/one-chain.js';
import { everyCallIsSafe, functionsSafeToSkip } from './guard-producers/safety.js';

function guardEveryBlock(body: readonly Stmt[], scope: ChainScope): readonly Stmt[] {
  let changed = false;
  const inner = (b: readonly Stmt[]): readonly Stmt[] => {
    const out = guardEveryBlock(b, scope);
    if (out !== b) changed = true;
    return out;
  };
  const nested = body.map((s): Stmt => {
    switch (s.s) {
      case 'if': {
        const arms = s.arms.map((a) => {
          const b = inner(a.body);
          return b === a.body ? a : { ...a, body: b };
        });
        return { ...s, arms, elseBody: s.elseBody && inner(s.elseBody) };
      }
      case 'for': {
        const b = inner(s.body);
        return b === s.body ? s : { ...s, body: b };
      }
      case 'switch': {
        const cases = s.cases.map((k) => {
          const b = inner(k.body);
          return b === k.body ? k : { ...k, body: b };
        });
        return { ...s, cases, defaultBody: s.defaultBody && inner(s.defaultBody) };
      }
      default:
        return s;
    }
  });
  let current: readonly Stmt[] = changed ? nested : body;
  for (;;) {
    const next = guardOneChain(current, scope);
    if (next === undefined) return current;
    current = next;
  }
}

// Why: the fixpoint optimizes each function in a module that holds it alone, so the callees a
// producer reaches are not in the module this pass sees. The safe set is computed once from the
// whole module, keyed by the effect table every per-function view inherits, as DCE does.
const safeByTable = new WeakMap<FnWrites, ReadonlySet<string>>();

export function prepareGuardProducers(m: ModuleDecl): void {
  const writes = fnWrites(m);
  if (!safeByTable.has(writes)) safeByTable.set(writes, functionsSafeToSkip(m, writes));
}

function firstFreeGuardNumber(f: FuncDecl): number {
  const taken = new Set<string>();
  const scan = (s: Stmt): void => {
    if ((s.s === 'let' || s.s === 'var') && s.name.startsWith(GUARD_PREFIX)) taken.add(s.name);
    eachStmtExpr(s, () => {}, scan);
  };
  for (const s of f.body) scan(s);
  let n = 0;
  while (taken.has(`${GUARD_PREFIX}${String(n)}`)) n++;
  return n;
}

export function guardProducers(m: ModuleDecl): ModuleDecl {
  prepareGuardProducers(m);
  const safeFns = safeByTable.get(fnWrites(m))!;
  const safe = (e: Expr): boolean => everyCallIsSafe(e, (n) => safeFns.has(n));
  let changed = false;
  const funcs = m.funcs.map((f): FuncDecl => {
    // Why: a compute entry runs an idle lane through its iteration so that every lane of the
    // workgroup takes the same control flow (docs/hardware-notes.md A1); a guard would skip it.
    if (bodyHasRaw(f.body) || stageOf(f) === 'compute') return f;
    const body = guardEveryBlock(f.body, {
      safe,
      safeFns,
      counter: { n: firstFreeGuardNumber(f) },
    });
    if (body === f.body) return f;
    changed = true;
    return { ...f, body };
  });
  return changed ? { ...m, funcs } : m;
}
