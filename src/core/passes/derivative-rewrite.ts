// ═══ The derivative rewrite: an implicit-LOD sample or a derivative in non-uniform control flow ═══
//
// Change 0132, item 3; Rule 8.5. WGSL refuses `textureSample`, `textureSampleBias`,
// `textureSampleCompare` and the screen-space derivatives in non-uniform control flow, and
// `uniformity.ts` finds each such call. This pass rewrites the calls it can reach, so that the
// author does not have to: RECOMPUTE, THEN DERIVE.
//
//   • The hoist point. The uniformity walk records the class of the control flow at each
//     statement. The hoist point is the latest statement before the call, on the path that
//     reaches it, where that class is `uniform`. When no statement of the call's function
//     qualifies (the function is called under non-uniform control flow), the walk climbs to a
//     call site that is not uniform and looks there, so a helper's call is hoisted in its caller.
//   • The slice. The backward slice of the call's operand (the coordinate of a sample, the
//     argument of a derivative, every argument of a call with no gradient form), from the call
//     back to the hoist point, across the helpers between them. It is emitted again at the
//     hoist point with fresh names. The original statements stay where they are, so the branch
//     computes what it computed before.
//   • The derivative. At the hoist point: `dpdx` and `dpdy` of the recomputed coordinate, the
//     recomputed derivative, or the recomputed call.
//   • The use. Inside the branch: `textureSampleGrad` with those gradients (`textureGrad` on
//     GLSL ES 3.00, from the same IR), the value computed at the hoist point for a derivative,
//     and for a call with no gradient form (a `textureSampleCompare`, a `texture_1d` sample).
//     `textureSampleBias` multiplies both gradients by `exp2(clamp(bias, -16.0, 15.99))`.
//   • Helpers. A helper between the hoist point and the call is SPECIALIZED: a copy of it takes
//     the gradients as extra parameters, and the call site that needed them calls the copy. The
//     original stays, for its other callers and for the host code that may call an exported
//     one; a copy the rewrite made and then left uncalled leaves the module.
//
// The rewrite cannot reach a call whose slice cannot be recomputed at the hoist point. The
// reasons (change 0132, item 4), which `TS8052` names:
//
//   1. A read of memory the module writes (`read_write` storage, `workgroup` or `private`
//      memory), an atomic operation, or a loop whose trip count is not a constant.
//   2. A call with no gradient form whose arguments fail reason 1.
//   3. An operand that changes from one iteration of a loop on the path to the next.
//
// and one more, for what the proposal does not list: a value the compiler cannot recompute at
// all (a `raw` statement, a write through an `inout` parameter, a call with an effect).
//
// Not here: a barrier and a subgroup call are never rewritten. No author filter switches the
// rule off: change 0132 removed it, and the front end refuses a written one (`TS8028`).

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { eachExpr, mapChildren } from '../ir/visit.js';
import { isAtomicIntrinsic, isKnownIntrinsic } from '../intrinsics.js';
import { argAccess } from './access.js';
import { EFFECTFUL_INTRINSICS, SYNC_WRITE, fnReads, fnWrites } from './effects.js';
import {
  uniformityViolations,
  type Uniformity,
  type UniformityObservation,
  type UniformitySource,
  type UniformityViolation,
} from './uniformity.js';

type Call = Extract<Expr, { op: 'call' }>;

/** Why the rewrite could not reach a call: the reason `TS8052` names. */
export type DerivativeRewriteReason =
  | { readonly kind: 'memory'; readonly name: string }
  | { readonly kind: 'atomic' }
  | { readonly kind: 'loop-trips' }
  | { readonly kind: 'no-gradient'; readonly texture: string; readonly what: 'depth' | '1d' }
  | { readonly kind: 'loop-variant' }
  | { readonly kind: 'other' };

/** What the rewrite made of a module. */
export interface DerivativeRewrite {
  /** The module with every reached call rewritten; the input itself when it rewrote none. */
  readonly module: ModuleDecl;
  /** `source.builtIfs`, with the statements the rewrite rebuilt or copied added. */
  readonly builtIfs: ReadonlyMap<Stmt, 'short-circuit' | 'conditional'>;
  /** Why each call the rewrite could not reach was not reached, keyed by {@link reasonKey}. */
  readonly unreached: ReadonlyMap<string, DerivativeRewriteReason>;
}

/** The key {@link DerivativeRewrite.unreached} holds a violation's reason under: its callee and
 *  where it was written. A copy of a helper keeps its calls' spans, so the key outlives it. */
export function reasonKey(v: Pick<UniformityViolation, 'callee' | 'span'>): string {
  return `${v.callee}@${v.span === undefined ? '-' : `${v.span.start}:${v.span.length}`}`;
}

/** A refusal on its way out of the slice walk. */
class Refusal extends Error {
  constructor(readonly reason: DerivativeRewriteReason) {
    super(`derivative rewrite refused: ${reason.kind}`);
  }
}

const refuse = (reason: DerivativeRewriteReason): never => {
  throw new Refusal(reason);
};

// ── What a target becomes ──

type TargetPlan =
  | { readonly kind: 'derivative' }
  | {
      readonly kind: 'grad';
      readonly gradFn: string;
      /** The index of the layer argument the array forms take after the coordinate. */
      readonly layered: boolean;
      /** The index of a bias argument, for `textureSampleBias…`. */
      readonly bias?: number;
    }
  | { readonly kind: 'whole'; readonly what: 'depth' | '1d' };

/** How the call `c` is rewritten, or `undefined` for one this pass has no form for. */
function planOf(c: Call): TargetPlan | undefined {
  if (/^(dpdx|dpdy|fwidth)/.test(c.fn)) return { kind: 'derivative' };
  const tex = c.args[0]?.type;
  switch (c.fn) {
    case 'textureSample':
      // WGSL gives a texture_1d no textureSampleGrad (wgsl.txt, textureSampleGrad overloads).
      return tex?.kind === 'texture' && tex.dim === '1d'
        ? { kind: 'whole', what: '1d' }
        : { kind: 'grad', gradFn: 'textureSampleGrad', layered: false };
    case 'textureSampleArray':
      return { kind: 'grad', gradFn: 'textureSampleGradArray', layered: true };
    case 'textureSampleCubeArray':
      return { kind: 'grad', gradFn: 'textureSampleGradCubeArray', layered: true };
    case 'textureSampleBias':
      return { kind: 'grad', gradFn: 'textureSampleGrad', layered: false, bias: 3 };
    case 'textureSampleBiasArray':
      return { kind: 'grad', gradFn: 'textureSampleGradArray', layered: true, bias: 4 };
    case 'textureSampleBiasCubeArray':
      return { kind: 'grad', gradFn: 'textureSampleGradCubeArray', layered: true, bias: 4 };
    default:
      // Every textureSampleCompare form: a depth texture has no gradient form in WGSL
      // (§17.7.12 lists only the f32 texture types).
      return c.fn.startsWith('textureSampleCompare') ? { kind: 'whole', what: 'depth' } : undefined;
  }
}

