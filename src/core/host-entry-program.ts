// ═══ A `@compute` entry's call as a program-runtime pipeline and pass (change 0120, D2) ═══
//
// `entry(bindings, workgroups)` outside a `fuse` scope runs here once `core/host-compute.ts` has
// checked it, put it in its place in the call queue and chosen its tier (Rules 8.24 and 11.8).
// Each tier runs it through the program runtime of `src/runtime/`, as a full-screen draw runs
// (`core/host-draw.ts`, the owner's decision of 2026-11-09, "Program 객체까지 통일"):
//
//   - WebGPU: a `ProgramImpl` of `RuntimeImpl` over the owner's device, its compute pipeline, and
//     one compute pass in one submission. Each buffer binding is packed at the call into a buffer
//     of the runtime's pool, bound with the size it holds; a `Resident` is bound as its device
//     buffer, and an indirect count is dispatched from its buffer. What the entry wrote is copied
//     to staging buffers of the pool in the same submission and read back into the caller's value
//     in place. A module's entries share one shader module on each device.
//   - WebGL2: a `Program` of `GlRuntimeImpl` over the call layer's context, its compute pipeline
//     (the pass program the entry record carries, change 0054), and one dispatch in a frame run
//     at once, in the call's place in the queue. Each storage binding is its packed words, which
//     the dispatch runs on in place and the call reads back.
//   - The CPU tier: a `ProgramImpl` of `RuntimeImpl` over the CPU backend, with the entry's CPU
//     program, and one compute pass. Each buffer holds the CPU tier's value `toCpu` makes of the
//     host's value, and the call reads back the value the code left (`holdValue`), so the code
//     computes on the host's numbers as the CPU tier always did (Rule 11.7).
//
// The manifest a call loads is made from the entry record the generated module writes, one for
// each entry and tier, as a draw's is: the call layer carries no compiler (Rules 11.10, 11.11).
// The call layer's checks and refusals stay its own: the pipeline checks no limit, and a device
// error is the call's "WebGPU refused the call".
//
// The host face installs this file in `entryPrograms` at its first call (`callCompute` below),
// so `typeshade/fuse`, which borrows `core/host-compute.ts`, reaches no program runtime.

import { callCompute as queuedCall, entryPrograms, type EntryPrograms } from './host-compute.js';
import {
  boxed,
  fromCpu,
  gpuHandle,
  isBuffer,
  isGuard,
  packed,
  pendingClears,
  readInto,
  toCpu,
  type Checked,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type GpuDevice,
  type Workgroups,
} from './host-entry.js';
import {
  PACK_SCHEMA,
  packLayout,
  type Pack,
  type PackBinding,
  type PackConsole,
  type PackEntry,
} from './manifest-types.js';
import { VERSION } from './version.js';
import type { CpuValue } from './cpu-runtime.js';
import type { IncomingReads } from './host-failure.js';
import type { Tier } from './tiers.js';
import {
  cpuRuntimeOf,
  glImageTexture,
  glRuntimeOf,
  packBindingOf,
  samplerOn,
  slotOf,
  webgpuRuntimeOf,
} from './host-draw.js';
import { CPU_PROGRAM, type CpuCode, type CpuProgram } from '../rhi/cpu-program.js';
import { holdValue } from '../rhi/cpu.js';
import type { RhiBuffer, RhiShaderModule, RhiTexture } from '../rhi/rhi.js';
import {
  CallBuffer,
  CallWords,
  ProgramImpl,
  type ComputePipelineImpl,
  type Program,
} from '../runtime/program.js';
import type { RuntimeImpl } from '../runtime/runtime.js';
import type { GlRuntimeImpl } from '../runtime/gl.js';

/**
 * Call a `@compute` entry from host code (Rule 8.24), as `callCompute` of `core/host-compute.ts`
 * does, with a call outside a `fuse` scope run as a program-runtime pipeline and pass.
 */
export function callCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
  options?: unknown,
  reads?: IncomingReads,
): Promise<void> {
  entryPrograms.run ??= PROGRAMS;
  return queuedCall(cpu, e, argc, bindings, workgroups, options, reads);
}

