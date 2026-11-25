import type { GlComputeProgram } from './passes/gl-compute.js';

const FIRST_PASS = 1;
const ALL_RUN = 2;
const GUARD = '_fp64';
import { atomicStep } from './scalar-arith.js';
import { runPassesAsync, type PassInvocation } from './phase-schedule.js';
import { byteSize, pack } from './host-entry.js';
import { layoutFromPack } from './manifest-types.js';
import { gpuDone } from './gl-fence.js';
import { compile } from './gl-compute/program-cache.js';
import { drawn } from './gl-compute/refused-draw-check.js';
import {
  BATCH_LAYERS,
  MAX_ROOT_WORDS,
  shape,
  wordTexture,
  type Layered,
} from './gl-compute/word-textures.js';
export { compile } from './gl-compute/program-cache.js';

export { gpuDone };

export interface GlComputeInput {
  readonly workgroups: readonly [number, number, number];
  readonly memory: Readonly<Record<string, Uint32Array>>;
  readonly uniforms?: Readonly<Record<string, unknown>>;
  readonly textures?: Readonly<
    Record<string, { readonly texture: WebGLTexture; readonly sampler?: WebGLSampler | null }>
  >;
  readonly storageTextures?: Readonly<
    Record<
      string,
      {
        readonly texture: WebGLTexture;
        readonly width: number;
        readonly height: number;
        readonly layers?: number;
      }
    >
  >;
}

export interface GlComputeReport {
  readonly passes: number;
  readonly barrierPhases: number;
}

interface Inv extends PassInvocation {
  readonly index: number;
}

const NO_FRAGMENTS = `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(0.0); }
`;

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

interface Rect {
  readonly tex: WebGLTexture;
  readonly layer: number;
  readonly x: number;
  readonly w: number;
  readonly h: number;
}

interface PackBuffer {
  readonly buffer: WebGLBuffer;
  bytes: number;
}

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
  await gpuDone(gl);
  const out = new Uint32Array(words);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  return out;
}

function declaresGuard(vertex: string): boolean {
  return new RegExp(`^uniform (?:\\w+ )*sampler2D ${GUARD};$`, 'm').test(vertex);
}

