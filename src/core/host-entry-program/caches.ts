import type { ComputeEntry } from '../host-entry.js';
import type { Pack } from '../manifest-types.js';
import type { RhiShaderModule } from '../../rhi/rhi.js';
import { ProgramImpl, type ComputePipelineImpl, type Program } from '../../runtime/program.js';
import type { RuntimeImpl } from '../../runtime/runtime.js';
import { callManifestOf } from './manifest.js';

export const programs = new WeakMap<object, WeakMap<Pack, ProgramImpl | Program>>();

const modules = new WeakMap<
  RuntimeImpl,
  Map<string, { module: RhiShaderModule; errors: Promise<string> }>
>();

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

export function programOn(rt: RuntimeImpl, m: Pack, module?: RhiShaderModule): ProgramImpl {
  let byManifest = programs.get(rt);
  if (byManifest === undefined) programs.set(rt, (byManifest = new WeakMap()));
  let p = byManifest.get(m) as ProgramImpl | undefined;
  if (p === undefined)
    byManifest.set(m, (p = new ProgramImpl(rt, m, m.console !== undefined, module)));
  return p;
}

const pipelines = new WeakMap<object, WeakMap<ComputeEntry, Promise<ComputePipelineImpl>>>();

export function pipelineOn(
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

export function gpuPipeline(rt: RuntimeImpl, e: ComputeEntry): Promise<ComputePipelineImpl> {
  return pipelineOn(rt, e, async () => {
    const m = callManifestOf(e, 'webgpu');
    const { module, errors } = moduleOn(rt, e.wgsl);
    const refused = await errors;
    if (refused !== '') throw new Error(`${e.name}: WebGPU refused the module's WGSL: ${refused}`);
    return programOn(rt, m, module).callPipeline(e.name, e.constants);
  });
}
