// ═══ Lockstep dispatch of a compute entry on the CPU (roadmap 0.2 item 5, #82) ═══
//
// The oracle runs one invocation per call, which is right for everything but a barrier: a
// `workgroupBarrier()` means "every invocation of this workgroup has finished the statements
// before this line", and one invocation run to completion has no one to wait for. This file
// runs a workgroup's invocations in phases instead. Each invocation is the debug interpreter's
// generator, which yields before every statement; the scheduler advances each one until the
// statement it is about to run is a barrier, or it finishes, and only when every live
// invocation has arrived does it let them all past. What every invocation left in the shared
// workgroup memory is then what every other one reads after the barrier, which is the GPU's
// guarantee.
//
// Invocations of one workgroup that do not agree about a barrier (some return before it, some
// reach a different one) are a program WGSL forbids, since a barrier must sit in uniform
// control flow, and a GPU would hang or misbehave on; here it is an error naming the barrier's
// line and the counts, the first divergence report roadmap item 21 asks for.

import { zeroOf, type CpuValue } from '../cpu-runtime.js'
import { stageOf, workgroupSizeOf, type FuncDecl, type ModuleDecl, type Stmt } from '../ir/index.js'
import { sourceSpanOf } from '../ir/span.js'
import { isBarrierIntrinsic } from '../intrinsics.js'
import { validate } from '../passes/validate.js'
import { autoVars } from '../passes/opt/index.js'
import { froundF32 } from '../passes/precision.js'
import { evalExpr, makeCtx, runFunction, type StepCtx } from './interp.js'
import type { CpuPrecision, DispatchReport } from '../oracle.js'

/** The shape of `workgroups` a dispatch takes: one number for a 1-D grid, or the three counts. */
export type WorkgroupCount = number | readonly [number, number, number]

const isBarrierStmt = (s: Stmt): boolean =>
  s.s === 'call' &&
  s.expr.op === 'call' &&
  s.expr.declRef === undefined &&
  isBarrierIntrinsic(s.expr.fn)

function drain<T>(g: Generator<unknown, T, void>): T {
  for (;;) {
    const n = g.next()
    if (n.done) return n.value
  }
}

type Vec3 = readonly [number, number, number]

/** The value an entry parameter takes for one invocation: its `@builtin`, or the zero of its
 *  type for a parameter the dispatch has nothing for. */
function paramValue(
  p: FuncDecl['params'][number],
  gid: Vec3,
  lid: Vec3,
  lidx: number,
  wid: Vec3,
  nwg: Vec3,
): CpuValue {
  switch (p.builtin) {
    case 'global_invocation_id':
      return [...gid]
    case 'local_invocation_id':
      return [...lid]
    case 'local_invocation_index':
      return lidx
    case 'workgroup_id':
      return [...wid]
    case 'num_workgroups':
      return [...nwg]
    default:
      return zeroOf(p.type)
  }
}

interface Run {
  readonly gen: ReturnType<typeof runFunction>
  done: boolean
  /** The barrier statement this invocation is paused before, once it has arrived at one. */
  at: Stmt | undefined
}

/** Advance one invocation until it is about to run a barrier, or it finishes. */
function advance(r: Run): void {
  r.at = undefined
  for (;;) {
    const n = r.gen.next()
    if (n.done) {
      r.done = true
      return
    }
    if (n.value.afterCall) continue
    if (isBarrierStmt(n.value.stmt)) {
      r.at = n.value.stmt
      return
    }
  }
}

/** Run the `@compute` entry `entry` of `m` over `workgroups` workgroups of its declared size,
 *  every invocation of a workgroup in lockstep at each barrier. `bindings` is the host's
 *  binding table: arrays are shared and written in place, and a scalar a kernel wrote is
 *  copied back when the dispatch ends. Workgroup memory starts zero for each workgroup; a
 *  per-invocation variable starts at its initializer for each invocation.
 *
 *  Throws when the entry is not a compute entry, and when the invocations of one workgroup
 *  disagree about a barrier: some finished while others wait at one, or they wait at different
 *  ones. */
