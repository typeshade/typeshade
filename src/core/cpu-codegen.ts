import type {
  Expr,
  Stmt,
  ModuleDecl,
  StructDecl,
  ShaderType,
  BinOp,
  CmpOp,
  FuncDecl,
} from './ir/index.js';
import { workgroupShapeOf } from './ir/index.js';
import { resolveWorkgroupShape } from './ir/workgroup.js';
import { eachExpr, eachStmtExpr } from './ir/visit.js';
import { validate } from './passes/validate.js';
import { autoVars } from './passes/opt/index.js';
import { froundF32 } from './passes/precision.js';
import {
  treeCombine,
  treeLoops,
  type LoopReduction,
  type TreeLoop,
} from './passes/parallel-loop.js';
import { treeIdentity } from './kernel-tree.js';
import type { CpuPrecision } from './oracle.js';
import { consoleTableRows, type ConsoleSink } from './console.js';
import {
  type CpuValue,
  type NumKind,
  type Componentwise,
  FIELD_IDX,
  BUILTINS,
  COMPONENTWISE,
  GPU_STUBS,
  numKindOf,
  copiedParams,
  isAggregateType,
  elemKindOf,
  zeroOf,
  comparesAsF32,
  TYPED_BIT_BUILTINS,
} from './cpu-runtime.js';
import { compileModule, type CpuModule } from './oracle.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from './intrinsics.js';
import { fnWrites } from './passes/effects.js';
import { dispatchCompute, dispatchEach, needsLockstep } from './debug/dispatch.js';
import { createCodegenRuntime, type CodegenRuntime } from './cpu-codegen-runtime.js';
import { unboundBindings, zeroLit } from './cpu-codegen/zero-literal.js';

class CodegenUnsupported extends Error {}

const q = (s: string): string => JSON.stringify(s);

function jsNum(v: number | boolean): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

function isArrayValued(t: ShaderType): boolean {
  return t.kind === 'vec' || t.kind === 'vec64' || t.kind === 'mat' || t.kind === 'array';
}
const isF32 = (t: ShaderType): boolean => t.kind === 'scalar' && t.scalar === 'f32';
const isF32ish = (t: ShaderType): boolean => isF32(t) || (t.kind === 'vec' && t.elem === 'f32');

interface ModCtx {
  structs: Map<string, StructDecl>;
  constId: Map<string, string>;
  overrideId: Map<string, string>;
  fnNames: ReadonlySet<string>;
  varNames: ReadonlySet<string>;
  bindingNames: ReadonlySet<string>;
  params: ReadonlyMap<string, FuncDecl['params']>;
  trees: ReadonlyMap<Stmt, TreeLoop>;
  f32: boolean;
  bound: Map<string, string>;
  pure: WeakMap<Expr, boolean>;
  absence: Absence;
}

interface FnCtx {
  mod: ModCtx;
  name: string;
  varId: Map<string, string>;
  hoisted: string[];
  n: number;
  inoutPublish?: string;
  rounded: Map<string, readonly string[]>;
}

function tempVar(S: FnCtx): string {
  const id = `$t${S.n++}`;
  S.hoisted.push(id);
  return id;
}

function storeBackJs(
  call: Expr & { op: 'call' },
  callSrc: string,
  S: FnCtx,
  places: readonly (string | undefined)[] = [],
): string {
  const params = S.mod.params.get(call.fn);
  if (params === undefined || !params.some((p) => p.mode === 'inout')) return callSrc;
  const stores: string[] = [];
  params.forEach((p, i) => {
    const arg = call.args[i];
    if (p.mode !== 'inout' || arg === undefined) return;
    if (arg.op === 'varref' || arg.op === 'param') {
      stores.push(emitAssignExpr(arg, `$.inout.values[${i}]`, S));
    } else if (places[i] !== undefined) {
      stores.push(places[i]!.replace('%VALUE%', `$.inout.values[${i}]`));
    }
  });
  if (stores.length === 0) return callSrc;
  const t = tempVar(S);
  return `(${t} = ${callSrc}, ${stores.join(', ')}, ${t})`;
}

function declareVar(name: string, S: FnCtx): string {
  let id = S.varId.get(name);
  if (id === undefined) {
    id = `$v${S.n++}`;
    S.varId.set(name, id);
    S.hoisted.push(id);
  }
  return id;
}

function readVar(name: string, S: FnCtx): string {
  const id = S.varId.get(name);
  if (id !== undefined) return id;
  if (S.mod.varNames.has(name)) return `$.vars[${q(name)}]`;
  return `$.bindings[${q(name)}]`;
}

interface Js {
  readonly js: string;
  readonly atom?: boolean;
  readonly stable?: boolean;
  readonly fresh?: boolean;
  readonly rounded?: boolean;
  readonly num?: number;
}

interface Lanes {
  readonly pre: readonly string[];
  readonly comps: readonly Js[];
}

type Call = Extract<Expr, { op: 'call' }>;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

const seq = (pre: readonly string[], s: string): string =>
  pre.length === 0 ? s : `(${[...pre, s].join(', ')})`;

const keyed = (base: string, key: string): string =>
  /^[\w$]+$/.test(base) ? `${base}[${key}]` : `(${base})[${key}]`;

const arrayOf = (l: Lanes): Js => ({
  js: seq(l.pre, `[${l.comps.map((c) => c.js).join(', ')}]`),
  fresh: true,
});

function litJs(v: number | boolean): Js {
  if (typeof v === 'boolean') return { js: jsNum(v), atom: true, stable: true };
  return { js: jsNum(v), atom: true, stable: true, num: v, rounded: Object.is(Math.fround(v), v) };
}

function widthOf(t: ShaderType | undefined): number | undefined {
  return t !== undefined && (t.kind === 'vec' || t.kind === 'vec64') ? t.n : undefined;
}
const isScalar = (t: ShaderType): boolean => t.kind === 'scalar' || t.kind === 'f64';
const fits = (t: ShaderType, n: number): boolean => widthOf(t) === n || isScalar(t);

function bound(S: FnCtx, rhs: string): string {
  const table = S.mod.bound;
  let id = table.get(rhs);
  if (id === undefined) {
    id = rhs === 'Math.fround' ? '$fr' : `$h${table.size}`;
    table.set(rhs, id);
  }
  return id;
}

type Helper =
  | 'applyBin'
  | 'matVecShaped'
  | 'matMulShaped'
  | 'vecMatShaped'
  | 'matColumn'
  | 'matTransposeShaped'
  | 'setMatColumn'
  | 'splat'
  | 'swiz'
  | 'negVec'
  | 'wrap'
  | 'cmpVec'
  | 'bit'
  | 'selVec'
  | 'u32Sat'
  | 'i32Sat'
  | 'intDiv'
  | 'intRem'
  | 'clone'
  | 'cvt'
  | 'cvtVec';
const helper = (S: FnCtx, name: Helper & keyof CodegenRuntime): string => bound(S, `$.${name}`);

function rounded(v: Js, S: FnCtx): Js {
  if (v.rounded) return v;
  if (v.num !== undefined) return litJs(Math.fround(v.num));
  return { js: `${bound(S, 'Math.fround')}(${v.js})`, rounded: true };
}

function atomize(v: Js, S: FnCtx, pre: string[]): Js {
  if (v.atom) return v;
  const t = tempVar(S);
  pre.push(`${t} = ${v.js}`);
  return { js: t, atom: true, rounded: v.rounded };
}

const negate = (js: string): string => (js.startsWith('-') ? `(-(${js}))` : `(-${js})`);

const wrapNum = (js: string, kind: NumKind): string =>
  kind === 'f32' ? js : kind === 'i32' ? `(${js} | 0)` : `(${js} >>> 0)`;

function wrapped(js: string, t: ShaderType, S: FnCtx): string {
  const kind = numKindOf(t);
  if (kind === 'f32') return js;
  if (isArrayValued(t)) return `${helper(S, 'wrap')}(${js}, ${q(kind)})`;
  return wrapNum(js, kind);
}

const sumOf = (terms: readonly string[]): string => terms.reduce((s, t) => `(${s} + ${t})`, '0');

function componentwiseOf(name: string): Componentwise | undefined {
  return Object.hasOwn(COMPONENTWISE, name)
    ? (COMPONENTWISE as Readonly<Record<string, Componentwise>>)[name]
    : undefined;
}

