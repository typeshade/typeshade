// Implements: Rule 8.22, a kernel function's accepted loops lowered to compute entries (docs/language-design.md; traced in reqs/).
// ═══ A kernel function's loops, lowered to the compute entries its call dispatches (0013) ═══
//
// The proof (`parallel-loop.ts`) says which of a kernel function's loops may run in any order.
// This pass turns a function whose every loop it accepted into what the host call dispatches:
//
//   - one module, which every target but WGSL ignores, holding a `@compute` entry per loop, the
//     functions the loops call, a uniform struct of the function's scalar parameters and each
//     loop's start and trip count, and a storage binding per array parameter, read or
//     read-write as the body uses it (Rule 8.23);
//   - per loop, a range function the host runs on the CPU tier first: the statements before the
//     loop, then the loop's start and bound, from which the call takes the trip count. Its arrays
//     are read only by their `.length`, so the call hands it the lengths alone.
//
// Each invocation takes one iteration: `i = start + k * step` for the `k`th, and returns at once
// past the trip count. It replays the scalar statements before the loop, which write only its
// own locals (the body's shape, Rule 8.22), and a `continue` of the loop's own becomes its
// `return`.
//
// A function this pass cannot lower runs on the CPU tier, and `noGpu` says why. This part lowers
// maps; a loop that reduces or scatters, and one that reaches a module binding or variable, a
// `bool` or an emulated `f64`, run on the CPU until the parts of change 0013 that add them.

import type { BindingDecl, Expr, FuncDecl, ModuleDecl, Stmt, StructDecl } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T } from '../ir/types.js';
import { mapChildren } from '../ir/visit.js';
import { fnReads, fnWrites } from './effects.js';
import type { KernelProof } from './parallel-loop.js';

type ForStmt = Stmt & { s: 'for' };

/** One loop of a lowered kernel function. */
export interface KernelLoopPlan {
  /** The `@compute` entry that runs it, one invocation per iteration. */
  readonly entry: string;
  /** The CPU-tier function that returns `vec2(start, bound)` for it. */
  readonly range: string;
  /** How the counter compares with the bound, as the loop writes it (`i < n`). */
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly step: number;
  /** The array parameters the loop writes, which the call reads back. */
  readonly writes: readonly string[];
  /** `a*i + c` writes, which the call checks against each array's length first. */
  readonly checks: readonly { readonly param: string; readonly a: number; readonly c: number }[];
}

/** What the call of a kernel function dispatches, when the function lowers. */
export interface KernelPlan {
  /** The module the entries are in; a target emits it as WGSL. */
  readonly module: ModuleDecl;
  /** The uniform binding of the scalar parameters, `_start` and `_n`. */
  readonly argsBinding: string;
  readonly argsStruct: string;
  readonly loops: readonly KernelLoopPlan[];
  /** The range functions, for the CPU tier's code. */
  readonly ranges: readonly FuncDecl[];
}

/** The workgroup size every lowered loop runs at. */
export const KERNEL_WORKGROUP = 64;

