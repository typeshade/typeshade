// ═══ A local that only reads a place reads the place itself (Rule 8.28, change 0104) ═══
//
// `const p = items[i]` is a copy: the whole element is loaded into `p`, every field and every
// element of an array field, and a loop loads it again on each iteration. When `p` is never
// written and nothing writes the place while `p` is read, the copy and the place hold one value
// for as long as `p` is read, so every read of `p` can read the place instead: `p.pos.x` is
// `items[_pl0].pos.x`, with the index evaluated once, where `p` was declared, into `_pl0`, unless
// it gives one value wherever it is evaluated (change 0105, item 3). A call
// handed `p` is then handed the place, which Rule 8.28 already passes by pointer on WGSL and by
// name on GLSL ES 3.00 for a module-scope place. On WebGL2 a storage element read whole has no
// lane, so `const p = items[i]` was refused there; read field by field, it compiles.
//
// The local stays a copy when any of these holds over the statements after its declaration in
// its block (the only ones that can read it):
//
//   - the local is written: assigned, or handed to a parameter the callee writes through;
//   - a write can reach the part of the root the place names: an assignment, a call that writes
//     through an argument or by name (`fnWrites`), or an atomic. Two paths of one root reach
//     different parts when, at some step, they name different fields or different literal
//     indices; an index that is not a literal decides nothing at its step (change 0105, item 4);
//   - the root is memory other invocations share (a workgroup variable, a `read_write` storage
//     binding) and a barrier runs, directly or in a function called there;
//   - the root or an index name is declared again there, which would make the place name
//     something else.
//
// A `let` and a `const` of the source alike (Decision D2): a `var` the function never writes
// is a `let` in all but spelling. Only struct and fixed-size array locals are taken; a scalar,
// a vector or a matrix copy is a register move.
//
// An IR → IR pass with no target in it, run by each writer where it reads the module: WGSL
// after the optimizer, so no pass binds the place back to a copy; GLSL before its storage
// emulation, which can then read the element field by field.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import {
  atomicWriteRoot,
  callWrites,
  EFFECTFUL_INTRINSICS,
  fnWrites,
  SYNC_WRITE,
  type FnWrites,
} from './effects.js';
import { bodyHasRaw } from './opt/dce.js';

type Param = FuncDecl['params'][number];

/** The root of a place, `items` for `items[i].pos`, when the path is members and indices. */
function rootOf(e: Expr): (Expr & { op: 'varref' | 'param' }) | undefined {
  let at = e;
  for (;;) {
    if (at.op === 'varref' || at.op === 'param') return at;
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    return undefined;
  }
}

/** Whether `e` reads a place: a name, or a field or element of one. */
const isPlace = (e: Expr): boolean =>
  e.op !== 'varref' && e.op !== 'param' && rootOf(e) !== undefined;

const aggregate = (e: Expr): boolean =>
  e.type.kind === 'struct' || (e.type.kind === 'array' && e.type.size !== undefined);

/** The fp64 lowering's `vec64` and `mat64` structs, which are a vector and a matrix in the
 *  source (change 0103's exclusion). */
const loweredNumber = (e: Expr): boolean =>
  e.type.kind === 'struct' &&
  (e.type.name.startsWith('DF64Vec') || e.type.name.startsWith('DF64Mat'));

/** Every statement of `body`, nested ones included, in order. */
function eachStmt(body: readonly Stmt[], visit: (s: Stmt) => void): void {
  const walk = (s: Stmt): void => {
    visit(s);
    eachStmtExpr(s, () => {}, walk);
  };
  for (const s of body) walk(s);
}

/** Every expression the statements of `body` hold, nested ones included. */
function eachBodyExpr(body: readonly Stmt[], visit: (e: Expr) => void): void {
  for (const s of body) eachStmtExpr(s, (e) => eachExpr(e, visit));
}

const targetRoot = (e: Expr): string | undefined => rootOf(e)?.name;

/** The names `body` writes, in its own words: assignment targets, what its calls write (their
 *  module names and the places they write through), and what its atomics write. */
function writtenIn(body: readonly Stmt[], writes: FnWrites): Set<string> {
  const out = new Set<string>();
  eachStmt(body, (s) => {
    if (s.s === 'assign' || s.s === 'assignOp') {
      const r = targetRoot(s.target);
      if (r !== undefined) out.add(r);
    }
  });
  eachBodyExpr(body, (x) => {
    if (x.op === 'call') for (const n of callWrites(x, writes)) out.add(n);
    const r = atomicWriteRoot(x);
    if (r !== undefined) out.add(r);
  });
  return out;
}

/** The names `body` declares, nested blocks included. */
function declaredIn(body: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  eachStmt(body, (s) => {
    if (s.s === 'let' || s.s === 'var') out.add(s.name);
  });
  return out;
}

