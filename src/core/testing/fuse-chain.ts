import { emitModule, lowerWgsl } from '../backends/wgsl.js';
import type { CpuValue } from '../cpu-runtime.js';
import { fusedFor, uniformFor, type Fused } from '../fuse-entry.js';
import { assignSlots, type GroupCall } from '../fuse-group.js';
import type { EntryBinding, Layout } from '../host-entry.js';
import type {
  FuseArray,
  FuseLoop,
  KernelFace,
  KernelFuse,
  KernelLoop,
  KernelParam,
} from '../host-kernel.js';
import type { FuncDecl, ModuleDecl, ShaderType } from '../ir/index.js';
import { f32T } from '../ir/index.js';
import { toPortable } from '../ir/portable.js';
import { layoutOf, calleesOf, closureOf } from '../manifest.js';
import { compileModule } from '../oracle.js';
import { fnWrites } from '../passes/effects.js';
import { lowerKernelPruned as lowerKernel } from '../passes/kernel-prune.js';
import { proveKernels } from '../passes/parallel-loop.js';
import type { OptLevel } from '../passes/opt/optimize.js';
import { VERSION } from '../version.js';
import { compile } from '../../compiler/ts/compile.js';
import { authorTypeText } from '../../compiler/ts/context.js';
import { bareArrays, hostTypeOf } from '../../compiler/ts/host-face.js';
import { describeRead } from '../../compiler/ts/kernel-loops.js';
import { copy, runKernelPlan, scheduleKernelPlan, tailOf } from './kernel-plan.js';
import { type ChainAccess, type ChainArray, type ChainCorpus } from './random-ir.js';
import { callArgs, type Inputs } from './fuse-chain/inputs.js';
import { outcomeOf, type Outcome } from './fuse-chain/apart.js';
import type { Lowered, PlannedGroup, GroupFault, GroupStep, FusedRun } from './fuse-chain/types.js';
export { scratchStencil, contractAgainstFacts } from './fuse-chain/stencil.js';
export type { Stencil } from './fuse-chain/stencil.js';
export { groupCallsOf, planChain } from './fuse-chain/grouping.js';
export { readsAtCounter, forgetsReduction, forgetsLength } from './fuse-chain/wrong-faces.js';
export type { Lowered, PlannedGroup, GroupFault, GroupStep, FusedRun } from './fuse-chain/types.js';
export {
  modelGroups,
  reasonOf,
  shapeOf,
  foldLevels,
  dispatchesOf,
  scratchFates,
} from './fuse-chain/model.js';
export type { Reason, ModelGroup, Fate } from './fuse-chain/model.js';
export { runApart } from './fuse-chain/apart.js';
export type { Outcome } from './fuse-chain/apart.js';
export { lengthOf, tripsOf, inputsOf, withScratchContents, callArgs } from './fuse-chain/inputs.js';
export type { Sizes, ScalarOf, Inputs } from './fuse-chain/inputs.js';

function spell(t: ShaderType): string {
  if (t.kind === 'struct') return t.name;
  if (t.kind === 'array')
    return t.size === undefined ? `array<${spell(t.elem)}>` : `array<${spell(t.elem)}, ${t.size}>`;
  return authorTypeText(t);
}

// Why: this is `reachedBy` of `compiler/ts/host-face.ts`, written again over IR: the generator
// makes no source, and the planner shares a helper by its origin and name.
function reachedBy(m: ModuleDecl): ModuleDecl {
  const helpers = new Set(m.funcs.filter((g) => g.stage === undefined).map((g) => g.name));
  const callees = new Map(m.funcs.map((g) => [g.name, calleesOf(g, helpers)]));
  const keep = new Set<string>();
  for (const g of m.funcs)
    if (g.stage !== undefined) for (const name of closureOf(g.name, callees)) keep.add(name);
  return {
    ...m,
    funcs: m.funcs
      .filter((g) => keep.has(g.name))
      .map(({ span: _span, nameSpan: _nameSpan, ...g }): FuncDecl => g),
  };
}

