// ═══ TypeShade compile gate — every example, both targets, compiled by the real compilers ═══
//
// WHAT IT PROVES. `examples/emit-goldens.test.ts` proves the emitters are byte-STABLE; it
// cannot say whether the bytes are a program. This gate can: each registered example is
// emitted here (in the same process the tests run in, from the same `examples` registry),
// and every emit is handed to the compiler that would receive it in production —
//
//   WGSL             `GPUDevice.createShaderModule` + `getCompilationInfo()` — Tint, inside
//                    Chromium's WebGPU. Every example emits WGSL, so every example is here.
//   GLSL ES 3.00     `compileShader` for the vertex AND fragment stage, then `linkProgram`,
//                    on a real WebGL2 context — ANGLE's translator. The `renderable` examples
//                    only — that registry flag is this package's single authority on "has a
//                    GLSL ES 3.00 form", and 6 of 43 clear it false today for four different
//                    reasons (no compute stage in GLSL ES 3.00, twice — the EDSL kernel and its
//                    source twin; a helper module with no entry point, twice; a host-side one; a
//                    loose scalar uniform, which GLSL ES 3.00 has no std140 block for). Those
//                    print `—`, never `ok`, so the count stays honest.
//
// THE ENTRY-CALL LEG (change 0016, Rule 8.24). After the compilers, the same page calls every
// `@compute` and full-screen `@fragment` entry of the `.shade.ts` examples through the host
// module the Vite plugin generates (`scripts/entry-calls.ts`): a compute entry on WebGPU and on
// the CPU tier, a draw on WebGPU, WebGL2 and the CPU tier, each tier against WebGPU. Its own
// instrument is a comparison that must report one changed value, and a compute entry whose
// WebGPU call wrote nothing fails, since it would match any tier.
//
// THE RENDER CASE (issue #392, Rule 11.11). The leg's program tier dispatches each compute entry
// through `typeshade/runtime`; the render case makes it draw. Three small programs
// (`scripts/render-case.ts`) are drawn the way a host draws them: a sky under `compare: 'always'`
// and `write: false`; indexed draws (a `Uint16Array`, a `Uint32Array`, the host's own `GPUBuffer`
// for vertices and for indices, three indices the runtime pads) under `compare: 'greater'` over a
// depth cleared to 0; a second pass that loads colour and depth; and a mesh whose vertices the
// shader pulls from a storage buffer. Colour and depth are read back and held to a picture
// computed in plain JavaScript. Its instrument is the same frames drawn with `compare: 'less'`,
// which must differ from that picture. `src/render-case.test.ts` holds the picture and the
// comparison, and both halves' reading of the three programs, without a device.
//
// THE PASSES LEG (change 0026). An example drawn in several passes has a program per pass, and
// each is a job of the sweep above under `<example>.<pass>`. After the sweep, the page draws
// every such example on WebGL2 the way a host does: the passes in order into textures the
// size of the canvas, each binding named like a pass reading this frame's output of an earlier
// pass or the frame before's of itself or a later one, then the example into the canvas. It
// reads the canvas back at frame 0 and at frame 30, and both must paint. For an example with a
// pass read as the frame before, frame 30 is drawn a second time with no history, and the two
// must differ: that is what shows the previous frame was read. Its own instrument is the same
// comparison made on an example whose passes read nothing of the frame before, which must
// report no difference. Every graph is then drawn the same way on WebGPU, and its frame 30
// must match WebGL2's: a texture's rows run down on WebGPU and up on WebGL2, so a pass read
// through a coordinate that is not the pixel's own comes back mirrored on one of them. That
// comparison's instrument is itself made on the WebGL2 picture mirrored, which it must see.
//
// THE DECLARED-NAMES LEG (change 0029, Rule 9.5). A function the file declares wins over every
// builtin function of its name, and each writer emits such a declaration under a name its target
// does not predeclare (`fract_`), so a builtin call of the same module, the author's or the
// compiler's own, still reaches the builtin. Whether Tint and ANGLE accept that is theirs to say,
// so the gate asks them three ways:
//
//   1. `declared-names`, a module that declares and calls `fract`, `pow`, `exp2` and `f32`, is an
//      example like the others: WGSL on Tint, both GLSL stages on ANGLE, the render pipeline.
//   2. A sweep over every name a writer renames (`predeclaredFunctionNames`). Two subject modules,
//      a compute one written on what WGSL predeclares (its types, its storage and texture forms, its
//      builtin functions) and a graphics one on what both targets have, each declare one function,
//      call it, and call builtins of every family beside it. For each name the function is given
//      that name in the IR and the module is emitted: Tint must accept every WGSL text and ANGLE
//      every GLSL text. The IR is renamed, and no source rewritten, because a source that declared
//      `private` or `mod` is one TypeScript or Rule 3.3 refuses, and a writer has to be right for
//      an IR whoever built it.
//   3. The values. #403's program, and one that declares `fract`, `pow`, `exp2` and `f32` beside
//      `random()` and `Math.pow`, run on WebGPU, and each answer is the declaration's, as the CPU
//      oracle gives it. The same declaration drawn by a fragment entry over one pixel of a WebGL2
//      canvas, where the answer used to be none, is the oracle's pixel.
//
// ITS INSTRUMENT. A sweep that accepted every name would say nothing about a writer that did not
// rename, so the same modules are handed over again with the rename undone, the declaration and
// its calls under the name itself, which is what the writers emitted before the change. Tint must
// refuse them for a floor of WGSL's names, ANGLE for a floor of the 89 built-in functions of GLSL
// ES 3.00, and each sentinel (a type, an enumerant, a builtin function) must be among the refused,
// or the sweep could not have failed. The value comparison is made once on a value moved by one,
// which it must report, and the pixel comparison must tell the declaration's colour from the
// builtin's.
//
// BOTH CORPORA. The sweep is `examples` (the curated `fn()` EDSL registry) followed by
// `shadeExamples` (the `"use typeshade"` `.shade.ts` files, compiled by `_shade.ts`). They
// are two authoring surfaces over ONE IR, so they are one list here: what this gate asks —
// does the emitted text compile — has the same answer shape for both, and a `.shade.ts`
// example that Tint rejects is exactly as broken as an EDSL one that does.
//
// Both run headless on SwiftShader, which is a real Vulkan / GL implementation in software:
// what it cannot stand in for is a GPU's rasterization and speed, and neither is measured
// here. Compile / validate / link is exactly the class SwiftShader is good for.
//
// WHY IT CANNOT BE VACUOUSLY GREEN (AGENTS.md#gate-discipline — validate the instrument against a
// known positive before believing a zero):
//
//   1. WebGPU MUST be reachable. `navigator.gpu` absent, no adapter, or no device is a
//      FAILURE of the gate, never a silent WGSL-less pass — the flags below are the four
//      that make WebGPU exist on SwiftShader, and the page is served from loopback because
//      `about:blank` is not a secure context and has no `navigator.gpu` at all.
//   2. Before any example is judged, each compiler is fed a shader that is NOT a program
//      (`fn broken( {`) and must REPORT it. A compiler that accepts garbage is a blind
//      instrument; the gate fails on it rather than trusting the 36 greens that follow.
//   3. A cut arm for the gate's own verification: `TYPESHADE_GATE_CUT=<example id>` corrupts
//      that example's emits before they reach the compilers, and the gate must then fail
//      NAMING that example and the backend. Never set in CI.
//
// Usage:  bun scripts/compile-gate.ts             (from the package root)
//         TYPESHADE_CHROMIUM=/path/to/headless_shell bun scripts/compile-gate.ts
//         — the executable is playwright's installed chromium-headless-shell unless named.
//
// Verifies: Rule 1.1, Rule 9.5, Rule 11.3, Rule 13.3 (docs/language-design.md; traced in reqs/).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { examples } from '../examples/index.js';
import { shadeExamples } from '../examples/_shade.js';
import { proveKernels } from '../src/core/passes/parallel-loop.js';
import { lowerKernel, lowerKernelGl } from '../src/core/passes/kernel-lower.js';
import { consoleBuffer, hasConsoleCall } from '../src/core/passes/console-buffer.js';
import { entryBundle } from './entry-calls.js';
import { ON_WEBGL2, PROGRAM_CASES } from './compute-case.js';
import type { EntryReport } from './entry-calls-page.js';
import { colours, differences, expectedFrame, FRAMES, type FrameName } from './render-case.js';
import {
  compile,
  compileModuleJs,
  emitGlslModule,
  emitModule,
  hostFeaturesFor,
  reflect,
  wgslBackend,
  type Capability,
} from '../src/index.js';
import type { FuncDecl, ModuleDecl, ShaderType } from '../src/index.js';
import type { Expr } from '../src/core/ir/index.js';
import { mapChildren, mapStmtExpr } from '../src/core/ir/visit.js';
import { compileModule } from '../src/core/oracle.js';
import { predeclaredFunctionNames } from '../src/core/passes/rename-predeclared.js';
import { GLSL_ES300_BUILTIN_FUNCTIONS, WGSL_PREDECLARED } from '../src/core/reserved-words.js';

/** The four flags that make WebGPU exist on SwiftShader. `--enable-unsafe-webgpu` alone
 *  leaves `'gpu' in navigator === false` without `--enable-unsafe-swiftshader`. */
const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
  '--enable-features=Vulkan',
];

/** Everything `createRenderPipeline` needs beyond the module, derived from the IR entries.
 *  `null` when this example is not a render pair, or when one of its IO types has no WebGPU
 *  format here — `skipped` then says which, so a silent `—` is never a silent hole. */
interface PipelineSpec {
  readonly vertexEntry: string;
  readonly fragmentEntry: string;
  /** One buffer per `@location` vertex input, each its own array: the gate only validates the
   *  layout, and one attribute per buffer is the layout that needs no packing rules. */
  readonly buffers: {
    arrayStride: number;
    attributes: { shaderLocation: number; offset: number; format: string }[];
  }[];
  readonly targets: { format: string }[];
}

interface Job {
  readonly id: string;
  readonly wgsl: string;
  /** Both stages, or `null` for an example with no GLSL ES 3.00 form (compute-only). */
  readonly glsl: { readonly vertex: string; readonly fragment: string } | null;
  /** The render pipeline to create from `wgsl`, or `null` with the reason in `pipelineSkip`. */
  readonly pipeline: PipelineSpec | null;
  readonly pipelineSkip: string;
  /** Set for a job of the declared-names sweep, which is judged apart from the examples. */
  readonly sweep?: Sweep;
}

/** What a job of the declared-names sweep is: a function given `name`, in a subject module, emitted
 *  as the writer emits it (`renamed`, which the compilers must accept) or with its rename undone
 *  (`own-name`, the instrument, which they must refuse for a name they predeclare). */
interface Sweep {
  readonly name: string;
  readonly subject: 'compute' | 'graphics';
  readonly form: 'renamed' | 'own-name';
}