type CallKind =
  | 'barrier'
  | 'atomic'
  | 'console'
  | 'saturate'
  | 'transpose'
  | 'bits'
  | 'module'
  | 'builtin'
  | 'stub';

function callKind(e: Call, fnNames: ReadonlySet<string>): CallKind {
  const intrinsic = e.declRef === undefined;
  if (intrinsic && isBarrierIntrinsic(e.fn)) return 'barrier';
  if (intrinsic && isAtomicIntrinsic(e.fn)) return 'atomic';
  if (intrinsic && e.fn.startsWith('console.')) return 'console';
  if (e.fn === 'u32' || e.fn === 'i32') {
    const src = e.args[0]!.type;
    if (src.kind === 'f64' || (src.kind === 'scalar' && src.scalar === 'f32')) return 'saturate';
  }
  if (intrinsic && e.fn === 'transpose' && e.args[0]!.type.kind === 'mat') return 'transpose';
  if (intrinsic && TYPED_BIT_BUILTINS.has(e.fn)) return 'bits';
  if (!intrinsic && fnNames.has(e.fn)) return 'module';
  if (BUILTINS[e.fn]) return 'builtin';
  if (GPU_STUBS[e.fn]) return 'stub';
  return 'module';
}

function isPure(e: Expr, S: FnCtx): boolean {
  const memo = S.mod.pure;
  const hit = memo.get(e);
  if (hit !== undefined) return hit;
  const p = (x: Expr): boolean => isPure(x, S);
  let pure: boolean;
  switch (e.op) {
    case 'lit':
    case 'constref':
    case 'overrideref':
    case 'param':
    case 'varref':
      pure = true;
      break;
    case 'externref':
      pure = false;
      break;
    case 'binop':
    case 'compare':
    case 'logical':
      pure = p(e.a) && p(e.b);
      break;
    case 'unop':
      pure = p(e.a);
      break;
    case 'member':
      pure = p(e.base);
      break;
    case 'index':
      pure = p(e.base) && p(e.idx);
      break;
    case 'construct':
      pure = e.args.every(p);
      break;
    case 'select':
      pure = p(e.cond) && p(e.ifTrue) && p(e.ifFalse);
      break;
    case 'matchExpr':
      pure = p(e.scrutinee) && e.cases.every(([, v]) => p(v)) && p(e.default);
      break;
    case 'call': {
      const k = callKind(e, S.mod.fnNames);
      pure =
        (k === 'saturate' ||
          k === 'transpose' ||
          k === 'bits' ||
          (k === 'builtin' && Object.hasOwn(BUILTINS, e.fn))) &&
        e.args.every(p);
      break;
    }
  }
  memo.set(e, pure);
  return pure;
}

function roundedParam(a: Expr, t: ShaderType, S: FnCtx): readonly string[] | undefined {
  if (a.op !== 'param') return undefined;
  const ids = S.rounded.get(a.name);
  if (ids === undefined) return undefined;
  const n = widthOf(a.type);
  const fitsIds =
    n === undefined
      ? isScalar(a.type) && isScalar(t) && ids.length === 1
      : widthOf(t) === n && ids.length === n;
  return fitsIds ? ids : undefined;
}

function isStable(e: Expr, S: FnCtx): boolean {
  if (e.op === 'lit' || e.op === 'constref' || e.op === 'overrideref') return true;
  if (e.op !== 'call' || e.fn !== '__fround' || e.args.length !== 1) return false;
  if (callKind(e, S.mod.fnNames) !== 'builtin') return false;
  const a = e.args[0]!;
  return a.op === 'lit' || roundedParam(a, e.type, S) !== undefined;
}

type AbsenceScope = Pick<ModCtx, 'fnNames' | 'varNames' | 'bindingNames' | 'params' | 'trees'>;

interface Absence {
  may(fn: string, e: Expr): boolean;
  holds(fn: string, name: string): boolean;
}

function returnsNothing(body: readonly Stmt[]): boolean {
  let found = false;
  const walk = (s: Stmt): void => {
    if (s.s === 'discard' || (s.s === 'return' && s.expr === undefined)) found = true;
    eachStmtExpr(s, () => undefined, walk);
  };
  body.forEach(walk);
  return found;
}

function alwaysReturns(body: readonly Stmt[]): boolean {
  for (const s of body) {
    if (s.s === 'return' || s.s === 'discard') return true;
    if (s.s === 'break' || s.s === 'continue') return false;
    if (
      s.s === 'if' &&
      s.elseBody !== undefined &&
      s.arms.every((arm) => alwaysReturns(arm.body)) &&
      alwaysReturns(s.elseBody)
    )
      return true;
    if (
      s.s === 'switch' &&
      s.defaultBody !== undefined &&
      s.cases.every((c) => alwaysReturns(c.body)) &&
      alwaysReturns(s.defaultBody)
    )
      return true;
  }
  return false;
}

function rootName(target: Expr): string | undefined {
  let x = target;
  while (x.op === 'member' || x.op === 'index') x = x.base;
  return x.op === 'varref' || x.op === 'param' ? x.name : undefined;
}

function analyseAbsence(m: ModuleDecl, scope: AbsenceScope): Absence {
  const held = new Map<string, Set<string>>(m.funcs.map((f) => [f.name, new Set()]));
  const shared = new Set<string>();
  const results = new Set<string>();
  let grew = false;
  for (const f of m.funcs)
    if (isAggregateType(f.ret) && (returnsNothing(f.body) || !alwaysReturns(f.body)))
      results.add(f.name);

  const holds = (fn: string, name: string): boolean =>
    held.get(fn)?.has(name) === true || shared.has(name);
  const note = (fn: string, name: string): void => {
    const names = held.get(fn);
    if (names !== undefined && !names.has(name)) {
      names.add(name);
      grew = true;
    }
    if ((scope.varNames.has(name) || scope.bindingNames.has(name)) && !shared.has(name)) {
      shared.add(name);
      grew = true;
    }
  };
  const memo = new Map<string, WeakMap<Expr, boolean>>();
  const may = (fn: string, e: Expr): boolean => {
    let seen = memo.get(fn);
    if (seen === undefined) memo.set(fn, (seen = new WeakMap()));
    let answer = seen.get(e);
    if (answer === undefined) seen.set(e, (answer = compute(fn, e)));
    return answer;
  };
  const compute = (fn: string, e: Expr): boolean => {
    const sub = (x: Expr): boolean => may(fn, x);
    switch (e.op) {
      case 'lit':
      case 'constref':
      case 'overrideref':
      case 'externref':
        return false;
      case 'param':
      case 'varref':
        return holds(fn, e.name);
      case 'binop':
      case 'compare':
      case 'logical':
        return sub(e.a) || sub(e.b);
      case 'unop':
        return sub(e.a);
      case 'member':
        return sub(e.base);
      case 'index':
        return widthOf(e.type) !== undefined || sub(e.base);
      case 'construct':
        return e.args.some(sub);
      case 'select':
        return sub(e.ifTrue) || sub(e.ifFalse);
      case 'matchExpr':
        return e.cases.some(([, v]) => sub(v)) || sub(e.default);
      case 'call':
        return callKind(e, scope.fnNames) === 'module' ? results.has(e.fn) : e.args.some(sub);
    }
  };
  const flows = (fn: string, e: Expr): boolean => isAggregateType(e.type) && may(fn, e);

  const visit = (f: FuncDecl): void => {
    const fn = f.name;
    const call = (e: Call): void => {
      const params = callKind(e, scope.fnNames) === 'module' ? scope.params.get(e.fn) : undefined;
      params?.forEach((p, i) => {
        const arg = e.args[i];
        if (arg === undefined) return;
        if (flows(fn, arg)) note(e.fn, p.name);
        if (p.mode === 'inout' && held.get(e.fn)?.has(p.name) === true) {
          const into = rootName(arg);
          if (into !== undefined) note(fn, into);
        }
      });
    };
    const stmt = (s: Stmt): void => {
      switch (s.s) {
        case 'let':
          if (flows(fn, s.expr)) note(fn, s.name);
          break;
        case 'var':
          if (s.init !== undefined && flows(fn, s.init)) note(fn, s.name);
          break;
        case 'assign': {
          const into = rootName(s.target);
          if (into !== undefined && flows(fn, s.expr)) note(fn, into);
          break;
        }
        case 'return':
          if (s.expr !== undefined && flows(fn, s.expr) && !results.has(fn)) {
            results.add(fn);
            grew = true;
          }
          break;
        case 'for':
          for (const r of scope.trees.get(s)?.reductions ?? [])
            if (holds(fn, r.name)) {
              note(fn, '$ta');
              note(fn, '$tb');
            }
          break;
        default:
          break;
      }
      eachStmtExpr(
        s,
        (e) =>
          eachExpr(e, (x) => {
            if (x.op === 'call') call(x);
          }),
        stmt,
      );
    };
    f.body.forEach(stmt);
  };
  do {
    grew = false;
    memo.clear();
    m.funcs.forEach(visit);
  } while (grew);
  return { holds, may };
}