/** The operands a target's slice recomputes. */
function operandsOf(c: Call, plan: TargetPlan): readonly Expr[] {
  switch (plan.kind) {
    case 'derivative':
      return [c.args[0]!];
    case 'grad':
      return [c.args[2]!];
    case 'whole':
      return c.args;
  }
}

/** The values the hoist point hands a target, with their types, in parameter order. */
function handleTypes(c: Call, plan: TargetPlan): { base: string; type: ShaderType }[] {
  switch (plan.kind) {
    case 'derivative':
      return [{ base: 'hoist_d', type: c.type }];
    case 'grad': {
      const t = c.args[2]!.type;
      return [
        { base: 'hoist_gx', type: t },
        { base: 'hoist_gy', type: t },
      ];
    }
    case 'whole':
      return [{ base: 'hoist_r', type: c.type }];
  }
}

const f32: ShaderType = { kind: 'scalar', scalar: 'f32' };
const lit = (value: number): Expr => ({ op: 'lit', type: f32, value });

/** The call that takes the place of `c`, given the values the hoist point computed. */
function replacementOf(c: Call, plan: TargetPlan, handles: readonly Expr[]): Expr {
  switch (plan.kind) {
    case 'derivative':
    case 'whole':
      return handles[0]!;
    case 'grad': {
      let [gx, gy] = handles as [Expr, Expr];
      const args = [...c.args];
      if (plan.bias !== undefined) {
        // WGSL clamps the bias to [-16.0, 15.99]; a gradient scaled by 2^bias gives the same
        // level of detail (change 0132, an assumption to measure).
        const bias = args.splice(plan.bias, 1)[0]!;
        const scale: Expr = {
          op: 'call',
          type: f32,
          fn: 'exp2',
          args: [{ op: 'call', type: f32, fn: 'clamp', args: [bias, lit(-16), lit(15.99)] }],
        };
        gx = { op: 'binop', type: gx.type, bop: '*', a: gx, b: scale } as Expr;
        gy = { op: 'binop', type: gy.type, bop: '*', a: gy, b: scale } as Expr;
      }
      return {
        op: 'call',
        type: c.type,
        fn: plan.gradFn,
        args: [...args, gx, gy],
        ...(c.span === undefined ? {} : { span: c.span }),
      };
    }
  }
}

// ── Where a call sits ──

/** One block on the path to a call: the block, and the index of the statement in it that holds
 *  the call or the next block. */
interface Frame {
  readonly block: readonly Stmt[];
  readonly index: number;
}

interface Site {
  readonly frames: readonly Frame[];
  /** The call is in the condition or the update of the `for` the last frame points at. */
  readonly inLoopHeader: boolean;
}

const contains = (e: Expr, target: Expr): boolean => {
  let hit = false;
  eachExpr(e, (x) => {
    if (x === target) hit = true;
  });
  return hit;
};

/** Whether `s` holds `target` in its own expressions: `direct`, or `header` for the iterated
 *  part of a `for` (its condition and its update). */
function holds(s: Stmt, target: Expr): 'direct' | 'header' | undefined {
  switch (s.s) {
    case 'let':
      return contains(s.expr, target) ? 'direct' : undefined;
    case 'var':
      return s.init !== undefined && contains(s.init, target) ? 'direct' : undefined;
    case 'assign':
    case 'assignOp':
      return contains(s.target, target) || contains(s.expr, target) ? 'direct' : undefined;
    case 'call':
      return contains(s.expr, target) ? 'direct' : undefined;
    case 'return':
      return s.expr !== undefined && contains(s.expr, target) ? 'direct' : undefined;
    case 'if':
      return s.arms.some((a) => contains(a.cond, target)) ? 'direct' : undefined;
    case 'switch':
      return contains(s.scrut, target) ? 'direct' : undefined;
    case 'for':
      if (holds(s.init, target) !== undefined) return 'direct';
      return contains(s.cond, target) || holds(s.update, target) !== undefined
        ? 'header'
        : undefined;
    default:
      return undefined;
  }
}

/** The blocks a statement holds. */
function blocksOf(s: Stmt): readonly (readonly Stmt[])[] {
  switch (s.s) {
    case 'if':
      return [...s.arms.map((a) => a.body), ...(s.elseBody ? [s.elseBody] : [])];
    case 'switch':
      return [...s.cases.map((c) => c.body), ...(s.defaultBody ? [s.defaultBody] : [])];
    case 'for':
      return [s.body];
    default:
      return [];
  }
}