interface Verdict {
  readonly id: string;
  /** Compiler messages of type `error`; empty means the compiler accepted the program. */
  readonly wgslErrors: readonly string[];
  /** `null` when the example has no GLSL form; else the compile + link errors. */
  readonly glslErrors: readonly string[] | null;
  /** `null` when there is no render pair to build; else the pipeline-creation errors. */
  readonly pipelineErrors: readonly string[] | null;
}

interface PageReport {
  readonly adapter: string;
  /** The optional device features the corpus asked for and this adapter granted. */
  readonly granted: readonly string[];
  /** The ones it asked for and this adapter does not have — printed, never silently dropped. */
  readonly missing: readonly string[];
  /** The instrument check: did each compiler REPORT the deliberately broken shader? */
  readonly brokenWgslReported: boolean;
  readonly brokenGlslReported: boolean;
  /** The pipeline leg's own instrument: a pipeline that is invalid for a reason
   *  `createShaderModule` cannot see must be REPORTED, or the leg is blind. */
  readonly brokenPipelineReported: boolean;
  readonly verdicts: readonly Verdict[];
}

const CUT = process.env['TYPESHADE_GATE_CUT'] ?? '';

/** The cut arm: an emit that is no longer a program. Applied AFTER emission so the emitter
 *  itself is untouched — this severs the wire between "emitted" and "compiled", which is
 *  the wire the gate exists to watch. */
const corrupt = (text: string): string => `${text}\n/* cut */ fn broken( {`;

/** Everything the gate compiles: the EDSL registry, then the `"use typeshade"` corpus. */
const ALL_EXAMPLES = [...examples, ...shadeExamples];

// ── The render-pipeline leg (#155) ──
//
// WHAT IT ADDS, measured rather than assumed. The audit expected the stage rules to surface
// only at `createRenderPipeline`; on THIS SwiftShader build (2026-09-21) they do not — a vertex
// entry calling `textureSample` is reported by `createShaderModule` itself ("built-in cannot be
// used by vertex pipeline stage"), and so are all eight of the storage-texture stage gaps. The
// existing WGSL leg already sees that class, and the note is left here because the opposite
// claim is easy to re-derive from the spec and wrong.
//
// What the pipeline leg demonstrably adds is everything validated ABOUT a module rather than
// INSIDE it: the vertex state against the entry's `@location` inputs, and the colour targets
// against its outputs. That is a real class — a shader whose attributes no buffer supplies
// compiles and cannot draw — and it is the class the instrument check below exercises. A
// future driver that does defer the stage or uniformity errors to pipeline creation is then
// already covered, at no extra cost.
//
// WHAT IT NEEDS. A pipeline is more than a module: WebGPU validates the vertex state against
// the entry's `@location` inputs and the fragment targets against its outputs. Both are
// derived from the IR below rather than authored, so an example gains its pipeline arm by
// existing. An IO type with no format here yields `null` and a printed reason — never a
// silent skip, which would make the leg look bigger than it is.

/** The `GPUVertexFormat` for a vertex attribute of this type, or `''` when there is none. */
function vertexFormat(t: ShaderType): string {
  if (t.kind === 'scalar') {
    return t.scalar === 'f32'
      ? 'float32'
      : t.scalar === 'i32'
        ? 'sint32'
        : t.scalar === 'u32'
          ? 'uint32'
          : '';
  }
  if (t.kind === 'vec' && t.n >= 2 && t.n <= 4) {
    const base =
      t.elem === 'f32' ? 'float32' : t.elem === 'i32' ? 'sint32' : t.elem === 'u32' ? 'uint32' : '';
    return base === '' ? '' : `${base}x${String(t.n)}`;
  }
  return '';
}

/** Bytes an attribute of this type occupies — every format above is four bytes per component. */
const vertexStride = (t: ShaderType): number => (t.kind === 'vec' ? t.n * 4 : 4);

/** A colour target whose format accepts this fragment output, or `''` when none does. */
function targetFormat(t: ShaderType): string {
  if (t.kind === 'scalar' && t.scalar === 'f32') return 'r32float';
  if (t.kind !== 'vec' || t.n !== 4) return '';
  return t.elem === 'f32'
    ? 'rgba8unorm'
    : t.elem === 'u32'
      ? 'rgba8uint'
      : t.elem === 'i32'
        ? 'rgba8sint'
        : '';
}

const stageOfFn = (f: FuncDecl): string =>
  f.stage ??
  (f.attrs?.some((a) => a.startsWith('@vertex')) === true
    ? 'vertex'
    : f.attrs?.some((a) => a.startsWith('@fragment')) === true
      ? 'fragment'
      : '');

/** The `@location` fields of an entry's IO, flattened: a bare parameter that carries one, or
 *  the located fields of the struct it takes (or returns). A `@builtin` carries no location
 *  and is supplied by the pipeline, so it is not listed. */
function locatedIo(
  m: ModuleDecl,
  type: ShaderType,
  location: number | undefined,
): { location: number; type: ShaderType }[] | null {
  if (location !== undefined) return [{ location, type }];
  if (type.kind !== 'struct') return [];
  const decl = m.structs.find((s) => s.name === type.name);
  if (decl === undefined) return null;
  return decl.fields.flatMap((f) =>
    f.location === undefined ? [] : [{ location: f.location, type: f.type }],
  );
}

/** The pipeline for a render pair, or `[null, reason]`. */
function pipelineOf(m: ModuleDecl): [PipelineSpec | null, string] {
  const vs = m.funcs.find((f) => stageOfFn(f) === 'vertex');
  const fs = m.funcs.find((f) => stageOfFn(f) === 'fragment');
  if (vs === undefined || fs === undefined) return [null, 'no vertex + fragment pair'];

  const inputs: { location: number; type: ShaderType }[] = [];
  for (const p of vs.params) {
    if (p.builtin !== undefined) continue;
    const located = locatedIo(m, p.type, p.location);
    if (located === null)
      return [null, `vertex input struct ${JSON.stringify(p.type)} is not declared`];
    inputs.push(...located);
  }
  const buffers = [];
  for (const input of inputs) {
    const format = vertexFormat(input.type);
    if (format === '')
      return [null, `no GPUVertexFormat for a @location(${String(input.location)}) input`];
    buffers.push({
      arrayStride: vertexStride(input.type),
      attributes: [{ shaderLocation: input.location, offset: 0, format }],
    });
  }

  const ret = fs.ret;
  const outputs = locatedIo(m, ret, ret.kind === 'struct' ? undefined : 0);
  if (outputs === null) return [null, 'fragment output struct is not declared'];
  if (outputs.length === 0) return [null, 'the fragment entry writes no @location output'];
  // A `@builtin(frag_depth)` output needs a depth attachment the gate does not describe.
  const retStruct =
    ret.kind === 'struct' ? m.structs.find((st) => st.name === ret.name) : undefined;
  if (retStruct?.fields.some((f) => f.builtin === 'frag_depth') === true) {
    return [null, 'the fragment entry writes @builtin(frag_depth), which needs a depth attachment'];
  }
  // Targets are POSITIONAL in WebGPU, so a gap in the `@location` numbering (0 and 2) would put
  // location 2's format at index 1 and validate the wrong thing. Refuse the module instead.
  const sorted = [...outputs].sort((a, b) => a.location - b.location);
  if (sorted.some((out, i) => out.location !== i)) {
    return [null, 'the fragment @location numbers have a gap, which a target list cannot express'];
  }
  const targets: { format: string }[] = [];
  for (const out of sorted) {
    const format = targetFormat(out.type);
    if (format === '')
      return [null, `no colour-target format for a @location(${String(out.location)}) output`];
    targets.push({ format });
  }
  return [{ vertexEntry: vs.name, fragmentEntry: fs.name, buffers, targets }, ''];
}

/** Each example whose module makes a console call, as the WGSL `compile(src, { console: 'gpu' })`
 *  writes it (surface §66): a second program, with the `_console` buffer and its stores, that Tint
 *  reads on its own (Rule 11.9, Rule 13.3). */
const CONSOLE_EXAMPLES = ALL_EXAMPLES.filter((ex) => hasConsoleCall(ex.module)).map((ex) => ({
  ...ex,
  id: `${ex.id}+console`,
  module: consoleBuffer(ex.module).module,
  renderable: false,
}));

/** The vertex stage the runtime draws a kernel's WebGL2 program with (`core/host-kernel-gl.ts`). */
const KERNEL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The WGSL each kernel function of the corpus lowers to (change 0013): the `@compute` entries
 *  its call dispatches, which `emitModule` of the example itself leaves out. A function that
 *  runs on the CPU has none. */
function kernelJobs(): Job[] {
  return ALL_EXAMPLES.flatMap((ex) =>
    proveKernels(ex.module).flatMap((proof): Job[] => {
      const f = ex.module.funcs.find((x) => x.name === proof.fn)!;
      const plan = lowerKernel(f, ex.module, proof);
      if ('noGpu' in plan) return [];
      const id = `${ex.id}#${proof.fn}`;
      const wgsl = emitModule(plan.module);
      // The WebGL2 tier's program for the first loop, when the function has one (Rule 11.8):
      // the fragment lowering over the runtime's fullscreen triangle.
      const gl = lowerKernelGl(f, ex.module, proof);
      const glsl =
        'noWebgl2' in gl
          ? null
          : { vertex: KERNEL_VS, fragment: emitGlslModule(gl.loops[0]!.module, 'fragment') };
      return [
        {
          id,
          wgsl: id === CUT ? corrupt(wgsl) : wgsl,
          glsl,
          pipeline: null,
          pipelineSkip: "a kernel function's loops, dispatched as compute",
        },
      ];
    }),
  );
}

/** Every pass of an example drawn in several (change 0026), as an example of its own under
 *  `<example>.<pass>`. A pass is drawn, so it has a GLSL ES 3.00 form. */
const PASS_EXAMPLES = ALL_EXAMPLES.flatMap((ex) =>
  (ex.passes ?? []).map((pass) => ({
    id: `${ex.id}.${pass.name}`,
    module: pass.module,
    renderable: true,
  })),
);

// ── The declared-names leg (change 0029, Rule 9.5) ──

/** A module that declares and calls `fract`, `pow`, `exp2` and `f32`, beside the builtins of the
 *  same names: `random()` expands to a call of the builtin `fract`, `Math.pow` is the builtin `pow`,
 *  and a call of `f32` is the cast, which no declaration of the name takes (Rule 9.5). */
const DECLARED_NAMES_SOURCE = `"use typeshade";
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
function pow(x: f32): f32 { return x * x; }
function exp2(x: f32): f32 { return x * 3.; }
function f32(x: f32): f32 { return x; }
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
class Color {
  @location(0) color: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  const x = f32(i) * 0.25;
  return { pos: vec4(fract(x), pow(x), 0., 1.), uv: vec2(exp2(x), x) };
}
@fragment
export function fs(v: VsOut): Color {
  const a = fract(v.uv.x) + pow(v.uv.y) + exp2(v.uv.x);
  const h = random(v.uv.x) + Math.pow(v.uv.y, 2.);
  return { color: vec4(a, h, f32(3), 1.) };
}
`;

