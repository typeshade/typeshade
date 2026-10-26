// The types of `_bench.mjs` for the scripts tsc reads (`tsconfig.tests.json`): the page runner
// the benchmarks and the performance gate share.

/** Run `measure(options)` in a page with WebGPU; see `_bench.mjs`. */
export function inPage<O, R>(args: {
  readonly modules: Readonly<Record<string, string>>;
  readonly measure: (options: O) => Promise<R> | R;
  readonly options: O;
  /** Launch Chromium for the machine's own adapter instead of SwiftShader. */
  readonly hardware?: boolean;
}): Promise<R>;

/** The median of a list of numbers. */
export function median(xs: readonly number[]): number;

/** A row of a result table: the median, the least and the most of the samples. */
export function row(
  name: string,
  times: readonly number[],
  seen: { submits: number; dispatches: number; buffers?: number },
): {
  name: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
  submissions: number;
  dispatches: number;
  buffers?: number;
};
