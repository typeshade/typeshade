import { consoleArgs, consoleTableRows, type ConsoleMethod } from '../console.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import type { SourceSpan } from '../ir/span.js';
import { parameterLocalsOf } from '../ir/parameter-locals.js';
import {
  type CpuValue,
  FIELD_IDX,
  isArr,
  applyBin,
  BUILTINS,
  GPU_STUBS,
  zeroOf,
  matVecShaped,
  matTransposeShaped,
  matColumn,
  matMulShaped,
  vecMatShaped,
  f32ToU32Sat,
  f32ToI32Sat,
  numKindOf,
  wrapValue,
  elemKindOf,
  convertComponent,
  convertComponents,
  atomicStep,
  compareValues,
  comparesAsF32,
  selectComponents,
  TYPED_BIT_BUILTINS,
  bitBuiltin,
  cloneValue,
  copiedParams,
  isAggregateType,
} from '../cpu-runtime.js';
import { barrierOutsideDispatch, isAtomicIntrinsic, isBarrierIntrinsic } from '../intrinsics.js';
import { kernelTree, reductionIdentity, ScatterRun } from '../kernel-tree.js';
import { fnWrites } from '../passes/effects.js';
import { treeCombine, type LoopReduction, type TreeLoop } from '../passes/parallel-loop.js';
import type { StepFrame, StepCtx, Step, Signal } from './interp/types.js';
import { rootName, whole, markStub } from './interp/stub-marks.js';
import { setSlot, setColumn } from './interp/memory-writes.js';
import { declaredTypes } from './interp/declared-types.js';
export type {
  StepFrame,
  StepEvent,
  StepCtx,
  WordMemory,
  JournalEntry,
  Step,
  Signal,
} from './interp/types.js';
const NORMAL: Signal = { kind: 'normal' };

const noValueFor = (name: string): Error =>
  new Error(
    `typeshade/debug: no value supplied for binding '${name}'; pass it in the session's bindings`,
  );

