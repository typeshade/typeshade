import type { KernelPlan } from './kernel-plan.js';
import type { ModuleDecl } from '../../ir/index.js';
import { emitGlslModule } from '../../backends/glsl.js';
import { glslDataTextureOf, type GlslDataTexture } from '../../glsl-data-texture.js';
import { spellingsOf } from '../../spelling-plan.js';
import type { ComputeRunner } from './types.js';

const MAX_W = 2048;

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

export function createWebGl2Runner(
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
