// ═══ The compile gate's entry-call leg, the half that runs in the page (Rule 8.24, change 0016) ═══
//
// `scripts/entry-calls.ts` bundles this file with each `.shade.ts` example's generated host
// module (the module the Vite plugin writes) and `typeshade/runtime`, so the calls below go
// through exactly what an application calls. For each callable entry:
//
//   - a `@compute` entry is called once on WebGPU, once on WebGL2 (the pass program of change
//     0054) and once on the CPU tier, each with its own copy of the same bindings, and every
//     storage binding it writes is compared;
//   - the same compute entry is dispatched once more by the program runtime (`typeshade/runtime`,
//     change 0025, Rule 11.11) from the module's manifest, with the same values, its written bindings the
//     host's own buffers read back, and compared with the call's;
//   - and once more by a program runtime of the WebGL2 tier (change 0054), from the pass program
//     the manifest carries, its written bindings `Resident`s read back, and compared with the
//     call's; an entry whose manifest carries none is reported as skipped with its reason;
//   - a full-screen `@fragment` entry is drawn into a canvas on WebGPU, on WebGL2 and on the
//     CPU tier, and each frame is compared with WebGPU's pixel by pixel.
//
// A tier the entry has no form for (a barrier or a texture on the CPU tier, a texture on
// WebGL2's compute tier, a storage buffer in a WebGL2 draw) is reported as skipped with the reason
// the host face gives, never passed silently.
//
// The bindings are made from the layouts in the face: the same deterministic values on every
// tier, small enough that an index an entry computes from them stays in range.
//
// The program tier draws as well as dispatches (issue #392, Rule 11.11). `renderFrames` loads the
// three programs of `scripts/render-case.ts` on the same runtime, and again on a runtime of the
// WebGL2 tier (change 0054), and draws its two frames the way a host does: a sky pass and two indexed draws in one `frame.pass()` under a reversed depth
// test, a second pass that loads what the first drew and draws from the host's own buffers, and a
// mesh whose vertices the shader pulls from a storage buffer. It reads colour and depth back, for
// the gate to hold to the picture the case computes, and draws the frames again with a depth test
// the scene does not want, which the gate must see differ (AGENTS.md#gate-discipline).

import { configure } from '../src/core/host-runtime.js';
import {
  byteSize,
  pack,
  readInto,
  type DrawBinding,
  type Layout,
  type LayoutNumber,
} from '../src/core/host-entry.js';
import { createRuntime, resident, type Pack, type Runtime, type Texture } from '../src/runtime.js';
import {
  positions,
  vertices,
  FAR,
  MID,
  NEAR,
  Q,
  SIZE as RENDER_SIZE,
  SKY,
  T,
  type FrameName,
  type Programs,
  type Readback,
} from './render-case.js';

/** One callable entry of one example, as `scripts/entry-calls.ts` lists it. */
export interface EntryCase {
  readonly id: string;
  readonly kind: 'compute' | 'fragment';
  readonly name: string;
  readonly bindings: readonly DrawBinding[];
  /** Why the CPU tier cannot run it (a barrier or a texture), when it cannot. */
  readonly noCpu?: string;
  /** Why the WebGL2 tier cannot draw it, when it cannot (a fragment entry). */
  readonly noGl?: string;
  readonly call: (...args: unknown[]) => Promise<void>;
  /** The module's manifest, its default export, which the program runtime loads. */
  readonly manifest: Pack;
}

/** What one tier did against the reference tier: its worst difference, or why it did not run. */
export interface TierVerdict {
  readonly tier: string;
  readonly worst?: number;
  readonly values?: number;
  readonly skipped?: string;
  readonly error?: string;
}

export interface EntryVerdict {
  readonly id: string;
  readonly kind: 'compute' | 'fragment';
  readonly name: string;
  /** What the reference tier produced: how many written values the WebGPU call changed, so a
   *  call that compares nothing cannot pass, or how many distinct colours its frame holds. */
  readonly changed?: number;
  /** The reference tier's own failure, when it could not run at all. */
  readonly error?: string;
  readonly tiers: readonly TierVerdict[];
}