const missing = (o: Expr, S: FnCtx): boolean =>
  widthOf(o.type) !== undefined && S.mod.absence.may(S.name, o);
const anyMissing = (os: readonly Expr[], S: FnCtx): boolean => os.some((o) => missing(o, S));

function laneOperands(e: Expr): readonly Expr[] {
  switch (e.op) {
    case 'binop':
    case 'compare':
      return [e.a, e.b];
    case 'unop':
      return [e.a];
    case 'select':
      return [e.cond, e.ifTrue, e.ifFalse];
    case 'member':
      return [e.base];
    case 'construct':
    case 'call':
      return e.args;
    default:
      return [];
  }
}

function operands(
  ops: readonly Expr[],
  S: FnCtx,
  broadcast = true,
): { pre: string[]; parts: Js[][] } {
  let last = -1;
  ops.forEach((o, j) => {
    if (!isPure(o, S)) last = j;
  });
  const pre: string[] = [];
  const parts = ops.map((o, j): Js[] => {
    const w = widthOf(o.type);
    if (j <= last && !isStable(o, S)) {
      const v = emit(o, S);
      const t = tempVar(S);
      pre.push(`${t} = ${v.js}`);
      if (w === undefined) return [{ js: t, atom: true, rounded: v.rounded }];
      return range(w).map((i) => ({ js: `${t}[${i}]`, atom: true }));
    }
    if (w !== undefined) {
      const l = lanesOf(o, w, S);
      pre.push(...l.pre);
      return [...l.comps];
    }
    const v = emit(o, S);
    return [broadcast ? atomize(v, S, pre) : v];
  });
  return { pre, parts };
}

function lanewise(ops: readonly Expr[], n: number, S: FnCtx, f: (xs: readonly Js[]) => Js): Lanes {
  const { pre, parts } = operands(ops, S);
  const comps = range(n).map((i) =>
    f(parts.map((p, j) => (widthOf(ops[j]!.type) === undefined ? p[0]! : p[i]!))),
  );
  return { pre, comps };
}

function lanesOf(e: Expr, n: number, S: FnCtx): Lanes {
  const own = ownLanes(e, n, S);
  if (own !== undefined) return own;
  const v = emit(e, S);
  if (v.atom) {
    return {
      pre: [],
      comps: range(n).map((i) => ({ js: keyed(v.js, String(i)), atom: true, stable: v.stable })),
    };
  }
  const t = tempVar(S);
  return {
    pre: [`${t} = ${v.js}`],
    comps: range(n).map((i) => ({ js: `${t}[${i}]`, atom: true })),
  };
}

function ownLanes(e: Expr, n: number, S: FnCtx): Lanes | undefined {
  if (anyMissing(laneOperands(e), S)) return undefined;
  switch (e.op) {
    case 'binop': {
      if (widthOf(e.a.type) === undefined && widthOf(e.b.type) === undefined) return undefined;
      if (!fits(e.a.type, n) || !fits(e.b.type, n)) return undefined;
      const kind = numKindOf(e.type);
      return lanewise([e.a, e.b], n, S, ([a, b]) => ({
        js: emitScalarBin(e.bop, a!.js, b!.js, kind, S),
      }));
    }
    case 'unop': {
      if (widthOf(e.a.type) !== n) return undefined;
      const kind = numKindOf(e.type);
      return lanewise([e.a], n, S, ([a]) => ({ js: wrapNum(negate(a!.js), kind) }));
    }
    case 'compare': {
      if (widthOf(e.a.type) !== n || widthOf(e.b.type) !== n) return undefined;
      const f32 = comparesAsF32(e.a.type);
      return lanewise([e.a, e.b], n, S, ([a, b]) => ({ js: compareJs(e.cop, a!, b!, f32, S) }));
    }
    case 'select': {
      if (widthOf(e.cond.type) !== n || widthOf(e.ifTrue.type) !== n) return undefined;
      if (widthOf(e.ifFalse.type) !== n) return undefined;
      return lanewise([e.cond, e.ifTrue, e.ifFalse], n, S, ([c, t, f]) => ({
        js: `(${c!.js} ? ${t!.js} : ${f!.js})`,
        rounded: t!.rounded === true && f!.rounded === true,
      }));
    }
    case 'construct':
      return constructLanes(e, n, S);
    case 'member':
      return swizzleLanes(e, n, S);
    case 'call':
      return callLanes(e, n, S);
    default:
      return undefined;
  }
}

function constructLanes(
  e: Extract<Expr, { op: 'construct' }>,
  n: number,
  S: FnCtx,
): Lanes | undefined {
  const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
  const splat = e.args.length === 1 && !isArrayValued(e.args[0]!.type);
  let count = 0;
  for (const a of e.args) {
    const w = widthOf(a.type);
    if (w === undefined && isArrayValued(a.type)) return undefined;
    count += w ?? 1;
  }
  if (!splat && count !== n) return undefined;
  const { pre, parts } = operands(e.args, S, false);
  const cvt = (c: Js, a: Expr): Js => {
    const from = elemKindOf(a.type);
    if (elem === undefined || from === undefined || from === elem) return c;
    return { js: `${helper(S, 'cvt')}(${c.js}, ${q(from)}, ${q(elem)})` };
  };
  if (splat) {
    const c = atomize(cvt(parts[0]![0]!, e.args[0]!), S, pre);
    return { pre, comps: range(n).map(() => c) };
  }
  return { pre, comps: e.args.flatMap((a, j) => parts[j]!.map((c) => cvt(c, a))) };
}

function swizzleLanes(e: Extract<Expr, { op: 'member' }>, n: number, S: FnCtx): Lanes | undefined {
  const w = widthOf(e.base.type);
  if (w === undefined || e.field.length < 2 || e.field.length !== n) return undefined;
  const idx: number[] = [];
  for (const c of e.field) {
    if (!Object.hasOwn(FIELD_IDX, c)) return undefined;
    const i = FIELD_IDX[c]!;
    if (i >= w) return undefined;
    idx.push(i);
  }
  const { pre, parts } = operands([e.base], S);
  const src = parts[0]!;
  const picked = (i: number): number => idx.filter((k) => k === i).length;
  const comps = src.map((c, i) => (picked(i) > 1 ? atomize(c, S, pre) : c));
  return { pre, comps: idx.map((i) => comps[i]!) };
}