/** One step of a place's path: a field, a literal index, or an index that is not a literal. */
type Step = { field: string } | { lit: number | boolean } | { dyn: true };

/** The path of a place below its root, `[pos, x]` for `items[2].pos.x` read as
 *  `[{lit:2},{field:pos},{field:x}]`. */
function pathOf(e: Expr): Step[] {
  const out: Step[] = [];
  let at = e;
  for (;;) {
    if (at.op === 'member') out.push({ field: at.field });
    else if (at.op === 'index')
      out.push(at.idx.op === 'lit' ? { lit: at.idx.value } : { dyn: true });
    else break;
    at = at.base;
  }
  return out.reverse();
}

/** Whether two paths of one root reach different parts of it (change 0105, item 4): at some step
 *  they name different fields, or different literal indices. An index that is not a literal can
 *  be any index, so it decides nothing at its step; a path that is a prefix of the other reaches
 *  a part of it. */
function disjoint(a: readonly Step[], b: readonly Step[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if ('field' in x && 'field' in y && x.field !== y.field) return true;
    if ('lit' in x && 'lit' in y && x.lit !== y.lit) return true;
  }
  return false;
}

/** The parts of each root `body` writes, as paths: an assignment writes its target's path, a
 *  call writes the path of each argument its callee writes through and the whole of each module
 *  name it writes, and an atomic writes the whole of its root. A whole root is the empty path. */
function writePathsIn(
  body: readonly Stmt[],
  writes: FnWrites,
  byName: ReadonlyMap<string, FuncDecl>,
): Map<string, Step[][]> {
  const out = new Map<string, Step[][]>();
  const add = (root: string, path: Step[]): void => {
    const at = out.get(root) ?? [];
    at.push(path);
    out.set(root, at);
  };
  eachStmt(body, (s) => {
    if (s.s === 'assign' || s.s === 'assignOp') {
      const r = targetRoot(s.target);
      if (r !== undefined) add(r, pathOf(s.target));
    }
  });
  eachBodyExpr(body, (x) => {
    if (x.op === 'call') {
      const written = writes.get(x.fn) ?? new Set<string>();
      const inout = new Set<string>();
      byName.get(x.fn)?.params.forEach((p, i) => {
        if (p.mode !== 'inout') return;
        inout.add(p.name);
        const arg = x.args[i];
        const r = arg === undefined ? undefined : targetRoot(arg);
        if (written.has(p.name) && r !== undefined) add(r, pathOf(arg!));
      });
      // Each module name the callee writes, itself or below, is written whole.
      for (const n of written) if (!inout.has(n)) add(n, []);
    }
    const r = atomicWriteRoot(x);
    if (r !== undefined) add(r, []);
  });
  return out;
}

/** Every name a function's body uses or declares, so a new local takes a fresh one. */
function namesOf(f: FuncDecl): Set<string> {
  const out = new Set<string>(f.params.map((p: Param) => p.name));
  for (const n of declaredIn(f.body)) out.add(n);
  eachBodyExpr(f.body, (x) => {
    if (x.op === 'varref' || x.op === 'param') out.add(x.name);
  });
  return out;
}

/** Replace every read of the name `name` in `e` with `place`. */
function substitute(e: Expr, name: string, place: Expr): Expr {
  if ((e.op === 'varref' || e.op === 'param') && e.name === name) return place;
  return mapChildren(e, (c) => substitute(c, name, place));
}

/** Whether evaluating `e` again where a local is read gives the value it gave where the local
 *  was declared: it calls no function of the module and no intrinsic with an effect, and none
 *  of its names is written (`written`) or declared again (`redeclared`) there, nor is memory
 *  other invocations share across a barrier (`synced`). */
function holdsOneValue(
  e: Expr,
  fns: ReadonlySet<string>,
  written: ReadonlySet<string>,
  redeclared: ReadonlySet<string>,
  synced: boolean,
  shared: ReadonlySet<string>,
): boolean {
  let ok = true;
  eachExpr(e, (x) => {
    if (x.op === 'call' && (fns.has(x.fn) || EFFECTFUL_INTRINSICS.has(x.fn))) ok = false;
    if (x.op === 'varref' || x.op === 'param') {
      if (written.has(x.name) || redeclared.has(x.name) || (synced && shared.has(x.name)))
        ok = false;
    }
  });
  return ok;
}

/** Read each local that only reads a place from the place itself. See the module header.
 *  Identity for a module where no struct or array local copies a place. */
