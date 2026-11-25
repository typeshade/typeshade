// Why: this oracle is an f64 ALGEBRA oracle, not an f32-precision oracle. Its f32 mode rounds per
// operation but is not an f32 hardware oracle; the GPU gates hold the f32 half of the contract.

import type { Expr, Stmt, ModuleDecl, StructDecl, ShaderType, FuncDecl } from './ir/index.js';
import { validate } from './passes/validate.js';
import { autoVars } from './passes/opt/index.js';
import { froundF32 } from './passes/precision.js';
import {
  treeCombine,
  treeLoops,
  type LoopReduction,
  type TreeLoop,
} from './passes/parallel-loop.js';
import { kernelTree, reductionIdentity, ScatterRun } from './kernel-tree.js';
import { cpuTextureCall } from './cpu-texture.js';
import {
  type CpuValue,
  FIELD_IDX,
  isArr,
  applyBin,
  BUILTINS,
  GPU_STUBS,
  zeroOf,
  f32ToU32Sat,
  f32ToI32Sat,
  numKindOf,
  wrapValue,
  cloneValue,
  copiedParams,
  inoutReturn,
  isAggregateType,
  convertComponent,
  convertComponents,
  elemKindOf,
  atomicStep,
  compareValues,
  comparesAsF32,
  selectComponents,
  TYPED_BIT_BUILTINS,
  bitBuiltin,
  matTransposeShaped,
  matColumn,
  setMatColumn,
  matVecShaped,
  vecMatShaped,
  matMulShaped,
} from './cpu-runtime.js';
import { barrierOutsideDispatch, isAtomicIntrinsic, isBarrierIntrinsic } from './intrinsics.js';
import { fnWrites } from './passes/effects.js';
import { consoleArgs, consoleTableRows, type ConsoleMethod, type ConsoleSink } from './console.js';
import { dispatchCompute, type WorkgroupCount } from './debug/dispatch.js';

export type { CpuValue, CpuStruct } from './cpu-runtime.js';
export type { WorkgroupCount } from './debug/dispatch.js';
export { ORACLE_BUILTIN_NAMES, ORACLE_GPU_STUB_NAMES } from './cpu-runtime.js';

interface Ctx {
  consts: Map<string, CpuValue>;
  overrides: Map<string, CpuValue>;
  fns: Record<string, (...args: CpuValue[]) => CpuValue>;
  params: Map<string, FuncDecl['params']>;
  bindings: Record<string, CpuValue>;
  vars: Record<string, CpuValue>;
  structs: Map<string, StructDecl>;
  gpuStubs: boolean;
  consoleSink?: ConsoleSink;
  trees?: ReadonlyMap<Stmt, TreeLoop>;
  f32?: boolean;
}

/** The shape both CPU backends return, so a caller can compile with {@link compileModuleJs}
 *  and fall back to {@link compileModule} without touching call sites (for example when the
 *  host forbids `new Function` under a Content Security Policy). `fns` is a table of the
 *  module's declared functions by name, each taking its parameters positionally in declaration
 *  order. `setBinding` supplies a storage or uniform binding's value before a function that
 *  reads it runs. The two backends return the same value for the same call:
 *  `compileModuleJs(m).fns.f(args)` and `compileModule(m).fns.f(args)` agree under `Object.is`,
 *  element for element.
 *
 *  Exported from `typeshade`.
 */
export interface CpuModule {
  /** The module's declared functions by name. Parameters are positional, in declaration
   *  order; the return value is the function's result as a {@link CpuValue}. */
  fns: Record<string, (...args: CpuValue[]) => CpuValue>;
  /** Supply a storage or uniform binding's value by its declared name, before invoking a
   *  function that reads it. */
  setBinding(name: string, value: CpuValue): void;
  /** Run a `@compute` entry over `workgroups` workgroups of its declared size (one number for
   *  a 1-D grid, or the three counts), every invocation of a workgroup in lockstep at each
   *  `workgroupBarrier()` / `storageBarrier()`, with the builtin parameters
   *  (`global_invocation_id`, `local_invocation_id`, `local_invocation_index`, `workgroup_id`,
   *  `num_workgroups`) filled in (roadmap 0.2 item 5). Workgroup memory starts zero for each
   *  workgroup and a per-invocation variable at its initializer for each invocation; the
   *  bindings are the ones {@link setBinding} supplied, arrays written in place. Throws when the
   *  invocations of one workgroup disagree about a barrier, naming its line and the counts.
   *  A kernel with no barrier may also be run one invocation at a time through {@link fns}. */
  dispatch(entry: string, workgroups: WorkgroupCount): DispatchReport;
}

