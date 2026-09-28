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
// THE PASSES LEG (change 0026). An example drawn in several passes has a program per pass, and
// each is a job of the sweep above under `<example>.<pass>`. After the sweep, the page draws
// every such example on WebGL2 the way a host does: the passes in order into textures the
// size of the canvas, each binding named like a pass reading this frame's output of an earlier
// pass or the frame before's of itself or a later one, then the example into the canvas. It
// reads the canvas back at frame 0 and at frame 30, and both must paint. For an example with a
// pass read as the frame before, frame 30 is drawn a second time with no history, and the two
// must differ: that is what shows the previous frame was read. Its own instrument is the same
// comparison made on an example whose passes read nothing of the frame before, which must
// report no difference.
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
// Verifies: Rule 1.1, Rule 11.3, Rule 13.3 (docs/language-design.md; traced in reqs/).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { examples } from '../examples/index.js';
import { shadeExamples } from '../examples/_shade.js';
import { proveKernels } from '../src/core/passes/parallel-loop.js';
import { lowerKernel, lowerKernelGl } from '../src/core/passes/kernel-lower.js';
import { consoleBuffer, hasConsoleCall } from '../src/core/passes/console-buffer.js';
import { entryBundle } from './entry-calls.js';
import type { EntryReport } from './entry-calls-page.js';
import {
  emitGlslModule,
  emitModule,
  hostFeaturesFor,
  reflect,
  wgslBackend,
  type Capability,
} from '../src/index.js';
import type { FuncDecl, ModuleDecl, ShaderType } from '../src/index.js';

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

function jobs(): Job[] {
  return [...ALL_EXAMPLES, ...PASS_EXAMPLES, ...CONSOLE_EXAMPLES]
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
    .concat(kernelJobs());
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
      ].map(({ name, module }) => ({
        name,
        vertex: emitGlslModule(module, 'vertex'),
        fragment: cut(emitGlslModule(module, 'fragment'), name),
      })),
    };
  });
}

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
      verdicts.push({ id: graph.id, errors, colours: [0, 0], historyDiffers: 0, target: '' });
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
    });
  }
  return verdicts;
}

/** Print the passes leg's verdicts; the number of failures. */
function graphVerdicts(all: readonly Graph[], verdicts: readonly GraphVerdict[]): number {
  let failures = 0;
  const history = new Map(all.map((g) => [g.id, g.history]));
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
    const bad = v.errors.length > 0 || !painted || (needsHistory && v.historyDiffers === 0);
    if (bad) failures += 1;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${v.id}  passes on WebGL2 into ${v.target || '—'}: ` +
        `${String(v.colours[0])} colours at frame 0, ${String(v.colours[1])} at frame 30` +
        (needsHistory
          ? `, ${String(v.historyDiffers)} pixels differ from frame 30 drawn with no frame before`
          : ', reads no frame before'),
    );
    for (const e of v.errors) console.log(`        ${e}`);
  }
  return failures;
}

/** How far a tier may land from WebGPU: a compute entry's values relative to 1 or their own
 *  size, and a draw's channels in 8-bit steps. */
const ENTRY_TOLERANCE = { compute: 1e-5, fragment: 2 } as const;

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
  console.log(
    `entry calls: ${String(b.compute)} compute entries and ${String(b.fragment)} fragment entries of the examples, ` +
      `called through their host modules · failures: ${String(failures)}`,
  );
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
    // The passes leg (change 0026): every example drawn in several passes, on WebGL2.
    graphReport = await page.evaluate(drawGraphsInPage, {
      graphs: allGraphs,
      size: [96, 72] as [number, number],
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
  const width = Math.max(...report.verdicts.map((v) => v.id.length));
  const skipReason = new Map(all.map((j) => [j.id, j.pipelineSkip]));
  for (const v of report.verdicts) {
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
  failures += graphVerdicts(allGraphs, graphReport);
  failures += entryVerdicts(entryReport, bundle);
  const withGlsl = report.verdicts.filter((v) => v.glslErrors !== null).length;
  const withPipeline = report.verdicts.filter((v) => v.pipelineErrors !== null).length;
  console.log(
    `${String(report.verdicts.length)} examples · WGSL on Tint: ${String(report.verdicts.length)} · ` +
      `GLSL ES 3.00 on WebGL2: ${String(withGlsl)} (vertex + fragment + link) · ` +
      `render pipelines on Tint: ${String(withPipeline)} · failures: ${String(failures)}`,
  );
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
