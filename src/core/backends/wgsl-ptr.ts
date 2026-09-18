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

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js'
import { mapStmt } from '../passes/opt/ir-transform.js'
import { eachStmtExpr } from '../ir/visit.js'
import { eachExpr } from '../ir/visit.js'

/** A WGSL address space a pointer parameter can point into. */
export type PtrSpace = 'function' | 'private' | 'workgroup' | 'storage'

/** The space each pointer parameter of a declaration points into. Written by
 *  {@link pointerSpaces} and read by the backend's `paramDecl`; a declaration nothing put here
 *  has none, and `function` is what a pointer parameter defaults to. */
const SPACES = new WeakMap<FuncDecl['params'][number], PtrSpace>()

/** The space `p` points into: what {@link pointerSpaces} decided, or `function`. */
export const ptrSpaceOf = (p: FuncDecl['params'][number]): PtrSpace =>
  SPACES.get(p) ?? 'function'

/** The root name an l-value is reached through: `ps[i].pos` is reached through `ps`. */
function rootName(e: Expr): string | undefined {
  let at = e
  for (;;) {
    if (at.op === 'varref' || at.op === 'param') return at.name
    if (at.op === 'member' || at.op === 'index') {
      at = at.base
      continue
    }
    return undefined
  }
}

/** The address space an argument lives in, read off the module's own declarations: a storage
 *  binding is `storage`, a module variable is the space it declares, and everything else is a
 *  local, which is `function`. */
function spaceOfArg(e: Expr, m: ModuleDecl): PtrSpace {
  const name = rootName(e)
  if (name === undefined) return 'function'
  const binding = m.bindings.find((b) => b.name === name)
  if (binding !== undefined) return binding.space === 'storage' ? 'storage' : 'function'
  const v = (m.vars ?? []).find((x) => x.name === name)
  if (v !== undefined) return v.space === 'workgroup' ? 'workgroup' : 'private'
  return 'function'
}

/** The key one call's argument spaces make, for a function with `inout` parameters. */
const keyOf = (spaces: readonly PtrSpace[]): string => spaces.join(',')

/** Give every function with a pointer parameter one copy per address space its calls use, and
 *  point each call at the copy it needs. Identity for a module with no `inout` parameter, which
 *  is every module that declares no method writing its object. */