function findSite(block: readonly Stmt[], target: Expr, frames: Frame[] = []): Site | undefined {
  for (let i = 0; i < block.length; i++) {
    const s = block[i]!;
    const h = holds(s, target);
    if (h !== undefined) {
      return { frames: [...frames, { block, index: i }], inLoopHeader: h === 'header' };
    }
    for (const b of blocksOf(s)) {
      const r = findSite(b, target, [...frames, { block, index: i }]);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

// ── The walk's facts about names ──

/** The root a write lands on, when it is a local or a parameter. */
function rootName(e: Expr): string | undefined {
  if (e.op === 'varref' || e.op === 'param') return e.name;
  if (e.op === 'member' || e.op === 'index') return rootName(e.base);
  return undefined;
}

/** The index expressions a write's target evaluates. */
function targetIndices(e: Expr): Expr[] {
  if (e.op === 'index') return [e.idx, ...targetIndices(e.base)];
  if (e.op === 'member') return targetIndices(e.base);
  return [];
}

// ── The rewrite ──

/** The most rewrites one module takes; a bound, not a measured need. */
const MAX_ROUNDS = 256;

/** Rewrites every implicit-LOD sample and derivative of `m` that `uniformityViolations` finds in
 *  non-uniform control flow and this pass can reach; see the header. `source` is what the walk
 *  reads beside the IR, as for `uniformityViolations`. */
export function rewriteDerivatives(
  m: ModuleDecl,
  source: UniformitySource = {},
): DerivativeRewrite {
  const builtIfs = new Map(source.builtIfs ?? []);
  const unreached = new Map<string, DerivativeRewriteReason>();
  /** The calls the rewrite gave up on, so a round does not try them again. */
  const given = new Set<string>();
  const clones = new Set<string>();
  let cur = m;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const observe: UniformityObservation = { stmt: new Map(), call: new Map() };
    const found = uniformityViolations(cur, { ...source, builtIfs, observe }).filter(
      (v) => v.kind === 'derivative' && !given.has(reasonKey(v)),
    );
    if (found.length === 0) break;
    let next: ModuleDecl | undefined;
    for (const v of found) {
      const attempt = rewriteOne(cur, v, found, observe, builtIfs, clones);
      if (attempt.module !== undefined) {
        next = attempt.module;
        break;
      }
      given.add(reasonKey(v));
      unreached.set(reasonKey(v), attempt.reason);
    }
    if (next === undefined) break;
    cur = next;
  }
  if (cur === m) return { module: m, builtIfs, unreached };
  return { module: withoutDeadCopies(cur, clones), builtIfs, unreached };
}

/** Every function name a call in `m` names. */
function calledNames(m: ModuleDecl): Set<string> {
  const out = new Set<string>();
  const byName = new Set(m.funcs.map((f) => f.name));
  for (const f of m.funcs) {
    walkExprs(f.body, (e) => {
      if (e.op === 'call' && byName.has(e.fn)) out.add(e.fn);
    });
  }
  return out;
}

/** Visits every expression of `stmts`, at any depth. */
function walkExprs(stmts: readonly Stmt[], visit: (e: Expr) => void): void {
  const stmt = (s: Stmt): void => {
    switch (s.s) {
      case 'let':
        eachExpr(s.expr, visit);
        break;
      case 'var':
        if (s.init) eachExpr(s.init, visit);
        break;
      case 'assign':
      case 'assignOp':
        eachExpr(s.target, visit);
        eachExpr(s.expr, visit);
        break;
      case 'call':
        eachExpr(s.expr, visit);
        break;
      case 'return':
        if (s.expr) eachExpr(s.expr, visit);
        break;
      case 'if':
        for (const a of s.arms) {
          eachExpr(a.cond, visit);
          a.body.forEach(stmt);
        }
        s.elseBody?.forEach(stmt);
        break;
      case 'for':
        stmt(s.init);
        eachExpr(s.cond, visit);
        stmt(s.update);
        s.body.forEach(stmt);
        break;
      case 'switch':
        eachExpr(s.scrut, visit);
        for (const c of s.cases) c.body.forEach(stmt);
        s.defaultBody?.forEach(stmt);
        break;
      default:
        break;
    }
  };
  stmts.forEach(stmt);
}

/** `m` without the copies the rewrite made and then left uncalled (a copy of a copy replaces
 *  it when a later round specializes it again). Every function of the input stays. */
function withoutDeadCopies(m: ModuleDecl, clones: ReadonlySet<string>): ModuleDecl {
  let funcs = m.funcs;
  for (;;) {
    const called = calledNames({ ...m, funcs });
    const keep = funcs.filter((f) => !clones.has(f.name) || called.has(f.name));
    if (keep.length === funcs.length) break;
    funcs = keep;
  }
  return funcs === m.funcs ? m : { ...m, funcs };
}

/** One call site on the way from the hoist point to the target: the function it sits in and the
 *  call (of the next function, or the target itself) it leads to. */
interface Level {
  readonly fn: FuncDecl;
  readonly site: Site;
  /** The frame and the statement the region starts at: the hoist point at level 0, the top of
   *  the function below it. */
  readonly startFrame: number;
  readonly startIndex: number;
  /** The call this level leads to: the next level's call site, or the target. */
  readonly call: Call;
}

/** The levels from the hoist point down to `target` in `fn`, or a refusal. */
function chainOf(
  m: ModuleDecl,
  fn: FuncDecl,
  target: Call,
  observe: UniformityObservation,
): Level[] {
  const below: Level[] = [];
  let f = fn;
  let call = target;
  for (let depth = 0; depth <= m.funcs.length; depth++) {
    const site = findSite(f.body, call);
    if (site === undefined) refuse({ kind: 'other' });
    const hoist = hoistOf(site!, observe);
    if (hoist !== undefined) {
      return [
        { fn: f, site: site!, startFrame: hoist.frame, startIndex: hoist.index, call },
        ...below,
      ];
    }
    below.unshift({ fn: f, site: site!, startFrame: 0, startIndex: 0, call });
    // No statement of `f` runs under uniform control flow: climb to a call site that does not.
    const name = f.name;
    let up: { fn: FuncDecl; call: Call } | undefined;
    for (const g of m.funcs) {
      walkExprs(g.body, (e) => {
        if (up === undefined && e.op === 'call' && e.fn === name) {
          const at = observe.call.get(e);
          if (at !== undefined && at !== 'uniform') up = { fn: g, call: e };
        }
      });
      if (up !== undefined) break;
    }
    if (up === undefined) refuse({ kind: 'other' });
    f = up!.fn;
    call = up!.call;
  }
  return refuse({ kind: 'other' });
}

/** The latest statement on the path to the call whose control flow is uniform. */
function hoistOf(
  site: Site,
  observe: UniformityObservation,
): { frame: number; index: number } | undefined {
  const flow = (s: Stmt): Uniformity => observe.stmt.get(s) ?? 'unknown';
  for (let m = site.frames.length - 1; m >= 0; m--) {
    const { block, index } = site.frames[m]!;
    for (let j = index; j >= 0; j--)
      if (flow(block[j]!) === 'uniform') return { frame: m, index: j };
  }
  return undefined;
}

/** The statements a level's region holds, in the order they run, and where a loop on the path
 *  begins among them. */
interface Region {
  readonly items: readonly Stmt[];
  readonly loops: readonly { readonly at: number; readonly loop: Extract<Stmt, { s: 'for' }> }[];
}

function regionOf(level: Level): Region {
  const items: Stmt[] = [];
  const loops: { at: number; loop: Extract<Stmt, { s: 'for' }> }[] = [];
  const { frames } = level.site;
  for (let k = level.startFrame; k < frames.length; k++) {
    const { block, index } = frames[k]!;
    const from = k === level.startFrame ? level.startIndex : 0;
    for (let j = from; j < index; j++) items.push(block[j]!);
    const owner = block[index]!;
    const last = k === frames.length - 1;
    if (
      owner.s === 'for' &&
      (last ? level.site.inLoopHeader : frames[k + 1]!.block === owner.body)
    ) {
      // The hoist point sits before this loop only when it is the owner itself or above it.
      if (k > level.startFrame || index >= from) loops.push({ at: items.length, loop: owner });
    }
  }
  return { items, loops };
}

/** Rewrites `v`, with every other violation of `found` that shares its chain, or says why not. */
function rewriteOne(
  m: ModuleDecl,
  v: UniformityViolation,
  found: readonly UniformityViolation[],
  observe: UniformityObservation,
  builtIfs: Map<Stmt, 'short-circuit' | 'conditional'>,
  clones: Set<string>,
):
  | { module: ModuleDecl; reason?: undefined }
  | { module?: undefined; reason: DerivativeRewriteReason } {
  const plan = planOf(v.call);
  if (plan === undefined) return { reason: { kind: 'other' } };
  const fn = m.funcs.find((f) => f.name === v.fn);
  if (fn === undefined) return { reason: { kind: 'other' } };
  let chain: Level[];
  try {
    chain = chainOf(m, fn, v.call, observe);
  } catch (e) {
    if (e instanceof Refusal) return { reason: e.reason };
    throw e;
  }
  // The others that share the chain, in the same function, at a point the first one's region
  // runs through: one recompute serves them all.
  const group: { call: Call; plan: TargetPlan; site: Site }[] = [
    { call: v.call, plan, site: chain[chain.length - 1]!.site },
  ];
  for (const w of found) {
    if (w === v || w.fn !== v.fn) continue;
    const p = planOf(w.call);
    if (p === undefined) continue;
    let other: Level[];
    try {
      other = chainOf(m, fn, w.call, observe);
    } catch (e) {
      if (e instanceof Refusal) continue;
      throw e;
    }
    if (!sameChain(chain, other)) continue;
    group.push({ call: w.call, plan: p, site: other[other.length - 1]!.site });
  }
  const ordered = linearGroup(chain, group);
  for (const attempt of ordered.length > 1 ? [ordered, [group[0]!]] : [[group[0]!]]) {
    try {
      return { module: applyRewrite(m, chain, attempt, builtIfs, clones) };
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      if (attempt.length === 1) {
        // A call with no gradient form names the texture it could not recompute, unless the
        // trouble was the loop it sits in.
        const reason =
          plan.kind === 'whole' && e.reason.kind !== 'loop-variant'
            ? {
                kind: 'no-gradient' as const,
                texture: nameOf(v.call.args[0]) ?? v.callee,
                what: plan.what,
              }
            : e.reason;
        return { reason };
      }
    }
  }
  return { reason: { kind: 'other' } };
}

const nameOf = (e: Expr | undefined): string | undefined =>
  e !== undefined && (e.op === 'varref' || e.op === 'param') ? e.name : undefined;

function sameChain(a: readonly Level[], b: readonly Level[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => {
    const o = b[i]!;
    if (l.fn !== o.fn) return false;
    if (i === 0) {
      const hl = l.site.frames[l.startFrame]!.block[l.startIndex];
      const ho = o.site.frames[o.startFrame]!.block[o.startIndex];
      if (hl !== ho) return false;
    }
    return i === a.length - 1 || l.call === o.call;
  });
}

/** The group's targets in the order they run, each one's region a prefix of the next one's and
 *  ending at a statement the next one's region holds; the first target and those that fit. */
function linearGroup(
  chain: readonly Level[],
  group: readonly { call: Call; plan: TargetPlan; site: Site }[],
): { call: Call; plan: TargetPlan; site: Site }[] {
  const last = chain[chain.length - 1]!;
  const regionAt = (site: Site): Region => regionOf({ ...last, site });
  const withRegion = group.map((g) => ({ g, r: regionAt(g.site), stmt: holder(g.site) }));
  withRegion.sort((x, y) => x.r.items.length - y.r.items.length);
  const out = [withRegion[0]!];
  for (const w of withRegion.slice(1)) {
    const prev = out[out.length - 1]!;
    const fits =
      prev.r.items.every((s, i) => w.r.items[i] === s) &&
      prev.r.loops.length === w.r.loops.filter((l) => l.at <= prev.r.items.length).length &&
      (w.r.items[prev.r.items.length] === prev.stmt ||
        (w.r.items.length === prev.r.items.length && w.stmt === prev.stmt));
    if (fits) out.push(w);
  }
  const keep = out.map((o) => o.g);
  // The first target must be in the group; without it, the group is just the first target.
  return keep.includes(group[0]!) ? keep : [group[0]!];
}

const holder = (site: Site): Stmt => {
  const f = site.frames[site.frames.length - 1]!;
  return f.block[f.index]!;
};

// ── The slice ──

/** What the slice walk knows about the module, computed once per rewrite. */
interface ModuleFacts {
  readonly m: ModuleDecl;
  readonly byName: ReadonlyMap<string, FuncDecl>;
  /** Module-scope names a read of which is memory: bindings and module variables. */
  readonly memory: ReadonlySet<string>;
  /** Module-scope names some function of the module writes. */
  readonly written: ReadonlySet<string>;
  readonly pure: Map<string, DerivativeRewriteReason | null>;
}

function factsOf(m: ModuleDecl): ModuleFacts {
  const writes = fnWrites(m);
  const written = new Set<string>();
  for (const w of writes.values()) for (const n of w) if (n !== SYNC_WRITE) written.add(n);
  return {
    m,
    byName: new Map(m.funcs.map((f) => [f.name, f])),
    memory: new Set([...m.bindings.map((b) => b.name), ...(m.vars ?? []).map((v) => v.name)]),
    written,
    pure: new Map(),
  };
}

const isUserCall = (facts: ModuleFacts, c: Call): boolean =>
  c.declRef !== undefined || (facts.byName.has(c.fn) && !isKnownIntrinsic(c.fn));

/** Refuses a read of module memory some function writes. */
function checkMemory(facts: ModuleFacts, name: string): void {
  if (!facts.memory.has(name) || !facts.written.has(name)) return;
  const b = facts.m.bindings.find((x) => x.name === name);
  // A binding nothing writes, a texture and a sampler included, reads the same value anywhere.
  if (b !== undefined && b.space !== 'storage') return;
  refuse({ kind: 'memory', name });
}

/** Refuses a call of a user function that cannot run again at the hoist point. */
function checkPureCall(facts: ModuleFacts, name: string): void {
  const known = facts.pure.get(name);
  if (known === null) return;
  if (known !== undefined) refuse(known);
  const f = facts.byName.get(name);
  let reason: DerivativeRewriteReason | null = null;
  try {
    if (f === undefined || f.params.some((p) => p.mode === 'inout')) refuse({ kind: 'other' });
    const w = fnWrites(facts.m).get(name);
    if (w !== undefined && w.size > 0) refuse({ kind: 'other' });
    for (const r of fnReads(facts.m).get(name) ?? []) checkMemory(facts, r);
    const stmt = (s: Stmt): void => {
      if (s.s === 'discard' || s.s === 'raw' || s.s === 'placeholder') refuse({ kind: 'other' });
      if (s.s === 'for' && s.counted?.trips === undefined) refuse({ kind: 'loop-trips' });
      for (const b of blocksOf(s)) b.forEach(stmt);
      if (s.s === 'for') {
        stmt(s.init);
        stmt(s.update);
      }
    };
    f!.body.forEach(stmt);
    walkExprs(f!.body, (e) => {
      if (e.op !== 'call') return;
      if (isUserCall(facts, e)) checkPureCall(facts, e.fn);
      else checkIntrinsic(e.fn);
    });
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    reason = e.reason;
  }
  facts.pure.set(name, reason);
  if (reason !== null) refuse(reason);
}

function checkIntrinsic(fn: string): void {
  if (isAtomicIntrinsic(fn)) refuse({ kind: 'atomic' });
  if (EFFECTFUL_INTRINSICS.has(fn)) refuse({ kind: 'other' });
}

/** The local names a statement list writes or declares, at any depth, and the roots of the
 *  arguments a call hands an `inout` parameter. */
function localWrites(facts: ModuleFacts, stmts: readonly Stmt[]): Set<string> {
  const out = new Set<string>();
  const stmt = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') out.add(s.name);
    if (s.s === 'assign' || s.s === 'assignOp') {
      const r = rootName(s.target);
      if (r !== undefined) out.add(r);
    }
    if (s.s === 'for') {
      stmt(s.init);
      stmt(s.update);
    }
    for (const b of blocksOf(s)) b.forEach(stmt);
  };
  stmts.forEach(stmt);
  walkExprs(stmts, (e) => {
    if (e.op !== 'call' || !isUserCall(facts, e)) return;
    const f = facts.byName.get(e.fn);
    f?.params.forEach((p, i) => {
      if (p.mode !== 'inout') return;
      const r = e.args[i] && rootName(e.args[i]);
      if (r !== undefined) out.add(r);
    });
  });
  return out;
}

/** What one level's backward walk needs and found. */
interface Needs {
  /** Local names the slice reads that the walk has not yet found the definition of. */
  readonly locals: Set<string>;
  /** The type of each local name read, for a copy the slice makes of it. */
  readonly types: Map<string, ShaderType>;
  /** Parameters the slice reads. */
  readonly params: Set<string>;
}

/** Adds what `e` reads to `needs`, refusing what cannot be read again at the hoist point. */
function addReads(facts: ModuleFacts, e: Expr, needs: Needs): void {
  const visit = (x: Expr): void => {
    switch (x.op) {
      case 'varref':
        if (facts.memory.has(x.name)) checkMemory(facts, x.name);
        else {
          needs.locals.add(x.name);
          needs.types.set(x.name, x.type);
        }
        return;
      case 'param':
        needs.params.add(x.name);
        return;
      case 'call':
        if (isUserCall(facts, x)) checkPureCall(facts, x.fn);
        else checkIntrinsic(x.fn);
        x.args.forEach((a, i) => {
          // `arrayLength(&xs)` reads the size the host bound, not an element.
          if (!isUserCall(facts, x) && argAccess(x.fn, i) === 'length') {
            const r = rootName(a);
            if (r !== undefined && !facts.memory.has(r)) needs.locals.add(r);
            return;
          }
          visit(a);
        });
        return;
      default:
        mapChildren(x, (c) => {
          visit(c);
          return c;
        });
    }
  };
  visit(e);
}

/** The backward slice of one statement against `needs`: the statement with only what the slice
 *  reads kept, or `undefined` when it adds nothing. */
function sliceStmt(facts: ModuleFacts, s: Stmt, needs: Needs): Stmt | undefined {
  switch (s.s) {
    case 'let':
    case 'var': {
      if (!needs.locals.has(s.name)) return undefined;
      needs.locals.delete(s.name);
      const init = s.s === 'let' ? s.expr : s.init;
      if (init !== undefined) addReads(facts, init, needs);
      return s;
    }
    case 'assign':
    case 'assignOp': {
      const root = rootName(s.target);
      if (root === undefined || !needs.locals.has(root)) return undefined;
      if (s.target.op === 'param') refuse({ kind: 'other' });
      const whole = s.s === 'assign' && s.target.op === 'varref';
      if (whole) needs.locals.delete(root);
      addReads(facts, s.expr, needs);
      for (const i of targetIndices(s.target)) addReads(facts, i, needs);
      return s;
    }
    case 'call': {
      const w = localWrites(facts, [s]);
      for (const n of w) if (needs.locals.has(n)) refuse({ kind: 'other' });
      return undefined;
    }
    case 'if': {
      const after = new Set(needs.locals);
      let union = new Set<string>();
      let kept = false;
      const arms = s.arms.map((a) => {
        const local: Needs = { ...needs, locals: new Set(after) };
        const body = sliceBlock(facts, a.body, local);
        if (body.length > 0) kept = true;
        union = new Set([...union, ...local.locals]);
        return { cond: a.cond, body };
      });
      let elseBody: Stmt[] | undefined;
      if (s.elseBody) {
        const local: Needs = { ...needs, locals: new Set(after) };
        elseBody = sliceBlock(facts, s.elseBody, local);
        if (elseBody.length > 0) kept = true;
        union = new Set([...union, ...local.locals]);
      } else union = new Set([...union, ...after]);
      if (!kept) return undefined;
      needs.locals.clear();
      for (const n of union) needs.locals.add(n);
      for (const a of s.arms) addReads(facts, a.cond, needs);
      return { ...s, arms, ...(elseBody === undefined ? {} : { elseBody }) };
    }
    case 'switch': {
      const after = new Set(needs.locals);
      let union = new Set<string>();
      let kept = false;
      const cases = s.cases.map((c) => {
        const local: Needs = { ...needs, locals: new Set(after) };
        const body = sliceBlock(facts, c.body, local);
        if (body.length > 0) kept = true;
        union = new Set([...union, ...local.locals]);
        return { values: c.values, body };
      });
      let defaultBody: Stmt[] | undefined;
      if (s.defaultBody) {
        const local: Needs = { ...needs, locals: new Set(after) };
        defaultBody = sliceBlock(facts, s.defaultBody, local);
        if (defaultBody.length > 0) kept = true;
        union = new Set([...union, ...local.locals]);
      } else union = new Set([...union, ...after]);
      if (!kept) return undefined;
      needs.locals.clear();
      for (const n of union) needs.locals.add(n);
      addReads(facts, s.scrut, needs);
      return { ...s, cases, ...(defaultBody === undefined ? {} : { defaultBody }) };
    }
    case 'for': {
      const writes = localWrites(facts, [s]);
      if (![...needs.locals].some((n) => writes.has(n))) return undefined;
      // A loop the slice runs again must end where it ended before: a constant trip count
      // (Rule 7.5's counted form) and no jump out of it.
      if (s.counted?.trips === undefined || hasJump(s.body)) refuse({ kind: 'loop-trips' });
      const counter = s.init.s === 'var' || s.init.s === 'let' ? s.init.name : undefined;
      // What the body needs at its end is what the loop needs after it and what the next
      // iteration needs at its start: a fixpoint.
      let atEnd = new Set([...needs.locals, ...(counter === undefined ? [] : [counter])]);
      let body: Stmt[] = [];
      for (let i = 0; i < 64; i++) {
        const local: Needs = { ...needs, locals: new Set(atEnd) };
        body = sliceBlock(facts, s.body, local);
        addReads(facts, s.cond, local);
        if (s.update.s === 'assign' || s.update.s === 'assignOp') {
          addReads(facts, s.update.expr, local);
        }
        const next = new Set([...atEnd, ...local.locals]);
        if (next.size === atEnd.size) break;
        atEnd = next;
      }
      needs.locals.clear();
      for (const n of atEnd) needs.locals.add(n);
      if (counter !== undefined) needs.locals.delete(counter);
      if (s.init.s === 'var' && s.init.init !== undefined) addReads(facts, s.init.init, needs);
      if (s.init.s === 'let') addReads(facts, s.init.expr, needs);
      return { ...s, body };
    }
    case 'raw':
    case 'placeholder':
      return refuse({ kind: 'other' });
    default:
      return undefined;
  }
}

function hasJump(stmts: readonly Stmt[]): boolean {
  return stmts.some(
    (s) =>
      s.s === 'break' ||
      s.s === 'continue' ||
      s.s === 'return' ||
      s.s === 'discard' ||
      blocksOf(s).some(hasJump),
  );
}

function sliceBlock(facts: ModuleFacts, stmts: readonly Stmt[], needs: Needs): Stmt[] {
  const out: Stmt[] = [];
  for (let i = stmts.length - 1; i >= 0; i--) {
    const kept = sliceStmt(facts, stmts[i]!, needs);
    if (kept !== undefined) out.unshift(kept);
  }
  return out;
}

/** A target of the level the slice ends at, and where in its region it is reached. */
interface Tap {
  readonly at: number;
  readonly call: Call;
  readonly plan: TargetPlan;
}

/** The backward walk of one level's region: the statements kept, by index, and what is still
 *  needed at its start. `seed` adds what the level's end reads (`at` is the region index the
 *  read happens at, the region's length for its own call). */
function sliceRegion(
  facts: ModuleFacts,
  region: Region,
  seeds: readonly { at: number; add: (needs: Needs) => void }[],
): { kept: Map<number, Stmt>; needs: Needs } {
  const needs: Needs = { locals: new Set(), types: new Map(), params: new Set() };
  const kept = new Map<number, Stmt>();
  for (let p = region.items.length; p >= 0; p--) {
    for (const s of seeds) if (s.at === p) s.add(needs);
    for (const l of region.loops) {
      if (l.at !== p) continue;
      const writes = localWrites(facts, [l.loop]);
      if ([...needs.locals].some((n) => writes.has(n))) refuse({ kind: 'loop-variant' });
    }
    if (p === 0) break;
    const s = sliceStmt(facts, region.items[p - 1]!, needs);
    if (s !== undefined) kept.set(p - 1, s);
  }
  return { kept, needs };
}

// ── Emission ──

/** Fresh names for one function. */
class Names {
  private n = 0;
  constructor(private readonly used: Set<string>) {}
  fresh(base: string): string {
    for (;;) {
      const name = `${base}_h${this.n++}`;
      if (!this.used.has(name)) {
        this.used.add(name);
        return name;
      }
    }
  }
}

function namesOf(m: ModuleDecl, f: FuncDecl): Set<string> {
  const used = new Set<string>([
    ...m.funcs.map((x) => x.name),
    ...m.consts.map((x) => x.name),
    ...m.bindings.map((x) => x.name),
    ...m.structs.map((x) => x.name),
    ...(m.overrides ?? []).map((x) => x.name),
    ...(m.vars ?? []).map((x) => x.name),
    ...f.params.map((p) => p.name),
  ]);
  const stmt = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') used.add(s.name);
    if (s.s === 'for') {
      stmt(s.init);
      stmt(s.update);
    }
    for (const b of blocksOf(s)) b.forEach(stmt);
  };
  f.body.forEach(stmt);
  return used;
}

