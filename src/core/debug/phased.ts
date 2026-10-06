// ═══ A compute dispatch run in phases on the CPU (change 0054, the WebGL2 execution model) ═══
//
// `passes/phase-split.ts` cuts a compute entry into phases. This file runs the result the way
// the WebGL2 tier will, one pass at a time over every invocation of the dispatch:
//
//   - In a pass, each live invocation that is not waiting at a barrier runs its phase
//     function from its resume point to its next cut. It reads memory as the pass found it,
//     plus its own writes: each write it makes is recorded and undone when its run ends.
//   - The scatter then does every invocation's writes again, in invocation index order.
//   - The resolve pass performs the atomic operation of every invocation that stopped before
//     one, in invocation index order, and gives each its value.
//   - A workgroup whose live invocations all wait at the same barrier is released; one whose
//     invocations disagree about a barrier is an error, as in `dispatch.ts`.
//
// Invocation index order is the order of the workgroups (x fastest, then y, then z) and,
// within one, of `local_invocation_index`.

import { zeroOf, type CpuValue } from '../cpu-runtime.js';
import { stageOf, workgroupShapeOf, type ModuleDecl } from '../ir/index.js';
import { sourceSpanOf } from '../ir/span.js';
import { validate } from '../passes/validate.js';
import { autoVars } from '../passes/opt/index.js';
import { froundF32 } from '../passes/precision.js';
import { splitPhases, type PhaseCut, type PhasePlan } from '../passes/phase-split.js';
import {
  drain,
  evalExpr,
  makeCtx,
  runFunction,
  type JournalEntry,
  type StepCtx,
} from './interp.js';
import { paramValue, type WorkgroupCount } from './dispatch.js';
import type { ConsoleSink } from '../console.js';
import type { CpuPrecision, DispatchReport } from '../oracle.js';

/** What a phased dispatch did: {@link DispatchReport}, and how many passes it ran. */
export interface PhasedReport extends DispatchReport {
  readonly passes: number;
}

export type Vec3 = readonly [number, number, number];

interface Invocation extends Scheduled {
  readonly workgroup: number;
  readonly wid: Vec3;
  readonly gid: Vec3;
  readonly args: CpuValue[];
  readonly privates: Record<string, CpuValue>;
  waiting: boolean;
  log: JournalEntry[];
}

export interface PhasedOptions {
  readonly gpuStubs?: boolean;
  readonly precision?: CpuPrecision;
  readonly consoleSink?: ConsoleSink;
  /** The write log's size; four by default (change 0054, decision 4). */
  readonly logEntries?: number;
}

/** Split the `@compute` entry `entry` of `m` into phases and run it over `workgroups`, as
 *  `dispatchCompute` does with the same arguments, but in the WebGL2 tier's order. */
export function dispatchPhased(
  m: ModuleDecl,
  entry: string,
  workgroups: WorkgroupCount,
  bindings: Record<string, CpuValue>,
  opts?: PhasedOptions,
): PhasedReport {
  validate(m);
  let prepared = autoVars(m);
  if (opts?.precision === 'f32') prepared = froundF32(prepared);
  const decl = prepared.funcs.find((f) => f.name === entry);
  if (!decl) throw new Error(`typeshade/cpu: no function "${entry}" in module`);
  if (stageOf(decl) !== 'compute') {
    throw new Error(
      `typeshade/cpu: dispatch runs a @compute entry; "${entry}" is ${stageOf(decl) ?? 'a helper function'}`,
    );
  }
  const plan = splitPhases(prepared, entry, {
    ...(opts?.logEntries !== undefined ? { logEntries: opts.logEntries } : {}),
  });
  return runPlan(plan, workgroups, bindings, opts);
}

/** Run a split entry over `workgroups` workgroups against `bindings`, which it writes in place;
 *  a scalar binding the entry wrote is copied back when the dispatch ends. */
