// ═══ A compute dispatch on WebGL2 (change 0054) ═══
//
// WebGL2 has no compute stage. `passes/gl-compute.ts` builds a split entry's pass program; this
// file runs it, a pass at a time, in the order `phase-schedule.ts` gives (change 0054, "The
// execution model", as amended three times):
//
//   - Memory is textures. Each memory root is an `R32UI` 2D array texture of 32-bit words, as
//     std430 lays the binding out; a workgroup root holds one copy per workgroup, side by side.
//     A layer holds `width × layerRows` words (the program's `layout`), so a root of any size is
//     as many layers as it needs: no size goes to another tier.
//   - A pass runs each invocation once, as a point with the rasterizer off. Transform feedback
//     captures its record (state, write log, request), a batch of layers at a time, and the
//     records go into the chunk's record texture through a pixel unpack buffer: one invocation a
//     row, so the state stays on the GPU between passes. A dispatch larger than one record
//     texture is more chunks.
//   - The scatter draws one point for each log entry, in invocation index order, straight into
//     each layer the pass wrote. It reads the log from the records, never the memory, so it
//     needs no second copy of a root and copies nothing. Points drawn later win, so the last
//     invocation to write a word wins.
//   - The host reads the first texels of each record: the resume point, the log's count and
//     keys, the request. It decides who runs next (the barrier hold), performs each atomic
//     request in invocation index order on the memory it reads back, writes the memory again
//     (the resolve pass), and writes each invocation's control texel: whether it runs, and what
//     its atomic operation returned. A pass where every invocation runs and none waits on a
//     result uploads no control texel, and the first pass uploads no record.
//   - A read-back does not hold the page: each lands in a pixel pack buffer behind one fence,
//     and the host yields until the GPU has passed it (`readBack`), so `runGlCompute` is async.
//   - The pass program and the scatter are linked once per context and kept, so a later
//     dispatch of the same entry links nothing. `scripts/gl-compute-bench.ts` measures the cost.
//
// The CPU model of this executor is `testing/gl-model.ts`; `scripts/gpu-differential.ts` holds
// the two to the same words. It imports no compiler.

import type { GlComputeLayout, GlComputeProgram } from './passes/gl-compute.js';

/** The control uniform's flags (`GL_FIRST_PASS`, `GL_ALL_RUN` in `passes/gl-compute.ts`, which
 *  this file does not import: it imports no compiler). */
const FIRST_PASS = 1;
const ALL_RUN = 2;
import { atomicStep } from './scalar-arith.js';
import { runPassesAsync, type PassInvocation } from './phase-schedule.js';
import { byteSize, pack } from './host-entry.js';
import { layoutFromPack } from './manifest-types.js';

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

function compile(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  what: string,
  varyings: readonly string[] = [],
): WebGLProgram {
  let cache = linked.get(gl);
  if (cache === undefined) linked.set(gl, (cache = new Map()));
  const key = `${vs}\0${fs}\0${varyings.join(',')}`;
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
  if (varyings.length > 0) gl.transformFeedbackVaryings(p, [...varyings], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) {
    throw new Error(`typeshade/webgl2: ${what} did not link: ${gl.getProgramInfoLog(p) ?? ''}`);
  }
  cache.set(key, p);
  return p;
}

/** The layers of invocations one transform feedback draw takes: its buffer's size. */
const BATCH_LAYERS = 64;

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

/** The fragment stage the pass program links with: transform feedback takes the record and
 *  nothing is rasterized. */
const NO_FRAGMENTS = `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(0.0); }
`;

/** The scatter program of `p`: one point for each of the first `u_slots` log slots of each
 *  invocation from `u_base` on, placed in the layer `u_layer` of its root or nowhere. It reads
 *  the log from the record texture of the chunk `u_base` starts. */