function callLanes(e: Call, n: number, S: FnCtx): Lanes | undefined {
  if (callKind(e, S.mod.fnNames) !== 'builtin') return undefined;
  const kind = numKindOf(e.type);
  const out = (l: Lanes): Lanes =>
    kind === 'f32' ? l : { pre: l.pre, comps: l.comps.map((c) => ({ js: wrapNum(c.js, kind) })) };
  const [a0] = e.args;
  if (e.fn === '__fround') {
    if (e.args.length !== 1 || widthOf(a0!.type) !== n) return undefined;
    const ids = roundedParam(a0!, e.type, S);
    if (ids !== undefined) {
      return out({
        pre: [],
        comps: ids.map((id) => ({ js: id, atom: true, stable: true, rounded: true })),
      });
    }
    return out(lanewise(e.args, n, S, ([x]) => rounded(x!, S)));
  }
  if (e.fn === 'normalize') {
    if (e.args.length !== 1 || widthOf(a0!.type) !== n) return undefined;
    const { pre, parts } = operands(e.args, S);
    const c = parts[0]!.map((x) => atomize(x, S, pre));
    const l = tempVar(S);
    pre.push(`${l} = Math.sqrt(${sumOf(c.map((x) => `${x.js} * ${x.js}`))})`);
    return out({ pre, comps: c.map((x) => ({ js: `(${x.js} / ${l})` })) });
  }
  if (e.fn === 'cross') {
    if (n !== 3 || e.args.length !== 2 || !e.args.every((a) => widthOf(a.type) === 3))
      return undefined;
    const { pre, parts } = operands(e.args, S);
    const [u, w] = parts.map((p) => p.map((x) => atomize(x, S, pre))) as [Js[], Js[]];
    const d = (i: number, j: number, k: number, l: number): Js => ({
      js: `(${u[i]!.js} * ${w[j]!.js} - ${u[k]!.js} * ${w[l]!.js})`,
    });
    return out({ pre, comps: [d(1, 2, 2, 1), d(2, 0, 0, 2), d(0, 1, 1, 0)] });
  }
  const cw = componentwiseOf(e.fn);
  if (cw === undefined || e.args.length !== cw.lane.length) return undefined;
  if (!e.args.every((a) => fits(a.type, n))) return undefined;
  const vector =
    cw.vector === 'any'
      ? e.args.some((a) => widthOf(a.type) === n)
      : widthOf(e.args[cw.vector]?.type) === n;
  if (!vector) return undefined;
  const lane = bound(S, `$.L[${q(e.fn)}].lane`);
  return out(
    lanewise(e.args, n, S, (xs) => ({ js: `${lane}(${xs.map((x) => x.js).join(', ')})` })),
  );
}

function component(base: Expr, i: number, S: FnCtx): Js {
  const n = widthOf(base.type);
  if (n !== undefined && i < n) {
    const own = ownLanes(base, n, S);
    if (own !== undefined) {
      const c = own.comps[i]!;
      return own.pre.length === 0 ? c : { js: seq(own.pre, c.js), rounded: c.rounded };
    }
  }
  const b = emit(base, S);
  return { js: keyed(b.js, String(i)), atom: b.atom, stable: b.stable };
}

function compareJs(cop: CmpOp, a: Js, b: Js, f32: boolean, S: FnCtx): string {
  switch (cop) {
    case '<':
      return `(${a.js} < ${b.js})`;
    case '>':
      return `(${a.js} > ${b.js})`;
    case '<=':
      return `(${a.js} <= ${b.js})`;
    case '>=':
      return `(${a.js} >= ${b.js})`;
    case '==':
      return f32 ? `(${rounded(a, S).js} === ${rounded(b, S).js})` : `(${a.js} === ${b.js})`;
    case '!=':
      return f32 ? `(${rounded(a, S).js} !== ${rounded(b, S).js})` : `(${a.js} !== ${b.js})`;
  }
}

function emitExpr(e: Expr, S: FnCtx): string {
  return emit(e, S).js;
}

function emit(e: Expr, S: FnCtx): Js {
  const n = widthOf(e.type);
  if (n !== undefined) {
    const own = ownLanes(e, n, S);
    if (own !== undefined) return arrayOf(own);
  }
  switch (e.op) {
    case 'lit':
      return litJs(e.value);
    case 'constref': {
      const id = S.mod.constId.get(e.name);
      if (id === undefined) throw new CodegenUnsupported(`unknown const ${e.name}`);
      return { js: id, atom: true, stable: true };
    }
    case 'overrideref': {
      const id = S.mod.overrideId.get(e.name);
      if (id === undefined) throw new CodegenUnsupported(`unknown override ${e.name}`);
      return { js: id, atom: true, stable: true };
    }
    case 'externref':
      throw new CodegenUnsupported(`host-provided global '${e.name}' has no CPU value`);
    case 'param':
    case 'varref':
      return { js: readVar(e.name, S), atom: true };
    case 'binop':
      return emitBinop(e, S);
    case 'unop': {
      const a = emitExpr(e.a, S);
      if (isArrayValued(e.a.type))
        return { js: wrapped(`${helper(S, 'negVec')}(${a})`, e.type, S), fresh: true };
      return { js: wrapped(negate(a), e.type, S) };
    }
    case 'compare': {
      const a = emit(e.a, S);
      const b = emit(e.b, S);
      if (isArrayValued(e.a.type)) {
        return {
          js: `${helper(S, 'cmpVec')}(${q(e.cop)}, ${a.js}, ${b.js}, ${comparesAsF32(e.a.type)})`,
          fresh: true,
        };
      }
      return { js: compareJs(e.cop, a, b, isF32(e.a.type), S) };
    }
    case 'logical': {
      const a = emitExpr(e.a, S);
      const b = emitExpr(e.b, S);
      return { js: e.lop === '&&' ? `(${a} && ${b})` : `(${a} || ${b})` };
    }
    case 'call':
      return emitCall(e, S);
    case 'member': {
      if (isArrayValued(e.base.type)) {
        if (e.field.length > 1) {
          const idx = [...e.field].map((c) => FIELD_IDX[c]);
          if (idx.some((i) => i === undefined)) throw new CodegenUnsupported(`swizzle .${e.field}`);
          return {
            js: `${helper(S, 'swiz')}(${emitExpr(e.base, S)}, [${idx.join(', ')}])`,
            fresh: true,
          };
        }
        const i = FIELD_IDX[e.field];
        if (i === undefined) throw new CodegenUnsupported(`field .${e.field}`);
        return component(e.base, i, S);
      }
      const base = emit(e.base, S);
      return { js: keyed(base.js, q(e.field)), atom: base.atom };
    }
    case 'construct':
      return emitConstruct(e, S);
    case 'select': {
      if (e.cond.type.kind === 'vec') {
        return {
          js: `${helper(S, 'selVec')}(${emitExpr(e.cond, S)}, ${emitExpr(e.ifTrue, S)}, ${emitExpr(e.ifFalse, S)})`,
          fresh: true,
        };
      }
      const c = emitExpr(e.cond, S);
      const t = emit(e.ifTrue, S);
      const f = emit(e.ifFalse, S);
      return {
        js: `(${c} ? ${t.js} : ${f.js})`,
        fresh: t.fresh === true && f.fresh === true,
        rounded: t.rounded === true && f.rounded === true,
      };
    }
    case 'index': {
      if (e.base.type.kind === 'mat') {
        return {
          js: `${helper(S, 'matColumn')}(${emitExpr(e.base, S)}, ${emitExpr(e.idx, S)}, ${e.base.type.rows})`,
          fresh: true,
        };
      }
      const i = e.idx.op === 'lit' ? e.idx.value : undefined;
      const n = widthOf(e.base.type);
      if (n !== undefined && typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < n)
        return component(e.base, i, S);
      const base = emit(e.base, S);
      const idx = emit(e.idx, S);
      return { js: keyed(base.js, idx.js), atom: base.atom === true && idx.atom === true };
    }
    case 'matchExpr': {
      let expr = emitExpr(e.default, S);
      for (let i = e.cases.length - 1; i >= 0; i--) {
        expr = `($m === ${jsNum(e.cases[i]![0])} ? ${emitExpr(e.cases[i]![1], S)} : ${expr})`;
      }
      return { js: `(($m) => ${expr})(${emitExpr(e.scrutinee, S)})` };
    }
  }
}