/** What a {@link CpuModule.dispatch} ran: the workgroups, the invocations across them, and
 *  how many barrier phases the invocations of each workgroup went through in total.
 *
 *  Exported from `typeshade`.
 */
export interface DispatchReport {
  readonly workgroups: number;
  readonly invocations: number;
  readonly barrierPhases: number;
}

function evalExpr(e: Expr, env: Map<string, CpuValue>, ctx: Ctx): CpuValue {
  switch (e.op) {
    case 'lit':
      return e.value;
    case 'constref': {
      const v = ctx.consts.get(e.name);
      if (v === undefined) throw new Error(`typeshade/cpu: unknown const ${e.name}`);
      return v;
    }
    case 'overrideref': {
      const v = ctx.overrides.get(e.name);
      if (v === undefined) throw new Error(`typeshade/cpu: unknown override ${e.name}`);
      return v;
    }
    case 'externref':
      throw new Error(`typeshade/cpu: host-provided global '${e.name}' has no CPU value`);
    case 'param':
    case 'varref': {
      if (env.has(e.name)) return env.get(e.name) as CpuValue;
      if (e.name in ctx.bindings) return ctx.bindings[e.name];
      if (e.name in ctx.vars) return ctx.vars[e.name];
      throw new Error(`typeshade/cpu: unbound ${e.name}`);
    }
    case 'binop': {
      const av = evalExpr(e.a, env, ctx),
        bv = evalExpr(e.b, env, ctx);
      if (
        e.bop === '*' &&
        e.a.type.kind === 'mat' &&
        (e.b.type.kind === 'vec' || e.b.type.kind === 'vec64')
      ) {
        return matVecShaped(av as number[], bv as number[], e.a.type.cols, e.a.type.rows);
      }
      if (e.bop === '*' && e.a.type.kind === 'mat' && e.b.type.kind === 'mat') {
        return matMulShaped(
          av as number[],
          bv as number[],
          e.a.type.cols,
          e.a.type.rows,
          e.b.type.cols,
        );
      }
      // Why: a row vector times a matrix is `transpose(m) * v` (wgsl.txt:9960-9995).
      if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat') {
        return vecMatShaped(av as number[], bv as number[], e.b.type.cols, e.b.type.rows);
      }
      return applyBin(e.bop, av, bv, numKindOf(e.type));
    }
    case 'unop': {
      const a = evalExpr(e.a, env, ctx);
      return wrapValue(isArr(a) ? a.map((v) => -(v as number)) : -(a as number), numKindOf(e.type));
    }
    case 'compare': {
      return compareValues(
        e.cop,
        evalExpr(e.a, env, ctx),
        evalExpr(e.b, env, ctx),
        comparesAsF32(e.a.type),
      );
    }
    // eslint-disable-next-line no-fallthrough
    case 'logical': {
      const a = evalExpr(e.a, env, ctx) as boolean;
      if (e.lop === '&&') return a ? (evalExpr(e.b, env, ctx) as boolean) : false;
      return a ? true : (evalExpr(e.b, env, ctx) as boolean);
    }
    case 'call': {
      if (e.declRef === undefined && isBarrierIntrinsic(e.fn)) throw barrierOutsideDispatch(e.fn);
      if (e.declRef === undefined && isAtomicIntrinsic(e.fn)) return evalAtomic(e, env, ctx);
      // Implements: Rule 8.25
      const params = ctx.params.get(e.fn);
      const places: (Place | undefined)[] = [];
      const args = e.args.map((a, i) => {
        if (params?.[i]?.mode === 'inout' && (a.op === 'member' || a.op === 'index')) {
          const place = refOf(a, env, ctx);
          places[i] = place;
          return place.get();
        }
        return evalExpr(a, env, ctx);
      });
      if (e.declRef === undefined && e.fn.startsWith('console.')) {
        const method = e.fn.slice('console.'.length);
        if (ctx.consoleSink)
          ctx.consoleSink({
            method: method as ConsoleMethod,
            args: consoleArgs(
              args,
              e.labels,
              consoleTableRows(
                method,
                e.args.map((a) => a.type),
              ),
            ),
            span: e.span,
          });
        return undefined as unknown as CpuValue;
      }
      if (e.fn === 'u32' || e.fn === 'i32') {
        const src = e.args[0]!.type;
        if (src.kind === 'f64' || (src.kind === 'scalar' && src.scalar === 'f32')) {
          return e.fn === 'u32' ? f32ToU32Sat(args[0] as number) : f32ToI32Sat(args[0] as number);
        }
      }
      if (e.declRef === undefined && e.fn === 'transpose') {
        const t = e.args[0]!.type;
        if (t.kind === 'mat') return matTransposeShaped(args[0] as number[], t.cols, t.rows);
      }
      if (e.declRef === undefined && TYPED_BIT_BUILTINS.has(e.fn)) {
        return bitBuiltin(e.fn, args, elemKindOf(e.args[0]!.type) === 'i32' ? 'i32' : 'u32');
      }
      if (e.declRef !== undefined) {
        const declared = ctx.fns[e.fn];
        if (declared) return storeBack(e, declared(...args), env, ctx, places);
      }
      const b = BUILTINS[e.fn];
      if (b) return wrapValue(b(...args), numKindOf(e.type));
      const stub = GPU_STUBS[e.fn];
      if (stub) {
        const real = cpuTextureCall(e.fn, args);
        if (real !== undefined) return real;
        if (!ctx.gpuStubs) {
          throw new Error(
            `typeshade/cpu: '${e.fn}' is not supported yet on the CPU tier (Rule 8.24); pass compileModule(m, { gpuStubs: true }) to accept placeholder values (X-GIS #763 O3)`,
          );
        }
        return stub(...args);
      }
      const user = ctx.fns[e.fn];
      if (user) return storeBack(e, user(...args), env, ctx, places);
      throw new Error(`typeshade/cpu: unknown fn ${e.fn}`);
    }
    case 'member': {
      const base = evalExpr(e.base, env, ctx);
      if (isArr(base)) {
        if (e.field.length > 1) return [...e.field].map((c) => base[FIELD_IDX[c]!] as number);
        return base[FIELD_IDX[e.field]] as CpuValue;
      }
      return (base as Record<string, CpuValue>)[e.field];
    }
    case 'construct': {
      if (e.type.kind === 'array') return e.args.map((a) => evalExpr(a, env, ctx)) as CpuValue;
      if (e.type.kind === 'struct') {
        const decl = ctx.structs.get(e.type.name);
        if (decl === undefined) throw new Error(`oracle: struct '${e.type.name}' not declared`);
        const obj: Record<string, CpuValue> = {};
        decl.fields.forEach((f, i) => {
          obj[f.name] = evalExpr(e.args[i]!, env, ctx);
        });
        return obj as CpuValue;
      }
      const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
      const out: number[] = [];
      for (const a of e.args) {
        const v = evalExpr(a, env, ctx);
        const from = elemKindOf(a.type);
        if (elem === undefined || from === undefined) {
          if (isArr(v)) out.push(...(v as number[]));
          else out.push(v as number);
          continue;
        }
        if (isArr(v)) out.push(...convertComponents(v as number[], from, elem));
        else out.push(convertComponent(v as number, from, elem));
      }
      if ((e.type.kind === 'vec' || e.type.kind === 'vec64') && out.length === 1)
        return new Array(e.type.n as number).fill(out[0]);
      return out;
    }
    case 'select': {
      const c = evalExpr(e.cond, env, ctx);
      if (isArr(c)) {
        return selectComponents(c, evalExpr(e.ifTrue, env, ctx), evalExpr(e.ifFalse, env, ctx));
      }
      return c ? evalExpr(e.ifTrue, env, ctx) : evalExpr(e.ifFalse, env, ctx);
    }
    case 'index': {
      const base = evalExpr(e.base, env, ctx) as CpuValue[];
      const i = evalExpr(e.idx, env, ctx) as number;
      if (e.base.type.kind === 'mat') return matColumn(base as number[], i, e.base.type.rows);
      return base[i];
    }
    case 'matchExpr': {
      const sv = evalExpr(e.scrutinee, env, ctx) as number;
      const hit = e.cases.find(([v]) => v === sv);
      return evalExpr(hit ? hit[1] : e.default, env, ctx);
    }
  }
}

