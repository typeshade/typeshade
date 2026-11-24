import { planKernel, type KernelPlan } from './runner/kernel-plan.js';
import { workgroupSizeOf, type ModuleDecl } from '../ir/index.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { emitGlslModule } from '../backends/glsl.js';
import { glslDataTextureOf, type GlslDataTexture } from '../glsl-data-texture.js';
import { emitModule as emitWgslModule } from '../backends/wgsl.js';
import { TIERS } from '../tiers.js';
import { emittedName, spellingsOf } from '../spelling-plan.js';
import type {
  ComputeBackend,
  RejectedBackend,
  ComputeRunnerOptions,
  ComputeRunner,
} from './runner/types.js';
export type {
  ComputeBackend,
  RejectedBackend,
  GpuDeviceLike,
  ComputeRunnerOptions,
  ComputeRunner,
} from './runner/types.js';

interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GpuComputePassLike {
  setPipeline(p: unknown): void;
  setBindGroup(index: number, group: unknown): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}

interface GpuEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(
    src: unknown,
    srcOff: number,
    dst: unknown,
    dstOff: number,
    size: number,
  ): void;
  finish(): unknown;
}

interface GpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}

interface GpuDeviceApi {
  createShaderModule(d: { code: string }): unknown;
  createComputePipeline(d: {
    layout: 'auto';
    compute: { module: unknown; entryPoint: string };
  }): GpuPipelineLike;
  createBuffer(d: { size: number; usage: number }): GpuBufferLike;
  createBindGroup(d: {
    layout: unknown;
    entries: readonly { binding: number; resource: { buffer: GpuBufferLike } }[];
  }): unknown;
  createCommandEncoder(): GpuEncoderLike;
  readonly queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView): void;
    submit(buffers: readonly unknown[]): void;
  };
}

/* Why: `GPUBufferUsage` / `GPUMapMode` flags, spelled out because `types: []` means the real
 *  globals are not declared here. These values are NORMATIVE in the WebGPU spec (§buffer
 *  usage flags), not implementation detail — they are as stable as the API itself. */
const GPU_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;
const GPU_MAP_READ = 0x0001;

const DEFAULT_PREFER: readonly ComputeBackend[] = TIERS;

const MAX_W = 2048;

function createCpuRunner(
  m: ModuleDecl,
  plan: KernelPlan,
): Omit<ComputeRunner, 'backend' | 'rejected'> {
  const cm = compileModuleJs(m);
  const entryFn = cm.fns[plan.entry.name];
  if (typeof entryFn !== 'function')
    throw new Error(`createComputeRunner: compiled module has no entry '${plan.entry.name}'`);
  const gid: [number, number, number] = [0, 0, 0];

  return {
    run(input: Float32Array, invocations?: number): Promise<Uint32Array> {
      const n = invocations ?? input.length;
      const out = new Array<number>(n).fill(0);
      for (const b of plan.readBindings) cm.setBinding(b.name, Array.from(input));
      cm.setBinding(plan.dispatchUniform.name, [n, 0, 0, 0]);
      cm.setBinding(plan.outBinding.name, out);
      for (let i = 0; i < n; i++) {
        gid[0] = i;
        entryFn(gid);
      }
      return Promise.resolve(Uint32Array.from(out));
    },
    dispose(): void {},
  };
}

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

function compileGlProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('createComputeRunner: gl.createShader failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? '';
      gl.deleteShader(sh);
      throw new Error(`createComputeRunner: shader compile failed: ${log}`);
    }
    return sh;
  };
  const prog = gl.createProgram();
  if (!prog) throw new Error('createComputeRunner: gl.createProgram failed');
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '';
    gl.deleteProgram(prog);
    throw new Error(`createComputeRunner: program link failed: ${log}`);
  }
  return prog;
}

function uploadDataTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  data: Float32Array,
  format: GlslDataTexture,
): void {
  const w = Math.min(Math.max(1, data.length), MAX_W);
  const h = Math.ceil(data.length / w);
  const [internal, fmt, type] =
    format === 'r32ui'
      ? [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT]
      : format === 'r32i'
        ? [gl.R32I, gl.RED_INTEGER, gl.INT]
        : [gl.R32F, gl.RED, gl.FLOAT];
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let padded = data;
  if (data.length !== w * h) {
    padded = new Float32Array(w * h);
    padded.set(data);
  }
  const lanes =
    format === 'r32ui'
      ? new Uint32Array(padded.buffer, padded.byteOffset, padded.length)
      : format === 'r32i'
        ? new Int32Array(padded.buffer, padded.byteOffset, padded.length)
        : padded;
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, type, lanes);
}

