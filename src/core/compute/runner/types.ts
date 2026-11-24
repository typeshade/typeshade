import type { TIERS } from '../../tiers.js';

/** The tiers, most-capable first (`core/tiers.ts`, the one list the call layer reads too).
 *  The default `prefer` order is that list's. */
export type ComputeBackend = (typeof TIERS)[number];

/** A candidate that did not win, and the reason — so a fallback is never silent. */
export interface RejectedBackend {
  readonly backend: ComputeBackend;
  readonly reason: string;
}

/** A WebGPU device, as the runner requires one. A real `GPUDevice` satisfies this — see
 *  the note above for why the arguments are deliberately unspelled. */
export interface GpuDeviceLike {
  createShaderModule(...args: never[]): unknown;
  createComputePipeline(...args: never[]): unknown;
  createBuffer(...args: never[]): unknown;
  createBindGroup(...args: never[]): unknown;
  createCommandEncoder(...args: never[]): unknown;
  readonly queue: object;
}

/** How to resolve the tier, and which live GPU handles are available to resolve onto.
 *  Everything here is read ONCE, when the runner is built. */
export interface ComputeRunnerOptions {
  /** Backends to try, in order. Defaults to `['webgpu', 'webgl2', 'cpu']`.
   *
   *  Pin it to a single entry to make a tier REQUIRED — `prefer: ['webgl2']` throws
   *  rather than quietly running 200k invocations on the CPU (21 ms) or 1M (~105 ms).
   *  That cliff is the reason this list is declared instead of inferred. */
  readonly prefer?: readonly ComputeBackend[];
  /** A live WebGL2 context. Its absence is why `webgl2` is skipped. */
  readonly gl?: WebGL2RenderingContext;
  /** A live WebGPU device. Its absence is why `webgpu` is skipped. */
  readonly device?: GpuDeviceLike;
}

/** A kernel bound to one resolved backend. Build it with {@link createComputeRunner},
 *  read {@link ComputeRunner.backend} to learn which tier won, then call
 *  {@link ComputeRunner.run} as many times as you like — the emit, the program link and
 *  the tier decision all happened at construction, so `run` is the dispatch alone. */
export interface ComputeRunner {
  /** Which tier resolved. Read it — a CPU fallback costs ~105 ms at 1M invocations. */
  readonly backend: ComputeBackend;
  /** Every candidate ahead of the winner, with the reason it was skipped. */
  readonly rejected: readonly RejectedBackend[];
  /** Run the kernel over `input`.
   *
   *  `invocations` defaults to `input.length` — right for a stride-1 kernel, which is the
   *  common shape. A kernel that reads several lanes per invocation
   *  (`feat_data[i * STRIDE + lane]`) must pass its own count, because the array length no
   *  longer is one.
   *
   *  Returns one `u32` per invocation: the value the `@compute` kernel would have written
   *  to its `read_write` binding. 32 bits is the width of an R32UI texel, not a semantic
   *  limit — pack a colour with `pack4x8unorm`, or round-trip an f32 through `bitcastU32`. */
  run(input: Float32Array, invocations?: number): Promise<Uint32Array>;
  /** Release backend resources (GL programs/textures). Idempotent; a no-op on CPU. */
  dispose(): void;
}
