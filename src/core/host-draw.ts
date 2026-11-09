// ═══ A fragment entry drawn from host code (Rule 8.24, surface §67) ═══
//
// `entry(target, bindings)` on a `@fragment` entry a host file imported (change 0016). The entry
// reads no builtin but its pixel's `position` and `front_facing`, and writes one `@location(0)`
// colour, so one full-screen triangle the runtime supplies draws it over the whole canvas. The
// Vite plugin writes everything the draw needs into the generated module at build time, as a
// `FragmentEntry` literal: the module's WGSL, the GLSL ES 3.00 fragment program where the WebGL2
// tier can draw it, and each binding the entry reaches, with its layout.
// With no host-supplied binding, `entry(target)` supplies the empty object (change 0125).
//
// Three tiers, and a canvas keeps the first one that draws into it, since a canvas keeps the
// first kind of context it hands out:
//
//   1. WebGPU, with the canvas's `webgpu` context.
//   2. WebGL2, with the entry's GLSL fragment program and the runtime's full-screen vertex
//      program. GLSL's `gl_FragCoord` counts rows from the bottom and WGSL's `position` from the
//      top, so the frame is drawn into a framebuffer and copied to the canvas upside down: the
//      first row the program draws is the canvas's top row, as it is on WebGPU.
//   3. The CPU tier: the generated code (Rule 11.7), pixel by pixel, into an `ImageData` put on
//      the canvas's `2d` context.
//
// The frame is opaque on every tier: the colour's alpha is written but not composited, so the
// three tiers show the same pixels. A draw reads nothing back (`docs/dx.md` principle 4): the
// promise resolves when the frame is submitted, and a frame loop may drop it.
//
// A storage array with no size may be a `Resident` (Rule 11.8). A draw that reads one runs in the
// call queue of `core/resident.ts`, so it sees what the kernel and entry calls made before it
// wrote; WebGPU binds the handle's device buffer, and the CPU tier reads its copy. A scratch
// array of a `fuse` scope (change 0058) is no binding for a draw: the call is refused, and the
// refusal names the array as scratch.

