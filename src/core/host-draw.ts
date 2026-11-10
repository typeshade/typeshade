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
// Each tier draws through the program runtime (change 0120, D2): the entry and the full-screen
// triangle as a `Program` of a manifest made from the `FragmentEntry`, its render pipeline, and
// one pass into the canvas, on the tier's device of `src/rhi/`.
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

import type { ConsoleLog } from './console.js';
import {
  checkBindings,
  describe,
  flavored,
  gpuHandle,
  isBuffer,
  isGuard,
  packed,
  type Checked,
  type DrawBinding,
  type GeneratedCpu,
  type GpuDevice,
  type Layout,
  type Sampling,
} from './host-entry.js';
import {
  PACK_SCHEMA,
  packLayout,
  type Pack,
  type PackBinding,
  type PackConsole,
  type PackEntry,
  type PackLayout,
} from './manifest-types.js';
import { VERSION } from './version.js';
import { fuseSlot } from './fuse-scope.js';
import { checkIncoming, type IncomingReads } from './host-failure.js';
import { defaultOwner, inferOwner, ownerOf, resourceOwner, type CallOwner } from './owner.js';
import { TIERS, type Tier } from './tiers.js';
import { kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import type { RhiDevice, RhiTexture } from '../rhi/rhi.js';
import { CPU_PROGRAM, type CpuCode, type CpuIoField, type CpuProgram } from '../rhi/cpu-program.js';
import { GL_IMAGE, type GlImage } from './gl-image.js';
import { webgpuDevice } from '../rhi/webgpu.js';
import { cpuDevice } from '../rhi/cpu.js';
import { RuntimeImpl, type PassTargets, type RenderPass } from '../runtime/runtime.js';
import type { ProgramImpl, RenderPipeline } from '../runtime/program.js';
import type { Sampler } from '../runtime/resources.js';
import type { GlRuntimeImpl } from '../runtime/gl.js';

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
        throw new TypeError('This Resident was destroyed; make a new one with array().');
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
  const frame: Frame = { ...checked, bytes: new Map(), residents, owner };
  for (const b of e.bindings) {
    if (!isBuffer(b) || residents.has(b.name)) continue;
    frame.bytes.set(b.name, packed(b, checked.values[b.name]));
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

// ─── the draw, as a program-runtime pipeline and pass (change 0120, D2) ──────────────────────
//
// Each tier draws through the program runtime of `src/runtime/`: WebGPU and the CPU tier through
// `RuntimeImpl` over the RHI device of the tier, WebGL2 through `GlRuntimeImpl` over the canvas's
// context. A draw loads the entry's draw manifest (below) as a `Program`, takes its render
// pipeline of the full-screen triangle and the entry, and records one pass into the canvas that
// clears to opaque black and draws 3 vertices. The program, the pipeline and the bind group
// layouts are made once for each entry on each device; a draw whose shapes repeat takes its
// buffers from the runtime's pool and its bind groups from the runtime's cache.

/** The name of the full-screen vertex entry a draw manifest adds. A WGSL identifier may not start
 *  with two underscores, so it is spelled in full; no emitted name of a module takes it. */
const VERTEX = 'typeshade_fullscreen_vertex';

/** The full-screen triangle: three vertices, counter-clockwise, covering clip space. */
const FULLSCREEN_WGSL = `@vertex fn ${VERTEX}(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
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

/** The same triangle as a function of the CPU program. */
const fullscreenCpu = (i: number): readonly number[] => [
  ((i << 1) & 2) * 2 - 1,
  (i & 2) * 2 - 1,
  0,
  1,
];

/** The tier a draw manifest is made for: each binds a little differently. One of `TIERS`
 *  (`./tiers.ts`), so the names are written there only. */
type DrawTier = Tier;

/** A buffer binding's layout in a draw manifest: its packed bytes as 32-bit words. The call layer
 *  checks and packs each value at the call (`frameOf`), so a value the host changes before the
 *  queued draw runs does not change the frame; the program binds those bytes as they are. The CPU
 *  program decodes them with the binding's own layout. */
export const WORDS: PackLayout = {
  kind: 'array',
  length: null,
  stride: 4,
  element: { kind: 'scalar', type: 'u32' },
};

/** The format of a storage binding's data texture on WebGL2, by its element type. */
const DATA_FORMAT = { f32: 'r32float', i32: 'r32sint', u32: 'r32uint' } as const;

/** The element type of a storage buffer's words, which the WebGL2 backend's data texture holds. */
export function elemOf(l: Layout): 'f32' | 'i32' | 'u32' {
  while (l.k === 'a') l = l.e;
  const t = l.k === 's' || l.k === 'v' ? l.t : 'f32';
  return t === 'i32' || t === 'u32' ? t : 'f32';
}

/** The names the program runtime gives the bindings it supplies itself: the `_fp64` guard and the
 *  `_console` buffer. */
const SUPPLIED = new Set(['_fp64', '_console']);

/** The name a draw manifest gives a binding, by which the draw binds it: its own, except an
 *  authored binding that takes a name the program runtime supplies, which is renamed so that the
 *  runtime binds the author's value (change 0125's `_fp64` and `_console` uniforms). */
export const slotOf = (b: DrawBinding): string =>
  !isGuard(b) && SUPPLIED.has(b.name) ? `${b.name}$authored` : b.name;

/** A binding of an entry, as a draw manifest writes it, or an entry call's manifest for `stage`
 *  (`core/host-entry-program.ts`), under the name `name`. */
export function packBindingOf(
  b: DrawBinding,
  stage: 'fragment' | 'compute' = 'fragment',
  name = slotOf(b),
): PackBinding {
  const at = {
    name,
    emitted: b.name,
    ...(b.glsl !== undefined ? { emittedGlsl: b.glsl } : {}),
    group: b.group,
    binding: b.binding,
    type: b.s,
    stages: [stage],
  };
  if (isBuffer(b))
    return b.space === 'uniform'
      ? { ...at, space: 'uniform', resource: { resourceKind: 'uniform-buffer' }, layout: WORDS }
      : {
          ...at,
          space: 'storage',
          access: b.rw === true ? 'read_write' : 'read',
          resource: { resourceKind: 'storage-buffer' },
          layout: WORDS,
          dataTexture: { format: DATA_FORMAT[elemOf(b.layout)], lanes: 1 },
        };
  if (b.space === 'sampler')
    return { ...at, space: 'handle', resource: { resourceKind: 'sampler' } };
  if (b.space === 'storage-texture')
    return {
      ...at,
      space: 'handle',
      resource: {
        resourceKind: 'storage-texture',
        storageFormat: b.storage!.format,
        storageAccess: b.storage!.access,
        textureDim: '2d',
      },
    };
  return {
    ...at,
    space: 'handle',
    resource: { resourceKind: 'texture', textureDim: '2d', sampleType: 'float' },
    ...(isGuard(b) ? { injected: true as const } : {}),
  };
}

/** The CPU program of a draw: the module's generated code with the full-screen triangle beside
 *  it, the entry's builtins and its `@location(0)` colour, and each buffer binding's own layout,
 *  by which the CPU backend reads the bytes it is bound as the value `toCpu` makes. */
function drawCpuProgram(e: FragmentEntry, cpu: GeneratedCpu): CpuProgram {
  const colour: CpuIoField = { name: e.out ?? 'colour', location: 0, width: 4 };
  const code = cpu as unknown as CpuCode;
  return {
    // The module's functions call each other through `$.F`, which stays the module's own; the
    // table here only adds the triangle.
    code: { F: { ...code.F, [VERTEX]: fullscreenCpu } as CpuCode['F'], $: code.$ },
    entries: {
      [VERTEX]: {
        fn: VERTEX,
        stage: 'vertex',
        params: [{ kind: 'field', field: { name: 'i', builtin: 'vertex_index' } }],
        out: { kind: 'field', field: { name: 'position', builtin: 'position', width: 4 } },
      },
      [e.entryPoint ?? e.fn]: {
        fn: e.fn,
        stage: 'fragment',
        params: e.params.map((builtin) => ({
          kind: 'field' as const,
          field: { name: builtin, builtin },
        })),
        out:
          e.out === null ? { kind: 'field', field: colour } : { kind: 'struct', fields: [colour] },
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
}

/** Each entry's draw manifest, by tier. */
const drawManifests = new WeakMap<FragmentEntry, Map<DrawTier, Pack>>();

/**
 * The manifest a draw of `e` loads on `tier`: the entry's program with the full-screen vertex
 * entry beside it, one for each entry and tier. The generated module writes the entry as a call
 * record, not as a manifest, and the call layer carries no compiler, so the manifest is made here
 * from that record: the module's WGSL and the triangle's, each binding the entry reaches, the
 * recorded console variant where the WGSL records, the WebGL2 programs, and on the CPU tier the
 * CPU program under the `CPU_PROGRAM` key (change 0120, O2 (a)).
 */
function drawManifestOf(e: FragmentEntry, cpu: GeneratedCpu, tier: DrawTier): Pack {
  let byTier = drawManifests.get(e);
  if (byTier === undefined) drawManifests.set(e, (byTier = new Map()));
  const hit = byTier.get(tier);
  if (hit !== undefined) return hit;
  // The CPU backend binds buffers only: an entry it draws reaches no texture (Rule 8.24).
  const bindings = e.bindings
    .filter((b) => tier !== 'cpu' || isBuffer(b))
    .map((b) => packBindingOf(b));
  const entry: PackEntry = {
    name: e.name,
    emitted: e.entryPoint ?? e.fn,
    stage: 'fragment',
    outputs: [{ name: e.out ?? 'colour', type: 'vec4<f32>', location: 0 }],
    bindings: bindings.map((b) => ({ name: b.name, writes: false })),
  };
  const vertex: PackEntry = { name: VERTEX, emitted: VERTEX, stage: 'vertex', bindings: [] };
  const wgsl = `${e.wgsl}\n${FULLSCREEN_WGSL}\n`;
  let console: PackConsole | undefined;
  if (tier === 'webgpu' && e.log !== undefined) {
    const slot: PackBinding = {
      name: '_console',
      emitted: '_console',
      space: 'storage',
      group: e.log.group,
      binding: e.log.binding,
      access: 'read_write',
      type: 'array<u32>',
      stages: ['fragment'],
      resource: { resourceKind: 'storage-buffer' },
      injected: true,
    };
    console = { wgsl, log: e.log, bindings: [...bindings, slot] };
  }
  let gl: Pack['gl'];
  if (tier === 'webgl2' && e.gl !== undefined) {
    const blocks: Record<string, string> = {};
    const samplers: Record<string, string | null> = {};
    const data: string[] = [];
    for (const b of e.bindings)
      if (b.space === 'uniform') blocks[slotOf(b)] = e.gl.blocks[b.name] ?? b.name;
      else if (b.space === 'storage') data.push(slotOf(b));
      else if (b.space === 'texture') {
        const sampler = e.gl.samplers[b.name] ?? null;
        const paired = e.bindings.find((x) => x.name === sampler);
        samplers[slotOf(b)] = paired === undefined ? sampler : slotOf(paired);
      }
    gl = {
      vertices: { [VERTEX]: { vertex: FULLSCREEN_GLSL, blocks: {}, samplers: {} } },
      draws: {
        [e.name]: { fragment: e.gl.frag, blocks, samplers, ...(data.length > 0 ? { data } : {}) },
      },
    };
  }
  const m: Pack = {
    schema: PACK_SCHEMA,
    compiler: VERSION,
    wgsl,
    bindings,
    entries: [vertex, entry],
    structs: [],
    overrides: [],
    features: [],
    ...(console !== undefined ? { console } : {}),
    ...(gl !== undefined ? { gl } : {}),
  };
  if (tier === 'cpu') (m as { [CPU_PROGRAM]?: CpuProgram })[CPU_PROGRAM] = drawCpuProgram(e, cpu);
  byTier.set(tier, m);
  return m;
}

/** The part of a WebGPU shader module that reports how its WGSL compiled. */
interface CompilationInfo {
  getCompilationInfo?(): Promise<{
    messages: readonly { type: string; lineNum: number; linePos: number; message: string }[];
  }>;
}

/** The program runtime a canvas draws through: WebGPU's or the CPU tier's `RuntimeImpl`, or the
 *  WebGL2 tier's `GlRuntimeImpl`. */
type DrawRuntime =
  | { readonly tier: 'webgpu' | 'cpu'; readonly rt: RuntimeImpl }
  | { readonly tier: 'webgl2'; readonly rt: GlRuntimeImpl };

/** The render pipeline of an entry on a runtime, made once for each entry and runtime. */
const pipelines = new WeakMap<object, Map<FragmentEntry, Promise<RenderPipeline>>>();

async function pipelineOf(
  d: DrawRuntime,
  e: FragmentEntry,
  cpu: GeneratedCpu,
  format: string,
): Promise<RenderPipeline> {
  const program = d.rt.load(drawManifestOf(e, cpu, d.tier));
  if (d.tier === 'webgpu') {
    const module = (program as unknown as ProgramImpl).shaderModule();
    const info = d.rt.rhi.toNative(module) as CompilationInfo;
    const errors = ((await info.getCompilationInfo?.())?.messages ?? []).filter(
      (m) => m.type === 'error',
    );
    if (errors.length > 0)
      throw new Error(
        `${e.name}: WebGPU refused the module's WGSL: ${errors.map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
      );
  }
  return program.render({
    vertex: VERTEX,
    fragment: e.name,
    // The frame is opaque on every tier. WebGPU's canvas (`alphaMode: 'opaque'`) and the WebGL2
    // context (`alpha: false`) drop the colour's alpha; the CPU backend's `putImageData` would
    // not, so its pipeline writes red, green and blue, and the clear's alpha of 1 stays.
    targets: [d.tier === 'cpu' ? { format, writeMask: 0x7 } : format],
  });
}