/** Whether an expression may be written twice in place of a `let`: a leaf, or a value of a type
 *  no `let` holds (a texture, a sampler). */
const duplicable = (e: Expr): boolean =>
  e.op === 'lit' ||
  e.op === 'constref' ||
  e.op === 'overrideref' ||
  e.op === 'varref' ||
  e.op === 'param' ||
  e.type.kind === 'texture' ||
  e.type.kind === 'depth-texture' ||
  e.type.kind === 'storage-texture' ||
  e.type.kind === 'sampler' ||
  e.type.kind === 'sampler-comparison';

/** Renames the locals and parameters of one level as it is emitted at the hoist point. */
class Renamer {
  constructor(
    readonly locals: Map<string, Expr>,
    readonly params: ReadonlyMap<string, Expr>,
  ) {}
  expr(e: Expr): Expr {
    if (e.op === 'varref') return this.locals.get(e.name) ?? e;
    if (e.op === 'param') return this.params.get(e.name) ?? e;
    return mapChildren(e, (c) => this.expr(c));
  }
  scoped(): Renamer {
    return new Renamer(new Map(this.locals), this.params);
  }
}

const varref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });

/** `s` emitted at the hoist point: every local it declares under a fresh name. */
function emitStmt(s: Stmt, r: Renamer, names: Names): Stmt {
  switch (s.s) {
    case 'let': {
      const expr = r.expr(s.expr);
      const name = names.fresh(s.name);
      r.locals.set(s.name, varref(name, s.expr.type));
      return { s: 'let', name, expr };
    }
    case 'var': {
      const init = s.init === undefined ? undefined : r.expr(s.init);
      const name = names.fresh(s.name);
      r.locals.set(s.name, varref(name, s.type));
      return { s: 'var', name, type: s.type, ...(init === undefined ? {} : { init }) };
    }
    case 'assign':
      return { s: 'assign', target: r.expr(s.target), expr: r.expr(s.expr) };
    case 'assignOp':
      return { s: 'assignOp', target: r.expr(s.target), bop: s.bop, expr: r.expr(s.expr) };
    case 'if':
      return {
        s: 'if',
        arms: s.arms.map((a) => ({
          cond: r.expr(a.cond),
          body: emitBlock(a.body, r.scoped(), names),
        })),
        ...(s.elseBody === undefined ? {} : { elseBody: emitBlock(s.elseBody, r.scoped(), names) }),
      };
    case 'switch':
      return {
        s: 'switch',
        scrut: r.expr(s.scrut),
        cases: s.cases.map((c) => ({
          values: c.values,
          body: emitBlock(c.body, r.scoped(), names),
        })),
        ...(s.defaultBody === undefined
          ? {}
          : { defaultBody: emitBlock(s.defaultBody, r.scoped(), names) }),
      };
    case 'for': {
      const inner = r.scoped();
      const init = emitStmt(s.init, inner, names);
      const cond = inner.expr(s.cond);
      const update = emitStmt(s.update, inner, names);
      const body = emitBlock(s.body, inner.scoped(), names);
      const { span: _span, counted, ...rest } = s;
      return {
        ...rest,
        init,
        cond,
        update,
        body,
        ...(counted === undefined
          ? {}
          : {
              counted: {
                ...counted,
                name: init.s === 'var' || init.s === 'let' ? init.name : counted.name,
              },
            }),
      };
    }
    default:
      return s;
  }
}