export function* evalExpr(e: Expr, env: Map<string, CpuValue>, ctx: StepCtx): Step<CpuValue> {
  switch (e.op) {
    case 'lit':
      return e.value;
    case 'constref': {
      const v = ctx.consts.get(e.name);
      if (v === undefined) throw new Error(`typeshade/debug: unknown const ${e.name}`);
      return v;
      // This arm once also resolved a BINDING named by a constref, because the front end
      // spelled a read of `declare const camera: uniform<Camera>` that way and the oracle
      // therefore threw `unknown const` on any source-compiled module with a binding. #18
      // (issue #14) changed the lowering to a `varref`, so that shape can no longer be built
      // by either surface, and the resolution moved to the `param`/`varref` case above. The
      // workaround is gone rather than kept: unreachable code that answers differently from
      // `oracle.ts` is a divergence nothing exercises, which is exactly what
      // `step-differential.test.ts` exists to prevent.
    }
    case 'overrideref': {
      const v = ctx.overrides.get(e.name);
      if (v === undefined) throw new Error(`typeshade/debug: unknown override ${e.name}`);
      return v;
    }
    case 'externref':
      throw new Error(`typeshade/debug: host-provided global '${e.name}' has no CPU value`);
    case 'param':
    case 'varref': {
      if (env.has(e.name)) {
        if (ctx.frames[ctx.frames.length - 1]?.stubbed.has(e.name)) ctx.stubHits++;
        return env.get(e.name) as CpuValue;
      }
      if (e.name in ctx.bindings) return ctx.bindings[e.name];
      if (e.name in ctx.privates) return ctx.privates[e.name];
      if (e.name in ctx.vars) return ctx.vars[e.name];
      if (ctx.bindingNames.has(e.name)) throw noValueFor(e.name);
      throw new Error(`typeshade/debug: unbound ${e.name}`);
    }
    case 'binop': {
      const av = yield* evalExpr(e.a, env, ctx);
      const bv = yield* evalExpr(e.b, env, ctx);
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
      if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat') {
        return vecMatShaped(av as number[], bv as number[], e.b.type.cols, e.b.type.rows);
      }
      return applyBin(e.bop, av, bv, numKindOf(e.type));
    }
    case 'unop': {
      const a = yield* evalExpr(e.a, env, ctx);
      return wrapValue(isArr(a) ? a.map((v) => -(v as number)) : -(a as number), numKindOf(e.type));
    }
    case 'compare': {
      const a = yield* evalExpr(e.a, env, ctx);
      const b = yield* evalExpr(e.b, env, ctx);
      return compareValues(e.cop, a, b, comparesAsF32(e.a.type));
    }
    case 'logical': {
      const a = (yield* evalExpr(e.a, env, ctx)) as boolean;
      if (e.lop === '&&') return a ? ((yield* evalExpr(e.b, env, ctx)) as boolean) : false;
      return a ? true : ((yield* evalExpr(e.b, env, ctx)) as boolean);
    }
    case 'call': {
      if (e.declRef === undefined && isBarrierIntrinsic(e.fn)) {
        if (!ctx.lockstep) throw barrierOutsideDispatch(e.fn);
        return 0;
      }
      if (e.declRef === undefined && isAtomicIntrinsic(e.fn)) return yield* evalAtomic(e, env, ctx);
      if (
        e.declRef === undefined &&
        ctx.words !== undefined &&
        (e.fn === '_phLoad' || e.fn === '_phStore')
      ) {
        const root = (yield* evalExpr(e.args[0]!, env, ctx)) as number;
        const word = (yield* evalExpr(e.args[1]!, env, ctx)) as number;
        if (e.fn === '_phLoad') return ctx.words.load(root, word);
        ctx.words.store(root, word, (yield* evalExpr(e.args[2]!, env, ctx)) as number);
        return undefined as unknown as CpuValue;
      }
      const args: CpuValue[] = [];
      const argStubbed: boolean[] = [];
      // Why: an `inout` argument that is a field or an element is resolved once, read there and
      // written back there, as the oracle's `storeBack` does (Rule 8.25).
      const inoutOf = ctx.decls.get(e.fn)?.params;
      const places: ({ readonly set: (v: CpuValue) => void } | undefined)[] = [];
      for (const [i, a] of e.args.entries()) {
        const before = ctx.stubHits;
        if (inoutOf?.[i]?.mode === 'inout' && (a.op === 'member' || a.op === 'index')) {
          const place = yield* refOf(a, env, ctx);
          places[i] = place;
          args.push(place.get());
        } else args.push(yield* evalExpr(a, env, ctx));
        argStubbed.push(ctx.stubHits > before);
      }
      if (e.declRef === undefined && e.fn.startsWith('console.')) {
        ctx.consoleSink?.({
          method: e.fn.slice('console.'.length) as ConsoleMethod,
          args: consoleArgs(
            args,
            e.labels,
            consoleTableRows(
              e.fn.slice('console.'.length),
              e.args.map((a) => a.type),
            ),
          ),
          ...(e.span ? { span: e.span } : {}),
          ...(ctx.invocation ? { invocation: ctx.invocation } : {}),
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
      const declared = e.declRef !== undefined ? ctx.decls.get(e.fn) : undefined;
      const b = declared === undefined ? BUILTINS[e.fn] : undefined;
      if (b) return wrapValue(b(...args), numKindOf(e.type));
      const stub = declared === undefined ? GPU_STUBS[e.fn] : undefined;
      if (stub) {
        if (!ctx.gpuStubs) {
          throw new Error(
            `typeshade/debug: '${e.fn}' is GPU-only and not computable here; start the session with gpuStubs: true to accept placeholder values`,
          );
        }
        ctx.stubbed.add(e.fn);
        ctx.stubHits++;
        return stub(...args);
      }
      const decl = declared ?? ctx.decls.get(e.fn);
      if (decl) {
        if (!decl.params.some((p) => p.mode === 'inout')) {
          return yield* callFunction(decl, args, e.span, ctx, argStubbed);
        }
        const returned: CpuValue[] = [];
        const value = yield* callFunction(decl, args, e.span, ctx, argStubbed, returned);
        for (const [i, p] of decl.params.entries()) {
          const arg = e.args[i];
          if (p.mode !== 'inout' || arg === undefined) continue;
          if (arg.op === 'varref' || arg.op === 'param') {
            yield* setLValue(arg, returned[i] as CpuValue, env, ctx);
          } else places[i]?.set(returned[i] as CpuValue);
        }
        return value;
      }
      throw new Error(`typeshade/debug: unknown fn ${e.fn}`);
    }
    case 'member': {
      const base = yield* evalExpr(e.base, env, ctx);
      if (isArr(base)) {
        if (e.field.length > 1) return [...e.field].map((c) => base[FIELD_IDX[c]!] as number);
        return base[FIELD_IDX[e.field]] as CpuValue;
      }
      return (base as Record<string, CpuValue>)[e.field];
    }
    case 'construct': {
      if (e.type.kind === 'array') {
        const out: CpuValue[] = [];
        for (const a of e.args) out.push(yield* evalExpr(a, env, ctx));
        return out as CpuValue;
      }
      if (e.type.kind === 'struct') {
        const decl = ctx.structs.get(e.type.name);
        if (decl === undefined)
          throw new Error(`typeshade/debug: struct '${e.type.name}' not declared`);
        const obj: Record<string, CpuValue> = {};
        for (let i = 0; i < decl.fields.length; i++) {
          obj[decl.fields[i]!.name] = yield* evalExpr(e.args[i]!, env, ctx);
        }
        return obj as CpuValue;
      }
      const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
      const out: number[] = [];
      for (const a of e.args) {
        const v = yield* evalExpr(a, env, ctx);
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
      const c = yield* evalExpr(e.cond, env, ctx);
      if (isArr(c)) {
        const t = yield* evalExpr(e.ifTrue, env, ctx);
        const f = yield* evalExpr(e.ifFalse, env, ctx);
        return selectComponents(c, t, f);
      }
      return c ? yield* evalExpr(e.ifTrue, env, ctx) : yield* evalExpr(e.ifFalse, env, ctx);
    }
    case 'index': {
      const base = (yield* evalExpr(e.base, env, ctx)) as CpuValue[];
      const idx = (yield* evalExpr(e.idx, env, ctx)) as number;
      if (e.base.type.kind === 'mat') return matColumn(base as number[], idx, e.base.type.rows);
      return base[idx];
    }
    case 'matchExpr': {
      const sv = (yield* evalExpr(e.scrutinee, env, ctx)) as number;
      const hit = e.cases.find(([v]) => v === sv);
      return yield* evalExpr(hit ? hit[1] : e.default, env, ctx);
    }
  }
}

export function* callFunction(
  decl: FuncDecl,
  args: readonly CpuValue[],
  callSpan: SourceSpan | undefined,
  ctx: StepCtx,
  stubbedArgs?: readonly boolean[],
  returned?: CpuValue[],
): Step<CpuValue> {
  const r = yield* runFunction(decl, args, callSpan, ctx, stubbedArgs, returned);
  const caller = ctx.frames[ctx.frames.length - 1];
  if (caller?.current) yield { stmt: caller.current, frames: ctx.frames, afterCall: true };
  return r.kind === 'return' ? (r.value as CpuValue) : (undefined as unknown as CpuValue);
}

export function* runFunction(
  decl: FuncDecl,
  args: readonly CpuValue[],
  callSpan: SourceSpan | undefined,
  ctx: StepCtx,
  stubbedArgs?: readonly boolean[],
  returned?: CpuValue[],
): Step<Signal> {
  const env = new Map<string, CpuValue>();
  const copies = ctx.copies.get(decl.name);
  decl.params.forEach((p, i) =>
    env.set(p.name, copies?.[i] === true ? cloneValue(args[i]!) : (args[i] as CpuValue)),
  );
  const frame: StepFrame = {
    fnName: decl.name,
    fnSpan: decl.span,
    callSpan,
    env,
    types: declaredTypes(decl),
    parameterLocals: parameterLocalsOf(decl),
    stubbed: new Set(decl.params.filter((_, i) => stubbedArgs?.[i]).map((p) => p.name)),
    current: undefined,
  };
  ctx.frames.push(frame);
  try {
    const signal = yield* execBody(decl.body, env, ctx);
    if (returned !== undefined) decl.params.forEach((p, i) => (returned[i] = env.get(p.name)!));
    return signal;
  } finally {
    ctx.frames.pop();
  }
}

function isMemoryRoot(root: string | undefined, env: Map<string, CpuValue>, ctx: StepCtx): boolean {
  return (
    root !== undefined &&
    !env.has(root) &&
    !(root in ctx.privates) &&
    (root in ctx.bindings || root in ctx.vars)
  );
}

function* refOf(
  target: Expr,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<{ readonly get: () => CpuValue; readonly set: (v: CpuValue) => void }> {
  if (target.op === 'varref' || target.op === 'param') {
    const name = target.name;
    if (env.has(name))
      return { get: () => env.get(name) as CpuValue, set: (v) => env.set(name, v) };
    for (const table of [ctx.privates, ctx.vars, ctx.bindings]) {
      if (name in table) {
        return {
          get: () => table[name] as CpuValue,
          set: (v) => setSlot(table, name, v, ctx, table !== ctx.privates),
        };
      }
    }
    if (ctx.bindingNames.has(name)) throw noValueFor(name);
    throw new Error(`typeshade/debug: unbound ${name}`);
  }
  if (target.op === 'member') {
    const base = yield* evalExpr(target.base, env, ctx);
    const key: string | number = isArr(base) ? FIELD_IDX[target.field]! : target.field;
    const obj = base as unknown as Record<string | number, CpuValue>;
    const logged = isMemoryRoot(rootName(target), env, ctx);
    return {
      get: () => obj[key] as CpuValue,
      set: (v) => setSlot(obj, key, v, ctx, logged),
    };
  }
  if (target.op === 'index') {
    const base = (yield* evalExpr(target.base, env, ctx)) as CpuValue[];
    const i = (yield* evalExpr(target.idx, env, ctx)) as number;
    const logged = isMemoryRoot(rootName(target), env, ctx);
    if (target.base.type.kind === 'mat') {
      const rows = target.base.type.rows;
      return {
        get: () => matColumn(base as number[], i, rows),
        set: (v) => setColumn(base as number[], i, rows, v as number[], ctx, logged),
      };
    }
    const slots = base as unknown as Record<number, CpuValue>;
    return {
      get: () => base[i] as CpuValue,
      set: (v) => setSlot(slots, i, v, ctx, logged),
    };
  }
  throw new Error(`typeshade/debug: bad atomic location ${target.op}`);
}

function* evalAtomic(
  e: Extract<Expr, { op: 'call' }>,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<CpuValue> {
  const loc = e.args[0];
  if (loc === undefined) throw new Error(`typeshade/debug: ${e.fn} needs a location`);
  const ref = yield* refOf(loc, env, ctx);
  const arg = e.args[1] === undefined ? 0 : ((yield* evalExpr(e.args[1], env, ctx)) as number);
  const store =
    e.args[2] === undefined ? undefined : ((yield* evalExpr(e.args[2], env, ctx)) as number);
  const at = ctx.frames.at(-1)?.current;
  if (ctx.lockstep && at !== undefined) yield { stmt: at, frames: ctx.frames, atomic: 'before' };
  const step = atomicStep(e.fn, ref.get() as number, arg, numKindOf(loc.type), store);
  if (e.fn !== 'atomicLoad') ref.set(step.next);
  if (ctx.lockstep && at !== undefined) yield { stmt: at, frames: ctx.frames, atomic: 'after' };
  return step.result;
}

function* setLValue(
  target: Expr,
  value: CpuValue,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<void> {
  if (target.op === 'varref' || target.op === 'param') {
    if (!env.has(target.name)) {
      for (const table of [ctx.privates, ctx.vars, ctx.bindings]) {
        if (target.name in table) {
          setSlot(table, target.name, value, ctx, table !== ctx.privates);
          return;
        }
      }
    }
    env.set(target.name, value);
    return;
  }
  if (target.op === 'member') {
    const base = yield* evalExpr(target.base, env, ctx);
    const logged = isMemoryRoot(rootName(target), env, ctx);
    if (isArr(base)) {
      setSlot(
        base as unknown as Record<number, CpuValue>,
        FIELD_IDX[target.field]!,
        value,
        ctx,
        logged,
      );
    } else setSlot(base as Record<string, CpuValue>, target.field, value, ctx, logged);
    return;
  }
  if (target.op === 'index') {
    const base = (yield* evalExpr(target.base, env, ctx)) as CpuValue[];
    const idx = (yield* evalExpr(target.idx, env, ctx)) as number;
    const logged = isMemoryRoot(rootName(target), env, ctx);
    if (target.base.type.kind === 'mat') {
      setColumn(base as number[], idx, target.base.type.rows, value as number[], ctx, logged);
      return;
    }
    setSlot(base as unknown as Record<number, CpuValue>, idx, value, ctx, logged);
    return;
  }
  throw new Error(`typeshade/debug: bad assignment target ${target.op}`);
}

function bindValue(v: CpuValue, t: ShaderType): CpuValue {
  return isAggregateType(t) ? cloneValue(v) : v;
}

export function* execBody(
  body: readonly Stmt[],
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<Signal> {
  const frame = ctx.frames[ctx.frames.length - 1];
  for (const s of body) {
    if (frame) frame.current = s;
    yield { stmt: s, frames: ctx.frames };
    switch (s.s) {
      case 'let': {
        const before = ctx.stubHits;
        env.set(s.name, bindValue(yield* evalExpr(s.expr, env, ctx), s.expr.type));
        markStub(frame, s.name, ctx.stubHits > before, true);
        break;
      }
      case 'var': {
        const before = ctx.stubHits;
        env.set(
          s.name,
          s.init
            ? bindValue(yield* evalExpr(s.init, env, ctx), s.type)
            : zeroOf(s.type, ctx.structs, ctx.overrides),
        );
        markStub(frame, s.name, ctx.stubHits > before, true);
        break;
      }
      case 'assign': {
        const before = ctx.stubHits;
        const value = bindValue(yield* evalExpr(s.expr, env, ctx), s.expr.type);
        yield* setLValue(s.target, value, env, ctx);
        markStub(frame, rootName(s.target), ctx.stubHits > before, whole(s.target));
        break;
      }
      case 'assignOp': {
        const before = ctx.stubHits;
        const cur = yield* evalExpr(s.target, env, ctx);
        const kind = numKindOf(s.target.type);
        const rhs = yield* evalExpr(s.expr, env, ctx);
        yield* setLValue(s.target, applyBin(s.bop, cur, rhs, kind), env, ctx);
        markStub(frame, rootName(s.target), ctx.stubHits > before, whole(s.target));
        break;
      }
      case 'return':
        return { kind: 'return', value: s.expr ? yield* evalExpr(s.expr, env, ctx) : undefined };
      case 'break':
        return { kind: 'break' };
      case 'continue':
        return { kind: 'continue' };
      case 'discard':
        return { kind: 'discard' };
      case 'call':
        yield* evalExpr(s.expr, env, ctx);
        break;
      case 'if': {
        let taken = false;
        for (const arm of s.arms) {
          if (yield* evalExpr(arm.cond, env, ctx)) {
            const r = yield* execBody(arm.body, env, ctx);
            if (r.kind !== 'normal') return r;
            taken = true;
            break;
          }
        }
        if (!taken && s.elseBody) {
          const r = yield* execBody(s.elseBody, env, ctx);
          if (r.kind !== 'normal') return r;
        }
        break;
      }
      case 'for': {
        const tree = ctx.trees?.get(s);
        if (tree !== undefined) {
          const r = yield* execTreeFor(s, tree, env, ctx);
          if (r !== undefined) return r;
          break;
        }
        yield* execBody([s.init], env, ctx);
        while (yield* evalExpr(s.cond, env, ctx)) {
          const r = yield* execBody(s.body, env, ctx);
          if (r.kind === 'break') break;
          if (r.kind === 'return' || r.kind === 'discard') return r;
          yield* execBody([s.update], env, ctx);
        }
        break;
      }
      case 'switch': {
        const v = (yield* evalExpr(s.scrut, env, ctx)) as number;
        const hit = s.cases.find((c) => c.values.includes(v));
        const chosen = hit ? hit.body : s.defaultBody;
        if (chosen) {
          const r = yield* execBody(chosen, env, ctx);
          if (r.kind !== 'normal' && r.kind !== 'break') return r;
        }
        break;
      }
      case 'placeholder':
        throw new Error(
          `typeshade/debug: placeholder Stmt reached the stepping backend; composer forgot to splice tag=${s.tag}`,
        );
      case 'raw':
        throw new Error(
          'typeshade/debug: raw Stmt reached the stepping backend; raw passthrough is GPU-only',
        );
    }
  }
  return NORMAL;
}

function* execTreeFor(
  s: Stmt & { s: 'for' },
  loop: TreeLoop,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<Signal | undefined> {
  const { reductions } = loop;
  const saved = reductions.map((r) => env.get(r.name) as CpuValue);
  const bags = reductions.map((): CpuValue[] => []);
  const identity = (r: LoopReduction) => (): CpuValue => reductionIdentity(r.op, r.type);
  const combine = (r: LoopReduction) => {
    const e = treeCombine(r, ctx.f32 ?? false);
    return (a: CpuValue, b: CpuValue): CpuValue =>
      drain(
        evalExpr(
          e,
          new Map([
            ['$ta', a],
            ['$tb', b],
          ]),
          ctx,
        ),
      );
  };
  const scatter = loop.scatters;
  const arrays = scatter.map((n) => env.get(n) as number[]);
  const run = scatter.length === 0 ? undefined : new ScatterRun(arrays, ctx.f32 ?? false);
  scatter.forEach((n, j) => env.set(n, run!.view(j)));
  const leave = (): void => {
    if (run === undefined) return;
    run.finish();
    scatter.forEach((n, j) => env.set(n, run.real(j)));
  };
  yield* execBody([s.init], env, ctx);
  while (yield* evalExpr(s.cond, env, ctx)) {
    reductions.forEach((r) => env.set(r.name, identity(r)()));
    const res = yield* execBody(s.body, env, ctx);
    reductions.forEach((r, k) => bags[k]!.push(env.get(r.name) as CpuValue));
    run?.end();
    if (res.kind === 'return' || res.kind === 'discard') {
      leave();
      return res;
    }
    yield* execBody([s.update], env, ctx);
  }
  reductions.forEach((r, k) => {
    const c = combine(r);
    const folded = kernelTree(bags[k]!, c, identity(r));
    env.set(r.name, folded === undefined ? saved[k]! : c(saved[k]!, folded));
  });
  leave();
  return undefined;
}

export function makeCtx(
  m: ModuleDecl,
  gpuStubs: boolean,
  selectedOverrides?: Readonly<Record<string, CpuValue>>,
): StepCtx {
  const writes = fnWrites(m);
  const overrides = new Map<string, CpuValue>((m.overrides ?? []).map((o) => [o.name, o.default]));
  for (const [name, value] of Object.entries(selectedOverrides ?? {})) overrides.set(name, value);
  const ctx: StepCtx = {
    consts: new Map<string, CpuValue>(),
    overrides,
    decls: new Map(m.funcs.map((f) => [f.name, f])),
    copies: new Map(
      m.funcs.map((f) => [f.name, copiedParams(f.params, (writes.get(f.name)?.size ?? 0) > 0)]),
    ),
    bindings: {},
    vars: {},
    privates: {},
    lockstep: false,
    structs: new Map(m.structs.map((s) => [s.name, s])),
    bindingNames: new Set(m.bindings.map((b) => b.name)),
    gpuStubs,
    stubHits: 0,
    frames: [],
    stubbed: new Set<string>(),
  };
  for (const c of m.consts) {
    ctx.consts.set(c.name, c.valueExpr ? drain(evalExpr(c.valueExpr, new Map(), ctx)) : c.cpuValue);
  }
  for (const v of m.vars ?? []) {
    if (v.space === 'private') {
      ctx.privates[v.name] = v.init
        ? drain(evalExpr(v.init, new Map(), ctx))
        : zeroOf(v.type, ctx.structs, ctx.overrides);
    } else {
      ctx.vars[v.name] = zeroOf(v.type, ctx.structs, ctx.overrides);
    }
  }
  return ctx;
}

export function drain<T>(g: Step<T>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