/** `declared-names`, judged as an example is. */
const DECLARED_NAMES_EXAMPLES = ((): { id: string; module: ModuleDecl; renderable: boolean }[] => {
  const c = compile(DECLARED_NAMES_SOURCE);
  const errors = c.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0) {
    throw new Error(`the declared-names example does not compile: ${errors[0]!.message}`);
  }
  return [{ id: 'declared-names', module: c.module, renderable: true }];
})();

/** The function each subject module declares and calls, which the sweep gives every name. */
const SUBJECT_FN = 'subject';

/** Calls of builtins over two floats `x` and `y`, one for each name of a family a declared function
 *  could hide. Both subjects make them, and each is a name the emitted text spells. */
const FLOAT_CALLS: readonly string[] = [
  ...[
    'abs',
    'acos',
    'asin',
    'atan',
    'ceil',
    'cos',
    'cosh',
    'degrees',
    'exp',
    'exp2',
    'floor',
    'fract',
    'inverseSqrt',
    'log',
    'log2',
    'radians',
    'round',
    'saturate',
    'sign',
    'sin',
    'sinh',
    'sqrt',
    'tan',
    'tanh',
    'trunc',
  ].map((n) => `${n}(x)`),
  ...['atan2', 'max', 'min', 'pow', 'step'].map((n) => `${n}(x, y)`),
  ...['clamp', 'fma', 'mix', 'smoothstep'].map((n) => `${n}(x, y, 0.5)`),
  'length(vec2(x, y))',
  'normalize(vec2(x, y)).x',
  'dot(vec2(x, y), vec2(y, x))',
  'distance(vec2(x, y), vec2(y, x))',
  'reflect(vec2(x, y), vec2(0., 1.)).x',
  'cross(vec3(x, y, 1.), vec3(y, x, 1.)).x',
  'random(x)',
];

/** The compute subject's own calls: the bit, packing, integer, matrix and selection builtins,
 *  which read `bits`, `i` and `m` of its body. */
const COMPUTE_CALLS: readonly string[] = [
  'f32(countOneBits(bits))',
  'f32(countLeadingZeros(bits))',
  'f32(countTrailingZeros(bits))',
  'f32(firstLeadingBit(bits))',
  'f32(firstTrailingBit(bits))',
  'f32(reverseBits(bits) & 1)',
  'f32(extractBits(bits, 2, 3))',
  'f32(insertBits(bits, 5, 1, 3))',
  'f32(pack4x8unorm(vec4(x, y, x, y)))',
  'unpack4x8unorm(bits).x',
  'f32(pack2x16float(vec2(x, y)))',
  'unpack2x16float(bits).x',
  'f32(abs(i))',
  'f32(min(i, 3))',
  'f32(max(i, 3))',
  'f32(clamp(i, 0, 3))',
  'determinant(m)',
  'select(x, y, x > y)',
  'ldexp(x, 2)',
  'quantizeToF16(x)',
  'faceForward(vec2(x, y), vec2(y, x), vec2(x, x)).x',
  'refract(vec2(x, y), vec2(0., 1.), 0.5).x',
];

/** The graphics subject's own calls: the derivatives and the implicit-level texture reads, which
 *  only a fragment entry may make. */
const GRAPHICS_CALLS: readonly string[] = [
  'dpdx(x)',
  'dpdy(x)',
  'fwidth(x)',
  'textureSample(image, smp, vec2(x, y)).x',
  'textureSampleLevel(image, smp, vec2(x, y), 0.).x',
  'textureLoad(image, vec2i(1, 1), 0).x',
  'f32(textureDimensions(image).x)',
];

/** `total = total + …;` lines of six calls each. One long sum is a compile-time cliff of the
 *  front end, which grows with the length of the chain. */
const sumLines = (calls: readonly string[]): string =>
  Array.from(
    { length: Math.ceil(calls.length / 6) },
    (_, k) => `  total = total + ${calls.slice(k * 6, k * 6 + 6).join(' + ')};`,
  ).join('\n');

/** A compute entry written on what WGSL predeclares: its types, its address spaces and access
 *  modes, its texel formats, its atomics, textures and builtin functions. */
const COMPUTE_SUBJECT = `"use typeshade";
class Body {
  at: vec2;
  vel: vec2;
  step(dt: f32): void {
    this.at = this.at + this.vel * dt;
  }
}
class Summary {
  count: atomic<u32>;
}
class Params {
  world: mat4;
  tint: vec4;
  scale: f32;
  steps: i32;
  flags: u32;
}
declare const params: uniform<Params>;
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
declare const bins: storage<array<atomic<u32>>, "read_write">;
declare const summary: storage<Summary, "read_write">;
declare const image: texture_2d<f32>;
declare const smp: sampler;
declare const shot: texture_storage_2d<"rgba8unorm", "write">;
declare const acc: texture_storage_2d<"r32float", "read_write">;
let tile: workgroup<array<f32, 64>>;
let calls: u32;
function ${SUBJECT_FN}(x: f32): f32 {
  return x + 0.5;
}
@compute([64, 1, 1])
export function main(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  if (gid.x >= src.length) {
    return;
  }
  let body: Body = { at: vec2(0., 0.), vel: vec2(1., 2.) };
  body.step(params.scale);
  calls = calls + 1;
  tile[lid.x] = src[gid.x];
  const flag: bool = params.flags > 1 && params.steps > 0;
  const world = params.world * params.tint;
  const uv = vec2(f32(gid.x) / 64., 0.5);
  const c = textureSampleLevel(image, smp, uv, 0.);
  textureStore(shot, vec2i(i32(gid.x), 0), c);
  const r = textureLoad(acc, vec2i(0, 0));
  const x = tile[lid.x] + body.at.x;
  const y = world.x + r.x;
  const bits = gid.x;
  const i = i32(gid.x);
  const m = mat2(x, y, y, x);
  let total = ${SUBJECT_FN}(0.25) + f32(atomicAdd(bins[0], 1)) + f32(atomicAdd(summary.count, 1));
  total = total + f32(calls) + (flag ? 1. : 0.);
${sumLines([...FLOAT_CALLS, ...COMPUTE_CALLS])}
  dst[gid.x] = total;
}
`;

/** A vertex and a fragment entry written on what both targets have, so GLSL ES 3.00 has a program
 *  for it. */
const GRAPHICS_SUBJECT = `"use typeshade";
declare const image: texture_2d<f32>;
declare const smp: sampler;
function ${SUBJECT_FN}(x: f32): f32 {
  return x + 0.5;
}
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
class Color {
  @location(0) color: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  const x = f32(i) * 0.25;
  let s = ${SUBJECT_FN}(x);
  s = s + abs(x) + sin(x) + fract(x) + mix(x, 1., 0.5);
  return { pos: vec4(s, 0., 0., 1.), uv: vec2(x, x) };
}
@fragment
export function fs(v: VsOut): Color {
  const x = v.uv.x;
  const y = v.uv.y;
  let total = ${SUBJECT_FN}(0.25);
${sumLines([...FLOAT_CALLS, ...GRAPHICS_CALLS])}
  return { color: vec4(total, total, total, 1.) };
}
`;

/** `m` with its function `from` named `to`, and every call through it (`declRef`) with it. A call
 *  of the builtin `to` that the module already makes has no `declRef` and is left as it is, which
 *  is the state the front end leaves a module in when a function is declared under a builtin's
 *  name (Rule 9.5). */
function withFunctionNamed(m: ModuleDecl, from: string, to: string): ModuleDecl {
  const rename = (e: Expr): Expr =>
    mapChildren(
      e.op === 'call' && e.declRef !== undefined && e.fn === from ? { ...e, fn: to } : e,
      rename,
    );
  return {
    ...m,
    funcs: m.funcs.map((f) => ({
      ...f,
      name: f.name === from ? to : f.name,
      body: f.body.map((st) => mapStmtExpr(st, rename)),
    })),
  };
}

/** `text` with a writer's rename undone: the declaration and its calls under `name` itself. */
const ownName = (text: string, name: string): string =>
  text.replace(new RegExp(`\\b${name}_(?=\\()`, 'g'), name);

/** The two subject modules, compiled. */
function subjectModules(): Record<Sweep['subject'], ModuleDecl> {
  const build = (source: string, what: string): ModuleDecl => {
    const c = compile(source);
    const errors = c.diagnostics.filter((d) => d.category === 'error');
    if (errors.length > 0) {
      throw new Error(
        `the ${what} subject of the declared-names leg does not compile: ${errors[0]!.message}`,
      );
    }
    return c.module;
  };
  return {
    compute: build(COMPUTE_SUBJECT, 'compute'),
    graphics: build(GRAPHICS_SUBJECT, 'graphics'),
  };
}

/** Every name a writer renames a function away from: what its target predeclares, and the id of
 *  each builtin the IR carries. */
const renamedNames = (): string[] =>
  [...new Set([...predeclaredFunctionNames('wgsl'), ...predeclaredFunctionNames('glsl')])].sort();

/** Whether `name` could be a function's name at all: the registry holds ids that are operators
 *  (`~`), which no function is named. */
const isIdentifier = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

/** The sweep: each subject with its function given each name, as the writers emit it, and again,
 *  for the names a target predeclares, with the rename undone. */
function declaredNamesJobs(): Job[] {
  const subjects = subjectModules();
  const out: Job[] = [];
  for (const name of renamedNames().filter(isIdentifier)) {
    for (const subject of ['compute', 'graphics'] as const) {
      const m = withFunctionNamed(subjects[subject], SUBJECT_FN, name);
      const wgsl = emitModule(m);
      const glsl =
        subject === 'graphics'
          ? { vertex: emitGlslModule(m, 'vertex'), fragment: emitGlslModule(m, 'fragment') }
          : null;
      const add = (id: string, form: Sweep['form'], w: string, g: typeof glsl): void => {
        out.push({
          id,
          wgsl: id === CUT ? corrupt(w) : w,
          glsl:
            g !== null && id === CUT
              ? { vertex: corrupt(g.vertex), fragment: corrupt(g.fragment) }
              : g,
          pipeline: null,
          pipelineSkip: 'a name of the declared-names sweep',
          sweep: { name, subject, form },
        });
      };
      add(`declared-names/${subject}/${name}`, 'renamed', wgsl, glsl);
      if (WGSL_PREDECLARED.has(name) || GLSL_ES300_BUILTIN_FUNCTIONS.has(name)) {
        add(
          `declared-names/${subject}/${name}/own-name`,
          'own-name',
          ownName(wgsl, name),
          glsl === null
            ? null
            : { vertex: ownName(glsl.vertex, name), fragment: ownName(glsl.fragment, name) },
        );
      }
    }
  }
  return out;
}

