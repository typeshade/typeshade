// ═══ A compute dispatch on WebGL2 (change 0054, step 2) ═══
//
// WebGL2 has no compute stage. `passes/gl-compute.ts` builds a split entry's pass program; this
// file runs it, a pass at a time, in the order `phase-schedule.ts` gives:
//
//   - Memory is textures. Each memory root is an `R32UI` 2D array texture of 32-bit words, as
//     std430 lays the binding out; a workgroup root holds one copy per workgroup, side by side.
//     A layer holds `width × layerRows` words (the program's `layout`), so a root of any size is
//     as many layers as it needs, and so are the state and the outputs: no size goes to another
//     tier.
//   - A pass draws the pass program once for each sixteen words of its output and each layer of
//     invocations, into four `RGBA32UI` targets. Each fragment is one invocation: it restores its state from the state
//     texture, runs if the executor marked it active, and writes its state, its write log and
//     its atomic request.
//   - The scatter draws one point for each log entry, in invocation index order, straight into
//     each layer the pass wrote. It reads only the outputs, never the memory, so it needs no
//     second copy of a root and copies nothing. Points drawn later win, so the last invocation
//     to write a word wins.
//   - The state comes back to the host after each pass. The host decides who runs next (the
//     barrier hold), and performs each atomic request in invocation index order on the memory
//     it reads back, then writes the memory and the results again: the resolve pass. The log's
//     values are not read back: the scatter reads them where they are.
//   - The pass program and the scatter are linked once per context and kept, so a later
//     dispatch of the same entry links nothing. `scripts/gl-compute-bench.ts` measures the cost.
//
// The CPU model of this executor is `testing/gl-model.ts`; `scripts/gpu-differential.ts` holds
// the two to the same words. It imports no compiler.

import type { GlComputeLayout, GlComputeProgram } from './passes/gl-compute.js';
import { atomicStep, type CpuValue } from './cpu-runtime.js';
import { runPasses, type PassInvocation } from './phase-schedule.js';
import { byteSize, pack } from './host-entry.js';

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

/** The most words one root can hold: a log key keeps the root in its top four bits. */
const MAX_ROOT_WORDS = 1 << 28;

/** How `count` words lie in layers of `layout`: the texture's rows and its layers. */
function shape(
  count: number,
  { width, layerRows }: GlComputeLayout,
): { h: number; layers: number } {
  const rows = Math.max(1, Math.ceil(count / width));
  const layers = Math.ceil(rows / layerRows);
  return { h: layers > 1 ? layerRows : rows, layers };
}

/** A layered texture: its rows and its layers. */
interface Layered {
  readonly tex: WebGLTexture;
  readonly h: number;
  readonly layers: number;
}

/** An `R32UI` 2D array texture of `words`, laid out as `layout` says. */
function wordTexture(
  gl: WebGL2RenderingContext,
  words: Uint32Array,
  layout: GlComputeLayout,
  what: string,
): Layered {
  const { h, layers } = shape(words.length, layout);
  const most = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  if (layers > most)
    throw new Error(
      `typeshade/webgl2: ${what} needs ${String(layers)} layers, more than this context's ${String(most)}`,
    );
  const data = new Uint32Array(layout.width * h * layers);
  data.set(words);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.R32UI,
    layout.width,
    h,
    layers,
    0,
    gl.RED_INTEGER,
    gl.UNSIGNED_INT,
    data,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return { tex, h, layers };
}

/** The scatter program of `p`: one point for each of the first `u_slots` log slots of each
 *  invocation, placed in the layer `u_layer` of its root or nowhere. */