/** Lower kernel function `f` of `m`, whose loops `proof` judged, or say why it runs on the CPU. */
export function lowerKernel(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): KernelPlan | { readonly noGpu: string } {
  if (proof.shape !== undefined)
    return { noGpu: "its body is not the kernel call's shape (TS8070)" };
  const loops = f.body.filter((s): s is ForStmt => s.s === 'for');
  if (loops.length === 0) return { noGpu: 'it has no loop to dispatch' };
  for (const v of proof.loops) {
    if (!v.ok) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
    if (v.reductions.length > 0 || v.writes.some((w) => w.kind === 'scatter' || w.kind === 'texel'))
      return { noGpu: 'a loop of it reduces, which a later part of change 0013 lowers' };
  }
  if (f.ret.kind !== 'void')
    return { noGpu: 'it returns a value, which a later part of change 0013 lowers' };
  const scalars = f.params.filter((p) => !isRuntimeArray(p.type));
  const arrays = f.params.filter((p) => isRuntimeArray(p.type));
  for (const p of scalars) {
    const why = notUniform(p.type, m);
    if (why !== undefined) return { noGpu: `parameter "${p.name}" is ${why}` };
  }
  for (const p of arrays) {
    const why = notStorage((p.type as { elem: ShaderType }).elem, m);
    if (why !== undefined) return { noGpu: `parameter "${p.name}" holds ${why}` };
  }
  // What the loops reach beyond their own parameters: a module binding or variable is not
  // something the call passes.
  const reads = fnReads(m);
  const writes = fnWrites(m);
  const moduleNames = new Set([
    ...m.bindings.map((b) => b.name),
    ...(m.vars ?? []).map((v) => v.name),
  ]);
  for (const n of [...(reads.get(f.name) ?? []), ...(writes.get(f.name) ?? [])])
    if (moduleNames.has(n)) return { noGpu: `it reaches "${n}", which the call does not pass` };

  const argsStruct = `${f.name}_Args`;
  const argsBinding = `${f.name}_args`;
  const taken = new Set([
    ...m.funcs.map((x) => x.name),
    ...m.structs.map((s) => s.name),
    ...m.bindings.map((b) => b.name),
  ]);
  if (taken.has(argsStruct) || taken.has(argsBinding))
    return {
      noGpu: `the module already declares "${argsBinding}", the name the call's uniform takes`,
    };

  const plans: KernelLoopPlan[] = [];
  const entries: FuncDecl[] = [];
  const ranges: FuncDecl[] = [];
  const prelude: Stmt[] = [];
  let loopIndex = 0;
  let counterType: ShaderType | undefined;
  for (const st of f.body) {
    if (st.s !== 'for') {
      if (st.s === 'return') continue;
      prelude.push(st);
      continue;
    }
    const j = loopIndex++;
    const counted = st.counted!;
    const header = rangeOf(st);
    if (header === undefined)
      return { noGpu: `loop ${j + 1} compares its counter in a way the call cannot count` };
    if (counterType !== undefined && typeKey(counterType) !== typeKey(header.type))
      return { noGpu: 'its loops count with counters of two types' };
    counterType = header.type;
    // The range function reads an array only by its `.length`: the call hands it the lengths.
    if (
      !readsArraysByLengthOnly(
        [
          ...prelude,
          { s: 'call', expr: header.start } as Stmt,
          { s: 'call', expr: header.bound } as Stmt,
        ],
        arrays.map((p) => p.name),
      )
    )
      return {
        noGpu: `the statements before loop ${j + 1} read an array's elements, which the call runs before it dispatches`,
      };
    const range: FuncDecl = {
      name: `${f.name}__range${j}`,
      params: f.params,
      ret: {
        kind: 'vec',
        n: 2,
        elem: header.type.kind === 'scalar' ? (header.type.scalar as 'i32') : 'i32',
      },
      body: [
        ...prelude,
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: { kind: 'vec', n: 2, elem: (header.type as { scalar: 'i32' }).scalar },
            args: [header.start, header.bound],
          },
        },
      ],
      kernel: true,
    };
    ranges.push(range);
    const v = proof.loops[j]!;
    const written = new Set<string>();
    if (v.ok) for (const w of v.writes) written.add(w.name);
    const checks: KernelLoopPlan['checks'][number][] = [];
    if (v.ok)
      for (const w of v.writes)
        if (w.kind === 'affine' && arrays.some((p) => p.name === w.name))
          for (const c of w.c) checks.push({ param: w.name, a: w.a, c });
    const entry = entryFor(
      f,
      st,
      j,
      counted.name,
      header.type,
      counted.step,
      prelude,
      scalars.map((p) => p.name),
      arrays.map((p) => p.name),
      argsBinding,
      argsStruct,
    );
    entries.push(entry);
    plans.push({
      entry: entry.name,
      range: range.name,
      cop: header.cop,
      step: counted.step,
      writes: [...written].filter((n) => arrays.some((p) => p.name === n)),
      checks,
    });
  }

  const argsDecl: StructDecl = {
    name: argsStruct,
    fields: [
      ...scalars.map((p) => ({ name: p.name, type: p.type })),
      { name: '_start', type: counterType! },
      { name: '_n', type: u32T },
    ],
  };
  const writtenArrays = writes.get(f.name) ?? new Set<string>();
  const bindings: BindingDecl[] = [
    {
      group: 0,
      binding: 0,
      name: argsBinding,
      space: 'uniform',
      type: { kind: 'struct', name: argsStruct },
    },
    ...arrays.map((p, k): BindingDecl => ({
      group: 0,
      binding: k + 1,
      name: p.name,
      space: 'storage',
      access: writtenArrays.has(p.name) ? 'read_write' : 'read',
      type: p.type,
    })),
  ];
  const module: ModuleDecl = {
    consts: m.consts,
    structs: [...m.structs, argsDecl],
    bindings,
    funcs: [...m.funcs.filter((x) => x.kernel !== true && x.stage === undefined), ...entries],
    overrides: m.overrides ?? [],
    vars: (m.vars ?? []).filter((x) => x.space !== 'workgroup'),
    ...(m.enables !== undefined ? { enables: m.enables } : {}),
  };
  return { module, argsBinding, argsStruct, loops: plans, ranges };
}

// ─── one loop's entry ────────────────────────────────────────────────────────────────────────