function jobs(): Job[] {
  return [...ALL_EXAMPLES, ...PASS_EXAMPLES, ...CONSOLE_EXAMPLES, ...DECLARED_NAMES_EXAMPLES]
    .map((ex) => {
      const cut = ex.id === CUT;
      const wgsl = emitModule(ex.module);
      const glsl = ex.renderable
        ? {
            vertex: emitGlslModule(ex.module, 'vertex'),
            fragment: emitGlslModule(ex.module, 'fragment'),
          }
        : null;
      const [pipeline, pipelineSkip] = pipelineOf(ex.module);
      return {
        id: ex.id,
        wgsl: cut ? corrupt(wgsl) : wgsl,
        glsl:
          glsl && cut ? { vertex: corrupt(glsl.vertex), fragment: corrupt(glsl.fragment) } : glsl,
        pipeline,
        pipelineSkip,
      };
    })
    .concat(kernelJobs(), declaredNamesJobs());
}

/** The optional WebGPU features the corpus needs, derived from the modules themselves rather
 *  than listed by hand: a capability an example requires translates into the `requiredFeatures`
 *  string the WGSL target wants, which is exactly what a host would pass `requestDevice`. An
 *  example that opts into nothing contributes nothing, so this is empty for most corpora. */
function wantedFeatures(): string[] {
  const caps = new Set<Capability>();
  for (const ex of [...ALL_EXAMPLES, ...PASS_EXAMPLES])
    for (const c of reflect(ex.module).requiredFeatures) caps.add(c);
  return [...new Set(hostFeaturesFor(wgslBackend, [...caps]))].sort();
}

/** A page on loopback — a secure context, so `navigator.gpu` exists. Serves one empty document. */
function serve(entries: string): Promise<Server> {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      if (req.url === '/entries.js') {
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.end(entries);
        return;
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>typeshade compile gate</title>');
    });
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

