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
// textures of words, and a `Resident` is the array it holds, as on the CPU tier. A scratch array
// of a `fuse` scope (change 0058) is no binding for an entry: the call is refused, and the
// refusal names the array as scratch.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import {
  boxed,
  checkBindings,
  flavored,
  isBuffer,
  onCpu,
  onGpu,
  packed,
  readInto,
  residentable,
  workgroupsOf,
  type Checked,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type GpuBuffer,
} from './host-entry.js';
import { fuseSlot } from './fuse-scope.js';
import { defaultOwner, foreignOwner } from './owner.js';
import { kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import { glContext } from './gl-context.js';
import { runGlCompute, type GlComputeReport } from './gl-compute.js';
import type { PlanRun } from './host-kernel.js';
import type { GlComputeProgram } from './passes/gl-compute.js';
import { uploadImage } from './host-draw.js';

/**
 * The `Resident` each binding of a call of `e` stands for (Rule 8.24), after the number of
 * arguments and the refusals that need no value: a `Resident` for a binding it may not stand for,
 * a scratch array of a `fuse` scope, and one `Resident` for two bindings. Reads no element.
 *
 * @throws `TypeError` naming the entry and the binding.
 */
export function residentsOf(
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
): Map<EntryBinding, ResidentArrayState> {
  if (argc !== 2)
    throw new TypeError(`${e.name}() takes 2 arguments, (bindings, workgroups); got ${argc}.`);
  const states = new Map<EntryBinding, ResidentArrayState>();
  if (typeof bindings === 'object' && bindings !== null && !Array.isArray(bindings))
    for (const b of e.bindings) {
      const s = residentState((bindings as Record<string, unknown>)[b.name]);
      if (s === undefined || !isBuffer(b)) continue;
      if (!residentable(b))
        throw new TypeError(
          `${e.name}(): binding "${b.name}" (${b.s}) takes no Resident: only a storage array with no size does.`,
        );
      // A scratch array of a `fuse` scope is for the kernel calls in the body of that scope
      // (change 0058). It holds no host array, so the check of the value below would name
      // "undefined": the handle says what it is.
      const refusal = s.outside?.(`${e.name}(): binding "${b.name}"`);
      if (refusal !== undefined) throw refusal;
      const twin = [...states].find(([, t]) => t === s);
      if (twin !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${b.name}" is the same resident array as binding "${twin[0].name}".`,
        );
      states.set(b, s);
    }
  return states;
}

/** An entry call the call layer has checked (Rule 8.24): its Residents, its bindings with each
 *  Resident as its view, and the workgroups it dispatches. Nothing has run or been uploaded. */
export interface CheckedEntry {
  /** The `Resident` each binding stands for, by binding. */
  readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
  readonly checked: Checked;
  readonly wg: readonly [number, number, number];
}

/**
 * Check a call of an entry before anything runs (Rule 8.24): the number of arguments, each
 * `Resident` for a binding it may stand for, a `Resident` once per binding, and every value
 * against its binding. Reads no element and uploads nothing.
 *
 * @throws `TypeError` naming the entry and the binding.
 */
export function checkEntryCall(
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
): CheckedEntry {
  const states = residentsOf(e, argc, bindings);
  // A `Resident` stands for the array it holds.
  let view = bindings;
  if (typeof bindings === 'object' && bindings !== null && !Array.isArray(bindings)) {
    const o: Record<string, unknown> = { ...(bindings as Record<string, unknown>) };
    for (const [b, s] of states) o[b.name] = s.view();
    view = o;
  }
  // Every value is checked before anything runs or is uploaded.
  return { states, checked: checkBindings(e, view), wg: workgroupsOf(e, workgroups) };
}

/** What a scope borrows of this file to record and run an entry call (change 0069), so that
 *  `typeshade/fuse` does not import the tiers of an entry (WebGL2, the CPU) to hold the plan. */
export const entryHost = { residentsOf, checkEntryCall, runEntry };

/**
 * Call a `@compute` entry from host code (Rule 8.24): dispatch `workgroups` workgroups of it
 * with `bindings` on the first tier `configure` allows that can run it (Rule 11.8), WebGPU and
 * then the CPU tier by default, and read every storage binding it writes back into the caller's
 * value in place, or leave it on the device in a `Resident`. Calls run one after another, in
 * the order they were made.
 *
 * @throws `TypeError` naming the entry and the binding for a value that does not fit, and for
 *   an entry the CPU tier cannot run (a barrier, a texture) where WebGPU does not run it, and
 *   for a scratch array of a `fuse` scope, which only the kernel calls in the body take;
 *   `Error` when no tier it may use can run it. A call made inside the body of `fuse()` is
 *   recorded and forms a group of its own in the scope's plan (Rule 11.13, change 0069).
 */
export function callCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
): Promise<void> {
  if (fuseSlot.active !== undefined)
    return fuseSlot.active.entry(cpu, e, argc, bindings, workgroups, entryHost);
  const written: ResidentArrayState[] = [];
  if (typeof bindings === 'object' && bindings !== null)
    for (const b of e.bindings) {
      const s = residentState((bindings as Record<string, unknown>)[b.name]);
      // A bare call is the default owner's: it takes no array a device made (change 0071).
      const foreign = foreignOwner(`${e.name}(): binding "${b.name}"`, defaultOwner, s);
      if (foreign !== undefined) return Promise.reject(foreign);
      if (s !== undefined && isBuffer(b) && b.writes) written.push(s);
    }
  const call = kernelQueue.run(async () => {
    await runEntry(cpu, e, checkEntryCall(e, argc, bindings, workgroups), undefined);
  });
  // A call nobody awaits keeps its error on what it writes, for `read()` to throw.
  call.then(
    () => written.forEach((s) => (s.error = undefined)),
    (err: unknown) => written.forEach((s) => (s.error = err)),
  );
  return call;
}