function entryFor(
  f: FuncDecl,
  loop: ForStmt,
  j: number,
  counter: string,
  counterType: ShaderType,
  step: number,
  prelude: readonly Stmt[],
  scalars: readonly string[],
  arrays: readonly string[],
  argsBinding: string,
  argsStruct: string,
): FuncDecl {
  const vec3u: ShaderType = { kind: 'vec', n: 3, elem: 'u32' };
  const gid: Expr = { op: 'param', type: vec3u, name: '_gid' };
  const nwg: Expr = { op: 'param', type: vec3u, name: '_nwg' };
  const args: Expr = {
    op: 'varref',
    type: { kind: 'struct', name: argsStruct },
    name: argsBinding,
  };
  const field = (name: string, type: ShaderType): Expr => ({
    op: 'member',
    type,
    base: args,
    field: name,
  });
  const x = (v: Expr): Expr => ({ op: 'member', type: u32T, base: v, field: 'x' });
  const y = (v: Expr): Expr => ({ op: 'member', type: u32T, base: v, field: 'y' });
  const u = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
  const k: Expr = { op: 'varref', type: u32T, name: '_k' };
  // `_k = gid.x + gid.y * (nwg.x * 64)`: a dispatch past 65535 workgroups spills into y.
  const index: Expr = {
    op: 'binop',
    type: u32T,
    bop: '+',
    a: x(gid),
    b: {
      op: 'binop',
      type: u32T,
      bop: '*',
      a: y(gid),
      b: { op: 'binop', type: u32T, bop: '*', a: x(nwg), b: u(KERNEL_WORKGROUP) },
    },
  };
  const start = field('_start', counterType);
  const kAs: Expr = { op: 'call', type: counterType, fn: typeKey(counterType), args: [k] };
  const stepLit: Expr = { op: 'lit', type: counterType, value: Math.abs(step) };
  const i: Expr = {
    op: 'binop',
    type: counterType,
    bop: step < 0 ? '-' : '+',
    a: start,
    b: { op: 'binop', type: counterType, bop: '*', a: kAs, b: stepLit },
  };
  const scalarSet = new Set(scalars);
  const arraySet = new Set(arrays);
  // A parameter is a field of the uniform, or the storage binding of its name.
  const rewrite = (e: Expr): Expr => {
    if (e.op === 'param' && scalarSet.has(e.name)) return field(e.name, e.type);
    if (e.op === 'param' && arraySet.has(e.name))
      return { op: 'varref', type: e.type, name: e.name };
    return mapChildren(e, rewrite);
  };
  const body: Stmt[] = [
    { s: 'let', name: '_k', expr: index },
    {
      s: 'if',
      arms: [
        {
          cond: {
            op: 'compare',
            type: { kind: 'scalar', scalar: 'bool' },
            cop: '>=',
            a: k,
            b: field('_n', u32T),
          },
          body: [{ s: 'return' }],
        },
      ],
    },
    { s: 'let', name: counter, expr: i },
    ...[...prelude, ...ownContinuesReturn(loop.body)].map((s) => mapStmt(s, rewrite)),
  ];
  return {
    name: `${f.name}_loop${j}`,
    params: [
      { name: '_gid', type: vec3u, builtin: 'global_invocation_id' },
      { name: '_nwg', type: vec3u, builtin: 'num_workgroups' },
    ],
    ret: { kind: 'void' },
    body,
    stage: 'compute',
    workgroupSize: KERNEL_WORKGROUP,
    attrs: [`@compute @workgroup_size(${KERNEL_WORKGROUP})`],
  };
}

/** The loop's body with each `continue` of its own, which ends this iteration, as a `return`,
 *  which ends this invocation. One inside a nested loop is that loop's and stays. */
function ownContinuesReturn(body: readonly Stmt[]): Stmt[] {
  const visit = (st: Stmt): Stmt => {
    switch (st.s) {
      case 'continue':
        return { s: 'return', ...(st.span !== undefined ? { span: st.span } : {}) };
      case 'if':
        return {
          ...st,
          arms: st.arms.map((a) => ({ ...a, body: a.body.map(visit) })),
          ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(visit) } : {}),
        };
      case 'switch':
        // A `continue` in a switch continues the loop around it, which is this one.
        return {
          ...st,
          cases: st.cases.map((c) => ({ ...c, body: c.body.map(visit) })),
          ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(visit) } : {}),
        };
      default:
        return st;
    }
  };
  return body.map(visit);
}

