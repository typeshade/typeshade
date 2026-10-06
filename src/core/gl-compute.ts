// ═══ A compute dispatch on WebGL2 (change 0054, step 2) ═══
//
// WebGL2 has no compute stage. `passes/gl-compute.ts` builds a split entry's pass program; this
// file runs it, a pass at a time, in the order `phase-schedule.ts` gives:
//
//   - Memory is textures. Each memory root is an `R32UI` texture of 32-bit words, as std430 lays
//     the binding out; a workgroup root holds one copy per workgroup, side by side.
//   - A pass draws the pass program once for each sixteen words of its output, into four
//     `RGBA32UI` targets. Each fragment is one invocation: it restores its state from the state
//     texture, runs if the executor marked it active, and writes its state, its write log and
//     its atomic request.
//   - The scatter draws one point for each log entry, in invocation index order, into the next
//     texture of the root's ping-pong pair, which a blit has made a copy of the current one; the
//     pair is then swapped. Points drawn later win, so the last invocation to write a word wins.
//   - The state comes back to the host after each pass. The host decides who runs next (the
//     barrier hold), and performs each atomic request in invocation index order on the memory
//     it reads back, then writes the memory and the results again: the resolve pass. The log's
//     values are not read back: the scatter reads them where they are.
//   - The pass program and the scatter are linked once per context and kept, so a later
//     dispatch of the same entry links nothing. `scripts/gl-compute-bench.ts` measures the cost.
//
// The CPU model of this executor is `testing/gl-model.ts`; `scripts/gpu-differential.ts` holds
// the two to the same words. It imports no compiler.

import type { GlComputeProgram } from './passes/gl-compute.js';
import { atomicStep, type CpuValue } from './cpu-runtime.js';
import { runPasses, type PassInvocation } from './phase-schedule.js';
import { byteSize, pack } from './host-entry.js';

const W = 2048;

/** What a dispatch takes besides the program. */
export interface GlComputeInput {
  readonly workgroups: readonly [number, number, number];
  /** Each storage root's words, by binding name. The dispatch writes them back in place. */
  readonly memory: Readonly<Record<string, Uint32Array>>;
  /** Each uniform binding's host value, by name, packed by its std140 layout. */
  readonly uniforms?: Readonly<Record<string, unknown>>;
}

/** What a dispatch did. */
export interface GlComputeReport {
  readonly passes: number;
  readonly barrierPhases: number;
}

interface Inv extends PassInvocation {
  readonly index: number;
}

/** Each context's linked programs, by their two sources: a dispatch links its pass program and
 *  its scatter once per context, and every later dispatch of the same entry reuses them. */
const linked = new WeakMap<WebGL2RenderingContext, Map<string, WebGLProgram>>();

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, what: string): WebGLProgram {
  let cache = linked.get(gl);
  if (cache === undefined) linked.set(gl, (cache = new Map()));
  const key = `${vs}\0${fs}`;
  const hit = cache.get(key);
  // A context that was lost and restored keeps its object but not its programs.
  if (hit !== undefined && gl.isProgram(hit)) return hit;
  const shader = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) {
      throw new Error(`typeshade/webgl2: ${what} did not compile: ${gl.getShaderInfoLog(s) ?? ''}`);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) {
    throw new Error(`typeshade/webgl2: ${what} did not link: ${gl.getProgramInfoLog(p) ?? ''}`);
  }
  cache.set(key, p);
  return p;
}

/** An `R32UI` texture of `words`, `W` wide. */
function wordTexture(
  gl: WebGL2RenderingContext,
  words: Uint32Array,
): { tex: WebGLTexture; h: number } {
  const h = Math.max(1, Math.ceil(words.length / W));
  const data = new Uint32Array(W * h);
  data.set(words);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, W, h, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return { tex, h };
}