// Why: this follows `kernelFace` and `fuseRecord` of `compiler/ts/host-face.ts`, because the
// generator writes IR and no source, so `hostFace` cannot make the face.
export function lowerFace(m: ModuleDecl, fn: string, origin: string): Lowered | { none: string } {
  const f = m.funcs.find((x) => x.name === fn);
  if (f === undefined) return { none: `no function "${fn}"` };
  const proof = proveKernels(m).find((p) => p.fn === fn);
  if (proof === undefined) return { none: 'it was not proved' };
  const plan = lowerKernel(f, m, proof);
  if ('noGpu' in plan) return { none: plan.noGpu };
  const structs = new Map(plan.module.structs.map((s) => [s.name, s]));
  const written = fnWrites(m).get(fn) ?? new Set<string>();
  const params: KernelParam[] = [];
  for (const p of f.params) {
    if (p.type.kind === 'array' && p.type.size === undefined) {
      const layout = layoutOf(p.type, 'std430', structs, authorTypeText);
      if ('none' in layout) return { none: `parameter "${p.name}": ${layout.none}` };
      params.push({
        name: p.name,
        k: 'array',
        layout: layout as Layout & { k: 'a' },
        writes: written.has(p.name),
        s: spell(p.type),
      });
      continue;
    }
    const t = hostTypeOf(p.type, structs);
    if ('none' in t) return { none: `parameter "${p.name}": ${t.none}` };
    params.push({ name: p.name, k: 'value', type: t });
  }
  const result = hostTypeOf(f.ret, structs);
  if ('none' in result) return { none: `its result: ${result.none}` };
  const argsLayout = layoutOf(
    { kind: 'struct', name: plan.argsStruct },
    'std140',
    structs,
    authorTypeText,
  );
  if ('none' in argsLayout) return { none: argsLayout.none };
  const partNames = new Set(
    plan.loops.flatMap((l) => (l.reduce?.vars ?? []).map((v) => v.binding)),
  );
  const arrays = plan.module.bindings.filter(
    (b) => b.name !== plan.argsBinding && !partNames.has(b.name),
  );
  const loops: KernelLoop[] = [];
  for (const l of plan.loops) {
    const plain = {
      entry: l.entry,
      range: l.range,
      cop: l.cop,
      step: l.step,
      writes: l.writes,
      checks: l.checks,
      wg: l.wg,
    };
    if (l.reduce === undefined) {
      loops.push(plain);
      continue;
    }
    const vars: NonNullable<KernelLoop['reduce']>['vars'][number][] = [];
    for (const v of l.reduce.vars) {
      const b = plan.module.bindings.find((x) => x.name === v.binding)!;
      const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
      if ('none' in layout) return { none: layout.none };
      const t = v.type;
      vars.push({
        name: v.name,
        op: v.op,
        scalar: (t.kind === 'f64' || t.kind === 'vec64'
          ? 'f64'
          : t.kind === 'vec'
            ? t.elem
            : (t as { scalar: string }).scalar) as 'f32',
        n: t.kind === 'vec' || t.kind === 'vec64' ? t.n : 1,
        binding: {
          name: b.name,
          group: b.group,
          binding: b.binding,
          space: 'storage',
          writes: true,
          rw: true,
          layout,
          s: spell(b.type),
        },
      });
    }
    loops.push({ ...plain, reduce: { entry: l.reduce.entry, vars } });
  }
  const arrayParams = f.params
    .filter((p) => p.type.kind === 'array' && p.type.size === undefined)
    .map((p) => p.name);
  const facts = plan.loops.map((l, j): FuseLoop => {
    const v = proof.loops[j]!;
    if (!v.ok) throw new Error(`${fn}: loop ${j + 1} lowered without an accepted proof`);
    const reached: FuseArray[] = [];
    for (const param of arrayParams) {
      const store = v.stores.find((x) => x.name === param);
      const fact = store ?? v.reads.find((x) => x.name === param);
      if (fact === undefined) continue;
      const first = describeRead(f, fact);
      reached.push({
        param,
        access: store === undefined ? 'read' : store.readBack ? 'readwrite' : 'write',
        atI: fact.atI,
        ...(first !== undefined ? { first } : {}),
      });
    }
    const bare = bareArrays(f, plan, l, arrayParams);
    return {
      entry: l.entry,
      ...(l.reduce !== undefined ? { fold: l.reduce.entry } : {}),
      wg: l.wg,
      arrays: reached,
      ...(bare.length > 0 ? { bare } : {}),
      reduces: l.reduce !== undefined,
      scatters: v.writes.some((w) => w.kind === 'scatter'),
      continues: l.continues,
      iterates: l.iterates,
      iteration: l.iteration,
    };
  });
  const fuse: KernelFuse = { origin, facts, ir: toPortable(reachedBy(plan.module), VERSION) };
  const face: KernelFace = {
    name: fn,
    fn,
    params,
    result,
    fuse,
    gpu: {
      wgsl: emitModule(plan.module),
      args: {
        name: plan.argsBinding,
        group: 0,
        binding: 0,
        space: 'uniform',
        writes: false,
        layout: argsLayout,
        s: plan.argsStruct,
      },
      arrays: arrays.map((b): EntryBinding => {
        const p = params.find((x) => x.name === b.name) as KernelParam & { k: 'array' };
        return {
          name: b.name,
          group: b.group,
          binding: b.binding,
          space: 'storage',
          writes: p.writes,
          ...(b.access === 'read_write' ? { rw: true as const } : {}),
          layout: p.layout,
          s: p.s,
        };
      }),
      loops,
      ...(plan.tail !== undefined ? { tail: plan.tail } : {}),
    },
  };
  return { face, m, fn, plan };
}