import type { CpuValue } from './cpu-runtime.js';
import type { ConsoleLog } from './console.js';
import {
  ADDRESS,
  checkBindings,
  consoleFor,
  describe,
  flavored,
  gpuHandle,
  isBuffer,
  isGuard,
  packed,
  toCpu,
  type Checked,
  type DrawBinding,
  type GeneratedCpu,
  type GpuDevice,
  type Layout,
} from './host-entry.js';
import { packLayout } from './manifest-types.js';
import { fuseSlot } from './fuse-scope.js';
import { checkIncoming, type IncomingReads } from './host-failure.js';
import { defaultOwner, inferOwner, ownerOf, resourceOwner, type CallOwner } from './owner.js';
import { TIERS, type Tier } from './tiers.js';
import { kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import {
  STAGE as RHI_STAGE,
  type RhiBindEntry,
  type RhiBindGroupLayout,
  type RhiBindLayoutEntry,
  type RhiBindResource,
  type RhiBuffer,
  type RhiCanvas,
  type RhiDevice,
  type RhiRenderPipeline,
  type RhiShaderModule,
  type RhiTexture,
} from '../rhi/rhi.js';
import type { CpuCode, CpuIoField, CpuProgram } from '../rhi/cpu-program.js';
import { GL_IMAGE, uploadImage, type GlImage } from './gl-image.js';
import { webgpuDevice } from '../rhi/webgpu.js';
import { webgl2Device } from '../rhi/webgl2.js';
import { cpuDevice } from '../rhi/cpu.js';

// ─── what the generated module carries ───────────────────────────────────────────────────────

/** A full-screen `@fragment` entry a host can draw, as the generated module writes it. */
export interface FragmentEntry {
  readonly name: string;
  readonly fn: string;
  /** The entry's name in the WGSL, when it differs from `fn` (Proposal 0070). */
  readonly entryPoint?: string;
  readonly wgsl: string;
  /** The module's WGSL under the `'integer'` flavor of the emulated double, present when the
   *  module emulates `f64` (change 0073): a draw under that flavor dispatches it, with no guard. */
  readonly wgslInteger?: string;
  /** Each parameter's builtin, in order: `position` or `front_facing`. */
  readonly params: readonly string[];
  /** The struct field that holds the `@location(0)` colour, or null for a bare `vec4`. */
  readonly out: string | null;
  readonly bindings: readonly DrawBinding[];
  /** What the WebGL2 tier draws with; absent when it cannot draw the entry. */
  readonly gl?: {
    /** The GLSL ES 3.00 fragment program. */
    readonly frag: string;
    /** Each uniform binding's block name. */
    readonly blocks: Readonly<Record<string, string>>;
    /** Each texture binding's sampler binding, or null when it is only loaded. */
    readonly samplers: Readonly<Record<string, string | null>>;
  };
  /** Why the WebGL2 tier cannot draw the entry, when it cannot. */
  readonly noGl?: string;
  /** Why the CPU tier cannot draw the entry, when it cannot. */
  readonly noCpu?: string; /** As a compute entry's: whether the WGSL records `console.*` calls, and the log. */
  readonly console?: true;
  readonly log?: ConsoleLog;
}

// ─── checking the arguments ──────────────────────────────────────────────────────────────────

/** One draw's arguments, checked and copied at the call, so a value the host changes before the
 *  queued draw runs does not change the frame. */
interface Frame extends Checked {
  readonly owner: CallOwner;
  /** Each buffer binding's packed bytes. */
  readonly bytes: Map<string, ArrayBuffer>;
  /** Each buffer binding's CPU-tier value, when the entry has a CPU tier. */
  readonly cpu: Map<string, CpuValue>;
  /** Each binding passed as a `Resident` (Rule 11.8): read when the draw runs, after the calls
   *  made before it, not copied at the call. */
  readonly residents: Map<string, ResidentArrayState>;
}

function frameOf(e: FragmentEntry, v: unknown): Frame {
  // A `Resident` stands for the array it holds.
  const residents = new Map<string, ResidentArrayState>();
  let view = v;
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
    for (const b of e.bindings) {
      const s = residentState(o[b.name]);
      if (s === undefined) continue;
      if (s.destroyed)
        throw new TypeError('This Resident was destroyed; make a new one with resident().');
      if (!isBuffer(b) || b.space !== 'storage' || b.layout.k !== 'a' || b.layout.n !== null)
        throw new TypeError(
          `${e.name}(): binding "${b.name}" (${b.s}) takes no Resident: only a storage array with no size does.`,
        );
      // A scratch array of a `fuse` scope is for the kernel calls in the body of that scope
      // (change 0058). It holds no host array, so the check of the value below would name
      // "undefined": the handle says what it is.
      const refusal = s.outside?.(`${e.name}(): binding "${b.name}"`);
      if (refusal !== undefined) throw refusal;
      residents.set(b.name, s);
      o[b.name] = s.view();
    }
    view = o;
  }
  const checked = checkBindings(e, view, new Set(residents.keys()));
  const owner = inferOwner(
    `${e.name}()`,
    e.bindings.map((b) => [
      `binding "${b.name}"`,
      residents.has(b.name)
        ? ownerOf(residents.get(b.name)!)
        : resourceOwner(checked.values[b.name]),
    ]),
  );
  const frame: Frame = { ...checked, bytes: new Map(), cpu: new Map(), residents, owner };
  for (const b of e.bindings) {
    if (!isBuffer(b) || residents.has(b.name)) continue;
    frame.bytes.set(b.name, packed(b, checked.values[b.name]));
    if (e.noCpu === undefined)
      frame.cpu.set(b.name, toCpu(b.layout, checked.values[b.name], false));
  }
  return frame;
}

/** Bring each resident binding up to date for a tier that reads the host's copy. */
async function hostResidents(e: FragmentEntry, f: Frame): Promise<void> {
  for (const b of e.bindings) {
    const s = f.residents.get(b.name);
    if (s === undefined || !isBuffer(b)) continue;
    await s.sync();
    f.bytes.set(b.name, packed(b, s.host));
    if (e.noCpu === undefined) f.cpu.set(b.name, toCpu(b.layout, s.host, false));
  }
}

