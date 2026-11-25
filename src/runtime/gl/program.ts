import { GlComputePipelineImpl } from './compute-pipeline.js';
import type { Pack } from '../../core/manifest-types.js';
import {
  at,
  constantsOf,
  entryOf,
  specializedWorkgroupShape,
  type ComputePipeline,
  type Constants,
  type Program,
  type RenderPipeline,
  type RenderState,
} from '../program.js';
import { GlRenderPrograms, glslOverrideNames, pinOverrides } from '../gl-draw.js';
import type { GlPipelineOwner } from './binding-values.js';

export class GlProgramImpl implements Program {
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