function emitCall(e: Call, S: FnCtx): Js {
  const kind = callKind(e, S.mod.fnNames);
  if (kind === 'barrier') return { js: `$.barrier(${q(e.fn)})` };
  if (kind === 'atomic') return { js: emitAtomic(e, S) };
  if (kind === 'builtin') {
    const own = builtinJs(e, S);
    if (own !== undefined) return own;
  }
  const params = S.mod.params.get(e.fn);
  const places: (string | undefined)[] = [];
  const args = e.args.map((a, i) => {
    if (params?.[i]?.mode !== 'inout' || (a.op !== 'member' && a.op !== 'index')) {
      return emitExpr(a, S);
    }
    const base = tempVar(S);
    const key = tempVar(S);
    const keyJs =
      a.op === 'index'
        ? emitExpr(a.idx, S)
        : isArrayValued(a.base.type)
          ? String(FIELD_IDX[a.field])
          : q(a.field);
    if (a.op === 'index' && a.base.type.kind === 'mat') {
      const rows = a.base.type.rows;
      places[i] = `${helper(S, 'setMatColumn')}(${base}, ${key}, ${rows}, %VALUE%)`;
      return `(${base} = ${emitExpr(a.base, S)}, ${key} = ${keyJs}, ${helper(S, 'matColumn')}(${base}, ${key}, ${rows}))`;
    }
    places[i] = `${base}[${key}] = %VALUE%`;
    return `(${base} = ${emitExpr(a.base, S)}, ${key} = ${keyJs}, ${base}[${key}])`;
  });
  switch (kind) {
    case 'console': {
      const method = e.fn.slice('console.'.length);
      const rows = consoleTableRows(
        method,
        e.args.map((a) => a.type),
      );
      return {
        js: `$.console(${q(method)}, [${args.join(', ')}], ${e.span ? q(JSON.stringify(e.span)) : 'undefined'}, ${e.labels ? JSON.stringify(e.labels) : 'undefined'}${rows === undefined ? '' : `, ${rows}`})`,
      };
    }
    case 'saturate':
      return { js: `${helper(S, e.fn === 'u32' ? 'u32Sat' : 'i32Sat')}(${args[0]})` };
    case 'transpose': {
      const t = e.args[0]!.type as Extract<ShaderType, { kind: 'mat' }>;
      return {
        js: `${helper(S, 'matTransposeShaped')}(${args[0]}, ${t.cols}, ${t.rows})`,
        fresh: true,
      };
    }
    case 'bits': {
      const k = elemKindOf(e.args[0]!.type) === 'i32' ? 'i32' : 'u32';
      return {
        js: `${helper(S, 'bit')}(${q(e.fn)}, ${q(k)}, [${args.join(', ')}])`,
        fresh: isArrayValued(e.type),
      };
    }
    case 'builtin': {
      const f = Object.hasOwn(BUILTINS, e.fn) ? bound(S, `$.B[${q(e.fn)}]`) : `$.B[${q(e.fn)}]`;
      return { js: wrapped(`${f}(${args.join(', ')})`, e.type, S) };
    }
    case 'stub':
      return { js: `$.gpuStub(${[q(e.fn), ...args].join(', ')})` };
    default:
      return { js: storeBackJs(e, `$.F[${q(e.fn)}](${args.join(', ')})`, S, places) };
  }
}

function builtinJs(e: Call, S: FnCtx): Js | undefined {
  const kind = numKindOf(e.type);
  const out = (v: Js): Js => (kind === 'f32' ? v : { js: wrapNum(v.js, kind) });
  const [a0, a1] = e.args;
  if (e.fn === '__fround') {
    if (e.args.length !== 1 || !isScalar(a0!.type)) return undefined;
    const ids = roundedParam(a0!, e.type, S);
    if (ids !== undefined) return out({ js: ids[0]!, atom: true, stable: true, rounded: true });
    return out(rounded(emit(a0!, S), S));
  }
  const cw = componentwiseOf(e.fn);
  if (cw !== undefined) {
    if (e.args.length !== cw.lane.length || !e.args.every((a) => isScalar(a.type)))
      return undefined;
    const lane = bound(S, `$.L[${q(e.fn)}].lane`);
    return out({ js: `${lane}(${e.args.map((a) => emitExpr(a, S)).join(', ')})` });
  }
  if ((e.fn === 'dot' || e.fn === 'distance') && e.args.length === 2) {
    const w = widthOf(a0!.type);
    if (w === undefined || widthOf(a1!.type) !== w || anyMissing(e.args, S)) return undefined;
    const { pre, parts } = operands(e.args, S);
    const [a, b] = parts as [Js[], Js[]];
    if (e.fn === 'dot')
      return out({ js: seq(pre, sumOf(range(w).map((i) => `${a[i]!.js} * ${b[i]!.js}`))) });
    const d = range(w).map((i) => atomize({ js: `(${a[i]!.js} - ${b[i]!.js})` }, S, pre));
    return out({ js: seq(pre, `Math.sqrt(${sumOf(d.map((x) => `${x.js} * ${x.js}`))})`) });
  }
  if (e.fn === 'length' && e.args.length === 1) {
    const w = widthOf(a0!.type);
    if (w === undefined || anyMissing(e.args, S)) return undefined;
    const { pre, parts } = operands(e.args, S);
    const c = parts[0]!.map((x) => atomize(x, S, pre));
    return out({ js: seq(pre, `Math.sqrt(${sumOf(c.map((x) => `${x.js} * ${x.js}`))})`) });
  }
  return undefined;
}

function emitBinop(e: Extract<Expr, { op: 'binop' }>, S: FnCtx): Js {
  const a = emitExpr(e.a, S);
  const b = emitExpr(e.b, S);
  if (
    e.bop === '*' &&
    e.a.type.kind === 'mat' &&
    (e.b.type.kind === 'vec' || e.b.type.kind === 'vec64')
  )
    return {
      js: `${helper(S, 'matVecShaped')}(${a}, ${b}, ${e.a.type.cols}, ${e.a.type.rows})`,
      fresh: true,
    };
  if (e.bop === '*' && e.a.type.kind === 'mat' && e.b.type.kind === 'mat')
    return {
      js: `${helper(S, 'matMulShaped')}(${a}, ${b}, ${e.a.type.cols}, ${e.a.type.rows}, ${e.b.type.cols})`,
      fresh: true,
    };
  if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat')
    return {
      js: `${helper(S, 'vecMatShaped')}(${a}, ${b}, ${e.b.type.cols}, ${e.b.type.rows})`,
      fresh: true,
    };
  const kind = numKindOf(e.type);
  if (isArrayValued(e.a.type) || isArrayValued(e.b.type))
    return { js: `${helper(S, 'applyBin')}(${q(e.bop)}, ${a}, ${b}, ${q(kind)})`, fresh: true };
  return { js: emitScalarBin(e.bop, a, b, kind, S) };
}

function applyBinJs(bop: BinOp, a: Expr, b: Expr, kind: NumKind, S: FnCtx): string {
  const n = widthOf(a.type);
  if (n !== undefined && fits(b.type, n) && !anyMissing([a, b], S)) {
    return arrayOf(
      lanewise([a, b], n, S, ([x, y]) => ({ js: emitScalarBin(bop, x!.js, y!.js, kind, S) })),
    ).js;
  }
  const x = emitExpr(a, S);
  const y = emitExpr(b, S);
  if (!isArrayValued(a.type) && !isArrayValued(b.type)) return emitScalarBin(bop, x, y, kind, S);
  return `${helper(S, 'applyBin')}(${q(bop)}, ${x}, ${y}, ${q(kind)})`;
}

function emitScalarBin(bop: BinOp, a: string, b: string, kind: NumKind, S: FnCtx): string {
  const int = kind !== 'f32';
  const wrap = (s: string): string => (kind === 'i32' ? `(${s} | 0)` : `(${s} >>> 0)`);
  switch (bop) {
    case '+':
      return int ? wrap(`(${a} + ${b})`) : `(${a} + ${b})`;
    case '-':
      return int ? wrap(`(${a} - ${b})`) : `(${a} - ${b})`;
    case '*':
      return int ? wrap(`Math.imul(${a}, ${b})`) : `(${a} * ${b})`;
    case '/':
      return int ? `${helper(S, 'intDiv')}(${a}, ${b}, ${q(kind)})` : `(${a} / ${b})`;
    case '%':
      return int ? `${helper(S, 'intRem')}(${a}, ${b}, ${q(kind)})` : `(${a} % ${b})`;
    case '&':
      return kind === 'i32' ? `(${a} & ${b})` : `((${a} & ${b}) >>> 0)`;
    case '|':
      return kind === 'i32' ? `(${a} | ${b})` : `((${a} | ${b}) >>> 0)`;
    case '^':
      return kind === 'i32' ? `(${a} ^ ${b})` : `((${a} ^ ${b}) >>> 0)`;
    case '<<':
      return kind === 'i32' ? `(${a} << ${b})` : `((${a} << ${b}) >>> 0)`;
    case '>>':
      return kind === 'i32' ? `(${a} >> ${b})` : `(${a} >>> ${b})`;
  }
}