/** Runs INSIDE the browser. Plain DOM + WebGPU + WebGL2 — nothing from this package. */
async function compileInPage(input: {
  jobs: Job[];
  broken: string;
  brokenPipeline: { code: string; vertexEntry: string; fragmentEntry: string };
  wanted: string[];
}): Promise<PageReport> {
  if (!('gpu' in navigator) || navigator.gpu === undefined) {
    throw new Error('navigator.gpu is absent — WebGPU is not reachable in this browser');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('requestAdapter() returned null — no WebGPU adapter');
  // The OPTIONAL features the corpus asks for, intersected with what this adapter has.
  // `requestDevice()` with no list gives a device with none of them, and Tint then refuses
  // `enable clip_distances;` with `extension 'clip_distances' is not allowed in the current
  // environment` — which reads like a bad emit and is not one. An example that needs a
  // feature the adapter genuinely lacks is reported below rather than silently compiled
  // against a device that cannot honour it.
  const granted = input.wanted.filter((f) => adapter.features.has(f as GPUFeatureName));
  const missing = input.wanted.filter((f) => !adapter.features.has(f as GPUFeatureName));
  const device = await adapter.requestDevice({ requiredFeatures: granted as GPUFeatureName[] });
  const info = adapter.info;
  const adapterLabel = `${info.vendor || '?'} / ${info.architecture || '?'} / ${info.description || info.device || '?'}`;

  async function wgslErrors(code: string): Promise<string[]> {
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code });
    const compilation = await module.getCompilationInfo();
    const scope = await device.popErrorScope();
    const errors = compilation.messages
      .filter((m) => m.type === 'error')
      .map((m) => `${String(m.lineNum)}:${String(m.linePos)} ${m.message}`);
    if (scope !== null) errors.push(`validation: ${scope.message}`);
    return errors;
  }

  /** Create the render pipeline and return the validation errors. A stage rule and the
   *  uniformity analysis are reported HERE, not at `createShaderModule`. */
  async function pipelineErrors(
    code: string,
    spec: { vertexEntry: string; fragmentEntry: string; buffers: unknown[]; targets: unknown[] },
  ): Promise<string[]> {
    device.pushErrorScope('validation');
    const errors: string[] = [];
    try {
      const module = device.createShaderModule({ code });
      device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module,
          entryPoint: spec.vertexEntry,
          buffers: spec.buffers as GPUVertexBufferLayout[],
        },
        fragment: {
          module,
          entryPoint: spec.fragmentEntry,
          targets: spec.targets as GPUColorTargetState[],
        },
      });
    } catch (e) {
      errors.push(`threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    const scope = await device.popErrorScope();
    if (scope !== null) errors.push(scope.message);
    return errors;
  }

  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl === null) throw new Error('getContext("webgl2") returned null — WebGL2 is not reachable');

  // An arrow, not a `function` declaration: a declaration is hoisted, so TS analyses its body
  // with `gl`'s DECLARED type and the null-check above never reaches it (TS18047 on every use).
  const glslErrors = (vertex: string, fragment: string): string[] => {
    const errors: string[] = [];
    const stage = (type: number, source: string, label: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (shader === null) {
        errors.push(`${label}: createShader returned null`);
        return null;
      }
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        errors.push(`${label}: ${gl.getShaderInfoLog(shader) ?? 'compile failed with no log'}`);
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vs = stage(gl.VERTEX_SHADER, vertex, 'vertex');
    const fs = stage(gl.FRAGMENT_SHADER, fragment, 'fragment');
    if (vs !== null && fs !== null) {
      const program = gl.createProgram();
      if (program === null) {
        errors.push('link: createProgram returned null');
      } else {
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          errors.push(`link: ${gl.getProgramInfoLog(program) ?? 'link failed with no log'}`);
        }
        gl.deleteProgram(program);
      }
    }
    if (vs !== null) gl.deleteShader(vs);
    if (fs !== null) gl.deleteShader(fs);
    return errors;
  };

  // The instrument check, FIRST: each compiler must report a non-program.
  const brokenWgslReported = (await wgslErrors(input.broken)).length > 0;
  const brokenGlslReported = glslErrors(input.broken, input.broken).length > 0;
  // The pipeline leg's own instrument, and it must be a shader `createShaderModule` ACCEPTS:
  // a module-level error would be caught by the WGSL leg above and would say nothing about
  // whether pipeline creation is watched. A `@location` vertex input with no vertex buffer
  // is invalid for the pipeline alone.
  const brokenPipelineReported =
    (await wgslErrors(input.brokenPipeline.code)).length === 0 &&
    (
      await pipelineErrors(input.brokenPipeline.code, {
        vertexEntry: input.brokenPipeline.vertexEntry,
        fragmentEntry: input.brokenPipeline.fragmentEntry,
        buffers: [],
        targets: [{ format: 'rgba8unorm' }],
      })
    ).length > 0;

  const verdicts: Verdict[] = [];
  for (const job of input.jobs) {
    verdicts.push({
      id: job.id,
      wgslErrors: await wgslErrors(job.wgsl),
      glslErrors: job.glsl === null ? null : glslErrors(job.glsl.vertex, job.glsl.fragment),
      pipelineErrors: job.pipeline === null ? null : await pipelineErrors(job.wgsl, job.pipeline),
    });
  }
  return {
    adapter: adapterLabel,
    granted,
    missing,
    brokenWgslReported,
    brokenGlslReported,
    brokenPipelineReported,
    verdicts,
  };
}

/** One program of a pass graph as the page draws it: '' names the example's own file, drawn
 *  last into the canvas. */
interface GraphProgram {
  readonly name: string;
  readonly vertex: string;
  readonly fragment: string;
  /** The WGSL half, which the WebGPU draw of the graph runs, with its entries and bindings. */
  readonly wgsl: string;
  readonly vertexEntry: string;
  readonly fragmentEntry: string;
  readonly bindings: readonly {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
    readonly kind: string;
  }[];
  /** The uniform block's size and the WGSL offsets of its fields, or null for none. */
  readonly uniform: { readonly size: number; readonly offsets: Record<string, number> } | null;
}

/** An example drawn in several passes, for the passes leg. */
interface Graph {
  readonly id: string;
  readonly programs: readonly GraphProgram[];
  /** Whether some pass is read as the frame before: by itself, or by a pass drawn before it. */
  readonly history: boolean;
}

interface GraphVerdict {
  readonly id: string;
  readonly errors: readonly string[];
  /** Distinct colours in the canvas at frame 0 and at frame 30. */
  readonly colours: readonly [number, number];
  /** Pixels that differ at frame 30 between the draw with history and the one without. */
  readonly historyDiffers: number;
  /** The float render target, or `RGBA8` where `EXT_color_buffer_float` is absent. */
  readonly target: string;
  /** The canvas at frame 30, drawn with history, as WebGL2 reads it back: RGBA, the bottom row
   *  first. Empty where a program did not link. */
  readonly frame30: readonly number[];
}

/** The same graph drawn on WebGPU: the canvas at frame 30, RGBA, the top row first. */
interface GpuGraphVerdict {
  readonly id: string;
  readonly errors: readonly string[];
  readonly pixels: readonly number[];
}

/** The pass graphs of the corpus, with what each program reads. */
function graphs(): Graph[] {
  return ALL_EXAMPLES.filter((ex) => ex.passes !== undefined).map((ex) => {
    const passes = ex.passes ?? [];
    const modules = [...passes.map((p) => p.module), ex.module];
    // A pass is read as the frame before by itself or by a pass drawn before it.
    const history = passes.some((p, i) =>
      modules.slice(0, i + 1).some((m) => m.bindings.some((b) => b.name === p.name)),
    );
    const cut = (text: string, name: string): string =>
      `${ex.id}.${name}` === CUT ? corrupt(text) : text;
    return {
      id: ex.id,
      history,
      programs: [
        ...passes.map((p) => ({ name: p.name, module: p.module })),
        { name: '', module: ex.module },
      ].map(({ name, module }) => {
        const r = reflect(module);
        const block = r.uniforms[0];
        const entry = (stage: string): string =>
          r.entries.find((e) => e.stage === stage)?.name ?? '';
        return {
          name,
          vertex: emitGlslModule(module, 'vertex'),
          fragment: cut(emitGlslModule(module, 'fragment'), name),
          wgsl: emitModule(module),
          vertexEntry: entry('vertex'),
          fragmentEntry: entry('fragment'),
          bindings: r.bindGroups.flatMap((g) =>
            g.entries.map((e) => ({
              name: e.name,
              group: g.group,
              binding: e.binding,
              kind: e.resourceKind,
            })),
          ),
          uniform: block
            ? {
                size: block.size,
                offsets: Object.fromEntries(block.fields.map((f) => [f.name, f.offset])),
              }
            : null,
        };
      }),
    };
  });
}

/** The canvas the passes leg draws each graph at. */
const GRAPH_SIZE: [number, number] = [96, 72];

/** Runs INSIDE the browser. Draws each pass graph on WebGL2 as a host does (change 0026). */
function drawGraphsInPage(input: { graphs: Graph[]; size: [number, number] }): GraphVerdict[] {
  const [W, H] = input.size;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (gl === null) throw new Error('getContext("webgl2") returned null — WebGL2 is not reachable');
  const float = gl.getExtension('EXT_color_buffer_float') !== null;
  const verdicts: GraphVerdict[] = [];

  for (const graph of input.graphs) {
    const errors: string[] = [];
    const passNames = graph.programs.filter((p) => p.name !== '').map((p) => p.name);
    const link = (program: GraphProgram): WebGLProgram | null => {
      const shader = (type: number, source: string): WebGLShader | null => {
        const sh = gl.createShader(type);
        if (sh === null) return null;
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          errors.push(
            `${program.name || 'example'}: ${gl.getShaderInfoLog(sh) ?? 'compile failed'}`,
          );
          return null;
        }
        return sh;
      };
      const vs = shader(gl.VERTEX_SHADER, program.vertex);
      const fs = shader(gl.FRAGMENT_SHADER, program.fragment);
      if (vs === null || fs === null) return null;
      const p = gl.createProgram();
      if (p === null) {
        errors.push(`${program.name || 'example'}: createProgram returned null`);
        return null;
      }
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        errors.push(`${program.name || 'example'}: ${gl.getProgramInfoLog(p) ?? 'link failed'}`);
        return null;
      }
      return p;
    };
    const programs = graph.programs.map(link);
    if (programs.some((p) => p === null)) {
      verdicts.push({
        id: graph.id,
        errors,
        colours: [0, 0],
        historyDiffers: 0,
        target: '',
        frame30: [],
      });
      continue;
    }

    // Two textures a pass, written in turn: this frame's, and the frame before's.
    const target = (): WebGLTexture => {
      const t = gl.createTexture();
      if (t === null) throw new Error('createTexture returned null');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        float ? gl.RGBA16F : gl.RGBA8,
        W,
        H,
        0,
        gl.RGBA,
        float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const fbo = gl.createFramebuffer();
    const fresh = () => passNames.map(() => [target(), target()] as [WebGLTexture, WebGLTexture]);
    const clear = (textures: [WebGLTexture, WebGLTexture][]) => {
      for (const pair of textures)
        for (const t of pair) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
    };

    // The uniform block, laid out as the driver reports it, and the three fields a host fills.
    const blocks = programs.map((p) => {
      const program = p as WebGLProgram;
      const index = gl.getUniformBlockIndex(program, 'Uniforms');
      if (index === gl.INVALID_INDEX) return null;
      const size = gl.getActiveUniformBlockParameter(
        program,
        index,
        gl.UNIFORM_BLOCK_DATA_SIZE,
      ) as number;
      const fields = ['time', 'resolution', 'frame'];
      const found =
        gl.getUniformIndices(
          program,
          fields.map((f) => `Uniforms.${f}`),
        ) ?? [];
      const indices = [...found];
      const offsets = new Map<string, number>();
      fields.forEach((f, i) => {
        const at = indices[i];
        if (at === undefined || at === gl.INVALID_INDEX) return;
        offsets.set(f, (gl.getActiveUniforms(program, [at], gl.UNIFORM_OFFSET) as number[])[0]!);
      });
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
      gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW);
      gl.uniformBlockBinding(program, index, 0);
      return { size, offsets, buffer };
    });

    const drawFrame = (frame: number, textures: [WebGLTexture, WebGLTexture][]): void => {
      programs.forEach((p, i) => {
        const program = p as WebGLProgram;
        gl.useProgram(program);
        const block = blocks[i];
        if (block) {
          const bytes = new DataView(new ArrayBuffer(block.size));
          const at = (f: string) => block.offsets.get(f);
          if (at('time') !== undefined) bytes.setFloat32(at('time')!, frame / 60, true);
          if (at('resolution') !== undefined) {
            bytes.setFloat32(at('resolution')!, W, true);
            bytes.setFloat32(at('resolution')! + 4, H, true);
          }
          if (at('frame') !== undefined) bytes.setUint32(at('frame')!, frame, true);
          gl.bindBuffer(gl.UNIFORM_BUFFER, block.buffer);
          gl.bufferSubData(gl.UNIFORM_BUFFER, 0, bytes);
          gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, block.buffer);
        }
        // Rule 3 of change 0026: an earlier pass is read as this frame's output, the pass
        // itself or a later one as the frame before's.
        passNames.forEach((name, j) => {
          const location = gl.getUniformLocation(program, name);
          if (location === null) return;
          const pair = textures[j]!;
          const written = pair[frame % 2]!;
          const before = pair[(frame + 1) % 2]!;
          gl.activeTexture(gl.TEXTURE0 + j);
          gl.bindTexture(gl.TEXTURE_2D, j < i ? written : before);
          gl.uniform1i(location, j);
        });
        const last = i === programs.length - 1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : fbo);
        if (!last)
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            textures[i]![frame % 2]!,
            0,
          );
        gl.viewport(0, 0, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      });
    };
    const read = (): Uint8Array => {
      const pixels = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const colours = (pixels: Uint8Array): number => {
      const seen = new Set<number>();
      for (let k = 0; k < pixels.length; k += 4)
        seen.add((pixels[k]! << 16) | (pixels[k + 1]! << 8) | pixels[k + 2]!);
      return seen.size;
    };

    const textures = fresh();
    clear(textures);
    drawFrame(0, textures);
    const first = read();
    for (let frame = 1; frame <= 30; frame += 1) drawFrame(frame, textures);
    const withHistory = read();
    // Frame 30 again with no frame before it: every pass output starts from zeroes.
    const blank = fresh();
    clear(blank);
    drawFrame(30, blank);
    const without = read();
    let differs = 0;
    for (let k = 0; k < withHistory.length; k += 4)
      if (
        Math.abs(withHistory[k]! - without[k]!) > 2 ||
        Math.abs(withHistory[k + 1]! - without[k + 1]!) > 2 ||
        Math.abs(withHistory[k + 2]! - without[k + 2]!) > 2
      )
        differs += 1;
    const glError = gl.getError();
    if (glError !== gl.NO_ERROR) errors.push(`gl error 0x${glError.toString(16)}`);
    verdicts.push({
      id: graph.id,
      errors,
      colours: [colours(first), colours(withHistory)],
      historyDiffers: differs,
      target: float ? 'RGBA16F' : 'RGBA8',
      frame30: Array.from(withHistory),
    });
  }
  return verdicts;
}

/** Runs INSIDE the browser. Draws each pass graph on WebGPU the way the WebGL2 leg does: the
 *  passes in order into `rgba16float` textures the size of the canvas, two a pass written in
 *  turn, then the example into an `rgba8unorm` target, and reads that target back at frame 30. */
async function drawGraphsOnWebGpu(input: {
  graphs: Graph[];
  size: [number, number];
}): Promise<GpuGraphVerdict[]> {
  const [W, H] = input.size;
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('requestAdapter() returned null — no WebGPU adapter');
  const device = await adapter.requestDevice();
  const verdicts: GpuGraphVerdict[] = [];
  for (const graph of input.graphs) {
    const errors: string[] = [];
    const pixels: number[] = [];
    const passNames = graph.programs.filter((p) => p.name !== '').map((p) => p.name);
    device.pushErrorScope('validation');
    try {
      const output = (): GPUTexture =>
        device.createTexture({
          size: [W, H],
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
      const pairs = passNames.map(() => [output(), output()]);
      const canvas = device.createTexture({
        size: [W, H],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      // The fp64 guard reads a white texel, as every host gives it.
      const white = device.createTexture({
        size: [1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: white },
        new Uint8Array([255, 255, 255, 255]),
        {},
        [1, 1],
      );
      const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const programs = graph.programs.map((program, i) => {
        const last = i === graph.programs.length - 1;
        const groups = new Map<number, GPUBindGroupLayoutEntry[]>();
        for (const b of program.bindings) {
          const list = groups.get(b.group) ?? [];
          groups.set(b.group, list);
          if (b.kind === 'uniform-buffer')
            list.push({ binding: b.binding, visibility, buffer: { type: 'uniform' } });
          else if (b.kind === 'texture')
            list.push({ binding: b.binding, visibility, texture: { sampleType: 'float' } });
          else if (b.kind === 'sampler')
            list.push({ binding: b.binding, visibility, sampler: { type: 'filtering' } });
          else
            throw new Error(
              `${program.name || 'example'}: binds a ${b.kind}, which the passes leg does not fill`,
            );
        }
        const top = Math.max(-1, ...groups.keys());
        const layouts = Array.from({ length: top + 1 }, (_, g) =>
          device.createBindGroupLayout({ entries: groups.get(g) ?? [] }),
        );
        const module = device.createShaderModule({ code: program.wgsl });
        const pipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
          vertex: { module, entryPoint: program.vertexEntry },
          fragment: {
            module,
            entryPoint: program.fragmentEntry,
            targets: [{ format: last ? 'rgba8unorm' : 'rgba16float' }],
          },
          primitive: { topology: 'triangle-list' },
        });
        const uniform = program.uniform
          ? device.createBuffer({
              size: Math.max(16, program.uniform.size),
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
          : null;
        return { program, pipeline, layouts, uniform };
      });
      const drawFrame = (frame: number): void => {
        const encoder = device.createCommandEncoder();
        programs.forEach(({ program, pipeline, layouts, uniform }, i) => {
          const block = program.uniform;
          if (uniform !== null && block !== null) {
            // The three fields the WebGL2 leg fills, with the same values.
            const bytes = new DataView(new ArrayBuffer(block.size));
            const time = block.offsets['time'];
            const resolution = block.offsets['resolution'];
            const count = block.offsets['frame'];
            if (time !== undefined) bytes.setFloat32(time, frame / 60, true);
            if (resolution !== undefined) {
              bytes.setFloat32(resolution, W, true);
              bytes.setFloat32(resolution + 4, H, true);
            }
            if (count !== undefined) bytes.setUint32(count, frame, true);
            device.queue.writeBuffer(uniform, 0, bytes.buffer);
          }
          // Rule 3 of change 0026: an earlier pass is read as this frame's output, the pass
          // itself or a later one as the frame before's.
          const passView = (name: string): GPUTextureView => {
            const j = passNames.indexOf(name);
            const pair = pairs[j];
            if (pair === undefined)
              throw new Error(`${program.name || 'example'}: no pass '${name}' to read`);
            return pair[j < i ? frame % 2 : (frame + 1) % 2]!.createView();
          };
          const groups = layouts.map((layout, g) =>
            device.createBindGroup({
              layout,
              entries: program.bindings
                .filter((b) => b.group === g)
                .map((b) => ({
                  binding: b.binding,
                  resource:
                    b.kind === 'uniform-buffer'
                      ? { buffer: uniform! }
                      : b.kind === 'sampler'
                        ? sampler
                        : b.name === '_fp64'
                          ? white.createView()
                          : passView(b.name),
                })),
            }),
          );
          const last = i === programs.length - 1;
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: (last ? canvas : pairs[i]![frame % 2]!).createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.setPipeline(pipeline);
          groups.forEach((group, g) => pass.setBindGroup(g, group));
          pass.draw(3);
          pass.end();
        });
        device.queue.submit([encoder.finish()]);
      };
      for (let frame = 0; frame <= 30; frame += 1) drawFrame(frame);
      const stride = Math.ceil((W * 4) / 256) * 256;
      const readback = device.createBuffer({
        size: stride * H,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: canvas }, { buffer: readback, bytesPerRow: stride }, [
        W,
        H,
      ]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readback.getMappedRange());
      for (let y = 0; y < H; y += 1)
        for (let x = 0; x < W * 4; x += 1) pixels.push(mapped[y * stride + x]!);
      readback.unmap();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    const scoped = await device.popErrorScope();
    if (scoped !== null) errors.push(scoped.message);
    verdicts.push({ id: graph.id, errors, pixels });
  }
  device.destroy();
  return verdicts;
}

/** Channels further apart than this, in 8-bit steps, make two pixels of the passes leg differ. */
const PASS_AGREE = 4;

/** The pixels at which two RGBA images of one size, rows in one order, differ. */
function differingPixels(a: readonly number[], b: readonly number[]): number {
  let differs = 0;
  for (let k = 0; k + 3 < a.length; k += 4)
    if (
      Math.abs(a[k]! - (b[k] ?? -255)) > PASS_AGREE ||
      Math.abs(a[k + 1]! - (b[k + 1] ?? -255)) > PASS_AGREE ||
      Math.abs(a[k + 2]! - (b[k + 2] ?? -255)) > PASS_AGREE
    )
      differs += 1;
  return differs;
}

/** An RGBA image of `width` pixels a row with its rows in the other order. */
function otherRowOrder(pixels: readonly number[], width: number): number[] {
  const rows: number[][] = [];
  for (let k = 0; k < pixels.length; k += width * 4) rows.push(pixels.slice(k, k + width * 4));
  return rows.reverse().flat();
}

/** Print the passes leg's verdicts; the number of failures. */
function graphVerdicts(
  all: readonly Graph[],
  verdicts: readonly GraphVerdict[],
  gpu: readonly GpuGraphVerdict[],
  size: readonly [number, number],
): number {
  let failures = 0;
  const history = new Map(all.map((g) => [g.id, g.history]));
  // WebGPU against WebGL2 at frame 30. WebGL2 reads its canvas back from the bottom row and
  // WebGPU from the top, so the WebGL2 rows are put in the other order first. The bound is one
  // pixel in a hundred.
  const bound = Math.floor((size[0] * size[1]) / 100);
  const onGpu = new Map(gpu.map((v) => [v.id, v]));
  const across = new Map<string, { differs: number; mirrored: number } | null>();
  for (const v of verdicts) {
    const g = onGpu.get(v.id);
    across.set(
      v.id,
      g && g.errors.length === 0 && g.pixels.length > 0 && v.frame30.length === g.pixels.length
        ? {
            differs: differingPixels(g.pixels, otherRowOrder(v.frame30, size[0])),
            mirrored: differingPixels(g.pixels, v.frame30),
          }
        : null,
    );
  }
  // Its instrument: the same comparison, made with the WebGL2 rows left in their own order,
  // which mirrors the picture, must see the mirror in some graph, or it could not see a pass
  // read upside down on one backend.
  const sees = [...across].filter(([, c]) => c !== null && c.mirrored > bound).map(([id]) => id);
  if (sees.length === 0) {
    console.error(
      'FAIL instrument: the WebGPU comparison sees no graph mirrored top to bottom — its ' +
        'verdicts could not tell a pass read upside down on one backend',
    );
    failures += 1;
  } else {
    console.log(
      `instrument: ${sees.join(', ')} drawn on WebGPU differs from itself on WebGL2 mirrored ` +
        'top to bottom — the WebGPU verdicts can fail',
    );
  }
  // The instrument: a graph with no pass read as the frame before must show no difference
  // between frame 30 with history and without, or the comparison cannot tell them apart.
  const control = verdicts.filter((v) => history.get(v.id) === false);
  const blind = control.length === 0 || control.some((v) => v.historyDiffers !== 0);
  if (blind) {
    console.error(
      'FAIL instrument: the passes leg has no graph without history, or one of them differs ' +
        'from itself drawn with no frame before — its history verdicts would be blind',
    );
    failures += 1;
  } else {
    console.log(
      `instrument: ${control.map((v) => v.id).join(', ')} reads no frame before and draws frame 30 ` +
        'the same with history and without — the history verdicts can fail',
    );
  }
  for (const v of verdicts) {
    const painted = v.colours[0] > 1 && v.colours[1] > 1;
    const needsHistory = history.get(v.id) === true;
    const compared = across.get(v.id) ?? null;
    const gpuErrors = onGpu.get(v.id)?.errors ?? ['not drawn on WebGPU'];
    const bad =
      v.errors.length > 0 ||
      !painted ||
      (needsHistory && v.historyDiffers === 0) ||
      compared === null ||
      compared.differs > bound;
    if (bad) failures += 1;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${v.id}  passes on WebGL2 into ${v.target || '—'}: ` +
        `${String(v.colours[0])} colours at frame 0, ${String(v.colours[1])} at frame 30` +
        (needsHistory
          ? `, ${String(v.historyDiffers)} pixels differ from frame 30 drawn with no frame before`
          : ', reads no frame before') +
        (compared === null
          ? '; not compared with WebGPU'
          : `; on WebGPU, ${String(compared.differs)} pixels differ at frame 30 (bound ${String(bound)})`),
    );
    for (const e of v.errors) console.log(`        ${e}`);
    if (compared === null) for (const e of gpuErrors) console.log(`        webgpu: ${e}`);
  }
  return failures;
}