function createWebGl2Runner(
  gl: WebGL2RenderingContext,
  m: ModuleDecl,
  plan: KernelPlan,
): Omit<ComputeRunner, 'backend' | 'rejected'> {
  const program = compileGlProgram(gl, FULLSCREEN_VS, emitGlslModule(m, 'fragment'));
  const dataTex = gl.createTexture();
  if (!dataTex) throw new Error('createComputeRunner: gl.createTexture failed');

  const glslNames = spellingsOf(m).glsl.bindings;
  const glslName = (n: string): string => glslNames.get(n) ?? n;
  const samplerLoc = gl.getUniformLocation(program, glslName(plan.readBindings[0]?.name ?? ''));
  const read = plan.readBindings[0];
  const dataFormat: GlslDataTexture =
    (read && glslDataTextureOf(read.type, new Map(m.structs.map((s) => [s.name, s])))) ?? 'r32f';
  const dispatchLoc = gl.getUniformLocation(program, glslName(plan.dispatchUniform.name));
  let disposed = false;

  return {
    run(input: Float32Array, invocations?: number): Promise<Uint32Array> {
      if (disposed) throw new Error('createComputeRunner: runner has been disposed');
      const n = invocations ?? input.length;
      if (n === 0) return Promise.resolve(new Uint32Array(0));
      const wOut = Math.min(Math.max(1, n), MAX_W);
      const hOut = Math.ceil(n / wOut);

      const wasBlend = gl.isEnabled(gl.BLEND);
      const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      const prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
      gl.activeTexture(gl.TEXTURE0);
      const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      gl.activeTexture(prevActiveTex);
      const restoreHostState = (): void => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevTex0);
        gl.activeTexture(prevActiveTex);
        gl.useProgram(prevProgram);
        if (wasBlend) gl.enable(gl.BLEND);
      };

      uploadDataTexture(gl, dataTex, input, dataFormat);

      const outTex = gl.createTexture();
      if (!outTex) {
        restoreHostState();
        throw new Error('createComputeRunner: gl.createTexture (out) failed');
      }
      gl.bindTexture(gl.TEXTURE_2D, outTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32UI,
        wOut,
        hOut,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      const fbo = gl.createFramebuffer();
      if (!fbo) {
        gl.deleteTexture(outTex);
        restoreHostState();
        throw new Error('createComputeRunner: gl.createFramebuffer failed');
      }
      const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error(
            `createComputeRunner: R32UI framebuffer incomplete (0x${status.toString(16)})`,
          );

        gl.viewport(0, 0, wOut, hOut);
        gl.disable(gl.BLEND);
        gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0, 0, 0, 0]));

        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dataTex);
        if (samplerLoc) gl.uniform1i(samplerLoc, 0);
        if (dispatchLoc) gl.uniform4uiv(dispatchLoc, new Uint32Array([n, wOut, 0, 0]));

        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        const grid = new Uint32Array(wOut * hOut);
        gl.readPixels(0, 0, wOut, hOut, gl.RED_INTEGER, gl.UNSIGNED_INT, grid);
        return Promise.resolve(grid.slice(0, n));
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(vp[0]!, vp[1]!, vp[2]!, vp[3]!);
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(outTex);
        restoreHostState();
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      gl.deleteProgram(program);
      gl.deleteTexture(dataTex);
    },
  };
}

