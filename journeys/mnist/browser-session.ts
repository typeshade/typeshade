// Browser-safe MNIST experiment session. All numerical model operations are the
// TypeShade compute entries compiled from softmax.shade.ts; no JS ML fallback.
// Reusable by the web site and the compiler's browser integration gates.
import { createRuntime, resident } from '../../src/runtime.ts';
import type { Pack } from '../../src/core/manifest-types.ts';
import type { Resident } from '../../src/core/resident.ts';
import { INPUTS, CLASSES, initialize, buffers } from './model.mjs';

export type MnistTier = 'webgpu' | 'webgl2';
type Entry = 'forward' | 'objective' | 'reduce' | 'backward' | 'update' | 'predict';
type Values = Float32Array | Uint32Array;
const ENTRIES: readonly Entry[] = [
  'forward',
  'objective',
  'reduce',
  'backward',
  'update',
  'predict',
];

export interface MnistSession {
  readonly tier: MnistTier;
  readonly renderer: string;
  trainBatch(pixels: Float32Array, labels: Uint32Array, rate: number): Promise<void>;
  evaluateBatch(
    pixels: Float32Array,
    labels: Uint32Array,
  ): Promise<{ loss: number; correct: number }>;
  predict(pixels: Float32Array): Promise<{ probabilities: Float32Array; predicted: number }>;
  readModel(): Promise<{ weights: Float32Array; bias: Float32Array }>;
  destroy(): Promise<void>;
}

/** All commands, including inference and model readback, are serialized on one session.
 *  This prevents a rapid draw event from overwriting input buffers in-flight. */
export async function openMnistSession(
  pack: Pack,
  { tier, batchSize = 16, seed = 123 }: { tier: MnistTier; batchSize?: number; seed?: number },
): Promise<MnistSession> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1024)
    throw new RangeError('Invalid MNIST batch size');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('Invalid MNIST seed');

  if (tier === 'webgl2') {
    for (const entry of ENTRIES) {
      const pass = pack.gl?.computes?.[entry];
      if (!pass || 'none' in pass)
        throw new Error('TypeShade WebGL2 pass unavailable for ' + entry);
    }
  }

  const rt = await createRuntime({ prefer: [tier], programs: [pack] });
  if (rt.tier !== tier) {
    rt.destroy();
    throw new Error('Requested ' + tier + ', received ' + rt.tier);
  }
  const host = buffers(
    { pixels: new Float32Array(batchSize * INPUTS), labels: new Uint32Array(batchSize) },
    initialize(seed),
    batchSize,
  ) as Record<string, Values>;
  const data: Record<string, Resident<Values>> = {};
  const pipelines: Partial<
    Record<Entry, Awaited<ReturnType<ReturnType<typeof rt.load>['compute']>>>
  > = {};
  try {
    const program = rt.load(pack);
    for (const [name, value] of Object.entries(host)) data[name] = resident(value);
    for (const entry of ENTRIES) pipelines[entry] = await program.compute(entry);
  } catch (error) {
    for (const handle of Object.values(data)) handle.destroy();
    rt.destroy();
    throw error;
  }
  const renderer =
    tier === 'webgpu'
      ? (rt.device as GPUDevice).adapterInfo?.description ||
        (rt.device as GPUDevice).adapterInfo?.vendor ||
        'WebGPU adapter'
      : (() => {
          const gl = rt.device as WebGL2RenderingContext;
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return String(
            ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          );
        })();
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();

  function queue<T>(callback: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('MNIST session closed'));
    const result = tail.then(callback);
    tail = result.catch(() => undefined);
    return result;
  }
  function setBatch(pixels: Float32Array, labels: Uint32Array, count: number): void {
    if (
      count < 1 ||
      count > batchSize ||
      labels.length !== count ||
      pixels.length !== count * INPUTS
    )
      throw new RangeError('Invalid MNIST batch');
    host.pixels.fill(0);
    host.pixels.set(pixels);
    host.labels.fill(0);
    host.labels.set(labels);
    data.pixels.write(host.pixels);
    data.labels.write(host.labels);
  }
  async function dispatch(entry: Entry, count: number, rate: number): Promise<void> {
    const workgroups =
      entry === 'reduce' || entry === 'predict'
        ? 1
        : entry === 'backward' || entry === 'update'
          ? Math.ceil((INPUTS * CLASSES) / 64)
          : Math.ceil(count / 64);
    const desc = pack.entries.find((item) => item.name === entry);
    if (!desc?.bindings) throw new Error('MNIST binding manifest missing: ' + entry);
    const available: Record<string, unknown> = { ...data, batch: { count, offset: 0, rate } };
    const reached: Record<string, unknown> = {};
    for (const binding of desc.bindings) {
      if (!(binding.name in available))
        throw new Error('MNIST resource not initialized: ' + binding.name);
      reached[binding.name] = available[binding.name];
    }
    const pipeline = pipelines[entry];
    if (!pipeline) throw new Error('MNIST pipeline not loaded: ' + entry);
    const frame = rt.frame();
    frame.dispatch(pipeline, reached, workgroups);
    await frame.submit();
  }
  return {
    tier,
    renderer,
    trainBatch(pixels, labels, rate) {
      return queue(async () => {
        if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Invalid learning rate');
        setBatch(pixels, labels, labels.length);
        for (const entry of ['forward', 'objective', 'backward', 'update'] as const)
          await dispatch(entry, labels.length, rate);
      });
    },
    evaluateBatch(pixels, labels) {
      return queue(async () => {
        setBatch(pixels, labels, labels.length);
        for (const entry of ['forward', 'objective', 'reduce'] as const)
          await dispatch(entry, labels.length, 0);
        const stats = (await data.stats.read()) as Float32Array;
        if (!Number.isFinite(stats[0]) || !Number.isFinite(stats[1]))
          throw new Error('Non-finite MNIST evaluation statistics');
        return { loss: stats[0], correct: stats[1] };
      });
    },
    predict(pixels) {
      return queue(async () => {
        if (pixels.length !== INPUTS) throw new RangeError('MNIST inference requires 784 pixels');
        setBatch(pixels, new Uint32Array(1), 1);
        await dispatch('forward', 1, 0);
        await dispatch('predict', 1, 0);
        const probabilities = (await data.probabilities.read()) as Float32Array;
        const prediction = (await data.predicted.read()) as Uint32Array;
        const sum = probabilities.reduce((a, b) => a + b, 0);
        if (
          !probabilities.every((value) => Number.isFinite(value) && value >= 0) ||
          Math.abs(sum - 1) > 0.0002 ||
          prediction[0] >= CLASSES
        )
          throw new Error('Invalid TypeShade inference probability output');
        return { probabilities, predicted: prediction[0] };
      });
    },
    readModel() {
      return queue(async () => ({
        weights: (await data.weights.read()) as Float32Array,
        bias: (await data.bias.read()) as Float32Array,
      }));
    },
    async destroy() {
      if (closed) return;
      closed = true;
      await tail;
      for (const handle of Object.values(data)) handle.destroy();
      rt.destroy();
    },
  };
}