export function pointerSpaces(m: ModuleDecl): ModuleDecl {
  const byName = new Map(m.funcs.map((f) => [f.name, f]))
  const hasPointer = (f: FuncDecl): boolean => f.params.some((p) => p.mode === 'inout')
  if (!m.funcs.some(hasPointer)) return m

  // Every call to such a function, with the spaces its arguments live in. A call inside a
  // function that itself takes a pointer passes that pointer straight on, so the space it
  // reads is the ENCLOSING parameter's — resolved to a fixed point below, because the
  // enclosing function's own spaces are decided by its callers.
  const wanted = new Map<string, Set<string>>()
  const record = (fn: string, spaces: readonly PtrSpace[]): void => {
    const into = wanted.get(fn) ?? new Set<string>()
    into.add(keyOf(spaces))
    wanted.set(fn, into)
  }
  const argSpaces = (call: Expr & { op: 'call' }, inside: ReadonlyMap<string, PtrSpace>): PtrSpace[] => {
    const callee = byName.get(call.fn)
    if (callee === undefined) return []
    const out: PtrSpace[] = []
    for (const [i, p] of callee.params.entries()) {
      if (p.mode !== 'inout') continue
      const arg = call.args[i]
      if (arg === undefined) continue
      const through = rootName(arg)
      const enclosing = through === undefined ? undefined : inside.get(through)
      out.push(enclosing ?? spaceOfArg(arg, m))
    }
    return out
  }
  const walkCalls = (f: FuncDecl, inside: ReadonlyMap<string, PtrSpace>): void => {
    for (const s of f.body) {
      eachStmtExpr(s, (e) => {
        eachExpr(e, (x) => {
          if (x.op !== 'call') return
          const callee = byName.get(x.fn)
          if (callee === undefined || !hasPointer(callee)) return
          record(x.fn, argSpaces(x, inside))
        })
      })
    }
  }
  // A function with no pointer parameter is walked once; one that has them is walked per space
  // set it was asked for, since that is what its own arguments pass on.
  for (const f of m.funcs) if (!hasPointer(f)) walkCalls(f, new Map())
  for (let round = 0; round < m.funcs.length + 1; round++) {
    let grew = false
    for (const f of m.funcs) {
      if (!hasPointer(f)) continue
      for (const key of [...(wanted.get(f.name) ?? [])]) {
        const before = [...wanted.values()].reduce((n, s) => n + s.size, 0)
        walkCalls(f, bindingOf(f, key))
        if ([...wanted.values()].reduce((n, s) => n + s.size, 0) !== before) grew = true
      }
    }
    if (!grew) break
  }

  // One copy per space set, named for the space when there is more than one.
  const copies = new Map<string, FuncDecl>()
  const nameFor = (base: string, key: string, only: boolean): string =>
    only || key === '' ? base : `${base}_${key.split(',').join('_')}`
  const funcs: FuncDecl[] = []
  for (const f of m.funcs) {
    if (!hasPointer(f)) {
      funcs.push(f)
      continue
    }
    const keys = [...(wanted.get(f.name) ?? new Set([keyOf(f.params.filter((p) => p.mode === 'inout').map(() => 'function'))]))]
    keys.sort()
    for (const key of keys) {
      const spaces = key === '' ? [] : (key.split(',') as PtrSpace[])
      const name = nameFor(f.name, key, keys.length === 1)
      const params = f.params.map((p) => ({ ...p }))
      let at = 0
      for (const p of params) {
        if (p.mode !== 'inout') continue
        SPACES.set(p, spaces[at] ?? 'function')
        at++
      }
      const copy: FuncDecl = { ...f, name, params }
      copies.set(`${f.name}|${key}`, copy)
      funcs.push(copy)
    }
  }

  // Point every call at the copy its arguments name.
  const retarget = (f: FuncDecl, inside: ReadonlyMap<string, PtrSpace>): FuncDecl => {
    const fix = (e: Expr): Expr => {
      if (e.op !== 'call') return e
      const callee = byName.get(e.fn)
      if (callee === undefined || !hasPointer(callee)) return e
      const key = keyOf(argSpaces(e, inside))
      const only = (wanted.get(e.fn)?.size ?? 1) === 1
      const target = copies.get(`${e.fn}|${key}`)
      const name = target?.name ?? nameFor(e.fn, key, only)
      return name === e.fn ? e : { ...e, fn: name, declRef: target ?? e.declRef }
    }
    return { ...f, body: f.body.map((s: Stmt) => mapStmt(s, fix)) }
  }
  return {
    ...m,
    funcs: funcs.map((f) =>
      retarget(f, hasPointer(f) ? bindingOfDecl(f) : new Map()),
    ),
  }
}

/** What each pointer parameter of `f` points into, for the copy keyed `key`. */
function bindingOf(f: FuncDecl, key: string): Map<string, PtrSpace> {
  const spaces = key === '' ? [] : (key.split(',') as PtrSpace[])
  const out = new Map<string, PtrSpace>()
  let at = 0
  for (const p of f.params) {
    if (p.mode !== 'inout') continue
    out.set(p.name, spaces[at] ?? 'function')
    at++
  }
  return out
}

/** The same, read off a copy whose parameters already carry their spaces. */
function bindingOfDecl(f: FuncDecl): Map<string, PtrSpace> {
  const out = new Map<string, PtrSpace>()
  for (const p of f.params) if (p.mode === 'inout') out.set(p.name, ptrSpaceOf(p))
  return out
}