/** `s` with `f` applied to every expression it holds, nested statements included. */
function mapStmt(st: Stmt, f: (e: Expr) => Expr): Stmt {
  const S = (x: Stmt): Stmt => mapStmt(x, f);
  switch (st.s) {
    case 'let':
      return { ...st, expr: f(st.expr) };
    case 'var':
      return st.init !== undefined ? { ...st, init: f(st.init) } : st;
    case 'assign':
    case 'assignOp':
      return { ...st, target: f(st.target), expr: f(st.expr) };
    case 'call':
      return { ...st, expr: f(st.expr) };
    case 'return':
      return st.expr !== undefined ? { ...st, expr: f(st.expr) } : st;
    case 'if':
      return {
        ...st,
        arms: st.arms.map((a) => ({ cond: f(a.cond), body: a.body.map(S) })),
        ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(S) } : {}),
      };
    case 'for':
      return {
        ...st,
        init: S(st.init),
        cond: f(st.cond),
        update: S(st.update),
        body: st.body.map(S),
      };
    case 'switch':
      return {
        ...st,
        scrut: f(st.scrut),
        cases: st.cases.map((c) => ({ ...c, body: c.body.map(S) })),
        ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(S) } : {}),
      };
    default:
      return st;
  }
}

// ─── the loop's range ────────────────────────────────────────────────────────────────────────

/** The loop's start, its bound, the comparison between them and the counter's type. */
function rangeOf(
  loop: ForStmt,
): { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType } | undefined {
  const c = loop.counted;
  if (c === undefined || loop.init.s !== 'var' || loop.init.init === undefined) return undefined;
  const cond = loop.cond;
  if (cond.op !== 'compare') return undefined;
  const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as const;
  const isCounter = (e: Expr): boolean =>
    (e.op === 'varref' || e.op === 'param') && e.name === c.name;
  let cop: KernelLoopPlan['cop'];
  let bound: Expr;
  if (isCounter(cond.a) && cond.cop in flip) {
    cop = cond.cop as KernelLoopPlan['cop'];
    bound = cond.b;
  } else if (isCounter(cond.b) && cond.cop in flip) {
    cop = flip[cond.cop as keyof typeof flip];
    bound = cond.a;
  } else return undefined;
  // The step moves toward the bound (Rule 7.5): up for `<`, down for `>`.
  if ((cop === '<' || cop === '<=') !== c.step > 0) return undefined;
  return { start: loop.init.init, bound, cop, type: loop.init.type };
}

/** Whether `sts` read the arrays `names` only as `arrayLength(a)`. */
function readsArraysByLengthOnly(sts: readonly Stmt[], names: readonly string[]): boolean {
  const set = new Set(names);
  let ok = true;
  const visit = (e: Expr): void => {
    if (!ok) return;
    if (e.op === 'call' && e.fn === 'arrayLength') return;
    if ((e.op === 'param' || e.op === 'varref') && set.has(e.name)) {
      ok = false;
      return;
    }
    forEachChild(e, visit);
  };
  const walk = (st: Stmt): void => {
    mapStmt(st, (e) => {
      visit(e);
      return e;
    });
  };
  sts.forEach(walk);
  return ok;
}

function forEachChild(e: Expr, f: (c: Expr) => void): void {
  mapChildren(e, (c) => {
    f(c);
    return c;
  });
}

// ─── what the call can bind ──────────────────────────────────────────────────────────────────

const isRuntimeArray = (t: ShaderType): boolean => t.kind === 'array' && t.size === undefined;

function typeKey(t: ShaderType): string {
  return t.kind === 'scalar' ? t.scalar : t.kind;
}

/** Why a scalar parameter cannot be a uniform field, or undefined. */
function notUniform(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

/** Why an array element cannot live in a storage buffer the call packs, or undefined. */
function notStorage(t: ShaderType, m: ModuleDecl): string | undefined {
  return notShareable(t, m, new Set());
}

function notShareable(t: ShaderType, m: ModuleDecl, seen: Set<string>): string | undefined {
  switch (t.kind) {
    case 'scalar':
      return t.scalar === 'bool' ? 'a bool, which no buffer holds' : undefined;
    case 'vec':
      return t.elem === 'bool' ? 'a bool vector, which no buffer holds' : undefined;
    case 'mat':
      return undefined;
    case 'array':
      return t.size === undefined ? 'an array with no size' : notShareable(t.elem, m, seen);
    case 'struct': {
      if (seen.has(t.name)) return undefined;
      seen.add(t.name);
      const s = m.structs.find((x) => x.name === t.name);
      if (s === undefined) return `struct ${t.name}, which is not declared`;
      for (const fl of s.fields) {
        const why = notShareable(fl.type, m, seen);
        if (why !== undefined) return why;
      }
      return undefined;
    }
    default:
      return `a ${t.kind}, which the call does not pack yet`;
  }
}