// ─── the manifest of an entry call ───────────────────────────────────────────────────────────

/** The tier a call's manifest is made for: each binds a little differently. One of `TIERS`
 *  (`./tiers.ts`), so the names are written there only. */
type CallTier = Tier;

/** Each entry's call manifest, by tier. */
const manifests = new WeakMap<ComputeEntry, Map<CallTier, Pack>>();

/** The handle bindings the entry's WebGL2 pass program reads: each texture it samples or loads,
 *  and the sampler each is paired with. */
function glHandles(e: ComputeEntry): Set<string> {
  const out = new Set<string>();
  for (const t of e.gl?.textures ?? []) {
    out.add(t.name);
    if (t.sampler !== null) out.add(t.sampler);
  }
  return out;
}

/** The CPU program of an entry call: the module's generated code, the entry's builtins and
 *  workgroup size, each buffer binding, and the workgroup variables' zeros. */
function callCpuProgram(e: ComputeEntry, cpu: GeneratedCpu): CpuProgram {
  return {
    code: cpu as unknown as CpuCode,
    entries: {
      [e.entryPoint ?? e.fn]: {
        fn: e.fn,
        stage: 'compute',
        params: e.params.map((builtin) => ({
          kind: 'field' as const,
          field: { name: builtin, builtin },
        })),
        workgroupSize: e.wg,
      },
    },
    bindings: e.bindings.filter(isBuffer).map((b) => ({
      name: b.name,
      group: b.group,
      binding: b.binding,
      layout: packLayout(b.layout),
      kind: b.space,
    })),
    workgroupZero: e.workgroupZero,
  };
}

/**
 * The manifest a call of `e` loads on `tier`, one for each entry and tier: the module's WGSL, the
 * entry, each binding it reaches, the recorded console variant where the WGSL records, the
 * WebGL2 pass program, and on the CPU tier the CPU program under `CPU_PROGRAM` (O2 (a)). A
 * WebGPU or CPU binding is named as a draw's is (`slotOf`); a WebGL2 binding keeps its own name,
 * by which the pass program reads it, and a uniform its layout, by which the dispatch packs it.
 */
function callManifestOf(e: ComputeEntry, tier: CallTier, cpu?: GeneratedCpu): Pack {
  let byTier = manifests.get(e);
  if (byTier === undefined) manifests.set(e, (byTier = new Map()));
  const hit = byTier.get(tier);
  if (hit !== undefined) return hit;
  const gl = tier === 'webgl2';
  const handles = gl ? glHandles(e) : undefined;
  const reached = e.bindings.filter((b) =>
    tier === 'cpu' ? isBuffer(b) : gl ? isBuffer(b) || isGuard(b) || handles!.has(b.name) : true,
  );
  const bindings = reached.map((b): PackBinding => {
    const p = packBindingOf(b, 'compute', gl ? b.name : slotOf(b));
    return gl && isBuffer(b) && b.space === 'uniform' ? { ...p, layout: packLayout(b.layout) } : p;
  });
  const entry: PackEntry = {
    name: e.name,
    emitted: e.entryPoint ?? e.fn,
    stage: 'compute',
    workgroupSize: e.wg,
    bindings: reached.map((b, i) => ({
      name: bindings[i]!.name,
      writes: isBuffer(b) && b.writes,
    })),
  };
  let console: PackConsole | undefined;
  if (tier === 'webgpu' && e.log !== undefined) {
    const slot: PackBinding = {
      name: '_console',
      emitted: '_console',
      space: 'storage',
      group: e.log.group,
      binding: e.log.binding,
      access: 'read_write',
      type: 'array<u32>',
      stages: ['compute'],
      resource: { resourceKind: 'storage-buffer' },
      injected: true,
    };
    console = { wgsl: e.wgsl, log: e.log, bindings: [...bindings, slot] };
  }
  const m: Pack = {
    schema: PACK_SCHEMA,
    compiler: VERSION,
    wgsl: e.wgsl,
    bindings,
    entries: [entry],
    structs: [],
    overrides: [],
    features: [],
    ...(console !== undefined ? { console } : {}),
    ...(gl && e.gl !== undefined ? { gl: { computes: { [e.name]: e.gl } } } : {}),
  };
  if (tier === 'cpu') (m as { [CPU_PROGRAM]?: CpuProgram })[CPU_PROGRAM] = callCpuProgram(e, cpu!);
  byTier.set(tier, m);
  return m;
}

