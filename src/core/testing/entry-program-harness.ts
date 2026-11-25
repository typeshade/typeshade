import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GpuDevice } from '../host-entry.js';

export const SOURCE = `"use typeshade";
class Params { k: f32; }
declare const params: uniform<Params>;
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
declare const total: storage<f32, "read_write">;
@compute([4]) export function scale(g: builtin<"global_invocation_id">) {
  out[g.x] = xs[g.x] * params.k;
  if (g.x == 0) { total = 7.; }
}
declare const photo: texture_2d<f32>;
declare const smp: sampler;
@compute([4]) export function look(g: builtin<"global_invocation_id">) {
  out[g.x] = textureSampleLevel(photo, smp, vec2f(0.5), 0.).y;
}
@compute([4]) export function shout(g: builtin<"global_invocation_id">) {
  out[g.x] = 1.;
  console.log("x", g.x);
}
@compute([4]) export function twin(g: builtin<"global_invocation_id">) {
  out[g.x] = xs[g.x] + params.k;
}
`;

export const WIDE = `"use typeshade";
declare const values: storage<array<f64>, "read_write">;
@compute([4]) export function dbl(gid: builtin<"global_invocation_id">) {
  if (gid.x < values.length) {
    values[gid.x] = values[gid.x] * f64(2.) + values[0];
  }
}
`;

export type Call = (...a: unknown[]) => Promise<void>;
export type Entries = Record<'scale' | 'twin' | 'look' | 'shout', Call>;

export interface Face {
  readonly diagnostics: readonly { readonly category: string }[];
  readonly code?: string;
}

export type MakeFace = (
  source: string,
  options: { fileName: string; runtime: string; console?: 'gpu' },
) => Face;

export async function loadEntries(
  makeFace: MakeFace,
  recordConsole = false,
  source = SOURCE,
): Promise<Entries> {
  const face = makeFace(source, {
    fileName: '/app/m.shade.ts',
    runtime: resolve(__dirname, '../host-runtime.ts'),
    ...(recordConsole ? { console: 'gpu' as const } : {}),
  });
  if (face.diagnostics.some((d) => d.category === 'error')) throw new Error('does not compile');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-entry-program-'));
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Entries;
}

export interface FakeOptions {
  readonly validation?: string;
  readonly compile?: readonly { type: string; message: string }[];
  readonly bindGroupFailsOnce?: string;
  readonly withoutClearBuffer?: boolean;
  readonly onDispatch?: (storage: ArrayBuffer[]) => void;
}

export interface FakeTexture {
  readonly format: string;
  destroys: number;
}

export interface FakeBuffer {
  readonly size: number;
  readonly usage: number;
  readonly bytes: ArrayBuffer;
  destroys: number;
}

const COPY_SRC = 4;
const STORAGE = 128;

export function fakeGpu(options: FakeOptions = {}) {
  const commands: string[] = [];
  const made: FakeBuffer[] = [];
  const shaders: string[] = [];
  const pipelines: string[] = [];
  const textures: FakeTexture[] = [];
  const bound: { buffer: FakeBuffer; size: number | undefined }[][] = [];
  let bindGroupFailures = options.bindGroupFailsOnce === undefined ? 0 : 1;
  const device = {
    features: new Set<string>(),
    limits: {},
    lost: new Promise<never>(() => undefined),
    createShaderModule: (d: { code: string }) => {
      shaders.push(d.code);
      return {
        getCompilationInfo: async () => ({
          messages: (options.compile ?? []).map((m) => ({ ...m, lineNum: 3, linePos: 4 })),
        }),
      };
    },
    createComputePipeline: (d: { compute: { entryPoint: string } }) => {
      pipelines.push(d.compute.entryPoint);
      return { getBindGroupLayout: () => ({}) };
    },
    createTexture: (d: { format: string }) => {
      const t: FakeTexture = { format: d.format, destroys: 0 };
      textures.push(t);
      return {
        createView: () => ({}),
        destroy: () => {
          t.destroys++;
        },
      };
    },
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: (d: {
      entries: { resource: { buffer?: { record: FakeBuffer }; size?: number } }[];
    }) => {
      if (bindGroupFailures > 0) {
        bindGroupFailures--;
        throw new Error(options.bindGroupFailsOnce);
      }
      bound.push(
        d.entries.flatMap((e) =>
          e.resource.buffer === undefined
            ? []
            : [{ buffer: e.resource.buffer.record, size: e.resource.size }],
        ),
      );
      return {};
    },
    createBuffer: (d: { size: number; usage: number }) => {
      const record: FakeBuffer = {
        size: d.size,
        usage: d.usage,
        bytes: new ArrayBuffer(d.size),
        destroys: 0,
      };
      made.push(record);
      return {
        record,
        mapAsync: async () => undefined,
        getMappedRange: () => record.bytes,
        unmap: () => undefined,
        destroy: () => {
          record.destroys++;
        },
      };
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        dispatchWorkgroupsIndirect: (_b: unknown, offset: number) => {
          commands.push(`dispatchIndirect at ${offset}`);
        },
        dispatchWorkgroups: (x: number) => {
          commands.push(`dispatch ${x}`);
          options.onDispatch?.(
            made
              .filter((b) => (b.usage & STORAGE) !== 0 && (b.usage & COPY_SRC) !== 0)
              .map((b) => b.bytes),
          );
        },
        end: () => undefined,
      }),
      copyBufferToBuffer: (
        s: { record: FakeBuffer },
        so: number,
        d: { record: FakeBuffer },
        dO: number,
        n: number,
      ) => {
        new Uint8Array(d.record.bytes, dO, n).set(new Uint8Array(s.record.bytes, so, n));
        commands.push('copy');
      },
      ...(options.withoutClearBuffer
        ? {}
        : {
            clearBuffer: (b: { record: FakeBuffer }) => {
              new Uint8Array(b.record.bytes).fill(0);
              commands.push('clear');
            },
          }),
      finish: () => ({}),
    }),
    pushErrorScope: () => commands.push('push'),
    popErrorScope: async () => {
      commands.push('pop');
      return options.validation === undefined ? null : { message: options.validation };
    },
    queue: {
      writeTexture: () => undefined,
      writeBuffer: (b: { record: FakeBuffer }, at: number, data: ArrayBuffer | ArrayBufferView) => {
        const src = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        new Uint8Array(b.record.bytes, at, src.byteLength).set(src);
        commands.push('write');
      },
      submit: () => commands.push('submit'),
      onSubmittedWorkDone: async () => undefined,
    },
  };
  return {
    device: device as unknown as GpuDevice,
    commands,
    made,
    shaders,
    pipelines,
    textures,
    bound,
  };
}

export class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(4 * width * height);
  }
}