function scatterSources(p: GlComputeProgram): { vs: string; fs: string; textures: number[] } {
  const { width: W, layerRows: LH } = p.layout;
  const first = Math.floor(p.logAt / 16);
  const last = Math.floor((p.logAt + 32) / 16);
  const textures: number[] = [];
  for (let s = first; s <= last; s++) for (let a = 0; a < 4; a++) textures.push(s * 4 + a);
  const decls = textures.map((t) => `uniform usampler2DArray o${String(t)};`).join('\n');
  const pick = textures
    .map((t) => `  if (k == ${String(t)}u) x = texelFetch(o${String(t)}, at, 0);`)
    .join('\n');
  const vs = `#version 300 es
precision highp int;
precision highp float;
precision highp usampler2DArray;
${decls}
uniform uint u_root;
uniform uint u_layer;
uniform uint u_n;
uniform uint u_ow;
uniform uint u_mh;
uniform uint u_slots;
flat out uint v;
uint word(uint i, uint w) {
  uint k = (w / 16u) * 4u + (w % 16u) / 4u;
  uint row = i / u_ow;
  ivec3 at = ivec3(int(i % u_ow), int(row % ${String(LH)}u), int(row / ${String(LH)}u));
  uvec4 x = uvec4(0u);
${pick}
  return x[w % 4u];
}
void main() {
  uint i = uint(gl_VertexID) / u_slots;
  uint slot = uint(gl_VertexID) % u_slots;
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  v = 0u;
  if (i >= u_n) return;
  if (slot >= word(i, ${String(p.logAt)}u)) return;
  uint key = word(i, ${String(p.logAt + 1)}u + slot);
  if ((key >> 28u) != u_root) return;
  uint w = key & 0x0fffffffu;
  uint row = w / ${String(W)}u;
  if (row / ${String(LH)}u != u_layer) return;
  v = word(i, ${String(p.logAt + 17)}u + slot);
  gl_Position = vec4((float(w % ${String(W)}u) + 0.5) / ${String(W)}.0 * 2.0 - 1.0,
                     (float(row % ${String(LH)}u) + 0.5) / float(u_mh) * 2.0 - 1.0, 0.0, 1.0);
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
  const { width: W, layerRows: LH } = p.layout;
  const [nx, ny, nz] = input.workgroups;
  const [sx, sy, sz] = p.workgroupSize;
  const perGroup = sx * sy * sz;
  const groups = nx * ny * nz;
  const n = perGroup * groups;
  const slices = Math.ceil(p.outputWords / 16);
  // The outputs: one texel for each invocation, `ow` wide, in layers of `LH` rows.
  const ow = Math.min(n, W);
  const out1 = shape(n, { width: ow, layerRows: LH });
  const perLayer = ow * LH;
  const rowsIn = (b: number): number => Math.min(LH, Math.ceil((n - b * perLayer) / ow));

  // Memory: one layered word texture per root.
  const words = p.roots.map((r) => {
    if (r.space === 'workgroup') return new Uint32Array(r.fixed * groups);
    const m = input.memory[r.name];
    if (m === undefined) throw new Error(`typeshade/webgl2: no memory for '${r.name}'`);
    return m;
  });
  p.roots.forEach((r, k) => {
    if (words[k]!.length > MAX_ROOT_WORDS)
      throw new Error(
        `typeshade/webgl2: '${r.name}' holds ${String(words[k]!.length)} words, more than the ${String(MAX_ROOT_WORDS)} a write log key can name`,
      );
  });
  const memory = words.map((w, k) => wordTexture(gl, w, p.layout, `'${p.roots[k]!.name}'`));

  // State, on the host between passes.
  const state = new Uint32Array(n * p.stateWords);
  for (let i = 0; i < n; i++) {
    for (const [at, init] of p.init) state.set(init, i * p.stateWords + at);
    p.roots.forEach((r, k) => {
      const at = p.lengthWords[r.name];
      if (at !== undefined) state[i * p.stateWords + at] = (words[k]!.length - r.fixed) / r.stride;
    });
  }
  const stateTex = wordTexture(gl, state, p.layout, 'the state');
  const stateData = new Uint32Array(W * stateTex.h * stateTex.layers);

  // Outputs: four `RGBA32UI` targets for each slice, a layer for each `perLayer` invocations.
  const outputs = Array.from({ length: slices * 4 }, () => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32UI, ow, out1.h, out1.layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

  // What the host reads of the outputs, each into its own array: the state of each invocation
  // that ran, its log's count, the keys of the log slots some invocation filled, and the
  // request where some invocation stopped at an atomic operation. The log's values stay on the
  // GPU, where the scatter reads them.
  const active = new Uint8Array(n);
  const counts = new Uint32Array(n);
  let slots = 0;
  let keys = new Uint32Array(0);
  const requests = Object.keys(p.requests).length > 0 ? new Uint32Array(n * 3) : undefined;
  const px = new Uint32Array(ow * out1.h * 4);
  /** Read output words `[lo, hi)` of every invocation and hand each to `put`. */
  const readWords = (lo: number, hi: number, put: (i: number, w: number, v: number) => void) => {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
    for (let t = Math.floor(lo / 4); t * 4 < hi; t++) {
      const c0 = Math.max(0, lo - t * 4);
      const c1 = Math.min(4, hi - t * 4);
      for (let b = 0; b < out1.layers; b++) {
        gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, outputs[t]!, 0, b);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, ow, rowsIn(b), gl.RGBA_INTEGER, gl.UNSIGNED_INT, px);
        const from = b * perLayer;
        const to = Math.min(n, from + perLayer);
        for (let i = from; i < to; i++) {
          const at = (i - from) * 4;
          for (let c = c0; c < c1; c++) put(i, t * 4 + c, px[at + c]!);
        }
      }
    }
  };
  const readOutputs = (): void => {
    readWords(0, p.logAt + 1, (i, w, v) => {
      if (active[i] === 0) return;
      if (w < p.stateWords) state[i * p.stateWords + w] = v;
      else if (w === p.logAt) counts[i] = v;
    });
    slots = 0;
    for (let i = 0; i < n; i++) if (active[i] !== 0 && counts[i]! > slots) slots = counts[i]!;
    if (slots > 0) {
      if (keys.length < n * slots) keys = new Uint32Array(n * slots);
      readWords(p.logAt + 1, p.logAt + 1 + slots, (i, w, v) => {
        keys[i * slots + w - p.logAt - 1] = v;
      });
    }
    let atAtomic = false;
    if (requests !== undefined)
      for (let i = 0; i < n && !atAtomic; i++)
        atAtomic = active[i] !== 0 && p.requests[state[i * p.stateWords + p.pcWord]!] !== undefined;
    if (atAtomic)
      readWords(p.requestAt, p.requestAt + 3, (i, w, v) => {
        requests![i * 3 + w - p.requestAt] = v;
      });
  };
  // The roots a scatter or a resolve has written: only those are read back at the end.
  const dirty = new Set<number>();
  const readMemory = (r: number): Uint32Array => {
    const { tex, h, layers } = memory[r]!;
    const layerPx = new Uint32Array(W * h * 4);
    const m = new Uint32Array(words[r]!.length);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
    for (let l = 0; l < layers; l++) {
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, l);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, W, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, layerPx);
      const from = l * W * h;
      const to = Math.min(m.length, from + W * h);
      for (let i = from; i < to; i++) m[i] = layerPx[(i - from) * 4]!;
    }
    return m;
  };
  const writeMemory = (r: number, m: Uint32Array): void => {
    const { tex, h, layers } = memory[r]!;
    const data = new Uint32Array(W * h * layers);
    data.set(m);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      0,
      W,
      h,
      layers,
      gl.RED_INTEGER,
      gl.UNSIGNED_INT,
      data,
    );
  };

  // The resolve pass reads a root back once, performs every request of the pass on it, and
  // writes it once, before the next pass reads it.
  const resolving = new Map<number, Uint32Array>();
  const flush = (): void => {
    for (const [r, m] of resolving) {
      writeMemory(r, m);
      dirty.add(r);
    }
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
  const drawBuffers = [
    gl.COLOR_ATTACHMENT0,
    gl.COLOR_ATTACHMENT1,
    gl.COLOR_ATTACHMENT2,
    gl.COLOR_ATTACHMENT3,
  ];

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
      active.fill(0);
      counts.fill(0);
      for (let i = 0; i < n; i++) state[i * p.stateWords + p.activeWord] = 0;
      for (const inv of runnable) {
        state[inv.index * p.stateWords + p.activeWord] = 1;
        active[inv.index] = 1;
      }
      stateData.set(state);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, stateTex.tex);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        0,
        W,
        stateTex.h,
        stateTex.layers,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        stateData,
      );

      // The pass program, once for each layer of invocations and each slice of its output.
      gl.useProgram(pass);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const block = gl.getUniformBlockIndex(pass, '_PhCtl');
      gl.uniformBlockBinding(pass, block, 1);
      let unit = 0;
      memory.forEach((m, r) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, m.tex);
        gl.uniform1i(gl.getUniformLocation(pass, `_phx_mem${String(r)}`), unit++);
      });
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, stateTex.tex);
      gl.uniform1i(gl.getUniformLocation(pass, '_phx_state'), unit++);
      uniformBuffers.forEach((b, k) => gl.bindBufferBase(gl.UNIFORM_BUFFER, 2 + k, b));
      for (let b = 0; b < out1.layers; b++) {
        gl.viewport(0, 0, ow, rowsIn(b));
        for (let g = 0; g < slices; g++) {
          for (let a = 0; a < 4; a++) {
            gl.framebufferTextureLayer(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0 + a,
              outputs[g * 4 + a]!,
              0,
              b,
            );
          }
          gl.drawBuffers(drawBuffers);
          gl.bindBuffer(gl.UNIFORM_BUFFER, ctl);
          gl.bufferData(
            gl.UNIFORM_BUFFER,
            new Uint32Array([nx, ny, nz, 0, g, n, b, 0]),
            gl.DYNAMIC_DRAW,
          );
          gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, ctl);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
      for (let a = 1; a < 4; a++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + a, null, 0, 0);
      }
      readOutputs();

      // The layers each root was written in this pass, each with the first and the last
      // invocation that wrote in it: the scatter draws that range and no more.
      const written = p.roots.map(() => new Map<number, [number, number]>());
      for (const inv of runnable) {
        const i = inv.index;
        for (let s = 0; s < counts[i]!; s++) {
          const key = keys[i * slots + s]!;
          const layers = written[key >>> 28];
          if (layers === undefined) continue;
          const l = Math.floor((key & 0x0fffffff) / (W * LH));
          const range = layers.get(l);
          if (range === undefined) layers.set(l, [i, i]);
          else {
            range[0] = Math.min(range[0], i);
            range[1] = Math.max(range[1], i);
          }
        }
      }

      // The scatter, root by root and layer by layer, straight into the memory texture.
      gl.useProgram(scatterProgram);
      scatter.textures.forEach((t, k) => {
        gl.activeTexture(gl.TEXTURE0 + k);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, outputs[t]!);
        gl.uniform1i(gl.getUniformLocation(scatterProgram, `o${String(t)}`), k);
      });
      gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_n'), n);
      gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_ow'), ow);
      gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_slots'), slots);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      memory.forEach((m, r) => {
        if (written[r]!.size === 0) return;
        gl.viewport(0, 0, W, m.h);
        gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_root'), r);
        gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_mh'), m.h);
        dirty.add(r);
        for (const [l, [lo, hi]] of written[r]!) {
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, m.tex, 0, l);
          gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_layer'), l);
          gl.drawArrays(gl.POINTS, lo * slots, (hi - lo + 1) * slots);
        }
      });
    },
    resolve(inv, pc) {
      const rq = p.requests[pc]!;
      const o = inv.index * 3;
      let m = resolving.get(rq.root);
      if (m === undefined) resolving.set(rq.root, (m = readMemory(rq.root)));
      const word = requests![o]!;
      const signed = (b: number): number => (rq.elem === 'i32' ? b | 0 : b >>> 0);
      const old = signed(m[word]!);
      const step = atomicStep(
        rq.fn,
        old,
        signed(requests![o + 1]!),
        rq.elem,
        signed(requests![o + 2]!),
      );
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
    if (r.space === 'storage' && dirty.has(k)) words[k]!.set(readMemory(k));
  });
  for (const { tex } of memory) gl.deleteTexture(tex);
  for (const t of outputs) gl.deleteTexture(t);
  gl.deleteTexture(stateTex.tex);
  gl.deleteFramebuffer(fbo);
  gl.deleteFramebuffer(readFbo);
  gl.deleteBuffer(ctl);
  for (const b of uniformBuffers) gl.deleteBuffer(b);
  return report;
}