export function runPlan(
  plan: PhasePlan,
  workgroups: WorkgroupCount,
  bindings: Record<string, CpuValue>,
  opts?: PhasedOptions,
): PhasedReport {
  const m = plan.module;
  const decl = m.funcs.find((f) => f.name === plan.entry)!;
  const size: Vec3 = workgroupShapeOf(decl) ?? [64, 1, 1];
  const nwg: Vec3 = typeof workgroups === 'number' ? [workgroups, 1, 1] : workgroups;
  const base = makeCtx(m, opts?.gpuStubs ?? false);
  for (const [k, v] of Object.entries(bindings)) base.bindings[k] = v;
  const vars = m.vars ?? [];
  const privatesOf = (): Record<string, CpuValue> => {
    const out: Record<string, CpuValue> = {};
    for (const v of vars) {
      if (v.space !== 'private') continue;
      out[v.name] = v.init
        ? drain(evalExpr(v.init, new Map(), base))
        : zeroOf(v.type, base.structs);
    }
    return out;
  };
  const memory: Record<string, CpuValue>[] = [];
  const invocations: Invocation[] = [];
  for (let wz = 0; wz < nwg[2]; wz++) {
    for (let wy = 0; wy < nwg[1]; wy++) {
      for (let wx = 0; wx < nwg[0]; wx++) {
        const wid: Vec3 = [wx, wy, wz];
        const shared: Record<string, CpuValue> = {};
        for (const v of vars) {
          if (v.space === 'workgroup') shared[v.name] = zeroOf(v.type, base.structs);
        }
        memory.push(shared);
        for (let lz = 0; lz < size[2]; lz++) {
          for (let ly = 0; ly < size[1]; ly++) {
            for (let lx = 0; lx < size[0]; lx++) {
              const lid: Vec3 = [lx, ly, lz];
              const gid: Vec3 = [wx * size[0] + lx, wy * size[1] + ly, wz * size[2] + lz];
              const lidx = lx + ly * size[0] + lz * size[0] * size[1];
              invocations.push({
                workgroup: memory.length - 1,
                wid,
                gid,
                args: decl.params.map((p) => paramValue(p, gid, lid, lidx, wid, nwg)),
                privates: privatesOf(),
                waiting: false,
                log: [],
              });
            }
          }
        }
      }
    }
  }
  const ctxOf = (inv: Invocation, journal: JournalEntry[] | undefined): StepCtx => ({
    ...base,
    vars: memory[inv.workgroup]!,
    privates: inv.privates,
    ...(journal ? { journal } : {}),
    ...(opts?.consoleSink ? { consoleSink: opts.consoleSink, invocation: inv.gid } : {}),
    frames: [],
    stubbed: new Set<string>(),
    stubHits: 0,
  });
  const { passes, barrierPhases } = schedulePasses(plan, invocations, size, {
    pass(runnable) {
      // Each invocation runs against memory as the pass found it, plus its own writes.
      for (const inv of runnable) {
        const journal: JournalEntry[] = [];
        drain(runFunction(decl, inv.args, undefined, ctxOf(inv, journal)));
        for (let i = journal.length - 1; i >= 0; i--) journal[i]!.undo();
        inv.log = journal;
      }
      // The scatter, in invocation index order.
      for (const inv of runnable) {
        for (const entry of inv.log) entry.redo();
        inv.log = [];
      }
    },
    resolve(inv, cut) {
      const value = drain(evalExpr(cut.request, new Map(), ctxOf(inv, undefined)));
      if (cut.result !== undefined) inv.privates[cut.result] = value;
    },
  });
  for (const k of Object.keys(base.bindings)) bindings[k] = base.bindings[k] as CpuValue;
  return {
    workgroups: nwg[0] * nwg[1] * nwg[2],
    invocations: invocations.length,
    barrierPhases,
    passes,
  };
}

/** What {@link schedulePasses} needs of an invocation. */
export interface Scheduled {
  readonly wid: Vec3;
  readonly privates: Record<string, CpuValue>;
  waiting: boolean;
}

/** The passes of a split entry over `invocations`, in invocation index order, `size` to a
 *  workgroup: release each workgroup whose live invocations all wait at one barrier, run a pass
 *  of the rest (`hooks.pass`: run each, then scatter), then resolve, in index order, the atomic
 *  operation of each invocation that stopped before one (`hooks.resolve`). The phased oracle and
 *  the CPU model of the WebGL2 executor differ only in their memory, which the hooks own.
 *
 *  Throws when the invocations of a workgroup disagree about a barrier, with `dispatch.ts`'s
 *  words. */
export function schedulePasses<I extends Scheduled>(
  plan: PhasePlan,
  invocations: readonly I[],
  size: Vec3,
  hooks: {
    readonly pass: (runnable: readonly I[]) => void;
    readonly resolve: (inv: I, cut: PhaseCut & { kind: 'atomic' }, pc: number) => void;
  },
): { readonly passes: number; readonly barrierPhases: number } {
  const pcOf = (inv: I): number => inv.privates[plan.pc] as number;
  const perGroup = size[0] * size[1] * size[2];
  const groups = invocations.length / perGroup;
  let passes = 0;
  let barrierPhases = 0;
  for (;;) {
    const live = invocations.filter((inv) => pcOf(inv) !== plan.done);
    if (live.length === 0) break;
    // Release each workgroup whose live invocations all wait at one barrier.
    for (let w = 0; w < groups; w++) {
      const group = invocations.slice(w * perGroup, (w + 1) * perGroup);
      const alive = group.filter((inv) => pcOf(inv) !== plan.done);
      if (alive.length === 0 || !alive.every((inv) => inv.waiting)) continue;
      const at = pcOf(alive[0]!);
      const cut = plan.cuts.get(at);
      const fn = cut?.kind === 'barrier' ? cut.fn : 'barrier';
      const where = cut?.kind === 'barrier' && cut.stmt ? sourceSpanOf(cut.stmt) : undefined;
      const line = where === undefined ? 'a line without a span' : `line ${where.line}`;
      const wid = alive[0]!.wid;
      if (alive.length < group.length) {
        throw new Error(
          `typeshade/cpu: ${fn}() at ${line} was reached by ${alive.length} of ${group.length} ` +
            `invocations of workgroup (${wid.join(', ')}); ${group.length - alive.length} returned before it. Every ` +
            `invocation of a workgroup must reach the same barrier: move it out of the branch, ` +
            `or the early return ahead of it.`,
        );
      }
      if (alive.some((inv) => pcOf(inv) !== at)) {
        throw new Error(
          `typeshade/cpu: the invocations of workgroup (${wid.join(', ')}) wait at different ` +
            `barriers (one at ${line}). Every invocation of a workgroup must reach the same ` +
            `barrier in the same order.`,
        );
      }
      for (const inv of alive) inv.waiting = false;
      barrierPhases++;
    }
    const runnable = live.filter((inv) => !inv.waiting);
    hooks.pass(runnable);
    passes++;
    // The resolve pass, in invocation index order.
    for (const inv of runnable) {
      const pc = pcOf(inv);
      const cut = plan.cuts.get(pc);
      if (cut === undefined || pc === plan.done) continue;
      if (cut.kind === 'barrier') inv.waiting = true;
      else if (cut.kind === 'atomic') hooks.resolve(inv, cut, pc);
    }
  }
  return { passes, barrierPhases };
}
