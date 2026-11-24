import type {
  RhiBindLayoutEntry,
  RhiDepthStencilState,
  RhiDevice,
  RhiRenderPass,
  RhiRenderPassDesc,
  RhiRenderPipeline,
  RhiRenderPipelineDesc,
} from './rhi.js';

export interface FakeGlOptions {
  readonly extensions?: Readonly<Record<string, object>>;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly returns?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  readonly missing?: readonly string[];
  readonly size?: readonly [number, number];
}

export interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  readonly calls: string[];
  readonly uploads: ArrayLike<number>[];
  constant(name: string): number;
  named(value: number): string;
  resize(width: number, height: number): void;
  of(...names: string[]): string[];
}

const DEFAULT_PARAMETERS: Record<string, () => unknown> = {
  MAX_COLOR_ATTACHMENTS: () => 4,
  VIEWPORT: () => new Int32Array([0, 0, 8, 8]),
  DEPTH_RANGE: () => new Float32Array([0, 1]),
  BLEND_COLOR: () => new Float32Array([0, 0, 0, 0]),
  MAX_VIEWPORT_DIMS: () => new Int32Array([4096, 2048]),
};

export function fakeGl(options: FakeGlOptions = {}): FakeGl {
  const calls: string[] = [];
  const uploads: ArrayLike<number>[] = [];
  const values = new Map<string, number>();
  const names = new Map<number, string>();
  let next = 0x4000;
  let made = 0;
  const [width, height] = options.size ?? [8, 8];
  const constant = (name: string): number => {
    let v = values.get(name);
    if (v === undefined) {
      const run = name === 'COLOR_ATTACHMENT0' ? 16 : name === 'TEXTURE0' ? 32 : 1;
      for (let k = 0; k < run; k++) {
        const each = run === 1 ? name : name.replace(/0$/, String(k));
        values.set(each, next);
        names.set(next, each);
        next++;
      }
      v = values.get(name)!;
    }
    return v;
  };
  const named = (value: number): string => names.get(value) ?? String(value);
  const show = (v: unknown): string => {
    if (typeof v === 'number') return named(v);
    if (typeof v === 'boolean' || v === null || v === undefined) return String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (ArrayBuffer.isView(v))
      return `[${Array.from(v as unknown as ArrayLike<number>).join(',')}]`;
    if (Array.isArray(v)) return `[${v.map(show).join(',')}]`;
    if (typeof v === 'object' && '__name' in v) return (v as { __name: string }).__name;
    return typeof v;
  };
  const object = (kind: string) => (): object => ({ __name: `${kind}${String(made++)}` });
  const host: Record<string, (...a: unknown[]) => unknown> = {
    getParameter: (p) => {
      const key = named(p as number);
      if (options.parameters !== undefined && key in options.parameters)
        return options.parameters[key];
      return DEFAULT_PARAMETERS[key]?.();
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isProgram: () => true,
    getUniformBlockIndex: () => 0,
    getActiveUniformBlockParameter: () => 64,
    getUniformLocation: (_p, name) => ({ __name: `location:${String(name)}` }),
    getError: () => constant('NO_ERROR'),
    clientWaitSync: () => constant('ALREADY_SIGNALED'),
    createShader: object('shader'),
    createProgram: object('program'),
    createVertexArray: object('vao'),
    createFramebuffer: object('fbo'),
    createSampler: object('sampler'),
    createTexture: object('texture'),
    createBuffer: object('buffer'),
    fenceSync: object('fence'),
    bufferData: (_target, data) => {
      if (ArrayBuffer.isView(data)) uploads.push(data as unknown as ArrayLike<number>);
      else if (data instanceof ArrayBuffer) uploads.push(new Uint8Array(data));
    },
    getExtension: (name) => options.extensions?.[String(name)] ?? null,
  };
  const props: Record<string, unknown> = {
    drawingBufferWidth: width,
    drawingBufferHeight: height,
    canvas: { __name: 'canvas' },
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (key in props) return props[key];
        if (/^[A-Z][A-Z0-9_]*$/.test(key))
          return options.missing?.includes(key) === true ? undefined : constant(key);
        const fn = options.returns?.[key] ?? host[key] ?? (() => undefined);
        return (...a: unknown[]) => {
          calls.push(`${key}(${a.map(show).join(',')})`);
          return fn(...a);
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  const of = (...wanted: string[]): string[] =>
    calls.filter((c) => wanted.some((w) => c.startsWith(`${w}(`)));
  const resize = (w: number, h: number): void => {
    props.drawingBufferWidth = w;
    props.drawingBufferHeight = h;
  };
  return { gl, calls, uploads, constant, named, resize, of };
}

export const VERTEX = (declarations = ''): string => `#version 300 es
${declarations}
void main() { gl_Position = vec4(0.0); }
`;

export const FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out vec4 o;
void main() { o = vec4(1.0); }
`;

export interface PipelineOptions {
  readonly vertex?: string;
  readonly layouts?: readonly RhiBindLayoutEntry[][];
  readonly topology?: string;
  readonly cullMode?: 'none' | 'front' | 'back';
  readonly frontFace?: 'ccw' | 'cw';
  readonly targets?: readonly { format: string; blend?: object; writeMask?: number }[] | null;
  readonly depthStencil?: RhiDepthStencilState;
  readonly buffers?: RhiRenderPipelineDesc['vertex']['buffers'];
}

export function pipelineOf(
  device: RhiDevice,
  options: PipelineOptions = {},
): Promise<RhiRenderPipeline> {
  const targets = options.targets === undefined ? [{ format: 'rgba8unorm' }] : options.targets;
  return device.createRenderPipeline({
    label: 'the pipeline of the test',
    layouts: (options.layouts ?? []).map((entries) => device.createBindGroupLayout(entries)),
    module: device.createShaderModule(options.vertex ?? VERTEX()),
    vertex: { entryPoint: 'main', buffers: options.buffers ?? [] },
    ...(targets === null
      ? {}
      : {
          fragment: {
            entryPoint: 'main',
            targets,
            module: device.createShaderModule(FRAGMENT),
          },
        }),
    primitive: {
      topology: options.topology ?? 'triangle-list',
      cullMode: options.cullMode ?? 'none',
      frontFace: options.frontFace ?? 'ccw',
    },
    ...(options.depthStencil === undefined ? {} : { depthStencil: options.depthStencil }),
    multisample: { count: 1, mask: 0xffffffff },
  });
}

export const NO_BIAS = { constant: 0, slopeScale: 0, clamp: 0 } as const;

export function renderPass(
  device: RhiDevice,
  desc: (device: RhiDevice) => RhiRenderPassDesc,
  draws: (pass: RhiRenderPass) => void = () => undefined,
): void {
  const p = device.createCommandEncoder().beginRenderPass(desc(device));
  draws(p);
  p.end();
}

export function colourPass(
  device: RhiDevice,
  attachment: Partial<RhiRenderPassDesc['colorAttachments'][number]> = {},
  draws: (pass: RhiRenderPass) => void = () => undefined,
): void {
  renderPass(
    device,
    (d) => ({
      colorAttachments: [
        {
          view: d.createView(
            d.createTexture({ size: [8, 8, 1], format: 'rgba8unorm', usage: ['render'] }),
          ),
          loadOp: 'load',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
          ...attachment,
        },
      ],
    }),
    draws,
  );
}
