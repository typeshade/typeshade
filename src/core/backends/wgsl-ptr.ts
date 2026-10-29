// === WGSL: a parameter the callee writes is a pointer, and a pointer carries its space ===
//
// The IR says WHICH parameters a callee writes through (`params[i].mode === 'inout'`) and
// nothing about how a target spells it, because the two targets do not agree. GLSL ES 3.00 has
// `inout T name`, copy-in/copy-out, and it takes any l-value argument. WGSL has a pointer, and
// the ADDRESS SPACE is part of the pointer's type: `ptr<function, T>` and
// `ptr<storage, T, read_write>` are different types, and a function declared for one cannot be
// handed the other. Measured on Tint:
//
//   fn bump(p: ptr<function, S>)          bump(&localVar)   accepts
//   fn bump(p: ptr<storage, S, read_write>)  bump(&buf[i])  accepts
//   fn bump(p: ptr<function, S>)          bump(&buf[i])     REJECTS, "expected
//                                                           'ptr<function, S, read_write>',
//                                                           got 'ptr<storage, S, read_write>'"
//
// So one WGSL function per address space its calls actually use. That is monomorphisation, the
// same answer T9 gives generics, and it belongs here rather than in the IR: GLSL emits the one
// function and never hears about any of it.
//
// One space and the function keeps its name, which is every module in the corpus today. Two or
// more and each copy past the first takes a suffix naming its space, so the name depends only
// on the spaces used and not on what else the module does — a golden stays stable.

// A parameter the callee only READS is a pointer too when it is a struct or an array and the
// call hands it a place (Rule 8.26, change 0103): `fn Ray_at(self_: ptr<function, Ray>, t: f32)`
// called as `Ray_at(&r, 1.0)`, and `ptr<storage, T, read>` or `ptr<uniform, T>` for a binding,
// so the call reads the caller's own place instead of copying it whole. Each such parameter adds
// one more position to the key a copy is made for, with `value` for a call whose argument is no
// place, or one that can change while the callee runs (below): that call keeps the copy it had.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import { stageOf } from '../ir/nodes.js';
import { mapStmt } from '../passes/opt/ir-transform.js';
import { eachStmtExpr } from '../ir/visit.js';
import { eachExpr } from '../ir/visit.js';
import { fnWrites, SYNC_WRITE, type FnWrites } from '../passes/effects.js';

/** A WGSL address space a pointer parameter can point into. `storage_read` is a pointer into a
 *  `read` storage binding, which a parameter that only reads its argument can be handed;
 *  `storage` is `read_write`. */
export type PtrSpace =
  'function' | 'private' | 'workgroup' | 'storage' | 'storage_read' | 'uniform';

/** What one position of a copy's key says: the space a pointer points into, or `value` for a
 *  read-only parameter that this copy takes by value, as every such parameter was taken before
 *  change 0103. */
type Token = PtrSpace | 'value';

type Param = FuncDecl['params'][number];

/** The space each pointer parameter of a declaration points into. Written by
 *  {@link pointerSpaces} and read by the backend's `paramDecl`; a declaration nothing put here
 *  has none, and `function` is what a pointer parameter defaults to. */
const SPACES = new WeakMap<Param, PtrSpace>();

/** The space `p` points into: what {@link pointerSpaces} decided, or `function`. */
export const ptrSpaceOf = (p: Param): PtrSpace => SPACES.get(p) ?? 'function';

/** The WGSL pointer type of a pointer parameter: `ptr<storage, T, read_write>` for one the
 *  callee writes into a storage element, `ptr<storage, T, read>` for one it reads from a `read`
 *  binding, `ptr<S, T>` otherwise. */
export const ptrTypeOf = (p: Param, inner: string): string => {
  const space = ptrSpaceOf(p);
  if (space === 'storage') return `ptr<storage, ${inner}, read_write>`;
  if (space === 'storage_read') return `ptr<storage, ${inner}, read>`;
  return `ptr<${space}, ${inner}>`;
};