function refOf(target: Expr, env: Map<string, CpuValue>, ctx: Ctx): Place {
  if (target.op === 'varref' || target.op === 'param') {
    const name = target.name;
    if (env.has(name))
      return { get: () => env.get(name) as CpuValue, set: (v) => env.set(name, v) };
    if (name in ctx.vars) {
      return {
        get: () => ctx.vars[name] as CpuValue,
        set: (v) => {
          ctx.vars[name] = v;
        },
      };
    }
    if (name in ctx.bindings) {
      return {
        get: () => ctx.bindings[name] as CpuValue,
        set: (v) => {
          ctx.bindings[name] = v;
        },
      };
    }
    throw new Error(`typeshade/cpu: unbound ${name}`);
  }
  if (target.op === 'member') {
    const base = evalExpr(target.base, env, ctx);
    const key: string | number = isArr(base) ? FIELD_IDX[target.field]! : target.field;
    const obj = base as unknown as Record<string | number, CpuValue>;
    return {
      get: () => obj[key] as CpuValue,
      set: (v) => {
        obj[key] = v;
      },
    };
  }
  if (target.op === 'index') {
    const base = evalExpr(target.base, env, ctx) as CpuValue[];
    const i = evalExpr(target.idx, env, ctx) as number;
    if (target.base.type.kind === 'mat') {
      const rows = target.base.type.rows;
      return {
        get: () => matColumn(base as number[], i, rows),
        set: (v) => setMatColumn(base as number[], i, rows, v as number[]),
      };
    }
    return {
      get: () => base[i] as CpuValue,
      set: (v) => {
        base[i] = v;
      },
    };
  }
  throw new Error(`typeshade/cpu: bad atomic location ${target.op}`);
}

