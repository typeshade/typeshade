import type {
  RhiBindEntry,
  RhiBindLayoutEntry,
  RhiBuffer,
  RhiBufferDesc,
  RhiCommandEncoder,
  RhiDevice,
  RhiRenderPass,
  RhiRenderPassDesc,
  RhiRenderPipelineDesc,
  RhiTexture,
  RhiTextureDesc,
} from './rhi.js';

export interface RecordingOptions {
  readonly viewportLimit?: number;
  readonly features?: readonly string[];
  readonly inactive?: readonly number[];
  readonly rejectPipelines?: number;
}

export interface Recording {
  readonly rhi: RhiDevice;
  readonly log: string[];
  readonly layouts: RhiBindLayoutEntry[][];
  readonly bindGroups: RhiBindEntry[][];
  readonly buffers: RhiBuffer[];
  readonly textures: RhiTexture[];
  readonly textureDescs: RhiTextureDesc[];
  readonly bufferDescs: RhiBufferDesc[];
  readonly writes: { readonly buffer: RhiBuffer; readonly bytes: Uint8Array }[];
  readonly textureWrites: { readonly texture: RhiTexture; readonly bytes: Uint8Array }[];
  readonly reads: { readonly texture: RhiTexture; readonly bytesPerTexel: number }[];
  readonly passes: RhiRenderPass[];
  readonly passDescs: RhiRenderPassDesc[];
  pipelines: number;
}

const bytesOf = (data: ArrayBuffer | ArrayBufferView): Uint8Array =>
  ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    : new Uint8Array(data.slice(0));

export function recordingRhi(options: RecordingOptions = {}): Recording {
  const log: string[] = [];
  const ids = new WeakMap<object, number>();
  let next = 0;
  const id = (o: object): string => {
    if (!ids.has(o)) ids.set(o, next++);
    return `#${ids.get(o)}`;
  };
  const rec: Recording = {
    rhi: undefined as unknown as RhiDevice,
    log,
    layouts: [],
    bindGroups: [],
    buffers: [],
    textures: [],
    textureDescs: [],
    bufferDescs: [],
    writes: [],
    textureWrites: [],
    reads: [],
    passes: [],
    passDescs: [],
    pipelines: 0,
  };
  const handle = <K extends string>(kind: K, extra: object = {}) => ({ __rhi: kind, ...extra });
  const pass = (): RhiRenderPass => {
    const call =
      (name: string) =>
      (...args: unknown[]): void => {
        log.push(
          `${name}(${args
            .map((a) =>
              typeof a === 'object' && a !== null && '__rhi' in a
                ? `${(a as { __rhi: string }).__rhi}${id(a)}`
                : Array.isArray(a)
                  ? `[${a.join(',')}]`
                  : String(a),
            )
            .join(',')})`,
        );
      };
    const p = {
      setPipeline: call('setPipeline'),
      setBindGroup: call('setBindGroup'),
      setVertexBuffer: call('setVertexBuffer'),
      setIndexBuffer: call('setIndexBuffer'),
      draw: call('draw'),
      drawIndexed: call('drawIndexed'),
      setViewport: call('setViewport'),
      setScissorRect: call('setScissorRect'),
      setBlendConstant: call('setBlendConstant'),
      setStencilReference: call('setStencilReference'),
      end: call('end'),
    };
    rec.passes.push(p);
    return p;
  };
  const rhi = {
    backend: 'webgl2',
    native: null,
    caps: {
      compute: 'fragment-emulated',
      shaderLanguage: 'glsl-es300',
      immediate: true,
      limits: { maxViewportDimension: options.viewportLimit ?? 8192 },
      hasFeature: (name: string) => options.features?.includes(name) ?? false,
    },
    createBuffer(desc: RhiBufferDesc) {
      const b = handle('buffer', { size: desc.size }) as unknown as RhiBuffer;
      rec.buffers.push(b);
      rec.bufferDescs.push(desc);
      log.push(`createBuffer${id(b)}(${desc.size},${desc.usage.join('|')})`);
      return b;
    },
    writeBuffer(buffer: RhiBuffer, byteOffset: number, data: ArrayBuffer | ArrayBufferView) {
      rec.writes.push({ buffer, bytes: bytesOf(data) });
      log.push(`writeBuffer${id(buffer)}(${byteOffset})`);
    },
    readBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    destroyBuffer(b: RhiBuffer) {
      log.push(`destroyBuffer${id(b)}`);
    },
    createTexture(desc: RhiTextureDesc) {
      const [width, height] = desc.size;
      const t = handle('texture', { width, height, format: desc.format }) as unknown as RhiTexture;
      rec.textures.push(t);
      rec.textureDescs.push(desc);
      log.push(`createTexture${id(t)}(${width}x${height},${desc.format})`);
      return t;
    },
    writeTexture(t: RhiTexture, data: ArrayBufferView) {
      rec.textureWrites.push({ texture: t, bytes: bytesOf(data) });
      log.push(`writeTexture${id(t)}`);
    },
    readTexture(t: RhiTexture, bytesPerTexel: number) {
      rec.reads.push({ texture: t, bytesPerTexel });
      log.push(`readTexture${id(t)}`);
      return Promise.resolve(new Uint8Array(t.width * t.height * bytesPerTexel));
    },
    destroyTexture(t: RhiTexture) {
      log.push(`destroyTexture${id(t)}`);
    },
    createView: (t: RhiTexture) => handle('view', { of: t }),
    currentTexture: () => handle('texture', { width: 1, height: 1, format: 'rgba8unorm' }),
    createSampler: () => handle('sampler'),
    createShaderModule: () => handle('module'),
    createBindGroupLayout(entries: readonly RhiBindLayoutEntry[]) {
      rec.layouts.push([...entries]);
      return handle('bindlayout', { entries });
    },
    createBindGroup(_layout: object, entries: readonly RhiBindEntry[]) {
      rec.bindGroups.push([...entries]);
      return handle('bindgroup');
    },
    createComputePipeline: () => Promise.reject(new Error('no compute')),
    createRenderPipeline(desc: RhiRenderPipelineDesc) {
      rec.pipelines++;
      log.push('createRenderPipeline');
      if (rec.pipelines <= (options.rejectPipelines ?? 0))
        return Promise.reject(new Error('the device refused the pipeline'));
      const layout = desc.layouts[0] as unknown as { entries: readonly RhiBindLayoutEntry[] };
      const read = layout.entries
        .map((e) => e.binding)
        .filter((b) => !(options.inactive ?? []).includes(b));
      return Promise.resolve(handle('pipeline', { slots: [read.map((binding) => ({ binding }))] }));
    },
    createCommandEncoder: (): RhiCommandEncoder => ({
      beginRenderPass: (desc: RhiRenderPassDesc) => {
        rec.passDescs.push(desc);
        log.push('beginRenderPass');
        return pass();
      },
      beginComputePass: () => {
        throw new Error('no compute');
      },
      copyBufferToBuffer: () => undefined,
    }),
    submit() {
      log.push('submit');
      return Promise.resolve();
    },
    pushValidationScope: () => undefined,
    popValidationScope: () => Promise.resolve(null),
    fromNative: (kind: string, native: object) =>
      (native as { __rhi?: string }).__rhi === kind ? native : undefined,
    toNative: (h: object) => h,
    destroy: () => undefined,
  };
  return Object.assign(rec, { rhi: rhi as unknown as RhiDevice });
}