export interface EntryReport {
  /** The instrument: a comparison against a copy with one value changed must report it. */
  readonly perturbedReported: boolean;
  readonly verdicts: readonly EntryVerdict[];
  /** The render case (`scripts/render-case.ts`): each frame drawn through the program runtime as
   *  a host writes it, and again with the scene's depth test wrong on purpose. */
  readonly render: {
    readonly right: Readonly<Record<FrameName, Readback>>;
    readonly wrong: Readonly<Record<FrameName, Readback>>;
  };
  /** The same frames on a runtime of the WebGL2 tier (change 0054). */
  readonly glRender: EntryReport['render'];
  /** The `passes` frame drawn into a canvas by a runtime on its WebGL2 context. */
  readonly glCanvas: Readback;
}

/** A runtime-sized array's element count, and a canvas's side. */
const N = 256;
const SIZE = 32;

// ─── the bindings ────────────────────────────────────────────────────────────────────────────

/** The `k`-th deterministic value of a number type: small, and exact in f32. */
function numberAt(t: LayoutNumber, k: number): number {
  if (t === 'f32' || t === 'f64') return ((k * 37) % 17) / 8 - 1;
  if (t === 'i32') return ((k * 7) % 11) - 5;
  return (k * 7) % 11;
}

const TYPED = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  f64: Float64Array,
} as const;

/** A host value for `l`, as the host view types it, numbered from `k.n`. */
function valueOf(l: Layout, boxed: boolean, k: { n: number }): unknown {
  switch (l.k) {
    case 's': {
      const v = numberAt(l.t, k.n++);
      return boxed ? TYPED[l.t].of(v) : v;
    }
    case 'v':
      return Array.from({ length: l.n }, () => numberAt(l.t, k.n++));
    case 'm':
      return Array.from({ length: l.c * l.r }, () => numberAt('f32', k.n++));
    case 'a': {
      const count = l.n ?? N;
      if (l.n === null && (l.e.k === 's' || l.e.k === 'v')) {
        const t = l.e.t;
        const lanes = l.e.k === 'v' ? l.e.n : 1;
        const out = new TYPED[t](count * lanes);
        for (let i = 0; i < out.length; i++) out[i] = numberAt(t, k.n++);
        return out;
      }
      return Array.from({ length: count }, () => valueOf(l.e, false, k));
    }
    case 'o':
      return Object.fromEntries(l.f.map(([name, , fl]) => [name, valueOf(fl, false, k)]));
  }
}

/** The bindings object, fresh: each tier gets its own copy of the same values. */
function bindingsOf(c: EntryCase): Record<string, unknown> {
  const k = { n: 1 };
  const out: Record<string, unknown> = {};
  for (const b of c.bindings) {
    if (b.space === 'uniform' || b.space === 'storage')
      out[b.name] = valueOf(b.layout, b.writes && b.layout.k === 's', k);
    else if ('guard' in b)
      continue; // the `_fp64` guard is the runtime's to bind
    else if (b.space === 'texture') out[b.name] = imageOf();
    else out[b.name] = { filter: 'nearest', address: 'repeat' };
  }
  return out;
}

/** An 8x8 image, each texel its own colour. */
function imageOf(): ImageData {
  const img = new ImageData(8, 8);
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) img.data.set([i * 32, j * 32, (i + j) * 16, 255], 4 * (j * 8 + i));
  return img;
}

/** Every number a value holds, in order. */
function flat(v: unknown): number[] {
  if (typeof v === 'number') return [v];
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) return v.flatMap(flat);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(flat);
  return [];
}

/** The worst difference of `got` from `want`, relative to 1 or the value's own size; `Infinity`
 *  when the lengths differ. NaN matches NaN. */