// ─── the canvas ──────────────────────────────────────────────────────────────────────────────

/** The part of `HTMLCanvasElement` and `OffscreenCanvas` a draw uses. */
interface Canvas {
  width: number;
  height: number;
  getContext(kind: string, options?: object): unknown;
}

function isCanvas(v: unknown): v is Canvas {
  const g = globalThis as unknown as Record<string, (abstract new () => unknown) | undefined>;
  return ['HTMLCanvasElement', 'OffscreenCanvas'].some(
    (k) => g[k] !== undefined && v instanceof g[k],
  );
}

/** How one canvas draws, decided at its first draw. `prepare` builds what an entry needs on
 *  the tier (a pipeline, a program) once; `paint` draws and submits one frame synchronously, so
 *  the frame is submitted in the task that settles the draw's promise. */
interface Painter {
  readonly tier: Tier;
  /** Whether the tier binds a `Resident` as its device buffer, rather than the host's copy. */
  readonly onDevice?: true;
  /** The actual WebGPU device, for automatic fp64 selection. */
  readonly device?: object;
  prepare(e: FragmentEntry, cpu: GeneratedCpu): Promise<void>;
  /** Record and submit one frame. The CPU backend runs it in the submit, and returns the
   *  promise of that submit, which rejects when the entry's code throws. */
  paint(e: FragmentEntry, cpu: GeneratedCpu, f: Frame): Promise<void> | undefined;
}

interface CanvasState {
  /** Each draw runs after the one before it, so draws made before the device exists run in
   *  order once it does. */
  chain: Promise<unknown>;
  painter?: Promise<Painter>;
  owner?: CallOwner;
  tier?: Tier;
}

const canvases = new WeakMap<object, CanvasState>();

/**
 * Draw one frame of a full-screen `@fragment` entry into `target` (Rule 8.24): on WebGPU where
 * there is one, then WebGL2, then the CPU tier. The first draw into a canvas decides its tier.
 *
 * The promise resolves when the frame is submitted; nothing is read back.
 *
 * @throws `TypeError` naming the entry and the binding for a value that does not fit, and for an
 *   entry no tier can draw into this canvas, and for a call made inside the body of `fuse()`,
 *   which records no draw (change 0058), and for a scratch array of a `fuse` scope, which only
 *   the kernel calls in the body take.
 */
export function callDraw(
  cpu: GeneratedCpu,
  e: FragmentEntry,
  argc: number,
  target: unknown,
  bindings: unknown,
  reads?: IncomingReads,
): Promise<void> {
  fuseSlot.active?.refuse(`${e.name}()`, 'a draw');
  try {
    const empty = e.bindings.every(isGuard);
    if (argc !== 2 && !(empty && argc === 1))
      throw new TypeError(
        empty
          ? `${e.name}() takes 1 or 2 arguments, (target, bindings?); got ${argc}.`
          : `${e.name}() takes 2 arguments, (target, bindings); got ${argc}.`,
      );
    if (!isCanvas(target))
      throw new TypeError(
        `${e.name}(): "target" is an HTMLCanvasElement or an OffscreenCanvas; got ${describe(target)}.`,
      );
    const frame = frameOf(e, empty && bindings === undefined ? {} : bindings);
    let state = canvases.get(target);
    if (state === undefined) canvases.set(target, (state = { chain: Promise.resolve() }));
    const s = state;
    const before = s.chain;
    const draw = (): Promise<void> =>
      before.then(async () => {
        checkIncoming(
          e.bindings.flatMap((b) => {
            const state = frame.residents.get(b.name);
            return state !== undefined && (reads === undefined || reads.includes(b.name))
              ? [state]
              : [];
          }),
        );
        // A context can be configured for another GPU. Do not reuse the previous owner's painter.
        if (s.painter === undefined || s.owner !== frame.owner) {
          s.owner = frame.owner;
          s.painter = painterFor(target, e, frame.owner, s.tier);
        }
        const painter = await s.painter;
        s.tier ??= painter.tier;
        // On WebGPU the draw runs its inferred owner's flavor of the emulated double
        // (change 0073); the WebGL2 program and the CPU tier have one text each.
        const de =
          painter.onDevice === true ? flavored(e, frame.owner.fp64Flavor(painter.device)) : e;
        await painter.prepare(de, cpu);
        if (painter.onDevice !== true) await hostResidents(e, frame);
        await painter.paint(de, cpu, frame);
      });
    // A draw with an owned resource takes its place among the kernel and entry calls, so it sees
    // what the calls made before it wrote, and no call made after it writes first.
    const run =
      frame.residents.size > 0 || frame.owner !== defaultOwner ? kernelQueue.run(draw) : draw();
    // A failed draw does not stop the draws after it.
    s.chain = run.catch(() => undefined);
    return run;
  } catch (err) {
    return Promise.reject(err);
  }
}