export function lowerChain(c: ChainCorpus): Lowered[] | { none: string } {
  const out: Lowered[] = [];
  for (const call of c.calls) {
    const r = lowerFace(c.module, call.fn, `chain-${c.seed}`);
    if ('none' in r) return { none: `${call.fn}: ${r.none}` };
    out.push(r);
  }
  return out;
}

export function fuseGroup(
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
  contracted: readonly object[] = [],
): { fused: Fused; arrays: readonly object[] } | { none: string } {
  const { slots, arrays } = assignSlots(idx.map((i) => calls[i]!));
  const fused = fusedFor(
    idx.map((i, m) => ({ k: lows[i]!.face, slots: slots[m]! })),
    arrays.flatMap((a, at) => (contracted.includes(a) ? [at] : [])),
  );
  return 'none' in fused ? fused : { fused, arrays };
}

export function localsStartingAtOne(wgsl: string, locals: number): string {
  let n = 0;
  const out = wgsl.replace(/var (_fs\d+): f32;/g, (_, name: string) => {
    n += 1;
    return `var ${name}: f32 = 1.0;`;
  });
  if (n !== locals)
    throw new Error(`the entry declares ${n} scratch locals, and the group holds ${locals}`);
  return out;
}

export function fusedUniform(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
  inputs: Inputs,
  fault?: GroupFault,
): { values: Record<string, unknown>; n: number } {
  const skip = fault === 'skip-first-iteration';
  const values = uniformFor(
    idx.map((i) => {
      const range = calls[i]!.range!;
      return {
        k: lows[i]!.face,
        hosts: callArgs(c, i, inputs),
        range: skip
          ? { start: range.start + c.calls[i]!.step, n: range.n - 1 }
          : { start: range.start, n: range.n },
      };
    }),
  );
  return { values, n: calls[idx[0]!]!.range!.n - (skip ? 1 : 0) };
}