export function worstOf(want: readonly number[], got: readonly number[]): number {
  if (want.length !== got.length) return Infinity;
  let worst = 0;
  want.forEach((w, i) => {
    const g = got[i]!;
    if (Number.isNaN(w) && Number.isNaN(g)) return;
    const d = Math.abs(w - g) / Math.max(1, Math.abs(w));
    worst = Math.max(worst, Number.isNaN(d) ? Infinity : d);
  });
  return worst;
}

// ─── the calls ───────────────────────────────────────────────────────────────────────────────

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The storage bindings the entry writes, flattened, before and after one call on `tier`. */
async function computeOn(
  c: EntryCase,
  tier: 'webgpu' | 'webgl2' | 'cpu',
): Promise<{ before: number[]; after: number[] }> {
  const bindings = bindingsOf(c);
  const written = (): number[] =>
    c.bindings
      .filter((b) => b.space === 'storage' && b.writes)
      .flatMap((b) => flat(bindings[b.name]));
  const before = written();
  configure({ prefer: [tier] });
  try {
    await c.call(bindings, 1);
  } finally {
    configure({});
  }
  return { before, after: written() };
}

/** A canvas whose first context is `kind`, so a draw into it keeps that tier. */
function canvas(kind?: 'webgl2' | '2d'): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = SIZE;
  el.height = SIZE;
  if (kind === 'webgl2')
    el.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (kind === '2d') el.getContext('2d', { alpha: false });
  return el;
}

/** The canvas's pixels, RGBA, read in the task that drew them. */
function pixels(el: HTMLCanvasElement): number[] {
  const copy = document.createElement('canvas');
  copy.width = SIZE;
  copy.height = SIZE;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(el, 0, 0);
  return [...ctx.getImageData(0, 0, SIZE, SIZE).data];
}

async function drawOn(c: EntryCase, kind?: 'webgl2' | '2d'): Promise<number[]> {
  const el = canvas(kind);
  await c.call(el, bindingsOf(c));
  // A canvas hands out only the kind of context it gave first: WebGPU drew this one, or the
  // reference is some other tier and the comparison would be with itself.
  if (kind === undefined && el.getContext('webgpu') === null)
    throw new Error('the draw did not run on WebGPU');
  return pixels(el);
}

let programRuntime: Promise<Runtime> | undefined;

/** The storage bindings the entry writes, flattened, after one dispatch by the program runtime
 *  from the manifest: the written bindings are GPU buffers the page makes, filled with the same
 *  values and read back, and every other value is the runtime's to pack. */