function emitBlock(stmts: readonly Stmt[], r: Renamer, names: Names): Stmt[] {
  return stmts.map((s) => emitStmt(s, r, names));
}

/** Applies the rewrite of `targets`, all reached through `chain`, or throws a {@link Refusal}. */
function applyRewrite(
  m: ModuleDecl,
  chain: readonly Level[],
  targets: readonly { call: Call; plan: TargetPlan; site: Site }[],
  builtIfs: Map<Stmt, 'short-circuit' | 'conditional'>,
  clones: Set<string>,
): ModuleDecl {
  const facts = factsOf(m);
  const k = chain.length - 1;
  const lastLevel = chain[k]!;
  // The region and the taps of the level the targets sit in: the longest target region holds
  // the others, each tapped where its own region ends.
  const regions = targets.map((t) => regionOf({ ...lastLevel, site: t.site }));
  const longest = regions.reduce((a, b) => (b.items.length > a.items.length ? b : a));
  const taps: Tap[] = targets.map((t, i) => ({
    at: regions[i]!.items.length,
    call: t.call,
    plan: t.plan,
  }));

  // Backward, from the targets to the hoist point: each level's needed parameters become reads
  // of the arguments of the call that leads into it.
  const slices: { kept: Map<number, Stmt>; needs: Needs; region: Region }[] = [];
  let paramSeed: Set<string> = new Set();
  for (let i = k; i >= 0; i--) {
    const level = chain[i]!;
    const region = i === k ? longest : regionOf(level);
    const seeds =
      i === k
        ? taps.map((t) => ({
            at: t.at,
            add: (needs: Needs) => {
              for (const o of operandsOf(t.call, t.plan)) addReads(facts, o, needs);
            },
          }))
        : [
            {
              at: region.items.length,
              add: (needs: Needs) => {
                const callee = chain[i + 1]!.fn;
                callee.params.forEach((p, pos) => {
                  if (!paramSeed.has(p.name)) return;
                  if (p.mode === 'inout') refuse({ kind: 'other' });
                  addReads(facts, level.call.args[pos]!, needs);
                });
              },
            },
          ];
    const s = sliceRegion(facts, region, seeds);
    // Above the hoist level, nothing local is defined before the region: it is the whole
    // function's prefix, so a name still needed is one this walk could not find.
    if (i > 0 && s.needs.locals.size > 0) refuse({ kind: 'other' });
    slices[i] = { ...s, region };
    paramSeed = s.needs.params;
  }

  // Forward, at the hoist point.
  const f0 = chain[0]!.fn;
  const names = new Names(namesOf(m, f0));
  const hoisted: Stmt[] = [];
  const handles = new Map<Call, Expr[]>();
  let renamer = new Renamer(new Map(), new Map());
  for (let i = 0; i <= k; i++) {
    const level = chain[i]!;
    const { kept, needs, region } = slices[i]!;
    if (i === 0) {
      // A name defined before the hoist point that the slice writes is copied first, so the
      // original keeps its value.
      const written = localWrites(facts, [...kept.values()]);
      for (const n of needs.locals) {
        if (!written.has(n)) continue;
        const type = needs.types.get(n)!;
        const name = names.fresh(n);
        hoisted.push({ s: 'var', name, type, init: varref(n, type) });
        renamer.locals.set(n, varref(name, type));
      }
    } else {
      // The parameters this level reads are the arguments of the call that leads into it.
      const params = new Map<string, Expr>();
      const into = chain[i - 1]!.call;
      level.fn.params.forEach((p, pos) => {
        if (!needs.params.has(p.name)) return;
        const arg = renamer.expr(into.args[pos]!);
        if (duplicable(arg)) params.set(p.name, arg);
        else {
          const name = names.fresh(p.name);
          hoisted.push({ s: 'let', name, expr: arg });
          params.set(p.name, varref(name, arg.type));
        }
      });
      renamer = new Renamer(new Map(), params);
    }
    for (let p = 0; p <= region.items.length; p++) {
      if (i === k) {
        for (const t of taps)
          if (t.at === p) handles.set(t.call, emitTap(t, renamer, names, hoisted));
      }
      const s = kept.get(p);
      if (s !== undefined) hoisted.push(emitStmt(s, renamer, names));
    }
  }

  // The use: in the hoist function when the targets are there, else through copies of the
  // helpers between, each taking the values as extra parameters.
  const hoistStmt = chain[0]!.site.frames[chain[0]!.startFrame]!.block[chain[0]!.startIndex]!;
  const funcs = [...m.funcs];
  if (k === 0) {
    const replace = new Map<Expr, Expr>();
    for (const t of targets)
      replace.set(t.call, replacementOf(t.call, t.plan, handles.get(t.call)!));
    const body = rebuild(f0.body, replace, hoistStmt, hoisted, builtIfs);
    funcs[funcs.indexOf(f0)] = { ...f0, body };
    return { ...m, funcs };
  }
  // Extra parameters, in target order, the same for every copy.
  const extras = targets.flatMap((t) => handleTypes(t.call, t.plan).map((h) => ({ ...h, t })));
  let nextCall: { name: string; extraNames: string[] } | undefined;
  const copies: { of: FuncDecl; copy: FuncDecl }[] = [];
  for (let i = k; i >= 1; i--) {
    const fi = chain[i]!.fn;
    const local = new Names(namesOf(m, fi));
    const extraNames = extras.map((e) => local.fresh(e.base));
    const extraParams = extras.map((e, j) => ({ name: extraNames[j]!, type: e.type }));
    const paramRefs: Expr[] = extraParams.map((p) => ({ op: 'param', name: p.name, type: p.type }));
    const replace = new Map<Expr, Expr>();
    if (i === k) {
      let at = 0;
      for (const t of targets) {
        const n = handleTypes(t.call, t.plan).length;
        replace.set(t.call, replacementOf(t.call, t.plan, paramRefs.slice(at, at + n)));
        at += n;
      }
    } else {
      const c = chain[i]!.call;
      replace.set(c, { ...withoutDecl(c), fn: nextCall!.name, args: [...c.args, ...paramRefs] });
    }
    const name = freshFunctionName(m, funcs, fi.name);
    clones.add(name);
    const copy: FuncDecl = {
      ...fi,
      name,
      params: [...fi.params, ...extraParams],
      body: deepCopy(fi.body, replace, builtIfs),
    };
    copies.push({ of: fi, copy });
    nextCall = { name, extraNames };
  }
  const c1 = chain[0]!.call;
  const handleRefs = targets.flatMap((t) => handles.get(t.call)!);
  const replace = new Map<Expr, Expr>([
    [c1, { ...withoutDecl(c1), fn: nextCall!.name, args: [...c1.args, ...handleRefs] }],
  ]);
  funcs[funcs.indexOf(f0)] = {
    ...f0,
    body: rebuild(f0.body, replace, hoistStmt, hoisted, builtIfs),
  };
  // Each copy right after the function it copies, which is before every caller of it on GLSL.
  for (const { of, copy } of copies) {
    const at = funcs.findIndex((f) => f.name === of.name);
    funcs.splice(at + 1, 0, copy);
  }
  return { ...m, funcs };
}