function emitConstruct(e: Extract<Expr, { op: 'construct' }>, S: FnCtx): Js {
  const freshAll = (vals: readonly Js[]): boolean =>
    vals.every((v, i) => !isAggregateType(e.args[i]!.type) || v.fresh === true);
  if (e.type.kind === 'array') {
    const vals = e.args.map((a) => emit(a, S));
    return { js: `[${vals.map((v) => v.js).join(', ')}]`, fresh: freshAll(vals) };
  }
  if (e.type.kind === 'struct') {
    const decl = S.mod.structs.get(e.type.name);
    if (decl === undefined) throw new CodegenUnsupported(`struct ${e.type.name} not declared`);
    const vals = decl.fields.map((_, i) => emit(e.args[i]!, S));
    const fields = decl.fields.map((f, i) => `${q(f.name)}: ${vals[i]!.js}`);
    return { js: `{ ${fields.join(', ')} }`, fresh: freshAll(vals) };
  }
  const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
  const n = e.type.kind === 'vec' || e.type.kind === 'vec64' ? e.type.n : 0;
  const cvt = (a: Expr): string => {
    const src = emitExpr(a, S);
    const from = elemKindOf(a.type);
    if (elem === undefined || from === undefined || from === elem) return src;
    return `${helper(S, isArrayValued(a.type) ? 'cvtVec' : 'cvt')}(${src}, ${q(from)}, ${q(elem)})`;
  };
  if (e.args.length === 1 && !isArrayValued(e.args[0]!.type))
    return { js: `${helper(S, 'splat')}(${n}, ${cvt(e.args[0]!)})`, fresh: true };
  const parts = e.args.map((a) => (isArrayValued(a.type) ? `...(${cvt(a)})` : cvt(a)));
  return { js: `[${parts.join(', ')}]`, fresh: true };
}

function emitAtomic(e: Extract<Expr, { op: 'call' }>, S: FnCtx): string {
  const loc = e.args[0];
  if (loc === undefined) throw new CodegenUnsupported(`${e.fn} without a location`);
  const fn = q(e.fn);
  const kind = q(numKindOf(loc.type));
  const arg = e.args[1] === undefined ? '0' : emitExpr(e.args[1], S);
  const store = e.args[2] === undefined ? 'undefined' : emitExpr(e.args[2], S);
  if (loc.op === 'index') {
    return `$.atomicAt(${fn}, ${emitExpr(loc.base, S)}, ${emitExpr(loc.idx, S)}, ${arg}, ${kind}, ${store})`;
  }
  if (loc.op === 'member') {
    const key = isArrayValued(loc.base.type) ? String(FIELD_IDX[loc.field] ?? -1) : q(loc.field);
    return `$.atomicAt(${fn}, ${emitExpr(loc.base, S)}, ${key}, ${arg}, ${kind}, ${store})`;
  }
  if (loc.op === 'varref' || loc.op === 'param') {
    const id = S.varId.get(loc.name);
    if (id === undefined) {
      const table = S.mod.varNames.has(loc.name) ? '$.vars' : '$.bindings';
      return `$.atomicAt(${fn}, ${table}, ${q(loc.name)}, ${arg}, ${kind}, ${store})`;
    }
    return `$.atomicRef(${fn}, () => ${id}, ($v) => (${id} = $v), ${arg}, ${kind}, ${store})`;
  }
  throw new CodegenUnsupported(`atomic location ${loc.op}`);
}

function emitAssignExpr(target: Expr, valueStr: string, S: FnCtx): string {
  if (target.op === 'varref' || target.op === 'param') {
    const local = S.varId.get(target.name);
    if (local === undefined && S.mod.varNames.has(target.name))
      return `$.vars[${q(target.name)}] = ${valueStr}`;
    if (local === undefined && S.mod.bindingNames.has(target.name))
      return `$.bindings[${q(target.name)}] = ${valueStr}`;
    const id = local ?? declareVar(target.name, S);
    return `${id} = ${valueStr}`;
  }
  if (target.op === 'member') {
    const base = emitExpr(target.base, S);
    if (isArrayValued(target.base.type)) {
      const i = FIELD_IDX[target.field];
      if (i === undefined) throw new CodegenUnsupported(`assign .${target.field}`);
      return `(${base})[${i}] = ${valueStr}`;
    }
    return `(${base})[${q(target.field)}] = ${valueStr}`;
  }
  if (target.op === 'index') {
    if (target.base.type.kind === 'mat') {
      return `${helper(S, 'setMatColumn')}(${emitExpr(target.base, S)}, ${emitExpr(target.idx, S)}, ${target.base.type.rows}, ${valueStr})`;
    }
    return `(${emitExpr(target.base, S)})[${emitExpr(target.idx, S)}] = ${valueStr}`;
  }
  throw new CodegenUnsupported(`assignment target ${target.op}`);
}

function bindJs(v: Js, t: ShaderType, S: FnCtx): string {
  return isAggregateType(t) && v.fresh !== true ? `${helper(S, 'clone')}(${v.js})` : v.js;
}

function emitStmt(s: Stmt, S: FnCtx): string {
  switch (s.s) {
    case 'let': {
      const id = declareVar(s.name, S);
      return `${id} = ${bindJs(emit(s.expr, S), s.expr.type, S)};`;
    }
    case 'var': {
      const id = declareVar(s.name, S);
      return `${id} = ${s.init ? bindJs(emit(s.init, S), s.type, S) : zeroLit(s.type, S.mod.structs)};`;
    }
    case 'assign':
      return `${emitAssignExpr(s.target, bindJs(emit(s.expr, S), s.expr.type, S), S)};`;
    case 'assignOp': {
      const val = applyBinJs(s.bop, s.target, s.expr, numKindOf(s.target.type), S);
      return `${emitAssignExpr(s.target, val, S)};`;
    }
    case 'return':
      if (S.inoutPublish !== undefined) {
        if (!s.expr) return `return void (${S.inoutPublish});`;
        const t = tempVar(S);
        return `return (${t} = ${emitExpr(s.expr, S)}, ${S.inoutPublish}, ${t});`;
      }
      return s.expr ? `return ${emitExpr(s.expr, S)};` : `return undefined;`;
    case 'break':
      return `break;`;
    case 'continue':
      return `continue;`;
    case 'discard':
      return `return undefined;`;
    case 'call':
      return `${emitExpr(s.expr, S)};`;
    case 'if': {
      const parts: string[] = [];
      s.arms.forEach((arm, i) => {
        parts.push(
          `${i === 0 ? 'if' : 'else if'} (${emitExpr(arm.cond, S)}) {\n${emitBody(arm.body, S)}\n}`,
        );
      });
      if (s.elseBody) parts.push(`else {\n${emitBody(s.elseBody, S)}\n}`);
      return parts.join(' ');
    }
    case 'for': {
      const init = emitForInit(s.init, S);
      const cond = emitExpr(s.cond, S);
      const update = emitForUpdate(s.update, S);
      const tree = S.mod.trees.get(s);
      if (tree !== undefined) return emitTreeFor(s, tree, init, cond, update, S);
      return `for (${init}; ${cond}; ${update}) {\n${emitBody(s.body, S)}\n}`;
    }
    case 'switch': {
      const scrut = emitExpr(s.scrut, S);
      const cases = s.cases.map(
        (c) =>
          `${c.values.map((v) => `case ${jsNum(v)}:`).join(' ')} {\n${emitBody(c.body, S)}\nbreak;\n}`,
      );
      const dflt = s.defaultBody ? `default: {\n${emitBody(s.defaultBody, S)}\nbreak;\n}` : '';
      return `switch (${scrut}) {\n${cases.join('\n')}\n${dflt}\n}`;
    }
    case 'placeholder':
      throw new CodegenUnsupported(`placeholder ${s.tag}`);
    case 'raw':
      throw new CodegenUnsupported('raw Stmt');
  }
}