export function fusedRun(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
  inputs: Inputs,
  fused: Fused,
  fault?: GroupFault,
): FusedRun {
  const u = fusedUniform(c, lows, calls, idx, inputs, fault);
  const reduce = fused.reduce;
  if (reduce === undefined)
    return {
      steps:
        u.n > 0
          ? [{ entry: fused.entry.fn, wg: [Math.ceil(u.n / fused.wg), 1, 1], values: u.values }]
          : [],
      partials: [],
      folds: [],
    };
  const last = idx[idx.length - 1]!;
  const low = lows[last]!;
  const schedule = scheduleKernelPlan(
    low.m,
    low.fn,
    low.plan,
    callArgs(c, last, inputs),
    fault === 'skip-first-iteration' ? fault : undefined,
  );
  const loop = low.plan.loops[0]!.entry;
  let steps: GroupStep[] = schedule.steps.map((st) => ({
    entry: st.entry === loop ? fused.entry.fn : reduce.fold.fn,
    wg: st.workgroups,
    values: {
      ...u.values,
      [reduce.fields.n]: st.args['_n'],
      [reduce.fields.in]: st.args['_in'],
      [reduce.fields.out]: st.args['_out'],
    },
  }));
  if (fault === 'drop-last-level' && steps.length > 1) steps = steps.slice(0, -1);
  if (fault === 'zero-partials' && steps.length > 1)
    steps = [steps[0]!, { clear: schedule.partials.map((p) => p.binding) }, ...steps.slice(1)];
  return { steps, partials: schedule.partials, folds: schedule.folds };
}

export function plannedDispatches(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  groups: readonly PlannedGroup[],
  inputs: Inputs,
): number {
  let n = 0;
  for (const g of groups) {
    if (g.calls.length > 1) {
      const built = fuseGroup(lows, calls, g.calls, g.contracted);
      if ('none' in built) throw new Error(`the group of ${g.calls.join(', ')}: ${built.none}`);
      n += fusedRun(c, lows, calls, g.calls, inputs, built.fused).steps.length;
      continue;
    }
    const i = g.calls[0]!;
    const low = lows[i]!;
    n += scheduleKernelPlan(low.m, low.fn, low.plan, callArgs(c, i, inputs)).steps.length;
  }
  return n;
}

const zeroOf = (t: ShaderType): CpuValue =>
  (t.kind === 'vec' ? new Array<number>(t.n).fill(0) : 0) as CpuValue;