function guardTexture(gl: WebGL2RenderingContext, t: WebGLTexture): WebGLTexture {
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

interface Chunk {
  readonly base: number;
  readonly count: number;
  readonly tex: WebGLTexture;
  readonly layers: number;
}

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

  const images = (p.storageTextures ?? []).map((t) => {
    const given = input.storageTextures?.[t.name];
    if (given === undefined)
      throw new Error(`typeshade/webgl2: no storage texture for '${t.name}'`);
    return {
      ...t,
      ...given,
      layers: given.layers ?? 1,
      root: p.roots.findIndex((r) => r.name === t.name),
    };
  });
  const uniformValues: Record<string, unknown> = { ...input.uniforms };
  for (const t of images) uniformValues[t.size] = { s: [t.width, t.height, t.layers, 0] };
  const words = p.roots.map((r) => {
    if (r.space === 'workgroup') return new Uint32Array(r.fixed * groups);
    const image = images.find((t) => t.name === r.name);
    if (image !== undefined) return new Uint32Array(image.width * image.height * image.layers * 4);
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
  const sampled = (p.textures ?? []).map((t) => {
    const given = input.textures?.[t.name];
    if (given === undefined) throw new Error(`typeshade/webgl2: no texture for '${t.name}'`);
    return { ...given, target: targetOf(gl, t.dim) };
  });
  const guarded = declaresGuard(p.vertex);
  const reads = p.roots.length + 2 + sampled.length + (guarded ? 1 : 0);
  const units = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number;
  if (reads > units)
    throw new Error(
      `typeshade/webgl2: the pass program reads ${String(reads)} textures, more than the ${String(units)} a vertex stage of this context binds`,
    );
  const resources: (() => void)[] = [];
  const own = <T>(value: T, release: (value: T) => void): T => {
    resources.push(() => release(value));
    return value;
  };
  const createTexture = (): WebGLTexture => own(gl.createTexture()!, (t) => gl.deleteTexture(t));
  const createBuffer = (): WebGLBuffer => own(gl.createBuffer()!, (b) => gl.deleteBuffer(b));
  const createFramebuffer = (): WebGLFramebuffer =>
    own(gl.createFramebuffer()!, (f) => gl.deleteFramebuffer(f));
  try {
    const memory = words.map((w, k) =>
      wordTexture(gl, w, p.layout, `'${p.roots[k]!.name}'`, createTexture),
    );

    const recWidth = p.slices * p.sliceTexels;
    const perChunk = LH * maxLayers;
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
      const tex = createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32UI, recWidth, rows, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      chunks.push({ base, count, tex, layers });
    }
    pcs.fill(record0(p));

    const invShape = shape(n, { width: W, layerRows: LH });
    const control = new Uint32Array(W * invShape.h * invShape.layers * 4);
    const invTex = createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, invTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32UI, W, invShape.h, invShape.layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const guard = guarded ? guardTexture(gl, createTexture()) : undefined;

    const most = Math.min(n, perChunk);
    const perBatch = Math.min(most, LH * BATCH_LAYERS);
    const tfo = own(gl.createTransformFeedback()!, (t) => gl.deleteTransformFeedback(t));
    const tfBuffers = Array.from({ length: p.slices }, () => {
      const b = createBuffer();
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, b);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, perBatch * p.sliceTexels * 16, gl.DYNAMIC_COPY);
      return b;
    });
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

    const fbo = createFramebuffer();
    const readFbo = createFramebuffer();
    const packBuffer: PackBuffer = { buffer: createBuffer(), bytes: 0 };
    const vao = own(gl.createVertexArray(), (v) => gl.deleteVertexArray(v));

    const pass = compile(gl, p.vertex, NO_FRAGMENTS, `${p.entry}'s pass program`, p.varyings);
    const scatter = scatterSources(p);
    const scatterProgram = compile(gl, scatter.vs, scatter.fs, `${p.entry}'s scatter`);
    const ctl = createBuffer();
    const uniformBuffers = p.uniforms.map((u, k) => {
      const v = uniformValues[u.name];
      if (v === undefined) throw new Error(`typeshade/webgl2: no value for uniform '${u.name}'`);
      const layout = layoutFromPack(u.layout);
      const bytes = new ArrayBuffer(Math.max(16, Math.ceil(byteSize(layout, v, u.name) / 16) * 16));
      pack(new DataView(bytes), 0, layout, v, u.name);
      const buffer = createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
      gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.STATIC_DRAW);
      gl.uniformBlockBinding(pass, gl.getUniformBlockIndex(pass, u.block), 2 + k);
      return buffer;
    });

    const counts = new Uint32Array(n);
    const requests = new Uint32Array(Object.keys(p.requests).length > 0 ? n * 3 : 0);
    let slots = 0;
    let keys = new Uint32Array(0);
    const active = new Uint8Array(n);
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
          rects.push({
            tex: c.tex,
            layer: l,
            x: t0,
            w: t1 - t0,
            h: Math.min(LH, c.count - l * LH),
          });
          firsts.push(c.base + l * LH);
        }
      }
      const data = await readBack(gl, readFbo, packBuffer, rects);
      let at = 0;
      rects.forEach((r, k) => {
        for (let row = 0; row < r.h; row++, at += per) take(firsts[k]! + row, data, at);
      });
    };
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
    const dirty = new Set<number>();

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
    for (const t of images) {
      if (t.access !== 'read') renderable(gl, fbo, t);
      imageIn(gl, fbo, p, t, memory[t.root]!);
    }
    const report = await runPassesAsync<Inv>({
      invocations,
      perGroup,
      done: p.done,
      pcOf,
      cutAt: (pc) => p.cuts[pc],
      barrierAt: (pc) => p.barriers[pc] ?? { fn: 'barrier', line: 'a line without a span' },
      async pass(runnable) {
        flush();
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

        gl.useProgram(pass);
        // Why: the scatter leaves a memory layer attached and the pass reads memory, so WebGL
        // calls a draw with our framebuffer bound a feedback loop.
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
        if (guard !== undefined) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, guard);
          gl.bindSampler(unit, null);
          gl.uniform1i(gl.getUniformLocation(pass, GUARD), unit++);
        }
        const firstSampled = unit;
        try {
          sampled.forEach((t, k) => {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(t.target, t.texture);
            gl.bindSampler(unit, t.sampler ?? null);
            gl.uniform1i(gl.getUniformLocation(pass, `_phx_tex${String(k)}`), unit++);
          });
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
          drawn(gl, `${p.entry}'s pass program`);
        } finally {
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
          gl.disable(gl.RASTERIZER_DISCARD);
          for (let u = firstSampled; u < unit; u++) {
            gl.bindSampler(u, null);
            gl.activeTexture(gl.TEXTURE0 + u);
            gl.bindTexture(sampled[u - firstSampled]!.target, null);
          }
        }
        await readRecords();

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
        drawn(gl, `${p.entry}'s scatter`);
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
    for (const t of images) if (t.access !== 'read') imageOut(gl, fbo, p, t, memory[t.root]!);
    for (const [k, r] of p.roots.entries())
      if (r.space === 'storage' && dirty.has(k) && !images.some((t) => t.root === k))
        words[k]!.set(await readMemory(k));
    return report;
  } finally {
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = resources.length - 1; i >= 0; i--) resources[i]!();
  }
}

type Image = NonNullable<GlComputeProgram['storageTextures']>[number] & {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly root: number;
};

const TRIANGLE_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PREFIX = { float: '', uint: 'u', sint: 'i' } as const;

function attach(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, t: Image, layer: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  if (t.dim === '2d-array')
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t.texture, 0, layer);
  else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
}