const withoutDecl = (c: Call): Call => {
  const { declRef: _declRef, ...rest } = c;
  return rest;
};

function freshFunctionName(m: ModuleDecl, funcs: readonly FuncDecl[], base: string): string {
  const used = new Set([...funcs.map((f) => f.name), ...namesOf(m, { ...funcs[0]!, body: [] })]);
  for (let n = 0; ; n++) {
    const name = `${base}_grad${n === 0 ? '' : String(n)}`;
    if (!used.has(name)) return name;
  }
}

/** The statements a target's values are computed by at the hoist point; returns the values. */
function emitTap(t: Tap, r: Renamer, names: Names, out: Stmt[]): Expr[] {
  const bind = (base: string, expr: Expr): Expr => {
    const name = names.fresh(base);
    out.push({ s: 'let', name, expr });
    return varref(name, expr.type);
  };
  switch (t.plan.kind) {
    case 'derivative': {
      const arg = r.expr(t.call.args[0]!);
      return [bind('hoist_d', { op: 'call', type: t.call.type, fn: t.call.fn, args: [arg] })];
    }
    case 'grad': {
      const coord = r.expr(t.call.args[2]!);
      const c = duplicable(coord) ? coord : bind('hoist_c', coord);
      return [
        bind('hoist_gx', { op: 'call', type: coord.type, fn: 'dpdx', args: [c] }),
        bind('hoist_gy', { op: 'call', type: coord.type, fn: 'dpdy', args: [c] }),
      ];
    }
    case 'whole':
      return [
        bind('hoist_r', {
          op: 'call',
          type: t.call.type,
          fn: t.call.fn,
          args: t.call.args.map((a) => r.expr(a)),
        }),
      ];
  }
}