/** The root name an l-value is reached through: `ps[i].pos` is reached through `ps`. */
function rootName(e: Expr): string | undefined {
  let at = e;
  for (;;) {
    if (at.op === 'varref' || at.op === 'param') return at.name;
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    return undefined;
  }
}

/** The address space an argument the callee WRITES lives in, read off the module's own
 *  declarations: a storage binding is `storage`, a module variable is the space it declares,
 *  and everything else is a local, which is `function`. The front end has made it a place a
 *  function may write (Rule 8.10). */
function spaceOfArg(e: Expr, m: ModuleDecl): PtrSpace {
  const name = rootName(e);
  if (name === undefined) return 'function';
  const binding = m.bindings.find((b) => b.name === name);
  if (binding !== undefined) return binding.space === 'storage' ? 'storage' : 'function';
  const v = (m.vars ?? []).find((x) => x.name === name);
  if (v !== undefined) return v.space === 'workgroup' ? 'workgroup' : 'private';
  return 'function';
}

/** Whether `p` of `f` is a parameter the callee only reads and a call may hand a place by
 *  pointer (Rule 8.26): a struct or a fixed-size array, taken by value, of a function that is
 *  not an entry point. A by-value parameter is never written in WGSL, which refuses an
 *  assignment to one, so the IR never writes it either. */
const readsInPlace = (f: FuncDecl, p: Param): boolean =>
  p.mode === undefined &&
  stageOf(f) === undefined &&
  p.builtin === undefined &&
  p.location === undefined &&
  (p.type.kind === 'struct' || (p.type.kind === 'array' && p.type.size !== undefined));

/** The parameters of `f` a copy's key has a position for: each one it writes through, and each
 *  one it only reads that a place may reach by pointer. */
const keyed = (f: FuncDecl): boolean[] =>
  f.params.map((p) => p.mode === 'inout' || readsInPlace(f, p));

/** The names a function body declares with `var`, which WGSL can take the address of. A name a
 *  body also declares with `let` is left out: a pointer to it could name the wrong one. */
function varNames(f: FuncDecl): ReadonlySet<string> {
  const vars = new Set<string>();
  const lets = new Set<string>();
  const visit = (s: Stmt): void => {
    if (s.s === 'var') vars.add(s.name);
    if (s.s === 'let') lets.add(s.name);
    eachStmtExpr(s, () => {}, visit);
  };
  for (const s of f.body) visit(s);
  for (const n of lets) vars.delete(n);
  for (const p of f.params) vars.delete(p.name);
  return vars;
}

/** The key one call's arguments make, for a function with keyed parameters. */
const keyOf = (tokens: readonly Token[]): string => tokens.join(',');

/** Give every function with a pointer parameter one copy per address-space key its calls use,
 *  and point each call at the copy it needs. Identity for a module with no `inout` parameter and
 *  no struct or array parameter. */
