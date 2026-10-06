// The page side of the WebGL2 compute arm (`gl-compute-arm.ts`): the executor, bundled for the
// browser, and one function the arm calls with a program and its memory. Nothing from the
// compiler: the program arrives built.

import { runGlCompute } from '../src/core/gl-compute.js';
import type { GlComputeProgram } from '../src/core/passes/gl-compute.js';

/** One dispatch the arm asks for. */
export interface ComputeJob {
  readonly id: string;
  readonly program: GlComputeProgram;
  readonly workgroups: number;
  readonly memory: Readonly<Record<string, number[]>>;
  readonly uniforms: Readonly<Record<string, unknown>>;
}

/** What came back: each storage root's words, or why it did not run. */
export interface ComputeResult {
  readonly id: string;
  readonly memory?: Record<string, number[]>;
  readonly passes?: number;
  readonly error?: string;
}

let gl: WebGL2RenderingContext | undefined;

function run(jobs: readonly ComputeJob[]): { renderer: string; results: ComputeResult[] } {
  if (gl === undefined) {
    const made = document.createElement('canvas').getContext('webgl2');
    if (made === null)
      throw new Error('getContext("webgl2") returned null: WebGL2 is not reachable');
    gl = made;
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    debug === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
  );
  const results = jobs.map((job): ComputeResult => {
    const memory: Record<string, Uint32Array> = {};
    for (const [k, v] of Object.entries(job.memory)) memory[k] = new Uint32Array(v);
    try {
      const r = runGlCompute(gl!, job.program, {
        workgroups: [job.workgroups, 1, 1],
        memory,
        uniforms: job.uniforms,
      });
      return {
        id: job.id,
        passes: r.passes,
        memory: Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, [...v]])),
      };
    } catch (e) {
      return { id: job.id, error: e instanceof Error ? e.message : String(e) };
    }
  });
  return { renderer, results };
}

/** Each job run `reps` times after one warm-up run: the median time of one run, in ms. */
function bench(
  jobs: readonly ComputeJob[],
  reps: number,
): { renderer: string; results: { id: string; passes: number; ms: number }[] } {
  const first = run(jobs);
  const results = jobs.map((job, k) => {
    const times: number[] = [];
    for (let r = 0; r < reps; r++) {
      const t0 = performance.now();
      run([job]);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { id: job.id, passes: first.results[k]!.passes ?? 0, ms: times[times.length >> 1]! };
  });
  return { renderer: first.renderer, results };
}

/** One pass of the executor's shape over `n` words, with the memory as `R32UI` and as `R32F`
 *  (decision 5 of change 0054): a fragment per word reads its word from the memory texture and
 *  writes it to a target of the same kind, which the host reads back. The median time of one
 *  pass, in ms, for each format; `null` for `R32F` without `EXT_color_buffer_float`. */
function benchFormats(n: number, reps: number): { r32ui: number; r32f: number | null } {
  const c = gl ?? document.createElement('canvas').getContext('webgl2')!;
  gl = c;
  const floats = c.getExtension('EXT_color_buffer_float') !== null;
  const w = 2048;
  const h = Math.ceil(n / w);
  const vs = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const fsOf = (f: boolean): string => `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform highp ${f ? 'sampler2D' : 'usampler2D'} m;
out ${f ? 'vec4' : 'uvec4'} o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); o = ${f ? 'vec4' : 'uvec4'}(texelFetch(m, q, 0).r); }`;
  const one = (f: boolean): number => {
    const sh = (t: number, src: string): WebGLShader => {
      const x = c.createShader(t)!;
      c.shaderSource(x, src);
      c.compileShader(x);
      return x;
    };
    const prog = c.createProgram()!;
    c.attachShader(prog, sh(c.VERTEX_SHADER, vs));
    c.attachShader(prog, sh(c.FRAGMENT_SHADER, fsOf(f)));
    c.linkProgram(prog);
    const tex = (internal: number, format: number, type: number, data: ArrayBufferView | null) => {
      const t = c.createTexture()!;
      c.bindTexture(c.TEXTURE_2D, t);
      c.texImage2D(c.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, c.NEAREST);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MAG_FILTER, c.NEAREST);
      return t;
    };
    const mem = f
      ? tex(c.R32F, c.RED, c.FLOAT, new Float32Array(w * h).fill(1.5))
      : tex(c.R32UI, c.RED_INTEGER, c.UNSIGNED_INT, new Uint32Array(w * h).fill(7));
    const target = f
      ? tex(c.RGBA32F, c.RGBA, c.FLOAT, null)
      : tex(c.RGBA32UI, c.RGBA_INTEGER, c.UNSIGNED_INT, null);
    const fbo = c.createFramebuffer()!;
    c.bindFramebuffer(c.FRAMEBUFFER, fbo);
    c.framebufferTexture2D(c.FRAMEBUFFER, c.COLOR_ATTACHMENT0, c.TEXTURE_2D, target, 0);
    c.useProgram(prog);
    c.activeTexture(c.TEXTURE0);
    c.bindTexture(c.TEXTURE_2D, mem);
    c.uniform1i(c.getUniformLocation(prog, 'm'), 0);
    c.viewport(0, 0, w, h);
    const px = f ? new Float32Array(w * h * 4) : new Uint32Array(w * h * 4);
    const times: number[] = [];
    for (let r = 0; r <= reps; r++) {
      const t0 = performance.now();
      c.drawArrays(c.TRIANGLES, 0, 3);
      if (f) c.readPixels(0, 0, w, h, c.RGBA, c.FLOAT, px);
      else c.readPixels(0, 0, w, h, c.RGBA_INTEGER, c.UNSIGNED_INT, px);
      if (r > 0) times.push(performance.now() - t0);
    }
    c.deleteTexture(mem);
    c.deleteTexture(target);
    c.deleteFramebuffer(fbo);
    c.deleteProgram(prog);
    times.sort((a, b) => a - b);
    return times[times.length >> 1]!;
  };
  return { r32ui: one(false), r32f: floats ? one(true) : null };
}

(globalThis as Record<string, unknown>)['__runCompute'] = run;
(globalThis as Record<string, unknown>)['__benchCompute'] = bench;
(globalThis as Record<string, unknown>)['__benchFormats'] = benchFormats;