async function computeOnProgram(c: EntryCase): Promise<number[]> {
  const rt = await (programRuntime ??= createRuntime());
  const device = rt.device as unknown as {
    createBuffer(d: object): {
      mapAsync(m: number): Promise<void>;
      getMappedRange(): ArrayBuffer;
      unmap(): void;
      destroy(): void;
    };
    createTexture(d: object): object;
    queue: {
      writeBuffer(b: object, o: number, d: ArrayBuffer): void;
      writeTexture(d: object, data: ArrayBufferView, l: object, s: readonly number[]): void;
    };
  };
  const pipeline = await rt.load(c.manifest).compute(c.name);
  const values = bindingsOf(c);
  const given: Record<string, unknown> = {};
  const written: {
    name: string;
    layout: Layout;
    size: number;
    buffer: object;
    staging: ReturnType<typeof device.createBuffer>;
  }[] = [];
  for (const b of c.bindings) {
    if ('guard' in b) continue;
    const v = values[b.name];
    if (b.space === 'storage' && b.writes) {
      const bytes = new ArrayBuffer(byteSize(b.layout, v, b.name));
      pack(new DataView(bytes), 0, b.layout, v, b.name, b.layout.k === 's');
      const buffer = device.createBuffer({ size: bytes.byteLength, usage: 0x80 | 0x4 | 0x8 });
      device.queue.writeBuffer(buffer, 0, bytes);
      const staging = device.createBuffer({ size: bytes.byteLength, usage: 0x1 | 0x8 });
      written.push({ name: b.name, layout: b.layout, size: bytes.byteLength, buffer, staging });
      given[b.name] = buffer;
    } else if (b.space === 'texture') {
      const img = v as ImageData;
      const texture = device.createTexture({
        size: [img.width, img.height, 1],
        format: 'rgba8unorm',
        usage: 0x4 | 0x2,
      });
      device.queue.writeTexture({ texture }, img.data, { bytesPerRow: img.width * 4 }, [
        img.width,
        img.height,
        1,
      ]);
      given[b.name] = texture;
    } else if (b.space === 'sampler') given[b.name] = rt.sampler(v as object);
    else given[b.name] = v;
  }
  const frame = rt.frame();
  frame.dispatch(pipeline, given, 1);
  const encoder = frame.encoder as {
    copyBufferToBuffer(s: object, so: number, d: object, dO: number, n: number): void;
  };
  for (const w of written) encoder.copyBufferToBuffer(w.buffer, 0, w.staging, 0, w.size);
  await frame.submit();
  const out: number[] = [];
  for (const w of written) {
    await w.staging.mapAsync(1);
    const dv = new DataView(w.staging.getMappedRange().slice(0));
    w.staging.unmap();
    const target = values[w.name];
    const read = readInto(dv, 0, w.layout, target);
    out.push(...flat(read === undefined ? target : read));
  }
  return out;
}

let glRuntime: Promise<Runtime> | undefined;

/** The storage bindings the entry writes, flattened, after one dispatch by a program runtime of
 *  the WebGL2 tier (change 0054) from the manifest's pass program: each written binding a
 *  `Resident`, read back once the frame is submitted, and every other value the runtime's to
 *  pack. A scalar the call takes boxed is given as the number it holds. */