export function runGrouped(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  groups: readonly PlannedGroup[],
  inputs: Inputs,
  opts: { level?: OptLevel; fault?: GroupFault } = {},
): Outcome {
  const locals = new Set(
    groups.flatMap((g) => (g.contracted ?? []).map((a) => (a as ChainArray).id)),
  );
  const store = new Map<string, CpuValue>(
    [...inputs.arrays]
      .filter(([id]) => !locals.has(id))
      .map(([id, v]) => [id, copy(v as unknown as CpuValue)]),
  );
  const results = new Map<string, CpuValue>();
  for (const g of groups) {
    if (g.calls.length > 1) {
      const built = fuseGroup(lows, calls, g.calls, g.contracted);
      if ('none' in built) throw new Error(`the group of ${g.calls.join(', ')}: ${built.none}`);
      const { fused, arrays } = built;
      const cpu = compileModule(
        opts.level === undefined ? fused.module : lowerWgsl(fused.module, opts.level),
        { precision: 'f32' },
      );
      fused.slots.forEach((slot) =>
        cpu.setBinding(
          slot.name,
          store.get((arrays[slot.array] as ChainArray).id)! as unknown as CpuValue,
        ),
      );
      const run = fusedRun(c, lows, calls, g.calls, inputs, fused, opts.fault);
      const parts = new Map<string, CpuValue[]>();
      for (const p of run.partials) {
        const part = Array.from({ length: p.slots }, () => zeroOf(p.type));
        parts.set(p.binding, part);
        cpu.setBinding(p.binding, part as unknown as CpuValue);
      }
      for (const st of run.steps) {
        if ('clear' in st) {
          for (const name of st.clear) {
            const part = parts.get(name)!;
            const type = run.partials.find((p) => p.binding === name)!.type;
            for (let k = 0; k < part.length; k++) part[k] = zeroOf(type);
          }
          continue;
        }
        cpu.setBinding(fused.args.name, st.values as unknown as CpuValue);
        cpu.dispatch(st.entry, st.wg as [number, number, number]);
      }
      const folded = run.folds.map((f) =>
        'identity' in f ? f.identity : copy(parts.get(f.binding)![f.at]!),
      );
      g.calls.forEach((i, m) => {
        const low = lows[i]!;
        const r = tailOf(
          low.m,
          low.fn,
          low.plan,
          callArgs(c, i, inputs, store),
          m === g.calls.length - 1 ? folded : [],
        );
        if (r !== undefined) results.set(low.fn, r);
      });
      continue;
    }
    const i = g.calls[0]!;
    const low = lows[i]!;
    for (const a of c.calls[i]!.args)
      if ('array' in a && locals.has(a.array))
        throw new Error(`${low.fn} names ${a.array}, which a group holds as a local`);
    const args = callArgs(c, i, inputs, store);
    const run = runKernelPlan(low.m, low.fn, low.plan, args);
    let at = 0;
    for (const a of c.calls[i]!.args) if ('array' in a) store.set(a.array, run.arrays[at++]!);
    if (run.result !== undefined) results.set(low.fn, run.result);
  }
  return outcomeOf(c, store, results);
}

const accessOf = (
  param: string,
  array: string,
  reads: ChainAccess['reads'],
  writes: ChainAccess['writes'],
): ChainAccess => ({ param, array, reads, writes, conditional: false, measures: false });

const arrayOfN = (id: string, o: { written: boolean; scratch: boolean }): ChainArray => ({
  id,
  elem: f32T,
  length: { of: 'n', times: 1 },
  ...o,
});

export function stencilChain(): ChainCorpus {
  const source = `"use typeshade";
export function produce(t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < t.length; i++) {
    t[i] = a[i] * 2. + 1.;
  }
}
export function stencil(out: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + t[i ^ 1];
  }
}
`;
  const r = compile(source, { fileName: '/app/stencil.shade.ts' });
  return {
    module: r.module,
    seed: 0,
    features: {},
    arrays: [
      arrayOfN('x0', { written: true, scratch: true }),
      arrayOfN('x1', { written: false, scratch: false }),
      arrayOfN('x2', { written: true, scratch: false }),
    ],
    calls: [
      {
        fn: 'produce',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x0' }, { array: 'x1' }],
        access: [accessOf('t', 'x0', 'none', 'i'), accessOf('a', 'x1', 'i', 'none')],
        continues: false,
        reduces: 0,
      },
      {
        fn: 'stencil',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x2' }, { array: 'x0' }],
        access: [accessOf('out', 'x2', 'none', 'i'), accessOf('t', 'x0', 'shifted', 'none')],
        continues: false,
        reduces: 0,
      },
    ],
  };
}

