import {
  blendConstantOf,
  scissorOf,
  stencilReferenceOf,
  viewportOf,
  type Geometry,
  type PassFit,
  type RenderPipeline,
} from '../program.js';
import type { RenderPass } from '../runtime.js';
import type { RhiDevice, RhiTexture } from '../../rhi/rhi.js';
import type { DrawRun } from './pipeline-types.js';

export class GlPass implements RenderPass, PassFit {
  readonly steps: DrawRun[] = [];
  blend: readonly number[] = [0, 0, 0, 0];
  declared = false;
  range: [number, number] = [0, 1];
  stencilReference = 0;

  constructor(
    private readonly info: {
      readonly rhi: RhiDevice;
      readonly width: number;
      readonly height: number;
      readonly depthFormat?: string;
      readonly depthReadOnly: boolean;
      readonly stencilReadOnly: boolean;
      readonly depthTarget?: object;
      readonly depthTexture?: RhiTexture;
    },
  ) {}

  get raw(): object {
    throw new TypeError('A pass on WebGL2 has no GPURenderPassEncoder.');
  }

  get depthFormat(): string | undefined {
    return this.info.depthFormat;
  }

  get depthReadOnly(): boolean {
    return this.info.depthReadOnly;
  }

  get stencilReadOnly(): boolean {
    return this.info.stencilReadOnly;
  }

  readsOwnDepth(value: unknown, texture: RhiTexture): boolean {
    const own = this.info.depthTexture;
    return (
      value === this.info.depthTarget ||
      (own !== undefined && this.info.rhi.toNative(texture) === this.info.rhi.toNative(own))
    );
  }

  setStencilReference(reference: number): void {
    this.stencilReference = stencilReferenceOf(reference);
  }

  add(run: DrawRun): void {
    this.steps.push(run);
  }

  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void {
    pipeline.draw(this, bindings, geometry);
  }

  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth?: number,
    maxDepth?: number,
  ): void {
    const limit = this.info.rhi.caps.limits.maxViewportDimension!;
    const v = viewportOf(x, y, width, height, minDepth, maxDepth, limit);
    this.range = [v.minDepth, v.maxDepth];
    this.add({
      residents: [],
      run: (p) => p.setViewport(...v.rect, v.minDepth, v.maxDepth),
    });
  }

  setScissorRect(x: number, y: number, width: number, height: number): void {
    const r = scissorOf(x, y, width, height, { width: this.info.width, height: this.info.height });
    this.add({ residents: [], run: (p) => p.setScissorRect(...r) });
  }

  setBlendConstant(color: ArrayLike<number>): void {
    const c = blendConstantOf(color);
    this.blend = c;
    this.declared = false;
    this.add({ residents: [], run: (p) => p.setBlendConstant(c) });
  }
}