/** `e` with every expression `replace` names replaced, identity kept where nothing changed. */
function replaceExpr(e: Expr, replace: ReadonlyMap<Expr, Expr>): Expr {
  const hit = replace.get(e);
  if (hit !== undefined) return hit;
  let changed = false;
  const out = mapChildren(e, (c) => {
    const n = replaceExpr(c, replace);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? out : e;
}

/** `stmts` with `replace` applied and `inserted` placed before `before`, identity kept for what
 *  did not change; a rebuilt `if` keeps the operator `builtIfs` named it for. */
function rebuild(
  stmts: readonly Stmt[],
  replace: ReadonlyMap<Expr, Expr>,
  before: Stmt,
  inserted: readonly Stmt[],
  builtIfs: Map<Stmt, 'short-circuit' | 'conditional'>,
): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    if (s === before) out.push(...inserted);
    out.push(rebuildStmt(s, replace, before, inserted, builtIfs));
  }
  return out;
}

function rebuildStmt(
  s: Stmt,
  replace: ReadonlyMap<Expr, Expr>,
  before: Stmt,
  inserted: readonly Stmt[],
  builtIfs: Map<Stmt, 'short-circuit' | 'conditional'>,
): Stmt {
  const E = (e: Expr): Expr => replaceExpr(e, replace);
  const B = (b: readonly Stmt[]): Stmt[] => rebuild(b, replace, before, inserted, builtIfs);
  const same = (a: readonly Stmt[], b: readonly Stmt[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  let out: Stmt = s;
  switch (s.s) {
    case 'let': {
      const expr = E(s.expr);
      if (expr !== s.expr) out = { ...s, expr };
      break;
    }
    case 'var': {
      const init = s.init === undefined ? undefined : E(s.init);
      if (init !== s.init) out = { ...s, init };
      break;
    }
    case 'assign':
    case 'assignOp': {
      const target = E(s.target);
      const expr = E(s.expr);
      if (target !== s.target || expr !== s.expr) out = { ...s, target, expr };
      break;
    }
    case 'call': {
      const expr = E(s.expr);
      if (expr !== s.expr) out = { ...s, expr };
      break;
    }
    case 'return': {
      const expr = s.expr === undefined ? undefined : E(s.expr);
      if (expr !== s.expr) out = { ...s, expr };
      break;
    }
    case 'if': {
      const arms = s.arms.map((a) => ({ cond: E(a.cond), body: B(a.body) }));
      const elseBody = s.elseBody === undefined ? undefined : B(s.elseBody);
      if (
        arms.some((a, i) => a.cond !== s.arms[i]!.cond || !same(a.body, s.arms[i]!.body)) ||
        (elseBody !== undefined && !same(elseBody, s.elseBody!))
      ) {
        out = { ...s, arms, ...(elseBody === undefined ? {} : { elseBody }) };
      }
      break;
    }
    case 'switch': {
      const scrut = E(s.scrut);
      const cases = s.cases.map((c) => ({ values: c.values, body: B(c.body) }));
      const defaultBody = s.defaultBody === undefined ? undefined : B(s.defaultBody);
      if (
        scrut !== s.scrut ||
        cases.some((c, i) => !same(c.body, s.cases[i]!.body)) ||
        (defaultBody !== undefined && !same(defaultBody, s.defaultBody!))
      ) {
        out = { ...s, scrut, cases, ...(defaultBody === undefined ? {} : { defaultBody }) };
      }
      break;
    }
    case 'for': {
      const init = rebuildStmt(s.init, replace, before, inserted, builtIfs);
      const cond = E(s.cond);
      const update = rebuildStmt(s.update, replace, before, inserted, builtIfs);
      const body = B(s.body);
      if (init !== s.init || cond !== s.cond || update !== s.update || !same(body, s.body)) {
        out = { ...s, init, cond, update, body };
      }
      break;
    }
    default:
      break;
  }
  if (out !== s) {
    const op = builtIfs.get(s);
    if (op !== undefined) builtIfs.set(out, op);
  }
  return out;
}

/** A copy of `stmts` that shares no node with them, with `replace` applied (looked up on the
 *  original nodes); a copied `if` keeps the operator `builtIfs` named it for. */
function deepCopy(
  stmts: readonly Stmt[],
  replace: ReadonlyMap<Expr, Expr>,
  builtIfs: Map<Stmt, 'short-circuit' | 'conditional'>,
): Stmt[] {
  const E = (e: Expr): Expr => {
    const hit = replace.get(e);
    if (hit !== undefined) return hit;
    return { ...mapChildren(e, E) } as Expr;
  };
  const S = (s: Stmt): Stmt => {
    let out: Stmt;
    switch (s.s) {
      case 'let':
        out = { ...s, expr: E(s.expr) };
        break;
      case 'var':
        out = s.init === undefined ? { ...s } : { ...s, init: E(s.init) };
        break;
      case 'assign':
      case 'assignOp':
        out = { ...s, target: E(s.target), expr: E(s.expr) };
        break;
      case 'call':
        out = { ...s, expr: E(s.expr) };
        break;
      case 'return':
        out = s.expr === undefined ? { ...s } : { ...s, expr: E(s.expr) };
        break;
      case 'if':
        out = {
          ...s,
          arms: s.arms.map((a) => ({ cond: E(a.cond), body: a.body.map(S) })),
          ...(s.elseBody === undefined ? {} : { elseBody: s.elseBody.map(S) }),
        };
        break;
      case 'switch':
        out = {
          ...s,
          scrut: E(s.scrut),
          cases: s.cases.map((c) => ({ values: c.values, body: c.body.map(S) })),
          ...(s.defaultBody === undefined ? {} : { defaultBody: s.defaultBody.map(S) }),
        };
        break;
      case 'for':
        out = { ...s, init: S(s.init), cond: E(s.cond), update: S(s.update), body: s.body.map(S) };
        break;
      default:
        out = { ...s };
    }
    const op = builtIfs.get(s);
    if (op !== undefined) builtIfs.set(out, op);
    return out;
  };
  return stmts.map(S);
}