/** How far a tier may land from WebGPU: a compute entry's values relative to 1 or their own
 *  size, and a draw's channels in 8-bit steps. */
const ENTRY_TOLERANCE = { compute: 1e-5, fragment: 2 } as const;

/** The render case (`scripts/render-case.ts`, #392): each frame drawn through the program runtime,
 *  colour and depth held to the picture the scene must hold. The instrument first
 *  (AGENTS.md#gate-discipline): the same frames drawn with a depth test the scene does not want
 *  must differ from that picture, or a frame that ignored its depth state would pass. Then a floor
 *  on what a frame holds, so a blank one cannot. */
function renderVerdicts(render: EntryReport['render'], tier: string): number {
  let failures = 0;
  const names = Object.keys(FRAMES) as FrameName[];
  // A frame that did not draw as it should has its own verdict below, which says why; the
  // instrument judges the frames that did.
  const judged = names.filter((name) => !('error' in render.right[name]));
  const blind: string[] = [];
  for (const name of judged) {
    const got = render.wrong[name];
    if ('error' in got) {
      blind.push(`frame ${name} did not draw (${got.error})`);
      continue;
    }
    const d = differences(got, expectedFrame(name));
    if (d.color + d.depth === 0) blind.push(`frame ${name} matched its picture`);
  }
  if (blind.length > 0) {
    console.error(
      `FAIL instrument: the render case on ${tier} drawn with depth 'less' where the scene needs 'greater' must differ from its picture, and ${blind.join('; ')} — its verdicts would be blind`,
    );
    failures += 1;
  } else if (judged.length > 0) {
    console.log(
      `instrument: the render case on ${tier} drawn with depth 'less' where the scene needs 'greater' DIFFERS from its picture — its verdicts can fail`,
    );
  } else {
    console.log(
      'instrument: not shown, since no frame of the render case drew as it should; its verdicts say why',
    );
  }
  for (const name of names) {
    const { what, colours: floor } = FRAMES[name];
    const got = render.right[name];
    if ('error' in got) {
      failures += 1;
      console.log(`FAIL  program render frame ${name} on ${tier}  ${what}: ${got.error}`);
      continue;
    }
    const d = differences(got, expectedFrame(name));
    const distinct = colours(got.color);
    const bad = d.color + d.depth > 0 || distinct < floor;
    if (bad) failures += 1;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  program render frame ${name} on ${tier}  ${what} (${String(distinct)} colours; ` +
        `${String(d.color)} colour and ${String(d.depth)} depth pixels differ from its picture)`,
    );
  }
  return failures;
}

/** Print the entry-call leg's verdicts; the number of failures. */
function entryVerdicts(r: EntryReport, b: { compute: number; fragment: number }): number {
  let failures = 0;
  if (r.perturbedReported) {
    console.log(
      'instrument: the entry comparison REPORTED a changed value — its verdicts can fail',
    );
  } else {
    console.error('FAIL instrument: the entry comparison missed a changed value');
    failures += 1;
  }
  const width = Math.max(...r.verdicts.map((v) => `${v.id}#${v.name}`.length));
  for (const v of r.verdicts) {
    const label = `${v.id}#${v.name}`.padEnd(width);
    if (v.error !== undefined) {
      failures += 1;
      console.log(`FAIL  ${label}  ${v.kind} on webgpu: ${v.error}`);
      continue;
    }
    const cells = v.tiers.map((t) => {
      if (t.skipped !== undefined) return `${t.tier} — (${t.skipped})`;
      if (t.error !== undefined) return `${t.tier} FAIL (${t.error})`;
      const ok = (t.worst ?? Infinity) <= ENTRY_TOLERANCE[v.kind];
      return `${t.tier} ${ok ? 'ok' : 'FAIL'} (worst ${String(t.worst)} over ${String(t.values)})`;
    });
    // A compute reference that wrote nothing would match any tier. A draw's reference is held
    // to WebGPU by its canvas's context in the page, and one flat colour is a frame like any.
    const blind = v.kind === 'compute' && (v.changed ?? 0) === 0;
    const produced =
      v.kind === 'compute' ? `${String(v.changed)} values written` : `${String(v.changed)} colours`;
    const bad = blind || cells.some((c) => c.includes(' FAIL'));
    if (bad) failures += 1;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${label}  ${v.kind} on webgpu (${produced}${blind ? ', which compares nothing' : ''}) against: ${cells.join(' · ')}`,
    );
  }
  // A compute case no example has (`scripts/compute-case.ts`) is there for a WebGL2 tier: one
  // that tier skipped, or never reached, has shown nothing.
  for (const name of ON_WEBGL2) {
    const v = r.verdicts.find((x) => x.id === `case:${name}`);
    const missing = ['webgl2', 'program webgl2'].filter(
      (tier) => v?.tiers.find((t) => t.tier === tier)?.worst === undefined,
    );
    if (missing.length > 0) {
      failures += 1;
      console.log(
        `FAIL  the compute case ${name} was not compared on ${missing.join(' and ')}: ${v === undefined ? 'it was not called' : 'that tier skipped it or failed'}`,
      );
    }
  }
  // A program case (`PROGRAM_CASES`) is there for the program runtime's WebGL2 tier alone.
  for (const name of Object.keys(PROGRAM_CASES)) {
    const v = r.verdicts.find((x) => x.id === `program:${name}`);
    if (v?.tiers.find((t) => t.tier === 'program webgl2')?.worst === undefined) {
      failures += 1;
      console.log(
        `FAIL  the program case ${name} was not compared on program webgl2: ${v === undefined ? 'it was not dispatched' : 'that tier skipped it or failed'}`,
      );
    }
  }
  failures += renderVerdicts(r.render, 'webgpu');
  failures += renderVerdicts(r.glRender, 'webgl2');
  // The canvas: the same picture as the `passes` frame, turned over onto the screen and back.
  {
    const got = r.glCanvas;
    if ('error' in got) {
      failures += 1;
      console.log(`FAIL  program render frame passes into a WebGL2 canvas: ${got.error}`);
    } else {
      const d = differences(got, expectedFrame('passes'));
      const bad = d.color + d.depth > 0;
      if (bad) failures += 1;
      console.log(
        `${bad ? 'FAIL' : 'ok  '}  program render frame passes into a WebGL2 canvas (${String(d.color)} colour and ${String(d.depth)} depth pixels differ from its picture)`,
      );
    }
  }
  console.log(
    `entry calls: ${String(b.compute)} compute entries and ${String(b.fragment)} fragment entries of the examples, ` +
      `called through their host modules · failures: ${String(failures)}`,
  );
  return failures;
}

// ── The declared-names leg: the sweep's verdicts, and the values ──

/** How many of the names a target predeclares its compiler must refuse when a function is declared
 *  under the name itself, and which it must refuse whatever the count: a type, an enumerant, a
 *  builtin function. Measured on Tint and on ANGLE when the leg was written (the floors sit under
 *  what they reported) and printed on every run, so a compiler that came to accept more is seen. */
const OWN_NAME_INSTRUMENT = {
  // Tint refused 64 of the 268: a name is refused where the subject modules use what it hides,
  // which is every type, enumerant and builtin function they write.
  wgsl: {
    floor: 60,
    sentinels: ['f32', 'read', 'select', 'textureLoad', 'rgba8unorm'],
    names: WGSL_PREDECLARED,
  },
  // ANGLE refused 83 of the 89 whatever the module uses. The other six (`mix`, `texture`,
  // `textureLod`, `textureGrad`, `texelFetch`, `textureSize`) it accepts for a function of a
  // signature the built-in does not have, so none of them is a sentinel.
  glsl: {
    floor: 80,
    sentinels: ['fract', 'sin', 'abs', 'dFdx'],
    names: GLSL_ES300_BUILTIN_FUNCTIONS,
  },
} as const;

/** Print the sweep's verdicts; the number of failures. */
function declaredNamesVerdicts(all: readonly Job[], verdicts: readonly Verdict[]): number {
  const sweepOf = new Map(
    all.flatMap((j) => (j.sweep === undefined ? [] : [[j.id, j.sweep] as const])),
  );
  let failures = 0;
  const refused = { wgsl: new Set<string>(), glsl: new Set<string>() };
  const named = new Set<string>();
  let modules = 0;
  let programs = 0;
  let shown = 0;
  for (const v of verdicts) {
    const sweep = sweepOf.get(v.id);
    if (sweep === undefined) continue;
    if (sweep.form === 'own-name') {
      if (v.wgslErrors.length > 0) refused.wgsl.add(sweep.name);
      if ((v.glslErrors?.length ?? 0) > 0) refused.glsl.add(sweep.name);
      continue;
    }
    named.add(sweep.name);
    modules += 1;
    if (v.glslErrors !== null) programs += 1;
    const errors = [
      ...v.wgslErrors.map((e) => `wgsl: ${e}`),
      ...(v.glslErrors ?? []).map((e) => `glsl: ${e}`),
    ];
    if (errors.length === 0) continue;
    failures += 1;
    if (shown++ < 12) {
      console.log(`FAIL  ${v.id}  a function named ${sweep.name}, as the writers emit it`);
      for (const e of errors.slice(0, 3)) console.log(`        ${e}`);
    }
  }
  if (failures > shown) console.log(`FAIL  … and ${String(failures - shown)} more names`);
  for (const target of ['wgsl', 'glsl'] as const) {
    const { floor, sentinels, names } = OWN_NAME_INSTRUMENT[target];
    const seen = [...names].filter((n) => refused[target].has(n));
    const missing = sentinels.filter((n) => !refused[target].has(n));
    const compiler = target === 'wgsl' ? 'Tint' : 'ANGLE';
    if (seen.length < floor || missing.length > 0) {
      failures += 1;
      console.error(
        `FAIL instrument: with the rename undone ${compiler} refuses ${String(seen.length)} of the ` +
          `${String(names.size)} names ${target === 'wgsl' ? 'WGSL predeclares' : 'GLSL ES 3.00 has as built-in functions'} ` +
          `(floor ${String(floor)})` +
          (missing.length > 0 ? `, and accepts the sentinels ${missing.join(', ')}` : '') +
          ' — the sweep above could not have failed',
      );
    } else {
      const accepted = [...names].filter((n) => !refused[target].has(n));
      console.log(
        `instrument: a function declared under its own name is refused by ${compiler} for ` +
          `${String(seen.length)} of the ${String(names.size)} names ${target === 'wgsl' ? 'WGSL predeclares' : 'GLSL ES 3.00 has as built-in functions'}, ` +
          `sentinels ${sentinels.join(', ')} among them` +
          (accepted.length > 0 && accepted.length <= 12
            ? `; accepted: ${accepted.join(', ')}`
            : '') +
          ' — the sweep can fail',
      );
    }
  }
  const notNames = renamedNames().filter((n) => !isIdentifier(n));
  console.log(
    `${failures === 0 ? 'ok  ' : 'FAIL'}  declared names: ${String(named.size)} names a writer renames, ` +
      `each on a compute and a graphics module: ${String(modules)} WGSL modules on Tint, ` +
      `${String(programs)} GLSL ES 3.00 programs on WebGL2 (vertex + fragment + link)` +
      (notNames.length > 0 ? `; ${notNames.join(', ')} is no function's name` : ''),
  );
  return failures;
}

/** What a program of the values leg means at one element of its `out` buffer: the number the
 *  declaration gives, or the range of a value no two implementations of `sin` share bit for bit. */
type Means = number | readonly [number, number];

interface ValueCase {
  readonly id: string;
  readonly source: string;
  /** The `out` buffer before the entry runs. */
  readonly initial: readonly number[];
  readonly means: readonly Means[];
}

/** #403's program (`out[1]` holds 1.25), then one that declares `fract`, `pow`, `exp2` and `f32`
 *  and calls each beside the builtins of those names. */
const VALUE_CASES: readonly ValueCase[] = [
  {
    id: '#403',
    source: `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
@compute([1])
export function main() { out[0] = fract(out[1]); out[2] = fract(1.25); }
`,
    initial: [0, 1.25, 0],
    // The declaration, for the run-time argument and for the literal: the builtin is 0.25.
    means: [0.75, 1.25, 0.75],
  },
  {
    id: 'declared-names',
    source: `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function fract(x: f32): f32 { return 99.; }
function pow(x: f32): f32 { return x + 100.; }
function exp2(x: f32): f32 { return x * 3.; }
function f32(x: f32): f32 { return 7.; }
@compute([1])
export function main() {
  const x = out[1];
  out[0] = fract(x);
  out[2] = pow(x) + Math.pow(x, 2.);
  out[3] = exp2(x);
  out[4] = random(x);
  out[5] = f32(3);
}
`,
    initial: [0, 1.25, 0, 0, 0, 0],
    // The declarations, the builtin `pow` a `Math.pow` is (1.25 squared), `random()` reaching the
    // builtin `fract` (a declaration of it would make it 99), and the cast `f32` is.
    means: [99, 1.25, 102.8125, 3.75, [0, 1], 3],
  },
];

/** The elements of `got` that are not what `means` says, described. */
function disagreements(means: readonly Means[], got: readonly number[]): string[] {
  return means.flatMap((m, i) => {
    const v = got[i];
    if (v === undefined) return [`out[${String(i)}] is missing`];
    const ok =
      typeof m === 'number'
        ? Math.abs(v - m) <= 1e-4 * Math.max(1, Math.abs(m))
        : v >= m[0] && v <= m[1];
    const want = typeof m === 'number' ? String(m) : `a value in ${String(m[0])}..${String(m[1])}`;
    return ok ? [] : [`out[${String(i)}] is ${String(v)}, the declaration gives ${want}`];
  });
}

/** Each case of the values leg on the CPU: the interpreter and its generated twin, run over the
 *  `out` buffer. */
function valuesOnCpu(c: ValueCase): { tier: string; out: number[] }[] {
  const compiled = compile(c.source);
  const errors = compiled.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0)
    throw new Error(`the ${c.id} value program does not compile: ${errors[0]!.message}`);
  return (
    [
      ['oracle', compileModule],
      ['codegen', compileModuleJs],
    ] as const
  ).map(([tier, make]) => {
    const cm = make(compiled.module);
    const out = [...c.initial];
    cm.setBinding('out', out);
    cm.fns['main']!();
    return { tier, out };
  });
}

