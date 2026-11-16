// #689: host calls that distinguish element length from backing capacity or lane count.
// Verifies: Rule 8.23, Rule 11.8, Rule 13.3.
// Measured 2026-11-07 with Chromium 156.0.8078.4, ANGLE/SwiftShader (software):
// baseline f826ece5 refused all 10 WebGL2 calls with "arrayLength has no GLSL ES 3.00
// spelling"; its 20 WebGPU/CPU controls passed. This fix passes all 30 exact readbacks,
// including an actual input-length perturbation from 3 to 4 on each tier.
import { createDevice, type Buffer } from '../src/runtime.js';
import type { u32 } from '../src/runtime/host-types.js';

export const KERNEL_LENGTH_SOURCE = `"use typeshade";
interface Item { value: vec4; flag: u32; }
export function measure(out: array<u32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x.length;
}
export function own(out: array<u32>, x: array<f32>): void {
  for (let i: u32 = 1; i < out.length; i++) out[i] = out.length + x.length;
}
export function vector(out: array<u32>, x: array<vec4>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x.length;
}
export function record(out: array<u32>, x: array<Item>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x.length;
}
export function dynamic(out: array<u32>, count: array<u32>, x: array<f32>): void {
  for (let i: u32 = 0; i < count[0]; i++) out[i] = x.length;
}
`;

export interface KernelLengthModule {
  readonly measure: (out: Buffer<u32>, x: unknown) => Promise<void>;
  readonly own: (out: Buffer<u32>, x: unknown) => Promise<void>;
  readonly vector: (out: Buffer<u32>, x: unknown) => Promise<void>;
  readonly record: (out: Buffer<u32>, x: unknown) => Promise<void>;
  readonly dynamic: (out: Buffer<u32>, count: Uint32Array, x: unknown) => Promise<void>;
}
type Tier = 'webgpu' | 'webgl2' | 'cpu';
interface Readback {
  readonly name: string;
  readonly tier: Tier;
  readonly values?: readonly number[];
  readonly error?: string;
}
export interface KernelLengthReport {
  readonly rows: readonly Readback[];
}

// Values come from the host inputs below, not the shader or another tier.
const EXPECTED: Readonly<Record<string, readonly number[]>> = {
  subarray: [3, 3, 3, 3, 3],
  own: [99, 8, 8, 8, 8],
  vector: [3, 3, 3, 3, 3],
  record: [2, 2, 2, 2, 2],
  resident: [3, 3, 3, 3, 3],
  resized: [4, 4, 4, 4, 4],
  dynamic: [3, 3, 99, 99, 99],
  clipped: [3, 3, 3, 3, 3],
  zeroRange: [99, 99, 99, 99, 99],
  perturbed: [4, 4, 4, 4, 4],
};
const TIERS: readonly Tier[] = ['webgpu', 'webgl2', 'cpu'];

/** Each tier is required alone. Owner inference from the output prevents silent fallback. */
export async function runKernelLengths(module: KernelLengthModule): Promise<KernelLengthReport> {
  const rows: Readback[] = [];
  for (const tier of TIERS) {
    const device = await createDevice({ prefer: [tier] });
    try {
      if (device.tier !== tier)
        throw new Error(`kernel lengths opened ${device.tier}, not ${tier}`);
      const subarray = new Float32Array(32).subarray(4, 7);
      const held = device.array(subarray);
      const draw = async (
        name: string,
        call: (out: Buffer<u32>) => Promise<void>,
      ): Promise<void> => {
        const out = device.array(new Uint32Array(5).fill(99));
        try {
          await call(out);
          rows.push({ name, tier, values: [...(await out.read())] });
        } catch (error) {
          rows.push({ name, tier, error: error instanceof Error ? error.message : String(error) });
        } finally {
          out.dispose();
        }
      };
      await draw('subarray', (out) => module.measure(out, subarray));
      await draw('own', (out) => module.own(out, subarray));
      await draw('vector', (out) => module.vector(out, new Float32Array(32).subarray(4, 16)));
      await draw('record', (out) =>
        module.record(out, [
          { value: [1, 2, 3, 4], flag: 5 },
          { value: [6, 7, 8, 9], flag: 10 },
        ]),
      );
      await draw('resident', (out) => module.measure(out, held));
      held.set(new Float32Array(4));
      await draw('resized', (out) => module.measure(out, held));
      await draw('dynamic', (out) => module.dynamic(out, new Uint32Array([2]), subarray));
      await draw('clipped', (out) => module.dynamic(out, new Uint32Array([8]), subarray));
      await draw('zeroRange', (out) => module.dynamic(out, new Uint32Array([0]), subarray));
      // Actual changed input, not a fabricated result: it must differ from the subarray call.
      await draw('perturbed', (out) => module.measure(out, new Float32Array(4)));
      held.dispose();
    } finally {
      await device.dispose();
    }
  }
  return { rows };
}

export function kernelLengthFailures(report: KernelLengthReport): string[] {
  const failures: string[] = [];
  const matches = (got: readonly number[] | undefined, expected: readonly number[]): boolean =>
    got?.length === expected.length && got.every((value, i) => value === expected[i]);
  const count = TIERS.length * Object.keys(EXPECTED).length;
  if (
    report.rows.length !== count ||
    new Set(report.rows.map((row) => `${row.tier}:${row.name}`)).size !== count
  )
    failures.push('kernel length inventory differs');
  for (const tier of TIERS) {
    for (const [name, expected] of Object.entries(EXPECTED)) {
      const row = report.rows.find((row) => row.name === name && row.tier === tier);
      if (row?.error !== undefined || !matches(row?.values, expected))
        failures.push(`${tier} ${name}: ${JSON.stringify(row)}`);
    }
    const perturbed = report.rows.find((row) => row.name === 'perturbed' && row.tier === tier);
    if (matches(perturbed?.values, EXPECTED.subarray!))
      failures.push(`${tier}: changed-length instrument was blind`);
  }
  return failures;
}