function evalAtomic(
  e: Extract<Expr, { op: 'call' }>,
  env: Map<string, CpuValue>,
  ctx: Ctx,
): CpuValue {
  const loc = e.args[0];
  if (loc === undefined) throw new Error(`typeshade/cpu: ${e.fn} needs a location`);
  const ref = refOf(loc, env, ctx);
  const arg = e.args[1] === undefined ? 0 : (evalExpr(e.args[1], env, ctx) as number);
  const store = e.args[2] === undefined ? undefined : (evalExpr(e.args[2], env, ctx) as number);
  const step = atomicStep(e.fn, ref.get() as number, arg, numKindOf(loc.type), store);
  if (e.fn !== 'atomicLoad') ref.set(step.next);
  return step.result;
}

type Place = { readonly get: () => CpuValue; readonly set: (v: CpuValue) => void };

function storeBack(
  call: Expr & { op: 'call' },
  value: CpuValue,
  env: Map<string, CpuValue>,
  ctx: Ctx,
  places: readonly (Place | undefined)[] = [],
): CpuValue {
  const params = ctx.params.get(call.fn);
  if (params === undefined || !params.some((p) => p.mode === 'inout')) return value;
  const out = inoutReturn.values;
  params.forEach((p, i) => {
    const arg = call.args[i];
    if (p.mode !== 'inout' || arg === undefined) return;
    if (arg.op === 'varref' || arg.op === 'param') setLValue(arg, out[i] as CpuValue, env, ctx);
    else places[i]?.set(out[i] as CpuValue);
  });
  return value;
}

function setLValue(target: Expr, value: CpuValue, env: Map<string, CpuValue>, ctx: Ctx): void {
  if (target.op === 'varref' || target.op === 'param') {
    if (!env.has(target.name)) {
      if (target.name in ctx.vars) {
        ctx.vars[target.name] = value;
        return;
      }
      if (target.name in ctx.bindings) {
        ctx.bindings[target.name] = value;
        return;
      }
    }
    env.set(target.name, value);
    return;
  }
  if (target.op === 'member') {
    const base = evalExpr(target.base, env, ctx);
    if (isArr(base)) base[FIELD_IDX[target.field]] = value as number;
    else (base as Record<string, CpuValue>)[target.field] = value;
    return;
  }
  if (target.op === 'index') {
    const base = evalExpr(target.base, env, ctx) as CpuValue[];
    const i = evalExpr(target.idx, env, ctx) as number;
    if (target.base.type.kind === 'mat') {
      setMatColumn(base as number[], i, target.base.type.rows, value as number[]);
      return;
    }
    base[i] = value;
    return;
  }
  throw new Error(`typeshade/cpu: bad assignment target ${target.op}`);
}

