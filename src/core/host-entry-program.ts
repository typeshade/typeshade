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
import type { CpuValue } from './cpu-runtime.js';
import type { IncomingReads } from './host-failure.js';
import {
  cpuRuntimeOf,
  glImageTexture,
  glRuntimeOf,
  samplerOn,
  slotOf,
  webgpuRuntimeOf,
} from './host-draw.js';
import { holdValue } from '../rhi/cpu.js';
import type { RhiBuffer, RhiTexture } from '../rhi/rhi.js';
import { CallBuffer, CallWords, type Program } from '../runtime/program.js';
import type { GlRuntimeImpl } from '../runtime/gl.js';
import { glHandles, callManifestOf } from './host-entry-program/manifest.js';
import { programs, programOn, pipelineOn, gpuPipeline } from './host-entry-program/caches.js';

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

const PROGRAMS: EntryPrograms = { gpu: onGpuProgram, gl: onGlProgram, cpu: onCpuProgram };

function readBack(b: EntryBinding, dv: DataView, values: Record<string, unknown>): void {
  if (boxed(b))
    (values[b.name] as { [i: number]: number })[0] = readInto(dv, 0, b.layout, undefined) as number;
  else readInto(dv, 0, b.layout, values[b.name]);
}

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
  rhi.pushValidationScope();
  const encoder = rhi.createCommandEncoder();
  try {
    for (const b of e.bindings) {
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
          `${e.name}(): binding "${b.name}" is a Texture on the WebGPU device, which the WebGL2 tier does not read yet (Rule 8.24); pass an image source for a call that may fall back.`,
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
  const unhold = (): void => held.forEach((h) => holdValue(h.buffer, undefined));
  const settled = done.then(unhold, (err: unknown) => {
    unhold();
    throw err;
  });
  rt.pool.release(settled);
  await settled;
  for (const { b, slot } of held)
    if (b.writes) fromCpu(b.layout, slot.value as CpuValue, values[b.name], boxed(b));
}