// ─── programs and pipelines ──────────────────────────────────────────────────────────────────

/** The program of each call manifest on each runtime, loaded once. */
const programs = new WeakMap<object, WeakMap<Pack, ProgramImpl | Program>>();

/** A shader module of one WGSL text on one runtime, with the errors its compilation reported:
 *  the entries of a module share it, as the call layer's pipelines always did. */
const modules = new WeakMap<
  RuntimeImpl,
  Map<string, { module: RhiShaderModule; errors: Promise<string> }>
>();

/** The part of a WebGPU shader module that reports how its WGSL compiled. */
interface CompilationInfo {
  getCompilationInfo?(): Promise<{
    messages: readonly { type: string; lineNum: number; linePos: number; message: string }[];
  }>;
}

function moduleOn(
  rt: RuntimeImpl,
  wgsl: string,
): { module: RhiShaderModule; errors: Promise<string> } {
  let byText = modules.get(rt);
  if (byText === undefined) modules.set(rt, (byText = new Map()));
  let made = byText.get(wgsl);
  if (made === undefined) {
    const module = rt.rhi.createShaderModule(wgsl);
    const info = rt.rhi.toNative(module) as CompilationInfo;
    const errors = (async () =>
      ((await info.getCompilationInfo?.())?.messages ?? [])
        .filter((m) => m.type === 'error')
        .map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`)
        .join('; '))();
    byText.set(wgsl, (made = { module, errors }));
  }
  return made;
}

function programOn(rt: RuntimeImpl, m: Pack, module?: RhiShaderModule): ProgramImpl {
  let byManifest = programs.get(rt);
  if (byManifest === undefined) programs.set(rt, (byManifest = new WeakMap()));
  let p = byManifest.get(m) as ProgramImpl | undefined;
  if (p === undefined)
    byManifest.set(m, (p = new ProgramImpl(rt, m, m.console !== undefined, module)));
  return p;
}

/** The compute pipeline of each entry on each runtime: made once, and a refusal kept, as the call
 *  layer's pipeline was. */
const pipelines = new WeakMap<object, WeakMap<ComputeEntry, Promise<ComputePipelineImpl>>>();

function pipelineOn(
  rt: RuntimeImpl,
  e: ComputeEntry,
  make: () => Promise<ComputePipelineImpl>,
): Promise<ComputePipelineImpl> {
  let byEntry = pipelines.get(rt);
  if (byEntry === undefined) pipelines.set(rt, (byEntry = new WeakMap()));
  let p = byEntry.get(e);
  if (p === undefined) byEntry.set(e, (p = make()));
  return p;
}

/** The WebGPU pipeline of `e`: its module's WGSL refused is the call's refusal, before anything
 *  is uploaded. */
function gpuPipeline(rt: RuntimeImpl, e: ComputeEntry): Promise<ComputePipelineImpl> {
  return pipelineOn(rt, e, async () => {
    const m = callManifestOf(e, 'webgpu');
    const { module, errors } = moduleOn(rt, e.wgsl);
    const refused = await errors;
    if (refused !== '') throw new Error(`${e.name}: WebGPU refused the module's WGSL: ${refused}`);
    return programOn(rt, m, module).callPipeline(e.name, e.constants);
  });
}

// ─── the three tiers ─────────────────────────────────────────────────────────────────────────

/** What the program runtime makes of an entry call on each tier. */
const PROGRAMS: EntryPrograms = { gpu: onGpuProgram, gl: onGlProgram, cpu: onCpuProgram };

/** A written storage binding's bytes, read back into the caller's value in place. */
function readBack(b: EntryBinding, dv: DataView, values: Record<string, unknown>): void {
  if (boxed(b))
    (values[b.name] as { [i: number]: number })[0] = readInto(dv, 0, b.layout, undefined) as number;
  else readInto(dv, 0, b.layout, values[b.name]);
}