/**
 * Run a checked entry call on the first tier that can run it (Rule 11.8). Outside a scope
 * (`run` absent) the dispatch is its own submission. In the plan of a scope (`run`, change 0069)
 * the WebGPU dispatch joins the plan's batch, and a tier that reads the host first submits the
 * batch before it. Returns what the call wrote, in place.
 *
 * @throws `TypeError` for an entry the CPU tier cannot run and no other tier runs, naming what the
 *   entry reaches; `Error` naming each tier's reason otherwise.
 */
export async function runEntry(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  c: CheckedEntry,
  run: PlanRun | undefined,
): Promise<void> {
  const { states, checked, wg } = c;
  const why: string[] = [];
  let noCpu: string | undefined;
  // A bare call is the default owner's; a plan's call is its scope's owner's (change 0071).
  const owner = run?.owner ?? defaultOwner;
  for (const tier of owner.tiers()) {
    if (tier === 'webgpu') {
      const d = await owner.device();
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
      // The owner's flavor of the emulated double picks the WGSL and the guard (change 0073).
      const ge = flavored(e, owner.fp64Flavor());
      if (run === undefined) return onGpu(d, ge, { ...checked, onDevice }, wg);
      run.tiers.add('webgpu');
      await run.batchOn(d).add(ge, { ...checked, onDevice }, wg);
      return;
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
      await run?.flush();
      await hostCopies(states, checked.values, run);
      run?.tiers.add('webgl2');
      const passes = await onGl(gl, e, e.gl, checked, wg);
      if (run !== undefined) run.counts.dispatches += passes;
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
    await run?.flush();
    await hostCopies(states, checked.values, run);
    run?.tiers.add('cpu');
    onCpu(cpu, e, checked.values, wg);
    return;
  }
  // What the entry itself needs is the refusal the author can act on.
  if (noCpu !== undefined) throw new TypeError(`${e.name}() needs WebGPU: ${noCpu}.`);
  throw new Error(`${e.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

/** Bring each resident binding's host copy up to date for a tier that runs on the host, and give
 *  the call that copy: a zeroed array has none until now, and the check saw the zeros it would
 *  hold, so a call that writes the array writes the copy and not those zeros (change 0065). In the
 *  plan of a scope (`run`), a read of the device counts as a submission, as it does for a kernel
 *  call. */
async function hostCopies(
  states: ReadonlyMap<EntryBinding, ResidentArrayState>,
  values: Record<string, unknown>,
  run: PlanRun | undefined,
): Promise<void> {
  for (const [b, s] of states) {
    // A read of the device is a submission, which the report of a scope counts.
    if ((await s.sync()) && run !== undefined) run.counts.submissions++;
    values[b.name] = s.host;
  }
}

/** Run `e` on WebGL2: each storage binding packed to words, the uniforms as the host gave them,
 *  each image an `RGBA8` texture with its sampler's filter and address, and every storage
 *  binding the entry writes read back into the caller's value in place. */
async function onGl(
  gl: WebGL2RenderingContext,
  e: ComputeEntry,
  program: GlComputeProgram,
  checked: Checked,
  wg: readonly [number, number, number],
): Promise<number> {
  const values = checked.values;
  const memory: Record<string, Uint32Array> = {};
  const uniforms: Record<string, unknown> = {};
  for (const b of e.bindings) {
    if (!isBuffer(b)) continue;
    if (b.space === 'uniform') uniforms[b.name] = values[b.name];
    else memory[b.name] = new Uint32Array(packed(b, values[b.name]));
  }
  const textures: Record<string, { texture: WebGLTexture }> = {};
  let report: GlComputeReport | undefined;
  try {
    for (const t of program.textures ?? []) {
      const img = checked.images.get(t.name)!;
      if (img.view !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${t.name}" is a Texture on the WebGPU device, which the WebGL2 tier cannot read; pass an image source for a call that may fall back.`,
        );
      // An unpaired texture is only loaded or measured, which no filter changes; a texture
      // with no mipmaps still needs a filter that reads none.
      const s = (t.sampler !== null ? checked.samplers.get(t.sampler) : undefined) ?? {
        filter: 'nearest',
        address: 'clamp',
      };
      const tex = gl.createTexture()!;
      textures[t.name] = { texture: tex };
      gl.bindTexture(gl.TEXTURE_2D, tex);
      uploadImage(gl, img.source, s);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    report = await runGlCompute(gl, program, { workgroups: wg, memory, uniforms, textures });
  } finally {
    for (const { texture } of Object.values(textures)) gl.deleteTexture(texture);
  }
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
  return report!.passes;
}
