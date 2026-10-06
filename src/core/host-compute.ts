// ═══ A `@compute` entry's call: its order, its tiers and its resident bindings ═══
// ═══ (Rules 8.24 and 11.8, surface §67, change 0016)                          ═══
//
// `entry(bindings, workgroups)` runs in the order the host made it, after every kernel call and
// entry call before it, as a kernel call does (`core/resident.ts`), so an entry and a kernel
// function can share a `Resident` and see each other's writes.
//
// A runtime-sized storage array binding may be a `Resident` (0013's handle): on WebGPU it is
// bound as the buffer it already has on the device and nothing is read back; on the CPU tier it
// is the array the handle holds, brought up to date first. The tiers are tried in the order
// `configure({ prefer })` sets: WebGPU, WebGL2, then the CPU tier. WebGL2 has no compute stage;
// there the entry runs as the pass program of change 0054 (`gl-compute.ts`), its storage as
// textures of words, and a `Resident` is the array it holds, as on the CPU tier.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import {
  boxed,
  checkBindings,
  gpuDevice,
  isBuffer,
  onCpu,
  onGpu,
  packed,
  readInto,
  workgroupsOf,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type GpuBuffer,
} from './host-entry.js';
import { kernelQueue, preferredTiers, residentState, type ResidentArrayState } from './resident.js';
import { glContext } from './host-kernel-gl.js';
import { runGlCompute } from './gl-compute.js';
import type { GlComputeProgram } from './passes/gl-compute.js';

/** A binding a `Resident` may stand for: a storage array with no size. */
const residentable = (b: EntryBinding): boolean =>
  b.space === 'storage' && b.layout.k === 'a' && b.layout.n === null;

/**
 * Call a `@compute` entry from host code (Rule 8.24): dispatch `workgroups` workgroups of it
 * with `bindings` on the first tier `configure` allows that can run it (Rule 11.8), WebGPU and
 * then the CPU tier by default, and read every storage binding it writes back into the caller's
 * value in place, or leave it on the device in a `Resident`. Calls run one after another, in
 * the order they were made.
 *
 * @throws `TypeError` naming the entry and the binding for a value that does not fit, and for
 *   an entry the CPU tier cannot run (a barrier, a texture) where WebGPU does not run it;
 *   `Error` when no tier it may use can run it.
 */
export function callCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
): Promise<void> {
  const written: ResidentArrayState[] = [];
  if (typeof bindings === 'object' && bindings !== null)
    for (const b of e.bindings) {
      const s = residentState((bindings as Record<string, unknown>)[b.name]);
      if (s !== undefined && isBuffer(b) && b.writes) written.push(s);
    }
  const call = kernelQueue.run(() => runCompute(cpu, e, argc, bindings, workgroups));
  // A call nobody awaits keeps its error on what it writes, for `read()` to throw.
  call.then(
    () => written.forEach((s) => (s.error = undefined)),
    (err: unknown) => written.forEach((s) => (s.error = err)),
  );
  return call;
}

async function runCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
): Promise<void> {
  if (argc !== 2)
    throw new TypeError(`${e.name}() takes 2 arguments, (bindings, workgroups); got ${argc}.`);
  // A `Resident` stands for the array it holds.
  const states = new Map<EntryBinding, ResidentArrayState>();
  let view = bindings;
  if (typeof bindings === 'object' && bindings !== null && !Array.isArray(bindings)) {
    const o: Record<string, unknown> = { ...(bindings as Record<string, unknown>) };
    for (const b of e.bindings) {
      const s = residentState(o[b.name]);
      if (s === undefined || !isBuffer(b)) continue;
      if (!residentable(b))
        throw new TypeError(
          `${e.name}(): binding "${b.name}" (${b.s}) takes no Resident: only a storage array with no size does.`,
        );
      const twin = [...states].find(([, t]) => t === s);
      if (twin !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${b.name}" is the same resident array as binding "${twin[0].name}".`,
        );
      states.set(b, s);
      o[b.name] = s.host;
    }
    view = o;
  }
  // Every value is checked before anything runs or is uploaded.
  const checked = checkBindings(e, view);
  const wg = workgroupsOf(e, workgroups);
  const why: string[] = [];
  let noCpu: string | undefined;
  for (const tier of preferredTiers()) {
    if (tier === 'webgpu') {
      const d = await gpuDevice();
      if (d === null) {
        why.push('webgpu: there is no WebGPU device');
        continue;
      }
      const onDevice = new Map<string, GpuBuffer>();
      for (const [b, s] of states)
        onDevice.set(
          b.name,
          s.bufferFor(d, b.layout, () => packed(b, s.host), b.writes),
        );
      return onGpu(d, e, { ...checked, onDevice }, wg);
    }
    if (tier === 'webgl2') {
      if (e.gl === undefined) {
        why.push(`webgl2: ${e.noGl ?? 'the entry has no WebGL2 program'}`);
        continue;
      }
      const gl = glContext();
      if (gl === null) {
        why.push('webgl2: there is no WebGL2 context');
        continue;
      }
      for (const s of states.values()) await s.sync();
      onGl(gl, e, e.gl, checked.values, wg);
      return;
    }
    noCpu =
      e.barrier !== undefined
        ? `it reaches ${e.barrier}, and a barrier has no CPU tier`
        : e.noCpu !== undefined
          ? `${e.noCpu}, and the CPU tier cannot`
          : undefined;
    if (noCpu !== undefined) {
      why.push(`cpu: ${noCpu}`);
      continue;
    }
    for (const s of states.values()) await s.sync();
    onCpu(cpu, e, checked.values, wg);
    return;
  }
  // What the entry itself needs is the refusal the author can act on.
  if (noCpu !== undefined) throw new TypeError(`${e.name}() needs WebGPU: ${noCpu}.`);
  throw new Error(`${e.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

/** Run `e` on WebGL2: each storage binding packed to words, the uniforms as the host gave them,
 *  and every storage binding the entry writes read back into the caller's value in place. */
function onGl(
  gl: WebGL2RenderingContext,
  e: ComputeEntry,
  program: GlComputeProgram,
  values: Record<string, unknown>,
  wg: readonly [number, number, number],
): void {
  const memory: Record<string, Uint32Array> = {};
  const uniforms: Record<string, unknown> = {};
  for (const b of e.bindings) {
    if (!isBuffer(b)) continue;
    if (b.space === 'uniform') uniforms[b.name] = values[b.name];
    else memory[b.name] = new Uint32Array(packed(b, values[b.name]));
  }
  runGlCompute(gl, program, { workgroups: wg, memory, uniforms });
  for (const b of e.bindings) {
    if (!isBuffer(b) || b.space !== 'storage' || !b.writes) continue;
    const dv = new DataView(memory[b.name]!.buffer);
    if (boxed(b))
      (values[b.name] as { [i: number]: number })[0] = readInto(
        dv,
        0,
        b.layout,
        undefined,
      ) as number;
    else readInto(dv, 0, b.layout, values[b.name]);
  }
}