async function computeOnProgramGl(c: EntryCase): Promise<number[]> {
  const rt = await (glRuntime ??= createRuntime({ prefer: ['webgl2'] }));
  if (rt.tier !== 'webgl2') throw new Error(`the runtime runs on ${rt.tier}, not webgl2`);
  const pipeline = await rt.load(c.manifest).compute(c.name);
  const values = bindingsOf(c);
  const given: Record<string, unknown> = {};
  const written: { name: string; scalar: boolean; handle: ReturnType<typeof resident> }[] = [];
  for (const b of c.bindings) {
    if ('guard' in b) continue;
    const v = values[b.name];
    if (b.space === 'storage' && b.writes) {
      const scalar = b.layout.k === 's';
      const handle = resident(scalar ? flat(v)[0] : v);
      written.push({ name: b.name, scalar, handle });
      given[b.name] = handle;
    } else if (b.space === 'texture') {
      // A texture of the runtime holding the image, as a host that draws into it and reads it
      // back would have one.
      const img = v as ImageData;
      const texture = rt.texture({ size: [img.width, img.height], format: 'rgba8unorm' });
      const gl = rt.device as WebGL2RenderingContext;
      gl.bindTexture(gl.TEXTURE_2D, texture.texture as WebGLTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        img.width,
        img.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        img.data,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
      given[b.name] = texture;
    } else if (b.space === 'sampler') given[b.name] = rt.sampler(v as object);
    else given[b.name] = v;
  }
  const frame = rt.frame();
  frame.dispatch(pipeline, given, 1);
  await frame.submit();
  const out: number[] = [];
  for (const w of written) out.push(...flat(await w.handle.read()));
  return out;
}

// The formats of the case's depth attachment and colour target.
const DEPTH = 'depth32float';
const COLOR = 'rgba8unorm';

/** A frame of the render case: what it draws through the program runtime, colour and depth read
 *  back as bytes and floats. `sceneCompare` is the depth test of the mesh pipelines: `'greater'`,
 *  which a reversed projection needs, or a wrong one, for the gate's instrument. */
type CaseFrame = (rt: Runtime, programs: Programs, sceneCompare: string) => Promise<Readback>;

/** The host's own buffer of `data`, on the runtime's tier: a `GPUBuffer` on WebGPU, a
 *  `WebGLBuffer` on WebGL2 (change 0054). */
function hostBuffer(rt: Runtime, data: ArrayBufferView, use: 'vertex' | 'index'): object {
  if (rt.tier === 'webgl2') {
    const gl = rt.device as WebGL2RenderingContext;
    const target = use === 'vertex' ? gl.ARRAY_BUFFER : gl.ELEMENT_ARRAY_BUFFER;
    const b = gl.createBuffer()!;
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    gl.bindBuffer(target, null);
    return b;
  }
  const device = rt.device as GPUDevice;
  const b = device.createBuffer({
    size: Math.ceil(data.byteLength / 4) * 4,
    usage:
      (use === 'vertex' ? GPUBufferUsage.VERTEX : GPUBufferUsage.INDEX) | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(b, 0, data as BufferSource);
  return b;
}

/** A frame's colour and depth read back: colour as bytes, depth as floats. */
async function readBack(color: Texture, depth: Texture): Promise<Readback> {
  return { color: [...(await color.read())], depth: [...(await depth.readFloats())] };
}

/** The `passes` frame: a sky pass and two indexed draws in one `frame.pass()`, depth cleared to 0
 *  for a reversed projection; then a second pass that loads both attachments and draws a triangle
 *  from the host's own vertex and index buffers. */
const passesFrame: CaseFrame = (rt, programs, sceneCompare) => passes(rt, programs, sceneCompare);

/** The `passes` frame, its colour drawn into a texture of the runtime, or into `canvas`, the
 *  canvas of the runtime's WebGL2 context (change 0054), read back through a 2D canvas. */
async function passes(
  rt: Runtime,
  programs: Programs,
  sceneCompare: string,
  canvas?: HTMLCanvasElement,
): Promise<Readback> {
  // The sky is drawn behind everything and writes no depth; the scene compares as it is given.
  const sky = await rt.load(programs.sky).render({
    targets: [COLOR],
    depth: { format: DEPTH, compare: 'always', write: false },
  });
  const mesh = await rt.load(programs.mesh).render({
    targets: [COLOR],
    depth: { format: DEPTH, compare: sceneCompare },
  });
  const texture = rt.texture({ size: [RENDER_SIZE, RENDER_SIZE], format: COLOR });
  const color = canvas === undefined ? texture : rt.device;
  const depth = rt.texture({ size: [RENDER_SIZE, RENDER_SIZE], format: DEPTH });
  const hostVertices = hostBuffer(rt, vertices(MID), 'vertex');
  // Three `uint16` indices are six bytes and a write takes a multiple of four: a fourth pads
  // it, and the draw counts three.
  const hostIndices = hostBuffer(rt, new Uint16Array([0, 1, 2, 0]), 'index');
  const f = rt.frame();
  f.pass(
    { color: [{ target: color, clear: [1, 0, 1, 1] }], depth: { target: depth, clear: 0 } },
    (p) => {
      p.draw(sky, { sky: SKY }, { count: 3 });
      p.draw(
        mesh,
        { tint: { color: NEAR.tint } },
        { vertices: vertices(NEAR), indices: new Uint16Array([0, 1, 2, 0, 2, 3]), count: 6 },
      );
      p.draw(
        mesh,
        { tint: { color: FAR.tint } },
        { vertices: vertices(FAR), indices: new Uint32Array([0, 1, 2, 2, 3, 0]), count: 6 },
      );
    },
  );
  f.pass(
    { color: [{ target: color, load: 'load' }], depth: { target: depth, load: 'load' } },
    (p) =>
      p.draw(
        mesh,
        { tint: { color: MID.tint } },
        { vertices: hostVertices, indices: { buffer: hostIndices, format: 'uint16' }, count: 3 },
      ),
  );
  await f.submit();
  if (canvas === undefined) return readBack(texture, depth);
  const copy = document.createElement('canvas');
  copy.width = RENDER_SIZE;
  copy.height = RENDER_SIZE;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return {
    color: [...ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data],
    depth: [...(await depth.readFloats())],
  };
}

/** The `pulled` frame: vertex pulling, the way a host's renderer draws a mesh it keeps in storage.
 *  The vertex entry reads its positions from a storage `Resident` by `vertex_index`; the triangle
 *  is indexed with a `Uint16Array` of three (six bytes, which the runtime pads), and the
 *  rectangle with the host's own `GPUBuffer` of `uint32` indices. */
const pulledFrame: CaseFrame = async (rt, programs, sceneCompare) => {
  const pulled = await rt.load(programs.pulled).render({
    targets: [COLOR],
    depth: { format: DEPTH, compare: sceneCompare },
  });
  const color = rt.texture({ size: [RENDER_SIZE, RENDER_SIZE], format: COLOR });
  const depth = rt.texture({ size: [RENDER_SIZE, RENDER_SIZE], format: DEPTH });
  const verts = resident(new Float32Array([...positions(Q), ...positions(T)]));
  const quadIndices = hostBuffer(rt, new Uint32Array([0, 1, 2, 0, 2, 3]), 'index');
  const f = rt.frame();
  f.pass(
    { color: [{ target: color, clear: [0, 0, 0, 1] }], depth: { target: depth, clear: 0 } },
    (p) => {
      p.draw(
        pulled,
        { verts, tint: { color: T.tint } },
        { indices: new Uint16Array([6, 5, 4]), count: 3 },
      );
      p.draw(
        pulled,
        { verts, tint: { color: Q.tint } },
        { indices: { buffer: quadIndices, format: 'uint32' }, count: 6 },
      );
    },
  );
  await f.submit();
  return readBack(color, depth);
};

/** The render case's frames, each read back, or the error that stopped it: a frame that cannot
 *  be drawn is a verdict of the gate, not a crash of the page. */
async function renderFrames(
  programs: Programs,
  sceneCompare: string,
  tier: 'webgpu' | 'webgl2',
): Promise<Record<FrameName, Readback>> {
  const attempt = async (frame: CaseFrame): Promise<Readback> => {
    try {
      const rt = await (tier === 'webgpu'
        ? (programRuntime ??= createRuntime())
        : (glRuntime ??= createRuntime({ prefer: ['webgl2'] })));
      if (rt.tier !== tier) throw new Error(`the runtime runs on ${rt.tier}, not ${tier}`);
      return await frame(rt, programs, sceneCompare);
    } catch (e) {
      return { error: message(e) };
    }
  };
  return { passes: await attempt(passesFrame), pulled: await attempt(pulledFrame) };
}

async function verdictOf(c: EntryCase): Promise<EntryVerdict> {
  const base = { id: c.id, kind: c.kind, name: c.name };
  if (c.kind === 'compute') {
    let want: number[];
    let changed: number;
    try {
      const run = await computeOn(c, 'webgpu');
      want = run.after;
      changed = run.after.filter((v, i) => !Object.is(v, run.before[i])).length;
    } catch (e) {
      return { ...base, error: `webgpu: ${message(e)}`, tiers: [] };
    }
    const tiers: TierVerdict[] = [];
    try {
      const got = await computeOnProgram(c);
      tiers.push({ tier: 'program', worst: worstOf(want, got), values: want.length });
    } catch (e) {
      tiers.push({ tier: 'program', error: message(e) });
    }
    // The program runtime of the WebGL2 tier runs the pass program the manifest carries.
    const glProgram = c.manifest.gl?.computes?.[c.name];
    if (glProgram !== undefined && 'none' in glProgram)
      tiers.push({ tier: 'program webgl2', skipped: glProgram.none });
    else
      try {
        const got = await computeOnProgramGl(c);
        tiers.push({ tier: 'program webgl2', worst: worstOf(want, got), values: want.length });
      } catch (e) {
        tiers.push({ tier: 'program webgl2', error: message(e) });
      }
    // WebGL2 runs the entry as the pass program of change 0054.
    if (c.noGl !== undefined) tiers.push({ tier: 'webgl2', skipped: c.noGl });
    else
      try {
        const got = (await computeOn(c, 'webgl2')).after;
        tiers.push({ tier: 'webgl2', worst: worstOf(want, got), values: want.length });
      } catch (e) {
        tiers.push({ tier: 'webgl2', error: message(e) });
      }
    if (c.noCpu !== undefined)
      return { ...base, changed, tiers: [...tiers, { tier: 'cpu', skipped: c.noCpu }] };
    try {
      const got = (await computeOn(c, 'cpu')).after;
      tiers.push({ tier: 'cpu', worst: worstOf(want, got), values: want.length });
    } catch (e) {
      tiers.push({ tier: 'cpu', error: message(e) });
    }
    return { ...base, changed, tiers };
  }
  let want: number[];
  try {
    want = await drawOn(c);
  } catch (e) {
    return { ...base, error: `webgpu: ${message(e)}`, tiers: [] };
  }
  const colours = new Set<number>();
  for (let i = 0; i < want.length; i += 4)
    colours.add((want[i]! << 16) | (want[i + 1]! << 8) | want[i + 2]!);
  const tiers: TierVerdict[] = [];
  for (const [tier, kind, no] of [
    ['webgl2', 'webgl2', c.noGl],
    ['cpu', '2d', c.noCpu],
  ] as const) {
    if (no !== undefined) {
      tiers.push({ tier, skipped: no });
      continue;
    }
    try {
      const got = await drawOn(c, kind);
      // In 8-bit steps: a channel's difference out of 255.
      const worst = Math.max(...want.map((w, i) => Math.abs(w - (got[i] ?? NaN))));
      tiers.push({ tier, worst, values: want.length });
    } catch (e) {
      tiers.push({ tier, error: message(e) });
    }
  }
  return { ...base, changed: colours.size, tiers };
}

/** Call every entry on every tier it has, and compare each with WebGPU; then draw the render
 *  case's frames from `programs`, its manifests. */
export async function runEntries(
  cases: readonly EntryCase[],
  programs: Programs,
): Promise<EntryReport> {
  // The instrument, FIRST: a comparison that cannot see one changed value is blind.
  const probe = [0.5, -1, 2, 3];
  const perturbedReported = worstOf(probe, [0.5, -1, 2.01, 3]) > 0;
  const verdicts: EntryVerdict[] = [];
  for (const c of cases) verdicts.push(await verdictOf(c));
  // The render case: right, and with a depth test the scene does not want ('less' where a
  // reversed projection needs 'greater'), which the gate must see differ.
  const render = {
    right: await renderFrames(programs, 'greater', 'webgpu'),
    wrong: await renderFrames(programs, 'less', 'webgpu'),
  };
  // The same frames on a runtime of the WebGL2 tier (change 0054), held to the same pictures.
  const glRender = {
    right: await renderFrames(programs, 'greater', 'webgl2'),
    wrong: await renderFrames(programs, 'less', 'webgl2'),
  };
  // And into a canvas: a runtime on the canvas's own WebGL2 context, its frame turned over onto
  // the screen, and its load the screen turned back.
  let glCanvas: Readback;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = RENDER_SIZE;
    canvas.height = RENDER_SIZE;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (gl === null) throw new Error('the canvas gave no WebGL2 context');
    glCanvas = await passes(await createRuntime({ device: gl }), programs, 'greater', canvas);
  } catch (e) {
    glCanvas = { error: message(e) };
  }
  return { perturbedReported, verdicts, render, glRender, glCanvas };
}