export function dispatchCompute(
  m: ModuleDecl,
  entry: string,
  workgroups: WorkgroupCount,
  bindings: Record<string, CpuValue>,
  opts?: { readonly gpuStubs?: boolean; readonly precision?: CpuPrecision },
): DispatchReport {
  validate(m)
  let prepared = autoVars(m)
  if (opts?.precision === 'f32') prepared = froundF32(prepared)
  const decl = prepared.funcs.find((f) => f.name === entry)
  if (!decl) throw new Error(`typeshade/cpu: no function "${entry}" in module`)
  if (stageOf(decl) !== 'compute') {
    throw new Error(
      `typeshade/cpu: dispatch runs a @compute entry; "${entry}" is ${stageOf(decl) ?? 'a helper function'}`,
    )
  }
  // The front end carries the x size alone today (`@compute([n, 1, 1])`, TS8028 otherwise).
  const size: Vec3 = [workgroupSizeOf(decl) ?? 64, 1, 1]
  const nwg: Vec3 = typeof workgroups === 'number' ? [workgroups, 1, 1] : workgroups
  const base = makeCtx(prepared, opts?.gpuStubs ?? false)
  for (const [k, v] of Object.entries(bindings)) base.bindings[k] = v
  const vars = prepared.vars ?? []
  const privatesOf = (): Record<string, CpuValue> => {
    const out: Record<string, CpuValue> = {}
    for (const v of vars) {
      if (v.space !== 'private') continue
      out[v.name] = v.init ? drain(evalExpr(v.init, new Map(), base)) : zeroOf(v.type, base.structs)
    }
    return out
  }
  let phases = 0
  let invocations = 0
  for (let wz = 0; wz < nwg[2]; wz++) {
    for (let wy = 0; wy < nwg[1]; wy++) {
      for (let wx = 0; wx < nwg[0]; wx++) {
        const wid: Vec3 = [wx, wy, wz]
        for (const v of vars) {
          if (v.space === 'workgroup') base.vars[v.name] = zeroOf(v.type, base.structs)
        }
        const runs: Run[] = []
        for (let lz = 0; lz < size[2]; lz++) {
          for (let ly = 0; ly < size[1]; ly++) {
            for (let lx = 0; lx < size[0]; lx++) {
              const lid: Vec3 = [lx, ly, lz]
              const gid: Vec3 = [wx * size[0] + lx, wy * size[1] + ly, wz * size[2] + lz]
              const lidx = lx + ly * size[0] + lz * size[0] * size[1]
              const args = decl.params.map((p) => paramValue(p, gid, lid, lidx, wid, nwg))
              const ctx: StepCtx = {
                ...base,
                privates: privatesOf(),
                lockstep: true,
                frames: [],
                stubbed: new Set<string>(),
                stubHits: 0,
              }
              runs.push({
                gen: runFunction(decl, args, undefined, ctx),
                done: false,
                at: undefined,
              })
            }
          }
        }
        invocations += runs.length
        for (;;) {
          for (const r of runs) if (!r.done) advance(r)
          const waiting = runs.filter((r) => !r.done)
          if (waiting.length === 0) break
          const finished = runs.length - waiting.length
          const at = waiting[0]!.at!
          const fn = at.s === 'call' && at.expr.op === 'call' ? at.expr.fn : 'barrier'
          const where = sourceSpanOf(at)
          const line = where === undefined ? 'a line without a span' : `line ${where.line}`
          if (finished > 0) {
            throw new Error(
              `typeshade/cpu: ${fn}() at ${line} was reached by ${waiting.length} of ${runs.length} ` +
                `invocations of workgroup (${wid.join(', ')}); ${finished} returned before it. Every ` +
                `invocation of a workgroup must reach the same barrier: move it out of the branch, ` +
                `or the early return ahead of it.`,
            )
          }
          if (waiting.some((r) => r.at !== at)) {
            throw new Error(
              `typeshade/cpu: the invocations of workgroup (${wid.join(', ')}) wait at different ` +
                `barriers (one at ${line}). Every invocation of a workgroup must reach the same ` +
                `barrier in the same order.`,
            )
          }
          phases++
        }
      }
    }
  }
  // A scalar binding the kernel wrote lives in the run's own table; hand it back.
  for (const k of Object.keys(base.bindings)) bindings[k] = base.bindings[k] as CpuValue
  return { workgroups: nwg[0] * nwg[1] * nwg[2], invocations, barrierPhases: phases }
}
