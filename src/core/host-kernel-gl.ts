// ═══ A kernel function's loops on WebGL2 (Rule 11.8, surface §65, change 0013) ═══
//
// WebGL2 has no compute stage and no storage buffer. A loop that writes one array of 4-byte
// elements at exactly `i` runs as a fragment program instead (`lowerKernelGl`,
// `core/passes/kernel-lower.ts`, through the GLSL writer's compute→fragment lowering): one
// fullscreen draw into an `R32UI` target, one texel per iteration, and a readback. Each array
// it reads is a data texture of its name, and each scalar a uniform.
//
// The target starts out holding what the array holds, so an iteration that writes nothing (a
// `continue`, which the program spells `discard`) leaves its element as it was.
//
// The context is the runtime's own, made on the first call that needs it (`gl-context.ts`), so no
// host state is borrowed or restored. Like the rest of `typeshade/runtime` it imports no compiler.

import { packed, type EntryBinding, type Layout } from './host-entry.js';
import { glContext } from './gl-context.js';

export { glContext };

/** One loop's program and what it reads, as the generated module writes it. */
export interface KernelGlLoop {
  /** The fragment program; the vertex stage is the runtime's fullscreen triangle. */
  readonly glsl: string;
  /** The array the loop writes at `i`, and its element's scalar. */
  readonly out: string;
  readonly outScalar: 'f32' | 'i32' | 'u32';
  /** Each array the loop reads, with its layout. */
  readonly reads: readonly { readonly name: string; readonly layout: Layout & { k: 'a' } }[];
  /** Each loose uniform: its name, its scalar and its component count. */
  readonly uniforms: readonly {
    readonly name: string;
    readonly scalar: 'f32' | 'i32' | 'u32';
    readonly n: number;
  }[];
}

/** The widest texture WebGL2 guarantees: a data texture or the target wraps into rows here. */
const MAX_W = 2048;

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const programs = new WeakMap<KernelGlLoop, WebGLProgram>();

/** The loop's program, compiled and linked once per context. */
export function programOf(gl: WebGL2RenderingContext, loop: KernelGlLoop): WebGLProgram {
  const cached = programs.get(loop);
  if (cached !== undefined) return cached;
  const shader = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(`WebGL2 refused the program: ${gl.getShaderInfoLog(s) ?? ''}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, FULLSCREEN_VS));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, loop.glsl));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`WebGL2 refused the program: ${gl.getProgramInfoLog(p) ?? ''}`);
  programs.set(loop, p);
  return p;
}

/** A 2D-tiled data texture of `lanes`, texel `i` at `(i % W, i / W)`, as `_sfetch` reads it. */
function dataTexture(
  gl: WebGL2RenderingContext,
  lanes: Float32Array | Int32Array | Uint32Array,
): WebGLTexture {
  const w = Math.min(Math.max(1, lanes.length), MAX_W);
  const h = Math.max(1, Math.ceil(lanes.length / w));
  const [internal, format, type, Ctor] =
    lanes instanceof Float32Array
      ? [gl.R32F, gl.RED, gl.FLOAT, Float32Array]
      : lanes instanceof Int32Array
        ? [gl.R32I, gl.RED_INTEGER, gl.INT, Int32Array]
        : [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, Uint32Array];
  const data = new Ctor(w * h);
  data.set(lanes as never);
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** An array argument's lanes as its data texture holds them: a typed array of one scalar as it
 *  is, anything else packed in its storage layout and read as lanes of its texture's type, `u32`
 *  or `i32` for an integer vector (#484), `u32` for a struct with an integer field (change 0046)
 *  and `f32` for the rest. */
function lanesOf(
  name: string,
  layout: Layout & { k: 'a' },
  value: unknown,
): Float32Array | Int32Array | Uint32Array {
  if (value instanceof Float32Array || value instanceof Int32Array || value instanceof Uint32Array)
    if (layout.e.k === 's') return value;
  const b: EntryBinding = {
    name,
    group: 0,
    binding: 0,
    space: 'storage',
    writes: false,
    layout,
    s: name,
  };
  const bytes = packed(b, value);
  // A struct with a u32 or i32 field is an R32UI texture (change 0046), its float lanes read
  // back through uintBitsToFloat, so its bytes go up as they are.
  if (
    layout.e.k === 'o' &&
    layout.e.f.some(([, , l]) => l.k === 's' && (l.t === 'u32' || l.t === 'i32'))
  )
    return new Uint32Array(bytes);
  if (layout.e.k === 'v' && layout.e.t === 'u32') return new Uint32Array(bytes);
  if (layout.e.k === 'v' && layout.e.t === 'i32') return new Int32Array(bytes);
  return new Float32Array(bytes);
}

/** Run one loop over `n` iterations from `start` on WebGL2, writing its array in place. */
export function onWebgl2(
  gl: WebGL2RenderingContext,
  loop: KernelGlLoop,
  arrays: ReadonlyMap<string, unknown>,
  uniforms: ReadonlyMap<string, unknown>,
  start: number,
  step: number,
  n: number,
): void {
  if (n === 0) return;
  const program = programOf(gl, loop);
  gl.useProgram(program);
  const textures: WebGLTexture[] = [];
  loop.reads.forEach((r, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    textures.push(dataTexture(gl, lanesOf(r.name, r.layout, arrays.get(r.name))));
    const at = gl.getUniformLocation(program, r.name);
    if (at !== null) gl.uniform1i(at, unit);
  });
  for (const u of loop.uniforms) {
    const at = gl.getUniformLocation(program, u.name);
    if (at === null) continue;
    const v = u.name === '_start' ? start : uniforms.get(u.name);
    const xs = (u.n === 1 ? [v] : (v as readonly number[])) as number[];
    if (u.scalar === 'f32') gl[`uniform${u.n}fv` as 'uniform1fv'](at, xs);
    else if (u.scalar === 'i32') gl[`uniform${u.n}iv` as 'uniform1iv'](at, xs);
    else gl[`uniform${u.n}uiv` as 'uniform1uiv'](at, xs);
  }
  // The target: one texel per iteration, holding what the array holds there.
  const w = Math.min(n, MAX_W);
  const h = Math.ceil(n / w);
  const out = arrays.get(loop.out) as Float32Array | Int32Array | Uint32Array;
  const bits = new Uint32Array(out.buffer, out.byteOffset, out.length);
  const grid = new Uint32Array(w * h);
  for (let k = 0; k < n; k++) grid[k] = bits[start + k * step]!;
  gl.activeTexture(gl.TEXTURE0 + loop.reads.length);
  const target = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, grid);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error(`the R32UI target is incomplete (0x${status.toString(16)})`);
    const dispatch = gl.getUniformLocation(program, '_dispatch');
    if (dispatch !== null) gl.uniform4uiv(dispatch, [n, w, 0, 0]);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RED_INTEGER, gl.UNSIGNED_INT, grid);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL2 error 0x${error.toString(16)}`);
    for (let k = 0; k < n; k++) bits[start + k * step] = grid[k]!;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(target);
    for (const t of textures) gl.deleteTexture(t);
  }
}