/** Runs INSIDE the browser: each program as a compute pass of one workgroup over an `out` buffer
 *  bound at group 0, binding 0, read back. */
async function valuesInPage(input: {
  cases: { id: string; wgsl: string; entry: string; initial: number[] }[];
}): Promise<{ id: string; out: number[]; errors: string[] }[]> {
  if (!('gpu' in navigator) || navigator.gpu === undefined) {
    throw new Error('navigator.gpu is absent — WebGPU is not reachable in this browser');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('requestAdapter() returned null — no WebGPU adapter');
  const device = await adapter.requestDevice();
  const results: { id: string; out: number[]; errors: string[] }[] = [];
  for (const c of input.cases) {
    const errors: string[] = [];
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: c.wgsl });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: c.entry },
    });
    const bytes = c.initial.length * 4;
    const storage = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(storage, 0, new Float32Array(c.initial));
    const readback = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: storage } }],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(storage, 0, readback, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = Array.from(new Float32Array(readback.getMappedRange().slice(0)));
    readback.unmap();
    const scope = await device.popErrorScope();
    if (scope !== null) errors.push(scope.message);
    results.push({ id: c.id, out, errors });
  }
  return results;
}

/** Print the values leg's verdicts; the number of failures. */
function valueVerdicts(
  cases: readonly ValueCase[],
  onGpu: readonly { id: string; out: number[]; errors: string[] }[],
): number {
  let failures = 0;
  // Its instrument: the comparison, made on a value moved by one, must report it.
  const first = cases[0]!;
  const moved = first.means.map((m, i) => (i === 0 && typeof m === 'number' ? m + 1 : m));
  if (disagreements(moved, valuesOnCpu(first)[0]!.out).length === 0) {
    console.error('FAIL instrument: the value comparison missed a value moved by one');
    failures += 1;
  } else {
    console.log('instrument: the value comparison REPORTED a moved value — its verdicts can fail');
  }
  for (const c of cases) {
    const tiers = [
      ...valuesOnCpu(c),
      { tier: 'webgpu', out: onGpu.find((g) => g.id === c.id)?.out ?? [] },
    ];
    const errors = onGpu.find((g) => g.id === c.id)?.errors ?? ['not run on WebGPU'];
    const wrong = tiers.flatMap((t) => disagreements(c.means, t.out).map((d) => `${t.tier}: ${d}`));
    const bad = wrong.length > 0 || errors.length > 0;
    if (bad) failures += 1;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${c.id}  values on ${tiers.map((t) => t.tier).join(', ')} are the declaration's`,
    );
    for (const w of wrong) console.log(`        ${w}`);
    for (const e of errors) console.log(`        webgpu: ${e}`);
  }
  return failures;
}