function scatterSources(p: GlComputeProgram): { vs: string; fs: string } {
  const { width: W, layerRows: LH } = p.layout;
  const vs = `#version 300 es
precision highp int;
precision highp float;
precision highp usampler2DArray;
uniform usampler2DArray u_rec;
uniform uint u_root;
uniform uint u_layer;
uniform uint u_base;
uniform uint u_mh;
uniform uint u_slots;
flat out uint v;
uint word(uint local, uint w) {
  uvec4 t = texelFetch(u_rec, ivec3(int(w / 4u), int(local % ${String(LH)}u), int(local / ${String(LH)}u)), 0);
  return t[w % 4u];
}
void main() {
  uint i = uint(gl_VertexID) / u_slots;
  uint slot = uint(gl_VertexID) % u_slots;
  uint local = i - u_base;
  gl_PointSize = 1.0;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  v = 0u;
  if (slot >= word(local, ${String(p.countWord)}u)) return;
  uint key = word(local, ${String(p.keysAt)}u + slot);
  if ((key >> 28u) != u_root) return;
  uint w = key & 0x0fffffffu;
  uint row = w / ${String(W)}u;
  if (row / ${String(LH)}u != u_layer) return;
  v = word(local, ${String(p.valuesAt)}u + slot);
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
  return { vs, fs };
}

/** One rectangle of one layer of an `R32UI` or `RGBA32UI` array texture, to read back. */
interface Rect {
  readonly tex: WebGLTexture;
  readonly layer: number;
  readonly x: number;
  readonly w: number;
  readonly h: number;
}

/** Give the page one turn. A `MessageChannel` message runs on the next task with no delay;
 *  a nested `setTimeout(0)` waits at least 4 ms, which a pass with several read-backs pays each
 *  time. */
function yieldToPage(): Promise<void> {
  return new Promise((settle) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      settle();
    };
    channel.port2.postMessage(undefined);
  });
}

/** A dispatch's pixel pack buffer, kept across its read-backs and grown when one needs more. */
interface PackBuffer {
  readonly buffer: WebGLBuffer;
  bytes: number;
}

/** Read `rects` back without holding the page (change 0054, item 7): each `readPixels` lands
 *  in one pixel pack buffer, one fence follows them, and the words are taken once the GPU has
 *  passed the fence. Until then the host yields to the page. The words come in `rects` order,
 *  four a texel, each rectangle row by row. */
async function readBack(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  pack: PackBuffer,
  rects: readonly Rect[],
): Promise<Uint32Array> {
  const words = rects.reduce((n, r) => n + r.w * r.h * 4, 0);
  const buffer = pack.buffer;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  if (pack.bytes < words * 4) {
    gl.bufferData(gl.PIXEL_PACK_BUFFER, words * 4, gl.STREAM_READ);
    pack.bytes = words * 4;
  }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
  let at = 0;
  for (const r of rects) {
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, r.tex, 0, r.layer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(r.x, 0, r.w, r.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, at * 4);
    at += r.w * r.h * 4;
  }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
  gl.flush();
  for (;;) {
    const state = gl.clientWaitSync(fence, 0, 0);
    if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) break;
    if (state === gl.WAIT_FAILED) {
      gl.deleteSync(fence);
      throw new Error('typeshade/webgl2: a read-back fence failed (was the context lost?)');
    }
    await yieldToPage();
  }
  gl.deleteSync(fence);
  const out = new Uint32Array(words);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  return out;
}

/** A chunk of invocations: the record texture of its invocations, one a row. */
interface Chunk {
  readonly base: number;
  readonly count: number;
  readonly tex: WebGLTexture;
  readonly layers: number;
}

/** Run `p` over `input.workgroups` on `gl`. */
export async function runGlCompute(
  gl: WebGL2RenderingContext,
  p: GlComputeProgram,
  input: GlComputeInput,
): Promise<GlComputeReport> {
  const { width: W, layerRows: LH } = p.layout;
  const [nx, ny, nz] = input.workgroups;
  const [sx, sy, sz] = p.workgroupSize;
  const perGroup = sx * sy * sz;
  const groups = nx * ny * nz;
  const n = perGroup * groups;
  const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;

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

  // Records: an `RGBA32UI` 2D array texture per chunk, one invocation a row, `LH` rows a layer.
  // A chunk holds as many invocations as the context's layers allow; a larger dispatch is more
  // chunks, so no number of invocations goes to another tier.
  const recWidth = p.slices * p.sliceTexels;
  const perChunk = LH * maxLayers;
  // Each runtime-sized root's element count, which the first pass reads from the uniform.
  const lens = new Uint32Array(16);
  p.roots.forEach((r, k) => {
    if (r.space === 'storage') lens[k] = (words[k]!.length - r.fixed) / r.stride;
  });
  const pcs = new Uint32Array(n);
  const chunks: Chunk[] = [];
  for (let base = 0; base < n; base += perChunk) {
    const count = Math.min(perChunk, n - base);
    const layers = Math.ceil(count / LH);
    const rows = layers > 1 ? LH : count;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32UI, recWidth, rows, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // The first pass starts every record from its initial values, so nothing is uploaded.
    chunks.push({ base, count, tex, layers });
  }
  pcs.fill(record0(p));

  // Each invocation's control texel, which the host writes: whether it runs this pass, and the
  // value its last atomic operation returned.
  const invShape = shape(n, { width: W, layerRows: LH });
  const control = new Uint32Array(W * invShape.h * invShape.layers * 4);
  const invTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, invTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32UI, W, invShape.h, invShape.layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  // Transform feedback: one buffer per slice of the record, for a batch of `BATCH_LAYERS`
  // layers of invocations at a time. Each invocation reads and writes only its own row, so a
  // batch's records replace their rows before the next batch draws.
  const most = Math.min(n, perChunk);
  const perBatch = Math.min(most, LH * BATCH_LAYERS);
  const tfo = gl.createTransformFeedback()!;
  const tfBuffers = Array.from({ length: p.slices }, () => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, b);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, perBatch * p.sliceTexels * 16, gl.DYNAMIC_COPY);
    return b;
  });
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

  const fbo = gl.createFramebuffer()!;
  const readFbo = gl.createFramebuffer()!;
  const packBuffer: PackBuffer = { buffer: gl.createBuffer()!, bytes: 0 };
  const vao = gl.createVertexArray();

  const pass = compile(gl, p.vertex, NO_FRAGMENTS, `${p.entry}'s pass program`, p.varyings);
  const scatter = scatterSources(p);
  const scatterProgram = compile(gl, scatter.vs, scatter.fs, `${p.entry}'s scatter`);
  const ctl = gl.createBuffer()!;
  const uniformBuffers = p.uniforms.map((u, k) => {
    const v = input.uniforms?.[u.name];
    if (v === undefined) throw new Error(`typeshade/webgl2: no value for uniform '${u.name}'`);
    const layout = layoutFromPack(u.layout);
    const bytes = new ArrayBuffer(Math.max(16, Math.ceil(byteSize(layout, v, u.name) / 16) * 16));
    pack(new DataView(bytes), 0, layout, v, u.name);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.STATIC_DRAW);
    gl.uniformBlockBinding(pass, gl.getUniformBlockIndex(pass, u.block), 2 + k);
    return buffer;
  });

  // What the host reads of each record: its resume point, its log's count, its request and the
  // keys of the log slots some invocation filled. They lead the record, so a read is the first
  // few texels of every row.
  const counts = new Uint32Array(n);
  const requests = new Uint32Array(Object.keys(p.requests).length > 0 ? n * 3 : 0);
  let slots = 0;
  let keys = new Uint32Array(0);
  const active = new Uint8Array(n);
  /** Read record texels `[t0, t1)` of every invocation; `take(i, data, at)` reads invocation
   *  `i`'s words at `at` in `data`. */
  const readTexels = async (
    t0: number,
    t1: number,
    take: (i: number, data: Uint32Array, at: number) => void,
  ): Promise<void> => {
    const per = (t1 - t0) * 4;
    const rects: Rect[] = [];
    const firsts: number[] = [];
    for (const c of chunks) {
      for (let l = 0; l < c.layers; l++) {
        rects.push({ tex: c.tex, layer: l, x: t0, w: t1 - t0, h: Math.min(LH, c.count - l * LH) });
        firsts.push(c.base + l * LH);
      }
    }
    const data = await readBack(gl, readFbo, packBuffer, rects);
    let at = 0;
    rects.forEach((r, k) => {
      for (let row = 0; row < r.h; row++, at += per) take(firsts[k]! + row, data, at);
    });
  };
  // The first texels of a record: the resume point, the count, the request and three keys.
  const head = Math.ceil((p.keysAt + 3) / 4);
  const early = new Uint32Array(n * 3);
  const readRecords = async (): Promise<void> => {
    const req = requests.length > 0;
    await readTexels(0, head, (i, px, at) => {
      if (active[i] === 0) return;
      pcs[i] = px[at + p.pcWord]!;
      counts[i] = px[at + p.countWord]!;
      if (req) {
        requests[i * 3] = px[at + p.requestAt]!;
        requests[i * 3 + 1] = px[at + p.requestAt + 1]!;
        requests[i * 3 + 2] = px[at + p.requestAt + 2]!;
      }
      early[i * 3] = px[at + p.keysAt]!;
      early[i * 3 + 1] = px[at + p.keysAt + 1]!;
      early[i * 3 + 2] = px[at + p.keysAt + 2]!;
    });
    slots = 0;
    for (let i = 0; i < n; i++) if (counts[i]! > slots) slots = counts[i]!;
    if (slots === 0) return;
    if (keys.length < n * slots) keys = new Uint32Array(n * slots);
    const k3 = Math.min(3, slots);
    for (let i = 0; i < n; i++)
      for (let s = 0; s < k3; s++) keys[i * slots + s] = early[i * 3 + s]!;
    const last = Math.ceil((p.keysAt + slots) / 4);
    if (last > head)
      await readTexels(head, last, (i, px, at) => {
        if (active[i] === 0) return;
        for (let s = 3; s < slots; s++) keys[i * slots + s] = px[at + p.keysAt + s - head * 4]!;
      });
  };
  const readMemory = async (r: number): Promise<Uint32Array> => {
    const { tex, h, layers } = memory[r]!;
    const m = new Uint32Array(words[r]!.length);
    const rects = Array.from({ length: layers }, (_, l) => ({ tex, layer: l, x: 0, w: W, h }));
    const data = await readBack(gl, readFbo, packBuffer, rects);
    for (let i = 0; i < m.length; i++) m[i] = data[i * 4]!;
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
  // The roots a scatter or a resolve has written: only those are read back at the end.
  const dirty = new Set<number>();

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
  const pcOf = (inv: Inv): number => pcs[inv.index]!;
  let first = true;
  let pending = false;

  gl.bindVertexArray(vao);
  const report = await runPassesAsync<Inv>({
    invocations,
    perGroup,
    done: p.done,
    pcOf,
    cutAt: (pc) => p.cuts[pc],
    barrierAt: (pc) => p.barriers[pc] ?? { fn: 'barrier', line: 'a line without a span' },
    async pass(runnable) {
      flush();
      // Who runs this pass. Where every invocation runs and none has an atomic result waiting,
      // a flag says so and no control texel is uploaded.
      const allRun = runnable.length === n && !pending;
      counts.fill(0);
      if (allRun) active.fill(1);
      else {
        active.fill(0);
        for (let i = 0; i < n; i++) control[i * 4] = 0;
        for (const inv of runnable) {
          control[inv.index * 4] = 1;
          active[inv.index] = 1;
        }
        pending = false;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, invTex);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          0,
          W,
          invShape.h,
          invShape.layers,
          gl.RGBA_INTEGER,
          gl.UNSIGNED_INT,
          control,
        );
      }
      const passFlags = (first ? FIRST_PASS : 0) | (allRun ? ALL_RUN : 0);
      first = false;

      // The pass program: each chunk's invocations as points, every slice of their records
      // into its transform feedback buffer, then the records into the chunk's texture.
      gl.useProgram(pass);
      // The scatter left a memory layer attached; the pass reads memory, so it draws with no
      // framebuffer of ours bound, or WebGL calls it a feedback loop.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.uniformBlockBinding(pass, gl.getUniformBlockIndex(pass, '_PhCtl'), 1);
      let unit = 0;
      memory.forEach((m, r) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, m.tex);
        gl.uniform1i(gl.getUniformLocation(pass, `_phx_mem${String(r)}`), unit++);
      });
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, invTex);
      gl.uniform1i(gl.getUniformLocation(pass, '_phx_inv'), unit++);
      const recUnit = unit++;
      gl.uniform1i(gl.getUniformLocation(pass, '_phx_rec'), recUnit);
      uniformBuffers.forEach((b, k) => gl.bindBufferBase(gl.UNIFORM_BUFFER, 2 + k, b));
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfo);
      for (const c of chunks) {
        gl.activeTexture(gl.TEXTURE0 + recUnit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, c.tex);
        for (let from = 0; from < c.count; from += perBatch) {
          const count = Math.min(perBatch, c.count - from);
          for (let g = 0; g < p.slices; g++) {
            gl.bindBuffer(gl.UNIFORM_BUFFER, ctl);
            gl.bufferData(
              gl.UNIFORM_BUFFER,
              new Uint32Array([nx, ny, nz, 0, g, n, c.base, passFlags, ...lens]),
              gl.DYNAMIC_DRAW,
            );
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, ctl);
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tfBuffers[g]!);
            gl.beginTransformFeedback(gl.POINTS);
            gl.drawArrays(gl.POINTS, c.base + from, count);
            gl.endTransformFeedback();
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
          }
          // Every slice has read the batch's old records before any is replaced.
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, c.tex);
          for (let g = 0; g < p.slices; g++) {
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, tfBuffers[g]!);
            for (let r = 0; r < count; r += LH) {
              gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                g * p.sliceTexels,
                0,
                (from + r) / LH,
                p.sliceTexels,
                Math.min(LH, count - r),
                1,
                gl.RGBA_INTEGER,
                gl.UNSIGNED_INT,
                r * p.sliceTexels * 16,
              );
            }
          }
          gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        }
      }
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      await readRecords();

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

      // The scatter, root by root, layer by layer and chunk by chunk, straight into memory.
      gl.useProgram(scatterProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(gl.getUniformLocation(scatterProgram, 'u_rec'), 0);
      gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_slots'), slots);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      memory.forEach((m, r) => {
        if (written[r]!.size === 0) return;
        dirty.add(r);
        gl.viewport(0, 0, W, m.h);
        gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_root'), r);
        gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_mh'), m.h);
        for (const [l, [lo, hi]] of written[r]!) {
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, m.tex, 0, l);
          gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_layer'), l);
          for (const c of chunks) {
            const a = Math.max(lo, c.base);
            const b = Math.min(hi, c.base + c.count - 1);
            if (a > b) continue;
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, c.tex);
            gl.uniform1ui(gl.getUniformLocation(scatterProgram, 'u_base'), c.base);
            gl.drawArrays(gl.POINTS, a * slots, (b - a + 1) * slots);
          }
        }
      });
    },
    async resolve(inv, pc) {
      const rq = p.requests[pc]!;
      const o = inv.index * 3;
      let m = resolving.get(rq.root);
      if (m === undefined) resolving.set(rq.root, (m = await readMemory(rq.root)));
      const word = requests[o]!;
      const signed = (b: number): number => (rq.elem === 'i32' ? b | 0 : b >>> 0);
      const old = signed(m[word]!);
      const step = atomicStep(
        rq.fn,
        old,
        signed(requests[o + 1]!),
        rq.elem,
        signed(requests[o + 2]!),
      );
      if (rq.fn !== 'atomicLoad') m[word] = step.next >>> 0;
      if (rq.result === undefined) return;
      pending = true;
      const at = inv.index * 4 + 1;
      if (rq.pair) {
        const r = step.result as { old_value: number; exchanged: boolean };
        control[at] = r.old_value >>> 0;
        control[at + 1] = r.exchanged ? 1 : 0;
      } else control[at] = (step.result as number) >>> 0;
    },
  });

  flush();
  // Hand the storage roots back.
  for (const [k, r] of p.roots.entries())
    if (r.space === 'storage' && dirty.has(k)) words[k]!.set(await readMemory(k));
  for (const { tex } of memory) gl.deleteTexture(tex);
  for (const c of chunks) gl.deleteTexture(c.tex);
  gl.deleteTexture(invTex);
  for (const b of tfBuffers) gl.deleteBuffer(b);
  gl.deleteTransformFeedback(tfo);
  gl.deleteFramebuffer(fbo);
  gl.deleteFramebuffer(readFbo);
  gl.deleteBuffer(packBuffer.buffer);
  gl.deleteBuffer(ctl);
  for (const b of uniformBuffers) gl.deleteBuffer(b);
  return report;
}

/** The resume point every record starts at. */
function record0(p: GlComputeProgram): number {
  return p.init.find(([at]) => at === p.pcWord)?.[1][0] ?? 0;
}