function renderable(gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, t: Image): void {
  if (/float$/.test(t.format)) gl.getExtension('EXT_color_buffer_float');
  attach(gl, fbo, t, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  if (status !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error(
      `typeshade/webgl2: the storage texture '${t.name}' is ${t.format}, which this WebGL2 context does not render to and the WebGL2 tier has no fallback for yet (Rule 10.5)${
        /float$/.test(t.format) && gl.getExtension('EXT_color_buffer_float') === null
          ? ' (it has no EXT_color_buffer_float)'
          : ''
      }; was it made with that format?`,
    );
}

function plainState(gl: WebGL2RenderingContext): void {
  for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE])
    gl.disable(cap);
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.colorMask(true, true, true, true);
}

function imageIn(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  p: GlComputeProgram,
  t: Image,
  mem: Layered,
): void {
  const { width: W, layerRows: LH } = p.layout;
  const arr = t.dim === '2d-array';
  const sampler = `${PREFIX[t.texel]}sampler2D${arr ? 'Array' : ''}`;
  const bits =
    t.texel === 'float' ? 'floatBitsToUint(v[c])' : t.texel === 'sint' ? 'uint(v[c])' : 'v[c]';
  const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp ${sampler};
uniform ${sampler} u_src;
uniform uint u_layer;
uniform uint u_w;
uniform uint u_h;
uniform uint u_n;
out uvec4 o;
void main() {
  uint wi = (u_layer * ${String(LH)}u + uint(gl_FragCoord.y)) * ${String(W)}u + uint(gl_FragCoord.x);
  uint texel = wi / 4u;
  int c = int(wi % 4u);
  o = uvec4(0u);
  if (texel >= u_w * u_h * u_n) return;
  uint x = texel % u_w;
  uint y = (texel / u_w) % u_h;
  ${PREFIX[t.texel]}vec4 v = texelFetch(u_src, ${arr ? 'ivec3(int(x), int(y), int(texel / (u_w * u_h)))' : 'ivec2(int(x), int(y))'}, 0);
  o = uvec4(${bits}, 0u, 0u, 0u);
}
`;
  const program = compile(gl, TRIANGLE_VS, fs, `the read of storage texture '${t.name}'`);
  const nearest = gl.createSampler()!;
  gl.samplerParameteri(nearest, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.samplerParameteri(nearest, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const target = arr ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
  try {
    gl.useProgram(program);
    plainState(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(target, t.texture);
    gl.bindSampler(0, nearest);
    gl.uniform1i(gl.getUniformLocation(program, 'u_src'), 0);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_w'), t.width);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_h'), t.height);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_n'), t.layers);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, W, mem.h);
    for (let l = 0; l < mem.layers; l++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, mem.tex, 0, l);
      gl.uniform1ui(gl.getUniformLocation(program, 'u_layer'), l);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    drawn(gl, `${p.entry}'s read of storage texture '${t.name}'`);
  } finally {
    gl.bindSampler(0, null);
    gl.bindTexture(target, null);
    gl.deleteSampler(nearest);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function imageOut(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer,
  p: GlComputeProgram,
  t: Image,
  mem: Layered,
): void {
  const { width: W, layerRows: LH } = p.layout;
  const out = `${PREFIX[t.texel]}vec4`;
  const value = t.texel === 'float' ? 'uintBitsToFloat(b)' : t.texel === 'sint' ? 'ivec4(b)' : 'b';
  const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2DArray;
uniform usampler2DArray u_mem;
uniform uint u_layer;
uniform uint u_w;
uniform uint u_h;
out ${out} o;
uint word(uint w) {
  uint row = w / ${String(W)}u;
  return texelFetch(u_mem, ivec3(int(w % ${String(W)}u), int(row % ${String(LH)}u), int(row / ${String(LH)}u)), 0).x;
}
void main() {
  uint at = ((u_layer * u_h + uint(gl_FragCoord.y)) * u_w + uint(gl_FragCoord.x)) * 4u;
  uvec4 b = uvec4(word(at), word(at + 1u), word(at + 2u), word(at + 3u));
  o = ${value};
}
`;
  const program = compile(gl, TRIANGLE_VS, fs, `the write of storage texture '${t.name}'`);
  try {
    gl.useProgram(program);
    plainState(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, mem.tex);
    gl.bindSampler(0, null);
    gl.uniform1i(gl.getUniformLocation(program, 'u_mem'), 0);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_w'), t.width);
    gl.uniform1ui(gl.getUniformLocation(program, 'u_h'), t.height);
    gl.viewport(0, 0, t.width, t.height);
    for (let l = 0; l < t.layers; l++) {
      attach(gl, fbo, t, l);
      gl.uniform1ui(gl.getUniformLocation(program, 'u_layer'), l);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    drawn(gl, `${p.entry}'s write of storage texture '${t.name}'`);
  } finally {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function targetOf(gl: WebGL2RenderingContext, dim: '2d-array' | '3d' | 'cube' | undefined): number {
  return dim === '2d-array'
    ? gl.TEXTURE_2D_ARRAY
    : dim === '3d'
      ? gl.TEXTURE_3D
      : dim === 'cube'
        ? gl.TEXTURE_CUBE_MAP
        : gl.TEXTURE_2D;
}

function record0(p: GlComputeProgram): number {
  return p.init.find(([at]) => at === p.pcWord)?.[1][0] ?? 0;
}