/** The default sampling of a sampler binding the host leaves out. */
const LINEAR_CLAMP: Sampling = { filter: 'linear', address: 'clamp' };

/** The program runtime's sampler of each sampling, one for each runtime. */
const samplers = new WeakMap<object, Map<string, Sampler>>();
export function samplerOn(rt: RuntimeImpl | GlRuntimeImpl, s: Sampling): Sampler {
  let byKey = samplers.get(rt);
  if (byKey === undefined) samplers.set(rt, (byKey = new Map()));
  const key = `${s.filter}:${s.address}`;
  let sampler = byKey.get(key);
  if (sampler === undefined) byKey.set(key, (sampler = rt.sampler(s)));
  return sampler;
}

/** The part of a WebGL2 context an image upload into a texture the device made uses. */
interface GlImageWrite extends GlImage {
  texSubImage2D(
    t: number,
    level: number,
    x: number,
    y: number,
    format: number,
    type: number,
    source: object,
  ): void;
}

/**
 * An image uploaded into an `rgba8unorm` texture the WebGL2 backend made, for a draw or an entry
 * call on WebGL2. The RHI takes no image source yet, so the image is uploaded through the context
 * the backend runs on (Rule 11.17). The caller destroys the texture once the work has run.
 */
export function glImageTexture(
  rhi: RhiDevice,
  img: { readonly source: object; readonly width: number; readonly height: number },
): RhiTexture {
  const texture = rhi.createTexture({
    size: [img.width, img.height, 1],
    format: 'rgba8unorm',
    usage: ['sampled', 'copy-dst'],
  });
  const gl = rhi.native as unknown as GlImageWrite;
  gl.activeTexture(GL_IMAGE.TEXTURE0);
  gl.bindTexture(GL_IMAGE.TEXTURE_2D, rhi.toNative(texture));
  gl.pixelStorei(GL_IMAGE.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(GL_IMAGE.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texSubImage2D(GL_IMAGE.TEXTURE_2D, 0, 0, 0, GL_IMAGE.RGBA, GL_IMAGE.UNSIGNED_BYTE, img.source);
  gl.bindTexture(GL_IMAGE.TEXTURE_2D, null);
  return texture;
}

/** A packed binding as the words its draw-manifest layout reads. */
function wordsOf(bytes: ArrayBuffer): Uint32Array {
  if (bytes.byteLength % 4 === 0) return new Uint32Array(bytes);
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  padded.set(new Uint8Array(bytes));
  return new Uint32Array(padded.buffer);
}

/**
 * The painter of one canvas on one program runtime. `target` is what the pass draws into: the
 * canvas's `webgpu` context, its `webgl2` context, or its `2d` context as the CPU backend takes
 * it. Every tier records the same: the entry's pipeline, its bindings by name, one pass into the
 * canvas that clears to opaque black, and one draw of 3 vertices.
 */
function programPainter(
  d: DrawRuntime,
  target: object,
  format: string,
  noTierWhy: (e: FragmentEntry) => string | undefined,
  tierName: string,
): Painter {
  const ready = new Map<FragmentEntry, RenderPipeline>();
  let per = pipelines.get(d.rt);
  if (per === undefined) pipelines.set(d.rt, (per = new Map()));
  const cache = per;
  const prepare = async (e: FragmentEntry, cpu: GeneratedCpu): Promise<void> => {
    if (noTierWhy(e) !== undefined) throw noTier(e, tierName, noTierWhy(e));
    if (ready.has(e)) return;
    let p = cache.get(e);
    if (p === undefined) {
      p = pipelineOf(d, e, cpu, format);
      cache.set(e, p);
      // A pipeline that failed is made again at the next draw.
      p.catch(() => cache.delete(e));
    }
    ready.set(e, await p);
  };
  const paint: Painter['paint'] = (e, _cpu, f) => {
    const pipeline = ready.get(e)!;
    const rhi = d.rt.rhi;
    const gpu = d.tier === 'webgpu' ? (rhi.native as unknown as GpuDevice) : undefined;
    const owned: { destroy(): void }[] = [];
    const textures: RhiTexture[] = [];
    const values: Record<string, unknown> = {};
    try {
      for (const b of e.bindings) {
        if (isGuard(b) || (d.tier === 'cpu' && !isBuffer(b))) continue;
        if (isBuffer(b)) {
          const resident = f.residents.get(b.name);
          // On WebGPU a `Resident` is bound as its device buffer; the other tiers read the host
          // copy `hostResidents` packed.
          values[slotOf(b)] =
            resident !== undefined && gpu !== undefined
              ? resident.bufferFor(gpu, b.layout, () => packed(b, resident.host), false)
              : wordsOf(f.bytes.get(b.name)!);
        } else if (b.space === 'sampler')
          values[slotOf(b)] = samplerOn(d.rt, f.samplers.get(b.name) ?? LINEAR_CLAMP);
        else if (gpu !== undefined)
          // WebGPU uploads an image, as a compute entry's call does, and binds a storage texture's
          // view as it is.
          values[slotOf(b)] = gpuHandle(
            gpu as unknown as Parameters<typeof gpuHandle>[0],
            b,
            f,
            owned,
          );
        else {
          const img = f.images.get(b.name)!;
          if (img.view !== undefined)
            throw new TypeError(
              `${e.name}(): binding "${b.name}" is a Texture on the WebGPU device, which the WebGL2 tier cannot read; pass an image source for a draw that may fall back.`,
            );
          const texture = glImageTexture(rhi, img);
          textures.push(texture);
          values[slotOf(b)] = rhi.toNative(texture);
        }
      }
      const targets: PassTargets = {
        color: [{ target, clear: [0, 0, 0, 1], load: 'clear', store: 'store' }],
      };
      const record = (pass: RenderPass): void => pass.draw(pipeline, values, { count: 3 });
      let done: Promise<unknown>;
      if (d.tier === 'webgl2') done = d.rt.runPass(targets, record);
      else {
        const frame = d.rt.frame();
        frame.pass(targets, record);
        done = frame.submit();
      }
      // The CPU backend ran the frame in the submit, and an error of its code rejects the draw. A
      // GPU's frame resolves when the GPU has run it, which a draw does not wait for; its console
      // calls print then, after the draw's promise resolved, since a draw reads nothing back.
      if (d.tier === 'cpu') return done.then(() => undefined);
      done.catch(() => undefined);
      return undefined;
    } finally {
      for (const o of owned) o.destroy();
      for (const t of textures) rhi.destroyTexture(t);
    }
  };
  return {
    tier: d.tier,
    ...(d.tier === 'webgpu' ? { onDevice: true as const, device: d.rt.rhi.native! } : {}),
    prepare,
    paint,
  };
}

/** The program runtime of each native device or context the call layer draws with, so the
 *  pipelines an entry makes on one device serve every canvas of that device. */
const runtimes = new WeakMap<object, RuntimeImpl | Promise<GlRuntimeImpl>>();

/** The CPU tier's program runtime: one software device for every canvas. */
let cpuRuntime: RuntimeImpl | undefined;

/** The program runtime the call layer draws and calls entries with on a `GPUDevice`, one for each
 *  device, which it never destroys. */
export function webgpuRuntimeOf(device: object): RuntimeImpl {
  let rt = runtimes.get(device) as RuntimeImpl | undefined;
  if (rt === undefined)
    runtimes.set(device, (rt = new RuntimeImpl(webgpuDevice(device as never), {}, false)));
  return rt;
}

/** The program runtime the call layer draws and calls entries with on a WebGL2 context, one for
 *  each context. The WebGL2 tier of the program runtime loads on first use, as `createRuntime()`
 *  loads it. */
export function glRuntimeOf(gl: object): Promise<GlRuntimeImpl> {
  let rt = runtimes.get(gl) as Promise<GlRuntimeImpl> | undefined;
  if (rt === undefined) {
    rt = import('../runtime/gl.js').then(
      ({ GlRuntimeImpl }) => new GlRuntimeImpl(gl as WebGL2RenderingContext, false),
    );
    runtimes.set(gl, rt);
  }
  return rt;
}

/** The CPU tier's program runtime: one software device for every canvas and entry call. */
export function cpuRuntimeOf(): RuntimeImpl {
  return (cpuRuntime ??= new RuntimeImpl(cpuDevice(), {}, true));
}

function webgpuPainter(device: object, ctx: GpuCanvasContext): Painter {
  const nav = (globalThis as { navigator?: { gpu?: { getPreferredCanvasFormat(): string } } })
    .navigator;
  const format = nav?.gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const rt = webgpuRuntimeOf(device);
  return programPainter({ tier: 'webgpu', rt }, ctx, format, () => undefined, '');
}

async function webgl2Painter(gl: object): Promise<Painter> {
  return programPainter(
    { tier: 'webgl2', rt: await glRuntimeOf(gl) },
    gl,
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
  const rt = cpuRuntimeOf();
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
  return programPainter({ tier: 'cpu', rt }, context, 'rgba8unorm', (e) => e.noCpu, 'the CPU');
}

/** The part of a canvas's `webgpu` context the call layer configures. */
interface GpuCanvasContext {
  configure(c: { device: unknown; format: string; alphaMode: 'opaque' }): void;
}