type Signal =
  | { kind: 'normal' }
  | { kind: 'return'; value: CpuValue | undefined }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'discard' };
const NORMAL: Signal = { kind: 'normal' };

// Why: one flat env per call matches WGSL block scoping only while a binding is reached through
// the Node b.let()/b.var()/forRange returns; a read of a binding by name would diverge from it.
function bindValue(v: CpuValue, t: ShaderType): CpuValue {
  return isAggregateType(t) ? cloneValue(v) : v;
}

function execTreeFor(
  s: Stmt & { s: 'for' },
  loop: TreeLoop,
  env: Map<string, CpuValue>,
  ctx: Ctx,
): Signal | undefined {
  const { reductions } = loop;
  const saved = reductions.map((r) => env.get(r.name) as CpuValue);
  const bags = reductions.map((): CpuValue[] => []);
  const identity = (r: LoopReduction) => (): CpuValue => reductionIdentity(r.op, r.type);
  const combine = (r: LoopReduction) => {
    const e = treeCombine(r, ctx.f32 ?? false);
    return (a: CpuValue, b: CpuValue): CpuValue =>
      evalExpr(
        e,
        new Map([
          ['$ta', a],
          ['$tb', b],
        ]),
        ctx,
      );
  };
  const scatter = loop.scatters.length > 0 ? loop.scatters : undefined;
  const run =
    scatter === undefined
      ? undefined
      : new ScatterRun(
          scatter.map((n) => env.get(n) as number[]),
          ctx.f32 ?? false,
        );
  const arrays = scatter?.map((n) => env.get(n));
  scatter?.forEach((n, j) => env.set(n, run!.view(j)));
  const leave = (): void => {
    if (run === undefined) return;
    run.finish();
    scatter!.forEach((n, j) => env.set(n, arrays![j]!));
  };
  execBody([s.init], env, ctx);
  while (evalExpr(s.cond, env, ctx)) {
    reductions.forEach((r) => env.set(r.name, identity(r)()));
    const res = execBody(s.body, env, ctx);
    reductions.forEach((r, k) => bags[k]!.push(env.get(r.name) as CpuValue));
    run?.end();
    if (res.kind === 'return' || res.kind === 'discard') {
      leave();
      return res;
    }
    execBody([s.update], env, ctx);
  }
  reductions.forEach((r, k) => {
    const c = combine(r);
    const folded = kernelTree(bags[k]!, c, identity(r));
    env.set(r.name, folded === undefined ? saved[k]! : c(saved[k]!, folded));
  });
  leave();
  return undefined;
}