function emitTreeFor(
  s: Stmt & { s: 'for' },
  tree: TreeLoop,
  init: string,
  cond: string,
  update: string,
  S: FnCtx,
): string {
  const { reductions } = tree;
  const ids = reductions.map((r) => readVar(r.name, S));
  const saved = reductions.map(() => tempVar(S));
  const bags = reductions.map(() => tempVar(S));
  const identities = reductions.map((r) => identityJs(r));
  S.varId.set('$ta', '$ta');
  S.varId.set('$tb', '$tb');
  const combines = reductions.map(
    (r) => `(($ta, $tb) => ${emitExpr(treeCombine(r, S.mod.f32), S)})`,
  );
  S.varId.delete('$ta');
  S.varId.delete('$tb');
  const before = ids.map((id, k) => `${saved[k]} = ${id}; ${bags[k]} = [];`).join('\n');
  const start = ids.map((id, k) => `${id} = ${identities[k]};`).join(' ');
  const collect = ids.map((id, k) => `${bags[k]}.push(${id});`).join(' ');
  const after = ids
    .map(
      (id, k) =>
        `${id} = ${saved[k]};\n{ const $tr = $.tree(${bags[k]}, ${combines[k]}, () => ${identities[k]}); if ($tr !== undefined) ${id} = ${combines[k]}(${id}, $tr); }`,
    )
    .join('\n');
  const scat = tree.scatters.map((n) => {
    const id = S.varId.get(n);
    if (id === undefined)
      throw new CodegenUnsupported('a scatter into a name that is not a parameter');
    return id;
  });
  const r = scat.length === 0 ? '' : tempVar(S);
  const endIter = scat.length === 0 ? '' : `${r}.end();`;
  const loop = `for (${init}; ${cond}; ${update}) {\n${start}\ntry {\n${emitBody(s.body, S)}\n} finally { ${collect} ${endIter} }\n}\n${after}`;
  if (scat.length === 0) return `${before}\n${loop}`;
  const views = scat.map((id, j) => `${id} = ${r}.view(${j});`).join(' ');
  const real = scat.map((id, j) => `${id} = ${r}.real(${j});`).join(' ');
  return `${before}\n${r} = $.scatter([${scat.join(', ')}], ${S.mod.f32}); ${views}\ntry {\n${loop}\n} finally { ${r}.finish(); ${real} }`;
}

function identityJs(r: LoopReduction): string {
  const t = r.type;
  const scalar =
    t.kind === 'scalar'
      ? t.scalar
      : t.kind === 'vec'
        ? t.elem
        : t.kind === 'f64' || t.kind === 'vec64'
          ? 'f64'
          : undefined;
  if (scalar === undefined) throw new CodegenUnsupported(`a ${t.kind} reduction`);
  const one = jsNum(treeIdentity(r.op, scalar));
  return t.kind === 'vec' || t.kind === 'vec64'
    ? `[${new Array<string>(t.n).fill(one).join(', ')}]`
    : one;
}

function emitHeaderAssign(s: Stmt, S: FnCtx): string | undefined {
  if (s.s === 'assign') return emitAssignExpr(s.target, bindJs(emit(s.expr, S), s.expr.type, S), S);
  if (s.s === 'assignOp') {
    const val = applyBinJs(s.bop, s.target, s.expr, numKindOf(s.target.type), S);
    return emitAssignExpr(s.target, val, S);
  }
  return undefined;
}

function emitForInit(s: Stmt, S: FnCtx): string {
  if (s.s === 'let') return `${declareVar(s.name, S)} = ${emitExpr(s.expr, S)}`;
  if (s.s === 'var')
    return `${declareVar(s.name, S)} = ${s.init ? emitExpr(s.init, S) : zeroLit(s.type, S.mod.structs)}`;
  const assigned = emitHeaderAssign(s, S);
  if (assigned !== undefined) return assigned;
  throw new CodegenUnsupported(`for-init ${s.s}`);
}

function emitForUpdate(s: Stmt, S: FnCtx): string {
  const assigned = emitHeaderAssign(s, S);
  if (assigned !== undefined) return assigned;
  throw new CodegenUnsupported(`for-update ${s.s}`);
}

function emitBody(body: readonly Stmt[], S: FnCtx): string {
  return body.map((s) => emitStmt(s, S)).join('\n');
}

interface ParamUse {
  reads: number;
  wrapped: number;
  written: boolean;
}

function paramUses(f: FuncDecl, mod: ModCtx): ReadonlyMap<string, ParamUse> {
  const uses = new Map<string, ParamUse>();
  const types = new Map<string, ShaderType>();
  for (const p of f.params) {
    uses.set(p.name, { reads: 0, wrapped: 0, written: uses.has(p.name) });
    types.set(p.name, p.type);
  }
  const shaped = (t: ShaderType, decl: ShaderType): boolean => {
    const w = widthOf(decl);
    return w === undefined ? isScalar(t) : widthOf(t) === w;
  };
  const write = (e: Expr | undefined): void => {
    let x = e;
    while (x !== undefined && (x.op === 'member' || x.op === 'index' || x.op === 'call'))
      x = x.op === 'call' ? x.args[0] : x.base;
    if (x !== undefined && (x.op === 'param' || x.op === 'varref')) {
      const u = uses.get(x.name);
      if (u !== undefined) u.written = true;
    }
  };
  const visit = (x: Expr): void => {
    if (x.op === 'param' || x.op === 'varref') {
      const u = uses.get(x.name);
      if (u !== undefined) u.reads++;
      return;
    }
    if (x.op !== 'call') return;
    const a = x.args[0];
    if (
      x.fn === '__fround' &&
      x.args.length === 1 &&
      !(x.declRef !== undefined && mod.fnNames.has(x.fn)) &&
      a !== undefined &&
      a.op === 'param'
    ) {
      const u = uses.get(a.name);
      const t = types.get(a.name);
      if (u !== undefined && t !== undefined && shaped(a.type, t) && shaped(x.type, t)) u.wrapped++;
    }
    if (x.declRef === undefined && isAtomicIntrinsic(x.fn)) write(a);
    mod.params.get(x.fn)?.forEach((p, i) => {
      if (p.mode === 'inout') write(x.args[i]);
    });
  };
  const stmt = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') {
      const u = uses.get(s.name);
      if (u !== undefined) u.written = true;
    }
    if (s.s === 'assign' || s.s === 'assignOp') write(s.target);
    eachStmtExpr(s, (e) => eachExpr(e, visit), stmt);
  };
  for (const s of f.body) stmt(s);
  return uses;
}

export interface GeneratedModuleJs {
  readonly module: ModuleDecl;
  readonly decls: readonly string[];
  readonly constIds: ReadonlyMap<string, string>;
  readonly fns: readonly string[];
  readonly fallbacks: readonly string[];
  readonly factorySource: string;
}