export function readLocalsInPlace(m: ModuleDecl): ModuleDecl {
  const writes = fnWrites(m);
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const fns = new Set(byName.keys());
  const shared = new Set<string>([
    ...m.bindings
      .filter((b) => b.space === 'storage' && b.access === 'read_write')
      .map((b) => b.name),
    ...(m.vars ?? []).filter((v) => v.space === 'workgroup').map((v) => v.name),
  ]);
  let changed = false;
  const funcs = m.funcs.map((f) => {
    if (bodyHasRaw(f.body)) return f;
    const taken = namesOf(f);
    const writtenAnywhere = writtenIn(f.body, writes);
    let n = 0;
    const fresh = (): string => {
      for (;;) {
        const name = `_pl${n++}`;
        if (!taken.has(name)) {
          taken.add(name);
          return name;
        }
      }
    };
    /** A call in `body` that synchronises the workgroup, directly or in its callee. */
    const syncs = (body: readonly Stmt[]): boolean => {
      let found = false;
      eachBodyExpr(body, (x) => {
        if (x.op !== 'call') return;
        if (
          ['workgroupBarrier', 'storageBarrier', 'textureBarrier', 'workgroupUniformLoad'].includes(
            x.fn,
          )
        )
          found = true;
        if (writes.get(x.fn)?.has(SYNC_WRITE)) found = true;
      });
      return found;
    };
    const declaredOnce = (name: string): boolean => {
      let count = 0;
      eachStmt(f.body, (s) => {
        if ((s.s === 'let' || s.s === 'var') && s.name === name) count++;
      });
      return count === 1;
    };

    const block = (body: readonly Stmt[]): readonly Stmt[] => {
      const out: Stmt[] = [];
      for (let i = 0; i < body.length; i++) {
        // Nested blocks first: their own locals are taken where they are declared.
        const s = blockStmt(body[i]!);
        const init = s.s === 'let' ? s.expr : s.s === 'var' ? s.init : undefined;
        if (
          init === undefined ||
          !isPlace(init) ||
          !aggregate(init) ||
          loweredNumber(init) ||
          !declaredOnce((s as { name: string }).name)
        ) {
          out.push(s);
          continue;
        }
        const name = (s as { name: string }).name;
        const root = rootOf(init)!.name;
        const rest = body.slice(i + 1);
        // The local is written: a `var` anywhere in the function, since it is declared once.
        if (writtenAnywhere.has(name)) {
          out.push(s);
          continue;
        }
        // The place's root is written while the local can be read, or shares memory across a
        // barrier, or a name the place is spelled with is declared again.
        const redeclared = declaredIn(rest);
        const restWrites = writtenIn(rest, writes);
        // A write reaches the local only when its path can meet the place's (item 4 of change
        // 0105): `qs[1].a = 5.` leaves `const q = qs[0]` as it was.
        const own = pathOf(init);
        const reaches = (writePathsIn(rest, writes, byName).get(root) ?? []).some(
          (w) => !disjoint(w, own),
        );
        if (reaches || (shared.has(root) && syncs(rest)) || redeclared.has(root)) {
          out.push(s);
          continue;
        }
        // Each index that is not a literal is evaluated once, where the local was declared.
        const lets: Stmt[] = [];
        const bindIndices = (e: Expr): Expr => {
          if (e.op === 'member') {
            const base = bindIndices(e.base);
            return base === e.base ? e : { ...e, base };
          }
          if (e.op === 'index') {
            const base = bindIndices(e.base);
            // An index that calls no function of the module and no intrinsic with an effect,
            // and whose names nothing writes or declares again while the local can be read,
            // holds one value already (item 3 of change 0105). A loop counter is one: the
            // update runs after the body, where the local is gone.
            if (
              holdsOneValue(
                e.idx,
                fns,
                restWrites,
                redeclared,
                shared.size > 0 && syncs(rest),
                shared,
              )
            )
              return base === e.base ? e : { ...e, base };
            const tmp = fresh();
            lets.push({ s: 'let', name: tmp, expr: e.idx });
            return { ...e, base, idx: { op: 'varref', type: e.idx.type, name: tmp } };
          }
          return e;
        };
        const place = bindIndices(init);
        out.push(...lets);
        const replaced = rest.map((r) => mapStmtExpr(r, (e) => substitute(e, name, place)));
        // The statements after it are handled with the local gone, and this pass ends here.
        changed = true;
        out.push(...block(replaced));
        break;
      }
      return out;
    };
    const blockStmt = (s: Stmt): Stmt => {
      switch (s.s) {
        case 'if':
          return {
            ...s,
            arms: s.arms.map((a) => ({ ...a, body: block(a.body) })),
            elseBody: s.elseBody ? block(s.elseBody) : undefined,
          };
        case 'for':
          return { ...s, body: block(s.body) };
        case 'switch':
          return {
            ...s,
            cases: s.cases.map((c) => ({ ...c, body: block(c.body) })),
            defaultBody: s.defaultBody ? block(s.defaultBody) : undefined,
          };
        default:
          return s;
      }
    };
    const body = block(f.body);
    return body === f.body ? f : { ...f, body };
  });
  return changed ? { ...m, funcs } : m;
}