/** #403's declaration drawn by a fragment entry, the answer WebGL2 had none of: one pixel whose
 *  colour is `(fract(p.x), fract(1.25), 0, 1)` at `p.x` of 0.5, with `fract` the file's own. */
const FRAGMENT_VALUE_SOURCE = `"use typeshade";
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const a = fract(p.x);
  const b = fract(1.25);
  return { color: vec4(a, b, 0., 1.) };
}
`;

/** The colour of the pixel at (0, 0) as the CPU oracle gives it, in bytes: `p` is the pixel's
 *  centre, (0.5, 0.5). */
function pixelOnCpu(source: string): number[] {
  const c = compile(source);
  const errors = c.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0)
    throw new Error(`the fragment value program does not compile: ${errors[0]!.message}`);
  const { color } = c.eval('fs', [[0.5, 0.5, 0, 1]]) as { color: number[] };
  return color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/** Runs INSIDE the browser: a fragment program drawn over one pixel of a WebGL2 canvas, and the
 *  pixel read back. */
function drawPixelInPage(input: { vertex: string; fragment: string }): {
  pixel: number[];
  errors: string[];
} {
  const errors: string[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (gl === null) throw new Error('getContext("webgl2") returned null — WebGL2 is not reachable');
  const stage = (type: number, source: string, label: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      errors.push(`${label}: ${gl.getShaderInfoLog(shader) ?? 'compile failed with no log'}`);
      return null;
    }
    return shader;
  };
  const vs = stage(gl.VERTEX_SHADER, input.vertex, 'vertex');
  const fs = stage(gl.FRAGMENT_SHADER, input.fragment, 'fragment');
  const program = gl.createProgram();
  if (vs === null || fs === null || program === null) return { pixel: [], errors };
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    errors.push(`link: ${gl.getProgramInfoLog(program) ?? 'link failed with no log'}`);
    return { pixel: [], errors };
  }
  gl.useProgram(program);
  gl.viewport(0, 0, 1, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return { pixel: Array.from(pixel), errors };
}

/** Print the fragment value's verdict; the number of failures. */
function pixelVerdict(drawn: { pixel: number[]; errors: string[] }): number {
  const worst = (a: readonly number[], b: readonly number[]): number =>
    a.length === b.length ? Math.max(...a.map((v, i) => Math.abs(v - b[i]!))) : Infinity;
  const declared = pixelOnCpu(FRAGMENT_VALUE_SOURCE);
  const builtin = pixelOnCpu(FRAGMENT_VALUE_SOURCE.replace(/^function fract.*\n/m, ''));
  let failures = 0;
  // Its instrument: the declaration's colour and the builtin's are told apart, or a pass could be
  // either.
  if (worst(declared, builtin) <= 1) {
    console.error(
      `FAIL instrument: the declaration's pixel ${declared.join(',')} is the builtin's ${builtin.join(',')}`,
    );
    failures += 1;
  } else {
    console.log(
      `instrument: the pixel comparison tells the declaration's colour (${declared.join(',')}) from the builtin's (${builtin.join(',')})`,
    );
  }
  const bad = drawn.errors.length > 0 || worst(declared, drawn.pixel) > 1;
  if (bad) failures += 1;
  console.log(
    `${bad ? 'FAIL' : 'ok  '}  #403 fragment  the pixel on WebGL2 (${drawn.pixel.join(',')}) is the CPU oracle's ` +
      `and the declaration's (${declared.join(',')})`,
  );
  for (const e of drawn.errors) console.log(`        webgl2: ${e}`);
  return failures;
}

async function main(): Promise<number> {
  const all = jobs();
  if (all.length < 10) {
    console.error(
      `compile gate: the registry has ${String(all.length)} examples — the reader is broken, not the registry`,
    );
    return 1;
  }
  if (CUT !== '' && !all.some((j) => j.id === CUT)) {
    console.error(`compile gate: TYPESHADE_GATE_CUT='${CUT}' names no example`);
    return 1;
  }

  const bundle = await entryBundle();
  const server = await serve(bundle.js);
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: CHROMIUM_ARGS,
  });
  let report: PageReport;
  let entryReport: EntryReport;
  let graphReport: GraphVerdict[];
  let gpuGraphReport: GpuGraphVerdict[];
  let valueReport: { id: string; out: number[]; errors: string[] }[];
  let pixelReport: { pixel: number[]; errors: string[] };
  const allGraphs = graphs();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${String(port)}/`);
    report = await page.evaluate(compileInPage, {
      jobs: all,
      broken: 'fn broken( {',
      brokenPipeline: {
        // A program Tint COMPILES and a pipeline must reject: the vertex entry reads
        // `@location(0)`, and the pipeline below supplies no vertex buffer for it.
        code: `struct In { @location(0) p: vec3<f32> }
struct Out { @builtin(position) pos: vec4<f32> }
@vertex fn vs_probe(i: In) -> Out { return Out(vec4<f32>(i.p, 1.0)); }
@fragment fn fs_probe() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }`,
        vertexEntry: 'vs_probe',
        fragmentEntry: 'fs_probe',
      },
      wanted: wantedFeatures(),
    });
    // The passes leg (change 0026): every example drawn in several passes, on WebGL2, and
    // again on WebGPU to compare with it.
    graphReport = await page.evaluate(drawGraphsInPage, {
      graphs: allGraphs,
      size: GRAPH_SIZE,
    });
    gpuGraphReport = await page.evaluate(drawGraphsOnWebGpu, {
      graphs: allGraphs,
      size: GRAPH_SIZE,
    });
    // The declared-names leg's values: each program as a compute pass on WebGPU.
    valueReport = await page.evaluate(valuesInPage, {
      cases: VALUE_CASES.map((c) => ({
        id: c.id,
        wgsl: compile(c.source).wgsl ?? '',
        entry: 'main',
        initial: [...c.initial],
      })),
    });
    // ... and the same declaration drawn by a fragment entry on WebGL2, whose answer was none.
    pixelReport = await page.evaluate(drawPixelInPage, {
      vertex: KERNEL_VS,
      fragment: compile(FRAGMENT_VALUE_SOURCE).glsl?.fragment ?? '',
    });
    // The entry-call leg (Rule 8.24): the examples' entries, called through their generated
    // host modules on every tier.
    await page.addScriptTag({ url: '/entries.js', type: 'module' });
    await page.waitForFunction(() => '__runEntries' in globalThis);
    entryReport = await page.evaluate(() =>
      (globalThis as unknown as { __runEntries(): Promise<EntryReport> }).__runEntries(),
    );
  } finally {
    await browser.close();
    server.close();
  }

  let failures = 0;
  console.log(`compile gate — WebGPU adapter: ${report.adapter}`);
  if (report.granted.length > 0 || report.missing.length > 0) {
    console.log(
      `features: requested ${report.granted.join(', ') || '(none)'}` +
        (report.missing.length > 0 ? ` · NOT on this adapter: ${report.missing.join(', ')}` : ''),
    );
  }
  // The instrument verdict is printed on BOTH paths. A check whose success is silent cannot be
  // told apart, in a CI log, from a check that was deleted — and this one is the only reason to
  // believe the greens below (AGENTS.md#gate-discipline: validate the instrument before believing a zero).
  if (report.brokenWgslReported && report.brokenGlslReported) {
    console.log('instrument: Tint and WebGL2 both REPORTED a non-program — the verdicts can fail');
  } else {
    console.error(
      `FAIL instrument: a compiler accepted a non-program (Tint reported: ${String(report.brokenWgslReported)}, ` +
        `WebGL2 reported: ${String(report.brokenGlslReported)}) — every verdict below would be blind`,
    );
    failures += 1;
  }
  // The pipeline leg has its own instrument, because its failure mode is different: a leg
  // that silently created nothing would print `ok` for every example.
  if (report.brokenPipelineReported) {
    console.log(
      'instrument: a module Tint COMPILES was REJECTED at createRenderPipeline — the pipeline leg can fail',
    );
  } else {
    console.error(
      'FAIL instrument: createRenderPipeline accepted a pipeline with an unsupplied vertex ' +
        'attribute — the pipeline verdicts below would be blind',
    );
    failures += 1;
  }
  // The examples are judged one by one; a name of the declared-names sweep is judged with the rest
  // of its leg below.
  const sweepIds = new Set(all.filter((j) => j.sweep !== undefined).map((j) => j.id));
  const examplesOnly = report.verdicts.filter((v) => !sweepIds.has(v.id));
  const width = Math.max(...examplesOnly.map((v) => v.id.length));
  const skipReason = new Map(all.map((j) => [j.id, j.pipelineSkip]));
  for (const v of examplesOnly) {
    const wgsl = v.wgslErrors.length === 0 ? 'ok' : 'FAIL';
    const glsl = v.glslErrors === null ? '—' : v.glslErrors.length === 0 ? 'ok' : 'FAIL';
    const pipe = v.pipelineErrors === null ? '—' : v.pipelineErrors.length === 0 ? 'ok' : 'FAIL';
    const bad = wgsl === 'FAIL' || glsl === 'FAIL' || pipe === 'FAIL';
    if (bad) failures += 1;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${v.id.padEnd(width)}  wgsl→Tint ${wgsl.padEnd(4)}  ` +
        `glsl→WebGL2 ${glsl.padEnd(4)}  pipeline ${pipe}`,
    );
    for (const e of v.wgslErrors) console.log(`        wgsl: ${e}`);
    for (const e of v.glslErrors ?? []) console.log(`        glsl: ${e}`);
    for (const e of v.pipelineErrors ?? []) console.log(`        pipeline: ${e}`);
    // A `—` in the pipeline column is a decision, so it says which one.
    if (v.pipelineErrors === null) {
      console.log(`        pipeline: not built — ${skipReason.get(v.id) ?? 'unknown'}`);
    }
  }
  failures += declaredNamesVerdicts(all, report.verdicts);
  failures += valueVerdicts(VALUE_CASES, valueReport);
  failures += pixelVerdict(pixelReport);
  failures += graphVerdicts(allGraphs, graphReport, gpuGraphReport, GRAPH_SIZE);
  failures += entryVerdicts(entryReport, bundle);
  const withGlsl = examplesOnly.filter((v) => v.glslErrors !== null).length;
  const withPipeline = examplesOnly.filter((v) => v.pipelineErrors !== null).length;
  console.log(
    `${String(examplesOnly.length)} examples · WGSL on Tint: ${String(examplesOnly.length)} · ` +
      `GLSL ES 3.00 on WebGL2: ${String(withGlsl)} (vertex + fragment + link) · ` +
      `render pipelines on Tint: ${String(withPipeline)} · failures: ${String(failures)}`,
  );
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
