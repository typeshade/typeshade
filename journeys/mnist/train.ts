import { initialize, buffers } from './model.mjs';
export interface Dataset {
  pixels: Float32Array;
  labels: Uint32Array;
}
export interface Model {
  weights: Float32Array;
  bias: Float32Array;
}
export interface Batch {
  count: number;
  offset: number;
  rate: number;
}
export type HostBuffers = Record<string, Float32Array | Uint32Array>;
export type Entry = 'forward' | 'objective' | 'reduce' | 'backward' | 'update';
export interface Backend {
  tier: string;
  executionClassification?: string;
  transfers?: Record<string, string | number>;
  deviceTensorBytes?: number;
  dispatch(entry: Entry, batch: Batch): Promise<void>;
  /** Optional browser-local epoch: no Playwright round-trip for each batch. */
  trainEpoch?(
    totalRows: number,
    batchSize: number,
    rate: number,
  ): Promise<{ forwardMs: number; backwardMs: number; updateMs: number }>;
  /** Stage timers from batched frames are host-side attribution, not GPU kernel times. */
  timingDomain?: string;
  read(name: string): Promise<Float32Array | Uint32Array>;
  destroy(): void | Promise<void>;
}
export type MakeBackend = (host: HostBuffers) => Backend | Promise<Backend>;
export interface TrainingOptions {
  epochs?: number;
  batchSize?: number;
  rate?: number;
  seed?: number;
  log?: (row: Record<string, unknown>) => void;
}
// SGD and batching live in the experiment, not TypeShade Core. Fixed contiguous batches.
export async function train(
  data: Dataset,
  makeBackend: MakeBackend,
  { epochs = 5, batchSize = 32, rate = 0.1, seed = 123, log = () => {} }: TrainingOptions = {},
) {
  if (
    !Number.isInteger(epochs) ||
    epochs < 1 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    data.labels.length === 0 ||
    data.pixels.length !== data.labels.length * 784
  )
    throw new Error('Invalid training options');
  const host = buffers(data, initialize(seed), Math.min(batchSize, data.labels.length));
  const backend = await makeBackend(host);
  const timings = [];
  const started = performance.now();
  async function dispatch(entry: Entry, batch: Batch) {
    const begin = performance.now();
    await backend.dispatch(entry, batch);
    return performance.now() - begin;
  }
  async function evaluate() {
    let loss = 0,
      correct = 0;
    for (let offset = 0; offset < data.labels.length; offset += batchSize) {
      const count = Math.min(batchSize, data.labels.length - offset);
      const batch = { count, offset, rate };
      await backend.dispatch('forward', batch);
      await backend.dispatch('objective', batch);
      await backend.dispatch('reduce', batch);
      const stats = await backend.read('stats');
      loss += stats[0] * count;
      correct += stats[1];
    }
    return { loss: loss / data.labels.length, accuracy: correct / data.labels.length };
  }
  try {
    const initial = await evaluate();
    log({ phase: 'initial', tier: backend.tier, ...initial });
    for (let epoch = 1; epoch <= epochs; epoch++) {
      const begin = performance.now();
      let forwardMs = 0,
        backwardMs = 0,
        updateMs = 0;
      if (backend.trainEpoch) {
        // The backend already holds the dataset on the browser host. It executes
        // the whole epoch there so Playwright transports only epoch boundaries.
        const times = await backend.trainEpoch(data.labels.length, batchSize, rate);
        forwardMs = times.forwardMs;
        backwardMs = times.backwardMs;
        updateMs = times.updateMs;
      } else {
        for (let offset = 0; offset < data.labels.length; offset += batchSize) {
          const batch = { count: Math.min(batchSize, data.labels.length - offset), offset, rate };
          forwardMs += await dispatch('forward', batch);
          forwardMs += await dispatch('objective', batch);
          backwardMs += await dispatch('backward', batch);
          updateMs += await dispatch('update', batch);
        }
      }
      const epochMs = performance.now() - begin;
      const metrics = await evaluate();
      const row = {
        epoch,
        ...metrics,
        forwardMs,
        backwardMs,
        updateMs,
        epochMs,
        timingDomain: backend.timingDomain ?? 'Node wall time per awaited dispatch',
      };
      timings.push(row);
      log(row);
    }
    const weights = (await backend.read('weights')) as Float32Array;
    const bias = (await backend.read('bias')) as Float32Array;
    if (![...weights, ...bias].every(Number.isFinite)) throw new Error('Non-finite parameters');
    return {
      tier: backend.tier,
      initial,
      final: timings.at(-1),
      timings,
      weights,
      bias,
      totalMs: performance.now() - started,
      computation: {
        classification:
          backend.executionClassification ??
          (backend.tier.startsWith('cpu')
            ? 'CPU-only training'
            : 'Entire training computation on WebGPU; hardware classification reported by adapter'),
        stages: Object.fromEntries(
          ['forward', 'softmax/loss', 'gradient reduction/backward', 'SGD update'].map((stage) => [
            stage,
            backend.tier,
          ]),
        ),
        hostOnly: [
          'dataset loading',
          'normalization',
          'initialization',
          'batch control',
          'aggregation of evaluation metrics',
        ],
      },
      memory: {
        deviceTensorBytes: backend.deviceTensorBytes ?? 0,
        peakObservedBufferAllocationBytes: backend.transfers?.peakRequestedBufferBytes ?? 0,
        observedBufferLabel:
          'Peak sum of requested buffer sizes tracked after pipeline creation; includes staging and uniforms; excludes driver/pipeline/texture allocations, not physical VRAM',
        label:
          'Estimated tensor payload bytes; excludes runtime, staging, pipeline and JS overhead',
        bytes: Object.values(host).reduce((n, a) => n + a.byteLength, 0),
      },
      transfers: backend.transfers ?? {
        uploads: 0,
        readbacks: 0,
        label: 'CPU execution: no CPU/GPU transfers',
      },
    };
  } finally {
    await backend.destroy();
  }
}
export async function evaluateModel(
  data: Dataset,
  model: Model,
  makeBackend: MakeBackend,
  batchSize = 32,
) {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    data.labels.length === 0 ||
    data.pixels.length !== data.labels.length * 784
  )
    throw new Error('Invalid evaluation dataset or batch size');
  const backend = await makeBackend(buffers(data, model, Math.min(batchSize, data.labels.length)));
  let loss = 0,
    correct = 0;
  try {
    for (let offset = 0; offset < data.labels.length; offset += batchSize) {
      const count = Math.min(batchSize, data.labels.length - offset);
      const batch = { count, offset, rate: 0 };
      for (const entry of ['forward', 'objective', 'reduce'] as const)
        await backend.dispatch(entry, batch);
      const stats = await backend.read('stats');
      loss += stats[0] * count;
      correct += stats[1];
    }
    return { loss: loss / data.labels.length, accuracy: correct / data.labels.length };
  } finally {
    await backend.destroy();
  }
}
