import { GlComputePipelineImpl } from './gl/compute-pipeline.js';
// Implements: Rule 11.11

import { deviceInfo, type DeviceInfo } from '../core/device-info.js';
import type { RhiDevice, RhiSampler } from '../rhi/rhi.js';
import { webgl2Device } from '../rhi/webgl2.js';
import { type Pack, type PackBindings } from '../core/manifest-types.js';
import {
  at,
  checkManifest,
  constantsOf,
  entryOf,
  specializedWorkgroupShape,
  type ComputePipeline,
  type Constants,
  type Program,
  type RenderPipeline,
  type RenderState,
} from './program.js';
import type { Sampler, SamplerOptions, Texture, TextureOptions } from './resources.js';
import type { Frame, LoadOptions, PassTargets, RenderPass, Runtime } from './runtime.js';
import {
  GlDrawing,
  GlRenderPrograms,
  GlSamplerImpl,
  GlTextureImpl,
  glslOverrideNames,
  pinOverrides,
  recordPass,
} from './gl-draw.js';
import { type GlPipelineOwner } from './gl/binding-values.js';
import { GlFrameImpl } from './gl/frame.js';

export class GlRuntimeImpl implements Runtime<WebGL2RenderingContext> {
  readonly info: DeviceInfo;
  readonly tier = 'webgl2';
  readonly limits: Readonly<Record<string, number>> = Object.freeze({});

  readonly rhi: RhiDevice;
  readonly drawing: GlDrawing;
  #nearest: RhiSampler | undefined;

  constructor(
    gl: WebGL2RenderingContext,
    private readonly owned: boolean,
  ) {
    this.rhi = webgl2Device(gl);
    this.drawing = new GlDrawing(this.rhi);
    this.info = deviceInfo('webgl2', gl);
  }

  get device(): WebGL2RenderingContext {
    return this.rhi.native as WebGL2RenderingContext;
  }

  // Why: WebGL2 takes a texture of integers as complete only with a nearest, clamped sampler.
  get nearest(): RhiSampler {
    return (this.#nearest ??= this.rhi.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    }));
  }

  load<E extends PackBindings>(program: Pack<E>, options: LoadOptions = {}): Program<E> {
    checkManifest(program);
    if (options.console === true)
      throw new TypeError(
        'load({ console: true }): recording console calls is not supported yet on the WebGL2 tier of the program runtime (Rule 11.9).',
      );
    return new GlProgramImpl(this, program) as unknown as Program<E>;
  }

  texture(options: TextureOptions | object): Texture {
    return new GlTextureImpl(this.drawing, options);
  }

  sampler(options?: SamplerOptions | object): Sampler {
    return new GlSamplerImpl(this.rhi, options);
  }

  frame(): Frame {
    return new GlFrameImpl(this.drawing);
  }

  runPass(targets: PassTargets, record: (pass: RenderPass) => void): Promise<void> {
    return recordPass(this.drawing, targets, record)();
  }

  async runFrame(record: (frame: Frame) => void): Promise<void> {
    const frame = new GlFrameImpl(this.drawing);
    record(frame);
    await frame.runNow();
  }

  submit(): ReturnType<Frame['submit']> {
    return Promise.reject(
      new TypeError(
        'submit(...encoders): a WebGL2 runtime has no command encoders; submit a frame, rt.frame().submit().',
      ),
    );
  }

  destroy(): void {
    if (this.owned) this.rhi.destroy();
  }
}

class GlProgramImpl implements Program {
  readonly recording = false;
  readonly #pipelines = new Map<string, GlComputePipelineImpl>();
  #render: GlRenderPrograms | undefined;

  constructor(
    readonly rt: GlPipelineOwner['rt'],
    readonly manifest: Pack,
  ) {}

  compute(entry?: string, options?: { readonly constants?: Constants }): Promise<ComputePipeline> {
    try {
      return Promise.resolve(this.#compute(entry, options?.constants));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #compute(entry: string | undefined, given: Constants | undefined): ComputePipeline {
    const e = entryOf(this.manifest, entry, 'compute');
    const constants = constantsOf(this.manifest, given);
    const defaultShape = e.workgroupSize ?? [64, 1, 1];
    const workgroupShape = specializedWorkgroupShape(e, constants?.values);
    if (workgroupShape.some((n, axis) => n !== defaultShape[axis]))
      throw new TypeError(
        `"${e.name}"${at(e)} has no WebGL2 program for workgroup shape [${workgroupShape.join(', ')}]; a shape other than the declared default [${defaultShape.join(', ')}] is not supported yet on the WebGL2 tier (Rule 11.8).`,
      );
    const key = `${e.name}:${constants?.key ?? ''}`;
    let p = this.#pipelines.get(key);
    if (p === undefined) {
      const program = this.manifest.gl?.computes?.[e.name];
      if (program === undefined)
        throw new TypeError(
          `The manifest carries no WebGL2 program for "${e.name}"${at(e)}; pack it again with this version of typeshade.`,
        );
      if ('none' in program)
        throw new TypeError(`"${e.name}"${at(e)} has no WebGL2 program: ${program.none}.`);
      p = new GlComputePipelineImpl(
        this,
        e,
        constants === undefined
          ? program
          : {
              ...program,
              vertex: pinOverrides(
                program.vertex,
                constants.values,
                glslOverrideNames(this.manifest),
              ),
            },
        defaultShape,
      );
      this.#pipelines.set(key, p);
    }
    return p;
  }

  render(state: RenderState = {}): Promise<RenderPipeline> {
    try {
      return Promise.resolve(
        (this.#render ??= new GlRenderPrograms(this.rt.drawing, this.manifest)).render(state),
      );
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }
}