function execBody(body: readonly Stmt[], env: Map<string, CpuValue>, ctx: Ctx): Signal {
  for (const s of body) {
    switch (s.s) {
      case 'let':
        env.set(s.name, bindValue(evalExpr(s.expr, env, ctx), s.expr.type));
        break;
      case 'var':
        env.set(
          s.name,
          s.init ? bindValue(evalExpr(s.init, env, ctx), s.type) : zeroOf(s.type, ctx.structs),
        );
        break;
      case 'assign':
        setLValue(s.target, bindValue(evalExpr(s.expr, env, ctx), s.expr.type), env, ctx);
        break;
      case 'assignOp': {
        const cur = evalExpr(s.target, env, ctx);
        const kind = numKindOf(s.target.type);
        setLValue(s.target, applyBin(s.bop, cur, evalExpr(s.expr, env, ctx), kind), env, ctx);
        break;
      }
      case 'return':
        return { kind: 'return', value: s.expr ? evalExpr(s.expr, env, ctx) : undefined };
      case 'break':
        return { kind: 'break' };
      case 'continue':
        return { kind: 'continue' };
      case 'discard':
        return { kind: 'discard' };
      case 'call':
        evalExpr(s.expr, env, ctx);
        break;
      case 'if': {
        let taken = false;
        for (const arm of s.arms) {
          if (evalExpr(arm.cond, env, ctx)) {
            const r = execBody(arm.body, env, ctx);
            if (r.kind !== 'normal') return r;
            taken = true;
            break;
          }
        }
        if (!taken && s.elseBody) {
          const r = execBody(s.elseBody, env, ctx);
          if (r.kind !== 'normal') return r;
        }
        break;
      }
      case 'for': {
        const tree = ctx.trees?.get(s);
        if (tree !== undefined) {
          const r = execTreeFor(s, tree, env, ctx);
          if (r !== undefined) return r;
          break;
        }
        execBody([s.init], env, ctx);
        while (evalExpr(s.cond, env, ctx)) {
          const r = execBody(s.body, env, ctx);
          if (r.kind === 'break') break;
          if (r.kind === 'return' || r.kind === 'discard') return r;
          execBody([s.update], env, ctx);
        }
        break;
      }
      case 'switch': {
        const v = evalExpr(s.scrut, env, ctx) as number;
        const hit = s.cases.find((c) => c.values.includes(v));
        const chosen = hit ? hit.body : s.defaultBody;
        if (chosen) {
          const r = execBody(chosen, env, ctx);
          // Why: a `break` in a case body exits the SWITCH only, in WGSL and GLSL alike.
          if (r.kind !== 'normal' && r.kind !== 'break') return r;
        }
        break;
      }
      case 'placeholder': {
        throw new Error(
          `typeshade/cpu: placeholder Stmt reached CPU backend — composer forgot to splice tag=${s.tag}`,
        );
      }
      case 'raw': {
        throw new Error(
          'typeshade/cpu: raw Stmt reached CPU backend — raw passthrough is GPU-only',
        );
      }
    }
  }
  return NORMAL;
}

/** How the CPU backends evaluate f32 arithmetic.
 *
 *  - `'f64'` (default): every value is a JavaScript double, so the result is the mathematically
 *    intended one to 53 bits. This is the reference an implementation is checked against.
 *  - `'f32'`: a correctly rounding f32 machine over the same IR the GPU receives. Every
 *    f32-typed operation rounds to f32 after it is evaluated, with ±Infinity on overflow. Use
 *    it when the question is what the target computes, so a parity gate can compare at ulp
 *    scale without a tolerance wide enough to hide a real error.
 *
 *  Exported from `typeshade`.
 */
export type CpuPrecision = 'f64' | 'f32';

/** Compile a module for the CPU: a tree-walk interpreter over the same IR the GPU backends
 *  receive, returning a {@link CpuModule} whose `fns` are ordinary JavaScript functions. It is
 *  the differential reference a parity test compares a GPU result against.
 *
 *  `opts.precision` picks what the arithmetic means. `'f64'`, the default, is the algebra
 *  oracle: every value is a JavaScript double, so the result is the mathematically intended
 *  one to 53 bits. It proves the IR picked the right operations in the right order, and it is
 *  blind by construction to f32 rounding, which only appears once the target truncates.
 *  `'f32'` is a correctly-rounding f32 machine over the same IR: every f32-typed operation
 *  rounds to f32 afterwards, with infinities on overflow. Reach for `'f32'` when the question
 *  is what the target computes, so a parity gate can compare at ulp scale without a tolerance
 *  wide enough to hide a real error.
 *
 *  `opts.gpuStubs` decides what happens at an operation the CPU cannot perform. A texture
 *  read, a screen-space derivative and the rest of the GPU-only intrinsics have no CPU
 *  meaning, and by default a call to one throws, since a plausible wrong number is the worst
 *  failure mode for a reference. Turn it on and each stands in for its GPU value: an opaque
 *  black texture read, a zero derivative. Do that only where a placeholder is acceptable for
 *  the test at hand. A texture of the CPU tier's memory (`device.texture()` on a device with
 *  no WebGPU device, change 0077) is the exception: bound with `setBinding`, it is read by
 *  `textureLoad` and `textureDimensions` and written by `textureStore`, with or without
 *  `gpuStubs`, as `compileModuleJs` does.
 *
 *  `setBinding(name, value)` supplies a uniform or storage binding by its declared name, since
 *  a CPU run has no bind groups. Call it before invoking an entry that reads that binding.
 *
 *  A raw statement has no CPU evaluation at all. Reaching one throws, whichever target its
 *  payload was written for, because raw text is opaque to the IR and the oracle has nothing to
 *  walk.
 *
 *  It runs {@link validate} and {@link autoVars} first, the same passes the GPU writers run, so
 *  it rejects the same malformed modules they do.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to evaluate.
 *  @param opts - `precision` and `gpuStubs`, as above.
 *  @returns the compiled module: `fns` by name, and `setBinding`.
 *  @throws {@link ValidationError} when the module fails a core rule, and `Error` when a
 *    GPU-only intrinsic is called with `gpuStubs` off, or when a raw statement is reached.
 *
 *  @example
 *  ```ts
 *  import { compileModule } from 'typeshade'
 *
 *  const cpu = compileModule(MODULE, { precision: 'f32' })
 *  cpu.setBinding('u', { scale: 2, offset: [0.5, 0.5] })
 *  const got = cpu.fns.transform([1, 1])
 *  ```
 *
 *  @see {@link compileModuleJs} for the same results on a hot path.
 *  @see {@link CpuPrecision} for the two precision modes.
 */