export function pointerSpaces(m: ModuleDecl): ModuleDecl {
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const keyedOf = new Map(m.funcs.map((f) => [f.name, keyed(f)]));
  const hasPointer = (f: FuncDecl): boolean => keyedOf.get(f.name)!.some((k) => k);
  if (!m.funcs.some(hasPointer)) return m;
  const writes: FnWrites = fnWrites(m);
  const localVars = new Map(m.funcs.map((f) => [f.name, varNames(f)]));

  /** The token a read-only parameter's argument takes at one call (Rule 8.26), in the function
   *  `f` whose copy is `inside`. `value` when the argument is no place a pointer can reach, and
   *  when the place can change while the callee runs: the callee writes it by name, another
   *  argument of the call that the callee writes is the same place, or it is memory other
   *  invocations share and the callee runs a barrier (change 0103, section 4). */
  const readToken = (
    call: Expr & { op: 'call' },
    at: number,
    f: FuncDecl,
    inside: ReadonlyMap<string, Token>,
  ): Token => {
    const arg = call.args[at];
    const root = arg === undefined ? undefined : rootName(arg);
    if (arg === undefined || root === undefined) return 'value';
    let token: Token = 'value';
    const held = inside.get(root);
    if (held !== undefined) token = held;
    else if (f.params.some((p) => p.name === root)) token = 'value';
    else if (localVars.get(f.name)!.has(root)) token = 'function';
    else {
      const binding = m.bindings.find((b) => b.name === root);
      const v = (m.vars ?? []).find((x) => x.name === root);
      if (binding !== undefined && binding.space === 'uniform') token = 'uniform';
      else if (binding !== undefined && binding.space === 'storage')
        token = binding.access === 'read_write' ? 'storage' : 'storage_read';
      else if (v !== undefined) token = v.space === 'workgroup' ? 'workgroup' : 'private';
    }
    if (token === 'value') return token;
    const written = writes.get(call.fn) ?? new Set<string>();
    // 1. The callee, or a function it calls, writes the place by its name.
    if (held === undefined && written.has(root)) return 'value';
    // 2. Another argument of the call that the callee writes through is the same place.
    const callee = byName.get(call.fn)!;
    for (const [j, p] of callee.params.entries()) {
      if (j === at || p.mode !== 'inout') continue;
      const other = call.args[j];
      if (other !== undefined && rootName(other) === root) return 'value';
    }
    // 3. Shared memory, read across a barrier another invocation's write can land behind.
    if ((token === 'workgroup' || token === 'storage') && written.has(SYNC_WRITE)) return 'value';
    return token;
  };

  // Every call to such a function, with the tokens its arguments make. A call inside a function
  // that itself takes a pointer passes that pointer straight on, so the token it reads is the
  // ENCLOSING parameter's, resolved to a fixed point below, because the enclosing function's
  // own tokens are decided by its callers.
  const wanted = new Map<string, Set<string>>();
  const record = (fn: string, tokens: readonly Token[]): void => {
    const into = wanted.get(fn) ?? new Set<string>();
    into.add(keyOf(tokens));
    wanted.set(fn, into);
  };
  /** The tokens of a copy no call asks for: a pointer into a local for each written
   *  parameter, a value for each read-only one. */
  const defaultTokens = (f: FuncDecl): Token[] =>
    f.params
      .filter((_, i) => keyedOf.get(f.name)![i])
      .map((p): Token => (p.mode === 'inout' ? 'function' : 'value'));
  const argTokens = (
    call: Expr & { op: 'call' },
    f: FuncDecl,
    inside: ReadonlyMap<string, Token>,
  ): Token[] => {
    const callee = byName.get(call.fn);
    if (callee === undefined) return [];
    const out: Token[] = [];
    for (const [i, p] of callee.params.entries()) {
      if (p.mode === 'inout') {
        const arg = call.args[i];
        if (arg === undefined) continue;
        const through = rootName(arg);
        const enclosing = through === undefined ? undefined : inside.get(through);
        out.push(enclosing ?? spaceOfArg(arg, m));
        continue;
      }
      if (keyedOf.get(callee.name)![i]) out.push(readToken(call, i, f, inside));
    }
    return out;
  };
  const walkCalls = (f: FuncDecl, inside: ReadonlyMap<string, Token>): void => {
    for (const s of f.body) {
      eachStmtExpr(s, (e) => {
        eachExpr(e, (x) => {
          if (x.op !== 'call') return;
          const callee = byName.get(x.fn);
          if (callee === undefined || !hasPointer(callee)) return;
          record(x.fn, argTokens(x, f, inside));
        });
      });
    }
  };
  // A function with no keyed parameter is walked once; one that has them is walked per key it
  // was asked for, since that is what its own arguments pass on.
  for (const f of m.funcs) if (!hasPointer(f)) walkCalls(f, new Map());
  const total = (): number => [...wanted.values()].reduce((n, s) => n + s.size, 0);
  const settle = (): void => {
    for (let round = 0; round < m.funcs.length + 1; round++) {
      let grew = false;
      for (const f of m.funcs) {
        if (!hasPointer(f)) continue;
        for (const key of [...(wanted.get(f.name) ?? [])]) {
          const before = total();
          walkCalls(f, bindingOf(f, key, keyedOf.get(f.name)!));
          if (total() !== before) grew = true;
        }
      }
      if (!grew) break;
    }
  };
  // A function no call reaches is still emitted, as its default copy, and the calls in that
  // copy count like any other; recording them can reach a function no call reached before.
  for (;;) {
    settle();
    const unreached = m.funcs.filter((f) => hasPointer(f) && !wanted.has(f.name));
    if (unreached.length === 0) break;
    for (const f of unreached) record(f.name, defaultTokens(f));
  }

  // One copy per key, named for its tokens when there is more than one.
  const copies = new Map<string, FuncDecl>();
  const nameFor = (base: string, key: string, only: boolean): string =>
    only || key === '' ? base : `${base}_${key.split(',').join('_')}`;
  const funcs: FuncDecl[] = [];
  const originOf = new Map<FuncDecl, FuncDecl>();
  for (const f of m.funcs) {
    if (!hasPointer(f)) {
      funcs.push(f);
      originOf.set(f, f);
      continue;
    }
    const keys = [...(wanted.get(f.name) ?? new Set([keyOf(defaultTokens(f))]))];
    keys.sort();
    for (const key of keys) {
      const tokens = key === '' ? [] : (key.split(',') as Token[]);
      const name = nameFor(f.name, key, keys.length === 1);
      let at = 0;
      const params = f.params.map((p, i): Param => {
        if (!keyedOf.get(f.name)![i]) return { ...p };
        const token = tokens[at++] ?? (p.mode === 'inout' ? 'function' : 'value');
        if (token === 'value') return { ...p };
        // A read-only parameter handed a place is spelled as one the callee takes by pointer;
        // nothing after this pass reads the IR's `inout` for anything but the spelling.
        const copy: Param = { ...p, mode: 'inout' };
        SPACES.set(copy, token);
        return copy;
      });
      const copy: FuncDecl = { ...f, name, params };
      copies.set(`${f.name}|${key}`, copy);
      funcs.push(copy);
      originOf.set(copy, f);
    }
  }

  // Point every call at the copy its arguments name.
  const retarget = (
    f: FuncDecl,
    origin: FuncDecl,
    inside: ReadonlyMap<string, Token>,
  ): FuncDecl => {
    const fix = (e: Expr): Expr => {
      if (e.op !== 'call') return e;
      const callee = byName.get(e.fn);
      if (callee === undefined || !hasPointer(callee)) return e;
      const key = keyOf(argTokens(e, origin, inside));
      const only = (wanted.get(e.fn)?.size ?? 1) === 1;
      const target = copies.get(`${e.fn}|${key}`);
      const name = target?.name ?? nameFor(e.fn, key, only);
      return name === e.fn ? e : { ...e, fn: name, declRef: target ?? e.declRef };
    };
    return { ...f, body: f.body.map((s: Stmt) => mapStmt(s, fix)) };
  };
  return {
    ...m,
    funcs: funcs.map((c) => {
      const origin = originOf.get(c) ?? c;
      return retarget(c, origin, hasPointer(origin) ? bindingOfDecl(c) : new Map());
    }),
  };
}

/** What each keyed parameter of `f` holds, for the copy keyed `key`: its pointer's space. A
 *  parameter the copy takes by value holds nothing a call can pass on. */
function bindingOf(f: FuncDecl, key: string, keyedHere: readonly boolean[]): Map<string, Token> {
  const tokens = key === '' ? [] : (key.split(',') as Token[]);
  const out = new Map<string, Token>();
  let at = 0;
  f.params.forEach((p, i) => {
    if (!keyedHere[i]) return;
    const token = tokens[at++] ?? (p.mode === 'inout' ? 'function' : 'value');
    if (token !== 'value') out.set(p.name, token);
  });
  return out;
}

/** The same, read off a copy whose parameters already carry their spaces. */
function bindingOfDecl(f: FuncDecl): Map<string, Token> {
  const out = new Map<string, Token>();
  for (const p of f.params) if (p.mode === 'inout') out.set(p.name, ptrSpaceOf(p));
  return out;
}