export function generateModuleJs(
  m: ModuleDecl,
  opts?: { precision?: CpuPrecision },
): GeneratedModuleJs {
  validate(m);
  const av = autoVars(m);
  const mv = opts?.precision === 'f32' ? froundF32(av) : av;

  const scope: AbsenceScope = {
    fnNames: new Set(mv.funcs.map((f) => f.name)),
    varNames: new Set((mv.vars ?? []).map((v) => v.name)),
    bindingNames: new Set(mv.bindings.map((b) => b.name)),
    params: new Map(mv.funcs.map((f) => [f.name, f.params])),
    trees: treeLoops(av, mv),
  };
  const mod: ModCtx = {
    structs: new Map(mv.structs.map((s) => [s.name, s])),
    constId: new Map(),
    overrideId: new Map(),
    ...scope,
    f32: opts?.precision === 'f32',
    bound: new Map(),
    pure: new WeakMap(),
    absence: analyseAbsence(mv, scope),
  };

  const constDecls: string[] = [];
  const constEnv: FnCtx = {
    mod,
    name: '',
    varId: new Map(),
    hoisted: [],
    n: 0,
    rounded: new Map(),
  };
  mv.consts.forEach((c, i) => {
    const id = `$C_${i}`;
    mod.constId.set(c.name, id);
    const rhs = c.valueExpr ? emitExpr(c.valueExpr, constEnv) : jsNum(c.cpuValue);
    constDecls.push(`const ${id} = ${rhs};`);
  });
  (mv.overrides ?? []).forEach((o, i) => {
    const id = `$O_${i}`;
    mod.overrideId.set(o.name, id);
    constDecls.push(`const ${id} = ($.overrides[${q(o.name)}] ?? ${jsNum(o.default)});`);
  });

  const fnSrcs: string[] = [];
  const fallbackNames: string[] = [];
  const privates = (mv.vars ?? []).filter((v) => v.space === 'private');
  if (privates.length > 0) {
    const varEnv: FnCtx = {
      mod,
      name: '',
      varId: new Map(),
      hoisted: [],
      n: 0,
      rounded: new Map(),
    };
    const lines = privates.map(
      (v) =>
        `$.vars[${q(v.name)}] = ${v.init ? bindJs(emit(v.init, varEnv), v.type, varEnv) : zeroLit(v.type, mod.structs)};`,
    );
    const hoist = varEnv.hoisted.length ? `let ${varEnv.hoisted.join(', ')};\n` : '';
    fnSrcs.push(`"$initPrivates": function() {\n${hoist}${lines.join('\n')}\n}`);
  }
  const inoutBuffers: string[] = [];
  const writes = fnWrites(mv);
  for (const f of mv.funcs) {
    try {
      const S: FnCtx = {
        mod,
        name: f.name,
        varId: new Map(),
        hoisted: [],
        n: 0,
        rounded: new Map(),
      };
      const params = f.params.map((p, i) => {
        const id = `$a${i}`;
        S.varId.set(p.name, id);
        return id;
      });
      const copies = copiedParams(f.params, (writes.get(f.name)?.size ?? 0) > 0);
      const uses = paramUses(f, mod);
      const entry: string[] = [];
      f.params.forEach((p, i) => {
        const id = params[i]!;
        const u = uses.get(p.name)!;
        const round =
          p.mode !== 'inout' &&
          isF32ish(p.type) &&
          u.wrapped > 0 &&
          !u.written &&
          !(widthOf(p.type) !== undefined && mod.absence.holds(f.name, p.name));
        if (copies[i] && !(round && u.reads === u.wrapped))
          entry.push(`${id} = ${helper(S, 'clone')}(${id});`);
        if (!round) return;
        const fr = bound(S, 'Math.fround');
        const w = widthOf(p.type);
        const ids = w === undefined ? [`$p${i}`] : range(w).map((k) => `$p${i}_${k}`);
        S.hoisted.push(...ids);
        S.rounded.set(p.name, ids);
        ids.forEach((r, k) => entry.push(`${r} = ${fr}(${w === undefined ? id : `${id}[${k}]`});`));
      });
      if (f.params.some((p) => p.mode === 'inout')) {
        const buffer = `$io${inoutBuffers.length}`;
        inoutBuffers.push(`const ${buffer} = Array(${params.length});`);
        S.inoutPublish = [
          ...params.map((id, i) => `${buffer}[${i}] = ${id}`),
          `$.inout.values = ${buffer}`,
        ].join(', ');
      }
      const bodySrc = emitBody(f.body, S);
      const exit = S.inoutPublish !== undefined ? `\n${S.inoutPublish};` : '';
      const hoist = S.hoisted.length ? `let ${S.hoisted.join(', ')};\n` : '';
      fnSrcs.push(
        `${q(f.name)}: function(${params.join(', ')}) {\n${hoist}${entry.map((l) => `${l}\n`).join('')}${bodySrc}${exit}\n}`,
      );
    } catch (err) {
      if (err instanceof CodegenUnsupported) {
        fallbackNames.push(f.name);
        continue;
      }
      throw err;
    }
  }

  const decls = [
    ...[...mod.bound].map(([rhs, id]) => `const ${id} = ${rhs};`),
    ...(constEnv.hoisted.length > 0 ? [`let ${constEnv.hoisted.join(', ')};`] : []),
    ...constDecls,
    ...inoutBuffers,
    ...unboundBindings(mv, mod.structs),
  ];
  return {
    module: mv,
    decls,
    constIds: mod.constId,
    fns: fnSrcs,
    fallbacks: fallbackNames,
    factorySource: `${decls.join('\n')}\nreturn {\n${fnSrcs.join(',\n')}\n};`,
  };
}

/** Compile a module for the CPU by generating JavaScript, returning the same
 *  {@link CpuModule} shape {@link compileModule} returns and the same results bit for bit.
 *  Prefer it on any hot path.
 *
 *  Bit identity holds by construction: every operation calls the exact runtime helper the
 *  interpreter calls, or, for a vector operand the IR types say it can and that nothing the
 *  module does can leave missing (a helper's `discard`, an element read past an array's end),
 *  the scalar operation that helper applies to each component, so the two cannot drift apart.
 *  What differs is when the work happens. Instead of walking the IR node by node on every
 *  invocation, this walks each function body once, emits a JavaScript source string and builds
 *  it with `new Function`, so each call runs straight-line code with real local variables.
 *
 *  The interpreter is the reference and the fallback. A function body holding a shape this
 *  generator cannot emit bit-identically (a raw statement, a placeholder statement, an
 *  assignment target with no expression form) falls back to the interpreter for that function
 *  alone, so a returned module can be part compiled and part interpreted with nothing to do at
 *  the call site. Where `new Function` itself is unavailable, as on a host whose content
 *  security policy forbids `unsafe-eval`, construction throws, and the caller catches it and
 *  calls {@link compileModule} instead. Reach for the interpreter directly when debugging, too,
 *  since it puts no generated source between you and the IR.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to evaluate.
 *  @param opts - the same `precision` and `gpuStubs` {@link compileModule} takes.
 *  @returns the compiled module: `fns` by name, and `setBinding`.
 *  @throws `Error` when the host forbids `new Function`, which is the case to catch and fall
 *    back to {@link compileModule} for. It also throws {@link ValidationError} when the module
 *    fails a core rule, and, once a function runs, the same errors {@link compileModule}
 *    documents for a GPU-only intrinsic called with `gpuStubs` off or a raw statement reached.
 *
 *  @example
 *  ```ts
 *  import { compileModuleJs, compileModule } from 'typeshade'
 *
 *  const cpu = (() => {
 *    try {
 *      return compileModuleJs(MODULE)
 *    } catch {
 *      return compileModule(MODULE) // no new Function on this host
 *    }
 *  })()
 *  ```
 *
 *  @see {@link compileModule} for the interpreter this matches.
 */
export function compileModuleJs(
  m: ModuleDecl,
  opts?: {
    gpuStubs?: boolean;
    precision?: CpuPrecision;
    consoleSink?: ConsoleSink;
    overrides?: Readonly<Record<string, CpuValue>>;
  },
): CpuModule {
  const gen = generateModuleJs(m, opts);
  const mv = gen.module;
  const fallbackNames = gen.fallbacks;
  const factorySrc = gen.factorySource;
  const factory = new Function('$', factorySrc) as (
    $: CodegenRuntime,
  ) => Record<string, (...a: CpuValue[]) => CpuValue>;

  const runtime = createCodegenRuntime(opts);

  const jsFns = factory(runtime);
  const structs = new Map(mv.structs.map((s) => [s.name, s]));
  const overrideValues = new Map(Object.entries(runtime.overrides));
  for (const v of mv.vars ?? [])
    if (v.space === 'workgroup') runtime.vars[v.name] = zeroOf(v.type, structs, overrideValues);
  const initPrivates = jsFns['$initPrivates'] as (() => void) | undefined;

  const interp: CpuModule | null = fallbackNames.length ? compileModule(m, opts) : null;
  const interpreted: ReadonlySet<string> = new Set(fallbackNames);

  const F: Record<string, (...a: CpuValue[]) => CpuValue> = {};
  for (const f of mv.funcs) {
    F[f.name] = jsFns[f.name] ?? interp!.fns[f.name]!;
  }
  runtime.F = F;

  let fns = F;
  if (initPrivates !== undefined) {
    fns = {};
    for (const f of mv.funcs) {
      const inner = F[f.name]!;
      fns[f.name] = (...a: CpuValue[]): CpuValue => {
        initPrivates();
        return inner(...a);
      };
    }
  }
  return {
    fns,
    setBinding: (name, value) => {
      runtime.bindings[name] = value;
      interp?.setBinding(name, value);
    },
    dispatch: (entry, workgroups) => {
      if (needsLockstep(mv, entry, interpreted))
        return dispatchCompute(m, entry, workgroups, runtime.bindings, opts);
      const decl = mv.funcs.find((f) => f.name === entry)!;
      const run = fns[entry]!;
      const selectedShape = resolveWorkgroupShape(
        workgroupShapeOf(decl) ?? [64, 1, 1],
        decl.workgroupSizeOverrides,
        overrideValues,
      );
      const outer = runtime.invocation;
      try {
        return dispatchEach(
          decl,
          workgroups,
          () => {
            for (const v of mv.vars ?? [])
              if (v.space === 'workgroup')
                runtime.vars[v.name] = zeroOf(v.type, structs, overrideValues);
          },
          (args, gid) => {
            runtime.invocation = gid;
            run(...args);
          },
          selectedShape,
        );
      } finally {
        runtime.invocation = outer;
      }
    },
  };
}