export function compileModule(
  m: ModuleDecl,
  opts?: {
    gpuStubs?: boolean;
    precision?: CpuPrecision;
    consoleSink?: ConsoleSink;
    overrides?: Readonly<Record<string, CpuValue>>;
  },
): CpuModule {
  validate(m);
  m = autoVars(m);
  const unrounded = m;
  if (opts?.precision === 'f32') m = froundF32(m);
  const overrides = new Map<string, CpuValue>((m.overrides ?? []).map((o) => [o.name, o.default]));
  for (const [name, value] of Object.entries(opts?.overrides ?? {})) overrides.set(name, value);
  const ctx: Ctx = {
    consts: new Map<string, CpuValue>(),
    overrides,
    fns: {},
    params: new Map(m.funcs.map((f) => [f.name, f.params])),
    bindings: {},
    vars: {},
    structs: new Map(m.structs.map((s) => [s.name, s])),
    gpuStubs: opts?.gpuStubs ?? false,
    consoleSink: opts?.consoleSink,
    trees: treeLoops(unrounded, m),
    f32: opts?.precision === 'f32',
  };
  for (const c of m.consts) {
    ctx.consts.set(c.name, c.valueExpr ? evalExpr(c.valueExpr, new Map(), ctx) : c.cpuValue);
  }
  const vars = m.vars ?? [];
  for (const v of vars)
    if (v.space === 'workgroup') ctx.vars[v.name] = zeroOf(v.type, ctx.structs, ctx.overrides);
  const privates = vars.filter((v) => v.space === 'private');
  const initPrivates = (): void => {
    for (const v of privates) {
      ctx.vars[v.name] = v.init
        ? bindValue(evalExpr(v.init, new Map(), ctx), v.type)
        : zeroOf(v.type, ctx.structs, ctx.overrides);
    }
  };
  const writes = fnWrites(m);
  for (const f of m.funcs) {
    const copies = copiedParams(f.params, (writes.get(f.name)?.size ?? 0) > 0);
    const inout = f.params.some((p) => p.mode === 'inout');
    ctx.fns[f.name] = (...args: CpuValue[]): CpuValue => {
      const env = new Map<string, CpuValue>();
      f.params.forEach((p, i) => env.set(p.name, copies[i] ? cloneValue(args[i]!) : args[i]));
      const r = execBody(f.body, env, ctx);
      if (inout) inoutReturn.values = f.params.map((p) => env.get(p.name) as CpuValue);
      return r.kind === 'return' ? (r.value as CpuValue) : (undefined as unknown as CpuValue);
    };
  }
  let fns = ctx.fns;
  if (privates.length > 0) {
    fns = {};
    for (const f of m.funcs) {
      const inner = ctx.fns[f.name]!;
      fns[f.name] = (...args: CpuValue[]): CpuValue => {
        initPrivates();
        return inner(...args);
      };
    }
  }
  return {
    fns,
    setBinding: (name, value) => {
      ctx.bindings[name] = value;
    },
    dispatch: (entry, workgroups) => dispatchCompute(m, entry, workgroups, ctx.bindings, opts),
  };
}