/** Dispatch the entry once on WebGPU, reading each storage binding it writes back into the
 *  caller's value in place; a binding in `checked.onDevice` is bound as it is. */
async function onGpuProgram(
  d: GpuDevice,
  e: ComputeEntry,
  checked: Checked,
  wg: Workgroups,
): Promise<void> {
  const rt = webgpuRuntimeOf(d);
  const pipeline = await gpuPipeline(rt, e);
  const rhi = rt.rhi;
  const owned: { destroy(): void }[] = [];
  const values: Record<string, unknown> = {};
  const written: { b: EntryBinding; buffer: RhiBuffer; size: number }[] = [];
  let staged: { b: EntryBinding; staging: RhiBuffer; size: number }[];
  let printed: (() => Promise<unknown>) | undefined;
  let done: Promise<void>;
  let error: Promise<string | null>;
  // From here to the submit nothing awaits: the buffers this call takes from the pool go back
  // together, once what it reads is read.
  rhi.pushValidationScope();
  const encoder = rhi.createCommandEncoder();
  try {
    for (const b of e.bindings) {
      // The `_fp64` guard is the runtime's.
      if (isGuard(b)) continue;
      if (!isBuffer(b)) {
        values[slotOf(b)] = gpuHandle(
          d as unknown as Parameters<typeof gpuHandle>[0],
          b,
          checked,
          owned,
        );
        continue;
      }
      const resident = checked.onDevice?.get(b.name);
      if (resident !== undefined) {
        values[slotOf(b)] = resident;
        continue;
      }
      const bytes = packed(b, checked.values[b.name]);
      const buffer = rt.pool.take(
        bytes.byteLength,
        b.space === 'uniform' ? ['uniform', 'copy-dst'] : ['storage', 'copy-src', 'copy-dst'],
      );
      rhi.writeBuffer(buffer, 0, bytes);
      values[slotOf(b)] = new CallBuffer(buffer, bytes.byteLength);
      if (b.space === 'storage' && b.writes) written.push({ b, buffer, size: bytes.byteLength });
    }
    // A pooled array given out again as zeros is cleared here, before the pass that binds it or
    // reads its counts, in the call's own submission (change 0071).
    const native = rhi.toNative(encoder) as { clearBuffer?(b: object): void };
    for (const buffer of [
      ...(checked.onDevice?.values() ?? []),
      ...('buffer' in wg ? [wg.buffer] : []),
    ]) {
      const pending = pendingClears.get(buffer);
      if (pending === undefined) continue;
      pendingClears.delete(buffer);
      pending.clearPending = false;
      if (native.clearBuffer !== undefined) native.clearBuffer(buffer);
      else rhi.writeBuffer(buffer as never, 0, new ArrayBuffer(pending.gpu?.size ?? 0));
    }
    const pass = encoder.beginComputePass();
    pipeline.record(
      pass,
      values,
      'buffer' in wg ? { buffer: wg.buffer as unknown as RhiBuffer, offset: wg.offset } : wg,
    );
    pass.end();
    staged = written.map((w) => {
      const staging = rt.pool.take(w.size, ['map-read', 'copy-dst']);
      encoder.copyBufferToBuffer(w.buffer, 0, staging, 0, w.size);
      return { b: w.b, staging, size: w.size };
    });
    printed = rt.takeConsole(encoder);
    done = rhi.submit([encoder]);
    error = rhi.popValidationScope();
  } catch (err) {
    // Close the scope on the way out, so that the next call's errors are its own, and hand the
    // pool back what this call took and a console buffer it may have recorded.
    rt.takeConsole(encoder);
    void rhi.popValidationScope().catch(() => undefined);
    rt.pool.release(Promise.resolve());
    for (const o of owned) o.destroy();
    throw err;
  }
  const read = (async () => {
    const refused = await error;
    if (refused !== null) throw new Error(`${e.name}(): WebGPU refused the call: ${refused}`);
    for (const { b, staging, size } of staged) {
      const bytes = await rhi.readBuffer(staging);
      readBack(b, new DataView(bytes, 0, size), checked.values);
    }
    await printed?.();
  })();
  rt.pool.release(Promise.allSettled([done, read]));
  try {
    await read;
  } finally {
    for (const o of owned) o.destroy();
  }
}

