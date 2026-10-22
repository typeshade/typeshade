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
// The workgroup count may be one a kernel wrote (change 0075): `{ indirect, offset? }`, three
// elements of a `Resident<Uint32Array>`. WebGPU dispatches it with `dispatchWorkgroupsIndirect`
// and reads nothing back. The CPU tier and WebGL2 read the three elements from the host copy,
// brought up to date, when the call runs. A count with a 0 in it, or one past the device's
// `maxComputeWorkgroupsPerDimension`, runs nothing on every tier, as WebGPU's queue does.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import {
  boxed,
  checkBindings,
  configuredRuntime,
  describe,
  flavored,
  isBuffer,
  madeReport,
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
  type GpuDevice,
  type Workgroups,
} from './host-entry.js';
import { specializeEntry, checkEntryLimits, cpuSpecialization } from './host-overrides.js';
import { fuseSlot } from './fuse-scope.js';
import { defaultOwner, foreignOwner, type CallOwner } from './owner.js';
import { kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import { glContext } from './gl-context.js';
import { runGlCompute, type GlComputeReport } from './gl-compute.js';
import type { PlanRun } from './host-kernel.js';
import type { GlComputeProgram } from './passes/gl-compute.js';
import { uploadImage } from './host-draw.js';

function checkArity(e: ComputeEntry, argc: number): void {
  if (argc !== 2 && argc !== 3)
    throw new TypeError(
      `${e.name}() takes 2 or 3 arguments, (bindings, workgroups, options?); got ${argc}.`,
    );
}

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
  checkArity(e, argc);
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

/**
 * The `Resident` an indirect workgroup count names (change 0075), with the refusal that needs no
 * value: a scratch array of a `fuse` scope, which only a kernel call takes. Undefined for a count
 * that is no object with an `indirect` key, or whose `indirect` is no `Resident`: the check of the
 * call refuses those.
 *
 * @throws `TypeError` naming the entry and `workgroups.indirect`.
 */
export function indirectOf(e: ComputeEntry, workgroups: unknown): ResidentArrayState | undefined {
  if (typeof workgroups !== 'object' || workgroups === null || !('indirect' in workgroups))
    return undefined;
  const s = residentState(workgroups.indirect);
  const refusal = s?.outside?.(`${e.name}(): "workgroups.indirect"`);
  if (refusal !== undefined) throw refusal;
  return s;
}

/** An indirect workgroup count, checked (change 0075): the `Resident<Uint32Array>` that holds it
 *  and the element its three counts start at. */
export interface IndirectCount {
  readonly state: ResidentArrayState;
  readonly offset: number;
}

/** An entry call the call layer has checked (Rule 8.24): its Residents, its bindings with each
 *  Resident as its view, and the workgroups it dispatches: three counts, or the `Resident` that
 *  holds them (change 0075). Nothing has run or been uploaded. */
export interface CheckedEntry {
  /** The `Resident` each binding stands for, by binding. */
  readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
  readonly checked: Checked;
  readonly wg: readonly [number, number, number] | IndirectCount;
}

/**
 * The workgroups of a call, checked (Rule 8.24): three counts, or an indirect count (change 0075)
 * whose array is a live `Resident<Uint32Array>` with three elements from the offset, and is no
 * binding the entry writes, since WebGPU refuses a buffer that one dispatch reads its counts from
 * and writes.
 *
 * @throws `TypeError` naming the entry and `workgroups`, `workgroups.indirect` or
 *   `workgroups.offset`.
 */
function countsOf(
  e: ComputeEntry,
  workgroups: unknown,
  states: ReadonlyMap<EntryBinding, ResidentArrayState>,
): readonly [number, number, number] | IndirectCount {
  const wg = workgroupsOf(e, workgroups);
  if (Array.isArray(wg)) return wg;
  const { indirect, offset } = wg as { indirect: unknown; offset: number };
  const at = `${e.name}(): "workgroups.indirect"`;
  const s = indirectOf(e, workgroups);
  if (s === undefined)
    throw new TypeError(
      `${at} is a Resident<Uint32Array> that holds the workgroup counts; got ${describe(indirect)}.`,
    );
  if (s.destroyed)
    throw new TypeError(`${at}: this Resident was destroyed; make a new one with resident().`);
  const view = s.view();
  if (!(view instanceof Uint32Array))
    throw new TypeError(`${at} is a Resident<Uint32Array>; got a Resident of ${describe(view)}.`);
  if (offset + 3 > view.length)
    throw new TypeError(
      `${e.name}(): "workgroups.offset" is ${offset}, and the three counts from it need ${offset + 3} elements; the array holds ${view.length}.`,
    );
  for (const [b, t] of states)
    if (t === s && (b.writes || b.rw === true))
      throw new TypeError(
        `${at} is also binding "${b.name}", which the entry ${b.writes ? 'writes' : 'binds read_write'}. WebGPU cannot read the counts from a buffer that the same dispatch writes, so pass another Resident.`,
      );
  return { state: s, offset };
}

/**
 * Check a call of an entry before anything runs (Rule 8.24): the number of arguments, each
 * `Resident` for a binding it may stand for, a `Resident` once per binding, and every value
 * against its binding. Uploads nothing. A `Resident` of numbers or vectors is checked by its
 * element type and its length alone, and none of its elements is read (#717).
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
  const residents = new Set([...states.keys()].map((b) => b.name));
  return {
    states,
    checked: checkBindings(e, view, residents),
    wg: countsOf(e, workgroups, states),
  };
}

/** What a scope borrows of this file to record and run an entry call (change 0069), so that
 *  `typeshade/fuse` does not import the tiers of an entry (WebGL2, the CPU) to hold the plan. */
export const entryHost = { residentsOf, indirectOf, checkEntryCall, runEntry };

/**
 * Call a `@compute` entry from host code (Rule 8.24): dispatch `workgroups` workgroups of it,
 * or the three counts a `Resident<Uint32Array>` holds (`{ indirect, offset? }`, change 0075),
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
  options?: unknown,
): Promise<void> {
  let prepared = true;
  let refusal: unknown;
  try {
    checkArity(e, argc);
    e = specializeEntry(e, options);
  } catch (err) {
    if (fuseSlot.active !== undefined) throw err;
    // A queued call's written Residents must retain even a preparation error for read().
    // Keep its place in the queue, without ever dispatching it.
    prepared = false;
    refusal = err;
  }
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
  // The array of an indirect count is the default owner's too (change 0075).
  const foreign = foreignOwner(
    `${e.name}(): "workgroups.indirect"`,
    defaultOwner,
    typeof workgroups === 'object' && workgroups !== null && 'indirect' in workgroups
      ? residentState(workgroups.indirect)
      : undefined,
  );
  if (foreign !== undefined) return Promise.reject(foreign);
  const call = kernelQueue.run(async () => {
    if (!prepared) throw refusal;
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
      checkEntryLimits(e, d.limits ?? {});
      const onDevice = new Map<string, GpuBuffer>();
      for (const [b, s] of states)
        onDevice.set(
          b.name,
          s.bufferFor(d, b.layout, () => packed(b, s.host), b.writes),
        );
      // An indirect count is read from the array's device buffer, which the dispatch only reads
      // (change 0075): a newer host copy is uploaded, and a newer device copy stays.
      const grid: Workgroups =
        'state' in wg
          ? {
              buffer: wg.state.bufferFor(
                d,
                COUNTS,
                () => (wg.state.host as Uint32Array).slice().buffer,
                false,
              ),
              offset: 4 * wg.offset,
            }
          : wg;
      // The owner's flavor of the emulated double picks the WGSL and the guard (change 0073).
      const ge = flavored(e, owner.fp64Flavor());
      if (run === undefined) return onGpu(d, ge, { ...checked, onDevice }, grid);
      run.tiers.add('webgpu');
      await run.batchOn(d).add(ge, { ...checked, onDevice }, grid);
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
      run?.tiers.add('webgl2');
      const grid = await gridOf(wg, owner, run);
      if (grid === undefined) return;
      await hostCopies(states, checked.values, run);
      const passes = await onGl(gl, e, e.gl, checked, grid);
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
    run?.tiers.add('cpu');
    const grid = await gridOf(wg, owner, run);
    if (grid === undefined) return;
    await hostCopies(states, checked.values, run);
    if (e.overrideValues !== undefined) checkEntryLimits(e);
    const selected = cpuSpecialization(cpu, e);
    onCpu(selected.cpu, selected.entry, checked.values, grid);
    return;
  }
  // What the entry itself needs is the refusal the author can act on.
  if (noCpu !== undefined) throw new TypeError(`${e.name}() needs WebGPU: ${noCpu}.`);
  throw new Error(`${e.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

/** The layout of the array of an indirect count: `u32`s, 4 bytes each (change 0075). */
const COUNTS = { k: 'a', n: null, st: 4, e: { k: 's', t: 'u32' } } as const;

/** The specification's default of `maxComputeWorkgroupsPerDimension`. */
const MOST_WORKGROUPS = 65535;

/**
 * The grid a tier that runs on the host runs (change 0075): the counts as written, or the three
 * elements of an indirect count's array, read from its host copy brought up to date when the call
 * runs. Undefined when the grid has a 0 in it, or a count past the owner's WebGPU device's
 * `maxComputeWorkgroupsPerDimension` (65535 without one): WebGPU's queue runs nothing for either
 * (D5). A read of the device counts as a submission in the plan of a scope.
 */
async function gridOf(
  wg: readonly [number, number, number] | IndirectCount,
  owner: CallOwner,
  run: PlanRun | undefined,
): Promise<readonly [number, number, number] | undefined> {
  if (!('state' in wg)) return wg;
  // The counts are only read: a copy equal to the device's keeps the buffer as it is.
  if ((await wg.state.sync(true)) && run !== undefined) run.counts.submissions++;
  const words = wg.state.host as Uint32Array;
  const grid = [words[wg.offset]!, words[wg.offset + 1]!, words[wg.offset + 2]!] as const;
  // The limits of the device the owner holds, without asking for one: a bare call's is the
  // configured runtime's or the call layer's, once it is made.
  const limits =
    owner === defaultOwner
      ? ((configuredRuntime()?.device as GpuDevice | undefined)?.limits ?? madeReport()?.limits)
      : (await owner.device())?.limits;
  const most = limits?.maxComputeWorkgroupsPerDimension ?? MOST_WORKGROUPS;
  return grid.every((n) => n > 0 && n <= most) ? grid : undefined;
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