export function foldChain(fused: boolean): ChainCorpus {
  const source = `"use typeshade";
export function scale(t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < t.length; i++) {
    t[i] = a[i] * 2. + 1.;
  }
}
export function total(t: array<f32>): f32 {
  let s: f32 = 0.;
  let hi: f32 = -1000.;
  for (let i: u32 = 0; i < t.length; i++) {
    s += t[i];
    hi = max(hi, t[i]);
  }
  return s + hi;
}
`;
  const r = compile(source, { fileName: '/app/fold.shade.ts' });
  return fused
    ? {
        module: r.module,
        seed: -1,
        features: {},
        arrays: [
          arrayOfN('x0', { written: true, scratch: true }),
          arrayOfN('x1', { written: false, scratch: false }),
        ],
        calls: [
          {
            fn: 'scale',
            over: 'n',
            start: 0,
            step: 1,
            args: [{ array: 'x0' }, { array: 'x1' }],
            access: [accessOf('t', 'x0', 'none', 'i'), accessOf('a', 'x1', 'i', 'none')],
            continues: false,
            reduces: 0,
          },
          {
            fn: 'total',
            over: 'n',
            start: 0,
            step: 1,
            args: [{ array: 'x0' }],
            access: [accessOf('t', 'x0', 'i', 'none')],
            continues: false,
            reduces: 2,
          },
        ],
      }
    : {
        module: r.module,
        seed: -2,
        features: {},
        arrays: [arrayOfN('x0', { written: false, scratch: false })],
        calls: [
          {
            fn: 'total',
            over: 'n',
            start: 0,
            step: 1,
            args: [{ array: 'x0' }],
            access: [accessOf('t', 'x0', 'i', 'none')],
            continues: false,
            reduces: 2,
          },
        ],
      };
}

export function limitChain(): ChainCorpus {
  const source = `"use typeshade";
export function scaleA(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 2. + 1.;
  }
}
export function scaleB(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 3. + 2.;
  }
}
export function scaleC(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 4. + 3.;
  }
}
export function scaleD(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 5. + 4.;
  }
}
export function sum(t: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < t.length; i++) {
    s += t[i];
  }
  return s;
}
`;
  const r = compile(source, { fileName: '/app/limit.shade.ts' });
  const map = (fn: string, o: string, a: string): ChainCorpus['calls'][number] => ({
    fn,
    over: 'n',
    start: 0,
    step: 1,
    args: [{ array: o }, { array: a }],
    access: [accessOf('o', o, 'none', 'i'), accessOf('a', a, 'i', 'none')],
    continues: false,
    reduces: 0,
  });
  return {
    module: r.module,
    seed: -3,
    features: {},
    arrays: [
      arrayOfN('x0', { written: true, scratch: false }),
      arrayOfN('x1', { written: false, scratch: false }),
      arrayOfN('x2', { written: true, scratch: false }),
      arrayOfN('x3', { written: false, scratch: false }),
      arrayOfN('x4', { written: true, scratch: false }),
      arrayOfN('x5', { written: false, scratch: false }),
      arrayOfN('x6', { written: true, scratch: false }),
      arrayOfN('x7', { written: false, scratch: false }),
    ],
    calls: [
      map('scaleA', 'x0', 'x1'),
      map('scaleB', 'x2', 'x3'),
      map('scaleC', 'x4', 'x5'),
      map('scaleD', 'x6', 'x7'),
      {
        fn: 'sum',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x6' }],
        access: [accessOf('t', 'x6', 'i', 'none')],
        continues: false,
        reduces: 1,
      },
    ],
  };
}

export function localChain(): ChainCorpus {
  const source = `"use typeshade";
export function accumulate(t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < t.length; i++) {
    t[i] += a[i];
  }
}
export function spread(o: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = t[i] * 2.;
  }
}
`;
  const r = compile(source, { fileName: '/app/accumulate.shade.ts' });
  return {
    module: r.module,
    seed: -4,
    features: {},
    arrays: [
      arrayOfN('x0', { written: true, scratch: true }),
      arrayOfN('x1', { written: false, scratch: false }),
      arrayOfN('x2', { written: true, scratch: false }),
    ],
    calls: [
      {
        fn: 'accumulate',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x0' }, { array: 'x1' }],
        access: [accessOf('t', 'x0', 'i', 'i'), accessOf('a', 'x1', 'i', 'none')],
        continues: false,
        reduces: 0,
      },
      {
        fn: 'spread',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x2' }, { array: 'x0' }],
        access: [accessOf('o', 'x2', 'none', 'i'), accessOf('t', 'x0', 'i', 'none')],
        continues: false,
        reduces: 0,
      },
    ],
  };
}