/** The canvas's tier: the first of WebGPU, WebGL2 and the CPU that can draw `first`, the entry
 *  that draws into the canvas first. */
async function painterFor(
  canvas: Canvas,
  first: FragmentEntry,
  owner: CallOwner,
  fixedTier?: Tier,
): Promise<Painter> {
  // Preserve the default draw's fixed fallback order; a device-owned draw takes its own policy.
  const tiers = owner === defaultOwner ? TIERS : owner.tiers();
  if (fixedTier !== undefined && !tiers.includes(fixedTier))
    throw new TypeError(
      `${first.name}(): this canvas draws on ${fixedTier}, which ${owner.label} does not allow.`,
    );
  const allows = (tier: Tier): boolean =>
    tiers.includes(tier) && (fixedTier === undefined || fixedTier === tier);
  const d = allows('webgpu') ? await owner.device() : null;
  if (d !== null) {
    const ctx = canvas.getContext('webgpu') as GpuCanvasContext | null;
    if (ctx !== null) return webgpuPainter(d, ctx);
  }
  if (allows('webgl2') && first.gl !== undefined) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    }) as object | null;
    if (gl !== null) return webgl2Painter(gl);
  }
  if (allows('cpu') && first.noCpu === undefined) {
    const c2d = canvas.getContext('2d', { alpha: false }) as Ctx2d | null;
    if (c2d !== null) return cpuPainter(c2d, canvas);
  }
  const why = [
    d === null ? 'there is no WebGPU' : 'the canvas hands out no webgpu context',
    first.gl === undefined ? `no WebGL2 tier (${first.noGl ?? 'unknown'})` : 'no webgl2 context',
    first.noCpu === undefined ? 'no 2d context' : `no CPU tier (${first.noCpu})`,
  ];
  throw new TypeError(`${first.name}(): nothing can draw it into this canvas: ${why.join('; ')}.`);
}

/** Why `e` cannot draw on a tier, as a `TypeError` naming the tiers it has. */
function noTier(e: FragmentEntry, tier: string, why: string | undefined): TypeError {
  return new TypeError(
    `${e.name}(): this canvas draws on ${tier}, and ${e.name} has no ${tier} tier: ${why ?? 'unknown'}.`,
  );
}

// ─── the draw, on the render hardware interface (change 0120, D2) ────────────────────────────