/** The scatter program of `p`: one point for each log slot of each invocation. */
function scatterSources(p: GlComputeProgram): { vs: string; fs: string; textures: number[] } {
  const first = Math.floor(p.logAt / 16);
  const last = Math.floor((p.logAt + 32) / 16);
  const textures: number[] = [];
  for (let s = first; s <= last; s++) for (let a = 0; a < 4; a++) textures.push(s * 4 + a);
  const decls = textures.map((t) => `uniform usampler2D o${String(t)};`).join('\n');
  const pick = textures
    .map((t) => `  if (k == ${String(t)}u) x = texelFetch(o${String(t)}, at, 0);`)
    .join('\n');
  const vs = `#version 300 es
precision highp int;
precision highp float;
precision highp usampler2D;
${decls}
uniform uint u_root;
uniform uint u_n;
uniform uint u_ow;
uniform uint u_mh;
flat out uint v;
uint word(uint i, uint w) {
  uint k = (w / 16u) * 4u + (w % 16u) / 4u;
  ivec2 at = ivec2(int(i % u_ow), int(i / u_ow));
  uvec4 x = uvec4(0u);
${pick}
  return x[w % 4u];
}
void main() {
  uint i = uint(gl_VertexID) / 16u;
  uint slot = uint(gl_VertexID) % 16u;
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  v = 0u;
  if (i >= u_n) return;
  if (slot >= word(i, ${String(p.logAt)}u)) return;
  uint key = word(i, ${String(p.logAt + 1)}u + slot);
  if ((key >> 28u) != u_root) return;
  uint w = key & 0x0fffffffu;
  v = word(i, ${String(p.logAt + 17)}u + slot);
  gl_Position = vec4((float(w % ${String(W)}u) + 0.5) / ${String(W)}.0 * 2.0 - 1.0,
                     (float(w / ${String(W)}u) + 0.5) / float(u_mh) * 2.0 - 1.0, 0.0, 1.0);
}
`;
  const fs = `#version 300 es
precision highp int;
precision highp float;
flat in uint v;
out uvec4 o;
void main() { o = uvec4(v, 0u, 0u, 0u); }
`;
  return { vs, fs, textures };
}