/** Run the entry's pass program on WebGL2: each storage binding its packed words, the uniforms as
 *  the host gave them, each image an `RGBA8` texture with its sampler's filter and address, and
 *  every storage binding the entry writes read back into the caller's value in place. */
async function onGlProgram(
  gl: WebGL2RenderingContext,
  e: ComputeEntry,
  checked: Checked,
  wg: readonly [number, number, number],
): Promise<void> {
  const rt: GlRuntimeImpl = await glRuntimeOf(gl);
  const m = callManifestOf(e, 'webgl2');
  let byManifest = programs.get(rt);
  if (byManifest === undefined) programs.set(rt, (byManifest = new WeakMap()));
  let program = byManifest.get(m) as Program | undefined;
  if (program === undefined) byManifest.set(m, (program = rt.load(m)));
  const pipeline = await program.compute(e.name);
  const handles = glHandles(e);
  const values: Record<string, unknown> = {};
  const words = new Map<EntryBinding, Uint32Array>();
  const textures: RhiTexture[] = [];
  try {
    for (const b of e.bindings) {
      if (isGuard(b)) continue;
      if (isBuffer(b)) {
        if (b.space === 'uniform') values[b.name] = checked.values[b.name];
        else {
          const w = new Uint32Array(packed(b, checked.values[b.name]));
          words.set(b, w);
          values[b.name] = new CallWords(w);
        }
        continue;
      }
      if (!handles.has(b.name)) continue;
      if (b.space === 'sampler') {
        values[b.name] = samplerOn(rt, checked.samplers.get(b.name)!);
        continue;
      }
      const img = checked.images.get(b.name)!;
      if (img.view !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${b.name}" is a Texture on the WebGPU device, which the WebGL2 tier cannot read; pass an image source for a call that may fall back.`,
        );
      const texture = glImageTexture(rt.rhi, img);
      textures.push(texture);
      values[b.name] = rt.rhi.toNative(texture);
    }
    await rt.runFrame((frame) => frame.dispatch(pipeline, values, wg));
  } finally {
    for (const t of textures) rt.rhi.destroyTexture(t);
  }
  for (const [b, w] of words)
    if (b.writes) readBack(b, new DataView(w.buffer, w.byteOffset, w.byteLength), checked.values);
}

/** Run every invocation of every workgroup on the CPU tier, reading each storage binding it
 *  writes back into the caller's value in place. */
async function onCpuProgram(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  values: Record<string, unknown>,
  wg: readonly [number, number, number],
): Promise<void> {
  const rt = cpuRuntimeOf();
  const pipeline = await pipelineOn(rt, e, () =>
    programOn(rt, callManifestOf(e, 'cpu', cpu)).callPipeline(e.name),
  );
  const held: { b: EntryBinding; buffer: RhiBuffer; slot: { value: unknown } }[] = [];
  const bound: Record<string, unknown> = {};
  for (const b of e.bindings) {
    if (!isBuffer(b)) continue;
    const buffer = rt.pool.take(16, [b.space, 'copy-dst']);
    const slot = { value: toCpu(b.layout, values[b.name], boxed(b)) as unknown };
    holdValue(buffer, slot);
    held.push({ b, buffer, slot });
    bound[slotOf(b)] = new CallBuffer(buffer);
  }
  let done: Promise<void>;
  try {
    const encoder = rt.rhi.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pipeline.record(pass, bound, wg);
    pass.end();
    done = rt.rhi.submit([encoder]);
  } catch (err) {
    done = Promise.reject(err as Error);
  }
  // The buffers bind their bytes again before the pool can give them to anything else.
  const unhold = (): void => held.forEach((h) => holdValue(h.buffer, undefined));
  const settled = done.then(unhold, (err: unknown) => {
    unhold();
    throw err;
  });
  rt.pool.release(settled);
  await settled;
  // What the entry wrote goes back into the caller's values; a written binding is always one
  // that can be updated in place (a boxed scalar, an array, a typed array or an object).
  for (const { b, slot } of held)
    if (b.writes) fromCpu(b.layout, slot.value as CpuValue, values[b.name], boxed(b));
}
