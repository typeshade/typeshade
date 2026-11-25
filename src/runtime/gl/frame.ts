import { kernelQueue, type ResidentArrayState } from '../../core/resident.js';
import type { ComputePipeline } from '../program.js';
import type { Frame, PassTargets, RenderPass } from '../runtime.js';
import { GlDrawing, recordPass } from '../gl-draw.js';

export class GlFrameImpl implements Frame {
  readonly #runs: (() => Promise<void> | void)[] = [];
  readonly #written = new Set<ResidentArrayState>();
  #submitted = false;

  constructor(private readonly drawing: GlDrawing) {}

  get encoder(): object {
    throw new TypeError('A frame on WebGL2 has no GPUCommandEncoder.');
  }

  record(run: () => Promise<void> | void, written: readonly ResidentArrayState[]): void {
    if (this.#submitted)
      throw new TypeError('This frame was submitted already; make a new one with rt.frame().');
    this.#runs.push(run);
    for (const s of written) this.#written.add(s);
  }

  dispatch<B>(
    pipeline: ComputePipeline<B>,
    bindings: NoInfer<B>,
    workgroups: number | readonly number[],
  ): void {
    pipeline.dispatch(this, bindings, workgroups);
  }

  pass(targets: PassTargets, record: (pass: RenderPass) => void): void {
    this.record(recordPass(this.drawing, targets, record), []);
  }

  async runNow(): Promise<void> {
    this.#submitted = true;
    for (const run of this.#runs) await run();
  }

  submit(): ReturnType<Frame['submit']> {
    if (this.#submitted)
      return Promise.reject(
        new TypeError('This frame was submitted already; make a new one with rt.frame().'),
      );
    this.#submitted = true;
    const runs = this.#runs;
    const written = [...this.#written];
    const done = kernelQueue.run(async () => {
      for (const run of runs) await run();
      return { console: [] };
    });
    done.then(
      () => written.forEach((s) => (s.error = undefined)),
      (err: unknown) => written.forEach((s) => (s.error = err)),
    );
    return done;
  }
}