/** Run `p` over `input.workgroups` on `gl`. */
export function runGlCompute(
  gl: WebGL2RenderingContext,
  p: GlComputeProgram,
  input: GlComputeInput,
): GlComputeReport {
  const [nx, ny, nz] = input.workgroups;
  const [sx, sy, sz] = p.workgroupSize;
  const perGroup = sx * sy * sz;
  const groups = nx * ny * nz;
  const n = perGroup * groups;
  const ow = Math.min(n, W);
  const oh = Math.ceil(n / W);
  const slices = Math.ceil(p.outputWords / 16);

  // Memory: a ping-pong pair of word textures per root.
  const words = p.roots.map((r) => {
    if (r.space === 'workgroup') return new Uint32Array(r.fixed * groups);
    const m = input.memory[r.name];
    if (m === undefined) throw new Error(`typeshade/webgl2: no memory for '${r.name}'`);
    return m;
  });
  const pairs = words.map((w) => [wordTexture(gl, w), wordTexture(gl, w)]);
  const current = pairs.map(() => 0);

  // State, on the host between passes.
  const state = new Uint32Array(n * p.stateWords);
  for (let i = 0; i < n; i++) {
    for (const [at, init] of p.init) state.set(init, i * p.stateWords + at);
    p.roots.forEach((r, k) => {
      const at = p.lengthWords[r.name];
      if (at !== undefined) state[i * p.stateWords + at] = (words[k]!.length - r.fixed) / r.stride;
    });
  }
  const stateTex = wordTexture(gl, state);

  // Outputs: four `RGBA32UI` targets for each slice.
  const outputs = Array.from({ length: slices * 4 }, () => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, ow, oh);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  });
  const fbo = gl.createFramebuffer()!;
  const readFbo = gl.createFramebuffer()!;
  const vao = gl.createVertexArray();

  const pass = compile(gl, p.vertex, p.fragment, `${p.entry}'s pass program`);
  const scatter = scatterSources(p);
  const scatterProgram = compile(gl, scatter.vs, scatter.fs, `${p.entry}'s scatter`);
  const ctl = gl.createBuffer()!;
  const uniformBuffers = p.uniforms.map((u, k) => {
    const v = input.uniforms?.[u.name];
    if (v === undefined) throw new Error(`typeshade/webgl2: no value for uniform '${u.name}'`);
    const bytes = new ArrayBuffer(Math.max(16, Math.ceil(byteSize(u.layout, v, u.name) / 16) * 16));
    pack(new DataView(bytes), 0, u.layout, v, u.name);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.STATIC_DRAW);
    gl.uniformBlockBinding(pass, gl.getUniformBlockIndex(pass, u.block), 2 + k);
    return buffer;
  });

  const out = new Uint32Array(n * p.outputWords);
  // The host reads the state, the log's count and keys, and the request. The log's values stay
  // on the GPU, where the scatter reads them, so a target that holds only values is not read.
  const entries = (p.requestAt - p.logAt - 1) / 2;
  const valuesAt = p.logAt + 1 + entries;
  const read = outputs
    .map((_, t) => t)
    .filter((t) => !(t * 4 >= valuesAt && t * 4 + 4 <= valuesAt + entries));
  const readOutputs = (): void => {
    const px = new Uint32Array(ow * oh * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
    for (const t of read) {
      gl.framebufferTexture2D(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        outputs[t]!,
        0,
      );
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, ow, oh, gl.RGBA_INTEGER, gl.UNSIGNED_INT, px);
      const base = t * 4;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 4; c++) {
          const w = base + c;
          if (w < p.outputWords) out[i * p.outputWords + w] = px[i * 4 + c]!;
        }
      }
    }
  };
  const readMemory = (r: number): Uint32Array => {
    const { tex, h } = pairs[r]![current[r]!]!;
    const px = new Uint32Array(W * h * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, px);
    const m = new Uint32Array(words[r]!.length);
    for (let i = 0; i < m.length; i++) m[i] = px[i * 4]!;
    return m;
  };
  const writeMemory = (r: number, m: Uint32Array): void => {
    const { tex, h } = pairs[r]![current[r]!]!;
    const data = new Uint32Array(W * h);
    data.set(m);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, h, gl.RED_INTEGER, gl.UNSIGNED_INT, data);
  };

  // The resolve pass reads a root back once, performs every request of the pass on it, and
  // writes it once, before the next pass reads it.
  const resolving = new Map<number, Uint32Array>();
  const flush = (): void => {
    for (const [r, m] of resolving) writeMemory(r, m);
    resolving.clear();
  };

  const invocations: Inv[] = Array.from({ length: n }, (_, index) => {
    const wl = Math.floor(index / perGroup);
    return {
      index,
      wid: [wl % nx, Math.floor(wl / nx) % ny, Math.floor(wl / (nx * ny))],
      waiting: false,
    };
  });
  const pcOf = (inv: Inv): number => state[inv.index * p.stateWords + p.pcWord]!;

  gl.bindVertexArray(vao);
  const report = runPasses<Inv>({
    invocations,
    perGroup,
    done: p.done,
    pcOf,
    cutAt: (pc) => p.cuts[pc],
    barrierAt: (pc) => p.barriers[pc] ?? { fn: 'barrier', line: 'a line without a span' },
    pass(runnable) {
      flush();
      // Who runs this pass.
      for (let i = 0; i < n; i++) state[i * p.stateWords + p.activeWord] = 0;
      for (const inv of runnable) state[inv.index * p.stateWords + p.activeWord] = 1;
      const sdata = new Uint32Array(W * stateTex.h);
      sdata.set(state);
      gl.bindTexture(gl.TEXTURE_2D, stateTex.tex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        W,
        stateTex.h,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        sdata,
      );

      // The pass program, once for each slice of its output.
      gl.useProgram(pass);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, ow, oh);
      const block = gl.getUniformBlockIndex(pass, '_PhCtl');
      gl.uniformBlockBinding(pass, block, 1);
      let unit = 0;
      p.roots.forEach((_, r) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, pairs[r]![current[r]!]!.tex);
        gl.uniform1i(gl.getUniformLocation(pass, `_phx_mem${String(r)}`), unit++);
      });
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, stateTex.tex);
      gl.uniform1i(gl.getUniformLocation(pass, '_phx_state'), unit++);
      uniformBuffers.forEach((b, k) => gl.bindBufferBase(gl.UNIFORM_BUFFER, 2 + k, b));
      for (let g = 0; g < slices; g++) {
        for (let a = 0; a < 4; a++) {
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + a,
            gl.TEXTURE_2D,
            outputs[g * 4 + a]!,
            0,
          );
        }
        gl.drawBuffers([
          gl.COLOR_ATTACHMENT0,
          gl.COLOR_ATTACHMENT1,
          gl.COLOR_ATTACHMENT2,
          gl.COLOR_ATTACHMENT3,
        ]);
        gl.bindBuffer(gl.UNIFORM_BUFFER, ctl);
        gl.bufferData(
          gl.UNIFORM_BUFFER,
          new Uint32Array([nx, ny, nz, 0, g, n, 0, 0]),
          gl.DYNAMIC_DRAW,
        );
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, ctl);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      for (let a = 1; a < 4; a++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + a, gl.TEXTURE_2D, null, 0);
      }
      readOutputs();
      for (const inv of runnable) {
        const o = inv.index * p.outputWords;
        state.set(out.subarray(o, o + p.stateWords), inv.index * p.stateWords);
      }

      // The scatter, root by root, into a copy of the current texture.
      gl.useProgram(scatterProgram);
      scatter.textures.forEach((t, k) => {
        gl.activeTexture(gl.TEXTURE0 + k);
        gl.bindTexture(gl.TEXTURE_2D, outputs[t]!);
        gl.uniform1i(gl.getUniformLocation(scatterProgram, `o${String(t)}`), k);
      });
      gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_n'), n);
      gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_ow'), ow);
      p.roots.forEach((_, r) => {
        const written = runnable.some((inv) => {
          const o = inv.index * p.outputWords;
          for (let s = 0; s < out[o + p.logAt]!; s++)
            if (out[o + p.logAt + 1 + s]! >>> 28 === r) return true;
          return false;
        });
        if (!written) return;
        const from = pairs[r]![current[r]!]!;
        const to = pairs[r]![1 - current[r]!]!;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
        gl.framebufferTexture2D(
          gl.READ_FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          from.tex,
          0,
        );
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(
          gl.DRAW_FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          to.tex,
          0,
        );
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.blitFramebuffer(0, 0, W, from.h, 0, 0, W, to.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, W, to.h);
        gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_root'), r);
        gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_mh'), to.h);
        gl.drawArrays(gl.POINTS, 0, n * 16);
        current[r] = 1 - current[r]!;
      });
    },
    resolve(inv, pc) {
      const rq = p.requests[pc]!;
      const o = inv.index * p.outputWords + p.requestAt;
      let m = resolving.get(rq.root);
      if (m === undefined) resolving.set(rq.root, (m = readMemory(rq.root)));
      const word = out[o]!;
      const signed = (b: number): number => (rq.elem === 'i32' ? b | 0 : b >>> 0);
      const old = signed(m[word]!);
      const step = atomicStep(rq.fn, old, signed(out[o + 1]!), rq.elem, signed(out[o + 2]!));
      if (rq.fn !== 'atomicLoad') m[word] = step.next >>> 0;
      if (rq.result === undefined) return;
      const at = inv.index * p.stateWords + rq.result;
      if (rq.pair) {
        const r = step.result as unknown as { old_value: number; exchanged: boolean };
        state[at] = r.old_value >>> 0;
        state[at + 1] = r.exchanged ? 1 : 0;
      } else state[at] = (step.result as CpuValue as number) >>> 0;
    },
  });

  flush();
  // Hand the storage roots back.
  p.roots.forEach((r, k) => {
    if (r.space === 'storage') words[k]!.set(readMemory(k));
  });
  for (const pair of pairs) for (const { tex } of pair) gl.deleteTexture(tex);
  for (const t of outputs) gl.deleteTexture(t);
  gl.deleteTexture(stateTex.tex);
  gl.deleteFramebuffer(fbo);
  gl.deleteFramebuffer(readFbo);
  gl.deleteBuffer(ctl);
  for (const b of uniformBuffers) gl.deleteBuffer(b);
  return report;
}