function createWebGpuRunner(
  device: GpuDeviceApi,
  m: ModuleDecl,
  plan: KernelPlan,
): Omit<ComputeRunner, 'backend' | 'rejected'> {
  const shader = device.createShaderModule({ code: emitWgslModule(m) });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shader,
      entryPoint: emittedName(spellingsOf(m).wgsl.entries, plan.entry.name),
    },
  });
  const layout = pipeline.getBindGroupLayout(0);
  const wg = workgroupSizeOf(plan.entry) ?? 64;
  let disposed = false;

  return {
    async run(input: Float32Array, invocations?: number): Promise<Uint32Array> {
      if (disposed) throw new Error('createComputeRunner: runner has been disposed');
      const n = invocations ?? input.length;
      const outBytes = Math.max(4, n * 4);

      const inBuf = device.createBuffer({
        size: Math.max(4, input.byteLength),
        usage: GPU_USAGE.STORAGE | GPU_USAGE.COPY_DST,
      });
      const outBuf = device.createBuffer({
        size: outBytes,
        usage: GPU_USAGE.STORAGE | GPU_USAGE.COPY_SRC,
      });
      const countBuf = device.createBuffer({
        size: 16,
        usage: GPU_USAGE.UNIFORM | GPU_USAGE.COPY_DST,
      });
      const stagingBuf = device.createBuffer({
        size: outBytes,
        usage: GPU_USAGE.MAP_READ | GPU_USAGE.COPY_DST,
      });
      try {
        device.queue.writeBuffer(inBuf, 0, input);
        device.queue.writeBuffer(countBuf, 0, new Uint32Array([n, 0, 0, 0]));

        const bind = device.createBindGroup({
          layout,
          entries: [
            ...plan.readBindings.map((b) => ({ binding: b.binding, resource: { buffer: inBuf } })),
            { binding: plan.outBinding.binding, resource: { buffer: outBuf } },
            { binding: plan.dispatchUniform.binding, resource: { buffer: countBuf } },
          ],
        });

        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(Math.ceil(n / wg));
        pass.end();
        enc.copyBufferToBuffer(outBuf, 0, stagingBuf, 0, outBytes);
        device.queue.submit([enc.finish()]);

        await stagingBuf.mapAsync(GPU_MAP_READ);
        const got = new Uint32Array(stagingBuf.getMappedRange().slice(0, n * 4));
        stagingBuf.unmap();
        return got;
      } finally {
        inBuf.destroy();
        outBuf.destroy();
        countBuf.destroy();
        stagingBuf.destroy();
      }
    },
    dispose(): void {
      disposed = true;
    },
  };
}

/** Build a runner for `m`, resolving the backend ONCE against `prefer`.
 *
 *  Throws — rather than silently degrading — when no candidate in `prefer` is available;
 *  the error lists every rejection reason, so "why is this on the CPU?" is answerable
 *  from the message alone.
 *
 *  @throws when the module has no `portable: true` compute entry, when that entry is
 *  outside the gather-only tier (the analyzer's own sentences, the `SD0111` text), or
 *  when no preferred backend can be built.
 */
export async function createComputeRunner(
  m: ModuleDecl,
  opts?: ComputeRunnerOptions,
): Promise<ComputeRunner> {
  const plan = planKernel(m);
  const prefer = opts?.prefer ?? DEFAULT_PREFER;
  const rejected: RejectedBackend[] = [];

  for (const backend of prefer) {
    if (backend === 'webgpu') {
      if (!opts?.device) {
        rejected.push({ backend, reason: 'no WebGPU device was passed (`device`)' });
        continue;
      }
      const offGroup = [plan.outBinding, plan.dispatchUniform, ...plan.readBindings].find(
        (b) => b.group !== 0,
      );
      if (offGroup) {
        rejected.push({
          backend,
          reason: `binding '${offGroup.name}' is declared in @group(${offGroup.group}); this tier builds its bind group from \`layout: 'auto'\` + getBindGroupLayout(0), so every binding a portable kernel touches must be in @group(0)`,
        });
        continue;
      }
      const impl = createWebGpuRunner(opts.device as GpuDeviceApi, m, plan);
      return { backend, rejected, run: impl.run, dispose: impl.dispose };
    }
    if (backend === 'webgl2') {
      if (!opts?.gl) {
        rejected.push({ backend, reason: 'no WebGL2 context was passed (`gl`)' });
        continue;
      }
      const impl = createWebGl2Runner(opts.gl, m, plan);
      return { backend, rejected, run: impl.run, dispose: impl.dispose };
    }
    const impl = createCpuRunner(m, plan);
    return { backend: 'cpu', rejected, run: impl.run, dispose: impl.dispose };
  }

  throw new Error(
    `createComputeRunner: no backend from [${prefer.join(', ')}] could be used. ` +
      rejected.map((r) => `${r.backend}: ${r.reason}`).join('; '),
  );
}