/** The full-screen triangle: three vertices, counter-clockwise, covering clip space. */
const FULLSCREEN_WGSL = `@vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The same triangle as a GLSL ES 3.00 vertex program, in WebGPU's clip space: the WebGL2 backend
 *  turns its position to GL's (`toGlClip`), so its depth is the near plane and `gl_FragCoord.z` is
 *  0, as WGSL's `position.z` is on WebGPU. */
const FULLSCREEN_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The same triangle as a CPU program, for the CPU backend. */
const FULLSCREEN_CPU: CpuProgram = {
  code: {
    F: {
      v: (i: number): readonly number[] => [((i << 1) & 2) * 2 - 1, (i & 2) * 2 - 1, 0, 1],
    } as unknown as CpuCode['F'],
    $: { bindings: {}, vars: {} },
  },
  entries: {
    v: {
      fn: 'v',
      stage: 'vertex',
      params: [{ kind: 'field', field: { name: 'i', builtin: 'vertex_index' } }],
      out: { kind: 'field', field: { name: 'position', builtin: 'position', width: 4 } },
    },
  },
  bindings: [],
  workgroupZero: {},
};

/** The CPU program of a full-screen fragment entry: the module's generated code, the entry's
 *  builtins and its `@location(0)` colour, and each buffer binding's layout, by which the CPU
 *  backend reads the bytes it is bound as the value `toCpu` makes. One for each entry and code. */
const cpuPrograms = new WeakMap<FragmentEntry, CpuProgram>();
function cpuProgramOf(e: FragmentEntry, cpu: GeneratedCpu): CpuProgram {
  let p = cpuPrograms.get(e);
  if (p === undefined) {
    const colour: CpuIoField = { name: e.out ?? 'colour', location: 0, width: 4 };
    p = {
      code: cpu as unknown as CpuCode,
      entries: {
        [e.fn]: {
          fn: e.fn,
          stage: 'fragment',
          params: e.params.map((builtin) => ({
            kind: 'field' as const,
            field: { name: builtin, builtin },
          })),
          out:
            e.out === null
              ? { kind: 'field', field: colour }
              : { kind: 'struct', fields: [colour] },
        },
      },
      bindings: e.bindings.filter(isBuffer).map((b) => ({
        name: b.name,
        group: b.group,
        binding: b.binding,
        layout: packLayout(b.layout),
        kind: b.space,
      })),
      workgroupZero: {},
    };
    cpuPrograms.set(e, p);
  }
  return p;
}

/** The element type of a storage buffer's words, which the WebGL2 backend's data texture holds. */
function elemOf(l: Layout): 'f32' | 'i32' | 'u32' {
  while (l.k === 'a') l = l.e;
  const t = l.k === 's' || l.k === 'v' ? l.t : 'f32';
  return t === 'i32' || t === 'u32' ? t : 'f32';
}

/** The bind group layouts of an entry's bindings, by group index, every group up to the last,
 *  written out rather than `'auto'` (see `pipelineLayout` in `host-entry.ts`). On WebGL2 an entry
 *  carries what its program binds by name: each uniform's block, each texture's sampler uniform
 *  and the sampler binding GLSL ES 3.00 fuses with it. The CPU backend binds buffers only. */
function layoutsOf(rhi: RhiDevice, e: FragmentEntry): RhiBindGroupLayout[] {
  const groups = new Map<number, RhiBindLayoutEntry[]>();
  const add = (g: number, entry: RhiBindLayoutEntry): void => {
    let list = groups.get(g);
    if (list === undefined) groups.set(g, (list = []));
    list.push(entry);
  };
  const gl = rhi.backend === 'webgl2' ? e.gl : undefined;
  const bindingOf = (name: string | null | undefined): number | undefined =>
    name === null || name === undefined
      ? undefined
      : e.bindings.find((b) => b.name === name)?.binding;
  for (const b of e.bindings) {
    if (rhi.backend === 'cpu' && !isBuffer(b)) continue;
    const at = { binding: b.binding, visibility: RHI_STAGE.fragment, label: b.name };
    if (b.space === 'texture') {
      const sampler = bindingOf(gl?.samplers[b.name]);
      add(b.group, {
        ...at,
        name: b.glsl ?? b.name,
        ...(sampler !== undefined ? { samplerBinding: sampler } : {}),
        texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
      });
    } else if (b.space === 'storage-texture')
      add(b.group, {
        ...at,
        storageTexture: {
          access: b.storage!.access,
          format: b.storage!.format,
          viewDimension: '2d',
        },
      });
    else if (b.space === 'sampler') add(b.group, { ...at, sampler: { type: 'filtering' } });
    else if (b.space === 'uniform')
      add(b.group, { ...at, name: gl?.blocks[b.name] ?? b.name, buffer: { type: 'uniform' } });
    else
      add(b.group, {
        ...at,
        name: b.glsl ?? b.name,
        buffer: { type: 'rw' in b && b.rw ? 'storage' : 'read-only-storage' },
      });
  }
  if (e.log !== undefined && rhi.backend === 'webgpu')
    add(e.log.group, {
      binding: e.log.binding,
      visibility: RHI_STAGE.fragment,
      buffer: { type: 'storage' },
    });
  const last = Math.max(-1, ...groups.keys());
  return Array.from({ length: last + 1 }, (_, g) => rhi.createBindGroupLayout(groups.get(g) ?? []));
}

/** What an entry draws with on one device: its pipeline and its bind group layouts. */
interface Prepared {
  readonly pipeline: RhiRenderPipeline;
  readonly layouts: readonly RhiBindGroupLayout[];
}

const prepared = new WeakMap<RhiDevice, Map<FragmentEntry, Promise<Prepared>>>();

/** The part of a WebGPU shader module that reports how its WGSL compiled. */
interface CompilationInfo {
  getCompilationInfo?(): Promise<{
    messages: readonly { type: string; lineNum: number; linePos: number; message: string }[];
  }>;
}

async function prepareOn(
  rhi: RhiDevice,
  e: FragmentEntry,
  cpu: GeneratedCpu,
  format: string,
): Promise<Prepared> {
  let fragment: RhiShaderModule;
  let vertex: RhiShaderModule;
  if (rhi.backend === 'webgpu') {
    fragment = rhi.createShaderModule(e.wgsl);
    const info = rhi.toNative(fragment) as CompilationInfo;
    const errors = ((await info.getCompilationInfo?.())?.messages ?? []).filter(
      (m) => m.type === 'error',
    );
    if (errors.length > 0)
      throw new Error(
        `${e.name}: WebGPU refused the module's WGSL: ${errors.map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
      );
    vertex = rhi.createShaderModule(FULLSCREEN_WGSL);
  } else if (rhi.backend === 'webgl2') {
    fragment = rhi.createShaderModule(e.gl!.frag);
    vertex = rhi.createShaderModule(FULLSCREEN_GLSL);
  } else {
    fragment = rhi.createShaderModule(cpuProgramOf(e, cpu));
    vertex = rhi.createShaderModule(FULLSCREEN_CPU);
  }
  const layouts = layoutsOf(rhi, e);
  const pipeline = await rhi.createRenderPipeline({
    label: `the draw of ${e.name}`,
    layouts,
    module: vertex,
    vertex: { entryPoint: 'v', buffers: [] },
    fragment: {
      module: fragment,
      entryPoint: e.entryPoint ?? e.fn,
      // The frame is opaque on every tier. WebGPU's canvas (`alphaMode: 'opaque'`) and the WebGL2
      // context (`alpha: false`) drop the colour's alpha; the CPU backend's `putImageData` would
      // not, so its pipeline writes red, green and blue, and the clear's alpha of 1 stays.
      targets: [{ format, ...(rhi.backend === 'cpu' ? { writeMask: 0x7 } : {}) }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    multisample: { count: 1, mask: 0xffffffff },
  });
  return { pipeline, layouts };
}

/** One opaque white texel: the `_fp64` guard's 1.0. */
const WHITE = new Uint8Array([255, 255, 255, 255]);

/**
 * The painter of one canvas on one RHI device: WebGPU over the owner's `GPUDevice`, WebGL2 over
 * the canvas's own context, or the CPU backend over its `2d` context. Every tier records the same
 * commands: a pipeline of the full-screen triangle and the entry, a bind group of each group, one
 * render pass into the canvas's texture that clears to opaque black, and one draw of 3 vertices.
 */
function rhiPainter(
  rhi: RhiDevice,
  target: RhiCanvas,
  tier: Tier,
  format: string,
  noTierWhy: (e: FragmentEntry) => string | undefined,
  tierName: string,
): Painter {
  const ready = new Map<FragmentEntry, Prepared>();
  let per = prepared.get(rhi);
  if (per === undefined) prepared.set(rhi, (per = new Map()));
  const cache = per;
  const prepare = async (e: FragmentEntry, cpu: GeneratedCpu): Promise<void> => {
    if (noTierWhy(e) !== undefined) throw noTier(e, tierName, noTierWhy(e));
    if (ready.has(e)) return;
    let p = cache.get(e);
    if (p === undefined) {
      p = prepareOn(rhi, e, cpu, format);
      cache.set(e, p);
      // A pipeline that failed is made again at the next draw.
      p.catch(() => cache.delete(e));
    }
    ready.set(e, await p);
  };
  const paint: Painter['paint'] = (e, _cpu, f) => {
    const { pipeline, layouts } = ready.get(e)!;
    const gpu = rhi.backend === 'webgpu' ? (rhi.native as unknown as GpuDevice) : undefined;
    const buffers: RhiBuffer[] = [];
    const textures: RhiTexture[] = [];
    const glTextures: object[] = [];
    const owned: { destroy(): void }[] = [];
    const resourceOf = (b: DrawBinding): RhiBindResource => {
      const resident = f.residents.get(b.name);
      if (resident !== undefined && isBuffer(b) && gpu !== undefined) {
        // On WebGPU a `Resident` is bound as its device buffer, which the RHI's WebGPU handle is.
        const buffer = resident.bufferFor(gpu, b.layout, () => packed(b, resident.host), false);
        return { buffer: rhi.fromNative('buffer', buffer as object)! };
      }
      if (isBuffer(b)) {
        const bytes = f.bytes.get(b.name)!;
        const buffer = rhi.createBuffer({
          size: bytes.byteLength,
          usage: [b.space, 'copy-dst'],
          ...(b.space === 'storage' ? { elem: elemOf(b.layout) } : {}),
        });
        rhi.writeBuffer(buffer, 0, bytes);
        buffers.push(buffer);
        return { buffer };
      }
      // WebGPU uploads an image, and makes a sampler, as a compute entry's call does.
      if (gpu !== undefined)
        return {
          native: gpuHandle(
            gpu as unknown as Parameters<typeof gpuHandle>[0],
            b,
            f,
            owned,
          ) as object,
        };
      if (isGuard(b)) {
        // The `_fp64` guard: one texel of 1.0, which the emulation multiplies by.
        const texture = rhi.createTexture({
          size: [1, 1, 1],
          format: 'rgba8unorm',
          usage: ['sampled', 'copy-dst'],
        });
        rhi.writeTexture(texture, WHITE, 4, 1, 1);
        textures.push(texture);
        return { view: rhi.createView(texture) };
      }
      if (b.space === 'sampler') {
        const s = f.samplers.get(b.name) ?? { filter: 'linear', address: 'clamp' };
        return {
          sampler: rhi.createSampler({
            magFilter: s.filter,
            minFilter: s.filter,
            mipmapFilter: 'nearest',
            addressModeU: ADDRESS[s.address],
            addressModeV: ADDRESS[s.address],
            addressModeW: ADDRESS[s.address],
          }),
        };
      }
      const img = f.images.get(b.name)!;
      if (img.view !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${b.name}" is a Texture on the WebGPU device, which the WebGL2 tier cannot read; pass an image source for a draw that may fall back.`,
        );
      // The RHI takes no image source yet: the image is uploaded to a texture of the context the
      // backend runs on, and bound as the host's own texture (Rule 11.17).
      const gl = rhi.native as unknown as GlImage;
      const tex = gl.createTexture()!;
      gl.activeTexture(GL_IMAGE.TEXTURE0);
      gl.bindTexture(GL_IMAGE.TEXTURE_2D, tex);
      uploadImage(gl, img.source, { filter: 'nearest', address: 'clamp' });
      gl.bindTexture(GL_IMAGE.TEXTURE_2D, null);
      glTextures.push(tex);
      return { native: tex };
    };
    const log = gpu !== undefined ? consoleFor(gpu, e.name, e.log) : undefined;
    const encoder = rhi.createCommandEncoder();
    let done: Promise<void>;
    try {
      const groups = new Map<number, RhiBindEntry[]>();
      for (const b of e.bindings) {
        if (rhi.backend === 'cpu' && !isBuffer(b)) continue;
        let list = groups.get(b.group);
        if (list === undefined) groups.set(b.group, (list = []));
        list.push({ binding: b.binding, resource: resourceOf(b) });
      }
      if (log !== undefined) {
        let list = groups.get(log.group);
        if (list === undefined) groups.set(log.group, (list = []));
        list.push({
          binding: log.entry.binding,
          resource: { buffer: rhi.fromNative('buffer', log.entry.resource.buffer as object)! },
        });
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: rhi.createView(rhi.currentTexture(target)),
            clearValue: [0, 0, 0, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      layouts.forEach((layout, g) =>
        pass.setBindGroup(g, rhi.createBindGroup(layout, groups.get(g) ?? [])),
      );
      pass.draw(3);
      pass.end();
      if (log !== undefined) log.copy(rhi.toNative(encoder) as Parameters<typeof log.copy>[0]);
      done = rhi.submit([encoder]);
    } finally {
      for (const b of buffers) rhi.destroyBuffer(b);
      for (const t of textures) rhi.destroyTexture(t);
      for (const o of owned) o.destroy();
      const gl = glTextures.length > 0 ? (rhi.native as unknown as GlImage) : undefined;
      for (const t of glTextures) gl!.deleteTexture(t);
    }
    // The frame is submitted; its console calls print when the GPU has run it, after the
    // promise resolved, since a draw reads nothing back.
    void log?.print();
    // The CPU backend ran the frame in the submit, and an error of its code rejects the draw. A
    // GPU's submit resolves when the GPU has run the frame, which a draw does not wait for.
    if (rhi.backend === 'cpu') return done;
    done.catch(() => undefined);
    return undefined;
  };
  return {
    tier,
    ...(rhi.backend === 'webgpu' ? { onDevice: true as const, device: rhi.native! } : {}),
    prepare,
    paint,
  };
}

/** The RHI device of each native device the call layer draws with, so the pipelines an entry
 *  makes on one device serve every canvas of that device. */
const rhis = new WeakMap<object, RhiDevice>();
function rhiOf(native: object, make: (n: never) => RhiDevice): RhiDevice {
  let r = rhis.get(native);
  if (r === undefined) rhis.set(native, (r = make(native as never)));
  return r;
}

/** The CPU backend the call layer draws on: one software device for every canvas. */
let cpuRhi: RhiDevice | undefined;

function webgpuPainter(d: object, ctx: GpuCanvasContext): Painter {
  const nav = (globalThis as { navigator?: { gpu?: { getPreferredCanvasFormat(): string } } })
    .navigator;
  const format = nav?.gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
  ctx.configure({ device: d, format, alphaMode: 'opaque' });
  const rhi = rhiOf(d, webgpuDevice);
  return rhiPainter(rhi, rhi.fromNative('canvas', ctx)!, 'webgpu', format, () => undefined, '');
}

function webgl2Painter(gl: object): Painter {
  const rhi = rhiOf(gl, webgl2Device);
  return rhiPainter(
    rhi,
    rhi.fromNative('canvas', gl)!,
    'webgl2',
    'rgba8unorm',
    (e) => (e.gl === undefined ? (e.noGl ?? 'unknown') : undefined),
    'WebGL2',
  );
}

/** The part of a `2d` context the CPU tier draws with. */
interface Ctx2d {
  createImageData(w: number, h: number): object;
  putImageData(img: object, x: number, y: number): void;
}

/** Each `2d` context as the CPU backend takes it: with the canvas it draws, at that canvas's size.
 *  One for each context, so the backend keeps one canvas handle for it. */
const contexts2d = new WeakMap<object, object>();

function cpuPainter(c2d: Ctx2d, canvas: Canvas): Painter {
  const rhi = (cpuRhi ??= cpuDevice());
  let context = contexts2d.get(c2d);
  if (context === undefined)
    contexts2d.set(
      c2d,
      (context = {
        canvas,
        createImageData: (w: number, h: number) => c2d.createImageData(w, h),
        putImageData: (img: object, x: number, y: number) => c2d.putImageData(img, x, y),
      }),
    );
  return rhiPainter(
    rhi,
    rhi.fromNative('canvas', context)!,
    'cpu',
    'rgba8unorm',
    (e) => e.noCpu,
    'the CPU',
  );
}

/** The part of a canvas's `webgpu` context the call layer configures. */
interface GpuCanvasContext {
  configure(c: { device: unknown; format: string; alphaMode: 'opaque' }): void;
}
